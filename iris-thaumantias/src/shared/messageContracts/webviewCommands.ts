/**
 * Webview -> Extension command contracts.
 */

import type { CourseDashboardCourse, ExerciseDetail } from '../../types/apiResponses';

/** All Webview->Extension command types */
export const WebviewCmd = {
    // Auth
    Login: 'login',
    Logout: 'logout',

    // Navigation
    BackToDashboard: 'backToDashboard',
    BrowseCourses: 'browseCourses',
    ShowAllCourses: 'showAllCourses',
    ViewCourseDetails: 'viewCourseDetails',
    OpenExercise: 'openExercise',
    OpenExerciseDetails: 'openExerciseDetails',
    OpenExamExerciseDetails: 'openExamExerciseDetails',
    BackToCourseDetails: 'backToCourseDetails',
    BackToExam: 'backToExam',

    // Course
    ReloadDashboard: 'reloadDashboard',
    ReloadCourses: 'reloadCourses',
    ReloadCourseDetail: 'reloadCourseDetail',
    LoadArchivedCourses: 'loadArchivedCourses',
    ViewArchivedCourse: 'viewArchivedCourse',
    ToggleCourseFullscreen: 'toggleCourseFullscreen',
    AskIrisAboutCourse: 'askIrisAboutCourse',

    // Exercise
    ReloadExerciseDetail: 'reloadExerciseDetail',
    ToggleFullscreen: 'toggleFullscreen',
    CloneRepository: 'cloneRepository',
    OpenRepository: 'openRepository',
    SubmitExercise: 'submitExercise',
    TriggerBuild: 'triggerBuild',
    StartExercise: 'startExercise',
    StartPractice: 'startPractice',
    AskIrisAboutExercise: 'askIrisAboutExercise',
    CheckRepositoryStatus: 'checkRepositoryStatus',
    DetectWorkspaceExercise: 'detectWorkspaceExercise',

    // Exam
    OpenExam: 'openExam',
    OpenExamInBrowser: 'openExamInBrowser',
    RefreshExam: 'refreshExam',
    ReloadExamConduction: 'reloadExamConduction',

    // Utility
    OpenWebsite: 'openWebsite',
    OpenSettings: 'openSettings',
    OpenBugReport: 'openBugReport',
    OpenInEditor: 'openInEditor',
    CopyToClipboard: 'copyToClipboard',
    OpenExternalLink: 'openExternalLink',
    OpenImagePreview: 'openImagePreview',
    SearchMarketplace: 'searchMarketplace',

    // Git
    SaveGitIdentity: 'saveGitIdentity',
    RequestGitIdentity: 'requestGitIdentity',
    SaveGitCredentials: 'saveGitCredentials',

    // Views
    ShowAiConfig: 'showAiConfig',
    ShowRecommendedExtensions: 'showRecommendedExtensions',
    ShowServiceStatus: 'showServiceStatus',
    ShowGitCredentials: 'showGitCredentials',
    ShowStruggleDetection: 'showStruggleDetection',
    PerformHealthChecks: 'performHealthChecks',

    // Iris Chat
    SendMessage: 'sendMessage',
    SelectChatContext: 'selectChatContext',
    SwitchSession: 'switchSession',
    CreateNewSession: 'createNewSession',
    SwitchToWorkspaceContext: 'switchToWorkspaceContext',
    SwitchContext: 'switchContext',
    ResetChatSessions: 'resetChatSessions',
    ReconnectWebSocket: 'reconnectWebSocket',
    MessageFeedback: 'messageFeedback',
    OpenFile: 'openFile',
    OpenDiagnostics: 'openDiagnostics',
    DebugSessions: 'debugSessions',
    OpenHelpPopup: 'openHelpPopup',

    // Inline commands
    Alert: 'alert',
    ShowSubmissionDetails: 'showSubmissionDetails',
    FetchTestResults: 'fetchTestResults',
    OpenExerciseInBrowser: 'openExerciseInBrowser',
    ViewBuildLog: 'viewBuildLog',
    GoToSourceError: 'goToSourceError',
    FetchBuildLogsForError: 'fetchBuildLogsForError',
    WebviewLog: 'webviewLog',
    ParticipateInExercise: 'participateInExercise',
    OpenClonedRepository: 'openClonedRepository',
    CopyCloneUrl: 'copyCloneUrl',
    PullChanges: 'pullChanges',
    StartExam: 'startExam',
    RenderPlantUmlInline: 'renderPlantUmlInline',

    ViewExercises: 'viewExercises',
    CheckGrades: 'checkGrades',
    OpenRulesInEditor: 'openRulesInEditor',
    RenderPlantUml: 'renderPlantUml',
    OpenPlantUmlInNewTab: 'openPlantUmlInNewTab',
    ClearBuildErrors: 'clearBuildErrors',
} as const;

/** Union of all Webview->Extension command strings */
export type WebviewCmd = (typeof WebviewCmd)[keyof typeof WebviewCmd];

/** Payload definitions -- undefined means no payload */
interface WebviewCmdPayloads {
    // Auth
    login: { username: string; password: string; rememberMe: boolean };
    logout: undefined;

    // Navigation
    backToDashboard: undefined;
    browseCourses: undefined;
    showAllCourses: undefined;
    viewCourseDetails: { courseData: CourseDashboardCourse };
    openExercise: { exerciseId: number; courseId?: number | null };
    openExerciseDetails: { exerciseId: number };
    openExamExerciseDetails: { exercise: ExerciseDetail; exerciseIndex: number; courseId: number; examId: number };
    backToCourseDetails: undefined;
    backToExam: undefined;

    // Course
    reloadDashboard: undefined;
    reloadCourses: undefined;
    reloadCourseDetail: { courseId: number };
    loadArchivedCourses: undefined;
    viewArchivedCourse: { courseId: number };
    toggleCourseFullscreen: undefined;
    askIrisAboutCourse: { courseId: number; courseTitle: string; courseShortName?: string };

    // Exercise
    reloadExerciseDetail: { exerciseId: number };
    toggleFullscreen: undefined;
    cloneRepository: { participationId: number; repositoryUri: string; exerciseTitle: string };
    openRepository: { repositoryUri?: string };
    submitExercise: { participationId: number; exerciseId?: number; exerciseTitle?: string; commitMessage?: string };
    triggerBuild: { participationId: number };
    startExercise: { exerciseId: number };
    startPractice: { exerciseId: number; exerciseTitle?: string };
    askIrisAboutExercise: { exerciseId: number; exerciseTitle: string; exerciseShortName?: string; releaseDate?: string; dueDate?: string; courseId?: number; courseTitle?: string; courseShortName?: string };
    checkRepositoryStatus: { showNotification?: boolean };
    detectWorkspaceExercise: undefined;

    // Exam
    openExam: { examId: number; courseId: number };
    openExamInBrowser: { courseId: number; examId: number };
    refreshExam: { courseId: number; examId: number; studentExamId?: number };
    reloadExamConduction: undefined;

    // Utility
    openWebsite: undefined;
    openSettings: { setting?: string };
    openBugReport: undefined;
    openInEditor: { data: Record<string, unknown> };
    copyToClipboard: { text: string };
    openExternalLink: { url: string };
    openImagePreview: { uri: string };
    searchMarketplace: { extensionId: string };

    // Git
    saveGitIdentity: { name: string; email: string };
    requestGitIdentity: undefined;
    saveGitCredentials: { username?: string; token?: string; serverUrl?: string };

    // Views
    showAiConfig: undefined;
    showRecommendedExtensions: undefined;
    showServiceStatus: undefined;
    showGitCredentials: undefined;
    showStruggleDetection: undefined;
    performHealthChecks: { serverUrl: string };

    // Iris Chat
    sendMessage: { text: string };
    selectChatContext: { context: string; itemId: number; itemName: string; itemShortName?: string };
    switchSession: { sessionId: string };
    createNewSession: undefined;
    switchToWorkspaceContext: undefined;
    switchContext: undefined;
    resetChatSessions: undefined;
    reconnectWebSocket: undefined;
    messageFeedback: { sessionId: number; messageId: number | string; feedback: 'positive' | 'negative' };
    openFile: { filePath: string };
    openDiagnostics: undefined;
    debugSessions: undefined;
    openHelpPopup: undefined;

    // Inline commands
    alert: { text: string };
    showSubmissionDetails: { participationId: number; resultId: number };
    fetchTestResults: { participationId: number; resultId: number };
    openExerciseInBrowser: { exerciseId: number; courseId?: number };
    viewBuildLog: { participationId: number; resultId?: number };
    goToSourceError: { filePath: string; line: number; column?: number };
    fetchBuildLogsForError: { participationId: number; resultId?: number };
    webviewLog: { level: string; text: string; category: string; error?: unknown };
    participateInExercise: { exerciseId: number; exerciseTitle: string };
    openClonedRepository: { exerciseId: number };
    copyCloneUrl: { participationId: number; repositoryUri: string };
    pullChanges: { exerciseTitle: string };
    startExam: { courseId: number; examId: number; studentExamId: number };
    renderPlantUmlInline: { plantUml: string; index: number };

    // Missing commands
    viewExercises: undefined;
    checkGrades: undefined;
    openRulesInEditor: { text: string };
    renderPlantUml: { plantUmlDiagrams: string[]; exerciseTitle?: string };
    openPlantUmlInNewTab: { plantUml: string; index: number };
    clearBuildErrors: undefined;
}

/** Auto-generated command messages */
type WebviewCommandMessages = {
    [K in WebviewCmd]: WebviewCmdPayloads[K] extends undefined
        ? { type: 'command'; command: K }
        : {} extends WebviewCmdPayloads[K]
            ? { type: 'command'; command: K; payload?: WebviewCmdPayloads[K] }
            : { type: 'command'; command: K; payload: WebviewCmdPayloads[K] }
}[WebviewCmd];

/** Full Webview->Extension union (commands + non-command messages) */
export type WebviewToExtensionMessage =
    | { type: 'ready' }
    | { type: 'updatePanelTitle'; title: string }
    | { type: 'error'; payload: { message: string; stack?: string; componentStack?: string } }
    | WebviewCommandMessages;

/**
 * VS Code API interface available in webview context.
 * Acquired via window.acquireVsCodeApi() in webview code.
 */
export interface VsCodeApi {
    postMessage(message: WebviewToExtensionMessage): void;
    getState<T = unknown>(): T | undefined;
    setState<T = unknown>(state: T): void;
}

/** Extract the command string from a webview message (command field for command-type, type otherwise). */
export function getCommand(message: WebviewToExtensionMessage): WebviewCmd | 'ready' | 'updatePanelTitle' | 'error' {
    return message.type === 'command'
        ? (message as { type: 'command'; command: WebviewCmd }).command
        : message.type;
}

/** Post a typed command from webview to extension. */
export function postCommand<K extends WebviewCmd>(
    vscodeApi: VsCodeApi,
    command: K,
    ...args: WebviewCmdPayloads[K] extends undefined
        ? []
        : {} extends WebviewCmdPayloads[K]
            ? [payload?: WebviewCmdPayloads[K]]
            : [payload: WebviewCmdPayloads[K]]
): void {
    const payload = args[0];
    if (payload !== undefined) {
        vscodeApi.postMessage({ type: 'command', command, payload } as WebviewToExtensionMessage);
    } else {
        vscodeApi.postMessage({ type: 'command', command } as WebviewToExtensionMessage);
    }
}

/** Extract a specific command message type */
export type WebCmd<T extends WebviewCmd> = Extract<WebviewToExtensionMessage, { command: T }>;

/** Extract typed payload from a command message. Throws if payload is missing. */
export function getPayload<T extends WebviewToExtensionMessage & { payload?: unknown }>(
    message: WebviewToExtensionMessage
): T extends { payload?: infer P } ? Exclude<P, undefined> : never {
    const raw = (message as Record<string, unknown>).payload;
    if (raw === undefined) {
        const cmd = (message as Record<string, unknown>).command ?? (message as Record<string, unknown>).type;
        throw new Error(`Expected payload on message but got none (command=${String(cmd)})`);
    }
    return raw as ReturnType<typeof getPayload<T>>;
}
