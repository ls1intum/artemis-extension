import * as vscode from 'vscode';
import { ContextStore } from './contextStore';
import { ChatSessionService } from './chatSessionService';
import { IrisSessionManager } from './irisSessionManager';
import { ChatContextType, TrackedExercise } from '../provider/contextTypes';

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
            this._contextStore.registerExercise({
                id: itemId,
                title: itemName,
                shortName: itemShortName,
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
            console.error('Error loading Iris sessions:', err);
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
            console.error('Error loading Iris sessions:', err);
        });
    }

    public handleExerciseSelection(exerciseId: number): void {
        const latest = this._contextStore.registerExercise({
            id: exerciseId,
            title: `Exercise ${exerciseId}`,
        });
        const exercise = latest.recentExercises.find(ex => ex.id === exerciseId) ?? latest.allExercises.find(ex => ex.id === exerciseId);

        this._contextStore.setActiveContext({
            type: 'exercise',
            id: exerciseId,
            title: exercise?.title ?? `Exercise ${exerciseId}`,
            shortName: exercise?.shortName,
            source: 'user-selected',
            locked: false,
            selectedAt: Date.now(),
        });

        this._resetSessionForContextChange();
        this._clearChatMessages();

        vscode.window.showInformationMessage(`Exercise context set to: ${exercise?.title ?? `Exercise ${exerciseId}`}`);

        // Load all sessions for the new context
        this._chatSessionService.loadAllSessionsForContext().catch((err: any) => {
            console.error('Error loading Iris sessions:', err);
        });
    }

    public handleSwitchContext(): void {
        this._contextStore.unlockActiveContext();
    }

    public handleSwitchToWorkspaceContext(): TrackedExercise | undefined {
        const snapshot = this._contextStore.snapshot();

        console.log('[IRISDEBUG] _handleSwitchToWorkspaceContext called');
        console.log('[IRISDEBUG] recentExercises:', snapshot.recentExercises.map(e => ({ id: e.id, title: e.title, isWorkspace: e.isWorkspace })));
        console.log('[IRISDEBUG] allExercises with isWorkspace:', snapshot.allExercises.filter(e => e.isWorkspace).map(e => ({ id: e.id, title: e.title })));

        // Search in both recent and all exercises
        const workspaceExercise = snapshot.recentExercises.find(exercise =>
            exercise.isWorkspace || /\(Workspace\)/i.test(exercise.title)
        ) || snapshot.allExercises.find(exercise =>
            exercise.isWorkspace || /\(Workspace\)/i.test(exercise.title)
        );

        console.log('[IRISDEBUG] Found workspaceExercise:', workspaceExercise);

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
