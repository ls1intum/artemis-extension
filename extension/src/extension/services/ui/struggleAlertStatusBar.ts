import * as vscode from 'vscode';

import type { TickRecord } from '@extension/services/struggle/types';
import type { IStruggleCoordinator } from '@extension/telemetry/contract';

import { type AlertBarState, computeAlertBarState } from './struggleAlertBarState';

/** Human label per suppressing-gate reason, for the "gated: X" text. */
const GATE_LABEL: Record<string, string> = {
    'b2-fluent-typing': 'fluent typing',
    'b4-grace-filter': 'grace window',
    'd1-warmup': 'warm-up',
    'cooldown': 'cooldown',
    'not-rearmed': 're-arm',
};

/**
 * Developer-only status bar item that surfaces the struggle engine's live alert
 * decision each tick:
 *  - firing: a real alert is going out (the student would be nudged),
 *  - gated:  the engine WOULD fire (urgency over θ at a trigger moment) but a gate
 *            holds it back,
 *  - armed:  monitoring (shows the current urgency).
 *
 * Visible only in developer mode while a session is active. It reflects the
 * engine's RAW decision (before the Tier-2 delivery throttle), so "gated" / "would
 * fire" is exactly what the engine intended. Clean build: the no-op coordinator
 * never ticks or alerts, so this surfaces nothing there.
 */
export class StruggleAlertStatusBar implements vscode.Disposable {
    public static readonly COMMAND_ID = 'artemis.struggleStatusBarAction';

    private readonly _item: vscode.StatusBarItem;
    private readonly _disposables: vscode.Disposable[] = [];
    private _sessionActive = false;
    private _lastTick: TickRecord | undefined;

    constructor(
        coordinator: IStruggleCoordinator,
        private readonly _isDeveloperMode: () => boolean,
        /** Reveal the panel + open the live-engine view (clicked from the bar). */
        private readonly _onActivate: () => void,
    ) {
        this._item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        this._item.command = StruggleAlertStatusBar.COMMAND_ID;
        this._disposables.push(
            this._item,
            vscode.commands.registerCommand(StruggleAlertStatusBar.COMMAND_ID, () => this._onActivate()),
            coordinator.onDidStartSession(() => { this._sessionActive = true; this._lastTick = undefined; this._render(); }),
            coordinator.onDidEndSession(() => { this._sessionActive = false; this._render(); }),
            coordinator.onDidTick(tick => { this._lastTick = tick; this._render(); }),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('artemis.developerMode')) { this._render(); }
            }),
        );
        this._render();
    }

    private _render(): void {
        if (!this._isDeveloperMode() || !this._sessionActive) {
            this._item.hide();
            return;
        }
        if (!this._lastTick) {
            this._item.text = '$(pulse) Struggle: armed';
            this._item.tooltip = 'Struggle engine armed (developer mode). Waiting for the first tick. Click to open the live engine view.';
            this._item.backgroundColor = undefined;
            this._item.show();
            return;
        }
        this._apply(computeAlertBarState(this._lastTick));
        this._item.show();
    }

    private _apply(state: AlertBarState): void {
        const u = state.urgency.toFixed(2);
        const th = state.theta.toFixed(2);
        switch (state.kind) {
            case 'firing':
                this._item.text = '$(megaphone) Struggle alert';
                this._item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                this._item.tooltip = `An alert is firing right now (urgency ${u}, θ ${th}). The student would be nudged. Click to open the live engine view.`;
                break;
            case 'gated': {
                const gate = (state.gateReason && GATE_LABEL[state.gateReason]) || 'a gate';
                this._item.text = `$(shield) Alert gated: ${gate}`;
                this._item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                this._item.tooltip = `The engine would alert (urgency ${u}, θ ${th}) but the ${gate} gate is holding it back. Click to open the live engine view.`;
                break;
            }
            case 'armed':
            default:
                this._item.text = `$(pulse) Struggle: ${u}`;
                this._item.backgroundColor = undefined;
                this._item.tooltip = `Struggle engine monitoring. Urgency ${u} (alert at θ ${th}). Click to open the live engine view.`;
                break;
        }
    }

    dispose(): void {
        for (const d of this._disposables) { d.dispose(); }
        this._disposables.length = 0;
    }
}
