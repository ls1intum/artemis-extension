import * as vscode from 'vscode';
import { checkWorkspaceFiles } from '../utils';

export interface FileMonitorUpdate {
    includedFiles: string[];
    excludedFiles: { path: string; reason: string }[];
    totalCount: number;
}

export class FileMonitorService implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private _fileUpdateTimer?: NodeJS.Timeout;
    private _lastFileUpdate = 0;

    private readonly _onDidUpdateFiles = new vscode.EventEmitter<FileMonitorUpdate>();
    public readonly onDidUpdateFiles = this._onDidUpdateFiles.event;

    constructor() {
        this._startFileMonitoring();
    }

    public dispose(): void {
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
        console.log('[File Monitor] Starting file monitoring...');
        
        // Listen to document save events
        const saveListener = vscode.workspace.onDidSaveTextDocument(() => {
            console.log('[File Monitor] Document saved, updating...');
            void this._updateReferencedFilesDisplay();
        });
        this._disposables.push(saveListener);

        // Listen to document change events (throttled)
        const changeListener = vscode.workspace.onDidChangeTextDocument(() => {
            this._scheduleFileUpdate();
        });
        this._disposables.push(changeListener);

        // Listen to Git changes
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (gitExtension) {
            Promise.resolve(gitExtension.activate()).then(() => {
                console.log('[File Monitor] Git extension activated');
                const git = gitExtension.exports.getAPI(1);
                if (git) {
                    console.log('[File Monitor] Git API available, watching', git.repositories.length, 'repositories');
                    // Listen to repository state changes
                    git.repositories.forEach((repo: any) => {
                        const repoListener = repo.state.onDidChange(() => {
                            console.log('[File Monitor] Git state changed, updating...');
                            void this._updateReferencedFilesDisplay();
                        });
                        this._disposables.push(repoListener);
                    });
                }
            }).catch(() => {
                console.log('[File Monitor] Git extension not available');
            });
        }

        // Periodic update (every 5 seconds) as a fallback
        this._fileUpdateTimer = setInterval(() => {
            console.log('[File Monitor] Periodic update...');
            void this._updateReferencedFilesDisplay();
        }, 5000);

        // Initial update
        console.log('[File Monitor] Running initial update...');
        void this._updateReferencedFilesDisplay();
    }

    private _scheduleFileUpdate(): void {
        // Throttle updates to avoid excessive calls while typing
        const now = Date.now();
        if (now - this._lastFileUpdate < 2000) { // Wait at least 2 seconds between updates
            return;
        }
        this._lastFileUpdate = now;
        void this._updateReferencedFilesDisplay();
    }

    public async triggerUpdate(): Promise<void> {
        await this._updateReferencedFilesDisplay();
    }

    private async _updateReferencedFilesDisplay(): Promise<void> {
        // Check if feature is enabled
        const sendUncommittedChanges = vscode.workspace.getConfiguration('artemis.iris').get<boolean>('sendUncommittedChanges', true);
        if (!sendUncommittedChanges) {
            console.log('[File Monitor] Feature disabled, clearing display');
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
                console.log('[File Monitor] No workspace folder');
                return;
            }

            console.log('[File Monitor] Checking git status in:', workspaceFolder.uri.fsPath);
            
            // Use unified workspace file checker with filters and status
            const result = await checkWorkspaceFiles(workspaceFolder, {
                includeContent: false,
                applyFilters: true,      // Apply filters to show only what will be sent
                includeStatus: true      // Include status/reason for all files
            });
            
            console.log('[File Monitor] Changed files from git:', JSON.stringify(result.files.map(f => f.path)));
            
            if (!result.hasChanges) {
                console.log('[File Monitor] No changes detected');
                this._onDidUpdateFiles.fire({
                    includedFiles: [],
                    excludedFiles: [],
                    totalCount: 0
                });
                return;
            }

            console.log(`[File Monitor] Found ${result.totalCount} changed files (${result.includedCount} will be sent, ${result.excludedCount} excluded)`);
            
            // Separate included and excluded files with reasons
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
            // Silently fail for live updates - don't show errors to user
            console.error('[File Monitor] Error updating referenced files display:', error);
        }
    }
}
