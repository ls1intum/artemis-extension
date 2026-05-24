import * as vscode from 'vscode';

import type { WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, getPayload, WebviewCmd } from '@shared/messageContracts';

import { LogCategory, logger } from '@extension/services/loggingService';
import { GitService } from '@extension/services/workspace';
import { checkWorkspaceFiles } from '@extension/services/workspace/workspaceFileChecker';
import { extractErrorMessage, VSCODE_CONFIG } from '@extension/utils';

import type { CommandContext, CommandMap } from './types';

const GIT_IDENTITY_NOT_CONFIGURED = 'GIT_IDENTITY_NOT_CONFIGURED';

/**
 * @deprecated TEMPORARY: submit and identity handlers will move to
 * RepositorySubmitCommands in the next commit. Tracked under #205.
 */
export class RepositoryCommandModule {
    private readonly gitService: GitService;

    constructor(private readonly context: CommandContext) {
        this.gitService = new GitService();
    }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.SubmitExercise]: this.handleSubmitExercise,
            [WebviewCmd.SaveGitIdentity]: this.handleSaveGitIdentity,
            [WebviewCmd.RequestGitIdentity]: this.handleRequestGitIdentity,
        };
    }

    private handleSubmitExercise = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'submitExercise'>>(message);
            const exerciseTitle = payload.exerciseTitle ?? 'Exercise';
            const commitMessage = payload.commitMessage;
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('Open the exercise repository in VS Code before submitting.');
                return;
            }

            const cwd = workspaceFolder.uri.fsPath;
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Submitting "${exerciseTitle}"...`,
                cancellable: false
            }, async progress => {
                progress.report({ message: 'Preparing repository...' });

                // Use unified workspace file checker (lightweight)
                const result = await checkWorkspaceFiles(workspaceFolder, {
                    includeContent: false,
                    applyFilters: false
                });

                if (!result.hasChanges) {
                    throw new Error('No local changes detected to submit.');
                }

                progress.report({ message: 'Staging changes...' });
                await this.gitService.addAll({ cwd });

                const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
                const configuredDefault = config.get<string>(
                    VSCODE_CONFIG.DEFAULT_COMMIT_MESSAGE_KEY,
                    'Solution submission via Iris extension'
                );
                const messageText = (commitMessage && commitMessage.trim()) || configuredDefault;

                await this.ensureGitIdentityConfigured(cwd);

                progress.report({ message: 'Committing changes...' });
                await this.gitService.commit(messageText, { cwd });

                progress.report({ message: 'Syncing with remote...' });
                try {
                    await this.gitService.pullWithRebase({ cwd });
                } catch (pullError: unknown) {
                    const errorMessage = pullError instanceof Error ? pullError.message : '';
                    if (errorMessage && errorMessage.includes('CONFLICT')) {
                        throw new Error('Merge conflict detected. Please resolve conflicts manually using git and try again.');
                    }
                    logger.warn('Pull failed, but continuing with push:', LogCategory.SUBMISSION, errorMessage);
                }

                progress.report({ message: 'Pushing to Artemis...' });
                await this.gitService.push({ cwd });
            });

            vscode.window.showInformationMessage(`Successfully submitted "${exerciseTitle}".`);

            // Re-check workspace status so UI reflects clean state after push
            void this.context.recheckRepoStatus?.();

            // Ensure WebSocket is connected to receive real-time result updates
            const websocketService = this.context.getWebsocketService?.();
            if (websocketService && !websocketService.isConnected()) {
                logger.info('🔌 Submission successful - ensuring WebSocket connection for result updates...', LogCategory.WEBSOCKET);
                try {
                    await websocketService.connect();
                } catch (wsError) {
                    logger.error('Failed to connect WebSocket after submission:', LogCategory.WEBSOCKET, wsError);
                }
            }
        } catch (error: unknown) {
            logger.error('Submit exercise error:', LogCategory.SUBMISSION, error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to submit exercise.';

            // Don't show error notification if user is being directed to Git Credentials Helper
            if (errorMessage !== GIT_IDENTITY_NOT_CONFIGURED) {
                vscode.window.showErrorMessage(errorMessage);
            }

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
            // Navigate to the Git Credentials Helper view
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
