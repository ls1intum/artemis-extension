import * as vscode from 'vscode';
import { IrisSessionManager } from './irisSessionManager';
import { ActiveContext } from '../../types';
import { logger, LogCategory } from '../loggingService';
import { ExtensionMsg } from '../../shared/messageContracts';
import { fetchSessionsWithMessages, importSessionsToStore } from './sessionSyncUtils';
import type { IrisServiceDeps } from './sessionSyncUtils';

export class IrisSessionLifecycleService {
    constructor(
        private readonly deps: IrisServiceDeps,
        private readonly _getIrisSessionManager: () => IrisSessionManager | undefined,
        private readonly _loadIrisMessages: () => Promise<void>,
        private readonly _resetToWorkspace: () => void = () => {},
    ) { }

    public createNewSession(): void {
        logger.info('Creating new session', LogCategory.IRIS_CHAT);

        // If workspace exercise exists and we're not in workspace context, switch back
        const workspaceExercise = this.deps.contextStore.getWorkspaceExercise();
        const currentContext = this.deps.contextStore.getActiveContext();
        if (workspaceExercise && currentContext?.source !== 'workspace-detected') {
            this._resetToWorkspace();
            return; // switchContext in the provider already handles session creation
        }

        const irisSessionManager = this._getIrisSessionManager();
        if (irisSessionManager) {
            irisSessionManager.unsubscribe();
        }

        this.deps.contextStore.createSession();
        this.deps.postSnapshot();

        this.deps.postMessage({ type: ExtensionMsg.ClearChatMessages });

        // Create a brand new Iris session on the server
        const activeContext = this.deps.contextStore.getActiveContext();
        if (activeContext && irisSessionManager) {
            irisSessionManager.createNewSession(activeContext)
                .then(sessionId => {
                    this._storeArtemisSessionId(sessionId);
                    vscode.window.showInformationMessage('New conversation started!');
                })
                .catch((err: unknown) => {
                    logger.error('Error creating new Iris session:', LogCategory.IRIS_CHAT, err);
                    const errorMessage = err instanceof Error ? err.message : String(err);
                    vscode.window.showErrorMessage(`Failed to create new conversation: ${errorMessage}`);
                });
        }
    }

    public switchToSession(sessionId: string): void {
        logger.info('Switching to session:', LogCategory.IRIS_CHAT, sessionId);

        const irisSessionManager = this._getIrisSessionManager();
        if (irisSessionManager) {
            irisSessionManager.unsubscribe();
        }

        this.deps.contextStore.switchSession(sessionId);
        this.deps.postSnapshot();

        this.deps.postMessage({ type: ExtensionMsg.ClearChatMessages });

        // Load messages for the switched session
        this._loadIrisMessages().catch(err => {
            logger.error('Error loading messages for switched session:', LogCategory.IRIS_CHAT, err);
        });
    }

    public async handleResetSessions(): Promise<void> {
        const confirmation = await vscode.window.showWarningMessage(
            'This will clear all local Iris chat session data and reload all sessions from Artemis. Continue?',
            { modal: true },
            'Yes, Reset & Reload'
        );

        if (confirmation !== 'Yes, Reset & Reload') {
            return;
        }

        this._clearAllSessions();

        // If there's an active context, reload all sessions from Artemis
        const activeContext = this.deps.contextStore.getActiveContext();
        if (!activeContext || !this.deps.artemisApiService) {
            return;
        }

        const targetContext: ActiveContext = { ...activeContext };

        try {
            logger.info('Fetching all Iris sessions from Artemis for context:', LogCategory.IRIS_CHAT, activeContext.title);

            const sessionsFromServer = await fetchSessionsWithMessages(this.deps.artemisApiService, activeContext);

            logger.info(`Fetched ${sessionsFromServer.length} session(s) with messages from Artemis`, LogCategory.IRIS_CHAT);

            // Check if context changed during async operations (both type AND id)
            const currentContext = this.deps.contextStore.getActiveContext();
            if (!currentContext || currentContext.type !== targetContext.type || currentContext.id !== targetContext.id) {
                logger.info('Context changed during session reset, aborting import', LogCategory.IRIS_CHAT);
                return;
            }

            // Import all sessions from Artemis
            const importedCount = importSessionsToStore(sessionsFromServer, this.deps.contextStore);

            if (importedCount > 0) {
                // Switch to the first (newest) session
                this.deps.contextStore.switchToFirstSession();
                this.deps.postSnapshot();

                // Check context again before loading messages
                const contextAfterImport = this.deps.contextStore.getActiveContext();
                if (!contextAfterImport || contextAfterImport.type !== targetContext.type || contextAfterImport.id !== targetContext.id) {
                    logger.info('Context changed during session import, aborting message load', LogCategory.IRIS_CHAT);
                    return;
                }

                // Load messages for the most recent session
                await this._loadIrisMessages();

                vscode.window.showInformationMessage(`Successfully reloaded ${importedCount} session(s) from Artemis`);
            } else {
                vscode.window.showInformationMessage('No sessions found on Artemis for this context');
            }
        } catch (error: unknown) {
            logger.error('Error resetting sessions from Artemis:', LogCategory.IRIS_CHAT, error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to reload sessions: ${errorMessage}`);
        }
    }

    private _storeArtemisSessionId(artemisSessionId: number): void {
        // Store the Artemis session ID in the active local session
        this.deps.contextStore.setArtemisSessionId(artemisSessionId);
        this.deps.postSnapshot();
    }

    private _clearAllSessions(): void {
        logger.info('Clearing all local sessions', LogCategory.IRIS_CHAT);
        this.deps.contextStore.clearAllSessions();
        this.deps.postSnapshot();
        this.deps.postMessage({ type: ExtensionMsg.ClearChatMessages });
    }
}
