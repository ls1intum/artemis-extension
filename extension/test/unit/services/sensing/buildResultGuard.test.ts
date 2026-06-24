/**
 * Unit tests for Block F — shouldAcceptBuildResult guard
 *
 * Covers:
 *   1. activeExerciseId=undefined → false (no active session)
 *   2. activeExerciseId set, no participation in result → true (permissive)
 *   3. activeExerciseId=5, participation.id=5, registry maps 5→5 → true
 *   4. activeExerciseId=5, participation.id=7, registry maps 7→7 → false (known mismatch)
 *   5. activeExerciseId=5, participation.id=99, registry does NOT know 99 → true (permissive)
 *   6. activeExerciseId=5, participation.id=7, registry=undefined → true (no registry = permissive)
 */

import * as assert from 'assert';

import type { ResultDTO } from '@extension/domain';
import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import { shouldAcceptBuildResult } from '@extension/services/sensing/buildResultGuard';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

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
        // 99 is not in the registry at all
        assert.strictEqual(shouldAcceptBuildResult(result, 5, registry), true);
    });

    test('6. registry=undefined, mismatched participation → true (no registry = permissive)', () => {
        const result = makeResult(7);
        assert.strictEqual(shouldAcceptBuildResult(result, 5, undefined), true);
    });
});
