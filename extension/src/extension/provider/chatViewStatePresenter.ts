import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage, ExtMsg } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';
import type { ServerContext } from '@shared/types/serverContext';

import type { ContextStore } from '@extension/services/iris/context/contextStore';
import type { IrisConversationService } from '@extension/services/iris/conversation/conversationService';
import type { DetectionUiState } from '@extension/services/iris/startup/chatStartupCoordinator';

type IrisViewState = ExtMsg<'updateIrisState'>['state'];
type ConversationSnapshot = ReturnType<IrisConversationService['state']['snapshot']>;

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
} as const satisfies Omit<IrisViewState, 'exercises' | 'courses' | 'workspaceExerciseId' | 'detectionState'>;

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
        /**
         * The startup coordinator's latest published detection state. A
         * getter, not a value, for the same reason `_getConversation` is: the
         * coordinator is constructed after the presenter, so a plain value
         * here would capture whatever it was at construction time forever.
         */
        private readonly _getDetectionState: () => DetectionUiState,
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
                detectionState: this._getDetectionState(),
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
     * The course's conversations for the history popover: the overview rows
     * plus the ones only the invisible cache knows about, deduplicated by
     * session id with the overview row winning. Both sources are already
     * course-scoped (`setCourse` clears the cache), and `updateSummary` keeps a
     * session in exactly one of them, so the dedup is a guarantee rather than a
     * repair.
     */
    private _conversationRows(snapshot: ConversationSnapshot): IrisViewState['conversations'] {
        const byId = new Map<number, ConversationSnapshot['courseSessions'][number]>();
        for (const summary of [...snapshot.knownInvisible, ...snapshot.courseSessions]) {
            byId.set(summary.sessionId, summary);
        }
        return [...byId.values()].map(summary => {
            const context = this._named(summary.context);
            return {
                sessionId: summary.sessionId,
                courseId: summary.courseId,
                mode: context.mode,
                entityId: context.entityId,
                entityName: context.name,
                title: summary.title,
                lastActivity: summary.lastActivity,
            };
        });
    }

    /**
     * Fills a display name the SERVER did not supply. Only the overview
     * endpoint returns `entityName`; every detail load (`sessions/current`, the
     * by-id GET, a fresh conversation) builds its context from `mode` and
     * `entityId` alone. Without this the chip reads the literal word "Topic"
     * and a history row falls back to its mode.
     *
     * Exercises only, and only `PROGRAMMING_EXERCISE_CHAT`, exactly like
     * `_availabilityContext`: the tracked repository holds programming
     * exercises, and a LECTURE_CHAT `entityId` would collide with an exercise
     * id and hand back a wrong title with full confidence.
     *
     * The overload pair states the one fact callers need: it answers
     * `undefined` only for an `undefined` input, so the non-optional history
     * row needs no fallback of its own.
     */
    private _named(context: ServerContext): ServerContext;
    private _named(context: ServerContext | undefined): ServerContext | undefined;
    private _named(context: ServerContext | undefined): ServerContext | undefined {
        if (!context || context.name !== undefined || context.mode !== 'PROGRAMMING_EXERCISE_CHAT') {
            return context;
        }
        const title = this._contextStore.getExerciseById(context.entityId)?.title;
        return title === undefined ? context : { ...context, name: title };
    }

    /**
     * The open conversation, projected onto the wire.
     *
     * `courseTitle` has no equivalent in `ConversationSnapshot` (it only
     * carries `courseId`), so it is resolved against the tracked-course
     * repository, which is where a display name for a course lives.
     */
    private _serializeConversation(): Omit<IrisViewState, 'exercises' | 'courses' | 'workspaceExerciseId' | 'detectionState'> {
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
            committedContext: this._named(snapshot.committedContext),
            pendingContext: this._named(snapshot.pendingContext?.ctx),
            contentState: conversation.state.contentState(),
            sendInFlight: conversation.state.sendInFlight,
            navigationInFlight: conversation.navigationInFlight,
            // The overview UNION the invisible cache (spec 5.4), deduplicated by
            // session id. `knownInvisible` holds conversations the USER-scoped
            // overview does not list, starting with the one you are in before
            // it has a user message: without the union the open conversation is
            // simply absent from its own history, so §5.4's checkmark has
            // nothing to land on and pressing `+` then opening an older
            // conversation makes the new one unreachable.
            conversations: this._conversationRows(snapshot),
        };
    }
}
