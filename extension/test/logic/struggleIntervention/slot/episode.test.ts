import { describe, expect, it } from 'vitest';

import { addHint, markContinuation, newEpisode, toRequestEpisode } from '@extension/services/struggleIntervention/slot/episode';
import type { EpisodeHint } from '@extension/services/struggleIntervention/slot/episode';

describe('episode model', () => {
    const idgen = () => 'ep-1';

    it('newEpisode returns correct initial shape', () => {
        const ep = newEpisode(1000, idgen);
        expect(ep).toEqual({ episodeId: 'ep-1', isNew: true, hints: [], createdAtMs: 1000 });
    });

    it('addHint appends a hint immutably', () => {
        const ep = newEpisode(1000, idgen);
        const hint: EpisodeHint = { level: 'ambient', text: 'check your loop', atSessionS: 60 };
        const ep2 = addHint(ep, hint);

        // input is unchanged
        expect(ep.hints).toHaveLength(0);

        // output has the new hint
        expect(ep2.hints).toHaveLength(1);
        expect(ep2.hints[0]).toEqual(hint);

        // other fields are preserved
        expect(ep2.episodeId).toBe('ep-1');
        expect(ep2.isNew).toBe(true);
        expect(ep2.createdAtMs).toBe(1000);
    });

    it('addHint accumulates multiple hints', () => {
        let ep = newEpisode(2000, idgen);
        const h1: EpisodeHint = { level: 'ambient', text: 'hint one', atSessionS: 30 };
        const h2: EpisodeHint = { level: 'active', text: 'hint two', atSessionS: 90 };
        ep = addHint(ep, h1);
        ep = addHint(ep, h2);
        expect(ep.hints).toHaveLength(2);
        expect(ep.hints[1].level).toBe('active');
    });

    it('markContinuation sets isNew=false immutably', () => {
        const ep = newEpisode(1000, idgen);
        const ep2 = markContinuation(ep);

        // input is unchanged
        expect(ep.isNew).toBe(true);

        // output has isNew=false
        expect(ep2.isNew).toBe(false);

        // other fields are preserved
        expect(ep2.episodeId).toBe('ep-1');
        expect(ep2.hints).toEqual([]);
        expect(ep2.createdAtMs).toBe(1000);
    });

    it('toRequestEpisode drops createdAtMs', () => {
        const hint: EpisodeHint = { level: 'ambient', text: 'a hint', atSessionS: 45 };
        const ep = addHint(newEpisode(1000, idgen), hint);
        const req = toRequestEpisode(ep);

        expect(req).toEqual({ episodeId: 'ep-1', isNew: true, hints: [hint] });
        expect((req as Record<string, unknown>)['createdAtMs']).toBeUndefined();
    });
});
