// extension/src/extension/services/sensing/collectors/diagnosticsSettle.ts
import * as vscode from 'vscode';

import type { DiagnosticsSettledSignal, SaveSignal } from '@extension/services/sensing/types';
import { shouldRecordUri } from '@extension/services/sensing/uriFilter';

/**
 * Save-triggered diagnostics settle snapshot.
 *
 * After a save on a recordable URI, waits DIAGNOSTICS_SETTLE_MS for the
 * language server to update, then emits one bulk diagnostics dump. Saves
 * within the window coalesce into a single timer, exactly matching the v1
 * CompileEquivalentEmitter save path this replaces (engineering choice,
 * calibrated for LS latency).
 */
export class DiagnosticsSettleCollector implements vscode.Disposable {
    static readonly DIAGNOSTICS_SETTLE_MS = 500;

    private _timer: ReturnType<typeof setTimeout> | undefined;
    private _lastSaveSeq = 0;
    private readonly _subscription: vscode.Disposable;
    private readonly _onDidSettle = new vscode.EventEmitter<DiagnosticsSettledSignal>();
    readonly onDidSettle = this._onDidSettle.event;

    constructor(
        onSave: vscode.Event<SaveSignal>,
        private readonly _readAllDiagnostics: () => ReadonlyArray<[vscode.Uri, vscode.Diagnostic[]]>,
    ) {
        this._subscription = onSave(({ seq, document }) => {
            if (!shouldRecordUri(document.uri)) {
                return;
            }
            this._lastSaveSeq = seq;
            if (this._timer) {
                clearTimeout(this._timer);
            }
            this._timer = setTimeout(() => {
                this._timer = undefined;
                this._onDidSettle.fire({
                    ts: Date.now(),
                    savedSeq: this._lastSaveSeq,
                    entries: this._readAllDiagnostics(),
                });
            }, DiagnosticsSettleCollector.DIAGNOSTICS_SETTLE_MS);
        });
    }

    dispose(): void {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = undefined;
        }
        this._subscription.dispose();
        this._onDidSettle.dispose();
    }
}
