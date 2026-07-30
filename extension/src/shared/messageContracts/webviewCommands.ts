/**
 * Webview -> Extension command contracts.
 */

import type { ChatContextType } from '@shared/types/context';

/** Non-command webview message types (ready, requestInit, error) */
export const WebviewMsgType = {
    Ready: 'ready',
    RequestInit: 'requestInit',
    Error: 'error',
} as const;

/** All Webview->Extension command types */
export const WebviewCmd = {
    // Auth
    Login: 'login',
    Logout: 'logout',

    // Navigation
    BackToDashboard: 'backToDashboard',
    ShowAllCourses: 'showAllCourses',
    ViewCourseDetails: 'viewCourseDetails',
    OpenExercise: 'openExercise',
    OpenExerciseDetails: 'openExerciseDetails',
    BackToCourseDetails: 'backToCourseDetails',

    // Course
    ReloadDashboard: 'reloadDashboard',
    ReloadCourses: 'reloadCourses',
    ReloadCourseDetail: 'reloadCourseDetail',
    LoadArchivedCourses: 'loadArchivedCourses',
    ViewArchivedCourse: 'viewArchivedCourse',
    ToggleCourseFullscreen: 'toggleCourseFullscreen',
    ToggleCourseListFullscreen: 'toggleCourseListFullscreen',
    AskIrisAboutCourse: 'askIrisAboutCourse',

    // Exercise
    ReloadExerciseDetail: 'reloadExerciseDetail',
    ToggleFullscreen: 'toggleFullscreen',
    CloneRepository: 'cloneRepository',
    CopyAuthenticatedCloneUrl: 'copyAuthenticatedCloneUrl',
    OpenRepository: 'openRepository',
    OpenClonedRepository: 'openClonedRepository',
    SubmitExercise: 'submitExercise',
    StartExercise: 'startExercise',
    StartPractice: 'startPractice',
    AskIrisAboutExercise: 'askIrisAboutExercise',
    CheckRepositoryStatus: 'checkRepositoryStatus',
    ViewBuildLog: 'viewBuildLog',
    GoToSource: 'goToSource',

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
    // Internal: dispatched by viewInitDataService, not sent from React UI
    RequestGitIdentity: 'requestGitIdentity',
    // Recording
    OpenRecordingsFolder: 'openRecordingsFolder',
    ReplaySession: 'replaySession',

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
    OpenArtemisSession: 'openArtemisSession',
    RequestCourseHistory: 'requestCourseHistory',
    CreateNewSession: 'createNewSession',
    SwitchToWorkspaceContext: 'switchToWorkspaceContext',
    ResetChatSessions: 'resetChatSessions',
    ReconnectWebSocket: 'reconnectWebSocket',
    ReloadChatSession: 'reloadChatSession',
    ReloadActiveSession: 'reloadActiveSession',
    MessageFeedback: 'messageFeedback',
    OpenFile: 'openFile',
    OpenDiagnostics: 'openDiagnostics',
    DebugSessions: 'debugSessions',
    OpenHelpPopup: 'openHelpPopup',

    // Dev tools
    FreshSsrPreview: 'freshSsrPreview',

    // Test-results tracking
    TestResultsOverviewOpened: 'testResultsOverviewOpened',
    TestResultsOverviewClosed: 'testResultsOverviewClosed',
    TaskFeedbackOpened: 'taskFeedbackOpened',
    TaskFeedbackClosed: 'taskFeedbackClosed',

    // Problem-statement tracking
    ProblemStatementScroll: 'problemStatementScroll',
    ProblemStatementSelection: 'problemStatementSelection',
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
    showAllCourses: undefined;
    viewCourseDetails: { courseId: number };
    openExercise: { exerciseId: number; courseId?: number | null };
    openExerciseDetails: { exerciseId: number };
    backToCourseDetails: undefined;

    // Course
    reloadDashboard: undefined;
    reloadCourses: undefined;
    reloadCourseDetail: { courseId: number };
    loadArchivedCourses: undefined;
    viewArchivedCourse: { courseId: number };
    toggleCourseFullscreen: undefined;
    toggleCourseListFullscreen: undefined;
    askIrisAboutCourse: { courseId: number; courseTitle: string; courseShortName?: string };

    // Exercise
    reloadExerciseDetail: { exerciseId: number };
    toggleFullscreen: undefined;
    cloneRepository: { participationId: number; repositoryUri: string; exerciseTitle: string };
    copyAuthenticatedCloneUrl: { participationId: number; repositoryUri: string };
    openRepository: { repositoryUri?: string };
    openClonedRepository: { participationId: number };
    submitExercise: { participationId: number; exerciseId?: number; exerciseTitle?: string; commitMessage?: string };
    startExercise: { exerciseId: number };
    startPractice: { exerciseId: number; exerciseTitle?: string };
    askIrisAboutExercise: { exerciseId: number; exerciseTitle: string; exerciseShortName?: string; releaseDate?: string; dueDate?: string; courseId?: number; courseTitle?: string; courseShortName?: string };
    checkRepositoryStatus: undefined;
    viewBuildLog: { participationId: number; resultId?: number };
    goToSource: { participationId: number; resultId?: number };

    // Utility
    openWebsite: { path?: string };
    openSettings: { setting: string };
    openBugReport: undefined;
    openInEditor: { data: Record<string, unknown> | string; language?: string };
    copyToClipboard: { text: string };
    openExternalLink: { url: string };
    openImagePreview: { uri: string };
    searchMarketplace: { extensionId: string };

    // Recording
    openRecordingsFolder: undefined;
    replaySession: undefined;

    // Git
    saveGitIdentity: { name: string; email: string };
    requestGitIdentity: undefined;
    // Views
    showAiConfig: undefined;
    showRecommendedExtensions: undefined;
    showServiceStatus: undefined;
    showGitCredentials: undefined;
    showStruggleDetection: undefined;
    performHealthChecks: { serverUrl: string };

    // Iris Chat
    /**
     * `sessionId` names the conversation the optimistic bubble was drawn in,
     * so the host can fail it against the ORIGIN session rather than whatever
     * is open when the command is handled. Optional here because Task 10 is
     * additive; a later task makes it required alongside the rest of the
     * conversation-first wire contract.
     */
    sendMessage: { text: string; localId: string; localSessionId: string; sessionId?: number };
    selectChatContext: { context: ChatContextType; itemId: number; itemName: string; itemShortName?: string };
    switchSession: { sessionId: string };
    openArtemisSession: { courseId: number; artemisSessionId: number };
    /**
     * Requests the course-wide history popover's contents. `requestId` is a
     * webview-generated monotonic counter, bumped on every open/retry, so the
     * store can drop a response that no longer matches the latest request
     * (e.g. a slow Course-A fetch answering after the user switched to
     * Course-B).
     */
    requestCourseHistory: { courseId: number; requestId: number };
    createNewSession: undefined;
    switchToWorkspaceContext: undefined;
    resetChatSessions: undefined;
    reconnectWebSocket: undefined;
    reloadChatSession: undefined;
    reloadActiveSession: undefined;
    messageFeedback: { sessionId: number; messageId: number; feedback: 'positive' | 'negative' };
    openFile: { filePath: string };
    openDiagnostics: undefined;
    debugSessions: undefined;
    openHelpPopup: undefined;

    // Dev tools
    freshSsrPreview: { darkMode: boolean };

    // Test-results tracking
    testResultsOverviewOpened: {
        viewId: string;
        exerciseId: number;
        participationId?: number;
        resultId?: number;
        totalTests: number;
        passedTests: number;
        failedTests: number;
    };
    testResultsOverviewClosed: {
        viewId: string;
        exerciseId: number;
        participationId?: number;
        resultId?: number;
        durationMs: number;
        closeReason: 'button' | 'escape';
    };
    taskFeedbackOpened: {
        viewId: string;
        exerciseId: number;
        participationId?: number;
        resultId?: number;
        taskName: string;
        testIds: number[];
        totalTests: number;
        passedTests: number;
        failedTests: number;
        notExecutedTests?: number;
    };
    taskFeedbackClosed: {
        viewId: string;
        exerciseId: number;
        participationId?: number;
        resultId?: number;
        taskName: string;
        durationMs: number;
        closeReason: 'button' | 'escape';
    };

    // Problem-statement tracking
    problemStatementScroll: {
        scrollTop: number;
        scrollHeight: number;
        viewportHeight: number;
        statementTop: number;
        statementHeight: number;
    };
    problemStatementSelection: {
        selectedText: string;
        selectionLength: number;
        truncated: boolean;
        selectionTop: number;
        selectionLeft: number;
        selectionWidth: number;
        selectionHeight: number;
    };
}

/** Commands that require a non-undefined payload object. */
export const COMMANDS_REQUIRING_PAYLOAD = new Set<string>([
    WebviewCmd.Login,
    WebviewCmd.ViewCourseDetails,
    WebviewCmd.OpenExercise,
    WebviewCmd.OpenExerciseDetails,
    WebviewCmd.ReloadCourseDetail,
    WebviewCmd.AskIrisAboutCourse,
    WebviewCmd.ReloadExerciseDetail,
    WebviewCmd.CloneRepository,
    WebviewCmd.CopyAuthenticatedCloneUrl,
    WebviewCmd.SubmitExercise,
    WebviewCmd.StartExercise,
    WebviewCmd.StartPractice,
    WebviewCmd.AskIrisAboutExercise,
    WebviewCmd.OpenInEditor,
    WebviewCmd.CopyToClipboard,
    WebviewCmd.OpenExternalLink,
    WebviewCmd.OpenImagePreview,
    WebviewCmd.SearchMarketplace,
    WebviewCmd.OpenSettings,
    WebviewCmd.SaveGitIdentity,
    WebviewCmd.PerformHealthChecks,
    WebviewCmd.SendMessage,
    WebviewCmd.SelectChatContext,
    WebviewCmd.SwitchSession,
    WebviewCmd.OpenArtemisSession,
    WebviewCmd.RequestCourseHistory,
    WebviewCmd.MessageFeedback,
    WebviewCmd.OpenFile,
    WebviewCmd.ViewArchivedCourse,
    WebviewCmd.FreshSsrPreview,
    WebviewCmd.ViewBuildLog,
    WebviewCmd.GoToSource,
    WebviewCmd.OpenClonedRepository,
    WebviewCmd.TestResultsOverviewOpened,
    WebviewCmd.TestResultsOverviewClosed,
    WebviewCmd.TaskFeedbackOpened,
    WebviewCmd.TaskFeedbackClosed,
    WebviewCmd.ProblemStatementScroll,
    WebviewCmd.ProblemStatementSelection,
]);

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
    | { type: typeof WebviewMsgType.Ready }
    | { type: typeof WebviewMsgType.RequestInit }
    | { type: typeof WebviewMsgType.Error; payload: { message: string; stack?: string; componentStack?: string } }
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
export function getCommand(message: WebviewToExtensionMessage): WebviewCmd | typeof WebviewMsgType[keyof typeof WebviewMsgType] {
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

/** Request re-send of init data from the extension (e.g. error recovery). */
export function requestInit(vscodeApi: VsCodeApi): void {
    vscodeApi.postMessage({ type: WebviewMsgType.RequestInit } as WebviewToExtensionMessage);
}

/** Extract a specific command message type */
export type WebCmd<T extends WebviewCmd> = Extract<WebviewToExtensionMessage, { command: T }>;

/** Extract typed payload from a command message. Throws if payload is missing. */
export function getPayload<T extends WebviewToExtensionMessage & { payload?: unknown }>(
    message: WebviewToExtensionMessage
): T extends { payload?: infer P } ? Exclude<P, undefined> : never {
    if (!('payload' in message) || (message as { payload?: unknown }).payload === undefined) {
        const cmd = 'command' in message ? (message as { command: string }).command : message.type;
        throw new Error(`Expected payload on message but got none (command=${String(cmd)})`);
    }
    return (message as { payload: unknown }).payload as ReturnType<typeof getPayload<T>>;
}

/** Extract typed payload from a command message. Returns undefined if payload is missing. */
export function getOptionalPayload<T extends WebviewToExtensionMessage & { payload?: unknown }>(
    message: WebviewToExtensionMessage
): (T extends { payload?: infer P } ? P : never) | undefined {
    if (!('payload' in message) || (message as { payload?: unknown }).payload === undefined) {
        return undefined;
    }
    return (message as { payload: unknown }).payload as T extends { payload?: infer P } ? P : never;
}

/** Named payload type aliases for test-results tracking commands */
export type TestResultsOverviewOpenedPayload = WebviewCmdPayloads['testResultsOverviewOpened'];
export type TestResultsOverviewClosedPayload = WebviewCmdPayloads['testResultsOverviewClosed'];
export type TaskFeedbackOpenedPayload = WebviewCmdPayloads['taskFeedbackOpened'];
export type TaskFeedbackClosedPayload = WebviewCmdPayloads['taskFeedbackClosed'];

/** Named payload type aliases for problem-statement tracking commands */
export type ProblemStatementScrollPayload = WebviewCmdPayloads['problemStatementScroll'];
export type ProblemStatementSelectionPayload = WebviewCmdPayloads['problemStatementSelection'];
