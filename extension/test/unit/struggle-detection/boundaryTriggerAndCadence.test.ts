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

import { BoundaryTriggerEmitter } from '@extension/services/telemetry/eventPipeline/boundaryTriggerEmitter';
import { isLikelyManualPaste } from '@extension/services/telemetry/eventPipeline/compileEquivalentEmitter';
import { InactivityService } from '@extension/services/telemetry/inactivityService';
import { AdaptiveCadence } from '@extension/services/telemetry/intervention/adaptiveCadence';
import { DEFAULT_TRIGGER_CONFIG, TriggerType } from '@extension/services/telemetry/types';

// ============================================================================
// Test Subclass — exposes protected methods for direct invocation in tests
// ============================================================================

class TestableInactivityService extends InactivityService {
    public recordActivity(): void { this._recordActivity(); }
    public recordWeakActivity(): void { this._recordWeakActivity(); }
}

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

/** Create a mock TextDocumentChangeEvent for handleTextDocumentChange tests */
function makeDocChangeEvent(changes: any[], scheme: string = 'file'): any {
    return {
        document: { uri: { scheme } },
        contentChanges: changes,
        reason: undefined,
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

        let inactivityService: TestableInactivityService;

        setup(() => {
            inactivityService = new TestableInactivityService();
        });

        teardown(() => {
            inactivityService.dispose();
        });

        test('getTimeSinceLastActivity() returns ~0 after weak activity (cursor move)', () => {
            clock.tick(10000);
            inactivityService.recordWeakActivity();

            const timeSinceActivity = inactivityService.getTimeSinceLastActivity();
            assert.ok(timeSinceActivity < 100, `Expected ~0ms, got ${timeSinceActivity}ms`);
        });

        test('getTimeSinceLastEdit() unchanged after cursor move (no edit)', () => {
            inactivityService.recordActivity();
            clock.tick(5000);

            const timeSinceEdit = inactivityService.getTimeSinceLastEdit();
            assert.ok(timeSinceEdit >= 4900 && timeSinceEdit <= 5100,
                `Expected ~5000ms, got ${timeSinceEdit}ms`);

            const timeSinceActivity = inactivityService.getTimeSinceLastActivity();
            assert.ok(timeSinceActivity >= 4900 && timeSinceActivity <= 5100,
                `Expected ~5000ms, got ${timeSinceActivity}ms`);
        });

        test('getTimeSinceLastActivity() uses max of edit and weak timestamps', () => {
            inactivityService.recordActivity();
            clock.tick(3000);
            inactivityService.recordWeakActivity();

            const timeSinceActivity = inactivityService.getTimeSinceLastActivity();
            assert.ok(timeSinceActivity < 100, `After weak activity, expected ~0ms, got ${timeSinceActivity}ms`);
        });

        test('onDidResumeActivity fires when activity resumes after idle (>= 30s)', () => {
            let resumeCount = 0;
            inactivityService.onDidResumeActivity(() => resumeCount++);

            inactivityService.recordActivity();
            // Go idle for >= ACTIVE threshold (30s)
            clock.tick(30_000);
            // Resume activity
            inactivityService.recordActivity();

            assert.strictEqual(resumeCount, 1, 'Should fire once on resume after idle');
        });

        test('onDidResumeActivity does NOT fire when activity within active window (< 30s)', () => {
            let resumeCount = 0;
            inactivityService.onDidResumeActivity(() => resumeCount++);

            inactivityService.recordActivity();
            clock.tick(10_000); // Only 10s — still "active"
            inactivityService.recordActivity();

            assert.strictEqual(resumeCount, 0, 'Should not fire when still within active window');
        });

        test('onDidResumeActivity fires on weak activity (cursor) resume too', () => {
            let resumeCount = 0;
            inactivityService.onDidResumeActivity(() => resumeCount++);

            inactivityService.recordActivity();
            clock.tick(30_000);
            inactivityService.recordWeakActivity();

            assert.strictEqual(resumeCount, 1, 'Weak activity should also trigger resume');
        });
    });

    // =========================================================================
    // One-Shot Idle Timer (Paper model: fire once, re-arm on resume)
    // =========================================================================

    suite('One-Shot Idle Timer', () => {

        let inactivityService: TestableInactivityService;
        let adaptiveCadence: AdaptiveCadence;
        let emitter: BoundaryTriggerEmitter;
        let firedTriggers: TriggerType[];

        setup(() => {
            inactivityService = new TestableInactivityService();
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
            inactivityService.recordActivity();
            // Advance past idle threshold (30s)
            clock.tick(DEFAULT_TRIGGER_CONFIG.IDLE_INITIAL_MS + 1);

            const idleTriggers = firedTriggers.filter(t => t === 'idle');
            assert.strictEqual(idleTriggers.length, 1, 'Idle should fire exactly once');
        });

        test('Idle does NOT fire repeatedly while user stays idle', () => {
            inactivityService.recordActivity();
            // Advance well past threshold — in old polling model this would fire multiple times
            clock.tick(DEFAULT_TRIGGER_CONFIG.IDLE_INITIAL_MS + 60_000);

            const idleTriggers = firedTriggers.filter(t => t === 'idle');
            assert.strictEqual(idleTriggers.length, 1, 'One-shot: idle must fire only once');
        });

        test('Activity during idle period delays fire until actual threshold', () => {
            inactivityService.recordActivity();
            // Advance 10s — timer was armed for 30s at construction
            clock.tick(10_000);
            // Activity at 10s resets the idle clock (but not the timer directly).
            // When the original timer fires at 30s, it sees only 20s of idle
            // and re-arms for the remaining 10s.
            inactivityService.recordActivity();

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
            inactivityService.recordActivity();
            clock.tick(DEFAULT_TRIGGER_CONFIG.IDLE_INITIAL_MS + 1);

            // Idle fired once
            assert.strictEqual(firedTriggers.filter(t => t === 'idle').length, 1);

            // Wait much longer — should NOT fire again
            clock.tick(120_000);
            assert.strictEqual(firedTriggers.filter(t => t === 'idle').length, 1,
                'Without resume, idle must not fire again');
        });

        test('onDidResumeActivity re-arms idle timer → fires again after new idle period', () => {
            inactivityService.recordActivity();
            // First idle fire
            clock.tick(DEFAULT_TRIGGER_CONFIG.IDLE_INITIAL_MS + 1);
            assert.strictEqual(firedTriggers.filter(t => t === 'idle').length, 1);

            // User resumes activity (>= 30s idle, so resume event fires)
            inactivityService.recordActivity();
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
            inactivityService.recordActivity();
            // Need to go idle first (>= 30s) then resume to trigger re-arm
            clock.tick(30_000);
            inactivityService.recordActivity(); // resume → re-arm with 60s threshold

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
            inactivityService.recordActivity();
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

    // =========================================================================
    // fireExecutionErrorTrigger()
    // =========================================================================

    suite('fireExecutionErrorTrigger()', () => {

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

        test('fires execution-error trigger', () => {
            emitter.fireExecutionErrorTrigger();
            const errors = firedTriggers.filter(t => t === 'execution-error');
            assert.strictEqual(errors.length, 1);
        });

        test('cooldown blocks within 60s', () => {
            emitter.fireExecutionErrorTrigger();
            clock.tick(30_000);
            emitter.fireExecutionErrorTrigger();
            const errors = firedTriggers.filter(t => t === 'execution-error');
            assert.strictEqual(errors.length, 1, 'Second fire within cooldown should be blocked');
        });

        test('cooldown allows after 60s', () => {
            emitter.fireExecutionErrorTrigger();
            clock.tick(60_000);
            emitter.fireExecutionErrorTrigger();
            const errors = firedTriggers.filter(t => t === 'execution-error');
            assert.strictEqual(errors.length, 2, 'Second fire after cooldown should succeed');
        });
    });

    // =========================================================================
    // handleTextDocumentChange() integration
    // =========================================================================

    suite('handleTextDocumentChange() integration', () => {

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

        test('multi-line paste fires multiline-paste trigger', () => {
            const pasteChange = makeChangeEvent({
                text: 'line1\nline2\n',
                rangeLength: 0,
                rangeIsEmpty: true,
                rangeIsSingleLine: true,
            });
            emitter.handleTextDocumentChange(makeDocChangeEvent([pasteChange]));
            const pastes = firedTriggers.filter(t => t === 'multiline-paste');
            assert.strictEqual(pastes.length, 1);
        });

        test('non-file scheme is ignored', () => {
            const pasteChange = makeChangeEvent({
                text: 'line1\nline2\n',
                rangeLength: 0,
                rangeIsEmpty: true,
                rangeIsSingleLine: true,
            });
            emitter.handleTextDocumentChange(makeDocChangeEvent([pasteChange], 'git'));
            const pastes = firedTriggers.filter(t => t === 'multiline-paste');
            assert.strictEqual(pastes.length, 0, 'Non-file scheme should be ignored');
        });

        test('single-line change does not fire', () => {
            const singleChange = makeChangeEvent({
                text: 'just one line',
                rangeLength: 0,
                rangeIsEmpty: true,
                rangeIsSingleLine: true,
            });
            emitter.handleTextDocumentChange(makeDocChangeEvent([singleChange]));
            const pastes = firedTriggers.filter(t => t === 'multiline-paste');
            assert.strictEqual(pastes.length, 0, 'Single-line change should not fire');
        });

        test('cooldown blocks second paste within 60s', () => {
            const pasteChange = makeChangeEvent({
                text: 'line1\nline2\n',
                rangeLength: 0,
                rangeIsEmpty: true,
                rangeIsSingleLine: true,
            });

            emitter.handleTextDocumentChange(makeDocChangeEvent([pasteChange]));
            clock.tick(30_000);
            emitter.handleTextDocumentChange(makeDocChangeEvent([pasteChange]));
            const pastes = firedTriggers.filter(t => t === 'multiline-paste');
            assert.strictEqual(pastes.length, 1, 'Second paste within cooldown should be blocked');
        });

        test('cooldown allows after 60s', () => {
            const pasteChange = makeChangeEvent({
                text: 'line1\nline2\n',
                rangeLength: 0,
                rangeIsEmpty: true,
                rangeIsSingleLine: true,
            });

            emitter.handleTextDocumentChange(makeDocChangeEvent([pasteChange]));
            clock.tick(60_000);
            emitter.handleTextDocumentChange(makeDocChangeEvent([pasteChange]));
            const pastes = firedTriggers.filter(t => t === 'multiline-paste');
            assert.strictEqual(pastes.length, 2, 'Second paste after cooldown should succeed');
        });

        test('only first matching change fires per event', () => {
            const pasteChange1 = makeChangeEvent({
                text: 'line1\nline2\n',
                rangeLength: 0,
                rangeIsEmpty: true,
                rangeIsSingleLine: true,
            });
            const pasteChange2 = makeChangeEvent({
                text: 'line3\nline4\n',
                rangeLength: 0,
                rangeIsEmpty: true,
                rangeIsSingleLine: true,
            });
            emitter.handleTextDocumentChange(makeDocChangeEvent([pasteChange1, pasteChange2]));
            const pastes = firedTriggers.filter(t => t === 'multiline-paste');
            assert.strictEqual(pastes.length, 1, 'Only one trigger per event');
        });
    });

    // =========================================================================
    // Fresh threshold in idle callback (Fix 1 dedicated test)
    // =========================================================================

    suite('Fresh threshold in idle callback (Fix 1)', () => {

        let inactivityService: TestableInactivityService;
        let adaptiveCadence: AdaptiveCadence;
        let emitter: BoundaryTriggerEmitter;
        let firedTriggers: TriggerType[];

        setup(() => {
            inactivityService = new TestableInactivityService();
            adaptiveCadence = new AdaptiveCadence();
            emitter = new BoundaryTriggerEmitter(inactivityService, adaptiveCadence);
            firedTriggers = [];
            emitter.onDidFireTrigger(t => firedTriggers.push(t));
        });

        teardown(() => {
            emitter.dispose();
            inactivityService.dispose();
        });

        test('threshold increase between arm and fire is respected', () => {
            // Timer armed at construction with 30s threshold (delay=30s).
            // Activity baseline is construction time (IS constructor sets Date.now).
            inactivityService.recordActivity();

            // Tick 15s — timer still pending (armed for 30s)
            clock.tick(15_000);

            // Increase threshold to 60s
            adaptiveCadence.incrementIgnoreCount('idle');
            assert.strictEqual(adaptiveCadence.getIdleThreshold(), 60_000);

            // Tick 15s more → timer fires at 30s mark.
            // Callback reads FRESH threshold: currentIdle=30s < currentThreshold=60s → re-arms.
            clock.tick(15_000);
            assert.strictEqual(
                firedTriggers.filter(t => t === 'idle').length, 0,
                'Idle must NOT fire — threshold increased to 60s but only 30s idle',
            );

            // Tick 30s more → re-armed timer fires at 60s total idle.
            // Callback: currentIdle=60s >= currentThreshold=60s → fires.
            clock.tick(30_001);
            assert.strictEqual(
                firedTriggers.filter(t => t === 'idle').length, 1,
                'Idle should fire after 60s of actual idle matching increased threshold',
            );
        });

        test('threshold decrease between arm and fire: re-arm uses new threshold', () => {
            // Set up 60s threshold, then arm via reset
            adaptiveCadence.incrementIgnoreCount('idle'); // threshold = 60s
            inactivityService.recordActivity();
            emitter.reset(); // clears old timer, re-arms with 60s threshold (delay=60s)

            clock.tick(15_000);

            // Drop threshold back to 30s
            adaptiveCadence.resetAll();
            assert.strictEqual(adaptiveCadence.getIdleThreshold(), 30_000);

            // Tick 15s more (30s total idle) — triggers resume on next activity
            clock.tick(15_000);

            // Resume activity after 30s idle → onDidResumeActivity → re-arm
            // Re-arm reads current 30s threshold, alreadyIdle=0 → delay=30s
            inactivityService.recordActivity();

            // Tick 30s+1 → new timer fires using 30s threshold
            clock.tick(30_001);
            assert.strictEqual(
                firedTriggers.filter(t => t === 'idle').length, 1,
                'Re-arm after threshold decrease should use new 30s threshold',
            );
        });
    });

    // =========================================================================
    // handleSelectionChange() cooldown
    // =========================================================================

    suite('handleSelectionChange() cooldown', () => {

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

        test('second selection-maintained blocked within 60s cooldown', () => {
            const selections = () => firedTriggers.filter(t => t === 'selection-maintained');

            emitter.handleSelectionChange(makeSelectionEvent([{ isEmpty: false }]));
            clock.tick(DEFAULT_TRIGGER_CONFIG.SELECTION_INITIAL_MS + 1000); // fires
            assert.strictEqual(selections().length, 1, 'First selection should fire');

            emitter.handleSelectionChange(makeSelectionEvent([{ isEmpty: false }]));
            clock.tick(DEFAULT_TRIGGER_CONFIG.SELECTION_INITIAL_MS + 1000);
            assert.strictEqual(selections().length, 1, 'Second within cooldown should be blocked');
        });

        test('second selection-maintained allowed after 60s cooldown', () => {
            const selections = () => firedTriggers.filter(t => t === 'selection-maintained');

            emitter.handleSelectionChange(makeSelectionEvent([{ isEmpty: false }]));
            clock.tick(DEFAULT_TRIGGER_CONFIG.SELECTION_INITIAL_MS + 1000);
            assert.strictEqual(selections().length, 1);

            clock.tick(60_000); // wait for cooldown

            emitter.handleSelectionChange(makeSelectionEvent([{ isEmpty: false }]));
            clock.tick(DEFAULT_TRIGGER_CONFIG.SELECTION_INITIAL_MS + 1000);
            assert.strictEqual(selections().length, 2, 'Second after cooldown should fire');
        });
    });

    // =========================================================================
    // reset() — selection timer and cooldown clearing
    // =========================================================================

    suite('reset() — selection timer and cooldown clearing', () => {

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

        test('reset() cancels running selection timer', () => {
            emitter.handleSelectionChange(makeSelectionEvent([{ isEmpty: false }]));

            clock.tick(DEFAULT_TRIGGER_CONFIG.SELECTION_INITIAL_MS / 2);
            emitter.reset();

            // Tick well past original threshold — idle may fire from re-arm, but selection must not
            clock.tick(DEFAULT_TRIGGER_CONFIG.SELECTION_INITIAL_MS * 2);

            const selections = firedTriggers.filter(t => t === 'selection-maintained');
            assert.strictEqual(selections.length, 0, 'reset() should cancel selection timer');
        });

        test('reset() clears cooldown timestamps', () => {
            emitter.fireExecutionErrorTrigger();
            const errors = () => firedTriggers.filter(t => t === 'execution-error');
            assert.strictEqual(errors().length, 1);

            emitter.reset();

            // Fire immediately — should succeed because cooldown was cleared
            emitter.fireExecutionErrorTrigger();
            assert.strictEqual(errors().length, 2, 'After reset, cooldown should be cleared');
        });
    });

    // =========================================================================
    // dispose() stops idle timer from firing
    // =========================================================================

    suite('dispose() stops idle timer from firing', () => {

        let inactivityService: TestableInactivityService;
        let adaptiveCadence: AdaptiveCadence;
        let emitter: BoundaryTriggerEmitter;
        let firedTriggers: TriggerType[];

        setup(() => {
            inactivityService = new TestableInactivityService();
            adaptiveCadence = new AdaptiveCadence();
            emitter = new BoundaryTriggerEmitter(inactivityService, adaptiveCadence);
            firedTriggers = [];
            emitter.onDidFireTrigger(t => firedTriggers.push(t));
        });

        teardown(() => {
            // emitter already disposed in the test
            inactivityService.dispose();
        });

        test('dispose prevents pending idle timer from firing', () => {
            inactivityService.recordActivity();

            clock.tick(DEFAULT_TRIGGER_CONFIG.IDLE_INITIAL_MS / 2);
            emitter.dispose();

            clock.tick(DEFAULT_TRIGGER_CONFIG.IDLE_INITIAL_MS * 2);
            const idles = firedTriggers.filter(t => t === 'idle');
            assert.strictEqual(idles.length, 0, 'dispose() should prevent idle timer from firing');
        });
    });
});
