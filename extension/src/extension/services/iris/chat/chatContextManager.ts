import { ExtensionMsg } from '@shared/messageContracts';

import type { IrisServiceDeps } from '@extension/services/iris/context/sessionSyncUtils';
import { IrisWebSocketSessionClient } from '@extension/services/iris/transport/irisWebSocketSessionClient';
import { LogCategory, logger } from '@extension/services/loggingService';
import { ActiveContext, ChatContextType, ContextSnapshot, TrackedExercise } from '@extension/types';

import { IrisChatSessionService } from './chatSessionService';

// ── Policy helpers (pure functions) ──────────────────────────────

/**
 * Pure policy: pick the default context when nothing is active. The snapshot
 * is already sorted (workspace first, then by lastViewed desc), so we just
 * take the head of each list.
 */
export function pickBestContextFromSnapshot(snapshot: ContextSnapshot): ActiveContext | null {
    const best = snapshot.exercises[0];
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
    const bestCourse = snapshot.courses[0];
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

/**
 * Pure policy: may workspace detection take over the active context?
 *
 * @param userChoseThisSession whether the student made an explicit selection in THIS window, as
 *   opposed to one restored from persistence. The active context is stored together with its
 *   `source`, so treating `user-selected` alone as a veto let a single choice pin every future
 *   window forever, whatever the student actually had open (#371). Deliberately not a timestamp
 *   comparison: `selectedAt` is wall-clock, so a backward clock step could void a selection the
 *   student had just made — a worse failure than the one being fixed.
 */
function shouldOverrideWithWorkspace(
    active: ActiveContext | null,
    detected: TrackedExercise,
    userChoseThisSession: boolean,
): boolean {
    if (!active) {
        return true;
    }
    // An explicit user choice (e.g. "Ask Iris about this exercise") must never be silently
    // overwritten by background workspace re-detection — that produces the "I clicked B but the
    // chat shows A" bug. A choice restored from a previous window is not that: it says nothing
    // about the exercise now open.
    if (active.source === 'user-selected' && userChoseThisSession) {
        return false;
    }
    // Compare the entity, not just the number: a COURSE with id 3 is not exercise 3, and must not
    // suppress the override just because the ids collide.
    return active.type !== 'exercise' || active.id !== detected.id;
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
    /**
     * When `true` (default) the switch finishes by loading the context's
     * sessions and auto-selecting the default one. When `false`, steps 1–3
     * still run (register, set active, reset WS + clear UI) but session
     * selection is left to the caller: used by the atomic cross-context
     * `openArtemisSession` flow, which selects a specific session itself and
     * must not have the default-session loader race against it.
     */
    loadDefaultSession?: boolean;
}

export class ChatContextManager {
    /**
     * Set once the student picks a context in this window. Distinguishes a live choice from one
     * restored out of persistence, which carries the same `user-selected` source but says nothing
     * about what is open now. Read by {@link shouldOverrideWithWorkspace}; see #371.
     */
    private _userChoseThisSession = false;

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

        // Every explicit selection funnels through here, so this is the one place that has to
        // record it. From now on background detection leaves the context alone (#371).
        if (source === 'user-selected') {
            this._userChoseThisSession = true;
        }

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

        // Step 4 (optional): load the context's sessions and auto-select the
        // default one. Skipped when the caller drives session selection
        // itself (openArtemisSession), so the default-session loader does not
        // race against the caller's explicit session pick.
        if (params.loadDefaultSession === false) {
            return;
        }

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
        // Recorded before the no-op below, because the student picking the row that is ALREADY
        // active is still a choice: it is how you confirm a context restored from a previous
        // window, and it must arm the veto even though nothing else has to happen (#371).
        // This path is only ever reached from the webview's selection message.
        this._userChoseThisSession = true;

        const active = this.deps.contextStore.getActiveContext();
        if (active?.type === contextType && active.id === itemId) {
            // Re-selecting the already-active context is a no-op: no register,
            // no setActiveContext, no session reset, no chat clear, no reload.
            // The active session is preserved as-is.
            return;
        }

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
            if (exercise && shouldOverrideWithWorkspace(active, exercise, this._userChoseThisSession)) {
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
        const best = pickBestContextFromSnapshot(snapshot);
        if (best) {
            // Logged because this is the only path that picks a context without any explicit signal:
            // silent, it is indistinguishable in the log from "no context was chosen at all".
            logger.context(`Auto-selected ${best.type} ${best.id} (${best.title}) from snapshot`);
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
