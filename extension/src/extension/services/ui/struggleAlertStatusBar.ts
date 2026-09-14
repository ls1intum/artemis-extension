import * as vscode from 'vscode';

import type { TickRecord } from '@extension/services/struggle/types';
import type { IStruggleCoordinator } from '@extension/telemetry/contract';

import { type AlertBarDisplay, computeAlertBarState, formatAlertBar } from './struggleAlertBarState';

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
    /** Warm-up length (s), read once from the engine caps. The clean build's no-op returns 0
     *  (it never ticks, so the bar never renders), keeping this leak-free of struggle/config. */
    private readonly _warmupS: number;

    constructor(
        coordinator: IStruggleCoordinator,
        private readonly _isDeveloperMode: () => boolean,
        /** Reveal the panel + open the live-engine view (clicked from the bar). */
        private readonly _onActivate: () => void,
    ) {
        this._warmupS = coordinator.getDebugSnapshot().caps.warmupS;
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
        // Warm-up readout: null unless the engine itself reports warm-up (inWarmup = t <= warmupS),
        // so it persists through the final warm-up tick; the remaining is tick-time driven (warmupS − t).
        const warmupRemainingS = this._lastTick.decisionTrace.inWarmup
            ? Math.max(0, this._warmupS - this._lastTick.t)
            : null;
        this._apply(formatAlertBar(computeAlertBarState(this._lastTick), warmupRemainingS));
        this._item.show();
    }

    private _apply(display: AlertBarDisplay): void {
        this._item.text = display.text;
        this._item.tooltip = display.tooltip;
        this._item.backgroundColor = display.background === null
            ? undefined
            : new vscode.ThemeColor(display.background === 'error' ? 'statusBarItem.errorBackground' : 'statusBarItem.warningBackground');
    }

    dispose(): void {
        for (const d of this._disposables) { d.dispose(); }
        this._disposables.length = 0;
    }
}
