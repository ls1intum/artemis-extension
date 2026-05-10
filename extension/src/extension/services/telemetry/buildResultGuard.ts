/**
 * Shared guard for filtering incoming WebSocket build results.
 *
 * Both TelemetryManager and SessionRecorder receive every WebSocket result for
 * the authenticated user — not just results for the currently active exercise.
 * This helper centralises the filtering logic so neither component duplicates it.
 *
 * Policy:
 *   - Skip when no exercise session is active (activeExerciseId === undefined).
 *   - Skip when the result's participationId maps to a DIFFERENT exercise than
 *     the active one (known mismatch → drop).
 *   - Pass through when the participationId is unknown (registry has not learned
 *     it yet). Permissive on unknown mapping avoids losing real data during the
 *     first course-load window.
 */

import type { ResultDTO } from '../../types';
import type { ExerciseRegistry } from '../exerciseRegistry';

export function shouldAcceptBuildResult(
    result: ResultDTO,
    activeExerciseId: number | undefined,
    exerciseRegistry: ExerciseRegistry | undefined,
): boolean {
    // Guard 1: no active session → drop everything.
    if (activeExerciseId === undefined) {
        return false;
    }

    // Guard 2: known participation mapped to a different exercise → drop.
    const resultParticipationId = result.participation?.id;
    if (resultParticipationId !== undefined && exerciseRegistry !== undefined) {
        const mappedExerciseId = exerciseRegistry.getExerciseIdByParticipation(resultParticipationId);
        if (mappedExerciseId !== undefined && mappedExerciseId !== activeExerciseId) {
            return false;
        }
    }

    return true;
}
