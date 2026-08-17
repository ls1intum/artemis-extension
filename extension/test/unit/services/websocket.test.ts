import { Client, IMessage, StompConfig, StompSubscription } from '@stomp/stompjs';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { AuthManager } from '@extension/services/auth/authManager';
import { IrisWebSocketSessionClient } from '@extension/services/iris/transport/irisWebSocketSessionClient';
import { ArtemisWebsocketService } from '@extension/services/websocket/artemisWebsocketService';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

/**
 * Flush the microtask queue so connect() progresses past its `await` points and
 * reaches _createClient(). One yield per `await`, hence the loop.
 *
 * Promise.resolve() chaining rather than setTimeout/setImmediate, so it also
 * works under sinon.useFakeTimers() (sinon fakes timers, not microtasks).
 */
async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

class MockStompClient {
    public config: StompConfig;
    public connected: boolean = false;
    public active: boolean = false;
    public subscriptions: Map<string, (message: IMessage) => void> = new Map();

    constructor(config: StompConfig) {
        this.config = config;
    }

    activate(): void {
        this.active = true;
    }

    async deactivate(): Promise<void> {
        this.active = false;
        this.connected = false;
        if (this.config.onDisconnect) {
            this.config.onDisconnect(undefined as any);
        }
    }

    subscribe(topic: string, callback: (message: IMessage) => void): StompSubscription {
        this.subscriptions.set(topic, callback);
        return {
            id: `sub-${topic}`,
            unsubscribe: () => {
                this.subscriptions.delete(topic);
            }
        };
    }

    simulateConnect(): void {
        this.connected = true;
        if (this.config.onConnect) {
            this.config.onConnect({} as any);
        }
    }

    simulateDisconnect(): void {
        this.connected = false;
        if (this.config.onDisconnect) {
            this.config.onDisconnect(undefined as any);
        }
    }

    simulateWebSocketClose(): void {
        this.connected = false;
        if (this.config.onWebSocketClose) {
            this.config.onWebSocketClose({} as any);
        }
    }

    simulateMessage(topic: string, body: any): void {
        const callback = this.subscriptions.get(topic);
        if (callback) {
            callback({
                body: JSON.stringify(body),
                headers: {},
                command: 'MESSAGE',
                ack: () => {},
                nack: () => {}
            });
        }
    }
}

class TestableArtemisWebsocketService extends ArtemisWebsocketService {
    public mockClient?: MockStompClient;
    public connectCallCount: number = 0;

    // State and counters live on the private `_lifecycle`; the getters reach in
    // via `as any` to expose a stable testing surface.
    public get isConnectingState(): boolean { return this._lifecycleState() === 'connecting'; }
    public get isDisconnectingState(): boolean { return this._lifecycleState() === 'disconnecting'; }
    public get connectionGaveUpState(): boolean { return this._lifecycleState() === 'gave-up'; }
    public get lifecycleState(): string { return this._lifecycleState(); }

    public get reconnectAttemptsCount(): number {
        return ((this as any)._lifecycle._reconnectAttempts) as number;
    }

    public get wasConnectedOnceState(): boolean {
        return ((this as any)._lifecycle._wasConnectedOnce) as boolean;
    }

    public get connectionGeneration(): number {
        return ((this as any)._lifecycle._generation) as number;
    }

    private _lifecycleState(): string {
        return (this as any)._lifecycle._state as string;
    }

    protected _createClient(config: StompConfig): Client {
        this.mockClient = new MockStompClient(config);
        return this.mockClient as unknown as Client;
    }

    public async connect(): Promise<void> {
        this.connectCallCount++;
        return super.connect();
    }

    // Maps boolean flags onto the ConnectionState enum.
    // Priority: gave-up > disconnecting > connecting.
    public setInternalState(state: {
        isConnecting?: boolean;
        isDisconnecting?: boolean;
        connectionGaveUp?: boolean;
        reconnectAttempts?: number;
    }): void {
        const lc: any = (this as any)._lifecycle;
        if (state.connectionGaveUp === true) { lc._state = 'gave-up'; }
        else if (state.isDisconnecting === true) { lc._state = 'disconnecting'; }
        else if (state.isConnecting === true) { lc._state = 'connecting'; }
        // When setting flags to false, only change state if it currently matches
        // that flag (don't clobber 'connected' when clearing 'isConnecting')
        if (state.isConnecting === false && lc._state === 'connecting') { lc._state = 'disconnected'; }
        if (state.isDisconnecting === false && lc._state === 'disconnecting') { lc._state = 'disconnected'; }
        if (state.connectionGaveUp === false && lc._state === 'gave-up') { lc._state = 'disconnected'; }
        if (state.reconnectAttempts !== undefined) { lc._reconnectAttempts = state.reconnectAttempts; }
    }

    public triggerOnDisconnected(): void {
        (this as any)._onStompDisconnected();
    }

}

suite('ArtemisWebsocketService Safety Features', () => {
    let wsService: TestableArtemisWebsocketService;
    let authManager: AuthManager;
    let context: MockExtensionContext;

    setup(async () => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        // Pre-authenticate to avoid auth errors
        await authManager.storeArtemisCredentials('jwt=test-token', true);
        wsService = new TestableArtemisWebsocketService(authManager);
    });

    teardown(async () => {
        if (wsService) {
            await wsService.disconnect();
        }
        sinon.restore();
    });

    test('Connection Mutex: should block connect() when _isConnecting=true', async () => {
        // No simulateConnect here, so the state stays 'connecting' with an
        // in-flight _connectPromise.
        const p = wsService.connect();
        await flushMicrotasks();
        const firstClient = wsService.mockClient;

        // A second connect() while the first is in progress piggybacks on the same promise.
        const p2 = wsService.connect();
        await flushMicrotasks();

        assert.strictEqual(wsService.mockClient, firstClient, 'Should not create new client when already connecting');

        wsService.mockClient!.simulateConnect();
        await p;
        await p2;
    });

    test('Max Attempts: should set _connectionGaveUp=true after 20 failed attempts', async () => {
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        // 19 failed reconnects, so the disconnect below is the 20th and gives up.
        wsService.setInternalState({ reconnectAttempts: 19 });

        wsService.triggerOnDisconnected();
        await flushMicrotasks();

        // The connect() guard checks for the 'gave-up' state, so the block is
        // observed through a rejected connect() rather than a flag.
        assert.strictEqual(wsService.reconnectAttemptsCount, 20, 'Should have 20 reconnect attempts');
        try {
            await wsService.connect();
            assert.fail('connect() should have thrown after max attempts');
        } catch (error) {
            assert.ok(error instanceof Error);
            assert.ok(error.message.includes('Max attempts reached'),
                `Expected 'Max attempts reached' in message, got: ${error.message}`);
        }
    });

    test('Max Attempts: should block new connections after giving up', async () => {
        wsService.setInternalState({ connectionGaveUp: true });

        try {
            await wsService.connect();
            assert.fail('connect() should have thrown');
        } catch (error) {
            assert.ok(error instanceof Error);
            assert.ok(error.message.includes('Max attempts reached'), `Expected 'Max attempts reached' in message, got: ${error.message}`);
        }

        assert.strictEqual(wsService.mockClient, undefined, 'Should not create client after giving up');
    });

    test('Disconnect Mutex: should ignore onDisconnected during intentional disconnect', async () => {
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        const states: boolean[] = [];
        wsService.onDidChangeConnectionState(({ connected: isConnected }) => {
            states.push(isConnected);
        });

        const disconnectPromise = wsService.disconnect();

        // The disconnect handler is ignored during an intentional disconnect.
        // Tested implicitly: no reconnection loop occurs.
        await disconnectPromise;

        assert.strictEqual(wsService.isConnectingState, false);
        assert.strictEqual(wsService.isDisconnectingState, false);
    });
});

suite('ArtemisWebsocketService Connection State Management', () => {
    let wsService: TestableArtemisWebsocketService;
    let authManager: AuthManager;
    let context: MockExtensionContext;
    let clock: sinon.SinonFakeTimers;

    setup(async () => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        await authManager.storeArtemisCredentials('jwt=test-token', true);
        wsService = new TestableArtemisWebsocketService(authManager);
    });

    teardown(async () => {
        if (clock) {
            clock.restore();
        }
        if (wsService) {
            await wsService.disconnect();
        }
        sinon.restore();
    });

    test('Debounced Notifications: disconnect should delay notification by 5s', async () => {
        clock = sinon.useFakeTimers();

        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        const states: boolean[] = [];
        wsService.onDidChangeConnectionState(({ connected: isConnected }) => {
            states.push(isConnected);
        });

        // Drop the connected event fired by simulateConnect above.
        states.length = 0;

        wsService.triggerOnDisconnected();

        assert.strictEqual(states.length, 0, 'Should not notify immediately');

        clock.tick(4000);
        assert.strictEqual(states.length, 0, 'Should not notify before 5s');

        clock.tick(1000);
        assert.strictEqual(states.length, 1, 'Should notify after 5s');
        assert.strictEqual(states[0], false, 'Should notify as disconnected');
    });

    test('Debounced Notifications: reconnect within 5s should cancel disconnect notification', async () => {
        clock = sinon.useFakeTimers();

        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        const states: boolean[] = [];
        wsService.onDidChangeConnectionState(({ connected: isConnected }) => {
            states.push(isConnected);
        });

        // Drop the connected event fired by simulateConnect above.
        states.length = 0;

        wsService.triggerOnDisconnected();

        clock.tick(3000);

        // Reconnect before the 5s grace period ends.
        wsService.mockClient!.simulateConnect();

        assert.ok(states.includes(true), 'Should notify of reconnection immediately');

        // Past the 5s mark.
        clock.tick(3000);

        const falseNotifications = states.filter(s => s === false);
        assert.strictEqual(falseNotifications.length, 0, 'Disconnect notification should be cancelled');
    });
});

suite('ArtemisWebsocketService Reconnection Logic', () => {
    let wsService: TestableArtemisWebsocketService;
    let authManager: AuthManager;
    let context: MockExtensionContext;

    setup(async () => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        await authManager.storeArtemisCredentials('jwt=test-token', true);
        wsService = new TestableArtemisWebsocketService(authManager);
    });

    teardown(async () => {
        if (wsService) {
            await wsService.disconnect();
        }
        sinon.restore();
    });

    test('Reset Connection State: should reset all counters', async () => {
        wsService.setInternalState({
            reconnectAttempts: 15,
            connectionGaveUp: true
        });

        assert.strictEqual(wsService.reconnectAttemptsCount, 15);
        assert.strictEqual(wsService.connectionGaveUpState, true);

        wsService.resetConnectionState();

        assert.strictEqual(wsService.reconnectAttemptsCount, 0, 'Attempts should be reset to 0');
        assert.strictEqual(wsService.connectionGaveUpState, false, 'gaveUp should be reset to false');
    });

    test('Reset Connection State: should allow reconnection after giving up', async () => {
        const clock = sinon.useFakeTimers();

        try {
            wsService.setInternalState({ connectionGaveUp: true });

            try {
                await wsService.connect();
                assert.fail('connect() should have thrown while given up');
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.ok(error.message.includes('Max attempts reached'));
            }

            wsService.resetConnectionState();

            const p2 = wsService.connect();
            await flushMicrotasks();
            wsService.mockClient!.simulateConnect();
            await p2;
            assert.ok(wsService.mockClient, 'Should create client after reset');
            assert.strictEqual((wsService.mockClient as MockStompClient).active, true, 'Client should be active');
        } finally {
            clock.restore();
        }
    });

    test('No connect() in onDisconnected: disconnect handler should NOT call connect()', async () => {
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        const callCountAfterConnect = wsService.connectCallCount;

        wsService.triggerOnDisconnected();

        assert.strictEqual(
            wsService.connectCallCount,
            callCountAfterConnect,
            'onDisconnected should NOT call connect()'
        );
    });
});

suite('IrisWebSocketSessionClient Safety Features', () => {
    let wsService: TestableArtemisWebsocketService;
    let authManager: AuthManager;
    let sessionManager: IrisWebSocketSessionClient;
    let context: MockExtensionContext;
    let clock: sinon.SinonFakeTimers | undefined;

    setup(async () => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        await authManager.storeArtemisCredentials('jwt=test-token', true);

        wsService = new TestableArtemisWebsocketService(authManager);

        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        sessionManager = new IrisWebSocketSessionClient(wsService);
    });

    teardown(async () => {
        if (clock) {
            clock.restore();
        }
        if (sessionManager) {
            sessionManager.dispose();
        }
        if (wsService) {
            await wsService.disconnect();
        }
        sinon.restore();
    });

    // A deliberate `subscribeToSession` call is never rate-limited: `_converge`
    // moves to the desired session immediately.
    // `test/logic/iris/irisWebSocketSessionClient.resubscribe.test.ts` covers
    // the latest-wins semantics in full; this test only checks the two
    // scenarios visible through this suite's STOMP mock.
    test('Latest-wins: resubscribing to the same session is a no-op, a different one switches immediately', async () => {
        sessionManager.subscribeToSession(123);

        const topic123 = '/user/topic/iris/123';

        assert.ok(wsService.mockClient!.subscriptions.has(topic123), 'Initial subscription exists');

        // Resubscribing to the same session tears nothing down.
        const subscriptionCountBefore = wsService.mockClient!.subscriptions.size;
        sessionManager.subscribeToSession(123);
        assert.strictEqual(wsService.mockClient!.subscriptions.size, subscriptionCountBefore,
            'Resubscribing to the same session should not change subscriptions');

        // Switching to a different session takes effect without any wait.
        sessionManager.subscribeToSession(456);
        const topic456 = '/user/topic/iris/456';
        assert.ok(wsService.mockClient!.subscriptions.has(topic456),
            'Should switch to the new session immediately');
        assert.strictEqual(wsService.mockClient!.subscriptions.has(topic123), false,
            'Old session subscription should be torn down');
    });

    test('No connect() Calls: _converge should NEVER call connect()', async () => {
        await wsService.disconnect();

        const connectSpy = sinon.spy(wsService, 'connect');

        // The constructor registers the connection-state callback.
        const newSessionManager = new IrisWebSocketSessionClient(wsService);

        newSessionManager.subscribeToSession(123);
        newSessionManager.subscribeToSession(100);

        assert.strictEqual(connectSpy.callCount, 0, 'IrisWebSocketSessionClient should NEVER call connect()');
        sinon.assert.notCalled(connectSpy);

        newSessionManager.dispose();
    });

    test('Proper Cleanup: dispose() should dispose connection state subscription', async () => {
        // The constructor subscribes to onDidChangeConnectionState.
        const tempManager = new IrisWebSocketSessionClient(wsService);

        tempManager.dispose();

        // If dispose() left the callback registered, this state change would
        // make the manager try to resubscribe and throw.
        wsService.triggerOnDisconnected();
    });
});

suite('IrisWebSocketSessionClient Subscription Management', () => {
    let wsService: TestableArtemisWebsocketService;
    let authManager: AuthManager;
    let sessionManager: IrisWebSocketSessionClient;
    let context: MockExtensionContext;
    let clock: sinon.SinonFakeTimers;

    setup(async () => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        await authManager.storeArtemisCredentials('jwt=test-token', true);

        wsService = new TestableArtemisWebsocketService(authManager);

    });

    teardown(async () => {
        if (clock) {
            clock.restore();
        }
        if (sessionManager) {
            sessionManager.dispose();
        }
        if (wsService) {
            await wsService.disconnect();
        }
        sinon.restore();
    });

    test('Subscribe when connected: should subscribe only if WebSocket is connected', async () => {
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        sessionManager = new IrisWebSocketSessionClient(wsService);

        sessionManager.subscribeToSession(123);

        const topic = '/user/topic/iris/123';
        assert.ok(
            wsService.mockClient!.subscriptions.has(topic),
            'Should be subscribed when connected'
        );
    });

    test('Subscribe when connected: should NOT subscribe if WebSocket is disconnected', async () => {
        // The WebSocket is deliberately never connected.
        sessionManager = new IrisWebSocketSessionClient(wsService);

        // Must not throw, and must not subscribe either.
        sessionManager.subscribeToSession(123);

        // No client is created while disconnected.
        assert.strictEqual(wsService.mockClient, undefined, 'Should not have subscribed');
    });

    test('Resubscribe on reconnect: should automatically resubscribe when WebSocket reconnects', async () => {
        // Non-zero start time, otherwise the rate limiter sees timestamp 0.
        clock = sinon.useFakeTimers(Date.now());

        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        sessionManager = new IrisWebSocketSessionClient(wsService);
        sessionManager.subscribeToSession(123);

        const topic = '/user/topic/iris/123';

        assert.ok(wsService.mockClient!.subscriptions.has(topic), 'Initial subscription');

        sessionManager.unsubscribe();

        // Clears the SERVICE's subscriptions map.
        wsService.triggerOnDisconnected();

        // A real broker drops the client's subscriptions too.
        wsService.mockClient!.subscriptions.clear();

        assert.strictEqual(wsService.mockClient!.subscriptions.size, 0, 'Mock subscriptions cleared on disconnect');

        // Past the rate limit.
        clock.tick(3100);

        // Fires onDidChangeConnectionState, which drives _converge.
        wsService.mockClient!.simulateConnect();

        assert.ok(
            wsService.mockClient!.subscriptions.has(topic),
            'Should resubscribe on reconnect'
        );
    });

    test('Unsubscribe cleanup: unsubscribe() should remove subscription', async () => {
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        sessionManager = new IrisWebSocketSessionClient(wsService);
        sessionManager.subscribeToSession(123);

        const topic = '/user/topic/iris/123';
        assert.ok(wsService.mockClient!.subscriptions.has(topic), 'Should be subscribed');

        sessionManager.unsubscribe();

        assert.strictEqual(
            wsService.mockClient!.subscriptions.has(topic),
            false,
            'Subscription should be removed after unsubscribe()'
        );
    });

    test('Unsubscribe cleanup: dispose should clean up subscription', async () => {
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        sessionManager = new IrisWebSocketSessionClient(wsService);
        sessionManager.subscribeToSession(123);

        const topic = '/user/topic/iris/123';
        assert.ok(wsService.mockClient!.subscriptions.has(topic));

        sessionManager.dispose();

        assert.strictEqual(
            wsService.mockClient!.subscriptions.has(topic),
            false,
            'Subscription should be cleaned up on dispose'
        );
    });
});

suite('WebSocket Integration Tests', () => {
    let wsService: TestableArtemisWebsocketService;
    let authManager: AuthManager;
    let sessionManager: IrisWebSocketSessionClient;
    let context: MockExtensionContext;
    let clock: sinon.SinonFakeTimers;

    setup(async () => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        await authManager.storeArtemisCredentials('jwt=test-token', true);

        wsService = new TestableArtemisWebsocketService(authManager);

    });

    teardown(async () => {
        if (clock) {
            clock.restore();
        }
        if (sessionManager) {
            sessionManager.dispose();
        }
        if (wsService) {
            await wsService.disconnect();
        }
        sinon.restore();
    });

    test('Full lifecycle: connect -> subscribe -> receive message -> disconnect', async () => {
        // Non-zero start time, otherwise the rate limiter sees timestamp 0.
        clock = sinon.useFakeTimers(Date.now());

        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;
        assert.strictEqual(wsService.isConnected(), true);

        sessionManager = new IrisWebSocketSessionClient(wsService);
        sessionManager.subscribeToSession(123);

        const receivedMessages: any[] = [];
        sessionManager.onDidReceiveMessage((msg) => {
            receivedMessages.push(msg);
        });

        const testMessage = { content: 'Hello from Iris', sender: 'IRIS' };
        wsService.mockClient!.simulateMessage('/user/topic/iris/123', testMessage);

        // Messages arrive wrapped with their source session id.
        assert.strictEqual(receivedMessages.length, 1);
        assert.deepStrictEqual(receivedMessages[0], { frame: testMessage, sourceSessionId: 123 });

        await wsService.disconnect();
        assert.strictEqual(wsService.isConnected(), false);
    });

    test('Connection state propagation: WebSocket state changes should propagate to IrisWebSocketSessionClient', async () => {
        clock = sinon.useFakeTimers(Date.now());

        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        sessionManager = new IrisWebSocketSessionClient(wsService);

        // The listener is registered after the manager, so the initial 'true'
        // has already been fired. Only a fresh state change is observable here.
        const connectionStates: boolean[] = [];
        sessionManager.onDidConnectionStateChange((isConnected) => {
            connectionStates.push(isConnected);
        });

        wsService.triggerOnDisconnected();

        // The 'false' notification is debounced by 5s.
        clock.tick(5100);

        assert.ok(connectionStates.includes(false), 'Should report disconnected state');

        wsService.mockClient!.simulateConnect();

        assert.ok(connectionStates.includes(true), 'Should report reconnected state');
    });

    test('Memory leak prevention: multiple session initializations should not accumulate subscriptions', async () => {
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        sessionManager = new IrisWebSocketSessionClient(wsService);

        for (let i = 0; i < 5; i++) {
            sessionManager.subscribeToSession(123 + i);
        }

        // The connection-state listener is registered once, in the constructor;
        // repeated subscribeToSession calls add no more. Verified indirectly:
        // after dispose, a state change triggers nothing and throws nothing.
        sessionManager.dispose();
        wsService.triggerOnDisconnected();
    });
});

suite('WebSocket Race Condition Fixes', () => {
    let wsService: TestableArtemisWebsocketService;
    let authManager: AuthManager;
    let context: MockExtensionContext;
    let clock: sinon.SinonFakeTimers;

    setup(async () => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        await authManager.storeArtemisCredentials('jwt=test-token', true);
        wsService = new TestableArtemisWebsocketService(authManager);
    });

    teardown(async () => {
        if (clock) {
            clock.restore();
        }
        if (wsService) {
            await wsService.disconnect();
        }
        sinon.restore();
    });

    test('concurrent connect() should share the same promise', async () => {
        const p1 = wsService.connect();
        const p2 = wsService.connect();

        // Let the first connect() get as far as creating the client.
        await new Promise(resolve => setTimeout(resolve, 0));

        wsService.mockClient!.simulateConnect();

        await p1;
        await p2;

        assert.strictEqual(wsService.isConnected(), true);
    });

    test('max reconnect should notify only once', async () => {
        clock = sinon.useFakeTimers();

        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        const states: boolean[] = [];
        wsService.onDidChangeConnectionState(({ connected: isConnected }) => {
            states.push(isConnected);
        });
        // Drop the connected event fired by simulateConnect above.
        states.length = 0;

        // 19 attempts, so the disconnect below is the 20th and gives up.
        wsService.setInternalState({ reconnectAttempts: 19 });

        wsService.triggerOnDisconnected();

        // Past the 5s debounce period.
        clock.tick(6000);

        // Exactly one false notification: giving up notifies immediately and
        // cancels the debounce timer.
        const falseNotifications = states.filter(s => s === false);
        assert.strictEqual(falseNotifications.length, 1,
            `Expected exactly 1 disconnect notification, got ${falseNotifications.length}`);
    });

    test('WebSocket close during handshake should reject connect()', async () => {
        const p = wsService.connect();

        // Let connect() get as far as creating the client.
        await new Promise(resolve => setTimeout(resolve, 0));

        // Close BEFORE onConnect fires, i.e. mid-handshake.
        wsService.mockClient!.simulateWebSocketClose();

        try {
            await p;
            assert.fail('connect() should have rejected');
        } catch (error) {
            assert.ok(error instanceof Error);
            assert.ok(error.message.includes('closed during connection'),
                `Expected 'closed during connection' in message, got: ${error.message}`);
        }
    });

    test('disconnect() during connect() aborts connection via generation token', async () => {
        const p = wsService.connect();
        const genAfterConnect = wsService.connectionGeneration;

        // Let connect() get as far as creating the client.
        await new Promise(resolve => setTimeout(resolve, 0));

        // disconnect() increments the generation, invalidating the in-flight connect.
        await wsService.disconnect();
        assert.ok(wsService.connectionGeneration > genAfterConnect,
            'disconnect() should increment connection generation');

        // disconnect()'s _rejectConnect settles the original promise.
        try {
            await p;
            assert.fail('connect() should have been rejected by disconnect');
        } catch (error) {
            assert.ok(error instanceof Error);
        }
    });

    test('handshake failures increment reconnect attempts', async () => {
        const p = wsService.connect();
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.strictEqual(wsService.reconnectAttemptsCount, 0, 'Should start at 0');

        wsService.mockClient!.simulateWebSocketClose();

        try { await p; } catch { /* expected rejection */ }

        assert.strictEqual(wsService.reconnectAttemptsCount, 1,
            'Handshake failure should increment reconnect attempts');
    });

    test('connect() throws when blocked and no in-flight promise', async () => {
        wsService.setInternalState({ connectionGaveUp: true });

        try {
            await wsService.connect();
            assert.fail('connect() should have thrown');
        } catch (error) {
            assert.ok(error instanceof Error);
            assert.ok(error.message.includes('Max attempts reached'),
                `Expected 'Max attempts reached' in message, got: ${(error as Error).message}`);
        }
    });

    test('intentional disconnect notifies consumers', async () => {
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        const states: Array<{ connected: boolean; wasEverConnected: boolean }> = [];
        wsService.onDidChangeConnectionState(({ connected: isConnected, wasEverConnected }) => {
            states.push({ connected: isConnected, wasEverConnected });
        });
        // Drop the connected event fired by simulateConnect above.
        states.length = 0;

        await wsService.disconnect();

        assert.ok(states.length >= 1, 'Should have received at least one notification');
        const disconnectNotification = states.find(s => !s.connected);
        assert.ok(disconnectNotification, 'Should have received disconnect notification');
        assert.strictEqual(disconnectNotification!.wasEverConnected, true,
            'wasEverConnected should be true during disconnect notification');
    });

    // While the first connect() awaits `_client.deactivate()`, a parallel
    // `connect()` call observes the 'connecting' state at the top of the method
    // and returns the existing `_connectDeferred.promise`. The catch path
    // (deactivate failed, auth headers empty, etc.) must therefore settle that
    // deferred via `_settleDeferred(error)`, or every concurrent awaiter hangs
    // forever.
    test('concurrent connect() awaiters reject when catch path fires', async () => {
        // Hold deactivate open so a second connect() can attach as an awaiter
        // before the first call's catch block runs.
        const p1 = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p1;

        let releaseDeactivate!: () => void;
        const deactivateGate = new Promise<void>(resolve => { releaseDeactivate = resolve; });
        wsService.mockClient!.deactivate = async () => {
            await deactivateGate;
            throw new Error('deactivate failed');
        };

        // First reconnect: enters connecting, blocks inside `await deactivate()`.
        const reconnect1 = wsService.connect();
        await flushMicrotasks();
        assert.strictEqual(wsService.isConnectingState, true, 'first reconnect should be in connecting state');

        // Second reconnect arrives during the await: returns the same deferred.
        const reconnect2 = wsService.connect();

        // Let the catch path fire.
        releaseDeactivate();

        // Both awaiters must reject with the same root cause, neither hangs.
        await assert.rejects(reconnect1, /deactivate failed/);
        await assert.rejects(reconnect2, /deactivate failed/);
        assert.strictEqual(wsService.isConnectingState, false, 'state machine must exit connecting');
    });

    // Companion to the concurrent-awaiter test: when a single caller hits the
    // catch path, nobody else observes the deferred, yet it still has to settle
    // cleanly rather than surface as an unhandled rejection.
    test('catch path with single caller does not emit unhandled rejection', async () => {
        const rejections: unknown[] = [];
        const onUnhandled = (reason: unknown): void => { rejections.push(reason); };
        process.on('unhandledRejection', onUnhandled);
        try {
            const p1 = wsService.connect();
            await flushMicrotasks();
            wsService.mockClient!.simulateConnect();
            await p1;

            wsService.mockClient!.deactivate = async () => {
                throw new Error('deactivate failed');
            };

            await assert.rejects(wsService.connect(), /deactivate failed/);

            // Drain microtasks so any pending unhandled rejection would fire.
            await flushMicrotasks();
            await new Promise(resolve => setImmediate(resolve));

            assert.deepStrictEqual(rejections, [], 'no unhandled rejection allowed');
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }
    });

    test('_isDisconnecting resets if deactivate() throws', async () => {
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        wsService.mockClient!.deactivate = async () => {
            throw new Error('deactivate failed');
        };

        // A new connect() deactivates the existing client, which now throws.
        // Await the rejection immediately: handing the rejected promise a
        // handler only after a macrotask hop leaves it unhandled long enough
        // for the extension host to report it, and a swallow-all catch would
        // let this test pass even if connect() resolved.
        const p2 = wsService.connect();
        await assert.rejects(p2, /deactivate failed/);

        assert.strictEqual(wsService.isDisconnectingState, false,
            '_isDisconnecting should be reset even when deactivate() throws');
        assert.strictEqual(wsService.lifecycleState, 'disconnected',
            'failed reconnect must land in disconnected, not stay in connecting');
    });
});
