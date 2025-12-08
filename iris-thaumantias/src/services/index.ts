export { ArtemisWebsocketService } from './artemisWebsocketService';
export { ChatDiagnosticsService } from './chatDiagnosticsService';
export { FileMonitorService } from './fileMonitorService';
export { IrisSessionManager } from './irisSessionManager';
export { ContextStore } from './contextStore';
export { ExerciseRegistry, type ExerciseRegistryEntry } from './exerciseRegistry';
export {
    detectWorkspaceExercise,
    findExerciseByRepositoryUrl,
    normalizeRepositoryUrl,
    isExerciseInCurrentWorkspace,
    type DetectedExercise,
    type ExerciseSource
} from './workspaceDetectionService';
