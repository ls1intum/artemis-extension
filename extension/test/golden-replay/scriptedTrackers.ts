/**
 * Scripted A8/N2 trackers for golden-replay EXACT mode.
 *
 * In exact mode the harness injects the golden's recorded binary fA8/fN2 streams
 * verbatim instead of deriving them online, so the engine's severity and alerting
 * are exercised against the exact feature inputs the reference used. Each tracker
 * is backed by a `Map<tickTime, 0|1>`; `activeAt(tS)` returns the mapped boolean
 * (defaulting to inactive for unmapped ticks), and every ingest method is a no-op
 * (the scripted value, not the online derivation, is authoritative).
 */
import type {
    A8TrackerLike, N2TrackerLike,
} from '@extension/services/struggle/struggleEngine';

function toMap(pairs: [number, 0 | 1][]): Map<number, 0 | 1> {
    return new Map(pairs);
}

/** A8 tracker whose `activeAt` replays the scripted [tickTime, value] pairs. */
export function scriptedA8(pairs: [number, 0 | 1][]): A8TrackerLike {
    const map = toMap(pairs);
    return {
        recordChange(): void { /* no-op: scripted value is authoritative */ },
        activeAt(tS: number): boolean { return (map.get(tS) ?? 0) === 1; },
    };
}

/** N2 tracker whose `activeAt` replays the scripted [tickTime, value] pairs. */
export function scriptedN2(pairs: [number, 0 | 1][]): N2TrackerLike {
    const map = toMap(pairs);
    return {
        ingestSelection(): void { /* no-op: scripted value is authoritative */ },
        ingestSnapshot(): void { /* no-op: scripted value is authoritative */ },
        activeAt(tS: number): boolean { return (map.get(tS) ?? 0) === 1; },
    };
}
