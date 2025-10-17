import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { CommandContext, CommandMap } from './types';
import { VSCODE_CONFIG } from '../../../utils';

const execFileAsync = promisify(execFile);

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

    constructor(private readonly context: CommandContext) {
        this.registerWorkspaceListeners();
    }

    public getHandlers(): CommandMap {
        return {
            detectWorkspaceExercise: this.handleDetectWorkspaceExercise,
            participateInExercise: this.handleParticipateInExercise,
            checkRepositoryStatus: this.handleCheckRepositoryStatus,
            cloneRepository: this.handleCloneRepository,
            openClonedRepository: this.handleOpenClonedRepository,
            copyCloneUrl: this.handleCopyCloneUrl,
            pullChanges: this.handlePullChanges,
            submitExercise: this.handleSubmitExercise,
        };
    }

    public hasRecentlyClonedRepo(exerciseId: number): boolean {
        return this.clonedRepositories.has(exerciseId);
    }

    private handleDetectWorkspaceExercise = async (): Promise<void> => {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                this.context.sendMessage({
                    command: 'workspaceExerciseDetected',
                    exerciseId: null,
                    exerciseTitle: null
                });
                return;
            }

            try {
                const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
                    cwd: workspaceFolder.uri.fsPath
                });

                const repoUrl = stdout.trim();
                const coursesData = this.context.appStateManager.coursesData;
                let matchedExercise: { id: number; title: string } | null = null;

                if (coursesData?.courses) {
                    const normalizeUrl = (url: string) => {
                        return url
                            .replace(/^git@([^:]+):/, 'https://$1/')
                            .replace(/^https?:\/\/[^@]*@/, 'https://')
                            .replace(/\.git$/, '')
                            .replace(/\/$/, '')
                            .toLowerCase();
                    };

                    const normalizedRepoUrl = normalizeUrl(repoUrl);

                    for (const courseData of coursesData.courses) {
                        const exercises = courseData?.course?.exercises || courseData?.exercises || [];

                        for (const exercise of exercises) {
                            const participations = exercise.studentParticipations || [];

                            if (participations.length > 0 && participations[0].repositoryUri) {
                                const exerciseRepoUrl = normalizeUrl(participations[0].repositoryUri);

                                if (exerciseRepoUrl === normalizedRepoUrl) {
                                    matchedExercise = {
                                        id: exercise.id,
                                        title: exercise.title
                                    };
                                    break;
                                }
                            }
                        }

                        if (matchedExercise) {
                            break;
                        }
                    }
                }

                this.context.sendMessage({
                    command: 'workspaceExerciseDetected',
                    exerciseId: matchedExercise ? matchedExercise.id : null,
                    exerciseTitle: matchedExercise ? matchedExercise.title : null
                });
            } catch (gitError) {
                this.context.sendMessage({
                    command: 'workspaceExerciseDetected',
                    exerciseId: null,
                    exerciseTitle: null
                });
            }
        } catch (error) {
            console.error('Error detecting workspace exercise:', error);
            this.context.sendMessage({
                command: 'workspaceExerciseDetected',
                exerciseId: null,
                exerciseTitle: null
            });
        }
    };

    private handleParticipateInExercise = async (message: any): Promise<void> => {
        const exerciseId: number = message.exerciseId;
        const exerciseTitle: string = message.exerciseTitle;

        try {
            vscode.window.showInformationMessage('Starting exercise participation...');
            const participation = await this.context.artemisApi.startExerciseParticipation(exerciseId);

            if (participation) {
                vscode.window.showInformationMessage(
                    `Successfully started participation in "${exerciseTitle}". Your repository is being prepared.`
                );

                await this.context.actionHandler.openExerciseDetails(exerciseId);
            }
        } catch (error) {
            console.error('Failed to start exercise participation:', error);
            vscode.window.showErrorMessage(
                `Failed to start participation in "${exerciseTitle}": ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    };

    private handleCheckRepositoryStatus = async (message: any): Promise<void> => {
        try {
            const expectedRepoUrl: string = message.expectedRepoUrl;
            const exerciseId: number = message.exerciseId;

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            let isConnected = false;
            let hasChanges = false;

            this.currentRepoContext = { expectedRepoUrl, exerciseId };
            this.currentWorkspacePath = workspaceFolder?.uri.fsPath;

            if (workspaceFolder) {
                try {
                    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
                        cwd: workspaceFolder.uri.fsPath
                    });

                    const currentRepoUrl = stdout.trim();

                    const normalizeUrl = (url: string) => {
                        return url
                            .replace(/^git@([^:]+):/, 'https://$1/')
                            .replace(/^https?:\/\/[^@]*@/, 'https://')
                            .replace(/\.git$/, '')
                            .replace(/\/$/, '')
                            .toLowerCase();
                    };

                    const normalizedCurrent = normalizeUrl(currentRepoUrl);
                    const normalizedExpected = normalizeUrl(expectedRepoUrl);

                    isConnected = normalizedCurrent === normalizedExpected;

                    if (isConnected) {
                        try {
                            const { stdout: statusStdout } = await execFileAsync('git', ['status', '--porcelain'], {
                                cwd: workspaceFolder.uri.fsPath
                            });
                            hasChanges = statusStdout.trim().length > 0;
                        } catch (statusError: any) {
                            console.warn('Failed to determine repository changes:', statusError);
                            hasChanges = false;
                        }
                    }
                } catch (gitError: any) {
                    isConnected = false;
                    hasChanges = false;
                }
            }

            this.context.sendMessage({
                command: 'updateRepoStatus',
                isConnected: isConnected,
                hasChanges: hasChanges
            });
        } catch (error: any) {
            console.error('Check repository status error:', error);
            vscode.window.showErrorMessage('Error checking repository status');
        }
    };

    private handleCloneRepository = async (message: any): Promise<void> => {
        const { participationId, repositoryUri, exerciseId, exerciseTitle } = message;

        try {
            if (!participationId || !repositoryUri) {
                vscode.window.showErrorMessage('Cannot clone: missing participation or repository URL.');
                return;
            }

            try {
                await execFileAsync('git', ['--version']);
            } catch {
                vscode.window.showErrorMessage('Git not found in PATH. Please install Git to clone repositories.');
                return;
            }

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

            const selectedPath = folderUri[0].fsPath;

            let vcsToken: string;
            try {
                vcsToken = await this.context.artemisApi.getOrCreateVcsAccessToken(participationId);
            } catch (tokenErr) {
                console.error('Failed to get participation token:', tokenErr);
                vscode.window.showErrorMessage('Failed to obtain VCS access token for cloning.');
                return;
            }

            let username = 'user';
            try {
                const currentUser = await this.context.artemisApi.getCurrentUser();
                if (currentUser?.login) {
                    username = currentUser.login;
                }
            } catch (userErr) {
                console.warn('Could not fetch current user, defaulting username:', userErr);
            }

            let cloneUrl: string;
            try {
                const url = new URL(repositoryUri);
                url.username = username;
                url.password = vcsToken;
                cloneUrl = url.toString();
            } catch (e) {
                vscode.window.showErrorMessage('Invalid repository URL received from server.');
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
                    command: 'showClonedRepoNotice',
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
        } catch (error) {
            console.error('Clone repository error:', error);
            vscode.window.showErrorMessage('Failed to clone repository.');
        }
    };

    private handleOpenClonedRepository = async (message: any): Promise<void> => {
        const exerciseId: number = message.exerciseId;

        try {
            const repoInfo = this.clonedRepositories.get(exerciseId);

            if (!repoInfo) {
                vscode.window.showWarningMessage('No cloned repository found for this exercise. Please clone it first.');
                return;
            }

            const repoUri = vscode.Uri.file(repoInfo.path);
            await vscode.commands.executeCommand('vscode.openFolder', repoUri, true);

            this.clonedRepositories.delete(exerciseId);
        } catch (error) {
            console.error('Open cloned repository error:', error);
            vscode.window.showErrorMessage('Failed to open cloned repository.');
        }
    };

    private handleCopyCloneUrl = async (message: any): Promise<void> => {
        const { participationId, repositoryUri } = message;

        try {
            if (!participationId || !repositoryUri) {
                vscode.window.showErrorMessage('Cannot copy URL: missing participation or repository URL.');
                return;
            }

            let vcsToken: string;
            try {
                vcsToken = await this.context.artemisApi.getOrCreateVcsAccessToken(participationId);
            } catch (tokenErr) {
                console.error('Failed to get participation token:', tokenErr);
                vscode.window.showErrorMessage('Failed to obtain VCS access token.');
                return;
            }

            let username = 'user';
            try {
                const currentUser = await this.context.artemisApi.getCurrentUser();
                if (currentUser?.login) {
                    username = currentUser.login;
                }
            } catch {}

            try {
                const url = new URL(repositoryUri);
                url.username = username;
                url.password = vcsToken;
                await vscode.env.clipboard.writeText(url.toString());
                vscode.window.showInformationMessage('Clone URL (token) copied to clipboard.');
            } catch {
                vscode.window.showErrorMessage('Failed to construct clone URL.');
            }
        } catch (error) {
            console.error('Copy clone URL error:', error);
            vscode.window.showErrorMessage('Failed to copy clone URL.');
        }
    };

    private handlePullChanges = async (message: any): Promise<void> => {
        const exerciseTitle: string = message.exerciseTitle;

        try {
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
                    await execFileAsync('git', ['pull', '--rebase'], { cwd });
                    vscode.window.showInformationMessage(`Successfully pulled changes for "${exerciseTitle}".`);

                    if (this.currentRepoContext) {
                        await this.handleCheckRepositoryStatus(this.currentRepoContext);
                    }
                } catch (pullError: any) {
                    if (pullError.message && pullError.message.includes('CONFLICT')) {
                        throw new Error('Merge conflict detected. Please resolve conflicts manually.');
                    } else if (pullError.message && pullError.message.includes('Already up to date')) {
                        vscode.window.showInformationMessage('Repository is already up to date.');
                    } else {
                        throw pullError;
                    }
                }
            });
        } catch (error: any) {
            console.error('Pull changes error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to pull changes.';
            vscode.window.showErrorMessage(errorMessage);
        }
    };

    private handleSubmitExercise = async (message: any): Promise<void> => {
        const { participationId, exerciseId, exerciseTitle, commitMessage } = message;
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            const errorText = 'Open the exercise repository in VS Code before submitting.';
            vscode.window.showErrorMessage(errorText);
            this.context.sendMessage({ command: 'submissionResult', success: false, error: errorText });
            return;
        }

        this.currentWorkspacePath = workspaceFolder.uri.fsPath;
        const cwd = workspaceFolder.uri.fsPath;

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Submitting "${exerciseTitle}"...`,
                cancellable: false
            }, async progress => {
                progress.report({ message: 'Preparing repository...' });
                const { stdout: statusStdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd });
                if (!statusStdout.trim()) {
                    throw new Error('No local changes detected to submit.');
                }

                progress.report({ message: 'Staging changes...' });
                await execFileAsync('git', ['add', '-A'], { cwd });

                const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
                const configuredDefault = config.get<string>(
                    VSCODE_CONFIG.DEFAULT_COMMIT_MESSAGE_KEY,
                    'Solution submission via Iris extension'
                );
                const messageText = (commitMessage && commitMessage.trim()) || configuredDefault;

                progress.report({ message: 'Committing changes...' });
                await execFileAsync('git', ['commit', '-m', messageText], { cwd });

                progress.report({ message: 'Syncing with remote...' });
                try {
                    await execFileAsync('git', ['pull', '--rebase'], { cwd });
                } catch (pullError: any) {
                    if (pullError.message && pullError.message.includes('CONFLICT')) {
                        throw new Error('Merge conflict detected. Please resolve conflicts manually using git and try again.');
                    }
                    console.warn('Pull failed, but continuing with push:', pullError.message);
                }

                progress.report({ message: 'Pushing to Artemis...' });
                await execFileAsync('git', ['push'], { cwd });
            });

            vscode.window.showInformationMessage(`Successfully submitted "${exerciseTitle}".`);
            this.context.sendMessage({ command: 'submissionResult', success: true });
        } catch (error: any) {
            console.error('Submit exercise error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to submit exercise.';
            vscode.window.showErrorMessage(errorMessage);
            this.context.sendMessage({ command: 'submissionResult', success: false, error: errorMessage });
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
            void this.handleCheckRepositoryStatus(this.currentRepoContext);
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
                command: 'updateDirtyPagesStatus',
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
            command: 'updateDirtyPagesStatus',
            hasDirtyPages: hasDirtyPages,
            dirtyFileCount: dirtyDocuments.length,
            autoSaveEnabled: autoSave !== 'off'
        });
    }
}
