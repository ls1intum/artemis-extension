/**
 * Webview -> Extension command contracts.
 */

import type { AttemptId } from './domainTypes';

/** Non-command webview message types (ready, requestInit, error) */
export const WebviewMsgType = {
    Ready: 'ready',
    RequestInit: 'requestInit',
    Error: 'error',
} as const;

export const WebviewCmd = {
    // Auth
    Login: 'login',
    Logout: 'logout',
    CheckLoginOptions: 'checkLoginOptions',
    StartOidcLogin: 'startOidcLogin',
    CancelLogin: 'cancelLogin',

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
    ReloadWindow: 'reloadWindow',
    OpenBugReport: 'openBugReport',
    OpenInEditor: 'openInEditor',
    CopyToClipboard: 'copyToClipboard',
    SearchMarketplace: 'searchMarketplace',

    // Git
    SaveGitIdentity: 'saveGitIdentity',
    // Internal: dispatched by viewInitDataService, not sent from React UI
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
    ResetChatSessions: 'resetChatSessions',
    // Conversation-first navigation. There is no `UndoNavigation`: the notice
    // `showChatNotice` reports is actionless.
    SelectTopic: 'selectTopic',
    /**
     * Chat-side course refresh. Deliberately NOT `ReloadCourses`: that one is
     * registered only in `navigationCommands.ts`, reachable only through
     * `WebViewMessageHandler` (which only the main panel constructs), and its
     * handler navigates the main panel to the course list. A sidebar click
     * must not do that.
     */
    RefreshCourses: 'refreshCourses',
    OpenConversation: 'openConversation',
    SwitchCourse: 'switchCourse',
    NewConversation: 'newConversation',
    ReconnectWebSocket: 'reconnectWebSocket',
    ReloadChatSession: 'reloadChatSession',
    MessageFeedback: 'messageFeedback',
    OpenFile: 'openFile',
    OpenDiagnostics: 'openDiagnostics',
    OpenHelpPopup: 'openHelpPopup',
    /**
     * The startup-unavailable banner's Retry: re-runs workspace DETECTION,
     * not a conversation reload. `ReloadChatSession` (above) is the
     * unavailable-conversation banner's Retry and reads the OPEN
     * conversation; on this path there may be no workspace exercise at all
     * yet, so a reload would start whatever happens to be left over, or
     * nothing.
     */
    RetryStartupDetection: 'retryStartupDetection',

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

export type WebviewCmd = (typeof WebviewCmd)[keyof typeof WebviewCmd];

/** Payload definitions -- undefined means no payload */
interface WebviewCmdPayloads {
    // Auth
    login: { username: string; password: string; rememberMe: boolean; attemptId: AttemptId };
    logout: undefined;
    checkLoginOptions: { username: string; attemptId: AttemptId };
    startOidcLogin: { rememberMe: boolean };
    cancelLogin: undefined;

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
    reloadWindow: undefined;
    openSettings: { setting: string };
    openBugReport: undefined;
    openInEditor: { data: Record<string, unknown> | string; language?: string };
    copyToClipboard: { text: string };
    searchMarketplace: { extensionId: string };

    // Recording
    openRecordingsFolder: undefined;
    replaySession: undefined;

    // Git
    saveGitIdentity: { name: string; email: string };
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
     * is open when the command is handled.
     */
    sendMessage: { text: string; localId: string; sessionId: number };
    resetChatSessions: undefined;
    /**
     * Topic-based navigation for the picker, the chip's remove icon and the
     * Ask-Iris commands. `mode`/`entityId` name the target `ServerContext`;
     * `name` is a display hint the webview already knows and the host does
     * not need to re-fetch.
     */
    selectTopic: { mode: string; entityId: number; name?: string };
    /** Id-based navigation for the history popover. Never consults the topic index. */
    openConversation: { courseId: number; sessionId: number };
    /** No session id yet, so it acquires first; lands on an empty course conversation. */
    switchCourse: { courseId: number };
    /** Asks the host to fetch the dashboard course list into the store and re-post the snapshot. */
    refreshCourses: undefined;
    /** Header `+`. No payload: the current course is read host-side. */
    newConversation: undefined;
    reconnectWebSocket: undefined;
    reloadChatSession: undefined;
    messageFeedback: { sessionId: number; messageId: number; feedback: 'positive' | 'negative' };
    openFile: { filePath: string };
    openDiagnostics: undefined;
    openHelpPopup: undefined;
    retryStartupDetection: undefined;

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
    WebviewCmd.CheckLoginOptions,
    WebviewCmd.StartOidcLogin,
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
    WebviewCmd.SearchMarketplace,
    WebviewCmd.OpenSettings,
    WebviewCmd.SaveGitIdentity,
    WebviewCmd.PerformHealthChecks,
    WebviewCmd.SendMessage,
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
    WebviewCmd.SelectTopic,
    WebviewCmd.OpenConversation,
    WebviewCmd.SwitchCourse,
    // NewConversation is deliberately absent: it carries no payload.
]);

type WebviewCommandMessages = {
    [K in WebviewCmd]: WebviewCmdPayloads[K] extends undefined
        ? { type: 'command'; command: K }
        : {} extends WebviewCmdPayloads[K]
            ? { type: 'command'; command: K; payload?: WebviewCmdPayloads[K] }
            : { type: 'command'; command: K; payload: WebviewCmdPayloads[K] }
}[WebviewCmd];

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

export type TestResultsOverviewOpenedPayload = WebviewCmdPayloads['testResultsOverviewOpened'];
export type TestResultsOverviewClosedPayload = WebviewCmdPayloads['testResultsOverviewClosed'];
export type TaskFeedbackOpenedPayload = WebviewCmdPayloads['taskFeedbackOpened'];
export type TaskFeedbackClosedPayload = WebviewCmdPayloads['taskFeedbackClosed'];

export type ProblemStatementScrollPayload = WebviewCmdPayloads['problemStatementScroll'];
export type ProblemStatementSelectionPayload = WebviewCmdPayloads['problemStatementSelection'];
