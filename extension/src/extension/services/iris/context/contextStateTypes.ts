import type { ActiveContext, StoredSession, TrackedCourse, TrackedExercise } from '@extension/types';

export interface StoredState {
    version: number;
    activeContext: ActiveContext | null;
    activeSessionId: string | null;
    exercises: TrackedExercise[];
    courses: TrackedCourse[];
    sessions: Record<string, StoredSession[]>;
}

/**
 * The shape after the conversation-first rewrite. No sessions, no active
 * context. Lives alongside `StoredState` (v2) until Task 15 raises
 * `STORE_VERSION` to 3, tightens `parseStoredState` to this shape, and
 * removes the last reader of `activeContext`.
 */
export interface StoredStateV3 {
    version: 3;
    exercises: TrackedExercise[];
    courses: TrackedCourse[];
}
