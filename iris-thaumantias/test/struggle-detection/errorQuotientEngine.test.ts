/**
 * ErrorQuotientEngine Unit Tests
 *
 * Tests the Jadud 2006 EQ pair-scoring formula:
 *   score(eᵢ, eᵢ₊₁) = 11 if both error AND shared family
 *                       = 8  if both error AND no shared family
 *                       = 0  otherwise
 *   EQ = mean( score / 11 )
 */

import * as assert from 'assert';
import { ErrorQuotientEngine } from '../../src/services/telemetry/metrics/errorQuotientEngine';
import { ErrorSnapshot, DEFAULT_EQ_CONFIG, InterventionState } from '../../src/services/telemetry/types';
import { InterventionDecisionEngine } from '../../src/services/telemetry/decision/interventionDecisionEngine';
import { InterventionFilter } from '../../src/services/telemetry/interventionFilter';

function makeSnapshot(
    timestamp: number,
    hasErrors: boolean,
    families: string[] = [],
    errorCount?: number
): ErrorSnapshot {
    return {
        timestamp,
        hasErrors,
        errorFamilies: new Set(families),
        errorCount: errorCount ?? families.length,
    };
}

suite('ErrorQuotientEngine', () => {

    let engine: ErrorQuotientEngine;

    setup(() => {
        engine = new ErrorQuotientEngine();
    });

    // =========================================================================
    // Basic EQ Calculation
    // =========================================================================

    suite('Basic EQ Calculation', () => {

        test('empty engine returns EQ=0, confidence=none', () => {
            const { eq, confidence } = engine.getCurrentEQ();
            assert.strictEqual(eq, 0);
            assert.strictEqual(confidence, 'none');
        });

        test('single snapshot returns EQ=0, confidence=none', () => {
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            const { eq, confidence } = engine.getCurrentEQ();
            assert.strictEqual(eq, 0);
            assert.strictEqual(confidence, 'none');
        });

        test('two clean snapshots → EQ=0', () => {
            engine.addSnapshot(makeSnapshot(1000, false));
            engine.addSnapshot(makeSnapshot(7000, false));
            const { eq } = engine.getCurrentEQ();
            assert.strictEqual(eq, 0);
        });

        test('one clean + one error → EQ=0', () => {
            engine.addSnapshot(makeSnapshot(1000, false));
            engine.addSnapshot(makeSnapshot(7000, true, ['ts:2304']));
            const { eq } = engine.getCurrentEQ();
            assert.strictEqual(eq, 0);
        });

        test('one error + one clean → EQ=0', () => {
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            engine.addSnapshot(makeSnapshot(7000, false));
            const { eq } = engine.getCurrentEQ();
            assert.strictEqual(eq, 0);
        });
    });

    // =========================================================================
    // Pair Scoring: all same error → EQ = 1.0
    // =========================================================================

    suite('All Same Error (EQ = 1.0)', () => {

        test('two snapshots with same error → EQ=1.0 (11/11)', () => {
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            engine.addSnapshot(makeSnapshot(7000, true, ['ts:2304']));
            const { eq } = engine.getCurrentEQ();
            assert.strictEqual(eq, 1.0);
        });

        test('many snapshots all same error → EQ=1.0', () => {
            for (let i = 0; i < 10; i++) {
                engine.addSnapshot(makeSnapshot(1000 + i * 6000, true, ['ts:2304']));
            }
            const { eq } = engine.getCurrentEQ();
            assert.strictEqual(eq, 1.0);
        });
    });

    // =========================================================================
    // Pair Scoring: all different errors → EQ = 8/11 ≈ 0.727
    // =========================================================================

    suite('All Different Errors (EQ ≈ 8/11)', () => {

        test('two snapshots with different errors → EQ=8/11', () => {
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            engine.addSnapshot(makeSnapshot(7000, true, ['ts:7006']));
            const { eq } = engine.getCurrentEQ();
            assertApprox(eq, 8 / 11);
        });

        test('many snapshots all different errors → EQ=8/11', () => {
            for (let i = 0; i < 10; i++) {
                engine.addSnapshot(makeSnapshot(1000 + i * 6000, true, [`ts:${i}`]));
            }
            const { eq } = engine.getCurrentEQ();
            assertApprox(eq, 8 / 11);
        });
    });

    // =========================================================================
    // Mixed: error-clean pairs score 0 → lowers EQ
    // =========================================================================

    suite('Mixed Pairs', () => {

        test('alternating error/clean → EQ=0', () => {
            // error, clean, error, clean → pairs: (err,clean)=0, (clean,err)=0, (err,clean)=0
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            engine.addSnapshot(makeSnapshot(7000, false));
            engine.addSnapshot(makeSnapshot(13000, true, ['ts:2304']));
            engine.addSnapshot(makeSnapshot(19000, false));
            const { eq } = engine.getCurrentEQ();
            assert.strictEqual(eq, 0);
        });

        test('mixed same/different/clean → correct average', () => {
            // Pair 1: both error, same family → 11/11 = 1.0
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            engine.addSnapshot(makeSnapshot(7000, true, ['ts:2304']));
            // Pair 2: both error, different → 8/11
            engine.addSnapshot(makeSnapshot(13000, true, ['ts:7006']));
            // Pair 3: error + clean → 0
            engine.addSnapshot(makeSnapshot(19000, false));

            // EQ = (11/11 + 8/11 + 0/11) / 3 = (1.0 + 8/11 + 0) / 3
            const expected = (1.0 + 8 / 11 + 0) / 3;
            const { eq } = engine.getCurrentEQ();
            assertApprox(eq, expected);
        });
    });

    // =========================================================================
    // Confidence Levels
    // =========================================================================

    suite('Confidence Levels', () => {

        test('0-1 snapshots → none', () => {
            assert.strictEqual(engine.getCurrentEQ().confidence, 'none');
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            assert.strictEqual(engine.getCurrentEQ().confidence, 'none');
        });

        test('2-3 snapshots (1-2 pairs) → none', () => {
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            engine.addSnapshot(makeSnapshot(7000, true, ['ts:2304']));
            assert.strictEqual(engine.getCurrentEQ().confidence, 'none');
            engine.addSnapshot(makeSnapshot(13000, true, ['ts:2304']));
            assert.strictEqual(engine.getCurrentEQ().confidence, 'none');
        });

        test('4-6 snapshots (3-5 pairs) → low', () => {
            for (let i = 0; i < 4; i++) {
                engine.addSnapshot(makeSnapshot(1000 + i * 6000, true, ['ts:2304']));
            }
            assert.strictEqual(engine.getCurrentEQ().confidence, 'low');
        });

        test('7-15 snapshots (6-14 pairs) → medium', () => {
            for (let i = 0; i < 7; i++) {
                engine.addSnapshot(makeSnapshot(1000 + i * 6000, true, ['ts:2304']));
            }
            assert.strictEqual(engine.getCurrentEQ().confidence, 'medium');
        });

        test('16+ snapshots (15+ pairs) → high', () => {
            for (let i = 0; i < 16; i++) {
                engine.addSnapshot(makeSnapshot(1000 + i * 6000, true, ['ts:2304']));
            }
            assert.strictEqual(engine.getCurrentEQ().confidence, 'high');
        });
    });

    // =========================================================================
    // Dedup
    // =========================================================================

    suite('Dedup (5s window, same families)', () => {

        test('same snapshot within 5s → deduped', () => {
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            engine.addSnapshot(makeSnapshot(3000, true, ['ts:2304'])); // within 5s, same families
            assert.strictEqual(engine.getState().snapshots.length, 1);
        });

        test('different families within 5s → NOT deduped', () => {
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            engine.addSnapshot(makeSnapshot(3000, true, ['ts:7006'])); // different families
            assert.strictEqual(engine.getState().snapshots.length, 2);
        });

        test('same families after 5s → NOT deduped', () => {
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            engine.addSnapshot(makeSnapshot(7000, true, ['ts:2304'])); // 6s later
            assert.strictEqual(engine.getState().snapshots.length, 2);
        });

        test('clean snapshots within 5s → deduped', () => {
            engine.addSnapshot(makeSnapshot(1000, false));
            engine.addSnapshot(makeSnapshot(3000, false)); // both clean, within 5s
            assert.strictEqual(engine.getState().snapshots.length, 1);
        });

        test('error→clean within 5s → NOT deduped', () => {
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            engine.addSnapshot(makeSnapshot(3000, false)); // different error state
            assert.strictEqual(engine.getState().snapshots.length, 2);
        });
    });

    // =========================================================================
    // Session Split (30min inactivity)
    // =========================================================================

    suite('Session Split', () => {

        test('30min gap clears snapshots', () => {
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            engine.addSnapshot(makeSnapshot(7000, true, ['ts:2304']));
            assert.strictEqual(engine.getState().snapshots.length, 2);

            // 31 minutes later
            engine.addSnapshot(makeSnapshot(7000 + 31 * 60 * 1000, true, ['ts:2304']));
            assert.strictEqual(engine.getState().snapshots.length, 1);
            assert.strictEqual(engine.getCurrentEQ().eq, 0);
        });

        test('29min gap does NOT clear snapshots', () => {
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            engine.addSnapshot(makeSnapshot(7000, true, ['ts:2304']));

            // 29 minutes later
            engine.addSnapshot(makeSnapshot(7000 + 29 * 60 * 1000, true, ['ts:2304']));
            assert.strictEqual(engine.getState().snapshots.length, 3);
        });
    });

    // =========================================================================
    // Session Reset
    // =========================================================================

    suite('Session Reset', () => {

        test('resetSession clears everything', () => {
            for (let i = 0; i < 10; i++) {
                engine.addSnapshot(makeSnapshot(1000 + i * 6000, true, ['ts:2304']));
            }
            assert.ok(engine.getCurrentEQ().eq > 0);

            engine.resetSession();
            assert.strictEqual(engine.getCurrentEQ().eq, 0);
            assert.strictEqual(engine.getCurrentEQ().confidence, 'none');
            assert.strictEqual(engine.getState().snapshots.length, 0);
        });
    });

    // =========================================================================
    // Quantization Table from MVP Section 2.4
    // At 7 events (6 pairs), verify discrete EQ values
    // =========================================================================

    suite('Quantization at 7 Events (6 Pairs)', () => {

        test('0 error pairs → EQ=0.000', () => {
            // 7 clean snapshots
            for (let i = 0; i < 7; i++) {
                engine.addSnapshot(makeSnapshot(1000 + i * 6000, false));
            }
            assert.strictEqual(engine.getCurrentEQ().eq, 0);
        });

        test('1 different-error pair → EQ≈0.121', () => {
            // 1 pair with different errors (score 8), 5 pairs with 0
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            engine.addSnapshot(makeSnapshot(7000, true, ['ts:7006'])); // different → 8/11
            // 5 clean to make 0-scoring pairs
            for (let i = 2; i < 7; i++) {
                engine.addSnapshot(makeSnapshot(1000 + i * 6000, false));
            }
            // EQ = (8/11 + 0*5) / 6 = 8/66
            assertApprox(engine.getCurrentEQ().eq, 8 / 66);
        });

        test('1 same-error pair → EQ≈0.167', () => {
            // 1 pair with same errors (score 11), 5 pairs with 0
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            engine.addSnapshot(makeSnapshot(7000, true, ['ts:2304'])); // same → 11/11
            for (let i = 2; i < 7; i++) {
                engine.addSnapshot(makeSnapshot(1000 + i * 6000, false));
            }
            // EQ = (11/11 + 0*5) / 6 = 1/6
            assertApprox(engine.getCurrentEQ().eq, 1 / 6);
        });

        test('6 same-error pairs → EQ=1.000', () => {
            for (let i = 0; i < 7; i++) {
                engine.addSnapshot(makeSnapshot(1000 + i * 6000, true, ['ts:2304']));
            }
            assert.strictEqual(engine.getCurrentEQ().eq, 1.0);
            assert.strictEqual(engine.getCurrentEQ().confidence, 'medium');
        });
    });

    // =========================================================================
    // Multi-family snapshots
    // =========================================================================

    suite('Multi-Family Snapshots', () => {

        test('shared subset counts as same type', () => {
            // Snapshot 1: errors A, B
            // Snapshot 2: errors B, C
            // Intersection = {B} → same type → score 11
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:A', 'ts:B']));
            engine.addSnapshot(makeSnapshot(7000, true, ['ts:B', 'ts:C']));
            const { eq } = engine.getCurrentEQ();
            assert.strictEqual(eq, 1.0); // 11/11
        });

        test('no shared families → different type', () => {
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:A', 'ts:B']));
            engine.addSnapshot(makeSnapshot(7000, true, ['ts:C', 'ts:D']));
            const { eq } = engine.getCurrentEQ();
            assertApprox(eq, 8 / 11);
        });
    });

    // =========================================================================
    // getState()
    // =========================================================================

    suite('getState()', () => {

        test('returns correct state', () => {
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            engine.addSnapshot(makeSnapshot(7000, true, ['ts:2304']));
            engine.addSnapshot(makeSnapshot(13000, true, ['ts:2304']));

            const state = engine.getState();
            assert.strictEqual(state.snapshots.length, 3);
            assert.strictEqual(state.pairCount, 2);
            assert.strictEqual(state.currentEQ, 1.0);
            assert.strictEqual(state.confidence, 'none'); // 2 pairs < 3
        });
    });
});

// =========================================================================
// Boundary Tests for EQ-to-Intervention Thresholds (Plan Phase 4, Item 18)
// Tests exact values at 0.15, 0.35, 0.60 and floating-point neighbors.
// =========================================================================

suite('EQ Threshold Boundary Tests (InterventionDecisionEngine)', () => {

    let filter: InterventionFilter;
    let decisionEngine: InterventionDecisionEngine;

    // Standard state: exercise running > 5min, no interventions yet, no dismiss
    const defaultState: InterventionState = {
        sessionInterventionCount: 0,
        lastInterventionTime: 0,
        lastDismissed: false,
        lastAccepted: false,
    };

    setup(() => {
        filter = new InterventionFilter();
        // Set exercise start time far enough in the past (> 5min)
        filter.setExerciseStartTime();
        (filter as any)._exerciseStartTime = Date.now() - 10 * 60 * 1000;
        decisionEngine = new InterventionDecisionEngine(filter);
    });

    // --- 0.15 boundary (none → subtle) ---

    test('EQ = 0.1499 → level = none', () => {
        const result = decisionEngine.evaluate(0.1499, 'medium', 'idle', defaultState);
        assert.strictEqual(result.level, 'none');
        assert.strictEqual(result.shouldIntervene, false);
    });

    test('EQ = 0.15 → level = subtle', () => {
        const result = decisionEngine.evaluate(0.15, 'medium', 'idle', defaultState);
        assert.strictEqual(result.level, 'subtle');
    });

    test('EQ = 0.1501 → level = subtle', () => {
        const result = decisionEngine.evaluate(0.1501, 'medium', 'idle', defaultState);
        assert.strictEqual(result.level, 'subtle');
    });

    // --- 0.35 boundary (subtle → notification) ---

    test('EQ = 0.3499 → level = subtle', () => {
        const result = decisionEngine.evaluate(0.3499, 'medium', 'idle', defaultState);
        assert.strictEqual(result.level, 'subtle');
    });

    test('EQ = 0.35 → level = notification', () => {
        const result = decisionEngine.evaluate(0.35, 'medium', 'idle', defaultState);
        assert.strictEqual(result.level, 'notification');
    });

    test('EQ = 0.3501 → level = notification', () => {
        const result = decisionEngine.evaluate(0.3501, 'medium', 'idle', defaultState);
        assert.strictEqual(result.level, 'notification');
    });

    // --- 0.60 boundary (notification → proactive) ---

    test('EQ = 0.5999 → level = notification', () => {
        const result = decisionEngine.evaluate(0.5999, 'medium', 'idle', defaultState);
        assert.strictEqual(result.level, 'notification');
    });

    test('EQ = 0.60 → level = proactive', () => {
        const result = decisionEngine.evaluate(0.60, 'medium', 'idle', defaultState);
        assert.strictEqual(result.level, 'proactive');
    });

    test('EQ = 0.6001 → level = proactive', () => {
        const result = decisionEngine.evaluate(0.6001, 'medium', 'idle', defaultState);
        assert.strictEqual(result.level, 'proactive');
    });

    // --- Confidence gate overrides EQ ---

    test('EQ = 1.0 but confidence = none → no intervention', () => {
        const result = decisionEngine.evaluate(1.0, 'none', 'idle', defaultState);
        assert.strictEqual(result.shouldIntervene, false);
        assert.strictEqual(result.level, 'none');
    });

    test('EQ = 1.0 but confidence = low → no intervention', () => {
        const result = decisionEngine.evaluate(1.0, 'low', 'idle', defaultState);
        assert.strictEqual(result.shouldIntervene, false);
        assert.strictEqual(result.level, 'none');
    });

    test('EQ = 0.15 with confidence = medium → subtle intervention', () => {
        const result = decisionEngine.evaluate(0.15, 'medium', 'idle', defaultState);
        assert.strictEqual(result.level, 'subtle');
    });

    // --- Floating-point edge: discrete EQ values from 6 pairs ---

    test('6 pairs: 1 same-error pair → EQ = 1/6 ≈ 0.1667 → subtle (just above 0.15)', () => {
        const engine = new ErrorQuotientEngine();
        // 1 same-error pair + 5 zero pairs
        engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
        engine.addSnapshot(makeSnapshot(7000, true, ['ts:2304'])); // same → 11/11
        for (let i = 2; i < 7; i++) {
            engine.addSnapshot(makeSnapshot(1000 + i * 6000, false));
        }
        const { eq, confidence } = engine.getCurrentEQ();
        assertApprox(eq, 1 / 6); // ≈ 0.1667
        assert.strictEqual(confidence, 'medium');
        const result = decisionEngine.evaluate(eq, confidence, 'idle', defaultState);
        assert.strictEqual(result.level, 'subtle');
    });

    test('6 pairs: 1 different-error pair → EQ = 8/66 ≈ 0.1212 → none (just below 0.15)', () => {
        const engine = new ErrorQuotientEngine();
        engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
        engine.addSnapshot(makeSnapshot(7000, true, ['ts:7006'])); // different → 8/11
        for (let i = 2; i < 7; i++) {
            engine.addSnapshot(makeSnapshot(1000 + i * 6000, false));
        }
        const { eq, confidence } = engine.getCurrentEQ();
        assertApprox(eq, 8 / 66); // ≈ 0.1212
        assert.strictEqual(confidence, 'medium');
        const result = decisionEngine.evaluate(eq, confidence, 'idle', defaultState);
        assert.strictEqual(result.level, 'none');
    });

    test('6 pairs: 2 same-error pairs → EQ = 2/6 ≈ 0.3333 → subtle (just below 0.35)', () => {
        const engine = new ErrorQuotientEngine();
        // 2 consecutive same-error pairs, then clean
        engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
        engine.addSnapshot(makeSnapshot(7000, true, ['ts:2304'])); // pair 1: same
        engine.addSnapshot(makeSnapshot(13000, true, ['ts:2304'])); // pair 2: same
        for (let i = 3; i < 7; i++) {
            engine.addSnapshot(makeSnapshot(1000 + i * 6000, false));
        }
        const { eq } = engine.getCurrentEQ();
        assertApprox(eq, 2 / 6); // ≈ 0.3333
        const result = decisionEngine.evaluate(eq, 'medium', 'idle', defaultState);
        assert.strictEqual(result.level, 'subtle');
    });

    test('6 pairs: 4 same-error pairs → EQ = 4/6 ≈ 0.6667 → proactive (above 0.60)', () => {
        const engine = new ErrorQuotientEngine();
        engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
        engine.addSnapshot(makeSnapshot(7000, true, ['ts:2304']));
        engine.addSnapshot(makeSnapshot(13000, true, ['ts:2304']));
        engine.addSnapshot(makeSnapshot(19000, true, ['ts:2304']));
        engine.addSnapshot(makeSnapshot(25000, true, ['ts:2304'])); // 4 same pairs so far
        engine.addSnapshot(makeSnapshot(31000, false));
        engine.addSnapshot(makeSnapshot(37000, false));
        const { eq } = engine.getCurrentEQ();
        assertApprox(eq, 4 / 6); // ≈ 0.6667
        const result = decisionEngine.evaluate(eq, 'medium', 'idle', defaultState);
        assert.strictEqual(result.level, 'proactive');
    });
});

// =========================================================================
// Helpers
// =========================================================================

function assertApprox(actual: number, expected: number, tolerance = 0.001): void {
    assert.ok(
        Math.abs(actual - expected) < tolerance,
        `Expected ${expected} ± ${tolerance}, got ${actual}`
    );
}
