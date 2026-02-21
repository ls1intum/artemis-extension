import * as assert from 'assert';
import { ArtemisWebsocketService } from '../../src/services/artemisWebsocketService';
import { MockExtensionContext } from '../mocks/vscodeMocks';
import { AuthManager } from '../../src/auth/auth';
import { ResultDTO } from '../../src/types/artemis';
import { Client, StompConfig, IMessage, StompSubscription } from '@stomp/stompjs';

// Mock Stomp Client
class MockStompClient {
    public config: StompConfig;
    public connected: boolean = false;
    public subscriptions: Map<string, (message: IMessage) => void> = new Map();
    public active: boolean = false;

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
        return {
            id: 'sub-id',
            unsubscribe: () => {
                this.subscriptions.delete(topic);
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
            onNewResult: (result: ResultDTO) => { }
        };

        wsService.registerMessageHandler(handler);
        // No exception means success
        assert.ok(true);
    });

    test('should connect and handle state changes', async () => {
        wsService = new TestableArtemisWebsocketService(authManager);

        // Mock auth
        await authManager.storeArtemisCredentials('jwt=token', 'https://artemis.example.com', true);

        // Track state changes
        const states: boolean[] = [];
        wsService.onConnectionStateChange((isConnected) => {
            states.push(isConnected);
        });

        // Initial state
        assert.strictEqual(states[0], false);

        // Connect
        await wsService.connect();

        assert.ok(wsService.mockClient, 'Client should be created');
        assert.strictEqual(wsService.mockClient.active, true, 'Client should be active');

        // Simulate connection success
        wsService.mockClient.simulateConnect();

        // Should be connected now
        assert.strictEqual(wsService.isConnected(), true);
        assert.strictEqual(states[states.length - 1], true);
    });

    test('should subscribe to topics and receive messages', async () => {
        wsService = new TestableArtemisWebsocketService(authManager);
        await authManager.storeArtemisCredentials('jwt=token', 'https://artemis.example.com', true);
        await wsService.connect();
        wsService.mockClient!.simulateConnect();

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
        await wsService.connect();
        wsService.mockClient!.simulateConnect();

        assert.strictEqual(wsService.isConnected(), true);

        await wsService.disconnect();

        assert.strictEqual(wsService.isConnected(), false);
        assert.strictEqual(wsService.mockClient!.active, false);
    });

    test('should handle STOMP errors', async () => {
        wsService = new TestableArtemisWebsocketService(authManager);
        await authManager.storeArtemisCredentials('jwt=token', 'https://artemis.example.com', true);
        await wsService.connect();
        wsService.mockClient!.simulateConnect();

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

    test('should ensure connection reconnects if disconnected', async () => {
        wsService = new TestableArtemisWebsocketService(authManager);
        await authManager.storeArtemisCredentials('jwt=token', 'https://artemis.example.com', true);

        // Not connected yet
        assert.strictEqual(wsService.isConnected(), false);

        // Ensure connection
        const result = await wsService.ensureConnection();

        // Should have tried to connect
        assert.ok(wsService.mockClient);

        assert.strictEqual(wsService.mockClient!.active, true);
    });

    test('should subscribe to Iris session and receive messages', async () => {
        wsService = new TestableArtemisWebsocketService(authManager);
        await authManager.storeArtemisCredentials('jwt=token', 'https://artemis.example.com', true);
        await wsService.connect();
        wsService.mockClient!.simulateConnect();

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

    test('should handle Iris session unsubscription', async () => {
        wsService = new TestableArtemisWebsocketService(authManager);
        await authManager.storeArtemisCredentials('jwt=token', 'https://artemis.example.com', true);
        await wsService.connect();
        wsService.mockClient!.simulateConnect();

        const sessionId = 12345;
        const topic = `/user/topic/iris/${sessionId}`;

        // Subscribe
        wsService.subscribeToIrisSession(sessionId, () => { });
        assert.ok(wsService.mockClient!.subscriptions.has(topic));

        // Unsubscribe via method
        wsService.unsubscribeFromIrisSession(sessionId);
        assert.strictEqual(wsService.mockClient!.subscriptions.has(topic), false);
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
});
