// extension/src/extension/services/intervention/interventionService.ts
import * as vscode from 'vscode';

import type { SessionResettable, SessionStartContext } from '@extension/services/sessionLifecycle';
import type { AlertSink } from '@extension/services/struggle/alerting/alertSink';
import type { AlertRecord } from '@extension/services/struggle/types';

/**
 * Single-level struggle intervention (spec R4): one status-bar hint shown on an
 * alert; clicking it opens the Iris chat. The engine's alert state machine
 * (cooldown 120 s, gates, hysteresis, E6 re-alert) governs DETECTION frequency,
 * and a Tier-2 ThrottledAlertSink decorator (WS4) shapes DELIVERY frequency
 * upstream of this class; this class itself adds no cadence logic — that is
 * exactly what makes the v1 spam (idle/selection triggers + adaptive cadence) go
 * away.
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

    private readonly _onDidDeliver = new vscode.EventEmitter<AlertRecord>();
    /** Fires on every delivered alert (recorder + debug UI subscribe). */
    readonly onDidDeliver = this._onDidDeliver.event;

    constructor() {
        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this._statusBarItem.command = HINT_COMMAND;
        this._disposables.push(this._statusBarItem);
        this._disposables.push(
            vscode.commands.registerCommand(HINT_COMMAND, () => this.handleClick()),
        );
    }

    get isHintVisible(): boolean { return this._current !== undefined; }

    /** AlertSink: deliver one alert as the single-level hint. */
    deliver(alert: AlertRecord): void {
        this._current = alert;
        this._statusBarItem.text = '$(lightbulb) Need help?';
        this._statusBarItem.tooltip = 'Iris noticed you might be stuck — click to open the chat.';
        this._statusBarItem.show();
        this._onDidDeliver.fire(alert);
    }

    async handleClick(): Promise<void> {
        this._hide();
        await vscode.commands.executeCommand('iris.chatView.focus');
    }

    onSessionStart(_context: SessionStartContext): void { this._hide(); }

    /** AlertSink.reset: clear the visible hint (session change / interventions disabled). */
    reset(): void { this._hide(); }

    private _hide(): void {
        this._current = undefined;
        this._statusBarItem.hide();
    }

    dispose(): void {
        this._hide();
        while (this._disposables.length > 0) { this._disposables.pop()?.dispose(); }
        this._onDidDeliver.dispose();
    }
}
