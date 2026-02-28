import * as vscode from 'vscode';
import { ArtemisWebsocketService } from './artemisWebsocketService';
import { VSCODE_CONFIG } from '../utils';
import { logger } from './loggingService';

/**
 * WebSocket connection status enumeration
 */
enum WebSocketStatus {
    Connected = 'connected',
    Disconnected = 'disconnected',
    Reconnecting = 'reconnecting',
    Connecting = 'connecting',
    GaveUp = 'gaveup'
}

/**
 * Debug info interface matching ArtemisWebsocketService.getDebugInfoAsync() return type
 */
interface WebSocketDebugInfo {
    isConnected: boolean;
    isConnecting: boolean;
    isDisconnecting: boolean;
    wasConnectedOnce: boolean;
    connectionGaveUp: boolean;
    clientConnected: boolean;
    clientActive: boolean;
    subscriptionCount: number;
    subscriptions: string[];
    callbackCount: number;
    reconnectAttempts: number;
    maxReconnectAttempts: number;
    currentReconnectDelay: number;
    sessionId: string;
    serverUrl: string;
    websocketUrl: string;
    hasCookie: boolean;
    hasJwtToken: boolean;
    cookiePreview?: string;
}

/**
 * Service that manages a StatusBar item showing WebSocket connection status.
 *
 * Visibility rules:
 * - Override rule: ALWAYS shown when disconnected, gaveUp, or reconnecting
 * - Normal state: shown when `artemis.showWebSocketStatusBar` is true OR developer mode is on
 * - After reconnection with setting off: shown briefly (2s flash) then hidden
 *
 * This makes connection failures visible and actionable without cluttering the
 * status bar during normal healthy operation.
 */
export class WebSocketStatusBarService implements vscode.Disposable {
    private _statusBarItem: vscode.StatusBarItem;
    private _websocketService: ArtemisWebsocketService;
    private _disposables: vscode.Disposable[] = [];
    private _unsubscribeFromState?: () => void;
    private _currentStatus: WebSocketStatus = WebSocketStatus.Disconnected;
    private _lastError?: string;
    private _isDebugMode: boolean = false;
    private _showStatusBar: boolean = false;
    private _reconnectHideTimeout?: ReturnType<typeof setTimeout>;

    /**
     * Command ID for the StatusBar item click action
     */
    public static readonly COMMAND_ID = 'artemis.websocketStatusBarAction';

    constructor(websocketService: ArtemisWebsocketService) {
        this._websocketService = websocketService;

        // Create StatusBar item (right-aligned, priority 100)
        this._statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this._statusBarItem.command = WebSocketStatusBarService.COMMAND_ID;

        // Register command handler
        this._disposables.push(
            vscode.commands.registerCommand(
                WebSocketStatusBarService.COMMAND_ID,
                () => this._showQuickPick()
            )
        );

        // Check initial visibility settings
        this._updateVisibilitySettings();

        // Listen for configuration changes (developerMode or showWebSocketStatusBar)
        this._disposables.push(
            vscode.workspace.onDidChangeConfiguration(event => {
                if (
                    event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.DEVELOPER_MODE_KEY}`) ||
                    event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.SHOW_WEBSOCKET_STATUS_BAR_KEY}`)
                ) {
                    this._log('Visibility configuration changed');
                    this._updateVisibilitySettings();
                }
            })
        );

        // Subscribe to connection state changes
        this._unsubscribeFromState = this._websocketService.onConnectionStateChange(
            (isConnected, wasEverConnected) => {
                this._updateStatus(isConnected, wasEverConnected);
            }
        );

        // Initial status update
        this._updateStatusFromService();
    }

    /**
     * Check and update visibility settings from configuration.
     * Reads both developerMode (for debug-level tooltip info) and
     * showWebSocketStatusBar (for user-controlled normal-state visibility).
     */
    private _updateVisibilitySettings(): void {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        this._isDebugMode = config.get<boolean>(VSCODE_CONFIG.DEVELOPER_MODE_KEY, false);
        this._showStatusBar = config.get<boolean>(VSCODE_CONFIG.SHOW_WEBSOCKET_STATUS_BAR_KEY, false);

        this._log(`Developer mode: ${this._isDebugMode}, showStatusBar: ${this._showStatusBar}`);

        // Re-apply current visibility based on updated settings
        this._applyVisibility();
    }

    /**
     * Update status from WebSocket service state
     */
    private _updateStatusFromService(): void {
        const isConnected = this._websocketService.isConnected();
        const hasGivenUp = this._websocketService.hasGivenUp();

        if (hasGivenUp) {
            this._currentStatus = WebSocketStatus.GaveUp;
        } else if (isConnected) {
            this._currentStatus = WebSocketStatus.Connected;
        } else {
            this._currentStatus = WebSocketStatus.Disconnected;
        }

        this._updateStatusBarItem();
    }

    /**
     * Update status based on connection state callback
     */
    private _updateStatus(isConnected: boolean, wasEverConnected?: boolean): void {
        const hasGivenUp = this._websocketService.hasGivenUp();
        const previousStatus = this._currentStatus;

        if (hasGivenUp) {
            this._currentStatus = WebSocketStatus.GaveUp;
        } else if (isConnected) {
            this._currentStatus = WebSocketStatus.Connected;
            this._lastError = undefined; // Clear error on successful connection
        } else if (wasEverConnected) {
            // Was connected before, now trying to reconnect
            this._currentStatus = WebSocketStatus.Reconnecting;
        } else {
            this._currentStatus = WebSocketStatus.Disconnected;
        }

        // Handle the reconnect flash: when transitioning FROM Reconnecting TO connected
        // and the user setting is off, schedule a 2-second hide.
        // Only applies when coming from Reconnecting state (not initial connect from Disconnected).
        if (isConnected && !hasGivenUp && !this._showStatusBar && !this._isDebugMode) {
            if (previousStatus === WebSocketStatus.Reconnecting) {
                // Clear any existing timeout to avoid stacking
                if (this._reconnectHideTimeout) {
                    clearTimeout(this._reconnectHideTimeout);
                }
                this._reconnectHideTimeout = setTimeout(() => {
                    this._reconnectHideTimeout = undefined;
                    this._statusBarItem.hide();
                }, 2000);
            }
        }

        this._updateStatusBarItem();
    }

    /**
     * Apply the visibility rule based on current status and settings.
     *
     * Override rule: disconnected/reconnecting/gaveUp states ALWAYS show, regardless of settings.
     * Normal state: only show when showStatusBar or isDebugMode is true.
     * Reconnect flash: if a hide timeout is pending (2s after reconnect), keep showing.
     */
    private _applyVisibility(): void {
        const isDisconnected =
            this._currentStatus === WebSocketStatus.Disconnected ||
            this._currentStatus === WebSocketStatus.GaveUp;
        const isReconnecting = this._currentStatus === WebSocketStatus.Reconnecting;

        if (isDisconnected || isReconnecting) {
            // Override rule: ALWAYS show
            this._statusBarItem.show();
        } else if (this._showStatusBar || this._isDebugMode) {
            this._statusBarItem.show();
        } else if (this._reconnectHideTimeout) {
            // Reconnect flash in progress: keep showing until the timeout fires
            this._statusBarItem.show();
        } else {
            this._statusBarItem.hide();
        }
    }

    /**
     * Update the StatusBar item appearance based on current status
     */
    private _updateStatusBarItem(): void {
        // Apply override/visibility rule first
        this._applyVisibility();

        let icon: string;
        let text: string;
        let backgroundColor: vscode.ThemeColor | undefined;

        switch (this._currentStatus) {
            case WebSocketStatus.Connected:
                icon = '$(plug)';
                text = 'WS Connected';
                backgroundColor = undefined;
                break;
            case WebSocketStatus.Reconnecting: {
                const attempts = this._websocketService.reconnectAttempts;
                icon = '$(sync~spin)';
                text = `Reconnecting (${attempts}/20)...`;
                backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
            }
            case WebSocketStatus.Connecting:
                icon = '$(sync~spin)';
                text = 'WS Connecting...';
                backgroundColor = undefined;
                break;
            case WebSocketStatus.GaveUp:
                icon = '$(debug-disconnect)';
                text = 'WS Disconnected';
                backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
            case WebSocketStatus.Disconnected:
            default:
                icon = '$(debug-disconnect)';
                text = 'WS Disconnected';
                backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
        }

        this._statusBarItem.text = `${icon} ${text}`;
        this._statusBarItem.backgroundColor = backgroundColor;

        // Update tooltip with detailed info (async, non-blocking)
        void this._updateTooltip();
    }

    /**
     * Update the StatusBar item tooltip with detailed WebSocket info
     */
    private async _updateTooltip(): Promise<void> {
        try {
            const debugInfo = await this._websocketService.getDebugInfoAsync();
            const tooltip = this._buildTooltipMarkdown(debugInfo);
            this._statusBarItem.tooltip = tooltip;
        } catch (error) {
            this._statusBarItem.tooltip = new vscode.MarkdownString('WebSocket Debug Info\n\n*Error loading details*');
        }
    }

    /**
     * Build a MarkdownString tooltip with detailed connection info
     */
    private _buildTooltipMarkdown(info: WebSocketDebugInfo): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.supportHtml = true;

        // Connection Status
        const statusIcon = info.isConnected ? '✅' : info.connectionGaveUp ? '⛔' : '❌';
        const statusText = info.isConnected ? 'Connected' : info.connectionGaveUp ? 'Gave Up' : 'Disconnected';

        md.appendMarkdown(`## WebSocket Status\n\n`);
        md.appendMarkdown(`**Status:** ${statusIcon} ${statusText}\n\n`);

        if (this._isDebugMode) {
            // Full debug info in developer mode
            md.appendMarkdown(`---\n\n`);
            md.appendMarkdown(`**Connection Details:**\n`);
            md.appendMarkdown(`- Client Active: ${info.clientActive ? 'Yes' : 'No'}\n`);
            md.appendMarkdown(`- Client Connected: ${info.clientConnected ? 'Yes' : 'No'}\n`);
            md.appendMarkdown(`- Was Ever Connected: ${info.wasConnectedOnce ? 'Yes' : 'No'}\n\n`);

            md.appendMarkdown(`**Reconnection:**\n`);
            md.appendMarkdown(`- Attempts: \`${info.reconnectAttempts}/${info.maxReconnectAttempts}\`\n`);
            md.appendMarkdown(`- Current Delay: \`${info.currentReconnectDelay}ms\`\n`);
            md.appendMarkdown(`- Gave Up: ${info.connectionGaveUp ? 'Yes ⛔' : 'No'}\n\n`);

            md.appendMarkdown(`**Subscriptions:** (${info.subscriptionCount})\n`);
            if (info.subscriptions.length > 0) {
                info.subscriptions.forEach(sub => {
                    md.appendMarkdown(`- \`${sub}\`\n`);
                });
            } else {
                md.appendMarkdown(`- *None*\n`);
            }
            md.appendMarkdown(`\n`);

            md.appendMarkdown(`**Session:**\n`);
            md.appendMarkdown(`- Session ID: \`${info.sessionId}\`\n`);
            md.appendMarkdown(`- Callbacks: ${info.callbackCount}\n\n`);

            md.appendMarkdown(`**Server:**\n`);
            md.appendMarkdown(`- URL: \`${info.serverUrl}\`\n`);
            md.appendMarkdown(`- WebSocket: \`${info.websocketUrl}\`\n\n`);

            md.appendMarkdown(`**Authentication:**\n`);
            md.appendMarkdown(`- Has Cookie: ${info.hasCookie ? 'Yes ✅' : 'No ❌'}\n`);
            md.appendMarkdown(`- Has JWT: ${info.hasJwtToken ? 'Yes ✅' : 'No ❌'}\n`);
            if (info.cookiePreview) {
                md.appendMarkdown(`- Cookie: \`${info.cookiePreview}\`\n`);
            }
        }

        if (this._lastError) {
            md.appendMarkdown(`\n**Last Error:**\n`);
            md.appendMarkdown(`\`${this._lastError}\`\n`);
        }

        md.appendMarkdown(`\n---\n*Click to open actions menu*`);

        return md;
    }

    /**
     * Show Quick Pick menu with WebSocket actions
     */
    private async _showQuickPick(): Promise<void> {
        const isConnected = this._websocketService.isConnected();
        const hasGivenUp = this._websocketService.hasGivenUp();

        interface ActionItem extends vscode.QuickPickItem {
            action: 'reconnect' | 'disconnect' | 'reset' | 'showDebug' | 'copyDebug';
        }

        const items: ActionItem[] = [];

        // Context-aware actions
        if (!isConnected) {
            items.push({
                label: '$(plug) Reconnect',
                description: 'Attempt to reconnect to WebSocket',
                action: 'reconnect'
            });
        }

        if (isConnected) {
            items.push({
                label: '$(debug-disconnect) Disconnect',
                description: 'Disconnect from WebSocket',
                action: 'disconnect'
            });
        }

        if (hasGivenUp || !isConnected) {
            items.push({
                label: '$(refresh) Reset & Reconnect',
                description: 'Reset connection state and reconnect',
                action: 'reset'
            });
        }

        // Always available actions
        items.push(
            {
                label: '$(file-text) Show Full Debug Info',
                description: 'Open detailed debug info in a new document',
                action: 'showDebug'
            },
            {
                label: '$(clippy) Copy Debug Info',
                description: 'Copy debug info to clipboard',
                action: 'copyDebug'
            }
        );

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'WebSocket Actions',
            title: 'WebSocket Actions'
        });

        if (!selected) {
            return;
        }

        await this._executeAction(selected.action);
    }

    /**
     * Execute the selected action
     */
    private async _executeAction(action: string): Promise<void> {
        try {
            switch (action) {
                case 'reconnect':
                    await this._handleReconnect();
                    break;
                case 'disconnect':
                    await this._handleDisconnect();
                    break;
                case 'reset':
                    await this._handleResetAndReconnect();
                    break;
                case 'showDebug':
                    await this._showFullDebugInfo();
                    break;
                case 'copyDebug':
                    await this._copyDebugInfo();
                    break;
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            this._lastError = errorMsg;
            vscode.window.showErrorMessage(`WebSocket action failed: ${errorMsg}`);
            this._updateStatusBarItem();
        }
    }

    /**
     * Handle reconnect action
     */
    private async _handleReconnect(): Promise<void> {
        this._currentStatus = WebSocketStatus.Connecting;
        this._updateStatusBarItem();

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Connecting to WebSocket...',
            cancellable: false
        }, async () => {
            await this._websocketService.connect();
        });

        this._updateStatusFromService();

        if (this._websocketService.isConnected()) {
            vscode.window.showInformationMessage('WebSocket connected');
        }
    }

    /**
     * Handle disconnect action
     */
    private async _handleDisconnect(): Promise<void> {
        await this._websocketService.disconnect();
        this._currentStatus = WebSocketStatus.Disconnected;
        this._updateStatusBarItem();
        vscode.window.showInformationMessage('WebSocket disconnected');
    }

    /**
     * Handle reset and reconnect action
     */
    private async _handleResetAndReconnect(): Promise<void> {
        this._websocketService.resetConnectionState();
        this._lastError = undefined;

        this._currentStatus = WebSocketStatus.Connecting;
        this._updateStatusBarItem();

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Resetting and reconnecting to WebSocket...',
            cancellable: false
        }, async () => {
            await this._websocketService.connect();
        });

        this._updateStatusFromService();

        if (this._websocketService.isConnected()) {
            vscode.window.showInformationMessage('WebSocket reset and connected');
        }
    }

    /**
     * Show full debug info in a new document
     */
    private async _showFullDebugInfo(): Promise<void> {
        const debugInfo = await this._websocketService.getDebugInfoAsync();
        const content = this._formatDebugInfoAsText(debugInfo);

        const doc = await vscode.workspace.openTextDocument({
            content,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc, { preview: true });
    }

    /**
     * Copy debug info to clipboard
     */
    private async _copyDebugInfo(): Promise<void> {
        const debugInfo = await this._websocketService.getDebugInfoAsync();
        const content = this._formatDebugInfoAsText(debugInfo);

        await vscode.env.clipboard.writeText(content);
        vscode.window.showInformationMessage('WebSocket debug info copied to clipboard');
    }

    /**
     * Format debug info as plain text/markdown
     */
    private _formatDebugInfoAsText(info: WebSocketDebugInfo): string {
        const statusIcon = info.isConnected ? '🟢' : info.connectionGaveUp ? '⛔' : '🔴';
        const timestamp = new Date().toISOString();

        const lines = [
            `# WebSocket Debug Info`,
            ``,
            `**Generated:** ${timestamp}`,
            ``,
            `## Connection Status`,
            ``,
            `| Property | Value |`,
            `|----------|-------|`,
            `| Status | ${statusIcon} ${info.isConnected ? 'Connected' : info.connectionGaveUp ? 'Gave Up' : 'Disconnected'} |`,
            `| Client Active | ${info.clientActive ? 'Yes ✅' : 'No ❌'} |`,
            `| Client Connected | ${info.clientConnected ? 'Yes ✅' : 'No ❌'} |`,
            `| Is Connecting | ${info.isConnecting ? 'Yes' : 'No'} |`,
            `| Is Disconnecting | ${info.isDisconnecting ? 'Yes' : 'No'} |`,
            `| Was Connected Once | ${info.wasConnectedOnce ? 'Yes' : 'No'} |`,
            ``,
            `## Reconnection`,
            ``,
            `| Property | Value |`,
            `|----------|-------|`,
            `| Attempts | ${info.reconnectAttempts}/${info.maxReconnectAttempts} |`,
            `| Current Delay | ${info.currentReconnectDelay}ms |`,
            `| Gave Up | ${info.connectionGaveUp ? 'Yes ⛔' : 'No'} |`,
            ``,
            `## Subscriptions (${info.subscriptionCount})`,
            ``,
        ];

        if (info.subscriptions.length > 0) {
            info.subscriptions.forEach(sub => {
                lines.push(`- \`${sub}\``);
            });
        } else {
            lines.push(`*No active subscriptions*`);
        }

        lines.push(
            ``,
            `## Session & Server`,
            ``,
            `| Property | Value |`,
            `|----------|-------|`,
            `| Session ID | \`${info.sessionId}\` |`,
            `| Callbacks | ${info.callbackCount} |`,
            `| Server URL | ${info.serverUrl} |`,
            `| WebSocket URL | ${info.websocketUrl} |`,
            ``,
            `## Authentication`,
            ``,
            `| Property | Value |`,
            `|----------|-------|`,
            `| Has Cookie | ${info.hasCookie ? 'Yes ✅' : 'No ❌'} |`,
            `| Has JWT Token | ${info.hasJwtToken ? 'Yes ✅' : 'No ❌'} |`,
        );

        if (info.cookiePreview) {
            lines.push(`| Cookie Preview | \`${info.cookiePreview}\` |`);
        }

        if (this._lastError) {
            lines.push(
                ``,
                `## Last Error`,
                ``,
                `\`\`\``,
                this._lastError,
                `\`\`\``
            );
        }

        return lines.join('\n');
    }

    /**
     * Log helper
     */
    private _log(message: string): void {
        logger.websocket(`[StatusBar] ${message}`);
    }

    /**
     * Dispose all resources
     */
    public dispose(): void {
        this._log('Disposing WebSocket StatusBar service');

        // Clear reconnect hide timeout
        if (this._reconnectHideTimeout) {
            clearTimeout(this._reconnectHideTimeout);
            this._reconnectHideTimeout = undefined;
        }

        // Unsubscribe from connection state changes
        if (this._unsubscribeFromState) {
            this._unsubscribeFromState();
            this._unsubscribeFromState = undefined;
        }

        // Dispose StatusBar item
        this._statusBarItem.dispose();

        // Dispose all other disposables
        this._disposables.forEach(d => {
            void d.dispose();
        });
        this._disposables = [];
    }
}
