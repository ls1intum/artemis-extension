/**
 * Minimal exercise identity shared across extension host and webview.
 * All exercise-related types (ExerciseRegistryEntry, ContextItem,
 * DetectedExercise) extend this common base.
 */
export interface ExerciseRef {
    id: number;
    title: string;
    shortName?: string;
    courseId?: number;
}
