import * as vscode from 'vscode';
import { ContextStore } from './contextStore';
import { IrisSessionManager } from './irisSessionManager';
import { ArtemisApiService } from '../api';
import { ActiveContext } from '../provider/contextTypes';

export class SessionManagementService {
    constructor(
        private readonly _contextStore: ContextStore,
        private readonly _artemisApiService: ArtemisApiService | undefined,
        private readonly _getIrisSessionManager: () => IrisSessionManager | undefined,
        private readonly _postMessage: (message: any) => void,
        private readonly _postSnapshot: () => void,
        private readonly _loadIrisMessages: () => Promise<void>
    ) { }

    public createNewSession(): void {
        console.log('[Iris Chat] Creating new session');

        const irisSessionManager = this._getIrisSessionManager();
        if (irisSessionManager) {
            irisSessionManager.unsubscribe();
        }

        this._contextStore.createSession();
        this._postSnapshot();

        this._postMessage({ command: 'clearChatMessages' });

        // Create a brand new Iris session on the backend
        const activeContext = this._contextStore.getActiveContext();
        if (activeContext && irisSessionManager) {
            irisSessionManager.createNewSession(activeContext)
                .then(sessionId => {
                    this._storeArtemisSessionId(sessionId);
                    vscode.window.showInformationMessage('New conversation started!');
                })
                .catch(err => {
                    console.error('Error creating new Iris session:', err);
                    vscode.window.showErrorMessage(`Failed to create new conversation: ${err.message}`);
                });
        }
    }

    public switchToSession(sessionId: string): void {
        console.log('[Iris Chat] Switching to session:', sessionId);

        const irisSessionManager = this._getIrisSessionManager();
        if (irisSessionManager) {
            irisSessionManager.unsubscribe();
        }

        this._contextStore.switchSession(sessionId);
        this._postSnapshot();

        this._postMessage({ command: 'clearChatMessages' });

        // Load messages for the switched session
        this._loadIrisMessages().catch(err => {
            console.error('Error loading messages for switched session:', err);
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
            console.log('[Iris Chat] Fetching all Iris sessions from Artemis for context:', activeContext.title);

            // Step 1: Fetch session metadata
            let artemisSessionsMetadata: any[] = [];
            if (activeContext.type === 'course') {
                artemisSessionsMetadata = await this._artemisApiService.getCourseChatSessions(activeContext.id);
            } else if (activeContext.type === 'exercise') {
                artemisSessionsMetadata = await this._artemisApiService.getExerciseChatSessions(activeContext.id);
            }

            console.log(`[Iris Chat] Fetched ${artemisSessionsMetadata.length} session(s) metadata from Artemis`);

            // Step 2: Fetch messages for all sessions
            const artemisSessionsListFromServer: any[] = await Promise.all(
                artemisSessionsMetadata.map(async (session) => {
                    try {
                        const messages = await this._artemisApiService!.getChatMessages(session.id);
                        return {
                            ...session,
                            messages: messages
                        };
                    } catch (error) {
                        console.warn(`Failed to fetch messages for session ${session.id}:`, error);
                        return {
                            ...session,
                            messages: []
                        };
                    }
                })
            );

            console.log(`Fetched messages for all ${artemisSessionsListFromServer.length} sessions`);

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
                        const firstUserMsg = artemisSession.messages.find((m: any) => m.sender === 'USER');
                        if (firstUserMsg?.content?.[0]?.textContent) {
                            preview = firstUserMsg.content[0].textContent.substring(0, 50);
                        }
                    }

                    const snapshot = this._contextStore.createSessionWithDetails(
                        preview,
                        messageCount,
                        createdAt,
                        artemisSession.id
                    );

                    // Switch to the newest session if this is the first one
                    if (artemisSession === artemisSessionsListFromServer[0] && snapshot.activeSession) {
                        this._contextStore.switchSession(snapshot.activeSession.id);
                    }

                    console.log(`[Iris Chat] Imported session ${artemisSession.id} (${messageCount} messages) with local ID: ${snapshot.activeSession?.id}`);
                }

                this._postSnapshot();

                // Load messages for the most recent session
                await this._loadIrisMessages();

                vscode.window.showInformationMessage(`Successfully reloaded ${artemisSessionsListFromServer.length} session(s) from Artemis`);
            } else {
                vscode.window.showInformationMessage('No sessions found on Artemis for this context');
            }
        } catch (error: any) {
            console.error('Error resetting sessions from Artemis:', error);
            vscode.window.showErrorMessage(`Failed to reload sessions: ${error.message}`);
        }
    }

    private _storeArtemisSessionId(artemisSessionId: number): void {
        // Store the Artemis session ID in the active local session
        this._contextStore.setArtemisSessionId(artemisSessionId);
        this._postSnapshot();
    }

    private _clearAllSessions(): void {
        console.log('[Iris Chat] Clearing all local sessions');
        this._contextStore.clearAllSessions();
        this._postSnapshot();
        this._postMessage({ command: 'clearChatMessages' });
    }
}
