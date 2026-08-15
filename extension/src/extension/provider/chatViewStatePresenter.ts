import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage, ExtMsg } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';
import type { ServerContext } from '@shared/types/serverContext';

import type { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { CatalogProjection, CourseCatalog } from '@extension/services/courseCatalog';
import type { IrisConversationService } from '@extension/services/iris/conversation/conversationService';
import type { DetectionUiState } from '@extension/services/iris/startup/chatStartupCoordinator';
import type { WorkspaceExerciseTracker } from '@extension/services/workspace/workspaceExerciseTracker';

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
} as const satisfies Omit<IrisViewState, 'exercises' | 'courses' | 'workspaceExerciseId' | 'detectionState' | 'coursesUnavailable'>;

/**
 * What there is to project when no catalog exists at all. The catalog needs an
 * `ArtemisApiService`, which the provider treats as optional, so "no server to
 * ask" has to render as an empty picker rather than as a crash.
 */
const EMPTY_PROJECTION: CatalogProjection = { courses: [], exercises: [] };

function isPastDeadline(dueDate: string | undefined, nowMs: number): boolean {
    if (!dueDate) { return false; }
    const due = new Date(dueDate).getTime();
    return Number.isFinite(due) && due <= nowMs;
}

export class ChatViewStatePresenter {
    constructor(
        /**
         * The live view of what the server has. Optional for the same reason
         * the provider's own field is: without an `ArtemisApiService` there is
         * no catalog to build.
         */
        private readonly _catalog: CourseCatalog | undefined,
        private readonly _workspace: WorkspaceExerciseTracker,
        private readonly _courseAccess: CourseAccessStorageService,
        private readonly _postMessage: (msg: ExtensionToWebviewMessage) => void,
        /**
         * The Iris conversation service, or `undefined` when it was never
         * constructed (e.g. no ArtemisApiService). A GETTER, not a value: the
         * service is created in the provider's constructor, after the
         * presenter, so a plain value here would capture `undefined` forever.
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

    /**
     * `answersCourseRefresh` marks this snapshot as the reply to the webview's
     * `refreshCourses`. Only the handler for that command may set it: the
     * picker ends its loading state on it, and any other snapshot doing so
     * would answer a request that is still open.
     */
    public postSnapshot(options?: { answersCourseRefresh?: boolean }): void {
        const projection = this._catalog?.projection() ?? EMPTY_PROJECTION;
        const topicExerciseId = this._topicExerciseId();
        const workspaceExerciseId = this._workspace.exerciseId;
        const nowMs = Date.now();

        const exercises = projection.exercises
            .filter(ex => ex.pickable)
            // An overdue exercise the student is demonstrably still working in or
            // talking about must stay pickable, or the chip names a topic the
            // picker cannot show a checkmark for.
            .filter(ex => ex.id === workspaceExerciseId
                || ex.id === topicExerciseId
                || !isPastDeadline(ex.dueDate, nowMs))
            .map(ex => ({
                id: ex.id, title: ex.title, shortName: ex.shortName, courseId: ex.courseId,
                repositoryUri: ex.repositoryUri, releaseDate: ex.releaseDate, dueDate: ex.dueDate,
            }));

        // Detection can match inside an ARCHIVED course. If the supplemental
        // write for it never landed, the catalog knows nothing about the very
        // exercise the student has open; the tracker still does.
        const workspace = this._workspace.current;
        if (workspace && !exercises.some(ex => ex.id === workspace.id)) {
            exercises.push({
                id: workspace.id, title: workspace.title, shortName: workspace.shortName,
                courseId: workspace.courseId, repositoryUri: workspace.repositoryUri,
                releaseDate: undefined, dueDate: undefined,
            });
        }

        const courses = projection.courses.map(course => ({
            id: course.id,
            title: course.title,
            shortName: course.shortName,
            // Recency lives in the one store that already scopes it per server and
            // per principal. No second recency store is introduced.
            lastViewed: this._courseAccess.getAccessTimestamp(course.id),
        }));

        // Neither list is sorted here. `compareExercisesForPicker` and
        // `compareCoursesForPicker` reorder both in the webview, so a host-side
        // order would just be overwritten.
        const config = vscode.workspace.getConfiguration('artemis');
        this._postMessage({
            type: ExtensionMsg.UpdateIrisState,
            state: {
                exercises,
                courses,
                workspaceExerciseId,
                detectionState: this._getDetectionState(),
                // Without a catalog there is no server to ask, so there is no
                // failure to report either: the picker is empty by construction.
                coursesUnavailable: this._catalog?.coursesUnavailable ?? false,
                ...this._serializeConversation(),
            },
            showDiagnostics: config.get<boolean>('developerMode', false),
            answersCourseRefresh: options?.answersCourseRefresh,
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
            const context = this._named(summary.context, snapshot);
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
     * `entityId` alone, and without this the chip reads the literal word
     * "Topic".
     *
     * Nothing is stored, so nothing can go stale: each call answers from
     * sources that name the EXACT context being rendered. A CTXSWAP's own name
     * is already on `committedContext` (`ConversationState.applyContextSwap`),
     * so it wins here as `context.name` without any bookkeeping of ours.
     *
     * Exercises only, and only `PROGRAMMING_EXERCISE_CHAT`: a LECTURE_CHAT
     * `entityId` would collide with an exercise id and hand back a wrong title
     * with full confidence.
     *
     * The overload pair states the one fact callers need: it answers
     * `undefined` only for an `undefined` input, so the non-optional history
     * row needs no fallback of its own.
     */
    private _named(context: ServerContext, snapshot: ConversationSnapshot): ServerContext;
    private _named(context: ServerContext | undefined, snapshot: ConversationSnapshot): ServerContext | undefined;
    private _named(context: ServerContext | undefined, snapshot: ConversationSnapshot): ServerContext | undefined {
        if (!context || context.name !== undefined || context.mode !== 'PROGRAMMING_EXERCISE_CHAT') {
            return context;
        }
        const name = this._nameFromOverview(context, snapshot)
            ?? this._catalog?.exerciseTitle(context.entityId)
            ?? (this._workspace.exerciseId === context.entityId ? this._workspace.current?.title : undefined);
        return name === undefined ? context : { ...context, name };
    }

    /**
     * The overview row for THIS session, and only when it still describes THIS
     * topic. Keying on the session alone is not enough: a CTXSWAP changes the
     * topic without changing the conversation, and a session-keyed lookup would
     * label the new topic with the old exercise's name.
     */
    private _nameFromOverview(context: ServerContext, snapshot: ConversationSnapshot): string | undefined {
        const sessionId = snapshot.currentSessionId;
        if (sessionId === undefined) { return undefined; }
        for (const summary of [...snapshot.courseSessions, ...snapshot.knownInvisible]) {
            if (summary.sessionId !== sessionId) { continue; }
            if (summary.context.mode !== context.mode || summary.context.entityId !== context.entityId) { continue; }
            if (summary.context.name !== undefined) { return summary.context.name; }
        }
        return undefined;
    }

    /**
     * The open conversation, projected onto the wire.
     *
     * `courseTitle` has no equivalent in `ConversationSnapshot` (it only
     * carries `courseId`), so it is resolved against the catalog, which is
     * where a display name for a course lives.
     */
    private _serializeConversation(): Omit<IrisViewState, 'exercises' | 'courses' | 'workspaceExerciseId' | 'detectionState' | 'coursesUnavailable'> {
        const conversation = this._getConversation();
        if (!conversation) { return NO_CONVERSATION; }
        const snapshot = conversation.state.snapshot();
        return {
            courseId: snapshot.courseId,
            courseTitle: snapshot.courseId === undefined
                ? undefined
                // A conversation IS open, so "Choose a course" is a lie.
                // `Course 42` is the honest answer when nothing names it.
                : this._catalog?.courseTitle(snapshot.courseId) ?? `Course ${snapshot.courseId}`,
            currentSessionId: snapshot.currentSessionId,
            conversationTitle: snapshot.detail?.title,
            displayMessageCount: conversation.state.displayMessageCount(),
            committedContext: this._named(snapshot.committedContext, snapshot),
            pendingContext: this._named(snapshot.pendingContext?.ctx, snapshot),
            contentState: conversation.state.contentState(),
            sendInFlight: conversation.state.sendInFlight,
            navigationInFlight: conversation.navigationInFlight,
            // The overview UNION the invisible cache, deduplicated by session
            // id. `knownInvisible` holds conversations the USER-scoped overview
            // does not list, starting with the one you are in before it has a
            // user message: without the union the open conversation is absent
            // from its own history, so its checkmark has nothing to land on and
            // pressing `+` then opening an older conversation makes the new one
            // unreachable.
            conversations: this._conversationRows(snapshot),
        };
    }
}
