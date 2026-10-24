export { buildAuthenticatedRepositoryUrl } from './authenticatedRepositoryUrl';
export { FileMonitorService } from './fileMonitorService';
export { GitService } from './gitService';
export { LocalCloneStore } from './localCloneStore';
export { NoAiDetectionService } from './noAiDetectionService';
export {
    type ResolvedParticipation,
    type SubmissionSetupDeps,
    SubmissionSetupService,
} from './submissionSetupService';
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
