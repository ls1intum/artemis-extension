import * as vscode from 'vscode';

import { LogCategory, logger } from '@extension/services/loggingService';
import type { RecorderLifecycleState } from '@extension/services/recording/lifecycleController';
import type { RecordedEvent } from '@extension/services/recording/types';
import type { SensorHub } from '@extension/services/sensing';

interface PendingExecution {
    output: string;
    startTime: number;
    truncated: boolean;
    readerDone: boolean;
    endInfo: {
        exitCode: number | undefined;
        terminalName: string;
        command: string;
        cwd: string | undefined;
    } | undefined;
    aborted: boolean;
    /** Generation token captured when the execution started. */
    generation: number;
}

interface TerminalCollectorDeps {
    state: RecorderLifecycleState;
    record: (
        event: RecordedEvent,
        opts: { allowDuringStartup?: boolean; allowDuringEnding?: boolean },
        generation: number,
    ) => void;
}

export class TerminalCollector {
    static readonly MAX_OUTPUT_CHARS = 10240;

    private readonly _pendingExecutions = new Map<vscode.TerminalShellExecution, PendingExecution>();

    constructor(private readonly _deps: TerminalCollectorDeps) {}

    /**
     * Attach shellExecStart/End handlers to the hub channels; the subscriptions
     * are pushed into the caller's tracking array.
     */
    register(hub: SensorHub, disposables: vscode.Disposable[]): void {
        const recordingPhase = (): boolean => this._deps.state.phase === 'recording';

        const shellExecStart = hub.onDidStartTerminalShellExecution(({ event }) => {
            if (!recordingPhase()) { return; }
            const entry: PendingExecution = {
                output: '', startTime: Date.now(), truncated: false,
                readerDone: false, endInfo: undefined, aborted: false,
                generation: this._deps.state.currentGeneration,
            };
            this._pendingExecutions.set(event.execution, entry);
            void this._collectExecutionOutput(event.execution, entry);
        });
        disposables.push(shellExecStart);

        const shellExecEnd = hub.onDidEndTerminalShellExecution(({ event }) => {
            if (!recordingPhase()) { return; }
            const entry = this._pendingExecutions.get(event.execution);
            if (!entry) { return; }
            this._pendingExecutions.delete(event.execution);
            entry.endInfo = {
                exitCode: event.exitCode,
                terminalName: event.terminal.name,
                command: event.execution.commandLine.value,
                cwd: event.execution.cwd?.toString(),
            };
            if (entry.readerDone) {
                this._emitTerminalCommand(entry);
            }
        });
        disposables.push(shellExecEnd);
    }

    /**
     * Abort all pending executions and clear the map. Used by all three
     * teardown paths in ObservationRegistry (flushDebouncesForEnd,
     * discardDebouncesForConsentDowngrade, disposeSubscriptions).
     */
    abortAllPending(): void {
        for (const entry of this._pendingExecutions.values()) {
            entry.aborted = true;
        }
        this._pendingExecutions.clear();
    }

    private async _collectExecutionOutput(
        execution: vscode.TerminalShellExecution,
        entry: PendingExecution,
    ): Promise<void> {
        try {
            for await (const data of execution.read()) {
                if (entry.aborted) { return; }
                if (!entry.truncated) {
                    const remaining = TerminalCollector.MAX_OUTPUT_CHARS - entry.output.length;
                    if (data.length <= remaining) {
                        entry.output += data;
                    } else {
                        entry.output += data.substring(0, remaining);
                        entry.truncated = true;
                    }
                }
            }
        } catch (err) {
            logger.error('Failed to read terminal execution output', LogCategory.TELEMETRY, err);
        }
        entry.readerDone = true;
        if (entry.endInfo && !entry.aborted) {
            this._emitTerminalCommand(entry);
        }
    }

    private _emitTerminalCommand(entry: PendingExecution): void {
        if (!entry.endInfo) { return; }
        if (this._deps.state.phase !== 'recording') { return; }
        const now = Date.now();
        this._deps.record({
            type: 'terminalCommand',
            timestamp: now,
            command: entry.endInfo.command,
            exitCode: entry.endInfo.exitCode,
            output: entry.output,
            outputTruncated: entry.truncated,
            cwd: entry.endInfo.cwd,
            terminalName: entry.endInfo.terminalName,
            durationMs: now - entry.startTime,
        }, {}, entry.generation);
    }
}
