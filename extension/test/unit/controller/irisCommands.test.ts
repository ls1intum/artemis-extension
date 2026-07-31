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
}

function buildHarness(outcome: TopicChangeOutcome): Harness {
    const sandbox = sinon.createSandbox();
    sandbox.stub(vscode.commands, 'executeCommand').resolves();
    sandbox.stub(vscode.window, 'showWarningMessage');
    sandbox.stub(vscode.window, 'showErrorMessage');
    const info = sandbox.stub(vscode.window, 'showInformationMessage');

    const asked: Array<{ target: ServerContext; courseHint?: number }> = [];
    const chatProvider = {
        askIrisAbout: async (target: ServerContext, courseHint?: number) => {
            asked.push({ target, courseHint });
            return outcome;
        },
    };
    const context = {
        providerRegistry: { getChatWebviewProvider: () => chatProvider },
    } as unknown as CommandContext;

    return { module: new IrisCommandModule(context), asked, info, sandbox };
}

suite('askIrisOutcomeMessage', () => {
    test('a staged topic says the conversation stayed', () => {
        assert.strictEqual(askIrisOutcomeMessage({ kind: 'staged' }, 'BFS'), 'Iris is now looking at BFS.');
    });

    test('an opened conversation says so, because the transcript was replaced', () => {
        assert.strictEqual(
            askIrisOutcomeMessage({ kind: 'opened', sessionId: 12 }, 'BFS'),
            'Iris is now looking at BFS, in a different conversation.',
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

    test('Ask-Iris on a conversation with content says it opened another one', async () => {
        h = buildHarness({ kind: 'opened', sessionId: 12 });

        await h.module.getHandlers()[WebviewCmd.AskIrisAboutExercise]({
            type: 'command',
            command: WebviewCmd.AskIrisAboutExercise,
            payload: { exerciseId: 5, exerciseTitle: 'BFS', courseId: 42 },
        });

        assert.match(String(h.info.lastCall.args[0]), /different conversation/);
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
});
