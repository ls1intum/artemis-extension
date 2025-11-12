import * as vscode from 'vscode';
import {
    ActiveContext,
    ChatContextType,
    ContextSnapshot,
    ContextSource,
    StoredSession,
    TrackedCourse,
    TrackedExercise,
} from './contextTypes';

interface StoredState {
    version: number;
    activeContext: ActiveContext | null;
    activeSessionId: string | null;
    recentExercises: TrackedExercise[];
    recentCourses: TrackedCourse[];
    allExercises: TrackedExercise[];
    allCourses: TrackedCourse[];
    sessions: Record<string, StoredSession[]>;
}

interface ExerciseInput {
    id: number;
    title: string;
    shortName?: string;
    releaseDate?: string;
    dueDate?: string;
    score?: number;
    repositoryUri?: string;
    source?: ContextSource;
    isWorkspace?: boolean;
}

interface CourseInput {
    id: number;
    title: string;
    shortName?: string;
    source?: ContextSource;
}

interface ContextStoreOptions {
    maxRecentExercises?: number;
    maxRecentCourses?: number;
    exerciseHistoryLimit?: number;
    courseHistoryLimit?: number;
}

const STORE_KEY = 'iris.contextStore';
const STORE_VERSION = 1;

const DEFAULT_OPTIONS: Required<ContextStoreOptions> = {
    maxRecentExercises: 5,
    maxRecentCourses: 3,
    exerciseHistoryLimit: 50,
    courseHistoryLimit: 30,
};

const SESSION_KEY_SEPARATOR = ':';

function getContextKey(type: ChatContextType, id: number): string {
    return `${type}${SESSION_KEY_SEPARATOR}${id}`;
}

function now(): number {
    return Date.now();
}

export class ContextStore {
    private state: StoredState;
    private options: Required<ContextStoreOptions>;

    constructor(private readonly context: vscode.ExtensionContext, options?: ContextStoreOptions) {
        this.options = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
        this.state = this.loadState();
    }

    private loadState(): StoredState {
        const raw = this.context.globalState.get<StoredState>(STORE_KEY);
        if (!raw) {
            return this.defaultState();
        }
        if (raw.version !== STORE_VERSION) {
            return this.migrateState(raw);
        }
        // Don't load sessions from storage - always start fresh
        return {
            ...raw,
            sessions: {},
            activeSessionId: null,
        };
    }

    private migrateState(previous: StoredState): StoredState {
        return {
            version: STORE_VERSION,
            activeContext: previous.activeContext ?? null,
            activeSessionId: previous.activeSessionId ?? null,
            recentExercises: previous.recentExercises ?? [],
            recentCourses: previous.recentCourses ?? [],
            allExercises: previous.allExercises ?? [],
            allCourses: previous.allCourses ?? [],
            sessions: previous.sessions ?? {},
        };
    }

    private defaultState(): StoredState {
        return {
            version: STORE_VERSION,
            activeContext: null,
            activeSessionId: null,
            recentExercises: [],
            recentCourses: [],
            allExercises: [],
            allCourses: [],
            sessions: {},
        };
    }

    private saveState(): void {
        // Don't persist sessions and activeSessionId - only save exercise/course tracking
        const stateToPersist: StoredState = {
            ...this.state,
            sessions: {}, // Never persist sessions
            activeSessionId: null, // Never persist active session
        };
        void this.context.globalState.update(STORE_KEY, stateToPersist);
    }

    public snapshot(): ContextSnapshot {
        const active = this.state.activeContext;
        const activeKey = active ? getContextKey(active.type, active.id) : null;
        const sessions = activeKey ? [...(this.state.sessions[activeKey] ?? [])] : [];
        const activeSession =
            sessions.find(session => session.id === this.state.activeSessionId) ?? sessions[0] ?? null;

        const recentExercises = [...this.state.recentExercises]
            .sort((a, b) => b.priority - a.priority || (b.lastViewed ?? 0) - (a.lastViewed ?? 0))
            .slice(0, this.options.maxRecentExercises);
        const recentCourses = [...this.state.recentCourses]
            .sort((a, b) => b.priority - a.priority || (b.lastViewed ?? 0) - (a.lastViewed ?? 0))
            .slice(0, this.options.maxRecentCourses);

        const allExercises = [...this.state.allExercises].sort((a, b) =>
            a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
        );
        const allCourses = [...this.state.allCourses].sort((a, b) =>
            a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
        );

        return {
            activeContext: active,
            activeSession,
            sessions,
            recentExercises,
            recentCourses,
            allExercises,
            allCourses,
        };
    }

    public getActiveContext(): ActiveContext | null {
        return this.state.activeContext;
    }

    public registerExercise(input: ExerciseInput): ContextSnapshot {
        console.log('🔧 [CONTEXT STORE] registerExercise called with:', input);
        console.log('🔧 [CONTEXT STORE] Current active context:', this.state.activeContext);
        
        const entry = this.upsertExercise(input);
        this.recalculateExercisePriorities();
        this.trimExerciseHistory();

        if (input.source === 'workspace-detected') {
            // Only override the active context if:
            // 1. There is no active context, OR
            // 2. The active context is NOT user-selected (respect explicit user choices)
            const shouldOverride = !this.state.activeContext || 
                                   this.state.activeContext.source !== 'user-selected';
            
            if (shouldOverride) {
                console.log('🔧 [CONTEXT STORE] Source is workspace-detected, setting active context to workspace exercise');
                this.setActiveContext({
                    type: 'exercise',
                    id: entry.id,
                    title: entry.title,
                    shortName: entry.shortName,
                    source: 'workspace-detected',
                    locked: true,
                    selectedAt: now(),
                });
            } else {
                console.log('🔧 [CONTEXT STORE] Workspace exercise detected, but user has explicitly selected another context - NOT overriding');
            }
        } else if (!this.state.activeContext) {
            console.log('🔧 [CONTEXT STORE] No active context exists, calling autoSelectContext()');
            this.autoSelectContext();
            console.log('🔧 [CONTEXT STORE] After autoSelectContext, active context is:', this.state.activeContext);
        } else {
            console.log('🔧 [CONTEXT STORE] Active context already exists, not changing it:', this.state.activeContext);
        }

        this.saveState();
        return this.snapshot();
    }

    public registerCourse(input: CourseInput): ContextSnapshot {
        this.upsertCourse(input);
        this.recalculateCoursePriorities();
        this.trimCourseHistory();

        if (!this.state.activeContext) {
            this.autoSelectContext();
        }

        this.saveState();
        return this.snapshot();
    }

    public removeExercise(exerciseId: number): ContextSnapshot {
        this.state.recentExercises = this.state.recentExercises.filter(ex => ex.id !== exerciseId);
        this.state.allExercises = this.state.allExercises.filter(ex => ex.id !== exerciseId);

        const active = this.state.activeContext;
        if (active?.type === 'exercise' && active.id === exerciseId) {
            this.clearActiveContext();
            this.autoSelectContext();
        }

        this.saveState();
        return this.snapshot();
    }

    public removeCourse(courseId: number): ContextSnapshot {
        this.state.recentCourses = this.state.recentCourses.filter(course => course.id !== courseId);
        this.state.allCourses = this.state.allCourses.filter(course => course.id !== courseId);

        const active = this.state.activeContext;
        if (active?.type === 'course' && active.id === courseId) {
            this.clearActiveContext();
            this.autoSelectContext();
        }

        this.saveState();
        return this.snapshot();
    }

    public setActiveContext(context: ActiveContext, ensureSession: boolean = true): ContextSnapshot {
        console.log('🔧 [CONTEXT STORE] setActiveContext called with:', context);
        console.log('🔧 [CONTEXT STORE] ensureSession:', ensureSession);
        console.log('🔧 [CONTEXT STORE] Previous active context:', this.state.activeContext);
        
        this.state.activeContext = {
            ...context,
            selectedAt: now(),
        };
        
        console.log('🔧 [CONTEXT STORE] New active context set to:', this.state.activeContext);
        
        if (ensureSession) {
            this.ensureSessionForActive();
        }
        this.saveState();
        return this.snapshot();
    }

    public unlockActiveContext(): ContextSnapshot {
        if (this.state.activeContext) {
            this.state.activeContext = {
                ...this.state.activeContext,
                locked: false,
            };
            this.saveState();
        }
        return this.snapshot();
    }

    public clearActiveContext(): ContextSnapshot {
        this.state.activeContext = null;
        this.state.activeSessionId = null;
        this.saveState();
        return this.snapshot();
    }

    public createSession(preview = 'New conversation'): ContextSnapshot {
        const active = this.state.activeContext;
        if (!active) {
            return this.snapshot();
        }

        // Clean up empty sessions before creating a new one
        this.cleanupEmptySessions();

        const key = getContextKey(active.type, active.id);
        const session: StoredSession = {
            id: `session-${now()}`,
            contextKey: key,
            preview,
            messageCount: 0,
            createdAt: now(),
            lastActivity: now(),
        };
        const sessions = this.state.sessions[key] ?? [];
        this.state.sessions[key] = [session, ...sessions];
        this.state.activeSessionId = session.id;
        this.saveState();
        return this.snapshot();
    }

    public createSessionWithDetails(
        preview: string,
        messageCount: number,
        createdAt: number,
        artemisSessionId?: number,
        messages?: any[]
    ): ContextSnapshot {
        const active = this.state.activeContext;
        if (!active) {
            return this.snapshot();
        }

        const key = getContextKey(active.type, active.id);
        const session: StoredSession = {
            id: `session-${createdAt}`,
            contextKey: key,
            preview,
            messageCount,
            createdAt,
            lastActivity: createdAt,
            artemisSessionId,
        };
        const sessions = this.state.sessions[key] ?? [];
        this.state.sessions[key] = [session, ...sessions];
        this.saveState();
        return this.snapshot();
    }

    public switchSession(sessionId: string): ContextSnapshot {
        const active = this.state.activeContext;
        if (!active) {
            return this.snapshot();
        }

        // Clean up empty sessions when switching
        this.cleanupEmptySessions();

        const key = getContextKey(active.type, active.id);
        const sessions = this.state.sessions[key] ?? [];
        if (sessions.some(session => session.id === sessionId)) {
            this.state.activeSessionId = sessionId;
            this.saveState();
        }
        return this.snapshot();
    }

    public clearSessionsForContext(contextKey: string): ContextSnapshot {
        const active = this.state.activeContext;
        const activeContextKey = active ? getContextKey(active.type, active.id) : null;
        const shouldClearActiveSession = activeContextKey === contextKey && this.state.activeSessionId !== null;

        // Remove all sessions for the specified context
        delete this.state.sessions[contextKey];

        if (shouldClearActiveSession) {
            this.state.activeSessionId = null;
        }

        this.saveState();
        return this.snapshot();
    }

    public switchToFirstSession(): ContextSnapshot {
        const active = this.state.activeContext;
        if (!active) {
            return this.snapshot();
        }

        const key = getContextKey(active.type, active.id);
        const sessions = this.state.sessions[key] ?? [];
        if (sessions.length > 0) {
            // Sort sessions by lastActivity, newest first
            const sortedSessions = [...sessions].sort((a, b) => {
                const dateA = new Date(a.lastActivity).getTime();
                const dateB = new Date(b.lastActivity).getTime();
                return dateB - dateA;
            });
            this.state.activeSessionId = sortedSessions[0].id;
            this.saveState();
        }
        return this.snapshot();
    }

    public incrementActiveSessionMessageCount(): void {
        const active = this.state.activeContext;
        if (!active) {
            return;
        }
        const key = getContextKey(active.type, active.id);
        const sessions = this.state.sessions[key];
        if (!sessions || sessions.length === 0) {
            return;
        }
        const session =
            sessions.find(s => s.id === this.state.activeSessionId) ?? sessions[0];
        session.messageCount += 1;
        session.lastActivity = now();
        this.state.activeSessionId = session.id;
        this.saveState();
    }

    public cleanupEmptySessions(): void {
        const active = this.state.activeContext;
        if (!active) {
            return;
        }
        const key = getContextKey(active.type, active.id);
        const sessions = this.state.sessions[key];
        if (!sessions || sessions.length === 0) {
            return;
        }

        // Keep only sessions with messages OR the active session
        const activeSessionId = this.state.activeSessionId;
        const filteredSessions = sessions.filter(
            session => session.messageCount > 0 || session.id === activeSessionId
        );

        // Update state if we removed any sessions
        if (filteredSessions.length !== sessions.length) {
            this.state.sessions[key] = filteredSessions;
            this.saveState();
        }
    }

    public setArtemisSessionId(artemisSessionId: number | undefined): void {
        const active = this.state.activeContext;
        if (!active) {
            return;
        }
        const key = getContextKey(active.type, active.id);
        const sessions = this.state.sessions[key];
        if (!sessions || sessions.length === 0) {
            return;
        }
        const session = sessions.find(s => s.id === this.state.activeSessionId) ?? sessions[0];
        session.artemisSessionId = artemisSessionId;
        this.saveState();
    }

    public clearAllSessions(): void {
        // Clear all session data but keep exercises and courses
        this.state.sessions = {};
        this.state.activeSessionId = null;
        this.saveState();
    }

    public clearAll(): ContextSnapshot {
        this.state = this.defaultState();
        this.saveState();
        return this.snapshot();
    }

    private upsertExercise(input: ExerciseInput): TrackedExercise {
        const existing =
            this.state.allExercises.find(ex => ex.id === input.id) ??
            this.state.recentExercises.find(ex => ex.id === input.id);

        const lastViewed = now();
        const merged: TrackedExercise = {
            id: input.id,
            title: input.title || existing?.title || `Exercise ${input.id}`,
            shortName: input.shortName ?? existing?.shortName,
            releaseDate: input.releaseDate ?? existing?.releaseDate,
            dueDate: input.dueDate ?? existing?.dueDate,
            lastViewed,
            score: input.score ?? existing?.score,
            repositoryUri: input.repositoryUri ?? existing?.repositoryUri,
            isWorkspace: input.isWorkspace ?? existing?.isWorkspace ?? false,
            priority: 0,
            lastUpdated: now(),
        };

        merged.priority = this.calculateExercisePriority(merged);

        this.state.allExercises = this.upsertList(
            this.state.allExercises,
            merged,
            item => item.id === merged.id
        );
        this.state.recentExercises = this.upsertList(
            this.state.recentExercises,
            merged,
            item => item.id === merged.id
        );

        return merged;
    }

    private upsertCourse(input: CourseInput): TrackedCourse {
        const existing =
            this.state.allCourses.find(course => course.id === input.id) ??
            this.state.recentCourses.find(course => course.id === input.id);

        const lastViewed = now();
        const merged: TrackedCourse = {
            id: input.id,
            title: input.title || existing?.title || `Course ${input.id}`,
            shortName: input.shortName ?? existing?.shortName,
            lastViewed,
            priority: 0,
            lastUpdated: now(),
        };

        merged.priority = this.calculateCoursePriority(merged);

        this.state.allCourses = this.upsertList(
            this.state.allCourses,
            merged,
            item => item.id === merged.id
        );
        this.state.recentCourses = this.upsertList(
            this.state.recentCourses,
            merged,
            item => item.id === merged.id
        );

        return merged;
    }

    private upsertList<T>(list: T[], value: T, matcher: (item: T) => boolean): T[] {
        const index = list.findIndex(matcher);
        if (index === -1) {
            return [value, ...list];
        }
        const next = [...list];
        next[index] = { ...(list[index] as any), ...(value as any) };
        return next;
    }

    private ensureSessionForActive(): void {
        const active = this.state.activeContext;
        if (!active) {
            return;
        }
        const key = getContextKey(active.type, active.id);
        const sessions = this.state.sessions[key];
        if (!sessions || sessions.length === 0) {
            this.createSession();
        } else {
            // Sort sessions by lastActivity, newest first
            const sortedSessions = [...sessions].sort((a, b) => {
                const dateA = new Date(a.lastActivity).getTime();
                const dateB = new Date(b.lastActivity).getTime();
                return dateB - dateA;
            });
            this.state.activeSessionId = sortedSessions[0].id;
        }
    }

    private autoSelectContext(): void {
        const bestExercise = [...this.state.recentExercises]
            .sort((a, b) => b.priority - a.priority || (b.lastViewed ?? 0) - (a.lastViewed ?? 0))[0];
        if (bestExercise) {
            this.state.activeContext = {
                type: 'exercise',
                id: bestExercise.id,
                title: bestExercise.title,
                shortName: bestExercise.shortName,
                source: 'system-default',
                locked: false,
                selectedAt: now(),
            };
            this.ensureSessionForActive();
            return;
        }

        const bestCourse = [...this.state.recentCourses]
            .sort((a, b) => b.priority - a.priority || (b.lastViewed ?? 0) - (a.lastViewed ?? 0))[0];
        if (bestCourse) {
            this.state.activeContext = {
                type: 'course',
                id: bestCourse.id,
                title: bestCourse.title,
                shortName: bestCourse.shortName,
                source: 'system-default',
                locked: false,
                selectedAt: now(),
            };
            this.ensureSessionForActive();
        }
    }

    private trimExerciseHistory(): void {
        if (this.state.recentExercises.length > this.options.exerciseHistoryLimit) {
            this.state.recentExercises = this.state.recentExercises
                .sort((a, b) => b.priority - a.priority || (b.lastViewed ?? 0) - (a.lastViewed ?? 0))
                .slice(0, this.options.exerciseHistoryLimit);
        }
        if (this.state.allExercises.length > 1000) {
            this.state.allExercises = this.state.allExercises
                .sort((a, b) => (b.lastViewed ?? 0) - (a.lastViewed ?? 0))
                .slice(0, 1000);
        }
    }

    private trimCourseHistory(): void {
        if (this.state.recentCourses.length > this.options.courseHistoryLimit) {
            this.state.recentCourses = this.state.recentCourses
                .sort((a, b) => b.priority - a.priority || (b.lastViewed ?? 0) - (a.lastViewed ?? 0))
                .slice(0, this.options.courseHistoryLimit);
        }
        if (this.state.allCourses.length > 400) {
            this.state.allCourses = this.state.allCourses
                .sort((a, b) => (b.lastViewed ?? 0) - (a.lastViewed ?? 0))
                .slice(0, 400);
        }
    }

    private recalculateExercisePriorities(): void {
        this.state.recentExercises = this.state.recentExercises.map(exercise => ({
            ...exercise,
            priority: this.calculateExercisePriority(exercise),
        }));
    }

    private recalculateCoursePriorities(): void {
        this.state.recentCourses = this.state.recentCourses.map(course => ({
            ...course,
            priority: this.calculateCoursePriority(course),
        }));
    }

    private calculateExercisePriority(exercise: TrackedExercise): number {
        const current = now();
        let priority = 0;
        const msPerDay = 24 * 60 * 60 * 1000;

        if (exercise.isWorkspace) {
            priority += 1000;
        }

        if (exercise.releaseDate) {
            const releaseTime = new Date(exercise.releaseDate).getTime();
            const daysSinceRelease = (current - releaseTime) / msPerDay;
            if (daysSinceRelease >= 0 && daysSinceRelease <= 7) {
                priority += 100;
            }
        }

        if (exercise.dueDate) {
            const dueTime = new Date(exercise.dueDate).getTime();
            const daysUntilDue = (dueTime - current) / msPerDay;
            if (daysUntilDue >= 0 && daysUntilDue <= 7) {
                priority += Math.max(200 - Math.floor(daysUntilDue * 30 / 7), 170);
            }
        }

        if (exercise.lastViewed) {
            const hoursSinceView = (current - exercise.lastViewed) / (60 * 60 * 1000);
            if (hoursSinceView <= 24) {
                priority += 50;
            }
        }

        if (exercise.releaseDate) {
            const releaseTime = new Date(exercise.releaseDate).getTime();
            priority += Math.floor(releaseTime / msPerDay / 1000);
        }

        if (exercise.score === 100) {
            priority -= 100;
        }

        return priority;
    }

    private calculateCoursePriority(course: TrackedCourse): number {
        const current = now();
        let priority = 0;

        if (course.lastViewed) {
            const hoursSinceView = (current - course.lastViewed) / (60 * 60 * 1000);
            if (hoursSinceView <= 24) {
                priority += 100;
            }
        }

        priority += Math.floor(((course.lastViewed ?? current) / (24 * 60 * 60 * 1000)) / 1000);
        return priority;
    }
}
