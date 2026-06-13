// extension/src/extension/services/struggle/dynamics/decay.ts
/**
 * V(t) dynamics (spec §2): V = max(S, V_prev * 2^(-dt/hl)), hl 120 s default,
 * 30 s in the fast-decay regime. The regime starts at an improved buildResult,
 * restarts on further improved builds, and ends after 120 s OR immediately at
 * the next non-improved buildResult. No hard reset (B5 unsupported, spec §2).
 *
 * Incremental port of compute_v / fast_decay_active (engine_v2.py). Events
 * MUST be ingested in non-decreasing ts order (the engine's drain rule
 * guarantees this); queries activeAt(t) come after all events <= t.
 */
import { SPEC } from '@extension/services/struggle/constants';

export class FastDecayTracker {
    private _lastImprovedS: number | null = null;
    private _killed = false;

    ingestImproved(tS: number): void {
        this._lastImprovedS = tS;
        this._killed = false;
    }

    ingestNonImproved(_tS: number): void {
        if (this._lastImprovedS !== null) {
            this._killed = true;
        }
    }

    activeAt(tS: number): boolean {
        return this._lastImprovedS !== null
            && !this._killed
            && tS - this._lastImprovedS <= SPEC.FAST_DECAY_MAX_S;
    }

    reset(): void {
        this._lastImprovedS = null;
        this._killed = false;
    }
}

export class VTracker {
    private _v: number | null = null;
    private _tPrevS = 0;

    /** Compute V at tick t from severity s; fast selects hl=30 (spec §2). */
    update(tS: number, s: number, fast: boolean): number {
        if (this._v === null) {
            this._v = s;            // first tick: V(t_first) = S(t_first)
        } else {
            const dt = tS - this._tPrevS;
            const hl = fast ? SPEC.HL_FAST_S : SPEC.HL_DEFAULT_S;
            this._v = Math.max(s, this._v * 2 ** (-dt / hl));
        }
        this._tPrevS = tS;
        return this._v;
    }

    get current(): number | null { return this._v; }

    reset(): void {
        this._v = null;
        this._tPrevS = 0;
    }
}
