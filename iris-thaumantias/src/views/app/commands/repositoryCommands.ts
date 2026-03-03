import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { CommandContext, CommandMap } from './types';
import { getPayload, ExtensionMsg, WebviewCmd } from '../../../shared/messageContracts';
import type {
    WebviewToExtensionMessage,
    WebCmd,
} from '../../../shared/messageContracts';
import { CONFIG, VSCODE_CONFIG, checkWorkspaceFiles, extractErrorMessage } from '../../../utils';
import { detectWorkspaceExercise, normalizeRepositoryUrl, type ExerciseSource, GitService } from '../../../services';
import { logger } from '../../../services/loggingService';

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
    private textDocumentChangeListener?: vscode.Disposable;
    private readonly gitService: GitService;

    constructor(private readonly context: CommandContext) {
        this.gitService = new GitService();
        this.registerWorkspaceListeners();
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
            logger.submissionError('Failed to get participation token:', tokenErr);
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
            logger.submissionWarn('Could not fetch current user, defaulting username:', userErr);
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

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.DetectWorkspaceExercise]: this.handleDetectWorkspaceExercise,
            [WebviewCmd.ParticipateInExercise]: this.handleParticipateInExercise,
            [WebviewCmd.CheckRepositoryStatus]: this.handleCheckRepositoryStatus,
            [WebviewCmd.CloneRepository]: this.handleCloneRepository,
            [WebviewCmd.OpenClonedRepository]: this.handleOpenClonedRepository,
            [WebviewCmd.CopyCloneUrl]: this.handleCopyCloneUrl,
            [WebviewCmd.PullChanges]: this.handlePullChanges,
            [WebviewCmd.SubmitExercise]: this.handleSubmitExercise,
            [WebviewCmd.SaveGitCredentials]: this.handleSaveGitCredentials,
            [WebviewCmd.SaveGitIdentity]: this.handleSaveGitIdentity,
            [WebviewCmd.RequestGitIdentity]: this.handleRequestGitIdentity,
            [WebviewCmd.StartPractice]: this.handleStartPractice,
            [WebviewCmd.StartExercise]: this.handleStartExercise,
            [WebviewCmd.OpenRepository]: this.handleOpenRepository,
            [WebviewCmd.TriggerBuild]: this.handleTriggerBuild,
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

    private handleDetectWorkspaceExercise = async (_message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const exercises = this.flattenExercisesFromCourses();
            const detected = await detectWorkspaceExercise(exercises);

            this.context.sendMessage({
                type: ExtensionMsg.WorkspaceExerciseDetected,
                exerciseId: detected?.id ?? null,
                exerciseTitle: detected?.title ?? null
            });
        } catch (error: unknown) {
            logger.submissionWarn('Error detecting workspace exercise:', error);
            this.context.sendMessage({
                type: ExtensionMsg.WorkspaceExerciseDetected,
                exerciseId: null,
                exerciseTitle: null
            });
        }
    };

    /**
     * Flattens all exercises from coursesData into a single array.
     */
    private flattenExercisesFromCourses(): ExerciseSource[] {
        const coursesData = this.context.appStateManager.coursesData;
        if (!coursesData?.courses) {
            return [];
        }

        const exercises: ExerciseSource[] = [];
        for (const courseData of coursesData.courses) {
            const courseExercises = courseData?.course?.exercises || courseData?.exercises || [];
            // Map ExerciseDetail to ExerciseSource, filtering out invalid exercises
            for (const ex of courseExercises) {
                if (typeof ex.id === 'number' && ex.title) {
                    exercises.push({
                        id: ex.id,
                        title: ex.title,
                        shortName: ex.shortName,
                        courseId: ex.course?.id,
                        repositoryUri: undefined,
                        studentParticipations: ex.studentParticipations
                    });
                }
            }
        }
        return exercises;
    }

    private handleParticipateInExercise = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'participateInExercise'>>(message);
            const exerciseId = payload.exerciseId;
            const exerciseTitle = payload.exerciseTitle;
            vscode.window.showInformationMessage('Starting exercise participation...');
            const participation = await this.context.artemisApi.startExerciseParticipation(exerciseId);

            if (participation) {
                vscode.window.showInformationMessage(
                    `Successfully started participation in "${exerciseTitle}". Your repository is being prepared.`
                );

                await this.context.actionHandler.openExerciseDetails(exerciseId);
            }
        } catch (error: unknown) {
            logger.submissionError('Failed to start exercise participation:', error);
            vscode.window.showErrorMessage(
                `Failed to start exercise participation: ${extractErrorMessage(error)}`
            );
        }
    };

    private handleCheckRepositoryStatus = async (_message: WebviewToExtensionMessage): Promise<void> => {
        if (this.currentRepoContext) {
            await this._checkRepositoryStatusWithContext(this.currentRepoContext);
        } else {
            logger.submissionWarn('No repository context available');
        }
    };

    private async _checkRepositoryStatusWithContext(repoContext: RepoContext): Promise<void> {
        try {
            const { expectedRepoUrl, exerciseId } = repoContext;

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            let isConnected = false;
            let hasChanges = false;
            let isGradedRepo = false;

            this.currentRepoContext = { expectedRepoUrl, exerciseId };
            this.currentWorkspacePath = workspaceFolder?.uri.fsPath;

            if (workspaceFolder) {
                try {
                    const currentRepoUrl = await this.gitService.getRemoteUrl({
                        cwd: workspaceFolder.uri.fsPath
                    });

                    const normalizedCurrent = normalizeRepositoryUrl(currentRepoUrl);
                    const normalizedExpected = normalizeRepositoryUrl(expectedRepoUrl);

                    isConnected = normalizedCurrent === normalizedExpected;

                    if (isConnected) {
                        try {
                            // Use unified workspace file checker (lightweight)
                            const result = await checkWorkspaceFiles(workspaceFolder, {
                                includeContent: false,
                                applyFilters: false
                            });
                            hasChanges = result.hasChanges;
                        } catch (statusError: unknown) {
                            logger.submissionWarn('Failed to determine repository changes:', statusError);
                            hasChanges = false;
                        }
                    } else {
                        // Check if we are in the graded repository
                        const coursesData = this.context.appStateManager.coursesData;
                        if (coursesData?.courses) {
                            for (const courseData of coursesData.courses) {
                                const exercises = courseData?.course?.exercises || [];
                                const exercise = exercises.find((e) => e?.id === exerciseId);

                                if (exercise) {
                                    const participations = exercise.studentParticipations || [];
                                    // Find graded participation (not testRun)
                                    const gradedParticipation = participations.find((p) => {
                                        return p && typeof p === 'object' && 'testRun' in p && !p.testRun;
                                    });

                                    if (gradedParticipation?.repositoryUri) {
                                        const normalizedGraded = normalizeRepositoryUrl(gradedParticipation.repositoryUri);
                                        if (normalizedCurrent === normalizedGraded) {
                                            isGradedRepo = true;
                                        }
                                    }
                                    break;
                                }
                            }
                        }
                    }
                } catch (gitError: unknown) {
                    isConnected = false;
                    hasChanges = false;
                }
            }

            this.context.sendMessage({
                type: ExtensionMsg.UpdateRepoStatus,
                isConnected: isConnected,
                hasChanges: hasChanges,
                isGradedRepo: isGradedRepo
            });
        } catch (error: unknown) {
            logger.submissionError('Check repository status error:', error);
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
                        const folderUri = await vscode.window.showOpenDialog({
                            canSelectFiles: false,
                            canSelectFolders: true,
                            canSelectMany: false,
                            openLabel: 'Select Clone Destination',
                            title: `Choose where to clone ${exerciseTitle}`
                        });

                        if (!folderUri || !folderUri[0]) {
                            vscode.window.showInformationMessage('Clone cancelled - no destination selected.');
                            return;
                        }
                        selectedPath = folderUri[0].fsPath;
                    }
                } catch (error: unknown) {
                    vscode.window.showWarningMessage(`Default clone path "${defaultClonePath}" does not exist. Please select a folder.`);
                    const folderUri = await vscode.window.showOpenDialog({
                        canSelectFiles: false,
                        canSelectFolders: true,
                        canSelectMany: false,
                        openLabel: 'Select Clone Destination',
                        title: `Choose where to clone ${exerciseTitle}`
                    });

                    if (!folderUri || !folderUri[0]) {
                        vscode.window.showInformationMessage('Clone cancelled - no destination selected.');
                        return;
                    }
                    selectedPath = folderUri[0].fsPath;
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
                        const folderUri = await vscode.window.showOpenDialog({
                            canSelectFiles: false,
                            canSelectFolders: true,
                            canSelectMany: false,
                            openLabel: 'Set as Default',
                            title: 'Select default folder for all exercise repositories'
                        });

                        if (folderUri && folderUri[0]) {
                            selectedPath = folderUri[0].fsPath;
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
                        const folderUri = await vscode.window.showOpenDialog({
                            canSelectFiles: false,
                            canSelectFolders: true,
                            canSelectMany: false,
                            openLabel: 'Select Folder',
                            title: `Where should "${exerciseTitle}" be cloned?`
                        });

                        if (!folderUri || !folderUri[0]) {
                            vscode.window.showInformationMessage('Clone cancelled - no folder selected.');
                            return;
                        }
                        selectedPath = folderUri[0].fsPath;
                    } else if (choice === 'Choose Each Time') {
                        // "Choose Each Time" - just show the folder picker for this clone
                        const folderUri = await vscode.window.showOpenDialog({
                            canSelectFiles: false,
                            canSelectFolders: true,
                            canSelectMany: false,
                            openLabel: 'Select Folder',
                            title: `Where should "${exerciseTitle}" be cloned?`
                        });

                        if (!folderUri || !folderUri[0]) {
                            vscode.window.showInformationMessage('Clone cancelled - no folder selected.');
                            return;
                        }
                        selectedPath = folderUri[0].fsPath;
                    } else {
                        // User cancelled the modal (pressed ESC) - abort clone
                        vscode.window.showInformationMessage('Clone cancelled.');
                        return;
                    }
                } else {
                    // Prompt disabled, just show folder picker
                    const folderUri = await vscode.window.showOpenDialog({
                        canSelectFiles: false,
                        canSelectFolders: true,
                        canSelectMany: false,
                        openLabel: 'Select Clone Destination',
                        title: `Choose where to clone ${exerciseTitle}`
                    });

                    if (!folderUri || !folderUri[0]) {
                        vscode.window.showInformationMessage('Clone cancelled - no destination selected.');
                        return;
                    }
                    selectedPath = folderUri[0].fsPath;
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

            setTimeout(() => {
                this.context.sendMessage({
                    type: ExtensionMsg.ShowClonedRepoNotice,
                    exerciseTitle: exerciseTitle
                });
            }, 2000);

            const openAction = await vscode.window.showInformationMessage('Open the cloned repository when ready?', 'Open Folder', 'Skip');
            if (openAction === 'Open Folder') {
                setTimeout(() => {
                    const repoUri = vscode.Uri.file(repoPath);
                    void vscode.commands.executeCommand('vscode.openFolder', repoUri, true);
                }, 3000);
            }
        } catch (error: unknown) {
            logger.submissionError('Clone repository error:', error);
            vscode.window.showErrorMessage('Failed to clone repository.');
        }
    };

    private handleOpenClonedRepository = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'openClonedRepository'>>(message);
            const exerciseId = payload.exerciseId;
            const repoInfo = this.clonedRepositories.get(exerciseId);

            if (!repoInfo) {
                vscode.window.showWarningMessage('No cloned repository found for this exercise. Please clone it first.');
                return;
            }

            // Validate that the cached path still exists
            if (!fs.existsSync(repoInfo.path)) {
                this.clonedRepositories.delete(exerciseId);
                vscode.window.showWarningMessage('The cloned repository folder no longer exists. Please clone it again.');
                return;
            }

            const repoUri = vscode.Uri.file(repoInfo.path);
            await vscode.commands.executeCommand('vscode.openFolder', repoUri, true);

            this.clonedRepositories.delete(exerciseId);
        } catch (error: unknown) {
            logger.submissionError('Open cloned repository error:', error);
            vscode.window.showErrorMessage('Failed to open cloned repository.');
        }
    };

    private handleCopyCloneUrl = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'copyCloneUrl'>>(message);
            const { participationId, repositoryUri } = payload;
            if (!participationId || !repositoryUri) {
                vscode.window.showErrorMessage('Cannot copy URL: missing participation or repository URL.');
                return;
            }

            const authenticatedUrl = await this.buildAuthenticatedUrl(participationId, repositoryUri);
            if (!authenticatedUrl) {
                return;
            }

            await vscode.env.clipboard.writeText(authenticatedUrl);
            vscode.window.showInformationMessage('Clone URL (token) copied to clipboard.');
        } catch (error: unknown) {
            logger.submissionError('Copy clone URL error:', error);
            vscode.window.showErrorMessage('Failed to copy clone URL.');
        }
    };

    private handlePullChanges = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'pullChanges'>>(message);
            const exerciseTitle = payload.exerciseTitle;
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder open. Please open the exercise repository first.');
                return;
            }

            const cwd = workspaceFolder.uri.fsPath;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Pulling changes for "${exerciseTitle}"...`,
                cancellable: false
            }, async () => {
                try {
                    await this.gitService.pullWithRebase({ cwd });
                    vscode.window.showInformationMessage(`Successfully pulled changes for "${exerciseTitle}".`);

                    if (this.currentRepoContext) {
                        await this._checkRepositoryStatusWithContext(this.currentRepoContext);
                    }
                } catch (pullError: unknown) {
                    const errorMessage = pullError instanceof Error ? pullError.message : '';
                    if (errorMessage && errorMessage.includes('CONFLICT')) {
                        throw new Error('Merge conflict detected. Please resolve conflicts manually.');
                    } else if (errorMessage && errorMessage.includes('Already up to date')) {
                        vscode.window.showInformationMessage('Repository is already up to date.');
                    } else {
                        throw pullError;
                    }
                }
            });
        } catch (error: unknown) {
            logger.submissionError('Pull changes error:', error);
            const errorMessage = extractErrorMessage(error);
            vscode.window.showErrorMessage(errorMessage);
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
                const errorText = 'Open the exercise repository in VS Code before submitting.';
                vscode.window.showErrorMessage(errorText);
                this.context.sendMessage({ type: ExtensionMsg.SubmissionResult, success: false, error: errorText });
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
                    logger.submissionWarn('Pull failed, but continuing with push:', errorMessage);
                }

                progress.report({ message: 'Pushing to Artemis...' });
                await this.gitService.push({ cwd });
            });

            vscode.window.showInformationMessage(`Successfully submitted "${exerciseTitle}".`);
            this.context.sendMessage({ type: ExtensionMsg.SubmissionResult, success: true });

            // Ensure WebSocket is connected to receive real-time result updates
            if (this.context.websocketService && !this.context.websocketService.isConnected()) {
                logger.websocket('🔌 Submission successful - ensuring WebSocket connection for result updates...');
                try {
                    await this.context.websocketService.connect();
                } catch (wsError) {
                    logger.websocketError('Failed to connect WebSocket after submission:', wsError);
                }
            }
        } catch (error: unknown) {
            logger.submissionError('Submit exercise error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to submit exercise.';

            // Don't show error notification if user is being directed to Git Credentials Helper
            if (errorMessage !== GIT_IDENTITY_NOT_CONFIGURED) {
                vscode.window.showErrorMessage(errorMessage);
            }

            this.context.sendMessage({ type: ExtensionMsg.SubmissionResult, success: false, error: errorMessage });
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
            logger.submissionError('Failed to save Git identity globally:', error);
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

    private handleSaveGitCredentials = async (message: WebviewToExtensionMessage): Promise<void> => {
        let rawUsername: string;
        let rawToken: string;
        let serverUrl: string;
        const sendResult = (status: 'success' | 'error' | 'warning' | 'info', text: string) => {
            this.context.sendMessage({
                type: ExtensionMsg.GitCredentialsResult,
                status,
                message: text
            });
        };
        try {
            const payload = getPayload<WebCmd<'saveGitCredentials'>>(message);
            rawUsername = typeof payload.username === 'string' ? payload.username.trim() : '';
            rawToken = typeof payload.token === 'string' ? payload.token.trim() : '';
            const rawServerUrl = typeof payload.serverUrl === 'string' ? payload.serverUrl.trim() : '';
            const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
            const configuredServerUrl = config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
            serverUrl = rawServerUrl || configuredServerUrl;
        } catch (error: unknown) {
            logger.submissionError('Failed to parse saveGitCredentials payload:', error);
            sendResult('error', 'Invalid message payload.');
            return;
        }

        if (!rawUsername) {
            sendResult('warning', 'Username is required.');
            vscode.window.showErrorMessage('Please provide a username before saving Git credentials.');
            return;
        }

        if (!rawToken) {
            sendResult('warning', 'Token is required.');
            vscode.window.showErrorMessage('Please provide a VCS token before saving Git credentials.');
            return;
        }

        let host: string;
        try {
            const parsedUrl = new URL(serverUrl);
            host = parsedUrl.host;
            if (!host) {
                throw new Error('Missing host in server URL.');
            }
        } catch (error: unknown) {
            logger.submissionError('Invalid Artemis server URL:', error);
            sendResult('error', 'Invalid Artemis server URL.');
            vscode.window.showErrorMessage('Invalid Artemis server URL. Please verify the value and try again.');
            return;
        }

        try {
            const isGitAvailable = await this.gitService.isGitAvailable();
            if (!isGitAvailable) {
                throw new Error('Git not available');
            }
        } catch {
            sendResult('error', 'Git is not available on the PATH.');
            vscode.window.showErrorMessage('Git is not available on this system. Please install Git and try again.');
            return;
        }

        try {
            await this.gitService.ensureCredentialHelper();
        } catch (error: unknown) {
            logger.submissionError('Failed to configure credential helper:', error);
            const messageText = extractErrorMessage(error);
            sendResult('error', `Failed to configure credential helper: ${messageText}`);
            vscode.window.showErrorMessage(`Failed to configure Git credential helper: ${messageText}`);
            return;
        }

        try {
            await this.gitService.storeCredentials(`https://${host}`, rawUsername, rawToken);
            const successMessage = `Saved Git credentials for ${host}.`;
            sendResult('success', successMessage);
            vscode.window.showInformationMessage(successMessage);
        } catch (error: unknown) {
            logger.submissionError('Failed to store credential entry:', error);
            const messageText = extractErrorMessage(error);
            sendResult('error', `Failed to save credentials: ${messageText}`);
            vscode.window.showErrorMessage(`Failed to save Git credentials: ${messageText}`);
        }
    };
    private registerWorkspaceListeners(): void {
        if (this.workspaceListenersRegistered) {
            return;
        }

        const handleUri = (uri?: vscode.Uri) => {
            this.scheduleWorkspaceStatusCheck(uri);
        };

        vscode.workspace.onDidSaveTextDocument(document => {
            handleUri(document.uri);
            this.scheduleDirtyPagesCheck();
        });
        vscode.workspace.onDidCreateFiles(event => {
            if (event.files && event.files.length > 0) {
                handleUri(event.files[0]);
            } else {
                handleUri();
            }
        });
        vscode.workspace.onDidDeleteFiles(event => {
            if (event.files && event.files.length > 0) {
                handleUri(event.files[0]);
            } else {
                handleUri();
            }
        });
        vscode.workspace.onDidRenameFiles(event => {
            if (event.files && event.files.length > 0) {
                handleUri(event.files[0].newUri);
            } else {
                handleUri();
            }
        });

        this.textDocumentChangeListener = vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.uri.scheme === 'file') {
                this.scheduleDirtyPagesCheck();
            }
        });

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
                void this._checkRepositoryStatusWithContext(this.currentRepoContext);
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
            logger.submissionError('Failed to start practice participation:', error);
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
            logger.submissionError('Failed to start exercise:', error);
            vscode.window.showErrorMessage(
                `Failed to start exercise: ${extractErrorMessage(error)}`
            );
        }
    };

    private handleOpenRepository = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'openRepository'>>(message);
            const repositoryUri = payload.repositoryUri;

            if (!repositoryUri) {
                vscode.window.showWarningMessage('No repository URL available.');
                return;
            }
            // Try to open the repository folder if it's already cloned in the workspace
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                const currentRepoUrl = await this.gitService.getRemoteUrl({
                    cwd: workspaceFolder.uri.fsPath
                });
                const normalizedCurrent = normalizeRepositoryUrl(currentRepoUrl);
                const normalizedExpected = normalizeRepositoryUrl(repositoryUri);
                if (normalizedCurrent === normalizedExpected) {
                    // Already in the correct workspace — just reveal the explorer
                    await vscode.commands.executeCommand('workbench.view.explorer');
                    return;
                }
            }

            // Open the URL externally as a fallback
            await vscode.env.openExternal(vscode.Uri.parse(repositoryUri));
        } catch (error: unknown) {
            logger.submissionError('Open repository error:', error);
            vscode.window.showErrorMessage('Failed to open repository.');
        }
    };

    private handleTriggerBuild = async (_message: WebviewToExtensionMessage): Promise<void> => {
        vscode.window.showInformationMessage('Build triggering is not supported yet. Please submit your exercise to trigger a build.');
    };
}
