/**
 * Unit tests for the shouldAcceptBuildResult guard (Block F).
 */

import * as assert from 'assert';

import type { ResultDTO } from '@extension/domain';
import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import { shouldAcceptBuildResult } from '@extension/services/sensing/buildResultGuard';

function makeResult(participationId?: number): ResultDTO {
    return {
        id: 1,
        successful: true,
        participation: participationId !== undefined ? { id: participationId } : undefined,
    };
}

function makeRegistry(entries: Array<{ participationId: number; exerciseId: number }>): ExerciseRegistry {
    const registry = new ExerciseRegistry();
    for (const { participationId, exerciseId } of entries) {
        registry.registerExercise(exerciseId, `Exercise ${exerciseId}`, '/repo', undefined, undefined, participationId);
    }
    return registry;
}

suite('shouldAcceptBuildResult (Block F)', () => {
    test('1. activeExerciseId=undefined → false', () => {
        const result = makeResult(5);
        assert.strictEqual(shouldAcceptBuildResult(result, undefined, undefined), false);
    });

    test('2. no participation in result → true (permissive)', () => {
        const result = makeResult(undefined);
        const registry = makeRegistry([{ participationId: 10, exerciseId: 3 }]);
        assert.strictEqual(shouldAcceptBuildResult(result, 5, registry), true);
    });

    test('3. participation maps to active exercise → true', () => {
        const result = makeResult(5);
        const registry = makeRegistry([{ participationId: 5, exerciseId: 5 }]);
        assert.strictEqual(shouldAcceptBuildResult(result, 5, registry), true);
    });

    test('4. participation maps to different exercise → false (known mismatch)', () => {
        const result = makeResult(7);
        const registry = makeRegistry([
            { participationId: 5, exerciseId: 5 },
            { participationId: 7, exerciseId: 7 },
        ]);
        assert.strictEqual(shouldAcceptBuildResult(result, 5, registry), false);
    });

    test('5. participation unknown to registry → true (permissive)', () => {
        const result = makeResult(99);
        const registry = makeRegistry([{ participationId: 5, exerciseId: 5 }]);
        assert.strictEqual(shouldAcceptBuildResult(result, 5, registry), true);
    });

    test('6. registry=undefined, mismatched participation → true (no registry = permissive)', () => {
        const result = makeResult(7);
        assert.strictEqual(shouldAcceptBuildResult(result, 5, undefined), true);
    });
});
