import * as vscode from 'vscode';
import {
    ActiveContext,
    ChatContextType,
    ContextSnapshot,
    ContextSource,
    StoredSession,
    TrackedCourse,
    TrackedExercise,
    type IrisChatMessage,
} from '../../types';
import { logger } from '../loggingService';
import { SessionManager } from './sessionManager';
import { calculateExercisePriority, calculateCoursePriority, byPriorityThenRecency, byLastViewedDesc } from './contextPriorityScorer';

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
    courseId?: number;
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

const ARCHIVE_LIMITS = {
    ALL_EXERCISES: 1000,
    ALL_COURSES: 400,
} as const;

// ── Utilities ─────────────────────────────────────────────────────

const SESSION_KEY_SEPARATOR = ':';

function getContextKey(type: ChatContextType, id: number): string {
    return `${type}${SESSION_KEY_SEPARATOR}${id}`;
}

function now(): number {
    return Date.now();
}

interface ActiveContextChangeEvent {
    current: ActiveContext | null;
    previous: ActiveContext | null;
}

export class ContextStore {
    private state: StoredState;
    private options: Required<ContextStoreOptions>;
    private readonly _sessionManager: SessionManager;

    private readonly _onDidChangeActiveContext = new vscode.EventEmitter<ActiveContextChangeEvent>();
    public readonly onDidChangeActiveContext = this._onDidChangeActiveContext.event;

    constructor(private readonly context: vscode.ExtensionContext, options?: ContextStoreOptions) {
        this.options = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
        this.state = this.loadState();
        this._sessionManager = new SessionManager(
            () => this.state,
            () => this.state.activeContext,
            () => this.saveState(),
        );
    }

    public dispose(): void {
        this._onDidChangeActiveContext.dispose();
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
        this.context.globalState.update(STORE_KEY, stateToPersist).then(undefined, (err: unknown) => logger.error('Failed to persist state', undefined, err));
    }

    public snapshot(): ContextSnapshot {
        const active = this.state.activeContext;
        const activeKey = active ? getContextKey(active.type, active.id) : null;
        const sessions = activeKey ? [...(this.state.sessions[activeKey] ?? [])] : [];
        const activeSession =
            sessions.find(session => session.id === this.state.activeSessionId) ?? sessions[0] ?? null;

        const recentExercises = [...this.state.recentExercises]
            .sort(byPriorityThenRecency)
            .slice(0, this.options.maxRecentExercises);
        const recentCourses = [...this.state.recentCourses]
            .sort(byPriorityThenRecency)
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

    public getExerciseById(exerciseId: number): TrackedExercise | undefined {
        return this.state.allExercises.find(exercise => exercise.id === exerciseId)
            ?? this.state.recentExercises.find(exercise => exercise.id === exerciseId);
    }

    public getWorkspaceExercise(): TrackedExercise | undefined {
        return this.state.allExercises.find(ex => ex.isWorkspace)
            ?? this.state.recentExercises.find(ex => ex.isWorkspace);
    }

    public registerExercise(input: ExerciseInput): ContextSnapshot {
        this.upsertExercise(input);
        this.recalculateExercisePriorities();
        this.trimExerciseHistory();
        this.saveState();
        return this.snapshot();
    }

    public registerCourse(input: CourseInput): ContextSnapshot {
        this.upsertCourse(input);
        this.recalculateCoursePriorities();
        this.trimCourseHistory();
        this.saveState();
        return this.snapshot();
    }

    public removeExercise(exerciseId: number): ContextSnapshot {
        this.state.recentExercises = this.state.recentExercises.filter(ex => ex.id !== exerciseId);
        this.state.allExercises = this.state.allExercises.filter(ex => ex.id !== exerciseId);

        const active = this.state.activeContext;
        if (active?.type === 'exercise' && active.id === exerciseId) {
            this.clearActiveContext();
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
        }

        this.saveState();
        return this.snapshot();
    }

    public setActiveContext(context: ActiveContext): ContextSnapshot {
        logger.context('setActiveContext called with:', context);
        logger.context('Previous active context:', this.state.activeContext);

        const previous = this.state.activeContext;
        this.state.activeContext = {
            ...context,
            selectedAt: now(),
        };

        logger.context('New active context set to:', this.state.activeContext);

        this.saveState();
        this._fireContextChangeIfNeeded(previous, this.state.activeContext);
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
        const previous = this.state.activeContext;
        this.state.activeContext = null;
        this.state.activeSessionId = null;
        this.saveState();
        this._fireContextChangeIfNeeded(previous, null);
        return this.snapshot();
    }

    public createSession(preview = 'New conversation'): ContextSnapshot {
        this._sessionManager.createSession(preview);
        return this.snapshot();
    }

    public createSessionWithDetails(
        preview: string,
        messageCount: number,
        createdAt: number,
        artemisSessionId?: number,
        messages?: IrisChatMessage[],
        title?: string,
    ): ContextSnapshot {
        this._sessionManager.createSessionWithDetails(preview, messageCount, createdAt, artemisSessionId, messages, title);
        return this.snapshot();
    }

    public switchSession(sessionId: string): ContextSnapshot {
        this._sessionManager.switchSession(sessionId);
        return this.snapshot();
    }

    public clearSessionsForContext(contextKey: string): ContextSnapshot {
        this._sessionManager.clearSessionsForContext(contextKey);
        return this.snapshot();
    }

    public switchToFirstSession(): ContextSnapshot {
        this._sessionManager.switchToFirstSession();
        return this.snapshot();
    }

    public incrementActiveSessionMessageCount(): void {
        this._sessionManager.incrementActiveSessionMessageCount();
    }

    public cleanupEmptySessions(): void {
        this._sessionManager.cleanupEmptySessions();
    }

    public updateSessionTitle(artemisSessionId: number, title: string): boolean {
        return this._sessionManager.updateSessionTitle(artemisSessionId, title);
    }

    public setArtemisSessionId(artemisSessionId: number | undefined): void {
        this._sessionManager.setArtemisSessionId(artemisSessionId);
    }

    public clearAllSessions(): void {
        this._sessionManager.clearAllSessions();
    }

    private upsertExercise(input: ExerciseInput): TrackedExercise {
        const existing =
            this.state.allExercises.find(ex => ex.id === input.id) ??
            this.state.recentExercises.find(ex => ex.id === input.id);

        const lastViewed = now();
        const isWorkspace = input.isWorkspace ?? existing?.isWorkspace ?? false;

        // If this exercise is being marked as workspace, clear the flag from all other exercises
        if (isWorkspace) {
            this.clearWorkspaceFlagFromOtherExercises(input.id);
        }

        const merged: TrackedExercise = {
            id: input.id,
            title: input.title || existing?.title || `Exercise ${input.id}`,
            shortName: input.shortName ?? existing?.shortName,
            courseId: input.courseId ?? existing?.courseId,
            releaseDate: input.releaseDate ?? existing?.releaseDate,
            dueDate: input.dueDate ?? existing?.dueDate,
            lastViewed,
            score: input.score ?? existing?.score,
            repositoryUri: input.repositoryUri ?? existing?.repositoryUri,
            isWorkspace,
            priority: 0,
            lastUpdated: now(),
        };

        merged.priority = calculateExercisePriority(merged);

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

    /**
     * Clears the isWorkspace flag from all exercises except the specified one.
     * This ensures only one exercise can be marked as the current workspace at a time.
     */
    private clearWorkspaceFlagFromOtherExercises(currentWorkspaceId: number): void {
        this.state.allExercises = this.state.allExercises.map(exercise => {
            if (exercise.id !== currentWorkspaceId && exercise.isWorkspace) {
                return {
                    ...exercise,
                    isWorkspace: false,
                    priority: calculateExercisePriority({ ...exercise, isWorkspace: false }),
                };
            }
            return exercise;
        });

        this.state.recentExercises = this.state.recentExercises.map(exercise => {
            if (exercise.id !== currentWorkspaceId && exercise.isWorkspace) {
                return {
                    ...exercise,
                    isWorkspace: false,
                    priority: calculateExercisePriority({ ...exercise, isWorkspace: false }),
                };
            }
            return exercise;
        });
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

        merged.priority = calculateCoursePriority(merged);

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
        // Spread both objects assuming they're object types
        next[index] = { ...(list[index] as object), ...(value as object) } as T;
        return next;
    }

    private trimExerciseHistory(): void {
        if (this.state.recentExercises.length > this.options.exerciseHistoryLimit) {
            this.state.recentExercises = this.state.recentExercises
                .sort(byPriorityThenRecency)
                .slice(0, this.options.exerciseHistoryLimit);
        }
        if (this.state.allExercises.length > ARCHIVE_LIMITS.ALL_EXERCISES) {
            this.state.allExercises = this.state.allExercises
                .sort(byLastViewedDesc)
                .slice(0, ARCHIVE_LIMITS.ALL_EXERCISES);
        }
    }

    private trimCourseHistory(): void {
        if (this.state.recentCourses.length > this.options.courseHistoryLimit) {
            this.state.recentCourses = this.state.recentCourses
                .sort(byPriorityThenRecency)
                .slice(0, this.options.courseHistoryLimit);
        }
        if (this.state.allCourses.length > ARCHIVE_LIMITS.ALL_COURSES) {
            this.state.allCourses = this.state.allCourses
                .sort(byLastViewedDesc)
                .slice(0, ARCHIVE_LIMITS.ALL_COURSES);
        }
    }

    private recalculateExercisePriorities(): void {
        this.state.recentExercises = this.state.recentExercises.map(exercise => ({
            ...exercise,
            priority: calculateExercisePriority(exercise),
        }));
    }

    private recalculateCoursePriorities(): void {
        this.state.recentCourses = this.state.recentCourses.map(course => ({
            ...course,
            priority: calculateCoursePriority(course),
        }));
    }

    private _fireContextChangeIfNeeded(previous: ActiveContext | null, current: ActiveContext | null): void {
        const changed = previous?.type !== current?.type || previous?.id !== current?.id;
        if (changed) {
            this._onDidChangeActiveContext.fire({ current, previous });
        }
    }

}
