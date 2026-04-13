import * as vscode from 'vscode';
import type { StoredSession, ContextSnapshot } from '../types';
import type { ContextStore } from '../services/iris/contextStore';
import { ExtensionMsg } from '../../shared/messageContracts';
import type { ExtMsg, ExtensionToWebviewMessage } from '../../shared/messageContracts';

export class ChatViewStatePresenter {
    constructor(
        private readonly _contextStore: ContextStore,
        private readonly _postMessage: (msg: ExtensionToWebviewMessage) => void,
    ) {}

    public postSnapshot(options: { showContextPicker?: boolean } = {}): void {
        const snapshot = this._contextStore.snapshot();
        const payload = this._serializeSnapshot(snapshot);

        const config = vscode.workspace.getConfiguration('artemis');
        const showDiagnostics = config.get<boolean>('developerMode', false);

        this._postMessage({
            type: ExtensionMsg.UpdateIrisState,
            state: payload,
            showDiagnostics,
        });

        if (options.showContextPicker) {
            this._postMessage({
                type: ExtensionMsg.ShowContextPicker,
                state: payload,
            });
        }
    }

    private _serializeSnapshot(snapshot: ContextSnapshot): ExtMsg<'updateIrisState'>['state'] {
        return {
            context: snapshot.activeContext,
            activeSessionId: snapshot.activeSession?.id ?? null,
            sessions: snapshot.sessions.map(session => this._serializeSession(session)),
            recentExercises: snapshot.recentExercises,
            recentCourses: snapshot.recentCourses,
            allExercises: snapshot.allExercises,
            allCourses: snapshot.allCourses,
        };
    }

    private _serializeSession(session: StoredSession) {
        return {
            id: session.id,
            artemisSessionId: session.artemisSessionId,
            preview: session.preview,
            title: session.title,
            messageCount: session.messageCount,
            createdAt: session.createdAt,
            lastActivity: session.lastActivity,
        };
    }
}
