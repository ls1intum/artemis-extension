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

/**
 * Priority scoring weights for exercise ranking in the context selector.
 *
 * The priority system uses additive scores to surface the most relevant exercise:
 * - WORKSPACE_BOOST (1000): Dominant — current workspace always ranks first.
 * - DUE_SOON_MAX/FLOOR (200/170): Upcoming deadlines get high urgency.
 *   Floor of 170 ensures even exercises due in 7 days outrank RECENTLY_RELEASED (100).
 *   Score decays linearly from 200→170 as daysUntilDue goes 0→7.
 * - RECENTLY_RELEASED (100): Newly released exercises surface for a week.
 * - VIEWED_RECENTLY (50): Small recency bonus for exercises opened in last 24h.
 * - FULLY_SCORED_PENALTY (-100): Completed exercises deprioritized.
 *
 * Tiebreaker: newer release dates get a micro-bonus (~0.001 points/day).
 */
const PRIORITY = {
    WORKSPACE_BOOST: 1000,
    RECENTLY_RELEASED: 100,
    DUE_SOON_MAX: 200,
    DUE_SOON_FLOOR: 170,
    VIEWED_RECENTLY: 50,
    FULLY_SCORED_PENALTY: -100,
    COURSE_VIEWED_RECENTLY: 100,
} as const;

/** Time windows for priority scoring (see PRIORITY for how these are used). */
const TIME_WINDOW = {
    RECENT_RELEASE_DAYS: 7,
    DUE_SOON_DAYS: 7,
    VIEWED_RECENTLY_HOURS: 24,
} as const;

const ARCHIVE_LIMITS = {
    ALL_EXERCISES: 1000,
    ALL_COURSES: 400,
} as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

// ── Comparators ───────────────────────────────────────────────────

/** Sort by priority descending, break ties by most-recently-viewed. */
function byPriorityThenRecency(
    a: { priority: number; lastViewed?: number },
    b: { priority: number; lastViewed?: number },
): number {
    return b.priority - a.priority || (b.lastViewed ?? 0) - (a.lastViewed ?? 0);
}

/** Sort by lastViewed descending (most recent first). */
function byLastViewedDesc(
    a: { lastViewed?: number },
    b: { lastViewed?: number },
): number {
    return (b.lastViewed ?? 0) - (a.lastViewed ?? 0);
}

// ── Utilities ─────────────────────────────────────────────────────

const SESSION_KEY_SEPARATOR = ':';

function getContextKey(type: ChatContextType, id: number): string {
    return `${type}${SESSION_KEY_SEPARATOR}${id}`;
}

function now(): number {
    return Date.now();
}

export interface ActiveContextChangeEvent {
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
                    priority: this.calculateExercisePriority({ ...exercise, isWorkspace: false }),
                };
            }
            return exercise;
        });

        this.state.recentExercises = this.state.recentExercises.map(exercise => {
            if (exercise.id !== currentWorkspaceId && exercise.isWorkspace) {
                return {
                    ...exercise,
                    isWorkspace: false,
                    priority: this.calculateExercisePriority({ ...exercise, isWorkspace: false }),
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

        if (exercise.isWorkspace) {
            priority += PRIORITY.WORKSPACE_BOOST;
        }

        if (exercise.releaseDate) {
            const releaseTime = new Date(exercise.releaseDate).getTime();
            const daysSinceRelease = (current - releaseTime) / MS_PER_DAY;
            if (daysSinceRelease >= 0 && daysSinceRelease <= TIME_WINDOW.RECENT_RELEASE_DAYS) {
                priority += PRIORITY.RECENTLY_RELEASED;
            }
        }

        if (exercise.dueDate) {
            const dueTime = new Date(exercise.dueDate).getTime();
            const daysUntilDue = (dueTime - current) / MS_PER_DAY;
            if (daysUntilDue >= 0 && daysUntilDue <= TIME_WINDOW.DUE_SOON_DAYS) {
                // Higher urgency closer to deadline (scales from DUE_SOON_MAX down to DUE_SOON_FLOOR)
                const dueSoonSpread = PRIORITY.DUE_SOON_MAX - PRIORITY.DUE_SOON_FLOOR;
                const urgencyDecay = Math.floor(daysUntilDue * dueSoonSpread / TIME_WINDOW.DUE_SOON_DAYS);
                priority += Math.max(PRIORITY.DUE_SOON_MAX - urgencyDecay, PRIORITY.DUE_SOON_FLOOR);
            }
        }

        if (exercise.lastViewed) {
            const hoursSinceView = (current - exercise.lastViewed) / MS_PER_HOUR;
            if (hoursSinceView <= TIME_WINDOW.VIEWED_RECENTLY_HOURS) {
                priority += PRIORITY.VIEWED_RECENTLY;
            }
        }

        // Tiny tiebreaker: newer releases rank slightly higher
        if (exercise.releaseDate) {
            const releaseTime = new Date(exercise.releaseDate).getTime();
            priority += Math.floor(releaseTime / MS_PER_DAY / 1000);
        }

        if (exercise.score === 100) {
            priority += PRIORITY.FULLY_SCORED_PENALTY;
        }

        return priority;
    }

    private _fireContextChangeIfNeeded(previous: ActiveContext | null, current: ActiveContext | null): void {
        const changed = previous?.type !== current?.type || previous?.id !== current?.id;
        if (changed) {
            this._onDidChangeActiveContext.fire({ current, previous });
        }
    }

    private calculateCoursePriority(course: TrackedCourse): number {
        const current = now();
        let priority = 0;

        if (course.lastViewed) {
            const hoursSinceView = (current - course.lastViewed) / MS_PER_HOUR;
            if (hoursSinceView <= TIME_WINDOW.VIEWED_RECENTLY_HOURS) {
                priority += PRIORITY.COURSE_VIEWED_RECENTLY;
            }
        }

        // Tiny tiebreaker: more recently viewed courses rank slightly higher
        priority += Math.floor(((course.lastViewed ?? current) / MS_PER_DAY) / 1000);
        return priority;
    }
}
