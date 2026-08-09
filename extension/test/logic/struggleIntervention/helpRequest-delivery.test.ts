import { describe, expect, it } from 'vitest';

import type { PendingStamp } from '@extension/services/struggleIntervention/slot/guard';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';

import { fakeDeps, simulateDelivered } from './helpers';

describe('help_request delivery', () => {
    it('an active reply to an in-flight help_request appends to the open episode and posts a bubble, even in Less', async () => {
        // Establish the delivered episode under the default (more) level first: simulateDelivered
        // drives a real onServerActive call, which itself honors the Less reroute, so flipping the
        // mock to 'less' beforehand would park the episode instead of delivering it. The scenario
        // under test is a Less-mode follow-up reply to an ALREADY-open episode, so the level only
        // needs to read 'less' once the help_request marker is in flight.
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-hr');
        deps.getProactiveLevel = () => 'less';
        const gen = svc._slot.generation();
        const stamp: PendingStamp = { episodeId: 'ep-hr', generation: gen, hardEvent: false, requestToken: 'tok' };
        const localToken = svc._guard.issue('help_request', stamp);
        svc._inFlightMarker = { requestToken: 'tok', episodeId: 'ep-hr', generation: gen, intent: 'help_request', localToken };

        svc.onServerActive('ep-hr', 1, undefined, undefined, undefined, 0.9, 'next concrete step', 200);
        // The active surface navigates before posting the bubble, so let that settle.
        await Promise.resolve();
        await Promise.resolve();

        expect(deps.postBubble).toHaveBeenCalledWith('next concrete step', 200, 'ep-hr');
        const st = svc._slot.snapshot().state as Extract<ReturnType<typeof svc._slot.snapshot>['state'], { kind: 'delivered' }>;
        expect(st.episode.hints.map(h => h.text)).toContain('next concrete step');
        expect(svc._offeredHintCounts.get('ep-hr')).toBe(1);
    });
});
