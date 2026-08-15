export type CloseState = 'open' | 'pending-post' | 'candidate-close';

/** Configuration consumed from TUNING knobs (injected by the orchestrator). */
export interface ProgressCloseCfg {
    /** sBase must be continuously below this value for reArmHoldMs to fire a close edge. */
    reArmSBase: number;
    /** How long (ms) sBase must be continuously below reArmSBase to fire one close edge. */
    reArmHoldMs: number;
}

/**
 * Progress-edge detector and confirmClose edge-trigger latch (§7.1).
 *
 * A "progress edge" fires when EITHER:
 *   1. newGreenTest === true (a build result carries a strict new high in passed tests), OR
 *   2. sBase has been continuously below reArmSBase for at least reArmHoldMs
 *      (first satisfaction only -- the armed flag prevents re-firing on the same
 *      continuous below-period; the sBase path re-arms only after sBase rises above
 *      reArmSBase again).
 *
 * State transitions:
 *   open  -(fresh edge)->  pending-post  -(onPosted)->  candidate-close
 *                                |                             |
 *                         onConfirmResult(false)     onConfirmResult(true)
 *                                |                             |
 *                               open                       (terminal)
 *
 * A fresh edge while pending-post or candidate-close does NOT stack (exactly one
 * owed close at a time).
 *
 * onPosted() is TOTAL (safe to call from any state):
 *   pending-post  ->  candidate-close (consume the owed edge)
 *   open          ->  no-op (stale_solved close with no progress edge pending)
 *   candidate-close -> no-op (already consumed)
 *
 * Clock is injected via the `now` parameter; no Date.now / setInterval inside.
 */
export class ProgressCloseLatch {
    private readonly _cfg: ProgressCloseCfg;

    private _state: CloseState = 'open';

    /**
     * Whether the sBase edge path is currently allowed to track a new below-period.
     * Starts true. Set to false after sBase fires, or after onConfirmResult(false)
     * (requires sBase to rise above reArmSBase before it can fire again).
     * Set back to true when sBase rises to or above reArmSBase, or by reset().
     */
    private _armed = true;

    /**
     * Timestamp when sBase first dropped below reArmSBase in the current run.
     * Null when sBase is at or above the threshold, or when not armed.
     */
    private _belowSince: number | null = null;

    /**
     * True after onConfirmResult(true): the slot is freed elsewhere, so the latch
     * must not re-fire until reset().
     */
    private _terminal = false;

    constructor(cfg: ProgressCloseCfg) {
        this._cfg = cfg;
    }

    /** Current state of the latch. */
    state(): CloseState {
        return this._state;
    }

    /**
     * Feed one engine tick. Called once per tick by the orchestrator.
     *
     * @param now - current time in ms (injected)
     * @param sBase - two-feature severity base score [0, 1]
     * @param newGreenTest - true when this build result carries a strict new high in
     *   passed tests
     */
    observe(now: number, sBase: number, newGreenTest: boolean): void {
        if (this._terminal) {
            return;
        }

        // -- sBase path --
        if (sBase < this._cfg.reArmSBase) {
            if (this._armed) {
                if (this._belowSince === null) {
                    // First tick below in this run -- start the timer.
                    this._belowSince = now;
                } else if (this._state === 'open' && now - this._belowSince >= this._cfg.reArmHoldMs) {
                    // Held below for long enough -- fire a close edge.
                    this._state = 'pending-post';
                    this._armed = false;
                    this._belowSince = null;
                }
            }
            // Not armed: ignore the below-period entirely.
        } else {
            // sBase at or above the threshold: reset the timer and re-arm the path.
            this._belowSince = null;
            this._armed = true;
        }

        // -- newGreenTest path --
        if (newGreenTest && this._state === 'open') {
            this._state = 'pending-post';
        }
    }

    /**
     * True while a confirmClose is owed but not yet POSTed (state is pending-post).
     * Stays true across ticks until onPosted() so a owed close is never lost while
     * the wire is busy.
     */
    shouldPost(): boolean {
        return this._state === 'pending-post';
    }

    /**
     * A confirmClose POST was ACCEPTED by Artemis.
     *
     * TOTAL function (safe from any state):
     *   pending-post   -> candidate-close (consume the owed edge)
     *   open           -> no-op (stale_solved close with no owed progress edge)
     *   candidate-close -> no-op (already consumed; idempotent)
     */
    onPosted(): void {
        if (this._state === 'pending-post') {
            this._state = 'candidate-close';
        }
    }

    /**
     * Iris has responded to the confirmClose.
     *
     * @param resolved - true: slot freed elsewhere (terminal; latch must not re-fire
     *   until reset()); false: back to open, a fresh edge is required before the
     *   latch can owe another close.
     */
    onConfirmResult(resolved: boolean): void {
        if (resolved) {
            this._terminal = true;
        } else {
            this._state = 'open';
            // Require a rise above reArmSBase before the sBase path can fire again.
            this._armed = false;
            this._belowSince = null;
        }
    }

    /**
     * Hard reset to initial state. Called on every slot take / free / replace /
     * discard / terminal transition so a stale owed-close never suppresses a
     * future episode's close.
     */
    reset(): void {
        this._state = 'open';
        this._armed = true;
        this._belowSince = null;
        this._terminal = false;
    }
}
