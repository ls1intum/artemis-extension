/**
 * Unit tests for the artemis.struggleDetection.showInterventions toggle.
 *
 * Covers:
 *  T1. Toggle off → onDidSuppressIntervention fires once (decision unchanged);
 *      onDidShowIntervention and onDidBlockIntervention do NOT fire.
 *  T2. Toggle off → no calls to vscode.window.show*Message or statusBarItem.show.
 *  T3. Toggle off → UI-delivery state does not advance.
 *  T4. Toggle off → suppression events are NOT rate-limited.
 *  T5. Toggle off → onDidCalculateEQ still fires.
 *  T6. Toggle on (default) → existing show path runs; no suppression event.
 *  T7. Live-toggle on→off with subtle visible → hideHint called; dismiss reason 'hidden'.
 *  T8. Live-toggle off→on → no spurious events.
 *  T9. Setting type guard: non-boolean falls back to true.
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { TelemetryManager } from '../../../../src/extension/services/telemetry/telemetryManager';
import type {
    InterventionDecision,
    SuppressedInterventionPayload,
} from '../../../../src/extension/services/telemetry/types';

interface ConfigStubValues {
    enabled?: boolean;
    showInterventions?: unknown;
    developerMode?: boolean;
}

function stubGetConfiguration(sandbox: sinon.SinonSandbox, values: ConfigStubValues): sinon.SinonStub {
    const original = vscode.workspace.getConfiguration;
    return sandbox.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
        const cfg = original.call(vscode.workspace, section);
        return {
            ...cfg,
            get: <T>(key: string, defaultValue?: T): T => {
                if (section === 'artemis.struggleDetection' && key === 'enabled') {
                    return (values.enabled ?? true) as unknown as T;
                }
                if (section === 'artemis.struggleDetection' && key === 'showInterventions') {
                    return (values.showInterventions ?? true) as unknown as T;
                }
                if (section === 'artemis' && key === 'developerMode') {
                    return (values.developerMode ?? false) as unknown as T;
                }
                return defaultValue as T;
            },
            inspect: cfg.inspect.bind(cfg),
            update: cfg.update.bind(cfg),
            has: cfg.has.bind(cfg),
        } as unknown as vscode.WorkspaceConfiguration;
    });
}

/**
 * Drive a synthetic eligible decision through TelemetryManager._evaluateAndIntervene.
 * Uses a controlled private accessor since _evaluateAndIntervene is private and
 * trigger-emitter wiring would couple this test to unrelated subsystems.
 *
 * Whitebox brittleness: depends on private field/method names
 * `_decisionEngine` and `_evaluateAndIntervene`.
 */
function driveEligibleDecision(
    tm: TelemetryManager,
    overrides: Partial<InterventionDecision> = {},
): void {
    type Internal = {
        _evaluateAndIntervene(triggerType: 'execution-error' | 'multiline-paste' | 'idle' | 'selection-maintained'): void;
        _decisionEngine: { evaluate: (...args: unknown[]) => InterventionDecision };
    };
    const internal = tm as unknown as Internal;
    const stub = sinon.stub(internal._decisionEngine, 'evaluate').returns({
        rawWanted: true,
        shouldIntervene: true,
        level: 'subtle',
        triggerType: 'execution-error',
        eq: 0.5,
        confidence: 'sufficient',
        ...overrides,
    });
    try {
        internal._evaluateAndIntervene('execution-error');
    } finally {
        stub.restore();
    }
}

suite('TelemetryManager — intervention UI toggle', () => {
    let sandbox: sinon.SinonSandbox;
    let showInfoStub: sinon.SinonStub;
    let showWarnStub: sinon.SinonStub;
    let statusBarItem: { show: sinon.SinonStub; hide: sinon.SinonStub; dispose: sinon.SinonStub; text: string; tooltip: string | undefined; backgroundColor: vscode.ThemeColor | undefined; command: string | undefined };

    setup(() => {
        sandbox = sinon.createSandbox();
        statusBarItem = {
            show: sandbox.stub(),
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
            text: '',
            tooltip: undefined,
            backgroundColor: undefined,
            command: undefined,
        };
        sandbox.stub(vscode.window, 'createStatusBarItem').returns(statusBarItem as unknown as vscode.StatusBarItem);
        // Stub command registration so InterventionService construction in
        // multiple tests does not collide on the global command registry.
        // sandbox.restore() in teardown guarantees cleanup even on throw.
        sandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));
        showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage');
        showWarnStub = sandbox.stub(vscode.window, 'showWarningMessage');
    });

    teardown(() => {
        sandbox.restore();
    });

    /**
     * Re-stubbing `vscode.workspace.getConfiguration` requires restoring the
     * existing stub first; sinon throws "already wrapped" otherwise. The
     * sandbox itself doesn't allow targeted restore, so we walk its fakes to
     * find the active getConfiguration wrap and restore just that one.
     */
    function reStubGetConfiguration(values: ConfigStubValues): void {
        const desc = Object.getOwnPropertyDescriptor(vscode.workspace, 'getConfiguration');
        const current = desc?.value as { restore?: () => void } | undefined;
        if (current?.restore) {
            current.restore();
        }
        stubGetConfiguration(sandbox, values);
    }

    test('T1: toggle off → suppression event fires; no show/block events', () => {
        stubGetConfiguration(sandbox, { showInterventions: false });
        const tm = new TelemetryManager();
        const suppressed: SuppressedInterventionPayload[] = [];
        const shown: InterventionDecision[] = [];
        const blocked: unknown[] = [];
        tm.onDidSuppressIntervention(payload => suppressed.push(payload));
        tm.onDidShowIntervention(d => shown.push(d));
        tm.onDidBlockIntervention(p => blocked.push(p));

        driveEligibleDecision(tm, { level: 'subtle' });

        assert.strictEqual(suppressed.length, 1, 'expected exactly one suppression event');
        assert.strictEqual(suppressed[0].reason, 'user-disabled');
        assert.strictEqual(suppressed[0].decision.shouldIntervene, true, 'decision.shouldIntervene must be preserved as true');
        assert.strictEqual(suppressed[0].decision.level, 'subtle');
        assert.strictEqual(shown.length, 0, 'onDidShowIntervention must not fire when suppressed');
        assert.strictEqual(blocked.length, 0, 'onDidBlockIntervention must not fire when suppressed');
        tm.dispose();
    });

    test('T2: toggle off → no UI surface calls', () => {
        stubGetConfiguration(sandbox, { showInterventions: false });
        const tm = new TelemetryManager();

        driveEligibleDecision(tm, { level: 'subtle' });
        driveEligibleDecision(tm, { level: 'notification' });
        driveEligibleDecision(tm, { level: 'proactive' });

        assert.strictEqual(showInfoStub.callCount, 0, 'showInformationMessage was called');
        assert.strictEqual(showWarnStub.callCount, 0, 'showWarningMessage was called');
        assert.strictEqual(statusBarItem.show.callCount, 0, 'statusBarItem.show was called');
        tm.dispose();
    });

    test('T3: toggle off → UI-delivery state does not advance', () => {
        stubGetConfiguration(sandbox, { showInterventions: false });
        const tm = new TelemetryManager();

        for (let i = 0; i < 5; i++) {
            driveEligibleDecision(tm, { level: 'notification' });
        }

        const internal = tm as unknown as { _interventionService: { getState(): { lastInterventionTime: number; sessionInterventionCount: number; lastDismissed: boolean; lastAccepted: boolean } } };
        const state = internal._interventionService.getState();
        assert.strictEqual(state.lastInterventionTime, 0, 'lastInterventionTime advanced');
        assert.strictEqual(state.sessionInterventionCount, 0, 'sessionInterventionCount advanced');
        assert.strictEqual(state.lastDismissed, false);
        assert.strictEqual(state.lastAccepted, false);
        tm.dispose();
    });

    test('T4: toggle off → suppression events are not rate-limited', () => {
        stubGetConfiguration(sandbox, { showInterventions: false });
        const tm = new TelemetryManager();
        const captured: SuppressedInterventionPayload[] = [];
        tm.onDidSuppressIntervention(payload => captured.push(payload));

        for (let i = 0; i < 5; i++) {
            driveEligibleDecision(tm, { level: 'notification' });
        }

        assert.strictEqual(captured.length, 5);
        tm.dispose();
    });

    test('T5: toggle off → onDidCalculateEQ still fires for the trigger', () => {
        stubGetConfiguration(sandbox, { showInterventions: false });
        const tm = new TelemetryManager();
        const eqEvents: unknown[] = [];
        tm.onDidCalculateEQ(e => eqEvents.push(e));

        driveEligibleDecision(tm, { level: 'subtle' });

        assert.strictEqual(eqEvents.length >= 1, true, 'onDidCalculateEQ must fire for trigger evaluation even when UI suppressed');
        tm.dispose();
    });

    test('T6: toggle on (default) → no suppression event; show path runs', () => {
        stubGetConfiguration(sandbox, { showInterventions: true });
        const tm = new TelemetryManager();
        const captured: SuppressedInterventionPayload[] = [];
        tm.onDidSuppressIntervention(payload => captured.push(payload));

        driveEligibleDecision(tm, { level: 'subtle' });

        assert.strictEqual(captured.length, 0);
        assert.strictEqual(statusBarItem.show.callCount >= 1, true, 'statusBarItem.show should fire for subtle path');
        tm.dispose();
    });

    test('T7: live-toggle on→off with subtle visible → hideHint called; dismiss reason hidden', () => {
        stubGetConfiguration(sandbox, { showInterventions: true });
        const tm = new TelemetryManager();

        driveEligibleDecision(tm, { level: 'subtle' });
        const dismissals: Array<{ dismissReason: string }> = [];
        tm.onDidDismissIntervention(payload => dismissals.push(payload));

        // Flip the stubbed config, then re-trigger configuration loading.
        // We invoke _loadConfiguration directly (whitebox) instead of firing a
        // fake ConfigurationChangeEvent: TelemetryManager re-runs
        // _loadConfiguration unconditionally on a matching event, so calling
        // it directly is equivalent and avoids brittle event mocking.
        reStubGetConfiguration({ showInterventions: false });
        (tm as unknown as { _loadConfiguration(): void })._loadConfiguration();

        assert.strictEqual(statusBarItem.hide.callCount >= 1, true, 'statusBarItem.hide expected on transition');
        assert.strictEqual(dismissals.length, 1, 'expected exactly one dismiss event');
        assert.strictEqual(dismissals[0].dismissReason, 'hidden');
        tm.dispose();
    });

    test('T8: live-toggle off→on → no spurious events', () => {
        stubGetConfiguration(sandbox, { showInterventions: false });
        const tm = new TelemetryManager();
        const suppressed: SuppressedInterventionPayload[] = [];
        const dismissals: unknown[] = [];
        tm.onDidSuppressIntervention(p => suppressed.push(p));
        tm.onDidDismissIntervention(p => dismissals.push(p));

        reStubGetConfiguration({ showInterventions: true });
        (tm as unknown as { _loadConfiguration(): void })._loadConfiguration();

        assert.strictEqual(suppressed.length, 0);
        assert.strictEqual(dismissals.length, 0);
        tm.dispose();
    });

    test('T9: type guard — non-boolean setting falls back to true', () => {
        stubGetConfiguration(sandbox, { showInterventions: 'not-a-boolean' });
        const tm = new TelemetryManager();

        const internal = tm as unknown as { _showInterventions: boolean };
        assert.strictEqual(internal._showInterventions, true);
        tm.dispose();
    });
});
