import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { WebSocketStatusBarService } from '../../../src/extension/services/websocket/websocketStatusBar';
import { ArtemisWebsocketService } from '../../../src/extension/services/websocket/artemisWebsocketService';

/**
 * Tests for WebSocketStatusBarService visibility logic.
 *
 * Uses sinon stubs to control:
 * - vscode.workspace.getConfiguration (controls showWebSocketStatusBar / developerMode)
 * - vscode.window.createStatusBarItem (captures mock status bar item)
 * - vscode.commands.registerCommand (captures command handler)
 * - ArtemisWebsocketService (mock with captured onConnectionStateChange callback)
 *
 * Tests fire the captured callback directly to simulate connection state changes
 * and then assert on the mock status bar item's text, backgroundColor, show(), and hide().
 */
suite('WebSocketStatusBarService', () => {
    let sandbox: sinon.SinonSandbox;
    let mockWsService: sinon.SinonStubbedInstance<ArtemisWebsocketService> & { reconnectAttempts: number };
    let capturedCallback: (isConnected: boolean, wasEverConnected?: boolean) => void;
    let mockStatusBarItem: {
        text: string;
        backgroundColor: vscode.ThemeColor | undefined;
        command: string | undefined;
        tooltip: string | vscode.MarkdownString | undefined;
        show: sinon.SinonSpy;
        hide: sinon.SinonSpy;
        dispose: sinon.SinonSpy;
    };
    let configValues: Record<string, boolean>;
    let capturedCommandHandler: (() => void) | undefined;

    setup(() => {
        sandbox = sinon.createSandbox();

        // Default config values
        configValues = {
            showWebSocketStatusBar: false,
            developerMode: false,
        };

        // Mock status bar item
        mockStatusBarItem = {
            text: '',
            backgroundColor: undefined,
            command: undefined,
            tooltip: undefined,
            show: sandbox.spy(),
            hide: sandbox.spy(),
            dispose: sandbox.spy(),
        };

        // Stub createStatusBarItem
        sandbox.stub(vscode.window, 'createStatusBarItem').returns(mockStatusBarItem as unknown as vscode.StatusBarItem);

        // Stub getConfiguration to return controllable values
        const mockConfig = {
            get: <T>(key: string, defaultValue?: T): T => {
                if (key in configValues) {
                    return configValues[key] as unknown as T;
                }
                return defaultValue as T;
            }
        };
        sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as unknown as vscode.WorkspaceConfiguration);

        // Stub onDidChangeConfiguration
        sandbox.stub(vscode.workspace, 'onDidChangeConfiguration').returns({ dispose: () => {} } as vscode.Disposable);

        // Stub registerCommand and capture the handler
        sandbox.stub(vscode.commands, 'registerCommand').callsFake((_commandId: string, handler: (...args: unknown[]) => unknown) => {
            capturedCommandHandler = handler as () => void;
            return { dispose: () => {} } as vscode.Disposable;
        });

        // Build mock websocket service
        // We need a partial mock that captures the onConnectionStateChange callback
        mockWsService = {
            onConnectionStateChange: sandbox.stub().callsFake((cb: (isConnected: boolean, wasEverConnected?: boolean) => void) => {
                capturedCallback = cb;
                // Immediately invoke with initial state (not connected, never connected)
                cb(false, false);
                return () => {};
            }),
            isConnected: sandbox.stub().returns(false),
            hasGivenUp: sandbox.stub().returns(false),
            getDebugInfoAsync: sandbox.stub().resolves({
                isConnected: false,
                isConnecting: false,
                isDisconnecting: false,
                wasConnectedOnce: false,
                connectionGaveUp: false,
                clientConnected: false,
                clientActive: false,
                subscriptionCount: 0,
                subscriptions: [],
                callbackCount: 0,
                reconnectAttempts: 0,
                maxReconnectAttempts: 20,
                currentReconnectDelay: 500,
                sessionId: 'test-session',
                serverUrl: 'https://artemis.tum.de',
                websocketUrl: 'wss://artemis.tum.de/websocket/websocket',
                hasCookie: false,
                hasJwtToken: false,
            }),
            connect: sandbox.stub().resolves(),
            disconnect: sandbox.stub().resolves(),
            resetConnectionState: sandbox.stub(),
            reconnectAttempts: 0,
        } as unknown as sinon.SinonStubbedInstance<ArtemisWebsocketService> & { reconnectAttempts: number };
    });

    teardown(() => {
        sandbox.restore();
        capturedCommandHandler = undefined;
    });

    // Helper to create the service and flush pending async operations
    function createService(): WebSocketStatusBarService {
        return new WebSocketStatusBarService(mockWsService as unknown as ArtemisWebsocketService);
    }

    suite('visibility', () => {
        test('hidden when showWebSocketStatusBar=false and connected', () => {
            configValues.showWebSocketStatusBar = false;
            configValues.developerMode = false;

            createService();

            // Simulate connected, was ever connected
            capturedCallback(true, true);

            // Should be hidden (setting is off, not disconnected/reconnecting)
            assert.ok(mockStatusBarItem.hide.called, 'Status bar should be hidden when setting is off and connected');
        });

        test('shown when showWebSocketStatusBar=true and connected', () => {
            configValues.showWebSocketStatusBar = true;
            configValues.developerMode = false;

            createService();

            // Simulate connected
            capturedCallback(true, true);

            // Should be shown (setting is on)
            assert.ok(mockStatusBarItem.show.called, 'Status bar should be shown when setting is on and connected');
        });

        test('ALWAYS shown when disconnected (override rule ignores showWebSocketStatusBar)', () => {
            configValues.showWebSocketStatusBar = false;
            configValues.developerMode = false;

            createService();
            // Reset spy counts after construction
            mockStatusBarItem.show.resetHistory();
            mockStatusBarItem.hide.resetHistory();

            // Simulate disconnected (wasEverConnected=false means Disconnected status)
            capturedCallback(false, false);

            assert.ok(mockStatusBarItem.show.called, 'Status bar MUST be shown when disconnected regardless of setting');
            assert.ok(!mockStatusBarItem.hide.called, 'Status bar must NOT be hidden when disconnected');
        });

        test('ALWAYS shown when reconnecting (override rule ignores showWebSocketStatusBar)', () => {
            configValues.showWebSocketStatusBar = false;
            configValues.developerMode = false;

            createService();
            mockStatusBarItem.show.resetHistory();
            mockStatusBarItem.hide.resetHistory();

            // Simulate reconnecting: wasEverConnected=true means Reconnecting status
            capturedCallback(false, true);

            assert.ok(mockStatusBarItem.show.called, 'Status bar MUST be shown when reconnecting regardless of setting');
        });

        test('ALWAYS shown when gaveUp (override rule ignores showWebSocketStatusBar)', () => {
            configValues.showWebSocketStatusBar = false;
            configValues.developerMode = false;

            (mockWsService.hasGivenUp as sinon.SinonStub).returns(true);

            createService();
            mockStatusBarItem.show.resetHistory();
            mockStatusBarItem.hide.resetHistory();

            // Simulate disconnect notification after giving up
            capturedCallback(false, true);

            assert.ok(mockStatusBarItem.show.called, 'Status bar MUST be shown when gaveUp regardless of setting');
        });
    });

    suite('status text', () => {
        test('connected shows "$(plug) WS Connected"', () => {
            configValues.showWebSocketStatusBar = true;

            createService();
            capturedCallback(true, true);

            assert.ok(
                mockStatusBarItem.text.includes('$(plug)'),
                `Expected "$(plug)" in text, got: ${mockStatusBarItem.text}`
            );
            assert.ok(
                mockStatusBarItem.text.includes('WS Connected'),
                `Expected "WS Connected" in text, got: ${mockStatusBarItem.text}`
            );
        });

        test('reconnecting shows "$(sync~spin) Reconnecting (N/20)..."', () => {
            configValues.showWebSocketStatusBar = false;

            // Set reconnect attempt count
            mockWsService.reconnectAttempts = 3;

            createService();
            capturedCallback(false, true); // wasEverConnected=true → Reconnecting

            assert.ok(
                mockStatusBarItem.text.includes('$(sync~spin)'),
                `Expected "$(sync~spin)" in text, got: ${mockStatusBarItem.text}`
            );
            assert.ok(
                mockStatusBarItem.text.includes('Reconnecting'),
                `Expected "Reconnecting" in text, got: ${mockStatusBarItem.text}`
            );
            assert.ok(
                mockStatusBarItem.text.includes('3/20'),
                `Expected "3/20" in text, got: ${mockStatusBarItem.text}`
            );
        });

        test('disconnected shows "$(debug-disconnect) WS Disconnected"', () => {
            configValues.showWebSocketStatusBar = false;

            createService();
            capturedCallback(false, false); // wasEverConnected=false → Disconnected

            assert.ok(
                mockStatusBarItem.text.includes('$(debug-disconnect)'),
                `Expected "$(debug-disconnect)" in text, got: ${mockStatusBarItem.text}`
            );
            assert.ok(
                mockStatusBarItem.text.includes('WS Disconnected'),
                `Expected "WS Disconnected" in text, got: ${mockStatusBarItem.text}`
            );
        });

        test('disconnected status has errorBackground', () => {
            createService();
            capturedCallback(false, false);

            assert.ok(
                mockStatusBarItem.backgroundColor instanceof vscode.ThemeColor,
                'Expected ThemeColor backgroundColor when disconnected'
            );
        });

        test('reconnecting status has warningBackground', () => {
            createService();
            capturedCallback(false, true); // Reconnecting

            assert.ok(
                mockStatusBarItem.backgroundColor instanceof vscode.ThemeColor,
                'Expected ThemeColor backgroundColor when reconnecting'
            );
        });
    });

    suite('reconnect flash', () => {
        test('after reconnection with setting off, hides after 2s timeout', async () => {
            configValues.showWebSocketStatusBar = false;
            const clock = sandbox.useFakeTimers();

            try {
                createService();

                // First simulate reconnecting
                capturedCallback(false, true);
                mockStatusBarItem.hide.resetHistory();

                // Then simulate successful reconnect
                capturedCallback(true, true);

                // Status bar should still be shown immediately (flash)
                assert.ok(!mockStatusBarItem.hide.called, 'Should not hide immediately on reconnect');

                // Advance time by 2 seconds
                clock.tick(2000);

                // Now it should be hidden
                assert.ok(mockStatusBarItem.hide.called, 'Should hide after 2s when setting is off');
            } finally {
                clock.restore();
            }
        });

        test('when setting is on, does not hide after reconnection', async () => {
            configValues.showWebSocketStatusBar = true;
            const clock = sandbox.useFakeTimers();

            try {
                createService();
                mockStatusBarItem.hide.resetHistory();

                // Simulate successful reconnect
                capturedCallback(true, true);

                // Advance past timeout
                clock.tick(3000);

                // Should NOT be hidden since setting is on
                assert.ok(!mockStatusBarItem.hide.called, 'Should not hide when setting is on');
            } finally {
                clock.restore();
            }
        });
    });

    suite('dispose', () => {
        test('dispose cleans up status bar item and unsubscribes', () => {
            const service = createService();
            service.dispose();

            assert.ok(mockStatusBarItem.dispose.called, 'Status bar item should be disposed');
        });

        test('dispose clears reconnect hide timeout', () => {
            configValues.showWebSocketStatusBar = false;
            const clock = sandbox.useFakeTimers();

            try {
                const service = createService();

                // Simulate reconnection to set the flash timeout
                capturedCallback(false, true);
                capturedCallback(true, true);

                // Dispose before timeout fires
                mockStatusBarItem.hide.resetHistory();
                service.dispose();

                // Advance time — timeout should be cleared, hide should NOT be called
                clock.tick(3000);

                assert.ok(!mockStatusBarItem.hide.called, 'Should not hide after dispose even when timeout elapses');
            } finally {
                clock.restore();
            }
        });
    });

    suite('reconnectAttempts getter', () => {
        test('reconnectAttempts getter returns the internal counter value', () => {
            // This tests that the getter is accessible on the service
            // We test via the status bar text which reads reconnectAttempts
            configValues.showWebSocketStatusBar = false;
            mockWsService.reconnectAttempts = 7;

            createService();
            capturedCallback(false, true); // Reconnecting

            assert.ok(
                mockStatusBarItem.text.includes('7/20'),
                `Expected "7/20" in reconnecting text, got: ${mockStatusBarItem.text}`
            );
        });
    });
});
