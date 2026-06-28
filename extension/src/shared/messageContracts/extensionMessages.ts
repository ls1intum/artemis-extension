/**
 * Extension -> Webview message contracts.
 */

import type {
    ExerciseDetailsResponse,
    IrisStageDTO,
    ResultSummary,
    SubmissionSummary,
} from '@shared/types/apiResponses';
import type { ChatContextType } from '@shared/types/context';

import type { ArchivedCourse, CourseDetailData, RecentCourseNode } from './domainTypes';

// ---------------------------------------------------------------------------
// Shared boundary union (mirrors engine's BOUNDARY_PRIORITY order)
// ---------------------------------------------------------------------------

export const BOUNDARY_TYPES = ['FM', 'FM_PLUS', 'E4', 'N1', 'STATE'] as const;
export type BoundaryType = typeof BOUNDARY_TYPES[number];

// ---------------------------------------------------------------------------
// AskIris proactive-availability card state (spec §12.2 / §14)
// ---------------------------------------------------------------------------

/**
 * Which proactive-availability state the AskIris card renders (spec §12.2, one term per §14 row).
 * The clean (no-engine) build never sends a card at all — its "hidden" case is the ABSENCE of the
 * `proactiveControl` capability, not a state here (see `proactiveControlCommands._push`).
 */
export type ProactiveCardState = 'available' | 'off-course' | 'unavailable' | 'degraded';
/** Why a non-"available" card is in that state (drives the §14 banner / note copy). */
export type ProactiveCardReason = 'noai' | 'iris-off' | 'course-off' | 'limited';

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
    s: number;
    v: number;
    theta: number;
    boundariesPreGate: BoundaryType[];
    alertKind: 'edit' | 'discrete' | null;
    alertPrimary: BoundaryType | null;
    decisionTrace: LiveDecisionTrace;
}

// ---------------------------------------------------------------------------
// Struggle debug snapshot (dev timers/counters dashboard + Phase B log)
// ---------------------------------------------------------------------------

/** Raw Tier-2 delivery-throttle state (counters + absolute ms timestamps). The
 *  consumer computes every "remaining" locally against the snapshot's `nowMs`, so
 *  this stays pure state with no derived countdowns baked in. */
export interface StruggleThrottleState {
    /** Alerts DELIVERED so far this session (vs caps.maxAlertsPerSession). */
    deliveredThisSession: number;
    /** Absolute ms timestamps of delivered alerts this session (the rolling per-minute window). */
    deliveredAtMs: number[];
    /** Absolute ms of the most recent delivery, or null if none yet (the min-gap floor). */
    lastDeliveryMs: number | null;
}

/** SPEC/TUNING caps echoed once so the client computes "remaining" without re-importing config. */
export interface StruggleDebugCaps {
    warmupS: number;
    cooldownS: number;
    graceS: number;
    minDeliveryGapS: number;
    maxAlertsPerMinute: number;
    maxAlertsPerSession: number;
    n2MinActiveS: number;
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
    /** fN2 "off-screen error" currently active (metric; a true countdown needs a tracker getter, deferred). */
    fN2Active: boolean;
    /** Effective feature window at the last tick: max(10, min(60, sessionSeconds)). */
    effectiveWindowS: number;
    /** Longest pause in the last window (s), shown against caps.gapNormS. */
    longestGapS: number;
    /** E6 re-arm gate: alert legality is gated SEPARATELY from the bare cooldown end. */
    notRearmed: boolean;
    caps: StruggleDebugCaps;
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
    LoadMessagesError: 'loadMessagesError',
    ClearChatMessages: 'clearChatMessages',
    UpdateReferencedFiles: 'updateReferencedFiles',
    UpdateWebSocketStatus: 'updateWebSocketStatus',
    ShowDisabledState: 'showDisabledState',
    HideDisabledState: 'hideDisabledState',
    ShowUnavailableState: 'showUnavailableState',
    HideUnavailableState: 'hideUnavailableState',
    UpdateNoAiStatus: 'updateNoAiStatus',
    UpdateProactiveControl: 'updateProactiveControl',
    UpdateIrisStages: 'updateIrisStages',
    SendRejected: 'sendRejected',

    // Exercise/Repo responses
    UpdateRepoStatus: 'updateRepoStatus',
    UpdateDirtyPagesStatus: 'updateDirtyPagesStatus',
    ShowClonedRepoNotice: 'showClonedRepoNotice',
    GitCredentialsResult: 'gitCredentialsResult',
    GitIdentityInfo: 'gitIdentityInfo',
    HealthCheckResults: 'healthCheckResults',

    // Server-side problem statement rendering
    ProblemStatementRendered: 'problemStatementRendered',

} as const;

/** Union of all Extension->Webview message type strings */
export type ExtensionMsg = (typeof ExtensionMsg)[keyof typeof ExtensionMsg];

/** Server-rendered problem statement fragment (body HTML returned by Artemis SSR endpoint). */
interface RenderedProblemStatementPayload {
    html: string;
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
        isStruggling: boolean;
        /** v3 decision signal (S_base); isStruggling = urgency >= θ. */
        urgency: number;
        v: number;
        s: number;
        primaryBoundary: 'FM' | 'FM_PLUS' | 'E4' | 'N1' | 'STATE' | null;
        lastAlertT: number | null;
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
    updateIrisState: {
        state: {
            context: { type: ChatContextType; id: number; title: string; shortName?: string; courseId?: number; locked: boolean; source: 'user-selected' | 'workspace-detected' | 'system-default' } | null;
            activeSessionId: string | null;
            sessions: Array<{
                id: string;
                artemisSessionId?: number;
                preview: string;
                title?: string;
                messageCount: number;
                createdAt: number;
                lastActivity: number;
            }>;
            exercises: Array<{ id: number; title: string; shortName?: string; courseId?: number; repositoryUri?: string; isWorkspace?: boolean }>;
            courses: Array<{ id: number; title: string; shortName?: string }>;
        };
        showDiagnostics?: boolean;
    };
    addMessage: {
        message: {
            id?: number;
            role: 'user' | 'assistant';
            content: string;
            timestamp: number;
            helpful?: boolean | null;
            origin?: 'proactive';
            proactiveOutcome?: 'DISMISSED';
        };
    };
    loadMessages: {
        /** Local session UUID this load belongs to. The webview ignores
         *  loads whose id no longer matches the currently active session,
         *  so a slow response cannot pollute a freshly switched view. */
        localSessionId: string;
        artemisSessionId: number;
        messages: Array<{
            id?: number;
            role: 'user' | 'assistant';
            content: string;
            timestamp: number;
            helpful?: boolean | null;
            origin?: 'proactive';
            proactiveOutcome?: 'DISMISSED';
        }>;
    };
    loadMessagesError: { localSessionId: string };
    clearChatMessages: undefined;
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
        preference: 'on' | 'off';
        autoPaused: boolean;
        /** Which availability card the AskIris control renders (spec §12.2 / §14). */
        cardState: ProactiveCardState;
        /** Why a non-"available" card is in that state (drives the §14 banner / note copy). */
        cardReason?: ProactiveCardReason;
    };
    updateIrisStages: {
        stages: IrisStageDTO[];
    };
    /**
     * Posted by the extension host when a user-initiated `sendMessage`
     * command was rejected synchronously (e.g. no chat context, .noai
     * detected, Iris disabled for this exercise). The webview uses
     * `localId` + `localSessionId` to find the optimistic user message and
     * mark it failed so the thinking indicator does not get stuck.
     */
    sendRejected: {
        localId: string;
        localSessionId: string;
        reason: 'no-ai' | 'no-context' | 'iris-disabled' | 'iris-unavailable';
        errorMessage: string;
    };

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

    // Server-side problem statement rendering
    problemStatementRendered: RenderedProblemStatementPayload;
}

/** Auto-generated discriminated union of all Extension->Webview messages */
export type ExtensionToWebviewMessage = {
    [K in ExtensionMsg]: ExtensionMsgPayloads[K] extends undefined
        ? { type: K }
        : { type: K } & ExtensionMsgPayloads[K]
}[ExtensionMsg];

/** Extract a specific Extension->Webview message type */
export type ExtMsg<T extends ExtensionMsg> = Extract<ExtensionToWebviewMessage, { type: T }>;
