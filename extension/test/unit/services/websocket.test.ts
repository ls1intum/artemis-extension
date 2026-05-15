import * as assert from 'assert';
import * as sinon from 'sinon';
import { ArtemisWebsocketService } from '../../../src/extension/services/websocket/artemisWebsocketService';
import { IrisWebSocketSessionClient } from '../../../src/extension/services/iris/transport/irisWebSocketSessionClient';
import { MockExtensionContext } from '../mocks/vscodeMocks';
import { AuthManager } from '../../../src/extension/services/auth/authManager';
import { ArtemisApiService } from '../../../src/extension/api';
import { Client, StompConfig, IMessage, StompSubscription } from '@stomp/stompjs';
import { ActiveContext } from '../../../src/extension/types';

// Helper to create a valid ActiveContext for tests
function createTestContext(type: 'exercise' | 'course', id: number, title: string): ActiveContext {
    return {
        type,
        id,
        title,
        source: 'user-selected',
        locked: false,
        selectedAt: Date.now()
    };
}

/**
 * Flush the microtask queue so that connect() progresses past its async
 * operations (await getAuthHeaders()) and reaches _createClient().
 *
 * Why multiple yields: connect() has several `await` points before
 * _createClient(). Each `await` schedules a microtask continuation.
 * We chain enough Promise.resolve() calls to let all of them run.
 *
 * Uses Promise.resolve() chaining instead of setTimeout/setImmediate
 * so it works even when sinon.useFakeTimers() is active (sinon fakes
 * setTimeout and setImmediate but NOT Promise microtasks).
 */
async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

// ============================================================================
// Mock STOMP Client
// ============================================================================

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

    // Test helpers
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

// ============================================================================
// Testable WebSocket Service (exposes internals for testing)
// ============================================================================

class TestableArtemisWebsocketService extends ArtemisWebsocketService {
    public mockClient?: MockStompClient;
    public connectCallCount: number = 0;

    // Expose private fields for testing via getters
    public get isConnectingState(): boolean {
        return (this as any)._connectionState === 'connecting';
    }

    public get isDisconnectingState(): boolean {
        return (this as any)._connectionState === 'disconnecting';
    }

    public get connectionGaveUpState(): boolean {
        return (this as any)._connectionState === 'gave-up';
    }

    public get reconnectAttemptsCount(): number {
        return (this as any)._reconnectAttempts;
    }

    public get wasConnectedOnceState(): boolean {
        return (this as any)._wasConnectedOnce;
    }

    public get connectionGeneration(): number {
        return (this as any)._connectionGeneration;
    }

    // Override client creation to use mock
    protected _createClient(config: StompConfig): Client {
        this.mockClient = new MockStompClient(config);
        return this.mockClient as unknown as Client;
    }

    // Override connect to track call count
    public async connect(): Promise<void> {
        this.connectCallCount++;
        return super.connect();
    }

    // Helper to directly set internal state for testing.
    // Maps legacy boolean flags to the ConnectionState enum.
    // Priority: gave-up > disconnecting > connecting > (no change for false-only flags)
    public setInternalState(state: {
        isConnecting?: boolean;
        isDisconnecting?: boolean;
        connectionGaveUp?: boolean;
        reconnectAttempts?: number;
    }): void {
        if (state.connectionGaveUp === true) {
            (this as any)._connectionState = 'gave-up';
        } else if (state.isDisconnecting === true) {
            (this as any)._connectionState = 'disconnecting';
        } else if (state.isConnecting === true) {
            (this as any)._connectionState = 'connecting';
        }
        // When setting flags to false, only change state if it currently matches
        // that flag (don't clobber 'connected' when clearing 'isConnecting')
        if (state.isConnecting === false && (this as any)._connectionState === 'connecting') {
            (this as any)._connectionState = 'disconnected';
        }
        if (state.isDisconnecting === false && (this as any)._connectionState === 'disconnecting') {
            (this as any)._connectionState = 'disconnected';
        }
        if (state.connectionGaveUp === false && (this as any)._connectionState === 'gave-up') {
            (this as any)._connectionState = 'disconnected';
        }
        if (state.reconnectAttempts !== undefined) {
            (this as any)._reconnectAttempts = state.reconnectAttempts;
        }
    }

    // Helper to trigger onDisconnected
    public triggerOnDisconnected(): void {
        (this as any)._onDisconnected();
    }

}

// ============================================================================
// Test Suite: ArtemisWebsocketService Safety Features
// ============================================================================

suite('ArtemisWebsocketService Safety Features', () => {
    let wsService: TestableArtemisWebsocketService;
    let authManager: AuthManager;
    let context: MockExtensionContext;

    setup(async () => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        // Pre-authenticate to avoid auth errors
        await authManager.storeArtemisCredentials('jwt=test-token', 'https://artemis.example.com', true);
        wsService = new TestableArtemisWebsocketService(authManager);
    });

    teardown(async () => {
        if (wsService) {
            await wsService.disconnect();
        }
        sinon.restore();
    });

    // ========================================================================
    // Test 1: Connection Mutex
    // ========================================================================
    test('Connection Mutex: should block connect() when _isConnecting=true', async () => {
        // Start a connect but DON'T simulateConnect — keeps state as 'connecting'
        // with an in-flight _connectPromise
        const p = wsService.connect();
        await flushMicrotasks();
        const firstClient = wsService.mockClient;

        // Second connect() while first is still in progress — should piggyback on same promise
        const p2 = wsService.connect();
        await flushMicrotasks();

        // Should NOT replace the client (same reference — _createClient not called again)
        assert.strictEqual(wsService.mockClient, firstClient, 'Should not create new client when already connecting');

        // Resolve the shared promise
        wsService.mockClient!.simulateConnect();
        await p;
        await p2;
    });

    // ========================================================================
    // Test 3: Max Attempts
    // ========================================================================
    test('Max Attempts: should set _connectionGaveUp=true after 20 failed attempts', async () => {
        // First connect to get a client
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        // After connect, reconnectAttempts is 0. Set it to 19 to simulate 19 failed reconnects
        wsService.setInternalState({ reconnectAttempts: 19 });

        // This disconnect (the 20th attempt) should trigger gaveUp.
        // The state transitions: connected -> disconnected -> gave-up -> disconnecting -> disconnected
        // because _onDisconnected deactivates the client after hitting max attempts.
        wsService.triggerOnDisconnected();
        await flushMicrotasks();

        // reconnectAttempts is now 20 (19 + 1), which blocked further connections.
        // The connect() guard checks _connectionState === 'gave-up', so verify
        // that subsequent connection attempts are blocked:
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

    // ========================================================================
    // Test 4: Disconnect Mutex
    // ========================================================================
    test('Disconnect Mutex: should ignore onDisconnected during intentional disconnect', async () => {
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        // Track state change events
        const states: boolean[] = [];
        wsService.onDidChangeConnectionState(({ connected: isConnected }) => {
            states.push(isConnected);
        });

        // Start disconnect (this sets _isDisconnecting = true)
        const disconnectPromise = wsService.disconnect();

        // The disconnect handler should be ignored during intentional disconnect
        // This is tested implicitly - no reconnection loop occurs
        await disconnectPromise;

        // After intentional disconnect, state should be clean
        assert.strictEqual(wsService.isConnectingState, false);
        assert.strictEqual(wsService.isDisconnectingState, false);
    });
});

// ============================================================================
// Test Suite: ArtemisWebsocketService Connection State Management
// ============================================================================

suite('ArtemisWebsocketService Connection State Management', () => {
    let wsService: TestableArtemisWebsocketService;
    let authManager: AuthManager;
    let context: MockExtensionContext;
    let clock: sinon.SinonFakeTimers;

    setup(async () => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        await authManager.storeArtemisCredentials('jwt=test-token', 'https://artemis.example.com', true);
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

    // ========================================================================
    // Test 7: Debounced Notifications
    // ========================================================================
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

        // Clear initial connected event fired by simulateConnect above
        states.length = 0;

        // Trigger disconnect
        wsService.triggerOnDisconnected();

        // Immediately after disconnect, callback should NOT be called yet
        assert.strictEqual(states.length, 0, 'Should not notify immediately');

        // Advance time by 4 seconds - still not notified
        clock.tick(4000);
        assert.strictEqual(states.length, 0, 'Should not notify before 5s');

        // Advance time to 5 seconds - now should be notified
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

        // Clear initial connected event
        states.length = 0;

        // Trigger disconnect
        wsService.triggerOnDisconnected();

        // Advance 3 seconds
        clock.tick(3000);

        // Reconnect before 5s grace period ends
        wsService.mockClient!.simulateConnect();

        // Should get connected notification immediately
        assert.ok(states.includes(true), 'Should notify of reconnection immediately');

        // Advance past the 5s mark
        clock.tick(3000);

        // Should NOT have received a false notification (it was cancelled)
        const falseNotifications = states.filter(s => s === false);
        assert.strictEqual(falseNotifications.length, 0, 'Disconnect notification should be cancelled');
    });
});

// ============================================================================
// Test Suite: ArtemisWebsocketService Reconnection Logic
// ============================================================================

suite('ArtemisWebsocketService Reconnection Logic', () => {
    let wsService: TestableArtemisWebsocketService;
    let authManager: AuthManager;
    let context: MockExtensionContext;

    setup(async () => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        await authManager.storeArtemisCredentials('jwt=test-token', 'https://artemis.example.com', true);
        wsService = new TestableArtemisWebsocketService(authManager);
    });

    teardown(async () => {
        if (wsService) {
            await wsService.disconnect();
        }
        sinon.restore();
    });

    // ========================================================================
    // Test 9: Reset Connection State
    // ========================================================================
    test('Reset Connection State: should reset all counters', async () => {
        // Set up a "bad" state
        wsService.setInternalState({
            reconnectAttempts: 15,
            connectionGaveUp: true
        });

        // Verify bad state
        assert.strictEqual(wsService.reconnectAttemptsCount, 15);
        assert.strictEqual(wsService.connectionGaveUpState, true);

        // Reset
        wsService.resetConnectionState();

        // Verify reset
        assert.strictEqual(wsService.reconnectAttemptsCount, 0, 'Attempts should be reset to 0');
        assert.strictEqual(wsService.connectionGaveUpState, false, 'gaveUp should be reset to false');
    });

    test('Reset Connection State: should allow reconnection after giving up', async () => {
        const clock = sinon.useFakeTimers();

        try {
            // Give up
            wsService.setInternalState({ connectionGaveUp: true });

            // Can't connect while given up - should throw
            try {
                await wsService.connect();
                assert.fail('connect() should have thrown while given up');
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.ok(error.message.includes('Max attempts reached'));
            }

            // Reset
            wsService.resetConnectionState();

            // Now should be able to connect
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

    // ========================================================================
    // Test 10: No connect() in onDisconnected
    // ========================================================================
    test('No connect() in onDisconnected: disconnect handler should NOT call connect()', async () => {
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        // Record call count after initial connect
        const callCountAfterConnect = wsService.connectCallCount;

        // Trigger disconnect handler
        wsService.triggerOnDisconnected();

        // connect() should NOT have been called again
        assert.strictEqual(
            wsService.connectCallCount,
            callCountAfterConnect,
            'onDisconnected should NOT call connect()'
        );
    });
});

// ============================================================================
// Test Suite: IrisWebSocketSessionClient Safety Features
// ============================================================================

suite('IrisWebSocketSessionClient Safety Features', () => {
    let wsService: TestableArtemisWebsocketService;
    let authManager: AuthManager;
    let apiService: sinon.SinonStubbedInstance<ArtemisApiService>;
    let sessionManager: IrisWebSocketSessionClient;
    let context: MockExtensionContext;
    let clock: sinon.SinonFakeTimers | undefined;

    setup(async () => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        await authManager.storeArtemisCredentials('jwt=test-token', 'https://artemis.example.com', true);

        wsService = new TestableArtemisWebsocketService(authManager);

        // Mock API service
        apiService = sinon.createStubInstance(ArtemisApiService);
        apiService.getCurrentChat
            .withArgs('PROGRAMMING_EXERCISE_CHAT', sinon.match.any).resolves({ id: 123 } as any);
        apiService.getCurrentChat
            .withArgs('COURSE_CHAT', sinon.match.any).resolves({ id: 456 } as any);

        // Connect WebSocket first
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        sessionManager = new IrisWebSocketSessionClient(apiService as any, wsService);
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

    // ========================================================================
    // Test 1: Rate Limiting for IrisWebSocketSessionClient
    // ========================================================================
    test('Rate Limiting: resubscription should have min 3s interval', async () => {
        // Don't use fake timers for this test - they interfere with IrisWebSocketSessionClient's Date.now()
        
        // Initialize session (this calls _subscribeIfConnected and subscribes)
        // API returns { id: 123 }, so topic will be /user/topic/iris/123
        await sessionManager.initializeSession(createTestContext('exercise', 100, 'Test'));
        
        const topic = '/user/topic/iris/123';  // API returns 123, not 100!
        
        // Verify initial subscription exists
        assert.ok(wsService.mockClient!.subscriptions.has(topic), 'Initial subscription exists');

        // Try to subscribe again immediately - should be rate limited
        const subscriptionCountBefore = wsService.mockClient!.subscriptions.size;
        sessionManager.subscribeToSession(123);  // Use 123 (the actual session ID)

        // Should NOT have changed subscription count (rate limited, returned early)
        assert.strictEqual(wsService.mockClient!.subscriptions.size, subscriptionCountBefore, 
            'Should not change subscriptions due to rate limit');

        // Wait 3.1 seconds for real
        await new Promise(resolve => setTimeout(resolve, 3100));

        // Now subscription should work (unsubscribe + resubscribe)
        sessionManager.subscribeToSession(123);
        
        // Should still have the subscription (unsubscribed and resubscribed)
        assert.ok(wsService.mockClient!.subscriptions.has(topic),
            'Should allow subscription after 3s');
    }).timeout(5000);  // Increase timeout since we're waiting for real

    // ========================================================================
    // Test 2: No connect() Calls from IrisWebSocketSessionClient
    // ========================================================================
    test('No connect() Calls: _subscribeIfConnected should NEVER call connect()', async () => {
        // Disconnect WebSocket
        await wsService.disconnect();

        // SPY on connect() to verify it's never called
        const connectSpy = sinon.spy(wsService, 'connect');

        // Create new session manager (constructor registers callback)
        const newSessionManager = new IrisWebSocketSessionClient(apiService as any, wsService);

        // Try to initialize session (WebSocket not connected)
        await newSessionManager.initializeSession(createTestContext('exercise', 100, 'Test'));

        // Try to subscribe directly
        newSessionManager.subscribeToSession(100);

        // connect() should NEVER have been called
        assert.strictEqual(connectSpy.callCount, 0, 'IrisWebSocketSessionClient should NEVER call connect()');
        sinon.assert.notCalled(connectSpy);

        newSessionManager.dispose();
    });

    // ========================================================================
    // Test 3: Proper Cleanup on dispose
    // ========================================================================
    test('Proper Cleanup: dispose() should dispose connection state subscription', async () => {
        // IrisWebSocketSessionClient subscribes to onDidChangeConnectionState in constructor.
        // We verify dispose() does not throw and the subscription is cleaned up.
        const tempManager = new IrisWebSocketSessionClient(apiService as any, wsService);

        // Dispose should not throw
        tempManager.dispose();

        // Verify the manager no longer reacts to state changes by simulating
        // a reconnect. If dispose() didn't clean up, the callback would fire
        // and try to resubscribe (which would fail or cause side-effects).
        // We verify indirectly: after dispose, no error is thrown on disconnect/reconnect.
        wsService.triggerOnDisconnected();
    });
});

// ============================================================================
// Test Suite: IrisWebSocketSessionClient Subscription Management
// ============================================================================

suite('IrisWebSocketSessionClient Subscription Management', () => {
    let wsService: TestableArtemisWebsocketService;
    let authManager: AuthManager;
    let apiService: sinon.SinonStubbedInstance<ArtemisApiService>;
    let sessionManager: IrisWebSocketSessionClient;
    let context: MockExtensionContext;
    let clock: sinon.SinonFakeTimers;

    setup(async () => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        await authManager.storeArtemisCredentials('jwt=test-token', 'https://artemis.example.com', true);

        wsService = new TestableArtemisWebsocketService(authManager);

        apiService = sinon.createStubInstance(ArtemisApiService);
        apiService.getCurrentChat
            .withArgs('PROGRAMMING_EXERCISE_CHAT', sinon.match.any).resolves({ id: 123 } as any);
        apiService.getCurrentChat
            .withArgs('COURSE_CHAT', sinon.match.any).resolves({ id: 456 } as any);
        apiService.createChatSession
            .withArgs('PROGRAMMING_EXERCISE_CHAT', sinon.match.any).resolves({ id: 789 } as any);
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

    // ========================================================================
    // Test 4: Subscribe when connected
    // ========================================================================
    test('Subscribe when connected: should subscribe only if WebSocket is connected', async () => {
        // Connect first
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        sessionManager = new IrisWebSocketSessionClient(apiService as any, wsService);

        // Initialize session - should subscribe
        await sessionManager.initializeSession(createTestContext('exercise', 100, 'Test'));

        // Check subscription exists
        const topic = '/user/topic/iris/123';
        assert.ok(
            wsService.mockClient!.subscriptions.has(topic),
            'Should be subscribed when connected'
        );
    });

    test('Subscribe when connected: should NOT subscribe if WebSocket is disconnected', async () => {
        // Don't connect WebSocket
        sessionManager = new IrisWebSocketSessionClient(apiService as any, wsService);

        // Initialize session - should NOT throw, but also not subscribe
        await sessionManager.initializeSession(createTestContext('exercise', 100, 'Test'));

        // No mock client exists when not connected
        assert.strictEqual(wsService.mockClient, undefined, 'Should not have subscribed');
    });

    // ========================================================================
    // Test 5: Resubscribe on reconnect
    // ========================================================================
    test('Resubscribe on reconnect: should automatically resubscribe when WebSocket reconnects', async () => {
        // Start clock with a non-zero time to avoid rate limiting issues
        clock = sinon.useFakeTimers(Date.now());

        // Connect and subscribe
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        sessionManager = new IrisWebSocketSessionClient(apiService as any, wsService);
        await sessionManager.initializeSession(createTestContext('exercise', 100, 'Test'));

        // API returns { id: 123 }, so subscription is for session 123
        const topic = '/user/topic/iris/123';
        
        // Check initial subscription exists in the mock client
        assert.ok(wsService.mockClient!.subscriptions.has(topic), 'Initial subscription');

        // Manually unsubscribe to clear the active subscription
        sessionManager.unsubscribe();
        
        // Simulate disconnect - this clears the SERVICE's subscriptions map
        wsService.triggerOnDisconnected();
        
        // Clear the mock client's subscriptions to simulate what happens in real life
        wsService.mockClient!.subscriptions.clear();

        // Verify mock subscriptions are cleared
        assert.strictEqual(wsService.mockClient!.subscriptions.size, 0, 'Mock subscriptions cleared on disconnect');

        // Advance time past rate limit
        clock.tick(3100);

        // Simulate reconnect - this triggers onDidChangeConnectionState event
        // which will call _subscribeIfConnected if conditions are met
        wsService.mockClient!.simulateConnect();

        // Should have resubscribed (the session manager resubscribes on reconnect)
        // Plus the 3 auto-subscriptions from _onConnected
        assert.ok(
            wsService.mockClient!.subscriptions.has(topic),
            'Should resubscribe on reconnect'
        );
    });

    // ========================================================================
    // Test 6: Unsubscribe cleanup
    // ========================================================================
    test('Unsubscribe cleanup: unsubscribe() should remove subscription', async () => {
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        sessionManager = new IrisWebSocketSessionClient(apiService as any, wsService);
        await sessionManager.initializeSession(createTestContext('exercise', 100, 'Test'));

        const topic = '/user/topic/iris/123';
        assert.ok(wsService.mockClient!.subscriptions.has(topic), 'Should be subscribed');

        // Unsubscribe
        sessionManager.unsubscribe();

        // Subscription should be removed
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

        sessionManager = new IrisWebSocketSessionClient(apiService as any, wsService);
        await sessionManager.initializeSession(createTestContext('exercise', 100, 'Test'));

        const topic = '/user/topic/iris/123';
        assert.ok(wsService.mockClient!.subscriptions.has(topic));

        // Dispose
        sessionManager.dispose();

        // Subscription should be removed
        assert.strictEqual(
            wsService.mockClient!.subscriptions.has(topic),
            false,
            'Subscription should be cleaned up on dispose'
        );
    });
});

// ============================================================================
// Test Suite: Integration Tests
// ============================================================================

suite('WebSocket Integration Tests', () => {
    let wsService: TestableArtemisWebsocketService;
    let authManager: AuthManager;
    let apiService: sinon.SinonStubbedInstance<ArtemisApiService>;
    let sessionManager: IrisWebSocketSessionClient;
    let context: MockExtensionContext;
    let clock: sinon.SinonFakeTimers;

    setup(async () => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        await authManager.storeArtemisCredentials('jwt=test-token', 'https://artemis.example.com', true);

        wsService = new TestableArtemisWebsocketService(authManager);

        apiService = sinon.createStubInstance(ArtemisApiService);
        apiService.getCurrentChat
            .withArgs('PROGRAMMING_EXERCISE_CHAT', sinon.match.any).resolves({ id: 123 } as any);
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
        // Start clock with current time to avoid rate limiting issues
        clock = sinon.useFakeTimers(Date.now());

        // 1. Connect
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;
        assert.strictEqual(wsService.isConnected(), true);

        // 2. Create session manager and subscribe
        sessionManager = new IrisWebSocketSessionClient(apiService as any, wsService);
        await sessionManager.initializeSession(createTestContext('exercise', 100, 'Test'));

        // 3. Register message handler
        const receivedMessages: any[] = [];
        sessionManager.onDidReceiveMessage((msg) => {
            receivedMessages.push(msg);
        });

        // 4. Simulate receiving a message (API returns { id: 123 })
        const testMessage = { content: 'Hello from Iris', sender: 'IRIS' };
        wsService.mockClient!.simulateMessage('/user/topic/iris/123', testMessage);

        // 5. Verify message received
        assert.strictEqual(receivedMessages.length, 1);
        assert.deepStrictEqual(receivedMessages[0], testMessage);

        // 6. Disconnect
        await wsService.disconnect();
        assert.strictEqual(wsService.isConnected(), false);
    });

    test('Connection state propagation: WebSocket state changes should propagate to IrisWebSocketSessionClient', async () => {
        // Start clock with current time
        clock = sinon.useFakeTimers(Date.now());

        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        // Create session manager - it will immediately receive the connected state
        // via onDidChangeConnectionState event from WebSocket service
        sessionManager = new IrisWebSocketSessionClient(apiService as any, wsService);

        // Register our listener AFTER session manager is created
        const connectionStates: boolean[] = [];
        sessionManager.onDidConnectionStateChange((isConnected) => {
            connectionStates.push(isConnected);
        });

        // Note: The initial 'true' state was already fired before we registered our listener.
        // This is expected behavior - we need to trigger a state change to see it.
        
        // Simulate disconnect - this will eventually fire 'false' (after debounce)
        wsService.triggerOnDisconnected();

        // Wait for debounce (5 seconds)
        clock.tick(5100);

        // Should have received disconnected state
        assert.ok(connectionStates.includes(false), 'Should report disconnected state');

        // Now simulate reconnect to get a 'true' state
        wsService.mockClient!.simulateConnect();

        // Should have received connected state
        assert.ok(connectionStates.includes(true), 'Should report reconnected state');
    });

    test('Memory leak prevention: multiple session initializations should not accumulate subscriptions', async () => {
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        sessionManager = new IrisWebSocketSessionClient(apiService as any, wsService);

        // Initialize session multiple times
        for (let i = 0; i < 5; i++) {
            await sessionManager.initializeSession(createTestContext('exercise', 100 + i, `Test ${i}`));
        }

        // The session manager registers its connection state listener only once
        // (in the constructor). Multiple initializeSession calls should not add
        // more listeners. We verify indirectly: after dispose, a state change
        // should not trigger any side-effects from the manager.
        sessionManager.dispose();
        wsService.triggerOnDisconnected();
        // No assertion needed beyond "no error thrown"
    });
});

// ============================================================================
// Test Suite: WebSocket Race Condition Fixes
// ============================================================================

suite('WebSocket Race Condition Fixes', () => {
    let wsService: TestableArtemisWebsocketService;
    let authManager: AuthManager;
    let context: MockExtensionContext;
    let clock: sinon.SinonFakeTimers;

    setup(async () => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        await authManager.storeArtemisCredentials('jwt=test-token', 'https://artemis.example.com', true);
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

    // ========================================================================
    // Bug 1 + 3C: concurrent connect() should share the same promise
    // ========================================================================
    test('concurrent connect() should share the same promise', async () => {
        // Start first connect
        const p1 = wsService.connect();

        // Start concurrent connect() — should return the pending promise
        const p2 = wsService.connect();

        // Flush microtasks so first connect() finishes creating the client
        await new Promise(resolve => setTimeout(resolve, 0));

        // Simulate successful connection — resolves the shared promise
        wsService.mockClient!.simulateConnect();

        await p1;
        await p2;

        assert.strictEqual(wsService.isConnected(), true);
    });

    // ========================================================================
    // Bug 3A: max reconnect should notify only once
    // ========================================================================
    test('max reconnect should notify only once', async () => {
        clock = sinon.useFakeTimers();

        // Connect first
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        // Track disconnect notifications
        const states: boolean[] = [];
        wsService.onDidChangeConnectionState(({ connected: isConnected }) => {
            states.push(isConnected);
        });
        // Clear initial connected event
        states.length = 0;

        // Set attempts to 19 so next disconnect is the 20th (triggers give-up)
        wsService.setInternalState({ reconnectAttempts: 19 });

        // Trigger disconnect — this would previously schedule a debounced notification
        // AND fire an immediate notification when max reached
        wsService.triggerOnDisconnected();

        // Advance past the 5s debounce period
        clock.tick(6000);

        // Should have exactly 1 false notification (the immediate one from give-up),
        // NOT 2 (debounce timer should have been cancelled)
        const falseNotifications = states.filter(s => s === false);
        assert.strictEqual(falseNotifications.length, 1,
            `Expected exactly 1 disconnect notification, got ${falseNotifications.length}`);
    });

    // ========================================================================
    // Bug 3B: WebSocket close during handshake should reject connect()
    // ========================================================================
    test('WebSocket close during handshake should reject connect()', async () => {
        // Start connect
        const p = wsService.connect();

        // Flush microtasks so connect() creates the client
        await new Promise(resolve => setTimeout(resolve, 0));

        // Simulate WebSocket close BEFORE onConnect fires (during handshake)
        wsService.mockClient!.simulateWebSocketClose();

        // The connect promise should reject
        try {
            await p;
            assert.fail('connect() should have rejected');
        } catch (error) {
            assert.ok(error instanceof Error);
            assert.ok(error.message.includes('closed during connection'),
                `Expected 'closed during connection' in message, got: ${error.message}`);
        }
    });

    // ========================================================================
    // Bug 1: disconnect() during connect() aborts connection
    // ========================================================================
    test('disconnect() during connect() aborts connection via generation token', async () => {
        // Start connect
        const p = wsService.connect();
        const genAfterConnect = wsService.connectionGeneration;

        // Flush microtasks so connect() creates the client
        await new Promise(resolve => setTimeout(resolve, 0));

        // disconnect() should increment generation, invalidating the in-flight connect
        await wsService.disconnect();
        assert.ok(wsService.connectionGeneration > genAfterConnect,
            'disconnect() should increment connection generation');

        // The original connect promise was rejected by disconnect's _rejectConnect
        try {
            await p;
            assert.fail('connect() should have been rejected by disconnect');
        } catch (error) {
            assert.ok(error instanceof Error);
        }
    });

    // ========================================================================
    // Bug 2: handshake failures increment reconnect attempts
    // ========================================================================
    test('handshake failures increment reconnect attempts', async () => {
        // Start connect
        const p = wsService.connect();
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.strictEqual(wsService.reconnectAttemptsCount, 0, 'Should start at 0');

        // Simulate WebSocket close during handshake
        wsService.mockClient!.simulateWebSocketClose();

        try { await p; } catch { /* expected rejection */ }

        assert.strictEqual(wsService.reconnectAttemptsCount, 1,
            'Handshake failure should increment reconnect attempts');
    });

    // ========================================================================
    // Bug 3: connect() throws when blocked (no in-flight promise)
    // ========================================================================
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

    // ========================================================================
    // Bug 4: intentional disconnect notifies consumers
    // ========================================================================
    test('intentional disconnect notifies consumers', async () => {
        // Connect first
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        const states: Array<{ connected: boolean; wasEverConnected: boolean }> = [];
        wsService.onDidChangeConnectionState(({ connected: isConnected, wasEverConnected }) => {
            states.push({ connected: isConnected, wasEverConnected });
        });
        // Clear initial connected event
        states.length = 0;

        // Intentional disconnect
        await wsService.disconnect();

        // Should have received a (false, true) notification
        assert.ok(states.length >= 1, 'Should have received at least one notification');
        const disconnectNotification = states.find(s => !s.connected);
        assert.ok(disconnectNotification, 'Should have received disconnect notification');
        assert.strictEqual(disconnectNotification!.wasEverConnected, true,
            'wasEverConnected should be true during disconnect notification');
    });

    // ========================================================================
    // Concurrent connect() awaiters are not orphaned when the catch path fires
    // ========================================================================
    //
    // While the first connect() awaits `_client.deactivate()`, a parallel
    // `connect()` call observes the 'connecting' state at the top of the
    // method and returns the existing `_connectDeferred.promise`. If the
    // catch path then throws (deactivate failed, auth headers empty, etc.)
    // without settling the deferred, every concurrent awaiter hangs forever.
    // The fix routes the catch through `_settleDeferred(error)`.
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

        // Both awaiters must reject with the same root cause — neither hangs.
        await assert.rejects(reconnect1, /deactivate failed/);
        await assert.rejects(reconnect2, /deactivate failed/);
        assert.strictEqual(wsService.isConnectingState, false, 'state machine must exit connecting');
    });

    // ========================================================================
    // Catch path with NO concurrent awaiter must not orphan the deferred
    // ========================================================================
    //
    // Companion to the concurrent-awaiter test: when only a single caller
    // hits the catch path, the deferred is never observed by anyone else.
    // It still has to settle cleanly without producing an unhandled
    // promise rejection.
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

    // ========================================================================
    // Bug 5: _isDisconnecting resets if deactivate() throws
    // ========================================================================
    test('_isDisconnecting resets if deactivate() throws', async () => {
        // Connect first
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        // Make deactivate throw
        wsService.mockClient!.deactivate = async () => {
            throw new Error('deactivate failed');
        };

        // Start a new connect — the deactivation of the existing client will throw
        try {
            const p2 = wsService.connect();
            await new Promise(resolve => setTimeout(resolve, 0));
            await p2;
        } catch {
            // Expected — deactivate threw
        }

        // _isDisconnecting should NOT be stuck as true
        assert.strictEqual(wsService.isDisconnectingState, false,
            '_isDisconnecting should be reset even when deactivate() throws');
    });
});
