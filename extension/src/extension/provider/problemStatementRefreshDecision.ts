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
 *   - That participation id must match the participation the SSR
 *     coordinator currently renders (`studentParticipations[0]`).
 *     TODO: once the coordinator's selection becomes graded/practice aware,
 *     revisit this comparison so other-participation results refresh too.
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

    const renderedPid = exercise.studentParticipations?.[0]?.id;
    if (renderedPid === undefined) { return false; }

    return resultPid === renderedPid;
}
