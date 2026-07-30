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
     * Task 9: fires whenever the workspace-flagged exercise changes (set via
     * `registerExercise`, cleared via `clearWorkspaceFlag`). Distinct from
     * `onDidChangeActiveContext`: the workspace exercise is derived from the
     * folder's git remote and does not necessarily track what the user is
     * chatting about. The struggle detector follows this event from Task 14
     * onward; nothing consumes it yet.
     */
    private readonly _onDidChangeWorkspaceExercise = new vscode.EventEmitter<TrackedExercise | undefined>();
    public readonly onDidChangeWorkspaceExercise = this._onDidChangeWorkspaceExercise.event;

    /**
     * Task 9: navigation state for "which course is the user currently
     * looking at", distinct from the workspace exercise's course. In-memory
     * only (not persisted, not part of `StoredState`); it resets on every
     * extension reload, which matches its role as transient UI navigation
     * state rather than a durable preference.
     */
    private _currentCourseId: number | undefined;

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
        this._onDidChangeWorkspaceExercise.dispose();
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

    public getCurrentCourseId(): number | undefined {
        return this._currentCourseId;
    }

    public setCurrentCourseId(courseId: number | undefined): void {
        this._currentCourseId = courseId;
    }

    /**
     * Clears the `isWorkspace` flag on all tracked exercises. Silent with
     * respect to `onDidChangeActiveContext` (does NOT fire it). Callers that
     * need a UI refresh must post a snapshot themselves, see
     * `ChatWebviewProvider.clearWorkspaceExercise`. It DOES fire
     * `onDidChangeWorkspaceExercise` when a workspace exercise was actually
     * cleared, since that event exists specifically to track this flag.
     */
    public clearWorkspaceFlag(): void {
        const previousWorkspace = this._repository.getWorkspaceExercise();
        this._repository.clearAllWorkspaceFlags();
        this._persistence.save(this.state);
        this._fireWorkspaceExerciseChangeIfNeeded(previousWorkspace);
    }

    public registerExercise(input: ExerciseInput): ContextSnapshot {
        const previousWorkspace = this._repository.getWorkspaceExercise();
        this._repository.upsertExercise(input);
        this._repository.trimExerciseHistory();
        this._persistence.save(this.state);
        this._fireWorkspaceExerciseChangeIfNeeded(previousWorkspace);
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

    private _fireWorkspaceExerciseChangeIfNeeded(previous: TrackedExercise | undefined): void {
        const current = this._repository.getWorkspaceExercise();
        if (previous?.id !== current?.id) {
            this._onDidChangeWorkspaceExercise.fire(current);
        }
    }
}
