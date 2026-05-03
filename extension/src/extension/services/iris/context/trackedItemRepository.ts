import type { StoredState } from './contextStateTypes';
import type { TrackedExercise, TrackedCourse, ContextSource } from '../../../types';
import {
    byPriorityThenRecency,
    byLastViewedDesc,
    calculateExercisePriority,
    calculateCoursePriority,
} from './contextPriorityScorer';

export interface ExerciseInput {
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

export interface CourseInput {
    id: number;
    title: string;
    shortName?: string;
    source?: ContextSource;
}

export interface TrackedItemRepositoryOptions {
    exerciseHistoryLimit: number;
    courseHistoryLimit: number;
}

const ARCHIVE_LIMITS = {
    ALL_EXERCISES: 1000,
    ALL_COURSES: 400,
} as const;

function now(): number {
    return Date.now();
}

export class TrackedItemRepository {
    constructor(
        private readonly _getState: () => StoredState,
        private readonly _options: TrackedItemRepositoryOptions,
    ) {}

    // ── Exercise public API ───────────────────────────────────────────

    public upsertExercise(input: ExerciseInput): TrackedExercise {
        const state = this._getState();
        const existing =
            state.allExercises.find(ex => ex.id === input.id) ??
            state.recentExercises.find(ex => ex.id === input.id);

        const lastViewed = now();
        const isWorkspace = input.isWorkspace ?? existing?.isWorkspace ?? false;

        if (isWorkspace) {
            this._clearWorkspaceFlagFromOtherExercises(input.id);
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

        state.allExercises = this._upsertList(state.allExercises, merged, item => item.id === merged.id);
        state.recentExercises = this._upsertList(state.recentExercises, merged, item => item.id === merged.id);

        return merged;
    }

    public removeExercise(id: number): void {
        const state = this._getState();
        state.recentExercises = state.recentExercises.filter(ex => ex.id !== id);
        state.allExercises = state.allExercises.filter(ex => ex.id !== id);
    }

    public recalculateExercisePriorities(): void {
        const state = this._getState();
        state.recentExercises = state.recentExercises.map(ex => ({
            ...ex,
            priority: calculateExercisePriority(ex),
        }));
    }

    public trimExerciseHistory(): void {
        const state = this._getState();
        if (state.recentExercises.length > this._options.exerciseHistoryLimit) {
            state.recentExercises = state.recentExercises
                .sort(byPriorityThenRecency)
                .slice(0, this._options.exerciseHistoryLimit);
        }
        if (state.allExercises.length > ARCHIVE_LIMITS.ALL_EXERCISES) {
            state.allExercises = state.allExercises
                .sort(byLastViewedDesc)
                .slice(0, ARCHIVE_LIMITS.ALL_EXERCISES);
        }
    }

    public getExerciseById(id: number): TrackedExercise | undefined {
        const state = this._getState();
        return state.allExercises.find(ex => ex.id === id)
            ?? state.recentExercises.find(ex => ex.id === id);
    }

    public getWorkspaceExercise(): TrackedExercise | undefined {
        const state = this._getState();
        return state.allExercises.find(ex => ex.isWorkspace)
            ?? state.recentExercises.find(ex => ex.isWorkspace);
    }

    // ── Course public API ─────────────────────────────────────────────

    public upsertCourse(input: CourseInput): TrackedCourse {
        const state = this._getState();
        const existing =
            state.allCourses.find(course => course.id === input.id) ??
            state.recentCourses.find(course => course.id === input.id);

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

        state.allCourses = this._upsertList(state.allCourses, merged, item => item.id === merged.id);
        state.recentCourses = this._upsertList(state.recentCourses, merged, item => item.id === merged.id);

        return merged;
    }

    public removeCourse(id: number): void {
        const state = this._getState();
        state.recentCourses = state.recentCourses.filter(course => course.id !== id);
        state.allCourses = state.allCourses.filter(course => course.id !== id);
    }

    public recalculateCoursePriorities(): void {
        const state = this._getState();
        state.recentCourses = state.recentCourses.map(course => ({
            ...course,
            priority: calculateCoursePriority(course),
        }));
    }

    public trimCourseHistory(): void {
        const state = this._getState();
        if (state.recentCourses.length > this._options.courseHistoryLimit) {
            state.recentCourses = state.recentCourses
                .sort(byPriorityThenRecency)
                .slice(0, this._options.courseHistoryLimit);
        }
        if (state.allCourses.length > ARCHIVE_LIMITS.ALL_COURSES) {
            state.allCourses = state.allCourses
                .sort(byLastViewedDesc)
                .slice(0, ARCHIVE_LIMITS.ALL_COURSES);
        }
    }

    // ── Privates ──────────────────────────────────────────────────────

    private _clearWorkspaceFlagFromOtherExercises(currentId: number): void {
        const state = this._getState();
        state.allExercises = state.allExercises.map(exercise => {
            if (exercise.id !== currentId && exercise.isWorkspace) {
                return {
                    ...exercise,
                    isWorkspace: false,
                    priority: calculateExercisePriority({ ...exercise, isWorkspace: false }),
                };
            }
            return exercise;
        });

        state.recentExercises = state.recentExercises.map(exercise => {
            if (exercise.id !== currentId && exercise.isWorkspace) {
                return {
                    ...exercise,
                    isWorkspace: false,
                    priority: calculateExercisePriority({ ...exercise, isWorkspace: false }),
                };
            }
            return exercise;
        });
    }

    private _upsertList<T>(list: T[], value: T, matcher: (item: T) => boolean): T[] {
        const index = list.findIndex(matcher);
        if (index === -1) {
            return [value, ...list];
        }
        const next = [...list];
        next[index] = { ...(list[index] as object), ...(value as object) } as T;
        return next;
    }
}
