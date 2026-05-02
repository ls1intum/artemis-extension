import * as vscode from 'vscode';
import {
    ActiveContext,
    ContextSnapshot,
    type IrisChatMessage,
} from '../../types';
import { logger } from '../loggingService';
import { SessionManager } from './sessionManager';
import type { StoredState } from './contextStateTypes';
import { ContextPersistence } from './contextPersistence';
import { buildContextSnapshot } from './contextSnapshot';
import { TrackedItemRepository } from './trackedItemRepository';
import type { TrackedExercise, TrackedCourse } from '../../types';

export type { ExerciseInput, CourseInput } from './trackedItemRepository';

interface ContextStoreOptions {
    maxRecentExercises?: number;
    maxRecentCourses?: number;
    exerciseHistoryLimit?: number;
    courseHistoryLimit?: number;
}

const DEFAULT_OPTIONS: Required<ContextStoreOptions> = {
    maxRecentExercises: 5,
    maxRecentCourses: 3,
    exerciseHistoryLimit: 50,
    courseHistoryLimit: 30,
};

// ── Utilities ─────────────────────────────────────────────────────

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
    private readonly _persistence: ContextPersistence;
    private readonly _sessionManager: SessionManager;
    private readonly _repository: TrackedItemRepository;

    private readonly _onDidChangeActiveContext = new vscode.EventEmitter<ActiveContextChangeEvent>();
    public readonly onDidChangeActiveContext = this._onDidChangeActiveContext.event;

    constructor(private readonly context: vscode.ExtensionContext, options?: ContextStoreOptions) {
        this.options = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
        this._persistence = new ContextPersistence(context);
        this.state = this._persistence.load();
        this._sessionManager = new SessionManager(
            () => this.state,
            () => this.state.activeContext,
            () => this._persistence.save(this.state),
        );
        this._repository = new TrackedItemRepository(
            () => this.state,
            {
                exerciseHistoryLimit: this.options.exerciseHistoryLimit,
                courseHistoryLimit: this.options.courseHistoryLimit,
            },
        );
    }

    public dispose(): void {
        this._onDidChangeActiveContext.dispose();
    }

    public snapshot(): ContextSnapshot {
        return buildContextSnapshot(this.state, this.options);
    }

    public getActiveContext(): ActiveContext | null {
        return this.state.activeContext;
    }

    public getExerciseById(exerciseId: number): TrackedExercise | undefined {
        return this._repository.getExerciseById(exerciseId);
    }

    public getWorkspaceExercise(): TrackedExercise | undefined {
        return this._repository.getWorkspaceExercise();
    }

    public registerExercise(input: Parameters<TrackedItemRepository['upsertExercise']>[0]): ContextSnapshot {
        this._repository.upsertExercise(input);
        this._repository.recalculateExercisePriorities();
        this._repository.trimExerciseHistory();
        this._persistence.save(this.state);
        return this.snapshot();
    }

    public registerCourse(input: Parameters<TrackedItemRepository['upsertCourse']>[0]): ContextSnapshot {
        this._repository.upsertCourse(input);
        this._repository.recalculateCoursePriorities();
        this._repository.trimCourseHistory();
        this._persistence.save(this.state);
        return this.snapshot();
    }

    public removeExercise(exerciseId: number): ContextSnapshot {
        this._repository.removeExercise(exerciseId);

        const active = this.state.activeContext;
        if (active?.type === 'exercise' && active.id === exerciseId) {
            this.clearActiveContext();
        }

        this._persistence.save(this.state);
        return this.snapshot();
    }

    public removeCourse(courseId: number): ContextSnapshot {
        this._repository.removeCourse(courseId);

        const active = this.state.activeContext;
        if (active?.type === 'course' && active.id === courseId) {
            this.clearActiveContext();
        }

        this._persistence.save(this.state);
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

        this._persistence.save(this.state);
        this._fireContextChangeIfNeeded(previous, this.state.activeContext);
        return this.snapshot();
    }

    public unlockActiveContext(): ContextSnapshot {
        if (this.state.activeContext) {
            this.state.activeContext = {
                ...this.state.activeContext,
                locked: false,
            };
            this._persistence.save(this.state);
        }
        return this.snapshot();
    }

    public clearActiveContext(): ContextSnapshot {
        const previous = this.state.activeContext;
        this.state.activeContext = null;
        this.state.activeSessionId = null;
        this._persistence.save(this.state);
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

    private _fireContextChangeIfNeeded(previous: ActiveContext | null, current: ActiveContext | null): void {
        const changed = previous?.type !== current?.type || previous?.id !== current?.id;
        if (changed) {
            this._onDidChangeActiveContext.fire({ current, previous });
        }
    }
}
