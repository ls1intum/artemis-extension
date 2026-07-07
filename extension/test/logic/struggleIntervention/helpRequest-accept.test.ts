import { describe, expect, it } from 'vitest';

import type { PendingStamp } from '@extension/services/struggleIntervention/slot/guard';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';

import { fakeDeps } from './helpers';

describe('help_request local intent', () => {
    it('_acceptHelpRequest returns the stamp and clears the marker on a matching reply', () => {
        const svc = new StruggleInterventionService(fakeDeps());
        const gen = svc._slot.generation();
        const stamp: PendingStamp = { episodeId: 'ep-1', generation: gen, hardEvent: false, requestToken: 'tok' };
        const localToken = svc._guard.issue('help_request', stamp);
        svc._inFlightMarker = { requestToken: 'tok', episodeId: 'ep-1', generation: gen, intent: 'help_request', localToken };

        expect(svc._acceptHelpRequest()).not.toBeNull();
        expect(svc._inFlightMarker).toBeUndefined();
    });

    it('_acceptHelpRequest returns null when the marker is a decide', () => {
        const svc = new StruggleInterventionService(fakeDeps());
        const gen = svc._slot.generation();
        const stamp: PendingStamp = { episodeId: 'ep-1', generation: gen, hardEvent: false, requestToken: 'tok' };
        const localToken = svc._guard.issue('decide', stamp);
        svc._inFlightMarker = { requestToken: 'tok', episodeId: 'ep-1', generation: gen, intent: 'decide', localToken };
        expect(svc._acceptHelpRequest()).toBeNull();
    });
});
