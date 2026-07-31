/**
 * Extension -> Webview message contracts.
 */

import type {
    ExerciseDetailsResponse,
    IrisActivityDTO,
    IrisChatMode,
    IrisRunState,
    ResultSummary,
    SubmissionSummary,
} from '@shared/types/apiResponses';
import type { ChatContextType } from '@shared/types/context';

import type { ArchivedCourse, CourseDetailData, RecentCourseNode } from './domainTypes';

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
    OpenSessionError: 'openSessionError',
    UpdateCourseHistory: 'updateCourseHistory',
    CourseHistoryError: 'courseHistoryError',
    ClearChatMessages: 'clearChatMessages',
    UpdateReferencedFiles: 'updateReferencedFiles',
    UpdateWebSocketStatus: 'updateWebSocketStatus',
    ShowDisabledState: 'showDisabledState',
    HideDisabledState: 'hideDisabledState',
    ShowUnavailableState: 'showUnavailableState',
    HideUnavailableState: 'hideUnavailableState',
    UpdateNoAiStatus: 'updateNoAiStatus',
    UpdateIrisRunUi: 'updateIrisRunUi',
    SendRejected: 'sendRejected',
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
    /** Rejects a projection belonging to a session we already left. */
    localSessionId: string;
    /**
     * Conversation-first counterpart to `localSessionId`, beside it (not
     * replacing it) until Task 15. Optional and unpopulated until Task 14
     * routes run UI through `IrisConversationService`.
     */
    sessionId?: number;
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
        eq: number;
        eqConfidence: 'insufficient' | 'sufficient';
        triggerType?: string;
        recommendedAction: 'none' | 'subtle' | 'notification' | 'proactive';
        isEnabled: boolean;
        developerMode: boolean;
    };
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
            exercises: Array<{ id: number; title: string; shortName?: string; courseId?: number; repositoryUri?: string; isWorkspace?: boolean; releaseDate?: string; dueDate?: string; lastViewed?: number }>;
            courses: Array<{ id: number; title: string; shortName?: string; lastViewed?: number }>;
            // ---- Conversation-first fields (Task 10). EVERY field below is
            // OPTIONAL until Task 15. They are added to a payload that dozens
            // of typed React fixtures already construct; making them required
            // here would force all of those to be rewritten in a commit that
            // is supposed to be additive, and Task 15 tightens them anyway
            // once the old fields above are deleted.
            courseId?: number | undefined;
            courseTitle?: string | undefined;
            currentSessionId?: number | undefined;
            conversationTitle?: string | undefined;
            /** Excludes CTXSWAP rows. Display only; never the ownership predicate. */
            displayMessageCount?: number;
            committedContext?: { mode: string; entityId: number; name?: string } | undefined;
            pendingContext?: { mode: string; entityId: number; name?: string } | undefined;
            /** 'unknown' disables the picker, the chip remove icon and Ask-Iris. */
            contentState?: 'unknown' | 'empty' | 'content';
            sendInFlight?: boolean;
            navigationInFlight?: boolean;
            conversations?: Array<{
                sessionId: number;
                courseId: number;
                mode: string;
                entityId: number;
                entityName?: string;
                title?: string;
                lastActivity: number;
            }>;
            /** The detected workspace exercise, when any. Sourced from the
             *  same workspace-detection state the old model already tracks;
             *  not part of `IrisConversationService`'s own state. */
            workspaceExerciseId?: number | undefined;
            /**
             * True once the host dispatcher answers the conversation-first
             * commands (Task 14 sets it). Absent until then, so this build
             * keeps rendering the old interface. Task 15 deletes it together
             * with the old fields.
             *
             * It has to be its own flag rather than something inferred from
             * the fields above: the presenter already fills every one of them
             * whenever the conversation service exists, and all of them are
             * legitimately empty at cold start, so neither a value nor the
             * presence of a key can tell "the host answers this model" from
             * "the host merely mirrors it".
             */
            conversationFirst?: boolean;
        };
        showDiagnostics?: boolean;
    };
    addMessage: {
        /**
         * Session this bubble belongs to; the webview drops stale sessions.
         * Both producers (the WS handler and the provider's catch path) only
         * ever emit when they have a session id to attribute the bubble to.
         */
        localSessionId: string;
        /**
         * Conversation-first counterpart to `localSessionId`, beside it (not
         * replacing it) until Task 15. Optional and unpopulated until Task 14
         * routes message delivery through `IrisConversationService`.
         */
        sessionId?: number;
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
            activities?: IrisActivityDTO[];
            final?: boolean;
        };
        /**
         * Omitted for non-run bubbles (the provider's error messages), which
         * must leave run state untouched.
         */
        runUi?: IrisRunUiProjection;
    };
    loadMessages: {
        /** Local session UUID this load belongs to. The webview ignores
         *  loads whose id no longer matches the currently active session,
         *  so a slow response cannot pollute a freshly switched view. */
        localSessionId: string;
        /** Conversation-first counterpart to `localSessionId`; see `addMessage`. */
        sessionId?: number;
        artemisSessionId: number;
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
     * Non-destructive reconnect reconciliation: same shape as `loadMessages`
     * but merged by id into the live list instead of replacing it, so a
     * mid-answer disconnect that missed the terminal frame recovers the
     * persisted answer without wiping optimistic/error bubbles.
     */
    mergeSessionMessages: {
        localSessionId: string;
        /** Conversation-first counterpart to `localSessionId`; see `addMessage`. */
        sessionId?: number;
        artemisSessionId: number;
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
        localSessionId: string;
        /** Conversation-first counterpart to `localSessionId`; see `addMessage`. */
        sessionId?: number;
        localId: string;
        id: number;
    };
    loadMessagesError: { localSessionId: string };
    /**
     * A pre-switch open failure: the course overview fetch failed, or the
     * requested Artemis session id was not present in it. Distinct from
     * {@link loadMessagesError} (which is keyed to a `localSessionId` and
     * dropped unless it matches the active session): nothing was mutated and
     * the active session is untouched, so this cannot be attributed to any
     * local session. The history popover surfaces it inline.
     */
    openSessionError: { message: string };
    /**
     * Answers a `requestCourseHistory` command: the course-wide history for
     * the course-history popover, newest-first (see `buildCourseHistory`).
     * `requestId` echoes the request so the store can drop a stale response
     * whose `requestId` no longer matches the latest request.
     */
    updateCourseHistory: {
        courseId: number;
        requestId: number;
        entries: Array<{
            artemisSessionId: number;
            courseId: number;
            mode: IrisChatMode;
            entityId: number;
            entityName?: string;
            title?: string;
            lastActivity: number;
        }>;
    };
    /** `requestCourseHistory` failed (e.g. the overview fetch threw). */
    courseHistoryError: { courseId: number; requestId: number };
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
    updateIrisRunUi: {
        projection: IrisRunUiProjection;
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
        /** Conversation-first counterpart to `localSessionId`; see `addMessage`. */
        sessionId?: number;
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
     * An informative, actionless notice for the conversation-first path (e.g.
     * a staged topic dropped by an incoming context-swap marker). No undo: the
     * marker itself already made the conversation non-empty, so the staging
     * could never be restored. Not yet consumed by the webview; the path that
     * produces it stays dormant until Task 14.
     */
    showChatNotice: { text: string };

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
