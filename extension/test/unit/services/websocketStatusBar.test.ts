import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { WebSocketStatusBarService } from '@extension/services/websocket/websocketStatusBar';
import { ArtemisWebsocketService } from '@extension/services/websocket/artemisWebsocketService';
import type { WebSocketDisplayStatus } from '@shared/messageContracts';

/**
 * Tests for WebSocketStatusBarService visibility logic.
 *
 * Uses sinon stubs to control:
 * - vscode.workspace.getConfiguration (controls showWebSocketStatusBar / developerMode)
 * - vscode.window.createStatusBarItem (captures mock status bar item)
 * - vscode.commands.registerCommand (captures command handler)
 * - ArtemisWebsocketService (mock with captured onDidChangeConnectionState callback)
 *
 * Tests fire the captured callback directly to simulate connection state changes
 * and then assert on the mock status bar item's text, backgroundColor, show(), and hide().
 */
suite('WebSocketStatusBarService', () => {
    let sandbox: sinon.SinonSandbox;
    let mockWsService: sinon.SinonStubbedInstance<ArtemisWebsocketService> & { reconnectAttempts: number };
    let capturedCallback: (isConnected: boolean, wasEverConnected?: boolean) => void;
    /**
     * Drive the mock through a (status, isConnected, wasEverConnected) tuple
     * and fire the captured callback so the status bar pulls the new value
     * via getDisplayStatus(). Mirrors how the real service drives the bar.
     */
    let driveState: (status: WebSocketDisplayStatus, isConnected?: boolean, wasEverConnected?: boolean) => void;
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

        // Build mock websocket service. The status bar now reads its UI status
        // from getDisplayStatus(); the callback only signals "something
        // changed, refresh". So the test must set the stub return value
        // before firing the callback. driveState() encapsulates that.
        let currentStatus: WebSocketDisplayStatus = 'disconnected';
        mockWsService = {
            onDidChangeConnectionState: sandbox.stub().callsFake((cb: (event: { connected: boolean; wasEverConnected: boolean }) => void) => {
                capturedCallback = (isConnected: boolean, wasEverConnected?: boolean) => cb({ connected: isConnected, wasEverConnected: wasEverConnected ?? false });
                return { dispose: () => {} };
            }),
            getDisplayStatus: sandbox.stub().callsFake((): WebSocketDisplayStatus => currentStatus),
            isConnected: sandbox.stub().returns(false),
            connect: sandbox.stub().resolves(),
            disconnect: sandbox.stub().resolves(),
            resetConnectionState: sandbox.stub(),
            reconnectAttempts: 0,
        } as unknown as sinon.SinonStubbedInstance<ArtemisWebsocketService> & { reconnectAttempts: number };

        driveState = (status, isConnected = status === 'connected', wasEverConnected = status === 'reconnecting' || status === 'connected') => {
            currentStatus = status;
            capturedCallback(isConnected, wasEverConnected);
        };
    });

    teardown(() => {
        sandbox.restore();
        capturedCommandHandler = undefined;
    });

    // Helper to create the service. Defaults to authenticated=true so the
    // existing logged-in visibility scenarios behave as before; pass false
    // explicitly to exercise the logged-out gate.
    function createService(authenticated = true): WebSocketStatusBarService {
        const service = new WebSocketStatusBarService(mockWsService as unknown as ArtemisWebsocketService);
        service.setAuthenticated(authenticated);
        return service;
    }

    suite('visibility', () => {
        test('hidden when showWebSocketStatusBar=false and connected', () => {
            configValues.showWebSocketStatusBar = false;
            configValues.developerMode = false;

            createService();

            // Simulate connected
            driveState('connected');

            // Should be hidden (setting is off, not disconnected/reconnecting)
            assert.ok(mockStatusBarItem.hide.called, 'Status bar should be hidden when setting is off and connected');
        });

        test('shown when showWebSocketStatusBar=true and connected', () => {
            configValues.showWebSocketStatusBar = true;
            configValues.developerMode = false;

            createService();

            // Simulate connected
            driveState('connected');

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

            // Simulate disconnected (retries exhausted)
            driveState('disconnected');

            assert.ok(mockStatusBarItem.show.called, 'Status bar MUST be shown when disconnected regardless of setting');
            assert.ok(!mockStatusBarItem.hide.called, 'Status bar must NOT be hidden when disconnected');
        });

        test('ALWAYS shown when reconnecting (override rule ignores showWebSocketStatusBar)', () => {
            configValues.showWebSocketStatusBar = false;
            configValues.developerMode = false;

            createService();
            mockStatusBarItem.show.resetHistory();
            mockStatusBarItem.hide.resetHistory();

            // Simulate reconnecting (had a prior successful connection)
            driveState('reconnecting');

            assert.ok(mockStatusBarItem.show.called, 'Status bar MUST be shown when reconnecting regardless of setting');
        });

        test('ALWAYS shown when retries are exhausted (override rule ignores showWebSocketStatusBar)', () => {
            configValues.showWebSocketStatusBar = false;
            configValues.developerMode = false;

            createService();
            mockStatusBarItem.show.resetHistory();
            mockStatusBarItem.hide.resetHistory();

            // 'disconnected' display status now folds gave-up into the same UI state
            driveState('disconnected');

            assert.ok(mockStatusBarItem.show.called, 'Status bar MUST be shown when retries are exhausted');
        });
    });

    suite('status text', () => {
        test('connected shows "$(plug) WS Connected"', () => {
            configValues.showWebSocketStatusBar = true;

            createService();
            driveState('connected');

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
            driveState('reconnecting');

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
            driveState('disconnected');

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
            driveState('disconnected');

            assert.ok(
                mockStatusBarItem.backgroundColor instanceof vscode.ThemeColor,
                'Expected ThemeColor backgroundColor when disconnected'
            );
        });

        test('reconnecting status has warningBackground', () => {
            createService();
            driveState('reconnecting');

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
                driveState('reconnecting');
                mockStatusBarItem.hide.resetHistory();

                // Then simulate successful reconnect
                driveState('connected');

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
                driveState('connected');

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
                driveState('reconnecting');
                driveState('connected');

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

    suite('authentication gate', () => {
        test('logged out + setting off + state disconnected → hidden', () => {
            configValues.showWebSocketStatusBar = false;

            createService(false);
            mockStatusBarItem.show.resetHistory();
            mockStatusBarItem.hide.resetHistory();

            driveState('disconnected');

            assert.ok(
                mockStatusBarItem.hide.called,
                'Status bar must be hidden when logged out and setting is off, even with disconnected state'
            );
            assert.ok(
                !mockStatusBarItem.show.called,
                'Status bar must NOT be shown when logged out and setting is off'
            );
        });

        test('logged out + setting on + state disconnected → shown', () => {
            configValues.showWebSocketStatusBar = true;

            createService(false);
            mockStatusBarItem.show.resetHistory();
            mockStatusBarItem.hide.resetHistory();

            driveState('disconnected');

            assert.ok(
                mockStatusBarItem.show.called,
                'Status bar must be shown when logged out but setting is explicitly on'
            );
        });

        test('logged out → logged in transition re-applies visibility (logged-in rules return)', () => {
            configValues.showWebSocketStatusBar = false;

            const service = createService(false);
            driveState('disconnected');
            mockStatusBarItem.show.resetHistory();
            mockStatusBarItem.hide.resetHistory();

            // Transition: user logs in
            service.setAuthenticated(true);

            // With setting off + logged in + state disconnected → needs attention → show
            assert.ok(
                mockStatusBarItem.show.called,
                'After login, logged-in visibility rules must take over (disconnected → show)'
            );
        });

        test('logged in → logged out transition re-applies visibility (statusbar hides)', () => {
            configValues.showWebSocketStatusBar = false;

            const service = createService(true);
            driveState('disconnected');
            assert.ok(mockStatusBarItem.show.called, 'precondition: bar visible while logged-in disconnected');
            mockStatusBarItem.show.resetHistory();
            mockStatusBarItem.hide.resetHistory();

            // Transition: user logs out
            service.setAuthenticated(false);

            assert.ok(
                mockStatusBarItem.hide.called,
                'After logout, status bar must hide (no WebSocket exists)'
            );
        });

        test('setAuthenticated is idempotent (same value is a no-op)', () => {
            configValues.showWebSocketStatusBar = false;

            const service = createService(true);
            driveState('disconnected');
            mockStatusBarItem.show.resetHistory();
            mockStatusBarItem.hide.resetHistory();

            // Same value as current → no visibility re-apply
            service.setAuthenticated(true);

            assert.ok(
                !mockStatusBarItem.show.called && !mockStatusBarItem.hide.called,
                'setAuthenticated with unchanged value must not trigger show/hide'
            );
        });
    });

    suite('reconnectAttempts getter', () => {
        test('reconnectAttempts getter returns the internal counter value', () => {
            // This tests that the getter is accessible on the service
            // We test via the status bar text which reads reconnectAttempts
            configValues.showWebSocketStatusBar = false;
            mockWsService.reconnectAttempts = 7;

            createService();
            driveState('reconnecting');

            assert.ok(
                mockStatusBarItem.text.includes('7/20'),
                `Expected "7/20" in reconnecting text, got: ${mockStatusBarItem.text}`
            );
        });
    });
});
