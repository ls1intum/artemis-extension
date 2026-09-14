import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage } from '@shared/messageContracts';

import { LogCategory, logger } from '@extension/services/loggingService';

export type WebviewSink = (msg: ExtensionToWebviewMessage) => void;

/**
 * Fans a single extension->webview message out to every live transport: the
 * sidebar sender plus each open fullscreen panel. This is what keeps the two
 * (independent) webviews in sync for global push signals (proactive-consent,
 * .noai, the server-rendered problem statement) instead of each producer
 * hand-wiring the sidebar only and every panel re-subscribing on its own.
 *
 * Kept intentionally minimal: a plain `Set<Sink>` with per-sink exception
 * isolation. No dev-mode gating, buffering, backfill, or refcounts — those are
 * feature concerns that belong to `LiveEngineFeed`, not the generic push path.
 * Registration is idempotent (Set) and each `addSink` hands back a `Disposable`
 * so callers remove exactly what they added on webview/panel disposal.
 */
export class WebviewBroadcaster implements vscode.Disposable {
    private readonly _sinks = new Set<WebviewSink>();

    /** Register a transport. Returns a disposable that unregisters it. */
    addSink(sink: WebviewSink): vscode.Disposable {
        this._sinks.add(sink);
        return new vscode.Disposable(() => { this._sinks.delete(sink); });
    }

    /** Deliver `msg` to every registered transport; one failing sink never blocks the rest. */
    broadcast(msg: ExtensionToWebviewMessage): void {
        for (const sink of this._sinks) {
            try {
                sink(msg);
            } catch (err) {
                logger.warn(`Webview broadcast to a sink failed: ${err}`, LogCategory.VIEW);
            }
        }
    }

    dispose(): void {
        this._sinks.clear();
    }
}
