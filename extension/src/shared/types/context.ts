import type { ExerciseRef } from './exerciseRef';

export type ChatContextType = 'exercise' | 'course';

export type ContextSource =
    | 'workspace-detected'
    | 'user-selected'
    | 'system-default';

export interface ActiveContext {
    type: ChatContextType;
    id: number;
    title: string;
    shortName?: string;
    courseId?: number;
    source: ContextSource;
    locked: boolean;
    selectedAt: number;
}

export interface TrackedExercise extends ExerciseRef {
    releaseDate?: string;
    dueDate?: string;
    lastViewed?: number;
    score?: number;
    repositoryUri?: string;
    isWorkspace?: boolean;
    priority: number;
    lastUpdated: number;
}

export interface TrackedCourse {
    id: number;
    title: string;
    shortName?: string;
    lastViewed?: number;
    priority: number;
    lastUpdated: number;
}

export interface StoredSession {
    id: string;
    contextKey: string;
    preview: string;
    /** LLM-generated session title from Artemis (2-5 words). Falls back to preview when absent. */
    title?: string;
    messageCount: number;
    createdAt: number;
    lastActivity: number;
    /**
     * Artemis-side Iris session ID, cached for session re-initialization.
     * This is the persistence-layer copy. The live WebSocket subscription
     * uses IrisWebSocketSessionClient._currentArtemisSessionId instead.
     * Both are synchronized by IrisChatSessionService.
     */
    artemisSessionId?: number;
}

export interface ContextSnapshot {
    activeContext: ActiveContext | null;
    activeSession: StoredSession | null;
    sessions: StoredSession[];
    recentExercises: TrackedExercise[];
    recentCourses: TrackedCourse[];
    allExercises: TrackedExercise[];
    allCourses: TrackedCourse[];
}
