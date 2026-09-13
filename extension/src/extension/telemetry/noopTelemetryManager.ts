import type * as vscode from 'vscode';

import type { EQState, ITelemetryManager, StruggleContext } from '@extension/services/telemetry';
import type { ArtemisWebsocketService } from '@extension/services/websocket';

/**
 * An Event that never fires. Returns a disposable so unsubscription is safe.
 * Runtime-pure: no `vscode.EventEmitter` (which would need a value import).
 */
function neverEvent<T>(): vscode.Event<T> {
    return () => ({ dispose() { /* no event ever fires */ } });
}

/**
 * No-op telemetry manager for the Open VSX (clean / Theia-cloud) build.
 *
 * Mirrors the @dataCollection/noop seam: imports nothing (at runtime) from the
 * struggle engine, so esbuild tree-shakes the whole engine subtree out of the
 * clean bundle. The cloud build therefore ships NO tracking engine. Detection
 * re-enables by flipping the @telemetry alias back to the real factory.
 *
 * Method signatures match the real TelemetryManager exactly (via type-only
 * imports) so the no-op is a faithful drop-in and unit tests can call it directly.
 */
export class NoopTelemetryManager implements ITelemetryManager {
    public readonly onDidCalculateEQ: ITelemetryManager['onDidCalculateEQ'] = neverEvent();
    public readonly onDidShowIntervention: ITelemetryManager['onDidShowIntervention'] = neverEvent();
    public readonly onDidAcceptIntervention: ITelemetryManager['onDidAcceptIntervention'] = neverEvent();
    public readonly onDidDismissIntervention: ITelemetryManager['onDidDismissIntervention'] = neverEvent();
    public readonly onDidBlockIntervention: ITelemetryManager['onDidBlockIntervention'] = neverEvent();
    public readonly onDidSuppressIntervention: ITelemetryManager['onDidSuppressIntervention'] = neverEvent();

    // Never registers a WebSocket message handler → no build results are processed.
    public setWebsocketService(_websocketService: ArtemisWebsocketService): void { /* no-op */ }
    public startExerciseSession(_exerciseId: number, _exerciseRoot?: vscode.Uri): void { /* no-op */ }
    public endExerciseSession(): void { /* no-op */ }
    public getStruggleContext(): StruggleContext {
        return { isStruggling: false, eq: 0, eqConfidence: 'insufficient', recommendedAction: 'none' };
    }
    public getEqEngineState(): EQState {
        return { snapshots: [], currentEQ: 0, pairCount: 0, confidence: 'insufficient' };
    }
    public isEnabled(): boolean { return false; }
    public async showStruggleScoreDialog(): Promise<void> { /* no-op */ }
    public dispose(): void { /* no-op */ }
}
