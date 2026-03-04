import * as vscode from 'vscode';
import { ContextStore } from './contextStore';
import { ChatSessionService } from './chatSessionService';
import { IrisSessionManager } from './irisSessionManager';
import { ActiveContext, ChatContextType, TrackedExercise } from '../types';
import { logger, LogLevel, LogCategory } from './loggingService';
import { ExtensionMsg } from '../shared/messageContracts';
import type { ExtensionToWebviewMessage } from '../shared/messageContracts';

export type ChatContextReason =
    | 'user-selected'
    | 'auto-workspace'
    | 'auto-first'
    | 'auto-recent'
    | 'default'
    | 'workspace-detected';

export class ChatContextManager {
    constructor(
        private readonly _contextStore: ContextStore,
        private readonly _chatSessionService: ChatSessionService,
        private readonly _getIrisSessionManager: () => IrisSessionManager | undefined,
        private readonly _postMessage: (message: ExtensionToWebviewMessage) => void,
        private readonly _postSnapshot?: () => void,
    ) { }

    public handleContextSelection(
        contextType: ChatContextType,
        itemId: number,
        itemName: string,
        itemShortName?: string
    ): void {
        if (contextType === 'exercise') {
            const tracked = this._contextStore.getExerciseById(itemId);
            this._contextStore.registerExercise({
                id: itemId,
                title: itemName,
                shortName: itemShortName,
                courseId: tracked?.courseId,
                source: 'user-selected',
            });
        } else if (contextType === 'course') {
            this._contextStore.registerCourse({
                id: itemId,
                title: itemName,
                shortName: itemShortName,
                source: 'user-selected',
            });
        }

        this._contextStore.setActiveContext({
            type: contextType,
            id: itemId,
            title: itemName,
            shortName: itemShortName,
            courseId: contextType === 'exercise' ? this._contextStore.getExerciseById(itemId)?.courseId : undefined,
            source: 'user-selected',
            locked: false,
            selectedAt: Date.now(),
        });

        this._resetSessionForContextChange();
        this._clearChatMessages();

        const label = contextType === 'exercise' ? 'Exercise' : contextType === 'course' ? 'Course' : 'Context';
        vscode.window.showInformationMessage(`${label} context set to: ${itemName}`);

        // Load all sessions for the new context
        this._chatSessionService.loadAllSessionsForContext().catch((err: unknown) => {
            logger.error('Error loading Iris sessions:', LogCategory.IRIS_CHAT, err);
        });
    }

    public handleCourseSelection(courseId: number): void {
        const latest = this._contextStore.registerCourse({
            id: courseId,
            title: `Course ${courseId}`,
        });
        const course = latest.recentCourses.find(c => c.id === courseId) ?? latest.allCourses.find(c => c.id === courseId);

        this._contextStore.setActiveContext({
            type: 'course',
            id: courseId,
            title: course?.title ?? `Course ${courseId}`,
            shortName: course?.shortName,
            source: 'user-selected',
            locked: false,
            selectedAt: Date.now(),
        });

        this._resetSessionForContextChange();
        this._clearChatMessages();

        // Load all sessions for the new context
        this._chatSessionService.loadAllSessionsForContext().catch((err: unknown) => {
            logger.error('Error loading Iris sessions:', LogCategory.IRIS_CHAT, err);
        });
    }

    public handleExerciseSelection(exerciseId: number): void {
        const tracked = this._contextStore.getExerciseById(exerciseId);
        const latest = this._contextStore.registerExercise({
            id: exerciseId,
            title: `Exercise ${exerciseId}`,
            courseId: tracked?.courseId,
        });
        const exercise = latest.recentExercises.find(ex => ex.id === exerciseId) ?? latest.allExercises.find(ex => ex.id === exerciseId);

        this._contextStore.setActiveContext({
            type: 'exercise',
            id: exerciseId,
            title: exercise?.title ?? `Exercise ${exerciseId}`,
            shortName: exercise?.shortName,
            courseId: exercise?.courseId,
            source: 'user-selected',
            locked: false,
            selectedAt: Date.now(),
        });

        this._resetSessionForContextChange();
        this._clearChatMessages();

        vscode.window.showInformationMessage(`Exercise context set to: ${exercise?.title ?? `Exercise ${exerciseId}`}`);

        // Load all sessions for the new context
        this._chatSessionService.loadAllSessionsForContext().catch((err: unknown) => {
            logger.error('Error loading Iris sessions:', LogCategory.IRIS_CHAT, err);
        });
    }

    public handleSwitchContext(): void {
        this._contextStore.unlockActiveContext();
    }

    public handleSwitchToWorkspaceContext(): TrackedExercise | undefined {
        const snapshot = this._contextStore.snapshot();

        // Search in both recent and all exercises
        const workspaceExercise = snapshot.recentExercises.find(exercise =>
            exercise.isWorkspace || /\(Workspace\)/i.test(exercise.title)
        ) || snapshot.allExercises.find(exercise =>
            exercise.isWorkspace || /\(Workspace\)/i.test(exercise.title)
        );

        if (!workspaceExercise) {
            vscode.window.showWarningMessage('No workspace exercise detected. Open a workspace folder with a git repository.');
            return undefined;
        }

        // Return the exercise so the provider can call setExerciseContext
        return workspaceExercise;
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
        logger.context('SET EXERCISE CONTEXT Called with:', LogLevel.DEBUG, {
            exerciseId, exerciseTitle, shortName, releaseDate, dueDate, courseId, reason,
            source: this._mapReasonToSource(reason),
        });

        this._contextStore.registerExercise({
            id: exerciseId,
            title: exerciseTitle,
            shortName,
            courseId,
            releaseDate,
            dueDate,
            source: this._mapReasonToSource(reason),
            isWorkspace: reason === 'workspace-detected' || reason === 'auto-workspace',
        });

        this._contextStore.setActiveContext({
            type: 'exercise',
            id: exerciseId,
            title: exerciseTitle,
            shortName,
            courseId,
            source: this._mapReasonToSource(reason),
            locked: reason === 'workspace-detected' || reason === 'auto-workspace',
            selectedAt: Date.now(),
        }, false);

        this._finalizeContextSwitch(`exercise:${exerciseId}`, `Exercise context set to: ${exerciseTitle}`);
    }

    public setCourseContext(
        courseId: number,
        courseTitle: string,
        reason: ChatContextReason = 'user-selected',
        shortName?: string,
    ): void {
        this._contextStore.registerCourse({
            id: courseId,
            title: courseTitle,
            shortName,
            source: this._mapReasonToSource(reason),
        });

        this._contextStore.setActiveContext({
            type: 'course',
            id: courseId,
            title: courseTitle,
            shortName,
            source: this._mapReasonToSource(reason),
            locked: reason === 'workspace-detected',
            selectedAt: Date.now(),
        }, false);

        this._finalizeContextSwitch(`course:${courseId}`, `Course context set to: ${courseTitle}`);
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
            return {
                id: active.id,
                title: active.title,
            };
        }
        return undefined;
    }

    public mapReasonToSource(reason: ChatContextReason): 'workspace-detected' | 'user-selected' | 'system-default' {
        return this._mapReasonToSource(reason);
    }

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

    private _finalizeContextSwitch(contextKey: string, label: string): void {
        this._contextStore.clearSessionsForContext(contextKey);
        this._resetSessionForContextChange();
        this._clearChatMessages();
        vscode.window.showInformationMessage(label);
        void this._chatSessionService.loadAllSessionsForContext();
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
