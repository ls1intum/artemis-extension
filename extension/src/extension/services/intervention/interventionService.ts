// extension/src/extension/services/intervention/interventionService.ts
import * as vscode from 'vscode';

import type { SessionResettable, SessionStartContext } from '@extension/services/sessionLifecycle';
import type { AlertSink } from '@extension/services/struggle/alerting/alertSink';
import type { AlertRecord } from '@extension/services/struggle/types';

/**
 * Single-level struggle intervention (spec R4): one status-bar hint shown on a
 * v2 alert; clicking it opens the Iris chat. The engine's alert state machine
 * (cooldown 120 s, gates, hysteresis, E6 re-alert) governs frequency, so no
 * extra suppression/cadence logic lives here — that is exactly what makes the
 * v1 spam (idle/selection triggers + adaptive cadence) go away.
 *
 * Tier-ready: deliver() receives the full AlertRecord (V, path armed|e6,
 * boundary types). Escalation-over-persistence (path === 'e6') and richer UX
 * are future Ch7 work; this class deliberately stays single-level.
 *
 * Implements AlertSink (injected into StruggleCoordinator) and SessionResettable
 * (the coordinator resets it on a new exercise session).
 */
const HINT_COMMAND = 'iris.intervention.acceptSubtle';

export class InterventionService implements vscode.Disposable, AlertSink, SessionResettable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _statusBarItem: vscode.StatusBarItem;
    private _current: AlertRecord | undefined;

    private _ambientHint: string | undefined;
    private _ambientOpensChat = true;
    private _ambientVisible = false;

    private readonly _onDidDeliver = new vscode.EventEmitter<AlertRecord>();
    /** Fires on every delivered alert (recorder + debug UI subscribe). */
    readonly onDidDeliver = this._onDidDeliver.event;

    private readonly _onDidClick = new vscode.EventEmitter<void>();
    /** Fires when the user clicks the status-bar hint (ambient or legacy). */
    readonly onDidClick = this._onDidClick.event;

    constructor() {
        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this._statusBarItem.command = HINT_COMMAND;
        this._disposables.push(this._statusBarItem);
        this._disposables.push(
            vscode.commands.registerCommand(HINT_COMMAND, () => this.handleClick()),
        );
    }

    get isHintVisible(): boolean { return this._current !== undefined || this._ambientVisible; }

    /** AlertSink: deliver one alert as the single-level hint. */
    deliver(alert: AlertRecord): void {
        this._current = alert;
        this._statusBarItem.text = '$(lightbulb) Need help?';
        this._statusBarItem.tooltip = 'Iris noticed you might be stuck — click to open the chat.';
        // Warning (orange) background so the proactive nudge stands out instead of getting lost in the status bar.
        this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this._statusBarItem.show();
        this._onDidDeliver.fire(alert);
    }

    /**
     * Show the lamp with a hover hint. {@code opensChat=true} (server hint) -> click focuses the Iris chat;
     * {@code opensChat=false} (no-AI local template, spec §9) -> click shows the template, does NOT bounce to AI chat.
     */
    showAmbient(hint: string, opensChat: boolean): void {
        this._ambientHint = hint;
        this._ambientOpensChat = opensChat;
        this._ambientVisible = true;
        this._statusBarItem.text = '$(lightbulb) Need help?';
        this._statusBarItem.tooltip = hint || 'Iris noticed you might be stuck.';
        this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this._statusBarItem.show();
    }

    async handleClick(): Promise<void> {
        const hint = this._ambientHint;
        const opensChat = this._ambientOpensChat;
        this._onDidClick.fire();
        this._hide();
        if (opensChat) {
            await vscode.commands.executeCommand('iris.chatView.focus');
        } else if (hint) {
            void vscode.window.showInformationMessage(hint);
        }
    }

    onSessionStart(_context: SessionStartContext): void { this._hide(); }

    /** AlertSink.reset: clear the visible hint (session change / interventions disabled). */
    reset(): void { this._hide(); }

    private _hide(): void {
        this._current = undefined;
        this._ambientVisible = false;
        // Reset the ambient click behavior to the default so a later hint shown via the legacy `deliver`
        // path (which does not set these) cannot read a stale `opensChat=false`/hint from a prior ambient.
        this._ambientHint = undefined;
        this._ambientOpensChat = true;
        this._statusBarItem.backgroundColor = undefined;
        this._statusBarItem.hide();
    }

    dispose(): void {
        this._hide();
        while (this._disposables.length > 0) { this._disposables.pop()?.dispose(); }
        this._onDidDeliver.dispose();
        this._onDidClick.dispose();
    }
}
