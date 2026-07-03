import type { ActiveContext } from '@shared/types/context';

/**
 * Minimal interface for ChatWebviewProvider, consumed by ProviderRegistry for dependency inversion.
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
    /** True iff a `.noai` marker disables AI for the workspace (spec §14 case 3). */
    isNoAiEnabled(): boolean;
    /** Resolves once the initial `.noai` workspace scan has completed, so `isNoAiEnabled()` is authoritative. */
    whenNoAiReady(): Promise<void>;
}
