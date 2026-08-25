export { FileMonitorService } from './fileMonitorService';
export { GitService } from './gitService';
export { NoAiDetectionService } from './noAiDetectionService';
export {
    collectExerciseSources,
    type DetectedExercise,
    findExerciseByRepositoryUrl,
    findWorkspaceCourseInArchive,
    getEntryExercises,
    getWorkspaceRepositoryUrl,
    getWorkspaceStatus,
    normalizeRepositoryUrl,
} from './workspaceDetectionService';
export * from './workspaceFileChecker';
