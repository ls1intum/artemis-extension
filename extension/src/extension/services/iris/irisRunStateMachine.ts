import type { IrisRunState } from '@shared/types/apiResponses';

import type { IrisWebSocketMessage } from './parseIrisWs';

/**
 * Owns "which Iris run is current, and are we waiting for an answer".
 *
 * Pure logic, no `vscode` import, so it is unit-testable under vitest. The
 * guard set mirrors the Artemis web client's chat service, which needs the same
 * protections against out-of-order, superseded and late frames.
 */
export class IrisRunStateMachine {
    private _currentRunId: string | undefined;
    private _generation = 0;
    private _pendingGeneration = false;
    private _waiting = false;
    private readonly _knownRunIds = new Set<string>();
    private readonly _terminalStateByRunId = new Map<string, IrisRunState>();
    private readonly _finalizedRunIds = new Set<string>();
    private readonly _lastPartialSeqByRunId = new Map<string, number>();
    private readonly _lastActivitySeqByRunId = new Map<string, number>();

    public get waiting(): boolean { return this._waiting; }
    public get currentRunId(): string | undefined { return this._currentRunId; }
    public get generation(): number { return this._generation; }
    public get pendingGeneration(): boolean { return this._pendingGeneration; }

    /**
     * Frame-level admission. MUST run before any per-field handling, including
     * `sessionTitle`: otherwise a stale run can still rename the live session.
     */
    public admit(frame: IrisWebSocketMessage): boolean {
        const runId = frame.runId;
        if (!runId) {
            // Short server overloads omit runId. Admitted, but callers must not
            // let such a frame bind or finalize a run.
            return true;
        }

        const isKnown = this._knownRunIds.has(runId);
        if (this._pendingGeneration && isKnown) { return false; }

        if (!isKnown) {
            this._knownRunIds.add(runId);
            this._currentRunId = runId;
            this._pendingGeneration = false;
        }
        if (this._currentRunId && runId !== this._currentRunId) { return false; }

        const terminal = this._terminalStateByRunId.get(runId);
        if (terminal && frame.runState && frame.runState !== terminal) {
            // Terminal state is monotonic: a late RUNNING must not resurrect it.
            return false;
        }
        return true;
    }

    public acceptPartial(runId: string, seq: number): boolean {
        if (this._finalizedRunIds.has(runId)) { return false; }
        const last = this._lastPartialSeqByRunId.get(runId);
        if (last !== undefined && seq <= last) { return false; }
        this._lastPartialSeqByRunId.set(runId, seq);
        return true;
    }

    public acceptActivities(runId: string, seq: number): boolean {
        if (this._finalizedRunIds.has(runId)) { return false; }
        const last = this._lastActivitySeqByRunId.get(runId);
        if (last !== undefined && seq <= last) { return false; }
        this._lastActivitySeqByRunId.set(runId, seq);
        return true;
    }

    /** @returns the generation id, so the caller can abort exactly its own send. */
    public beginGeneration(): number {
        this._generation += 1;
        this._pendingGeneration = true;
        this._waiting = true;
        return this._generation;
    }

    public abortGeneration(generation: number): void {
        if (generation !== this._generation) { return; }
        this._pendingGeneration = false;
        this._waiting = false;
    }

    public finalizeRun(runId: string | undefined, intermediate: boolean): void {
        // A run-ID-less MESSAGE (e.g. a memory attach on an already-persisted
        // message) must never end the current run.
        if (!runId || intermediate) { return; }
        this._finalizedRunIds.add(runId);
        this._lastPartialSeqByRunId.delete(runId);
        if (runId === this._currentRunId) { this._waiting = false; }
    }

    /**
     * Resolve the in-flight answer out of band: a persisted assistant message
     * past the send baseline was found after a reconnect (see
     * {@link historyResolvesRun}). Finalizes the bound run so a late frame cannot
     * resurrect it and clears `_waiting`, without discarding the known-run guards
     * (unlike {@link reset}).
     *
     * No-op while `_pendingGeneration` is true: the current generation has not
     * bound its run yet, so `_currentRunId` still belongs to a PREVIOUS generation
     * (beginGeneration does not clear it). Resolving then would finalize the wrong
     * run and clear a pending flag a later generation relies on. The never-bound
     * case therefore falls back to the manual reload rather than resolving here.
     */
    public resolveCurrentRun(): void {
        if (this._pendingGeneration) { return; }
        if (this._currentRunId) {
            this._finalizedRunIds.add(this._currentRunId);
            this._lastPartialSeqByRunId.delete(this._currentRunId);
        }
        this._waiting = false;
    }

    /**
     * @returns whether the transition was ACCEPTED. The caller must not mirror
     *   `runState`/`error` into its projection when this returns false, or the
     *   guard would protect only half the state: the machine would still be
     *   waiting while the projection claimed FINISHED.
     */
    public applyRunState(runId: string | undefined, state: IrisRunState): boolean {
        if (state === 'RUNNING') { return true; }

        if (runId) {
            if (runId !== this._currentRunId) { return false; }
            this._terminalStateByRunId.set(runId, state);
            if (!this._pendingGeneration) { this._waiting = false; }
            return true;
        }

        // Unscoped terminal: it can only belong to the run already bound. While
        // a NEW generation is pending it must not clear waiting, or a late
        // FINISHED from the previous run unblocks the new one.
        if (this._pendingGeneration || !this._currentRunId) { return false; }
        this._terminalStateByRunId.set(this._currentRunId, state);
        this._waiting = false;
        return true;
    }


    public reset(): void {
        this._currentRunId = undefined;
        this._pendingGeneration = false;
        this._waiting = false;
        this._knownRunIds.clear();
        this._terminalStateByRunId.clear();
        this._finalizedRunIds.clear();
        this._lastPartialSeqByRunId.clear();
        this._lastActivitySeqByRunId.clear();
    }
}

/** The send-path's view of the machine: open a generation, or abort it. */
export interface RunLifecycle {
    beginGeneration(): number;
    abortGeneration(generation: number): void;
}

/**
 * Wraps {@link IrisRunStateMachine} so opening/aborting a generation also
 * PUBLISHES the resulting projection. Extracted so the publish-on-transition
 * behaviour is testable without a provider.
 *
 * `onBegin` must clear the handler projection first (then publish), or a new
 * send republishes the previous run's FAILED/error together with
 * `waiting: true` and the old alert flashes back until the first frame of the
 * new run. `onAbort` just publishes the now `waiting: false` projection.
 */
export function createRunLifecycle(
    runs: IrisRunStateMachine,
    onBegin: () => void,
    onAbort: () => void,
): RunLifecycle {
    return {
        beginGeneration: () => {
            const generation = runs.beginGeneration();
            onBegin();
            return generation;
        },
        abortGeneration: (generation: number) => {
            runs.abortGeneration(generation);
            onAbort();
        },
    };
}
