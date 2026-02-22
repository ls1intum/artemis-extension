import type { ChatContextType, ContextSource } from '../types/context';

// ============================================================================
// Phase 2: Context/Session Model Classes (all with fromJSON)
// ============================================================================

export class ActiveContext {
    constructor(
        public readonly type: ChatContextType,
        public readonly id: number,
        public readonly title: string,
        public readonly source: ContextSource,
        public readonly locked: boolean,
        public readonly selectedAt: number,
        public readonly shortName?: string,
        public readonly courseId?: number,
    ) {}

    static fromJSON(data: unknown): ActiveContext {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid ActiveContext data');
        }
        const d = data as Record<string, unknown>;
        return new ActiveContext(
            String(d.type) as ChatContextType,
            Number(d.id),
            String(d.title),
            String(d.source) as ContextSource,
            Boolean(d.locked),
            Number(d.selectedAt),
            typeof d.shortName === 'string' ? d.shortName : undefined,
            typeof d.courseId === 'number' ? d.courseId : undefined,
        );
    }
}

export class TrackedExercise {
    constructor(
        public readonly id: number,
        public readonly title: string,
        public readonly priority: number,
        public readonly lastUpdated: number,
        public readonly shortName?: string,
        public readonly courseId?: number,
        public readonly releaseDate?: string,
        public readonly dueDate?: string,
        public readonly lastViewed?: number,
        public readonly score?: number,
        public readonly repositoryUri?: string,
        public readonly isWorkspace?: boolean,
    ) {}

    static fromJSON(data: unknown): TrackedExercise {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid TrackedExercise data');
        }
        const d = data as Record<string, unknown>;
        return new TrackedExercise(
            Number(d.id),
            String(d.title),
            Number(d.priority),
            Number(d.lastUpdated),
            typeof d.shortName === 'string' ? d.shortName : undefined,
            typeof d.courseId === 'number' ? d.courseId : undefined,
            typeof d.releaseDate === 'string' ? d.releaseDate : undefined,
            typeof d.dueDate === 'string' ? d.dueDate : undefined,
            typeof d.lastViewed === 'number' ? d.lastViewed : undefined,
            typeof d.score === 'number' ? d.score : undefined,
            typeof d.repositoryUri === 'string' ? d.repositoryUri : undefined,
            typeof d.isWorkspace === 'boolean' ? d.isWorkspace : undefined,
        );
    }
}

export class TrackedCourse {
    constructor(
        public readonly id: number,
        public readonly title: string,
        public readonly priority: number,
        public readonly lastUpdated: number,
        public readonly shortName?: string,
        public readonly lastViewed?: number,
    ) {}

    static fromJSON(data: unknown): TrackedCourse {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid TrackedCourse data');
        }
        const d = data as Record<string, unknown>;
        return new TrackedCourse(
            Number(d.id),
            String(d.title),
            Number(d.priority),
            Number(d.lastUpdated),
            typeof d.shortName === 'string' ? d.shortName : undefined,
            typeof d.lastViewed === 'number' ? d.lastViewed : undefined,
        );
    }
}

export class StoredSession {
    constructor(
        public readonly id: string,
        public readonly contextKey: string,
        public readonly preview: string,
        public readonly messageCount: number,
        public readonly createdAt: number,
        public readonly lastActivity: number,
        public readonly artemisSessionId?: number,
    ) {}

    static fromJSON(data: unknown): StoredSession {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid StoredSession data');
        }
        const d = data as Record<string, unknown>;
        return new StoredSession(
            String(d.id),
            String(d.contextKey),
            String(d.preview),
            Number(d.messageCount),
            Number(d.createdAt),
            Number(d.lastActivity),
            typeof d.artemisSessionId === 'number' ? d.artemisSessionId : undefined,
        );
    }
}

export class ContextSnapshot {
    constructor(
        public readonly activeContext: ActiveContext | null,
        public readonly activeSession: StoredSession | null,
        public readonly sessions: StoredSession[],
        public readonly recentExercises: TrackedExercise[],
        public readonly recentCourses: TrackedCourse[],
        public readonly allExercises: TrackedExercise[],
        public readonly allCourses: TrackedCourse[],
    ) {}

    static fromJSON(data: unknown): ContextSnapshot {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid ContextSnapshot data');
        }
        const d = data as Record<string, unknown>;
        return new ContextSnapshot(
            d.activeContext && typeof d.activeContext === 'object' ? ActiveContext.fromJSON(d.activeContext) : null,
            d.activeSession && typeof d.activeSession === 'object' ? StoredSession.fromJSON(d.activeSession) : null,
            Array.isArray(d.sessions) ? d.sessions.map(s => StoredSession.fromJSON(s)) : [],
            Array.isArray(d.recentExercises) ? d.recentExercises.map(e => TrackedExercise.fromJSON(e)) : [],
            Array.isArray(d.recentCourses) ? d.recentCourses.map(c => TrackedCourse.fromJSON(c)) : [],
            Array.isArray(d.allExercises) ? d.allExercises.map(e => TrackedExercise.fromJSON(e)) : [],
            Array.isArray(d.allCourses) ? d.allCourses.map(c => TrackedCourse.fromJSON(c)) : [],
        );
    }
}
