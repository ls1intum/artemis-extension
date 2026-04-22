import * as vscode from 'vscode';

/**
 * Finite-state machine phases for the session recorder.
 *
 *   idle → starting → recording → ending → idle              (normal cycle)
 *   {idle|starting|recording|ending} → disabling → disabled  (consent downgrade / dispose)
 *   disabled → idle                                          (re-enable)
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
 * `phase ∈ {idle, disabled}` after final cleanup. Remains populated through
 * `disabling` until `clearActiveSessionAfterFinalize()` so that the async
 * teardown path can still emit metadata.
 */
export interface ActiveSessionState {
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
 * Emitted whenever phase or active session changes. Mirrors the existing
 * `RecordingState` shape for consumer compatibility.
 */
export interface RecordingState {
    isEnabled: boolean;
    isRecording: boolean;
    exerciseId: number | undefined;
    eventCount: number;
}

/**
 * Pure state holder for the session recorder lifecycle. No I/O, no VS Code
 * APIs beyond `EventEmitter`. All mutations go through the named methods
 * below; direct field writes are not exposed.
 *
 * Invariants:
 *   - `activeSession !== null` iff phase ∈ {starting, recording, ending, disabling}
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

    private readonly _onStateChange = new vscode.EventEmitter<RecordingState>();
    public readonly onStateChange = this._onStateChange.event;

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

    snapshot(): RecordingState {
        return {
            isEnabled: this.isEnabled,
            isRecording: this.isRecording,
            exerciseId: this._activeSession?.exerciseId,
            eventCount: this._activeSession?.eventCount ?? 0,
        };
    }

    // ── Transitions ───────────────────────────────────────────────────

    /**
     * Transition `_phase` from one of the expected source states to the target
     * state. Throws if the current phase is not in `from`. Fires
     * `onStateChange` as a side effect.
     */
    transitionPhase(from: readonly RecorderPhase[], to: RecorderPhase): void {
        if (!from.includes(this._phase)) {
            throw new Error(
                `Illegal phase transition: expected ${from.join('|')} → ${to}, but current phase is ${this._phase}`,
            );
        }
        this._phase = to;
        this._fire();
    }

    /**
     * Force a phase transition without checking the source phase. Only use for
     * `disable()` which can legally fire from any active phase.
     */
    forcePhase(to: RecorderPhase): void {
        this._phase = to;
        this._fire();
    }

    /** Increment and return the new requested generation. */
    bumpRequestedGeneration(): number {
        return ++this._requestedGeneration;
    }

    // ── Session lifecycle ─────────────────────────────────────────────

    /**
     * Initialise an active session. Called inside `_doStart` sync prelude.
     * Does NOT commit the generation — that happens atomically with
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
        this._fire();
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
        this._fire();
    }

    /** Transition `'starting' → 'recording'` after `startupPhaseComplete` is written. */
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
     *   `ending`    → `idle`
     *   `disabling` → `disabled`
     * Any other phase is an error.
     */
    clearActiveSessionAfterFinalize(): void {
        this._activeSession = null;
        if (this._phase === 'ending') {
            this._phase = 'idle';
        } else if (this._phase === 'disabling') {
            this._phase = 'disabled';
        } else if (this._phase === 'starting') {
            // Pre-commit abort path — nothing was ever written. Fall back to idle.
            this._phase = 'idle';
        } else {
            throw new Error(
                `clearActiveSessionAfterFinalize called from unexpected phase '${this._phase}'`,
            );
        }
        this._fire();
    }

    // ── Internals ─────────────────────────────────────────────────────

    private _fire(): void {
        this._onStateChange.fire(this.snapshot());
    }

    dispose(): void {
        this._onStateChange.dispose();
    }
}
