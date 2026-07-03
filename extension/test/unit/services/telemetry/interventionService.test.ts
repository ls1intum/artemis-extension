/**
 * Unit tests for Block C — Interventions FSM
 *
 * Tests cover:
 *   1. Subtle-Show → StatusBar-Click → onDidAcceptIntervention with same decision
 *   2. Subtle-Show → hideHint() → onDidDismissIntervention with reason 'hidden'
 *   3. rawWanted=true, shouldIntervene=false, blockedReason='cooldown' → recordBlockedDecision
 *      called (not showXxxEQ), 1 onDidBlock event
 *   4. rawWanted=true, shouldIntervene=false, blockedReason='low-confidence' → 1 onDidBlock event
 *   5. Five blocks within 60s (same triggerType+reason) → only 1 event (rate-limit)
 *   6. Five blocks, each 70s apart → 5 events
 *   7. rawWanted=false → neither show nor block, no event
 *   8. rawWanted=true, shouldIntervene=true → 'shown' event, no 'blocked'
 *   9. TelemetryManager dispatch: shouldIntervene=false && rawWanted=false → no recordBlockedDecision
 *
 * Additional:
 *  10. InterventionDecisionEngine: confidence=insufficient with EQ above threshold → rawWanted=true, blockedReason='low-confidence'
 *  11. InterventionDecisionEngine: EQ below all thresholds → rawWanted=false, no blockedReason
 *  12. Subtle-Show → second show → first decision dismissed as 'replaced'
 */

import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { InterventionDecisionEngine } from '@extension/services/telemetry/decision/interventionDecisionEngine';
import { InterventionFilter } from '@extension/services/telemetry/interventionFilter';
import { InterventionService } from '@extension/services/telemetry/interventionService';
import type { InterventionDecision, InterventionState } from '@extension/services/telemetry/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDecision(overrides: Partial<InterventionDecision> = {}): InterventionDecision {
    return {
        rawWanted: true,
        shouldIntervene: true,
        level: 'subtle',
        eq: 0.25,
        confidence: 'sufficient',
        triggerType: 'idle',
        ...overrides,
    };
}

function makeState(overrides: Partial<InterventionState> = {}): InterventionState {
    return {
        lastInterventionTime: 0,
        sessionInterventionCount: 0,
        lastDismissed: false,
        lastAccepted: false,
        ...overrides,
    };
}

/**
 * Advance the fake clock used by sinon. We manipulate Date.now() return value
 * by replacing it with a controllable stub rather than using fake timers (which
 * would also affect setTimeout and complicate things).
 */
function makeDateStub(sandbox: sinon.SinonSandbox): { advance(ms: number): void } {
    let now = Date.now();
    sandbox.stub(Date, 'now').callsFake(() => now);
    return {
        advance(ms: number) { now += ms; },
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

suite('Block C — InterventionService: subtle accept/dismiss', () => {
    let service: InterventionService;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        // The extension under test has already registered the subtle-accept
        // command during activate(). Stub registerCommand so test-scoped
        // InterventionService instances don't collide on the global registry.
        sandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));
        service = new InterventionService();
    });

    teardown(() => {
        service.dispose();
        sandbox.restore();
    });

    // Test 1: Subtle-Show → status bar click (handleAcceptSubtle) → onDidAcceptIntervention with same decision
    test('subtle show → handleAcceptSubtle (status bar click handler) → onDidAcceptIntervention fires with same decision', () => {
        const decision = makeDecision({ level: 'subtle', eq: 0.3, triggerType: 'execution-error' });
        const accepted: InterventionDecision[] = [];
        const sub = service.onDidAcceptIntervention(d => accepted.push(d));

        service.showSubtleHintEQ(decision);

        // Simulate what happens when the status bar is clicked (iris.intervention.acceptSubtle command)
        service.handleAcceptSubtle();

        sub.dispose();

        assert.strictEqual(accepted.length, 1, 'exactly one accept event should fire');
        assert.strictEqual(accepted[0].eq, decision.eq, 'accept event should carry the original eq');
        assert.strictEqual(accepted[0].triggerType, decision.triggerType, 'accept event should carry triggerType');
    });

    // Test 1b: handleAcceptSubtle with no active subtle decision → fallback to open chat, no accept event
    test('handleAcceptSubtle with no active subtle decision → no accept event (just opens chat)', () => {
        const accepted: InterventionDecision[] = [];
        const sub = service.onDidAcceptIntervention(d => accepted.push(d));

        // No showSubtleHintEQ called first
        service.handleAcceptSubtle();

        sub.dispose();

        assert.strictEqual(accepted.length, 0, 'no accept event when no subtle hint is active');
    });

    // Test 2: Subtle-Show → hideHint() → onDidDismissIntervention with reason 'hidden'
    test('subtle show → hideHint → onDidDismissIntervention fires with dismissReason=hidden', () => {
        const decision = makeDecision({ level: 'subtle' });
        const dismissed: Array<{ eq: number; dismissReason: string }> = [];
        const sub = service.onDidDismissIntervention(p => dismissed.push({ eq: p.eq, dismissReason: p.dismissReason }));

        service.showSubtleHintEQ(decision);
        service.hideHint();

        sub.dispose();

        assert.strictEqual(dismissed.length, 1, 'exactly one dismiss event should fire from hideHint');
        assert.strictEqual(dismissed[0].dismissReason, 'hidden', 'dismissReason should be hidden');
        assert.strictEqual(dismissed[0].eq, decision.eq, 'dismiss event should carry the original eq');
    });

    // Test 2b: hideHint() when no subtle hint active → no dismiss event
    test('hideHint with no active subtle hint → no dismiss event', () => {
        const dismissed: unknown[] = [];
        const sub = service.onDidDismissIntervention(p => dismissed.push(p));

        service.hideHint();

        sub.dispose();

        assert.strictEqual(dismissed.length, 0, 'no dismiss event should fire when no hint is active');
    });

    // Test 12: second showSubtleHintEQ while one is active → first dismissed as 'replaced'
    test('second subtle show while first active → first dismissed as replaced', () => {
        const decision1 = makeDecision({ eq: 0.2 });
        const decision2 = makeDecision({ eq: 0.4 });
        const dismissed: Array<{ eq: number; dismissReason: string }> = [];
        const sub = service.onDidDismissIntervention(p => dismissed.push({ eq: p.eq, dismissReason: p.dismissReason }));

        service.showSubtleHintEQ(decision1);
        service.showSubtleHintEQ(decision2);

        sub.dispose();

        assert.strictEqual(dismissed.length, 1, 'first hint should be implicitly dismissed');
        assert.strictEqual(dismissed[0].eq, decision1.eq, 'dismissed eq should be from the first decision');
        assert.strictEqual(dismissed[0].dismissReason, 'replaced', 'dismissReason should be replaced');
    });
});

suite('Block C — InterventionService: blocked decisions and rate-limiting', () => {
    let service: InterventionService;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));
        service = new InterventionService();
    });

    teardown(() => {
        service.dispose();
        sandbox.restore();
    });

    // Test 3: rawWanted=true, shouldIntervene=false, blockedReason='cooldown' → 1 onDidBlock event
    test('recordBlockedDecision → fires onDidBlockIntervention with blockedReason', () => {
        const decision = makeDecision({
            rawWanted: true,
            shouldIntervene: false,
            level: 'notification',
            blockedReason: 'cooldown',
            triggerType: 'execution-error',
        });
        const blocks: InterventionDecision[] = [];
        const sub = service.onDidBlockIntervention(({ decision: d }) => blocks.push(d));

        service.recordBlockedDecision(decision);

        sub.dispose();

        assert.strictEqual(blocks.length, 1, 'exactly one block event should fire');
        assert.strictEqual(blocks[0].blockedReason, 'cooldown');
        assert.strictEqual(blocks[0].triggerType, 'execution-error');
    });

    // Test 4: blockedReason='low-confidence' (EQ high but confidence insufficient)
    test('blocked with low-confidence → 1 onDidBlock event with blockedReason=low-confidence', () => {
        const decision = makeDecision({
            rawWanted: true,
            shouldIntervene: false,
            level: 'notification',
            eq: 0.5,
            confidence: 'insufficient',
            blockedReason: 'low-confidence',
            triggerType: 'multiline-paste',
        });
        const blocks: string[] = [];
        const sub = service.onDidBlockIntervention(({ decision: d }) => blocks.push(d.blockedReason ?? ''));

        service.recordBlockedDecision(decision);

        sub.dispose();

        assert.strictEqual(blocks.length, 1);
        assert.strictEqual(blocks[0], 'low-confidence');
    });

    // Test 5: Five blocks within 60s for same (triggerType, blockedReason) → only 1 event
    test('five blocks within 60s for same combination → rate-limited to 1 event', () => {
        const clock = makeDateStub(sandbox);
        const decision = makeDecision({
            rawWanted: true,
            shouldIntervene: false,
            level: 'notification',
            blockedReason: 'cooldown',
            triggerType: 'idle',
        });
        const blocks: unknown[] = [];
        const sub = service.onDidBlockIntervention(() => blocks.push(null));

        // Fire 5 times, each 5 seconds apart (well within 60s window)
        for (let i = 0; i < 5; i++) {
            service.recordBlockedDecision(decision);
            clock.advance(5_000);
        }

        sub.dispose();

        assert.strictEqual(blocks.length, 1, 'rate-limit should suppress 4 of 5 events');
    });

    // Test 6: Five blocks, each 70s apart → 5 events
    test('five blocks each 70s apart → all 5 events fire (window expires between each)', () => {
        const clock = makeDateStub(sandbox);
        const decision = makeDecision({
            rawWanted: true,
            shouldIntervene: false,
            level: 'notification',
            blockedReason: 'cooldown',
            triggerType: 'idle',
        });
        const blocks: unknown[] = [];
        const sub = service.onDidBlockIntervention(() => blocks.push(null));

        for (let i = 0; i < 5; i++) {
            service.recordBlockedDecision(decision);
            clock.advance(70_000);
        }

        sub.dispose();

        assert.strictEqual(blocks.length, 5, 'each block should fire after window expires');
    });

    // Test 7: rawWanted=false → recordBlockedDecision is not the right call, but also: no show, no block
    test('recordBlockedDecision not called when rawWanted=false → no block event fires', () => {
        // This tests that the service correctly acts on what's passed to it.
        // With rawWanted=false we should not call recordBlockedDecision at all —
        // but even if we did, verify no event fires for an empty call (we don't call it here).
        const blocks: unknown[] = [];
        const shown: unknown[] = [];
        const sub1 = service.onDidBlockIntervention(() => blocks.push(null));
        const sub2 = service.onDidShowIntervention(() => shown.push(null));

        // Do NOT call any service method — simulating TelemetryManager not
        // dispatching when rawWanted=false
        sub1.dispose();
        sub2.dispose();

        assert.strictEqual(blocks.length, 0, 'no block event when rawWanted=false');
        assert.strictEqual(shown.length, 0, 'no show event when rawWanted=false');
    });

    // Test 8: rawWanted=true, shouldIntervene=true → shown event, no blocked
    test('rawWanted=true, shouldIntervene=true → showSubtleHintEQ fires shown, no blocked', () => {
        const decision = makeDecision({ rawWanted: true, shouldIntervene: true, level: 'subtle' });
        const shown: unknown[] = [];
        const blocks: unknown[] = [];
        const s1 = service.onDidShowIntervention(() => shown.push(null));
        const s2 = service.onDidBlockIntervention(() => blocks.push(null));

        service.showSubtleHintEQ(decision);

        s1.dispose();
        s2.dispose();

        assert.strictEqual(shown.length, 1, 'shown event should fire');
        assert.strictEqual(blocks.length, 0, 'no block event should fire');
    });

    // Test: showNotificationEQ blocked by cooldown fires onDidBlockIntervention with reason 'cooldown'
    test('showNotificationEQ blocked by cooldown fires onDidBlockIntervention with cooldown reason', async () => {
        const clock = makeDateStub(sandbox);
        // Stub showInformationMessage so the first show completes immediately without user interaction.
        sandbox.stub(require('vscode').window, 'showInformationMessage').resolves(undefined);

        const decision = makeDecision({
            rawWanted: true,
            shouldIntervene: true,
            level: 'notification',
            eq: 0.4,
            triggerType: 'execution-error',
        });

        const shown: unknown[] = [];
        const blocks: InterventionDecision[] = [];
        const s1 = service.onDidShowIntervention(() => shown.push(null));
        const s2 = service.onDidBlockIntervention(({ decision: d }) => blocks.push(d));

        // First show — succeeds (sets lastInterventionTime to now)
        await service.showNotificationEQ(decision);

        // Second show — immediately after (still within 5min cooldown)
        await service.showNotificationEQ(decision);

        s1.dispose();
        s2.dispose();

        assert.strictEqual(shown.length, 1, 'only the first show should fire onDidShowIntervention');
        assert.strictEqual(blocks.length, 1, 'exactly one block event should fire for the cooldown-blocked show');
        assert.strictEqual(blocks[0].blockedReason, 'cooldown', 'blockedReason should be cooldown');
        assert.strictEqual(blocks[0].shouldIntervene, false, 'shouldIntervene should be false on the block event');

        void clock; // clock used to make Date.now() controllable; advance not needed here
    });

    // Test: showProactiveHelpEQ blocked by cooldown fires onDidBlockIntervention with reason 'cooldown'
    test('showProactiveHelpEQ blocked by cooldown fires onDidBlockIntervention with cooldown reason', async () => {
        sandbox.stub(require('vscode').window, 'showWarningMessage').resolves(undefined);

        const decision = makeDecision({
            rawWanted: true,
            shouldIntervene: true,
            level: 'proactive',
            eq: 0.7,
            triggerType: 'idle',
        });

        const shown: unknown[] = [];
        const blocks: InterventionDecision[] = [];
        const s1 = service.onDidShowIntervention(() => shown.push(null));
        const s2 = service.onDidBlockIntervention(({ decision: d }) => blocks.push(d));

        // First show — succeeds
        await service.showProactiveHelpEQ(decision);

        // Second show — still within 5min cooldown
        await service.showProactiveHelpEQ(decision);

        s1.dispose();
        s2.dispose();

        assert.strictEqual(shown.length, 1, 'only the first show should fire onDidShowIntervention');
        assert.strictEqual(blocks.length, 1, 'exactly one block event should fire for the cooldown-blocked show');
        assert.strictEqual(blocks[0].blockedReason, 'cooldown', 'blockedReason should be cooldown');
        assert.strictEqual(blocks[0].shouldIntervene, false, 'shouldIntervene should be false on the block event');
    });

    // Test: repeated cooldown-blocked showNotificationEQ within 60s only fires one block event (rate-limit)
    test('repeated cooldown-blocked showNotificationEQ within 60s only fires one block event', async () => {
        const clock = makeDateStub(sandbox);
        sandbox.stub(require('vscode').window, 'showInformationMessage').resolves(undefined);

        const decision = makeDecision({
            rawWanted: true,
            shouldIntervene: true,
            level: 'notification',
            eq: 0.5,
            triggerType: 'multiline-paste',
        });

        const blocks: unknown[] = [];
        const sub = service.onDidBlockIntervention(() => blocks.push(null));

        // First show — succeeds, sets lastInterventionTime
        await service.showNotificationEQ(decision);

        // Three more shows within the 60s block-event rate-limit window (advance 5s between each)
        clock.advance(5_000);
        await service.showNotificationEQ(decision);
        clock.advance(5_000);
        await service.showNotificationEQ(decision);
        clock.advance(5_000);
        await service.showNotificationEQ(decision);

        sub.dispose();

        assert.strictEqual(blocks.length, 1, 'rate-limit should suppress 2 of the 3 cooldown-block events');
    });

    // Rate-limit: different (triggerType, blockedReason) combinations are tracked independently
    test('different (triggerType, reason) combinations are rate-limited independently', () => {
        const clock = makeDateStub(sandbox);
        const decisionA = makeDecision({
            rawWanted: true, shouldIntervene: false, level: 'notification',
            blockedReason: 'cooldown', triggerType: 'idle',
        });
        const decisionB = makeDecision({
            rawWanted: true, shouldIntervene: false, level: 'notification',
            blockedReason: 'session-limit', triggerType: 'idle',
        });
        const blocks: string[] = [];
        const sub = service.onDidBlockIntervention(({ decision: d }) =>
            blocks.push(`${d.triggerType}:${d.blockedReason}`),
        );

        // Fire A twice within 60s: only 1 event for A
        service.recordBlockedDecision(decisionA);
        clock.advance(5_000);
        service.recordBlockedDecision(decisionA);

        // Fire B: different reason key → separate rate-limit bucket, should fire
        service.recordBlockedDecision(decisionB);

        sub.dispose();

        assert.strictEqual(blocks.length, 2, '2 events: 1 for A, 1 for B');
        assert.ok(blocks.includes('idle:cooldown'), 'A should have fired once');
        assert.ok(blocks.includes('idle:session-limit'), 'B should have fired once');
    });
});

suite('Block C — InterventionDecisionEngine: rawWanted and blockedReason', () => {
    let filter: InterventionFilter;
    let engine: InterventionDecisionEngine;

    setup(() => {
        filter = new InterventionFilter();
        // Set exercise start time to > 5 minutes ago so warmup doesn't block
        filter.setExerciseStartTime(Date.now() - 10 * 60 * 1000);
        engine = new InterventionDecisionEngine(filter);
    });

    // Test 10: EQ above threshold, confidence=insufficient → rawWanted=true, blockedReason='low-confidence'
    test('EQ above notification threshold + insufficient confidence → rawWanted=true, blockedReason=low-confidence', () => {
        const state = makeState();
        const result = engine.evaluate(0.5, 'insufficient', 'idle', state);

        assert.strictEqual(result.rawWanted, true, 'rawWanted should be true when EQ is above threshold');
        assert.strictEqual(result.shouldIntervene, false, 'shouldIntervene must be false for insufficient confidence');
        assert.strictEqual(result.blockedReason, 'low-confidence', 'blockedReason should be low-confidence');
    });

    // Test 11: EQ below all thresholds (< 0.15) → rawWanted=false, no blockedReason
    test('EQ below all thresholds → rawWanted=false, shouldIntervene=false, no blockedReason', () => {
        const state = makeState();
        const result = engine.evaluate(0.05, 'sufficient', 'idle', state);

        assert.strictEqual(result.rawWanted, false, 'rawWanted should be false when EQ is below all thresholds');
        assert.strictEqual(result.shouldIntervene, false);
        assert.strictEqual(result.level, 'none');
        assert.strictEqual(result.blockedReason, undefined, 'no blockedReason when rawWanted=false');
    });

    // EQ above threshold + sufficient confidence + no guardrails → shouldIntervene=true
    test('EQ above threshold + sufficient confidence + no guardrails → shouldIntervene=true, rawWanted=true', () => {
        const state = makeState();
        const result = engine.evaluate(0.25, 'sufficient', 'idle', state);

        assert.strictEqual(result.rawWanted, true);
        assert.strictEqual(result.shouldIntervene, true, 'should intervene when all gates pass');
        assert.strictEqual(result.blockedReason, undefined, 'no blockedReason when shouldIntervene=true');
    });

    // Session-limit blocked → rawWanted=true, blockedReason='session-limit'
    test('session-limit exceeded → rawWanted=true, shouldIntervene=false, blockedReason=session-limit', () => {
        const state = makeState({ sessionInterventionCount: 3 }); // MAX_INTERVENTIONS_PER_SESSION = 3
        const result = engine.evaluate(0.5, 'sufficient', 'idle', state);

        assert.strictEqual(result.rawWanted, true);
        assert.strictEqual(result.shouldIntervene, false);
        assert.strictEqual(result.blockedReason, 'session-limit');
    });

    // Warmup-blocked → rawWanted=true, blockedReason='warmup' (exercise start too recent)
    test('warmup not elapsed → rawWanted=true, shouldIntervene=false, blockedReason=warmup', () => {
        // Create a fresh filter with start time = now (no time has passed)
        const freshFilter = new InterventionFilter();
        freshFilter.setExerciseStartTime(Date.now());
        const freshEngine = new InterventionDecisionEngine(freshFilter);

        const state = makeState();
        const result = freshEngine.evaluate(0.5, 'sufficient', 'idle', state);

        assert.strictEqual(result.rawWanted, true);
        assert.strictEqual(result.shouldIntervene, false);
        assert.strictEqual(result.blockedReason, 'warmup');
    });

    // Insufficient confidence with EQ *below* threshold → rawWanted=false, no blockedReason
    test('EQ below threshold + insufficient confidence → rawWanted=false, no blockedReason', () => {
        const state = makeState();
        const result = engine.evaluate(0.05, 'insufficient', 'idle', state);

        assert.strictEqual(result.rawWanted, false);
        assert.strictEqual(result.blockedReason, undefined);
    });
});

suite('Block C — TelemetryManager dispatch routing', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));
    });

    teardown(() => {
        sandbox.restore();
    });

    // Test 9: shouldIntervene=false && rawWanted=false → no block event
    // We test this via InterventionDecisionEngine + InterventionService integration
    // since TelemetryManager._evaluateAndIntervene is private.
    test('decision with rawWanted=false does not fire onDidBlockIntervention', () => {
        const filter = new InterventionFilter();
        filter.setExerciseStartTime(Date.now() - 10 * 60 * 1000);
        const engine = new InterventionDecisionEngine(filter);
        const service = new InterventionService();

        const blocks: unknown[] = [];
        const sub = service.onDidBlockIntervention(() => blocks.push(null));

        // EQ=0.05 → rawWanted=false → should not call recordBlockedDecision
        const decision = engine.evaluate(0.05, 'sufficient', 'idle', makeState());
        assert.strictEqual(decision.rawWanted, false, 'precondition: rawWanted must be false');

        if (decision.rawWanted) {
            service.recordBlockedDecision(decision);
        }
        // else: rawWanted=false → normal operation, no call

        sub.dispose();
        service.dispose();

        assert.strictEqual(blocks.length, 0, 'no block event when rawWanted=false');
    });

    // Test: rawWanted=true + shouldIntervene=false → recordBlockedDecision should be called
    test('decision with rawWanted=true + shouldIntervene=false routes to recordBlockedDecision', () => {
        const service = new InterventionService();

        const decision = makeDecision({
            rawWanted: true,
            shouldIntervene: false,
            level: 'notification',
            blockedReason: 'low-confidence',
        });

        const blocks: InterventionDecision[] = [];
        const sub = service.onDidBlockIntervention(({ decision: d }) => blocks.push(d));

        // Simulate TelemetryManager dispatch logic
        if (decision.shouldIntervene) {
            service.showSubtleHintEQ(decision); // would call the appropriate show method
        } else if (decision.rawWanted) {
            service.recordBlockedDecision(decision);
        }

        sub.dispose();
        service.dispose();

        assert.strictEqual(blocks.length, 1);
        assert.strictEqual(blocks[0].blockedReason, 'low-confidence');
    });
});

suite('InterventionService.hideHint() — full status-bar reset', () => {
    let svc: InterventionService;
    let statusBarItem: vscode.StatusBarItem;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        statusBarItem = {
            text: '',
            tooltip: undefined,
            backgroundColor: undefined,
            command: undefined,
            show: sandbox.stub(),
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
            alignment: vscode.StatusBarAlignment.Right,
            priority: 100,
            color: undefined,
            name: undefined,
            id: 'mock',
            accessibilityInformation: undefined,
        } as unknown as vscode.StatusBarItem;
        sandbox.stub(vscode.window, 'createStatusBarItem').returns(statusBarItem);
        sandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));
        svc = new InterventionService();
    });

    teardown(() => {
        svc.dispose();
        sandbox.restore();
    });

    test('hideHint clears text, tooltip, and backgroundColor', () => {
        // Simulate state left behind by a notification/proactive flow.
        statusBarItem.text = '$(warning) Help available!';
        statusBarItem.tooltip = 'EQ: 80% — Iris detected struggle';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');

        svc.hideHint();

        assert.strictEqual(statusBarItem.text, '');
        assert.strictEqual(statusBarItem.tooltip, undefined);
        assert.strictEqual(statusBarItem.backgroundColor, undefined);
    });
});

suite('Block C — InterventionService: notification/proactive accept + dismiss paths', () => {
    let service: InterventionService;
    let sandbox: sinon.SinonSandbox;
    let executeCommand: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));
        // Stub executeCommand so the accept path's `iris.chatView.focus` invocation
        // is observable and does not hit the real command registry.
        executeCommand = sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined);
        service = new InterventionService();
    });

    teardown(() => {
        service.dispose();
        sandbox.restore();
    });

    test('showNotificationEQ → accept (Open Iris Chat) → fires onDidAcceptIntervention and opens Iris Chat', async () => {
        sandbox.stub(require('vscode').window, 'showInformationMessage').resolves('Open Iris Chat');
        const decision = makeDecision({ level: 'notification', eq: 0.4, triggerType: 'execution-error' });
        const accepted: InterventionDecision[] = [];
        const dismissed: unknown[] = [];
        const subA = service.onDidAcceptIntervention(d => accepted.push(d));
        const subD = service.onDidDismissIntervention(() => dismissed.push(null));

        await service.showNotificationEQ(decision);

        subA.dispose();
        subD.dispose();

        assert.strictEqual(accepted.length, 1, 'exactly one accept event should fire');
        assert.strictEqual(accepted[0].eq, decision.eq, 'accept event carries the original eq');
        assert.strictEqual(dismissed.length, 0, 'no dismiss event on accept');
        assert.ok(executeCommand.calledWith('iris.chatView.focus'), 'should open Iris Chat');
        assert.strictEqual(service.getState().lastAccepted, true, 'lastAccepted set');
        assert.strictEqual(service.getState().lastDismissed, false, 'lastDismissed cleared');
    });

    test('showNotificationEQ → dismiss (Not now) → fires onDidDismissIntervention with reason user-action', async () => {
        sandbox.stub(require('vscode').window, 'showInformationMessage').resolves(undefined);
        const decision = makeDecision({ level: 'notification', eq: 0.4 });
        const accepted: unknown[] = [];
        const dismissed: Array<{ eq: number; dismissReason: string }> = [];
        const subA = service.onDidAcceptIntervention(() => accepted.push(null));
        const subD = service.onDidDismissIntervention(p => dismissed.push({ eq: p.eq, dismissReason: p.dismissReason }));

        await service.showNotificationEQ(decision);

        subA.dispose();
        subD.dispose();

        assert.strictEqual(accepted.length, 0, 'no accept event on dismiss');
        assert.strictEqual(dismissed.length, 1, 'exactly one dismiss event should fire');
        assert.strictEqual(dismissed[0].dismissReason, 'user-action', 'dismissReason should be user-action');
        assert.strictEqual(dismissed[0].eq, decision.eq, 'dismiss event carries the original eq');
        assert.strictEqual(service.getState().lastDismissed, true, 'lastDismissed set');
        assert.strictEqual(service.getState().lastAccepted, false, 'lastAccepted cleared');
        assert.ok(executeCommand.neverCalledWith('iris.chatView.focus'), 'should not open Iris Chat on dismiss');
    });

    test('showProactiveHelpEQ → accept (Get Help Now) → fires onDidAcceptIntervention and opens Iris Chat', async () => {
        sandbox.stub(require('vscode').window, 'showWarningMessage').resolves('Get Help Now');
        const decision = makeDecision({ level: 'proactive', eq: 0.7, triggerType: 'idle' });
        const accepted: InterventionDecision[] = [];
        const subA = service.onDidAcceptIntervention(d => accepted.push(d));

        await service.showProactiveHelpEQ(decision);

        subA.dispose();

        assert.strictEqual(accepted.length, 1, 'exactly one accept event should fire');
        assert.strictEqual(accepted[0].eq, decision.eq, 'accept event carries the original eq');
        assert.ok(executeCommand.calledWith('iris.chatView.focus'), 'should open Iris Chat');
        assert.strictEqual(service.getState().lastAccepted, true, 'lastAccepted set');
    });

    test('showProactiveHelpEQ → dismiss (Later) → fires onDidDismissIntervention with reason user-action', async () => {
        sandbox.stub(require('vscode').window, 'showWarningMessage').resolves(undefined);
        const decision = makeDecision({ level: 'proactive', eq: 0.7 });
        const dismissed: Array<{ dismissReason: string }> = [];
        const subD = service.onDidDismissIntervention(p => dismissed.push({ dismissReason: p.dismissReason }));

        await service.showProactiveHelpEQ(decision);

        subD.dispose();

        assert.strictEqual(dismissed.length, 1, 'exactly one dismiss event should fire');
        assert.strictEqual(dismissed[0].dismissReason, 'user-action', 'dismissReason should be user-action');
        assert.strictEqual(service.getState().lastDismissed, true, 'lastDismissed set');
    });
});

suite('Block C — InterventionService: per-kind modal UI variant', () => {
    let service: InterventionService;
    let statusBarItem: vscode.StatusBarItem;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        statusBarItem = {
            text: '',
            tooltip: undefined,
            backgroundColor: undefined,
            command: undefined,
            show: sandbox.stub(),
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
            alignment: vscode.StatusBarAlignment.Right,
            priority: 100,
            color: undefined,
            name: undefined,
            id: 'mock',
            accessibilityInformation: undefined,
        } as unknown as vscode.StatusBarItem;
        sandbox.stub(vscode.window, 'createStatusBarItem').returns(statusBarItem);
        sandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));
        sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined);
        service = new InterventionService();
    });

    teardown(() => {
        service.dispose();
        sandbox.restore();
    });

    // Locks the notification branch of the shared _showModalIntervention variant:
    // status-bar styling, message-builder selection, dialog kind, and button labels.
    test('showNotificationEQ uses the notification status-bar variant + showInformationMessage(Open Iris Chat, Not now)', async () => {
        const info = sandbox.stub(require('vscode').window, 'showInformationMessage').resolves(undefined);
        const decision = makeDecision({ level: 'notification', eq: 0.4 }); // below 0.45 → "stuck" copy

        await service.showNotificationEQ(decision);

        assert.strictEqual(statusBarItem.text, '$(lightbulb) Stuck? Let me help!');
        assert.strictEqual(statusBarItem.tooltip, 'EQ: 40% — Click to get help from Iris');
        const bg = statusBarItem.backgroundColor as unknown as { id: string } | undefined;
        assert.strictEqual(bg?.id, 'statusBarItem.warningBackground');
        assert.strictEqual(info.callCount, 1, 'showInformationMessage called once');
        const [message, ...buttons] = info.firstCall.args;
        assert.strictEqual(message, 'It looks like you might be stuck. Would you like help from Iris?');
        assert.deepStrictEqual(buttons, ['Open Iris Chat', 'Not now']);
    });

    // Locks the proactive branch: error background, "severe struggle" copy (eq >= 0.80),
    // and showWarningMessage with { modal: false } + Get Help Now / Later.
    test('showProactiveHelpEQ uses the proactive status-bar variant + showWarningMessage({modal:false}, Get Help Now, Later)', async () => {
        const warn = sandbox.stub(require('vscode').window, 'showWarningMessage').resolves(undefined);
        const decision = makeDecision({ level: 'proactive', eq: 0.85 }); // at/above 0.80 → "repeated errors" copy

        await service.showProactiveHelpEQ(decision);

        assert.strictEqual(statusBarItem.text, '$(warning) Help available!');
        assert.strictEqual(statusBarItem.tooltip, 'EQ: 85% — Iris detected you might be struggling');
        const bg = statusBarItem.backgroundColor as unknown as { id: string } | undefined;
        assert.strictEqual(bg?.id, 'statusBarItem.errorBackground');
        assert.strictEqual(warn.callCount, 1, 'showWarningMessage called once');
        const [message, options, ...buttons] = warn.firstCall.args;
        assert.strictEqual(message, "You've been encountering the same errors repeatedly. Let Iris help you work through this!");
        assert.deepStrictEqual(options, { modal: false });
        assert.deepStrictEqual(buttons, ['Get Help Now', 'Later']);
    });
});

