/**
 * C8: dismissEpisode - episode-scoped slot resolution.
 */
import { describe, expect, it, vi } from 'vitest';

import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';

import { fakeDeps, simulateDelivered } from './helpers';

describe('C8: dismissEpisode', () => {
    it('frees the slot (generation bumps), writes DISMISSED, tears down runtime, folds without praise', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-dismiss');
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
        const genBefore = svc._slot.generation();

        svc.dismissEpisode('ep-dismiss');

        expect(svc._slot.snapshot().state.kind).toBe('free');
        expect(svc._slot.generation()).toBeGreaterThan(genBefore);
        await Promise.resolve();
        expect(deps.setEpisodeOutcome).toHaveBeenCalledWith(42, 'ep-dismiss', 'DISMISSED');
        expect(deps.foldEpisode).toHaveBeenCalledWith('ep-dismiss', 'DISMISSED');
        // No praise: index 2 is the optional praise arg and stays absent (index 1 is the outcome).
        const foldCall = (deps.foldEpisode as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(foldCall[2]).toBeUndefined();
    });

    it('_clearEpisodeRuntime: watchdog disarmed and owed-close cleared', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-clear');

        svc._owedConfirmClose = { confirmReason: 'progress' };
        // Watchdog was armed by simulateDelivered (via onServerActive take-delivered path)
        expect(svc._watchdog).toBeDefined();

        svc.dismissEpisode('ep-clear');

        expect(svc._owedConfirmClose).toBeUndefined();
        // Watchdog is disarmed and set to undefined by _clearEpisodeRuntime
        expect(svc._watchdog).toBeUndefined();
    });

    it('dismissEpisode called with no arg resolves the current delivered slot episode', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-noid');
        expect(svc._slot.snapshot().state.kind).toBe('delivered');

        svc.dismissEpisode(); // no arg - should resolve live episode

        expect(svc._slot.snapshot().state.kind).toBe('free');
        await Promise.resolve();
        expect(deps.setEpisodeOutcome).toHaveBeenCalledWith(42, 'ep-noid', 'DISMISSED');
        expect(deps.foldEpisode).toHaveBeenCalledWith('ep-noid', 'DISMISSED');
    });

    it('double-dismiss (slot already free): safe no-op for slot, outcome write still fires (idempotent)', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-double');

        svc.dismissEpisode('ep-double'); // first dismiss
        await Promise.resolve();
        expect(svc._slot.snapshot().state.kind).toBe('free');

        const callCountAfterFirst = (deps.setEpisodeOutcome as ReturnType<typeof vi.fn>).mock.calls.length;
        const foldCallsAfterFirst = (deps.foldEpisode as ReturnType<typeof vi.fn>).mock.calls.length;

        svc.dismissEpisode('ep-double'); // second dismiss (double)
        await Promise.resolve();

        // Outcome write fires again (A10 first-terminal-wins handles idempotency server-side)
        expect((deps.setEpisodeOutcome as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCountAfterFirst + 1);
        // foldEpisode does NOT fire again (slot was already free, so shouldFreeSlot is false)
        expect((deps.foldEpisode as ReturnType<typeof vi.fn>).mock.calls.length).toBe(foldCallsAfterFirst);
    });

    it('dismiss when slot is FREE and no episodeId passed: safe total no-op', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        // slot starts FREE

        svc.dismissEpisode(); // no arg, slot free

        expect(deps.setEpisodeOutcome).not.toHaveBeenCalled();
        expect(deps.foldEpisode).not.toHaveBeenCalled();
    });

    it('episodeId mismatch: writes outcome for passed id but does NOT free slot or fold', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-live');
        expect(svc._slot.snapshot().state.kind).toBe('delivered');

        svc.dismissEpisode('ep-stale-different'); // different from live 'ep-live'

        expect(svc._slot.snapshot().state.kind).toBe('delivered');
        await Promise.resolve();
        // Outcome write for the passed id (safe back-fill)
        expect(deps.setEpisodeOutcome).toHaveBeenCalledWith(42, 'ep-stale-different', 'DISMISSED');
        // foldEpisode must NOT be called (could collapse the wrong episode)
        expect(deps.foldEpisode).not.toHaveBeenCalled();
    });

});
