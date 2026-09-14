import { describe, expect, it } from 'vitest';

import type { RecordedEvent } from '@extension/services/recording/types';
import { asEditAlert } from '@test/__shared__/alertNarrow';

import { replaySession } from './struggleReplay';

const URI = 'file:///Users/x/exercise/src/Main.java';
const SNAPSHOT_PATH = 'snapshots/Main.java.0.txt';
const SESSION_START_MS = 1_000_000_000_000;
const JAVA = 'class Main { void run() {} }';

function resolveSnapshotText(path: string): string {
    if (path === SNAPSHOT_PATH) {
        return JAVA;
    }
    throw new Error(`unexpected snapshot path: ${path}`);
}

/** A minimal idle session: a startup snapshot for one URI, a sessionStart, and
 *  nothing else. The engine should still tick the whole grid and (eventually)
 *  alert on the idle STATE boundary. */
function idleEvents(): RecordedEvent[] {
    return [
        { type: 'sessionStart', timestamp: SESSION_START_MS, exerciseId: 1, participantId: 'P1' },
        { type: 'fileSnapshot', timestamp: SESSION_START_MS + 20, uri: URI, snapshotPath: SNAPSHOT_PATH },
        { type: 'startupPhaseComplete', timestamp: SESSION_START_MS + 50 },
    ];
}

describe('replaySession — causal mode', () => {
    it('ticks the whole 10s grid and alerts STATE on a pure idle session', () => {
        const result = replaySession(idleEvents(), {
            mode: 'causal',
            sessionStartMs: SESSION_START_MS,
            durationS: 520,
            resolveSnapshotText,
        });

        expect(result.durationS).toBe(520);
        // First tick at +10s, never 0; one tick every 10s through durationS.
        expect(result.ticks.map(t => t.t)).toEqual(
            Array.from({ length: 52 }, (_, i) => (i + 1) * 10),
        );
        // The idle session crosses warmup (480s) with no typing -> STATE alert.
        expect(result.alerts.length).toBeGreaterThanOrEqual(1);
        expect(asEditAlert(result.alerts[0]).primary).toBe('STATE');
    });
});

describe('replaySession — exact mode', () => {
    it('injects a paste producing an N1 boundary at the mapped tick', () => {
        const result = replaySession(idleEvents(), {
            mode: 'exact',
            inject: { fA8: [], fN2: [], pasteEventTimes: [20] },
            sessionStartMs: SESSION_START_MS,
            durationS: 60,
            resolveSnapshotText,
        });

        const byT = new Map(result.ticks.map(t => [t.t, t]));
        expect(byT.get(20)!.boundariesPreGate).toContain('N1');
        // No paste at other ticks.
        expect(byT.get(10)!.boundariesPreGate).not.toContain('N1');
        expect(byT.get(30)!.boundariesPreGate).not.toContain('N1');
    });
});
