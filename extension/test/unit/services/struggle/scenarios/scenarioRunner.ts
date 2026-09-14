/**
 * Scenario harness (Engine v3): drives the StruggleEngine end-to-end with
 * synthetic sensor events on a sinon-faked clock. Scenarios are typed TS data;
 * every event is anchored at a session-relative time in seconds.
 */
import * as vscode from 'vscode';
import * as sinon from 'sinon';

import type { ResultDTO } from '@extension/domain/submissions';
import type { AlertSink } from '@extension/services/struggle/alerting/alertSink';
import { StruggleEngine } from '@extension/services/struggle/struggleEngine';
import type { AlertRecord, TickRecord } from '@extension/services/struggle/types';
import { TestSensorHub } from '@test/__shared__/testSensorHub';

export type ScenarioEvent =
    | { at: number; type: 'typing'; durationS: number; charsPerSecond: number; uri?: string }
    | { at: number; type: 'build'; failed: string[]; buildFailed?: boolean; passed?: number; total?: number }
    | { at: number; type: 'terminalRun' }
    | { at: number; type: 'paste'; chars: number; lines: number; uri?: string };

export interface Scenario {
    id: string;
    category: 'obvious' | 'subtle' | 'no-struggle' | 'edge';
    description: string;
    durationS: number;
    events: ScenarioEvent[];
    expected: {
        /** Exact alert tick times (session-relative seconds). */
        alertTimes?: number[];
        /** Exact alert kinds, positionally aligned with alertTimes (edit|discrete). */
        alertKinds?: Array<'edit' | 'discrete'>;
        noAlerts?: boolean;
        /** Optional invariant on the final tick's sBase. */
        finalSBaseBelow?: number;
    };
}

const DEFAULT_URI = 'file:///ws/exercise/Main.java';
const START = 1_750_000_000_000;

/** Manual clock: the runner drives engine.advanceTo itself so that events at
 *  exactly a grid time are enqueued BEFORE that tick runs (drain rule: tick T
 *  includes ts <= T). */
const NOOP_ENGINE_CLOCK = {
    now: () => Date.now(),
    setInterval: () => 0 as unknown,
    clearInterval: () => { /* runner-driven */ },
};

export interface ScenarioResult {
    alerts: AlertRecord[];
    ticks: TickRecord[];
}

export function runScenario(scenario: Scenario): ScenarioResult {
    const clock = sinon.useFakeTimers({
        now: START,
        toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
    });
    const hub = new TestSensorHub();
    const engine = new StruggleEngine(hub, NOOP_ENGINE_CLOCK);
    const alerts: AlertRecord[] = [];
    // Route alerts through the same AlertSink contract as the production delivery path.
    const sink: AlertSink = { deliver: a => alerts.push(a) };
    const ticks: TickRecord[] = [];
    engine.onDidAlert(a => sink.deliver(a));
    engine.onDidTick(t => ticks.push(t));
    try {
        engine.start({ sessionStartMs: START });

        // Expand events into atomic timestamped firings.
        const atomic: Array<{ at: number; fire: () => void }> = [];
        for (const ev of scenario.events) {
            const uri = vscode.Uri.parse(('uri' in ev && ev.uri) || DEFAULT_URI);
            switch (ev.type) {
                case 'typing': {
                    const n = Math.floor(ev.durationS * ev.charsPerSecond);
                    for (let i = 0; i < n; i++) {
                        const at = ev.at + i / ev.charsPerSecond;
                        atomic.push({ at, fire: () => hub.emit.textChange.fire({
                            ts: START + at * 1000,
                            event: {
                                document: { uri, getText: () => 'class A {}' },
                                contentChanges: [{ text: 'a', rangeLength: 0, range: { start: { line: 0 }, isEmpty: true, isSingleLine: true } }],
                            },
                        } as never) });
                    }
                    break;
                }
                case 'build':
                    atomic.push({ at: ev.at, fire: () => hub.emit.buildResult.fire({
                        ts: START + ev.at * 1000,
                        result: {
                            id: 1,
                            submission: { id: 1, buildFailed: ev.buildFailed ?? false },
                            feedbacks: ev.failed.map(d => ({ positive: false, detailText: d, text: 't' })),
                            passedTestCaseCount: ev.passed,
                            testCaseCount: ev.total,
                        } as unknown as ResultDTO,
                    }) });
                    break;
                case 'terminalRun':
                    atomic.push({ at: ev.at, fire: () => hub.emit.shellEnd.fire({ ts: START + ev.at * 1000, event: {} as never }) });
                    break;
                case 'paste':
                    atomic.push({ at: ev.at, fire: () => hub.emit.pasteDetected.fire({
                        ts: START + ev.at * 1000, uri, chars: ev.chars, lines: ev.lines,
                    }) });
                    break;
            }
        }
        atomic.sort((a, b) => a.at - b.at);

        // Ordering per timestamp (tick contract): (1) advance the sinon clock to
        // the event time (the engine does NOT tick, noop interval); (2) fire ALL
        // events at this timestamp so any event at exactly a grid time is enqueued
        // before its tick runs (events sharing a timestamp must all enqueue before
        // that tick, otherwise the first one's advanceTo runs the tick before the
        // rest are enqueued and they drain one tick late); (3) advanceTo(time)
        // processes every due tick.
        let currentS = 0;
        let i = 0;
        while (i < atomic.length) {
            const at = atomic[i].at;
            if (at > currentS) {
                clock.tick((at - currentS) * 1000);
                currentS = at;
            }
            while (i < atomic.length && atomic[i].at === at) {
                atomic[i].fire();
                i++;
            }
            engine.advanceTo(START + currentS * 1000);
        }
        if (scenario.durationS > currentS) {
            clock.tick((scenario.durationS - currentS) * 1000);
            engine.advanceTo(START + scenario.durationS * 1000);
        }
        return { alerts, ticks };
    } finally {
        engine.dispose();
        clock.restore();
    }
}
