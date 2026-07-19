import * as vscode from 'vscode';
import * as assert from 'assert';

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

/** Always-granted detection consent for tests that are not about the gate (#349). */
function grantedConsent() {
    return { isGranted: () => true, onDidChange: new vscode.EventEmitter<void>().event };
}

/** Flippable consent whose set() also fires the change event (#349 gate tests). */
class TestConsent {
    private readonly _em = new vscode.EventEmitter<void>();
    private _granted: boolean;
    readonly consent: { isGranted: () => boolean; onDidChange: vscode.Event<void> };
    constructor(granted: boolean) {
        this._granted = granted;
        this.consent = { isGranted: () => this._granted, onDidChange: this._em.event };
    }
    set(granted: boolean): void { this._granted = granted; this._em.fire(); }
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
            detectionConsent: grantedConsent(),
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
            detectionConsent: grantedConsent(),
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
            detectionConsent: grantedConsent(),
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
            detectionConsent: grantedConsent(),
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
            detectionConsent: grantedConsent(),
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
            detectionConsent: grantedConsent(),
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

    test('delivery is ungated by configuration: an idle STATE alert reaches the sink (#352)', () => {
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

    test('isConsentGranted reflects the consent dep', () => {
        const granted = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: { deliver: () => { /* noop */ } },
            exerciseRegistry: undefined,
            detectionConsent: grantedConsent(),
        });
        const denied = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: { deliver: () => { /* noop */ } },
            exerciseRegistry: undefined,
            detectionConsent: { isGranted: () => false, onDidChange: () => new vscode.Disposable(() => { /* noop */ }) },
        });
        try {
            assert.strictEqual(granted.isConsentGranted(), true);
            assert.strictEqual(denied.isConsentGranted(), false);
        } finally {
            granted.dispose();
            denied.dispose();
        }
    });

    test('startExerciseSession resets the sink per-session budget via resetSession (not reset)', () => {
        const calls = { reset: 0, resetSession: 0 };
        const c = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: { deliver: () => { /* noop */ }, reset: () => { calls.reset++; }, resetSession: () => { calls.resetSession++; } },
            exerciseRegistry: undefined,
            detectionConsent: grantedConsent(),
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
            detectionConsent: grantedConsent(),
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

});

suite('StruggleCoordinator consent gate (#349)', () => {
    /** Manual clock: engine timer is inert; tests drive via coordinator.advanceTo. */
    function manualClock(startMs: number) {
        let now = startMs;
        return {
            clock: { now: () => now, setInterval: () => 0, clearInterval: () => { /* manual */ } },
            advance: (ms: number) => { now += ms; },
        };
    }

    /** 1-char-insert text change for the hub (mirrors the engine test's fakeTextChange). */
    function oneCharInsert(uri: string, ts: number): { ts: number; event: unknown } {
        return {
            ts,
            event: {
                document: { uri: vscode.Uri.parse(uri), getText: () => 'x' },
                contentChanges: [{ text: 'a', rangeLength: 0, range: { start: { line: 0 }, isEmpty: true, isSingleLine: true } }],
            },
        };
    }

    test('no consent: no engine, no ticks, no start event, inactive snapshots, onNewResult inert', () => {
        const T0 = 1_000_000_000_000;
        const { clock, advance } = manualClock(T0);
        const tc = new TestConsent(false);
        const hub = new TestSensorHub();
        const latch: boolean[] = [];
        const seen: unknown[] = [];
        const ticks: number[] = [];
        let started = 0;
        const c = new StruggleCoordinator({
            hub,
            alertSink: { deliver: () => { /* noop */ }, onNewBuildResult: v => latch.push(v) },
            detectionConsent: tc.consent,
            exerciseRegistry: undefined,
            clock,
        });
        try {
            c.onDidStartSession(() => started++);
            c.onDidTick(t => ticks.push(t.t));
            const sub = hub.onBuildResult(s => seen.push(s));
            c.startExerciseSession(1);
            // The engine never started: editor activity + time produce NO ticks.
            hub.emit.textChange.fire(oneCharInsert('file:///work/ex1/src/A.java', T0 + 1_000) as never);
            advance(30_000);
            c.advanceTo(T0 + 30_000);
            assert.deepStrictEqual(ticks, [], 'no engine ticks without consent');
            assert.strictEqual(started, 0, 'no start event without consent');
            assert.strictEqual(c.activeExerciseId, 1, 'bookkeeping still records the exercise');
            assert.strictEqual(c.getSnapshot().isStruggling, false);
            assert.strictEqual(c.getDebugSnapshot().sessionActive, false, 'debug snapshot reports no live session');
            c.onNewResult({ id: 1, passedTestCaseCount: 3, testCaseCount: 10 } as ResultDTO);
            assert.deepStrictEqual(seen, [], 'no hub emit without consent');
            assert.deepStrictEqual(latch, [], 'no progress-latch signal without consent');
            sub.dispose();
        } finally { c.dispose(); }
    });

    test('mid-session grant: engine starts NOW (fresh sessionStartMs), start event fires once', () => {
        const T0 = 1_000_000_000_000;
        const { clock, advance } = manualClock(T0);
        const tc = new TestConsent(false);
        let started = 0;
        const c = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: { deliver: () => { /* noop */ } },
            detectionConsent: tc.consent,
            exerciseRegistry: undefined,
            clock,
        });
        try {
            c.onDidStartSession(() => started++);
            c.startExerciseSession(1);
            advance(600_000);                       // student worked 10 min unconsented
            tc.set(true);                           // grant
            assert.strictEqual(started, 1, 'start event fires on grant');
            assert.strictEqual(c.sessionStartMs, T0 + 600_000, 'fresh session start = grant time (fresh warmup)');
            assert.strictEqual(c.getDebugSnapshot().sessionActive, true);
            tc.set(true);                           // duplicate event: reconciliation is idempotent
            assert.strictEqual(started, 1);
        } finally { c.dispose(); }
    });

    test('mid-session revoke: abort without drain, end event, onConsentRevoked on the sink', () => {
        const T0 = 1_000_000_000_000;
        const { clock, advance } = manualClock(T0);
        const tc = new TestConsent(true);
        const sinkCalls: string[] = [];
        const ticks: number[] = [];
        let ended = 0;
        const c = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: {
                deliver: () => { /* noop */ },
                reset: () => sinkCalls.push('reset'),
                onConsentRevoked: () => sinkCalls.push('onConsentRevoked'),
            },
            detectionConsent: tc.consent,
            exerciseRegistry: undefined,
            clock,
        });
        try {
            c.onDidTick(t => ticks.push(t.t));
            c.onDidEndSession(() => ended++);
            c.startExerciseSession(1);
            advance(25_000);                        // two grid ticks are DUE but unprocessed
            tc.set(false);                          // revoke
            assert.deepStrictEqual(ticks, [], 'no final drain: due ticks are not computed on revoke');
            assert.strictEqual(ended, 1, 'end event fires on revoke');
            assert.ok(sinkCalls.includes('onConsentRevoked'), 'consent-revocation reset reaches the sink');
            assert.strictEqual(c.getDebugSnapshot().sessionActive, false);
            assert.strictEqual(c.activeExerciseId, 1, 'bookkeeping survives the revoke');
        } finally { c.dispose(); }
    });

    test('revoke -> regrant: engine restarts fresh; throttle budget is never touched by flips', () => {
        const T0 = 1_000_000_000_000;
        const { clock, advance } = manualClock(T0);
        const tc = new TestConsent(true);
        let sessionResets = 0;
        const c = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: { deliver: () => { /* noop */ }, resetSession: () => sessionResets++ },
            detectionConsent: tc.consent,
            exerciseRegistry: undefined,
            clock,
        });
        try {
            c.startExerciseSession(1);
            assert.strictEqual(sessionResets, 1, 'exercise open resets the throttle session');
            advance(60_000);
            tc.set(false);
            advance(60_000);
            tc.set(true);
            assert.strictEqual(sessionResets, 1, 'consent flips never reset the throttle session');
            assert.strictEqual(c.sessionStartMs, T0 + 120_000, 'regrant restarts the engine fresh');
        } finally { c.dispose(); }
    });

    test('same-exercise call while consent pending updates the root the ENGINE starts with', () => {
        const T0 = 1_000_000_000_000;
        const { clock } = manualClock(T0);
        const tc = new TestConsent(false);
        const hub = new TestSensorHub();
        const ticks: Array<{ n: number }> = [];
        const c = new StruggleCoordinator({
            hub,
            alertSink: { deliver: () => { /* noop */ } },
            detectionConsent: tc.consent,
            exerciseRegistry: undefined,
            clock,
        });
        try {
            c.onDidTick(t => ticks.push({ n: t.features.nOneCharInserts }));
            c.startExerciseSession(1);                                       // no root known yet
            c.startExerciseSession(1, vscode.Uri.parse('file:///work/ex1')); // repeat call carries the root
            tc.set(true);                                                    // engine starts NOW with that root
            assert.strictEqual(c.activeExerciseRoot?.path, '/work/ex1');
            // Prove the ENGINE received the root: its URI filter keeps the in-root edit
            // and drops the out-of-root one (2 fired, 1 counted).
            hub.emit.textChange.fire(oneCharInsert('file:///work/ex1/src/A.java', T0 + 1_000) as never);
            hub.emit.textChange.fire(oneCharInsert('file:///elsewhere/B.java', T0 + 2_000) as never);
            c.advanceTo(T0 + 10_000);
            assert.strictEqual(ticks.length, 1, 'the engine runs after the grant');
            assert.strictEqual(ticks[0].n, 1, 'URI filter uses the updated root (in-root counted, out-of-root dropped)');
        } finally { c.dispose(); }
    });

    test('exercise end while the engine never ran fires no end event', () => {
        const tc = new TestConsent(false);
        let ended = 0;
        const c = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: { deliver: () => { /* noop */ } },
            detectionConsent: tc.consent,
            exerciseRegistry: undefined,
        });
        try {
            c.onDidEndSession(() => ended++);
            c.startExerciseSession(1);
            c.endExerciseSession();
            assert.strictEqual(ended, 0, 'no unmatched engine-end event');
            assert.strictEqual(c.activeExerciseId, undefined, 'bookkeeping cleared');
        } finally { c.dispose(); }
    });

    test('baseline asymmetry: denied builds never enter the coordinator baseline; the engine tracker restarts', () => {
        // DEFAULT clock deliberately: TestSensorHub stamps build events with the real
        // Date.now(), and they only enter the engine's stagnation tracker when a grid
        // tick drains the queue - so the session must live in real time and be drained
        // with advanceTo. (The engine's live interval is irrelevant at test speed.)
        const tc = new TestConsent(true);
        const latch: boolean[] = [];
        const c = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: { deliver: () => { /* noop */ }, onNewBuildResult: v => latch.push(v) },
            detectionConsent: tc.consent,
            exerciseRegistry: undefined,
        });
        try {
            c.startExerciseSession(1);
            c.onNewResult({ id: 1, passedTestCaseCount: 3, testCaseCount: 10 } as ResultDTO);
            c.onNewResult({ id: 2, passedTestCaseCount: 3, testCaseCount: 10 } as ResultDTO);  // no new high
            assert.deepStrictEqual(latch, [true, false], 'consented builds set the baseline (max=3)');
            c.advanceTo(c.sessionStartMs + 10_000);    // tick 10 drains both queued builds
            // Tracker semantics: the first build establishes the streak at 1, the equal
            // second increments it (see testStagnation.ts).
            assert.strictEqual(c.getDebugSnapshot().testStagnation?.streak, 2, 'engine stagnation streak grew');
            tc.set(false);
            c.onNewResult({ id: 3, passedTestCaseCount: 5, testCaseCount: 10 } as ResultDTO);
            assert.deepStrictEqual(latch, [true, false], 'denied-period build is fully ignored');
            tc.set(true);
            // The intentional asymmetry (spec 6.4): the coordinator baseline is SESSION-scoped
            // and survives the flip; the engine's own test-stagnation tracker is ENGINE-scoped
            // and restarts fresh with the new engine.
            assert.strictEqual(c.getDebugSnapshot().testStagnation?.streak, 0, 'engine tracker restarted on regrant');
            c.onNewResult({ id: 4, passedTestCaseCount: 4, testCaseCount: 10 } as ResultDTO);
            assert.deepStrictEqual(latch, [true, false, true], '4 > retained max 3 is a new high; the denied 5 never counted');
        } finally { c.dispose(); }
    });
});
