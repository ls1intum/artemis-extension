import * as vscode from 'vscode';
import { ContextStore } from '../contextStore';
import { IrisSessionManager } from './irisSessionManager';
import { ArtemisApiService } from '../../api';
import { ActiveContext } from '../../types';
import type { IrisChatSession, IrisChatMessage } from '../../types/apiResponses';
import { logger, LogCategory } from '../loggingService';
import { ExtensionMsg } from '../../shared/messageContracts';
import type { ExtensionToWebviewMessage } from '../../shared/messageContracts';

export class IrisSessionLifecycleService {
    constructor(
        private readonly _contextStore: ContextStore,
        private readonly _artemisApiService: ArtemisApiService | undefined,
        private readonly _getIrisSessionManager: () => IrisSessionManager | undefined,
        private readonly _postMessage: (message: ExtensionToWebviewMessage) => void,
        private readonly _postSnapshot: () => void,
        private readonly _loadIrisMessages: () => Promise<void>,
        private readonly _resetToWorkspace: () => void = () => {},
    ) { }

    public createNewSession(): void {
        logger.info('Creating new session', LogCategory.IRIS_CHAT);

        // If workspace exercise exists and we're not in workspace context, switch back
        const workspaceExercise = this._contextStore.getWorkspaceExercise();
        const currentContext = this._contextStore.getActiveContext();
        if (workspaceExercise && currentContext?.source !== 'workspace-detected') {
            this._resetToWorkspace();
            return; // switchContext in the provider already handles session creation
        }

        const irisSessionManager = this._getIrisSessionManager();
        if (irisSessionManager) {
            irisSessionManager.unsubscribe();
        }

        this._contextStore.createSession();
        this._postSnapshot();

        this._postMessage({ type: ExtensionMsg.ClearChatMessages });

        // Create a brand new Iris session on the server
        const activeContext = this._contextStore.getActiveContext();
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

        this._contextStore.switchSession(sessionId);
        this._postSnapshot();

        this._postMessage({ type: ExtensionMsg.ClearChatMessages });

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
        const activeContext = this._contextStore.getActiveContext();
        if (!activeContext || !this._artemisApiService) {
            return;
        }

        try {
            logger.info('Fetching all Iris sessions from Artemis for context:', LogCategory.IRIS_CHAT, activeContext.title);

            // Step 1: Fetch session metadata
            let artemisSessionsMetadata: IrisChatSession[] = [];
            if (activeContext.type === 'course') {
                artemisSessionsMetadata = await this._artemisApiService.getCourseChatSessions(activeContext.id);
            } else if (activeContext.type === 'exercise') {
                artemisSessionsMetadata = await this._artemisApiService.getExerciseChatSessions(activeContext.id);
            }

            logger.info(`Fetched ${artemisSessionsMetadata.length} session(s) metadata from Artemis`, LogCategory.IRIS_CHAT);

            // Step 2: Fetch messages for all sessions
            const artemisSessionsListFromServer: Array<IrisChatSession & { messages: IrisChatMessage[] }> = await Promise.all(
                artemisSessionsMetadata.map(async (session) => {
                    try {
                        const messages = await this._artemisApiService!.getChatMessages(session.id ?? 0);
                        return {
                            ...session,
                            messages: messages
                        };
                    } catch (error) {
                        logger.warn(`Failed to fetch messages for session ${session.id}:`, LogCategory.IRIS_CHAT, error);
                        return {
                            ...session,
                            messages: []
                        };
                    }
                })
            );

            logger.info(`Fetched messages for all ${artemisSessionsListFromServer.length} sessions`, LogCategory.IRIS_CHAT);

            // Import all sessions from Artemis
            if (artemisSessionsListFromServer.length > 0) {
                // Sort sessions by creation date (newest first)
                artemisSessionsListFromServer.sort((a, b) => {
                    const dateA = a.creationDate ? new Date(a.creationDate).getTime() : 0;
                    const dateB = b.creationDate ? new Date(b.creationDate).getTime() : 0;
                    return dateB - dateA;
                });

                for (const artemisSession of artemisSessionsListFromServer) {
                    // Create local session for each Artemis session
                    const messageCount = artemisSession.messages?.length || 0;
                    const createdAt = artemisSession.creationDate ? new Date(artemisSession.creationDate).getTime() : Date.now();

                    // Create preview from first user message or use default
                    let preview = 'New conversation';
                    if (artemisSession.messages && artemisSession.messages.length > 0) {
                        const firstUserMsg = artemisSession.messages.find((m: IrisChatMessage) => m.sender === 'USER');
                        if (firstUserMsg?.content?.[0]?.textContent) {
                            preview = firstUserMsg.content[0].textContent.substring(0, 50);
                        }
                    }

                    const snapshot = this._contextStore.createSessionWithDetails(
                        preview,
                        messageCount,
                        createdAt,
                        artemisSession.id ?? 0
                    );

                    // Switch to the newest session if this is the first one
                    if (artemisSession === artemisSessionsListFromServer[0] && snapshot.activeSession) {
                        this._contextStore.switchSession(snapshot.activeSession.id);
                    }

                    logger.info(`Imported session ${artemisSession.id} (${messageCount} messages) with local ID: ${snapshot.activeSession?.id}`, LogCategory.IRIS_CHAT);
                }

                this._postSnapshot();

                // Load messages for the most recent session
                await this._loadIrisMessages();

                vscode.window.showInformationMessage(`Successfully reloaded ${artemisSessionsListFromServer.length} session(s) from Artemis`);
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
        this._contextStore.setArtemisSessionId(artemisSessionId);
        this._postSnapshot();
    }

    private _clearAllSessions(): void {
        logger.info('Clearing all local sessions', LogCategory.IRIS_CHAT);
        this._contextStore.clearAllSessions();
        this._postSnapshot();
        this._postMessage({ type: ExtensionMsg.ClearChatMessages });
    }
}
