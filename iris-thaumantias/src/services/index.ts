export { ArtemisWebsocketService } from './artemisWebsocketService';
export { ChatDiagnosticsService } from './chatDiagnosticsService';
export { ChatSessionService } from './chatSessionService';
export { ChatMessageService } from './chatMessageService';
export { ChatContextManager } from './chatContextManager';
export { SessionManagementService } from './sessionManagementService';
export { WebSocketMessageHandler } from './websocketMessageHandler';
export { GitService } from './gitService';
export { FileMonitorService } from './fileMonitorService';
export { IrisSessionManager } from './irisSessionManager';
export { ContextStore } from './contextStore';
export { ProviderRegistry } from './ProviderRegistry';
export { ExerciseRegistry, type ExerciseRegistryEntry } from './exerciseRegistry';
export { WebSocketStatusBarService } from './websocketStatusBar';
export { logger, LogLevel, LogCategory, LoggingService } from './loggingService';
export {
    detectWorkspaceExercise,
    findExerciseByRepositoryUrl,
    normalizeRepositoryUrl,
    isExerciseInCurrentWorkspace,
    type DetectedExercise,
    type ExerciseSource
} from './workspaceDetectionService';

// Telemetry services
export * from './telemetry';
