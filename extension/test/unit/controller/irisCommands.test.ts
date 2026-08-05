import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { WebviewCmd } from '@shared/messageContracts';
import type { ServerContext } from '@shared/types/serverContext';

import { askIrisOutcomeMessage, IrisCommandModule } from '@extension/controller/commands/irisCommands';
import type { CommandContext } from '@extension/controller/commands/types';
import type { TopicChangeOutcome } from '@extension/services/iris/conversation/conversationService';

interface Harness {
    module: IrisCommandModule;
    asked: Array<{ target: ServerContext; courseHint?: number }>;
    info: sinon.SinonStub;
    sandbox: sinon.SinonSandbox;
    executeCommandStub: sinon.SinonStub;
    chatProvider: {
        askIrisAbout: (target: ServerContext, courseHint?: number) => Promise<TopicChangeOutcome>;
        admitExplicitIntent: (reason: string) => void;
    };
}

function buildHarness(outcome: TopicChangeOutcome): Harness {
    const sandbox = sinon.createSandbox();
    const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
    sandbox.stub(vscode.window, 'showWarningMessage');
    sandbox.stub(vscode.window, 'showErrorMessage');
    const info = sandbox.stub(vscode.window, 'showInformationMessage');

    const asked: Array<{ target: ServerContext; courseHint?: number }> = [];
    const chatProvider = {
        askIrisAbout: async (target: ServerContext, courseHint?: number) => {
            asked.push({ target, courseHint });
            return outcome;
        },
        admitExplicitIntent: sandbox.stub(),
    };
    const context = {
        providerRegistry: { getChatWebviewProvider: () => chatProvider },
    } as unknown as CommandContext;

    return { module: new IrisCommandModule(context), asked, info, sandbox, executeCommandStub, chatProvider };
}

suite('askIrisOutcomeMessage', () => {
    test('a staged topic says the conversation stayed', () => {
        assert.strictEqual(askIrisOutcomeMessage({ kind: 'staged' }, 'BFS'), 'Iris is now looking at BFS.');
    });

    test('an acquired conversation says the same thing: nothing was replaced', () => {
        // `opened` survives for the cold start only, where the click acquired
        // the FIRST conversation. Announcing "a different conversation" there
        // names an event the student never saw.
        assert.strictEqual(
            askIrisOutcomeMessage({ kind: 'opened', sessionId: 12 }, 'BFS'),
            'Iris is now looking at BFS.',
        );
    });

    test('rejections name the reason the student can act on', () => {
        assert.strictEqual(
            askIrisOutcomeMessage({ kind: 'rejected', reason: 'loading' }, 'BFS'),
            'Iris is still loading. Try again in a moment.',
        );
        assert.strictEqual(
            askIrisOutcomeMessage({ kind: 'rejected', reason: 'send-in-flight' }, 'BFS'),
            'Iris is answering right now. Please wait.',
        );
    });

    test('a superseded navigation says nothing at all', () => {
        assert.strictEqual(askIrisOutcomeMessage({ kind: 'stale' }, 'BFS'), undefined);
    });
});

suite('Ask Iris commands', () => {
    let h: Harness;

    teardown(() => { h.sandbox.restore(); });

    test('the exercise command carries the payload course id to the provider', async () => {
        h = buildHarness({ kind: 'staged' });

        await h.module.getHandlers()[WebviewCmd.AskIrisAboutExercise]({
            type: 'command',
            command: WebviewCmd.AskIrisAboutExercise,
            payload: { exerciseId: 5, exerciseTitle: 'BFS', courseId: 42 },
        });

        assert.deepStrictEqual(h.asked, [{
            target: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' },
            courseHint: 42,
        }]);
    });

    test('Ask-Iris never claims a conversation change, not even when it acquired one', async () => {
        // `opened` is reachable from this path only on a cold start, where the
        // click acquired the first conversation and nothing was replaced.
        h = buildHarness({ kind: 'opened', sessionId: 12 });

        await h.module.getHandlers()[WebviewCmd.AskIrisAboutExercise]({
            type: 'command',
            command: WebviewCmd.AskIrisAboutExercise,
            payload: { exerciseId: 5, exerciseTitle: 'BFS', courseId: 42 },
        });

        assert.strictEqual(String(h.info.lastCall.args[0]), 'Iris is now looking at BFS.');
    });

    test('Ask-Iris is rejected while a send is in flight', async () => {
        h = buildHarness({ kind: 'rejected', reason: 'send-in-flight' });

        await h.module.getHandlers()[WebviewCmd.AskIrisAboutExercise]({
            type: 'command',
            command: WebviewCmd.AskIrisAboutExercise,
            payload: { exerciseId: 5, exerciseTitle: 'BFS', courseId: 42 },
        });

        assert.match(String(h.info.lastCall.args[0]), /answering right now/);
    });

    test('the course command asks for the course chat, hinting its own course', async () => {
        h = buildHarness({ kind: 'opened', sessionId: 3 });

        await h.module.getHandlers()[WebviewCmd.AskIrisAboutCourse]({
            type: 'command',
            command: WebviewCmd.AskIrisAboutCourse,
            payload: { courseId: 42, courseTitle: 'Intro' },
        });

        assert.deepStrictEqual(h.asked, [{
            target: { mode: 'COURSE_CHAT', entityId: 42, name: 'Intro' },
            courseHint: 42,
        }]);
    });

    const ORDERING_VARIANTS: Array<{ name: string; invoke: (harness: Harness) => Promise<void> }> = [
        {
            name: 'exercise',
            invoke: (harness) => harness.module.getHandlers()[WebviewCmd.AskIrisAboutExercise]({
                type: 'command',
                command: WebviewCmd.AskIrisAboutExercise,
                payload: { exerciseId: 5, exerciseTitle: 'BFS', courseId: 9 },
            }),
        },
        {
            name: 'course',
            invoke: (harness) => harness.module.getHandlers()[WebviewCmd.AskIrisAboutCourse]({
                type: 'command',
                command: WebviewCmd.AskIrisAboutCourse,
                payload: { courseId: 9, courseTitle: 'Algorithms' },
            }),
        },
    ];

    for (const variant of ORDERING_VARIANTS) {
        test(`Ask Iris about a ${variant.name} admits before the chat view is focused`, async () => {
            h = buildHarness({ kind: 'staged' });

            const order: string[] = [];
            // Extend the executeCommand stub this harness already installs
            // rather than adding a second one on the same method.
            h.executeCommandStub.callsFake(async (id: string) => {
                if (id === 'iris.chatView.focus') { order.push('focus'); }
                return undefined;
            });
            h.chatProvider.admitExplicitIntent = () => order.push('admit');
            const originalAskIrisAbout = h.chatProvider.askIrisAbout;
            h.chatProvider.askIrisAbout = async (target: ServerContext, courseHint?: number) => {
                order.push('ask');
                return originalAskIrisAbout(target, courseHint);
            };

            await variant.invoke(h);

            assert.deepStrictEqual(order, ['admit', 'focus', 'ask'],
                'focusing resolves the view, so the latch must already be cancelled');
        });
    }
});
