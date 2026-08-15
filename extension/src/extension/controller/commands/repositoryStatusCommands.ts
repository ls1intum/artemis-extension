import * as vscode from 'vscode';
import * as path from 'path';

import type { WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, WebviewCmd } from '@shared/messageContracts';

import { LogCategory, logger } from '@extension/services/loggingService';
import * as workspaceServices from '@extension/services/workspace';

import type { CommandContext, CommandMap } from './types';

interface RepoContext {
    expectedRepoUrl: string;
    exerciseId: number;
}

/**
 * Helper functions injected via the constructor so tests can substitute
 * deterministic doubles. The defaults wire up to the production modules.
 *
 * The injection seam is necessary because the production helpers are
 * re-exported through `@extension/services/workspace` barrel modules, where the
 * TS-emitted descriptors are non-configurable getters: namespace stubbing fails
 * with "descriptor is not configurable", so the callables are injected instead.
 */
export interface RepositoryStatusCommandsDeps {
    getWorkspaceStatus: typeof workspaceServices.getWorkspaceStatus;
}

const defaultDeps: RepositoryStatusCommandsDeps = {
    getWorkspaceStatus: workspaceServices.getWorkspaceStatus,
};

export class RepositoryStatusCommands {
    private currentRepoContext?: RepoContext;
    private currentWorkspacePath?: string;
    private workspaceChangeDebounce?: NodeJS.Timeout;
    private dirtyPagesCheckDebounce?: NodeJS.Timeout;
    private workspaceListenersRegistered = false;
    private readonly listenerDisposables: vscode.Disposable[] = [];
    private readonly deps: RepositoryStatusCommandsDeps;

    constructor(
        private readonly context: CommandContext,
        deps: Partial<RepositoryStatusCommandsDeps> = {},
    ) {
        this.deps = { ...defaultDeps, ...deps };
        this.registerWorkspaceListeners();
    }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.CheckRepositoryStatus]: this.handleCheckRepositoryStatus,
        };
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

    /**
     * Trigger a fresh status check using the currently stored context.
     * No-op if no context has been set.
     */
    public async recheckCurrentRepoStatus(): Promise<void> {
        if (!this.currentRepoContext) {
            return;
        }
        await this._checkRepositoryStatusWithContext(
            [this.currentRepoContext.expectedRepoUrl],
            this.currentRepoContext.exerciseId,
        );
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

    private handleCheckRepositoryStatus = async (_message: WebviewToExtensionMessage): Promise<void> => {
        const exerciseData = this.context.appStateManager.currentExerciseData;
        const exercise = exerciseData?.exercise;
        const participations = exercise?.studentParticipations ?? [];
        const repoUris = participations
            .map(p => p.repositoryUri)
            .filter((uri): uri is string => !!uri);

        if (exercise?.id === undefined || repoUris.length === 0) {
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

            for (const uri of repoUris) {
                const status = await this.deps.getWorkspaceStatus(uri, workspaceFolder);
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
    }

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
}
