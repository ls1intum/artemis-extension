import type { ResultDTO } from '@extension/domain';

/** Minimal exercise shape for the participation-id check. */
interface ExerciseLike {
    readonly studentParticipations?: ReadonlyArray<{ readonly id?: number }>;
}

/**
 * Decide whether a WebSocket `newResult` event should trigger a
 * server-driven problem-statement refresh.
 *
 * Pure function so the filter is unit-testable in isolation from
 * {@link ArtemisWebviewProvider}.
 *
 * Rules:
 *   - Must be on the exercise-detail view.
 *   - The current exercise must be known (have an id).
 *   - The result must carry a finite, defined participation id.
 *   - That participation must be one of the exercise's own.
 *
 * The last rule used to name `studentParticipations[0]`, which Artemis builds from an unordered
 * set, so a result for whichever participation came second was dropped and the task markers went
 * stale. Matching any of them is deliberately wider than "the one on screen": telling them apart
 * here would mean carrying the graded/practice mode into a synchronous WebSocket handler, and the
 * cost is a refresh whose re-render produces the same HTML.
 */
export function shouldRefreshPSForResult(
    currentState: string,
    exercise: ExerciseLike | undefined,
    result: Pick<ResultDTO, 'participation'>,
): boolean {
    if (currentState !== 'exercise-detail') { return false; }
    if (!exercise) { return false; }

    const resultPid = result.participation?.id;
    if (resultPid === undefined || !Number.isFinite(resultPid)) { return false; }

    return (exercise.studentParticipations ?? []).some(p => p.id === resultPid);
}
