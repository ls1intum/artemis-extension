import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { StruggleDebugSnapshot } from '@shared/messageContracts';

import type { ResultDTO } from '@extension/domain/submissions';
import { ThrottledAlertSink } from '@extension/services/struggle/alerting/throttledAlertSink';
import { SPEC, THROTTLE_BY_LEVEL, TUNING } from '@extension/services/struggle/config';
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

    test('onNewResult calls onNewBuildResult(true) on sink for a strict new high in passed tests; false for a drop', () => {
        const calls: boolean[] = [];
        const c = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: { deliver: () => { /* noop */ }, onNewBuildResult: (v: boolean) => calls.push(v) },
            exerciseRegistry: undefined,
        });
        try {
            c.startExerciseSession(1);
            // First build: 3 passed -> new high (prev was -1)
            c.onNewResult({ id: 1, passedTestCaseCount: 3 } as ResultDTO);
            assert.deepStrictEqual(calls, [true], 'first build with 3 passed is a new high');
            // Second build: 2 passed -> not a new high
            c.onNewResult({ id: 2, passedTestCaseCount: 2 } as ResultDTO);
            assert.deepStrictEqual(calls, [true, false], 'lower count is not a new high');
            // Third build: 5 passed -> new high
            c.onNewResult({ id: 3, passedTestCaseCount: 5 } as ResultDTO);
            assert.deepStrictEqual(calls, [true, false, true], '5 > 3 is a new high');
            // New session: max resets; 2 passed on fresh session is a new high again
            c.startExerciseSession(2);
            c.onNewResult({ id: 4, passedTestCaseCount: 2 } as ResultDTO);
            assert.deepStrictEqual(calls, [true, false, true, true], 'new session resets the baseline');
        } finally {
            c.dispose();
        }
    });

    test('a failed build with a stale non-zero passed count is never a new green', () => {
        const calls: boolean[] = [];
        const c = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: { deliver: () => { /* noop */ }, onNewBuildResult: (v: boolean) => calls.push(v) },
            exerciseRegistry: undefined,
        });
        try {
            c.startExerciseSession(1);
            c.onNewResult({ id: 1, passedTestCaseCount: 5, testCaseCount: 10 } as ResultDTO);   // green, max=5
            // A failed/compile-error build carrying a stale HIGHER count must NOT fire green (the engine
            // nulls the count on failed builds; the coordinator must too), and must leave the baseline alone.
            c.onNewResult({ id: 2, passedTestCaseCount: 8, testCaseCount: 10, submission: { id: 2, buildFailed: true } } as unknown as ResultDTO);
            assert.deepStrictEqual(calls, [true, false], 'a failed build never fires a new green');
            // Baseline untouched: a later same-set 6/10 is still a strict new high over the retained 5.
            c.onNewResult({ id: 3, passedTestCaseCount: 6, testCaseCount: 10 } as ResultDTO);
            assert.deepStrictEqual(calls, [true, false, true], 'the failed build left the baseline at 5');
        } finally {
            c.dispose();
        }
    });

    test('a changed test set (denominator) re-baselines silently; only a later same-set high fires green', () => {
        const calls: boolean[] = [];
        const c = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: { deliver: () => { /* noop */ }, onNewBuildResult: (v: boolean) => calls.push(v) },
            exerciseRegistry: undefined,
        });
        try {
            c.startExerciseSession(1);
            c.onNewResult({ id: 1, passedTestCaseCount: 5, testCaseCount: 10 } as ResultDTO);   // green, max=5, ref=10
            // Denominator change 10 -> 20: 8 > 5 must NOT fake progress across incomparable sets; the new
            // set re-baselines silently to 8/20 instead of emitting green.
            c.onNewResult({ id: 2, passedTestCaseCount: 8, testCaseCount: 20 } as ResultDTO);
            assert.deepStrictEqual(calls, [true, false], 'the first build at a new test set is not progress');
            // Same set, strict increase over the new baseline -> green.
            c.onNewResult({ id: 3, passedTestCaseCount: 9, testCaseCount: 20 } as ResultDTO);
            assert.deepStrictEqual(calls, [true, false, true], '9 > 8 on the same set is a new high');
        } finally {
            c.dispose();
        }
    });

    test('a half-null build at a changed denominator defers the re-baseline until the first comparable build', () => {
        const calls: boolean[] = [];
        const c = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: { deliver: () => { /* noop */ }, onNewBuildResult: (v: boolean) => calls.push(v) },
            exerciseRegistry: undefined,
        });
        try {
            c.startExerciseSession(1);
            c.onNewResult({ id: 1, passedTestCaseCount: 5, testCaseCount: 10 } as ResultDTO);   // green, max=5, ref=10
            // Denominator changed but the passed count is missing (incomplete build) -> skip, baseline stays 5/10.
            c.onNewResult({ id: 2, testCaseCount: 20 } as ResultDTO);
            assert.deepStrictEqual(calls, [true, false], 'an incomplete build is not green');
            // First COMPARABLE build at the new set: silent re-baseline to 2/20, NOT green against the stale -1/5.
            c.onNewResult({ id: 3, passedTestCaseCount: 2, testCaseCount: 20 } as ResultDTO);
            assert.deepStrictEqual(calls, [true, false, false], 'the first comparable build at the new set is silent');
            // Now a strict increase on the new set fires green.
            c.onNewResult({ id: 4, passedTestCaseCount: 3, testCaseCount: 20 } as ResultDTO);
            assert.deepStrictEqual(calls, [true, false, false, true], '3 > 2 on the new set is a new high');
        } finally {
            c.dispose();
        }
    });

    test('a malformed build (passed > total, negative passed, or non-positive total) is never a new green', () => {
        const calls: boolean[] = [];
        const c = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: { deliver: () => { /* noop */ }, onNewBuildResult: (v: boolean) => calls.push(v) },
            exerciseRegistry: undefined,
        });
        try {
            c.startExerciseSession(1);
            c.onNewResult({ id: 1, passedTestCaseCount: 5, testCaseCount: 10 } as ResultDTO);   // green, max=5
            // Internally-inconsistent payloads carry no real progress signal: never green, baseline untouched.
            c.onNewResult({ id: 2, passedTestCaseCount: 999, testCaseCount: 10 } as ResultDTO);  // passed > total
            c.onNewResult({ id: 3, passedTestCaseCount: -1, testCaseCount: 10 } as ResultDTO);   // negative passed
            c.onNewResult({ id: 4, passedTestCaseCount: 0, testCaseCount: 0 } as ResultDTO);     // non-positive total
            assert.deepStrictEqual(calls, [true, false, false, false], 'malformed builds never fire a new green');
            // Baseline intact: a real 6/10 is still a strict new high over the retained 5.
            c.onNewResult({ id: 5, passedTestCaseCount: 6, testCaseCount: 10 } as ResultDTO);
            assert.deepStrictEqual(calls, [true, false, false, false, true], 'malformed builds left the baseline at 5');
        } finally {
            c.dispose();
        }
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
        assert.strictEqual(typeof snap.urgency, 'number');
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

    test('getDebugSnapshot echoes the SPEC caps + session anchors, no alert/build yet', () => {
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
            gapNormS: SPEC.GAP_NORM_S,
        });
    });

    test('getDebugSnapshot surfaces the last tick metrics (effective window grows to t)', () => {
        coord.startExerciseSession(1);
        coord.advanceTo(coord.sessionStartMs + 20_000);          // last tick t=20
        const dbg = coord.getDebugSnapshot();
        assert.strictEqual(dbg.effectiveWindowS, 20, 'max(10, min(60, 20)) = 20');
        assert.strictEqual(typeof dbg.longestGapS, 'number');
        assert.ok(dbg.decisionTrace, 'decision trace is present once a tick has run');
        assert.strictEqual(typeof dbg.decisionTrace!.outcome, 'string');
        assert.strictEqual(typeof dbg.decisionTrace!.gates.notRearmed, 'boolean');
    });

    test('getDebugSnapshot.testStagnation shows the streak mid-session and null after the session ends', () => {
        coord.startExerciseSession(1);
        coord.advanceTo(coord.sessionStartMs + 20_000);
        const mid = coord.getDebugSnapshot().testStagnation;
        assert.ok(mid, 'test-stagnation state present mid-session');
        assert.strictEqual(mid!.streak, 0, 'no builds ingested yet');
        assert.strictEqual(mid!.n, TUNING.testStagnationN);
        assert.strictEqual(typeof mid!.enabled, 'boolean');
        coord.endExerciseSession();
        assert.strictEqual(coord.getDebugSnapshot().testStagnation, null,
            'stale tracker (only recreated on start) must not leak after the session ends');
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
            alertSink: new ThrottledAlertSink({ deliver: () => { /* noop UI */ } }, () => THROTTLE_BY_LEVEL.more),
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
