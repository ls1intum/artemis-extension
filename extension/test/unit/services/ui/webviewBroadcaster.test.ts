import * as assert from 'assert';
import * as sinon from 'sinon';

import { WebviewBroadcaster } from '@extension/services/ui/webviewBroadcaster';

suite('WebviewBroadcaster', () => {
    test('fans a message out to every registered sink', () => {
        const b = new WebviewBroadcaster();
        const a = sinon.stub();
        const c = sinon.stub();
        b.addSink(a);
        b.addSink(c);

        const msg = { type: 'updateProactiveConsent' } as never;
        b.broadcast(msg);

        sinon.assert.calledOnceWithExactly(a, msg);
        sinon.assert.calledOnceWithExactly(c, msg);
    });

    test('addSink returns a disposable that unregisters exactly that sink', () => {
        const b = new WebviewBroadcaster();
        const a = sinon.stub();
        const c = sinon.stub();
        const regA = b.addSink(a);
        b.addSink(c);

        regA.dispose();
        b.broadcast({ type: 'updateProactiveConsent' } as never);

        sinon.assert.notCalled(a);
        sinon.assert.calledOnce(c);
    });

    test('a throwing sink does not block the others (per-sink isolation)', () => {
        const b = new WebviewBroadcaster();
        const bad = sinon.stub().throws(new Error('sink blew up'));
        const good = sinon.stub();
        b.addSink(bad);
        b.addSink(good);

        assert.doesNotThrow(() => b.broadcast({ type: 'updateNoAiStatus', isNoAiDetected: true } as never));
        sinon.assert.calledOnce(good);
    });

    test('dispose clears all sinks', () => {
        const b = new WebviewBroadcaster();
        const a = sinon.stub();
        b.addSink(a);

        b.dispose();
        b.broadcast({ type: 'updateProactiveConsent' } as never);

        sinon.assert.notCalled(a);
    });

    test('registering the same sink twice is idempotent (Set semantics)', () => {
        const b = new WebviewBroadcaster();
        const a = sinon.stub();
        b.addSink(a);
        b.addSink(a);

        b.broadcast({ type: 'updateProactiveConsent' } as never);

        sinon.assert.calledOnce(a);
    });
});
