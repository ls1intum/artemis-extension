import * as vscode from 'vscode';

export type IrisAvailabilityKind = 'enabled' | 'disabled' | 'unavailable';

export interface IrisEnabledCacheDeps {
    /** Resolve current Iris availability for the given exercise (courseId resolution + classify). */
    classify: (exerciseId: number) => Promise<IrisAvailabilityKind>;
    onSessionStart: vscode.Event<void>;
    onSessionEnd: vscode.Event<void>;
    /** Fires on websocket (re)connect; re-classifies a transient 'unavailable'. */
    onReconnect: vscode.Event<void>;
    getActiveExerciseId: () => number | undefined;
    /** Schedule a delayed callback; returns a cancel fn (injected for testability). */
    schedule: (fn: () => void, ms: number) => () => void;
    /** Bounded backoff for 'unavailable' retries. */
    retryDelaysMs?: number[];
}

const DEFAULT_RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

/**
 * Fail-closed, exercise-session-keyed Iris-availability cache. isEnabled() is true ONLY when the
 * last successful classify for the CURRENT session returned 'enabled'. Keyed to the struggle
 * exercise session (not chat context): its only refresh triggers are onSessionStart / onSessionEnd
 * / onReconnect. Single-flight + staleness-guarded per session token.
 */
export class IrisEnabledCache {
    private _state: IrisAvailabilityKind | 'unknown' = 'unknown';
    private _token = 0;              // bumped on every session start/end; invalidates in-flight work
    private _inFlightToken: number | undefined;
    private _retryIndex = 0;
    private _cancelRetry: (() => void) | undefined;
    private readonly _subs: vscode.Disposable[] = [];
    private readonly _retryDelays: number[];

    constructor(private readonly _deps: IrisEnabledCacheDeps) {
        this._retryDelays = _deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
        this._subs.push(_deps.onSessionStart(() => this._onSessionStart()));
        this._subs.push(_deps.onSessionEnd(() => this._onSessionEnd()));
        this._subs.push(_deps.onReconnect(() => {
            // Only refill the recovery budget + re-dispatch when idle: if a retry classify is already
            // in-flight, resetting _retryIndex here would let that in-flight result consume a refilled
            // budget (a surprising, timing-dependent extra retry cycle). Wait for it to land instead.
            if (this._state === 'unavailable' && this._inFlightToken === undefined) {
                this._retryIndex = 0;          // reconnect = a fresh recovery budget
                this._refresh(this._token);
            }
        }));
        // Backstop: a session may already be active when we are constructed.
        if (_deps.getActiveExerciseId() !== undefined) { this._onSessionStart(); }
    }

    isEnabled(): boolean {
        return this._state === 'enabled';
    }

    dispose(): void {
        // Bump the token FIRST so any still-pending classify resolves as stale in _apply
        // (oldToken !== this._token) and cannot mutate state or arm a post-disposal retry timer.
        this._token++;
        this._cancelRetry?.();
        this._cancelRetry = undefined;
        this._subs.forEach((d) => { d.dispose(); });
    }

    /** Engine session started: invalidate in-flight work, reset fail-closed, classify. */
    private _onSessionStart(): void {
        this._resetForTransition();
        if (this._deps.getActiveExerciseId() !== undefined) {
            this._refresh(this._token);
        }
    }

    /** Engine session ended (exercise end OR consent revoke, #349): reset WITHOUT
     *  re-kicking - on a revoke the exercise bookkeeping stays active, but Iris
     *  availability is only needed again once an engine session starts. */
    private _onSessionEnd(): void {
        this._resetForTransition();
    }

    /** Any session transition: invalidate in-flight work and reset fail-closed. */
    private _resetForTransition(): void {
        this._token++;
        this._state = 'unknown';
        this._retryIndex = 0;
        this._cancelRetry?.();
        this._cancelRetry = undefined;
    }

    private _refresh(token: number): void {
        if (token !== this._token) { return; }                 // stale trigger
        if (this._inFlightToken === token) { return; }          // single-flight
        const exerciseId = this._deps.getActiveExerciseId();
        if (exerciseId === undefined) { return; }
        this._inFlightToken = token;
        void this._deps.classify(exerciseId).then(
            (kind) => this._apply(token, kind),
            () => this._apply(token, 'unavailable'),
        );
    }

    private _apply(token: number, kind: IrisAvailabilityKind): void {
        if (this._inFlightToken === token) { this._inFlightToken = undefined; }
        if (token !== this._token) { return; }                  // session changed mid-flight → drop
        this._state = kind;
        // enabled/disabled are terminal: cancel any pending retry so a stale timer cannot re-classify.
        if (kind !== 'unavailable') {
            this._cancelRetry?.();
            this._cancelRetry = undefined;
            return;
        }
        // 'unavailable': bounded retry-with-backoff (a finite budget, NOT an infinite capped-delay loop).
        if (this._retryIndex >= this._retryDelays.length) { return; }   // budget exhausted
        const delay = this._retryDelays[this._retryIndex];
        this._retryIndex++;
        this._cancelRetry?.();
        this._cancelRetry = this._deps.schedule(() => this._refresh(token), delay);
    }
}
