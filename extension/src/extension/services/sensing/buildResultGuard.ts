/**
 * Shared guard for filtering incoming WebSocket build results.
 *
 * Both the StruggleCoordinator and SessionRecorder receive every WebSocket result
 * for the authenticated user — not just results for the currently active exercise.
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

import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { ResultDTO } from '@extension/types';

export function shouldAcceptBuildResult(
    result: ResultDTO,
    activeExerciseId: number | undefined,
    exerciseRegistry: ExerciseRegistry | undefined,
): boolean {
    if (activeExerciseId === undefined) {
        return false;
    }

    const resultParticipationId = result.participation?.id;
    if (resultParticipationId !== undefined && exerciseRegistry !== undefined) {
        const mappedExerciseId = exerciseRegistry.getExerciseIdByParticipation(resultParticipationId);
        if (mappedExerciseId !== undefined && mappedExerciseId !== activeExerciseId) {
            return false;
        }
    }

    return true;
}
