export { FileMonitorService } from './fileMonitorService';
export { GitService } from './gitService';
export { NoAiDetectionService } from './noAiDetectionService';
export {
    collectExerciseSources,
    detectAndRegisterWorkspaceExercise,
    type DetectedExercise,
    findExerciseByRepositoryUrl,
    findWorkspaceCourseInArchive,
    getEntryExercises,
    getWorkspaceRepositoryUrl,
    getWorkspaceStatus,
    normalizeRepositoryUrl,
    toExerciseSource,
} from './workspaceDetectionService';
export * from './workspaceFileChecker';
