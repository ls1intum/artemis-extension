import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { ResultDTO } from '@extension/domain/submissions';
import { StruggleEngine } from '@extension/services/struggle/struggleEngine';
import type { AlertRecord, TickRecord } from '@extension/services/struggle/types';
import { asEditAlert } from '@test/__shared__/alertNarrow';
import { TestSensorHub } from '@test/__shared__/testSensorHub';

function failingResult(failed: string[], buildFailed = false): ResultDTO {
    return {
        id: 1,
        submission: { id: 1, buildFailed },
        feedbacks: failed.map(d => ({ positive: false, detailText: d, text: 't' })),
    } as unknown as ResultDTO;
}

function fakeTextChange(uri: string, oneCharTexts: string[], fullText: string): { ts: number; event: unknown } {
    return {
        ts: 0, // caller overwrites
        event: {
            document: { uri: vscode.Uri.parse(uri), getText: () => fullText },
            contentChanges: oneCharTexts.map(text => ({
                text,
                rangeLength: 0,
                range: { start: { line: 0 }, isEmpty: true, isSingleLine: true },
            })),
        },
    };
}

suite('StruggleEngine (tick contract end-to-end)', () => {
    const START = 1_000_000_000_000;
    let hub: TestSensorHub;
    let engine: StruggleEngine;
    let ticks: TickRecord[];
    let alerts: AlertRecord[];

    setup(() => {
        hub = new TestSensorHub();
        engine = new StruggleEngine(hub);
        ticks = [];
        alerts = [];
        engine.onDidTick(t => ticks.push(t));
        engine.onDidAlert(a => alerts.push(a));
        engine.start({ sessionStartMs: START });
    });
    teardown(() => { engine.dispose(); });

    test('emits one TickRecord per 10 s grid point, catch-up safe', () => {
        engine.advanceTo(START + 60_000);
        assert.deepStrictEqual(ticks.map(t => t.t), [10, 20, 30, 40, 50, 60]);
        assert.strictEqual(ticks[0].ts, START + 10_000);
    });

    test('T8d: an idle session alerts at the first warmup-free tick (t=490)', () => {
        engine.advanceTo(START + 520_000);
        assert.deepStrictEqual(alerts.map(a => a.t), [490]);
        const a0 = asEditAlert(alerts[0]);
        assert.strictEqual(a0.primary, 'STATE');
        assert.strictEqual(a0.path, 'armed');
        // idle severity (v3 2-feature): fTyping=1, fGap=1 -> S = (1+1)/2 = 1.0 >= theta(0.7)
        const tick49 = ticks.find(t => t.t === 490)!;
        assert.ok(Math.abs(tick49.sBase - 1.0) < 1e-9);
        // The alert payload carries the firing tick's decision signal.
        assert.strictEqual(a0.urgency, tick49.sBase);
    });

    test('E6 re-alerts every 120 s while the idle state persists', () => {
        engine.advanceTo(START + 740_000);
        assert.deepStrictEqual(alerts.map(a => a.t), [490, 610, 730]);
        assert.deepStrictEqual(alerts.map(a => asEditAlert(a).path), ['armed', 'e6', 'e6']);
    });

    test('an FM boundary breaks through warmup when severity is already high', () => {
        // idle until urgency >= theta (reached well before 400), bad build at 400 s
        engine.advanceTo(START + 400_000);
        hub.emit.buildResult.fire({ ts: START + 400_500, result: failingResult([], true) });
        engine.advanceTo(START + 480_000);
        const fm = asEditAlert(alerts[0]);
        assert.strictEqual(fm.t, 410);
        assert.strictEqual(fm.primary, 'FM');
        assert.strictEqual(fm.inWarmup, true);
    });

    test('drain rule: an event with ts exactly on the grid belongs to that tick', () => {
        engine.advanceTo(START + 400_000);
        hub.emit.buildResult.fire({ ts: START + 410_000, result: failingResult([], true) });
        engine.advanceTo(START + 420_000);
        assert.strictEqual(alerts[0]?.t, 410);
    });

    test('fluent typing keeps severity low and B2 blocks (no alerts)', () => {
        // 2 one-char inserts per second, continuously
        for (let s = 1; s <= 600; s++) {
            const sig = fakeTextChange('file:///ws/Main.java', ['a', 'b'], 'class A {}');
            (sig as { ts: number }).ts = START + s * 1000;
            hub.emit.textChange.fire(sig as never);
        }
        engine.advanceTo(START + 600_000);
        assert.deepStrictEqual(alerts, []);
        const last = ticks[ticks.length - 1];
        assert.ok(last.features.typingRate >= 20);
    });

    test('uri filter: edits outside the exercise root are ignored', () => {
        engine.dispose();                      // abort path: no drain against real now()
        hub = new TestSensorHub();
        engine = new StruggleEngine(hub);
        ticks = [];
        engine.onDidTick(t => ticks.push(t));
        engine.start({ sessionStartMs: START, exerciseRoot: vscode.Uri.parse('file:///ws/ex1') });
        const inside = fakeTextChange('file:///ws/ex1/Main.java', ['a'], 'x');
        (inside as { ts: number }).ts = START + 5_000;
        hub.emit.textChange.fire(inside as never);
        const outside = fakeTextChange('file:///ws/other/Main.java', ['a'], 'x');
        (outside as { ts: number }).ts = START + 6_000;
        hub.emit.textChange.fire(outside as never);
        engine.advanceTo(START + 10_000);
        assert.strictEqual(ticks[ticks.length - 1].features.nOneCharInserts, 1);
    });

    test('severity: fTyping=0.6, fGap=0.3 -> sBase=0.45 (spec §1 formula, moved from featureWindow.test.ts)', () => {
        // 8 one-char inserts spaced 12 s apart within the 60 s effective window (t=70,
        // eff=60, w0=10): typingRate = 60*8/60 = 8/min -> fTyping = clip(1-8/20) = 0.6;
        // longestGapS = 12 (every consecutive gap, incl. w0..first and last..t) ->
        // fGap = clip(12/40) = 0.3. sBase = (0.6 + 0.3) / 2 = 0.45.
        const times = [22, 34, 46, 58, 70];
        const chars = [2, 2, 2, 1, 1];
        times.forEach((t, i) => {
            const sig = fakeTextChange('file:///ws/Main.java', Array(chars[i]).fill('a'), 'class A {}');
            (sig as { ts: number }).ts = START + t * 1000;
            hub.emit.textChange.fire(sig as never);
        });
        engine.advanceTo(START + 70_000);
        const t70 = ticks.find(t => t.t === 70)!;
        assert.strictEqual(t70.features.typingRate, 8);
        assert.strictEqual(t70.features.longestGapS, 12);
        assert.ok(Math.abs(t70.sBase - 0.45) < 1e-9);
    });

    test('stop() halts ticking; restart resets all state', () => {
        // NOTE: the default clock's now() is the real Date.now(), far beyond
        // START, so stop()'s final drain would catch up across years of grid
        // ticks. Use a pinned manual clock for this lifecycle test.
        engine.dispose();
        hub = new TestSensorHub();
        let nowMs = START;
        engine = new StruggleEngine(hub, { now: () => nowMs, setInterval: () => 0, clearInterval: () => { /* manual */ } });
        ticks = [];
        engine.onDidTick(t => ticks.push(t));
        engine.start({ sessionStartMs: START });
        nowMs = START + 30_000;
        engine.advanceTo(nowMs);
        engine.stop();
        engine.advanceTo(START + 60_000);
        assert.strictEqual(ticks.length, 3);
        const START2 = START + 100_000;
        nowMs = START2;
        engine.start({ sessionStartMs: START2 });
        engine.advanceTo(START2 + 10_000);
        const first = ticks[ticks.length - 1];
        assert.strictEqual(first.t, 10);
    });

    test('live timer drives ticks through the injectable clock (sinon)', () => {
        engine.dispose();
        const clock = sinon.useFakeTimers({ now: START, toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
        try {
            hub = new TestSensorHub();
            engine = new StruggleEngine(hub);
            const seen: number[] = [];
            engine.onDidTick(t => seen.push(t.t));
            engine.start({ sessionStartMs: START });
            clock.tick(30_000);
            assert.deepStrictEqual(seen, [10, 20, 30]);
        } finally {
            clock.restore();
            engine.dispose();
        }
    });

    test('emitted TickRecord carries the decision trace', () => {
        engine.advanceTo(START + 10_000);   // first grid tick at t=10
        const last = ticks.at(-1)!;
        assert.strictEqual(last.decisionTrace.reason, 'no-candidate');
        assert.strictEqual(last.decisionTrace.outcome, 'suppressed');
    });

    test('stop() final drain: a due tick still runs and consumes queued evidence', () => {
        engine.dispose();
        const clock = sinon.useFakeTimers({ now: START, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        try {
            hub = new TestSensorHub();
            // Manual engine clock: now() follows the faked Date, no interval.
            // Reproduces "tick 70 due but not yet run" (timer jitter).
            engine = new StruggleEngine(hub, { now: () => Date.now(), setInterval: () => 0, clearInterval: () => { /* manual */ } });
            const seen: TickRecord[] = [];
            engine.onDidTick(t => seen.push(t));
            engine.start({ sessionStartMs: START });
            engine.advanceTo(START + 60_000);                  // ticks 10..60 ran
            clock.tick(69_950);                                 // now = +69.95 s
            const sig = fakeTextChange('file:///ws/Main.java', ['a'], 'x');
            (sig as { ts: number }).ts = Date.now();           // +69.95 s, queued for tick 70
            hub.emit.textChange.fire(sig as never);
            clock.tick(300);                                    // now = +70.25 s
            engine.stop();                                      // tick 70 is DUE and must run
            const t70 = seen.find(t => t.t === 70);
            assert.ok(t70, 'tick 70 must run during the final drain');
            assert.strictEqual(t70!.features.nOneCharInserts, 1);
        } finally {
            clock.restore();
            engine.dispose();
        }
    });

    test('abort() tears down WITHOUT the final drain (#349 revoke path)', () => {
        engine.dispose();
        hub = new TestSensorHub();
        let nowMs = START;
        engine = new StruggleEngine(hub, { now: () => nowMs, setInterval: () => 0, clearInterval: () => { /* manual */ } });
        ticks = [];
        engine.onDidTick(t => ticks.push(t));
        engine.start({ sessionStartMs: START });
        nowMs = START + 25_000;                  // grid ticks 10 s and 20 s are DUE but unprocessed
        engine.abort();                          // stop() would drain them; a consent revoke must not
        assert.deepStrictEqual(ticks, [], 'abort must not compute ticks from pending observations');
        engine.advanceTo(START + 60_000);        // torn down: no session survives an abort
        assert.deepStrictEqual(ticks, [], 'advanceTo after abort is a no-op');
    });
});

suite('StruggleEngine — dev skip-warmup', () => {
    const START = 1_000_000_000_000;

    test('setSkipWarmup(true) before start: idle session alerts STATE inside the 480 s warm-up', () => {
        const hub = new TestSensorHub();
        const engine = new StruggleEngine(hub);
        const alerts: AlertRecord[] = [];
        engine.onDidAlert(a => alerts.push(a));
        engine.setSkipWarmup(true);                    // dev command, applied before the session starts
        engine.start({ sessionStartMs: START });
        engine.advanceTo(START + 60_000);              // 6 ticks, all well inside the default 480 s warm-up
        assert.ok(alerts.length > 0);
        const first = asEditAlert(alerts[0]);
        assert.strictEqual(first.primary, 'STATE');     // STATE boundary emitted despite being pre-warm-up
        assert.strictEqual(first.inWarmup, false);      // D1 gate lifted
        assert.ok(alerts[0].t <= 60);
        engine.dispose();
    });

    test('setSkipWarmup(true) mid-session takes effect live without a restart', () => {
        const hub = new TestSensorHub();
        const engine = new StruggleEngine(hub);
        const alerts: AlertRecord[] = [];
        engine.onDidAlert(a => alerts.push(a));
        engine.start({ sessionStartMs: START });
        engine.advanceTo(START + 100_000);              // 10 ticks, default warm-up -> silent
        assert.strictEqual(alerts.length, 0);
        engine.setSkipWarmup(true);                     // toggle mid-session
        engine.advanceTo(START + 110_000);              // the next tick fires
        assert.ok(alerts.length > 0);
        assert.strictEqual(alerts[0].t, 110);
        engine.dispose();
    });
});
