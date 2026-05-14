import * as assert from 'assert';
import * as sinon from 'sinon';
import { TestResultsTrackingCommandModule } from '../../../src/extension/controller/commands/testResultsTrackingCommands';
import type { CommandContext } from '../../../src/extension/controller/commands/types';
import { WebviewCmd } from '../../../src/shared/messageContracts/webviewCommands';

suite('TestResultsTrackingCommandModule', () => {
    let fireOverviewOpenedStub: sinon.SinonStub;
    let fireOverviewClosedStub: sinon.SinonStub;
    let fireTaskOpenedStub: sinon.SinonStub;
    let fireTaskClosedStub: sinon.SinonStub;
    let module: TestResultsTrackingCommandModule;

    setup(() => {
        fireOverviewOpenedStub = sinon.stub();
        fireOverviewClosedStub = sinon.stub();
        fireTaskOpenedStub = sinon.stub();
        fireTaskClosedStub = sinon.stub();
        const provider = {
            fireTestResultsOverviewOpened: fireOverviewOpenedStub,
            fireTestResultsOverviewClosed: fireOverviewClosedStub,
            fireTaskFeedbackOpened: fireTaskOpenedStub,
            fireTaskFeedbackClosed: fireTaskClosedStub,
            onDidOpenTestResultsOverview: sinon.stub(),
            onDidCloseTestResultsOverview: sinon.stub(),
            onDidOpenTaskFeedback: sinon.stub(),
            onDidCloseTaskFeedback: sinon.stub(),
        };
        const context = {
            providerRegistry: { getArtemisWebviewProvider: () => provider },
        } as unknown as CommandContext;
        module = new TestResultsTrackingCommandModule(context);
    });

    test('handles testResultsOverviewOpened by firing provider event', async () => {
        const payload = { viewId: 'v', exerciseId: 1, totalTests: 3, passedTests: 1, failedTests: 2 };
        const handlers = module.getHandlers();
        await handlers[WebviewCmd.TestResultsOverviewOpened]({
            type: 'command', command: WebviewCmd.TestResultsOverviewOpened, payload,
        } as never);
        sinon.assert.calledOnceWithExactly(fireOverviewOpenedStub, payload);
    });

    test('handles testResultsOverviewClosed by firing provider event', async () => {
        const payload = { viewId: 'v', exerciseId: 1, durationMs: 250, closeReason: 'button' as const };
        await module.getHandlers()[WebviewCmd.TestResultsOverviewClosed]({
            type: 'command', command: WebviewCmd.TestResultsOverviewClosed, payload,
        } as never);
        sinon.assert.calledOnceWithExactly(fireOverviewClosedStub, payload);
    });

    test('handles taskFeedbackOpened by firing provider event', async () => {
        const payload = { viewId: 'v', exerciseId: 1, taskName: 't', testIds: [1, 2], totalTests: 2, passedTests: 1, failedTests: 1 };
        await module.getHandlers()[WebviewCmd.TaskFeedbackOpened]({
            type: 'command', command: WebviewCmd.TaskFeedbackOpened, payload,
        } as never);
        sinon.assert.calledOnceWithExactly(fireTaskOpenedStub, payload);
    });

    test('handles taskFeedbackClosed by firing provider event', async () => {
        const payload = { viewId: 'v', exerciseId: 1, taskName: 't', durationMs: 50, closeReason: 'escape' as const };
        await module.getHandlers()[WebviewCmd.TaskFeedbackClosed]({
            type: 'command', command: WebviewCmd.TaskFeedbackClosed, payload,
        } as never);
        sinon.assert.calledOnceWithExactly(fireTaskClosedStub, payload);
    });

    test('drops events silently when provider is not registered', async () => {
        const ctxNoProvider = { providerRegistry: { getArtemisWebviewProvider: () => undefined } } as unknown as CommandContext;
        const mod = new TestResultsTrackingCommandModule(ctxNoProvider);
        const payload = { viewId: 'v', exerciseId: 1, totalTests: 0, passedTests: 0, failedTests: 0 };
        await assert.doesNotReject(
            mod.getHandlers()[WebviewCmd.TestResultsOverviewOpened]({
                type: 'command', command: WebviewCmd.TestResultsOverviewOpened, payload,
            } as never),
        );
    });

    test('logs and does not throw on missing payload (getPayload failure)', async () => {
        await assert.doesNotReject(
            module.getHandlers()[WebviewCmd.TaskFeedbackOpened]({
                type: 'command', command: WebviewCmd.TaskFeedbackOpened,
            } as never),
        );
        sinon.assert.notCalled(fireTaskOpenedStub);
    });
});
