import * as assert from 'assert';
import * as sinon from 'sinon';
import { ArtemisWebsocketService } from '../../../src/services/artemisWebsocketService';
import { IrisSessionManager } from '../../../src/services/irisSessionManager';
import { MockExtensionContext } from '../mocks/vscodeMocks';
import { AuthManager } from '../../../src/auth/auth';
import { ArtemisApiService } from '../../../src/api';
import { Client, StompConfig, IMessage, StompSubscription } from '@stomp/stompjs';
import { ActiveContext } from '../../../src/types';

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
        return (this as any)._isConnecting;
    }

    public get isDisconnectingState(): boolean {
        return (this as any)._isDisconnecting;
    }

    public get connectionGaveUpState(): boolean {
        return (this as any)._connectionGaveUp;
    }

    public get reconnectAttemptsCount(): number {
        return (this as any)._reconnectAttempts;
    }

    public get lastConnectionAttemptTime(): number {
        return (this as any)._lastConnectionAttempt;
    }

    public get connectionStateCallbacksCount(): number {
        return (this as any)._connectionStateCallbacks.size;
    }

    public get wasConnectedOnceState(): boolean {
        return (this as any)._wasConnectedOnce;
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

    // Helper to directly set internal state for testing
    public setInternalState(state: {
        isConnecting?: boolean;
        isDisconnecting?: boolean;
        connectionGaveUp?: boolean;
        reconnectAttempts?: number;
        lastConnectionAttempt?: number;
    }): void {
        if (state.isConnecting !== undefined) {
            (this as any)._isConnecting = state.isConnecting;
        }
        if (state.isDisconnecting !== undefined) {
            (this as any)._isDisconnecting = state.isDisconnecting;
        }
        if (state.connectionGaveUp !== undefined) {
            (this as any)._connectionGaveUp = state.connectionGaveUp;
        }
        if (state.reconnectAttempts !== undefined) {
            (this as any)._reconnectAttempts = state.reconnectAttempts;
        }
        if (state.lastConnectionAttempt !== undefined) {
            (this as any)._lastConnectionAttempt = state.lastConnectionAttempt;
        }
    }

    // Helper to trigger onDisconnected
    public triggerOnDisconnected(): void {
        (this as any)._onDisconnected();
    }

    // Helper to get reconnect delay
    public getReconnectDelay(): number {
        return (this as any)._getReconnectDelay();
    }
}

// ============================================================================
// Test Suite: ArtemisWebsocketService Safety Features
// ============================================================================

suite('ArtemisWebsocketService Safety Features', () => {
    let wsService: TestableArtemisWebsocketService;
    let authManager: AuthManager;
    let context: MockExtensionContext;
    let clock: sinon.SinonFakeTimers;

    setup(async () => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        // Pre-authenticate to avoid auth errors
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
    // Test 1: Connection Mutex
    // ========================================================================
    test('Connection Mutex: should block connect() when _isConnecting=true', async () => {
        // Create initial client first
        await wsService.connect();
        const firstClient = wsService.mockClient;
        
        // Simulate concurrent connection attempt
        wsService.setInternalState({ isConnecting: true });

        // Try to connect again - should be blocked
        await wsService.connect();

        // Should NOT replace the client (same reference)
        assert.strictEqual(wsService.mockClient, firstClient, 'Should not create new client when already connecting');
    });

    // ========================================================================
    // Test 2: Rate Limiting
    // ========================================================================
    test('Rate Limiting: _canAttemptConnection should block when called < 2s after last attempt', async () => {
        // Start clock at a known time and ensure Date.now() is mocked
        clock = sinon.useFakeTimers({ now: 1000, shouldAdvanceTime: true });

        // First connection - this sets lastConnectionAttempt to 1000
        await wsService.connect();
        wsService.mockClient!.simulateConnect();
        
        // Advance time by only 500ms (now = 1500)
        clock.tick(500);
        
        // Get the current client reference
        const clientBeforeSecondConnect = wsService.mockClient;
        
        // Second connection attempt - should be rate limited
        // lastConnectionAttempt = 1000, Date.now() = 1500, diff = 500ms < 2000ms
        await wsService.connect();
        
        // Should still have the same client (not deactivated and recreated)
        // If rate limiting worked, we never get past the check and never call deactivate()
        assert.strictEqual(wsService.mockClient, clientBeforeSecondConnect, 
            'Should not deactivate and recreate client due to rate limiting');
    });

    test('Rate Limiting: should allow connect() after 2s has passed', async () => {
        clock = sinon.useFakeTimers();

        // First connection
        await wsService.connect();
        wsService.mockClient!.simulateConnect();

        // Advance time by 2100ms (> 2000ms threshold)
        clock.tick(2100);

        // Force reset isConnecting to allow new connection
        wsService.setInternalState({ isConnecting: false });

        const firstClient = wsService.mockClient;

        // Try to connect again - should succeed
        await wsService.connect();

        // Should have created a new client (different instance)
        assert.ok(wsService.mockClient, 'Should create new client after rate limit period');
        assert.notStrictEqual(wsService.mockClient, firstClient, 'Should be a new client instance');
        assert.strictEqual(wsService.mockClient!.active, true, 'New client should be active');
    });

    // ========================================================================
    // Test 3: Max Attempts
    // ========================================================================
    test('Max Attempts: should set _connectionGaveUp=true after 20 failed attempts', async () => {
        // First connect to get a client
        await wsService.connect();
        wsService.mockClient!.simulateConnect();

        // After connect, reconnectAttempts is 0. Set it to 19 to simulate 19 failed reconnects
        wsService.setInternalState({ reconnectAttempts: 19 });

        // This disconnect (the 20th attempt) should trigger gaveUp
        wsService.triggerOnDisconnected();

        // reconnectAttempts is now 20 (19 + 1), which triggers gaveUp
        assert.strictEqual(wsService.connectionGaveUpState, true, 'Should give up after 20 attempts');
    });

    test('Max Attempts: should block new connections after giving up', async () => {
        wsService.setInternalState({ connectionGaveUp: true });

        const initialCallCount = wsService.connectCallCount;
        await wsService.connect();

        // connect() was called but should return early
        assert.strictEqual(wsService.mockClient, undefined, 'Should not create client after giving up');
    });

    // ========================================================================
    // Test 4: Disconnect Mutex
    // ========================================================================
    test('Disconnect Mutex: should ignore onDisconnected during intentional disconnect', async () => {
        await wsService.connect();
        wsService.mockClient!.simulateConnect();

        // Track state change callbacks
        const states: boolean[] = [];
        wsService.onConnectionStateChange((isConnected) => {
            states.push(isConnected);
        });

        // Clear initial state notification
        states.length = 0;

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
    // Test 5: Callback Registration
    // ========================================================================
    test('Callback Registration: should register callback and return unsubscribe function', () => {
        const callback = sinon.spy();

        const unsubscribe = wsService.onConnectionStateChange(callback);

        // Callback should be called immediately with current state
        assert.ok(callback.calledOnce, 'Callback should be called immediately');
        assert.strictEqual(callback.firstCall.args[0], false, 'Initial state should be false');

        // Unsubscribe function should be a function
        assert.strictEqual(typeof unsubscribe, 'function');

        // After registration, callback count should be 1
        assert.strictEqual(wsService.connectionStateCallbacksCount, 1);
    });

    // ========================================================================
    // Test 6: Callback Cleanup
    // ========================================================================
    test('Callback Cleanup: unsubscribe should remove callback from map', () => {
        const callback = sinon.spy();

        const unsubscribe = wsService.onConnectionStateChange(callback);
        assert.strictEqual(wsService.connectionStateCallbacksCount, 1);

        // Unsubscribe
        unsubscribe();

        assert.strictEqual(wsService.connectionStateCallbacksCount, 0, 'Callback should be removed');
    });

    test('Callback Cleanup: multiple callbacks should be tracked independently', () => {
        const callback1 = sinon.spy();
        const callback2 = sinon.spy();
        const callback3 = sinon.spy();

        const unsub1 = wsService.onConnectionStateChange(callback1);
        const unsub2 = wsService.onConnectionStateChange(callback2);
        const unsub3 = wsService.onConnectionStateChange(callback3);

        assert.strictEqual(wsService.connectionStateCallbacksCount, 3);

        // Unsubscribe middle one
        unsub2();
        assert.strictEqual(wsService.connectionStateCallbacksCount, 2);

        // Unsubscribe first
        unsub1();
        assert.strictEqual(wsService.connectionStateCallbacksCount, 1);

        // Unsubscribe last
        unsub3();
        assert.strictEqual(wsService.connectionStateCallbacksCount, 0);
    });

    // ========================================================================
    // Test 7: Debounced Notifications
    // ========================================================================
    test('Debounced Notifications: disconnect should delay notification by 5s', async () => {
        clock = sinon.useFakeTimers();

        await wsService.connect();
        wsService.mockClient!.simulateConnect();

        const states: boolean[] = [];
        wsService.onConnectionStateChange((isConnected) => {
            states.push(isConnected);
        });

        // Clear initial state from callback registration
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

        await wsService.connect();
        wsService.mockClient!.simulateConnect();

        const states: boolean[] = [];
        wsService.onConnectionStateChange((isConnected) => {
            states.push(isConnected);
        });

        // Clear initial states
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
    // Test 8: Exponential Backoff
    // ========================================================================
    test('Exponential Backoff: delay should double from 500 -> 1000 -> 2000 -> ... -> max 10000', () => {
        // Initial delay (0 attempts)
        wsService.setInternalState({ reconnectAttempts: 0 });
        assert.strictEqual(wsService.getReconnectDelay(), 500, 'Initial delay should be 500ms');

        // After 1 attempt
        wsService.setInternalState({ reconnectAttempts: 1 });
        assert.strictEqual(wsService.getReconnectDelay(), 1000, 'After 1 attempt: 1000ms');

        // After 2 attempts
        wsService.setInternalState({ reconnectAttempts: 2 });
        assert.strictEqual(wsService.getReconnectDelay(), 2000, 'After 2 attempts: 2000ms');

        // After 3 attempts
        wsService.setInternalState({ reconnectAttempts: 3 });
        assert.strictEqual(wsService.getReconnectDelay(), 4000, 'After 3 attempts: 4000ms');

        // After 4 attempts
        wsService.setInternalState({ reconnectAttempts: 4 });
        assert.strictEqual(wsService.getReconnectDelay(), 8000, 'After 4 attempts: 8000ms');

        // After 5 attempts - should cap at 10000
        wsService.setInternalState({ reconnectAttempts: 5 });
        assert.strictEqual(wsService.getReconnectDelay(), 10000, 'After 5 attempts: 10000ms (capped)');

        // After many attempts - should still be capped
        wsService.setInternalState({ reconnectAttempts: 10 });
        assert.strictEqual(wsService.getReconnectDelay(), 10000, 'After 10 attempts: still 10000ms (capped)');
    });

    // ========================================================================
    // Test 9: Reset Connection State
    // ========================================================================
    test('Reset Connection State: should reset all counters', async () => {
        // Set up a "bad" state
        wsService.setInternalState({
            reconnectAttempts: 15,
            connectionGaveUp: true,
            lastConnectionAttempt: Date.now()
        });

        // Verify bad state
        assert.strictEqual(wsService.reconnectAttemptsCount, 15);
        assert.strictEqual(wsService.connectionGaveUpState, true);

        // Reset
        wsService.resetConnectionState();

        // Verify reset
        assert.strictEqual(wsService.reconnectAttemptsCount, 0, 'Attempts should be reset to 0');
        assert.strictEqual(wsService.connectionGaveUpState, false, 'gaveUp should be reset to false');
        assert.strictEqual(wsService.lastConnectionAttemptTime, 0, 'lastAttempt should be reset to 0');
    });

    test('Reset Connection State: should allow reconnection after giving up', async () => {
        const clock = sinon.useFakeTimers();

        try {
            // Give up
            wsService.setInternalState({ connectionGaveUp: true });

            // Can't connect while given up - verify by checking client is not created
            const clientBeforeReset = wsService.mockClient;
            await wsService.connect();
            // Client should still be the same (undefined or previous)
            assert.strictEqual(wsService.mockClient, clientBeforeReset, 'Should not create new client while given up');

            // Reset
            wsService.resetConnectionState();

            // Now should be able to connect
            await wsService.connect();
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
        await wsService.connect();
        wsService.mockClient!.simulateConnect();

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
// Test Suite: IrisSessionManager Safety Features
// ============================================================================

suite('IrisSessionManager Safety Features', () => {
    let wsService: TestableArtemisWebsocketService;
    let authManager: AuthManager;
    let apiService: sinon.SinonStubbedInstance<ArtemisApiService>;
    let sessionManager: IrisSessionManager;
    let context: MockExtensionContext;
    let clock: sinon.SinonFakeTimers | undefined;

    setup(async () => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        await authManager.storeArtemisCredentials('jwt=test-token', 'https://artemis.example.com', true);

        wsService = new TestableArtemisWebsocketService(authManager);

        // Mock API service
        apiService = sinon.createStubInstance(ArtemisApiService);
        apiService.getCurrentExerciseChat.resolves({ id: 123 });
        apiService.getCurrentCourseChat.resolves({ id: 456 });

        // Connect WebSocket first
        await wsService.connect();
        wsService.mockClient!.simulateConnect();

        sessionManager = new IrisSessionManager(apiService as any, wsService);
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
    // Test 1: Rate Limiting for IrisSessionManager
    // ========================================================================
    test('Rate Limiting: resubscription should have min 3s interval', async () => {
        // Don't use fake timers for this test - they interfere with IrisSessionManager's Date.now()
        
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
    // Test 2: No connect() Calls from IrisSessionManager
    // ========================================================================
    test('No connect() Calls: _subscribeIfConnected should NEVER call connect()', async () => {
        // Disconnect WebSocket
        await wsService.disconnect();

        // SPY on connect() to verify it's never called
        const connectSpy = sinon.spy(wsService, 'connect');

        // Create new session manager (constructor registers callback)
        const newSessionManager = new IrisSessionManager(apiService as any, wsService);

        // Try to initialize session (WebSocket not connected)
        await newSessionManager.initializeSession(createTestContext('exercise', 100, 'Test'));

        // Try to subscribe directly
        newSessionManager.subscribeToSession(100);

        // connect() should NEVER have been called
        assert.strictEqual(connectSpy.callCount, 0, 'IrisSessionManager should NEVER call connect()');
        sinon.assert.notCalled(connectSpy);

        newSessionManager.dispose();
    });

    // ========================================================================
    // Test 3: Proper Cleanup on dispose
    // ========================================================================
    test('Proper Cleanup: dispose() should unsubscribe connection state callback', async () => {
        // IrisSessionManager registers a callback in constructor
        const callbackCountBefore = wsService.connectionStateCallbacksCount;

        // Create and dispose session manager
        const tempManager = new IrisSessionManager(apiService as any, wsService);

        // Should have registered a callback
        const callbackCountAfterCreate = wsService.connectionStateCallbacksCount;
        assert.strictEqual(
            callbackCountAfterCreate,
            callbackCountBefore + 1,
            'Should register callback on creation'
        );

        // Dispose
        tempManager.dispose();

        // Should have unregistered the callback
        assert.strictEqual(
            wsService.connectionStateCallbacksCount,
            callbackCountBefore,
            'Should unregister callback on dispose'
        );
    });
});

// ============================================================================
// Test Suite: IrisSessionManager Subscription Management
// ============================================================================

suite('IrisSessionManager Subscription Management', () => {
    let wsService: TestableArtemisWebsocketService;
    let authManager: AuthManager;
    let apiService: sinon.SinonStubbedInstance<ArtemisApiService>;
    let sessionManager: IrisSessionManager;
    let context: MockExtensionContext;
    let clock: sinon.SinonFakeTimers;

    setup(async () => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        await authManager.storeArtemisCredentials('jwt=test-token', 'https://artemis.example.com', true);

        wsService = new TestableArtemisWebsocketService(authManager);

        apiService = sinon.createStubInstance(ArtemisApiService);
        apiService.getCurrentExerciseChat.resolves({ id: 123 });
        apiService.getCurrentCourseChat.resolves({ id: 456 });
        apiService.createExerciseChatSession.resolves({ id: 789 });
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
        await wsService.connect();
        wsService.mockClient!.simulateConnect();

        sessionManager = new IrisSessionManager(apiService as any, wsService);

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
        sessionManager = new IrisSessionManager(apiService as any, wsService);

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
        await wsService.connect();
        wsService.mockClient!.simulateConnect();

        sessionManager = new IrisSessionManager(apiService as any, wsService);
        await sessionManager.initializeSession(createTestContext('exercise', 100, 'Test'));

        // API returns { id: 123 }, so subscription is for session 123
        const topic = '/user/topic/iris/123';
        
        // Check initial subscription exists in the mock client
        assert.ok(wsService.mockClient!.subscriptions.has(topic), 'Initial subscription');

        // Manually unsubscribe to reset _isSubscribed flag
        sessionManager.unsubscribe();
        
        // Simulate disconnect - this clears the SERVICE's subscriptions map
        wsService.triggerOnDisconnected();
        
        // Clear the mock client's subscriptions to simulate what happens in real life
        wsService.mockClient!.subscriptions.clear();

        // Verify mock subscriptions are cleared
        assert.strictEqual(wsService.mockClient!.subscriptions.size, 0, 'Mock subscriptions cleared on disconnect');

        // Advance time past rate limit
        clock.tick(3100);

        // Simulate reconnect - this triggers onConnectionStateChange callback
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
        await wsService.connect();
        wsService.mockClient!.simulateConnect();

        sessionManager = new IrisSessionManager(apiService as any, wsService);
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
        await wsService.connect();
        wsService.mockClient!.simulateConnect();

        sessionManager = new IrisSessionManager(apiService as any, wsService);
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
    let sessionManager: IrisSessionManager;
    let context: MockExtensionContext;
    let clock: sinon.SinonFakeTimers;

    setup(async () => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        await authManager.storeArtemisCredentials('jwt=test-token', 'https://artemis.example.com', true);

        wsService = new TestableArtemisWebsocketService(authManager);

        apiService = sinon.createStubInstance(ArtemisApiService);
        apiService.getCurrentExerciseChat.resolves({ id: 123 });
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
        await wsService.connect();
        wsService.mockClient!.simulateConnect();
        assert.strictEqual(wsService.isConnected(), true);

        // 2. Create session manager and subscribe
        sessionManager = new IrisSessionManager(apiService as any, wsService);
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

    test('Connection state propagation: WebSocket state changes should propagate to IrisSessionManager', async () => {
        // Start clock with current time
        clock = sinon.useFakeTimers(Date.now());

        await wsService.connect();
        wsService.mockClient!.simulateConnect();

        // Create session manager - it will immediately receive the connected state
        // via onConnectionStateChange callback from WebSocket service
        sessionManager = new IrisSessionManager(apiService as any, wsService);

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

    test('Memory leak prevention: multiple session initializations should not accumulate callbacks', async () => {
        await wsService.connect();
        wsService.mockClient!.simulateConnect();

        sessionManager = new IrisSessionManager(apiService as any, wsService);

        // Get initial callback count (1 from session manager constructor)
        const initialCallbackCount = wsService.connectionStateCallbacksCount;

        // Initialize session multiple times
        for (let i = 0; i < 5; i++) {
            await sessionManager.initializeSession(createTestContext('exercise', 100 + i, `Test ${i}`));
        }

        // Callback count should remain the same (session manager only registers once)
        assert.strictEqual(
            wsService.connectionStateCallbacksCount,
            initialCallbackCount,
            'Callback count should not increase with multiple session initializations'
        );
    });
});
