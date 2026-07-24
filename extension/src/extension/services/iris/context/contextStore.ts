import * as vscode from 'vscode';

import { logger } from '@extension/services/loggingService';
import type { TrackedExercise } from '@extension/types';
import { ActiveContext, ContextSnapshot } from '@extension/types';

import { ContextPersistence } from './contextPersistence';
import { buildContextSnapshot } from './contextSnapshot';
import type { StoredState } from './contextStateTypes';
import { SessionManager } from './sessionManager';
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

    /**
     * Task 12: fires the context key(s) affected by a session mutation
     * (message sent, session created/rehomed/retitled). A `void` event would
     * force consumers to drop everything on every mutation; carrying the
     * key(s) lets the course-history cache invalidate only the course(s)
     * actually touched.
     */
    private readonly _onDidChangeSessions = new vscode.EventEmitter<{ contextKeys: string[] }>();
    public readonly onDidChangeSessions = this._onDidChangeSessions.event;

    constructor(context: vscode.ExtensionContext, options?: ContextStoreOptions) {
        this.options = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
        this._persistence = new ContextPersistence(context);
        this.state = this._persistence.load();
        this._sessionManager = new SessionManager(
            () => this.state,
            () => this.state.activeContext,
            () => this._persistence.save(this.state),
            contextKeys => this._onDidChangeSessions.fire({ contextKeys }),
        );
        this._repository = new TrackedItemRepository(
            () => this.state,
            {
                exerciseArchiveLimit: this.options.exerciseArchiveLimit,
                courseArchiveLimit: this.options.courseArchiveLimit,
            },
        );
    }

    public dispose(): void {
        this._onDidChangeActiveContext.dispose();
        this._onDidChangeSessions.dispose();
    }

    public snapshot(): ContextSnapshot {
        return buildContextSnapshot(this.state);
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

    public getWorkspaceExerciseId(): number | undefined {
        return this._repository.getWorkspaceExercise()?.id;
    }

    /**
     * Clears the `isWorkspace` flag on all tracked exercises. Silent: does NOT fire
     * `onDidChangeActiveContext`. Callers that need a UI refresh must post a snapshot
     * themselves — see `ChatWebviewProvider.clearWorkspaceExercise`.
     */
    public clearWorkspaceFlag(): void {
        this._repository.clearAllWorkspaceFlags();
        this._persistence.save(this.state);
    }

    public registerExercise(input: ExerciseInput): ContextSnapshot {
        this._repository.upsertExercise(input);
        this._repository.trimExerciseHistory();
        this._persistence.save(this.state);
        return this.snapshot();
    }

    public registerCourse(input: CourseInput): ContextSnapshot {
        this._repository.upsertCourse(input);
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
        title?: string,
        lastActivity?: number,
    ): ContextSnapshot {
        this._sessionManager.createSessionWithDetails(preview, messageCount, createdAt, artemisSessionId, title, lastActivity);
        return this.snapshot();
    }

    public switchSession(sessionId: string): ContextSnapshot {
        this._sessionManager.switchSession(sessionId);
        return this.snapshot();
    }

    /**
     * Idempotent cross-context upsert keyed by `artemisSessionId`. Returns the
     * local session id (so the atomic open flow can immediately
     * `switchSession` to it). Delegates the rehome/collapse logic to
     * {@link SessionManager.upsertSessionFromOverview}.
     */
    public upsertSessionFromOverview(entry: {
        contextKey: string;
        artemisSessionId: number;
        title?: string;
        lastActivity: number;
    }): string {
        return this._sessionManager.upsertSessionFromOverview(entry);
    }

    public clearSessionsForContext(contextKey: string): ContextSnapshot {
        this._sessionManager.clearSessionsForContext(contextKey);
        return this.snapshot();
    }

    public switchToFirstSession(): ContextSnapshot {
        this._sessionManager.switchToFirstSession();
        return this.snapshot();
    }

    /**
     * Thin forward to {@link SessionManager.getActiveArtemisSessionId}. The
     * only way outside callers (e.g. `chatSessionService`) can read the raw
     * active-session pointer. `_sessionManager` itself is private to this
     * class.
     */
    public getActiveArtemisSessionId(): number | undefined {
        return this._sessionManager.getActiveArtemisSessionId();
    }

    /** Thin forward to {@link SessionManager.selectByArtemisSessionId}. */
    public selectByArtemisSessionId(artemisSessionId: number): boolean {
        return this._sessionManager.selectByArtemisSessionId(artemisSessionId);
    }

    public incrementActiveSessionMessageCount(): void {
        this._sessionManager.incrementActiveSessionMessageCount();
    }

    public setActiveSessionMessageCount(count: number): void {
        this._sessionManager.setActiveSessionMessageCount(count);
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
