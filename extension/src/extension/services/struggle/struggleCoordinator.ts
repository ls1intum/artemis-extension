// extension/src/extension/services/struggle/struggleCoordinator.ts
import * as vscode from 'vscode';

import type { StruggleDebugSnapshot } from '@shared/messageContracts';

import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { SensorHub } from '@extension/services/sensing';
import { shouldAcceptBuildResult } from '@extension/services/sensing/buildResultGuard';
import type { AlertSink } from '@extension/services/struggle/alerting/alertSink';
import { SPEC } from '@extension/services/struggle/config';
import { StruggleEngine } from '@extension/services/struggle/struggleEngine';
import type { AlertRecord, EngineClock, StruggleSnapshot, TickRecord } from '@extension/services/struggle/types';
import type { ArtemisWebsocketService } from '@extension/services/websocket/artemisWebsocketService';
import type { ResultDTO, WebSocketMessageHandler } from '@extension/types';

import { toLiveDecisionTrace } from './live/traceMap';

/** One-line summary of an alert for the snapshot/debug UI (kind-aware). */
function summarizeAlert(a: AlertRecord): { t: number; kind: 'edit' | 'discrete'; summary: string } {
    return a.kind === 'edit'
        ? { t: a.t, kind: 'edit', summary: `${a.types.join('+')} ${a.path}` }
        : { t: a.t, kind: 'discrete', summary: a.trigger };
}

// Real clock used in production when none is injected; mirror the engine's DEFAULT_CLOCK.
const DEFAULT_CLOCK: EngineClock = {
    now: () => Date.now(),
    setInterval: (cb, ms) => setInterval(cb, ms),
    clearInterval: handle => clearInterval(handle as Parameters<typeof clearInterval>[0]),
};

/** #349: the coordinator's detection-consent gate. isGranted() is true exactly while
 *  the proactive-egress consent is 'enabled'; onDidChange fires on any change of the
 *  underlying setting. REQUIRED (fail-closed): detection must never run unconsented
 *  because a construction site forgot the gate. */
export interface DetectionConsent {
    isGranted(): boolean;
    onDidChange: vscode.Event<void>;
}

export interface StruggleCoordinatorDeps {
    hub: SensorHub;
    alertSink: AlertSink;
    detectionConsent: DetectionConsent;
    exerciseRegistry?: ExerciseRegistry;
    clock?: EngineClock;
}

/**
 * Owns the struggle engine (the live decision path). Replaces the v1 TelemetryManager.
 *
 * Responsibilities:
 *  - WebSocket build-result producer: guard → hub.emitBuildResult (engine).
 *  - Engine alert → AlertSink (single-level delivery).
 *  - Expose onDidAlert / onDidTick for the recorder (subscribed by
 *    activation/sessionRecorderWiring; clean-bundle inversion, Decision 1).
 *  - getSnapshot() for the debug UI.
 *  - Exercise session lifecycle.
 */
export class StruggleCoordinator implements vscode.Disposable, WebSocketMessageHandler {
    private readonly _hub: SensorHub;
    private readonly _alertSink: AlertSink;
    private readonly _exerciseRegistry: ExerciseRegistry | undefined;
    private readonly _detectionConsent: DetectionConsent;
    /** #349: true only while the engine observes (started under consent). Exercise
     *  bookkeeping (_activeExerciseId/_activeExerciseRoot) exists independently. */
    private _engineRunning = false;
    private readonly _engine: StruggleEngine;
    private readonly _clock: EngineClock;
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _onDidStartSession = new vscode.EventEmitter<void>();
    private readonly _onDidEndSession = new vscode.EventEmitter<void>();
    private _activeExerciseId: number | undefined;
    private _activeExerciseRoot: vscode.Uri | undefined;
    private _sessionStartMs = 0;
    private _lastTick: TickRecord | undefined;
    private _lastAlert: AlertRecord | undefined;
    /** Dev-only: D1 warm-up skip (toggled by the developer command). */
    private _skipWarmup = false;
    /** Maximum passed-test count seen in the active session (-1 = no build yet). Reset on each new session. */
    private _maxPassedTestCount = -1;
    /** Test-set size (denominator) the current max was measured against (-1 = none yet). A changed
     *  denominator makes the old high incomparable, so the baseline is re-established (mirrors the
     *  engine's TestStagnationTracker). Reset on each new session. */
    private _refTestCaseCount = -1;

    constructor(deps: StruggleCoordinatorDeps) {
        this._hub = deps.hub;
        this._alertSink = deps.alertSink;
        this._exerciseRegistry = deps.exerciseRegistry;
        this._detectionConsent = deps.detectionConsent;
        this._clock = deps.clock ?? DEFAULT_CLOCK;
        this._engine = new StruggleEngine(this._hub, this._clock);
        this._disposables.push(this._onDidStartSession, this._onDidEndSession);

        // Engine alert → sink + snapshot bookkeeping. Delivery is ungated here (#352):
        // consent gates the engine itself (#349), and the per-exercise level plus the
        // throttle gate the surfaces downstream.
        this._disposables.push(this._engine.onDidAlert(alert => {
            this._lastAlert = alert;
            this._alertSink.deliver(alert);
        }));
        this._disposables.push(this._engine.onDidTick(tick => { this._lastTick = tick; }));

        this._disposables.push(this._detectionConsent.onDidChange(() => this._reconcileConsent()));
    }

    // ── WebSocket handler (build-result producer) ──────────────────────
    onNewResult(result: ResultDTO): void {
        // #349: without a running (= consented) engine a build result must not be
        // observed - no hub emit, no baseline mutation, no progress-latch signal.
        if (!this._engineRunning) { return; }
        if (!shouldAcceptBuildResult(result, this._activeExerciseId, this._exerciseRegistry)) { return; }
        this._hub.emitBuildResult(result);          // engine (FM/improved + test stagnation)
        // Detect a strict new high in passed tests and notify the alert sink so the orchestrator's
        // progress-close latch can observe the green-test path. Mirror the guards the engine applies
        // to its own trackers so a raw backend field can never fake progress and wrongly stand down a
        // live intervention.
        const buildFailed = result.submission?.buildFailed ?? false;
        const passed = result.passedTestCaseCount;
        const total = result.testCaseCount;
        // Failed/compile-error build: no comparable test info (BuildDeltaTracker nulls both counts).
        // Never green; leave both baseline fields untouched so a stale backend count cannot poison them.
        if (buildFailed) {
            this._alertSink.onNewBuildResult?.(false);
            return;
        }
        // Malformed / internally-inconsistent counts (mirrors TestStagnationTracker's validity guard):
        // a non-positive denominator, a negative passed count, or passed > total carries no real progress
        // signal. Skip it — not green, baseline untouched — so a bogus backend payload cannot fake a new high.
        if ((typeof total === 'number' && total <= 0)
            || (typeof passed === 'number' && passed < 0)
            || (typeof passed === 'number' && typeof total === 'number' && passed > total)) {
            this._alertSink.onNewBuildResult?.(false);
            return;
        }
        // Changed test set: the old high is not comparable to counts against a different denominator, so
        // re-baseline SILENTLY (mirrors TestStagnationTracker). Defer the re-baseline until a build that
        // actually carries a passed count — a half-null build is incomplete and must not shift the baseline.
        if (typeof total === 'number' && this._refTestCaseCount !== -1 && total !== this._refTestCaseCount) {
            if (typeof passed === 'number') {
                this._maxPassedTestCount = passed;
                this._refTestCaseCount = total;
            }
            this._alertSink.onNewBuildResult?.(false);
            return;
        }
        // Record the denominator the first time we see one, so a later change is detectable.
        if (typeof total === 'number' && this._refTestCaseCount === -1) {
            this._refTestCaseCount = total;
        }
        const isNewGreen = typeof passed === 'number' && passed > this._maxPassedTestCount;
        if (isNewGreen) { this._maxPassedTestCount = passed; }
        this._alertSink.onNewBuildResult?.(isNewGreen);
    }

    private _websocketService: ArtemisWebsocketService | undefined;

    setWebsocketService(ws: ArtemisWebsocketService): void {
        this._websocketService = ws;
        ws.registerMessageHandler(this);     // coordinator implements WebSocketMessageHandler (onNewResult)
    }

    // ── Recorder feed (subscribed by sessionRecorderWiring) ────────────
    get onDidAlert() { return this._engine.onDidAlert; }
    get onDidTick() { return this._engine.onDidTick; }

    /** Fires after a new exercise session is live (engine started). Activation
     *  subscribes this to clear the live-feed buffer; the coordinator stays
     *  UI-agnostic (it only emits the event, it never owns the feed). */
    get onDidStartSession(): vscode.Event<void> { return this._onDidStartSession.event; }

    /** Fires when the active exercise session ends (engine stopped). Lets the
     *  live-view feed flip its session indicator back to inactive. */
    get onDidEndSession(): vscode.Event<void> { return this._onDidEndSession.event; }

    // ── Session lifecycle ──────────────────────────────────────────────
    startExerciseSession(exerciseId: number, exerciseRoot?: vscode.Uri): void {
        if (this._activeExerciseId === exerciseId) {
            // #349: while consent is pending the engine has not started, so a repeat
            // call may carry a better root - remember it for the eventual start.
            if (!this._engineRunning && exerciseRoot !== undefined) {
                this._activeExerciseRoot = exerciseRoot;
            }
            return;
        }
        if (this._activeExerciseId !== undefined) { this.endExerciseSession(); }
        this._activeExerciseId = exerciseId;
        this._activeExerciseRoot = exerciseRoot;
        this._maxPassedTestCount = -1;  // reset per-exercise baseline
        this._refTestCaseCount = -1;
        // New exercise session: reset the sink's per-session throttle budget AND clear
        // any stale intervention (resetSession falls back to reset when unsupported).
        // The budget is exercise-scoped: consent flips (below) never touch it.
        if (this._alertSink.resetSession) {
            this._alertSink.resetSession();
        } else {
            this._alertSink.reset?.();
        }
        if (this._detectionConsent.isGranted()) {
            this._startEngine();
        }
        // #349: without consent this is bookkeeping only - the engine (and the start
        // event) waits for _reconcileConsent. Nothing is observed before opt-in.
    }

    /** Start the engine for the already-recorded exercise. sessionStartMs is the
     *  ACTUAL engine start (= grant time on a mid-session grant), so D1 warmup and
     *  all session-relative timing restart fresh - nothing was observed before. */
    private _startEngine(): void {
        this._sessionStartMs = this._clock.now();
        this._engine.start({ sessionStartMs: this._sessionStartMs, exerciseRoot: this._activeExerciseRoot });
        this._engineRunning = true;
        this._lastTick = undefined;
        this._lastAlert = undefined;
        // Session is live: notify activation so the live-feed buffer clears
        // (fired last so the clear lands once the new session is fully started).
        this._onDidStartSession.fire();
    }

    /** #349: idempotent consent reconciliation (subscribed to detectionConsent.onDidChange). */
    private _reconcileConsent(): void {
        if (this._detectionConsent.isGranted()) {
            // Mid-session grant: start now, fresh. No exercise open -> nothing to do.
            if (this._activeExerciseId !== undefined && !this._engineRunning) {
                this._startEngine();
            }
            return;
        }
        // Mid-session revoke: fail closed FIRST, then abort WITHOUT the final drain
        // (stop() would still compute due ticks from just-revoked observations).
        if (this._engineRunning) {
            this._engineRunning = false;
            this._engine.abort();
            if (this._alertSink.onConsentRevoked) {
                this._alertSink.onConsentRevoked();
            } else {
                this._alertSink.reset?.();
            }
            this._onDidEndSession.fire();
        }
    }

    /** ms epoch of the active session start (test/replay helper). */
    get sessionStartMs(): number { return this._sessionStartMs; }

    /** Active exercise id (undefined between sessions). Read by the proactive
     *  intervention orchestrator to key the egress endpoint. */
    get activeExerciseId(): number | undefined { return this._activeExerciseId; }

    /** Active exercise workspace root (undefined between sessions). Read by the
     *  orchestrator for file collection + the `.noai` marker probe. */
    get activeExerciseRoot(): vscode.Uri | undefined { return this._activeExerciseRoot; }

    /** Drive the engine's grid ticks deterministically (tests/replay; production
     *  uses the engine's own interval timer). */
    advanceTo(nowMs: number): void { this._engine.advanceTo(nowMs); }

    endExerciseSession(): void {
        if (this._activeExerciseId === undefined) { return; }
        const engineRan = this._engineRunning;
        if (engineRan) {
            // Normal end keeps the final-drain semantics. stop() BEFORE flipping
            // _engineRunning: the drain can synchronously emit ticks/alerts, and
            // consumers reading the snapshot inside those events must still see a
            // live session. (Revocation is the opposite: fail closed first, abort.)
            this._engine.stop();
            this._engineRunning = false;
        }
        this._activeExerciseId = undefined;
        this._activeExerciseRoot = undefined;
        // #349: the session events mean ENGINE transitions (status bar, live feed,
        // Iris cache). A session whose engine never ran ends without an end event.
        if (engineRan) { this._onDidEndSession.fire(); }
    }

    // ── Debug snapshot ─────────────────────────────────────────────────
    getSnapshot(): StruggleSnapshot {
        // No running engine: return a clean inactive state. `_lastTick` persists after
        // endExerciseSession(), so without this guard the snapshot — and the developer urgency
        // meter that renders from it — would surface stale data from the previous session.
        if (!this._engineRunning) {
            return { isStruggling: false, urgency: 0, primaryBoundary: null, lastAlert: null, sessionSeconds: 0 };
        }
        const tick = this._lastTick;
        // v3: isStruggling thresholds on urgency = S_base (the live decision signal).
        return {
            isStruggling: tick ? tick.sBase >= SPEC.THETA_FULL : false,
            urgency: tick?.sBase ?? 0,
            primaryBoundary: tick && tick.boundariesPreGate.length > 0 ? tick.boundariesPreGate[0] : null,
            lastAlert: this._lastAlert ? summarizeAlert(this._lastAlert) : null,
            sessionSeconds: tick?.t ?? 0,
        };
    }

    /**
     * Latest engine STATE for the dev timers/counters dashboard + the Phase B log. Pure assembly
     * of absolute ms anchors (warmup/cooldown/grace), the delivery-throttle counters, and the
     * last tick's metrics; the consumer derives every "remaining" locally. Telemetry only — never
     * read by any decision. Anchors are absolute so a 1 s client clock yields smooth countdowns
     * between the 10 s ticks.
     */
    getDebugSnapshot(): StruggleDebugSnapshot {
        const tick = this._lastTick;
        const lastFmBadS = this._engine.lastFmBadS;
        // Cooldown anchor: prefer THIS tick's own alert. The engine fires onDidTick BEFORE onDidAlert,
        // so on the exact firing tick `_lastAlert` (updated in the onDidAlert handler) is still the
        // PREVIOUS alert; `tick.alert` already carries this tick's alert, keeping the cooldown fresh.
        // (The throttle counts below intentionally still reflect deliveries through the prior tick:
        // delivery is downstream of the decision and runs on onDidAlert, after this snapshot is read.)
        const lastAlertMs = tick?.alert?.ts ?? this._lastAlert?.ts ?? null;
        return {
            sessionActive: this._engineRunning,
            nowMs: this._clock.now(),
            sessionStartMs: this._sessionStartMs,
            lastAlertMs,
            lastFmBadMs: lastFmBadS === null ? null : this._sessionStartMs + lastFmBadS * 1000,
            throttle: this._alertSink.getThrottleState?.() ?? null,
            effectiveWindowS: tick?.features.effectiveWindowS ?? 0,
            longestGapS: tick?.features.longestGapS ?? 0,
            // Decision trace for the dev pipeline. Null when inactive: `_lastTick` outlives the
            // session, but the snapshot contract treats all fields as stale when !sessionActive.
            decisionTrace: (this._engineRunning && tick) ? toLiveDecisionTrace(tick.decisionTrace) : null,
            // Same inactive-session guard: the tracker is only recreated on start(), so reading it
            // unconditionally would leak the previous session's streak after the session ends.
            testStagnation: this._engineRunning ? this._engine.getTestStagnationState() : null,
            caps: {
                warmupS: SPEC.WARMUP_S,
                cooldownS: SPEC.COOLDOWN_S,
                graceS: SPEC.GRACE_S,
                gapNormS: SPEC.GAP_NORM_S,
            },
        };
    }

    /** Consent state for the debug view (#352): sampled at init/tick/start/end refreshes. */
    isConsentGranted(): boolean { return this._detectionConsent.isGranted(); }

    /** Dev command: toggle the D1 warm-up skip on the engine. Returns the new state. */
    toggleSkipWarmup(): boolean {
        this._skipWarmup = !this._skipWarmup;
        this._engine.setSkipWarmup(this._skipWarmup);
        return this._skipWarmup;
    }

    /** Whether dev skip-warmup is currently active. */
    isSkipWarmup(): boolean { return this._skipWarmup; }

    dispose(): void {
        this._websocketService?.unregisterMessageHandler(this);   // parity with v1 TelemetryManager.dispose
        this.endExerciseSession();
        while (this._disposables.length > 0) { this._disposables.pop()?.dispose(); }
        this._engine.dispose();
    }
}
