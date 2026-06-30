// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Watchdog configuration (consumed from TUNING knobs in config.ts). */
export interface StaleConfig {
    /** How long (ms) after the last reset/arm before the watchdog fires. */
    staleAfterMs: number;
    /** Maximum number of watchdog fires before the slot is force-freed (§13 bound). */
    staleWindowMax: number;
    /** Maximum number of staleCheck asks that may be posted during the episode. */
    staleAskCap: number;
    // C5: DeadlineLatch abandon-timer knobs (optional; orchestrator DEFAULT_SLOT_CFG provides fallbacks)
    /** Initial deadline for the per-ask ABANDON timer (ms after ask-post). */
    abandonInitialMs?: number;
    /** Sliding reset applied on a free-text reply (ms from now, capped at ceiling). */
    abandonFreeTextMs?: number;
    /** Absolute ceiling: ABANDON fires no later than this many ms after the ask-post. */
    abandonCeilingMs?: number;
}

/**
 * Events emitted by tick().
 *
 * - `fire-stale-check`: DELIVERED slot; window already incremented; the
 *   orchestrator owes a best-effort staleCheck POST (if canPostAsk and no
 *   ask is in flight).
 * - `force-free`: staleWindowCount reached staleWindowMax -- slot must be
 *   abandoned (§13 termination bound).
 * - `free-silent`: PARKED slot timed out; free with no row, no POST.
 */
export type StaleEvent =
    | { kind: 'fire-stale-check' }
    | { kind: 'force-free' }
    | { kind: 'free-silent' };

// ---------------------------------------------------------------------------
// StaleWatchdog
// ---------------------------------------------------------------------------

/**
 * Pure stale watchdog with §13 termination counters.
 *
 * Clock is injected via the `now` parameter on each method; the host drives
 * calls from a setInterval (Phase C). No setInterval/Date.now inside this class.
 *
 * The LOAD-BEARING INVARIANT (§7.3/§13):
 *   `staleWindowCount` increments on EVERY DELIVERED fire, completely
 *   independent of the wire, the ask cap, or whether any staleCheck ran.
 *   A busy wire may delay or skip a POST, but it can never postpone force-free
 *   past `staleWindowMax` windows.
 */
export class StaleWatchdog {
    private readonly _cfg: StaleConfig;

    private _armed = false;
    private _parked = false;
    private _lastResetMs = 0;

    /** Incremented on every DELIVERED fire (wire-independent, never reset). */
    private _staleWindowCount = 0;
    /** Incremented each time the orchestrator posts a staleCheck ask. */
    private _staleAskCount = 0;

    constructor(cfg: StaleConfig) {
        this._cfg = cfg;
    }

    /**
     * Start the watchdog.
     * Called by the orchestrator on every slot TAKE.
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
     * Defer the next fire by resetting the elapsed clock.
     * Called on hard progress signals (new green test, sustained sBase drop)
     * and on the explicit "Still on it" keepalive (C5).
     * Counters (`staleWindowCount`, `staleAskCount`) are never reset here.
     */
    resetProgress(now: number): void {
        this._lastResetMs = now;
    }

    /**
     * Check whether a fire is due.
     *
     * Returns null when: not armed, or `staleAfterMs` has not yet elapsed.
     *
     * On a fire the clock re-arms (next fire is due staleAfterMs after `now`).
     *
     * For a DELIVERED slot: increments `staleWindowCount` on every fire
     * (wire-independent -- §13 bound), then returns `force-free` when the
     * count reaches `staleWindowMax`, else `fire-stale-check`.
     *
     * For a PARKED slot: returns `free-silent` without touching counters.
     */
    tick(now: number): StaleEvent | null {
        if (!this._armed) {
            return null;
        }
        if (now - this._lastResetMs < this._cfg.staleAfterMs) {
            return null;
        }

        // Re-arm the clock before returning so the next fire is relative to now.
        this._lastResetMs = now;

        if (this._parked) {
            return { kind: 'free-silent' };
        }

        // DELIVERED: increment window count on every fire, unconditionally.
        // This is the §13 bound: the window advances regardless of the wire.
        this._staleWindowCount++;

        if (this._staleWindowCount >= this._cfg.staleWindowMax) {
            return { kind: 'force-free' };
        }
        return { kind: 'fire-stale-check' };
    }

    /**
     * Record that a staleCheck ask was posted.
     * Called by the orchestrator (C4) when a staleCheck response with ask=true
     * is rendered in the webview.
     */
    onAskPosted(): void {
        this._staleAskCount++;
    }

    /**
     * Whether the orchestrator may post another staleCheck ask.
     * Does NOT affect window counting or force-free -- purely informational
     * for the orchestrator's POST decision.
     */
    canPostAsk(): boolean {
        return this._staleAskCount < this._cfg.staleAskCap;
    }

    /**
     * Stop the watchdog. Called by the orchestrator on every slot FREE or
     * terminal transition.
     */
    disarm(): void {
        this._armed = false;
    }

    /** Current staleWindowCount (number of DELIVERED fires so far). */
    windowCount(): number {
        return this._staleWindowCount;
    }
}
