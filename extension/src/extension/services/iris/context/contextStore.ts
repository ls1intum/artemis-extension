import * as vscode from 'vscode';

import type { ContextSnapshot, TrackedExercise } from '@extension/types';

import { ContextPersistence } from './contextPersistence';
import { compareCoursesForDisplay, compareExercisesForDisplay } from './contextSorting';
import type { CourseInput, ExerciseInput } from './trackedItemRepository';
import { TrackedItemRepository } from './trackedItemRepository';

interface ContextStoreOptions {
    exerciseArchiveLimit?: number;
    courseArchiveLimit?: number;
}

const DEFAULT_OPTIONS: Required<ContextStoreOptions> = {
    exerciseArchiveLimit: 1000,
    courseArchiveLimit: 400,
};

function isPastDeadline(ex: TrackedExercise, nowMs: number): boolean {
    if (!ex.dueDate) { return false; }
    const due = new Date(ex.dueDate).getTime();
    return Number.isFinite(due) && due <= nowMs;
}

export class ContextStore {
    private readonly _state: ReturnType<ContextPersistence['load']>;
    private options: Required<ContextStoreOptions>;
    private readonly _persistence: ContextPersistence;
    private readonly _repository: TrackedItemRepository;

    /**
     * Fires whenever the workspace-flagged exercise changes (set via
     * `registerExercise`, cleared via `clearWorkspaceFlag`). The workspace
     * exercise is derived from the folder's git remote and is deliberately
     * independent of what the student is chatting about: the struggle
     * detector follows this event, the chat follows its conversation.
     */
    private readonly _onDidChangeWorkspaceExercise = new vscode.EventEmitter<TrackedExercise | undefined>();
    public readonly onDidChangeWorkspaceExercise = this._onDidChangeWorkspaceExercise.event;

    constructor(context: vscode.ExtensionContext, options?: ContextStoreOptions) {
        this.options = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
        this._persistence = new ContextPersistence(context);
        this._state = this._persistence.load();
        this._repository = new TrackedItemRepository(
            () => this._state,
            {
                exerciseArchiveLimit: this.options.exerciseArchiveLimit,
                courseArchiveLimit: this.options.courseArchiveLimit,
            },
        );
    }

    public dispose(): void {
        this._onDidChangeWorkspaceExercise.dispose();
    }

    /**
     * What the pickers render. An exercise past its due date is hidden unless
     * it is the workspace one or `topicExerciseId` (the conversation's current
     * topic): an overdue exercise the student is demonstrably still talking
     * about must stay pickable, or the chip names a topic the picker cannot
     * show a checkmark for. Both lists are sorted for display, computed here
     * rather than stored so nothing can go stale.
     */
    public snapshot(topicExerciseId?: number): ContextSnapshot {
        const nowMs = Date.now();
        const visibleExercises = this._state.exercises.filter(ex =>
            ex.isWorkspace || ex.id === topicExerciseId || !isPastDeadline(ex, nowMs));
        return {
            exercises: [...visibleExercises].sort(compareExercisesForDisplay),
            courses: [...this._state.courses].sort(compareCoursesForDisplay),
        };
    }

    public getExerciseById(exerciseId: number): TrackedExercise | undefined {
        return this._repository.getExerciseById(exerciseId);
    }

    public getWorkspaceExercise(): TrackedExercise | undefined {
        return this._repository.getWorkspaceExercise();
    }

    public getWorkspaceExerciseId(): number | undefined {
        return this._repository.getWorkspaceExercise()?.id;
    }

    /** Display name for a tracked course, when we have one. */
    public getCourseTitle(courseId: number): string | undefined {
        return this._repository.getCourseById(courseId)?.title;
    }

    /**
     * Clears the `isWorkspace` flag on all tracked exercises. Callers that
     * need a UI refresh must post a snapshot themselves, see
     * `ChatWebviewProvider.clearWorkspaceExercise`. It DOES fire
     * `onDidChangeWorkspaceExercise` when a workspace exercise was actually
     * cleared, since that event exists specifically to track this flag.
     */
    public clearWorkspaceFlag(): void {
        const previousWorkspace = this._repository.getWorkspaceExercise();
        this._repository.clearAllWorkspaceFlags();
        this._persistence.save(this._state);
        this._fireWorkspaceExerciseChangeIfNeeded(previousWorkspace);
    }

    public registerExercise(input: ExerciseInput): ContextSnapshot {
        const previousWorkspace = this._repository.getWorkspaceExercise();
        this._repository.upsertExercise(input);
        this._repository.trimExerciseHistory();
        this._persistence.save(this._state);
        this._fireWorkspaceExerciseChangeIfNeeded(previousWorkspace);
        return this.snapshot();
    }

    public registerCourse(input: CourseInput): ContextSnapshot {
        this._repository.upsertCourse(input);
        this._repository.trimCourseHistory();
        this._persistence.save(this._state);
        return this.snapshot();
    }

    public removeExercise(exerciseId: number): ContextSnapshot {
        this._repository.removeExercise(exerciseId);
        this._persistence.save(this._state);
        return this.snapshot();
    }

    public removeCourse(courseId: number): ContextSnapshot {
        this._repository.removeCourse(courseId);
        this._persistence.save(this._state);
        return this.snapshot();
    }

    private _fireWorkspaceExerciseChangeIfNeeded(previous: TrackedExercise | undefined): void {
        const current = this._repository.getWorkspaceExercise();
        if (previous?.id !== current?.id) {
            this._onDidChangeWorkspaceExercise.fire(current);
        }
    }
}
