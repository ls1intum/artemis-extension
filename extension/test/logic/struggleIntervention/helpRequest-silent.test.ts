import { describe, expect, it } from 'vitest';

import type { PendingStamp } from '@extension/services/struggleIntervention/slot/guard';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';

import { fakeDeps, simulateDelivered } from './helpers';

describe('help_request silent completion', () => {
    it('clears the in-flight help_request marker and posts an honest note (no cap consumed)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-hr');
        const gen = svc._slot.generation();
        const stamp: PendingStamp = { episodeId: 'ep-hr', generation: gen, hardEvent: false, requestToken: 'tok' };
        const localToken = svc._guard.issue('help_request', stamp);
        svc._inFlightMarker = { requestToken: 'tok', episodeId: 'ep-hr', generation: gen, intent: 'help_request', localToken };

        svc.onServerSilent('ep-hr', undefined);

        expect(svc._inFlightMarker).toBeUndefined();
        expect(deps.postBubble).toHaveBeenCalledWith('Nothing more I can add right now.', null, 'ep-hr');
        expect(svc._offeredHintCounts.get('ep-hr') ?? 0).toBe(0);
    });
});
