import { describe, expect, it } from 'vitest';

import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';

import { fakeDeps, simulateDelivered } from './helpers';

describe('Moment-1 offer', () => {
    it('_canOfferStuck respects the More cap (3) and a decline (Less cap 1)', () => {
        const more = new StruggleInterventionService(fakeDeps({ getProactiveLevel: () => 'more' }));
        more._offeredHintCounts.set('ep-1', 3);
        expect(more._canOfferStuck('ep-1')).toBe(false);
        more._offeredHintCounts.set('ep-1', 2);
        expect(more._canOfferStuck('ep-1')).toBe(true);
    });

    it('acceptOffer fires only for the outstanding offer on the live episode, and resolves the bubble', async () => {
        const deps = fakeDeps({ getProactiveLevel: () => 'more' });
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-1');
        svc._outstandingOffer = { offerId: 'off-1', episodeId: 'ep-1', moment: 'stuck' };

        svc.acceptOffer('WRONG', 'ep-1');
        expect(deps.postIntervention).not.toHaveBeenCalled();

        svc.acceptOffer('off-1', 'ep-1');
        await Promise.resolve();
        expect(deps.resolveOfferBubble).toHaveBeenCalledWith('off-1', 'accept');
        expect(deps.postIntervention).toHaveBeenCalledWith(42, expect.objectContaining({ intent: 'help_request' }));
        expect(svc._outstandingOffer).toBeUndefined();
    });
});
