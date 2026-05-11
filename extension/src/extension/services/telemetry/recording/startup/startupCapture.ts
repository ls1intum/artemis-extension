import * as vscode from 'vscode';
import type { RecordedEvent } from '../types';
import { collectDiagnostics, collectSelectionChange, collectVisibleRangeChange } from '../eventCollectors';
import { shouldRecordUri } from '../uriFilter';
import { logger, LogCategory } from '../../../loggingService';

/**
 * Context supplied to startup contributors. Contributors run synchronously
 * inside the startup emission sequence, so they see a fully-committed session.
 */
export interface StartupContext {
    exerciseId: number;
    participantId: string | undefined;
    exerciseRoot: string | undefined;
    sessionId: string;
    timestamp: number;
}

/**
 * Synchronous producer of startup events. Must not perform async work —
 * emission order depends on deterministic sync iteration.
 */
export type StartupContributor = (ctx: StartupContext) => RecordedEvent[];

interface StartupCaptureDeps {
    record: (
        event: RecordedEvent,
        opts: { allowDuringStartup?: boolean; allowDuringEnding?: boolean },
        generation: number,
    ) => void;
}

/**
 * Emits the synchronous startup-event sequence for a freshly committed
 * session: initial diagnostics, external contributors, and initial-state
 * events. Called by LifecycleController AFTER open-file snapshots and
 * post-snapshot re-checks, BEFORE the startupPhaseComplete lifecycle append.
 *
 * Narrowed per plan v5: does NOT touch snapshots and does NOT emit
 * startupPhaseComplete. Does not re-check phase/generation internally; the
 * caller (LifecycleController) re-checks immediately before and after this
 * call.
 */
export class StartupCapture {
    private readonly _contributors: StartupContributor[] = [];

    constructor(private readonly _deps: StartupCaptureDeps) {}

    /**
     * Register a startup contributor. Returns a Disposable that deregisters.
     */
    register(contributor: StartupContributor): vscode.Disposable {
        this._contributors.push(contributor);
        return new vscode.Disposable(() => {
            const idx = this._contributors.indexOf(contributor);
            if (idx >= 0) {
                this._contributors.splice(idx, 1);
            }
        });
    }

    /**
     * Emit the full startup event sequence. Order matches current code:
     *   1. initial diagnostics (one event per open doc with diagnostics)
     *   2. external contributors (in registration order)
     *   3. initial-state events (windowFocus, selection/visibleRange per
     *      visible editor, fileSwitch for active editor, terminalOpenClose
     *      for each open terminal)
     *
     * `seedActiveEditor` is called after the fileSwitch is emitted so
     * listener-side active-editor tracking aligns with the recorded event.
     */
    emitStartupEvents(
        ctx: StartupContext,
        generation: number,
        exerciseRootUri: vscode.Uri | undefined,
        seedActiveEditor: (uri: string | undefined) => void,
    ): void {
        this._emitInitialDiagnostics(generation, exerciseRootUri);
        this._emitContributors(ctx, generation);
        this._emitInitialStateEvents(generation, exerciseRootUri, seedActiveEditor);
    }

    private _emitInitialDiagnostics(generation: number, exerciseRootUri: vscode.Uri | undefined): void {
        const allDiagnostics = vscode.languages.getDiagnostics();
        for (const [uri, diagnostics] of allDiagnostics) {
            if (!shouldRecordUri(uri, exerciseRootUri) || diagnostics.length === 0) {
                continue;
            }
            this._deps.record(
                collectDiagnostics(uri),
                { allowDuringStartup: true },
                generation,
            );
        }
    }

    private _emitContributors(ctx: StartupContext, generation: number): void {
        for (const contributor of this._contributors) {
            let events: RecordedEvent[] = [];
            try {
                events = contributor(ctx);
            } catch (err) {
                logger.error('Startup contributor threw', LogCategory.TELEMETRY, err);
                continue;
            }
            for (const ev of events) {
                this._deps.record(ev, { allowDuringStartup: true }, generation);
            }
        }
    }

    private _emitInitialStateEvents(
        generation: number,
        exerciseRootUri: vscode.Uri | undefined,
        seedActiveEditor: (uri: string | undefined) => void,
    ): void {
        // 1. Window focus.
        try {
            this._deps.record(
                {
                    type: 'windowFocus',
                    timestamp: Date.now(),
                    focused: vscode.window.state.focused,
                },
                { allowDuringStartup: true },
                generation,
            );
        } catch (err) {
            logger.error('Failed to emit initial windowFocus', LogCategory.TELEMETRY, err);
        }

        // 2. Selection + visible range for every visible file editor.
        for (const editor of vscode.window.visibleTextEditors) {
            if (!shouldRecordUri(editor.document.uri, exerciseRootUri)) {
                continue;
            }
            try {
                this._deps.record(
                    collectSelectionChange(editor, undefined),
                    { allowDuringStartup: true },
                    generation,
                );
                this._deps.record(
                    collectVisibleRangeChange(editor),
                    { allowDuringStartup: true },
                    generation,
                );
            } catch (err) {
                logger.error('Failed to emit initial editor state', LogCategory.TELEMETRY, err);
            }
        }

        // 3. fileSwitch for the active editor (if any).
        const activeUri = vscode.window.activeTextEditor?.document.uri;
        if (activeUri && shouldRecordUri(activeUri, exerciseRootUri)) {
            this._deps.record(
                { type: 'fileSwitch', timestamp: Date.now(), fromUri: undefined, toUri: activeUri.toString() },
                { allowDuringStartup: true },
                generation,
            );
            seedActiveEditor(activeUri.toString());
        }

        // 4. terminalOpenClose('opened') for every already-open terminal.
        for (const terminal of vscode.window.terminals) {
            this._deps.record(
                {
                    type: 'terminalOpenClose',
                    timestamp: Date.now(),
                    action: 'opened',
                    terminalName: terminal.name,
                },
                { allowDuringStartup: true },
                generation,
            );
        }
    }
}
