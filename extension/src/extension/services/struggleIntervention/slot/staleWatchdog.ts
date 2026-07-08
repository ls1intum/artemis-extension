// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Watchdog configuration (consumed from TUNING.slot in config.ts). */
export interface StaleConfig {
    /**
     * How long (ms) of CONTINUOUS idle before the slot is silently freed. The idle clock is
     * reset by `resetProgress` (calm ticks / new green test), so this measures a continuous
     * high-severity idle stretch, not cumulative idle. It is the sole termination backstop for
     * a delivered slot the student has visibly walked away from.
     */
    idleAbandonMs: number;
    /** Lead time before the DELIVERED force-free at which the Moment-3 presence check fires.
     *  Optional: absent or <= 0 disables the pre-abandon warn (test stubs / non-Moment-3 paths). */
    warnLeadMs?: number;
}

/**
 * Events emitted by tick().
 *
 * - `pre-abandon-warn`: DELIVERED slot idle within `warnLeadMs` of `idleAbandonMs` -- Moment-3
 *   presence check ("Still on this?").
 * - `force-free`: DELIVERED slot idle past `idleAbandonMs` -- free + ABANDONED (silent).
 * - `free-silent`: PARKED slot idle past `idleAbandonMs` -- free with no row, no POST.
 */
export type StaleEvent =
    | { kind: 'pre-abandon-warn' }
    | { kind: 'force-free' }
    | { kind: 'free-silent' };

// ---------------------------------------------------------------------------
// StaleWatchdog
// ---------------------------------------------------------------------------

/**
 * Continuous-idle watchdog. A delivered hint's slot stays occupied while the student is idle
 * (which blocks re-hints via reconcile's `suppress`); the watchdog only frees it silently after
 * `idleAbandonMs` of continuous idle, so a walked-away slot still terminates (no zombie slot).
 *
 * Clock is injected via the `now` parameter on each method; the host drives calls from a
 * setInterval (Phase C). No setInterval/Date.now inside this class.
 */
export class StaleWatchdog {
    private readonly _cfg: StaleConfig;

    private _armed = false;
    private _parked = false;
    private _lastResetMs = 0;
    private _warned = false;

    constructor(cfg: StaleConfig) {
        this._cfg = cfg;
    }

    /**
     * Start the watchdog. Called by the orchestrator on every slot TAKE.
     *
     * @param now - current time in ms (injected)
     * @param parked - true when the slot is PARKED (never-delivered ambient)
     */
    arm(now: number, parked: boolean): void {
        this._armed = true;
        this._parked = parked;
        this._lastResetMs = now;
        this._warned = false;
    }

    /**
     * Reset the idle clock. Called on progress signals (new green test, sustained sBase drop),
     * so the idle stretch is measured continuously -- any activity postpones the silent free.
     */
    resetProgress(now: number): void {
        this._lastResetMs = now;
        this._warned = false;
    }

    /**
     * Fire once `idleAbandonMs` of continuous idle has elapsed: `force-free` for a DELIVERED
     * slot (ABANDONED), `free-silent` for a PARKED slot. Returns null while armed but not yet
     * idle long enough, or when not armed. Re-arms the clock on a fire.
     *
     * When `warnLeadMs` is configured (> 0) and the slot is DELIVERED (not parked), fires
     * `pre-abandon-warn` once, `warnLeadMs` before the force-free -- and pins the remaining
     * window to exactly `warnLeadMs` so the force-free still lands `warnLeadMs` after the warn.
     */
    tick(now: number): StaleEvent | null {
        if (!this._armed) {
            return null;
        }
        const idle = now - this._lastResetMs;
        const warnLead = this._cfg.warnLeadMs ?? 0;
        if (warnLead > 0 && !this._parked && !this._warned && idle >= this._cfg.idleAbandonMs - warnLead && idle < this._cfg.idleAbandonMs) {
            this._warned = true;
            this._lastResetMs = now - (this._cfg.idleAbandonMs - warnLead);   // pin the remaining window to warnLead
            return { kind: 'pre-abandon-warn' };
        }
        if (idle < this._cfg.idleAbandonMs) {
            return null;
        }
        this._warned = false;
        this._lastResetMs = now;
        return this._parked ? { kind: 'free-silent' } : { kind: 'force-free' };
    }

    /**
     * Stop the watchdog. Called by the orchestrator on every slot FREE or terminal transition.
     */
    disarm(): void {
        this._armed = false;
    }

    /** True while the watchdog is armed (diagnostic read; does not affect the clock). */
    isArmed(): boolean {
        return this._armed;
    }

    /** Absolute ms of the next due silent free while armed, else null (diagnostic read). */
    staleDeadlineMs(): number | null {
        return this._armed ? this._lastResetMs + this._cfg.idleAbandonMs : null;
    }
}
