/**
 * Backward compatibility type aliases.
 */

import type { ExtMsg } from './extensionMessages';
import type { WebviewToExtensionMessage } from './webviewCommands';

// Extension->Webview message aliases
export type GenericInitMessage = ExtMsg<'init'>;
export type LoginSuccessMessage = ExtMsg<'loginSuccess'>;
export type LoginErrorMessage = ExtMsg<'loginError'>;
export type LogoutSuccessMessage = ExtMsg<'logoutSuccess'>;
export type ShowLoggedInMessage = ExtMsg<'showLoggedIn'>;
export type DashboardInitMessage = ExtMsg<'dashboardInit'>;
export type GitCredentialsInitMessage = ExtMsg<'gitCredentialsInit'>;
export type GitCredentialsResultMessage = ExtMsg<'gitCredentialsResult'>;
export type ServiceStatusInitMessage = ExtMsg<'serviceStatusInit'>;
export type HealthCheckResultsMessage = ExtMsg<'healthCheckResults'>;
export type RecommendedExtensionsInitMessage = ExtMsg<'recommendedExtensionsInit'>;
export type AiConfigInitMessage = ExtMsg<'aiConfigInit'>;
export type StruggleDetectionInitMessage = ExtMsg<'struggleDetectionInit'>;
export type WebSocketUpdateMessage = ExtMsg<'websocketUpdate'>;
export type IrisChatStateMessage = ExtMsg<'updateIrisState'>;
export type CourseDetailInitMessage = ExtMsg<'courseDetailInit'>;
export type ExerciseDetailInitMessage = ExtMsg<'exerciseDetailInit'>;
export type WorkspaceExerciseDetectedMessage = ExtMsg<'workspaceExerciseDetected'>;
export type ExamConductionInitMessage = ExtMsg<'examConductionInit'>;
export type ExamStartInitMessage = ExtMsg<'examStartInit'>;
export type ExamExerciseDetailInitMessage = ExtMsg<'examExerciseDetailInit'>;
export type CourseListInitMessage = ExtMsg<'courseListInit'>;
export type WebSocketDisconnectedMessage = ExtMsg<'websocketDisconnected'>;
export type WebSocketConnectedMessage = ExtMsg<'websocketConnected'>;
export type IrisChatAddMessage = ExtMsg<'addMessage'>;
export type IrisChatLoadMessages = ExtMsg<'loadMessages'>;
export type ReadyMessage = Extract<WebviewToExtensionMessage, { type: 'ready' }>;
export type ErrorMessage = Extract<WebviewToExtensionMessage, { type: 'error' }>;

// Command type aliases for commonly imported command interfaces
export type LoginCommand = Extract<WebviewToExtensionMessage, { command: 'login' }>;
export type LogoutCommand = Extract<WebviewToExtensionMessage, { command: 'logout' }>;
export type PerformHealthChecksCommand = Extract<WebviewToExtensionMessage, { command: 'performHealthChecks' }>;
export type RenderPlantUmlInlineCommand = Extract<WebviewToExtensionMessage, { command: 'renderPlantUmlInline' }>;
export type AskIrisAboutExerciseCommand = Extract<WebviewToExtensionMessage, { command: 'askIrisAboutExercise' }>;
export type AskIrisAboutCourseCommand = Extract<WebviewToExtensionMessage, { command: 'askIrisAboutCourse' }>;
export type SaveGitIdentityCommand = Extract<WebviewToExtensionMessage, { command: 'saveGitIdentity' }>;
export type CheckRepositoryStatusCommand = Extract<WebviewToExtensionMessage, { command: 'checkRepositoryStatus' }>;
export type CloneRepositoryCommand = Extract<WebviewToExtensionMessage, { command: 'cloneRepository' }>;
export type SubmitExerciseCommand = Extract<WebviewToExtensionMessage, { command: 'submitExercise' }>;
export type StartExerciseCommand = Extract<WebviewToExtensionMessage, { command: 'startExercise' }>;
export type StartPracticeCommand = Extract<WebviewToExtensionMessage, { command: 'startPractice' }>;
export type OpenRepositoryCommand = Extract<WebviewToExtensionMessage, { command: 'openRepository' }>;
export type CopyToClipboardCommand = Extract<WebviewToExtensionMessage, { command: 'copyToClipboard' }>;
export type OpenSettingsCommand = Extract<WebviewToExtensionMessage, { command: 'openSettings' }>;
export type SearchMarketplaceCommand = Extract<WebviewToExtensionMessage, { command: 'searchMarketplace' }>;
export type OpenInEditorCommand = Extract<WebviewToExtensionMessage, { command: 'openInEditor' }>;
export type OpenExternalLinkCommand = Extract<WebviewToExtensionMessage, { command: 'openExternalLink' }>;
export type OpenImagePreviewCommand = Extract<WebviewToExtensionMessage, { command: 'openImagePreview' }>;
export type OpenExamCommand = Extract<WebviewToExtensionMessage, { command: 'openExam' }>;
export type OpenExamInBrowserCommand = Extract<WebviewToExtensionMessage, { command: 'openExamInBrowser' }>;
export type ViewCourseDetailsCommand = Extract<WebviewToExtensionMessage, { command: 'viewCourseDetails' }>;
export type OpenExerciseDetailsCommand = Extract<WebviewToExtensionMessage, { command: 'openExerciseDetails' }>;
export type OpenExamExerciseDetailsCommand = Extract<WebviewToExtensionMessage, { command: 'openExamExerciseDetails' }>;
export type ReloadCourseDetailCommand = Extract<WebviewToExtensionMessage, { command: 'reloadCourseDetail' }>;
export type ReloadExerciseDetailCommand = Extract<WebviewToExtensionMessage, { command: 'reloadExerciseDetail' }>;
export type ViewArchivedCourseCommand = Extract<WebviewToExtensionMessage, { command: 'viewArchivedCourse' }>;
export type OpenExerciseCommand = Extract<WebviewToExtensionMessage, { command: 'openExercise' }>;
export type RefreshExamCommand = Extract<WebviewToExtensionMessage, { command: 'refreshExam' }>;
export type ReloadExamConductionCommand = Extract<WebviewToExtensionMessage, { command: 'reloadExamConduction' }>;
export type BackToDashboardCommand = Extract<WebviewToExtensionMessage, { command: 'backToDashboard' }>;
export type ReloadCoursesCommand = Extract<WebviewToExtensionMessage, { command: 'reloadCourses' }>;
export type SendMessageCommand = Extract<WebviewToExtensionMessage, { command: 'sendMessage' }>;
export type SelectChatContextCommand = Extract<WebviewToExtensionMessage, { command: 'selectChatContext' }>;
export type ReconnectWebSocketCommand = Extract<WebviewToExtensionMessage, { command: 'reconnectWebSocket' }>;
export type RenderPlantUmlCommand = Extract<WebviewToExtensionMessage, { command: 'renderPlantUml' }>;
export type OpenPlantUmlInNewTabCommand = Extract<WebviewToExtensionMessage, { command: 'openPlantUmlInNewTab' }>;
export type ParticipateInExerciseCommand = Extract<WebviewToExtensionMessage, { command: 'participateInExercise' }>;
export type OpenClonedRepositoryCommand = Extract<WebviewToExtensionMessage, { command: 'openClonedRepository' }>;
export type CopyCloneUrlCommand = Extract<WebviewToExtensionMessage, { command: 'copyCloneUrl' }>;
export type PullChangesCommand = Extract<WebviewToExtensionMessage, { command: 'pullChanges' }>;
export type SaveGitCredentialsCommand = Extract<WebviewToExtensionMessage, { command: 'saveGitCredentials' }>;
export type AlertCommand = Extract<WebviewToExtensionMessage, { command: 'alert' }>;
export type ShowSubmissionDetailsCommand = Extract<WebviewToExtensionMessage, { command: 'showSubmissionDetails' }>;
export type FetchTestResultsCommand = Extract<WebviewToExtensionMessage, { command: 'fetchTestResults' }>;
export type OpenExerciseInBrowserCommand = Extract<WebviewToExtensionMessage, { command: 'openExerciseInBrowser' }>;
export type ViewBuildLogCommand = Extract<WebviewToExtensionMessage, { command: 'viewBuildLog' }>;
export type GoToSourceErrorCommand = Extract<WebviewToExtensionMessage, { command: 'goToSourceError' }>;
export type FetchBuildLogsForErrorCommand = Extract<WebviewToExtensionMessage, { command: 'fetchBuildLogsForError' }>;
export type WebviewLogCommand = Extract<WebviewToExtensionMessage, { command: 'webviewLog' }>;
export type StartExamCommand = Extract<WebviewToExtensionMessage, { command: 'startExam' }>;
