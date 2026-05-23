import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { LogCategory, logger } from '@extension/services/loggingService';

const execFileAsync = promisify(execFile);

/**
 * Type for the file exists checker function (used for dependency injection in tests)
 */
type FileExistsChecker = (uri: vscode.Uri) => Promise<boolean>;

/**
 * Service that detects the presence of a .noai file in the workspace or git repository.
 * When a .noai file is detected, Iris AI assistance should be disabled.
 */
export class NoAiDetectionService implements vscode.Disposable {
    private _isNoAiEnabled: boolean = false;
    private _noAiFilePath: string | undefined;
    private readonly _disposables: vscode.Disposable[] = [];
    private _fileWatcher: vscode.FileSystemWatcher | undefined;

    private readonly _onNoAiStatusChanged = new vscode.EventEmitter<boolean>();
    public readonly onNoAiStatusChanged = this._onNoAiStatusChanged.event;
    private _initPromise: Promise<boolean>;

    /**
     * Customizable file exists checker for testing.
     * Default implementation uses vscode.workspace.fs.stat
     */
    private _fileExistsChecker: FileExistsChecker = async (uri: vscode.Uri) => {
        try {
            await vscode.workspace.fs.stat(uri);
            return true;
        } catch {
            return false;
        }
    };

    constructor() {
        this._initPromise = Promise.resolve(false);
        this._initialize();
    }

    /**
     * Wait for the initial .noai file check to complete.
     * Useful in tests to avoid setTimeout-based polling.
     */
    public waitForInitialization(): Promise<boolean> {
        return this._initPromise;
    }

    /**
     * Set a custom file exists checker (for testing purposes)
     */
    public setFileExistsChecker(checker: FileExistsChecker): void {
        this._fileExistsChecker = checker;
    }

    public dispose(): void {
        this._fileWatcher?.dispose();
        this._onNoAiStatusChanged.dispose();
        while (this._disposables.length > 0) {
            const disposable = this._disposables.pop();
            disposable?.dispose();
        }
    }

    /**
     * Returns true if a .noai file was detected (meaning Iris should be disabled)
     */
    public get isNoAiEnabled(): boolean {
        return this._isNoAiEnabled;
    }

    /**
     * Returns the path to the detected .noai file, if any
     */
    public get noAiFilePath(): string | undefined {
        return this._noAiFilePath;
    }

    private _initialize(): void {
        // Initial check
        this._initPromise = this._checkForNoAiFile();

        // Watch for workspace folder changes
        const workspaceFolderListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
            logger.info('.noai detection: Workspace folders changed, re-checking...', LogCategory.GENERAL);
            void this._checkForNoAiFile().catch((err: unknown) => {
                logger.error('Failed to check for .noai file after workspace change', LogCategory.GENERAL, err);
            });
            this._setupFileWatcher();
        });
        this._disposables.push(workspaceFolderListener);

        // Setup file watcher for .noai files
        this._setupFileWatcher();
    }

    private _setupFileWatcher(): void {
        // Dispose existing watcher
        this._fileWatcher?.dispose();

        // Watch for .noai file creation/deletion in all workspace folders
        this._fileWatcher = vscode.workspace.createFileSystemWatcher('**/.noai');

        this._fileWatcher.onDidCreate((uri) => {
            logger.info(`.noai file created: ${uri.fsPath}`, LogCategory.GENERAL);
            void this._checkForNoAiFile().catch((err: unknown) => {
                logger.error('Failed to check for .noai file after creation', LogCategory.GENERAL, err);
            });
        });

        this._fileWatcher.onDidDelete((uri) => {
            logger.info(`.noai file deleted: ${uri.fsPath}`, LogCategory.GENERAL);
            void this._checkForNoAiFile().catch((err: unknown) => {
                logger.error('Failed to check for .noai file after deletion', LogCategory.GENERAL, err);
            });
        });

        this._disposables.push(this._fileWatcher);
    }

    /**
     * Manually trigger a check for .noai files
     */
    public async checkForNoAiFile(): Promise<boolean> {
        return this._checkForNoAiFile();
    }

    private async _checkForNoAiFile(): Promise<boolean> {
        const previousState = this._isNoAiEnabled;
        this._isNoAiEnabled = false;
        this._noAiFilePath = undefined;

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            if (previousState !== this._isNoAiEnabled) {
                this._onNoAiStatusChanged.fire(this._isNoAiEnabled);
            }
            return this._isNoAiEnabled;
        }

        // Check each workspace folder
        for (const folder of workspaceFolders) {
            // Check workspace root
            const workspaceNoAi = vscode.Uri.joinPath(folder.uri, '.noai');
            if (await this._fileExists(workspaceNoAi)) {
                this._isNoAiEnabled = true;
                this._noAiFilePath = workspaceNoAi.fsPath;
                logger.info(`.noai file detected at workspace root: ${this._noAiFilePath}`, LogCategory.GENERAL);
                break;
            }

            // Check git root (might be different from workspace root)
            const gitRoot = await this._getGitRoot(folder);
            if (gitRoot && gitRoot !== folder.uri.fsPath) {
                const gitNoAi = vscode.Uri.file(`${gitRoot}/.noai`);
                if (await this._fileExists(gitNoAi)) {
                    this._isNoAiEnabled = true;
                    this._noAiFilePath = gitNoAi.fsPath;
                    logger.info(`.noai file detected at git root: ${this._noAiFilePath}`, LogCategory.GENERAL);
                    break;
                }
            }
        }

        // Fire event if state changed
        if (previousState !== this._isNoAiEnabled) {
            logger.info(`.noai detection state changed: ${this._isNoAiEnabled ? 'DISABLED' : 'ENABLED'}`, LogCategory.GENERAL);
            this._onNoAiStatusChanged.fire(this._isNoAiEnabled);
            await vscode.commands.executeCommand('setContext', 'iris:noAiDetected', this._isNoAiEnabled);
        }

        return this._isNoAiEnabled;
    }

    private async _fileExists(uri: vscode.Uri): Promise<boolean> {
        return this._fileExistsChecker(uri);
    }

    private async _getGitRoot(workspaceFolder: vscode.WorkspaceFolder): Promise<string | null> {
        try {
            const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
                cwd: workspaceFolder.uri.fsPath
            });
            return stdout.trim();
        } catch {
            return null;
        }
    }
}
