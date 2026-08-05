import * as assert from 'assert';
import * as sinon from 'sinon';

import type { ExtMsg } from '@shared/messageContracts';

import { ChatViewStatePresenter } from '@extension/provider/chatViewStatePresenter';
import type { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { CatalogCourse, CatalogExercise, CatalogProjection, CourseCatalog } from '@extension/services/courseCatalog';
import type { IrisConversationService } from '@extension/services/iris/conversation/conversationService';
import { WorkspaceExerciseTracker } from '@extension/services/workspace/workspaceExerciseTracker';

/**
 * The presenter projects the open conversation onto `updateIrisState`: the
 * pickable exercises and courses from the live `CourseCatalog`, the folder's
 * exercise from `WorkspaceExerciseTracker`, and every conversation-first field
 * from `IrisConversationService.state`. `IrisConversationService` itself needs
 * a real `ArtemisApiService` and transport deps to construct, so these tests
 * use a minimal fake that only implements the exact members the presenter
 * reads.
 *
 * Contexts are supplied BOTH ways on purpose. `listChatSessionsForCourse` is
 * the only producer that fills `name` (from the overview's `entityName`);
 * every detail load builds `{ mode, entityId }` and nothing else, so a fixture
 * that always supplies a name tests a shape the host never sends.
 */

/**
 * A minimal `CourseCatalog` double. Only the three read methods the presenter
 * calls exist, and the two title lookups answer from the same arrays
 * `projection()` returns, exactly as the real catalog derives them.
 */
class FakeCatalog {
    public courses: CatalogCourse[] = [];
    public exercises: CatalogExercise[] = [];

    public projection(): CatalogProjection {
        return { courses: this.courses, exercises: this.exercises };
    }

    public courseTitle(courseId: number): string | undefined {
        return this.courses.find(c => c.id === courseId)?.title;
    }

    public exerciseTitle(exerciseId: number): string | undefined {
        return this.exercises.find(e => e.id === exerciseId)?.title;
    }
}

/** Only `getAccessTimestamp` is read by the presenter. */
class FakeCourseAccess {
    public timestamps: Record<number, number> = {};

    public getAccessTimestamp(courseId: number): number | undefined {
        return this.timestamps[courseId];
    }
}

type ContextLike = { mode: string; entityId: number; name?: string };
type RowLike = { sessionId: number; courseId: number; context: ContextLike; title?: string; lastActivity: number };

function fakeConversation(over: {
    courseId?: number;
    currentSessionId?: number;
    detailTitle?: string;
    committedContext?: ContextLike;
    pendingCtx?: ContextLike;
    courseSessions?: RowLike[];
    knownInvisible?: RowLike[];
    displayMessageCount?: number;
    contentState?: 'unknown' | 'empty' | 'content';
    sendInFlight?: boolean;
    navigationInFlight?: boolean;
} = {}): IrisConversationService {
    const snapshot = {
        courseId: over.courseId,
        currentSessionId: over.currentSessionId,
        detail: over.detailTitle === undefined ? undefined : { title: over.detailTitle },
        committedContext: over.committedContext,
        pendingContext: over.pendingCtx === undefined ? undefined : { ctx: over.pendingCtx, sessionId: over.currentSessionId ?? 0, baseRevision: 0 },
        courseSessions: over.courseSessions ?? [],
        knownInvisible: over.knownInvisible ?? [],
    };
    return {
        state: {
            snapshot: () => snapshot,
            displayMessageCount: () => over.displayMessageCount ?? 0,
            contentState: () => over.contentState ?? 'unknown',
            sendInFlight: over.sendInFlight ?? false,
            // `pending ?? committed`, exactly as ConversationState computes it.
            effectiveContext: () => over.pendingCtx ?? over.committedContext,
        },
        navigationInFlight: over.navigationInFlight ?? false,
    } as unknown as IrisConversationService;
}

/**
 * The same double, but read LAZILY: every field is looked up on each
 * `postSnapshot()`, so a test can build the presenter once in `setup` and then
 * state its scenario field by field.
 */
interface MutableConversation {
    courseId: number | undefined;
    currentSessionId: number | undefined;
    committed: ContextLike | undefined;
    pending: ContextLike | undefined;
    courseSessions: RowLike[];
    knownInvisible: RowLike[];
}

function mutableConversation(): { mut: MutableConversation; service: IrisConversationService } {
    const mut: MutableConversation = {
        courseId: undefined,
        currentSessionId: undefined,
        committed: undefined,
        pending: undefined,
        courseSessions: [],
        knownInvisible: [],
    };
    const service = {
        state: {
            snapshot: () => ({
                courseId: mut.courseId,
                currentSessionId: mut.currentSessionId,
                detail: undefined,
                committedContext: mut.committed,
                pendingContext: mut.pending === undefined ? undefined : { ctx: mut.pending, sessionId: mut.currentSessionId ?? 0, baseRevision: 0 },
                courseSessions: mut.courseSessions,
                knownInvisible: mut.knownInvisible,
            }),
            displayMessageCount: () => 0,
            contentState: () => 'unknown',
            sendInFlight: false,
            effectiveContext: () => mut.pending ?? mut.committed,
        },
        navigationInFlight: false,
    } as unknown as IrisConversationService;
    return { mut, service };
}

type DetectionUiState = ExtMsg<'updateIrisState'>['state']['detectionState'];

interface Harness {
    catalog: FakeCatalog;
    tracker: WorkspaceExerciseTracker;
    access: FakeCourseAccess;
    postSpy: sinon.SinonSpy;
    sandbox: sinon.SinonSandbox;
    /**
     * `getDetectionState` defaults to `'settled'`: none of the pre-existing
     * tests in this file care about it, and `'settled'` is the value that
     * keeps their conversation-shaped assertions unaffected by an unrelated
     * field.
     */
    build: (
        getConversation: () => IrisConversationService | undefined,
        getDetectionState?: () => DetectionUiState,
    ) => ChatViewStatePresenter;
    latestState: () => ExtMsg<'updateIrisState'>['state'];
}

function buildHarness(): Harness {
    const sandbox = sinon.createSandbox();
    const catalog = new FakeCatalog();
    const tracker = new WorkspaceExerciseTracker();
    const access = new FakeCourseAccess();
    const posted: ExtMsg<'updateIrisState'>[] = [];
    const postSpy = sandbox.spy((msg: unknown) => posted.push(msg as ExtMsg<'updateIrisState'>));

    return {
        catalog,
        tracker,
        access,
        postSpy,
        sandbox,
        build: (getConversation, getDetectionState = () => 'settled') =>
            new ChatViewStatePresenter(
                catalog as unknown as CourseCatalog,
                tracker,
                access as unknown as CourseAccessStorageService,
                postSpy as never,
                getConversation,
                getDetectionState,
            ),
        latestState: () => posted[posted.length - 1].state,
    };
}

suite('ChatViewStatePresenter: conversation-first fields (Task 10)', () => {
    let h: Harness;

    setup(() => {
        h = buildHarness();
    });

    teardown(() => {
        h.tracker.dispose();
        h.sandbox.restore();
    });

    test('conversation getter returning undefined still emits every field, at its empty value', () => {
        h.catalog.courses = [{ id: 5, title: 'Algorithms' }];
        const presenter = h.build(() => undefined);

        presenter.postSnapshot();
        const state = h.latestState();

        assert.strictEqual(state.courses.length, 1, 'the catalog courses must still populate');
        assert.strictEqual(state.courseId, undefined);
        assert.strictEqual(state.courseTitle, undefined);
        assert.strictEqual(state.currentSessionId, undefined);
        // 'unknown', not undefined: every field is required on the wire now, so
        // "no conversation" has to be stated rather than left off.
        assert.strictEqual(state.contentState, 'unknown');
        assert.deepStrictEqual(state.conversations, []);
        assert.strictEqual(state.sendInFlight, false);
        assert.strictEqual(state.navigationInFlight, false);
        assert.strictEqual(state.displayMessageCount, 0);
    });

    test('conversation getter returning a live service populates every new field from its state', () => {
        h.catalog.courses = [{ id: 5, title: 'Algorithms' }];
        const conversation = fakeConversation({
            courseId: 5,
            currentSessionId: 42,
            detailTitle: 'Recursion help',
            committedContext: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 12, name: 'Sorting' },
            pendingCtx: { mode: 'COURSE_CHAT', entityId: 5 },
            courseSessions: [
                { sessionId: 42, courseId: 5, context: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 12, name: 'Sorting' }, title: 'Recursion help', lastActivity: 1_700_000_000_000 },
            ],
            displayMessageCount: 3,
            contentState: 'content',
            sendInFlight: true,
            navigationInFlight: true,
        });
        const presenter = h.build(() => conversation);

        presenter.postSnapshot();
        const state = h.latestState();

        assert.strictEqual(state.courseId, 5);
        // Resolved against the catalog: ConversationSnapshot carries only the
        // id, never a display title, and this field is OPTIONAL-shaped enough
        // that losing its source blanks the header's course line with no
        // compile error anywhere.
        assert.strictEqual(state.courseTitle, 'Algorithms');
        assert.strictEqual(state.currentSessionId, 42);
        assert.strictEqual(state.conversationTitle, 'Recursion help');
        assert.strictEqual(state.displayMessageCount, 3);
        assert.deepStrictEqual(state.committedContext, { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 12, name: 'Sorting' });
        assert.deepStrictEqual(state.pendingContext, { mode: 'COURSE_CHAT', entityId: 5 });
        assert.strictEqual(state.contentState, 'content');
        assert.strictEqual(state.sendInFlight, true);
        assert.strictEqual(state.navigationInFlight, true);
        assert.strictEqual(state.conversations?.length, 1);
        assert.strictEqual(state.conversations?.[0].sessionId, 42);
        assert.strictEqual(state.conversations?.[0].entityName, 'Sorting');
    });

    // The presenter hides past-deadline exercises. It is also the only thing
    // that knows what the conversation is about, so the topic has to survive
    // that filter or the chip names an exercise the picker refuses to list.
    test('the conversation topic survives the past-deadline filter, so an overdue topic stays listed', () => {
        const past = '2020-01-01T00:00:00.000Z';
        h.catalog.exercises = [{ id: 12, courseId: 5, title: 'Sorting', dueDate: past, pickable: true }];

        const withoutTopic = h.build(() => undefined);
        withoutTopic.postSnapshot();
        assert.deepStrictEqual(h.latestState().exercises.map(e => e.id), [],
            'precondition: an overdue exercise is hidden');

        const presenter = h.build(() => fakeConversation({
            courseId: 5,
            currentSessionId: 42,
            committedContext: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 12, name: 'Sorting' },
        }));
        presenter.postSnapshot();

        assert.deepStrictEqual(h.latestState().exercises.map(e => e.id), [12]);
    });

    test('a STAGED topic keeps its exercise listed too, so the checkmark has somewhere to land', () => {
        const past = '2020-01-01T00:00:00.000Z';
        h.catalog.exercises = [{ id: 12, courseId: 5, title: 'Sorting', dueDate: past, pickable: true }];

        const presenter = h.build(() => fakeConversation({
            courseId: 5,
            currentSessionId: 42,
            committedContext: { mode: 'COURSE_CHAT', entityId: 5 },
            pendingCtx: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 12, name: 'Sorting' },
        }));
        presenter.postSnapshot();

        assert.deepStrictEqual(h.latestState().exercises.map(e => e.id), [12]);
    });

    // THE SHAPE THE HOST ACTUALLY PRODUCES. `_toSessionDetail` builds
    // `context: { mode, entityId }` and never sets `name`, so on every load
    // path the committed and pending contexts reach the webview nameless.
    test('a nameless committed topic is named from the catalog', () => {
        h.catalog.exercises = [{ id: 12, courseId: 5, title: 'Sorting', pickable: true }];
        const presenter = h.build(() => fakeConversation({
            courseId: 5,
            currentSessionId: 42,
            committedContext: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 12 },
        }));

        presenter.postSnapshot();

        assert.strictEqual(h.latestState().committedContext?.name, 'Sorting',
            'without this the chip reads the literal word "Topic"');
    });

    test('a nameless STAGED topic is named too, so the chip does not change label on commit', () => {
        h.catalog.exercises = [{ id: 12, courseId: 5, title: 'Sorting', pickable: true }];
        const presenter = h.build(() => fakeConversation({
            courseId: 5,
            currentSessionId: 42,
            committedContext: { mode: 'COURSE_CHAT', entityId: 5 },
            pendingCtx: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 12 },
        }));

        presenter.postSnapshot();

        assert.strictEqual(h.latestState().pendingContext?.name, 'Sorting');
    });

    test('a nameless history row is named too, so the open conversation is not labelled a course chat', () => {
        h.catalog.exercises = [{ id: 12, courseId: 5, title: 'Sorting', pickable: true }];
        const presenter = h.build(() => fakeConversation({
            courseId: 5,
            currentSessionId: 42,
            courseSessions: [{
                sessionId: 42, courseId: 5,
                context: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 12 },
                title: 'BFS loop', lastActivity: 1,
            }],
        }));

        presenter.postSnapshot();

        assert.strictEqual(h.latestState().conversations?.[0].entityName, 'Sorting');
    });

    test('an entity the catalog does not know keeps no name, leaving the webview to name it by mode', () => {
        // Lectures are never in the catalog, and an exercise id would collide
        // with a lecture id, so the host must not guess here.
        const presenter = h.build(() => fakeConversation({
            courseId: 5,
            currentSessionId: 42,
            courseSessions: [{
                sessionId: 42, courseId: 5,
                context: { mode: 'LECTURE_CHAT', entityId: 12 },
                lastActivity: 1,
            }],
        }));

        presenter.postSnapshot();

        assert.strictEqual(h.latestState().conversations?.[0].entityName, undefined);
    });

    // Spec 5.4: the history is `courseSessions` UNION `knownInvisible`. The
    // conversation you are in is invisible-only until it has a user message.
    test('a conversation known only to the invisible cache still reaches the history', () => {
        const presenter = h.build(() => fakeConversation({
            courseId: 5,
            currentSessionId: 43,
            courseSessions: [{
                sessionId: 42, courseId: 5, context: { mode: 'COURSE_CHAT', entityId: 5 }, lastActivity: 2,
            }],
            knownInvisible: [{
                sessionId: 43, courseId: 5, context: { mode: 'COURSE_CHAT', entityId: 5 }, lastActivity: 1,
            }],
        }));

        presenter.postSnapshot();

        assert.deepStrictEqual(
            h.latestState().conversations?.map(c => c.sessionId).sort(),
            [42, 43],
        );
    });

    test('a session in both sources is listed once, with the overview row', () => {
        const presenter = h.build(() => fakeConversation({
            courseId: 5,
            currentSessionId: 42,
            courseSessions: [{
                sessionId: 42, courseId: 5, context: { mode: 'COURSE_CHAT', entityId: 5 }, title: 'Fresh', lastActivity: 2,
            }],
            knownInvisible: [{
                sessionId: 42, courseId: 5, context: { mode: 'COURSE_CHAT', entityId: 5 }, title: 'Stale', lastActivity: 1,
            }],
        }));

        presenter.postSnapshot();

        assert.strictEqual(h.latestState().conversations?.length, 1);
        assert.strictEqual(h.latestState().conversations?.[0].title, 'Fresh');
    });

    test('workspaceExerciseId is sourced from the workspace tracker, independent of the conversation getter', () => {
        h.tracker.set({ id: 12, title: 'Sorting', courseId: 5 });
        const presenter = h.build(() => undefined);

        presenter.postSnapshot();
        const state = h.latestState();

        assert.strictEqual(state.workspaceExerciseId, 12);
    });

    // Task 8: the coordinator's live detection state has to reach the wire.
    // The React tests inject snapshots directly and bypass this bridge
    // entirely, so only a host-side test can catch a presenter that hard-codes
    // the value instead of reading it from the getter.
    test('the snapshot carries the current detection state', () => {
        // A single snapshot cannot tell "reads the getter every call" apart
        // from "reads it once and caches it": both answer the same value on
        // the first post. The getter's return value changes between the two
        // `postSnapshot()` calls below specifically to rule out caching - a
        // presenter that memoized the first read (e.g. `this._cached ??=
        // this._getDetectionState()`) would still pass a single-snapshot
        // version of this test but would freeze the wire at `'unavailable'`
        // forever in production, and the course chooser would never appear.
        let detectionState: 'unsettled' | 'settled' | 'unavailable' = 'unavailable';
        const presenter = h.build(() => undefined, () => detectionState);

        presenter.postSnapshot();
        assert.strictEqual(h.latestState().detectionState, 'unavailable');

        detectionState = 'settled';
        presenter.postSnapshot();
        assert.strictEqual(h.latestState().detectionState, 'settled');
    });
});

suite('ChatViewStatePresenter: the catalog projection (Task 9)', () => {
    let h: Harness;
    let catalog: FakeCatalog;
    let tracker: WorkspaceExerciseTracker;
    let access: FakeCourseAccess;
    let conversation: MutableConversation;
    let presenter: ChatViewStatePresenter;
    let lastState: () => ExtMsg<'updateIrisState'>['state'];

    setup(() => {
        h = buildHarness();
        catalog = h.catalog;
        tracker = h.tracker;
        access = h.access;
        const live = mutableConversation();
        conversation = live.mut;
        presenter = h.build(() => live.service);
        lastState = h.latestState;
    });

    teardown(() => {
        h.tracker.dispose();
        h.sandbox.restore();
    });

    test('a past-deadline exercise is hidden', () => {
        catalog.exercises = [{ id: 1, courseId: 9, title: 'Old', dueDate: '2000-01-01T00:00:00Z', pickable: true }];
        presenter.postSnapshot();
        assert.deepStrictEqual(lastState().exercises, []);
    });

    test('a past-deadline exercise stays when it is the workspace one', () => {
        catalog.exercises = [{ id: 1, courseId: 9, title: 'Old', dueDate: '2000-01-01T00:00:00Z', pickable: true }];
        tracker.set({ id: 1, title: 'Old', courseId: 9 });
        presenter.postSnapshot();
        assert.deepStrictEqual(lastState().exercises.map(e => e.id), [1]);
        // The id alone cannot tell the two ways of arriving here apart: the
        // always-offerable fallback would push a tracker-shaped row for the
        // very same id. Only the CATALOG row carries the due date, so this is
        // what proves the filter let it through rather than the fallback
        // re-adding it.
        assert.strictEqual(lastState().exercises[0]?.dueDate, '2000-01-01T00:00:00Z');
    });

    test('a past-deadline exercise stays when it is the current topic', () => {
        catalog.exercises = [{ id: 1, courseId: 9, title: 'Old', dueDate: '2000-01-01T00:00:00Z', pickable: true }];
        conversation.committed = { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 1 };
        presenter.postSnapshot();
        assert.deepStrictEqual(lastState().exercises.map(e => e.id), [1]);
    });

    test('an exercise with no participation is not offered', () => {
        catalog.exercises = [{ id: 1, courseId: 9, title: 'No participation', pickable: false }];
        presenter.postSnapshot();
        assert.deepStrictEqual(lastState().exercises, []);
    });

    test('the workspace exercise is offered even when the catalog has no entity for it', () => {
        catalog.exercises = [];
        tracker.set({ id: 42, title: 'Archived exercise', courseId: 9 });
        presenter.postSnapshot();
        assert.deepStrictEqual(lastState().exercises.map(e => e.id), [42]);
    });

    test('a course carries its access timestamp for the picker order', () => {
        catalog.courses = [{ id: 9, title: 'C' }];
        access.timestamps[9] = 1234;
        presenter.postSnapshot();
        assert.strictEqual(lastState().courses[0]?.lastViewed, 1234);
    });

    test('a server-supplied name wins over the catalog', () => {
        catalog.exercises = [{ id: 1, courseId: 9, title: 'Catalog name', pickable: true }];
        conversation.committed = { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 1, name: 'Marker name' };
        presenter.postSnapshot();
        assert.strictEqual(lastState().committedContext?.name, 'Marker name');
    });

    test('an overview row names the topic when the detail load could not', () => {
        conversation.committed = { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 1 };
        conversation.currentSessionId = 5;
        conversation.courseSessions = [{ sessionId: 5, courseId: 9, context: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 1, name: 'From overview' }, lastActivity: 0 }];
        presenter.postSnapshot();
        assert.strictEqual(lastState().committedContext?.name, 'From overview');
    });

    test('an overview row for another topic in the same session names nothing', () => {
        conversation.committed = { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 2 };
        conversation.currentSessionId = 5;
        conversation.courseSessions = [{ sessionId: 5, courseId: 9, context: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 1, name: 'Old topic' }, lastActivity: 0 }];
        presenter.postSnapshot();
        assert.strictEqual(lastState().committedContext?.name, undefined);
    });

    test('an open conversation in an unnamed course reads Course 9, not nothing', () => {
        conversation.courseId = 9;
        catalog.courses = [];
        presenter.postSnapshot();
        assert.strictEqual(lastState().courseTitle, 'Course 9');
    });

    test('a cold start has no course title', () => {
        conversation.courseId = undefined;
        presenter.postSnapshot();
        assert.strictEqual(lastState().courseTitle, undefined);
    });
});
