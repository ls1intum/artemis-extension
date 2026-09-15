import * as vscode from 'vscode';

import type { WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, WebviewCmd } from '@shared/messageContracts';

import { LogCategory, logger } from '@extension/services/loggingService';
import type { GitService } from '@extension/services/workspace';
import type { ResolvedParticipation } from '@extension/services/workspace';
import { buildAuthenticatedRepositoryUrl, normalizeRepositoryUrl } from '@extension/services/workspace';
import { ApiError } from '@extension/types';
import { extractRedactedErrorMessage } from '@extension/utils';

import type { CommandContext, CommandMap } from './types';

/**
 * The Submission Setup page's two actions: recompute what is true, and repair
 * the one thing the student cannot repair themselves.
 *
 * Neither command takes a payload. The snapshot has no inputs the page owns,
 * and renewal deliberately re-resolves the participation from the workspace
 * rather than accepting an id from the webview: that id ends up in a request
 * for a credential, and the page is the least authoritative party in the chain.
 */
export class SubmissionSetupCommands {
    constructor(
        private readonly context: CommandContext,
        private readonly git: GitService,
    ) {}

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.RefreshSubmissionSetup]: this.handleRefresh,
            [WebviewCmd.RenewArtemisAccess]: this.handleRenew,
        };
    }

    /**
     * Recompute and post the snapshot.
     *
     * A snapshot is also what releases the page's busy state, so a failure here
     * must still send something: a silent throw would leave a button spinning
     * for the rest of the session.
     */
    public async postSnapshot(): Promise<void> {
        const service = this.context.submissionSetup;
        if (!service) { return; }
        try {
            const snapshot = await service.buildSnapshot();
            this.context.sendMessage({ type: ExtensionMsg.SubmissionSetupInfo, snapshot });
        } catch (error: unknown) {
            logger.error('Could not build the submission setup snapshot', LogCategory.SUBMISSION,
                extractRedactedErrorMessage(error));
            this.sendResult('error', 'Could not check your setup. See the Artemis log for details.');
        }
    }

    private sendResult(status: 'success' | 'error' | 'warning' | 'info', message: string): void {
        this.context.sendMessage({ type: ExtensionMsg.SubmissionSetupResult, status, message });
    }

    private handleRefresh = async (_message: WebviewToExtensionMessage): Promise<void> => {
        await this.postSnapshot();
    };

    private handleRenew = async (_message: WebviewToExtensionMessage): Promise<void> => {
        const service = this.context.submissionSetup;
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!service || !folder) {
            this.sendResult('warning', 'Open your exercise folder first.');
            return;
        }

        const participation = await service.resolveParticipation();
        if (!participation) {
            this.sendResult('warning', 'Could not work out which Artemis participation this folder belongs to.');
            return;
        }

        const login = (await this.currentLogin())?.trim();
        if (!login) {
            // The clone path falls back to the literal "user" here. Renewal must
            // not: that produces a URL which authenticates as nobody, and the
            // student would be left with a remote that is broken in a new way.
            this.sendResult('error', 'Could not read your Artemis account. Sign in again, then retry.');
            return;
        }

        // Two steps, cheapest first. Most broken remotes carry a stale or absent
        // token while the server's own token is perfectly good: a hand-cloned
        // repository, or a remote rewritten elsewhere. Asking for the token
        // Artemis already has repairs those without invalidating a credential
        // that may also be in use in another checkout.
        let authenticatedUrl = await this.buildUrlFor(participation, login, false);
        if (authenticatedUrl === undefined) { return; }

        // Prove the credential works BEFORE touching git config. A remote
        // rewritten to a URL that turns out to be refused is worse than the dead
        // one: the student can no longer tell which failure they are looking at.
        let probe = await this.git.probeRemoteAccess(folder, authenticatedUrl);

        if (probe === 'refused') {
            // Artemis' own token is dead too, so it has to be replaced. PUT
            // alone cannot do that: with a token on record it answers 500 (a
            // bare IllegalStateException in ParticipationVCSAccessTokenRepository
            // that Spring translates), so the old one is revoked first.
            this.sendResult('info', 'That access token no longer works. Getting a new one from Artemis...');
            authenticatedUrl = await this.buildUrlFor(participation, login, true);
            if (authenticatedUrl === undefined) { return; }
            probe = await this.git.probeRemoteAccess(folder, authenticatedUrl);
        }

        if (probe !== 'ok') {
            this.sendResult(
                'error',
                probe === 'refused'
                    ? 'Artemis still refuses this repository, so nothing was changed. '
                        + 'Ask your instructor whether you still have access to it.'
                    : 'Could not reach Artemis, so nothing was changed.',
            );
            await this.postSnapshot();
            return;
        }

        try {
            // Read the push URL before deciding, and let a failure abort: a
            // read that quietly answered "none" would repair the fetch URL and
            // leave the push using the dead credential.
            const pushUrls = await this.git.getPushUrls(folder);
            await this.git.setRemoteUrl(folder, authenticatedUrl, { alsoPush: pushUrls.length === 1 });
        } catch (error: unknown) {
            logger.error('Could not update the git remote', LogCategory.SUBMISSION,
                extractRedactedErrorMessage(error));
            this.sendResult('error', `Could not update your repository: ${extractRedactedErrorMessage(error)}`);
            await this.postSnapshot();
            return;
        }

        this.sendResult('success', 'Access renewed. You can submit again.');
        await this.postSnapshot();
    };

    /**
     * The authenticated URL for this participation, from the token Artemis
     * already has or, when `rotate` is set, from a freshly minted one.
     *
     * `undefined` means the caller must stop: the failure has already been
     * reported to the page.
     */
    private async buildUrlFor(
        participation: ResolvedParticipation,
        login: string,
        rotate: boolean,
    ): Promise<string | undefined> {
        let token: string;
        try {
            token = rotate
                ? await this.rotateToken(participation)
                : await this.context.artemisApi.getOrCreateVcsAccessToken(participation.participationId);
        } catch (error: unknown) {
            if (error instanceof ApiError && error.status === 401) {
                // makeRequest has already cleared the session and started the
                // auth-expired flow; this is a login problem, not a token problem.
                this.sendResult('error', 'Your Artemis session expired. Sign in again, then retry.');
                return undefined;
            }
            // The logger prints message and stack, and a fetch error can quote
            // the tokenised URL, so it is redacted before it gets there.
            logger.error('Could not obtain a VCS access token', LogCategory.SUBMISSION,
                extractRedactedErrorMessage(error));
            this.sendResult('error', `Could not renew your access: ${extractRedactedErrorMessage(error)}`);
            return undefined;
        }

        const url = buildAuthenticatedRepositoryUrl(participation.repositoryUri, login, token);
        if (!url) {
            this.sendResult('error', 'Artemis returned a repository address this extension cannot use.');
            return undefined;
        }
        return url;
    }

    /**
     * Revoke this participation's token and mint a replacement.
     *
     * The id comes from the account's token overview, matched on the repository
     * the participation names rather than on its exercise: an exercise can own a
     * graded and a practice token, and revoking the wrong one would break the
     * other checkout while leaving this one dead.
     */
    private async rotateToken(participation: ResolvedParticipation): Promise<string> {
        const tokens = await this.context.artemisApi.listVcsAccessTokens();
        const target = normalizeRepositoryUrl(participation.repositoryUri);
        const existing = tokens.find(t =>
            t.tokenType === 'PARTICIPATION'
            && t.repositoryUri !== undefined
            && normalizeRepositoryUrl(t.repositoryUri) === target);

        if (existing) {
            await this.context.artemisApi.revokeVcsAccessToken(existing.id, 'PARTICIPATION');
        }
        try {
            return await this.context.artemisApi.createVcsAccessToken(participation.participationId);
        } catch (error: unknown) {
            // The old token is gone by now, so an account left with none would
            // be worse off than before the repair started.
            logger.error('Could not create a replacement VCS access token', LogCategory.SUBMISSION,
                extractRedactedErrorMessage(error));
            return await this.context.artemisApi.getOrCreateVcsAccessToken(participation.participationId);
        }
    }

    private async currentLogin(): Promise<string | undefined> {
        try {
            return (await this.context.artemisApi.getCurrentUser())?.login;
        } catch (error: unknown) {
            logger.warn('Could not read the current user for a renewal', LogCategory.SUBMISSION,
                extractRedactedErrorMessage(error));
            return undefined;
        }
    }
}
