/**
 * Extension -> Webview message contracts.
 */

import type {
    ExerciseDetailsResponse,
    IrisActivityDTO,
    IrisRunState,
    ResultSummary,
    SubmissionSummary,
} from '@shared/types/apiResponses';

import type { ArchivedCourse, CourseDetailData, RecentCourseNode } from './domainTypes';
import type { ProactiveLevel } from './proactiveLevel';

// ---------------------------------------------------------------------------
// Shared boundary union (mirrors engine's BOUNDARY_PRIORITY order)
// ---------------------------------------------------------------------------

export const BOUNDARY_TYPES = ['FM', 'E4', 'N1', 'STATE'] as const;
export type BoundaryType = typeof BOUNDARY_TYPES[number];

// ---------------------------------------------------------------------------
// AskIris proactive-availability card state (spec §12.2 / §14)
// ---------------------------------------------------------------------------

/**
 * Which proactive-availability state the AskIris card renders (spec §12.2, one term per §14 row).
 * The clean (no-engine) build sends a chat-availability card too (`proactiveControlAvailable: false`,
 * no level control) — it is never the "no card sent" case (see `proactiveControlCommands._push`).
 */
export type ProactiveCardState = 'available' | 'off-course' | 'unavailable' | 'degraded';
/** Why a non-"available" card is in that state (drives the §14 notice / note copy). */
export type ProactiveCardReason = 'noai' | 'iris-off' | 'course-off' | 'limited' | 'consent-missing';

// ---------------------------------------------------------------------------
// Live-tick wire types (extension → struggle-detection webview)
// ---------------------------------------------------------------------------

export interface LiveDecisionTrace {
    outcome: 'fired-edit' | 'fired-discrete' | 'suppressed';
    reason: 'fired' | 'no-candidate' | 'b2-fluent-typing' | 'b4-grace-filter'
        | 'd1-warmup' | 'below-threshold' | 'cooldown' | 'not-rearmed';
    discreteTrigger: 'test-stagnation' | null;
    urgency: number;
    theta: number;
    typingRate: number | null;
    boundariesPresent: BoundaryType[];
    /** Infinity serialised as null (not JSON-safe). */
    secondsSinceLastAlert: number | null;
    inWarmup: boolean;
    graceActive: boolean;
    /** Live per-gate conditions for the developer gate view (mirrors the engine's
     *  GateConditions; each flag = that gate's blocking condition currently holds). */
    gates: {
        fluentTyping: boolean;
        grace: boolean;
        warmup: boolean;
        belowThreshold: boolean;
        cooldown: boolean;
        notRearmed: boolean;
    };
}

export interface LiveTick {
    /** Session-relative seconds. */
    t: number;
    /** S_base urgency score. */
    urgency: number;
    theta: number;
    boundariesPreGate: BoundaryType[];
    alertKind: 'edit' | 'discrete' | null;
    alertPrimary: BoundaryType | null;
    decisionTrace: LiveDecisionTrace;
}

// ---------------------------------------------------------------------------
// Struggle debug snapshot (dev timers/counters dashboard + Phase B log)
// ---------------------------------------------------------------------------

/** Raw Tier-2 delivery-throttle state (counters + absolute ms timestamps) PLUS the
 *  currently-active per-level caps (THROTTLE_BY_LEVEL, ENG) it is being enforced
 *  against. The caps live here (not in {@link StruggleDebugCaps}) because they are
 *  read live per delivery and can change mid-session on a proactive-level flip; the
 *  consumer computes every "remaining" locally against the snapshot's `nowMs`, so
 *  this stays pure state with no derived countdowns baked in. */
export interface StruggleThrottleState {
    /** Alerts DELIVERED so far this session (vs maxAlertsPerSession below). */
    deliveredThisSession: number;
    /** Absolute ms timestamps of delivered alerts this session. */
    deliveredAtMs: number[];
    /** Absolute ms of the most recent delivery, or null if none yet (the min-gap floor). */
    lastDeliveryMs: number | null;
    /** ACTIVE per-session delivery cap for the current proactive-help level. */
    maxAlertsPerSession: number;
    /** ACTIVE hard floor (seconds) between deliveries for the current level. */
    minDeliveryGapS: number;
}

/** SPEC caps echoed once so the client computes "remaining" without re-importing config.
 *  The Tier-2 delivery-throttle caps are NOT here (they are level-dependent and live on
 *  {@link StruggleThrottleState} instead, read live from the sink). */
export interface StruggleDebugCaps {
    warmupS: number;
    cooldownS: number;
    graceS: number;
    gapNormS: number;
}

/**
 * Latest-only engine STATE for the dev timers/counters dashboard and the Phase B
 * per-tick log. NOT a history series, and deliberately SEPARATE from the per-tick
 * {@link LiveTick} (never widen that). Every "remaining" value is derived by the
 * consumer from these absolute ms anchors + {@link StruggleDebugCaps}, against a
 * local 1 s clock offset-corrected by `nowMs`, so the 10 s emission cadence still
 * yields smooth per-second countdowns.
 */
export interface StruggleDebugSnapshot {
    /** Whether an exercise session is currently active. When false, all anchors below are stale
     *  (a previous session's or zero) and the dashboard must show "no active session" instead of timers. */
    sessionActive: boolean;
    /** Engine clock at snapshot-build time (ms); the client's offset reference. */
    nowMs: number;
    /** Session start (ms); the warmup anchor. */
    sessionStartMs: number;
    /** Last engine alert (ms); the cooldown anchor. null if none fired yet. */
    lastAlertMs: number | null;
    /** Last bad-build that armed the B4 grace window (ms); the grace anchor. null if none. */
    lastFmBadMs: number | null;
    /** Delivery-throttle state, or null when the sink does not expose it. */
    throttle: StruggleThrottleState | null;
    /** Effective feature window at the last tick: max(10, min(60, sessionSeconds)). */
    effectiveWindowS: number;
    /** Longest pause in the last window (s), shown against caps.gapNormS. */
    longestGapS: number;
    /** Latest tick's decision trace (outcome / reason / per-gate booleans / urgency / theta /
     *  boundaries): the SAME shape the live feed emits, reused here so the developer
     *  decision-flow pipeline renders from the init snapshot. `null` when no session is active
     *  or before the first tick (`_lastTick` persists across sessions; do not show it stale). */
    decisionTrace: LiveDecisionTrace | null;
    /** Test-stagnation add-on state (discrete path): current no-progress streak vs N. `null`
     *  when no session is active (the tracker is only recreated on start, so an unconditional
     *  read would leak the previous session's streak). */
    testStagnation: { enabled: boolean; streak: number; n: number } | null;
    caps: StruggleDebugCaps;
}

/**
 * In-flight request state for a slot (decision or confirm-close).
 */
export interface SlotInFlightDebug {
    intent: 'decide' | 'confirm_close' | 'help_request';
    localToken: number;
    episodeId: string;
    generation: number;
    requestToken: string;
}

/**
 * Snapshot of a slot's current state (assignment, deliverables, inflight requests).
 */
export interface SlotDebugSnapshot {
    nowMs: number;
    state: 'free' | 'parked' | 'delivered';
    level: 'ambient' | 'active' | null;
    episodeId: string | null;
    generation: number;
    episodeAgeMs: number | null;
    hintCount: number;
    isNew: boolean;
    inSession: boolean;
    watchdog: { armed: boolean; staleDeadlineMs: number | null };
    inFlight: SlotInFlightDebug | null;
    owed: { confirmClose: boolean };
    pendingOutcomes: number;
    /** Idle-abandon evidence gate: true = no new decide POSTs until fresh student activity. */
    awaitingEvidence: boolean;
    /** The "why is it silent" state: session latches and the student toggle. */
    suppression: {
        /** false -> POSTs stopped, local fallback templates on the lamp. */
        serverAvailable: boolean;
        /** Session latch: course-level proactive disabled (404/course-off reply). */
        courseProactiveOff: boolean;
        /** Durable single remembered student toggle (issue #341), independent of the active exercise. */
        studentProactiveOn: boolean;
    };
}

/**
 * Label describing how an episode completed.
 */
export type EpisodeOutcomeLabel = 'DISMISSED' | 'RECOVERED' | 'ABANDONED' | 'DISCARDED' | 'INTERRUPTED';

/**
 * History entry for a completed episode within a session.
 */
export interface EpisodeHistoryEntry {
    episodeId: string;
    peakLevel: 'ambient' | 'active';
    outcome: EpisodeOutcomeLabel;
    hintCount: number;
    durationMs: number;
    startedAtMs: number;
}

/**
 * Display-facing projection of the websocket connection state. Both the chat
 * webview and the status bar render off this. The webview store also has an
 * additional 'unknown' state for its first render, before any extension push
 * has arrived; the extension itself never emits 'unknown'.
 */
export type WebSocketDisplayStatus =
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'disconnected';

/** All Extension->Webview message types (const object for string-literal compatibility) */
export const ExtensionMsg = {
    // View initialization
    DashboardInit: 'dashboardInit',
    CourseListInit: 'courseListInit',
    CourseDetailInit: 'courseDetailInit',
    ExerciseDetailInit: 'exerciseDetailInit',
    ServiceStatusInit: 'serviceStatusInit',
    RecommendedExtensionsInit: 'recommendedExtensionsInit',
    AiConfigInit: 'aiConfigInit',
    StruggleDetectionInit: 'struggleDetectionInit',
    StruggleLiveBackfill: 'struggleLiveBackfill',
    StruggleLiveTick: 'struggleLiveTick',
    StruggleLiveReset: 'struggleLiveReset',
    StruggleLiveSessionState: 'struggleLiveSessionState',
    StruggleSlotUpdate: 'struggleSlotUpdate',
    ViewInitError: 'viewInitError',

    // Auth
    LoginSuccess: 'loginSuccess',
    LoginError: 'loginError',
    SetServerUrl: 'setServerUrl',

    // Loading
    ShowLoading: 'showLoading',
    HideLoading: 'hideLoading',
    UpdateLoading: 'updateLoading',

    // Dashboard/Course
    ArchivedCoursesLoaded: 'archivedCoursesLoaded',

    // WebSocket
    WebsocketUpdate: 'websocketUpdate',

    // Iris Chat
    UpdateIrisState: 'updateIrisState',
    AddMessage: 'addMessage',
    LoadMessages: 'loadMessages',
    OpenSessionError: 'openSessionError',
    UpdateReferencedFiles: 'updateReferencedFiles',
    UpdateWebSocketStatus: 'updateWebSocketStatus',
    ShowDisabledState: 'showDisabledState',
    HideDisabledState: 'hideDisabledState',
    ShowUnavailableState: 'showUnavailableState',
    HideUnavailableState: 'hideUnavailableState',
    UpdateNoAiStatus: 'updateNoAiStatus',
    UpdateProactiveControl: 'updateProactiveControl',
    UpdateProactiveConsent: 'updateProactiveConsent',
    UpdateIrisRunUi: 'updateIrisRunUi',
    SendRejected: 'sendRejected',
    FoldEpisode: 'foldEpisode',
    SetLiveEpisode: 'setLiveEpisode',
    RemoveMessage: 'removeMessage',
    ResolveOffer: 'resolveOffer',
    CollapseProactiveEpisodes: 'collapseProactiveEpisodes',
    MergeSessionMessages: 'mergeSessionMessages',
    ConfirmSentMessage: 'confirmSentMessage',
    ShowChatNotice: 'showChatNotice',

    // Exercise/Repo responses
    UpdateRepoStatus: 'updateRepoStatus',
    UpdateDirtyPagesStatus: 'updateDirtyPagesStatus',
    ShowClonedRepoNotice: 'showClonedRepoNotice',
    GitCredentialsResult: 'gitCredentialsResult',
    GitIdentityInfo: 'gitIdentityInfo',
    HealthCheckResults: 'healthCheckResults',

    // Server-side problem statement rendering
    ProblemStatementRendered: 'problemStatementRendered',

    // Proactive nudge banner
    ShowNudgeBanner: 'showNudgeBanner',
    HideNudgeBanner: 'hideNudgeBanner',

} as const;

/** Union of all Extension->Webview message type strings */
export type ExtensionMsg = (typeof ExtensionMsg)[keyof typeof ExtensionMsg];

/** Server-rendered problem statement fragment (body HTML returned by Artemis SSR endpoint). */
interface RenderedProblemStatementPayload {
    html: string;
}

/**
 * The host's view of run-scoped chat UI. Sent as a standalone snapshot
 * (`updateIrisRunUi`) while streaming, and embedded in `addMessage` so a commit
 * and its resulting UI state are applied atomically. The webview must never be
 * able to observe the draft cleared before the committed message landed.
 */
export interface IrisRunUiProjection {
    /** The conversation this projection belongs to; the webview drops any
     *  projection for a conversation it has already left. */
    sessionId: number;
    /** Monotonic; the webview drops anything not strictly newer. */
    revision: number;
    /** `null` clears the draft. Always `null` on a commit. */
    draft: { runId: string; text: string } | null;
    activities: IrisActivityDTO[];
    waiting: boolean;
    runState: IrisRunState | null;
    error?: { message?: string } | null;
}

/** Payload definitions for each Extension->Webview message */
interface ExtensionMsgPayloads {
    // View initialization
    dashboardInit: {
        courses: RecentCourseNode[];
        workspaceExercise?: {
            id: number;
            title: string;
        } | null;
        /** True when NOT in developer mode. Hides developer-only dashboard entries (the
         *  struggle-detection page, which is itself developer-only). Required + fail-closed so
         *  a forgotten producer is a type error, not a silently-shown dev surface. */
        hideDeveloperTools: boolean;
    };
    courseListInit: {
        courses: CourseDetailData[];
        archivedCourses?: ArchivedCourse[];
    };
    courseDetailInit: {
        courseData: CourseDetailData;
        workspaceExerciseId?: number | null;
        hideDeveloperTools?: boolean;
    };
    exerciseDetailInit: {
        exerciseData: ExerciseDetailsResponse;
        hideDeveloperTools: boolean;
        repoStatus?: { isConnected: boolean; hasChanges: boolean; isPracticeRepo: boolean };
        serverRenderedProblemStatement?: RenderedProblemStatementPayload;
        /** EduIDE (managed Theia): hide clone affordances, show "Open in Artemis". */
        isManagedEnvironment?: boolean;
    };
    serviceStatusInit: {
        serverUrl?: string;
    };
    recommendedExtensionsInit: {
        categories: Array<{
            id: string;
            name: string;
            description: string;
            extensions: Array<{
                id: string;
                name: string;
                publisher: string;
                version?: string;
                description: string;
                reason: string;
                optional?: boolean;
                isInstalled: boolean;
            }>;
        }>;
    };
    aiConfigInit: {
        aiExtensions: Array<{
            id: string; name: string; publisher: string; version: string;
            description: string; isInstalled: boolean; provider: string; providerColor: string;
        }>;
    };
    struggleDetectionInit: {
        /** v3 decision signal (S_base): the value the Urgency card renders and thresholds against θ. */
        urgency: number;
        isEnabled: boolean;
        developerMode: boolean;
        /** Latest engine timers/counters for the dev dashboard (developer mode only; omitted otherwise). */
        debug?: StruggleDebugSnapshot;
        /** True when rendered as a standalone editor-tab copy (hides the back-link, live chart, and
         *  pop-out button). The sidebar leaves this false. */
        embedded?: boolean;
    };
    struggleLiveBackfill: { ticks: LiveTick[] };
    struggleLiveTick: { tick: LiveTick };
    struggleLiveReset: undefined;
    /** Whether an exercise struggle-session is currently active (drives the live
     *  view's session indicator + empty-state wording). */
    struggleLiveSessionState: { active: boolean };
    struggleSlotUpdate: { snapshot: SlotDebugSnapshot; episodes: EpisodeHistoryEntry[] };
    viewInitError: { error: string };

    // Auth
    loginSuccess: { username: string };
    loginError: { error: string };
    setServerUrl: { serverUrl: string };

    // Loading
    showLoading: { message: string };
    hideLoading: undefined;
    updateLoading: { message: string };

    // Dashboard/Course
    archivedCoursesLoaded: { archivedCourses: ArchivedCourse[] };

    // WebSocket
    websocketUpdate:
        | { updateType: 'newResult'; data: ResultSummary }
        | { updateType: 'newSubmission'; data: SubmissionSummary }
        | { updateType: 'submissionProcessing'; data: { state: string; participationId: number; buildTimingInfo?: { buildStartDate?: string; estimatedCompletionDate?: string } } };

    // Iris Chat
    /**
     * The whole visible chat state, in one snapshot. Every field is REQUIRED:
     * there is exactly one interface now, so a producer that cannot fill a
     * field has to say so with an explicit `undefined`/`null` rather than by
     * omitting a key the webview would then silently default.
     */
    updateIrisState: {
        state: {
            exercises: Array<{ id: number; title: string; shortName?: string; courseId?: number; repositoryUri?: string; releaseDate?: string; dueDate?: string }>;
            courses: Array<{ id: number; title: string; shortName?: string; lastViewed?: number }>;
            courseId: number | undefined;
            courseTitle: string | undefined;
            currentSessionId: number | undefined;
            conversationTitle: string | undefined;
            /** Excludes CTXSWAP rows. Display only; never the ownership predicate. */
            displayMessageCount: number;
            committedContext: { mode: string; entityId: number; name?: string } | undefined;
            pendingContext: { mode: string; entityId: number; name?: string } | undefined;
            /** 'unknown' disables the picker, the chip remove icon and Ask-Iris. */
            contentState: 'unknown' | 'empty' | 'content';
            sendInFlight: boolean;
            navigationInFlight: boolean;
            conversations: Array<{
                sessionId: number;
                courseId: number;
                mode: string;
                entityId: number;
                entityName?: string;
                title?: string;
                lastActivity: number;
            }>;
            /** The detected workspace exercise, when any. Comes from
             *  workspace detection, not from `IrisConversationService`. */
            workspaceExerciseId: number | undefined;
            /**
             * Workspace detection's own progress, independent of whether it
             * found anything. `'unsettled'` means detection has not answered
             * yet: the webview must not treat "nothing open" as "no exercise
             * here" while that is still true, or a student is told to pick a
             * course while the extension is still working it out.
             * `'unavailable'` means detection could not reach the server at
             * all, which is not an answer either. Sourced from
             * `ChatStartupCoordinator`'s `DetectionUiState`.
             */
            detectionState: 'unsettled' | 'settled' | 'unavailable';
            /**
             * The newest dashboard request could not reach the server. An
             * empty `courses` alone cannot say whether the student has no
             * courses or whether nobody could be asked, and only one of those
             * two is a statement about their enrolment.
             */
            coursesUnavailable: boolean;
        };
        showDiagnostics?: boolean;
        /**
         * This snapshot is the answer to the webview's `refreshCourses`. The
         * host posts snapshots for many reasons, and one arriving while a
         * refresh is open is not a reply to it: without this marker the picker
         * ends its wait on an unrelated snapshot and renders whatever the
         * catalog held at the time, which on a cold start is "No courses
         * found" while the real request is still in flight.
         */
        answersCourseRefresh?: boolean;
    };
    addMessage: {
        /**
         * Conversation this bubble belongs to; the webview drops a bubble for
         * a conversation it has already left. Every producer only emits when
         * it has a conversation to attribute the bubble to.
         */
        sessionId: number;
        message: {
            id?: number;
            /**
             * `contextSwap` is a persisted CTXSWAP marker row (the
             * conversation-first path), not chat: the webview renders it as a
             * transcript divider, never as a user/assistant bubble.
             */
            role: 'user' | 'assistant' | 'contextSwap';
            content: string;
            timestamp: number;
            helpful?: boolean | null;
            origin?: 'proactive';
            proactiveOutcome?: 'DISMISSED' | 'RECOVERED' | 'ABANDONED';
            proactiveEpisodeId?: string;
            offer?: { offerId: string; moment: 'stuck' | 'abandon'; answered?: 'accept' | 'decline' | 'timeout' };
            activities?: IrisActivityDTO[];
            final?: boolean;
        };
        /**
         * Omitted for non-run bubbles (the provider's error messages and
         * proactive pushes), which must leave run state untouched.
         */
        runUi?: IrisRunUiProjection;
    };
    loadMessages: {
        /** The conversation this transcript belongs to. The webview ignores
         *  loads for a conversation it has already left, so a slow response
         *  cannot pollute a freshly opened one. */
        sessionId: number;
        messages: Array<{
            id?: number;
            /** `contextSwap`: see `addMessage.message.role`. */
            role: 'user' | 'assistant' | 'contextSwap';
            content: string;
            timestamp: number;
            helpful?: boolean | null;
            origin?: 'proactive';
            proactiveOutcome?: 'DISMISSED' | 'RECOVERED' | 'ABANDONED';
            proactiveEpisodeId?: string;
            activities?: IrisActivityDTO[];
            final?: boolean;
        }>;
    };
    /**
     * Non-destructive reconnect reconciliation: same shape as `loadMessages`
     * but merged by id into the live list instead of replacing it, so a
     * mid-answer disconnect that missed the terminal frame recovers the
     * persisted answer without wiping optimistic/error bubbles.
     */
    mergeSessionMessages: {
        sessionId: number;
        messages: Array<{
            id?: number;
            /** `contextSwap`: see `addMessage.message.role`. */
            role: 'user' | 'assistant' | 'contextSwap';
            content: string;
            timestamp: number;
            helpful?: boolean | null;
            activities?: IrisActivityDTO[];
            final?: boolean;
        }>;
    };
    /**
     * Reconciles the optimistic user bubble with its persisted server id from
     * the send POST response, so a later history merge matches it by id (no
     * duplicate) and the bubble leaves its `sending` state.
     */
    confirmSentMessage: {
        sessionId: number;
        localId: string;
        id: number;
    };
    /**
     * A navigation the student asked for that the host could not carry out:
     * the open failed, the course switch failed, or a send could not be
     * prepared. Deliberately carries no `sessionId`: nothing was mutated and
     * the open conversation is untouched, so there is no conversation to
     * attribute it to. The popover the student is looking at surfaces it
     * inline; the global banners are reserved for availability.
     */
    openSessionError: { message: string };
    updateReferencedFiles: {
        includedFiles: string[];
        excludedFiles: Array<{ path: string; reason?: string }>;
        totalCount: number;
    };
    updateWebSocketStatus: { status: WebSocketDisplayStatus };
    showDisabledState: { message: string };
    hideDisabledState: undefined;
    showUnavailableState: { message: string };
    hideUnavailableState: undefined;
    updateNoAiStatus: {
        isNoAiDetected: boolean;
        noAiFilePath?: string;
    };
    updateProactiveControl: {
        exerciseId: number;
        level: ProactiveLevel;
        /** Which availability card the AskIris control renders (spec §12.2 / §14). */
        cardState: ProactiveCardState;
        /** Why a non-"available" card is in that state (drives the §14 notice / note copy). */
        cardReason?: ProactiveCardReason;
        /** False in the clean/no-engine build: the card is a chat-availability reflection with no level control. */
        proactiveControlAvailable: boolean;
    };
    /** Posted when the proactive code-egress consent setting changes; the exercise view re-requests its control (#342). */
    updateProactiveConsent: undefined;
    updateIrisRunUi: {
        projection: IrisRunUiProjection;
    };
    /**
     * Posted by the extension host when a user-initiated `sendMessage`
     * command was rejected synchronously (e.g. no chat context, .noai
     * detected, Iris disabled for this exercise). The webview uses
     * `localId` + `sessionId` to find the optimistic user message and
     * mark it failed so the thinking indicator does not get stuck.
     */
    sendRejected: {
        localId: string;
        sessionId: number;
        /**
         * Widened for the conversation-first send coordinator (Task 14): the
         * new values name rejections `IrisConversationService`'s send path
         * can produce, which the old model never did. The coordinator cannot
         * report a reason the wire refuses to carry.
         */
        reason:
            | 'no-ai'
            | 'no-context'
            | 'iris-disabled'
            | 'iris-unavailable'
            | 'send-in-flight'
            | 'navigation-in-flight'
            | 'no-conversation'
            | 'conversation-changed'
            | 'rate-limit'
            | 'preparation-failed'
            | 'unknown';
        errorMessage: string;
    };
    /**
     * An actionless notice on the composer's own line (e.g. a navigation the
     * student did not ask for, or a topic change the host refused). No undo:
     * a context-swap marker has already made the conversation non-empty, so a
     * dropped staging could never be restored.
     *
     * `tone: 'error'` is what a refused topic change or a failed new
     * conversation uses: those two clicks have no popover left to hold an
     * `openSessionError`, so this line is the only place they can answer.
     */
    showChatNotice: { text: string; tone?: 'info' | 'error' };

    // Exercise/Repo responses
    updateRepoStatus: {
        isConnected: boolean;
        hasChanges: boolean;
        isPracticeRepo: boolean;
    };
    updateDirtyPagesStatus: {
        hasDirtyPages: boolean;
        dirtyFileCount: number;
        autoSaveEnabled: boolean;
    };
    showClonedRepoNotice: { exerciseTitle: string; participationId: number };
    gitCredentialsResult: {
        status: 'success' | 'error' | 'warning' | 'info';
        message: string;
    };
    gitIdentityInfo: { name: string; email: string };
    healthCheckResults: {
        results: Record<string, {
            status: 'online' | 'offline' | 'unknown';
            message: string;
            endpoint: string;
            httpStatus: number | null;
            response: string | null;
        }>;
    };

    // Server-side problem statement rendering. Broadcast to every open webview,
    // so it carries the exerciseId it belongs to; each exercise-detail view
    // applies it only when the id matches the exercise it is currently showing.
    problemStatementRendered: RenderedProblemStatementPayload & { exerciseId: number };

    /**
     * Emitted by the extension host on every DELIVERED terminal (dismiss / progress-close /
     * stale-free / force-free). The webview folds the episode group to a single summary line.
     * `praise` is present only on a progress-close terminal and carries the non-persisted
     * `episodeLabel` (fold copy) and `closeMessageId` (order-safe: C7 waits for the closing
     * row with that id before starting the ~5 s timer).
     */
    foldEpisode: {
        episodeId: string;
        outcome: 'RECOVERED' | 'DISMISSED' | 'ABANDONED';
        praise?: { episodeLabel: string; closeMessageId: number };
    };
    /**
     * Host-authoritative live-episode snapshot (state frame, latest wins): the episodeId of
     * the currently DELIVERED slot episode, or null when no episode is live. Sent on every
     * slot transition and re-sent on webview init, so a freshly created webview renders the
     * live episode as the open timeline instead of auto-folding it as an earlier hint.
     */
    setLiveEpisode: { episodeId: string | null };
    /**
     * Posted by the extension host when a stale control frame is dropped and the frame's
     * persisted chat row must be removed from the webview (stale-row suppression, C4).
     * The store removes the row if present AND records `id` in `suppressedIds` so a
     * chat-ws row with the same id arriving after the drop is never inserted.
     */
    removeMessage: { id: number };
    /**
     * Host-authoritative resolution of an offer bubble (spec B+): the webview finds the bubble by
     * `offerId` and sets its `offer.answered` (renders the condensed line in C10). The offer marker
     * itself is client-local/ephemeral (see `ChatMessage.offer`), so this is the only wire round-trip.
     */
    resolveOffer: { offerId: string; answered: 'accept' | 'decline' | 'timeout' };
    /**
     * Posted when the student switches proactive help to Off: the webview collapses every proactive
     * episode in the transcript to a fold line (Off = get out of the way). No payload — the store folds
     * every episode it holds.
     */
    collapseProactiveEpisodes: undefined;

    // Proactive nudge banner
    showNudgeBanner: { title: string; sub: string; episodeId?: string; moment?: 'stuck' | 'abandon'; offerId?: string; timerMs: number };
    hideNudgeBanner: undefined;
}

/** Auto-generated discriminated union of all Extension->Webview messages */
export type ExtensionToWebviewMessage = {
    [K in ExtensionMsg]: ExtensionMsgPayloads[K] extends undefined
        ? { type: K }
        : { type: K } & ExtensionMsgPayloads[K]
}[ExtensionMsg];

/** Extract a specific Extension->Webview message type */
export type ExtMsg<T extends ExtensionMsg> = Extract<ExtensionToWebviewMessage, { type: T }>;
