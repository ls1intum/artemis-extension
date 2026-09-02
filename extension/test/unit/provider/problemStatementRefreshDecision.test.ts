import * as assert from 'assert';

import type { ResultDTO } from '@extension/domain';
import { shouldRefreshPSForResult } from '@extension/provider/problemStatementRefreshDecision';

function makeExercise(participationIds: number[]): { studentParticipations: Array<{ id: number }> } {
    return { studentParticipations: participationIds.map(id => ({ id })) };
}

function makeResult(pid: number | undefined | null): Pick<ResultDTO, 'participation'> {
    return { participation: pid === undefined ? undefined : { id: pid as number } };
}

suite('shouldRefreshPSForResult', () => {
    test('returns false when not on exercise-detail', () => {
        assert.strictEqual(
            shouldRefreshPSForResult('dashboard', makeExercise([7]), makeResult(7)),
            false,
        );
    });

    test('returns false when exercise is undefined', () => {
        assert.strictEqual(
            shouldRefreshPSForResult('exercise-detail', undefined, makeResult(7)),
            false,
        );
    });

    test('returns false when result has no participation id', () => {
        assert.strictEqual(
            shouldRefreshPSForResult('exercise-detail', makeExercise([7]), makeResult(undefined)),
            false,
        );
    });

    test('returns false when participation id is not finite', () => {
        const result = { participation: { id: Number.NaN as unknown as number } };
        assert.strictEqual(
            shouldRefreshPSForResult('exercise-detail', makeExercise([7]), result),
            false,
        );
    });

    test('returns false when rendered exercise has no participations', () => {
        assert.strictEqual(
            shouldRefreshPSForResult('exercise-detail', makeExercise([]), makeResult(7)),
            false,
        );
    });

    test('refreshes for either participation, whichever order the server listed them in', () => {
        // Artemis builds studentParticipations from an unordered set, so comparing against [0] drops
        // results for the other one at random: with [graded, practice] the practice build is lost,
        // with [practice, graded] the graded build is. Both orders must accept both ids.
        for (const order of [[7, 99], [99, 7]]) {
            for (const pid of [7, 99]) {
                assert.strictEqual(
                    shouldRefreshPSForResult('exercise-detail', makeExercise(order), makeResult(pid)),
                    true,
                    `participation ${pid} in order [${order}]`,
                );
            }
        }
    });

    test('ignores a result for a participation this exercise does not have', () => {
        assert.strictEqual(
            shouldRefreshPSForResult('exercise-detail', makeExercise([7, 99]), makeResult(1234)),
            false,
        );
    });

    test('returns true when participation id matches the rendered one', () => {
        assert.strictEqual(
            shouldRefreshPSForResult('exercise-detail', makeExercise([7]), makeResult(7)),
            true,
        );
    });
});
