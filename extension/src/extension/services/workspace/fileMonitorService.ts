import * as vscode from 'vscode';

import { logger } from '@extension/services/loggingService';

import { checkWorkspaceFiles } from './workspaceFileChecker';

export interface FileMonitorUpdate {
    includedFiles: string[];
    excludedFiles: { path: string; reason: string }[];
    totalCount: number;
}

export class FileMonitorService implements vscode.Disposable {
    /** Minimum interval between file updates while typing */
    private static readonly THROTTLE_INTERVAL_MS = 2000;

    /** Fallback periodic update interval */
    private static readonly PERIODIC_UPDATE_INTERVAL_MS = 5000;

    private readonly _disposables: vscode.Disposable[] = [];
    private _fileUpdateTimer?: NodeJS.Timeout;
    private _lastFileUpdate = 0;
    private _disposed = false;

    private readonly _onDidUpdateFiles = new vscode.EventEmitter<FileMonitorUpdate>();
    public readonly onDidUpdateFiles = this._onDidUpdateFiles.event;

    constructor() {
        this._startFileMonitoring();
    }

    public dispose(): void {
        this._disposed = true;

        if (this._fileUpdateTimer) {
            clearInterval(this._fileUpdateTimer);
            this._fileUpdateTimer = undefined;
        }

        while (this._disposables.length > 0) {
            const disposable = this._disposables.pop();
            disposable?.dispose();
        }

        this._onDidUpdateFiles.dispose();
    }

    private _startFileMonitoring(): void {
        logger.fileMonitor('Starting file monitoring...');

        const saveListener = vscode.workspace.onDidSaveTextDocument(() => {
            logger.fileMonitor('Document saved, updating...');
            void this._updateReferencedFilesDisplay();
        });
        this._disposables.push(saveListener);

        const changeListener = vscode.workspace.onDidChangeTextDocument(() => {
            this._scheduleFileUpdate();
        });
        this._disposables.push(changeListener);

        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (gitExtension) {
            Promise.resolve(gitExtension.activate()).then(() => {
                if (this._disposed) { return; }
                logger.fileMonitor('Git extension activated');
                // Git extension exports are untyped - use unknown and type guard
                const exports = gitExtension.exports as { getAPI?: (version: number) => unknown };
                const git = exports.getAPI?.(1) as { repositories?: Array<{ state: { onDidChange: (listener: () => void) => vscode.Disposable } }> } | undefined;
                if (git?.repositories) {
                    logger.fileMonitor(`Git API available, watching ${git.repositories.length} repositories`);
                    git.repositories.forEach((repo) => {
                        const repoListener = repo.state.onDidChange(() => {
                            logger.fileMonitor('Git state changed, updating...');
                            void this._updateReferencedFilesDisplay();
                        });
                        this._disposables.push(repoListener);
                    });
                }
            }).catch(() => {
                logger.fileMonitor('Git extension not available');
            });
        }

        this._fileUpdateTimer = setInterval(() => {
            logger.fileMonitor('Periodic update...');
            void this._updateReferencedFilesDisplay();
        }, FileMonitorService.PERIODIC_UPDATE_INTERVAL_MS);

        logger.fileMonitor('Running initial update...');
        void this._updateReferencedFilesDisplay();
    }

    private _scheduleFileUpdate(): void {
        const now = Date.now();
        if (now - this._lastFileUpdate < FileMonitorService.THROTTLE_INTERVAL_MS) {
            return;
        }
        this._lastFileUpdate = now;
        void this._updateReferencedFilesDisplay();
    }

    public async triggerUpdate(): Promise<void> {
        await this._updateReferencedFilesDisplay();
    }

    private async _updateReferencedFilesDisplay(): Promise<void> {
        const sendUncommittedChanges = vscode.workspace.getConfiguration('artemis.iris').get<boolean>('sendUncommittedChanges', true);
        if (!sendUncommittedChanges) {
            logger.fileMonitor('Feature disabled, clearing display');
            this._onDidUpdateFiles.fire({
                includedFiles: [],
                excludedFiles: [],
                totalCount: 0
            });
            return;
        }

        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                logger.fileMonitor('No workspace folder');
                return;
            }

            const result = await checkWorkspaceFiles(workspaceFolder, {
                includeContent: false,
                applyFilters: true,
                includeStatus: true
            });

            if (!result.hasChanges) {
                // No changes: stay silent. This runs on every poll, so logging the empty result here
                // just floods the output channel; only log once there is actually something to report.
                this._onDidUpdateFiles.fire({
                    includedFiles: [],
                    excludedFiles: [],
                    totalCount: 0
                });
                return;
            }

            logger.fileMonitor(`Checking git status in: ${workspaceFolder.uri.fsPath}`);
            logger.fileMonitor(`Changed files from git: ${JSON.stringify(result.files.map(f => f.path))}`);
            logger.fileMonitor(`Found ${result.totalCount} changed files (${result.includedCount} will be sent, ${result.excludedCount} excluded)`);

            const includedFiles = result.files
                .filter(f => f.status === 'included')
                .map(f => f.path);

            const excludedFiles = result.files
                .filter(f => f.status === 'excluded')
                .map(f => ({ path: f.path, reason: f.reason || 'Excluded' }));

            this._onDidUpdateFiles.fire({
                includedFiles: includedFiles,
                excludedFiles: excludedFiles,
                totalCount: result.totalCount
            });
        } catch (error) {
            // Live updates fail silently; no error is shown to the user.
            logger.fileMonitorError('Error updating referenced files display:', error);
        }
    }
}
