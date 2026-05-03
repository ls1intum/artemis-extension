import { IrisChatSessionService } from './chatSessionService';
import { IrisWebSocketSessionClient } from '../transport/irisWebSocketSessionClient';
import { ActiveContext, ChatContextType, ContextSnapshot, TrackedExercise } from '../../../types';
import { logger, LogCategory } from '../../loggingService';
import { ExtensionMsg } from '../../../../shared/messageContracts';
import type { IrisServiceDeps } from '../context/sessionSyncUtils';

// ── Policy helpers (pure functions) ──────────────────────────────

function pickBestContext(snapshot: ContextSnapshot): ActiveContext | null {
    const exercises = [...snapshot.recentExercises].sort((a, b) =>
        b.priority - a.priority || (b.lastViewed ?? 0) - (a.lastViewed ?? 0)
    );
    const best = exercises[0];
    if (best) {
        return {
            type: 'exercise',
            id: best.id,
            title: best.title,
            shortName: best.shortName,
            courseId: best.courseId,
            source: 'system-default',
            locked: false,
            selectedAt: Date.now(),
        };
    }

    const courses = [...snapshot.recentCourses].sort((a, b) =>
        b.priority - a.priority || (b.lastViewed ?? 0) - (a.lastViewed ?? 0)
    );
    const bestCourse = courses[0];
    if (bestCourse) {
        return {
            type: 'course',
            id: bestCourse.id,
            title: bestCourse.title,
            shortName: bestCourse.shortName,
            source: 'system-default',
            locked: false,
            selectedAt: Date.now(),
        };
    }

    return null;
}

function shouldOverrideWithWorkspace(
    active: ActiveContext | null,
    detected: TrackedExercise,
): boolean {
    if (!active) {
        return true;
    }
    // An explicit user choice (e.g. "Ask Iris about this exercise") must never
    // be silently overwritten by background workspace re-detection — that
    // produces the "I clicked B but the chat shows A" bug.
    if (active.source === 'user-selected') {
        return false;
    }
    return active.id !== detected.id;
}

export type ChatContextReason =
    | 'user-selected'
    | 'auto-workspace'
    | 'auto-first'
    | 'auto-recent'
    | 'default'
    | 'workspace-detected';

interface SwitchContextParams {
    type: ChatContextType;
    id: number;
    title: string;
    shortName?: string;
    courseId?: number;
    reason?: ChatContextReason;
    releaseDate?: string;
    dueDate?: string;
}

export class ChatContextManager {
    constructor(
        private readonly deps: IrisServiceDeps,
        private readonly _chatSessionService: IrisChatSessionService,
        private readonly _getIrisWebSocketSessionClient: () => IrisWebSocketSessionClient | undefined,
    ) { }

    /**
     * Unified context switch: registers the entity, sets active context,
     * resets the Iris session, clears chat, and reloads sessions from Artemis.
     */
    public switchContext(params: SwitchContextParams): void {
        const reason = params.reason ?? 'user-selected';
        const source = this._mapReasonToSource(reason);
        const isWorkspaceRelated = reason === 'workspace-detected' || reason === 'auto-workspace';

        // Step 1: Register in context store
        if (params.type === 'exercise') {
            this.deps.contextStore.registerExercise({
                id: params.id,
                title: params.title,
                shortName: params.shortName,
                courseId: params.courseId,
                releaseDate: params.releaseDate,
                dueDate: params.dueDate,
                source,
                isWorkspace: isWorkspaceRelated,
            });
        } else {
            this.deps.contextStore.registerCourse({
                id: params.id,
                title: params.title,
                shortName: params.shortName,
                source,
            });
        }

        // Step 2: Set active context
        this.deps.contextStore.setActiveContext({
            type: params.type,
            id: params.id,
            title: params.title,
            shortName: params.shortName,
            courseId: params.type === 'exercise' ? params.courseId : undefined,
            source,
            locked: isWorkspaceRelated,
            selectedAt: Date.now(),
        });

        // Step 3: Finalize — reset WS subscription, clear UI, reload sessions
        this._resetSessionForContextChange();
        this._clearChatMessages();

        this._chatSessionService.loadAllSessionsForContext().catch((err: unknown) => {
            logger.error('Error loading Iris sessions:', LogCategory.IRIS_CHAT, err);
        });
    }

    // ── Thin wrappers kept for call-site compatibility ──────────────────

    public handleContextSelection(
        contextType: ChatContextType,
        itemId: number,
        itemName: string,
        itemShortName?: string
    ): void {
        const courseId = contextType === 'exercise'
            ? this.deps.contextStore.getExerciseById(itemId)?.courseId
            : undefined;
        this.switchContext({ type: contextType, id: itemId, title: itemName, shortName: itemShortName, courseId });
    }

    public setExerciseContext(
        exerciseId: number,
        exerciseTitle: string,
        reason: ChatContextReason = 'user-selected',
        shortName?: string,
        releaseDate?: string,
        dueDate?: string,
        courseId?: number,
    ): void {
        this.switchContext({
            type: 'exercise',
            id: exerciseId,
            title: exerciseTitle,
            shortName,
            courseId,
            reason,
            releaseDate,
            dueDate,
        });
    }

    public setCourseContext(
        courseId: number,
        courseTitle: string,
        reason: ChatContextReason = 'user-selected',
        shortName?: string,
    ): void {
        this.switchContext({ type: 'course', id: courseId, title: courseTitle, shortName, reason });
    }

    // ── Registration with auto-select policy ───────────────────────────

    public registerExerciseAndAutoSelect(input: {
        id: number;
        title: string;
        shortName?: string;
        courseId?: number;
        releaseDate?: string;
        dueDate?: string;
        source?: 'workspace-detected' | 'user-selected' | 'system-default';
        isWorkspace?: boolean;
    }): void {
        this.deps.contextStore.registerExercise(input);

        if (input.source === 'workspace-detected') {
            const active = this.deps.contextStore.getActiveContext();
            const exercise = this.deps.contextStore.getExerciseById(input.id);
            if (exercise && shouldOverrideWithWorkspace(active, exercise)) {
                logger.context('Source is workspace-detected, setting active context to workspace exercise');
                this.deps.contextStore.setActiveContext({
                    type: 'exercise',
                    id: exercise.id,
                    title: exercise.title,
                    shortName: exercise.shortName,
                    courseId: exercise.courseId,
                    source: 'workspace-detected',
                    locked: true,
                    selectedAt: Date.now(),
                });
                this.deps.contextStore.switchToFirstSession();
            }
        } else if (!this.deps.contextStore.getActiveContext()) {
            this._autoSelectFromSnapshot();
        }

        this.deps.postSnapshot();
    }

    public registerCourseAndAutoSelect(input: {
        id: number;
        title: string;
        shortName?: string;
        source?: 'workspace-detected' | 'user-selected' | 'system-default';
    }): void {
        this.deps.contextStore.registerCourse(input);

        if (!this.deps.contextStore.getActiveContext()) {
            this._autoSelectFromSnapshot();
        }

        this.deps.postSnapshot();
    }

    private _autoSelectFromSnapshot(): void {
        const snapshot = this.deps.contextStore.snapshot();
        const best = pickBestContext(snapshot);
        if (best) {
            this.deps.contextStore.setActiveContext(best);
            this.deps.contextStore.switchToFirstSession();
        }
    }

    public clearStaleWorkspaceContext(): void {
        const current = this.deps.contextStore.getActiveContext();
        if (current && current.source === 'workspace-detected') {
            logger.context(`Clearing stale workspace context: ${current.title}`);
            this.deps.contextStore.clearActiveContext();
            this.deps.postSnapshot();
        }
    }

    // ── Non-switch helpers ──────────────────────────────────────────────

    public handleSwitchToWorkspaceContext(): TrackedExercise | undefined {
        return this.deps.contextStore.getWorkspaceExercise();
    }

    public getSelectedContext(): ActiveContext | null {
        const active = this.deps.contextStore.getActiveContext();
        if (active?.type === 'exercise' && !active.courseId) {
            const tracked = this.deps.contextStore.getExerciseById(active.id);
            if (tracked?.courseId) {
                return { ...active, courseId: tracked.courseId };
            }
        }
        return active;
    }

    public getSelectedExerciseId(): number | undefined {
        const active = this.deps.contextStore.getActiveContext();
        return active?.type === 'exercise' ? active.id : undefined;
    }

    // ── Private helpers ─────────────────────────────────────────────────

    private _mapReasonToSource(reason: ChatContextReason): 'workspace-detected' | 'user-selected' | 'system-default' {
        switch (reason) {
            case 'user-selected':
                return 'user-selected';
            case 'auto-workspace':
            case 'workspace-detected':
                return 'workspace-detected';
            default:
                return 'system-default';
        }
    }

    private _resetSessionForContextChange(): void {
        const irisSessionManager = this._getIrisWebSocketSessionClient();
        if (irisSessionManager) {
            irisSessionManager.resetSession();
        }
    }

    private _clearChatMessages(): void {
        this.deps.postMessage({ type: ExtensionMsg.ClearChatMessages });
    }
}
