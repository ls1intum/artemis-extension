import * as vscode from 'vscode';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../../shared/messageContracts';
import { WebviewMsgType } from '../../shared/messageContracts';
import { isWebviewMessage } from '../../shared/messageContracts/typeGuards';
import { logger, LogCategory } from '../services/loggingService';

/**
 * Shared base class for webview providers.
 * Encapsulates the ready-signal handshake (queuing messages until the
 * webview's React shell has signalled readiness) and common message
 * handling boilerplate (type-guard, error logging, ready/requestInit).
 */
export abstract class BaseWebviewProvider {
    protected _view?: vscode.WebviewView;
    protected readonly _disposables: vscode.Disposable[] = [];
    /**
     * Disposables tied to the current webview view resolution. Cleared on
     * every re-resolve so listeners registered in resolveWebviewView() do
     * not accumulate across view destroy/recreate cycles.
     */
    protected _viewDisposables: vscode.Disposable[] = [];

    constructor(protected readonly _logCategory: LogCategory = LogCategory.VIEW) {}

    /** Subclasses must implement to (re-)render the webview HTML. */
    public abstract render(): void | Promise<void>;

    /** Called when the webview signals ready or requests re-init. */
    protected abstract _onReady(): void;

    /** Called for command-type messages after boilerplate handling. */
    protected abstract _handleCommand(message: Extract<WebviewToExtensionMessage, { type: 'command' }>): void;

    /**
     * Synchronously return the current panel visibility. Returns false when
     * the view has not yet been resolved by VS Code.
     *
     * Used by session-recorder Startup-Contributors to seed a
     * `panelVisibility` event reflecting the view's state at session start,
     * even if the `onDidChangeVisibility` emitter has not fired yet this
     * session.
     */
    public getCurrentVisibility(): boolean {
        return this._view?.visible ?? false;
    }

    /** Re-render the webview to pick up theme / config changes. */
    public refreshTheme(): void {
        Promise.resolve(this.render()).catch((err: unknown) => {
            logger.error('Failed to refresh webview theme', this._logCategory, err);
        });
    }

    /** Dispose every item in `_disposables` and `_viewDisposables` (LIFO order). */
    protected _drainDisposables(): void {
        this._drainViewDisposables();
        while (this._disposables.length > 0) {
            const d = this._disposables.pop();
            d?.dispose();
        }
    }

    /** Dispose only the per-view-resolution disposables. */
    protected _drainViewDisposables(): void {
        while (this._viewDisposables.length > 0) {
            const d = this._viewDisposables.pop();
            d?.dispose();
        }
    }

    // Ready-signal handshake state
    private _webviewReady = false;
    private _pendingMessages: ExtensionToWebviewMessage[] = [];

    /** Mark the webview as ready and flush queued messages. */
    protected _markReady(): void {
        this._webviewReady = true;
        this._flushPendingMessages();
    }

    /** Reset ready state (e.g. before re-render or new webview). */
    protected _resetReadyState(): void {
        this._webviewReady = false;
        this._pendingMessages = [];
    }

    /** Hard cap on pending messages to prevent unbounded growth. */
    private static readonly MAX_PENDING = 200;

    /** Event-type messages that carry unique data per dispatch and must never be deduplicated. */
    private static readonly EVENT_TYPES: ReadonlySet<string> = new Set([
        'websocketUpdate',
        'addMessage',
    ]);

    /**
     * Safely post a message to the webview, queuing it if not ready yet.
     * Deduplicates by message type (keeps latest) and enforces a hard cap.
     * Event-type messages are always appended without deduplication.
     */
    protected _postMessageSafe(message: ExtensionToWebviewMessage): void {
        if (this._webviewReady && this._view) {
            this._view.webview.postMessage(message);
        } else {
            if (BaseWebviewProvider.EVENT_TYPES.has(message.type)) {
                // Event messages carry unique data — never deduplicate
                this._pendingMessages.push(message);
            } else {
                // Deduplicate: replace existing message with same type
                const idx = this._pendingMessages.findIndex(m => m.type === message.type);
                if (idx !== -1) {
                    this._pendingMessages[idx] = message;
                } else {
                    this._pendingMessages.push(message);
                }
            }

            // Safety net: drop oldest if over hard cap
            while (this._pendingMessages.length > BaseWebviewProvider.MAX_PENDING) {
                this._pendingMessages.shift();
            }
        }
    }

    /**
     * Common message handler: type-guard, error logging, ready/requestInit,
     * then delegates command messages to the subclass via `_handleCommand`.
     */
    protected _handleMessage(message: unknown): void {
        if (!isWebviewMessage(message)) {
            return;
        }

        const typedMessage = message as WebviewToExtensionMessage;

        if (typedMessage.type === WebviewMsgType.Error) {
            const errorPayload = typedMessage.payload;
            logger.error('Webview ErrorBoundary crash report', this._logCategory, {
                message: errorPayload?.message,
                stack: errorPayload?.stack,
                componentStack: errorPayload?.componentStack,
            });
            return;
        }

        if (typedMessage.type === WebviewMsgType.Ready) {
            this._markReady();
            this._onReady();
            return;
        }

        if (typedMessage.type === WebviewMsgType.RequestInit) {
            this._onReady();
            return;
        }

        if (typedMessage.type !== 'command') { return; }

        this._handleCommand(typedMessage);
    }

    private _flushPendingMessages(): void {
        if (!this._view) {
            return;
        }
        const pending = this._pendingMessages;
        this._pendingMessages = [];
        for (const msg of pending) {
            this._view.webview.postMessage(msg);
        }
    }
}
