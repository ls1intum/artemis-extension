import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { CommandContext, CommandMap } from './types';
import { getPayload, getOptionalPayload, ExtensionMsg, WebviewCmd } from '../../../shared/messageContracts';
import type {
    WebviewToExtensionMessage,
    WebCmd,
} from '../../../shared/messageContracts';
import { VSCODE_CONFIG, extractErrorMessage, BuildLogParser } from '../../utils';
import { checkWorkspaceFiles } from '../../services/workspace/workspaceFileChecker';
import { normalizeRepositoryUrl, getWorkspaceRepositoryUrl, getWorkspaceStatus, GitService } from '../../services/workspace';
import { logger, LogCategory } from '../../services/loggingService';
import { cloneRepositoryProgrammatic, getTheiaEnvironment } from '../../theia';

const GIT_IDENTITY_NOT_CONFIGURED = 'GIT_IDENTITY_NOT_CONFIGURED';

/**
 * Soft cap on the in-memory map of recently cloned repositories per
 * participation. Bounded to keep the map from growing unboundedly during a
 * long session; FIFO eviction is acceptable because the map is only used to
 * surface "open cloned repo" notices.
 */
const MAX_CLONED_REPO_CACHE_SIZE = 10;

interface RepoContext {
    expectedRepoUrl: string;
    exerciseId: number;
}

export class RepositoryCommandModule {
    private currentRepoContext?: RepoContext;
    private currentWorkspacePath?: string;
    private workspaceChangeDebounce?: NodeJS.Timeout;
    private workspaceListenersRegistered = false;
    private clonedRepositoriesByParticipationId: Map<number, { path: string; title: string }> = new Map();
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
        // In Theia, always use the workspace root instead of showing a dialog
        if (getTheiaEnvironment().isTheia) {
            return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        }

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
            [WebviewCmd.CopyAuthenticatedCloneUrl]: this.handleCopyAuthenticatedCloneUrl,
            [WebviewCmd.SubmitExercise]: this.handleSubmitExercise,
            [WebviewCmd.SaveGitIdentity]: this.handleSaveGitIdentity,
            [WebviewCmd.RequestGitIdentity]: this.handleRequestGitIdentity,
            [WebviewCmd.StartPractice]: this.handleStartPractice,
            [WebviewCmd.StartExercise]: this.handleStartExercise,
            [WebviewCmd.OpenRepository]: this.handleOpenRepository,
            [WebviewCmd.OpenClonedRepository]: this.handleOpenClonedRepository,
            [WebviewCmd.ViewBuildLog]: this.handleViewBuildLog,
            [WebviewCmd.GoToSource]: this.handleGoToSource,
        };
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
            if (!participationId || !repositoryUri) {
                vscode.window.showErrorMessage('Cannot clone: missing participation or repository URL.');
                return;
            }

            if (!(await this.gitService.isGitAvailable())) {
                vscode.window.showErrorMessage('Git not found in PATH. Please install Git to clone repositories.');
                return;
            }

            const selectedPath = await this._resolveCloneDestination(exerciseTitle);
            if (!selectedPath) { return; }

            const cloneUrl = await this.buildAuthenticatedUrl(participationId, repositoryUri);
            if (!cloneUrl) { return; }

            const repoName = path.basename(repositoryUri).replace(/\.git$/, '');
            const repoPath = path.join(selectedPath, repoName);

            // Run git clone as an awaitable child process (same for Theia and
            // VS Code Desktop). A terminal-based fire-and-forget clone cannot
            // reliably signal success or failure back to the extension, which
            // caused the "Open Folder" prompt to appear even when the clone
            // errored out. Using the programmatic clone, a thrown error lands
            // in the outer catch and the prompt is only reached on success.
            await cloneRepositoryProgrammatic(cloneUrl, repoPath, exerciseTitle);

            this._rememberClonedRepo(participationId, repoPath, exerciseTitle);

            this.context.sendMessage({
                type: ExtensionMsg.ShowClonedRepoNotice,
                exerciseTitle: exerciseTitle,
                participationId,
            });

            const openAction = await vscode.window.showInformationMessage(
                `Open cloned repository "${exerciseTitle}"?`,
                'Open Folder',
                'Skip',
            );
            if (openAction === 'Open Folder') {
                void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(repoPath), true);
            }
        } catch (error: unknown) {
            logger.error('Clone repository error:', LogCategory.SUBMISSION, error);
            vscode.window.showErrorMessage(`Failed to clone repository: ${extractErrorMessage(error)}`);
        }
    };

    /**
     * Resolve the destination folder for a clone in one of three ways:
     *   1. The configured default-clone-path, if it points to an existing dir.
     *   2. The full "set default / choose / don't ask again" modal (when the
     *      prompt is enabled and no default is configured).
     *   3. A bare folder picker when the prompt has been silenced.
     *
     * Returns `undefined` when the user cancels at any branch; an information
     * notice is shown with the cancellation reason as a side effect.
     */
    private async _resolveCloneDestination(exerciseTitle: string): Promise<string | undefined> {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const defaultClonePath = config.get<string>(VSCODE_CONFIG.DEFAULT_CLONE_PATH_KEY, '').trim();
        const showPrompt = config.get<boolean>(VSCODE_CONFIG.SHOW_SET_DEFAULT_CLONE_PATH_PROMPT_KEY, true);

        if (defaultClonePath) {
            const reasonInvalid = await this._validateDefaultClonePath(defaultClonePath);
            if (!reasonInvalid) {
                return defaultClonePath;
            }
            vscode.window.showWarningMessage(`Default clone path "${defaultClonePath}" ${reasonInvalid}. Please select a folder.`);
            return this._pickFolderOrCancelClone('Select Clone Destination', `Choose where to clone ${exerciseTitle}`);
        }

        if (!showPrompt) {
            return this._pickFolderOrCancelClone('Select Clone Destination', `Choose where to clone ${exerciseTitle}`);
        }

        const choice = await vscode.window.showInformationMessage(
            'Where should exercise repositories be cloned?\n\nYou can set a default folder now (e.g., ~/artemis-exercises) so all future exercises are automatically saved there, or choose a location each time.',
            { modal: true },
            'Set Default Folder',
            'Choose Each Time',
            "Don't Ask Again",
        );

        if (choice === 'Set Default Folder') {
            const defaultFolderPath = await this._selectFolder('Set as Default', 'Select default folder for all exercise repositories');
            if (!defaultFolderPath) {
                vscode.window.showInformationMessage('Clone cancelled - no folder selected.');
                return undefined;
            }
            await config.update(VSCODE_CONFIG.DEFAULT_CLONE_PATH_KEY, defaultFolderPath, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`✓ All exercises will now be cloned to: ${defaultFolderPath}`);
            return defaultFolderPath;
        }
        if (choice === "Don't Ask Again") {
            await config.update(VSCODE_CONFIG.SHOW_SET_DEFAULT_CLONE_PATH_PROMPT_KEY, false, vscode.ConfigurationTarget.Global);
            return this._pickFolderOrCancelClone('Select Folder', `Where should "${exerciseTitle}" be cloned?`);
        }
        if (choice === 'Choose Each Time') {
            return this._pickFolderOrCancelClone('Select Folder', `Where should "${exerciseTitle}" be cloned?`);
        }

        // ESC / dismissed modal — abort.
        vscode.window.showInformationMessage('Clone cancelled.');
        return undefined;
    }

    /**
     * Returns `undefined` if the configured default-clone-path is usable; a
     * short reason string ('does not exist' / 'is not a directory') otherwise.
     */
    private async _validateDefaultClonePath(p: string): Promise<string | undefined> {
        try {
            const stats = await fs.promises.stat(p);
            return stats.isDirectory() ? undefined : 'is not a directory';
        } catch {
            return 'does not exist';
        }
    }

    /** Folder picker + the standard "Clone cancelled" notice on dismissal. */
    private async _pickFolderOrCancelClone(label: string, title: string): Promise<string | undefined> {
        const folderPath = await this._selectFolder(label, title);
        if (!folderPath) {
            vscode.window.showInformationMessage('Clone cancelled - no folder selected.');
            return undefined;
        }
        return folderPath;
    }

    /**
     * Insert a freshly cloned repository into the per-participation cache,
     * evicting the oldest entry by insertion order when the cap is reached.
     * (FIFO, not LRU — sufficient for the current "open cloned repo" notice
     * usage, which doesn't depend on recency-of-access semantics.)
     */
    private _rememberClonedRepo(participationId: number, repoPath: string, title: string): void {
        if (this.clonedRepositoriesByParticipationId.size >= MAX_CLONED_REPO_CACHE_SIZE
            && !this.clonedRepositoriesByParticipationId.has(participationId)) {
            const firstKey = this.clonedRepositoriesByParticipationId.keys().next().value;
            if (firstKey !== undefined) {
                this.clonedRepositoriesByParticipationId.delete(firstKey);
            }
        }
        this.clonedRepositoriesByParticipationId.set(participationId, { path: repoPath, title });
    }

    private handleCopyAuthenticatedCloneUrl = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const { participationId, repositoryUri } = getPayload<WebCmd<'copyAuthenticatedCloneUrl'>>(message);
            if (!participationId || !repositoryUri) {
                vscode.window.showErrorMessage('Cannot copy clone URL: missing participation or repository URL.');
                return;
            }

            const authenticatedUrl = await this.buildAuthenticatedUrl(participationId, repositoryUri);
            if (!authenticatedUrl) {
                return;
            }

            await vscode.env.clipboard.writeText(authenticatedUrl);
            vscode.window.showInformationMessage(
                'Authenticated clone URL copied to clipboard. It contains a VCS access token, so do not share it.'
            );
        } catch (error: unknown) {
            logger.error('Failed to copy authenticated clone URL:', LogCategory.SUBMISSION, error);
            vscode.window.showErrorMessage(`Failed to copy clone URL: ${extractErrorMessage(error)}`);
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

    private handleViewBuildLog = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'viewBuildLog'>>(message);
            const { participationId, resultId } = payload;
            const logs = await this.context.artemisApi.getBuildLogs(participationId, resultId);
            const logText = logs.map(entry => `[${entry.time}] ${entry.log}`).join('\n');
            const doc = await vscode.workspace.openTextDocument({ content: logText, language: 'log' });
            await vscode.window.showTextDocument(doc);
        } catch (error: unknown) {
            logger.error('Failed to fetch build logs:', LogCategory.SUBMISSION, error);
            vscode.window.showErrorMessage('Failed to fetch build logs.');
        }
    };

    private handleGoToSource = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'goToSource'>>(message);
            const { participationId, resultId } = payload;
            const logs = await this.context.artemisApi.getBuildLogs(participationId, resultId);
            const error = BuildLogParser.parseFirstError(logs);
            if (error) {
                await vscode.commands.executeCommand('artemis.goToSourceError', error.filePath, error.line, error.column, error.message);
            } else {
                vscode.window.showInformationMessage('No source error location found in build logs');
            }
        } catch (err: unknown) {
            logger.error('Failed to navigate to source error:', LogCategory.SUBMISSION, err);
            vscode.window.showErrorMessage('Failed to navigate to source error.');
        }
    };

    private handleOpenClonedRepository = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const { participationId } = getPayload<WebCmd<'openClonedRepository'>>(message);
            const repoInfo = this.clonedRepositoriesByParticipationId.get(participationId);

            if (!repoInfo) {
                vscode.window.showWarningMessage('Cloned repository not found. It may have been moved or deleted.');
                return;
            }

            try {
                const stats = fs.statSync(repoInfo.path);
                if (!stats.isDirectory()) {
                    this.clonedRepositoriesByParticipationId.delete(participationId);
                    vscode.window.showWarningMessage('Cloned repository path is not a directory.');
                    return;
                }
            } catch {
                this.clonedRepositoriesByParticipationId.delete(participationId);
                vscode.window.showWarningMessage('Cloned repository not found. It may have been moved or deleted.');
                return;
            }

            const repoUri = vscode.Uri.file(repoInfo.path);

            const currentFolder = vscode.workspace.workspaceFolders?.[0];
            if (currentFolder && currentFolder.uri.fsPath === repoInfo.path) {
                await vscode.commands.executeCommand('workbench.view.explorer');
                return;
            }

            await vscode.commands.executeCommand('vscode.openFolder', repoUri, true);
        } catch (error: unknown) {
            logger.error('Open cloned repository error:', LogCategory.SUBMISSION, error);
            vscode.window.showErrorMessage('Failed to open cloned repository.');
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
