import * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';

import type {
    A8TrackerLike, N2TrackerLike,
} from '@extension/services/struggle/struggleEngine';
import { StruggleEngine } from '@extension/services/struggle/struggleEngine';
import type { AlertRecord, EngineClock, TickRecord } from '@extension/services/struggle/types';
import { asEditAlert } from '@test/__shared__/alertNarrow';
import { TestSensorHub } from '@test/__shared__/testSensorHub';

const START = 1_000_000_000_000;

/** Manual clock pinned at START: tests drive ticks via advanceTo() themselves
 *  (so stop()/dispose drains never catch up against the real Date.now()). */
function pinnedClock(): EngineClock {
    return { now: () => START, setInterval: () => 0, clearInterval: () => { /* manual */ } };
}

/** Scripted A8: active iff the tick time is at or past 100 s, no matter what the
 *  recorded changes are. recordChange is accepted and ignored. */
function scriptedA8(): A8TrackerLike {
    return {
        recordChange: () => { /* scripted: input ignored */ },
        activeAt: (tS: number) => tS >= 100,
    };
}

/** Scripted N2: never active. */
function scriptedN2(): N2TrackerLike {
    return {
        ingestSelection: () => { /* scripted: input ignored */ },
        ingestSnapshot: () => { /* scripted: input ignored */ },
        activeAt: () => false,
    };
}

function fakeTextChange(uri: string, oneCharTexts: string[], fullText: string, ts: number): { ts: number; event: unknown } {
    return {
        ts,
        event: {
            document: { uri: vscode.Uri.parse(uri), getText: () => fullText },
            contentChanges: oneCharTexts.map(text => ({
                text,
                rangeLength: 0,
                range: { start: { line: 0 }, isEmpty: true, isSingleLine: true },
            })),
        },
    };
}

describe('StruggleEngine — injectable A8/N2 trackers', () => {
    it('feeds scripted A8/N2 signals regardless of edits (exact-replay seam)', () => {
        const hub = new TestSensorHub();
        const engine = new StruggleEngine(hub, pinnedClock(), {
            trackers: { a8: scriptedA8, n2: scriptedN2 },
        });
        const ticks: TickRecord[] = [];
        engine.onDidTick(t => ticks.push(t));
        engine.start({ sessionStartMs: START });

        // Fire edits that would NOT trip the real A8 tracker (too few, too
        // sparse) — proves fA8 follows the injected script, not online derivation.
        for (let s = 1; s <= 50; s++) {
            hub.emit.textChange.fire(fakeTextChange('file:///ws/Main.java', ['a'], 'class A {}', START + s * 1000) as never);
        }
        engine.advanceTo(START + 200_000);

        expect(ticks.map(t => t.t)).toEqual(
            Array.from({ length: 20 }, (_, i) => (i + 1) * 10),
        );
        for (const tick of ticks) {
            expect(tick.features.fA8).toBe(tick.t >= 100 ? 1 : 0);
            expect(tick.features.fN2).toBe(0);
        }

        engine.dispose();
    });

    it('default path (no trackers option) is unchanged: idle session alerts STATE at t=490', () => {
        const hub = new TestSensorHub();
        const engine = new StruggleEngine(hub);
        const ticks: TickRecord[] = [];
        const alerts: AlertRecord[] = [];
        engine.onDidTick(t => ticks.push(t));
        engine.onDidAlert(a => alerts.push(a));
        engine.start({ sessionStartMs: START });

        engine.advanceTo(START + 520_000);

        expect(alerts.map(a => a.t)).toEqual([490]);
        const a0 = asEditAlert(alerts[0]);
        expect(a0.primary).toBe('STATE');
        expect(a0.path).toBe('armed');
        const tick49 = ticks.find(t => t.t === 490)!;
        expect(Math.abs(tick49.s - 1.0)).toBeLessThan(1e-9);   // v3 2-feature idle: (1+1)/2
        // Default real trackers: an idle session never trips A8 or N2.
        for (const tick of ticks) {
            expect(tick.features.fA8).toBe(0);
            expect(tick.features.fN2).toBe(0);
        }

        engine.dispose();
    });
});
