import * as vscode from 'vscode';
import { ContextStore } from './contextStore';
import { IrisSessionInitService } from './chatSessionService';
import { IrisSessionManager } from './irisSessionManager';
import { ActiveContext, ChatContextType, TrackedExercise } from '../types';
import { logger, LogCategory } from './loggingService';
import { ExtensionMsg } from '../shared/messageContracts';
import type { ExtensionToWebviewMessage } from '../shared/messageContracts';

export type ChatContextReason =
    | 'user-selected'
    | 'auto-workspace'
    | 'auto-first'
    | 'auto-recent'
    | 'default'
    | 'workspace-detected';

export interface SwitchContextParams {
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
        private readonly _contextStore: ContextStore,
        private readonly _chatSessionService: IrisSessionInitService,
        private readonly _getIrisSessionManager: () => IrisSessionManager | undefined,
        private readonly _postMessage: (message: ExtensionToWebviewMessage) => void,
        private readonly _postSnapshot?: () => void,
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
            this._contextStore.registerExercise({
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
            this._contextStore.registerCourse({
                id: params.id,
                title: params.title,
                shortName: params.shortName,
                source,
            });
        }

        // Step 2: Set active context (ensureSession=false — sessions loaded below)
        this._contextStore.setActiveContext({
            type: params.type,
            id: params.id,
            title: params.title,
            shortName: params.shortName,
            courseId: params.type === 'exercise' ? params.courseId : undefined,
            source,
            locked: isWorkspaceRelated,
            selectedAt: Date.now(),
        }, false);

        // Step 3: Finalize — reset WS subscription, clear UI, reload sessions
        this._resetSessionForContextChange();
        this._clearChatMessages();

        const label = params.type === 'exercise' ? 'Exercise' : 'Course';
        vscode.window.showInformationMessage(`${label} context set to: ${params.title}`);

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
            ? this._contextStore.getExerciseById(itemId)?.courseId
            : undefined;
        this.switchContext({ type: contextType, id: itemId, title: itemName, shortName: itemShortName, courseId });
    }

    public handleCourseSelection(courseId: number): void {
        const snapshot = this._contextStore.snapshot();
        const course = snapshot.allCourses.find(c => c.id === courseId)
            ?? snapshot.recentCourses.find(c => c.id === courseId);
        this.switchContext({
            type: 'course',
            id: courseId,
            title: course?.title ?? `Course ${courseId}`,
            shortName: course?.shortName,
        });
    }

    public handleExerciseSelection(exerciseId: number): void {
        const tracked = this._contextStore.getExerciseById(exerciseId);
        this.switchContext({
            type: 'exercise',
            id: exerciseId,
            title: tracked?.title ?? `Exercise ${exerciseId}`,
            shortName: tracked?.shortName,
            courseId: tracked?.courseId,
        });
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

    // ── Non-switch helpers ──────────────────────────────────────────────

    public handleSwitchContext(): void {
        this._contextStore.unlockActiveContext();
    }

    public handleSwitchToWorkspaceContext(): TrackedExercise | undefined {
        const snapshot = this._contextStore.snapshot();

        const workspaceExercise = snapshot.recentExercises.find(exercise =>
            exercise.isWorkspace || /\(Workspace\)/i.test(exercise.title)
        ) || snapshot.allExercises.find(exercise =>
            exercise.isWorkspace || /\(Workspace\)/i.test(exercise.title)
        );

        if (!workspaceExercise) {
            vscode.window.showWarningMessage('No workspace exercise detected. Open a workspace folder with a git repository.');
            return undefined;
        }

        return workspaceExercise;
    }

    public clearContext(): void {
        this._contextStore.clearActiveContext();
        this._postSnapshot?.();
    }

    public getSelectedContext(): ActiveContext | null {
        const active = this._contextStore.getActiveContext();
        if (active?.type === 'exercise' && !active.courseId) {
            const tracked = this._contextStore.getExerciseById(active.id);
            if (tracked?.courseId) {
                return { ...active, courseId: tracked.courseId };
            }
        }
        return active;
    }

    public getSelectedExerciseId(): number | undefined {
        const active = this._contextStore.getActiveContext();
        return active?.type === 'exercise' ? active.id : undefined;
    }

    public getSelectedExercise(): { title: string; id: number } | undefined {
        const active = this._contextStore.getActiveContext();
        if (active?.type === 'exercise') {
            return { id: active.id, title: active.title };
        }
        return undefined;
    }

    public mapReasonToSource(reason: ChatContextReason): 'workspace-detected' | 'user-selected' | 'system-default' {
        return this._mapReasonToSource(reason);
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
        const irisSessionManager = this._getIrisSessionManager();
        if (irisSessionManager) {
            irisSessionManager.unsubscribe();
        }
    }

    private _clearChatMessages(): void {
        this._postMessage({ type: ExtensionMsg.ClearChatMessages });
    }
}
