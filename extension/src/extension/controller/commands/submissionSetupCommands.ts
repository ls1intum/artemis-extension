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

    /** Recompute and post the snapshot. Shared by both commands and by a successful identity save. */
    public async postSnapshot(): Promise<void> {
        const service = this.context.submissionSetup;
        if (!service) { return; }
        const snapshot = await service.buildSnapshot();
        this.context.sendMessage({ type: ExtensionMsg.SubmissionSetupInfo, snapshot });
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
            // PUT, never get-or-create: the GET hands back the very token that
            // stopped working, so a "renewal" would reinstall the dead one.
            token = await this.context.artemisApi.createVcsAccessToken(participation.participationId);
        } catch (error: unknown) {
            if (error instanceof ApiError && error.status === 401) {
                // makeRequest has already cleared the session and started the
                // auth-expired flow; this is a login problem, not a token problem.
                this.sendResult('error', 'Your Artemis session expired. Sign in again, then retry.');
                return;
            }
            logger.error('Could not create a VCS access token', LogCategory.SUBMISSION, error);
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
                    ? 'Artemis refused the new access token, so nothing was changed.'
                    : 'Could not reach Artemis, so nothing was changed.',
            );
            await this.postSnapshot();
            return;
        }

        try {
            const pushUrls = await this.git.getPushUrls(folder);
            await this.git.setRemoteUrl(folder, authenticatedUrl, { alsoPush: pushUrls.length === 1 });
        } catch (error: unknown) {
            logger.error('Could not update the git remote', LogCategory.SUBMISSION, error);
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
            logger.warn('Could not read the current user for a renewal', LogCategory.SUBMISSION, error);
            return undefined;
        }
    }
}
