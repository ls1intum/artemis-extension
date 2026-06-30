import * as vscode from 'vscode';

import type { EpisodeHistoryEntry, LiveTick, SlotDebugSnapshot } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import type { TickRecord } from '@extension/services/struggle/types';

import { toLiveDecisionTrace } from './traceMap';

export class LiveEngineFeed implements vscode.Disposable {
    private readonly _buffer: LiveTick[] = [];
    private _subscriberCount = 0;
    private _sessionActive = false;
    private _slotProvider: (() => { snapshot: SlotDebugSnapshot; episodes: EpisodeHistoryEntry[] } | null) | null = null;
    private readonly _sub: vscode.Disposable;

    constructor(
        source: { onDidTick: vscode.Event<TickRecord> },
        private readonly _post: (msg: unknown) => void,
        private readonly _isDeveloperMode: () => boolean,
        private readonly _cap = 600,
    ) {
        this._sub = source.onDidTick(rec => this._onTick(rec));
    }

    static toLiveTick(rec: TickRecord): LiveTick {
        const tr = rec.decisionTrace;
        return {
            t: rec.t, urgency: rec.sBase, s: rec.s, v: rec.v, theta: tr.theta,
            boundariesPreGate: [...rec.boundariesPreGate],
            alertKind: rec.alert ? rec.alert.kind : null,
            alertPrimary: rec.alert && rec.alert.kind === 'edit' ? rec.alert.primary : null,
            decisionTrace: toLiveDecisionTrace(tr),
        };
    }

    private _onTick(rec: TickRecord): void {
        const live = LiveEngineFeed.toLiveTick(rec);
        this._buffer.push(live);
        if (this._buffer.length > this._cap) { this._buffer.shift(); }
        if (this._subscriberCount > 0 && this._isDeveloperMode()) {
            this._post({ type: ExtensionMsg.StruggleLiveTick, tick: live });
        }
    }

    subscribe(): void {
        if (!this._isDeveloperMode()) { return; }
        this._subscriberCount++;
        // Replay on EVERY subscribe (preserves the current behavior the existing liveEngineFeed
        // tests expect + paints a late-mounting panel). The ref-count governs only DEACTIVATION:
        // the live tick stream stops posting once the count returns to 0.
        this._post({ type: ExtensionMsg.StruggleLiveReset });
        this._post({ type: ExtensionMsg.StruggleLiveBackfill, ticks: [...this._buffer] });
        this._post({ type: ExtensionMsg.StruggleLiveSessionState, active: this._sessionActive });
        this.pushSlotUpdate();
    }

    unsubscribe(): void {
        if (this._subscriberCount > 0) { this._subscriberCount--; }
    }

    setSlotProvider(provider: () => { snapshot: SlotDebugSnapshot; episodes: EpisodeHistoryEntry[] } | null): void {
        this._slotProvider = provider;
    }

    pushSlotUpdate(): void {
        if (this._subscriberCount === 0 || !this._isDeveloperMode() || !this._slotProvider) { return; }
        const payload = this._slotProvider();
        if (!payload) { return; }
        this._post({ type: ExtensionMsg.StruggleSlotUpdate, snapshot: payload.snapshot, episodes: payload.episodes });
    }

    setSessionActive(active: boolean): void {
        const wasActive = this._sessionActive;
        this._sessionActive = active;
        // A fresh session (inactive → active) restarts the chart: drop the
        // previous session's curve so the new run starts clean.
        if (active && !wasActive) {
            this._buffer.length = 0;
            if (this._subscriberCount > 0 && this._isDeveloperMode()) {
                this._post({ type: ExtensionMsg.StruggleLiveReset });
            }
        }
        if (this._subscriberCount > 0 && this._isDeveloperMode()) {
            this._post({ type: ExtensionMsg.StruggleLiveSessionState, active });
        }
    }

    dispose(): void { this._sub.dispose(); }
}
