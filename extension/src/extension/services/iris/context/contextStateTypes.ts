import type { ActiveContext, StoredSession, TrackedCourse, TrackedExercise } from '../../../types';

export interface StoredState {
    version: number;
    activeContext: ActiveContext | null;
    activeSessionId: string | null;
    exercises: TrackedExercise[];
    courses: TrackedCourse[];
    sessions: Record<string, StoredSession[]>;
}
