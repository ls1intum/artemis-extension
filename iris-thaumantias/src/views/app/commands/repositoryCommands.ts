import * as vscode from 'vscode';
import * as path from 'path';
import { execFile, spawn } from 'child_process';
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
            saveGitCredentials: this.handleSaveGitCredentials,
            saveGitIdentity: this.handleSaveGitIdentity,
            requestGitIdentity: this.handleRequestGitIdentity,
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
            } catch { }

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

                await this.ensureGitIdentityConfigured(cwd);

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

    private async ensureGitIdentityConfigured(cwd: string): Promise<void> {
        const existingName = await this.getGitConfigValue('user.name', cwd);
        const existingEmail = await this.getGitConfigValue('user.email', cwd);

        if (existingName && existingEmail) {
            return;
        }

        const choice = await vscode.window.showWarningMessage(
            'Git identity not configured. Artemis and Git need your name and email to submit changes. Without them, submissions fail with "Please tell me who you are."',
            { modal: true },
            'Configure Git Identity'
        );

        if (choice === 'Configure Git Identity') {
            // Navigate to the Git Credentials Helper view
            this.context.sendMessage({ command: 'showGitCredentials' });
        }

        throw new Error('Please configure Git identity in the helper, then try submitting again.');
    }

    private async getGitConfigValue(key: string, cwd: string): Promise<string | undefined> {
        const readValue = async (args: string[], options?: { cwd?: string }) => {
            try {
                const { stdout } = await execFileAsync('git', args, options);
                const stdoutString = typeof stdout === 'string' ? stdout : stdout.toString('utf8');
                const value = stdoutString.trim();
                return value.length > 0 ? value : undefined;
            } catch {
                return undefined;
            }
        };

        const local = await readValue(['config', '--get', key], { cwd });
        if (local) {
            return local;
        }

        return await readValue(['config', '--global', '--get', key]);
    }

    private handleSaveGitIdentity = async (message: any): Promise<void> => {
        const rawName = typeof message?.name === 'string' ? message.name.trim() : '';
        const rawEmail = typeof message?.email === 'string' ? message.email.trim() : '';

        const sendResult = (status: 'success' | 'error' | 'warning' | 'info', text: string) => {
            this.context.sendMessage({
                command: 'gitCredentialsResult',
                status,
                message: text
            });
        };

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

        try {
            await execFileAsync('git', ['config', '--global', 'user.name', rawName]);
            await execFileAsync('git', ['config', '--global', 'user.email', rawEmail]);
            sendResult('success', 'Git identity saved globally.');
            vscode.window.showInformationMessage('Git author information saved globally.');
        } catch (error: any) {
            console.error('Failed to save Git identity globally:', error);
            const messageText = error instanceof Error ? error.message : 'Unknown error';
            sendResult('error', `Failed to save Git identity: ${messageText}`);
            vscode.window.showErrorMessage(`Failed to save Git identity: ${messageText}`);
        }
    };

    private handleRequestGitIdentity = async (): Promise<void> => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const cwd = workspaceFolder?.uri.fsPath ?? process.cwd();

        const name = await this.getGitConfigValue('user.name', cwd);
        const email = await this.getGitConfigValue('user.email', cwd);

        this.context.sendMessage({
            command: 'gitIdentityInfo',
            name: name ?? '',
            email: email ?? ''
        });
    };

    private handleSaveGitCredentials = async (message: any): Promise<void> => {
        const rawUsername = typeof message?.username === 'string' ? message.username.trim() : '';
        const rawToken = typeof message?.token === 'string' ? message.token.trim() : '';
        const rawServerUrl = typeof message?.serverUrl === 'string' ? message.serverUrl.trim() : '';

        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const configuredServerUrl = config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, 'https://artemis.cit.tum.de');
        const serverUrl = rawServerUrl || configuredServerUrl;

        const sendResult = (status: 'success' | 'error' | 'warning' | 'info', text: string) => {
            this.context.sendMessage({
                command: 'gitCredentialsResult',
                status,
                message: text
            });
        };

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
        } catch (error) {
            console.error('Invalid Artemis server URL:', error);
            sendResult('error', 'Invalid Artemis server URL.');
            vscode.window.showErrorMessage('Invalid Artemis server URL. Please verify the value and try again.');
            return;
        }

        try {
            await execFileAsync('git', ['--version']);
        } catch {
            sendResult('error', 'Git is not available on the PATH.');
            vscode.window.showErrorMessage('Git is not available on this system. Please install Git and try again.');
            return;
        }

        try {
            await this.ensureCredentialHelperConfigured();
        } catch (error: any) {
            console.error('Failed to configure credential helper:', error);
            const messageText = error instanceof Error ? error.message : 'Unknown error';
            sendResult('error', `Failed to configure credential helper: ${messageText}`);
            vscode.window.showErrorMessage(`Failed to configure Git credential helper: ${messageText}`);
            return;
        }

        try {
            await this.storeCredentialEntry(host, rawUsername, rawToken);
            const successMessage = `Saved Git credentials for ${host}.`;
            sendResult('success', successMessage);
            vscode.window.showInformationMessage(successMessage);
        } catch (error: any) {
            console.error('Failed to store credential entry:', error);
            const messageText = error instanceof Error ? error.message : 'Unknown error';
            sendResult('error', `Failed to save credentials: ${messageText}`);
            vscode.window.showErrorMessage(`Failed to save Git credentials: ${messageText}`);
        }
    };

    private async ensureCredentialHelperConfigured(): Promise<void> {
        try {
            const { stdout } = await execFileAsync('git', ['config', '--global', '--get', 'credential.helper']);
            if (!stdout || stdout.trim().length === 0) {
                await execFileAsync('git', ['config', '--global', 'credential.helper', 'store']);
            }
        } catch {
            await execFileAsync('git', ['config', '--global', 'credential.helper', 'store']);
        }
    }

    private async storeCredentialEntry(host: string, username: string, password: string): Promise<void> {
        const input = `protocol=https\nhost=${host}\nusername=${username}\npassword=${password}\n\n`;

        await new Promise<void>((resolve, reject) => {
            const child = spawn('git', ['credential', 'approve']);
            let stderr = '';

            child.on('error', (error) => reject(error));
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            child.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(stderr.trim() || `git credential approve exited with code ${code}`));
                }
            });

            child.stdin.write(input);
            child.stdin.end();
        });
    }

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
