import * as vscode from 'vscode';

import type { WebSocketDisplayStatus } from '@shared/messageContracts';

import { LogCategory, logger } from '@extension/services/loggingService';
import { VSCODE_CONFIG } from '@extension/utils';

import { ArtemisWebsocketService } from './artemisWebsocketService';

/**
 * StatusBar item showing WebSocket connection status.
 *
 * Visibility rules:
 * - developerMode ON: always shown for diagnostics (any state, including
 *   connected and while logged out).
 * - developerMode OFF:
 *   - shown when disconnected or reconnecting (a problem the user can act on)
 *   - 2s flash after a successful reconnect, then hidden
 *   - otherwise hidden (incl. logged out)
 *
 * Auth state is supplied externally via {@link setAuthenticated}.
 * Click action: reset + reconnect. No-op while connecting/reconnecting.
 */
export class WebSocketStatusBarService implements vscode.Disposable {
    private readonly _statusBarItem: vscode.StatusBarItem;
    private readonly _websocketService: ArtemisWebsocketService;
    private readonly _disposables: vscode.Disposable[] = [];
    private _stateSubscription?: vscode.Disposable;
    private _currentStatus: WebSocketDisplayStatus = 'disconnected';
    private _isDevMode = false;
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
                if (event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.DEVELOPER_MODE_KEY}`)) {
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
        this._isDevMode = config.get<boolean>(VSCODE_CONFIG.DEVELOPER_MODE_KEY, false);
        this._updateStatusBarItem();
    }

    private _refreshStatus(): void {
        const previousStatus = this._currentStatus;
        this._currentStatus = this._websocketService.getDisplayStatus();

        if (
            this._currentStatus === 'connected'
            && previousStatus === 'reconnecting'
            && !this._isDevMode
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
     * login. Idempotent: a value matching the current state is a no-op.
     */
    public setAuthenticated(value: boolean): void {
        if (this._isAuthenticated === value) {
            return;
        }
        this._isAuthenticated = value;
        this._applyVisibility();
    }

    private _applyVisibility(): void {
        if (!this._isAuthenticated) {
            if (this._isDevMode) {
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
        } else if (this._isDevMode) {
            this._statusBarItem.show();
        } else if (this._reconnectHideTimeout) {
            this._statusBarItem.show();
        } else {
            this._statusBarItem.hide();
        }
    }

    private _updateStatusBarItem(): void {
        this._applyVisibility();

        const attempts = this._websocketService.reconnectAttempts;

        switch (this._currentStatus) {
            case 'connected':
                this._statusBarItem.text = this._isDevMode
                    ? '$(plug) WS Connected'
                    : '$(plug) Artemis: connected';
                this._statusBarItem.backgroundColor = undefined;
                break;
            case 'reconnecting':
                this._statusBarItem.text = this._isDevMode
                    ? `$(sync~spin) WS Reconnecting (${attempts}/20)...`
                    : `$(sync~spin) Artemis: reconnecting (${attempts}/20)...`;
                this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
            case 'connecting':
                this._statusBarItem.text = this._isDevMode
                    ? '$(sync~spin) WS Connecting...'
                    : '$(sync~spin) Artemis: connecting...';
                this._statusBarItem.backgroundColor = undefined;
                break;
            case 'disconnected':
            default:
                this._statusBarItem.text = this._isDevMode
                    ? '$(debug-disconnect) WS Disconnected'
                    : '$(debug-disconnect) Artemis: offline';
                this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
        }

        this._statusBarItem.tooltip = this._buildTooltip();
    }

    private _buildTooltip(): string | vscode.MarkdownString {
        if (this._isDevMode) {
            return this._buildDevTooltip();
        }
        switch (this._currentStatus) {
            case 'reconnecting': {
                const md = new vscode.MarkdownString();
                const attempts = this._websocketService.reconnectAttempts;
                md.appendMarkdown(
                    `**Reconnecting to Artemis... (${attempts}/20)**\n\n`
                    + `Live updates are paused and will resume automatically.`
                );
                return md;
            }
            case 'disconnected': {
                const md = new vscode.MarkdownString();
                md.appendMarkdown(
                    `**Connection to Artemis lost**\n\n`
                    + `Live updates (build results, submission status, Iris) are paused.\n\n`
                    + `Click to reconnect. If it keeps failing, check your internet connection or sign in again.`
                );
                return md;
            }
            case 'connecting':
                return 'Connecting to Artemis...';
            case 'connected':
            default:
                return 'Connected to Artemis. Click to reconnect.';
        }
    }

    private _buildDevTooltip(): vscode.MarkdownString {
        const d = this._websocketService.getDiagnostics();
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`## WebSocket (dev)\n\n`);
        md.appendMarkdown(`**Status:** ${this._currentStatus}\n\n`);
        md.appendMarkdown(`**Connection:**\n`);
        md.appendMarkdown(`- clientConnected: ${d.clientConnected}\n`);
        md.appendMarkdown(`- clientActive: ${d.clientActive}\n`);
        md.appendMarkdown(`- reconnect: ${d.reconnectAttempts}/${d.maxReconnectAttempts}\n\n`);
        md.appendMarkdown(`**Subscriptions (${d.subscriptionCount}):**\n`);
        if (d.subscriptions.length > 0) {
            d.subscriptions.forEach(s => md.appendMarkdown(`- \`${s}\`\n`));
        } else {
            md.appendMarkdown(`- *none*\n`);
        }
        md.appendMarkdown(`\n**Session:** \`${d.sessionId}\`\n\n`);
        md.appendMarkdown(`**Server:** \`${d.serverUrl}\`\n\n`);
        md.appendMarkdown(`**WebSocket:** \`${d.websocketUrl}\`\n`);
        return md;
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
