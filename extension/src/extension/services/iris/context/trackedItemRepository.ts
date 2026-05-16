import type { StoredState } from './contextStateTypes';
import type { TrackedExercise, TrackedCourse, ContextSource } from '@extension/types';
import { compareExercisesForDisplay, compareCoursesForDisplay } from './contextSorting';

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

interface TrackedItemRepositoryOptions {
    exerciseArchiveLimit: number;
    courseArchiveLimit: number;
}

function now(): number {
    return Date.now();
}

export class TrackedItemRepository {
    constructor(
        private readonly _getState: () => StoredState,
        private readonly _options: TrackedItemRepositoryOptions,
    ) {}

    public upsertExercise(input: ExerciseInput): TrackedExercise {
        const state = this._getState();
        const existing = state.exercises.find(ex => ex.id === input.id);

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
            lastViewed: now(),
            score: input.score ?? existing?.score,
            repositoryUri: input.repositoryUri ?? existing?.repositoryUri,
            isWorkspace,
        };

        state.exercises = this._upsertList(state.exercises, merged, item => item.id === merged.id);
        return merged;
    }

    public removeExercise(id: number): void {
        const state = this._getState();
        state.exercises = state.exercises.filter(ex => ex.id !== id);
    }

    public trimExerciseHistory(): void {
        const state = this._getState();
        if (state.exercises.length > this._options.exerciseArchiveLimit) {
            state.exercises = [...state.exercises]
                .sort(compareExercisesForDisplay)
                .slice(0, this._options.exerciseArchiveLimit);
        }
    }

    public getExerciseById(id: number): TrackedExercise | undefined {
        return this._getState().exercises.find(ex => ex.id === id);
    }

    public getWorkspaceExercise(): TrackedExercise | undefined {
        return this._getState().exercises.find(ex => ex.isWorkspace);
    }

    public upsertCourse(input: CourseInput): TrackedCourse {
        const state = this._getState();
        const existing = state.courses.find(c => c.id === input.id);
        const merged: TrackedCourse = {
            id: input.id,
            title: input.title || existing?.title || `Course ${input.id}`,
            shortName: input.shortName ?? existing?.shortName,
            lastViewed: now(),
        };
        state.courses = this._upsertList(state.courses, merged, item => item.id === merged.id);
        return merged;
    }

    public removeCourse(id: number): void {
        const state = this._getState();
        state.courses = state.courses.filter(c => c.id !== id);
    }

    public trimCourseHistory(): void {
        const state = this._getState();
        if (state.courses.length > this._options.courseArchiveLimit) {
            state.courses = [...state.courses]
                .sort(compareCoursesForDisplay)
                .slice(0, this._options.courseArchiveLimit);
        }
    }

    private _clearWorkspaceFlagFromOtherExercises(currentId: number): void {
        const state = this._getState();
        state.exercises = state.exercises.map(ex =>
            ex.id !== currentId && ex.isWorkspace ? { ...ex, isWorkspace: false } : ex
        );
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
