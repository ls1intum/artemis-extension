export type ChatContextType = 'exercise' | 'course' | 'lecture' | 'general';

export type ContextSource =
    | 'workspace-detected'
    | 'user-selected'
    | 'system-default';

export interface ActiveContext {
    type: ChatContextType;
    id: number;
    title: string;
    shortName?: string;
    source: ContextSource;
    locked: boolean;
    selectedAt: number;
}

export interface TrackedExercise {
    id: number;
    title: string;
    shortName?: string;
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
    messageCount: number;
    createdAt: number;
    lastActivity: number;
    artemisSessionId?: number; // The Iris session ID from the backend
    messages?: any[]; // Cached messages from Artemis
    messagesLoadedAt?: number; // Timestamp when messages were fetched
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
