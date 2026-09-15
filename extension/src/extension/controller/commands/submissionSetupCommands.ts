import * as vscode from 'vscode';

import type { WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, WebviewCmd } from '@shared/messageContracts';

import { LogCategory, logger } from '@extension/services/loggingService';
import type { GitService } from '@extension/services/workspace';
import { buildAuthenticatedRepositoryUrl } from '@extension/services/workspace';
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

        let token: string;
        try {
            // Get-or-create, not PUT. The plan called for PUT on the assumption
            // that it rotates a participation's token; measured against Artemis
            // develop it does not. With a token already on record it answers 500
            // (InvalidDataAccessApiUsageException server-side), so a renewal
            // built on it would fail for every student who has ever cloned.
            //
            // What this repairs is therefore the common case: the token in
            // `.git/config` is stale or absent (a hand-cloned repository, a
            // remote rewritten elsewhere) while the server's own token is good.
            // A token that is genuinely dead on the server cannot be replaced
            // from here, and the probe below is what keeps that honest: the
            // credential is tested before anything is written, so the student is
            // told it is still refused instead of being handed a repaired-looking
            // remote that fails on the next push.
            token = await this.context.artemisApi.getOrCreateVcsAccessToken(participation.participationId);
        } catch (error: unknown) {
            if (error instanceof ApiError && error.status === 401) {
                // makeRequest has already cleared the session and started the
                // auth-expired flow; this is a login problem, not a token problem.
                this.sendResult('error', 'Your Artemis session expired. Sign in again, then retry.');
                return;
            }
            // The logger prints message and stack, and a git or fetch error can
            // quote the tokenised URL, so it is redacted before it gets there.
            logger.error('Could not create a VCS access token', LogCategory.SUBMISSION,
                extractRedactedErrorMessage(error));
            this.sendResult('error', `Could not renew your access: ${extractRedactedErrorMessage(error)}`);
            return;
        }

        const authenticatedUrl = buildAuthenticatedRepositoryUrl(participation.repositoryUri, login, token);
        if (!authenticatedUrl) {
            this.sendResult('error', 'Artemis returned a repository address this extension cannot use.');
            return;
        }

        // Prove the new credential works BEFORE touching git config. A remote
        // rewritten to a URL that turns out to be refused is worse than the dead
        // one: the student can no longer tell which failure they are looking at.
        const probe = await this.git.probeRemoteAccess(folder, authenticatedUrl);
        if (probe !== 'ok') {
            this.sendResult(
                'error',
                probe === 'refused'
                    ? 'Artemis still refuses this repository, so nothing was changed. '
                        + 'Your access token needs to be renewed in Artemis itself.'
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
