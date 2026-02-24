/**
 * Message contracts for typed extension-webview communication.
 *
 * This file defines discriminated union types for bidirectional messaging
 * between the extension host (Node.js) and webview (browser) contexts.
 * It's importable from both contexts (no vscode imports).
 */

/**
 * VS Code API interface available in webview context.
 * Acquired via window.acquireVsCodeApi() in webview code.
 */
export interface VsCodeApi {
    postMessage(message: WebviewToExtensionMessage): void;
    getState<T = unknown>(): T | undefined;
    setState<T = unknown>(state: T): void;
}

// ============================================================================
// Extension → Webview Messages
// ============================================================================

/**
 * Generic initialization message for views.
 * Views can use this or define view-specific init messages.
 */
export interface GenericInitMessage {
    type: 'init';
    view: string;
    payload: Record<string, unknown>;
}

/**
 * GitCredentials view initialization message.
 */
export interface GitCredentialsInitMessage {
    type: 'gitCredentialsInit';
    payload: {
        currentName?: string;
        currentEmail?: string;
    };
}

/**
 * GitCredentials operation result message.
 */
export interface GitCredentialsResultMessage {
    type: 'gitCredentialsResult';
    status: 'success' | 'error' | 'warning';
    message: string;
}

/**
 * ServiceStatus view initialization message.
 */
export interface ServiceStatusInitMessage {
    type: 'serviceStatusInit';
    payload: {
        serverUrl?: string;
    };
}

/**
 * Health check results message.
 */
export interface HealthCheckResultsMessage {
    type: 'healthCheckResults';
    payload: {
        results: Record<string, {
            status: string;
            message: string;
            endpoint: string;
            httpStatus: number | null;
            response: string | null;
        }>;
    };
}

/**
 * RecommendedExtensions view initialization message.
 */
export interface RecommendedExtensionsInitMessage {
    type: 'recommendedExtensionsInit';
    payload: {
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
}

/**
 * Show loading indicator message.
 */
export interface ShowLoadingMessage {
    type: 'showLoading';
    payload: {
        message: string;
    };
}

/**
 * Hide loading indicator message.
 */
export interface HideLoadingMessage {
    type: 'hideLoading';
}

/**
 * Update loading message text.
 */
export interface UpdateLoadingMessage {
    type: 'updateLoading';
    payload: {
        message: string;
    };
}

/**
 * Login success message.
 */
export interface LoginSuccessMessage {
    type: 'loginSuccess';
    payload: {
        username: string;
    };
}

/**
 * Login error message.
 */
export interface LoginErrorMessage {
    type: 'loginError';
    payload: {
        error: string;
    };
}

/**
 * Logout success message.
 */
export interface LogoutSuccessMessage {
    type: 'logoutSuccess';
}

/**
 * Show logged-in state message.
 */
export interface ShowLoggedInMessage {
    type: 'showLoggedIn';
    payload: {
        userInfo: {
            username: string;
            serverUrl: string;
        };
    };
}

/**
 * Set server URL message.
 */
export interface SetServerUrlMessage {
    type: 'setServerUrl';
    payload: {
        serverUrl: string;
    };
}

/**
 * Dashboard initialization message.
 */
export interface DashboardInitMessage {
    type: 'dashboardInit';
    payload: {
        courses: Array<{
            courseData: {
                course: {
                    id?: number;
                    title: string;
                    exercises?: Array<{
                        id?: number;
                        title?: string;
                        type?: string;
                        releaseDate?: string;
                        startDate?: string;
                        dueDate?: string;
                    }>;
                    startDate?: string;
                    creationDate?: string;
                };
            };
            exercises: Array<{
                id?: number;
                title?: string;
                type?: string;
                releaseDate?: string;
                startDate?: string;
                dueDate?: string;
            }>;
        }>;
        workspaceExercise?: {
            id: number;
            title: string;
        };
    };
}

/**
 * Workspace exercise detected message.
 */
export interface WorkspaceExerciseDetectedMessage {
    type: 'workspaceExerciseDetected';
    payload: {
        exerciseId: number;
        exerciseTitle: string;
    } | null;
}

/**
 * CourseList view initialization message.
 */
export interface CourseListInitMessage {
    type: 'courseListInit';
    payload: {
        courses: CourseData[];
        archivedCourses?: ArchivedCourse[];
    };
}

/**
 * Archived courses loaded message.
 */
export interface ArchivedCoursesLoadedMessage {
    type: 'archivedCoursesLoaded';
    payload: {
        archivedCourses: ArchivedCourse[];
    };
}

/**
 * CourseDetail view initialization message.
 */
export interface CourseDetailInitMessage {
    type: 'courseDetailInit';
    payload: {
        courseData: CourseDetailData;
        workspaceExerciseId?: number | null;
        hideDeveloperTools?: boolean;
    };
}

/**
 * ExerciseDetail view initialization message.
 */
export interface ExerciseDetailInitMessage {
    type: 'exerciseDetailInit';
    payload: {
        exerciseData: unknown;
        hideDeveloperTools: boolean;
    };
}

/**
 * ExamConduction view initialization message.
 */
export interface ExamConductionInitMessage {
    type: 'examConductionInit';
    payload: {
        studentExam: unknown;
        courseId: number;
        examId: number;
        endTime: number;
        startTime: number;
        totalDuration: number;
        workspaceExerciseId: number | null;
    };
}

/**
 * ExamStart view initialization message.
 */
export interface ExamStartInitMessage {
    type: 'examStartInit';
    payload: {
        studentExam: unknown;
        courseId: number;
        examId: number;
    };
}

/**
 * ExamExerciseDetail view initialization message.
 */
export interface ExamExerciseDetailInitMessage {
    type: 'examExerciseDetailInit';
    payload: {
        exerciseData: unknown;
        examContext: {
            courseId: number;
            examId: number;
            studentExam: unknown;
            endTime: number;
            startTime: number;
            totalDuration: number;
        };
        hideDeveloperTools: boolean;
    };
}

/**
 * WebSocket update message (forwarded from extension's WebSocket handler).
 */
export interface WebSocketUpdateMessage {
    type: 'websocketUpdate';
    payload: {
        updateType: 'newResult' | 'newSubmission' | 'submissionProcessing';
        data: unknown;
    };
}

/**
 * WebSocket disconnected message.
 */
export interface WebSocketDisconnectedMessage {
    type: 'websocketDisconnected';
}

/**
 * WebSocket connected message.
 */
export interface WebSocketConnectedMessage {
    type: 'websocketConnected';
}

/**
 * CourseData structure for active courses.
 */
export interface CourseData {
    course: {
        id: number;
        title: string;
        description?: string;
        semester?: string;
        color?: string;
        exercises?: Exercise[];
        numberOfStudents?: number;
        instructorGroupName?: string;
    };
}

/**
 * Exercise structure within a course.
 */
export interface Exercise {
    id?: number;
    title?: string;
    type?: string;
    releaseDate?: string;
    startDate?: string;
    dueDate?: string;
}

/**
 * ArchivedCourse structure for archived courses.
 */
export interface ArchivedCourse {
    id: number;
    title: string;
    semester?: string;
    color?: string;
}

/**
 * Exam structure within a course.
 */
export interface Exam {
    id: number;
    title?: string;
    startDate?: string;
    endDate?: string;
}

/**
 * CourseDetail data structure (full course with exams and exercises).
 */
export interface CourseDetailData {
    course: {
        id: number;
        title: string;
        description?: string;
        semester?: string;
        color?: string;
        exercises?: Exercise[];
        exams?: Exam[];
        numberOfStudents?: number;
        instructorGroupName?: string;
        isArchived?: boolean;
        shortName?: string;
    };
}

/**
 * All messages that can be sent FROM extension host TO webview.
 * Discriminated by 'type' property.
 */
export type ExtensionToWebviewMessage =
    | GenericInitMessage
    | GitCredentialsInitMessage
    | GitCredentialsResultMessage
    | ServiceStatusInitMessage
    | HealthCheckResultsMessage
    | RecommendedExtensionsInitMessage
    | ShowLoadingMessage
    | HideLoadingMessage
    | UpdateLoadingMessage
    | LoginSuccessMessage
    | LoginErrorMessage
    | LogoutSuccessMessage
    | ShowLoggedInMessage
    | SetServerUrlMessage
    | DashboardInitMessage
    | WorkspaceExerciseDetectedMessage
    | CourseListInitMessage
    | ArchivedCoursesLoadedMessage
    | CourseDetailInitMessage
    | ExerciseDetailInitMessage
    | ExamConductionInitMessage
    | ExamStartInitMessage
    | ExamExerciseDetailInitMessage
    | WebSocketUpdateMessage
    | WebSocketDisconnectedMessage
    | WebSocketConnectedMessage
    | { type: 'error'; payload: { message: string } };

// ============================================================================
// Webview → Extension Messages
// ============================================================================

/**
 * Ready signal sent by webview after React hydration.
 */
export interface ReadyMessage {
    type: 'ready';
}

/**
 * Save Git identity command.
 */
export interface SaveGitIdentityCommand {
    type: 'command';
    command: 'saveGitIdentity';
    payload: {
        name: string;
        email: string;
    };
}

/**
 * Request current Git identity command.
 */
export interface RequestGitIdentityCommand {
    type: 'command';
    command: 'requestGitIdentity';
}

/**
 * Copy text to clipboard command.
 */
export interface CopyToClipboardCommand {
    type: 'command';
    command: 'copyToClipboard';
    payload: {
        text: string;
    };
}

/**
 * Navigate back to dashboard command.
 */
export interface BackToDashboardCommand {
    type: 'command';
    command: 'backToDashboard';
}

/**
 * Perform health checks command.
 */
export interface PerformHealthChecksCommand {
    type: 'command';
    command: 'performHealthChecks';
    payload: {
        serverUrl: string;
    };
}

/**
 * Request recommended extensions data command.
 */
export interface RequestRecommendedExtensionsCommand {
    type: 'command';
    command: 'requestRecommendedExtensions';
}

/**
 * Search VS Code marketplace for extension command.
 */
export interface SearchMarketplaceCommand {
    type: 'command';
    command: 'searchMarketplace';
    payload: {
        extensionId: string;
    };
}

/**
 * Login command with credentials.
 */
export interface LoginCommand {
    type: 'command';
    command: 'login';
    payload: {
        username: string;
        password: string;
        rememberMe: boolean;
    };
}

/**
 * Logout command.
 */
export interface LogoutCommand {
    type: 'command';
    command: 'logout';
}

/**
 * Open Artemis website command.
 */
export interface OpenWebsiteCommand {
    type: 'command';
    command: 'openWebsite';
}

/**
 * Open Artemis settings command.
 */
export interface OpenSettingsCommand {
    type: 'command';
    command: 'openSettings';
}

/**
 * Browse courses (dashboard) command.
 */
export interface BrowseCoursesCommand {
    type: 'command';
    command: 'browseCourses';
}

/**
 * Reload dashboard command.
 */
export interface ReloadDashboardCommand {
    type: 'command';
    command: 'reloadDashboard';
}

/**
 * Show all courses command.
 */
export interface ShowAllCoursesCommand {
    type: 'command';
    command: 'showAllCourses';
}

/**
 * View course details command.
 */
export interface ViewCourseDetailsCommand {
    type: 'command';
    command: 'viewCourseDetails';
    payload: {
        courseData: unknown;
    };
}

/**
 * Open exercise command.
 */
export interface OpenExerciseCommand {
    type: 'command';
    command: 'openExercise';
    payload: {
        exerciseId: number;
        courseId?: number | null;
    };
}

/**
 * Detect workspace exercise command.
 */
export interface DetectWorkspaceExerciseCommand {
    type: 'command';
    command: 'detectWorkspaceExercise';
}

/**
 * Show AI config command.
 */
export interface ShowAiConfigCommand {
    type: 'command';
    command: 'showAiConfig';
}

/**
 * Show recommended extensions command.
 */
export interface ShowRecommendedExtensionsCommand {
    type: 'command';
    command: 'showRecommendedExtensions';
}

/**
 * Show service status command.
 */
export interface ShowServiceStatusCommand {
    type: 'command';
    command: 'showServiceStatus';
}

/**
 * Show Git credentials command.
 */
export interface ShowGitCredentialsCommand {
    type: 'command';
    command: 'showGitCredentials';
}

/**
 * Show struggle detection command.
 */
export interface ShowStruggleDetectionCommand {
    type: 'command';
    command: 'showStruggleDetection';
}

/**
 * Open bug report command.
 */
export interface OpenBugReportCommand {
    type: 'command';
    command: 'openBugReport';
}

/**
 * Reload courses command.
 */
export interface ReloadCoursesCommand {
    type: 'command';
    command: 'reloadCourses';
}

/**
 * Load archived courses command.
 */
export interface LoadArchivedCoursesCommand {
    type: 'command';
    command: 'loadArchivedCourses';
}

/**
 * View archived course command.
 */
export interface ViewArchivedCourseCommand {
    type: 'command';
    command: 'viewArchivedCourse';
    payload: {
        courseId: number;
    };
}

/**
 * Reload course detail command.
 */
export interface ReloadCourseDetailCommand {
    type: 'command';
    command: 'reloadCourseDetail';
    payload: {
        courseId: number;
    };
}

/**
 * Open exercise details command.
 */
export interface OpenExerciseDetailsCommand {
    type: 'command';
    command: 'openExerciseDetails';
    payload: {
        exerciseId: number;
    };
}

/**
 * Open exam command.
 */
export interface OpenExamCommand {
    type: 'command';
    command: 'openExam';
    payload: {
        examId: number;
        courseId: number;
    };
}

/**
 * Ask Iris about course command.
 */
export interface AskIrisAboutCourseCommand {
    type: 'command';
    command: 'askIrisAboutCourse';
    payload: {
        courseId: number;
        courseTitle: string;
        courseShortName?: string;
    };
}

/**
 * Toggle course fullscreen command.
 */
export interface ToggleCourseFullscreenCommand {
    type: 'command';
    command: 'toggleCourseFullscreen';
}

/**
 * Open in editor command (developer tools).
 */
export interface OpenInEditorCommand {
    type: 'command';
    command: 'openInEditor';
    payload: {
        data: unknown;
    };
}

/**
 * Reload exercise detail command.
 */
export interface ReloadExerciseDetailCommand {
    type: 'command';
    command: 'reloadExerciseDetail';
    payload: {
        exerciseId: number;
    };
}

/**
 * Back to course details command.
 */
export interface BackToCourseDetailsCommand {
    type: 'command';
    command: 'backToCourseDetails';
}

/**
 * Clone repository command.
 */
export interface CloneRepositoryCommand {
    type: 'command';
    command: 'cloneRepository';
    payload: {
        participationId: number;
        repositoryUri: string;
        exerciseTitle: string;
    };
}

/**
 * Open repository command.
 */
export interface OpenRepositoryCommand {
    type: 'command';
    command: 'openRepository';
    payload: {
        repositoryUri?: string;
    };
}

/**
 * Submit exercise command.
 */
export interface SubmitExerciseCommand {
    type: 'command';
    command: 'submitExercise';
    payload: {
        participationId: number;
    };
}

/**
 * Trigger build command.
 */
export interface TriggerBuildCommand {
    type: 'command';
    command: 'triggerBuild';
    payload: {
        participationId: number;
    };
}

/**
 * Upload submission command.
 */
export interface UploadSubmissionCommand {
    type: 'command';
    command: 'uploadSubmission';
    payload: {
        exerciseId: number;
    };
}

/**
 * Start exercise command.
 */
export interface StartExerciseCommand {
    type: 'command';
    command: 'startExercise';
    payload: {
        exerciseId: number;
    };
}

/**
 * Start practice command.
 */
export interface StartPracticeCommand {
    type: 'command';
    command: 'startPractice';
    payload: {
        exerciseId: number;
    };
}

/**
 * Ask Iris about exercise command.
 */
export interface AskIrisAboutExerciseCommand {
    type: 'command';
    command: 'askIrisAboutExercise';
    payload: {
        exerciseId: number;
        exerciseTitle: string;
        exerciseShortName?: string;
        courseId?: number;
        courseTitle?: string;
        courseShortName?: string;
    };
}

/**
 * Toggle exercise fullscreen command.
 */
export interface ToggleExerciseFullscreenCommand {
    type: 'command';
    command: 'toggleExerciseFullscreen';
}

/**
 * Download file command.
 */
export interface DownloadFileCommand {
    type: 'command';
    command: 'downloadFile';
    payload: {
        url: string;
        filename: string;
    };
}

/**
 * Check repository status command.
 */
export interface CheckRepositoryStatusCommand {
    type: 'command';
    command: 'checkRepositoryStatus';
    payload: {
        showNotification?: boolean;
    };
}

/**
 * Open exam exercise details command.
 */
export interface OpenExamExerciseDetailsCommand {
    type: 'command';
    command: 'openExamExerciseDetails';
    payload: {
        exercise: unknown;
        exerciseIndex: number;
        courseId: number;
        examId: number;
    };
}

/**
 * Back to exam command.
 */
export interface BackToExamCommand {
    type: 'command';
    command: 'backToExam';
    payload: {
        courseId: number;
        examId: number;
    };
}

/**
 * Open exam in browser command.
 */
export interface OpenExamInBrowserCommand {
    type: 'command';
    command: 'openExamInBrowser';
    payload: {
        courseId: number;
        examId: number;
    };
}

/**
 * Refresh exam command.
 */
export interface RefreshExamCommand {
    type: 'command';
    command: 'refreshExam';
    payload: {
        courseId: number;
        examId: number;
        studentExamId?: number;
    };
}

/**
 * Reload exam conduction command.
 */
export interface ReloadExamConductionCommand {
    type: 'command';
    command: 'reloadExamConduction';
}

/**
 * Error message from webview to extension.
 */
export interface ErrorMessage {
    type: 'error';
    payload: {
        message: string;
        stack?: string;
        componentStack?: string;
    };
}

/**
 * All messages that can be sent FROM webview TO extension host.
 * Discriminated by 'type' property.
 */
export type WebviewToExtensionMessage =
    | ReadyMessage
    | SaveGitIdentityCommand
    | RequestGitIdentityCommand
    | CopyToClipboardCommand
    | BackToDashboardCommand
    | PerformHealthChecksCommand
    | RequestRecommendedExtensionsCommand
    | SearchMarketplaceCommand
    | LoginCommand
    | LogoutCommand
    | OpenWebsiteCommand
    | OpenSettingsCommand
    | BrowseCoursesCommand
    | ReloadDashboardCommand
    | ShowAllCoursesCommand
    | ViewCourseDetailsCommand
    | OpenExerciseCommand
    | DetectWorkspaceExerciseCommand
    | ShowAiConfigCommand
    | ShowRecommendedExtensionsCommand
    | ShowServiceStatusCommand
    | ShowGitCredentialsCommand
    | ShowStruggleDetectionCommand
    | OpenBugReportCommand
    | ReloadCoursesCommand
    | LoadArchivedCoursesCommand
    | ViewArchivedCourseCommand
    | ReloadCourseDetailCommand
    | OpenExerciseDetailsCommand
    | OpenExamCommand
    | AskIrisAboutCourseCommand
    | ToggleCourseFullscreenCommand
    | OpenInEditorCommand
    | ReloadExerciseDetailCommand
    | BackToCourseDetailsCommand
    | CloneRepositoryCommand
    | OpenRepositoryCommand
    | SubmitExerciseCommand
    | TriggerBuildCommand
    | UploadSubmissionCommand
    | StartExerciseCommand
    | StartPracticeCommand
    | AskIrisAboutExerciseCommand
    | ToggleExerciseFullscreenCommand
    | DownloadFileCommand
    | CheckRepositoryStatusCommand
    | OpenExamExerciseDetailsCommand
    | BackToExamCommand
    | OpenExamInBrowserCommand
    | RefreshExamCommand
    | ReloadExamConductionCommand
    | ErrorMessage;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for extension-to-webview messages.
 * Validates message structure and narrows type.
 */
export function isExtensionMessage(msg: unknown): msg is ExtensionToWebviewMessage {
    return typeof msg === 'object' && msg !== null && 'type' in msg
        && typeof (msg as { type: unknown }).type === 'string'
        && ['init', 'gitCredentialsInit', 'gitCredentialsResult', 'serviceStatusInit', 'healthCheckResults', 'recommendedExtensionsInit', 'showLoading', 'hideLoading', 'updateLoading', 'loginSuccess', 'loginError', 'logoutSuccess', 'showLoggedIn', 'setServerUrl', 'dashboardInit', 'workspaceExerciseDetected', 'courseListInit', 'archivedCoursesLoaded', 'courseDetailInit', 'exerciseDetailInit', 'examConductionInit', 'examStartInit', 'examExerciseDetailInit', 'websocketUpdate', 'websocketDisconnected', 'websocketConnected', 'error'].includes((msg as { type: string }).type);
}

/**
 * Type guard for webview-to-extension messages.
 * Validates message structure and narrows type.
 */
export function isWebviewMessage(msg: unknown): msg is WebviewToExtensionMessage {
    return typeof msg === 'object' && msg !== null && 'type' in msg
        && typeof (msg as { type: unknown }).type === 'string'
        && ['ready', 'command', 'error'].includes((msg as { type: string }).type);
}
