import type { ExerciseRef } from './exerciseRef';

/** Where a tracked exercise or course came from. */
export type ContextSource =
    | 'workspace-detected'
    | 'user-selected'
    | 'system-default';

export interface TrackedExercise extends ExerciseRef {
    releaseDate?: string;
    dueDate?: string;
    lastViewed?: number;
    score?: number;
    repositoryUri?: string;
    isWorkspace?: boolean;
}

export interface TrackedCourse {
    id: number;
    title: string;
    shortName?: string;
    lastViewed?: number;
}

/**
 * What the pickers render: the tracked exercises and courses, already sorted
 * for display. There is no active context and no local session list any more;
 * `IrisConversationService` owns the open conversation and its topic.
 */
export interface ContextSnapshot {
    exercises: TrackedExercise[];
    courses: TrackedCourse[];
}
