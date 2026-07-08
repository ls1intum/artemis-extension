// extension/src/extension/services/struggle/struggleEngine.ts
/**
 * Engine-v3 orchestrator (spec §0-§5): consumes ONLY the sensorHub, computes
 * S/V/boundaries/gates/alerting on a strict 10-s grid (first tick at +10 s,
 * never at 0). One code path for live and replay (spec §5):
 *
 *   - every subscription pushes a timestamped thunk into one queue;
 *   - advanceTo(now) processes each due grid tick: apply all thunks with
 *     ts <= tick (stable-ordered by ts), THEN compute the tick;
 *   - the live interval timer only calls advanceTo(clock.now()) — timer
 *     jitter and missed timers are harmless (catch-up loop, nominal times).
 *
 * Sensor policy at intake mirrors the recorder (the frozen parameters were
 * derived on recorded streams): shouldRecordUri(uri, exerciseRoot) filtering;
 * selection trailing debounce (Decision 5). v3 no longer consumes the editor
 * visibleRange stream (the dropped N4 scroll feature).
 */
import * as vscode from 'vscode';

import type { ResultDTO } from '@extension/domain/submissions';
import type { SensorHub } from '@extension/services/sensing';
import { shouldRecordUri } from '@extension/services/sensing/uriFilter';
import { BoundaryTracker } from '@extension/services/struggle/boundaries/boundaryTracker';
import {
    SELECTION_DEBOUNCE_MS, SPEC, TUNING,
} from '@extension/services/struggle/config';
import { type DecisionAblation, DecisionEngine } from '@extension/services/struggle/decision/decisionEngine';
import { TrailingDebouncer } from '@extension/services/struggle/intake/trailingDebouncer';
import { BuildDeltaTracker } from '@extension/services/struggle/signals/buildDelta';
import { DocumentShadowTracker } from '@extension/services/struggle/signals/documentShadow';
import { N2Tracker, normalizeDiagnosticCode } from '@extension/services/struggle/signals/errorDistance';
import { FeatureWindowTracker } from '@extension/services/struggle/signals/featureWindow';
import { FeedbackViewTracker } from '@extension/services/struggle/signals/feedbackViewState';
import { methodAtLine, parseMethods } from '@extension/services/struggle/signals/javaMethods';
import { A8Tracker } from '@extension/services/struggle/signals/regionPersistence';
import { severityFrom } from '@extension/services/struggle/signals/severity';
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

/** The A8-tracker subset the engine drives. Lets golden-replay (PR 3) inject a
 *  scripted A8 signal in exact mode instead of deriving it online. Widen this
 *  if the engine ever calls another A8Tracker method. */
export type A8TrackerLike = Pick<A8Tracker, 'recordChange' | 'activeAt'>;
/** The N2-tracker subset the engine drives (see A8TrackerLike). */
export type N2TrackerLike = Pick<N2Tracker, 'ingestSelection' | 'ingestSnapshot' | 'activeAt'>;

interface StruggleEngineOptions {
    /** Replay feeds already-debounced recorded streams (Decision 5). */
    preDebouncedIntake?: boolean;
    /** Factories for scripted A8/N2 trackers (golden-replay exact mode, PR 3).
     *  Omitted factories fall back to the real online trackers. */
    trackers?: { a8?: () => A8TrackerLike; n2?: () => N2TrackerLike };
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
    private _feedback = new FeedbackViewTracker();
    private _shadow = new DocumentShadowTracker();
    private _a8: A8TrackerLike = new A8Tracker();
    private _n2: N2TrackerLike = new N2Tracker();
    private _buildDelta = new BuildDeltaTracker();
    private _testStagnation = new TestStagnationTracker(TUNING.testStagnationN);
    private _boundaries = new BoundaryTracker();
    private _decision = new DecisionEngine();
    /** Dev skip-warmup (D1). When true the engine uses warmupS=0 for BOTH the
     *  STATE-boundary emission and the decision D1 gate. */
    private _skipWarmup = false;
    private _selectionDebounce: TrailingDebouncer<{ tsS: number; uriKey: string; endLine: number }> | undefined;
    /** Replay feeds already-debounced recorded streams (Decision 5). */
    private readonly _preDebounced: boolean;
    private readonly _opts: StruggleEngineOptions | undefined;

    constructor(
        hub: SensorHub,
        clock: EngineClock = DEFAULT_CLOCK,
        options?: StruggleEngineOptions,
    ) {
        this._hub = hub;
        this._clock = clock;
        this._opts = options;
        this._preDebounced = options?.preDebouncedIntake ?? false;
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
        // explicitly via stop() when drain semantics are wanted (PR 2c session
        // fan-out does stop() then start()). This keeps start() safe for
        // tests/replay that control time themselves.
        this._teardown();
        this._session = session;
        this._resetState();
        this._attach();
        // Seed document shadows from the already-open documents (A8 before-text).
        for (const doc of this._hub.readTextDocuments()) {
            if (this._passesUriFilter(doc.uri)) {
                this._shadow.seed(doc.uri.toString(), doc.getText());
            }
        }
        this._timer = this._clock.setInterval(() => this.advanceTo(this._clock.now()), SPEC.TICK_S * 1000);
    }

    /** Normal session end: final drain, then teardown. A grid tick that is
     *  already DUE at stop time must not lose events to timer jitter (flush
     *  the debouncers, run every due tick); events after the last due tick
     *  lapse (Python rule, Decision 1). */
    stop(): void {
        if (this._session !== undefined) {
            this._selectionDebounce?.flush();
            this.advanceTo(this._clock.now());
        }
        this._teardown();
    }

    /** Abort path: teardown WITHOUT the final drain (used by dispose; also
     *  what tests with a real default clock rely on — a drain against real
     *  Date.now() would catch up across the whole fake-session span). */
    private _teardown(): void {
        if (this._timer !== undefined) {
            this._clock.clearInterval(this._timer);
            this._timer = undefined;
        }
        for (const sub of this._subscriptions.splice(0)) {
            sub.dispose();
        }
        this._selectionDebounce?.dispose();
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
        this._selectionDebounce = new TrailingDebouncer(SELECTION_DEBOUNCE_MS, p => {
            this._enqueue(p.tsS, () => this._n2.ingestSelection(p.tsS, p.uriKey, p.endLine));
        });

        subs.push(this._hub.onDidChangeTextDocument(signal => {
            const uri = signal.event.document.uri;
            if (!this._passesUriFilter(uri)) {
                return;
            }
            const tsS = this._relS(signal.ts);
            const uriKey = uri.toString();
            const changes = signal.event.contentChanges.map(c => ({
                oneChar: c.rangeLength === 0 && c.text.length === 1,
                startLine: c.range.start.line,
            }));
            const before = this._shadow.beforeText(uriKey);
            const afterText = signal.event.document.getText();
            this._shadow.sync(uriKey, afterText);
            this._enqueue(tsS, () => {
                this._features.ingestTextChange(tsS, changes.filter(c => c.oneChar).length);
                if (before !== undefined) {
                    const methods = parseMethods(before);     // once per event
                    for (const c of changes) {
                        this._a8.recordChange(tsS, uriKey, methodAtLine(methods, c.startLine)?.name ?? null);
                    }
                }
            });
        }));

        subs.push(this._hub.onDidOpenTextDocument(({ document }) => {
            if (this._passesUriFilter(document.uri)) {
                this._shadow.seed(document.uri.toString(), document.getText());
            }
        }));

        subs.push(this._hub.onDidChangeTextEditorSelection(signal => {
            const uri = signal.event.textEditor.document.uri;
            if (!this._passesUriFilter(uri) || signal.event.selections.length === 0) {
                return;
            }
            const payload = {
                tsS: this._relS(signal.ts),
                uriKey: uri.toString(),
                endLine: signal.event.selections[0].end.line,
            };
            if (this._preDebounced) {
                this._enqueue(payload.tsS, () => this._n2.ingestSelection(payload.tsS, payload.uriKey, payload.endLine));
            } else {
                this._selectionDebounce!.push(payload.uriKey, payload);
            }
        }));

        subs.push(this._hub.onDidChangeDiagnostics(signal => {
            const tsS = this._relS(signal.ts);
            for (const uri of signal.uris) {
                if (!this._passesUriFilter(uri)) {
                    continue;
                }
                const errors = this._hub.readDiagnostics(uri)
                    .filter(d => d.severity === vscode.DiagnosticSeverity.Error)
                    .map(d => ({
                        line: d.range.start.line,
                        code: normalizeDiagnosticCode(d.code),
                        message: d.message,
                    }));
                const uriKey = uri.toString();
                this._enqueue(tsS, () => this._n2.ingestSnapshot(tsS, uriKey, errors));
            }
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
                if (c.isFMPlus) {
                    this._boundaries.ingest('FM_PLUS', tsS);
                }
                // Discrete add-on: a Test-Stagnation fire is assigned to this
                // build's tick (the drain runs before the tick computes).
                if (this._testStagnation.ingest(c)) {
                    this._pendingTestStagnation = true;
                }
            });
        }));

        subs.push(this._hub.onTaskFeedbackView(signal => {
            const tsS = this._relS(signal.ts);
            this._enqueue(tsS, () => this._feedback.ingest(tsS, signal.action, signal.viewId));
        }));
    }

    // ── tick ───────────────────────────────────────────────────────────

    private _drainUpTo(tS: number): void {
        // Stable order by ts: debounced emissions enqueue out of arrival order.
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
        const w0 = tS - wf.effectiveWindowS;
        const fFb: 0 | 1 = this._feedback.openOverlapping(w0, tS) ? 1 : 0;
        const fA8: 0 | 1 = this._a8.activeAt(tS) ? 1 : 0;
        const fN2: 0 | 1 = this._n2.activeAt(tS) ? 1 : 0;
        const { sBase, s } = severityFrom(wf, { fFb, fA8, fN2 });
        const boundaries = this._boundaries.flagsAt(tS, wf.tsState, this._warmupS);
        const graceActive = this._lastFmBadS !== null
            && this._lastFmBadS <= tS
            && tS - this._lastFmBadS <= SPEC.GRACE_S;

        // Schicht 3: the DecisionEngine owns the alert decision. It thresholds on
        // urgency = sBase; s (bonus severity) travels as telemetry only.
        const engineTick: EngineTick = {
            t: tS,
            urgency: sBase,
            editCandidate: { boundaries, typingRate: wf.typingRate, graceActive },
            discreteTriggers: { testStagnation: this._pendingTestStagnation },
            telemetry: { s },
        };
        this._pendingTestStagnation = false;            // consumed by this tick
        const decision = this._decision.decide(engineTick);
        const decisionTrace = this._decision.lastTrace;

        const tsMs = (this._session?.sessionStartMs ?? 0) + tS * 1000;
        const alert: AlertRecord | null = decision === null ? null : { ...decision, ts: tsMs };
        const record: TickRecord = {
            t: tS,
            ts: tsMs,
            features: { t: tS, ...wf, fFb, fA8, fN2 },
            sBase,
            s,
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
        this._feedback = new FeedbackViewTracker();
        this._shadow = new DocumentShadowTracker();
        this._a8 = this._opts?.trackers?.a8?.() ?? new A8Tracker();
        this._n2 = this._opts?.trackers?.n2?.() ?? new N2Tracker();
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
