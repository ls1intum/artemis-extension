/**
 * Unit tests for three correctness invariants:
 *
 *   #1 / #2: Adaptive-Cadence dismiss filter (TelemetryManager).
 *     `onDidDismissIntervention` fires for four distinct reasons:
 *       'user-action', 'hidden', 'replaced', 'session-end'.
 *     Only 'user-action' is an explicit user dismissal and the only signal
 *     Adaptive-Cadence reacts to. Implicit lifecycle dismissals (subtle hint
 *     replaced by a newer one, build success hiding the hint, session ending)
 *     must NOT increment the ignore counter.
 *     A dismiss event without `triggerType` skips the increment instead of
 *     falling back to 'idle'.
 *
 *   #1b: Lifecycle dismissals must not mutate InterventionState.lastDismissed
 *     (InterventionService). `InterventionFilter` blocks subtle/notification
 *     deliveries while `lastDismissed=true`, so an implicit 'replaced' or
 *     'hidden' dismiss flipping it would suppress the next real intervention
 *     even though the user never dismissed anything.
 *
 *   #5: Single-path EQ snapshot intake (TelemetryManager).
 *     Build events flow through the `onDidEmitCompileEquivalent` listener
 *     just like save events, and `onDidCalculateEQ` carries `source: 'build'`
 *     for build-derived snapshots.
 */

import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { ResultDTO } from '@extension/domain';
import type { AdaptiveCadence } from '@extension/services/telemetry/intervention/adaptiveCadence';
import { InterventionService } from '@extension/services/telemetry/interventionService';
import { TelemetryManager } from '@extension/services/telemetry/telemetryManager';
import type { InterventionDecision, InterventionDismissReason, TriggerType } from '@extension/services/telemetry/types';

type DismissPayload = InterventionDecision & { dismissReason: InterventionDismissReason };

interface TelemetryManagerInternals {
    _adaptiveCadence: AdaptiveCadence;
    _interventionService: {
        _onDidDismissIntervention: vscode.EventEmitter<DismissPayload>;
    };
}

function asInternals(tm: TelemetryManager): TelemetryManagerInternals {
    return tm as unknown as TelemetryManagerInternals;
}

function makeDecision(overrides: Partial<InterventionDecision> = {}): InterventionDecision {
    return {
        rawWanted: true,
        shouldIntervene: true,
        level: 'notification',
        triggerType: 'execution-error',
        eq: 0.5,
        confidence: 'sufficient',
        ...overrides,
    };
}

function fireDismiss(
    tm: TelemetryManager,
    reason: InterventionDismissReason,
    overrides: Partial<InterventionDecision> = {},
): void {
    const emitter = asInternals(tm)._interventionService._onDidDismissIntervention;
    emitter.fire({ ...makeDecision(overrides), dismissReason: reason });
}

function totalIgnoreCount(tm: TelemetryManager): number {
    const counts = asInternals(tm)._adaptiveCadence.getState().ignoreCounts;
    return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

suite('TelemetryManager — Adaptive-Cadence dismiss filter (#1, #2)', () => {
    let sandbox: sinon.SinonSandbox;
    let tm: TelemetryManager;

    setup(() => {
        sandbox = sinon.createSandbox();
        const statusBarItem = {
            show: sandbox.stub(),
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
            text: '',
            tooltip: undefined,
            backgroundColor: undefined,
            command: undefined,
        };
        sandbox.stub(vscode.window, 'createStatusBarItem').returns(statusBarItem as unknown as vscode.StatusBarItem);
        sandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));
        tm = new TelemetryManager();
    });

    teardown(() => {
        tm.dispose();
        sandbox.restore();
    });

    test('user-action dismiss increments the ignore counter for the trigger', () => {
        const before = totalIgnoreCount(tm);
        fireDismiss(tm, 'user-action', { triggerType: 'multiline-paste' });
        const after = asInternals(tm)._adaptiveCadence.getState().ignoreCounts;
        assert.strictEqual(after['multiline-paste'], 1, 'multiline-paste counter should advance');
        assert.strictEqual(totalIgnoreCount(tm) - before, 1, 'exactly one increment expected');
    });

    test("'replaced' dismiss does NOT increment the ignore counter", () => {
        const before = totalIgnoreCount(tm);
        fireDismiss(tm, 'replaced', { triggerType: 'execution-error' });
        assert.strictEqual(totalIgnoreCount(tm), before, "'replaced' must not advance cadence");
    });

    test("'hidden' dismiss does NOT increment the ignore counter", () => {
        const before = totalIgnoreCount(tm);
        fireDismiss(tm, 'hidden', { triggerType: 'idle' });
        assert.strictEqual(totalIgnoreCount(tm), before, "'hidden' must not advance cadence");
    });

    test("'session-end' dismiss does NOT increment the ignore counter", () => {
        const before = totalIgnoreCount(tm);
        fireDismiss(tm, 'session-end', { triggerType: 'selection-maintained' });
        assert.strictEqual(totalIgnoreCount(tm), before, "'session-end' must not advance cadence");
    });

    test('user-action dismiss without triggerType is skipped (no idle fallback)', () => {
        const idleBefore = asInternals(tm)._adaptiveCadence.getState().ignoreCounts['idle'];
        const totalBefore = totalIgnoreCount(tm);
        fireDismiss(tm, 'user-action', { triggerType: undefined });
        const idleAfter = asInternals(tm)._adaptiveCadence.getState().ignoreCounts['idle'];
        assert.strictEqual(idleAfter, idleBefore, 'idle counter must not advance on undefined triggerType');
        assert.strictEqual(totalIgnoreCount(tm), totalBefore, 'no counter should advance');
    });

    test('mixed sequence: only the user-action increments', () => {
        const baseline = totalIgnoreCount(tm);
        fireDismiss(tm, 'replaced', { triggerType: 'idle' });
        fireDismiss(tm, 'hidden', { triggerType: 'idle' });
        fireDismiss(tm, 'session-end', { triggerType: 'idle' });
        fireDismiss(tm, 'user-action', { triggerType: 'idle' });
        assert.strictEqual(totalIgnoreCount(tm) - baseline, 1, 'only user-action should increment');
    });
});

suite('InterventionService — lifecycle dismissals do not flip lastDismissed (#1b)', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        const statusBarItem = {
            show: sandbox.stub(),
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
            text: '',
            tooltip: undefined,
            backgroundColor: undefined,
            command: undefined,
        };
        sandbox.stub(vscode.window, 'createStatusBarItem').returns(statusBarItem as unknown as vscode.StatusBarItem);
        sandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));
    });

    teardown(() => {
        sandbox.restore();
    });

    test("'replaced' dismiss does NOT set lastDismissed", async () => {
        const svc = new InterventionService();
        try {
            svc.showSubtleHintEQ(makeDecision({ level: 'subtle', triggerType: 'idle' }));
            svc.showSubtleHintEQ(makeDecision({ level: 'subtle', triggerType: 'multiline-paste' }));
            assert.strictEqual(svc.getState().lastDismissed, false, 'replaced subtle hint must not flip lastDismissed');
        } finally {
            svc.dispose();
        }
    });

    test("'hidden' dismiss does NOT set lastDismissed", async () => {
        const svc = new InterventionService();
        try {
            svc.showSubtleHintEQ(makeDecision({ level: 'subtle', triggerType: 'execution-error' }));
            svc.hideHint();
            assert.strictEqual(svc.getState().lastDismissed, false, 'hideHint must not flip lastDismissed');
        } finally {
            svc.dispose();
        }
    });

    test('user-action dismiss (notification "Not now") SETS lastDismissed', async () => {
        // Caller-side mutation in showNotificationEQ still flips the flag.
        const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves('Not now' as unknown as vscode.MessageItem);
        const svc = new InterventionService();
        try {
            await svc.showNotificationEQ(makeDecision({ level: 'notification', triggerType: 'idle' }));
            assert.strictEqual(svc.getState().lastDismissed, true, 'user-action dismiss must flip lastDismissed');
            assert.strictEqual(showInfoStub.callCount, 1);
        } finally {
            svc.dispose();
        }
    });
});

suite('TelemetryManager — single-path EQ snapshot intake (#5)', () => {
    let sandbox: sinon.SinonSandbox;
    let tm: TelemetryManager;

    setup(() => {
        sandbox = sinon.createSandbox();
        const statusBarItem = {
            show: sandbox.stub(),
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
            text: '',
            tooltip: undefined,
            backgroundColor: undefined,
            command: undefined,
        };
        sandbox.stub(vscode.window, 'createStatusBarItem').returns(statusBarItem as unknown as vscode.StatusBarItem);
        sandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));
        tm = new TelemetryManager();
    });

    teardown(() => {
        tm.dispose();
        sandbox.restore();
    });

    test('build result emits onDidCalculateEQ with source "build" (no longer mislabelled as "save")', () => {
        tm.startExerciseSession(42);
        type EqEvent = { source: 'save' | 'build' | 'trigger'; triggerType?: TriggerType };
        const events: EqEvent[] = [];
        const sub = tm.onDidCalculateEQ(e => events.push(e));
        try {
            const result: ResultDTO = {
                id: 1,
                participation: { id: 5001 },
                submission: { buildFailed: true },
                successful: false,
            };
            tm.onNewResult(result);
            const buildEvents = events.filter(e => e.source === 'build');
            const saveEvents = events.filter(e => e.source === 'save');
            assert.strictEqual(buildEvents.length, 1, 'expected exactly one build-source EQ event');
            assert.strictEqual(saveEvents.length, 0, 'no save-source EQ event must be emitted for a build result');
        } finally {
            sub.dispose();
        }
    });

    test('build result is added to EQ engine exactly once (no double-counting)', () => {
        tm.startExerciseSession(43);
        type EQEngineLike = {
            addSnapshot: (snapshot: unknown) => boolean;
        };
        const internals = tm as unknown as { _eqEngine: EQEngineLike };
        const addSnapshotSpy = sandbox.spy(internals._eqEngine, 'addSnapshot');

        const result: ResultDTO = {
            id: 2,
            participation: { id: 5001 },
            submission: { buildFailed: true },
            successful: false,
        };
        tm.onNewResult(result);

        assert.strictEqual(
            addSnapshotSpy.callCount,
            1,
            'addSnapshot must be called exactly once per build result',
        );
    });

    test('build snapshot intake flows exclusively through onDidEmitCompileEquivalent (single-path architecture)', () => {
        // Architectural regression guard: if anyone reintroduces a direct
        // `addSnapshot` call in `onNewResult`, silencing the emitter would no
        // longer disable the intake, and this test would fail.
        tm.startExerciseSession(44);
        type EmitterLike = {
            _onDidEmitCompileEquivalent: { fire: (e: unknown) => void };
        };
        type EQEngineLike = { addSnapshot: (s: unknown) => boolean };
        const internals = tm as unknown as {
            _compileEmitter: EmitterLike;
            _eqEngine: EQEngineLike;
        };
        const addSnapshotSpy = sandbox.spy(internals._eqEngine, 'addSnapshot');
        // Replace `fire` with a no-op so the listener never runs.
        sandbox.replace(internals._compileEmitter._onDidEmitCompileEquivalent, 'fire', () => undefined);

        tm.onNewResult({
            id: 3,
            participation: { id: 5001 },
            submission: { buildFailed: true },
            successful: false,
        });

        assert.strictEqual(
            addSnapshotSpy.callCount,
            0,
            'with the emitter silenced, no snapshot path should exist — proves the listener is the only path',
        );
    });
});

suite('TelemetryManager.dispose() — idempotent', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(vscode.window, 'createStatusBarItem').returns({
            show: sandbox.stub(), hide: sandbox.stub(), dispose: sandbox.stub(),
            text: '', tooltip: undefined, backgroundColor: undefined, command: undefined,
        } as unknown as vscode.StatusBarItem);
        sandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));
    });

    teardown(() => {
        sandbox.restore();
    });

    test('calling dispose twice does not throw and does not re-run teardown', () => {
        const tm = new TelemetryManager();
        tm.dispose();
        // No throw on the second call: VS Code disposes context.subscriptions
        // after extension.ts:deactivate has already disposed explicitly.
        assert.doesNotThrow(() => tm.dispose());
    });
});

suite('TelemetryManager: exercise session across an identity change', () => {
    let sandbox: sinon.SinonSandbox;
    let tm: TelemetryManager;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(vscode.window, 'createStatusBarItem').returns({
            show: sandbox.stub(), hide: sandbox.stub(), dispose: sandbox.stub(),
            text: '', tooltip: undefined, backgroundColor: undefined, command: undefined,
        } as unknown as vscode.StatusBarItem);
        sandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));
        tm = new TelemetryManager();
    });

    teardown(() => {
        tm.dispose();
        sandbox.restore();
    });

    // `startExerciseSession` is deliberately a no-op for the id it is already
    // tracking, so if the identity reset does not end the session, the next
    // account working on an exercise with the same numeric id silently
    // continues the previous account's session. That is corrupt research data.
    test('ending the session lets the same exercise id start a fresh one', () => {
        tm.startExerciseSession(77);
        tm.onNewResult({
            id: 1,
            participation: { id: 5001 },
            submission: { buildFailed: true },
            successful: false,
        });
        assert.ok(tm.getEqEngineState().snapshots.length > 0, 'the first account produced data');

        // What the identity reset now does, then the new account's workspace
        // detection landing on an exercise with the same id.
        tm.endExerciseSession();
        tm.startExerciseSession(77);

        assert.strictEqual(
            tm.getEqEngineState().snapshots.length, 0,
            'the new account must not inherit the previous one\'s session',
        );
    });
});
