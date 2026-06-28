import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { StruggleDebugSnapshot } from '@shared/messageContracts';

import type { ResultDTO } from '@extension/domain/submissions';
import { ThrottledAlertSink } from '@extension/services/struggle/alerting/throttledAlertSink';
import { SPEC, TUNING } from '@extension/services/struggle/config';
import { StruggleCoordinator } from '@extension/services/struggle/struggleCoordinator';
import type { AlertRecord } from '@extension/services/struggle/types';
import { asEditAlert } from '@test/__shared__/alertNarrow';
import { TestSensorHub } from '@test/__shared__/testSensorHub';

function failingBuild(buildFailed = true): ResultDTO {
    return { id: 1, submission: { id: 1, buildFailed }, feedbacks: [] } as unknown as ResultDTO;
}

suite('StruggleCoordinator', () => {
    let hub: TestSensorHub;
    let delivered: AlertRecord[];
    let coord: StruggleCoordinator;

    setup(() => {
        hub = new TestSensorHub();
        delivered = [];
        coord = new StruggleCoordinator({
            hub,
            alertSink: { deliver: a => delivered.push(a) },
            exerciseRegistry: undefined,
        });
    });
    teardown(() => coord.dispose());

    test('onNewResult emits a guarded build result into the hub (engine sees it)', () => {
        const seen: unknown[] = [];
        const sub = hub.onBuildResult(s => seen.push(s));
        coord.startExerciseSession(1);
        coord.onNewResult(failingBuild());
        assert.strictEqual(seen.length, 1);
        sub.dispose();
    });

    test('an idle session drives the engine to an alert and the sink receives it', () => {
        coord.startExerciseSession(1, vscode.Uri.parse('file:///ws'));
        coord.advanceTo(coord.sessionStartMs + 520_000);   // test-only passthrough to engine.advanceTo
        assert.ok(delivered.length >= 1);
        assert.strictEqual(asEditAlert(delivered[0]).primary, 'STATE');
    });

    test('getSnapshot reflects the last tick', () => {
        coord.startExerciseSession(1);
        coord.advanceTo(coord.sessionStartMs + 20_000);
        const snap = coord.getSnapshot();
        assert.strictEqual(typeof snap.v, 'number');
        assert.strictEqual(snap.sessionSeconds, 20);
    });

    test('onDidStartSession fires on startExerciseSession', () => {
        let count = 0;
        const sub = coord.onDidStartSession(() => { count++; });
        coord.startExerciseSession(1);
        assert.strictEqual(count, 1);
        sub.dispose();
    });

    test('onDidTick fires for the recorder', () => {
        coord.startExerciseSession(1);
        const ticks: number[] = [];
        const sub = coord.onDidTick(t => ticks.push(t.t));
        coord.advanceTo(coord.sessionStartMs + 30_000);
        assert.deepStrictEqual(ticks, [10, 20, 30]);
        sub.dispose();
    });

    test('endExerciseSession stops the engine; restart resets', () => {
        coord.startExerciseSession(1);
        coord.advanceTo(coord.sessionStartMs + 30_000);
        coord.endExerciseSession();
        coord.startExerciseSession(2);
        const snap = coord.getSnapshot();
        assert.strictEqual(snap.sessionSeconds, 0);
    });

    test('struggleDetection.enabled=false suppresses intervention delivery (engine still ticks)', () => {
        // Stub the config so the coordinator reads enabled=false at construction.
        const realGet = vscode.workspace.getConfiguration;
        const stub = sinon.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
            const cfg = realGet.call(vscode.workspace, section);
            if (section === 'artemis.struggleDetection') {
                return { ...cfg, get: (key: string, dflt?: unknown) => (key === 'enabled' ? false : cfg.get(key, dflt)) } as vscode.WorkspaceConfiguration;
            }
            return cfg;
        });
        try {
            const seen: AlertRecord[] = [];
            const disabled = new StruggleCoordinator({
                hub: new TestSensorHub(),
                alertSink: { deliver: a => seen.push(a) },
                exerciseRegistry: undefined,
            });
            try {
                assert.strictEqual(disabled.isEnabled(), false);
                disabled.startExerciseSession(1, vscode.Uri.parse('file:///ws'));
                disabled.advanceTo(disabled.sessionStartMs + 520_000);   // would alert at t=490 if enabled
                assert.strictEqual(seen.length, 0, 'no intervention delivered while disabled');
            } finally {
                disabled.dispose();
            }
        } finally {
            stub.restore();
        }
    });

    test('startExerciseSession resets the sink per-session budget via resetSession (not reset)', () => {
        const calls = { reset: 0, resetSession: 0 };
        const c = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: { deliver: () => { /* noop */ }, reset: () => { calls.reset++; }, resetSession: () => { calls.resetSession++; } },
            exerciseRegistry: undefined,
        });
        try {
            c.startExerciseSession(1);
            assert.strictEqual(calls.resetSession, 1, 'new session resets the throttle budget');
            assert.strictEqual(calls.reset, 0, 'session start is not the UI-only reset');
        } finally {
            c.dispose();
        }
    });

    test('getDebugSnapshot echoes the SPEC/TUNING caps + session anchors, no alert/build yet', () => {
        coord.startExerciseSession(1);
        coord.advanceTo(coord.sessionStartMs + 20_000);
        const dbg = coord.getDebugSnapshot();
        assert.strictEqual(dbg.sessionStartMs, coord.sessionStartMs);
        assert.ok(dbg.nowMs >= dbg.sessionStartMs);
        assert.strictEqual(dbg.lastAlertMs, null);
        assert.strictEqual(dbg.lastFmBadMs, null);
        assert.strictEqual(dbg.throttle, null, 'a plain sink does not expose throttle state');
        assert.deepStrictEqual(dbg.caps, {
            warmupS: SPEC.WARMUP_S,
            cooldownS: SPEC.COOLDOWN_S,
            graceS: SPEC.GRACE_S,
            minDeliveryGapS: TUNING.minDeliveryGapS,
            maxAlertsPerMinute: TUNING.maxAlertsPerMinute,
            maxAlertsPerSession: TUNING.maxAlertsPerSession,
            n2MinActiveS: SPEC.N2_MIN_ACTIVE_S,
            gapNormS: SPEC.GAP_NORM_S,
        });
    });

    test('getDebugSnapshot surfaces the last tick metrics (effective window grows to t)', () => {
        coord.startExerciseSession(1);
        coord.advanceTo(coord.sessionStartMs + 20_000);          // last tick t=20
        const dbg = coord.getDebugSnapshot();
        assert.strictEqual(dbg.effectiveWindowS, 20, 'max(10, min(60, 20)) = 20');
        assert.strictEqual(typeof dbg.longestGapS, 'number');
        assert.strictEqual(typeof dbg.fN2Active, 'boolean');
        assert.ok(dbg.decisionTrace, 'decision trace is present once a tick has run');
        assert.strictEqual(typeof dbg.decisionTrace!.outcome, 'string');
        assert.strictEqual(typeof dbg.decisionTrace!.gates.notRearmed, 'boolean');
    });

    test('getDebugSnapshot.decisionTrace is null and getSnapshot is inactive once the session ends', () => {
        coord.startExerciseSession(1);
        coord.advanceTo(coord.sessionStartMs + 20_000);
        assert.ok(coord.getDebugSnapshot().decisionTrace, 'trace present mid-session');
        coord.endExerciseSession();
        const dbg = coord.getDebugSnapshot();
        assert.strictEqual(dbg.sessionActive, false);
        assert.strictEqual(dbg.decisionTrace, null, 'stale _lastTick must not leak after the session ends');
        const snap = coord.getSnapshot();
        assert.strictEqual(snap.isStruggling, false);
        assert.strictEqual(snap.urgency, 0, 'urgency meter reads zero when no session is active');
        assert.strictEqual(snap.primaryBoundary, null);
        assert.strictEqual(snap.lastAlert, null);
    });

    test('getDebugSnapshot.throttle reflects a ThrottledAlertSink after a delivered alert', () => {
        const c = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: new ThrottledAlertSink({ deliver: () => { /* noop UI */ } }, TUNING),
            exerciseRegistry: undefined,
        });
        try {
            c.startExerciseSession(1, vscode.Uri.parse('file:///ws'));
            c.advanceTo(c.sessionStartMs + 520_000);             // idle → STATE alert delivered
            const dbg = c.getDebugSnapshot();
            assert.ok(dbg.throttle, 'throttle state is exposed');
            assert.ok(dbg.throttle!.deliveredThisSession >= 1, 'at least one alert was delivered');
            assert.strictEqual(dbg.throttle!.deliveredAtMs.length, dbg.throttle!.deliveredThisSession);
        } finally {
            c.dispose();
        }
    });

    test('getDebugSnapshot.lastFmBadMs is armed by a failing (FM) build', () => {
        coord.startExerciseSession(1);
        coord.onNewResult(failingBuild());                       // compile-error → isFM
        coord.advanceTo(coord.sessionStartMs + 20_000);          // tick assigns the build
        const dbg = coord.getDebugSnapshot();
        assert.ok(dbg.lastFmBadMs !== null, 'grace anchor set after a bad build');
        // The build was stamped ~session start, so the anchor sits within the session span.
        assert.ok(dbg.lastFmBadMs! >= coord.sessionStartMs);
    });

    test('getDebugSnapshot.lastAlertMs is set once an alert fires', () => {
        coord.startExerciseSession(1, vscode.Uri.parse('file:///ws'));
        coord.advanceTo(coord.sessionStartMs + 520_000);         // idle → alert
        assert.ok(coord.getDebugSnapshot().lastAlertMs !== null);
    });

    test('getDebugSnapshot read WITHIN the firing onDidTick already reflects that alert (no one-tick lag)', () => {
        // The engine fires onDidTick before onDidAlert, so a snapshot read by an onDidTick consumer
        // on the firing tick must still see this tick's alert as the cooldown anchor (tick.alert path).
        let firing: StruggleDebugSnapshot | undefined;
        const sub = coord.onDidTick(tick => {
            if (tick.alert !== null && firing === undefined) { firing = coord.getDebugSnapshot(); }
        });
        coord.startExerciseSession(1, vscode.Uri.parse('file:///ws'));
        coord.advanceTo(coord.sessionStartMs + 520_000);
        sub.dispose();
        assert.ok(firing, 'an alert fired on some tick');
        assert.ok(firing!.lastAlertMs !== null, 'cooldown anchor reflects the firing tick, not a stale prior alert');
    });

    test('getDebugSnapshot.sessionActive tracks the session lifecycle', () => {
        assert.strictEqual(coord.getDebugSnapshot().sessionActive, false, 'no session yet');
        coord.startExerciseSession(1);
        assert.strictEqual(coord.getDebugSnapshot().sessionActive, true);
        coord.endExerciseSession();
        assert.strictEqual(coord.getDebugSnapshot().sessionActive, false);
    });

    test('turning showInterventions off mid-session clears the UI (reset) WITHOUT resetting the throttle budget (resetSession)', () => {
        let showInterventions = true;
        const realGet = vscode.workspace.getConfiguration;
        const getStub = sinon.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
            const cfg = realGet.call(vscode.workspace, section);
            if (section === 'artemis.struggleDetection') {
                return { ...cfg, get: (key: string, dflt?: unknown) => (key === 'showInterventions' ? showInterventions : cfg.get(key, dflt)) } as vscode.WorkspaceConfiguration;
            }
            return cfg;
        });
        let configHandler: ((e: vscode.ConfigurationChangeEvent) => void) | undefined;
        const onChangeStub = sinon.stub(vscode.workspace, 'onDidChangeConfiguration')
            .callsFake(((h: (e: vscode.ConfigurationChangeEvent) => void) => {
                configHandler = h;
                return new vscode.Disposable(() => { /* noop */ });
            }) as typeof vscode.workspace.onDidChangeConfiguration);
        try {
            const calls = { reset: 0, resetSession: 0 };
            const c = new StruggleCoordinator({
                hub: new TestSensorHub(),
                alertSink: { deliver: () => { /* noop */ }, reset: () => { calls.reset++; }, resetSession: () => { calls.resetSession++; } },
                exerciseRegistry: undefined,
            });
            try {
                c.startExerciseSession(1);                       // resetSession -> 1
                const sessionResetsBefore = calls.resetSession;
                showInterventions = false;                       // toggle delivery off mid-session
                configHandler?.({ affectsConfiguration: () => true } as vscode.ConfigurationChangeEvent);
                assert.strictEqual(calls.reset, 1, 'config-off clears the UI via reset');
                assert.strictEqual(calls.resetSession, sessionResetsBefore, 'config-off must NOT reset the throttle budget');
            } finally {
                c.dispose();
            }
        } finally {
            onChangeStub.restore();
            getStub.restore();
        }
    });
});
