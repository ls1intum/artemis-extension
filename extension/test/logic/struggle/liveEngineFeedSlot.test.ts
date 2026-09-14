import { describe, expect, it } from 'vitest';

import { ExtensionMsg } from '@shared/messageContracts';

import { LiveEngineFeed } from '@extension/services/struggle/live/liveEngineFeed';

function makeFeed() {
    const posts: any[] = [];
    const source = { onDidTick: () => ({ dispose() {} }) };
    const feed = new LiveEngineFeed(source as any, () => true);
    const sink = (m: any) => posts.push(m);
    return { feed, posts, sink };
}
const SNAP = () => ({ snapshot: { state: 'free' } as any, episodes: [] });

describe('LiveEngineFeed slot + ref-count', () => {
    it('replays reset/backfill + slot snapshot on every subscribe (preserves existing feed behavior)', () => {
        const { feed, posts, sink } = makeFeed();
        feed.setSlotProvider(SNAP);
        feed.subscribe(sink);
        feed.subscribe(sink);
        const resets = posts.filter(p => p.type === ExtensionMsg.StruggleLiveReset);
        const slots = posts.filter(p => p.type === ExtensionMsg.StruggleSlotUpdate);
        expect(resets.length).toBe(2);   // replay on EVERY subscribe (not 0->1 only)
        expect(slots.length).toBe(2);
    });
    it('stays active until the last unsubscribe', () => {
        const { feed, posts, sink } = makeFeed();
        feed.setSlotProvider(SNAP);
        feed.subscribe(sink); feed.subscribe(sink);
        feed.unsubscribe(sink); // 2 -> 1, still active
        posts.length = 0;
        feed.pushSlotUpdate();
        expect(posts.filter(p => p.type === ExtensionMsg.StruggleSlotUpdate).length).toBe(1);
        feed.unsubscribe(sink); // 1 -> 0, inactive
        posts.length = 0;
        feed.pushSlotUpdate();
        expect(posts.length).toBe(0);
    });
});
