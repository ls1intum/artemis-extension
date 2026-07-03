// extension/src/extension/services/intervention/debug/struggleDebug.ts
import * as vscode from 'vscode';

import type { StruggleSnapshot } from '@extension/services/struggle/types';

export async function showStruggleScoreDialog(snapshot: StruggleSnapshot): Promise<void> {
    const lastAlert = snapshot.lastAlert;
    const lines = [
        `Struggling: ${snapshot.isStruggling ? 'yes' : 'no'}`,
        `Urgency (S_base, decision signal): ${snapshot.urgency.toFixed(3)}`,
        `S (instantaneous, telemetry): ${snapshot.s.toFixed(3)}`,
        `Boundary at last tick: ${snapshot.primaryBoundary ?? '—'}`,
        `Last alert: ${lastAlert ? `t=${lastAlert.t}s (${lastAlert.kind}: ${lastAlert.summary})` : '—'}`,
        `Session: ${snapshot.sessionSeconds}s`,
    ];
    await vscode.window.showInformationMessage('Engine v3 — struggle state', { modal: true, detail: lines.join('\n') }, 'OK');
}
