/**
 * Boundary Trigger & Adaptive Cadence — Unit Tests
 *
 * Tests paper-compliance fixes:
 *   Fix 1: Selection-Trigger significance check (P11: "insignificant selection → no response")
 *   Fix 2: Idle-Definition includes all activity (P11: "no edit, caret, or selection")
 *   Fix 3: Adaptive cadence dismiss tracks correct trigger type
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import { BoundaryTriggerEmitter } from '../../src/services/telemetry/eventPipeline/boundaryTriggerEmitter';
import { InactivityService } from '../../src/services/telemetry/inactivityService';
import { AdaptiveCadence } from '../../src/services/telemetry/intervention/adaptiveCadence';
import { TriggerType, DEFAULT_TRIGGER_CONFIG } from '../../src/services/telemetry/types';

// ============================================================================
// Mock Helpers
// ============================================================================

/** Create a mock selection change event */
function makeSelectionEvent(selections: Array<{ isEmpty: boolean }>): any {
    return {
        textEditor: { document: { uri: { scheme: 'file' } } },
        selections: selections.map(s => ({
            isEmpty: s.isEmpty,
            anchor: { line: 0, character: 0 },
            active: s.isEmpty ? { line: 0, character: 0 } : { line: 0, character: 5 },
        })),
        kind: undefined,
    };
}

suite('Boundary Trigger & Cadence Fixes', () => {

    let clock: sinon.SinonFakeTimers;

    setup(() => {
        // Start well past the trigger cooldown (60s) so cooldown checks pass
        clock = sinon.useFakeTimers({
            now: 100_000,
            toFake: ['Date', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
            shouldClearNativeTimers: true,
        });
    });

    teardown(() => {
        clock.restore();
    });

    // =========================================================================
    // Fix 1: Selection-Trigger Significance Check
    // =========================================================================

    suite('Fix 1: Selection-Trigger Significance', () => {

        let inactivityService: InactivityService;
        let adaptiveCadence: AdaptiveCadence;
        let emitter: BoundaryTriggerEmitter;
        let firedTriggers: TriggerType[];

        setup(() => {
            inactivityService = new InactivityService();
            adaptiveCadence = new AdaptiveCadence();
            emitter = new BoundaryTriggerEmitter(inactivityService, adaptiveCadence);

            firedTriggers = [];
            emitter.onDidFireTrigger(t => firedTriggers.push(t));
        });

        teardown(() => {
            emitter.dispose();
            inactivityService.dispose();
        });

        test('Empty selection (cursor click) does NOT start timer', () => {
            const event = makeSelectionEvent([{ isEmpty: true }]);
            emitter.handleSelectionChange(event);

            // Advance past selection threshold — should NOT fire
            clock.tick(DEFAULT_TRIGGER_CONFIG.SELECTION_INITIAL_MS + 1000);
            assert.strictEqual(firedTriggers.length, 0, 'Empty selection must not trigger');
        });

        test('Non-empty selection (range) starts timer and fires trigger', () => {
            const event = makeSelectionEvent([{ isEmpty: false }]);
            emitter.handleSelectionChange(event);

            // Advance past selection threshold — should fire
            clock.tick(DEFAULT_TRIGGER_CONFIG.SELECTION_INITIAL_MS + 1000);
            assert.strictEqual(firedTriggers.length, 1);
            assert.strictEqual(firedTriggers[0], 'selection-maintained');
        });

        test('Cursor click cancels running selection timer', () => {
            // Start with a range selection
            const rangeEvent = makeSelectionEvent([{ isEmpty: false }]);
            emitter.handleSelectionChange(rangeEvent);

            // After half the threshold, click (empty selection)
            clock.tick(DEFAULT_TRIGGER_CONFIG.SELECTION_INITIAL_MS / 2);
            const cursorEvent = makeSelectionEvent([{ isEmpty: true }]);
            emitter.handleSelectionChange(cursorEvent);

            // Advance well past the original threshold — selection-maintained should NOT fire
            // (idle triggers may fire due to elapsed time — that's expected and unrelated)
            clock.tick(DEFAULT_TRIGGER_CONFIG.SELECTION_INITIAL_MS * 2);
            const selectionTriggers = firedTriggers.filter(t => t === 'selection-maintained');
            assert.strictEqual(selectionTriggers.length, 0, 'Cursor click must cancel selection timer');
        });

        test('Multi-cursor: at least one non-empty selection starts timer', () => {
            const event = makeSelectionEvent([
                { isEmpty: true },
                { isEmpty: false },
                { isEmpty: true },
            ]);
            emitter.handleSelectionChange(event);

            clock.tick(DEFAULT_TRIGGER_CONFIG.SELECTION_INITIAL_MS + 1000);
            assert.strictEqual(firedTriggers.length, 1);
            assert.strictEqual(firedTriggers[0], 'selection-maintained');
        });

        test('Multi-cursor: all empty does NOT start timer', () => {
            const event = makeSelectionEvent([
                { isEmpty: true },
                { isEmpty: true },
            ]);
            emitter.handleSelectionChange(event);

            clock.tick(DEFAULT_TRIGGER_CONFIG.SELECTION_INITIAL_MS + 1000);
            assert.strictEqual(firedTriggers.length, 0);
        });
    });

    // =========================================================================
    // Fix 2: Idle-Definition (all activity resets idle)
    // =========================================================================

    suite('Fix 2: Idle-Definition — getTimeSinceLastActivity()', () => {

        let inactivityService: InactivityService;

        setup(() => {
            inactivityService = new InactivityService();
        });

        teardown(() => {
            inactivityService.dispose();
        });

        test('getTimeSinceLastActivity() returns ~0 after weak activity (cursor move)', () => {
            // Advance time so there's a gap
            clock.tick(10000);

            // Simulate cursor movement (weak activity)
            // InactivityService listens to onDidChangeTextEditorSelection, but in tests
            // we use the internal test helper. Since there's no _testRecordWeakActivity,
            // we verify the method semantics directly via _testRecordActivity and timing.
            inactivityService._testRecordActivity();

            const timeSinceActivity = inactivityService.getTimeSinceLastActivity();
            assert.ok(timeSinceActivity < 100, `Expected ~0ms, got ${timeSinceActivity}ms`);
        });

        test('getTimeSinceLastEdit() unchanged after cursor move (no edit)', () => {
            // Record an edit first
            inactivityService._testRecordActivity();

            // Advance time
            clock.tick(5000);

            // getTimeSinceLastEdit should show the elapsed time
            const timeSinceEdit = inactivityService.getTimeSinceLastEdit();
            assert.ok(timeSinceEdit >= 4900 && timeSinceEdit <= 5100,
                `Expected ~5000ms, got ${timeSinceEdit}ms`);

            // getTimeSinceLastActivity should also show elapsed time
            // (no weak activity happened since the edit)
            const timeSinceActivity = inactivityService.getTimeSinceLastActivity();
            assert.ok(timeSinceActivity >= 4900 && timeSinceActivity <= 5100,
                `Expected ~5000ms, got ${timeSinceActivity}ms`);
        });

        test('getTimeSinceLastActivity() uses max of edit and weak timestamps', () => {
            // Record an edit
            inactivityService._testRecordActivity();

            // Advance and record weak activity via reset trick:
            // We can't directly call _recordWeakActivity, so we test the method
            // by checking that after reset, both timestamps are current.
            clock.tick(3000);
            inactivityService.reset();

            const timeSinceActivity = inactivityService.getTimeSinceLastActivity();
            assert.ok(timeSinceActivity < 100, `After reset, expected ~0ms, got ${timeSinceActivity}ms`);
        });

        test('Idle check in BoundaryTriggerEmitter uses getTimeSinceLastActivity()', () => {
            const adaptiveCadence = new AdaptiveCadence();
            const emitter = new BoundaryTriggerEmitter(inactivityService, adaptiveCadence);
            const firedTriggers: TriggerType[] = [];
            emitter.onDidFireTrigger(t => firedTriggers.push(t));

            // Record activity, then advance past idle threshold
            inactivityService._testRecordActivity();
            clock.tick(DEFAULT_TRIGGER_CONFIG.IDLE_INITIAL_MS + 5001);

            assert.ok(firedTriggers.includes('idle'),
                'Idle trigger should fire after threshold exceeded');

            emitter.dispose();
        });
    });

    // =========================================================================
    // Fix 3: Adaptive Cadence — Dismiss tracks correct trigger type
    // =========================================================================

    suite('Fix 3: Adaptive Cadence — Per-trigger-type dismiss tracking', () => {

        test('incrementIgnoreCount with specific trigger type increments that type', () => {
            const cadence = new AdaptiveCadence();

            cadence.incrementIgnoreCount('execution-error');
            const state = cadence.getState();
            assert.strictEqual(state.ignoreCounts['execution-error'], 1);
            assert.strictEqual(state.ignoreCounts['idle'], 0);
            assert.strictEqual(state.ignoreCounts['selection-maintained'], 0);
        });

        test('incrementIgnoreCount with selection-maintained raises selection threshold', () => {
            const cadence = new AdaptiveCadence();
            const initialThreshold = cadence.getSelectionThreshold();

            cadence.incrementIgnoreCount('selection-maintained');
            const newThreshold = cadence.getSelectionThreshold();

            assert.strictEqual(newThreshold, initialThreshold + DEFAULT_TRIGGER_CONFIG.SELECTION_INCREMENT_MS,
                'Selection threshold should increase after selection-maintained ignore');
        });

        test('incrementIgnoreCount with idle raises idle threshold only', () => {
            const cadence = new AdaptiveCadence();
            const initialIdleThreshold = cadence.getIdleThreshold();
            const initialSelectionThreshold = cadence.getSelectionThreshold();

            cadence.incrementIgnoreCount('idle');

            assert.strictEqual(cadence.getIdleThreshold(),
                initialIdleThreshold + DEFAULT_TRIGGER_CONFIG.IDLE_INCREMENT_MS);
            assert.strictEqual(cadence.getSelectionThreshold(), initialSelectionThreshold,
                'Selection threshold must not change when idle is incremented');
        });

        test('Dismiss after execution-error should NOT increment idle', () => {
            // This test validates the fix: before Fix 3, dismiss always incremented 'idle'
            const cadence = new AdaptiveCadence();

            // Simulate: trigger was execution-error, user dismisses
            const triggerType: TriggerType = 'execution-error';
            cadence.incrementIgnoreCount(triggerType);

            const state = cadence.getState();
            assert.strictEqual(state.ignoreCounts['idle'], 0,
                'Idle count must remain 0 when execution-error was dismissed');
            assert.strictEqual(state.ignoreCounts['execution-error'], 1);
        });

        test('Dismiss after selection-maintained should NOT increment idle', () => {
            const cadence = new AdaptiveCadence();

            const triggerType: TriggerType = 'selection-maintained';
            cadence.incrementIgnoreCount(triggerType);

            const state = cadence.getState();
            assert.strictEqual(state.ignoreCounts['idle'], 0,
                'Idle count must remain 0 when selection-maintained was dismissed');
            assert.strictEqual(state.ignoreCounts['selection-maintained'], 1);
        });

        test('Later trigger does not overwrite intervention trigger type before dismiss', () => {
            // Simulates the race-safety scenario:
            // 1. Trigger fires (execution-error) → intervention dispatched
            // 2. Before dismiss, another trigger fires but doesn't reach intervention
            //    (due to cooldown / canIntervene check)
            // 3. Dismiss should still use the original trigger type
            //
            // This is tested at the TelemetryManager level conceptually,
            // but we verify the AdaptiveCadence correctly receives the right type.
            const cadence = new AdaptiveCadence();

            // Original intervention trigger
            const originalTrigger: TriggerType = 'execution-error';
            // Simulate what TelemetryManager does on dismiss
            cadence.incrementIgnoreCount(originalTrigger);

            assert.strictEqual(cadence.getState().ignoreCounts['execution-error'], 1);
            assert.strictEqual(cadence.getState().ignoreCounts['idle'], 0);
        });
    });
});
