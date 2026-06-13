import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { ResultDTO } from '@extension/domain/submissions';
import { StruggleEngine } from '@extension/services/struggle/struggleEngine';
import type { AlertRecord, TickRecord } from '@extension/services/struggle/types';
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
        assert.strictEqual(alerts[0].primary, 'STATE');
        assert.strictEqual(alerts[0].path, 'armed');
        // idle severity: fTyping=1, fGap=1, fN4=0.1 -> S = 0.7 >= theta
        const tick49 = ticks.find(t => t.t === 490)!;
        assert.ok(Math.abs(tick49.s - 0.7) < 1e-9);
    });

    test('E6 re-alerts every 120 s while the idle state persists', () => {
        engine.advanceTo(START + 740_000);
        assert.deepStrictEqual(alerts.map(a => a.t), [490, 610, 730]);
        assert.deepStrictEqual(alerts.map(a => a.path), ['armed', 'e6', 'e6']);
    });

    test('an FM boundary breaks through warmup when V is already high', () => {
        // idle until V >= theta (reached well before 400), bad build at 400 s
        engine.advanceTo(START + 400_000);
        hub.emit.buildResult.fire({ ts: START + 400_500, result: failingResult([], true) });
        engine.advanceTo(START + 480_000);
        assert.strictEqual(alerts[0]?.t, 410);
        assert.strictEqual(alerts[0]?.primary, 'FM');
        assert.strictEqual(alerts[0]?.inWarmup, true);
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

    test('feedback view bonus raises S by 0.25 while open in the window', () => {
        hub.emit.taskFeedbackView.fire({ ts: START + 5_000, action: 'opened', viewId: 'v1' });
        engine.advanceTo(START + 10_000);
        const t10 = ticks[0];
        assert.strictEqual(t10.features.fFb, 1);
        assert.ok(Math.abs(t10.s - Math.min(1, t10.sBase + 0.25)) < 1e-9);
    });

    test('stop() halts ticking; restart resets all state', () => {
        // NOTE: the default clock's now() is the real Date.now(), far beyond
        // START — stop()'s final drain would catch up across years of grid
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
        assert.strictEqual(first.v, first.s);     // V reset: first tick V = S
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

    test('stop() final drain: a due tick still consumes flushed debounced evidence', () => {
        engine.dispose();
        const clock = sinon.useFakeTimers({ now: START, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        try {
            hub = new TestSensorHub();
            // Manual engine clock: now() follows the faked Date, no interval —
            // reproduces "tick 70 due but not yet run" (timer jitter).
            engine = new StruggleEngine(hub, { now: () => Date.now(), setInterval: () => 0, clearInterval: () => { /* manual */ } });
            const seen: TickRecord[] = [];
            engine.onDidTick(t => seen.push(t));
            engine.start({ sessionStartMs: START });
            engine.advanceTo(START + 60_000);                  // ticks 10..60 ran
            clock.tick(69_950);                                 // now = +69.95 s
            const editor = { textEditor: { document: { uri: vscode.Uri.parse('file:///ws/Main.java') } } };
            hub.emit.visibleRanges.fire({ ts: Date.now(), event: editor as never });
            clock.tick(300);                                    // debouncer flushes at +70.25 s
            engine.stop();                                      // tick 70 is DUE and must run
            const t70 = seen.find(t => t.t === 70);
            assert.ok(t70, 'tick 70 must run during the final drain');
            assert.strictEqual(t70!.features.scrollEvents, 1);
        } finally {
            clock.restore();
            engine.dispose();
        }
    });

    test('preDebouncedIntake bypasses the debouncers (replay mode, Decision 5)', () => {
        engine.dispose();
        hub = new TestSensorHub();
        engine = new StruggleEngine(hub, undefined, { preDebouncedIntake: true });
        const seen: TickRecord[] = [];
        engine.onDidTick(t => seen.push(t));
        engine.start({ sessionStartMs: START });
        const editor = { textEditor: { document: { uri: vscode.Uri.parse('file:///ws/Main.java') } } };
        for (let i = 0; i < 3; i++) {
            hub.emit.visibleRanges.fire({ ts: START + 2_000 + i * 100, event: editor as never });
        }
        engine.advanceTo(START + 10_000);
        assert.strictEqual(seen[0].features.scrollEvents, 3);   // every recorded event counts
    });

    test('debounced scroll: a raw visibleRange burst counts once (recorder parity)', () => {
        engine.dispose();
        const clock = sinon.useFakeTimers({ now: START, toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
        try {
            hub = new TestSensorHub();
            engine = new StruggleEngine(hub);
            const seen: TickRecord[] = [];
            engine.onDidTick(t => seen.push(t));
            engine.start({ sessionStartMs: START });
            const editor = {
                textEditor: { document: { uri: vscode.Uri.parse('file:///ws/Main.java') } },
            };
            for (let i = 0; i < 5; i++) {
                clock.tick(50);
                hub.emit.visibleRanges.fire({ ts: Date.now(), event: editor as never });
            }
            clock.tick(10_000);
            const t10 = seen.find(t => t.t === 10)!;
            assert.strictEqual(t10.features.scrollEvents, 1);
        } finally {
            clock.restore();
            engine.dispose();
        }
    });
});
