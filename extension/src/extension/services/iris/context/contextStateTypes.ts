import type { TrackedCourse, TrackedExercise } from '@extension/types';

/**
 * The persisted store after the conversation-first rewrite: tracked items
 * only. No `activeContext`, no local sessions. `IrisConversationService`
 * owns the open conversation and re-reads it from Artemis, so there is
 * nothing conversation-shaped left to persist.
 */
export interface StoredState {
    version: 3;
    exercises: TrackedExercise[];
    courses: TrackedCourse[];
}
