import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { WebCmd } from '@shared/messageContracts';
import { WebviewCmd } from '@shared/messageContracts';

import { ChatWebviewProvider } from '@extension/provider/chatWebviewProvider';
import { WorkspaceExerciseTracker } from '@extension/services/workspace/workspaceExerciseTracker';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

type NudgePayload = WebCmd<typeof WebviewCmd.NudgeBannerAction>['payload'];

function buildProvider(sandbox: sinon.SinonSandbox): ChatWebviewProvider {
    sandbox.stub(vscode.commands, 'registerCommand').returns({ dispose: () => undefined });
    const noAi = {
        isNoAiEnabled: false,
        onNoAiStatusChanged: new vscode.EventEmitter<boolean>().event,
    };
    const courseCatalog = {
        onCoursesLoaded: new vscode.EventEmitter<unknown>().event,
        fetch: async () => undefined,
        projection: () => ({ courses: [], exercises: [] }),
        courseTitle: () => undefined,
        exerciseTitle: () => undefined,
    };
    return new ChatWebviewProvider(
        vscode.Uri.file('/tmp'),
        new MockExtensionContext() as unknown as vscode.ExtensionContext,
        undefined,
        undefined,
        noAi as never,
        { getAllExercises: () => [] } as never,
        courseCatalog as never,
        undefined,
        new WorkspaceExerciseTracker(),
        { getAccessTimestamp: () => undefined } as never,
        { state: { kind: 'anonymous', serverKey: 'https://artemis.test' }, epoch: 0 } as never,
    );
}

/**
 * The offer bubble lives in the chat webview, the offer banner in the sidebar, and both post the
 * same `nudgeBannerAction`. The chat provider had no case for it, so every in-chat
 * "Show me" was swallowed by the unhandled-command path and the student got no hint at all.
 */
suite('ChatWebviewProvider offer action routing', () => {
    let provider: ChatWebviewProvider;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        provider = buildProvider(sandbox);
    });

    teardown(() => {
        provider.dispose();
        sandbox.restore();
    });

    function send(payload: NudgePayload): void {
        (provider as unknown as { _handleCommand: (m: unknown) => void })._handleCommand({
            type: 'command',
            command: WebviewCmd.NudgeBannerAction,
            payload,
        });
    }

    test('an offer answer from the chat fires onDidNudgeBannerAction with the payload intact', () => {
        const seen: NudgePayload[] = [];
        const sub = provider.onDidNudgeBannerAction(p => seen.push(p));

        const payload: NudgePayload = { moment: 'stuck', action: 'accept', episodeId: 'ep-1', offerId: 'off-1' };
        send(payload);

        sub.dispose();
        assert.deepStrictEqual(seen, [payload]);
    });

    test('the command never reaches the unhandled-command fallback', async () => {
        const internals = provider as unknown as { _handleUtilityCommand: (m: unknown) => Promise<boolean> };
        const utility = sandbox.stub(internals, '_handleUtilityCommand').resolves(false);

        send({ moment: 'abandon', action: 'decline', episodeId: 'ep-2', offerId: 'off-2' });

        assert.strictEqual(utility.callCount, 0);
    });

    test('the ready hook replays a pending proactive-thinking flag', () => {
        // A banner-raised offer is accepted before the chat exists, so its "Iris is working"
        // message is queued and then thrown away by `_resetReadyState()` on resolve. The replay is
        // what makes the student land on a chat that already shows it.
        const replay = sinon.stub(provider.proactive, 'replayThinking');

        (provider as unknown as { _onReady: () => void })._onReady();

        assert.strictEqual(replay.callCount, 1);
    });

    test('every offer answer is routed, not just accept', () => {
        const seen: NudgePayload[] = [];
        const sub = provider.onDidNudgeBannerAction(p => seen.push(p));

        send({ moment: 'stuck', action: 'accept', episodeId: 'ep-3', offerId: 'o-a' });
        send({ moment: 'stuck', action: 'decline', episodeId: 'ep-3', offerId: 'o-d' });
        send({ moment: 'abandon', action: 'timeout', episodeId: 'ep-3', offerId: 'o-t' });

        sub.dispose();
        assert.deepStrictEqual(seen.map(p => 'moment' in p && p.action), ['accept', 'decline', 'timeout']);
    });
});
