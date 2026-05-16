export { FileMonitorService } from './fileMonitorService';
export { GitService } from './gitService';
export { NoAiDetectionService } from './noAiDetectionService';
export {
    collectExerciseSources,
    detectAndRegisterWorkspaceExercise,
    type DetectedExercise,
    findExerciseByRepositoryUrl,
    findWorkspaceCourseInArchive,
    getWorkspaceRepositoryUrl,
    getWorkspaceStatus,
    normalizeRepositoryUrl,
} from './workspaceDetectionService';
export * from './workspaceFileChecker';
