export { FileMonitorService } from './fileMonitorService';
export { GitService } from './gitService';
export { NoAiDetectionService } from './noAiDetectionService';
export * from './workspaceFileChecker';
export {
    findExerciseByRepositoryUrl,
    normalizeRepositoryUrl,
    getWorkspaceRepositoryUrl,
    getWorkspaceStatus,
    detectAndRegisterWorkspaceExercise,
    findWorkspaceCourseInArchive,
    collectExerciseSources,
    type DetectedExercise,
} from './workspaceDetectionService';
