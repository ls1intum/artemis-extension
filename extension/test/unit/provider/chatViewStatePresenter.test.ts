import * as assert from 'assert';
import * as sinon from 'sinon';

import type { ExtMsg } from '@shared/messageContracts';

import { ChatViewStatePresenter } from '@extension/provider/chatViewStatePresenter';
import { ContextStore } from '@extension/services/iris/context/contextStore';
import type { IrisConversationService } from '@extension/services/iris/conversation/conversationService';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

/**
 * Task 10 step 3: the presenter fills BOTH shapes on `updateIrisState` --
 * the old context/activeSessionId/sessions model from `ContextStore`, and
 * the new conversation-first fields from `IrisConversationService.state`.
 * `IrisConversationService` itself needs a real `ArtemisApiService` and
 * transport deps to construct, so these tests use a minimal fake that
 * only implements the exact members the presenter reads.
 */
function fakeConversation(over: {
    courseId?: number;
    currentSessionId?: number;
    detailTitle?: string;
    committedContext?: { mode: string; entityId: number; name?: string };
    pendingCtx?: { mode: string; entityId: number; name?: string };
    courseSessions?: Array<{ sessionId: number; courseId: number; context: { mode: string; entityId: number; name?: string }; title?: string; lastActivity: number }>;
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
        knownInvisible: [],
    };
    return {
        state: {
            snapshot: () => snapshot,
            displayMessageCount: () => over.displayMessageCount ?? 0,
            contentState: () => over.contentState ?? 'unknown',
            sendInFlight: over.sendInFlight ?? false,
        },
        navigationInFlight: over.navigationInFlight ?? false,
    } as unknown as IrisConversationService;
}

interface Harness {
    contextStore: ContextStore;
    postSpy: sinon.SinonSpy;
    sandbox: sinon.SinonSandbox;
    build: (getConversation: () => IrisConversationService | undefined) => ChatViewStatePresenter;
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
        build: (getConversation) => new ChatViewStatePresenter(contextStore, postSpy as never, getConversation),
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

    test('conversation getter returning undefined leaves every new field undefined; old fields still populate', () => {
        h.contextStore.registerCourse({ id: 5, title: 'Algorithms' });
        const presenter = h.build(() => undefined);

        presenter.postSnapshot();
        const state = h.latestState();

        assert.strictEqual(state.courses.length, 1, 'old-model courses must still populate');
        assert.strictEqual(state.courseId, undefined);
        assert.strictEqual(state.currentSessionId, undefined);
        assert.strictEqual(state.contentState, undefined);
        assert.strictEqual(state.conversations, undefined);
        assert.strictEqual(state.sendInFlight, undefined);
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
        // Resolved against the OLD model's course list (ConversationSnapshot
        // carries only the id, not a display title).
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

    test('workspaceExerciseId is sourced from ContextStore, independent of the conversation getter', () => {
        h.contextStore.registerExercise({ id: 12, title: 'Sorting', isWorkspace: true } as never);
        const presenter = h.build(() => undefined);

        presenter.postSnapshot();
        const state = h.latestState();

        assert.strictEqual(state.workspaceExerciseId, 12);
    });
});
