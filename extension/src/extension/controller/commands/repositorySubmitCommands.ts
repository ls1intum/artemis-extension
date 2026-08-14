import * as vscode from 'vscode';

import type { WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, getPayload, WebviewCmd } from '@shared/messageContracts';

import { LogCategory, logger } from '@extension/services/loggingService';
import type { SubmissionFailureReason, SubmissionPayload } from '@extension/services/telemetry/recording/types';
import * as workspaceServices from '@extension/services/workspace';
import * as fileChecker from '@extension/services/workspace/workspaceFileChecker';
import { extractErrorMessage, VSCODE_CONFIG } from '@extension/utils';

import type { CommandContext, CommandMap } from './types';

const GIT_IDENTITY_NOT_CONFIGURED = 'GIT_IDENTITY_NOT_CONFIGURED';

/**
 * Maximum length of a commit message stored in the session recording. The full message is
 * always used for the actual git commit; only the recorded copy is capped so a large pasted
 * message cannot bloat events.jsonl, consistent with the truncation applied to file snapshots
 * and terminal output elsewhere in the recorder.
 */
const MAX_RECORDED_COMMIT_MESSAGE_LENGTH = 512;

/** Cap a commit message for the recording only, never the value committed to git. */
function capRecordedCommitMessage(message: string | undefined): string | undefined {
    if (message === undefined || message.length <= MAX_RECORDED_COMMIT_MESSAGE_LENGTH) {
        return message;
    }
    return message.slice(0, MAX_RECORDED_COMMIT_MESSAGE_LENGTH);
}

/**
 * User-facing message shown when a git step fails because another process holds
 * the repository's index lock. Replaces the raw `fatal: Unable to create
 * '.git/index.lock'` git output, which is opaque to students.
 */
const GIT_LOCK_USER_MESSAGE =
    'Another Git operation is currently using this repository, so the submission was stopped. '
    + 'Wait for it to finish (and close other Git tools such as the Source Control panel or lazygit), then try again. '
    + 'If this keeps happening, a previous Git process may have left a stale lock file at .git/index.lock that you can delete manually.';

/**
 * Whether a thrown git error is an index-lock contention failure. Scans both the
 * error message and any captured `stderr` (execFile rejections carry it) for the
 * stable, language-independent `index.lock` marker rather than the localized
 * "Another git process seems to be running" sentence.
 */
function isGitLockError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const { message, stderr } = error as { message?: unknown; stderr?: unknown };
    const haystack = `${typeof message === 'string' ? message : ''}\n${typeof stderr === 'string' ? stderr : ''}`;
    return haystack.toLowerCase().includes('index.lock');
}

/**
 * Helper functions injected via the constructor so tests can substitute
 * deterministic doubles. The defaults wire up to the production modules.
 *
 * (This injection seam exists because the production helper is re-exported
 * through `@extension/services/workspace/workspaceFileChecker`, where the
 * TS-emitted descriptor is a non-configurable getter that sinon cannot stub.
 * Direct namespace stubbing fails with "descriptor is not configurable",
 * so we inject the callable instead.)
 */
export interface RepositorySubmitCommandsDeps {
    checkWorkspaceFiles: typeof fileChecker.checkWorkspaceFiles;
}

const defaultDeps: RepositorySubmitCommandsDeps = {
    checkWorkspaceFiles: fileChecker.checkWorkspaceFiles,
};

export class RepositorySubmitCommands {
    private readonly deps: RepositorySubmitCommandsDeps;

    /**
     * Guards against a re-entrant submit (e.g. a double-click on the Submit
     * button, which is not disabled while a submission runs). A second submit
     * while one is in flight would race the first on the same repository's git
     * index and self-inflict an `.git/index.lock` collision. Scoped to this
     * handler's git pipeline; it is a double-click mitigation, not a repo-wide
     * mutex (VS Code's built-in Git and other tools can still touch the repo).
     */
    private _submitInFlight = false;

    constructor(
        private readonly context: CommandContext,
        private readonly gitService: workspaceServices.GitService = new workspaceServices.GitService(),
        deps: Partial<RepositorySubmitCommandsDeps> = {},
    ) {
        this.deps = { ...defaultDeps, ...deps };
    }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.SubmitExercise]: this.handleSubmitExercise,
            [WebviewCmd.SaveGitIdentity]: this.handleSaveGitIdentity,
            [WebviewCmd.RequestGitIdentity]: this.handleRequestGitIdentity,
        };
    }

    private handleSubmitExercise = async (message: WebviewToExtensionMessage): Promise<void> => {
        // Reject re-entrant submits before emitting any telemetry, so a blocked
        // duplicate never produces an orphan `started` without a terminal event.
        if (this._submitInFlight) {
            vscode.window.showInformationMessage('A submission is already in progress. Please wait for it to finish.');
            return;
        }
        this._submitInFlight = true;

        let participationId: number | undefined;
        let failureReason: SubmissionFailureReason = 'other';
        let resolvedCommitMessage: string | undefined;   // function-scoped: assigned inside withProgress, read at the succeeded emit
        let succeededEmitted = false;
        const fireSubmission = (payload: SubmissionPayload): void => {
            this.context.providerRegistry.getArtemisWebviewProvider()?.fireSubmission(payload);
        };
        try {
            const payload = getPayload<WebCmd<'submitExercise'>>(message);
            // participationId is contractually required, but guard: a malformed/partial message must
            // not produce a submission event with a missing participationId (the parser rejects that).
            participationId = typeof payload.participationId === 'number' ? payload.participationId : undefined;
            const exerciseTitle = payload.exerciseTitle ?? 'Exercise';
            const commitMessage = payload.commitMessage;
            const rawCommitMessage = capRecordedCommitMessage(commitMessage?.trim() || undefined);
            if (participationId !== undefined) {
                // fireSubmission is synchronous; the recorder's _record phase guard drops the event
                // if no session is recording, so no session-state guard is needed at any call site.
                fireSubmission({ status: 'started', participationId, commitMessage: rawCommitMessage });
            }

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                failureReason = 'no-workspace';
                throw new Error('Open the exercise repository in VS Code before submitting.');
            }

            const cwd = workspaceFolder.uri.fsPath;
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Submitting "${exerciseTitle}"...`,
                cancellable: false
            }, async progress => {
                progress.report({ message: 'Preparing repository...' });

                const result = await this.deps.checkWorkspaceFiles(workspaceFolder, {
                    includeContent: false,
                    applyFilters: false,
                    // Surface a `git status` failure (e.g. index.lock contention)
                    // instead of letting it collapse into a false "no changes".
                    throwOnGitError: true
                });

                if (!result.hasChanges) {
                    failureReason = 'no-changes';
                    throw new Error('No local changes detected to submit.');
                }

                progress.report({ message: 'Staging changes...' });
                await this.gitService.addAll({ cwd });

                const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
                const configuredDefault = config.get<string>(
                    VSCODE_CONFIG.DEFAULT_COMMIT_MESSAGE_KEY,
                    'Solution submission via Iris extension'
                );
                resolvedCommitMessage = (commitMessage && commitMessage.trim()) || configuredDefault;

                await this.ensureGitIdentityConfigured(cwd);

                progress.report({ message: 'Committing changes...' });
                await this.gitService.commit(resolvedCommitMessage, { cwd });

                progress.report({ message: 'Syncing with remote...' });
                try {
                    await this.gitService.pullWithRebase({ cwd });
                } catch (pullError: unknown) {
                    const pullMessage = pullError instanceof Error ? pullError.message : '';
                    if (pullMessage && pullMessage.includes('CONFLICT')) {
                        failureReason = 'merge-conflict';
                        throw new Error('Merge conflict detected. Please resolve conflicts manually using git and try again.');
                    }
                    if (isGitLockError(pullError)) {
                        // `git push` does not take the index lock, so a swallowed pull lock
                        // would let us push on an un-rebased branch and report a false
                        // success. Surface it instead so the outer catch shows the lock message.
                        throw pullError;
                    }
                    logger.warn('Pull failed, but continuing with push:', LogCategory.SUBMISSION, pullMessage);
                }

                progress.report({ message: 'Pushing to Artemis...' });
                try {
                    await this.gitService.push({ cwd });
                } catch (pushError: unknown) {
                    failureReason = 'push-failed';
                    throw pushError;
                }
            });

            // The only success site. The post-success work below cannot throw into the
            // outer catch (recheck is fire-and-forget and the websocket reconnect has its own
            // .catch), but succeededEmitted also hardens "exactly one terminal per started".
            if (participationId !== undefined) {
                fireSubmission({ status: 'succeeded', participationId, commitMessage: capRecordedCommitMessage(resolvedCommitMessage) });
                succeededEmitted = true;
            }

            vscode.window.showInformationMessage(`Successfully submitted "${exerciseTitle}".`);

            // Re-check workspace status so UI reflects clean state after push
            void this.context.recheckRepoStatus?.();

            // Ensure WebSocket is connected to receive real-time result updates
            const websocketService = this.context.getWebsocketService?.();
            if (websocketService && !websocketService.isConnected()) {
                logger.info('🔌 Submission successful - ensuring WebSocket connection for result updates...', LogCategory.WEBSOCKET);
                // Fire-and-forget: a hanging connect() must not keep _submitInFlight
                // set after the git work is done and `succeeded` was emitted.
                void websocketService.connect().catch(wsError => {
                    logger.error('Failed to connect WebSocket after submission:', LogCategory.WEBSOCKET, wsError);
                });
            }
        } catch (error: unknown) {
            logger.error('Submit exercise error:', LogCategory.SUBMISSION, error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to submit exercise.';

            if (errorMessage === GIT_IDENTITY_NOT_CONFIGURED) {
                // Sentinel constant (not free-text parsing): identity flow already navigated the user.
                failureReason = 'git-identity-missing';
            } else if (isGitLockError(error)) {
                // A lock can throw at any git step (status, add, commit, pull, push);
                // replace the raw git output with actionable guidance and record a
                // uniform 'other' reason (a lock is an environment failure, not e.g.
                // a genuine push rejection) regardless of which step the lock hit.
                failureReason = 'other';
                vscode.window.showErrorMessage(GIT_LOCK_USER_MESSAGE);
            } else {
                vscode.window.showErrorMessage(errorMessage);
            }

            if (participationId !== undefined && !succeededEmitted) {
                fireSubmission({ status: 'failed', participationId, failureReason });
            }
        } finally {
            this._submitInFlight = false;
        }
    };

    private async ensureGitIdentityConfigured(cwd: string): Promise<void> {
        const identity = await this.gitService.getIdentity({ cwd });

        if (identity) {
            return;
        }

        const choice = await vscode.window.showWarningMessage(
            'Git identity not configured. Artemis and Git need your name and email to submit changes. Without them, submissions fail with "Please tell me who you are."',
            { modal: true },
            'Configure Git Identity'
        );

        if (choice === 'Configure Git Identity') {
            this.context.actionHandler.showGitCredentials();
        }

        throw new Error(GIT_IDENTITY_NOT_CONFIGURED);
    }

    private async getGitConfigValue(key: string, cwd: string): Promise<string | undefined> {
        const local = await this.gitService.getConfigValue(key, { cwd }, false);
        if (local) {
            return local;
        }
        return await this.gitService.getConfigValue(key, { cwd }, true);
    }

    private handleSaveGitIdentity = async (message: WebviewToExtensionMessage): Promise<void> => {
        const sendResult = (status: 'success' | 'error' | 'warning' | 'info', text: string) => {
            this.context.sendMessage({
                type: ExtensionMsg.GitCredentialsResult,
                status,
                message: text
            });
        };
        try {
            const payload = getPayload<WebCmd<'saveGitIdentity'>>(message);
            const rawName = payload.name.trim();
            const rawEmail = payload.email.trim();

            if (!rawName) {
                sendResult('warning', 'Name cannot be empty.');
                vscode.window.showErrorMessage('Please provide a name before saving your Git identity.');
                return;
            }

            if (!rawEmail || !/\S+@\S+\.\S+/.test(rawEmail)) {
                sendResult('warning', 'Enter a valid email address.');
                vscode.window.showErrorMessage('Please provide a valid email address before saving your Git identity.');
                return;
            }
            await this.gitService.setGlobalIdentity({ name: rawName, email: rawEmail });
            sendResult('success', 'Git identity saved globally.');
            vscode.window.showInformationMessage('Git author information saved globally.');
        } catch (error: unknown) {
            logger.error('Failed to save Git identity globally:', LogCategory.SUBMISSION, error);
            const messageText = extractErrorMessage(error);
            sendResult('error', `Failed to save Git identity: ${messageText}`);
            vscode.window.showErrorMessage(`Failed to save Git identity: ${messageText}`);
        }
    };

    private handleRequestGitIdentity = async (_message: WebviewToExtensionMessage): Promise<void> => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const cwd = workspaceFolder?.uri.fsPath ?? process.cwd();

        const name = await this.getGitConfigValue('user.name', cwd);
        const email = await this.getGitConfigValue('user.email', cwd);

        this.context.sendMessage({
            type: ExtensionMsg.GitIdentityInfo,
            name: name ?? '',
            email: email ?? ''
        });
    };
}
