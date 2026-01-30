import * as vscode from 'vscode';
import { ContextStore } from './contextStore';
import { ChatSessionService } from './chatSessionService';
import { IrisSessionManager } from './irisSessionManager';
import { ChatContextType, TrackedExercise } from '../types';
import { logger, LogCategory } from './loggingService';

export class ChatContextManager {
    constructor(
        private readonly _contextStore: ContextStore,
        private readonly _chatSessionService: ChatSessionService,
        private readonly _getIrisSessionManager: () => IrisSessionManager | undefined,
        private readonly _postMessage: (message: any) => void
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
        this._chatSessionService.loadAllSessionsForContext().catch((err: any) => {
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
        this._chatSessionService.loadAllSessionsForContext().catch((err: any) => {
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
        this._chatSessionService.loadAllSessionsForContext().catch((err: any) => {
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

    private _resetSessionForContextChange(): void {
        const irisSessionManager = this._getIrisSessionManager();
        if (irisSessionManager) {
            irisSessionManager.unsubscribe();
        }
    }

    private _clearChatMessages(): void {
        this._postMessage({ command: 'clearChatMessages' });
    }
}
