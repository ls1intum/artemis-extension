import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { RecordedEvent, SessionMetadata } from '../types';
import type { RecordingStorageWriter } from '../storageWriter';
import type { SnapshotManager } from '../snapshots/snapshotManager';
import type { ObservationRegistry } from '../observation/observationRegistry';
import type { StartupCapture, StartupContext } from '../startup/startupCapture';
import type { RecorderLifecycleState, RecorderPhase } from './recorderLifecycleState';
import { logger, LogCategory } from '../../../loggingService';

export interface RecordInternalOptions {
    allowDuringStartup?: boolean;
    allowDuringEnding?: boolean;
}

export interface LifecycleControllerDeps {
    state: RecorderLifecycleState;
    writer: RecordingStorageWriter;
    snapshots: SnapshotManager;
    observation: ObservationRegistry;
    startup: StartupCapture;
    /**
     * Synchronous hook fired after state transitions that should notify
     * SessionRecorder's onDidChangeState subscribers. Facade implementation
     * forwards to its own EventEmitter.
     */
    onStateChange: () => void;
}

/**
 * Orchestrates the recording lifecycle FSM and hosts the central event sink.
 *
 * - `recordInternal(event, opts, gen)` is the phase-gated writer entry point
 *   used by all listener / public record-API callers.
 * - `writeLifecycleEvent(event)` is the synchronous bypass channel for
 *   sessionStart/sessionEnd/consentChange/startupPhaseComplete/
 *   fileSnapshotError events.
 * - `enable/disable/startSession/endSession/dispose` drive the phase FSM
 *   through `RecorderLifecycleState`; heavy work is queued on the
 *   lifecycle mutex to serialise transitions.
 *
 * Re-check points in `_doStart` (pre-commit, post-snapshot, final) match
 * the invariant described in the plan v5 flow and preserve byte-exact
 * event ordering against the previous implementation.
 */
export class LifecycleController {
    private _lifecyclePromise: Promise<void> = Promise.resolve();

    constructor(private readonly _deps: LifecycleControllerDeps) {}

    // ── Enable / Disable ─────────────────────────────────────────────

    enable(): void {
        if (this._deps.state.phase !== 'disabled') {
            return;
        }
        this._deps.state.transitionPhase(['disabled'], 'idle');
        this._deps.observation.enable();
        this._deps.onStateChange();
        logger.info('SessionRecorder enabled', LogCategory.TELEMETRY);
    }

    disable(): void {
        const state = this._deps.state;
        if (state.phase === 'disabled' || state.phase === 'disabling') {
            return;
        }
        // Capture finalize intent BEFORE flipping phase to 'disabling'.
        const active = state.activeSession;
        const shouldFinalize = active?.sessionStartWritten === true
            && (state.phase === 'starting' || state.phase === 'recording' || state.phase === 'ending');
        const generation = state.committedGeneration;

        state.forcePhase('disabling');
        state.bumpRequestedGeneration();

        // Sync prelude (GDPR Option A): discard buffered debounced payloads,
        // abort pending terminal executions, clear listener exercise context.
        this._deps.observation.discardDebouncesForConsentDowngrade();
        this._deps.observation.setExerciseContext(undefined);

        this._enqueueLifecycle('disable', () => this._doDisable({ shouldFinalize, generation }));
        logger.info('SessionRecorder disable requested', LogCategory.TELEMETRY);
    }

    // ── Session lifecycle ────────────────────────────────────────────

    async startSession(exerciseId: number, participantId?: string, exerciseRoot?: string): Promise<void> {
        const state = this._deps.state;
        if (state.phase === 'disabling' || state.phase === 'disabled') {
            return;
        }
        const requestedGen = state.bumpRequestedGeneration();
        return this._enqueueLifecycle('startSession', () =>
            this._doStart(requestedGen, exerciseId, participantId, exerciseRoot));
    }

    async endSession(reason: 'user-end' | 'deactivate' = 'user-end'): Promise<void> {
        const state = this._deps.state;
        if (state.phase === 'disabling' || state.phase === 'disabled') {
            return;
        }
        return this._enqueueLifecycle('endSession', () => this._doEnd(reason));
    }

    /** Drains any pending lifecycle op. Used by SessionRecorder.dispose(). */
    async drainPending(): Promise<void> {
        try {
            await this._lifecyclePromise;
        } catch {
            /* lifecycle promise is always settled-success, but be defensive */
        }
    }

    // ── Central sink + bypass ────────────────────────────────────────

    recordInternal(event: RecordedEvent, opts: RecordInternalOptions, gen?: number): void {
        const state = this._deps.state;
        if (gen !== undefined && gen !== state.currentGeneration) {
            return;
        }
        const phase = state.phase;
        if (phase === 'recording') {
            // always allowed
        } else if (phase === 'starting' && opts.allowDuringStartup) {
            // allowed during startup
        } else if (phase === 'ending' && opts.allowDuringEnding) {
            // allowed during ending
        } else {
            return;
        }
        state.incrementEventCount();
        this._deps.writer.appendEvent(event);
    }

    writeLifecycleEvent(event: RecordedEvent): void {
        this._deps.state.incrementEventCount();
        this._deps.writer.appendEvent(event);
    }

    // ── Private: Lifecycle mutex ─────────────────────────────────────

    private _enqueueLifecycle(label: string, op: () => Promise<void>): Promise<void> {
        this._lifecyclePromise = this._lifecyclePromise
            .catch(err => {
                logger.error(`Lifecycle lane recovered before ${label}`, LogCategory.TELEMETRY, err);
            })
            .then(async () => {
                try {
                    await op();
                } catch (err) {
                    logger.error(`Lifecycle operation failed: ${label}`, LogCategory.TELEMETRY, err);
                }
            });
        return this._lifecyclePromise;
    }

    // ── Private: _doStart — commit BEFORE snapshots (plan v5) ────────

    private async _doStart(
        requestedGen: number,
        exerciseId: number,
        participantId: string | undefined,
        exerciseRoot: string | undefined,
    ): Promise<void> {
        const state = this._deps.state;
        // `state.phase` is a getter, but TypeScript aggressively narrows it
        // after a control-flow check. Go through this helper to bypass
        // narrowing when async/sync work may have flipped the phase.
        const phase = (): RecorderPhase => state.phase;

        // Superseded before we even got scheduled (or disable() ran).
        if (requestedGen !== state.requestedGeneration) { return; }
        if (phase() === 'disabling' || phase() === 'disabled') { return; }

        // End any in-flight session first. _doEnd sets phase back to idle.
        if (phase() === 'recording') {
            await this._doEnd('user-end');
            if (requestedGen !== state.requestedGeneration) { return; }
            if (phase() === 'disabling' || phase() === 'disabled') { return; }
        }

        state.transitionPhase(['idle'], 'starting');

        const hex = crypto.randomBytes(3).toString('hex');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const sessionId = `${exerciseId}-${timestamp}-${hex}`;
        state.beginSession({
            sessionId,
            exerciseId,
            participantId,
            exerciseRoot,
            sessionStartTime: Date.now(),
        });
        const exerciseRootUri = exerciseRoot ? vscode.Uri.parse(exerciseRoot) : undefined;
        this._deps.observation.setExerciseContext(exerciseRootUri);
        this._deps.observation.seedActiveEditor(vscode.window.activeTextEditor?.document.uri.toString());

        await this._deps.writer.initSession(sessionId);

        // PRE-COMMIT RE-CHECK
        if (requestedGen !== state.requestedGeneration) {
            if (phase() === 'starting') {
                state.clearActiveSessionAfterFinalize();
            }
            await this._deps.writer.abort();
            return;
        }
        if (phase() === 'disabling' || phase() === 'disabled') {
            await this._deps.writer.abort();
            return;
        }

        // ── SYNCHRONOUS COMMIT BLOCK ── (no await between these two lines)
        state.markSessionStartWritten(requestedGen);
        const sessionStartTs = Date.now();
        this.writeLifecycleEvent({
            type: 'sessionStart',
            timestamp: sessionStartTs,
            exerciseId,
            participantId,
            exerciseRoot,
            schemaVersion: 2,
        });

        // ── Phase 1: open-file snapshots (async) ──
        await this._deps.snapshots.captureOpenFileSnapshots(requestedGen, exerciseRootUri);

        // POST-SNAPSHOT RE-CHECK
        if (phase() === 'disabling' || phase() === 'disabled') {
            return; // _doDisable will finalize the committed session
        }
        if (requestedGen !== state.requestedGeneration) {
            await this._doEnd('user-end');
            return;
        }

        // ── Phases 2-4: diagnostics + contributors + initial-state (sync) ──
        const startupCtx: StartupContext = {
            exerciseId,
            participantId,
            exerciseRoot,
            sessionId,
            timestamp: Date.now(),
        };
        this._deps.startup.emitStartupEvents(
            startupCtx,
            requestedGen,
            exerciseRootUri,
            uri => this._deps.observation.seedActiveEditor(uri),
        );

        // FINAL RE-CHECK (sync path, so only disable can flip phase).
        if (phase() === 'disabling' || phase() === 'disabled') {
            return;
        }
        if (requestedGen !== state.requestedGeneration) {
            await this._doEnd('user-end');
            return;
        }

        this.writeLifecycleEvent({
            type: 'startupPhaseComplete',
            timestamp: Date.now(),
        });
        state.markStartupComplete();
        this._deps.onStateChange();

        logger.info(`Recording session started: ${sessionId}`, LogCategory.TELEMETRY);
    }

    // ── Private: _doEnd ──────────────────────────────────────────────

    private async _doEnd(reason: 'user-end' | 'deactivate'): Promise<void> {
        const state = this._deps.state;
        if (state.phase !== 'recording' && state.phase !== 'starting') { return; }
        const active = state.activeSession;
        if (!active) { return; }

        const generation = state.currentGeneration;
        state.transitionPhase(['recording', 'starting'], 'ending');

        // Flush pending debounced payloads + abort pending terminal execs.
        this._deps.observation.flushDebouncesForEnd(generation);

        const exerciseId = active.exerciseId;
        this.writeLifecycleEvent({
            type: 'sessionEnd',
            timestamp: Date.now(),
            exerciseId,
        });

        const metadata: SessionMetadata = {
            sessionId: active.sessionId,
            exerciseId,
            participantId: active.participantId,
            startTime: active.sessionStartTime,
            endTime: Date.now(),
            eventCount: active.eventCount,
        };

        await this._deps.writer.flush();
        await this._deps.writer.writeMetadata(metadata);
        await this._deps.writer.endSession();

        logger.info(
            `Recording session ended (${reason}): ${active.sessionId} (${active.eventCount} events)`,
            LogCategory.TELEMETRY,
        );

        // Clear state ONLY after writer finalization, so concurrent disable()
        // still sees sessionStartWritten=true and routes through downgrade.
        state.clearCommitAfterFinalize();
        this._deps.observation.setExerciseContext(undefined);
        this._deps.snapshots.reset();
        state.clearActiveSessionAfterFinalize();
        this._deps.onStateChange();
    }

    // ── Private: _doDisable + finalize ───────────────────────────────

    private async _doDisable(
        params: { shouldFinalize: boolean; generation: number | undefined },
    ): Promise<void> {
        const { shouldFinalize, generation } = params;
        const state = this._deps.state;

        const finalizeNow = shouldFinalize
            && state.activeSession?.sessionStartWritten === true
            && generation !== undefined
            && state.committedGeneration === generation;

        if (finalizeNow) {
            try {
                await this._doFinalizeAfterDisable(generation);
            } catch (err) {
                logger.error('Failed to finalize session during disable', LogCategory.TELEMETRY, err);
            }
        }

        this._deps.observation.disposeSubscriptions();
        if (state.phase !== 'disabled') {
            state.forcePhase('disabled');
        }
        this._deps.onStateChange();
        logger.info('SessionRecorder disabled', LogCategory.TELEMETRY);
    }

    private async _doFinalizeAfterDisable(generation: number): Promise<void> {
        const state = this._deps.state;
        if (state.currentGeneration !== generation || state.activeSession?.sessionStartWritten !== true) {
            return;
        }
        const active = state.activeSession;
        if (!active) { return; }

        const exerciseId = active.exerciseId;

        this.writeLifecycleEvent({
            type: 'consentChange',
            timestamp: Date.now(),
            level: 'downgraded',
        });

        // Defence-in-depth: sync prelude already discarded; this catches
        // anything that might have slipped back in async.
        this._deps.observation.discardDebouncesForConsentDowngrade();

        this.writeLifecycleEvent({
            type: 'sessionEnd',
            timestamp: Date.now(),
            exerciseId,
        });

        const metadata: SessionMetadata = {
            sessionId: active.sessionId,
            exerciseId,
            participantId: active.participantId,
            startTime: active.sessionStartTime,
            endTime: Date.now(),
            eventCount: active.eventCount,
        };

        await this._deps.writer.flush();
        await this._deps.writer.writeMetadata(metadata);
        await this._deps.writer.endSession();

        state.clearCommitAfterFinalize();
        this._deps.snapshots.reset();
        state.clearActiveSessionAfterFinalize();
    }
}
