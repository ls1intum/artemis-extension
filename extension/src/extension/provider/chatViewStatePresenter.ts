import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage, ExtMsg } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import type { ContextStore } from '../services/iris/context/contextStore';
import type { ContextSnapshot, StoredSession } from '../types';

export class ChatViewStatePresenter {
    constructor(
        private readonly _contextStore: ContextStore,
        private readonly _postMessage: (msg: ExtensionToWebviewMessage) => void,
    ) {}

    public postSnapshot(): void {
        const snapshot = this._contextStore.snapshot();
        const config = vscode.workspace.getConfiguration('artemis');
        const showDiagnostics = config.get<boolean>('developerMode', false);
        this._postMessage({
            type: ExtensionMsg.UpdateIrisState,
            state: this._serializeSnapshot(snapshot),
            showDiagnostics,
        });
    }

    private _serializeSnapshot(snapshot: ContextSnapshot): ExtMsg<'updateIrisState'>['state'] {
        return {
            context: snapshot.activeContext,
            activeSessionId: snapshot.activeSession?.id ?? null,
            sessions: snapshot.sessions.map(session => this._serializeSession(session)),
            exercises: snapshot.exercises,
            courses: snapshot.courses,
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
