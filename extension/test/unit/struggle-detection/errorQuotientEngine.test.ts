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

import { InterventionDecisionEngine } from '@extension/services/telemetry/decision/interventionDecisionEngine';
import { InterventionFilter } from '@extension/services/telemetry/interventionFilter';
import { ErrorQuotientEngine } from '@extension/services/telemetry/metrics/errorQuotientEngine';
import { ErrorSnapshot, InterventionState } from '@extension/services/telemetry/types';

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

        test('empty engine returns EQ=0, confidence=insufficient', () => {
            const { eq, confidence } = engine.getCurrentEQ();
            assert.strictEqual(eq, 0);
            assert.strictEqual(confidence, 'insufficient');
        });

        test('single snapshot returns EQ=0, confidence=insufficient', () => {
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            const { eq, confidence } = engine.getCurrentEQ();
            assert.strictEqual(eq, 0);
            assert.strictEqual(confidence, 'insufficient');
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

    suite('Confidence Levels (binary gate)', () => {

        test('0 snapshots → insufficient', () => {
            assert.strictEqual(engine.getCurrentEQ().confidence, 'insufficient');
        });

        test('1 snapshot → insufficient', () => {
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            assert.strictEqual(engine.getCurrentEQ().confidence, 'insufficient');
        });

        test('2-3 snapshots (1-2 pairs) → insufficient', () => {
            engine.addSnapshot(makeSnapshot(1000, true, ['ts:2304']));
            engine.addSnapshot(makeSnapshot(7000, true, ['ts:2304']));
            assert.strictEqual(engine.getCurrentEQ().confidence, 'insufficient');
            engine.addSnapshot(makeSnapshot(13000, true, ['ts:2304']));
            assert.strictEqual(engine.getCurrentEQ().confidence, 'insufficient');
        });

        test('4-6 snapshots (3-5 pairs) → insufficient', () => {
            for (let i = 0; i < 6; i++) {
                engine.addSnapshot(makeSnapshot(1000 + i * 6000, true, ['ts:2304']));
            }
            assert.strictEqual(engine.getCurrentEQ().confidence, 'insufficient');
        });

        test('7 snapshots (6 pairs) → sufficient [P3, Section 4]', () => {
            for (let i = 0; i < 7; i++) {
                engine.addSnapshot(makeSnapshot(1000 + i * 6000, true, ['ts:2304']));
            }
            assert.strictEqual(engine.getCurrentEQ().confidence, 'sufficient');
        });

        test('16+ snapshots (15+ pairs) → sufficient', () => {
            for (let i = 0; i < 16; i++) {
                engine.addSnapshot(makeSnapshot(1000 + i * 6000, true, ['ts:2304']));
            }
            assert.strictEqual(engine.getCurrentEQ().confidence, 'sufficient');
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
            assert.strictEqual(engine.getCurrentEQ().confidence, 'insufficient');
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
            assert.strictEqual(engine.getCurrentEQ().confidence, 'sufficient');
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
            assert.strictEqual(state.confidence, 'insufficient'); // 2 pairs < 6
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
        const result = decisionEngine.evaluate(0.1499, 'sufficient', 'idle', defaultState);
        assert.strictEqual(result.level, 'none');
        assert.strictEqual(result.shouldIntervene, false);
    });

    test('EQ = 0.15 → level = subtle', () => {
        const result = decisionEngine.evaluate(0.15, 'sufficient', 'idle', defaultState);
        assert.strictEqual(result.level, 'subtle');
    });

    test('EQ = 0.1501 → level = subtle', () => {
        const result = decisionEngine.evaluate(0.1501, 'sufficient', 'idle', defaultState);
        assert.strictEqual(result.level, 'subtle');
    });

    // --- 0.35 boundary (subtle → notification) ---

    test('EQ = 0.3499 → level = subtle', () => {
        const result = decisionEngine.evaluate(0.3499, 'sufficient', 'idle', defaultState);
        assert.strictEqual(result.level, 'subtle');
    });

    test('EQ = 0.35 → level = notification', () => {
        const result = decisionEngine.evaluate(0.35, 'sufficient', 'idle', defaultState);
        assert.strictEqual(result.level, 'notification');
    });

    test('EQ = 0.3501 → level = notification', () => {
        const result = decisionEngine.evaluate(0.3501, 'sufficient', 'idle', defaultState);
        assert.strictEqual(result.level, 'notification');
    });

    // --- 0.60 boundary (notification → proactive) ---

    test('EQ = 0.5999 → level = notification', () => {
        const result = decisionEngine.evaluate(0.5999, 'sufficient', 'idle', defaultState);
        assert.strictEqual(result.level, 'notification');
    });

    test('EQ = 0.60 → level = proactive', () => {
        const result = decisionEngine.evaluate(0.60, 'sufficient', 'idle', defaultState);
        assert.strictEqual(result.level, 'proactive');
    });

    test('EQ = 0.6001 → level = proactive', () => {
        const result = decisionEngine.evaluate(0.6001, 'sufficient', 'idle', defaultState);
        assert.strictEqual(result.level, 'proactive');
    });

    // --- Confidence gate overrides EQ ---

    test('EQ = 1.0 but confidence = insufficient → no intervention (but level reflects severity)', () => {
        // Block C: rawWanted separates severity from the gate decision.
        // When confidence is insufficient, shouldIntervene is false but the level
        // now reflects the EQ severity (not 'none') so the blocked reason can be reported.
        const result = decisionEngine.evaluate(1.0, 'insufficient', 'idle', defaultState);
        assert.strictEqual(result.shouldIntervene, false);
        assert.strictEqual(result.level, 'proactive', 'level reflects severity even when confidence gate blocks');
        assert.strictEqual(result.rawWanted, true, 'rawWanted=true when EQ is above threshold');
        assert.strictEqual(result.blockedReason, 'low-confidence');
    });

    test('EQ = 0.15 with confidence = sufficient → subtle intervention', () => {
        const result = decisionEngine.evaluate(0.15, 'sufficient', 'idle', defaultState);
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
        assert.strictEqual(confidence, 'sufficient');
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
        assert.strictEqual(confidence, 'sufficient');
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
        const result = decisionEngine.evaluate(eq, 'sufficient', 'idle', defaultState);
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
        const result = decisionEngine.evaluate(eq, 'sufficient', 'idle', defaultState);
        assert.strictEqual(result.level, 'proactive');
    });
});

// =========================================================================
// Guardrail Enforcement Tests (Fix Verification)
// =========================================================================

suite('Guardrail Enforcement — Subtle Hints Respect Filter (NEW-1 fix)', () => {

    let filter: InterventionFilter;
    let decisionEngine: InterventionDecisionEngine;

    setup(() => {
        filter = new InterventionFilter();
        decisionEngine = new InterventionDecisionEngine(filter);
    });

    test('subtle level blocked during exercise warmup (< 5 min)', () => {
        // Exercise just started — warmup not elapsed
        filter.setExerciseStartTime(Date.now());
        const state: InterventionState = {
            sessionInterventionCount: 0,
            lastInterventionTime: 0,
            lastDismissed: false,
            lastAccepted: false,
        };
        const result = decisionEngine.evaluate(0.20, 'sufficient', 'idle', state);
        assert.strictEqual(result.level, 'subtle');
        assert.strictEqual(result.shouldIntervene, false, 'subtle hint must be blocked during warmup');
    });

    test('subtle level blocked when recent progress recorded', () => {
        filter.setExerciseStartTime(Date.now() - 10 * 60 * 1000); // 10 min ago
        filter.recordProgress(); // progress just now
        const state: InterventionState = {
            sessionInterventionCount: 0,
            lastInterventionTime: 0,
            lastDismissed: false,
            lastAccepted: false,
        };
        const result = decisionEngine.evaluate(0.20, 'sufficient', 'idle', state);
        assert.strictEqual(result.level, 'subtle');
        assert.strictEqual(result.shouldIntervene, false, 'subtle hint must be blocked during progress grace period');
    });

    test('subtle level blocked after dismiss', () => {
        filter.setExerciseStartTime(Date.now() - 10 * 60 * 1000);
        const state: InterventionState = {
            sessionInterventionCount: 0,
            lastInterventionTime: 0,
            lastDismissed: true,
            lastAccepted: false,
        };
        const result = decisionEngine.evaluate(0.20, 'sufficient', 'idle', state);
        assert.strictEqual(result.level, 'subtle');
        assert.strictEqual(result.shouldIntervene, false, 'subtle hint must be blocked after dismiss');
    });

    test('EQ below 0.15 produces no intervention at all', () => {
        filter.setExerciseStartTime(Date.now() - 10 * 60 * 1000);
        const state: InterventionState = {
            sessionInterventionCount: 0,
            lastInterventionTime: 0,
            lastDismissed: false,
            lastAccepted: false,
        };
        const result = decisionEngine.evaluate(0.10, 'sufficient', 'idle', state);
        assert.strictEqual(result.level, 'none');
        assert.strictEqual(result.shouldIntervene, false);
    });
});

suite('InterventionFilter Session Isolation (NEW-4 fix)', () => {

    let filter: InterventionFilter;
    let decisionEngine: InterventionDecisionEngine;

    const defaultState: InterventionState = {
        sessionInterventionCount: 0,
        lastInterventionTime: 0,
        lastDismissed: false,
        lastAccepted: false,
    };

    setup(() => {
        filter = new InterventionFilter();
        decisionEngine = new InterventionDecisionEngine(filter);
    });

    test('progress from session A does not suppress interventions in session B', () => {
        // Session A: exercise running > 5min, student makes progress
        filter.setExerciseStartTime(Date.now() - 10 * 60 * 1000);
        filter.recordProgress();

        // Verify: progress grace period is active
        const resultA = decisionEngine.evaluate(0.20, 'sufficient', 'idle', defaultState);
        assert.strictEqual(resultA.shouldIntervene, false, 'session A should be suppressed by progress');

        // Session B starts
        filter.onSessionStart({ exerciseId: 999 });
        // Fast-forward past warmup
        (filter as any)._exerciseStartTime = Date.now() - 10 * 60 * 1000;

        // Verify: progress grace period from session A is gone
        const resultB = decisionEngine.evaluate(0.20, 'sufficient', 'idle', defaultState);
        assert.strictEqual(resultB.shouldIntervene, true, 'session B must not be affected by session A progress');
    });

    test('_lastProgressTime is 0 after onSessionStart', () => {
        filter.recordProgress();
        filter.onSessionStart({ exerciseId: 123 });
        assert.strictEqual((filter as any)._lastProgressTime, 0);
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
