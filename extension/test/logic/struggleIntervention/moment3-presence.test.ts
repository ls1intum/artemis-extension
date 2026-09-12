import { describe, expect, it } from 'vitest';

import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';

import { fakeDeps, simulateDelivered } from './helpers';

describe('Moment-3 answers', () => {
    it('needMoreHelp posts a help_request even when the cap is exhausted, and resolves the bubble', async () => {
        // Establish the delivered episode under the default (more) level first: simulateDelivered
        // drives a real onServerActive call, which itself honors the Less reroute, so flipping the
        // mock to 'less' beforehand would park the episode instead of delivering it (see the same
        // idiom in helpRequest-delivery.test.ts). The scenario under test is a Less-level student
        // with an exhausted cap on an ALREADY-delivered episode.
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-1');
        deps.getProactiveLevel = () => 'less';
        svc._offeredHintCounts.set('ep-1', 1);   // Less cap reached
        svc._outstandingOffer = { offerId: 'off-1', episodeId: 'ep-1', moment: 'abandon' };
        svc.needMoreHelp('off-1', 'ep-1');
        await Promise.resolve();
        expect(deps.resolveOfferBubble).toHaveBeenCalledWith('off-1', 'accept');
        expect(deps.postIntervention).toHaveBeenCalledWith(42, expect.objectContaining({ intent: 'help_request' }));
        expect(svc._outstandingOffer).toBeUndefined();
    });
});
