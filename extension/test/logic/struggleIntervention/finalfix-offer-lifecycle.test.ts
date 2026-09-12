import { describe, expect, it } from 'vitest';

import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';

import { fakeDeps, simulateDelivered } from './helpers';

describe('final-fix: outstanding-offer lifecycle + help_request egress gates', () => {
    it('resolves and clears an outstanding stuck offer when the episode terminates (dismiss)', () => {
        const deps = fakeDeps({ getProactiveLevel: () => 'more' });
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-1');
        svc._outstandingOffer = { offerId: 'off-1', episodeId: 'ep-1', moment: 'stuck' };
        svc.dismissEpisode('ep-1');
        expect(svc._outstandingOffer).toBeUndefined();
        expect(deps.resolveOfferBubble).toHaveBeenCalledWith('off-1', 'timeout');
    });

    it('does NOT POST a help_request when .noai is set at click time; posts an honest note', async () => {
        const deps = fakeDeps({ hasNoaiMarker: () => true });
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-1');
        await svc._sendHelpRequest();
        expect(deps.postIntervention).not.toHaveBeenCalled();
        expect(deps.postBubble).toHaveBeenCalledWith('Nothing more I can add right now.', null, 'ep-1');
    });
});
