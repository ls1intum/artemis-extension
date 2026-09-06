import { describe, expect, it, vi } from 'vitest';

import { StaleWatchdog } from '@extension/services/struggleIntervention/slot/staleWatchdog';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';

import { fakeDeps, simulateDelivered } from './helpers';

// A non-accepted help_request POST must give an honest note, not leave the student with
// "accepted, no hint" (the offer already resolved to 'accept').
describe('Fix B: honest note on a non-accepted help_request POST', () => {
    it('posts the honest note and clears the in-flight marker when postIntervention resolves non-accepted', async () => {
        const deps = fakeDeps({ postIntervention: vi.fn().mockResolvedValue('failed') });
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-1');

        await svc._sendHelpRequest();

        expect(deps.postBubble).toHaveBeenCalledWith('Nothing more I can add right now.', null, 'ep-1');
        expect(svc._inFlightMarker).toBeUndefined();
    });

    it('does NOT post the fallback note if the episode terminated (marker changed) while the POST was pending', async () => {
        let svc!: StruggleInterventionService;
        const deps = fakeDeps({
            postIntervention: vi.fn().mockImplementation(async () => {
                // Simulate the episode terminating mid-POST: _clearEpisodeRuntime clears the in-flight marker.
                svc._inFlightMarker = undefined;
                return 'failed';
            }),
        });
        svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-1');

        await svc._sendHelpRequest();

        // The request is no longer the live one, so the fallback note must NOT post -- it could land on a
        // different/absent episode. (simulateDelivered posts the opening hint bubble, so assert only that the
        // fallback note specifically was never posted.)
        expect(deps.postBubble).not.toHaveBeenCalledWith('Nothing more I can add right now.', null, expect.anything());
    });
});

// Turning proactive Off mid-episode must clear an outstanding offer AND suppress the
// Moment-3 "Still on this?" presence check.
describe('Fix C: opt-out (proactive Off) tears down an outstanding offer and suppresses Moment-3', () => {
    it('setStudentProactive(exerciseId, false) resolves + clears an outstanding offer', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-1');
        svc._outstandingOffer = { offerId: 'off-1', episodeId: 'ep-1', moment: 'stuck' };

        svc.setStudentProactive(42, false);

        expect(deps.resolveOfferBubble).toHaveBeenCalledWith('off-1', 'timeout');
        expect(svc._outstandingOffer).toBeUndefined();
    });

    it('a pre-abandon-warn tick raises no Moment-3 offer once the level is off', () => {
        const deps = fakeDeps();   // default level 'more', so simulateDelivered really delivers (no Pull re-route)
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-1');

        // Flip to off AFTER delivery is established (flipping beforehand would change the
        // delivery routing itself, per the established idiom in moment3-presence.test.ts).
        deps.getProactiveLevel = () => 'off';
        vi.mocked(deps.postOfferBubble).mockClear();
        vi.mocked(deps.showOfferBanner).mockClear();
        vi.mocked(deps.setBadge).mockClear();

        // Overwrite the auto-armed watchdog with one that fires pre-abandon-warn immediately.
        svc._watchdog = new StaleWatchdog({ idleAbandonMs: 1000, warnLeadMs: 1000 });
        svc._watchdog.arm(Date.now(), false);

        svc['_handleWatchdogTick'](Date.now());

        expect(svc._outstandingOffer).toBeUndefined();
        expect(deps.postOfferBubble).not.toHaveBeenCalled();
        expect(deps.showOfferBanner).not.toHaveBeenCalled();
        expect(deps.setBadge).not.toHaveBeenCalled();
    });
});

// An ignored in-session stuck offer (no countdown) must not block the more-urgent
// Moment-3 presence check; it is superseded instead.
describe('Fix A: pre-abandon-warn supersedes a stale stuck offer', () => {
    it('resolves the stale stuck offer as timeout and raises a fresh abandon offer', () => {
        const deps = fakeDeps();   // default level 'more', in-session offers allowed
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-1');
        svc._outstandingOffer = { offerId: 'stuck-1', episodeId: 'ep-1', moment: 'stuck' };

        svc._watchdog = new StaleWatchdog({ idleAbandonMs: 1000, warnLeadMs: 1000 });
        svc._watchdog.arm(Date.now(), false);

        svc['_handleWatchdogTick'](Date.now());

        expect(deps.resolveOfferBubble).toHaveBeenCalledWith('stuck-1', 'timeout');
        expect(svc._outstandingOffer).toBeDefined();
        expect(svc._outstandingOffer?.moment).toBe('abandon');
    });
});
