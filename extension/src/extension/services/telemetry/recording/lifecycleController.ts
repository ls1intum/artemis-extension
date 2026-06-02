import * as vscode from 'vscode';
import * as crypto from 'crypto';

import { LogCategory, logger } from '@extension/services/loggingService';
import type { ObservationRegistry } from '@extension/services/telemetry/recording/observation/observationRegistry';
import type { SnapshotManager } from '@extension/services/telemetry/recording/snapshots/snapshotManager';
import type { StartupCapture, StartupContext } from '@extension/services/telemetry/recording/startup/startupCapture';
import type { RecordingStorageWriter } from '@extension/services/telemetry/recording/storageWriter';
import type { RecordedEvent, SessionMetadata } from '@extension/services/telemetry/recording/types';

// ── RecorderLifecycleState ────────────────────────────────────────────────

/**
 * Finite-state machine phases for the session recorder.
 *
 *   idle -> starting -> recording -> ending -> idle              (normal cycle)
 *   {idle|starting|recording|ending} -> disabling -> disabled  (consent downgrade / dispose)
 *   disabled -> idle                                          (re-enable)
 */
export type RecorderPhase =
    | 'idle'
    | 'starting'
    | 'recording'
    | 'ending'
    | 'disabling'
    | 'disabled';

/**
 * State owned exclusively by an active recording session. `null` when
 * `phase is in {idle, disabled}` after final cleanup. Remains populated through
 * `disabling` until `clearActiveSessionAfterFinalize()` so that the async
 * teardown path can still emit metadata.
 */
interface ActiveSessionState {
    readonly sessionId: string;
    readonly exerciseId: number;
    readonly participantId: string | undefined;
    /** Serialised URI string, e.g. "file:///workspace/ex1". */
    readonly exerciseRoot: string | undefined;
    readonly sessionStartTime: number;
    sessionStartWritten: boolean;
    eventCount: number;
}

/**
 * Pure state holder for the session recorder lifecycle. No I/O, no VS Code
 * APIs. All mutations go through the named methods below; direct field
 * writes are not exposed.
 *
 * Invariants:
 *   - `activeSession !== null` iff phase is in {starting, recording, ending, disabling}
 *     AND `clearActiveSessionAfterFinalize()` has not yet run.
 *   - `committedGeneration` only advances at `markSessionStartWritten(gen)`;
 *     it never bumps backward.
 *   - `sessionStartWritten` flips to true atomically with the generation commit.
 */
export class RecorderLifecycleState {
    private _phase: RecorderPhase = 'disabled';
    private _requestedGeneration = 0;
    private _currentGeneration = 0;
    private _committedGeneration: number | undefined;
    private _activeSession: ActiveSessionState | null = null;

    // ── Read-only views ───────────────────────────────────────────────

    get phase(): RecorderPhase {
        return this._phase;
    }

    get currentGeneration(): number {
        return this._currentGeneration;
    }

    get committedGeneration(): number | undefined {
        return this._committedGeneration;
    }

    get requestedGeneration(): number {
        return this._requestedGeneration;
    }

    get activeSession(): ActiveSessionState | null {
        return this._activeSession;
    }

    get isEnabled(): boolean {
        return this._phase !== 'disabling' && this._phase !== 'disabled';
    }

    get isRecording(): boolean {
        return this._phase === 'recording';
    }

    // ── Transitions ───────────────────────────────────────────────────

    /**
     * Transition `_phase` from one of the expected source states to the target
     * state. Throws if the current phase is not in `from`.
     */
    transitionPhase(from: readonly RecorderPhase[], to: RecorderPhase): void {
        if (!from.includes(this._phase)) {
            throw new Error(
                `Illegal phase transition: expected ${from.join('|')} -> ${to}, but current phase is ${this._phase}`,
            );
        }
        this._phase = to;
    }

    /**
     * Force a phase transition without checking the source phase. Only use for
     * `disable()` which can legally fire from any active phase.
     */
    forcePhase(to: RecorderPhase): void {
        this._phase = to;
    }

    /** Increment and return the new requested generation. */
    bumpRequestedGeneration(): number {
        return ++this._requestedGeneration;
    }

    // ── Session lifecycle ─────────────────────────────────────────────

    /**
     * Initialise an active session. Called inside `_doStart` sync prelude.
     * Does NOT commit the generation - that happens atomically with
     * `markSessionStartWritten(gen)` after the writer accepts the sessionStart.
     */
    beginSession(init: {
        sessionId: string;
        exerciseId: number;
        participantId: string | undefined;
        exerciseRoot: string | undefined;
        sessionStartTime: number;
    }): void {
        if (this._activeSession !== null) {
            throw new Error('beginSession called while activeSession is not null');
        }
        this._activeSession = {
            sessionId: init.sessionId,
            exerciseId: init.exerciseId,
            participantId: init.participantId,
            exerciseRoot: init.exerciseRoot,
            sessionStartTime: init.sessionStartTime,
            sessionStartWritten: false,
            eventCount: 0,
        };
    }

    /**
     * Atomically commit the generation and flip `sessionStartWritten`. Called
     * exactly once per session, inside the synchronous commit block that also
     * calls `writeLifecycleEvent({type:'sessionStart'})`. No await allowed
     * between this call and the sessionStart write.
     *
     * Preconditions: `phase === 'starting'`, `activeSession !== null`,
     * `activeSession.sessionStartWritten === false`.
     * Effects: `currentGeneration := generation`, `committedGeneration := generation`,
     * `activeSession.sessionStartWritten := true`. Phase stays `'starting'`.
     */
    markSessionStartWritten(generation: number): void {
        if (this._phase !== 'starting') {
            throw new Error(`markSessionStartWritten requires phase='starting' (was ${this._phase})`);
        }
        if (this._activeSession === null) {
            throw new Error('markSessionStartWritten requires activeSession !== null');
        }
        if (this._activeSession.sessionStartWritten) {
            throw new Error('markSessionStartWritten called twice for the same session');
        }
        this._currentGeneration = generation;
        this._committedGeneration = generation;
        this._activeSession.sessionStartWritten = true;
    }

    /** Transition `'starting' -> 'recording'` after `startupPhaseComplete` is written. */
    markStartupComplete(): void {
        this.transitionPhase(['starting'], 'recording');
    }

    /** Increment the per-session event counter. Sync. */
    incrementEventCount(): void {
        if (this._activeSession !== null) {
            this._activeSession.eventCount += 1;
        }
    }

    /** Clear the commit boundary (sessionStartWritten + committedGeneration). */
    clearCommitAfterFinalize(): void {
        this._committedGeneration = undefined;
        if (this._activeSession !== null) {
            this._activeSession.sessionStartWritten = false;
        }
    }

    /**
     * Null the active session and transition phase to its resting state:
     *   `ending`    -> `idle`
     *   `disabling` -> `disabled`
     * Any other phase is an error.
     */
    clearActiveSessionAfterFinalize(): void {
        this._activeSession = null;
        if (this._phase === 'ending') {
            this._phase = 'idle';
        } else if (this._phase === 'disabling') {
            this._phase = 'disabled';
        } else if (this._phase === 'starting') {
            // Pre-commit abort path - nothing was ever written. Fall back to idle.
            this._phase = 'idle';
        } else {
            throw new Error(
                `clearActiveSessionAfterFinalize called from unexpected phase '${this._phase}'`,
            );
        }
    }
}

// ── LifecycleController ───────────────────────────────────────────────────

interface RecordInternalOptions {
    allowDuringStartup?: boolean;
    allowDuringEnding?: boolean;
}

type TerminationReason = 'user-end' | 'deactivate' | 'consent-downgrade';

interface LifecycleControllerDeps {
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
 * - `_doFinalize(reason)` is the single finalization path shared by normal
 *   session end and consent-downgrade teardown; the two paths differ only in
 *   pre-conditions, the pre-sessionEnd marker, and the debounce policy.
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
        return this._enqueueLifecycle('endSession', () => this._doFinalize(reason));
    }

    /** Drains any pending lifecycle op. Used by SessionRecorder.shutdown(). */
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

        // End any in-flight session first. _doFinalize sets phase back to idle.
        if (phase() === 'recording') {
            await this._doFinalize('user-end');
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

        // Initial metadata write - lets live viewers fetch sessionStartTime
        // before the session ends. Overwritten at session end with final
        // endTime + eventCount. Best-effort, not awaited.
        const initialMetadata: SessionMetadata = {
            sessionId,
            exerciseId,
            participantId,
            startTime: sessionStartTs,
            endTime: null,
            eventCount: 0,
        };
        void this._deps.writer.writeMetadata(initialMetadata);

        // ── Phase 1: open-file snapshots (async) ──
        await this._deps.snapshots.captureOpenFileSnapshots(requestedGen, exerciseRootUri);

        // POST-SNAPSHOT RE-CHECK
        if (phase() === 'disabling' || phase() === 'disabled') {
            return; // _doDisable will finalize the committed session
        }
        if (requestedGen !== state.requestedGeneration) {
            await this._doFinalize('user-end');
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
            await this._doFinalize('user-end');
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

    // ── Private: _doFinalize ─────────────────────────────────────────

    private async _doFinalize(
        reason: TerminationReason,
        generationForDowngrade?: number,
    ): Promise<void> {
        const state = this._deps.state;
        const isConsentDowngrade = reason === 'consent-downgrade';

        // Pre-conditions differ by reason.
        if (isConsentDowngrade) {
            if (state.currentGeneration !== generationForDowngrade
                || state.activeSession?.sessionStartWritten !== true) {
                return;
            }
        } else {
            if (state.phase !== 'recording' && state.phase !== 'starting') { return; }
        }

        const active = state.activeSession;
        if (!active) { return; }

        const generation = state.currentGeneration;

        if (!isConsentDowngrade) {
            state.transitionPhase(['recording', 'starting'], 'ending');
        }

        // Pre-sessionEnd marker: consent-downgrade only.
        if (isConsentDowngrade) {
            this.writeLifecycleEvent({
                type: 'consentChange',
                timestamp: Date.now(),
                level: 'downgraded',
            });
        }

        // Debounce policy: flush (normal end) vs discard (consent-downgrade).
        if (isConsentDowngrade) {
            // Defence-in-depth: sync prelude already discarded; this catches
            // anything that might have slipped back in async.
            this._deps.observation.discardDebouncesForConsentDowngrade();
        } else {
            // Flush pending debounced payloads + abort pending terminal execs.
            this._deps.observation.flushDebouncesForEnd(generation);
        }

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

        // Preserve the pre-unification logging: normal-end paths logged
        // "Recording session ended", consent-downgrade finalization did not
        // log at this point.
        if (!isConsentDowngrade) {
            logger.info(
                `Recording session ended (${reason}): ${active.sessionId} (${active.eventCount} events)`,
                LogCategory.TELEMETRY,
            );
        }

        // Clear state ONLY after writer finalization, so concurrent disable()
        // still sees sessionStartWritten=true and routes through downgrade.
        state.clearCommitAfterFinalize();

        if (!isConsentDowngrade) {
            this._deps.observation.setExerciseContext(undefined);
        }
        this._deps.snapshots.reset();
        state.clearActiveSessionAfterFinalize();

        if (!isConsentDowngrade) {
            this._deps.onStateChange();
        }
    }

    // ── Private: _doDisable ──────────────────────────────────────────

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
                await this._doFinalize('consent-downgrade', generation);
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

}
