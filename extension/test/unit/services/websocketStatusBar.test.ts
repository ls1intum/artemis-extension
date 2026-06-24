import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { WebSocketDisplayStatus } from '@shared/messageContracts';

import { ArtemisWebsocketService } from '@extension/services/websocket/artemisWebsocketService';
import { WebSocketStatusBarService } from '@extension/services/websocket/websocketStatusBar';

/**
 * Tests for WebSocketStatusBarService visibility logic.
 *
 * Uses sinon stubs to control:
 * - vscode.workspace.getConfiguration (controls developerMode)
 * - vscode.window.createStatusBarItem (captures mock status bar item)
 * - vscode.commands.registerCommand (returns a no-op disposable)
 * - ArtemisWebsocketService (mock with captured onDidChangeConnectionState callback)
 *
 * Tests fire the captured callback directly to simulate connection state changes
 * and then assert on the mock status bar item's text, backgroundColor, show(), and hide().
 */
suite('WebSocketStatusBarService', () => {
    let sandbox: sinon.SinonSandbox;
    let mockWsService: sinon.SinonStubbedInstance<ArtemisWebsocketService> & { reconnectAttempts: number };
    let capturedCallback: (isConnected: boolean, wasEverConnected?: boolean) => void;
    let capturedConfigCallback: (e: vscode.ConfigurationChangeEvent) => void = () => {};
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

    setup(() => {
        sandbox = sinon.createSandbox();

        // Default config values
        configValues = {
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

        // capture the configuration-change listener so a test can fire it
        sandbox.stub(vscode.workspace, 'onDidChangeConfiguration').callsFake((cb) => {
            capturedConfigCallback = cb as (e: vscode.ConfigurationChangeEvent) => void;
            return { dispose: () => {} } as vscode.Disposable;
        });

        // Stub registerCommand
        sandbox.stub(vscode.commands, 'registerCommand').callsFake(() => {
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
        test('hidden when developerMode=false and connected', () => {
            configValues.developerMode = false;
            createService();
            mockStatusBarItem.show.resetHistory();
            mockStatusBarItem.hide.resetHistory();
            driveState('connected');
            assert.ok(mockStatusBarItem.hide.called, 'Hidden when developerMode off and connected');
            assert.ok(!mockStatusBarItem.show.called, 'Not shown when developerMode off and connected');
        });

        test('shown when developerMode=true and connected', () => {
            configValues.developerMode = true;
            createService();
            mockStatusBarItem.show.resetHistory();
            mockStatusBarItem.hide.resetHistory();
            driveState('connected');
            assert.ok(mockStatusBarItem.show.called, 'Shown when developerMode on and connected');
            assert.ok(!mockStatusBarItem.hide.called, 'Not hidden when developerMode on and connected');
        });

        test('ALWAYS shown when disconnected (override rule ignores developerMode)', () => {
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

        test('ALWAYS shown when reconnecting (override rule ignores developerMode)', () => {
            configValues.developerMode = false;

            createService();
            mockStatusBarItem.show.resetHistory();
            mockStatusBarItem.hide.resetHistory();

            // Simulate reconnecting (had a prior successful connection)
            driveState('reconnecting');

            assert.ok(mockStatusBarItem.show.called, 'Status bar MUST be shown when reconnecting regardless of setting');
        });

        test('ALWAYS shown when retries are exhausted (override rule ignores developerMode)', () => {
            configValues.developerMode = false;

            createService();
            mockStatusBarItem.show.resetHistory();
            mockStatusBarItem.hide.resetHistory();

            // 'disconnected' display status now folds gave-up into the same UI state
            driveState('disconnected');

            assert.ok(mockStatusBarItem.show.called, 'Status bar MUST be shown when retries are exhausted');
        });

        test('reacts to developerMode configuration change', () => {
            configValues.developerMode = false;
            createService();
            driveState('connected');
            mockStatusBarItem.show.resetHistory();
            mockStatusBarItem.hide.resetHistory();

            configValues.developerMode = true;
            capturedConfigCallback({
                affectsConfiguration: (section: string) => section === 'artemis.developerMode',
            } as vscode.ConfigurationChangeEvent);

            assert.ok(mockStatusBarItem.show.called, 'enabling developerMode shows the item while connected');
        });
    });

    suite('status text', () => {
        test('connected shows "$(plug) WS Connected"', () => {
            configValues.developerMode = true;

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
            configValues.developerMode = true;
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
            configValues.developerMode = true;

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
            configValues.developerMode = false;
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

        test('with developerMode on, does not hide after a reconnection', () => {
            configValues.developerMode = true;
            const clock = sandbox.useFakeTimers();
            try {
                createService();
                driveState('reconnecting');
                mockStatusBarItem.hide.resetHistory();
                driveState('connected');
                clock.tick(3000);
                assert.ok(!mockStatusBarItem.hide.called, 'developerMode keeps the item visible through a reconnect');
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
            configValues.developerMode = false;
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
        test('logged out + developerMode off + state disconnected → hidden', () => {
            configValues.developerMode = false;

            createService(false);
            mockStatusBarItem.show.resetHistory();
            mockStatusBarItem.hide.resetHistory();

            driveState('disconnected');

            assert.ok(
                mockStatusBarItem.hide.called,
                'Hidden when logged out and developerMode off'
            );
            assert.ok(
                !mockStatusBarItem.show.called,
                'Not shown when logged out and developerMode off'
            );
        });

        test('logged out + developerMode on + state disconnected → shown', () => {
            configValues.developerMode = true;

            createService(false);
            mockStatusBarItem.show.resetHistory();
            mockStatusBarItem.hide.resetHistory();

            driveState('disconnected');

            assert.ok(
                mockStatusBarItem.show.called,
                'Shown when logged out but developerMode on'
            );
        });

        test('logged out → logged in transition re-applies visibility (logged-in rules return)', () => {
            configValues.developerMode = false;

            const service = createService(false);
            driveState('disconnected');
            mockStatusBarItem.show.resetHistory();
            mockStatusBarItem.hide.resetHistory();

            // Transition: user logs in
            service.setAuthenticated(true);

            // With developerMode off + logged in + state disconnected → needs attention → show
            assert.ok(
                mockStatusBarItem.show.called,
                'After login, logged-in visibility rules must take over (disconnected → show)'
            );
        });

        test('logged in → logged out transition re-applies visibility (statusbar hides)', () => {
            configValues.developerMode = false;

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
            configValues.developerMode = false;

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
            configValues.developerMode = false;
            mockWsService.reconnectAttempts = 7;

            createService();
            driveState('reconnecting');

            assert.ok(
                mockStatusBarItem.text.includes('7/20'),
                `Expected "7/20" in reconnecting text, got: ${mockStatusBarItem.text}`
            );
        });
    });

    suite('normal mode labels', () => {
        test('normal mode connected shows "Artemis: connected"', () => {
            configValues.developerMode = false;
            createService();
            driveState('connected');
            assert.ok(
                mockStatusBarItem.text.includes('Artemis: connected'),
                `Expected "Artemis: connected", got: ${mockStatusBarItem.text}`
            );
        });

        test('normal mode disconnected shows "Artemis: offline"', () => {
            configValues.developerMode = false;
            createService();
            driveState('disconnected');
            assert.ok(
                mockStatusBarItem.text.includes('Artemis: offline'),
                `Expected "Artemis: offline", got: ${mockStatusBarItem.text}`
            );
        });

        test('normal mode reconnecting shows "Artemis: reconnecting (N/20)"', () => {
            configValues.developerMode = false;
            mockWsService.reconnectAttempts = 2;
            createService();
            driveState('reconnecting');
            assert.ok(
                mockStatusBarItem.text.includes('Artemis: reconnecting'),
                `Expected "Artemis: reconnecting", got: ${mockStatusBarItem.text}`
            );
            assert.ok(
                mockStatusBarItem.text.includes('2/20'),
                `Expected "2/20", got: ${mockStatusBarItem.text}`
            );
        });
    });
});
