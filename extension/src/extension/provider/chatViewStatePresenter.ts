import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage, ExtMsg } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import type { ContextStore } from '@extension/services/iris/context/contextStore';
import type { IrisConversationService } from '@extension/services/iris/conversation/conversationService';
import type { ContextSnapshot, StoredSession } from '@extension/types';

export class ChatViewStatePresenter {
    constructor(
        private readonly _contextStore: ContextStore,
        private readonly _postMessage: (msg: ExtensionToWebviewMessage) => void,
        /**
         * The conversation-first Iris service, or `undefined` when it was
         * never constructed (e.g. no ArtemisApiService). A GETTER, not a
         * value: the service is created in `resolveWebviewView`, the
         * presenter in the constructor, so a plain value here would capture
         * `undefined` forever. Same house pattern as
         * `IrisWebSocketMessageHandler`'s conversation getter in
         * `chatWebviewProvider.ts`.
         */
        private readonly _getConversation: () => IrisConversationService | undefined,
    ) {}

    public postSnapshot(): void {
        const snapshot = this._contextStore.snapshot();
        const config = vscode.workspace.getConfiguration('artemis');
        const showDiagnostics = config.get<boolean>('developerMode', false);
        this._postMessage({
            type: ExtensionMsg.UpdateIrisState,
            state: {
                ...this._serializeSnapshot(snapshot),
                ...this._serializeConversation(snapshot),
            },
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
            workspaceExerciseId: this._contextStore.getWorkspaceExerciseId(),
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

    /**
     * Conversation-first fields (Task 10). `undefined` when the service was
     * never constructed, so the webview keeps rendering off the old fields
     * from `_serializeSnapshot` alone. Both shapes are filled whenever the
     * service exists: both models are live at once until Task 14 cuts the
     * dispatcher over and Task 15 deletes the old fields.
     *
     * `courseTitle` has no equivalent in `ConversationSnapshot` (it only
     * carries `courseId`), so it is resolved against the old model's already
     * tracked course list, keyed by the conversation's own course id. That
     * list is the only place a display name for the course lives right now.
     */
    private _serializeConversation(contextSnapshot: ContextSnapshot): Partial<ExtMsg<'updateIrisState'>['state']> {
        const conversation = this._getConversation();
        if (!conversation) { return {}; }
        const snapshot = conversation.state.snapshot();
        return {
            // The activation flag. It is set HERE, on the same commit that
            // makes the dispatcher answer selectTopic, openConversation,
            // switchCourse and newConversation: the conversation-first
            // interface posts only those, so a flag without the handlers
            // leaves every navigation control dead, and handlers without the
            // flag leave the interface invisible.
            conversationFirst: true,
            courseId: snapshot.courseId,
            courseTitle: snapshot.courseId === undefined
                ? undefined
                : contextSnapshot.courses.find(course => course.id === snapshot.courseId)?.title,
            currentSessionId: snapshot.currentSessionId,
            conversationTitle: snapshot.detail?.title,
            displayMessageCount: conversation.state.displayMessageCount(),
            committedContext: snapshot.committedContext,
            pendingContext: snapshot.pendingContext?.ctx,
            contentState: conversation.state.contentState(),
            sendInFlight: conversation.state.sendInFlight,
            navigationInFlight: conversation.navigationInFlight,
            conversations: snapshot.courseSessions.map(summary => ({
                sessionId: summary.sessionId,
                courseId: summary.courseId,
                mode: summary.context.mode,
                entityId: summary.context.entityId,
                entityName: summary.context.name,
                title: summary.title,
                lastActivity: summary.lastActivity,
            })),
        };
    }
}
