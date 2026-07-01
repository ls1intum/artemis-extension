import * as vscode from 'vscode';

import { ExtensionMsg } from '@shared/messageContracts';

import { LiveEngineFeed } from '@extension/services/struggle/live/liveEngineFeed';

function fakeTick(t: number, over: any = {}): any {
    return { t, ts: t * 1000, sBase: 0.4, s: 0.4, v: 0.3, fastDecay: false,
        boundariesPreGate: [], alert: null,
        decisionTrace: { outcome: 'suppressed', reason: 'no-candidate', discreteTrigger: null,
            urgency: 0.4, theta: 0.7, typingRate: 0, boundariesPresent: [],
            secondsSinceLastAlert: Number.POSITIVE_INFINITY, inWarmup: false, graceActive: false,
            gates: { fluentTyping: false, grace: false, warmup: false, belowThreshold: false, cooldown: false, notRearmed: false } },
        ...over };
}

test('buffers ticks and backfills (reset then backfill) on subscribe in dev mode', () => {
    const emitter = new vscode.EventEmitter<any>();
    const posted: any[] = [];
    const sink = (m: any) => posted.push(m);
    const feed = new LiveEngineFeed({ onDidTick: emitter.event }, () => true, 600);
    emitter.fire(fakeTick(10)); emitter.fire(fakeTick(20));
    feed.subscribe(sink);
    const types = posted.map(m => m.type);
    expect(types.indexOf(ExtensionMsg.StruggleLiveReset)).toBeLessThan(types.indexOf(ExtensionMsg.StruggleLiveBackfill));
    expect(posted.find(m => m.type === ExtensionMsg.StruggleLiveBackfill).ticks).toHaveLength(2);
    emitter.fire(fakeTick(30));
    expect(posted.some(m => m.type === ExtensionMsg.StruggleLiveTick && m.tick.t === 30)).toBe(true);
});

test('buffers while unsubscribed but posts nothing', () => {
    const emitter = new vscode.EventEmitter<any>();
    const posted: any[] = [];
    const sink = (m: any) => posted.push(m);
    const feed = new LiveEngineFeed({ onDidTick: emitter.event }, () => true, 600);
    emitter.fire(fakeTick(10));
    expect(posted).toHaveLength(0);
    feed.subscribe(sink);
    expect(posted.find(m => m.type === ExtensionMsg.StruggleLiveBackfill).ticks).toHaveLength(1);
});

test('serializes Infinity secondsSinceLastAlert to null and carries discreteTrigger', () => {
    const live = LiveEngineFeed.toLiveTick(fakeTick(10, { decisionTrace: {
        outcome: 'fired-discrete', reason: 'no-candidate', discreteTrigger: 'test-stagnation',
        urgency: 0.4, theta: 0.7, typingRate: 0, boundariesPresent: [],
        secondsSinceLastAlert: Number.POSITIVE_INFINITY, inWarmup: false, graceActive: false,
        gates: { fluentTyping: false, grace: false, warmup: false, belowThreshold: false, cooldown: false, notRearmed: false } }, alert: { kind: 'discrete' } }));
    expect(live.decisionTrace.secondsSinceLastAlert).toBeNull();
    expect(live.decisionTrace.discreteTrigger).toBe('test-stagnation');
    expect(live.alertKind).toBe('discrete');
});

test('no posts when developer mode is off (even while subscribed)', () => {
    const emitter = new vscode.EventEmitter<any>();
    const posted: any[] = [];
    const sink = (m: any) => posted.push(m);
    const feed = new LiveEngineFeed({ onDidTick: emitter.event }, () => false, 600);
    feed.subscribe(sink);
    emitter.fire(fakeTick(10));
    expect(posted).toHaveLength(0);
});

test('drops oldest past the cap', () => {
    const emitter = new vscode.EventEmitter<any>();
    const posted: any[] = [];
    const sink = (m: any) => posted.push(m);
    const feed = new LiveEngineFeed({ onDidTick: emitter.event }, () => true, 2);
    emitter.fire(fakeTick(10)); emitter.fire(fakeTick(20)); emitter.fire(fakeTick(30));
    feed.subscribe(sink);
    expect(posted.find(m => m.type === ExtensionMsg.StruggleLiveBackfill).ticks.map((t: any) => t.t)).toEqual([20, 30]);
});

test('subscribe announces the current session-active state', () => {
    const emitter = new vscode.EventEmitter<any>();
    const posted: any[] = [];
    const sink = (m: any) => posted.push(m);
    const feed = new LiveEngineFeed({ onDidTick: emitter.event }, () => true, 600);
    feed.subscribe(sink);
    expect(posted.find(m => m.type === ExtensionMsg.StruggleLiveSessionState))
        .toEqual({ type: ExtensionMsg.StruggleLiveSessionState, active: false });
});

test('setSessionActive(true) on a fresh session resets the chart and announces the active state', () => {
    const emitter = new vscode.EventEmitter<any>();
    const posted: any[] = [];
    const sink = (m: any) => posted.push(m);
    const feed = new LiveEngineFeed({ onDidTick: emitter.event }, () => true, 600);
    emitter.fire(fakeTick(10));
    feed.subscribe(sink);
    posted.length = 0;
    feed.setSessionActive(true);
    expect(posted).toEqual([
        { type: ExtensionMsg.StruggleLiveReset },
        { type: ExtensionMsg.StruggleLiveSessionState, active: true },
    ]);
    // The buffer was cleared: a re-subscribe backfills only ticks after the reset.
    emitter.fire(fakeTick(20));
    posted.length = 0;
    feed.subscribe(sink);
    expect(posted.find(m => m.type === ExtensionMsg.StruggleLiveBackfill).ticks.map((t: any) => t.t)).toEqual([20]);
});

test('setSessionActive(false) announces the idle state without clearing the buffer', () => {
    const emitter = new vscode.EventEmitter<any>();
    const posted: any[] = [];
    const sink = (m: any) => posted.push(m);
    const feed = new LiveEngineFeed({ onDidTick: emitter.event }, () => true, 600);
    feed.setSessionActive(true);          // become active first (pre-subscribe: silent)
    emitter.fire(fakeTick(10));
    feed.subscribe(sink);
    posted.length = 0;
    feed.setSessionActive(false);
    expect(posted).toEqual([{ type: ExtensionMsg.StruggleLiveSessionState, active: false }]);
    // Buffer intact: the previous session's curve stays until a new session starts.
    posted.length = 0;
    feed.subscribe(sink);
    expect(posted.find(m => m.type === ExtensionMsg.StruggleLiveBackfill).ticks.map((t: any) => t.t)).toEqual([10]);
});
