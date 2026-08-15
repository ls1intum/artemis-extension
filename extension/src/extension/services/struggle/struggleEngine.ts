// extension/src/extension/services/struggle/struggleEngine.ts
/**
 * Engine-v3 orchestrator (spec §0-§5): consumes ONLY the sensorHub, computes
 * severity/boundaries/gates/alerting on a strict 10-s grid (first tick at
 * +10 s, never at 0). One code path for live and replay (spec §5):
 *
 *   - every subscription pushes a timestamped thunk into one queue;
 *   - advanceTo(now) processes each due grid tick: apply all thunks with
 *     ts <= tick (stable-ordered by ts), THEN compute the tick;
 *   - the live interval timer only calls advanceTo(clock.now()) — timer
 *     jitter and missed timers are harmless (catch-up loop, nominal times).
 *
 * Sensor policy at intake mirrors the recorder (the frozen parameters were
 * derived on recorded streams): shouldRecordUri(uri, exerciseRoot) filtering.
 * v3 does not consume the editor visibleRange stream (no N4 scroll feature).
 */
import * as vscode from 'vscode';

import type { ResultDTO } from '@extension/domain/submissions';
import type { SensorHub } from '@extension/services/sensing';
import { shouldRecordUri } from '@extension/services/sensing/uriFilter';
import { BoundaryTracker } from '@extension/services/struggle/boundaries/boundaryTracker';
import { SPEC, TUNING } from '@extension/services/struggle/config';
import { type DecisionAblation, DecisionEngine } from '@extension/services/struggle/decision/decisionEngine';
import { BuildDeltaTracker } from '@extension/services/struggle/signals/buildDelta';
import { FeatureWindowTracker } from '@extension/services/struggle/signals/featureWindow';
import { TestStagnationTracker } from '@extension/services/struggle/signals/testStagnation';
import type {
    AlertRecord, EngineClock, EngineSessionContext, EngineTick, TickRecord,
} from '@extension/services/struggle/types';

const DEFAULT_CLOCK: EngineClock = {
    now: () => Date.now(),
    setInterval: (cb, ms) => setInterval(cb, ms),
    clearInterval: handle => clearInterval(handle as Parameters<typeof clearInterval>[0]),
};

interface QueuedEvent { tsS: number; apply: () => void }

interface StruggleEngineOptions {
    /** Ablation toggles for the DecisionEngine add-ons. The golden-replay harness
     *  passes validated-base mode (add-ons OFF); production leaves them ON. */
    decision?: DecisionAblation;
}

export class StruggleEngine implements vscode.Disposable {
    private readonly _hub: SensorHub;
    private readonly _clock: EngineClock;

    private readonly _onDidTick = new vscode.EventEmitter<TickRecord>();
    readonly onDidTick = this._onDidTick.event;
    private readonly _onDidAlert = new vscode.EventEmitter<AlertRecord>();
    readonly onDidAlert = this._onDidAlert.event;

    // Session state (rebuilt on every start()).
    private _session: EngineSessionContext | undefined;
    private _subscriptions: vscode.Disposable[] = [];
    private _timer: unknown;
    private _queue: QueuedEvent[] = [];
    private _nextTickS = SPEC.TICK_S;
    private _lastFmBadS: number | null = null;
    /** Set when a build assigned to the current tick is a Test-Stagnation fire;
     *  read into the EngineTick's discreteTriggers, then cleared each tick. */
    private _pendingTestStagnation = false;

    private _features = new FeatureWindowTracker();
    private _buildDelta = new BuildDeltaTracker();
    private _testStagnation = new TestStagnationTracker(TUNING.testStagnationN);
    private _boundaries = new BoundaryTracker();
    private _decision = new DecisionEngine();
    /** Dev skip-warmup (D1). When true the engine uses warmupS=0 for BOTH the
     *  STATE-boundary emission and the decision D1 gate. */
    private _skipWarmup = false;
    private readonly _opts: StruggleEngineOptions | undefined;

    constructor(
        hub: SensorHub,
        clock: EngineClock = DEFAULT_CLOCK,
        options?: StruggleEngineOptions,
    ) {
        this._hub = hub;
        this._clock = clock;
        this._opts = options;
    }

    /** Effective D1 warm-up window (s): 0 when dev skip-warmup is on. Read live
     *  each tick by the STATE-boundary path and by the decision D1 gate. */
    private get _warmupS(): number { return this._skipWarmup ? 0 : SPEC.WARMUP_S; }

    /** Dev command: skip (or restore) the D1 warm-up window. Applies live to the
     *  running session (STATE boundaries + decision gate) and to every future one. */
    setSkipWarmup(skip: boolean): void {
        this._skipWarmup = skip;
        this._decision.setWarmupS(this._warmupS);
    }

    start(session: EngineSessionContext): void {
        // Teardown only (no final drain): the CALLER ends the previous session
        // explicitly via stop() when drain semantics are wanted. This keeps
        // start() safe for tests/replay that control time themselves.
        this._teardown();
        this._session = session;
        this._resetState();
        this._attach();
        this._timer = this._clock.setInterval(() => this.advanceTo(this._clock.now()), SPEC.TICK_S * 1000);
    }

    /** Normal session end: final drain, then teardown. A grid tick that is
     *  already DUE at stop time must not lose events to timer jitter (run
     *  every due tick); events after the last due tick lapse (Python rule,
     *  Decision 1). */
    stop(): void {
        if (this._session !== undefined) {
            this.advanceTo(this._clock.now());
        }
        this._teardown();
    }

    /** Consent revoked mid-session (#349): teardown WITHOUT the final drain. stop()
     *  would still process every due tick (and could emit a final alert) from
     *  observations up to the revoke moment; a revoke must not compute anything.
     *  Same teardown dispose() uses, but without disposing the event emitters. */
    abort(): void {
        this._teardown();
    }

    /** Shared teardown, WITHOUT the final drain. Tests with a real default clock
     *  rely on that: a drain against real Date.now() would catch up across the
     *  whole fake-session span. */
    private _teardown(): void {
        if (this._timer !== undefined) {
            this._clock.clearInterval(this._timer);
            this._timer = undefined;
        }
        for (const sub of this._subscriptions.splice(0)) {
            sub.dispose();
        }
        this._session = undefined;
    }

    dispose(): void {
        this._teardown();
        this._onDidTick.dispose();
        this._onDidAlert.dispose();
    }

    /** Process every due grid tick <= now. Public: replay and tests drive this directly. */
    advanceTo(nowMs: number): void {
        if (this._session === undefined) {
            return;
        }
        const nowS = (nowMs - this._session.sessionStartMs) / 1000;
        while (this._nextTickS <= nowS) {
            this._runTick(this._nextTickS);
            this._nextTickS += SPEC.TICK_S;
        }
    }

    /** Session-relative seconds of the last bad-build (FM) that armed the B4 grace window,
     *  or null when no grace is active. Exposed for the dev debug snapshot's grace countdown
     *  (telemetry only; the decision reads grace internally via `graceActive`). */
    get lastFmBadS(): number | null { return this._lastFmBadS; }

    /** Test-stagnation add-on state for the dev debug snapshot (telemetry only). `enabled`
     *  reflects the production ablation default; golden-replay overrides pass their own
     *  DecisionEngine ablation and never read this. */
    getTestStagnationState(): { enabled: boolean; streak: number; n: number } {
        return {
            enabled: this._opts?.decision?.enableTestStagnation ?? TUNING.enableTestStagnation,
            streak: this._testStagnation.streak,
            n: this._testStagnation.n,
        };
    }

    // ── intake ─────────────────────────────────────────────────────────

    private _relS(tsMs: number): number {
        return (tsMs - (this._session?.sessionStartMs ?? 0)) / 1000;
    }

    private _passesUriFilter(uri: vscode.Uri): boolean {
        return shouldRecordUri(uri, this._session?.exerciseRoot);
    }

    private _enqueue(tsS: number, apply: () => void): void {
        if (tsS < 0) {
            return;                       // pre-session signal: ignore
        }
        this._queue.push({ tsS, apply });
    }

    private _attach(): void {
        const subs = this._subscriptions;

        subs.push(this._hub.onDidChangeTextDocument(signal => {
            const uri = signal.event.document.uri;
            if (!this._passesUriFilter(uri)) {
                return;
            }
            const tsS = this._relS(signal.ts);
            const nOneChar = signal.event.contentChanges
                .filter(c => c.rangeLength === 0 && c.text.length === 1).length;
            this._enqueue(tsS, () => this._features.ingestTextChange(tsS, nOneChar));
        }));

        subs.push(this._hub.onDidEndTerminalShellExecution(signal => {
            const tsS = this._relS(signal.ts);
            this._enqueue(tsS, () => this._boundaries.ingest('E4', tsS));
        }));

        subs.push(this._hub.onPasteDetected(signal => {
            if (!this._passesUriFilter(signal.uri)) {
                return;
            }
            const tsS = this._relS(signal.ts);
            this._enqueue(tsS, () => this._boundaries.ingest('N1', tsS));
        }));

        subs.push(this._hub.onBuildResult(signal => {
            const tsS = this._relS(signal.ts);
            const result: ResultDTO = signal.result;
            this._enqueue(tsS, () => {
                const c = this._buildDelta.ingest(tsS, result);
                if (c.isFM) {
                    this._boundaries.ingest('FM', tsS);
                    this._lastFmBadS = tsS;
                }
                // Discrete add-on: a Test-Stagnation fire is assigned to this
                // build's tick (the drain runs before the tick computes).
                if (this._testStagnation.ingest(c)) {
                    this._pendingTestStagnation = true;
                }
            });
        }));
    }

    // ── tick ───────────────────────────────────────────────────────────

    private _drainUpTo(tS: number): void {
        // Stable order by ts: events still enqueue out of arrival order across sensors.
        this._queue.sort((a, b) => a.tsS - b.tsS);
        let consumed = 0;
        while (consumed < this._queue.length && this._queue[consumed].tsS <= tS) {
            this._queue[consumed].apply();
            consumed++;
        }
        this._queue.splice(0, consumed);
    }

    private _runTick(tS: number): void {
        this._drainUpTo(tS);

        const wf = this._features.computeAt(tS);
        // The one severity: sBase = (f_typing + f_gap) / 2 — the value the decision thresholds on.
        const sBase = (wf.fTyping + wf.fGap) / 2;
        const boundaries = this._boundaries.flagsAt(tS, wf.tsState, this._warmupS);
        const graceActive = this._lastFmBadS !== null
            && this._lastFmBadS <= tS
            && tS - this._lastFmBadS <= SPEC.GRACE_S;

        const engineTick: EngineTick = {
            t: tS,
            urgency: sBase,
            editCandidate: { boundaries, typingRate: wf.typingRate, graceActive },
            discreteTriggers: { testStagnation: this._pendingTestStagnation },
        };
        this._pendingTestStagnation = false;            // consumed by this tick
        const decision = this._decision.decide(engineTick);
        const decisionTrace = this._decision.lastTrace;

        const tsMs = (this._session?.sessionStartMs ?? 0) + tS * 1000;
        const alert: AlertRecord | null = decision === null ? null : { ...decision, ts: tsMs };
        const record: TickRecord = {
            t: tS,
            ts: tsMs,
            features: { t: tS, ...wf },
            sBase,
            boundariesPreGate: boundaries,
            alert,
            decisionTrace,
        };
        this._onDidTick.fire(record);
        if (alert !== null) {
            this._onDidAlert.fire(alert);
        }
    }

    private _resetState(): void {
        this._queue = [];
        this._nextTickS = SPEC.TICK_S;
        this._lastFmBadS = null;
        this._pendingTestStagnation = false;
        this._features = new FeatureWindowTracker();
        this._buildDelta = new BuildDeltaTracker();
        this._testStagnation = new TestStagnationTracker(TUNING.testStagnationN);
        this._boundaries = new BoundaryTracker();
        // Golden-replay overrides with validated-base mode; production defaults
        // the ablation from TUNING (add-ons on).
        this._decision = new DecisionEngine(
            this._skipWarmup ? { warmupS: 0 } : undefined,
            this._opts?.decision ?? { enableTestStagnation: TUNING.enableTestStagnation },
        );
    }
}
