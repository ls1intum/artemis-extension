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
        message: {
            id?: number;
            role: 'user' | 'assistant';
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
        artemisSessionId: number;
        messages: Array<{
            id?: number;
            role: 'user' | 'assistant';
            content: string;
            timestamp: number;
            helpful?: boolean | null;
            activities?: IrisActivityDTO[];
            final?: boolean;
        }>;
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
