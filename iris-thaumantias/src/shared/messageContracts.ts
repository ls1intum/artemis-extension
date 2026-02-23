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
        && ['init', 'gitCredentialsInit', 'gitCredentialsResult', 'serviceStatusInit', 'healthCheckResults', 'recommendedExtensionsInit', 'showLoading', 'hideLoading', 'updateLoading', 'loginSuccess', 'loginError', 'logoutSuccess', 'showLoggedIn', 'setServerUrl', 'dashboardInit', 'workspaceExerciseDetected', 'courseListInit', 'archivedCoursesLoaded', 'error'].includes((msg as { type: string }).type);
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
