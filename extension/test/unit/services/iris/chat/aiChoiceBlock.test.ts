import * as assert from 'assert';
import * as sinon from 'sinon';

import { ExtensionMsg } from '@shared/messageContracts';

import { ApiError } from '@extension/domain/errors';
import type { AiBlock } from '@extension/services/iris/chat/aiChoice';
import { ChatAvailabilityCoordinator } from '@extension/services/iris/chat/chatAvailabilityCoordinator';
import { ChatNavigationController } from '@extension/services/iris/chat/chatNavigationController';
import { ChatSendController } from '@extension/services/iris/chat/chatSendController';
import type { IrisAvailability } from '@extension/services/iris/chat/irisAvailabilityService';
import type { IrisConversationService } from '@extension/services/iris/conversation/conversationService';

/**
 * Artemis refuses every Iris conversation of an account that has not opted
 * into AI, with a bare 403. These tests pin that the chat names that cause
 * wherever a request failed, and only there.
 */

type Posted = { type: string; message?: string; text?: string; link?: { path: string }; reason?: string; errorMessage?: string };

function apiWithUser(user: unknown): never {
    return { getCurrentUser: sinon.stub().resolves(user) } as never;
}

suite('ChatAvailabilityCoordinator.explainFailure', () => {
    test('names a missing choice and puts up the linked banner', async () => {
        const posted: Posted[] = [];
        const coordinator = new ChatAvailabilityCoordinator(() => undefined, undefined, apiWithUser({ login: 's' }), m => posted.push(m as Posted));

        assert.strictEqual(await coordinator.explainFailure(), 'none');
        const banner = posted.find(m => m.type === ExtensionMsg.ShowUnavailableState);
        assert.match(banner?.message ?? '', /needs your AI choice/);
        assert.strictEqual(banner?.link?.path, '/user-settings/llm-usage');
    });

    test('names a choice against AI with its own wording', async () => {
        const posted: Posted[] = [];
        const coordinator = new ChatAvailabilityCoordinator(() => undefined, undefined, apiWithUser({ login: 's', selectedLLMUsage: 'NO_AI' }), m => posted.push(m as Posted));

        assert.strictEqual(await coordinator.explainFailure(), 'no-ai');
        assert.match(posted.find(m => m.type === ExtensionMsg.ShowUnavailableState)?.message ?? '', /chose not to use AI/);
    });

    test('explains nothing for an opted-in account or an unreadable one', async () => {
        const posted: Posted[] = [];
        const optedIn = new ChatAvailabilityCoordinator(() => undefined, undefined, apiWithUser({ login: 's', selectedLLMUsage: 'CLOUD_AI' }), m => posted.push(m as Posted));
        const unreadable = new ChatAvailabilityCoordinator(
            () => undefined, undefined, { getCurrentUser: sinon.stub().rejects(new Error('net')) } as never, m => posted.push(m as Posted));

        assert.strictEqual(await optedIn.explainFailure(), undefined);
        assert.strictEqual(await unreadable.explainFailure(), undefined);
        assert.deepStrictEqual(posted, []);
    });
});

suite('ChatNavigationController with an AI-choice block', () => {
    let posted: Posted[];
    let explainFailure: sinon.SinonStub;

    function controller(conversation: Partial<Record<string, unknown>> | undefined, block: AiBlock | null = 'none'): ChatNavigationController {
        posted = [];
        explainFailure = sinon.stub().resolves(block ?? undefined);
        return new ChatNavigationController({
            getConversation: () => conversation as IrisConversationService | undefined,
            catalog: undefined,
            artemisApi: undefined,
            availability: {
                explainFailure,
                announceCourseDisabled: sinon.stub(),
                refresh: sinon.stub().resolves(),
            } as never,
            postMessage: m => posted.push(m as Posted),
            admitExplicitIntent: () => {},
        });
    }

    function conversation(over: Partial<Record<string, unknown>>): Partial<Record<string, unknown>> {
        return {
            state: {
                snapshot: () => ({ courseId: undefined, courseSessions: [], knownInvisible: [] }),
                sendInFlight: false,
            },
            ...over,
        };
    }

    test('a cold start blocked by the choice shows its banner instead of "could not be reached", and still re-throws', async () => {
        const nav = controller(conversation({ start: sinon.stub().rejects(new ApiError('Forbidden', 403)) }));

        await assert.rejects(nav.acquire({ exerciseId: 5, courseId: 42 }));
        sinon.assert.calledOnce(explainFailure);
        assert.ok(!posted.some(m => m.type === ExtensionMsg.ShowUnavailableState), 'the generic banner must not replace the explained one');
    });

    test('a cold start that fails for another reason keeps the generic banner', async () => {
        const nav = controller(conversation({ start: sinon.stub().rejects(new Error('net')) }), null);

        await assert.rejects(nav.acquire({ exerciseId: 5, courseId: 42 }));
        assert.match(posted.find(m => m.type === ExtensionMsg.ShowUnavailableState)?.message ?? '', /could not be reached/);
    });

    test('Ask Iris reports the block when the topic change failed on a request', async () => {
        const nav = controller(conversation({ resolveTopicChange: sinon.stub().resolves({ kind: 'rejected', reason: 'failed' }) }), 'no-ai');

        const outcome = await nav.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' }, 42);

        assert.deepStrictEqual(outcome, { kind: 'ai-not-allowed', block: 'no-ai' });
    });

    test('Ask Iris reports the block when the course switch failed on a request', async () => {
        const nav = controller(conversation({
            state: { snapshot: () => ({ courseId: 41, courseSessions: [], knownInvisible: [] }), sendInFlight: false },
            switchCourse: sinon.stub().rejects(new ApiError('Forbidden', 403)),
        }));

        const outcome = await nav.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' }, 42);

        assert.deepStrictEqual(outcome, { kind: 'ai-not-allowed', block: 'none' });
    });

    test('local refusals keep their own reason and never ask the account', async () => {
        for (const reason of ['send-in-flight', 'no-course', 'loading', 'cross-course']) {
            const nav = controller(conversation({ resolveTopicChange: sinon.stub().resolves({ kind: 'rejected', reason }) }));

            const outcome = await nav.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' }, 42);

            assert.deepStrictEqual(outcome, { kind: 'rejected', reason });
            sinon.assert.notCalled(explainFailure);
        }
    });

    test('Ask Iris without a conversation service made no request and is not explained', async () => {
        const nav = controller(undefined);

        const outcome = await nav.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' }, 42);

        assert.deepStrictEqual(outcome, { kind: 'rejected', reason: 'failed' });
        sinon.assert.notCalled(explainFailure);
        assert.deepStrictEqual(posted, []);
    });

    test('a course switch from the picker that failed on the block says so inline', async () => {
        const nav = controller(conversation({ switchCourse: sinon.stub().rejects(new ApiError('Forbidden', 403)) }));

        await nav.switchCourse(42);

        assert.strictEqual(posted.find(m => m.type === ExtensionMsg.OpenSessionError)?.message, 'Iris needs your AI choice in Artemis first.');
    });

    test('a failed topic pick names the block; a send-in-flight refusal keeps its message', async () => {
        const failing = controller(conversation({ resolveTopicChange: sinon.stub().resolves({ kind: 'rejected', reason: 'failed' }) }), 'no-ai');
        await failing.selectTopic({ mode: 'COURSE_CHAT', entityId: 42 });
        assert.strictEqual(posted.find(m => m.type === ExtensionMsg.ShowChatNotice)?.text, 'You chose not to use AI in Artemis.');

        const busy = controller(conversation({ resolveTopicChange: sinon.stub().resolves({ kind: 'rejected', reason: 'send-in-flight' }) }));
        await busy.selectTopic({ mode: 'COURSE_CHAT', entityId: 42 });
        assert.strictEqual(posted.find(m => m.type === ExtensionMsg.ShowChatNotice)?.text, 'Wait for Iris to finish answering before switching.');
        sinon.assert.notCalled(explainFailure);
    });
});

suite('ChatSendController with an AI-choice block', () => {
    function sendController(availability: IrisAvailability): { send: ChatSendController; posted: Posted[]; post: sinon.SinonStub } {
        const posted: Posted[] = [];
        const context = { type: 'course', id: 42, title: 'C', courseId: 42 };
        const post = sinon.stub();
        const send = new ChatSendController({
            getConversation: () => undefined,
            artemisApi: undefined,
            availability: {
                context: () => context,
                check: sinon.stub().resolves(availability),
                isStillLive: () => true,
                post,
            } as never,
            noAi: { isNoAiEnabled: false } as never,
            runs: {} as never,
            websocketMessageHandler: { publishCurrentRunUi: sinon.stub() } as never,
            workspaceTracker: {} as never,
            postMessage: m => posted.push(m as Posted),
            postNoAiStatus: () => {},
        });
        return { send, posted, post };
    }

    for (const [block, text] of [
        ['none', 'Not sent. Iris needs your AI choice in Artemis.'],
        ['no-ai', 'Not sent. You chose not to use AI in Artemis.'],
    ] as const) {
        test(`fails the bubble and raises the banner (${block})`, async () => {
            const { send, posted, post } = sendController({ kind: 'ai-not-allowed', block });

            await send.send({ text: 'help', localId: 'l1', sessionId: 9 });

            const rejected = posted.find(m => m.type === ExtensionMsg.SendRejected);
            assert.strictEqual(rejected?.reason, 'ai-not-allowed');
            assert.strictEqual(rejected?.errorMessage, text);
            sinon.assert.calledWith(post, { kind: 'ai-not-allowed', block });
            send.dispose();
        });
    }
});
