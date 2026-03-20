export { FileMonitorService } from './fileMonitorService';
export { GitService } from './gitService';
export { NoAiDetectionService, type FileExistsChecker } from './noAiDetectionService';
export * from './workspaceFileChecker';
export {
    detectWorkspaceExercise,
    findExerciseByRepositoryUrl,
    normalizeRepositoryUrl,
    getWorkspaceRepositoryUrl,
    getWorkspaceStatus,
    isExerciseInCurrentWorkspace,
    detectAndRegisterWorkspaceExercise,
    detectWorkspaceForRepoUris,
    type DetectedExercise,
    type ExerciseSource,
    type WorkspaceStatus,
} from './workspaceDetectionService';
