import { describe, expect, it } from 'vitest';

import { NUDGE_TEXTS, pickNudgeText } from '@extension/services/ui/nudgeBannerText';

describe('nudgeBannerText', () => {
    it('the rotation pool has exactly 4 entries', () => {
        expect(NUDGE_TEXTS).toHaveLength(4);
    });

    it('pickNudgeText(prevTitle) never returns the same title as prevTitle', () => {
        for (const entry of NUDGE_TEXTS) {
            for (let i = 0; i < 20; i++) {
                const picked = pickNudgeText(entry.title, Math.random);
                expect(picked.title).not.toBe(entry.title);
            }
        }
    });

    it('with a stubbed rand it deterministically returns the expected pool entry', () => {
        // No prevTitle: pool is the full NUDGE_TEXTS (length 4). rand() = 0 -> index 0.
        expect(pickNudgeText(undefined, () => 0)).toEqual(NUDGE_TEXTS[0]);
        // rand() just under 1 -> last index (3).
        expect(pickNudgeText(undefined, () => 0.999)).toEqual(NUDGE_TEXTS[3]);

        // With a prevTitle, the pool excludes that entry (length 3) but keeps relative order.
        const prevTitle = NUDGE_TEXTS[0].title;
        const filteredPool = NUDGE_TEXTS.filter(t => t.title !== prevTitle);
        expect(pickNudgeText(prevTitle, () => 0)).toEqual(filteredPool[0]);
    });
});
