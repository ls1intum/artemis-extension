import * as vscode from 'vscode';

import type { WebSocketDisplayStatus } from '@shared/messageContracts';

import { VSCODE_CONFIG } from '@extension/utils';

import { LogCategory, logger } from '../loggingService';
import { ArtemisWebsocketService } from './artemisWebsocketService';

/**
 * StatusBar item showing WebSocket connection status.
 *
 * Visibility rules:
 * - When logged out: hidden unless `artemis.showWebSocketStatusBar` is true
 *   (no WebSocket exists, so the default "needs attention on disconnect" rule
 *   would surface a misleading red error indicator)
 * - When logged in:
 *   - ALWAYS shown when disconnected or reconnecting
 *   - Otherwise shown only when `artemis.showWebSocketStatusBar` is true
 *   - After reconnection with setting off: 2s flash then hidden
 *
 * Auth state is supplied externally via {@link setAuthenticated}; the service
 * does not own auth lifecycle.
 *
 * Click action: always reconnect (reset + connect). No-op while connecting.
 */
export class WebSocketStatusBarService implements vscode.Disposable {
    private readonly _statusBarItem: vscode.StatusBarItem;
    private readonly _websocketService: ArtemisWebsocketService;
    private readonly _disposables: vscode.Disposable[] = [];
    private _stateSubscription?: vscode.Disposable;
    private _currentStatus: WebSocketDisplayStatus = 'disconnected';
    private _showStatusBar = false;
    private _isAuthenticated = false;
    private _reconnectHideTimeout?: ReturnType<typeof setTimeout>;

    public static readonly COMMAND_ID = 'artemis.websocketStatusBarAction';

    constructor(websocketService: ArtemisWebsocketService) {
        this._websocketService = websocketService;

        this._statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this._statusBarItem.command = WebSocketStatusBarService.COMMAND_ID;

        this._disposables.push(
            vscode.commands.registerCommand(
                WebSocketStatusBarService.COMMAND_ID,
                () => this._handleClick()
            )
        );

        this._updateVisibilitySetting();

        this._disposables.push(
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.SHOW_WEBSOCKET_STATUS_BAR_KEY}`)) {
                    this._updateVisibilitySetting();
                }
            })
        );

        this._stateSubscription = this._websocketService.onDidChangeConnectionState(
            () => this._refreshStatus()
        );

        this._refreshStatus();
    }

    private _updateVisibilitySetting(): void {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        this._showStatusBar = config.get<boolean>(VSCODE_CONFIG.SHOW_WEBSOCKET_STATUS_BAR_KEY, false);
        this._applyVisibility();
    }

    private _refreshStatus(): void {
        const previousStatus = this._currentStatus;
        this._currentStatus = this._websocketService.getDisplayStatus();

        if (
            this._currentStatus === 'connected'
            && previousStatus === 'reconnecting'
            && !this._showStatusBar
        ) {
            if (this._reconnectHideTimeout) {
                clearTimeout(this._reconnectHideTimeout);
            }
            this._reconnectHideTimeout = setTimeout(() => {
                this._reconnectHideTimeout = undefined;
                this._applyVisibility();
            }, 2000);
        }

        this._updateStatusBarItem();
    }

    /**
     * Sync authentication state. When toggled, re-applies visibility so the
     * status bar can hide on logout (no WebSocket exists) and re-evaluate on
     * login. Idempotent — no-op when the value matches the current state.
     */
    public setAuthenticated(value: boolean): void {
        if (this._isAuthenticated === value) {
            return;
        }
        this._isAuthenticated = value;
        this._applyVisibility();
    }

    private _applyVisibility(): void {
        // Logged out: there is no WebSocket to surface a state for. Honor the
        // explicit "always show" setting for diagnostics, otherwise hide.
        if (!this._isAuthenticated) {
            if (this._showStatusBar) {
                this._statusBarItem.show();
            } else {
                this._statusBarItem.hide();
            }
            return;
        }

        const needsAttention =
            this._currentStatus === 'disconnected'
            || this._currentStatus === 'reconnecting';

        if (needsAttention) {
            this._statusBarItem.show();
        } else if (this._showStatusBar) {
            this._statusBarItem.show();
        } else if (this._reconnectHideTimeout) {
            this._statusBarItem.show();
        } else {
            this._statusBarItem.hide();
        }
    }

    private _updateStatusBarItem(): void {
        this._applyVisibility();

        switch (this._currentStatus) {
            case 'connected':
                this._statusBarItem.text = '$(plug) WS Connected';
                this._statusBarItem.tooltip = 'WebSocket connected. Click to reconnect.';
                this._statusBarItem.backgroundColor = undefined;
                break;
            case 'reconnecting': {
                const attempts = this._websocketService.reconnectAttempts;
                this._statusBarItem.text = `$(sync~spin) Reconnecting (${attempts}/20)...`;
                this._statusBarItem.tooltip = 'WebSocket reconnecting...';
                this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
            }
            case 'connecting':
                this._statusBarItem.text = '$(sync~spin) WS Connecting...';
                this._statusBarItem.tooltip = 'WebSocket connecting...';
                this._statusBarItem.backgroundColor = undefined;
                break;
            case 'disconnected':
            default:
                this._statusBarItem.text = '$(debug-disconnect) WS Disconnected';
                this._statusBarItem.tooltip = 'WebSocket disconnected. Click to reconnect.';
                this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
        }
    }

    private _clickInFlight = false;

    private async _handleClick(): Promise<void> {
        const liveStatus = this._websocketService.getDisplayStatus();
        if (liveStatus === 'connecting' || liveStatus === 'reconnecting') {
            return;
        }
        if (this._clickInFlight) {
            return;
        }
        this._clickInFlight = true;
        try {
            this._websocketService.resetConnectionState();
            await this._websocketService.connect();
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            logger.error('WebSocket status bar action failed', LogCategory.WEBSOCKET, error);
            vscode.window.showErrorMessage(`WebSocket reconnect failed: ${msg}`);
        } finally {
            this._clickInFlight = false;
            this._refreshStatus();
        }
    }

    public dispose(): void {
        if (this._reconnectHideTimeout) {
            clearTimeout(this._reconnectHideTimeout);
            this._reconnectHideTimeout = undefined;
        }
        if (this._stateSubscription) {
            this._stateSubscription.dispose();
            this._stateSubscription = undefined;
        }
        this._statusBarItem.dispose();
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables.length = 0;
    }
}
