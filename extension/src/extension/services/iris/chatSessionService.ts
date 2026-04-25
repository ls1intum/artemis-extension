import { ActiveContext, ApiError, type IrisChatMessage, type IrisSettingsResponse } from '../../types';
import type { IrisWebSocketSessionClient } from './irisWebSocketSessionClient';
import { extractIrisMessageContent } from './messageUtils';
import { logger, LogCategory } from '../loggingService';
import { ExtensionMsg } from '../../../shared/messageContracts';
import { fetchSessionsWithMessages, importSessionsToStore } from './sessionSyncUtils';
import type { IrisServiceDeps } from './sessionSyncUtils';

/**
 * Orchestrates Iris chat session lifecycle (create, load, switch).
 *
 * Session ID ownership model:
 *   ContextStore.StoredSession.artemisSessionId  → persistence layer (session metadata)
 *   IrisWebSocketSessionClient._currentArtemisSessionId → transport layer (live WS subscription)
 *   IrisChatSessionService (this class) → lifecycle coordinator (synchronizes both)
 */
export class IrisChatSessionService {
    private _contextLoadToken = 0;

    constructor(
        private readonly deps: IrisServiceDeps,
        private readonly _getIrisWebSocketSessionClient: () => IrisWebSocketSessionClient | undefined,
    ) { }

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
        const current = this.deps.contextStore.getActiveContext();
        return !!current && current.type === expected.type && current.id === expected.id;
    }

    public async checkAndLoadIrisSettings(context: ActiveContext): Promise<boolean> {
        if (!this.deps.artemisApiService) {
            logger.warn('Artemis API service not available', LogCategory.IRIS_CHAT);
            return false;
        }

        try {
            logger.info(`Checking Iris settings for ${context.type}: ${context.title}`, LogCategory.IRIS_CHAT);

            // Step 1: Check if Iris is globally enabled (server profile)
            const profileInfo = await this.deps.artemisApiService.getProfileInfo();
            if (!this.deps.artemisApiService.isIrisProfileActive(profileInfo)) {
                logger.info('Iris profile not active on server (global check failed)', LogCategory.IRIS_CHAT);
                return false;
            }

            // Step 2: Fetch course-level settings based on context type
            let settings: IrisSettingsResponse;
            if (context.type === 'course') {
                settings = await this.deps.artemisApiService.getIrisCourseChatSettings(context.id);
            } else if (context.type === 'exercise') {
                const courseId = await this.resolveCourseIdForExercise(context);
                if (!courseId) {
                    logger.warn('Unable to resolve course for exercise context; cannot check Iris settings', LogCategory.IRIS_CHAT);
                    return false;
                }
                settings = await this.deps.artemisApiService.getIrisCourseChatSettings(courseId);
            } else {
                logger.warn(`Unsupported context type for Iris: ${context.type}`, LogCategory.IRIS_CHAT);
                return false;
            }

            // Check if Iris chat is enabled
            const chatSettings = settings?.settings;

            if (!chatSettings?.enabled) {
                logger.info('Iris chat is disabled in settings', LogCategory.IRIS_CHAT);
                return false;
            }

            logger.info('Iris chat is enabled, settings loaded:', LogCategory.IRIS_CHAT, {
                enabled: chatSettings.enabled,
                rateLimit: settings?.effectiveRateLimit?.requests,
                rateLimitTimeframeHours: settings?.effectiveRateLimit?.timeframeHours
            });

            return true;
        } catch (error: unknown) {
            logger.error('Error checking Iris settings:', LogCategory.IRIS_CHAT, error);

            // If it's a 403, Iris is probably disabled - return false to show disabled overlay
            if ((error instanceof ApiError && error.status === 403) || (error instanceof Error && error.message?.includes('403'))) {
                logger.info('Iris is not available (403 error)', LogCategory.IRIS_CHAT);
                return false;
            }

            // For other errors, log but still return false to show disabled state
            logger.info(`Could not load Iris settings: ${error instanceof Error ? error.message : String(error)}`, LogCategory.IRIS_CHAT);
            return false;
        }
    }

    private async resolveCourseIdForExercise(context: ActiveContext): Promise<number | undefined> {
        if (context.courseId) {
            return context.courseId;
        }

        const tracked = this.deps.contextStore.getExerciseById(context.id);
        if (tracked?.courseId) {
            return tracked.courseId;
        }

        try {
            const exerciseDetails = await this.deps.artemisApiService?.getExerciseDetails(context.id);
            const resolvedCourseId = exerciseDetails?.exercise?.course?.id;
            if (resolvedCourseId) {
                this.deps.contextStore.registerExercise({
                    id: context.id,
                    title: context.title,
                    shortName: context.shortName,
                    courseId: resolvedCourseId,
                });
            }
            return resolvedCourseId;
        } catch (error) {
            logger.warn('Failed to resolve course from exercise details:', LogCategory.IRIS_CHAT, error);
            return undefined;
        }
    }

    // ── System-driven: load sessions on context switch ─────────────────

    public async loadAllSessionsForContext(): Promise<void> {
        const activeContext = this.deps.contextStore.getActiveContext();

        logger.info('Starting loadAllSessionsForContext', LogCategory.SESSION);
        logger.info('Active context:', LogCategory.SESSION, activeContext);

        if (!activeContext || !this.deps.artemisApiService) {
            logger.info('Cannot load sessions: missing context or API service', LogCategory.SESSION, {
                hasContext: !!activeContext,
                hasApiService: !!this.deps.artemisApiService
            });
            return;
        }

        const targetContext: ActiveContext = { ...activeContext };
        const loadToken = this.incrementLoadToken();

        logger.info('Target context for loading:', LogCategory.SESSION, targetContext);
        logger.info('Load token:', LogCategory.SESSION, loadToken);

        try {
            logger.info(`Loading all Iris sessions for ${activeContext.type}: ${activeContext.title} (ID: ${activeContext.id})`, LogCategory.SESSION);

            // Step 0: Check if Iris is enabled for this context
            const isEnabled = await this.checkAndLoadIrisSettings(activeContext);

            if (!this.isCurrentContext(targetContext, loadToken)) {
                logger.info('Context changed while checking Iris settings, aborting load', LogCategory.IRIS_CHAT);
                return;
            }

            if (!isEnabled) {
                logger.info('Iris is disabled, not loading sessions', LogCategory.IRIS_CHAT);
                // Clear any existing sessions and show disabled overlay
                this.deps.postMessage({
                    type: ExtensionMsg.ClearChatMessages
                });
                const contextLabel = activeContext.type === 'course' ? 'course' : 'exercise';
                this.deps.postMessage({
                    type: ExtensionMsg.ShowDisabledState,
                    message: `Iris chat is not enabled for this ${contextLabel}. Please contact your instructor.`
                });
                return;
            }

            // Hide disabled overlay if it was previously shown
            this.deps.postMessage({
                type: ExtensionMsg.HideDisabledState
            });

            const count = await this._fetchImportAndActivate(targetContext, loadToken);
            if (count === -1) { return; } // context changed

            if (count === 0) {
                // No sessions exist, create a new one
                logger.info('No sessions found, creating a new one', LogCategory.IRIS_CHAT);
                if (!this.isCurrentContext(targetContext, loadToken)) {
                    logger.info('Context changed before creating new session, aborting load', LogCategory.IRIS_CHAT);
                    return;
                }
                this.createNewSession();
            }

            // Post updated snapshot to show sessions in UI
            if (!this.isCurrentContext(targetContext, loadToken)) {
                logger.info('Context changed before posting snapshot, aborting load', LogCategory.IRIS_CHAT);
                return;
            }

            this.deps.postSnapshot();

        } catch (error: unknown) {
            logger.error('Error loading sessions for context:', LogCategory.SESSION, error);

            if (!this.isCurrentContext(targetContext, loadToken)) {
                logger.info('Context changed during error handling, skipping fallback session creation', LogCategory.IRIS_CHAT);
                return;
            }

            // Fall back to creating a new session
            this.createNewSession();
            this.deps.postSnapshot();
        }
    }

    public async initializeIrisSessionAndLoadMessages(
        context: ActiveContext,
        irisSessionManager: IrisWebSocketSessionClient,
        contextGuard?: () => boolean,
    ): Promise<void> {
        logger.info('initializeIrisSessionAndLoadMessages called', LogCategory.WEBSOCKET, {
            contextType: context.type,
            contextId: context.id,
            contextTitle: context.title
        });

        if (!this.deps.artemisApiService) {
            logger.error('No Artemis API service available', LogCategory.WEBSOCKET);
            return;
        }

        // Capture the local session id at the *start* of the load. We use
        // this — not a fresh snapshot at emit time — for both the artemis-id
        // mapping write and the LoadMessages payload, so a same-context
        // session switch during the await chain cannot mislabel response A
        // as belonging to session B.
        const startSnapshot = this.deps.contextStore.snapshot();
        const activeLocalSession = startSnapshot.activeSession;
        const startLocalSessionId = activeLocalSession?.id;

        if (!startLocalSessionId) {
            logger.warn('initializeIrisSessionAndLoadMessages called with no active local session; aborting', LogCategory.IRIS_CHAT);
            return;
        }

        const isStillStartSession = (): boolean =>
            this.deps.contextStore.snapshot().activeSession?.id === startLocalSessionId;

        try {
            logger.info(`Initializing Iris session for ${context.type}: ${context.title} (ID: ${context.id})`, LogCategory.IRIS_CHAT);

            logger.info('Active local session:', LogCategory.IRIS_CHAT, {
                id: activeLocalSession?.id,
                messageCount: activeLocalSession?.messageCount,
                artemisSessionId: activeLocalSession?.artemisSessionId,
                createdAt: activeLocalSession?.createdAt ? new Date(activeLocalSession.createdAt).toISOString() : 'unknown'
            });

            const sessionId = await irisSessionManager.initializeSession(context, activeLocalSession?.artemisSessionId);

            if (contextGuard && !contextGuard()) { return; }

            if (!activeLocalSession?.artemisSessionId && isStillStartSession()) {
                logger.info(`Storing NEW Artemis session ID mapping: ${sessionId}`, LogCategory.IRIS_CHAT);
                this.deps.contextStore.setArtemisSessionId(sessionId);
                this.deps.postSnapshot();
            }

            logger.info(`Iris session initialized with ID: ${sessionId}`, LogCategory.WEBSOCKET);

            logger.info(`Fetching messages for session: ${sessionId}`, LogCategory.IRIS_CHAT);
            const messages = await this.deps.artemisApiService.getChatMessages(sessionId);
            logger.info(`Received ${messages?.length || 0} messages from Iris`, LogCategory.IRIS_CHAT);

            if (contextGuard && !contextGuard()) { return; }

            if (activeLocalSession?.messageCount && activeLocalSession.messageCount > 0 &&
                (!messages || messages.length === 0) && isStillStartSession()) {
                logger.warn(`Warning: Expected ${activeLocalSession.messageCount} messages but got none. Stored session might be stale.`, LogCategory.IRIS_CHAT);
                logger.warn('Clearing stale Artemis session ID mapping...', LogCategory.IRIS_CHAT);

                this.deps.contextStore.setArtemisSessionId(undefined);
                this.deps.postSnapshot();
            }

            const formattedMessages = (messages ?? []).map((msg: IrisChatMessage) => {
                const content = extractIrisMessageContent(msg.content);

                return {
                    id: msg.id,
                    role: (msg.sender === 'USER' ? 'user' : 'assistant') as 'user' | 'assistant',
                    content: content,
                    timestamp: msg.sentAt ? new Date(msg.sentAt).getTime() : Date.now(),
                    helpful: (msg as { helpful?: boolean | null }).helpful
                };
            });

            // Always emit LoadMessages — even with an empty array — so the
            // webview can flip out of its loading state. We tag with the
            // local session id captured at start; if the user switched
            // sessions during the await, the webview discards this load
            // (the new session will get its own emit when its own load
            // completes).
            this.deps.postMessage({
                type: ExtensionMsg.LoadMessages,
                localSessionId: startLocalSessionId,
                artemisSessionId: sessionId,
                messages: formattedMessages,
            });
            logger.info(`Sent ${formattedMessages.length} message(s) to webview for session ${sessionId}`, LogCategory.IRIS_CHAT);
        } catch (error: unknown) {
            logger.error('Error initializing Iris session', LogCategory.IRIS_CHAT, error);
            // Emit an explicit failure signal keyed to the session that
            // *started* the load, not whatever is active now. The webview
            // will show the error UI only if that session is still active.
            this.deps.postMessage({
                type: ExtensionMsg.LoadMessagesError,
                localSessionId: startLocalSessionId,
            });
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to connect to Iris: ${errorMessage}`);
        }
    }

    // ── User-driven: create / switch / reset ──────────────────────────

    public createNewSession(): void {
        logger.info('Creating new session', LogCategory.IRIS_CHAT);

        const irisSessionManager = this._getIrisWebSocketSessionClient();
        if (irisSessionManager) {
            irisSessionManager.resetSession();
        }

        this.deps.contextStore.createSession();
        this.deps.postSnapshot();

        this.deps.postMessage({ type: ExtensionMsg.ClearChatMessages });

        // Create a brand new Iris session on the server.
        // The local session UUID exists immediately (created above); we
        // capture it now so the LoadMessages / LoadMessagesError emitted
        // below carries the right key even after async operations.
        const activeContext = this.deps.contextStore.getActiveContext();
        const newLocalSessionId = this.deps.contextStore.snapshot().activeSession?.id;
        if (activeContext && irisSessionManager && newLocalSessionId) {
            // Capture the local session UUID at start so the .then/.catch
            // handlers below operate on the session that *initiated* the
            // create, not whatever happens to be active when the server
            // responds. Guarding the artemis-id write on this id is what
            // prevents N's server id from being attached to B if the user
            // switches sessions during the round-trip.
            const isStillNewSession = (): boolean =>
                this.deps.contextStore.snapshot().activeSession?.id === newLocalSessionId;

            irisSessionManager.createNewSession(activeContext)
                .then(sessionId => {
                    if (!isStillNewSession()) {
                        logger.info(
                            `Discarding new-session response for ${newLocalSessionId}: user switched sessions during the create round-trip`,
                            LogCategory.IRIS_CHAT,
                        );
                        return;
                    }
                    this._storeArtemisSessionId(sessionId);
                    // A brand-new server session has no message history.
                    // Emit an empty LoadMessages so the webview flips out
                    // of its loading skeleton and renders the welcome
                    // state for this session.
                    this.deps.postMessage({
                        type: ExtensionMsg.LoadMessages,
                        localSessionId: newLocalSessionId,
                        artemisSessionId: sessionId,
                        messages: [],
                    });
                })
                .catch((err: unknown) => {
                    logger.error('Error creating new Iris session:', LogCategory.IRIS_CHAT, err);
                    if (isStillNewSession()) {
                        this.deps.postMessage({
                            type: ExtensionMsg.LoadMessagesError,
                            localSessionId: newLocalSessionId,
                        });
                    }
                });
        }
    }

    public switchToSession(sessionId: string): void {
        logger.info('Switching to session:', LogCategory.IRIS_CHAT, sessionId);

        const irisSessionManager = this._getIrisWebSocketSessionClient();
        if (irisSessionManager) {
            irisSessionManager.resetSession();
        }

        this.deps.contextStore.switchSession(sessionId);
        this.deps.postSnapshot();

        this.deps.postMessage({ type: ExtensionMsg.ClearChatMessages });

        // Load messages for the switched session
        this._loadIrisMessages().catch(err => {
            logger.error('Error loading messages for switched session:', LogCategory.IRIS_CHAT, err);
        });
    }

    public async resetAndReloadSessions(): Promise<number> {
        this._clearAllSessions();

        // If there's an active context, reload all sessions from Artemis
        const activeContext = this.deps.contextStore.getActiveContext();
        if (!activeContext || !this.deps.artemisApiService) {
            return 0;
        }

        const targetContext: ActiveContext = { ...activeContext };
        const loadToken = this.incrementLoadToken();

        logger.info('Fetching all Iris sessions from Artemis for context:', LogCategory.IRIS_CHAT, activeContext.title);

        const count = await this._fetchImportAndActivate(targetContext, loadToken);
        if (count === -1) { return 0; } // context changed

        // Mirror loadAllSessionsForContext's no-server-sessions fallback: a
        // context with zero imported sessions and no replacement leaves the
        // webview in "context set + activeSessionId === null" — which the
        // hydration predicate treats as still loading. Create a fresh local
        // session so the user lands in a usable empty conversation.
        if (count === 0 && this.isCurrentContext(targetContext, loadToken)) {
            this.createNewSession();
        }

        this.deps.postSnapshot();
        return count;
    }

    // ── Private helpers ───────────────────────────────────────────────

    /**
     * Shared fetch→import→activate flow used by both loadAllSessionsForContext
     * and handleResetSessions. Returns the number of imported sessions, or -1
     * if the context changed during the operation.
     */
    private async _fetchImportAndActivate(
        targetContext: ActiveContext,
        loadToken: number,
    ): Promise<number> {
        const sessions = await fetchSessionsWithMessages(this.deps.artemisApiService!, targetContext);

        logger.info(`Fetched ${sessions.length} session(s) with messages from Artemis`, LogCategory.IRIS_CHAT);

        if (!this.isCurrentContext(targetContext, loadToken)) {
            logger.info('Context changed before clearing sessions, aborting load', LogCategory.IRIS_CHAT);
            return -1;
        }

        const contextKey = `${targetContext.type}:${targetContext.id}`;
        logger.info(`Clearing all existing sessions for context ${contextKey} before loading fresh data from Artemis`, LogCategory.IRIS_CHAT);
        this.deps.contextStore.clearSessionsForContext(contextKey);

        this.deps.postMessage({ type: ExtensionMsg.ClearChatMessages });

        const count = importSessionsToStore(sessions, this.deps.contextStore);
        if (count > 0) {
            logger.info(`Imported ${count} sessions for ${targetContext.type} ${targetContext.id}`, LogCategory.IRIS_CHAT);
        }

        if (count > 0) {
            if (!this.isCurrentContext(targetContext, loadToken)) {
                logger.info('Context changed before switching to first session, aborting load', LogCategory.IRIS_CHAT);
                return -1;
            }

            this.deps.contextStore.switchToFirstSession();

            // Push the freshly-imported session UUIDs to the webview BEFORE
            // emitting LoadMessages. Without this, the LoadMessages emit
            // (tagged with the new local UUID) reaches the webview while it
            // still has activeSessionId === null, and the localSessionId
            // guard in IrisChatView discards the payload — leaving the chat
            // stuck on the loading skeleton until the user manually picks a
            // session. The trailing postSnapshot in loadAllSessionsForContext
            // is too late for that race.
            this.deps.postSnapshot();

            if (!this.isCurrentContext(targetContext, loadToken)) {
                logger.info('Context changed before loading messages, aborting load', LogCategory.IRIS_CHAT);
                return -1;
            }

            await this._loadIrisMessages();
        }

        return count;
    }

    private async _loadIrisMessages(): Promise<void> {
        const activeContext = this.deps.contextStore.getActiveContext();
        const irisSessionManager = this._getIrisWebSocketSessionClient();
        if (!activeContext || !this.deps.artemisApiService || !irisSessionManager) {
            return;
        }

        const loadToken = this._contextLoadToken;

        try {
            await this.initializeIrisSessionAndLoadMessages(
                activeContext,
                irisSessionManager,
                () => this.isCurrentContext(activeContext, loadToken),
            );
        } catch (error: unknown) {
            if (this._contextLoadToken !== loadToken) {
                logger.info('Context changed during message load, discarding error', LogCategory.IRIS_CHAT);
                return;
            }
            logger.error('Failed to load Iris messages', LogCategory.IRIS_CHAT, error);
        }
    }

    private _storeArtemisSessionId(artemisSessionId: number): void {
        this.deps.contextStore.setArtemisSessionId(artemisSessionId);
        this.deps.postSnapshot();
    }

    private _clearAllSessions(): void {
        logger.info('Clearing all local sessions', LogCategory.IRIS_CHAT);

        const irisSessionManager = this._getIrisWebSocketSessionClient();
        if (irisSessionManager) {
            irisSessionManager.resetSession();
        }

        this.deps.contextStore.clearAllSessions();
        this.deps.postSnapshot();
        this.deps.postMessage({ type: ExtensionMsg.ClearChatMessages });
    }
}
