// Auth
export { AuthManager } from './auth';
export { AuthFlowHandler } from './auth';
export { ConsentService, ConsentLevel } from './auth';

// Iris
export { ChatContextManager } from './iris';
export { ChatDiagnosticsService } from './iris';
export { ChatMessageService } from './iris';
export { IrisSessionInitService } from './iris';
export { IrisSessionManager } from './iris';
export { IrisSessionLifecycleService } from './iris';
export { fetchSessionsWithMessages, importSessionsToStore } from './iris';
export { IRIS_CHAT_HELP_MARKDOWN } from './iris';
export type { IrisServiceDeps } from './iris';
export type { ChatContextReason } from './iris';

// WebSocket
export { ArtemisWebsocketService } from './websocket';
export { SubmissionWebSocketHandler } from './websocket';
export { IrisWebSocketMessageHandler } from './websocket';
export { WebSocketStatusBarService } from './websocket';

// Workspace
export { FileMonitorService } from './workspace';
export { GitService } from './workspace';
export { NoAiDetectionService } from './workspace';
export {
    detectWorkspaceExercise,
    findExerciseByRepositoryUrl,
    normalizeRepositoryUrl,
    getWorkspaceRepositoryUrl,
    getWorkspaceStatus,
    isExerciseInCurrentWorkspace,
    detectAndRegisterWorkspaceExercise,
    detectWorkspaceForRepoUris,
    findWorkspaceCourseInArchive,
    collectExerciseSources,
    type DetectedExercise,
    type ExerciseSource,
    type WorkspaceStatus,
} from './workspace';

// UI
export { FullscreenPanelManager } from './ui';
export { ViewInitDataService } from './ui';
export { getReactWebviewHtml } from './ui';

// Exam
export { getExamErrorMessage } from './exam';

// Root-level (shared state & cross-cutting)
export { ContextStore } from './iris';
export { ProviderRegistry, type IProviderRegistry } from './ui';
export { ExerciseRegistry, type ExerciseRegistryEntry } from './exerciseRegistry';
export { logger, LogLevel, LogCategory } from './loggingService';

// Telemetry
export * from './telemetry';
