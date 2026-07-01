import { ExtensionMsg } from '@shared/messageContracts';

import type { ArtemisApiService } from '@extension/api';
import { MalformedResponseError } from '@extension/domain/errors';
import { resolveCourseIdFromContext } from '@extension/services/iris/context/courseIdResolver';
import type { IrisServiceDeps } from '@extension/services/iris/context/sessionSyncUtils';
import { fetchSessionsWithMessages, importSessionsToStore } from '@extension/services/iris/context/sessionSyncUtils';
import type { IrisWebSocketSessionClient } from '@extension/services/iris/transport/irisWebSocketSessionClient';
import { LogCategory, logger } from '@extension/services/loggingService';
import { ActiveContext, ApiError, type IrisChatMessage, type IrisSettingsResponse } from '@extension/types';

import { extractIrisMessageContent } from './messageUtils';

/**
 * Three-way availability classification for the Iris chat. The distinction
 * matters in the UI: `disabled` shows the persistent "instructor disabled
 * Iris" overlay, while `unavailable` shows a transient "temporarily
 * unavailable, retry" banner. Conflating the two misleads students into
 * thinking their course turned Iris off whenever the network blips.
 */
export type IrisAvailability =
    | { kind: 'enabled' }
    | { kind: 'disabled' }
    | { kind: 'unavailable'; reason: string };

/**
 * Tracked availability state with the context the classification belongs to.
 * Auto-retry-on-reconnect uses this to only fire if the user is still looking
 * at the same context (e.g. exercise 42) that originally classified as
 * unavailable — a stale classification for a previous context must not
 * trigger a reload of the current one.
 */
export type LastAvailability =
    | { kind: 'unknown'; contextKey?: undefined }
    | { kind: IrisAvailability['kind']; contextKey: string };

const UNAVAILABLE_USER_MESSAGE = 'Iris is temporarily unavailable. Retry to reload.';

function contextKeyOf(context: ActiveContext | null): string | undefined {
    return context ? `${context.type}:${context.id}` : undefined;
}

function describeError(error: unknown): string {
    if (error instanceof Error) {
        return error.message || error.name;
    }
    return String(error);
}

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
    private _lastAvailability: LastAvailability = { kind: 'unknown' };

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

    /**
     * Most recent availability classification, paired with the context it
     * belongs to. Consumed by the reconnect hook in
     * {@link ChatWebviewProvider} to decide whether to fire an auto-retry.
     */
    public get lastAvailability(): LastAvailability {
        return this._lastAvailability;
    }

    /**
     * Clear the tracked availability state. Called on context changes so a
     * stale `unavailable` from a previous exercise cannot trigger a reload
     * of the new one. Does not emit any UI messages — the caller is
     * responsible for hiding banners for the outgoing context.
     */
    public resetAvailability(): void {
        this._lastAvailability = { kind: 'unknown' };
    }

    /**
     * Public wrapper around the centralized availability emission. Used by
     * paths outside the chat-session loader that still need to surface an
     * availability state — e.g. {@link ChatMessageService.sendMessage} when
     * it gets an `unavailable` from `checkAndLoadIrisSettings`. Funneling
     * through here ensures `lastAvailability` is updated so the websocket
     * reconnect hook can auto-retry the reload afterwards.
     */
    public postAvailability(availability: IrisAvailability, context: ActiveContext | null): void {
        this._postAvailability(availability, context);
    }

    public async checkAndLoadIrisSettings(context: ActiveContext): Promise<IrisAvailability> {
        if (!this.deps.artemisApiService) {
            logger.warn('Artemis API service not available', LogCategory.IRIS_CHAT);
            return { kind: 'unavailable', reason: 'Artemis API service not initialized' };
        }

        logger.info(`Checking Iris settings for ${context.type}: ${context.title}`, LogCategory.IRIS_CHAT);

        // Unsupported context types are a hard "disabled" before any network call. NOTE (slice 5c): this
        // front guard is a deliberate, kind-preserving simplification of the original (which probed the
        // profile first). The ONLY divergence is the practically-unreachable {unsupported context type +
        // getProfileInfo throws} case, which used to surface `unavailable` and is now `disabled`; contexts
        // are only 'course'/'exercise' in practice, and only `availability.kind` is a caller contract (the
        // chat surfaces a fixed UNAVAILABLE_USER_MESSAGE, never `availability.reason`).
        if (context.type !== 'course' && context.type !== 'exercise') {
            logger.warn(`Unsupported context type for Iris: ${context.type}`, LogCategory.IRIS_CHAT);
            return { kind: 'disabled' };
        }

        // Delegate to the shared §14 classifier so the manual chat and the AskIris proactive card
        // (slice 5c) agree on one classification. The context-type → course-id resolution stays here.
        const resolveCourseId = async (): Promise<number | undefined> =>
            context.type === 'course' ? context.id : this.resolveCourseIdForExercise(context);

        const { availability } = await classifyIrisCourseAvailability(this.deps.artemisApiService, resolveCourseId);
        if (availability.kind === 'enabled') {
            logger.info('Iris chat is enabled, settings loaded', LogCategory.IRIS_CHAT);
        } else if (availability.kind === 'disabled') {
            logger.info('Iris chat is disabled (profile/settings)', LogCategory.IRIS_CHAT);
        } else {
            logger.error(`Iris availability check failed: ${availability.reason}`, LogCategory.IRIS_CHAT);
        }
        return availability;
    }

    /**
     * Single emission point for availability state. Every availability
     * transition flows through here, which keeps the "always clear the
     * opposite banner" invariant in one place and lets us record
     * `lastAvailability` alongside the UI signal. Callers that bypass this
     * helper will silently break banner consistency, so all other availability
     * emission must be funneled through {@link postAvailability} (the public
     * wrapper exposed for the send-path) or this private method directly.
     */
    private _postAvailability(availability: IrisAvailability, context: ActiveContext | null): void {
        const key = contextKeyOf(context);
        this._lastAvailability = key
            ? { kind: availability.kind, contextKey: key }
            : { kind: 'unknown' };

        switch (availability.kind) {
            case 'enabled':
                this.deps.postMessage({ type: ExtensionMsg.HideDisabledState });
                this.deps.postMessage({ type: ExtensionMsg.HideUnavailableState });
                break;
            case 'disabled': {
                const label = context?.type === 'course' ? 'course' : 'exercise';
                this.deps.postMessage({
                    type: ExtensionMsg.ShowDisabledState,
                    message: `Iris chat is not enabled for this ${label}. Please contact your instructor.`,
                });
                this.deps.postMessage({ type: ExtensionMsg.HideUnavailableState });
                break;
            }
            case 'unavailable':
                this.deps.postMessage({
                    type: ExtensionMsg.ShowUnavailableState,
                    message: UNAVAILABLE_USER_MESSAGE,
                });
                this.deps.postMessage({ type: ExtensionMsg.HideDisabledState });
                break;
        }
    }

    private async resolveCourseIdForExercise(context: ActiveContext): Promise<number | undefined> {
        return resolveCourseIdFromContext(context, this.deps.contextStore, this.deps.artemisApiService);
    }

    // ── System-driven: load sessions on context switch ─────────────────

    public async loadAllSessionsForContext(): Promise<void> {
        const activeContext = this.deps.contextStore.getActiveContext();

        logger.info('Starting loadAllSessionsForContext', LogCategory.SESSION);
        logger.info('Active context:', LogCategory.SESSION, activeContext);

        if (!activeContext) {
            logger.info('Cannot load sessions: missing context', LogCategory.SESSION);
            return;
        }
        if (!this.deps.artemisApiService) {
            logger.warn('Cannot load sessions: API service not initialized', LogCategory.SESSION);
            this._postAvailability(
                { kind: 'unavailable', reason: 'Artemis API service not initialized' },
                activeContext,
            );
            return;
        }

        const targetContext: ActiveContext = { ...activeContext };
        const loadToken = this.incrementLoadToken();

        logger.info('Target context for loading:', LogCategory.SESSION, targetContext);
        logger.info('Load token:', LogCategory.SESSION, loadToken);

        try {
            logger.info(`Loading all Iris sessions for ${activeContext.type}: ${activeContext.title} (ID: ${activeContext.id})`, LogCategory.SESSION);

            // Step 0: Check if Iris is enabled for this context
            const availability = await this.checkAndLoadIrisSettings(activeContext);

            if (!this.isCurrentContext(targetContext, loadToken)) {
                logger.info('Context changed while checking Iris settings, aborting load', LogCategory.IRIS_CHAT);
                return;
            }

            if (availability.kind !== 'enabled') {
                logger.info(`Iris is ${availability.kind}, not loading sessions`, LogCategory.IRIS_CHAT);
                // Clear any stale messages, then announce availability. The
                // banner is the terminal state for both disabled and
                // unavailable; the view stops the loader on either flag.
                // We intentionally do NOT post LoadMessagesError here:
                // availability failures are not history-load failures, and
                // emitting it would surface the misleading central error UI
                // in addition to the banner.
                this.deps.postMessage({ type: ExtensionMsg.ClearChatMessages });
                this._postAvailability(availability, activeContext);
                return;
            }

            // Enabled: clear any prior availability banners.
            this._postAvailability(availability, activeContext);

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
                logger.info('Context changed during error handling, skipping availability emit', LogCategory.IRIS_CHAT);
                return;
            }

            // Any caught error here means the server-side load failed (or the
            // settings/session listing call threw). Classify and surface as
            // unavailable. The previous behavior — falling back to
            // createNewSession() — silently masked transient server errors as
            // "no sessions on server", which then made every reload create
            // additional orphan local sessions. The right recovery is the
            // Retry button (manual or websocket-reconnect-driven).
            this._postAvailability(classifyAvailabilityFromError(error), targetContext);
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

                const proactiveOutcome = msg.proactiveOutcome === 'DISMISSED' || msg.proactiveOutcome === 'RECOVERED' || msg.proactiveOutcome === 'ABANDONED'
                    ? msg.proactiveOutcome
                    : undefined;

                // Route B: re-attach the extension-local stale-check kind/answer so a reloaded episode
                // keeps its differentiated check-in node (a proactive row absent from the store is a hint).
                const isProactive = msg.origin === 'PROACTIVE_STRUGGLE';
                const staleRec = isProactive && typeof msg.id === 'number'
                    ? this.deps.staleCheckLookup?.(msg.id)
                    : undefined;

                return {
                    id: msg.id,
                    role: (msg.sender === 'USER' ? 'user' : 'assistant') as 'user' | 'assistant',
                    content: content,
                    timestamp: msg.sentAt ? new Date(msg.sentAt).getTime() : Date.now(),
                    helpful: (msg as { helpful?: boolean | null }).helpful,
                    origin: (isProactive ? 'proactive' : undefined) as 'proactive' | undefined,
                    proactiveOutcome,
                    proactiveEpisodeId: typeof msg.proactiveEpisodeId === 'string' ? msg.proactiveEpisodeId : undefined,
                    proactiveKind: staleRec ? ('stale-check' as const) : undefined,
                    staleAnswer: staleRec?.answer,
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
                    if (!isStillNewSession()) {
                        return;
                    }
                    // Reuse the same availability classifier as
                    // loadAllSessionsForContext so a network drop during the
                    // server round-trip surfaces the unavailable banner
                    // instead of leaving the spinner up indefinitely. The
                    // LoadMessagesError signal is kept for true "history
                    // failed to load" cases — but the classifier-driven
                    // availability state is the primary outcome here, so the
                    // view's loader stops via the banner.
                    const availability = classifyAvailabilityFromError(err);
                    this._postAvailability(availability, activeContext);
                    this.deps.postMessage({
                        type: ExtensionMsg.LoadMessagesError,
                        localSessionId: newLocalSessionId,
                    });
                });
        }
    }

    public switchToSession(sessionId: string): void {
        // Fire-and-forget for the user-driven sidebar switch: the caller does
        // not await, so swallow load errors here (they are already surfaced to
        // the webview by the load path itself).
        this._switchToSessionAndLoad(sessionId).catch(err => {
            logger.error('Error loading messages for switched session:', LogCategory.IRIS_CHAT, err);
        });
    }

    /**
     * Set `sessionId` active and load its messages, returning the load promise.
     * Shared by {@link switchToSession} (fire-and-forget) and
     * {@link openProactiveSession} (which awaits, so its `Promise<void>` only
     * resolves once the messages have been posted to the webview).
     */
    private async _switchToSessionAndLoad(sessionId: string): Promise<void> {
        logger.info('Switching to session:', LogCategory.IRIS_CHAT, sessionId);

        const irisSessionManager = this._getIrisWebSocketSessionClient();
        if (irisSessionManager) {
            irisSessionManager.resetSession();
        }

        this.deps.contextStore.switchSession(sessionId);
        this.deps.postSnapshot();

        this.deps.postMessage({ type: ExtensionMsg.ClearChatMessages });

        // Load messages for the switched session
        await this._loadIrisMessages();
    }

    /**
     * Open the Iris session carrying a proactive bubble, identified by its
     * Artemis session id (spec §5.5 `active`). The session is freshly created
     * server-side and has no USER reply yet. The sessions/overview that
     * {@link loadAllSessionsForContext} consumes now lists such proactive-only
     * sessions (spec §7.3), but that reload is async and may not have run yet,
     * so for an immediate open we inject a local entry keyed
     * `session-<artemisSessionId>` directly (unless one already exists), then
     * switch to it; the switch's own message-load fetches the session by id via
     * {@link initializeIrisSessionAndLoadMessages} and surfaces the
     * `origin: 'proactive'` bubble.
     */
    public async openProactiveSession(artemisSessionId: number): Promise<void> {
        const localId = `session-${artemisSessionId}`;

        const activeContext = this.deps.contextStore.getActiveContext();
        if (!activeContext) {
            logger.warn(
                `openProactiveSession(${artemisSessionId}) ignored: no active context to attach the session to`,
                LogCategory.IRIS_CHAT,
            );
            return;
        }

        // Existence check against the active context's session list (the
        // snapshot only ever lists sessions for the active context), so
        // repeated `active` events for the same session do not duplicate it.
        const alreadyExists = this.deps.contextStore.snapshot().sessions.some(session => session.id === localId);
        if (!alreadyExists) {
            logger.info(`Injecting local entry for proactive session ${localId}`, LogCategory.IRIS_CHAT);
            this.deps.contextStore.createSessionWithDetails('Iris suggestion', 1, Date.now(), artemisSessionId);
            this.deps.postSnapshot();
        }

        // Set the entry active (guarded on existence, which we just ensured) and
        // run the existing load path: it reuses the entry's artemisSessionId,
        // fetches that session's messages by id, and posts LoadMessages with the
        // proactive bubble mapped to origin: 'proactive'. Awaited so this method
        // only resolves once the bubble has been posted to the webview.
        await this._switchToSessionAndLoad(localId);
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

        // Match the no-server-sessions fallback in loadAllSessionsForContext:
        // without a replacement session the webview's hydration predicate
        // sits on the loader forever.
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
        const sessions = await fetchSessionsWithMessages(this.deps.artemisApiService!, this.deps.contextStore, targetContext);

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

            // Publish the imported active session before LoadMessages.
            // Otherwise the webview still has a null/stale activeSessionId
            // and the localSessionId guard drops the payload.
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

/**
 * The §14 availability classification shared by the manual chat
 * ({@link IrisChatSessionService.checkAndLoadIrisSettings}) and the AskIris proactive card
 * (slice 5c `ProactiveControlCommandModule`). Profile probe → resolve course → settings call, with
 * the exact precedence both surfaces must agree on. Returns the raw settings too, so the card can read
 * `proactiveStruggleEnabled` (§13) from the same fetch.
 *
 * Contract: only `availability.kind` is preserved/guaranteed across callers. The per-branch `reason`
 * strings are logging-only (no consumer reads them — the chat surfaces a fixed message), so they are
 * NOT a stable contract; do not assert exact `reason` text.
 */
export async function classifyIrisCourseAvailability(
    api: Pick<ArtemisApiService, 'getProfileInfo' | 'isIrisProfileActive' | 'getIrisCourseChatSettings'>,
    resolveCourseId: () => Promise<number | undefined>,
): Promise<{ availability: IrisAvailability; settings?: IrisSettingsResponse }> {
    // Step 1: profile probe (a throw = infra/auth issue = unavailable; profile inactive = disabled).
    let profileInfo;
    try {
        profileInfo = await api.getProfileInfo();
    } catch (error: unknown) {
        return { availability: { kind: 'unavailable', reason: `Profile probe failed: ${describeError(error)}` } };
    }
    if (!api.isIrisProfileActive(profileInfo)) {
        logger.info(
            `Iris availability: disabled — 'iris' not active (activeProfiles=[${(profileInfo.activeProfiles ?? []).join(',')}], `
            + `activeModuleFeatures=[${(profileInfo.activeModuleFeatures ?? []).join(',')}])`,
            LogCategory.IRIS_CHAT,
        );
        return { availability: { kind: 'disabled' } };
    }
    // Step 2: resolve the course (transient failures only — never a disable signal).
    let courseId: number | undefined;
    try {
        courseId = await resolveCourseId();
    } catch (error: unknown) {
        return { availability: { kind: 'unavailable', reason: `Could not resolve course: ${describeError(error)}` } };
    }
    if (courseId === undefined) {
        return { availability: { kind: 'unavailable', reason: 'Could not resolve course for this context' } };
    }
    // Step 3: settings call — the ONLY place a 403 means "disabled" (course-forbidden = Iris off for this user).
    let settings: IrisSettingsResponse;
    try {
        settings = await api.getIrisCourseChatSettings(courseId);
    } catch (error: unknown) {
        return { availability: classifyAvailabilityFromError(error) };
    }
    const chatSettings = settings?.settings;
    if (!chatSettings || typeof chatSettings.enabled !== 'boolean') {
        return { availability: { kind: 'unavailable', reason: 'Malformed Iris settings response' } };
    }
    if (chatSettings.enabled === false) {
        logger.info(`Iris availability: disabled — course ${courseId} iris-settings.enabled is false`, LogCategory.IRIS_CHAT);
        return { availability: { kind: 'disabled' }, settings };
    }
    return { availability: { kind: 'enabled' }, settings };
}

/**
 * Maps a raw error (from `fetch`, `ApiError`, schema validation, etc.) to an
 * {@link IrisAvailability}. Exported privately to the file so both
 * `checkAndLoadIrisSettings` and the outer `loadAllSessionsForContext` /
 * `createNewSession` catch-blocks share one classification policy.
 *
 * Rules:
 *   - `ApiError(403)`   → disabled (course-level forbidden = disabled for this user)
 *   - any other `ApiError` (401/404/4xx/5xx)         → unavailable
 *   - `MalformedResponseError` (subclass of ApiError) → unavailable
 *   - any other Error / network / `TypeError`        → unavailable
 *
 * No string-matching on `error.message.includes('403')` — the historical
 * fallback was inherited code with no good reason to keep it and could
 * misclassify unrelated errors whose message happened to contain '403'.
 */
function classifyAvailabilityFromError(error: unknown): IrisAvailability {
    if (error instanceof MalformedResponseError) {
        return { kind: 'unavailable', reason: `Malformed response: ${error.message}` };
    }
    if (error instanceof ApiError) {
        if (error.status === 403) {
            return { kind: 'disabled' };
        }
        return { kind: 'unavailable', reason: `Server returned ${error.status}` };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'unavailable', reason: message || 'Unknown error' };
}
