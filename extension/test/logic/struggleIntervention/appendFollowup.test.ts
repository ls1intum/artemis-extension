import { describe, expect, it } from 'vitest';

import { SlotManager } from '@extension/services/struggleIntervention/slot/slotManager';
import { newEpisode } from '@extension/services/struggleIntervention/slot/episode';

function delivered(sm: SlotManager): void {
    const ep = newEpisode(0, () => 'ep-1');
    sm.takeDelivered(0, ep, { level: 'active', text: 'first', atSessionS: 1 });
}

describe('SlotManager.appendFollowup', () => {
    it('appends a follow-up hint to the same delivered episode and bumps generation', () => {
        const sm = new SlotManager();
        delivered(sm);
        const genBefore = sm.generation();
        const snap = sm.appendFollowup({ level: 'active', text: 'next step', atSessionS: 5 });
        expect(snap.state.kind).toBe('delivered');
        const st = snap.state as Extract<typeof snap.state, { kind: 'delivered' }>;
        expect(st.episode.hints.map(h => h.text)).toEqual(['first', 'next step']);
        expect(sm.generation()).toBeGreaterThan(genBefore);
    });

    it('throws when the slot is not delivered', () => {
        expect(() => new SlotManager().appendFollowup({ level: 'active', text: 'x', atSessionS: 1 })).toThrow();
    });
});
