/**
 * Main orchestrator for session recording.
 *
 * Runs parallel to TelemetryManager, consuming the shared SensorHub (or an owned default hub when none is injected) instead of holding its own VS Code listeners.
 * Only active when consent is Extended. Writes JSONL event streams
 * to {globalStorageUri}/recordings/{sessionId}/.
 *
 * ## Lifecycle FSM (Block AB)
 *
 * The recorder is a finite-state machine with six phases:
 *
 *   idle → starting → recording → ending → idle          (normal cycle)
 *   {idle|starting|recording|ending} → disabling → disabled  (consent downgrade)
 *   disabled → idle                                       (re-enable)
 *
 * `_phase` replaces the legacy `_isRecording` / `_isEnabled` booleans. Phase
 * transitions other than the synchronous `disable()` kick-off happen inside
 * the lifecycle mutex (`_lifecyclePromise`), so only one of `_doStart`,
 * `_doFinalize`, or `_doDisable` runs at a time.
 *
 * ## Session Generation Token
 *
 * Every successful `_doStart` increments `_currentGeneration`. `startSession`
 * callers also receive their own `requestedGeneration` — if another start is
 * enqueued before the current one reaches the commit point, the older
 * request aborts (no `sessionStart` written) and the newer wins. Async work
 * (snapshots, terminal output readers, debounce timers) captures the
 * generation at dispatch time and re-checks before writing, so stale
 * callbacks from a previous session can never contaminate a later one.
 *
 * ## Commit Boundary
 *
 * `_sessionStartWritten` flips to `true` only after the `sessionStart` event
 * has been handed to the writer. It is the authoritative signal for
 * "does the on-disk JSONL contain a session header?". `_committedGeneration`
 * pairs with it: on consent downgrade, `_doDisable` finalises a session only
 * when both are set AND the generation matches the one captured synchronously
 * at `disable()` time — guaranteeing no finalise-after-abort races.
 */

import * as vscode from 'vscode';

import type { ProblemStatementScrollPayload, ProblemStatementSelectionPayload } from '@shared/messageContracts/webviewCommands';

import type { InterventionBlockedReason, InterventionDismissReason, InterventionLevel, InterventionSuppressionReason, TriggerType } from '@extension/services/telemetry/types';
import type { ResultDTO, WebSocketMessageHandler } from '@extension/types';

import type { InterventionRecordAction, RecordedEvent, SerializedErrorSnapshot, SubmissionPayload } from './types';

/**
 * Distributive `Omit` over `RecordedEvent` — keeps each union variant intact
 * after stripping the `timestamp` discriminator-adjacent field.
 */
type RecordedEventWithoutTimestamp = RecordedEvent extends infer E
    ? E extends RecordedEvent
        ? Omit<E, 'timestamp'>
        : never
    : never;
import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import { LogCategory, logger } from '@extension/services/loggingService';
import { type SensorHub, VsCodeSensorHub } from '@extension/services/sensing';
import { shouldAcceptBuildResult } from '@extension/services/telemetry/buildResultGuard';
import type { PlatformCapabilities } from '@extension/theia';

import { collectBuildResult } from './eventCollectors';
import {
    LifecycleController,
    RecorderLifecycleState,
    type RecorderPhase as RecorderPhaseFromState,
} from './lifecycleController';
import { ObservationRegistry } from './observation/observationRegistry';
import { SnapshotManager } from './snapshots/snapshotManager';
import {
    StartupCapture,
    type StartupContributor as StartupContributorFromModule,
} from './startup/startupCapture';
import { RecordingStorageWriter } from './storageWriter';

interface RecordingState {
    isEnabled: boolean;
    isRecording: boolean;
    exerciseId: number | undefined;
    eventCount: number;
}

type StartupContributor = StartupContributorFromModule;

type RecorderPhase = RecorderPhaseFromState;

export class SessionRecorder implements WebSocketMessageHandler {
    // ── Shutdown guard ────────────────────────────────────────────────

    private _disposed = false;

    // ── Lifecycle state (phase + generation + active session) ─────────

    private readonly _state = new RecorderLifecycleState();

    // Forwarding getters — used internally by record-phase guards and by
    // whitebox tests. Writes go through explicit _state.* methods.
    private get _phase(): RecorderPhase { return this._state.phase; }
    private get _currentGeneration(): number { return this._state.currentGeneration; }
    private get _activeExerciseId(): number | undefined { return this._state.activeSession?.exerciseId; }
    private get _eventCount(): number { return this._state.activeSession?.eventCount ?? 0; }

    // ── Session state ──────────────────────────────────────────────────

    private readonly _snapshots: SnapshotManager;
    private readonly _observation: ObservationRegistry;

    private readonly _writer: RecordingStorageWriter;
    private readonly _startup: StartupCapture;

    private readonly _onDidChangeState = new vscode.EventEmitter<RecordingState>();
    public readonly onDidChangeState = this._onDidChangeState.event;

    private readonly _exerciseRegistry?: ExerciseRegistry;

    private readonly _sensorHub: SensorHub;
    private readonly _ownsHub: boolean;

    private readonly _lifecycle: LifecycleController;

    constructor(
        globalStorageUri: vscode.Uri,
        capabilities?: PlatformCapabilities,
        exerciseRegistry?: ExerciseRegistry,
        /** Injection point for tests. Production uses the default writer. */
        writer?: RecordingStorageWriter,
        /** Shared hub injected by production wiring; default exists for standalone construction in tests. */
        sensorHub?: SensorHub,
    ) {
        this._sensorHub = sensorHub ?? new VsCodeSensorHub(capabilities);
        this._ownsHub = sensorHub === undefined;
        this._writer = writer ?? new RecordingStorageWriter(globalStorageUri.fsPath);
        this._exerciseRegistry = exerciseRegistry;
        this._snapshots = new SnapshotManager({
            state: this._state,
            writer: this._writer,
            record: (event, opts, gen) => this._lifecycle.recordInternal(event, opts, gen),
            lifecycleAppend: event => this._lifecycle.writeLifecycleEvent(event),
        });
        this._startup = new StartupCapture({
            record: (event, opts, gen) => this._lifecycle.recordInternal(event, opts, gen),
            hub: this._sensorHub,
        });
        this._observation = new ObservationRegistry({
            state: this._state,
            snapshots: this._snapshots,
            record: (event, opts, gen) => this._lifecycle.recordInternal(event, opts, gen),
            hub: this._sensorHub,
        });
        this._lifecycle = new LifecycleController({
            state: this._state,
            writer: this._writer,
            snapshots: this._snapshots,
            observation: this._observation,
            startup: this._startup,
            hub: this._sensorHub,
            onStateChange: () => this._fireStateChange(),
        });
    }

    // ── Public state accessors ────────────────────────────────────────

    get isEnabled(): boolean { return this._state.isEnabled; }
    get isRecording(): boolean { return this._state.isRecording; }
    get activeExerciseId(): number | undefined { return this._state.activeSession?.exerciseId; }
    get eventCount(): number { return this._state.activeSession?.eventCount ?? 0; }

    // ── Startup contributors ──────────────────────────────────────────

    /**
     * Register a synchronous startup event producer. Contributor fires once
     * per session, inside `_doStart`, between the initial-state events and the
     * `startupPhaseComplete` marker. Returns a Disposable that deregisters the
     * contributor.
     */
    public registerStartupContributor(contributor: StartupContributor): vscode.Disposable {
        return this._startup.register(contributor);
    }

    // ── Enable / Disable (delegated to LifecycleController) ──────────

    enable(): void {
        this._lifecycle.enable();
    }

    disable(): void {
        this._lifecycle.disable();
    }

    // ── Session lifecycle (delegated) ────────────────────────────────

    async startSession(exerciseId: number, participantId?: string, exerciseRoot?: string): Promise<void> {
        return this._lifecycle.startSession(exerciseId, participantId, exerciseRoot);
    }

    async endSession(reason: 'user-end' | 'deactivate' = 'user-end'): Promise<void> {
        return this._lifecycle.endSession(reason);
    }

    // ── WebSocketMessageHandler ───────────────────────────────────────

    onNewResult(result: ResultDTO): void {
        if (this._phase !== 'recording') {
            return;
        }
        if (!shouldAcceptBuildResult(result, this._activeExerciseId, this._exerciseRegistry)) {
            return;
        }
        this._lifecycle.recordInternal(
            collectBuildResult(result, this._activeExerciseId),
            {},
            this._currentGeneration,
        );
    }

    // ── Public recording methods for chat / view / EQ / lifecycle events ──
    //
    // The public `record*` wrappers below are thin shells around `_record`,
    // which centralises the phase check, the timestamp, the generation capture,
    // and the empty-opts call to `LifecycleController.recordInternal`. Keep
    // these methods this shape — anything that needs custom `opts`, a
    // pre-existing timestamp (e.g. from a collector), or a different
    // generation snapshot must go through `_lifecycle.recordInternal` directly
    // and is NOT a candidate for this helper.

    /**
     * Centralised recording helper for the public `record*` methods.
     * Captures the phase guard, the synchronous `Date.now()` timestamp, and
     * the current generation in one place so the wrapper methods stay
     * declarative payloads.
     *
     * `RecordedEventWithoutTimestamp` is a *distributive* omit — the built-in
     * `Omit<RecordedEvent, 'timestamp'>` collapses the discriminated union and
     * drops per-variant fields like `action`, `eq`, `panel`, etc.
     */
    private _record(event: RecordedEventWithoutTimestamp): void {
        if (this._phase !== 'recording') {
            return;
        }
        this._lifecycle.recordInternal(
            { timestamp: Date.now(), ...event } as RecordedEvent,
            {},
            this._currentGeneration,
        );
    }

    recordIrisChatSent(
        text: string,
        messageId?: string,
        sessionId?: string,
        sentAt?: number,
    ): void {
        this._record({
            type: 'irisChatMessage',
            direction: 'sent',
            content: text,
            messageId,
            sessionId,
            sentAt,
        });
    }

    recordIrisChatReceived(
        content: string,
        messageId?: string,
        sessionId?: string,
        sentAt?: number,
    ): void {
        this._record({
            type: 'irisChatMessage',
            direction: 'received',
            content,
            messageId,
            sessionId,
            sentAt,
        });
    }

    /**
     * Record a send-attempt lifecycle event.
     *
     * Emit with status='pending' immediately before the API call, then again
     * with status='sent' on success or status='failed' on error. This ensures
     * failed sends are visible in the recording even when no irisChatMessage
     * event is produced.
     */
    recordIrisChatSendAttempt(
        content: string,
        status: 'pending' | 'sent' | 'failed',
        errorMessage?: string,
    ): void {
        this._record({
            type: 'irisChatSendAttempt',
            content,
            status,
            errorMessage,
        });
    }

    /**
     * Record a helpful/unhelpful feedback submission for an Iris message.
     */
    recordIrisChatFeedback(messageId: string, helpful: boolean): void {
        this._record({
            type: 'irisChatFeedback',
            messageId,
            helpful,
        });
    }

    /**
     * Record a test-results-overview view opened event.
     */
    recordTestResultsOverviewOpened(payload: {
        viewId: string;
        exerciseId: number;
        participationId?: number;
        resultId?: number;
        totalTests: number;
        passedTests: number;
        failedTests: number;
    }): void {
        this._record({
            type: 'testResultsOverviewView',
            action: 'opened',
            ...payload,
        });
    }

    /**
     * Record a test-results-overview view closed event.
     */
    recordTestResultsOverviewClosed(payload: {
        viewId: string;
        exerciseId: number;
        participationId?: number;
        resultId?: number;
        durationMs: number;
        closeReason: 'button' | 'escape';
    }): void {
        this._record({
            type: 'testResultsOverviewView',
            action: 'closed',
            ...payload,
        });
    }

    /**
     * Record a task-feedback view opened event.
     */
    recordTaskFeedbackOpened(payload: {
        viewId: string;
        exerciseId: number;
        participationId?: number;
        resultId?: number;
        taskName: string;
        testIds: number[];
        totalTests: number;
        passedTests: number;
        failedTests: number;
        notExecutedTests?: number;
    }): void {
        this._record({
            type: 'taskFeedbackView',
            action: 'opened',
            ...payload,
        });
    }

    /**
     * Record a task-feedback view closed event.
     */
    recordTaskFeedbackClosed(payload: {
        viewId: string;
        exerciseId: number;
        participationId?: number;
        resultId?: number;
        taskName: string;
        durationMs: number;
        closeReason: 'button' | 'escape';
    }): void {
        this._record({
            type: 'taskFeedbackView',
            action: 'closed',
            ...payload,
        });
    }

    recordEqSnapshot(
        eq: number,
        confidence: 'sufficient' | 'insufficient',
        source: 'save' | 'build' | 'trigger',
        triggerType?: string,
    ): void {
        this._record({
            type: 'eqSnapshot',
            eq,
            confidence,
            source,
            triggerType,
        });
    }

    recordIntervention(
        action: InterventionRecordAction,
        level: InterventionLevel,
        shouldIntervene: boolean,
        eq: number,
        confidence: 'sufficient' | 'insufficient',
        triggerType?: TriggerType,
        opts?: {
            blockedReason?: InterventionBlockedReason;
            suppressionReason?: InterventionSuppressionReason;
            dismissReason?: InterventionDismissReason;
            rawWanted?: boolean;
        },
    ): void {
        this._record({
            type: 'intervention',
            action,
            level,
            shouldIntervene,
            eq,
            confidence,
            triggerType,
            blockedReason: opts?.blockedReason,
            suppressionReason: opts?.suppressionReason,
            dismissReason: opts?.dismissReason,
            rawWanted: opts?.rawWanted,
        });
    }

    recordViewNavigation(from: string, to: string): void {
        this._record({
            type: 'viewNavigation',
            from,
            to,
        });
    }

    recordPanelVisibility(panel: 'artemis' | 'chat', visible: boolean): void {
        this._record({
            type: 'panelVisibility',
            panel,
            visible,
        });
    }

    /**
     * Record a problem-statement scroll event (how far the student has scrolled
     * through the exercise description).
     */
    recordProblemStatementScroll(payload: ProblemStatementScrollPayload): void {
        this._record({
            type: 'problemStatementScroll',
            ...payload,
        });
    }

    /**
     * Record a problem-statement text-selection event (text the student
     * highlighted inside the exercise description).
     */
    recordProblemStatementSelection(payload: ProblemStatementSelectionPayload): void {
        this._record({
            type: 'problemStatementSelection',
            ...payload,
        });
    }

    /**
     * Record a submission lifecycle event (started/succeeded/failed). `exerciseId`
     * is stamped from the active session, consistent with how buildResult is stamped.
     */
    recordSubmission(payload: SubmissionPayload): void {
        this._record({
            type: 'submission',
            status: payload.status,
            participationId: payload.participationId,
            exerciseId: this._activeExerciseId,
            commitMessage: payload.commitMessage,
            failureReason: payload.failureReason,
        });
    }

    recordConfigurationSnapshot(struggleDetectionEnabled: boolean, showInterventions: boolean): void {
        this._record({
            type: 'configurationSnapshot',
            struggleDetectionEnabled,
            showInterventions,
        });
    }

    recordConfigurationChange(changes: {
        struggleDetectionEnabled?: boolean;
        showInterventions?: boolean;
    }): void {
        this._record({
            type: 'configurationChange',
            changes,
        });
    }

    recordEqEngineState(
        snapshots: SerializedErrorSnapshot[],
        currentEQ: number,
        pairCount: number,
        confidence: 'sufficient' | 'insufficient',
    ): void {
        this._record({
            type: 'eqEngineState',
            snapshots,
            currentEQ,
            pairCount,
            confidence,
        });
    }

    // ── Shutdown ──────────────────────────────────────────────────────

    /**
     * Awaitable teardown. Deliberately NOT named `dispose()` and the class does
     * NOT implement `vscode.Disposable`: the durability guarantee (buffered
     * events flushed to disk) only holds if this is awaited, so it must never be
     * registered in `context.subscriptions` where VS Code would fire-and-forget it.
     * The durable path is `deactivate()` → DataCollectionHandle → here.
     * After shutdown disposes an owned hub, channel attaches become inert; a recorder must not be re-enabled past shutdown().
     */
    async shutdown(): Promise<void> {
        if (this._disposed) { return; }
        this._disposed = true;
        if (this._phase === 'recording' || this._phase === 'starting') {
            try {
                await this.endSession('deactivate');
            } catch (err: unknown) {
                logger.error('Failed to end recording session during shutdown', LogCategory.TELEMETRY, err);
            }
        }
        await this._lifecycle.drainPending();
        this._observation.disposeSubscriptions();
        await this._writer.shutdown();
        this._onDidChangeState.dispose();
        if (this._ownsHub) {
            this._sensorHub.dispose();
        }
    }

    // ── Private: State notification ─────────────────────────────────────

    private _fireStateChange(): void {
        this._onDidChangeState.fire({
            isEnabled: this.isEnabled,
            isRecording: this.isRecording,
            exerciseId: this._activeExerciseId,
            eventCount: this._eventCount,
        });
    }



}
