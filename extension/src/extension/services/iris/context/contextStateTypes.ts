import type { ActiveContext, StoredSession, TrackedCourse, TrackedExercise } from '../../../types';

export interface StoredState {
    version: number;
    activeContext: ActiveContext | null;
    activeSessionId: string | null;
    recentExercises: TrackedExercise[];
    recentCourses: TrackedCourse[];
    allExercises: TrackedExercise[];
    allCourses: TrackedCourse[];
    sessions: Record<string, StoredSession[]>;
}
