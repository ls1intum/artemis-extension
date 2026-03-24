import * as vscode from 'vscode';
import { IrisChatSessionService } from './chatSessionService';
import { IrisWebSocketSessionClient } from './irisWebSocketSessionClient';
import { ActiveContext, ChatContextType, TrackedExercise } from '../../types';
import { logger, LogCategory } from '../loggingService';
import { ExtensionMsg } from '../../shared/messageContracts';
import type { IrisServiceDeps } from './sessionSyncUtils';

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

        // Step 2: Set active context (ensureSession=false — sessions loaded below)
        this.deps.contextStore.setActiveContext({
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
            ? this.deps.contextStore.getExerciseById(itemId)?.courseId
            : undefined;
        this.switchContext({ type: contextType, id: itemId, title: itemName, shortName: itemShortName, courseId });
    }

    public handleCourseSelection(courseId: number): void {
        const snapshot = this.deps.contextStore.snapshot();
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
        const tracked = this.deps.contextStore.getExerciseById(exerciseId);
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
        this.deps.contextStore.unlockActiveContext();
    }

    public handleSwitchToWorkspaceContext(): TrackedExercise | undefined {
        const workspaceExercise = this.deps.contextStore.getWorkspaceExercise();

        if (!workspaceExercise) {
            vscode.window.showWarningMessage('No workspace exercise detected. Open a workspace folder with a git repository.');
            return undefined;
        }

        return workspaceExercise;
    }

    public clearContext(): void {
        this.deps.contextStore.clearActiveContext();
        this.deps.postSnapshot();
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

    public getSelectedExercise(): { title: string; id: number } | undefined {
        const active = this.deps.contextStore.getActiveContext();
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
        const irisSessionManager = this._getIrisWebSocketSessionClient();
        if (irisSessionManager) {
            irisSessionManager.resetSession();
        }
    }

    private _clearChatMessages(): void {
        this.deps.postMessage({ type: ExtensionMsg.ClearChatMessages });
    }
}
