import * as assert from 'assert';
import * as sinon from 'sinon';

import type { ExtMsg } from '@shared/messageContracts';

import { ChatViewStatePresenter } from '@extension/provider/chatViewStatePresenter';
import { ContextStore } from '@extension/services/iris/context/contextStore';
import type { IrisConversationService } from '@extension/services/iris/conversation/conversationService';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

/**
 * The presenter projects the open conversation onto `updateIrisState`: the
 * tracked exercises and courses from `ContextStore`, and every
 * conversation-first field from `IrisConversationService.state`.
 * `IrisConversationService` itself needs a real `ArtemisApiService` and
 * transport deps to construct, so these tests use a minimal fake that
 * only implements the exact members the presenter reads.
 *
 * Contexts are supplied BOTH ways on purpose. `listChatSessionsForCourse` is
 * the only producer that fills `name` (from the overview's `entityName`);
 * every detail load builds `{ mode, entityId }` and nothing else, so a fixture
 * that always supplies a name tests a shape the host never sends.
 */
function fakeConversation(over: {
    courseId?: number;
    currentSessionId?: number;
    detailTitle?: string;
    committedContext?: { mode: string; entityId: number; name?: string };
    pendingCtx?: { mode: string; entityId: number; name?: string };
    courseSessions?: Array<{ sessionId: number; courseId: number; context: { mode: string; entityId: number; name?: string }; title?: string; lastActivity: number }>;
    knownInvisible?: Array<{ sessionId: number; courseId: number; context: { mode: string; entityId: number; name?: string }; title?: string; lastActivity: number }>;
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

type DetectionUiState = ExtMsg<'updateIrisState'>['state']['detectionState'];

interface Harness {
    contextStore: ContextStore;
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
    const contextStore = new ContextStore(new MockExtensionContext());
    const posted: ExtMsg<'updateIrisState'>[] = [];
    const postSpy = sandbox.spy((msg: unknown) => posted.push(msg as ExtMsg<'updateIrisState'>));

    return {
        contextStore,
        postSpy,
        sandbox,
        build: (getConversation, getDetectionState = () => 'settled') =>
            new ChatViewStatePresenter(contextStore, postSpy as never, getConversation, getDetectionState),
        latestState: () => posted[posted.length - 1].state,
    };
}

suite('ChatViewStatePresenter: conversation-first fields (Task 10)', () => {
    let h: Harness;

    setup(() => {
        h = buildHarness();
    });

    teardown(() => {
        h.sandbox.restore();
    });

    test('conversation getter returning undefined still emits every field, at its empty value', () => {
        h.contextStore.registerCourse({ id: 5, title: 'Algorithms' });
        const presenter = h.build(() => undefined);

        presenter.postSnapshot();
        const state = h.latestState();

        assert.strictEqual(state.courses.length, 1, 'the tracked courses must still populate');
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
        h.contextStore.registerCourse({ id: 5, title: 'Algorithms' });
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
        // Resolved against the tracked-course repository: ConversationSnapshot
        // carries only the id, never a display title, and this field is
        // OPTIONAL-shaped enough that losing its source blanks the header's
        // course line with no compile error anywhere.
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

    // The store hides past-deadline exercises. The presenter is the only thing
    // that knows what the conversation is about, so it has to pass the topic in
    // or the chip names an exercise the picker refuses to list.
    test('the conversation topic travels into the snapshot, so an overdue topic stays listed', () => {
        const past = '2020-01-01T00:00:00.000Z';
        h.contextStore.registerExercise({ id: 12, title: 'Sorting', dueDate: past } as never);

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
        h.contextStore.registerExercise({ id: 12, title: 'Sorting', dueDate: past } as never);

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
    test('a nameless committed topic is named from the tracked exercise', () => {
        h.contextStore.registerExercise({ id: 12, title: 'Sorting', courseId: 5 } as never);
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
        h.contextStore.registerExercise({ id: 12, title: 'Sorting', courseId: 5 } as never);
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
        h.contextStore.registerExercise({ id: 12, title: 'Sorting', courseId: 5 } as never);
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

    test('an untracked entity keeps no name, leaving the webview to name it by mode', () => {
        // Lectures are never tracked, and an exercise id would collide with a
        // lecture id, so the host must not guess here.
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

    test('workspaceExerciseId is sourced from ContextStore, independent of the conversation getter', () => {
        h.contextStore.registerExercise({ id: 12, title: 'Sorting', isWorkspace: true } as never);
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
        const presenter = h.build(() => undefined, () => 'unavailable');

        presenter.postSnapshot();

        assert.strictEqual(h.latestState().detectionState, 'unavailable');
    });
});
