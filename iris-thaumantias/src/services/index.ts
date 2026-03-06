export { ArtemisWebsocketService } from './artemisWebsocketService';
export { ChatDiagnosticsService } from './chatDiagnosticsService';
export { ChatSessionService } from './chatSessionService';
export { ChatMessageService } from './chatMessageService';
export { ChatContextManager } from './chatContextManager';
export { SessionManagementService } from './sessionManagementService';
export { IrisWebSocketMessageHandler } from './websocketMessageHandler';
export { GitService } from './gitService';
export { FileMonitorService } from './fileMonitorService';
export { IrisSessionManager } from './irisSessionManager';
export { ContextStore } from './contextStore';
export { ProviderRegistry } from './ProviderRegistry';
export { ExerciseRegistry, type ExerciseRegistryEntry } from './exerciseRegistry';
export { WebSocketStatusBarService } from './websocketStatusBar';
export { logger, LogLevel, LogCategory } from './loggingService';
export { NoAiDetectionService } from './noAiDetectionService';
export { ViewInitDataService } from './viewInitDataService';
export { ConsentService, ConsentLevel } from './consentService';
export {
    detectWorkspaceExercise,
    findExerciseByRepositoryUrl,
    normalizeRepositoryUrl,
    getWorkspaceRepositoryUrl,
    getWorkspaceStatus,
    isExerciseInCurrentWorkspace,
    detectAndRegisterWorkspaceExercise,
    type DetectedExercise,
    type ExerciseSource,
    type WorkspaceStatus,
} from './workspaceDetectionService';

// Telemetry services
export * from './telemetry';
