import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import { ExtensionMsg } from '@shared/messageContracts';

import { LiveEngineFeed } from '@extension/services/struggle/live/liveEngineFeed';

function makeFeedWithEmitter() {
    const emitter = new vscode.EventEmitter<any>();
    const feed = new LiveEngineFeed({ onDidTick: emitter.event }, () => true, 600);
    const fireTick = (t: number) => emitter.fire({
        t, ts: t * 1000, sBase: 0.4, s: 0.4, v: 0.3, fastDecay: false,
        boundariesPreGate: [], alert: null,
        decisionTrace: {
            outcome: 'suppressed', reason: 'no-candidate', discreteTrigger: null,
            urgency: 0.4, theta: 0.7, typingRate: 0, boundariesPresent: [],
            secondsSinceLastAlert: Number.POSITIVE_INFINITY, inWarmup: false, graceActive: false,
            gates: { fluentTyping: false, grace: false, warmup: false, belowThreshold: false, cooldown: false, notRearmed: false },
        },
    });
    return { feed, fireTick };
}

const SNAP = () => ({ snapshot: { state: 'free' } as any, episodes: [] });

describe('LiveEngineFeed multi-sink fan-out', () => {
    it('fans ticks out to two distinct sinks', () => {
        const { feed, fireTick } = makeFeedWithEmitter();
        const postsA: any[] = [];
        const postsB: any[] = [];
        const sinkA = (m: any) => postsA.push(m);
        const sinkB = (m: any) => postsB.push(m);

        feed.subscribe(sinkA);
        feed.subscribe(sinkB);
        fireTick(1);

        expect(postsA.some(m => m.type === ExtensionMsg.StruggleLiveTick && m.tick.t === 1)).toBe(true);
        expect(postsB.some(m => m.type === ExtensionMsg.StruggleLiveTick && m.tick.t === 1)).toBe(true);
    });

    it('fans pushSlotUpdate out to two distinct sinks', () => {
        const { feed } = makeFeedWithEmitter();
        const postsA: any[] = [];
        const postsB: any[] = [];
        const sinkA = (m: any) => postsA.push(m);
        const sinkB = (m: any) => postsB.push(m);

        feed.setSlotProvider(SNAP);
        feed.subscribe(sinkA);
        feed.subscribe(sinkB);
        postsA.length = 0;
        postsB.length = 0;
        feed.pushSlotUpdate();

        expect(postsA.filter(m => m.type === ExtensionMsg.StruggleSlotUpdate)).toHaveLength(1);
        expect(postsB.filter(m => m.type === ExtensionMsg.StruggleSlotUpdate)).toHaveLength(1);
    });

    it('same sink twice = refcount 2; one unsubscribe still delivers; second unsubscribe stops delivery', () => {
        const { feed, fireTick } = makeFeedWithEmitter();
        const posts: any[] = [];
        const sink = (m: any) => posts.push(m);

        feed.subscribe(sink);
        feed.subscribe(sink); // refcount = 2

        feed.unsubscribe(sink); // refcount = 1
        posts.length = 0;
        fireTick(1);
        expect(posts.some(m => m.type === ExtensionMsg.StruggleLiveTick)).toBe(true); // still receiving

        feed.unsubscribe(sink); // refcount = 0, removed
        posts.length = 0;
        fireTick(2);
        expect(posts.some(m => m.type === ExtensionMsg.StruggleLiveTick)).toBe(false); // stopped
    });

    it('subscribe(a) replays to a only; a previously subscribed b gets no replay from the second subscribe', () => {
        const { feed } = makeFeedWithEmitter();
        const postsA: any[] = [];
        const postsB: any[] = [];
        const sinkA = (m: any) => postsA.push(m);
        const sinkB = (m: any) => postsB.push(m);

        feed.subscribe(sinkA);
        const beforeB = postsA.length;

        feed.subscribe(sinkB);

        // sinkA should not have received any extra messages from sinkB's subscribe
        expect(postsA.length).toBe(beforeB);
        // sinkB should have received Reset + Backfill + SessionState
        expect(postsB.some(m => m.type === ExtensionMsg.StruggleLiveReset)).toBe(true);
        expect(postsB.some(m => m.type === ExtensionMsg.StruggleLiveBackfill)).toBe(true);
        expect(postsB.some(m => m.type === ExtensionMsg.StruggleLiveSessionState)).toBe(true);
    });

    it('dropSink removes a sink regardless of refcount', () => {
        const { feed, fireTick } = makeFeedWithEmitter();
        const posts: any[] = [];
        const sink = (m: any) => posts.push(m);

        feed.subscribe(sink);
        feed.subscribe(sink); // refcount = 2
        feed.dropSink(sink);  // removed outright

        posts.length = 0;
        fireTick(1);
        expect(posts.some(m => m.type === ExtensionMsg.StruggleLiveTick)).toBe(false);
    });

    it('unsubscribe on absent sink is a silent no-op', () => {
        const { feed, fireTick } = makeFeedWithEmitter();
        const posts: any[] = [];
        const sink = (m: any) => posts.push(m);

        expect(() => feed.unsubscribe(sink)).not.toThrow();

        // Feed is still functional for other sinks after the no-op
        feed.subscribe(sink);
        fireTick(1);
        expect(posts.some(m => m.type === ExtensionMsg.StruggleLiveTick)).toBe(true);
    });

    it('dropSink on absent sink is a silent no-op', () => {
        const { feed, fireTick } = makeFeedWithEmitter();
        const posts: any[] = [];
        const sink = (m: any) => posts.push(m);

        expect(() => feed.dropSink(sink)).not.toThrow();

        // Feed is still functional
        feed.subscribe(sink);
        fireTick(1);
        expect(posts.some(m => m.type === ExtensionMsg.StruggleLiveTick)).toBe(true);
    });
});
