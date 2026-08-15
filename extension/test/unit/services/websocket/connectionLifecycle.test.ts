import * as assert from 'assert';
import * as sinon from 'sinon';

import { ConnectionLifecycle } from '@extension/services/websocket/connectionLifecycle';
import type { ConnectionState } from '@extension/services/websocket/connectionState';

/** Test-only subclass exposing internal hooks. Never imported from production. */
class TestableConnectionLifecycle extends ConnectionLifecycle {
    public forceState(state: ConnectionState): void {
        (this as any)._state = state;
    }
    public setReconnectAttempts(n: number): void {
        (this as any)._reconnectAttempts = n;
    }
}

const createdLifecycles: TestableConnectionLifecycle[] = [];

function makeLifecycle(): {
    lifecycle: TestableConnectionLifecycle;
    events: Array<{ connected: boolean; wasEverConnected: boolean }>;
} {
    const events: Array<{ connected: boolean; wasEverConnected: boolean }> = [];
    const lifecycle = new TestableConnectionLifecycle({
        log: () => { /* silent */ },
        onDidChangeConnectionState: (evt) => { events.push(evt); },
    });
    createdLifecycles.push(lifecycle);
    return { lifecycle, events };
}

suite('ConnectionLifecycle', () => {
    teardown(() => {
        // Dispose every lifecycle the test created so safety timeouts and
        // debounce timers do not leak into other suites.
        for (const lifecycle of createdLifecycles) { lifecycle.dispose(); }
        createdLifecycles.length = 0;
        sinon.restore();
    });

    test('initial state is disconnected with generation 0', () => {
        const { lifecycle } = makeLifecycle();
        assert.strictEqual(lifecycle.state, 'disconnected');
        assert.strictEqual(lifecycle.generation, 0);
        assert.strictEqual(lifecycle.reconnectAttempts, 0);
        assert.strictEqual(lifecycle.wasConnectedOnce, false);
    });

    test('beginConnect bumps generation, transitions to connecting, returns deferred', async () => {
        const { lifecycle } = makeLifecycle();
        const result = lifecycle.beginConnect({});
        assert.strictEqual(result.kind, 'fresh');
        if (result.kind !== 'fresh') { return; }
        assert.strictEqual(lifecycle.state, 'connecting');
        assert.strictEqual(lifecycle.generation, 1);
        assert.strictEqual(result.generation, 1);
        lifecycle.recordConnected();
        await result.promise;
    });

    test('beginConnect during connecting returns reuse directive', async () => {
        const { lifecycle } = makeLifecycle();
        const first = lifecycle.beginConnect({});
        const second = lifecycle.beginConnect({});
        assert.strictEqual(first.kind, 'fresh');
        assert.strictEqual(second.kind, 'reuse');
        lifecycle.recordConnected();
        if (first.kind === 'fresh') { await first.promise; }
        if (second.kind === 'reuse') { await second.promise; }
    });

    test('beginConnect after gave-up throws (state gate, NOT inflight reuse)', () => {
        const { lifecycle } = makeLifecycle();
        lifecycle.forceState('gave-up');
        assert.throws(() => lifecycle.beginConnect({ clientInflight: true }), /Max attempts reached/);
    });

    test('beginConnect during disconnecting throws', () => {
        const { lifecycle } = makeLifecycle();
        lifecycle.forceState('disconnecting');
        assert.throws(() => lifecycle.beginConnect({ clientInflight: true }), /Disconnect in progress/);
    });

    test('beginConnect with clientInflight returns reuse from disconnected (STOMP mid-handshake)', () => {
        const { lifecycle } = makeLifecycle();
        const result = lifecycle.beginConnect({ clientInflight: true });
        assert.strictEqual(result.kind, 'reuse');
        assert.strictEqual(lifecycle.state, 'disconnected');
        assert.strictEqual(lifecycle.generation, 0);
    });

    test('recordConnected resolves deferred and fires connected event', async () => {
        const { lifecycle, events } = makeLifecycle();
        const result = lifecycle.beginConnect({});
        if (result.kind !== 'fresh') { assert.fail(); return; }
        lifecycle.recordConnected();
        await result.promise;
        assert.strictEqual(lifecycle.state, 'connected');
        assert.strictEqual(lifecycle.wasConnectedOnce, true);
        assert.strictEqual(lifecycle.reconnectAttempts, 0);
        assert.deepStrictEqual(events, [{ connected: true, wasEverConnected: true }]);
    });

    test('recordDisconnect during connecting rejects the deferred', async () => {
        const { lifecycle } = makeLifecycle();
        const result = lifecycle.beginConnect({});
        if (result.kind !== 'fresh') { assert.fail(); return; }
        lifecycle.recordDisconnect({ hasClient: true });
        await assert.rejects(result.promise, /closed during connection/);
        assert.strictEqual(lifecycle.state, 'disconnected');
    });

    test('recordDisconnect after connected fires debounced disconnect event', () => {
        const clock = sinon.useFakeTimers();
        try {
            const { lifecycle, events } = makeLifecycle();
            const result = lifecycle.beginConnect({});
            if (result.kind !== 'fresh') { return; }
            lifecycle.recordConnected();
            events.length = 0;

            const directive = lifecycle.recordDisconnect({ hasClient: true });
            assert.strictEqual(directive.clearedConnectedState, true);
            assert.strictEqual(directive.gaveUp, false);
            assert.strictEqual(events.length, 0, 'event must wait for debounce');

            clock.tick(4999);
            assert.strictEqual(events.length, 0);

            clock.tick(1);
            assert.strictEqual(events.length, 1);
            assert.deepStrictEqual(events[0], { connected: false, wasEverConnected: true });
        } finally {
            clock.restore();
        }
    });

    test('recordDisconnect twice in same attempt does not double-count', () => {
        const { lifecycle } = makeLifecycle();
        const result = lifecycle.beginConnect({});
        if (result.kind !== 'fresh') { return; }
        lifecycle.recordConnected();

        lifecycle.recordDisconnect({ hasClient: true });
        assert.strictEqual(lifecycle.reconnectAttempts, 1);
        lifecycle.recordDisconnect({ hasClient: true });
        assert.strictEqual(lifecycle.reconnectAttempts, 1);
    });

    test('20 unexpected disconnects with client present transition to gave-up, bump generation, emit one event', () => {
        const clock = sinon.useFakeTimers();
        try {
            const { lifecycle, events } = makeLifecycle();
            const result = lifecycle.beginConnect({});
            if (result.kind !== 'fresh') { return; }
            lifecycle.recordConnected();
            events.length = 0;
            const genAfterConnect = lifecycle.generation;

            for (let i = 0; i < 20; i++) {
                lifecycle.recordWebSocketReopened();
                lifecycle.recordDisconnect({ hasClient: true });
            }
            assert.strictEqual(lifecycle.state, 'gave-up');
            assert.ok(lifecycle.generation > genAfterConnect, 'generation bumped on gave-up with client');
            const falseEvents = events.filter(e => !e.connected);
            assert.strictEqual(falseEvents.length, 1, 'exactly one disconnect notification');
        } finally {
            clock.restore();
        }
    });

    test('gave-up reached with hasClient=false does NOT bump generation', () => {
        const { lifecycle } = makeLifecycle();
        const result = lifecycle.beginConnect({});
        if (result.kind !== 'fresh') { return; }
        lifecycle.recordConnected();
        const genAfterConnect = lifecycle.generation;

        for (let i = 0; i < 20; i++) {
            lifecycle.recordWebSocketReopened();
            lifecycle.recordDisconnect({ hasClient: false });
        }
        assert.strictEqual(lifecycle.state, 'gave-up');
        assert.strictEqual(lifecycle.generation, genAfterConnect, 'no generation bump when client is gone');
    });

    test('beginDisconnect bumps generation, transitions to disconnecting, rejects in-flight deferred', async () => {
        const { lifecycle } = makeLifecycle();
        const result = lifecycle.beginConnect({});
        if (result.kind !== 'fresh') { return; }
        const genBefore = lifecycle.generation;

        lifecycle.beginDisconnect();
        assert.ok(lifecycle.generation > genBefore);
        assert.strictEqual(lifecycle.state, 'disconnecting');
        await assert.rejects(result.promise, /Disconnected/);
    });

    test('completeDisconnectWithClient fires (false, prior wasEverConnected) and resets counters', () => {
        const { lifecycle, events } = makeLifecycle();
        const result = lifecycle.beginConnect({});
        if (result.kind !== 'fresh') { return; }
        lifecycle.recordConnected();
        events.length = 0;

        lifecycle.beginDisconnect();
        lifecycle.completeDisconnectWithClient();

        assert.strictEqual(lifecycle.state, 'disconnected');
        assert.strictEqual(lifecycle.reconnectAttempts, 0);
        assert.strictEqual(lifecycle.wasConnectedOnce, false);
        const falseEvent = events.find(e => !e.connected);
        assert.ok(falseEvent);
        assert.strictEqual(falseEvent!.wasEverConnected, true);
    });

    test('completeDisconnectNoClient transitions to disconnected without firing event', () => {
        const { lifecycle, events } = makeLifecycle();
        lifecycle.beginDisconnect();
        events.length = 0;
        lifecycle.completeDisconnectNoClient();
        assert.strictEqual(lifecycle.state, 'disconnected');
        assert.deepStrictEqual(events, [], 'no event fired when no client existed');
    });

    test('abortSupersededConnect transitions to disconnected without firing or settling', () => {
        const { lifecycle, events } = makeLifecycle();
        const result = lifecycle.beginConnect({});
        if (result.kind !== 'fresh') { return; }
        // Simulate disconnect bumping the generation underneath us
        lifecycle.forceState('disconnected');
        events.length = 0;
        lifecycle.abortSupersededConnect();
        assert.strictEqual(lifecycle.state, 'disconnected');
        assert.deepStrictEqual(events, []);
        // The deferred was already settled by whatever bumped the generation;
        // abortSupersededConnect must NOT throw on a settled-or-missing deferred.
    });

    test('reset clears reconnectAttempts and exits gave-up', () => {
        const { lifecycle } = makeLifecycle();
        lifecycle.forceState('gave-up');
        lifecycle.setReconnectAttempts(15);
        lifecycle.reset();
        assert.strictEqual(lifecycle.state, 'disconnected');
        assert.strictEqual(lifecycle.reconnectAttempts, 0);
    });

    test('safety timeout rejects deferred after 15s and transitions to disconnected', async () => {
        const clock = sinon.useFakeTimers();
        try {
            const { lifecycle } = makeLifecycle();
            const result = lifecycle.beginConnect({});
            if (result.kind !== 'fresh') { return; }
            clock.tick(15001);
            await assert.rejects(result.promise, /timed out/);
            assert.strictEqual(lifecycle.state, 'disconnected');
        } finally {
            clock.restore();
        }
    });
});
