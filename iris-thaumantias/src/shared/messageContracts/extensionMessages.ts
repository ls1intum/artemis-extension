/**
 * Extension -> Webview message contracts.
 */

import type {
    ExerciseDetailsResponse,
    StudentExam,
    ResultSummary,
    SubmissionSummary,
} from '../../types/apiResponses';
import type { CourseData, ArchivedCourse, CourseDetailData, RecentCourseNode } from './domainTypes';

/** All Extension->Webview message types (const object for string-literal compatibility) */
export const ExtensionMsg = {
    // View initialization
    DashboardInit: 'dashboardInit',
    CourseListInit: 'courseListInit',
    CourseDetailInit: 'courseDetailInit',
    ExerciseDetailInit: 'exerciseDetailInit',
    ExamStartInit: 'examStartInit',
    ExamConductionInit: 'examConductionInit',
    ExamExerciseDetailInit: 'examExerciseDetailInit',
    ServiceStatusInit: 'serviceStatusInit',
    RecommendedExtensionsInit: 'recommendedExtensionsInit',
    AiConfigInit: 'aiConfigInit',
    StruggleDetectionInit: 'struggleDetectionInit',

    // Auth
    LoginSuccess: 'loginSuccess',
    LoginError: 'loginError',
    LogoutSuccess: 'logoutSuccess',
    SetServerUrl: 'setServerUrl',

    // Loading
    ShowLoading: 'showLoading',
    HideLoading: 'hideLoading',
    UpdateLoading: 'updateLoading',

    // Dashboard/Course
    WorkspaceExerciseDetected: 'workspaceExerciseDetected',
    ArchivedCoursesLoaded: 'archivedCoursesLoaded',

    // WebSocket
    WebsocketUpdate: 'websocketUpdate',

    // Iris Chat
    UpdateIrisState: 'updateIrisState',
    ShowContextPicker: 'showContextPicker',
    AddMessage: 'addMessage',
    LoadMessages: 'loadMessages',
    ClearChatMessages: 'clearChatMessages',
    UpdateReferencedFiles: 'updateReferencedFiles',
    UpdateWebSocketStatus: 'updateWebSocketStatus',
    ShowDisabledState: 'showDisabledState',
    HideDisabledState: 'hideDisabledState',
    UpdateNoAiStatus: 'updateNoAiStatus',

    // Exercise/Repo responses
    SubmissionResult: 'submissionResult',
    TestResultsData: 'testResultsData',
    BuildLogParsed: 'buildLogParsed',
    UpdateRepoStatus: 'updateRepoStatus',
    UpdateDirtyPagesStatus: 'updateDirtyPagesStatus',
    ShowClonedRepoNotice: 'showClonedRepoNotice',
    GitCredentialsResult: 'gitCredentialsResult',
    GitIdentityInfo: 'gitIdentityInfo',
    HealthCheckResults: 'healthCheckResults',

    // PlantUML
    PlantUmlRendered: 'plantUmlRendered',
    PlantUmlError: 'plantUmlError',

} as const;

/** Union of all Extension->Webview message type strings */
export type ExtensionMsg = (typeof ExtensionMsg)[keyof typeof ExtensionMsg];

/** Payload definitions for each Extension->Webview message */
interface ExtensionMsgPayloads {
    // View initialization
    dashboardInit: {
        courses: RecentCourseNode[];
        workspaceExercise?: {
            id: number;
            title: string;
        };
    };
    courseListInit: {
        courses: CourseData[];
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
    };
    examStartInit: {
        studentExam: StudentExam;
        courseId: number;
        examId: number;
    };
    examConductionInit: {
        studentExam: StudentExam;
        courseId: number;
        examId: number;
        endTime: number;
        startTime: number;
        totalDuration: number;
        workspaceExerciseId: number | null;
    };
    examExerciseDetailInit: {
        exerciseData: ExerciseDetailsResponse;
        examContext: {
            courseId: number;
            examId: number;
            studentExam: StudentExam;
            endTime: number;
            startTime: number;
            totalDuration: number;
        };
        hideDeveloperTools: boolean;
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
    };

    // Auth
    loginSuccess: { username: string };
    loginError: { error: string };
    logoutSuccess: undefined;
    setServerUrl: { serverUrl: string };

    // Loading
    showLoading: { message: string };
    hideLoading: undefined;
    updateLoading: { message: string };

    // Dashboard/Course
    workspaceExerciseDetected: {
        exerciseId: number | null;
        exerciseTitle: string | null;
    };
    archivedCoursesLoaded: { archivedCourses: ArchivedCourse[] };

    // WebSocket
    websocketUpdate:
        | { updateType: 'newResult'; data: ResultSummary }
        | { updateType: 'newSubmission'; data: SubmissionSummary }
        | { updateType: 'submissionProcessing'; data: { state: string; participationId: number; buildTimingInfo?: unknown } };

    // Iris Chat
    updateIrisState: {
        state: {
            context: { type: 'course' | 'exercise'; id: number; title: string; shortName?: string; locked: boolean; source: 'user-selected' | 'workspace-detected' | 'system-default' } | null;
            activeSessionId: string | null;
            sessions: Array<{
                id: string;
                artemisSessionId?: number;
                preview: string;
                messageCount: number;
                createdAt: number;
                lastActivity: number;
            }>;
            recentExercises: Array<{ id: number; title: string; shortName?: string; courseId?: number; repositoryUri?: string; isWorkspace?: boolean }>;
            recentCourses: Array<{ id: number; title: string; shortName?: string }>;
            allExercises: Array<{ id: number; title: string; shortName?: string; courseId?: number; repositoryUri?: string; isWorkspace?: boolean }>;
            allCourses: Array<{ id: number; title: string; shortName?: string }>;
        };
        showDiagnostics?: boolean;
    };
    showContextPicker: {
        state: ExtensionMsgPayloads['updateIrisState']['state'];
    };
    addMessage: {
        message: {
            id?: number;
            role: 'user' | 'assistant';
            content: string;
            timestamp: number;
            helpful?: boolean | null;
        };
    };
    loadMessages: {
        messages: Array<{
            id?: number;
            role: 'user' | 'assistant';
            content: string;
            timestamp: number;
            helpful?: boolean | null;
        }>;
    };
    clearChatMessages: undefined;
    updateReferencedFiles: {
        includedFiles: string[];
        excludedFiles: Array<{ path: string; reason?: string }>;
        totalCount: number;
    };
    updateWebSocketStatus: { isConnected: boolean };
    showDisabledState: { message: string };
    hideDisabledState: undefined;
    updateNoAiStatus: {
        isNoAiDetected: boolean;
        noAiFilePath?: string;
    };

    // Exercise/Repo responses
    submissionResult: { success: boolean; error?: string };
    testResultsData: {
        testCases: Array<{
            testName?: string;
            successful?: boolean;
            message?: string;
        }>;
        error?: string;
    };
    buildLogParsed: {
        error: {
            filePath: string;
            line: number;
            message: string;
            column?: number;
        } | null;
        participationId: number;
        resultId?: number;
    };
    updateRepoStatus: {
        isConnected: boolean;
        hasChanges: boolean;
        isGradedRepo: boolean;
    };
    updateDirtyPagesStatus: {
        hasDirtyPages: boolean;
        dirtyFileCount: number;
        autoSaveEnabled: boolean;
    };
    showClonedRepoNotice: { exerciseTitle: string };
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

    // PlantUML
    plantUmlRendered: { index: number; svg: string };
    plantUmlError: { index: number; error: string };
}

/** Auto-generated discriminated union of all Extension->Webview messages */
export type ExtensionToWebviewMessage = {
    [K in ExtensionMsg]: ExtensionMsgPayloads[K] extends undefined
        ? { type: K }
        : { type: K } & ExtensionMsgPayloads[K]
}[ExtensionMsg];

/** Extract a specific Extension->Webview message type */
export type ExtMsg<T extends ExtensionMsg> = Extract<ExtensionToWebviewMessage, { type: T }>;
