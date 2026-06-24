import * as vscode from 'vscode';

import type { LiveTick } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import type { TickRecord } from '@extension/services/struggle/types';

export class LiveEngineFeed implements vscode.Disposable {
    private readonly _buffer: LiveTick[] = [];
    private _subscribed = false;
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
            decisionTrace: {
                outcome: tr.outcome, reason: tr.reason, discreteTrigger: tr.discreteTrigger,
                urgency: tr.urgency, theta: tr.theta, typingRate: tr.typingRate,
                boundariesPresent: [...tr.boundariesPresent],
                secondsSinceLastAlert: Number.isFinite(tr.secondsSinceLastAlert) ? tr.secondsSinceLastAlert : null,
                inWarmup: tr.inWarmup, graceActive: tr.graceActive,
            },
        };
    }

    private _onTick(rec: TickRecord): void {
        const live = LiveEngineFeed.toLiveTick(rec);
        this._buffer.push(live);
        if (this._buffer.length > this._cap) { this._buffer.shift(); }
        if (this._subscribed && this._isDeveloperMode()) {
            this._post({ type: ExtensionMsg.StruggleLiveTick, tick: live });
        }
    }

    subscribe(): void {
        if (!this._isDeveloperMode()) { return; }
        this._subscribed = true;
        this._post({ type: ExtensionMsg.StruggleLiveReset });
        this._post({ type: ExtensionMsg.StruggleLiveBackfill, ticks: [...this._buffer] });
    }

    unsubscribe(): void { this._subscribed = false; }

    clear(): void {
        this._buffer.length = 0;
        if (this._subscribed && this._isDeveloperMode()) {
            this._post({ type: ExtensionMsg.StruggleLiveReset });
        }
    }

    dispose(): void { this._sub.dispose(); }
}
