import type { ResultDTO } from '@extension/domain';

/** Minimal exercise shape for the participation-id check. */
interface ExerciseLike {
    readonly studentParticipations?: ReadonlyArray<{ readonly id?: number }>;
}

/**
 * Decide whether a WebSocket `newResult` event should trigger a
 * server-driven problem-statement refresh.
 *
 * Pure function so we can unit-test the filter in isolation from
 * {@link ArtemisWebviewProvider}.
 *
 * Rules:
 *   - Must be on the exercise-detail view.
 *   - The current exercise must be known (have an id).
 *   - The result must carry a finite, defined participation id.
 *   - That participation id must match the participation the SSR
 *     coordinator currently renders (today: `studentParticipations[0]`).
 *     When the coordinator's selection logic is generalized in a
 *     follow-up (graded/practice repo aware), this comparison must be
 *     revisited so other-participation results trigger refreshes too.
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
