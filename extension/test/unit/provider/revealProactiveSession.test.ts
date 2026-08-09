/**
 * Reveal path after the conversation-model migration (#364 spec A, ported in the
 * dev merge).
 *
 * Two guarantees live here that a compiler cannot hold up:
 *
 *  1. The stale guard reads the SERVICE's navigation request token, not
 *     `ConversationState.navigationGeneration`. The two advance at different
 *     moments: the request sequence when a navigation is admitted, the state
 *     generation only once a conversation actually installs. A reveal that was
 *     armed before a still-in-flight navigation must already be refused, so
 *     reading the wrong counter silently disables the guard rather than
 *     breaking the build.
 *
 *  2. Focus does not wait for the conversation to load. The reveal opens the
 *     session without awaiting it, so a collapsed chat view appears at once
 *     instead of after a network round trip.
 */
import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ChatWebviewProvider } from '@extension/provider/chatWebviewProvider';
import { WorkspaceExerciseTracker } from '@extension/services/workspace/workspaceExerciseTracker';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

interface Harness {
    provider: ChatWebviewProvider;
    sandbox: sinon.SinonSandbox;
    navigateTo: sinon.SinonStub;
    focus: sinon.SinonStub;
    /** Advances the service-level request sequence, as starting a navigation does. */
    startNavigation(): void;
}

function buildHarness(opts: { navigateTo?: sinon.SinonStub } = {}): Harness {
    const sandbox = sinon.createSandbox();
    sandbox.stub(vscode.commands, 'registerCommand').returns({ dispose: () => undefined });
    const focus = sandbox.stub(vscode.commands, 'executeCommand').resolves();

    const provider = new ChatWebviewProvider(
        vscode.Uri.file('/tmp'),
        new MockExtensionContext() as unknown as vscode.ExtensionContext,
        { setProactiveOutcome: sinon.stub().resolves() } as never,
        undefined,
        { isNoAiEnabled: false, onNoAiStatusChanged: new vscode.EventEmitter<boolean>().event } as never,
        { getAllExercises: () => [] } as never,
        { onCoursesLoaded: new vscode.EventEmitter<unknown>().event, fetch: async () => undefined } as never,
        undefined,
        new WorkspaceExerciseTracker(),
        { getAccessTimestamp: () => undefined } as never,
        { state: 'authenticated', epoch: 0 } as never,
    );

    const navigateTo = opts.navigateTo ?? sinon.stub().resolves();
    let requestToken = 0;
    (provider as unknown as { _conversation: unknown })._conversation = {
        get navigationRequestToken() { return requestToken; },
        navigateTo,
        state: { snapshot: () => ({ currentSessionId: 4711 }) },
    };

    return { provider, sandbox, navigateTo, focus, startNavigation: () => { requestToken += 1; } };
}

suite('ChatWebviewProvider reveal (conversation model)', () => {
    let h: Harness;
    teardown(() => h.sandbox.restore());

    test('refuses a reveal whose navigation token is stale, without navigating or focusing', async () => {
        h = buildHarness();
        const armed = h.provider.currentNavToken();

        // The student navigates somewhere else while the reveal is being persisted.
        h.startNavigation();

        const revealed = await h.provider.revealProactiveSessionForExercise(10, 7, 4711, 'Ex', armed);

        assert.strictEqual(revealed, false, 'a stale reveal must report that it did nothing');
        assert.strictEqual(h.navigateTo.callCount, 0, 'a stale reveal must not navigate');
        assert.strictEqual(
            h.focus.getCalls().filter(c => c.args[0] === 'iris.chatView.focus').length,
            0,
            'a stale reveal must not steal focus',
        );
    });

    test('reads the service request token, so a navigation that has started but not installed already invalidates a reveal', async () => {
        h = buildHarness();
        const armed = h.provider.currentNavToken();

        // A navigation is admitted but its detail request has not returned, so no
        // conversation has installed yet. `navigationGeneration` would still be
        // unchanged here; the request sequence is what moved.
        h.startNavigation();

        assert.notStrictEqual(h.provider.currentNavToken(), armed, 'the token must move when a navigation starts');
        assert.strictEqual(
            await h.provider.revealProactiveSessionForExercise(10, 7, 4711, 'Ex', armed),
            false,
        );
    });

    test('navigates to the target conversation by course AND session', async () => {
        h = buildHarness();
        const revealed = await h.provider.revealProactiveSessionForExercise(10, 7, 4711, 'Ex', h.provider.currentNavToken());

        assert.strictEqual(revealed, true);
        assert.deepStrictEqual(
            h.navigateTo.firstCall.args[0],
            { courseId: 10, sessionId: 4711 },
            'the session lookup is course-scoped; a bare session id is not enough',
        );
    });

    test('focuses the chat without waiting for the conversation to load', async () => {
        let release!: () => void;
        const navigateTo = sinon.stub().returns(new Promise<void>(r => { release = r; }));
        h = buildHarness({ navigateTo });

        await h.provider.revealProactiveSessionForExercise(10, 7, 4711, 'Ex', h.provider.currentNavToken());

        assert.ok(
            h.focus.getCalls().some(c => c.args[0] === 'iris.chatView.focus'),
            'focus must not queue behind the still-pending navigation',
        );
        release();
    });

    test('a failing navigation neither throws nor reports the reveal as refused', async () => {
        const navigateTo = sinon.stub().rejects(new Error('offline'));
        h = buildHarness({ navigateTo });

        const revealed = await h.provider.revealProactiveSessionForExercise(10, 7, 4711, 'Ex', h.provider.currentNavToken());

        assert.strictEqual(revealed, true, 'the reveal was accepted; the open failing later is a separate matter');
        await Promise.resolve();
    });
});
