import type { ActiveContext } from '../../shared/types/context';

/**
 * Minimal interface for ChatWebviewProvider as consumed by ProviderRegistry and its callers.
 * Extracted to sever the circular import: ProviderRegistry -> chatWebviewProvider -> services/index -> ProviderRegistry.
 */
export interface IChatWebviewProvider {
    getSelectedContext(): ActiveContext | null;
    updateDetectedExercise(
        exerciseTitle: string,
        exerciseId: number,
        releaseDate?: string,
        dueDate?: string,
        shortName?: string,
        courseId?: number,
    ): void;
    updateDetectedCourse(courseTitle: string, courseId: number, shortName?: string): void;
    setExerciseContext(
        exerciseId: number,
        exerciseTitle: string,
        reason?: string,
        shortName?: string,
        releaseDate?: string,
        dueDate?: string,
        courseId?: number,
    ): void;
    setCourseContext(courseId: number, courseTitle: string, reason?: string, shortName?: string): void;
}
