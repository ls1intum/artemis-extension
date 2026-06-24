import * as vscode from 'vscode';
import { LiveEngineFeed } from '@extension/services/struggle/live/liveEngineFeed';
import { ExtensionMsg } from '@shared/messageContracts';

function fakeTick(t: number, over: any = {}): any {
    return { t, ts: t * 1000, sBase: 0.4, s: 0.4, v: 0.3, fastDecay: false,
        boundariesPreGate: [], alert: null,
        decisionTrace: { outcome: 'suppressed', reason: 'no-candidate', discreteTrigger: null,
            urgency: 0.4, theta: 0.7, typingRate: 0, boundariesPresent: [],
            secondsSinceLastAlert: Number.POSITIVE_INFINITY, inWarmup: false, graceActive: false },
        ...over };
}

test('buffers ticks and backfills (reset then backfill) on subscribe in dev mode', () => {
    const emitter = new vscode.EventEmitter<any>();
    const posted: any[] = [];
    const feed = new LiveEngineFeed({ onDidTick: emitter.event }, m => posted.push(m), () => true, 600);
    emitter.fire(fakeTick(10)); emitter.fire(fakeTick(20));
    feed.subscribe();
    const types = posted.map(m => m.type);
    expect(types.indexOf(ExtensionMsg.StruggleLiveReset)).toBeLessThan(types.indexOf(ExtensionMsg.StruggleLiveBackfill));
    expect(posted.find(m => m.type === ExtensionMsg.StruggleLiveBackfill).ticks).toHaveLength(2);
    emitter.fire(fakeTick(30));
    expect(posted.some(m => m.type === ExtensionMsg.StruggleLiveTick && m.tick.t === 30)).toBe(true);
});

test('buffers while unsubscribed but posts nothing', () => {
    const emitter = new vscode.EventEmitter<any>();
    const posted: any[] = [];
    const feed = new LiveEngineFeed({ onDidTick: emitter.event }, m => posted.push(m), () => true, 600);
    emitter.fire(fakeTick(10));
    expect(posted).toHaveLength(0);
    feed.subscribe();
    expect(posted.find(m => m.type === ExtensionMsg.StruggleLiveBackfill).ticks).toHaveLength(1);
});

test('serializes Infinity secondsSinceLastAlert to null and carries discreteTrigger', () => {
    const live = LiveEngineFeed.toLiveTick(fakeTick(10, { decisionTrace: {
        outcome: 'fired-discrete', reason: 'no-candidate', discreteTrigger: 'test-stagnation',
        urgency: 0.4, theta: 0.7, typingRate: 0, boundariesPresent: [],
        secondsSinceLastAlert: Number.POSITIVE_INFINITY, inWarmup: false, graceActive: false }, alert: { kind: 'discrete' } }));
    expect(live.decisionTrace.secondsSinceLastAlert).toBeNull();
    expect(live.decisionTrace.discreteTrigger).toBe('test-stagnation');
    expect(live.alertKind).toBe('discrete');
});

test('no posts when developer mode is off (even while subscribed)', () => {
    const emitter = new vscode.EventEmitter<any>();
    const posted: any[] = [];
    const feed = new LiveEngineFeed({ onDidTick: emitter.event }, m => posted.push(m), () => false, 600);
    feed.subscribe();
    emitter.fire(fakeTick(10));
    expect(posted).toHaveLength(0);
});

test('drops oldest past the cap', () => {
    const emitter = new vscode.EventEmitter<any>();
    const posted: any[] = [];
    const feed = new LiveEngineFeed({ onDidTick: emitter.event }, m => posted.push(m), () => true, 2);
    emitter.fire(fakeTick(10)); emitter.fire(fakeTick(20)); emitter.fire(fakeTick(30));
    feed.subscribe();
    expect(posted.find(m => m.type === ExtensionMsg.StruggleLiveBackfill).ticks.map((t: any) => t.t)).toEqual([20, 30]);
});

test('clear() empties the buffer and posts reset when subscribed', () => {
    const emitter = new vscode.EventEmitter<any>();
    const posted: any[] = [];
    const feed = new LiveEngineFeed({ onDidTick: emitter.event }, m => posted.push(m), () => true, 600);
    emitter.fire(fakeTick(10));
    feed.subscribe();
    posted.length = 0;
    feed.clear();
    expect(posted).toEqual([{ type: ExtensionMsg.StruggleLiveReset }]);
    emitter.fire(fakeTick(20));
    expect(posted.find(m => m.type === ExtensionMsg.StruggleLiveBackfill)).toBeUndefined(); // buffer was cleared
});
