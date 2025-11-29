export { ArtemisWebsocketService } from './artemisWebsocketService';
export { BuildErrorCodeLensProvider } from './buildErrorCodeLensProvider';
export { FileMonitorService } from './fileMonitorService';
export { IrisSessionManager } from './irisSessionManager';
export {
    detectWorkspaceExercise,
    findExerciseByRepositoryUrl,
    getWorkspaceRepositoryUrl,
    normalizeRepositoryUrl,
    isExerciseInCurrentWorkspace,
    type DetectedExercise,
    type ExerciseSource
} from './workspaceDetectionService';
