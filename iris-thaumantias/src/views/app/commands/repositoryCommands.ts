import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { CommandContext, CommandMap } from './types';
import { getPayload, getOptionalPayload, ExtensionMsg, WebviewCmd } from '../../../shared/messageContracts';
import type {
    WebviewToExtensionMessage,
    WebCmd,
} from '../../../shared/messageContracts';
import { VSCODE_CONFIG, checkWorkspaceFiles, extractErrorMessage } from '../../../utils';
import { normalizeRepositoryUrl, getWorkspaceRepositoryUrl, getWorkspaceStatus, GitService } from '../../../services';
import { logger, LogCategory } from '../../../services/loggingService';

const GIT_IDENTITY_NOT_CONFIGURED = 'GIT_IDENTITY_NOT_CONFIGURED';

interface RepoContext {
    expectedRepoUrl: string;
    exerciseId: number;
}

export class RepositoryCommandModule {
    private currentRepoContext?: RepoContext;
    private currentWorkspacePath?: string;
    private workspaceChangeDebounce?: NodeJS.Timeout;
    private workspaceListenersRegistered = false;
    private clonedRepositories: Map<number, { path: string; title: string }> = new Map();
    private dirtyPagesCheckDebounce?: NodeJS.Timeout;
    private readonly listenerDisposables: vscode.Disposable[] = [];
    private readonly gitService: GitService;

    constructor(private readonly context: CommandContext) {
        this.gitService = new GitService();
        this.registerWorkspaceListeners();
    }

    /**
     * Set the repository context so workspace listeners can detect changes
     * without requiring a manual checkRepositoryStatus command.
     */
    public setRepositoryContext(repoUrl: string, exerciseId: number): void {
        this.currentRepoContext = { expectedRepoUrl: repoUrl, exerciseId };
        this.currentWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    public clearRepositoryContext(): void {
        this.currentRepoContext = undefined;
    }

    public dispose(): void {
        for (const d of this.listenerDisposables) {
            d.dispose();
        }
        this.listenerDisposables.length = 0;
        if (this.workspaceChangeDebounce) {
            clearTimeout(this.workspaceChangeDebounce);
            this.workspaceChangeDebounce = undefined;
        }
        if (this.dirtyPagesCheckDebounce) {
            clearTimeout(this.dirtyPagesCheckDebounce);
            this.dirtyPagesCheckDebounce = undefined;
        }
        this.workspaceListenersRegistered = false;
    }

    /**
     * Build an authenticated clone URL by fetching a VCS token and the current user's login.
     * Returns the URL string on success, or null if token retrieval or URL construction fails.
     */
    private async buildAuthenticatedUrl(participationId: number, repositoryUri: string): Promise<string | null> {
        let vcsToken: string;
        try {
            vcsToken = await this.context.artemisApi.getOrCreateVcsAccessToken(participationId);
        } catch (tokenErr) {
            logger.error('Failed to get participation token:', LogCategory.SUBMISSION, tokenErr);
            vscode.window.showErrorMessage('Failed to obtain VCS access token.');
            return null;
        }

        let username = 'user';
        try {
            const currentUser = await this.context.artemisApi.getCurrentUser();
            if (currentUser?.login) {
                username = currentUser.login;
            }
        } catch (userErr) {
            logger.warn('Could not fetch current user, defaulting username:', LogCategory.SUBMISSION, userErr);
        }

        try {
            const url = new URL(repositoryUri);
            url.username = username;
            url.password = vcsToken;
            return url.toString();
        } catch {
            vscode.window.showErrorMessage('Invalid repository URL received from server.');
            return null;
        }
    }

    private async _selectFolder(openLabel: string, title: string): Promise<string | undefined> {
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel,
            title,
        });
        return folderUri?.[0]?.fsPath;
    }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.CheckRepositoryStatus]: this.handleCheckRepositoryStatus,
            [WebviewCmd.CloneRepository]: this.handleCloneRepository,
            [WebviewCmd.SubmitExercise]: this.handleSubmitExercise,
            [WebviewCmd.SaveGitIdentity]: this.handleSaveGitIdentity,
            [WebviewCmd.RequestGitIdentity]: this.handleRequestGitIdentity,
            [WebviewCmd.StartPractice]: this.handleStartPractice,
            [WebviewCmd.StartExercise]: this.handleStartExercise,
            [WebviewCmd.OpenRepository]: this.handleOpenRepository,
        };
    }

    public hasRecentlyClonedRepo(exerciseId: number): boolean {
        const repoInfo = this.clonedRepositories.get(exerciseId);
        if (!repoInfo) {
            return false;
        }
        // Validate that the cached path still exists
        if (!fs.existsSync(repoInfo.path)) {
            this.clonedRepositories.delete(exerciseId);
            return false;
        }
        return true;
    }

    private handleCheckRepositoryStatus = async (_message: WebviewToExtensionMessage): Promise<void> => {
        const exerciseData = this.context.appStateManager.currentExerciseData;
        const exercise = exerciseData?.exercise;
        const participations = exercise?.studentParticipations ?? [];
        const repoUris = participations
            .map(p => p.repositoryUri)
            .filter((uri): uri is string => !!uri);

        if (exercise?.id === undefined || repoUris.length === 0) {
            // Fall back to cached context if available
            if (this.currentRepoContext) {
                await this._checkRepositoryStatusWithContext([this.currentRepoContext.expectedRepoUrl], this.currentRepoContext.exerciseId);
            } else {
                logger.warn('No repository context available', LogCategory.SUBMISSION);
            }
            return;
        }

        this.currentRepoContext = { expectedRepoUrl: repoUris[0], exerciseId: exercise.id };
        await this._checkRepositoryStatusWithContext(repoUris, exercise.id);
    };

    private async _checkRepositoryStatusWithContext(repoUris: string[], exerciseId: number): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            this.currentWorkspacePath = workspaceFolder?.uri.fsPath;

            // Try each participation URI until we find a match
            for (const uri of repoUris) {
                const status = await getWorkspaceStatus(uri, workspaceFolder);
                if (status.isConnected) {
                    this.currentRepoContext = { expectedRepoUrl: uri, exerciseId };
                    this.context.sendMessage({
                        type: ExtensionMsg.UpdateRepoStatus,
                        isConnected: status.isConnected,
                        hasChanges: status.hasChanges,
                        isPracticeRepo: status.isPracticeRepo,
                    });
                    return;
                }
            }

            // No match found
            this.context.sendMessage({
                type: ExtensionMsg.UpdateRepoStatus,
                isConnected: false,
                hasChanges: false,
                isPracticeRepo: false,
            });
        } catch (error: unknown) {
            logger.error('Check repository status error:', LogCategory.SUBMISSION, error);
            vscode.window.showErrorMessage('Error checking repository status');
        }
    };

    private handleCloneRepository = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'cloneRepository'>>(message);
            const { participationId, repositoryUri, exerciseTitle } = payload;
            const exerciseId = participationId; // Use participationId for tracking
            if (!participationId || !repositoryUri) {
                vscode.window.showErrorMessage('Cannot clone: missing participation or repository URL.');
                return;
            }

            const isGitAvailable = await this.gitService.isGitAvailable();
            if (!isGitAvailable) {
                vscode.window.showErrorMessage('Git not found in PATH. Please install Git to clone repositories.');
                return;
            }

            // Check if default clone path is configured
            const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
            const defaultClonePath = config.get<string>(VSCODE_CONFIG.DEFAULT_CLONE_PATH_KEY, '').trim();
            const showPrompt = config.get<boolean>(VSCODE_CONFIG.SHOW_SET_DEFAULT_CLONE_PATH_PROMPT_KEY, true);

            let selectedPath: string;

            if (defaultClonePath) {
                // Verify the default path exists
                try {
                    const fs = await import('fs');
                    const stats = await fs.promises.stat(defaultClonePath);
                    if (stats.isDirectory()) {
                        selectedPath = defaultClonePath;
                    } else {
                        vscode.window.showWarningMessage(`Default clone path "${defaultClonePath}" is not a directory. Please select a folder.`);
                        const fallbackPath = await this._selectFolder('Select Clone Destination', `Choose where to clone ${exerciseTitle}`);
                        if (!fallbackPath) {
                            vscode.window.showInformationMessage('Clone cancelled - no destination selected.');
                            return;
                        }
                        selectedPath = fallbackPath;
                    }
                } catch (error: unknown) {
                    vscode.window.showWarningMessage(`Default clone path "${defaultClonePath}" does not exist. Please select a folder.`);
                    const errorFallbackPath = await this._selectFolder('Select Clone Destination', `Choose where to clone ${exerciseTitle}`);
                    if (!errorFallbackPath) {
                        vscode.window.showInformationMessage('Clone cancelled - no destination selected.');
                        return;
                    }
                    selectedPath = errorFallbackPath;
                }
            } else {
                // No default path configured - show prompt if enabled
                if (showPrompt) {
                    const choice = await vscode.window.showInformationMessage(
                        'Where should exercise repositories be cloned?\n\nYou can set a default folder now (e.g., ~/artemis-exercises) so all future exercises are automatically saved there, or choose a location each time.',
                        { modal: true },
                        'Set Default Folder',
                        'Choose Each Time',
                        "Don't Ask Again"
                    );

                    if (choice === 'Set Default Folder') {
                        const defaultFolderPath = await this._selectFolder('Set as Default', 'Select default folder for all exercise repositories');
                        if (defaultFolderPath) {
                            selectedPath = defaultFolderPath;
                            // Save as default
                            await config.update(
                                VSCODE_CONFIG.DEFAULT_CLONE_PATH_KEY,
                                selectedPath,
                                vscode.ConfigurationTarget.Global
                            );
                            vscode.window.showInformationMessage(`✓ All exercises will now be cloned to: ${selectedPath}`);
                        } else {
                            vscode.window.showInformationMessage('Clone cancelled - no folder selected.');
                            return;
                        }
                    } else if (choice === "Don't Ask Again") {
                        // Disable the prompt permanently
                        await config.update(
                            VSCODE_CONFIG.SHOW_SET_DEFAULT_CLONE_PATH_PROMPT_KEY,
                            false,
                            vscode.ConfigurationTarget.Global
                        );

                        // Still need to get a folder for this clone
                        const dontAskPath = await this._selectFolder('Select Folder', `Where should "${exerciseTitle}" be cloned?`);
                        if (!dontAskPath) {
                            vscode.window.showInformationMessage('Clone cancelled - no folder selected.');
                            return;
                        }
                        selectedPath = dontAskPath;
                    } else if (choice === 'Choose Each Time') {
                        const chosenPath = await this._selectFolder('Select Folder', `Where should "${exerciseTitle}" be cloned?`);
                        if (!chosenPath) {
                            vscode.window.showInformationMessage('Clone cancelled - no folder selected.');
                            return;
                        }
                        selectedPath = chosenPath;
                    } else {
                        // User cancelled the modal (pressed ESC) - abort clone
                        vscode.window.showInformationMessage('Clone cancelled.');
                        return;
                    }
                } else {
                    // Prompt disabled, just show folder picker
                    const promptDisabledPath = await this._selectFolder('Select Clone Destination', `Choose where to clone ${exerciseTitle}`);
                    if (!promptDisabledPath) {
                        vscode.window.showInformationMessage('Clone cancelled - no destination selected.');
                        return;
                    }
                    selectedPath = promptDisabledPath;
                }

            }

            const cloneUrl = await this.buildAuthenticatedUrl(participationId, repositoryUri);
            if (!cloneUrl) {
                return;
            }

            const terminal = vscode.window.createTerminal(`Exercise ${exerciseId}`);
            terminal.show();
            terminal.sendText(`cd "${selectedPath}"`);
            terminal.sendText(`git clone ${cloneUrl}`);
            vscode.window.showInformationMessage(`Cloning repository for "${exerciseTitle}" to ${selectedPath} using participation token...`);

            const repoName = path.basename(repositoryUri).replace(/\.git$/, '');
            const repoPath = path.join(selectedPath, repoName);

            if (this.clonedRepositories.size >= 10 && !this.clonedRepositories.has(exerciseId)) {
                const firstKey = this.clonedRepositories.keys().next().value;
                if (firstKey !== undefined) {
                    this.clonedRepositories.delete(firstKey);
                }
            }

            this.clonedRepositories.set(exerciseId, { path: repoPath, title: exerciseTitle });

            // Poll for the cloned directory to appear (up to 60s)
            const pollInterval = 2000;
            const maxAttempts = 30;
            let attempts = 0;
            const pollTimer = setInterval(() => {
                attempts++;
                if (fs.existsSync(repoPath)) {
                    clearInterval(pollTimer);
                    this.context.sendMessage({
                        type: ExtensionMsg.ShowClonedRepoNotice,
                        exerciseTitle: exerciseTitle
                    });
                } else if (attempts >= maxAttempts) {
                    clearInterval(pollTimer);
                    this.clonedRepositories.delete(exerciseId);
                }
            }, pollInterval);

            const openAction = await vscode.window.showInformationMessage('Open the cloned repository when ready?', 'Open Folder', 'Skip');
            if (openAction === 'Open Folder') {
                setTimeout(() => {
                    const repoUri = vscode.Uri.file(repoPath);
                    void vscode.commands.executeCommand('vscode.openFolder', repoUri, true);
                }, 3000);
            }
        } catch (error: unknown) {
            logger.error('Clone repository error:', LogCategory.SUBMISSION, error);
            vscode.window.showErrorMessage('Failed to clone repository.');
        }
    };

    private handleSubmitExercise = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'submitExercise'>>(message);
            const participationId = payload.participationId;
            const exerciseId = payload.exerciseId ?? 0;
            const exerciseTitle = payload.exerciseTitle ?? 'Exercise';
            const commitMessage = payload.commitMessage;
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('Open the exercise repository in VS Code before submitting.');
                return;
            }

            this.currentWorkspacePath = workspaceFolder.uri.fsPath;
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
            if (this.currentRepoContext) {
                void this._checkRepositoryStatusWithContext(
                    [this.currentRepoContext.expectedRepoUrl],
                    this.currentRepoContext.exerciseId,
                );
            }

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

    private registerWorkspaceListeners(): void {
        if (this.workspaceListenersRegistered) {
            return;
        }

        const handleUri = (uri?: vscode.Uri) => {
            this.scheduleWorkspaceStatusCheck(uri);
        };

        this.listenerDisposables.push(
            vscode.workspace.onDidSaveTextDocument(document => {
                handleUri(document.uri);
                this.scheduleDirtyPagesCheck();
            }),
            vscode.workspace.onDidCreateFiles(event => {
                if (event.files && event.files.length > 0) {
                    handleUri(event.files[0]);
                } else {
                    handleUri();
                }
            }),
            vscode.workspace.onDidDeleteFiles(event => {
                if (event.files && event.files.length > 0) {
                    handleUri(event.files[0]);
                } else {
                    handleUri();
                }
            }),
            vscode.workspace.onDidRenameFiles(event => {
                if (event.files && event.files.length > 0) {
                    handleUri(event.files[0].newUri);
                } else {
                    handleUri();
                }
            }),
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.uri.scheme === 'file') {
                    this.scheduleDirtyPagesCheck();
                }
            }),
        );

        this.workspaceListenersRegistered = true;
    }

    private scheduleWorkspaceStatusCheck(uri?: vscode.Uri): void {
        if (!this.currentRepoContext || !this.currentWorkspacePath) {
            return;
        }

        if (uri) {
            const relative = path.relative(this.currentWorkspacePath, uri.fsPath);
            if (relative.startsWith('..')) {
                return;
            }
        }

        if (this.workspaceChangeDebounce) {
            clearTimeout(this.workspaceChangeDebounce);
        }

        this.workspaceChangeDebounce = setTimeout(() => {
            if (this.currentRepoContext) {
                void this._checkRepositoryStatusWithContext(
                    [this.currentRepoContext.expectedRepoUrl],
                    this.currentRepoContext.exerciseId,
                );
            }
        }, 500);
    }

    private scheduleDirtyPagesCheck(): void {
        if (this.dirtyPagesCheckDebounce) {
            clearTimeout(this.dirtyPagesCheckDebounce);
        }

        this.dirtyPagesCheckDebounce = setTimeout(() => {
            this.checkDirtyPages();
        }, 300);
    }

    private checkDirtyPages(): void {
        const artemisConfig = vscode.workspace.getConfiguration('artemis');
        const showWarning = artemisConfig.get<boolean>('showUnsavedChangesWarning', true);

        if (!showWarning) {
            this.context.sendMessage({
                type: ExtensionMsg.UpdateDirtyPagesStatus,
                hasDirtyPages: false,
                dirtyFileCount: 0,
                autoSaveEnabled: false
            });
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        const dirtyDocuments = vscode.workspace.textDocuments.filter(doc => {
            if (doc.uri.scheme !== 'file') {
                return false;
            }

            const docPath = doc.uri.fsPath;
            const workspacePath = workspaceFolder.uri.fsPath;
            const relative = path.relative(workspacePath, docPath);

            if (relative.startsWith('..')) {
                return false;
            }

            return doc.isDirty;
        });

        const hasDirtyPages = dirtyDocuments.length > 0;
        const config = vscode.workspace.getConfiguration('files');
        const autoSave = config.get<string>('autoSave', 'off');

        this.context.sendMessage({
            type: ExtensionMsg.UpdateDirtyPagesStatus,
            hasDirtyPages: hasDirtyPages,
            dirtyFileCount: dirtyDocuments.length,
            autoSaveEnabled: autoSave !== 'off'
        });
    }

    private handleStartPractice = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'startPractice'>>(message);
            const exerciseId = payload.exerciseId;
            const exerciseTitle = payload.exerciseTitle ?? 'Exercise';
            vscode.window.showInformationMessage('Starting practice mode...');
            const participation = await this.context.artemisApi.startPracticeParticipation(exerciseId);

            if (participation) {
                vscode.window.showInformationMessage(
                    `Successfully started practice mode for "${exerciseTitle}". You can now clone the practice repository.`
                );

                await this.context.actionHandler.openExerciseDetails(exerciseId);
            }
        } catch (error: unknown) {
            logger.error('Failed to start practice participation:', LogCategory.SUBMISSION, error);
            vscode.window.showErrorMessage(
                `Failed to start practice mode: ${extractErrorMessage(error)}`
            );
        }
    };

    private handleStartExercise = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'startExercise'>>(message);
            const exerciseId = payload.exerciseId;
            vscode.window.showInformationMessage('Starting exercise...');
            const participation = await this.context.artemisApi.startExerciseParticipation(exerciseId);

            if (participation) {
                vscode.window.showInformationMessage('Successfully started exercise participation.');
                await this.context.actionHandler.openExerciseDetails(exerciseId);
            }
        } catch (error: unknown) {
            logger.error('Failed to start exercise:', LogCategory.SUBMISSION, error);
            vscode.window.showErrorMessage(
                `Failed to start exercise: ${extractErrorMessage(error)}`
            );
        }
    };

    private handleOpenRepository = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const repositoryUri = getOptionalPayload<WebCmd<'openRepository'>>(message)?.repositoryUri;

            if (!repositoryUri) {
                vscode.window.showWarningMessage('No repository URL available.');
                return;
            }
            // Try to open the repository folder if it's already cloned in the workspace
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                const wsUrl = await getWorkspaceRepositoryUrl(workspaceFolder);
                if (wsUrl && normalizeRepositoryUrl(wsUrl) === normalizeRepositoryUrl(repositoryUri)) {
                    // Already in the correct workspace — just reveal the explorer
                    await vscode.commands.executeCommand('workbench.view.explorer');
                    return;
                }
            }

            // Open the URL externally as a fallback
            await vscode.env.openExternal(vscode.Uri.parse(repositoryUri));
        } catch (error: unknown) {
            logger.error('Open repository error:', LogCategory.SUBMISSION, error);
            vscode.window.showErrorMessage('Failed to open repository.');
        }
    };

}
