import * as vscode from 'vscode';

import type { EpisodeHistoryEntry, LiveTick, SlotDebugSnapshot } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import type { TickRecord } from '@extension/services/struggle/types';
import type { Sink } from '@extension/telemetry/contract';

import { toLiveDecisionTrace } from './traceMap';

export { type Sink };

export class LiveEngineFeed implements vscode.Disposable {
    private readonly _buffer: LiveTick[] = [];
    private readonly _sinks = new Map<Sink, number>();
    private _sessionActive = false;
    private _slotProvider: (() => { snapshot: SlotDebugSnapshot; episodes: EpisodeHistoryEntry[] } | null) | null = null;
    private readonly _sub: vscode.Disposable;

    constructor(
        source: { onDidTick: vscode.Event<TickRecord> },
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
        if (this._sinks.size > 0 && this._isDeveloperMode()) {
            const msg = { type: ExtensionMsg.StruggleLiveTick, tick: live };
            for (const sink of this._sinks.keys()) { sink(msg); }
        }
    }

    subscribe(sink: Sink): void {
        if (!this._isDeveloperMode()) { return; }
        this._sinks.set(sink, (this._sinks.get(sink) ?? 0) + 1);
        sink({ type: ExtensionMsg.StruggleLiveReset });
        sink({ type: ExtensionMsg.StruggleLiveBackfill, ticks: [...this._buffer] });
        sink({ type: ExtensionMsg.StruggleLiveSessionState, active: this._sessionActive });
        this._pushSlotUpdateTo(sink);
    }

    unsubscribe(sink: Sink): void {
        const n = this._sinks.get(sink);
        if (n === undefined) { return; }
        if (n <= 1) { this._sinks.delete(sink); } else { this._sinks.set(sink, n - 1); }
    }

    dropSink(sink: Sink): void {
        this._sinks.delete(sink);
    }

    setSlotProvider(provider: () => { snapshot: SlotDebugSnapshot; episodes: EpisodeHistoryEntry[] } | null): void {
        this._slotProvider = provider;
    }

    private _pushSlotUpdateTo(sink: Sink): void {
        if (!this._isDeveloperMode() || !this._slotProvider) { return; }
        const p = this._slotProvider();
        if (!p) { return; }
        sink({ type: ExtensionMsg.StruggleSlotUpdate, snapshot: p.snapshot, episodes: p.episodes });
    }

    pushSlotUpdate(): void {
        if (!this._isDeveloperMode() || this._sinks.size === 0 || !this._slotProvider) { return; }
        const p = this._slotProvider();
        if (!p) { return; }
        const msg = { type: ExtensionMsg.StruggleSlotUpdate, snapshot: p.snapshot, episodes: p.episodes };
        for (const sink of this._sinks.keys()) { sink(msg); }
    }

    setSessionActive(active: boolean): void {
        const wasActive = this._sessionActive;
        this._sessionActive = active;
        // A fresh session (inactive -> active) restarts the chart: drop the
        // previous session's curve so the new run starts clean.
        if (active && !wasActive) {
            this._buffer.length = 0;
            if (this._sinks.size > 0 && this._isDeveloperMode()) {
                const msg = { type: ExtensionMsg.StruggleLiveReset };
                for (const sink of this._sinks.keys()) { sink(msg); }
            }
        }
        if (this._sinks.size > 0 && this._isDeveloperMode()) {
            const msg = { type: ExtensionMsg.StruggleLiveSessionState, active };
            for (const sink of this._sinks.keys()) { sink(msg); }
        }
    }

    dispose(): void { this._sub.dispose(); }
}
