import { describe, expect, it, vi } from 'vitest';

import type { AlertRecord } from '@extension/services/struggle/types';
import type { PendingStamp } from '@extension/services/struggleIntervention/slot/guard';
import { StaleWatchdog } from '@extension/services/struggleIntervention/slot/staleWatchdog';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';

import { fakeDeps, simulateDelivered } from './helpers';

// A Less + chat-closed offer is unanswerable (badge-only strands the slot), so
// _raiseStuckOffer / _raiseAbandonOffer stay fully quiet.
describe('Final-fix wave 2 minor #3: Less + chat-closed stays fully quiet', () => {
    it('a Moment-1 stuck-offer trigger raises nothing (no outstanding offer, no bubble/banner/badge)', async () => {
        const deps = fakeDeps();   // default level 'more', so simulateDelivered really delivers (no Pull re-route)
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-1');
        expect(svc._slot.snapshot().inSession).toBe(false);   // chat closed (default)

        // Now switch the student to Less for the scenario under test (established idiom: flipping
        // the level before simulateDelivered would have re-routed the delivery itself into PARKED).
        deps.getProactiveLevel = () => 'less';
        vi.mocked(deps.setBadge).mockClear();
        vi.mocked(deps.postOfferBubble).mockClear();
        vi.mocked(deps.showOfferBanner).mockClear();

        const stuckAlert: AlertRecord = {
            kind: 'edit', t: 610, ts: 610_000, urgency: 0.9,
            typesPreGate: ['STATE'], types: ['STATE'], primary: 'STATE', path: 'e6', inWarmup: false, inGrace: false,
        };
        svc.deliver(stuckAlert);
        await new Promise((r) => setTimeout(r, 0));

        expect(svc._outstandingOffer).toBeUndefined();
        expect(deps.postOfferBubble).not.toHaveBeenCalled();
        expect(deps.showOfferBanner).not.toHaveBeenCalled();
        expect(deps.setBadge).not.toHaveBeenCalled();
    });

    it('a Moment-3 presence-check trigger raises nothing (no outstanding offer, no bubble/banner/badge)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-1');
        expect(svc._slot.snapshot().inSession).toBe(false);

        deps.getProactiveLevel = () => 'less';
        vi.mocked(deps.setBadge).mockClear();
        vi.mocked(deps.postOfferBubble).mockClear();
        vi.mocked(deps.showOfferBanner).mockClear();

        // Overwrite the auto-armed watchdog with one that fires pre-abandon-warn immediately.
        svc._watchdog = new StaleWatchdog({ idleAbandonMs: 1000, warnLeadMs: 1000 });
        svc._watchdog!.arm(Date.now(), false);

        svc['_handleWatchdogTick'](Date.now());

        expect(svc._outstandingOffer).toBeUndefined();
        expect(deps.postOfferBubble).not.toHaveBeenCalled();
        expect(deps.showOfferBanner).not.toHaveBeenCalled();
        expect(deps.setBadge).not.toHaveBeenCalled();
    });
});

// An accept must not be dropped silently when a concurrent decide is in flight:
// acceptOffer / needMoreHelp bail BEFORE consuming the offer.
describe('Final-fix wave 2 minor #5: accept bails (leaves the offer outstanding) while a decide is in flight', () => {
    function armConcurrentDecide(svc: StruggleInterventionService, episodeId: string, requestToken: string): void {
        const gen = svc._slot.generation();
        const stamp: PendingStamp = { episodeId, generation: gen, hardEvent: true, requestToken };
        const localToken = svc._guard.issue('decide', stamp);
        svc._inFlightMarker = { requestToken, episodeId, generation: gen, intent: 'decide', localToken };
    }

    it('acceptOffer bails, leaving the offer outstanding, when a decide is in flight', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-1');
        svc._outstandingOffer = { offerId: 'off-1', episodeId: 'ep-1', moment: 'stuck' };
        armConcurrentDecide(svc, 'ep-1', 'tok-concurrent-1');

        svc.acceptOffer('off-1', 'ep-1');

        expect(deps.postIntervention).not.toHaveBeenCalled();
        expect(deps.resolveOfferBubble).not.toHaveBeenCalled();
        expect(svc._outstandingOffer).toEqual({ offerId: 'off-1', episodeId: 'ep-1', moment: 'stuck' });
    });

    it('needMoreHelp resets the idle clock (student is present) but still bails on the accept when a decide is in flight', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-1');
        expect(svc._watchdog).toBeDefined();
        const resetSpy = vi.spyOn(svc._watchdog!, 'resetProgress');

        svc._outstandingOffer = { offerId: 'off-2', episodeId: 'ep-1', moment: 'abandon' };
        armConcurrentDecide(svc, 'ep-1', 'tok-concurrent-2');

        svc.needMoreHelp('off-2', 'ep-1');

        expect(resetSpy).toHaveBeenCalledTimes(1);
        expect(deps.postIntervention).not.toHaveBeenCalled();
        expect(deps.resolveOfferBubble).not.toHaveBeenCalled();
        expect(svc._outstandingOffer).toEqual({ offerId: 'off-2', episodeId: 'ep-1', moment: 'abandon' });
    });
});
