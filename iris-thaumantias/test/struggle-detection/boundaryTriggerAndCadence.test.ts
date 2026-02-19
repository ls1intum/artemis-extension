/**
 * Boundary Trigger & Adaptive Cadence — Unit Tests
 *
 * Tests paper-compliance fixes:
 *   Fix 1: Selection-Trigger significance check (P11: "insignificant selection → no response")
 *   Fix 2: Idle-Definition includes all activity (P11: "no edit, caret, or selection")
 *          + One-Shot Idle Timer (P11: "User has been idle" → intervene once)
 *   Fix 3: Adaptive cadence dismiss tracks correct trigger type
 *   Fix 4: isLikelyManualPaste heuristic (MVP Edge Case 3)
 *   Fix 5: Adaptive threshold caps (180s idle, 120s selection)
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import { BoundaryTriggerEmitter } from '../../src/services/telemetry/eventPipeline/boundaryTriggerEmitter';
import { isLikelyManualPaste } from '../../src/services/telemetry/eventPipeline/compileEquivalentEmitter';
import { InactivityService } from '../../src/services/telemetry/inactivityService';
import { AdaptiveCadence } from '../../src/services/telemetry/intervention/adaptiveCadence';
import { TriggerType, DEFAULT_TRIGGER_CONFIG } from '../../src/services/telemetry/types';

// ============================================================================
// Mock Helpers
// ============================================================================

/** Create a mock TextDocumentContentChangeEvent for isLikelyManualPaste tests */
function makeChangeEvent(opts: {
    text: string;
    rangeLength?: number;
    rangeIsEmpty?: boolean;
    rangeIsSingleLine?: boolean;
}): any {
    const rangeIsEmpty = opts.rangeIsEmpty ?? (opts.rangeLength === 0 || opts.rangeLength === undefined);
    return {
        text: opts.text,
        rangeLength: opts.rangeLength ?? 0,
        range: {
            isEmpty: rangeIsEmpty,
            isSingleLine: opts.rangeIsSingleLine ?? true,
        },
        rangeOffset: 0,
    };
}

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
        // Start well past the trigger cooldown (60s) so cooldown checks pass for non-idle triggers
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
    // Fix 2: Idle-Definition (all activity resets idle) + One-Shot Idle Timer
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
            clock.tick(10000);
            inactivityService._testRecordWeakActivity();

            const timeSinceActivity = inactivityService.getTimeSinceLastActivity();
            assert.ok(timeSinceActivity < 100, `Expected ~0ms, got ${timeSinceActivity}ms`);
        });

        test('getTimeSinceLastEdit() unchanged after cursor move (no edit)', () => {
            inactivityService._testRecordActivity();
            clock.tick(5000);

            const timeSinceEdit = inactivityService.getTimeSinceLastEdit();
            assert.ok(timeSinceEdit >= 4900 && timeSinceEdit <= 5100,
                `Expected ~5000ms, got ${timeSinceEdit}ms`);

            const timeSinceActivity = inactivityService.getTimeSinceLastActivity();
            assert.ok(timeSinceActivity >= 4900 && timeSinceActivity <= 5100,
                `Expected ~5000ms, got ${timeSinceActivity}ms`);
        });

        test('getTimeSinceLastActivity() uses max of edit and weak timestamps', () => {
            inactivityService._testRecordActivity();
            clock.tick(3000);
            inactivityService._testRecordWeakActivity();

            const timeSinceActivity = inactivityService.getTimeSinceLastActivity();
            assert.ok(timeSinceActivity < 100, `After weak activity, expected ~0ms, got ${timeSinceActivity}ms`);
        });

        test('onDidResumeActivity fires when activity resumes after idle (>= 30s)', () => {
            let resumeCount = 0;
            inactivityService.onDidResumeActivity(() => resumeCount++);

            inactivityService._testRecordActivity();
            // Go idle for >= ACTIVE threshold (30s)
            clock.tick(30_000);
            // Resume activity
            inactivityService._testRecordActivity();

            assert.strictEqual(resumeCount, 1, 'Should fire once on resume after idle');
        });

        test('onDidResumeActivity does NOT fire when activity within active window (< 30s)', () => {
            let resumeCount = 0;
            inactivityService.onDidResumeActivity(() => resumeCount++);

            inactivityService._testRecordActivity();
            clock.tick(10_000); // Only 10s — still "active"
            inactivityService._testRecordActivity();

            assert.strictEqual(resumeCount, 0, 'Should not fire when still within active window');
        });

        test('onDidResumeActivity fires on weak activity (cursor) resume too', () => {
            let resumeCount = 0;
            inactivityService.onDidResumeActivity(() => resumeCount++);

            inactivityService._testRecordActivity();
            clock.tick(30_000);
            inactivityService._testRecordWeakActivity();

            assert.strictEqual(resumeCount, 1, 'Weak activity should also trigger resume');
        });
    });

    // =========================================================================
    // One-Shot Idle Timer (Paper model: fire once, re-arm on resume)
    // =========================================================================

    suite('One-Shot Idle Timer', () => {

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

        test('Idle fires exactly once after threshold', () => {
            // Record activity to establish baseline
            inactivityService._testRecordActivity();
            // Advance past idle threshold (30s)
            clock.tick(DEFAULT_TRIGGER_CONFIG.IDLE_INITIAL_MS + 1);

            const idleTriggers = firedTriggers.filter(t => t === 'idle');
            assert.strictEqual(idleTriggers.length, 1, 'Idle should fire exactly once');
        });

        test('Idle does NOT fire repeatedly while user stays idle', () => {
            inactivityService._testRecordActivity();
            // Advance well past threshold — in old polling model this would fire multiple times
            clock.tick(DEFAULT_TRIGGER_CONFIG.IDLE_INITIAL_MS + 60_000);

            const idleTriggers = firedTriggers.filter(t => t === 'idle');
            assert.strictEqual(idleTriggers.length, 1, 'One-shot: idle must fire only once');
        });

        test('Activity during idle period delays fire until actual threshold', () => {
            inactivityService._testRecordActivity();
            // Advance 10s — timer was armed for 30s at construction
            clock.tick(10_000);
            // Activity at 10s resets the idle clock (but not the timer directly).
            // When the original timer fires at 30s, it sees only 20s of idle
            // and re-arms for the remaining 10s.
            inactivityService._testRecordActivity();

            // At 20s after second activity (30s from start) — timer callback
            // re-checks and sees only 20s idle → re-arms
            clock.tick(20_000);
            assert.strictEqual(firedTriggers.filter(t => t === 'idle').length, 0,
                'Should not fire yet — only 20s idle since last activity');

            // 10s more → 30s since last activity → fires
            clock.tick(10_001);
            assert.strictEqual(firedTriggers.filter(t => t === 'idle').length, 1,
                'Should fire after 30s of actual idle since last activity');
        });

        test('After idle fires: no re-fire without activity resume', () => {
            inactivityService._testRecordActivity();
            clock.tick(DEFAULT_TRIGGER_CONFIG.IDLE_INITIAL_MS + 1);

            // Idle fired once
            assert.strictEqual(firedTriggers.filter(t => t === 'idle').length, 1);

            // Wait much longer — should NOT fire again
            clock.tick(120_000);
            assert.strictEqual(firedTriggers.filter(t => t === 'idle').length, 1,
                'Without resume, idle must not fire again');
        });

        test('onDidResumeActivity re-arms idle timer → fires again after new idle period', () => {
            inactivityService._testRecordActivity();
            // First idle fire
            clock.tick(DEFAULT_TRIGGER_CONFIG.IDLE_INITIAL_MS + 1);
            assert.strictEqual(firedTriggers.filter(t => t === 'idle').length, 1);

            // User resumes activity (>= 30s idle, so resume event fires)
            inactivityService._testRecordActivity();
            // This triggers onDidResumeActivity → _armIdleTimer()

            // Wait for threshold again
            clock.tick(DEFAULT_TRIGGER_CONFIG.IDLE_INITIAL_MS + 1);
            assert.strictEqual(firedTriggers.filter(t => t === 'idle').length, 2,
                'After resume + idle period, idle should fire again');
        });

        test('Adaptive threshold used when arming (k=1 → 60s)', () => {
            // Increment idle ignore count to raise threshold to 60s
            adaptiveCadence.incrementIgnoreCount('idle');
            assert.strictEqual(adaptiveCadence.getIdleThreshold(), 60_000);

            // Record activity and re-arm (simulate resume)
            inactivityService._testRecordActivity();
            // Need to go idle first (>= 30s) then resume to trigger re-arm
            clock.tick(30_000);
            inactivityService._testRecordActivity(); // resume → re-arm with 60s threshold

            // Wait 31s (past original 30s threshold, but below adaptive 60s)
            clock.tick(31_000);
            const idleAt31s = firedTriggers.filter(t => t === 'idle').length;

            // Wait until 61s total
            clock.tick(30_000);
            const idleAt61s = firedTriggers.filter(t => t === 'idle').length;

            // The first idle fires at constructor time (30s from start).
            // After resume+re-arm with 60s threshold, a new idle fires at ~60s.
            // At 31s after re-arm: should NOT have fired the new one yet
            // At 61s after re-arm: should have fired
            assert.ok(idleAt61s > idleAt31s,
                `Adaptive threshold (60s) should delay fire: at31s=${idleAt31s}, at61s=${idleAt61s}`);
        });

        test('reset() clears idle timer and re-arms', () => {
            inactivityService._testRecordActivity();
            clock.tick(15_000); // Half of threshold

            emitter.reset();

            // The old timer is cleared, new one armed. Advance another 15s from reset.
            // Since reset re-arms with fresh threshold (30s) and activity timestamps
            // were not reset (still 15s ago from the tick before reset... actually
            // reset() doesn't call inactivityService.reset(). So getTimeSinceLastActivity()
            // is now 15s. The new _armIdleTimer computes: 30s - 15s = 15s delay.
            // After 16s more, it should fire.
            clock.tick(16_000);
            const idleTriggers = firedTriggers.filter(t => t === 'idle');
            assert.ok(idleTriggers.length >= 1, 'After reset and threshold elapsed, idle should fire');
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

    // =========================================================================
    // isLikelyManualPaste — Heuristic Edge Cases (MVP Edge Case 3)
    // =========================================================================

    suite('isLikelyManualPaste — Heuristic', () => {

        // --- Positive cases: should detect as paste ---

        test('Pure multi-line insert (Ctrl+V paste) → true', () => {
            const change = makeChangeEvent({
                text: 'const a = 1;\nconst b = 2;\n',
                rangeLength: 0,
                rangeIsEmpty: true,
                rangeIsSingleLine: true,
            });
            assert.strictEqual(isLikelyManualPaste(change), true);
        });

        test('Exactly 2 lines (minimum >1 line) → true', () => {
            const change = makeChangeEvent({
                text: 'line1\nline2',
                rangeLength: 0,
                rangeIsEmpty: true,
                rangeIsSingleLine: true,
            });
            assert.strictEqual(isLikelyManualPaste(change), true);
        });

        test('Multi-line paste-over-selection (multi-line range, small) → true', () => {
            // User selects 2 lines and pastes multi-line content over them
            const change = makeChangeEvent({
                text: 'new line 1\nnew line 2\nnew line 3\n',
                rangeLength: 40,
                rangeIsEmpty: false,
                rangeIsSingleLine: false, // Selection spans multiple lines
            });
            assert.strictEqual(isLikelyManualPaste(change), true);
        });

        // --- Negative cases: single-line (not multi-line) ---

        test('Single-line insert → false', () => {
            const change = makeChangeEvent({
                text: 'const x = 42;',
                rangeLength: 0,
                rangeIsEmpty: true,
            });
            assert.strictEqual(isLikelyManualPaste(change), false);
        });

        test('Empty text → false', () => {
            const change = makeChangeEvent({
                text: '',
                rangeLength: 0,
                rangeIsEmpty: true,
            });
            assert.strictEqual(isLikelyManualPaste(change), false);
        });

        // --- Negative cases: formatter/refactoring exclusion ---

        test('Formatter: replaces >1000 chars with multi-line output → false', () => {
            const change = makeChangeEvent({
                text: 'formatted line 1\nformatted line 2\nformatted line 3\n',
                rangeLength: 1500,
                rangeIsEmpty: false,
                rangeIsSingleLine: false,
            });
            assert.strictEqual(isLikelyManualPaste(change), false);
        });

        test('Formatter: exactly 1001 chars replaced → false', () => {
            const change = makeChangeEvent({
                text: 'a\nb',
                rangeLength: 1001,
                rangeIsEmpty: false,
                rangeIsSingleLine: false,
            });
            assert.strictEqual(isLikelyManualPaste(change), false);
        });

        test('Formatter boundary: exactly 1000 chars replaced → true (threshold is >1000)', () => {
            // rangeLength === 1000 is NOT > 1000, so it passes the check
            const change = makeChangeEvent({
                text: 'a\nb\nc',
                rangeLength: 1000,
                rangeIsEmpty: false,
                rangeIsSingleLine: false,
            });
            assert.strictEqual(isLikelyManualPaste(change), true);
        });

        // --- Negative cases: Copilot/snippet exclusion ---

        test('Copilot: single-line range replaced with multi-line → false', () => {
            // Copilot ghost text: replaces inline text on one line with multi-line completion
            const change = makeChangeEvent({
                text: 'function hello() {\n  console.log("hi");\n}\n',
                rangeLength: 10,
                rangeIsEmpty: false,
                rangeIsSingleLine: true, // Original range is on a single line
            });
            assert.strictEqual(isLikelyManualPaste(change), false);
        });

        test('Snippet: single-line range expanded to multi-line → false', () => {
            const change = makeChangeEvent({
                text: 'for (let i = 0; i < arr.length; i++) {\n  \n}\n',
                rangeLength: 4,
                rangeIsEmpty: false,
                rangeIsSingleLine: true,
            });
            assert.strictEqual(isLikelyManualPaste(change), false);
        });

        test('Copilot on empty range (isEmpty=true, isSingleLine=true) → true (pure insert)', () => {
            // Edge case: some completions insert at cursor with empty range.
            // range.isEmpty means no text was replaced — looks like a paste.
            // This is a known limitation noted in the MVP.
            const change = makeChangeEvent({
                text: 'completion line 1\ncompletion line 2\n',
                rangeLength: 0,
                rangeIsEmpty: true,
                rangeIsSingleLine: true,
            });
            assert.strictEqual(isLikelyManualPaste(change), true);
        });

        // --- Combined edge cases ---

        test('Large paste (999 chars) with multi-line range → true', () => {
            const change = makeChangeEvent({
                text: 'x'.repeat(500) + '\n' + 'y'.repeat(498),
                rangeLength: 200,
                rangeIsEmpty: false,
                rangeIsSingleLine: false,
            });
            assert.strictEqual(isLikelyManualPaste(change), true);
        });

        test('Many lines but single-line non-empty range (like Copilot) → false', () => {
            const change = makeChangeEvent({
                text: Array(20).fill('  line').join('\n'),
                rangeLength: 5,
                rangeIsEmpty: false,
                rangeIsSingleLine: true,
            });
            assert.strictEqual(isLikelyManualPaste(change), false);
        });
    });

    // =========================================================================
    // Adaptive Threshold Caps (180s idle, 120s selection)
    // =========================================================================

    suite('Adaptive Threshold Caps', () => {

        test('Idle threshold capped at 180s after many ignores', () => {
            const cadence = new AdaptiveCadence();

            // 30s initial + 5 * 30s = 180s. One more should still be 180s.
            for (let i = 0; i < 10; i++) {
                cadence.incrementIgnoreCount('idle');
            }

            assert.strictEqual(
                cadence.getIdleThreshold(),
                DEFAULT_TRIGGER_CONFIG.IDLE_MAX_THRESHOLD_MS,
                `Idle threshold should be capped at ${DEFAULT_TRIGGER_CONFIG.IDLE_MAX_THRESHOLD_MS}ms`,
            );
        });

        test('Idle threshold reaches cap at exactly k=5 ignores', () => {
            const cadence = new AdaptiveCadence();

            // 30s + 5 * 30s = 180s = cap
            for (let i = 0; i < 5; i++) {
                cadence.incrementIgnoreCount('idle');
            }

            assert.strictEqual(cadence.getIdleThreshold(), 180_000,
                'At k=5: 30000 + 5*30000 = 180000 should equal cap');
        });

        test('Idle threshold at k=4 is still below cap', () => {
            const cadence = new AdaptiveCadence();

            for (let i = 0; i < 4; i++) {
                cadence.incrementIgnoreCount('idle');
            }

            assert.strictEqual(cadence.getIdleThreshold(), 150_000,
                'At k=4: 30000 + 4*30000 = 150000, below 180000 cap');
        });

        test('Selection threshold capped at 120s after many ignores', () => {
            const cadence = new AdaptiveCadence();

            for (let i = 0; i < 10; i++) {
                cadence.incrementIgnoreCount('selection-maintained');
            }

            assert.strictEqual(
                cadence.getSelectionThreshold(),
                DEFAULT_TRIGGER_CONFIG.SELECTION_MAX_THRESHOLD_MS,
                `Selection threshold should be capped at ${DEFAULT_TRIGGER_CONFIG.SELECTION_MAX_THRESHOLD_MS}ms`,
            );
        });

        test('Selection threshold reaches cap at exactly k=7 ignores', () => {
            const cadence = new AdaptiveCadence();

            // 15s + 7 * 15s = 120s = cap
            for (let i = 0; i < 7; i++) {
                cadence.incrementIgnoreCount('selection-maintained');
            }

            assert.strictEqual(cadence.getSelectionThreshold(), 120_000,
                'At k=7: 15000 + 7*15000 = 120000 should equal cap');
        });

        test('Selection threshold at k=6 is still below cap', () => {
            const cadence = new AdaptiveCadence();

            for (let i = 0; i < 6; i++) {
                cadence.incrementIgnoreCount('selection-maintained');
            }

            assert.strictEqual(cadence.getSelectionThreshold(), 105_000,
                'At k=6: 15000 + 6*15000 = 105000, below 120000 cap');
        });

        test('Idle cap holds even after reset and re-increment', () => {
            const cadence = new AdaptiveCadence();

            // Exceed cap, then reset, then exceed again
            for (let i = 0; i < 8; i++) {
                cadence.incrementIgnoreCount('idle');
            }
            assert.strictEqual(cadence.getIdleThreshold(), 180_000);

            cadence.resetAll();
            assert.strictEqual(cadence.getIdleThreshold(), 30_000,
                'After reset, threshold returns to initial');

            for (let i = 0; i < 20; i++) {
                cadence.incrementIgnoreCount('idle');
            }
            assert.strictEqual(cadence.getIdleThreshold(), 180_000,
                'Cap still holds after reset and re-increment');
        });

        test('Idle and selection caps are independent', () => {
            const cadence = new AdaptiveCadence();

            for (let i = 0; i < 10; i++) {
                cadence.incrementIgnoreCount('idle');
            }

            // Selection is still at initial
            assert.strictEqual(cadence.getSelectionThreshold(), 15_000,
                'Selection threshold must not be affected by idle ignores');
            assert.strictEqual(cadence.getIdleThreshold(), 180_000,
                'Idle should be capped');
        });
    });
});
