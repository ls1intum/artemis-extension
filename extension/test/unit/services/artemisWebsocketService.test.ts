import { Client, IMessage, StompConfig, StompSubscription } from '@stomp/stompjs';
import * as assert from 'assert';

import { AuthManager } from '@extension/services/auth/authManager';
import { ArtemisWebsocketService } from '@extension/services/websocket/artemisWebsocketService';
import type { ResultDTO } from '@extension/types';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

/**
 * Flush the microtask queue so that connect() progresses past its async
 * operations (await getAuthHeaders()) and reaches _createClient().
 *
 * Uses Promise.resolve() chaining instead of setTimeout/setImmediate
 * so it works even when sinon.useFakeTimers() is active.
 */
async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

// Mock Stomp Client
class MockStompClient {
    public config: StompConfig;
    public connected: boolean = false;
    public subscriptions: Map<string, (message: IMessage) => void> = new Map();
    public active: boolean = false;
    private _subCounter: number = 0;

    constructor(config: StompConfig) {
        this.config = config;
    }

    activate() {
        this.active = true;
        // In real life, this triggers connection. Here we wait for manual simulation.
    }

    deactivate() {
        this.active = false;
        this.connected = false;
        if (this.config.onDisconnect) {
            this.config.onDisconnect(undefined as any);
        }
        return Promise.resolve();
    }

    subscribe(topic: string, callback: (message: IMessage) => void): StompSubscription {
        this.subscriptions.set(topic, callback);
        const capturedCallback = callback;
        const subId = `sub-${++this._subCounter}`;
        return {
            id: subId,
            unsubscribe: () => {
                // Only remove if the map still holds this exact subscription's callback
                // (mirrors real STOMP client behavior with unique subscription IDs)
                if (this.subscriptions.get(topic) === capturedCallback) {
                    this.subscriptions.delete(topic);
                }
            }
        };
    }

    // Helper to simulate connection
    simulateConnect() {
        this.connected = true;
        if (this.config.onConnect) {
            this.config.onConnect({} as any);
        }
    }

    // Helper to simulate error
    simulateError(message: string) {
        if (this.config.onStompError) {
            this.config.onStompError({
                headers: { message },
                command: 'ERROR',
                body: ''
            } as any);
        }
    }

    // Helper to simulate message
    simulateMessage(topic: string, body: any) {
        const callback = this.subscriptions.get(topic);
        if (callback) {
            callback({
                body: JSON.stringify(body),
                headers: {},
                command: 'MESSAGE',
                ack: () => { },
                nack: () => { }
            });
        }
    }
}

class TestableArtemisWebsocketService extends ArtemisWebsocketService {
    public mockClient?: MockStompClient;

    protected _createClient(config: StompConfig): Client {
        this.mockClient = new MockStompClient(config);
        return this.mockClient as unknown as Client;
    }
}

/**
 * WebSocket Service Tests
 * 
 * These tests use a mock STOMP client to verify:
 * - Connection establishment and lifecycle
 * - Subscription management
 * - Message handling and routing
 * - Error handling
 */
suite('Artemis WebSocket Service Test Suite', () => {
    let wsService: TestableArtemisWebsocketService;
    let authManager: AuthManager;
    let context: MockExtensionContext;

    setup(() => {
        // Setup auth manager with mock credentials
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
    });

    teardown(async () => {
        // Clean up
        if (wsService) {
            await wsService.disconnect();
        }
    });

    test('should register message handlers', () => {
        wsService = new TestableArtemisWebsocketService(authManager);

        const handler = {
            onNewResult: (_result: ResultDTO) => { }
        };

        wsService.registerMessageHandler(handler);
        // No exception means success
        assert.ok(true);
    });

    test('should connect and handle state changes', async () => {
        wsService = new TestableArtemisWebsocketService(authManager);

        // Mock auth
        await authManager.storeArtemisCredentials('jwt=token', 'https://artemis.example.com', true);

        // Track state changes via EventEmitter (no immediate replay on subscribe)
        const states: boolean[] = [];
        wsService.onDidChangeConnectionState(({ connected: isConnected }) => {
            states.push(isConnected);
        });

        // No immediate replay: states should be empty before any event fires
        assert.strictEqual(states.length, 0, 'EventEmitter should not replay on subscribe');

        // Connect - flush microtasks so connect() reaches _createClient() past async operations
        const connectPromise = wsService.connect();
        await flushMicrotasks();

        assert.ok(wsService.mockClient, 'Client should be created');
        assert.strictEqual(wsService.mockClient.active, true, 'Client should be active');

        // Simulate connection success
        wsService.mockClient.simulateConnect();
        await connectPromise;

        // Should be connected now
        assert.strictEqual(wsService.isConnected(), true);
        assert.strictEqual(states[states.length - 1], true);
    });

    test('should subscribe to topics and receive messages', async () => {
        wsService = new TestableArtemisWebsocketService(authManager);
        await authManager.storeArtemisCredentials('jwt=token', 'https://artemis.example.com', true);
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        // Register a handler
        let receivedResult: ResultDTO | undefined;
        wsService.registerMessageHandler({
            onNewResult: (result) => {
                receivedResult = result;
            }
        });

        // Subscribe
        wsService.subscribeToPersonalResults();

        // Verify subscription in mock client
        const topic = '/user/topic/newResults';
        assert.ok(wsService.mockClient!.subscriptions.has(topic), 'Should be subscribed to results');

        // Simulate message — raw JSON data that will be parsed via fromJSON
        const mockResultData = {
            id: 1,
            score: 100,
            rated: true,
            successful: true,
            feedbacks: [],
            submission: { id: 1 }
        };

        wsService.mockClient!.simulateMessage(topic, mockResultData);

        // Verify handler was called with a proper ResultDTO instance
        assert.ok(receivedResult);
        assert.strictEqual(receivedResult!.id, 1);
        assert.strictEqual(receivedResult!.score, 100);
        assert.strictEqual(receivedResult!.successful, true);
    });

    test('should handle disconnection', async () => {
        wsService = new TestableArtemisWebsocketService(authManager);
        await authManager.storeArtemisCredentials('jwt=token', 'https://artemis.example.com', true);
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        assert.strictEqual(wsService.isConnected(), true);

        await wsService.disconnect();

        assert.strictEqual(wsService.isConnected(), false);
        assert.strictEqual(wsService.mockClient!.active, false);
    });

    test('should handle STOMP errors', async () => {
        wsService = new TestableArtemisWebsocketService(authManager);
        await authManager.storeArtemisCredentials('jwt=token', 'https://artemis.example.com', true);
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        // Simulate error
        wsService.mockClient!.simulateError('Connection lost');

        // Service might log it, but shouldn't crash. 
        // We can check if it tries to reconnect or updates state if implemented.
        // Currently implementation just logs errors.
        assert.ok(true);
    });

    test('should fail to connect without authentication', async () => {
        wsService = new TestableArtemisWebsocketService(authManager);

        try {
            await wsService.connect();
            assert.fail('Should have thrown error');
        } catch (error) {
            assert.ok(error instanceof Error);
            assert.ok(error.message.includes('authentication') || error.message.includes('cookie'));
        }
    });

    test('should connect when disconnected', async () => {
        wsService = new TestableArtemisWebsocketService(authManager);
        await authManager.storeArtemisCredentials('jwt=token', 'https://artemis.example.com', true);

        // Not connected yet
        assert.strictEqual(wsService.isConnected(), false);

        // Connect — flush microtasks so connect() reaches _createClient()
        const connectPromise = wsService.connect();
        await flushMicrotasks();

        // Should have tried to connect
        assert.ok(wsService.mockClient);
        assert.strictEqual(wsService.mockClient!.active, true);

        // Simulate successful connection so the promise resolves
        wsService.mockClient!.simulateConnect();
        await connectPromise;

        assert.strictEqual(wsService.isConnected(), true);
    });

    test('should subscribe to Iris session and receive messages', async () => {
        wsService = new TestableArtemisWebsocketService(authManager);
        await authManager.storeArtemisCredentials('jwt=token', 'https://artemis.example.com', true);
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        const sessionId = 12345;
        const topic = `/user/topic/iris/${sessionId}`;
        let receivedMessage: any;

        // Subscribe
        const unsubscribe = wsService.subscribeToIrisSession(sessionId, (message) => {
            receivedMessage = message;
        });

        // Verify subscription
        assert.ok(wsService.mockClient!.subscriptions.has(topic), 'Should be subscribed to Iris session');

        // Simulate message
        const mockIrisMessage = {
            content: 'Hello from Iris',
            sender: 'IRIS'
        };
        wsService.mockClient!.simulateMessage(topic, mockIrisMessage);

        // Verify handler called
        assert.deepStrictEqual(receivedMessage, mockIrisMessage);

        // Unsubscribe via returned function
        unsubscribe();
        assert.strictEqual(wsService.mockClient!.subscriptions.has(topic), false, 'Should be unsubscribed');
    });

    test('should throw when subscribing to Iris session if not connected', () => {
        wsService = new TestableArtemisWebsocketService(authManager);

        try {
            wsService.subscribeToIrisSession(123, () => { });
            assert.fail('Should have thrown');
        } catch (error) {
            assert.ok(error instanceof Error);
            assert.ok(error.message.includes('not connected'));
        }
    });

    test('stale unsubscribe should not remove active subscription', async () => {
        wsService = new TestableArtemisWebsocketService(authManager);
        await authManager.storeArtemisCredentials('jwt=token', 'https://artemis.example.com', true);
        const p = wsService.connect();
        await flushMicrotasks();
        wsService.mockClient!.simulateConnect();
        await p;

        const sessionId = 42;
        const topic = `/user/topic/iris/${sessionId}`;

        // First subscription
        const unsub1 = wsService.subscribeToIrisSession(sessionId, () => { });
        assert.ok(wsService.mockClient!.subscriptions.has(topic), 'First subscription should exist');

        // Second subscription for same session — replaces the first
        const unsub2 = wsService.subscribeToIrisSession(sessionId, () => { });
        assert.ok(wsService.mockClient!.subscriptions.has(topic), 'Second subscription should exist');

        // Call stale unsubscribe from first subscription — should NOT remove the new entry
        unsub1();
        assert.ok(wsService.mockClient!.subscriptions.has(topic),
            'Active subscription should still exist after stale unsubscribe');

        // Call current unsubscribe — should remove the entry
        unsub2();
        assert.strictEqual(wsService.mockClient!.subscriptions.has(topic), false,
            'Subscription should be removed after current unsubscribe');
    });
});
