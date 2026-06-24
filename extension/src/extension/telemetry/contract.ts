import type * as vscode from 'vscode';

import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { SensorHub } from '@extension/services/sensing';
import type { StruggleCoordinator } from '@extension/services/struggle/struggleCoordinator';

/**
 * Public contract of the struggle-detection engine (Schicht 2/3 owner).
 *
 * The `@telemetry` build seam swaps the real {@link StruggleCoordinator} for a
 * no-op in the Open VSX (clean / Theia-cloud / EduIDE) build, so every consumer
 * depends on this interface rather than the concrete class. Derived via `Pick`
 * from the class so the contract cannot drift: removing a public member from the
 * class breaks this type; the no-op must implement exactly this surface.
 *
 * TYPE-ONLY module — `import type { StruggleCoordinator }` is erased at build
 * time, so referencing the class here never pulls the engine into a bundle.
 */
export type IStruggleCoordinator = Pick<StruggleCoordinator,
    | 'setWebsocketService'
    | 'startExerciseSession'
    | 'getSnapshot'
    | 'isEnabled'
    | 'dispose'
    | 'onDidTick'
    | 'onDidAlert'
    | 'onDidStartSession'
>;

/**
 * Live engine-decision feed for the developer-mode struggle view, behind the
 * `@telemetry` seam so the clean build never imports the real
 * {@link LiveEngineFeed} (it lives under the build-excluded
 * `services/struggle/` subtree). The full factory returns the real feed; the
 * no-op factory returns an inert stub.
 */
export interface ILiveEngineFeed {
    /** Reset the webview chart and stream the buffered + live ticks. */
    subscribe(): void;
    /** Stop streaming live ticks (the buffer keeps filling). */
    unsubscribe(): void;
    /** Drop the buffer (and reset the webview when subscribed). */
    clear(): void;
    dispose(): void;
}

/**
 * Non-engine dependencies the full-build factory needs to construct the live
 * engine. The no-op factory ignores them. The struggle/intervention value graph
 * itself lives ONLY inside the full `@telemetry` module.
 */
export interface StruggleEngineDeps {
    hub: SensorHub;
    exerciseRegistry: ExerciseRegistry;
    /** Registers the lifetime of the intervention service + delivery sink. */
    context: vscode.ExtensionContext;
}
