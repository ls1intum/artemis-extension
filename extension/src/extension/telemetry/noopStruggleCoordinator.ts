import type * as vscode from 'vscode';

import type { StruggleDebugSnapshot } from '@shared/messageContracts';

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
    public readonly onDidStartSession: vscode.Event<void> = neverEvent();
    public readonly onDidEndSession: vscode.Event<void> = neverEvent();

    /** No active exercise in the clean (no-engine) build: there is no session to key off. */
    public get activeExerciseId(): number | undefined { return undefined; }

    public setWebsocketService(_ws: ArtemisWebsocketService): void { /* no-op */ }
    public startExerciseSession(_exerciseId: number, _exerciseRoot?: vscode.Uri): void { /* no-op */ }
    public endExerciseSession(): void { /* no-op */ }
    public isEnabled(): boolean { return false; }
    public getSnapshot(): StruggleSnapshot {
        return {
            isStruggling: false,
            urgency: 0,
            s: 0,
            primaryBoundary: null,
            lastAlert: null,
            sessionSeconds: 0,
        };
    }
    /** Inert snapshot for the clean build. The dev dashboard is stubbed out there, so this is
     *  never rendered; caps are zeroed because importing SPEC/TUNING would defeat the seam. */
    public getDebugSnapshot(): StruggleDebugSnapshot {
        return {
            sessionActive: false,
            nowMs: 0,
            sessionStartMs: 0,
            lastAlertMs: null,
            lastFmBadMs: null,
            throttle: null,
            fN2Active: false,
            effectiveWindowS: 0,
            longestGapS: 0,
            decisionTrace: null,
            testStagnation: null,
            caps: {
                warmupS: 0, cooldownS: 0, graceS: 0, n2MinActiveS: 0, gapNormS: 0,
            },
        };
    }
    public dispose(): void { /* no-op */ }
}
