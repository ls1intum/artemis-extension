import { ExtensionMsg } from '@shared/messageContracts';

import { MalformedResponseError } from '@extension/domain/errors';
import { resolveCourseIdFromContext } from '@extension/services/iris/context/courseIdResolver';
import type { IrisServiceDeps } from '@extension/services/iris/context/sessionSyncUtils';
import { fetchSessionsWithMessages, importSessionsToStore } from '@extension/services/iris/context/sessionSyncUtils';
import { isIrisActivity } from '@extension/services/iris/parseIrisWs';
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
    // Keyed by contextKey (`${type}:${id}`), NOT a single boolean: creating
    // in course A must not block a concurrent create in course B, and A's
    // completion must not clear B's guard. Populated before the server
    // round-trip in createNewSession() and cleared on every exit path
    // (success, failure, and the early-returns with nothing to await).
    private readonly _createInFlight = new Set<string>();
    // Keyed by local session id: a target-preserving Retry (reloadActiveSession)
    // reloads only the active session's messages. Repeated Retry clicks for the
    // same session must not start overlapping loads. The guard latches until
    // the in-flight load settles. Distinct from _createInFlight (which guards
    // server-side session creation) and from the provider's context-level
    // _reloadInFlight (which reloads the whole context).
    private readonly _reloadActiveInFlight = new Set<string>();

    constructor(
        private readonly deps: IrisServiceDeps,
        private readonly _getIrisWebSocketSessionClient: () => IrisWebSocketSessionClient | undefined,
        private readonly _runReset: { resetRuns: () => void },
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

        // Step 1: Profile probe. A 403 here is NOT a disable signal — that
        // would mean "user not allowed to read the server profile", which
        // is an infrastructure / auth issue. Profile-fetch failures
        // therefore funnel through the same `unavailable` path as any
        // other infra error.
        let profileInfo;
        try {
            profileInfo = await this.deps.artemisApiService.getProfileInfo();
        } catch (error: unknown) {
            logger.error('Profile info fetch failed for Iris check:', LogCategory.IRIS_CHAT, error);
            return { kind: 'unavailable', reason: `Profile probe failed: ${describeError(error)}` };
        }
        if (!this.deps.artemisApiService.isIrisProfileActive(profileInfo)) {
            logger.info('Iris profile not active on server (global check failed)', LogCategory.IRIS_CHAT);
            return { kind: 'disabled' };
        }

        // Step 2: Resolve courseId for an exercise context. Failures here
        // are transient (registry not populated yet, exercise-details
        // endpoint dropped) — never a disable signal.
        let courseId: number;
        if (context.type === 'course') {
            courseId = context.id;
        } else if (context.type === 'exercise') {
            let resolvedCourseId: number | undefined;
            try {
                resolvedCourseId = await this.resolveCourseIdForExercise(context);
            } catch (error: unknown) {
                logger.error('Course resolution failed for exercise context:', LogCategory.IRIS_CHAT, error);
                return { kind: 'unavailable', reason: `Could not resolve course: ${describeError(error)}` };
            }
            if (!resolvedCourseId) {
                logger.warn('Unable to resolve course for exercise context; cannot check Iris settings', LogCategory.IRIS_CHAT);
                return { kind: 'unavailable', reason: 'Could not resolve course for this exercise' };
            }
            courseId = resolvedCourseId;
        } else {
            logger.warn(`Unsupported context type for Iris: ${context.type}`, LogCategory.IRIS_CHAT);
            return { kind: 'disabled' };
        }

        // Step 3: Iris settings call — this is the ONLY endpoint where a
        // 403 has a "disabled" semantic (course-level forbidden = Iris
        // chat off for this user). All other status codes (incl. 401,
        // 4xx, 5xx) plus network/timeout/malformed map to unavailable
        // through the shared classifier.
        let settings: IrisSettingsResponse;
        try {
            settings = await this.deps.artemisApiService.getIrisCourseChatSettings(courseId);
        } catch (error: unknown) {
            logger.error('Iris settings fetch failed:', LogCategory.IRIS_CHAT, error);
            return classifyAvailabilityFromError(error);
        }

        // Distinguish "enabled is explicitly false" from "enabled field is
        // missing / non-boolean". The latter signals a malformed response,
        // which is a transport-layer issue, not an intentional disable.
        const chatSettings = settings?.settings;
        if (!chatSettings || typeof chatSettings.enabled !== 'boolean') {
            logger.warn('Iris settings response is missing or malformed', LogCategory.IRIS_CHAT, { settings });
            return { kind: 'unavailable', reason: 'Malformed Iris settings response' };
        }
        if (chatSettings.enabled === false) {
            logger.info('Iris chat is disabled in settings', LogCategory.IRIS_CHAT);
            return { kind: 'disabled' };
        }

        logger.info('Iris chat is enabled, settings loaded:', LogCategory.IRIS_CHAT, {
            enabled: chatSettings.enabled,
            rateLimit: settings?.effectiveRateLimit?.requests,
            rateLimitTimeframeHours: settings?.effectiveRateLimit?.timeframeHours
        });

        return { kind: 'enabled' };
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

                return {
                    id: msg.id,
                    role: (msg.sender === 'USER' ? 'user' : 'assistant') as 'user' | 'assistant',
                    content: content,
                    timestamp: msg.sentAt ? new Date(msg.sentAt).getTime() : Date.now(),
                    helpful: (msg as { helpful?: boolean | null }).helpful,
                    activities: Array.isArray(msg.activities) ? msg.activities.filter(isIrisActivity) : undefined,
                    final: typeof msg.final === 'boolean' ? msg.final : undefined
                };
            });

            // Correct the active session's messageCount to the number of
            // messages actually loaded. This matters for sessions created via
            // upsertSessionFromOverview (the atomic open flow): the overview
            // endpoint carries no counts, so they are seeded with
            // messageCount: 0 and would otherwise look empty (and be eligible
            // for cleanupEmptySessions) until the next full reload. Gated on
            // the start session so a stale continuation (user switched mid
            // load) does not overwrite a different session's count. This lives
            // here (not in the provider) because switchToSession returns
            // void and this method owns formattedMessages.
            if (isStillStartSession()) {
                this.deps.contextStore.setActiveSessionMessageCount(formattedMessages.length);
                this.deps.postSnapshot();
            }

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

        // Creation-in-flight guard: a rapid double-click (or a race between
        // the header's + button and the ConversationHistory popover's own
        // "New conversation" action) must not spawn two server-side sessions
        // for the same context. Keyed by contextKey, not a single boolean,
        // so an in-flight create in course A never blocks a concurrent one
        // in course B. Computed once, up front (nothing below changes the
        // active context type/id), and every exit path releases this same
        // key: the finally() on the happy/error path, and the two explicit
        // releases below for the early-return branches.
        const activeContext = this.deps.contextStore.getActiveContext();
        const guardKey = contextKeyOf(activeContext);
        if (guardKey && this._createInFlight.has(guardKey)) {
            logger.info(`createNewSession already in flight for ${guardKey}, ignoring duplicate call`, LogCategory.IRIS_CHAT);
            return;
        }
        if (guardKey) {
            this._createInFlight.add(guardKey);
        }

        // Drop host run state before the Iris session is reset, or the old
        // run's projection survives into the new conversation.
        this._runReset.resetRuns();

        const irisSessionManager = this._getIrisWebSocketSessionClient();
        if (irisSessionManager) {
            irisSessionManager.resetSession();
        }

        this.deps.contextStore.createSession();
        this.deps.postSnapshot();

        this.deps.postMessage({ type: ExtensionMsg.ClearChatMessages });

        // The local session UUID exists immediately (created above); we
        // capture it now so the LoadMessages / LoadMessagesError emitted
        // below carries the right key even after async operations.
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

            // Advance the navigation generation (accepted op: the in-flight
            // guard above already rejected duplicates without a bump, so a
            // rejected duplicate never invalidates this legitimate create).
            // Both continuations below re-check this token in addition to the
            // session-level isStillNewSession guard, so a newer navigation
            // (a switch, an open, another create) invalidates this create.
            const loadToken = this.incrementLoadToken();
            const isStillCurrentNav = (): boolean =>
                this._contextLoadToken === loadToken && isStillNewSession();

            irisSessionManager.createNewSession(activeContext)
                .then(sessionId => {
                    if (!isStillCurrentNav()) {
                        logger.info(
                            `Discarding new-session response for ${newLocalSessionId}: superseded by a newer navigation or session switch`,
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
                    if (!isStillCurrentNav()) {
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
                })
                .finally(() => {
                    if (guardKey) {
                        this._createInFlight.delete(guardKey);
                    }
                });
        } else if (guardKey) {
            // No websocket client / no active context / no local session:
            // there is nothing async to wait on, so release the guard
            // immediately instead of leaving it stuck until the process
            // that would have cleared it (there isn't one).
            this._createInFlight.delete(guardKey);
        }
    }

    public switchToSession(sessionId: string): void {
        logger.info('Switching to session:', LogCategory.IRIS_CHAT, sessionId);

        void this._switchAndLoad(sessionId).catch(err => {
            logger.error('Error loading messages for switched session:', LogCategory.IRIS_CHAT, err);
        });
    }

    /**
     * Target-preserving Retry: reload ONLY the active session's messages,
     * NOT the whole context (that is the provider's `_reloadChatSession` /
     * `loadAllSessionsForContext`). Single-flight, keyed by the active local
     * session id, so a button-mash cannot start overlapping loads. Reuses the
     * `switchToSession` load path (which advances the navigation token), so a
     * stale cross-context open in flight is invalidated by this reload.
     */
    public reloadActiveSessionMessages(): void {
        const activeLocalId = this.deps.contextStore.snapshot().activeSession?.id;
        if (!activeLocalId) {
            logger.info('reloadActiveSessionMessages: no active session, nothing to reload', LogCategory.IRIS_CHAT);
            return;
        }
        if (this._reloadActiveInFlight.has(activeLocalId)) {
            logger.info(`reloadActiveSessionMessages already in flight for ${activeLocalId}, ignoring duplicate`, LogCategory.IRIS_CHAT);
            return;
        }
        this._reloadActiveInFlight.add(activeLocalId);
        void this._switchAndLoad(activeLocalId)
            .catch(err => {
                logger.error('Error reloading active session messages:', LogCategory.IRIS_CHAT, err);
            })
            .finally(() => {
                this._reloadActiveInFlight.delete(activeLocalId);
            });
    }

    /**
     * Shared session-nav body for `switchToSession` and
     * `reloadActiveSessionMessages`: reset runs + WS, select the session, clear
     * the UI, advance the navigation generation, then load its messages.
     * Advancing `_contextLoadToken` here is what makes this switch the
     * authoritative navigation: any in-flight loader (including a stale
     * cross-context open) fails its `t === contextLoadToken` re-check and
     * returns without mutating or emitting an error. Returns the load promise
     * so the single-flight Retry guard can release only once it settles.
     */
    private _switchAndLoad(sessionId: string): Promise<void> {
        // Drop host run state before the Iris session is reset, or the old
        // run's projection survives into the switched-to conversation.
        this._runReset.resetRuns();

        const irisSessionManager = this._getIrisWebSocketSessionClient();
        if (irisSessionManager) {
            irisSessionManager.resetSession();
        }

        this.deps.contextStore.switchSession(sessionId);
        this.deps.postSnapshot();

        this.deps.postMessage({ type: ExtensionMsg.ClearChatMessages });

        // Advance the navigation generation before loading (accepted op).
        this.incrementLoadToken();

        return this._loadIrisMessages();
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

        // Drop host run state before the Iris session is reset, or the old
        // run's projection survives the Reset & Sync.
        this._runReset.resetRuns();

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
