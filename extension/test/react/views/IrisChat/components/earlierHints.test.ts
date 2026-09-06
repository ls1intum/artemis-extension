import { describe, expect, it } from 'vitest';

import { type ClosedResolver, groupEarlierHints } from '@webview/views/IrisChat/components/earlierHints';
import type { ChatRenderItem } from '@webview/views/IrisChat/components/groupProactiveMessages';
import type { ChatMessage } from '@webview/views/IrisChat/types';

const episode = (episodeId: string): ChatRenderItem => ({ kind: 'episode', episodeId, messages: [] });

const chat = (localId: string): ChatRenderItem => ({
    kind: 'single',
    message: { localId, role: 'user', content: localId, timestamp: 0 } as ChatMessage,
});

const proactiveSingle = (localId: string, episodeId: string): ChatRenderItem => ({
    kind: 'single',
    message: { localId, role: 'assistant', origin: 'proactive', proactiveEpisodeId: episodeId, content: '', timestamp: 0 } as ChatMessage,
});

/** Treats the given episodeIds as CLOSED fold lines; everything else is open/non-proactive. */
const closedBy = (ids: string[]): ClosedResolver => {
    const set = new Set(ids);
    return (item) => {
        const epId = item.kind === 'episode' ? item.episodeId : item.message.proactiveEpisodeId;
        return epId && set.has(epId) ? epId : undefined;
    };
};

describe('groupEarlierHints', () => {
    it('collapses a run of >=2 consecutive closed episodes into one group keyed by the first episodeId', () => {
        const items = [episode('A'), episode('B'), episode('C')];
        const grouped = groupEarlierHints(items, closedBy(['A', 'B', 'C']));
        expect(grouped).toEqual([
            { kind: 'earlier-hints', key: 'A', items },
        ]);
    });

    it('leaves a lone closed episode as a plain item (no run to collapse)', () => {
        const items = [episode('A')];
        const grouped = groupEarlierHints(items, closedBy(['A']));
        expect(grouped).toEqual([{ kind: 'item', item: items[0] }]);
    });

    it('a chat turn between closed episodes splits them into two separate runs', () => {
        const a = episode('A'); const b = episode('B'); const u = chat('u1'); const c = episode('C'); const d = episode('D');
        const grouped = groupEarlierHints([a, b, u, c, d], closedBy(['A', 'B', 'C', 'D']));
        expect(grouped).toEqual([
            { kind: 'earlier-hints', key: 'A', items: [a, b] },
            { kind: 'item', item: u },
            { kind: 'earlier-hints', key: 'C', items: [c, d] },
        ]);
    });

    it('an open (live, unfolded) episode is never grouped and breaks the run', () => {
        const a = episode('A'); const b = episode('B'); const live = episode('LIVE');
        const grouped = groupEarlierHints([a, b, live], closedBy(['A', 'B']));
        expect(grouped).toEqual([
            { kind: 'earlier-hints', key: 'A', items: [a, b] },
            { kind: 'item', item: live },
        ]);
    });

    it('a closed single-message proactive episode participates in a run', () => {
        const p = proactiveSingle('p1', 'A'); const b = episode('B');
        const grouped = groupEarlierHints([p, b], closedBy(['A', 'B']));
        expect(grouped).toEqual([{ kind: 'earlier-hints', key: 'A', items: [p, b] }]);
    });

    it('preserves order and passes non-closed items through untouched', () => {
        const u1 = chat('u1'); const a1 = chat('a1');
        const grouped = groupEarlierHints([u1, a1], closedBy([]));
        expect(grouped).toEqual([
            { kind: 'item', item: u1 },
            { kind: 'item', item: a1 },
        ]);
    });
});
