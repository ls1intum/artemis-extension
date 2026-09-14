import { describe, expect, it } from 'vitest';

import { newEpisode } from '@extension/services/struggleIntervention/slot/episode';

describe('Episode.exerciseId', () => {
    it('newEpisode stamps the owning exercise id', () => {
        const ep = newEpisode(1000, () => 'ep-uuid', 42);
        expect(ep.exerciseId).toBe(42);
    });

    it('newEpisode leaves exerciseId undefined when none is known', () => {
        const ep = newEpisode(1000, () => 'ep-uuid', undefined);
        expect(ep.exerciseId).toBeUndefined();
    });
});
