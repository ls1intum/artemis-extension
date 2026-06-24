// extension/src/extension/services/struggle/struggleCoordinator.ts
import * as vscode from 'vscode';

import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { SensorHub } from '@extension/services/sensing';
import { shouldAcceptBuildResult } from '@extension/services/sensing/buildResultGuard';
import type { AlertSink } from '@extension/services/struggle/alerting/alertSink';
import { SPEC } from '@extension/services/struggle/config';
import { StruggleEngine } from '@extension/services/struggle/struggleEngine';
import type { AlertRecord, EngineClock, StruggleSnapshot, TickRecord } from '@extension/services/struggle/types';
import type { ArtemisWebsocketService } from '@extension/services/websocket/artemisWebsocketService';
import type { ResultDTO, WebSocketMessageHandler } from '@extension/types';

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

export interface StruggleCoordinatorDeps {
    hub: SensorHub;
    alertSink: AlertSink;
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
    private readonly _engine: StruggleEngine;
    private readonly _clock: EngineClock;
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _onDidStartSession = new vscode.EventEmitter<void>();
    private readonly _onDidEndSession = new vscode.EventEmitter<void>();
    private _activeExerciseId: number | undefined;
    private _sessionStartMs = 0;
    private _lastTick: TickRecord | undefined;
    private _lastAlert: AlertRecord | undefined;
    private _isEnabled = true;
    private _showInterventions = true;

    constructor(deps: StruggleCoordinatorDeps) {
        this._hub = deps.hub;
        this._alertSink = deps.alertSink;
        this._exerciseRegistry = deps.exerciseRegistry;
        this._clock = deps.clock ?? DEFAULT_CLOCK;
        this._engine = new StruggleEngine(this._hub, this._clock);
        this._disposables.push(this._onDidStartSession, this._onDidEndSession);

        // Engine alert → sink (UI gated) + snapshot bookkeeping.
        // The alert is ALWAYS recorded via the engine's onDidAlert (the recorder
        // wiring subscribes the engine directly); only UI delivery is gated.
        // Delivery requires BOTH struggle detection enabled AND interventions
        // shown: disabling detection (enabled=false) must suppress interventions.
        this._disposables.push(this._engine.onDidAlert(alert => {
            this._lastAlert = alert;
            if (this._isEnabled && this._showInterventions) {
                this._alertSink.deliver(alert);
            }
        }));
        this._disposables.push(this._engine.onDidTick(tick => { this._lastTick = tick; }));

        this._loadConfiguration();
        this._disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('artemis.struggleDetection')) { this._loadConfiguration(); }
        }));
    }

    // ── WebSocket handler (build-result producer) ──────────────────────
    onNewResult(result: ResultDTO): void {
        if (!this._isEnabled) { return; }
        if (!shouldAcceptBuildResult(result, this._activeExerciseId, this._exerciseRegistry)) { return; }
        this._hub.emitBuildResult(result);          // engine (FM/FM+/improved + fast decay)
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
        if (this._activeExerciseId === exerciseId) { return; }
        if (this._activeExerciseId !== undefined) { this.endExerciseSession(); }
        this._activeExerciseId = exerciseId;
        this._sessionStartMs = this._clock.now();
        // New session: reset the sink's per-session throttle budget AND clear any
        // stale intervention (resetSession falls back to reset when unsupported).
        if (this._alertSink.resetSession) {
            this._alertSink.resetSession();
        } else {
            this._alertSink.reset?.();
        }
        this._engine.start({ sessionStartMs: this._sessionStartMs, exerciseRoot });
        this._lastTick = undefined;
        this._lastAlert = undefined;
        // New session is live: notify activation so the live-feed buffer clears
        // (fired last so the clear lands once the new session is fully started).
        this._onDidStartSession.fire();
    }

    /** ms epoch of the active session start (test/replay helper). */
    get sessionStartMs(): number { return this._sessionStartMs; }

    /** Drive the engine's grid ticks deterministically (tests/replay; production
     *  uses the engine's own interval timer). */
    advanceTo(nowMs: number): void { this._engine.advanceTo(nowMs); }

    endExerciseSession(): void {
        if (this._activeExerciseId === undefined) { return; }
        this._engine.stop();
        this._activeExerciseId = undefined;
        this._onDidEndSession.fire();
    }

    // ── Debug snapshot ─────────────────────────────────────────────────
    getSnapshot(): StruggleSnapshot {
        const tick = this._lastTick;
        // v3: isStruggling thresholds on urgency = S_base (the live decision
        // signal), NOT the V peak-hold curve. V stays as telemetry below.
        return {
            isStruggling: tick ? tick.sBase >= SPEC.THETA_FULL : false,
            urgency: tick?.sBase ?? 0,
            v: tick?.v ?? 0,
            s: tick?.s ?? 0,
            primaryBoundary: tick && tick.boundariesPreGate.length > 0 ? tick.boundariesPreGate[0] : null,
            lastAlert: this._lastAlert ? summarizeAlert(this._lastAlert) : null,
            sessionSeconds: tick?.t ?? 0,
        };
    }

    isEnabled(): boolean { return this._isEnabled; }

    private _loadConfiguration(): void {
        const cfg = vscode.workspace.getConfiguration('artemis.struggleDetection');
        const prevDeliver = this._isEnabled && this._showInterventions;
        this._isEnabled = cfg.get<boolean>('enabled', true);
        this._showInterventions = cfg.get<boolean>('showInterventions', true);
        // On any transition that turns delivery off (detection disabled OR
        // interventions hidden), clear a visible hint immediately. The engine
        // keeps computing/recording — only UI delivery is suppressed.
        if (prevDeliver && !(this._isEnabled && this._showInterventions)) {
            this._alertSink.reset?.();
        }
    }

    dispose(): void {
        this._websocketService?.unregisterMessageHandler(this);   // parity with v1 TelemetryManager.dispose
        this.endExerciseSession();
        while (this._disposables.length > 0) { this._disposables.pop()?.dispose(); }
        this._engine.dispose();
    }
}
