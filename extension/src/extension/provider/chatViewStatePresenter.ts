import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage, ExtMsg } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import type { ContextStore } from '@extension/services/iris/context/contextStore';
import type { IrisConversationService } from '@extension/services/iris/conversation/conversationService';

type IrisViewState = ExtMsg<'updateIrisState'>['state'];

/** The conversation half of the snapshot when no conversation service exists. */
const NO_CONVERSATION = {
    courseId: undefined,
    courseTitle: undefined,
    currentSessionId: undefined,
    conversationTitle: undefined,
    displayMessageCount: 0,
    committedContext: undefined,
    pendingContext: undefined,
    contentState: 'unknown',
    sendInFlight: false,
    navigationInFlight: false,
    conversations: [],
} as const satisfies Omit<IrisViewState, 'exercises' | 'courses' | 'workspaceExerciseId'>;

export class ChatViewStatePresenter {
    constructor(
        private readonly _contextStore: ContextStore,
        private readonly _postMessage: (msg: ExtensionToWebviewMessage) => void,
        /**
         * The Iris conversation service, or `undefined` when it was never
         * constructed (e.g. no ArtemisApiService). A GETTER, not a value: the
         * service is created in the provider's constructor, after the
         * presenter, so a plain value here would capture `undefined` forever.
         * Same house pattern as `IrisWebSocketMessageHandler`'s conversation
         * getter in `chatWebviewProvider.ts`.
         */
        private readonly _getConversation: () => IrisConversationService | undefined,
    ) {}

    public postSnapshot(): void {
        // The topic travels INTO the snapshot: the tracked-item store hides
        // past-deadline exercises, and the one the conversation is about has
        // to survive that filter.
        const snapshot = this._contextStore.snapshot(this._topicExerciseId());
        const config = vscode.workspace.getConfiguration('artemis');
        const showDiagnostics = config.get<boolean>('developerMode', false);
        this._postMessage({
            type: ExtensionMsg.UpdateIrisState,
            state: {
                exercises: snapshot.exercises,
                courses: snapshot.courses,
                workspaceExerciseId: this._contextStore.getWorkspaceExerciseId(),
                ...this._serializeConversation(),
            },
            showDiagnostics,
        });
    }

    /**
     * The exercise the open conversation is about, when it is about one.
     * `effectiveContext()` is `pending ?? committed`, which is exactly what
     * the picker draws its checkmark on, so both must resolve to the same
     * exercise or a staged overdue topic disappears from the list it was
     * staged from.
     */
    private _topicExerciseId(): number | undefined {
        const topic = this._getConversation()?.state.effectiveContext();
        return topic?.mode === 'PROGRAMMING_EXERCISE_CHAT' ? topic.entityId : undefined;
    }

    /**
     * The open conversation, projected onto the wire.
     *
     * `courseTitle` has no equivalent in `ConversationSnapshot` (it only
     * carries `courseId`), so it is resolved against the tracked-course
     * repository, which is where a display name for a course lives.
     */
    private _serializeConversation(): Omit<IrisViewState, 'exercises' | 'courses' | 'workspaceExerciseId'> {
        const conversation = this._getConversation();
        if (!conversation) { return NO_CONVERSATION; }
        const snapshot = conversation.state.snapshot();
        return {
            courseId: snapshot.courseId,
            courseTitle: snapshot.courseId === undefined
                ? undefined
                : this._contextStore.getCourseTitle(snapshot.courseId),
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
