// extension/src/extension/services/intervention/debug/struggleDebug.ts
import * as vscode from 'vscode';

import type { StruggleSnapshot } from '@extension/services/struggle/types';

export async function showStruggleScoreDialog(snapshot: StruggleSnapshot): Promise<void> {
    const lastAlert = snapshot.lastAlert;
    const lines = [
        `Struggling: ${snapshot.isStruggling ? 'yes' : 'no'}`,
        `V (decayed severity): ${snapshot.v.toFixed(3)}`,
        `S (instantaneous): ${snapshot.s.toFixed(3)}`,
        `Boundary at last tick: ${snapshot.primaryBoundary ?? '—'}`,
        `Last alert: ${lastAlert ? `t=${lastAlert.t}s (${lastAlert.types.join('+')}, ${lastAlert.path})` : '—'}`,
        `Session: ${snapshot.sessionSeconds}s`,
    ];
    await vscode.window.showInformationMessage('Engine v2 — struggle state', { modal: true, detail: lines.join('\n') }, 'OK');
}
