import * as assert from 'assert';
import * as sinon from 'sinon';

import { ExtensionMsg } from '@shared/messageContracts';

import type { ResultDTO } from '@extension/domain';
import { SubmissionWebSocketHandler } from '@extension/services/ui/submissionWebSocketHandler';

function makeResult(): ResultDTO {
    return {
        id: 1,
        completionDate: new Date().toISOString(),
        successful: true,
        score: 100,
        testCaseCount: 5,
        passedTestCaseCount: 5,
        codeIssueCount: 0,
        feedbacks: [],
        participation: { id: 42 },
        submission: { buildFailed: false },
    } as unknown as ResultDTO;
}

suite('SubmissionWebSocketHandler', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => { sandbox = sinon.createSandbox(); });
    teardown(() => { sandbox.restore(); });

    test('handleNewResult posts a WebsocketUpdate message of type newResult', () => {
        const postMessage = sandbox.stub();
        const handler = new SubmissionWebSocketHandler(postMessage);

        handler.handleNewResult(makeResult());

        sinon.assert.calledOnce(postMessage);
        sinon.assert.calledWith(
            postMessage,
            sinon.match({ type: ExtensionMsg.WebsocketUpdate, updateType: 'newResult' }),
        );
    });

    test('handleNewResult calls _onBuildResult with the result', () => {
        const postMessage = sandbox.stub();
        const onBuildResult = sandbox.stub();
        const handler = new SubmissionWebSocketHandler(postMessage, onBuildResult);
        const r = makeResult();

        handler.handleNewResult(r);

        sinon.assert.calledOnceWithExactly(onBuildResult, r);
    });

    test('handleNewResult calls _onResultReceived with the result', () => {
        const postMessage = sandbox.stub();
        const onBuildResult = sandbox.stub();
        const onResultReceived = sandbox.stub();
        const handler = new SubmissionWebSocketHandler(postMessage, onBuildResult, onResultReceived);
        const r = makeResult();

        handler.handleNewResult(r);

        sinon.assert.calledOnceWithExactly(onResultReceived, r);
    });

    test('handleNewResult invokes callbacks in order: postMessage, _onBuildResult, _onResultReceived', () => {
        const order: string[] = [];
        const postMessage = sandbox.stub().callsFake(() => { order.push('post'); });
        const onBuildResult = sandbox.stub().callsFake(() => { order.push('build'); });
        const onResultReceived = sandbox.stub().callsFake(() => { order.push('refresh'); });
        const handler = new SubmissionWebSocketHandler(postMessage, onBuildResult, onResultReceived);

        handler.handleNewResult(makeResult());

        assert.deepStrictEqual(order, ['post', 'build', 'refresh']);
    });

    test('handleNewResult tolerates missing optional callbacks', () => {
        const postMessage = sandbox.stub();
        const handler = new SubmissionWebSocketHandler(postMessage);

        // Must not throw.
        handler.handleNewResult(makeResult());

        sinon.assert.calledOnce(postMessage);
    });
});
