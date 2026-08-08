import type { TelemetryManager } from './telemetryManager';

/**
 * Public contract of the telemetry / struggle-detection engine.
 *
 * The `@telemetry` build seam swaps a real {@link TelemetryManager} for a no-op
 * in the Open VSX (clean / Theia-cloud) build, so every consumer depends on this
 * interface rather than the concrete class. Derived via `Pick` from the class so
 * the contract cannot drift from the implementation: adding a public method here
 * forces the no-op to implement it; removing one from the class breaks this type.
 *
 * This is a TYPE-ONLY module — `import type { TelemetryManager }` is erased at
 * build time, so referencing it here never pulls the engine into a bundle.
 */
export type ITelemetryManager = Pick<TelemetryManager,
    | 'setWebsocketService'
    | 'startExerciseSession'
    | 'endExerciseSession'
    | 'getStruggleContext'
    | 'getEqEngineState'
    | 'isEnabled'
    | 'showStruggleScoreDialog'
    | 'dispose'
    | 'onDidCalculateEQ'
    | 'onDidShowIntervention'
    | 'onDidAcceptIntervention'
    | 'onDidDismissIntervention'
    | 'onDidBlockIntervention'
    | 'onDidSuppressIntervention'
>;
