import type * as vscode from 'vscode';

import type { AlertRecord, StruggleSnapshot, TickRecord } from '@extension/services/struggle/types';
import type { ArtemisWebsocketService } from '@extension/services/websocket';

import type { IStruggleCoordinator } from './contract';

/**
 * An Event that never fires. Returns a disposable so unsubscription is safe.
 * Runtime-pure: no `vscode.EventEmitter` (which would need a value import).
 */
function neverEvent<T>(): vscode.Event<T> {
    return () => ({ dispose() { /* no event ever fires */ } });
}

/**
 * No-op struggle coordinator for the Open VSX (clean / Theia-cloud / EduIDE) build.
 *
 * Mirrors the @dataCollection/noop seam: imports NOTHING at runtime from the
 * struggle/intervention engine, so esbuild tree-shakes the whole engine subtree
 * out of the clean bundle. The cloud build therefore ships NO tracking engine.
 * Detection re-enables by flipping the @telemetry alias back to the real factory.
 *
 * The surface matches {@link IStruggleCoordinator} exactly (via type-only imports)
 * so it is a faithful drop-in and unit tests can call it directly.
 */
export class NoopStruggleCoordinator implements IStruggleCoordinator {
    public readonly onDidTick: vscode.Event<TickRecord> = neverEvent();
    public readonly onDidAlert: vscode.Event<AlertRecord> = neverEvent();

    public setWebsocketService(_ws: ArtemisWebsocketService): void { /* no-op */ }
    public startExerciseSession(_exerciseId: number, _exerciseRoot?: vscode.Uri): void { /* no-op */ }
    public isEnabled(): boolean { return false; }
    public getSnapshot(): StruggleSnapshot {
        return {
            isStruggling: false,
            urgency: 0,
            v: 0,
            s: 0,
            primaryBoundary: null,
            lastAlert: null,
            sessionSeconds: 0,
        };
    }
    public dispose(): void { /* no-op */ }
}
