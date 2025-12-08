import * as vscode from 'vscode';
import { ContextStore } from './contextStore';
import { ArtemisApiService } from '../api';
import { ActiveContext } from '../provider/contextTypes';

export class ChatSessionService {
    private _contextLoadToken = 0;

    constructor(
        private readonly _contextStore: ContextStore,
        private readonly _artemisApiService: ArtemisApiService | undefined,
        private readonly _postMessage: (message: any) => void,
        private readonly _onSessionLoaded: () => Promise<void>,
        private readonly _onCreateNewSession: () => void,
        private readonly _onPostSnapshot: () => void
    ) {}

    public get contextLoadToken(): number {
        return this._contextLoadToken;
    }

    public incrementLoadToken(): number {
        return ++this._contextLoadToken;
    }

    public isCurrentContext(expected: ActiveContext, loadToken: number): boolean {
        if (loadToken !== this._contextLoadToken) {
            return false;
        }
        const current = this._contextStore.getActiveContext();
        return !!current && current.type === expected.type && current.id === expected.id;
    }

    public async checkAndLoadIrisSettings(context: ActiveContext): Promise<boolean> {
        if (!this._artemisApiService) {
            console.warn('Artemis API service not available');
            return false;
        }

        try {
            console.log(`[Iris Chat] Checking Iris settings for ${context.type}: ${context.title}`);

            // Fetch settings based on context type
            let settings: any;
            if (context.type === 'course') {
                settings = await this._artemisApiService.getIrisCourseChatSettings(context.id);
            } else if (context.type === 'exercise') {
                settings = await this._artemisApiService.getIrisExerciseChatSettings(context.id);
            } else {
                console.warn(`Unsupported context type for Iris: ${context.type}`);
                return false;
            }

            // Check if Iris chat is enabled
            const chatSettings = context.type === 'course'
                ? settings?.irisChatSettings
                : settings?.irisProgrammingExerciseChatSettings;

            if (!chatSettings?.enabled) {
                console.log('[Iris Chat] Iris chat is disabled in settings');
                return false;
            }

            console.log('[Iris Chat] Iris chat is enabled, settings loaded:', {
                enabled: chatSettings.enabled,
                rateLimit: chatSettings.rateLimit,
                rateLimitTimeframeHours: chatSettings.rateLimitTimeframeHours
            });

            return true;
        } catch (error: any) {
            console.error('Error checking Iris settings:', error);

            // If it's a 403, Iris is probably disabled - return false to show disabled overlay
            if (error.status === 403 || error.message?.includes('403')) {
                console.log('[Iris Chat] Iris is not available (403 error)');
                return false;
            }

            // For other errors, log but still return false to show disabled state
            console.log(`[Iris Chat] Could not load Iris settings: ${error.message}`);
            return false;
        }
    }

    public async loadAllSessionsForContext(): Promise<void> {
        const activeContext = this._contextStore.getActiveContext();

        console.log('🔄 [LOAD SESSIONS] Starting loadAllSessionsForContext');
        console.log('🔄 [LOAD SESSIONS] Active context:', activeContext);

        if (!activeContext || !this._artemisApiService) {
            console.log('🔄 [LOAD SESSIONS] Cannot load sessions: missing context or API service', {
                hasContext: !!activeContext,
                hasApiService: !!this._artemisApiService
            });
            return;
        }

        const targetContext: ActiveContext = { ...activeContext };
        const loadToken = this.incrementLoadToken();

        console.log('🔄 [LOAD SESSIONS] Target context for loading:', targetContext);
        console.log('🔄 [LOAD SESSIONS] Load token:', loadToken);

        try {
            console.log(`🔄 [LOAD SESSIONS] Loading all Iris sessions for ${activeContext.type}: ${activeContext.title} (ID: ${activeContext.id})`);

            // Step 0: Check if Iris is enabled for this context
            const isEnabled = await this.checkAndLoadIrisSettings(activeContext);

            if (!this.isCurrentContext(targetContext, loadToken)) {
                console.log('[Iris Chat] Context changed while checking Iris settings, aborting load');
                return;
            }

            if (!isEnabled) {
                console.log('[Iris Chat] Iris is disabled, not loading sessions');
                // Clear any existing sessions and show disabled overlay
                this._postMessage({
                    command: 'clearChatMessages'
                });
                const contextLabel = activeContext.type === 'course' ? 'course' : 'exercise';
                this._postMessage({
                    command: 'showDisabledState',
                    message: `Iris chat is not enabled for this ${contextLabel}. Please contact your instructor.`
                });
                return;
            }

            // Hide disabled overlay if it was previously shown
            this._postMessage({
                command: 'hideDisabledState'
            });

            // Step 1: Fetch session metadata (fast, lightweight)
            let artemisSessionsMetadata: any[] = [];
            if (activeContext.type === 'course') {
                artemisSessionsMetadata = await this._artemisApiService.getCourseChatSessions(activeContext.id);
            } else if (activeContext.type === 'exercise') {
                artemisSessionsMetadata = await this._artemisApiService.getExerciseChatSessions(activeContext.id);
            } else {
                console.log(`[Iris Chat] Unsupported context type: ${activeContext.type}`);
                return;
            }

            console.log(`[Iris Chat] Fetched ${artemisSessionsMetadata.length} session(s) metadata from Artemis`);

            // Step 2: Fetch messages for each session (to display in list)
            const artemisSessionsListFromServer: any[] = await Promise.all(
                artemisSessionsMetadata.map(async (session) => {
                    if (!this._artemisApiService) {
                        return { ...session, messages: [] };
                    }
                    try {
                        console.log(`[Iris Chat] Fetching messages for session ${session.id}...`);
                        const messages = await this._artemisApiService.getChatMessages(session.id);
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

            // CLEAR all existing sessions for this context to avoid stale data
            if (!this.isCurrentContext(targetContext, loadToken)) {
                console.log('[Iris Chat] Context changed before clearing sessions, aborting load');
                return;
            }

            const contextKey = `${targetContext.type}:${targetContext.id}`;
            console.log(`[Iris Chat] Clearing all existing sessions for context ${contextKey} before loading fresh data from Artemis`);
            this._contextStore.clearSessionsForContext(contextKey);

            // Clear chat messages immediately after clearing sessions to avoid showing old messages
            this._postMessage({ command: 'clearChatMessages' });

            // Import all sessions from Artemis
            if (artemisSessionsListFromServer.length > 0) {
                // Sort sessions by creation date (newest first)
                artemisSessionsListFromServer.sort((a, b) => {
                    const dateA = a.creationDate ? new Date(a.creationDate).getTime() : 0;
                    const dateB = b.creationDate ? new Date(b.creationDate).getTime() : 0;
                    return dateB - dateA;
                });

                console.log(`[Iris Chat] Importing ${artemisSessionsListFromServer.length} sessions from Artemis`);

                for (const artemisSession of artemisSessionsListFromServer) {

                    if (!this.isCurrentContext(targetContext, loadToken)) {
                        console.log('[Iris Chat] Context changed while importing sessions, aborting load');
                        return;
                    }

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

                    console.log(`[Iris Chat] Importing session ${artemisSession.id}: ${messageCount} messages, preview: "${preview}"`);

                    // Create local session with Artemis session ID and messages
                    this._contextStore.createSessionWithDetails(
                        preview,
                        messageCount,
                        createdAt,
                        artemisSession.id,
                        artemisSession.messages || []
                    );
                }

                console.log(`[Iris Chat] Imported ${artemisSessionsListFromServer.length} sessions for ${activeContext.type} ${activeContext.id}`);
            }

            // Get the latest snapshot after importing sessions
            const updatedSnapshot = this._contextStore.snapshot();

            // If there are sessions, switch to the first one and load its messages
            if (updatedSnapshot.sessions.length > 0) {
                if (!this.isCurrentContext(targetContext, loadToken)) {
                    console.log('[Iris Chat] Context changed before switching to first session, aborting load');
                    return;
                }

                // Switch to the first (most recent) session
                this._contextStore.switchToFirstSession();

                // Load messages for the first session
                if (!this.isCurrentContext(targetContext, loadToken)) {
                    console.log('[Iris Chat] Context changed before loading messages, aborting load');
                    return;
                }

                await this._onSessionLoaded();
            } else {
                // No sessions exist, create a new one
                console.log('[Iris Chat] No sessions found, creating a new one');
                if (!this.isCurrentContext(targetContext, loadToken)) {
                    console.log('[Iris Chat] Context changed before creating new session, aborting load');
                    return;
                }
                this._contextStore.createSession();
                this._onCreateNewSession();
            }

            // Post updated snapshot to show sessions in UI
            if (!this.isCurrentContext(targetContext, loadToken)) {
                console.log('[Iris Chat] Context changed before posting snapshot, aborting load');
                return;
            }

            this._onPostSnapshot();

        } catch (error: any) {
            console.error('Error loading sessions for context:', error);
            vscode.window.showWarningMessage(`Could not load sessions: ${error.message}`);

            if (!this.isCurrentContext(targetContext, loadToken)) {
                console.log('[Iris Chat] Context changed during error handling, skipping fallback session creation');
                return;
            }

            // Fall back to creating a new session
            this._contextStore.createSession();
            this._onCreateNewSession();
            this._onPostSnapshot();
        }
    }
}
