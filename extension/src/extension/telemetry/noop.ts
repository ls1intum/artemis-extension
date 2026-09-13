import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { ITelemetryManager } from '@extension/services/telemetry';

import { NoopTelemetryManager } from './noopTelemetryManager';

/**
 * No-op telemetry seam for the Open VSX (clean) build. Imports nothing from the
 * struggle engine, so esbuild keeps that subtree out of the bundle.
 */
export function createTelemetryManager(_exerciseRegistry?: ExerciseRegistry): ITelemetryManager {
    return new NoopTelemetryManager();
}
