import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { SessionDetail } from '@shared/types/serverContext';

import { ArtemisApiService } from '@extension/api';
import { ChatWebviewProvider } from '@extension/provider/chatWebviewProvider';
import { ContextStore } from '@extension/services/iris/context/contextStore';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

interface Harness {
    provider: ChatWebviewProvider;
    contextStore: ContextStore;
    api: sinon.SinonStubbedInstance<ArtemisApiService>;
    exerciseEvents: number[];
    sandbox: sinon.SinonSandbox;
}

/**
 * Builds a provider with BOTH the API service and a websocket service, which
 * is what makes `_conversation` (and, from Task 14, the send coordinator)
 * actually get constructed. The websocket service is a bare event source: the
 * conversation-first paths never touch anything else on it.
 */
function buildHarness(): Harness {
    const sandbox = sinon.createSandbox();
    sandbox.stub(vscode.commands, 'registerCommand').returns({ dispose: () => undefined });
    sandbox.stub(vscode.window, 'showErrorMessage');
    sandbox.stub(vscode.window, 'showWarningMessage');

    const mockContext = new MockExtensionContext();
    const contextStore = new ContextStore(mockContext);
    const api = sinon.createStubInstance(ArtemisApiService);
    const websocket = {
        onDidChangeConnectionState: new vscode.EventEmitter<{ connected: boolean }>().event,
        isConnected: () => true,
    };
    const noAi = {
        isNoAiEnabled: false,
        onNoAiStatusChanged: new vscode.EventEmitter<boolean>().event,
    };
    const registry = { getAllExercises: () => [] };
    const courseDataCache = {
        onCoursesLoaded: new vscode.EventEmitter<unknown>().event,
        fetch: async () => undefined,
    };

    const provider = new ChatWebviewProvider(
        vscode.Uri.file('/tmp'),
        mockContext as unknown as vscode.ExtensionContext,
        api as unknown as ArtemisApiService,
        websocket as never,
        noAi as never,
        registry as never,
        courseDataCache as never,
        undefined,
        contextStore,
    );

    const exerciseEvents: number[] = [];
    provider.onDidChangeExerciseContext(({ exerciseId }) => exerciseEvents.push(exerciseId));

    return { provider, contextStore, api, exerciseEvents, sandbox };
}

function detail(over: Partial<SessionDetail> = {}): SessionDetail {
    return {
        sessionId: 1,
        courseId: 42,
        context: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 },
        lastActivity: 0,
        messages: [],
        ...over,
    };
}

suite('ChatWebviewProvider: struggle decoupling', () => {
    let h: Harness;

    setup(() => { h = buildHarness(); });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    test('changing the chat topic does not retarget struggle detection', () => {
        // The provider used to fire _onDidChangeExerciseContext whenever the
        // active chat context became an exercise, pointing the detector at an
        // exercise whose code is not open.
        h.contextStore.registerExercise({ id: 7, title: 'Topic only', courseId: 42 });
        h.contextStore.setActiveContext({
            type: 'exercise', id: 7, title: 'Topic only', courseId: 42,
            source: 'user-selected', locked: false, selectedAt: Date.now(),
        });

        assert.deepStrictEqual(h.exerciseEvents, []);
    });

    test('a workspace detection change does retarget it', () => {
        h.provider.registerWorkspaceExercise({
            id: 5, title: 'BFS', courseId: 42, source: 'workspace-detected', isWorkspace: true,
        });

        assert.deepStrictEqual(h.exerciseEvents, [5]);
    });

    test('the second workspace exercise carries the first as previousExerciseId', () => {
        const previous: Array<number | undefined> = [];
        h.provider.onDidChangeExerciseContext(({ previousExerciseId }) => previous.push(previousExerciseId));

        h.provider.registerWorkspaceExercise({
            id: 5, title: 'BFS', courseId: 42, source: 'workspace-detected', isWorkspace: true,
        });
        h.contextStore.clearWorkspaceFlag();
        h.provider.registerWorkspaceExercise({
            id: 6, title: 'DFS', courseId: 42, source: 'workspace-detected', isWorkspace: true,
        });

        assert.deepStrictEqual(h.exerciseEvents, [5, 6]);
        assert.deepStrictEqual(previous, [undefined, 5]);
    });
});

suite('ChatWebviewProvider: Ask Iris', () => {
    let h: Harness;

    setup(() => { h = buildHarness(); });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    test('with no conversation open, Ask-Iris acquires one instead of refusing', async () => {
        // The cold-start row of the resolution table. Without the course hint
        // travelling with the target, the service can only answer
        // `rejected: no-course` and the dashboard button is dead on a fresh
        // window, so assert the real outcome, not a recorded call name.
        h.api.getCurrentChat.resolves(detail({ sessionId: 1 }));

        const outcome = await h.provider.askIrisAbout(
            { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' },
            42,
        );

        assert.deepStrictEqual(outcome, { kind: 'opened', sessionId: 1 });
        assert.deepStrictEqual(h.api.getCurrentChat.firstCall.args, ['PROGRAMMING_EXERCISE_CHAT', 5, 42]);
        const conversation = (h.provider as unknown as { _conversation: { state: { snapshot(): { currentSessionId?: number } } } })._conversation;
        assert.strictEqual(conversation.state.snapshot().currentSessionId, 1);
    });

    test('Ask-Iris resolves the course when the payload omits it', async () => {
        h.contextStore.registerExercise({ id: 5, title: 'BFS', courseId: 42 });
        h.api.getCurrentChat.resolves(detail({ sessionId: 1 }));

        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' });

        assert.deepStrictEqual(h.api.getCurrentChat.firstCall.args, ['PROGRAMMING_EXERCISE_CHAT', 5, 42]);
    });

    test('Ask-Iris is rejected while a send is in flight', async () => {
        const conversation = (h.provider as unknown as { _conversation: { state: { beginSend(): void } } })._conversation;
        conversation.state.beginSend();

        const outcome = await h.provider.askIrisAbout(
            { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' },
            42,
        );

        assert.deepStrictEqual(outcome, { kind: 'rejected', reason: 'send-in-flight' });
        assert.strictEqual(h.api.getCurrentChat.callCount, 0);
    });
});

suite('ChatWebviewProvider: reload Iris chat', () => {
    let h: Harness;
    let calls: string[];

    setup(() => {
        h = buildHarness();
        calls = [];
        // A recording double: the point of these two tests is WHICH service
        // calls the command makes, and the real service's `reload` decides
        // internally between reload and start.
        (h.provider as unknown as { _conversation: unknown })._conversation = {
            state: { snapshot: () => ({ currentSessionId: 7, courseId: 42 }) },
            reload: async () => { calls.push('reload'); },
            refreshOverview: async () => { calls.push('refreshOverview'); },
        };
    });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    test('re-acquires the conversation and refreshes the overview', async () => {
        await h.provider.reloadIrisChat();
        assert.deepStrictEqual(calls, ['reload', 'refreshOverview']);
    });

    test('with no conversation open it re-runs start instead of failing', async () => {
        // The real service's `reload` falls back to `start` when nothing is
        // open, so the command must simply not refuse: it drops the caches and
        // re-reads, and the overview refresh is a no-op without a course.
        const started: string[] = [];
        (h.provider as unknown as { _conversation: unknown })._conversation = {
            state: { snapshot: () => ({ currentSessionId: undefined, courseId: undefined }) },
            reload: async () => { started.push('start'); },
            refreshOverview: async () => { started.push('refreshOverview'); },
        };

        await h.provider.reloadIrisChat();

        assert.strictEqual(started[0], 'start');
    });
});
