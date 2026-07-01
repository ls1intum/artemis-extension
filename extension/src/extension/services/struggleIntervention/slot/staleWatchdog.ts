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
}

/**
 * Events emitted by tick().
 *
 * - `force-free`: DELIVERED slot idle past `idleAbandonMs` -- free + ABANDONED (silent).
 * - `free-silent`: PARKED slot idle past `idleAbandonMs` -- free with no row, no POST.
 */
export type StaleEvent =
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
    }

    /**
     * Reset the idle clock. Called on progress signals (new green test, sustained sBase drop),
     * so the idle stretch is measured continuously -- any activity postpones the silent free.
     */
    resetProgress(now: number): void {
        this._lastResetMs = now;
    }

    /**
     * Fire once `idleAbandonMs` of continuous idle has elapsed: `force-free` for a DELIVERED
     * slot (ABANDONED), `free-silent` for a PARKED slot. Returns null while armed but not yet
     * idle long enough, or when not armed. Re-arms the clock on a fire.
     */
    tick(now: number): StaleEvent | null {
        if (!this._armed) {
            return null;
        }
        if (now - this._lastResetMs < this._cfg.idleAbandonMs) {
            return null;
        }
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
