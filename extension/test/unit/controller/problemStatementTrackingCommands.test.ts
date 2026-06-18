import * as assert from 'assert';
import * as sinon from 'sinon';

import { WebviewCmd } from '@shared/messageContracts/webviewCommands';

import { ProblemStatementTrackingCommandModule } from '@extension/controller/commands/problemStatementTrackingCommands';
import type { CommandContext } from '@extension/controller/commands/types';

suite('ProblemStatementTrackingCommandModule', () => {
    let fireScrollStub: sinon.SinonStub;
    let fireSelectionStub: sinon.SinonStub;
    let module: ProblemStatementTrackingCommandModule;

    setup(() => {
        fireScrollStub = sinon.stub();
        fireSelectionStub = sinon.stub();
        const provider = {
            fireProblemStatementScroll: fireScrollStub,
            fireProblemStatementSelection: fireSelectionStub,
        };
        const context = {
            providerRegistry: { getArtemisWebviewProvider: () => provider },
        } as unknown as CommandContext;
        module = new ProblemStatementTrackingCommandModule(context);
    });

    test('handles problemStatementScroll by firing provider event', async () => {
        const payload = { scrollTop: 100, scrollHeight: 3000, viewportHeight: 800, statementTop: 950, statementHeight: 1600 };
        await module.getHandlers()[WebviewCmd.ProblemStatementScroll]({
            type: 'command', command: WebviewCmd.ProblemStatementScroll, payload,
        } as never);
        sinon.assert.calledOnceWithExactly(fireScrollStub, payload);
    });

    test('handles problemStatementSelection by firing provider event', async () => {
        const payload = {
            selectedText: 'abc', selectionLength: 3, truncated: false,
            selectionTop: 10, selectionLeft: 20, selectionWidth: 30, selectionHeight: 12,
        };
        await module.getHandlers()[WebviewCmd.ProblemStatementSelection]({
            type: 'command', command: WebviewCmd.ProblemStatementSelection, payload,
        } as never);
        sinon.assert.calledOnceWithExactly(fireSelectionStub, payload);
    });

    test('drops events silently when provider is not registered', async () => {
        const ctxNoProvider = { providerRegistry: { getArtemisWebviewProvider: () => undefined } } as unknown as CommandContext;
        const mod = new ProblemStatementTrackingCommandModule(ctxNoProvider);
        const payload = { scrollTop: 0, scrollHeight: 0, viewportHeight: 0, statementTop: 0, statementHeight: 0 };
        await assert.doesNotReject(
            mod.getHandlers()[WebviewCmd.ProblemStatementScroll]({
                type: 'command', command: WebviewCmd.ProblemStatementScroll, payload,
            } as never),
        );
    });

    test('logs and does not throw on missing payload (getPayload failure)', async () => {
        await assert.doesNotReject(
            module.getHandlers()[WebviewCmd.ProblemStatementSelection]({
                type: 'command', command: WebviewCmd.ProblemStatementSelection,
            } as never),
        );
        sinon.assert.notCalled(fireSelectionStub);
    });
});
