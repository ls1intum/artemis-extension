/**
 * Golden-replay harness: drive the StruggleEngine from a recorded session through
 * a ReplaySensorHub, capturing every TickRecord and AlertRecord for comparison
 * against the frozen Python reference.
 *
 * Two modes:
 *   - 'exact':  inject the golden's N1 paste times, so N1-boundary detection
 *               and alerting run on exactly the reference's paste input.
 *   - 'causal': the engine derives paste online from the recorded events.
 *
 * Determinism (one intake path, struggleEngine.ts §5): per grid tick we (1)
 * pump every hub signal with time <= tS so the engine ENQUEUES it, THEN (2)
 * advanceTo(tS) which drains ts <= tS and computes the tick. Pump-then-advance
 * is the contract: a signal at exactly a grid time must be enqueued before its
 * own tick runs. The engine's live interval timer is disabled here: a fake clock
 * whose setInterval never fires lets the harness own the clock.
 */
import * as vscode from 'vscode';

import type { RecordedEvent } from '@extension/services/recording/types';
import { SPEC } from '@extension/services/struggle/config';
import { StruggleEngine } from '@extension/services/struggle/struggleEngine';
import type { AlertRecord, EngineClock, TickRecord } from '@extension/services/struggle/types';

import type { GoldenInject } from './goldenTypes';
import { assertEveryChangeHasSnapshot } from './invariants';
import { ReplaySensorHub } from './replaySensorHub';

export interface ReplayResult {
    readonly durationS: number;
    readonly ticks: TickRecord[];
    readonly alerts: AlertRecord[];
}

export type ReplayOpts =
    | {
        mode: 'exact';
        inject: GoldenInject;
        sessionStartMs: number;
        durationS: number;
        resolveSnapshotText: (snapshotPath: string) => string;
    }
    | {
        mode: 'causal';
        sessionStartMs: number;
        durationS: number;
        resolveSnapshotText: (snapshotPath: string) => string;
    };

/** Grid tick times for a session of length durationS: 10, 20, ... <= durationS.
 *  First tick at +10s, never at 0 (mirrors Python ticks_for). */
function ticksFor(durationS: number): number[] {
    const out: number[] = [];
    for (let t = SPEC.TICK_S; t <= durationS; t += SPEC.TICK_S) {
        out.push(t);
    }
    return out;
}

export function replaySession(events: RecordedEvent[], opts: ReplayOpts): ReplayResult {
    // Fail loud on a corrupt stream before driving the engine.
    assertEveryChangeHasSnapshot(events);

    const hub = new ReplaySensorHub(events, {
        resolveSnapshotText: opts.resolveSnapshotText,
        pasteMode: opts.mode === 'exact' ? 'inject' : 'derive',
        injectedPasteEventTimes: opts.mode === 'exact' ? opts.inject.pasteEventTimes : undefined,
        sessionStartMs: opts.sessionStartMs,
    });

    // Fake clock: the harness owns time. setInterval never fires (the engine's
    // live auto-tick is disabled); advanceTo is driven manually below.
    const DUMMY_HANDLE = Symbol('replay-timer');
    let currentMs = opts.sessionStartMs;
    const clock: EngineClock = {
        now: () => currentMs,
        setInterval: () => DUMMY_HANDLE,
        clearInterval: () => { /* harness-driven */ },
    };

    // Validated-base mode: discrete add-ons OFF so the replay matches the
    // alerts_full_u golden surface (edit path only).
    const engine = new StruggleEngine(hub, clock, {
        decision: { enableTestStagnation: false },
    });
    const ticks: TickRecord[] = [];
    const alerts: AlertRecord[] = [];
    const subs: vscode.Disposable[] = [
        engine.onDidTick(t => ticks.push(t)),
        engine.onDidAlert(a => alerts.push(a)),
    ];

    try {
        engine.start({ sessionStartMs: opts.sessionStartMs });
        for (const tS of ticksFor(opts.durationS)) {
            hub.pumpUpTo(tS);
            currentMs = opts.sessionStartMs + tS * 1000;
            engine.advanceTo(currentMs);
        }
        engine.stop();
    } finally {
        for (const sub of subs) {
            sub.dispose();
        }
        engine.dispose();
        hub.dispose();
    }

    return { durationS: opts.durationS, ticks, alerts };
}
