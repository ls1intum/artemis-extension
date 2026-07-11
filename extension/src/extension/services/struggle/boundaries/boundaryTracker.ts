// extension/src/extension/services/struggle/boundaries/boundaryTracker.ts
/**
 * Boundary bookkeeping (spec §3): FM/E4/N1 events are assigned to the
 * FIRST tick >= event time and evaluated exactly once there; the STATE
 * boundary has interval semantics (pending at every tick with an active TS
 * state after warmup — this realizes the "synthetic warmup entry" without an
 * exit/re-entry). Port of assign_to_ticks / build_boundaries (engine_v2.py,
 * v3 drops the N4-state arm).
 *
 * Incremental contract: ingest() in non-decreasing tick consumption order —
 * flagsAt(t) consumes every buffered event with ts <= t and must be called
 * with strictly increasing t (the engine's grid guarantees both).
 */
import type { BoundaryType } from '@extension/services/struggle/config';
import { BOUNDARY_PRIORITY, SPEC } from '@extension/services/struggle/config';

/** Score ticks t = 10, 20, ... <= duration (first tick at 10 s). Test/audit helper. */
export function ticksFor(durationS: number): number[] {
    const out: number[] = [];
    const n = Math.floor(durationS / SPEC.TICK_S);
    for (let k = 1; k <= n; k++) { out.push(k * SPEC.TICK_S); }
    return out;
}

/**
 * State entry times after warmup including the synthetic warmup-end entry
 * (spec §3 Warmup-Uebergang; DECISIONS_v2 #12). Pure helper for audit and the
 * T8 test ports; the alerting path uses only the interval-semantics flag.
 */
export function stateEntryTimes(
    ticks: readonly number[],
    state: readonly boolean[],
    warmupS: number,
): { entries: number[]; synthetic: boolean[] } {
    const entries: number[] = [];
    const synthetic: boolean[] = [];
    const firstFree = ticks.findIndex(t => t > warmupS);
    if (firstFree === -1) {
        return { entries, synthetic };
    }
    for (let i = 0; i < ticks.length; i++) {
        if (ticks[i] <= warmupS || !state[i]) {
            continue;
        }
        if (i === 0 || !state[i - 1]) {
            entries.push(ticks[i]);
            synthetic.push(false);
        } else if (i === firstFree) {       // state[i-1] active at the last warmup tick
            entries.push(ticks[i]);
            synthetic.push(true);
        }
    }
    return { entries, synthetic };
}

type EventBoundary = Exclude<BoundaryType, 'STATE'>;

export class BoundaryTracker {
    private readonly _buffers = new Map<EventBoundary, number[]>([
        ['FM', []], ['E4', []], ['N1', []],
    ]);

    /** Buffer an event boundary at session-relative time ts (seconds). */
    ingest(type: EventBoundary, tsS: number): void {
        this._buffers.get(type)!.push(tsS);
    }

    /**
     * Boundary types pending at tick t, in BOUNDARY_PRIORITY order. Consumes
     * every buffered event with ts <= t (exactly-once tick assignment).
     */
    flagsAt(tS: number, tsState: boolean, warmupS: number = SPEC.WARMUP_S): BoundaryType[] {
        const present = new Set<BoundaryType>();
        for (const [type, buffer] of this._buffers) {
            let consumed = 0;
            while (consumed < buffer.length && buffer[consumed] <= tS) {
                consumed++;
            }
            if (consumed > 0) {
                present.add(type);
                buffer.splice(0, consumed);
            }
        }
        if (tsState && tS > warmupS) {
            present.add('STATE');
        }
        return BOUNDARY_PRIORITY.filter(k => present.has(k));
    }

    reset(): void {
        for (const buffer of this._buffers.values()) {
            buffer.length = 0;
        }
    }
}
