/**
 * Main orchestrator for session recording.
 *
 * Runs parallel to TelemetryManager with its own VS Code listeners.
 * Only active when consent is Extended. Writes JSONL event streams
 * to {globalStorageUri}/recordings/{sessionId}/.
 *
 * ## Lifecycle FSM
 *
 * The recorder is a finite-state machine with six phases:
 *
 *   idle -> starting -> recording -> ending -> idle          (normal cycle)
 *   {idle|starting|recording|ending} -> disabling -> disabled (consent downgrade)
 *   disabled -> idle                                          (re-enable)
 *
 * Phase transitions and the session generation token are owned by
 * `LifecycleController`; this class only reads them for its record-phase
 * guards. Async work (snapshots, terminal output readers, debounce timers)
 * captures the generation at dispatch time and re-checks before writing, so
 * stale callbacks from a previous session cannot contaminate a later one.
 */

import * as vscode from 'vscode';

import type { ProblemStatementScrollPayload, ProblemStatementSelectionPayload } from '@shared/messageContracts/webviewCommands';

import type { InterventionBlockedReason, InterventionDismissReason, InterventionLevel, InterventionSuppressionReason, TriggerType } from '@extension/services/telemetry/types';
import type { ResultDTO, WebSocketMessageHandler } from '@extension/types';

import type { InterventionRecordAction, RecordedEvent, SerializedErrorSnapshot, SubmissionPayload } from './types';

/**
 * Distributive `Omit` over `RecordedEvent`. Keeps each union variant intact
 * after stripping the `timestamp` discriminator-adjacent field.
 */
type RecordedEventWithoutTimestamp = RecordedEvent extends infer E
    ? E extends RecordedEvent
        ? Omit<E, 'timestamp'>
        : never
    : never;
import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import { LogCategory, logger } from '@extension/services/loggingService';
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
    private _disposed = false;

    private readonly _state = new RecorderLifecycleState();

    // Read-only forwarding for the record-phase guards and whitebox tests.
    // Writes go through explicit _state.* methods.
    private get _phase(): RecorderPhase { return this._state.phase; }
    private get _currentGeneration(): number { return this._state.currentGeneration; }
    private get _activeExerciseId(): number | undefined { return this._state.activeSession?.exerciseId; }
    private get _eventCount(): number { return this._state.activeSession?.eventCount ?? 0; }

    private readonly _snapshots: SnapshotManager;
    private readonly _observation: ObservationRegistry;

    private readonly _writer: RecordingStorageWriter;
    private readonly _startup: StartupCapture;

    private readonly _onDidChangeState = new vscode.EventEmitter<RecordingState>();
    public readonly onDidChangeState = this._onDidChangeState.event;

    private readonly _capabilities?: PlatformCapabilities;
    private readonly _exerciseRegistry?: ExerciseRegistry;

    private readonly _lifecycle: LifecycleController;

    constructor(
        globalStorageUri: vscode.Uri,
        capabilities?: PlatformCapabilities,
        exerciseRegistry?: ExerciseRegistry,
        /** Injection point for tests. Production uses the default writer. */
        writer?: RecordingStorageWriter,
    ) {
        this._writer = writer ?? new RecordingStorageWriter(globalStorageUri.fsPath);
        this._capabilities = capabilities;
        this._exerciseRegistry = exerciseRegistry;
        this._snapshots = new SnapshotManager({
            state: this._state,
            writer: this._writer,
            record: (event, opts, gen) => this._lifecycle.recordInternal(event, opts, gen),
            lifecycleAppend: event => this._lifecycle.writeLifecycleEvent(event),
        });
        this._startup = new StartupCapture({
            record: (event, opts, gen) => this._lifecycle.recordInternal(event, opts, gen),
        });
        this._observation = new ObservationRegistry({
            state: this._state,
            snapshots: this._snapshots,
            record: (event, opts, gen) => this._lifecycle.recordInternal(event, opts, gen),
            capabilities: this._capabilities,
        });
        this._lifecycle = new LifecycleController({
            state: this._state,
            writer: this._writer,
            snapshots: this._snapshots,
            observation: this._observation,
            startup: this._startup,
            onStateChange: () => this._fireStateChange(),
        });
    }

    get isEnabled(): boolean { return this._state.isEnabled; }
    get isRecording(): boolean { return this._state.isRecording; }
    get activeExerciseId(): number | undefined { return this._state.activeSession?.exerciseId; }
    get eventCount(): number { return this._state.activeSession?.eventCount ?? 0; }

    /**
     * Register a synchronous startup event producer. Contributor fires once
     * per session, inside `_doStart`, between the initial-state events and the
     * `startupPhaseComplete` marker. Returns a Disposable that deregisters the
     * contributor.
     */
    public registerStartupContributor(contributor: StartupContributor): vscode.Disposable {
        return this._startup.register(contributor);
    }

    enable(): void {
        this._lifecycle.enable();
    }

    disable(): void {
        this._lifecycle.disable();
    }

    async startSession(exerciseId: number, participantId?: string, exerciseRoot?: string): Promise<void> {
        return this._lifecycle.startSession(exerciseId, participantId, exerciseRoot);
    }

    async endSession(reason: 'user-end' | 'deactivate' = 'user-end'): Promise<void> {
        return this._lifecycle.endSession(reason);
    }

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

    /**
     * Centralises the phase guard, the synchronous `Date.now()` timestamp and
     * the generation capture for the public `record*` wrappers below, so those
     * stay declarative payloads. Anything that needs custom `opts`, a
     * pre-existing timestamp (e.g. from a collector) or a different generation
     * snapshot must call `_lifecycle.recordInternal` directly instead.
     *
     * `RecordedEventWithoutTimestamp` is a *distributive* omit; the built-in
     * `Omit<RecordedEvent, 'timestamp'>` collapses the discriminated union and
     * drops per-variant fields like `action`, `eq`, `panel`.
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
     * Emit with status='pending' immediately before the API call, then again
     * with status='sent' on success or status='failed' on error, so failed
     * sends stay visible in the recording even when no irisChatMessage event is
     * produced.
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

    recordIrisChatFeedback(messageId: string, helpful: boolean): void {
        this._record({
            type: 'irisChatFeedback',
            messageId,
            helpful,
        });
    }

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

    recordProblemStatementScroll(payload: ProblemStatementScrollPayload): void {
        this._record({
            type: 'problemStatementScroll',
            ...payload,
        });
    }

    recordProblemStatementSelection(payload: ProblemStatementSelectionPayload): void {
        this._record({
            type: 'problemStatementSelection',
            ...payload,
        });
    }

    /**
     * `exerciseId` is stamped from the active session, consistent with how
     * buildResult is stamped.
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

    /**
     * Awaitable teardown. Deliberately NOT named `dispose()` and the class does
     * NOT implement `vscode.Disposable`: the durability guarantee (buffered
     * events flushed to disk) only holds if this is awaited, so it must never be
     * registered in `context.subscriptions` where VS Code would fire-and-forget it.
     * The durable path is `deactivate()` to DataCollectionHandle to here.
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
    }

    private _fireStateChange(): void {
        this._onDidChangeState.fire({
            isEnabled: this.isEnabled,
            isRecording: this.isRecording,
            exerciseId: this._activeExerciseId,
            eventCount: this._eventCount,
        });
    }



}
