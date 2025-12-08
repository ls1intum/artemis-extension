export { ArtemisWebsocketService } from './artemisWebsocketService';
export { BuildErrorCodeLensProvider } from './buildErrorCodeLensProvider';
export { ChatDiagnosticsService } from './chatDiagnosticsService';
export { FileMonitorService } from './fileMonitorService';
export { IrisSessionManager } from './irisSessionManager';
export {
    detectWorkspaceExercise,
    findExerciseByRepositoryUrl,
    normalizeRepositoryUrl,
    isExerciseInCurrentWorkspace,
    type DetectedExercise,
    type ExerciseSource
} from './workspaceDetectionService';
