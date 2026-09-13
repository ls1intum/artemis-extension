import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { ITelemetryManager } from '@extension/services/telemetry';
import { TelemetryManager } from '@extension/services/telemetry';

/** Real telemetry engine (full / Marketplace / Desktop build). */
export function createTelemetryManager(exerciseRegistry?: ExerciseRegistry): ITelemetryManager {
    return new TelemetryManager(exerciseRegistry);
}
