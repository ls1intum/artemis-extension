/**
 * The chat's "Iris is preparing your hint" indicator, derived from the in-flight marker rather than
 * tracked alongside it.
 *
 * `StruggleInterventionService._setInFlightMarker` is the only writer of the marker's identity in
 * production (every egress/frame call site goes through the port), so feeding this from there means
 * every abort path -- a stale frame, an opt-out, a failed POST, consent revocation, `reset()` --
 * clears the indicator without needing to know it exists.
 */

/** What the indicator needs from the service; deliberately narrower than the whole deps object. */
export interface HelpPendingPort {
    setProactiveThinking(on: boolean): void;
    /** `deps.setTimeoutFn` or a real `setTimeout`. Returns void, so the armed token is the cancellation. */
    schedule(fn: () => void, ms: number): void;
    /** Posted when the deadline elapses, so the student is not left with nothing after their click. */
    postDeadlineNote(): void;
    dbg(msg: string): void;
}

/**
 * How long the chat may claim that Iris is preparing a hint before it stops claiming it. [ENG]
 * Measured round trips are 5-18s; this is the "the reply is never coming" backstop, not a budget.
 */
export const HELP_PENDING_DEADLINE_MS = 60_000;

export class HelpPendingIndicator {
    /** Request token of the in-flight help_request the indicator is currently claiming, if any. */
    private _token: string | undefined;

    constructor(private readonly _port: HelpPendingPort) { }

    /**
     * `token` is the in-flight `help_request`'s request token, or `undefined` for "no student-initiated
     * request in flight". Idempotent: the same token twice does not re-arm the deadline.
     *
     * The deadline is UI-only. It does NOT clear the in-flight marker, because a late reply must
     * still be able to consume it and be attributed to the right episode.
     */
    sync(token: string | undefined): void {
        if (token === this._token) { return; }
        this._token = token;
        this._safely(() => this._port.setProactiveThinking(token !== undefined));
        if (token === undefined) { return; }
        this._port.schedule(() => {
            if (this._token !== token) { return; }
            this._token = undefined;
            this._safely(() => this._port.setProactiveThinking(false));
            this._port.dbg('  -> help_request pending deadline elapsed; indicator cleared, marker left alone');
            this._safely(() => this._port.postDeadlineNote());
        }, HELP_PENDING_DEADLINE_MS);
    }

    /** The chat is a surface, not a dependency: it must never be able to break the engine. */
    private _safely(fn: () => void): void {
        try { fn(); } catch { /* best-effort */ }
    }
}
