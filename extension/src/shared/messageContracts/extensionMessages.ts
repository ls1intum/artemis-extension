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
    LoginOptionsResult: 'loginOptionsResult',
    LoginOptionsError: 'loginOptionsError',

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
    loginOptionsResult: {
        loginMethod: 'PASSWORD' | 'OIDC' | 'SAML2';
        /** Null for password accounts; the view falls back to its own label. */
        idpName?: string | null;
    };
    loginOptionsError: {
        error?: string;
    };

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
     * a producer that cannot fill a field has to say so with an explicit
     * `undefined`/`null` rather than by omitting a key the webview would then
     * silently default.
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
         * Covers every rejection `IrisConversationService`'s send path can
         * produce: the coordinator cannot report a reason the wire refuses to
         * carry.
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

    // Server-side problem statement rendering
    problemStatementRendered: RenderedProblemStatementPayload;
}

/** Discriminated union of all Extension->Webview messages. */
export type ExtensionToWebviewMessage = {
    [K in ExtensionMsg]: ExtensionMsgPayloads[K] extends undefined
        ? { type: K }
        : { type: K } & ExtensionMsgPayloads[K]
}[ExtensionMsg];

export type ExtMsg<T extends ExtensionMsg> = Extract<ExtensionToWebviewMessage, { type: T }>;
