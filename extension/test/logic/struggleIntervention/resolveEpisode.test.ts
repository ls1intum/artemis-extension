/**
 * Manual "Solved it" close: the chat-card positive action records RECOVERED (mirrors dismissEpisode,
 * which records DISMISSED). Both share the _manualCloseEpisode path.
 */
import { describe, expect, it, vi } from 'vitest';

import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';

import { fakeDeps, simulateDelivered } from './helpers';

describe('resolveEpisode (manual "Solved it" → RECOVERED)', () => {
    it('frees the slot, writes RECOVERED, tears down runtime, folds RECOVERED without praise', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-solved');
        expect(svc._slot.snapshot().state.kind).toBe('delivered');

        svc.resolveEpisode('ep-solved');

        expect(svc._slot.snapshot().state.kind).toBe('free');
        await Promise.resolve();
        expect(deps.setEpisodeOutcome).toHaveBeenCalledWith(42, 'ep-solved', 'RECOVERED');
        expect(deps.foldEpisode).toHaveBeenCalledWith('ep-solved', 'RECOVERED');
        // No praise: manual "Solved it" carries no LLM praise message (third fold arg absent).
        const foldCall = (deps.foldEpisode as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(foldCall[2]).toBeUndefined();
    });

    it('no arg resolves the current delivered slot episode as RECOVERED', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-noid');

        svc.resolveEpisode();

        expect(svc._slot.snapshot().state.kind).toBe('free');
        await Promise.resolve();
        expect(deps.setEpisodeOutcome).toHaveBeenCalledWith(42, 'ep-noid', 'RECOVERED');
        expect(deps.foldEpisode).toHaveBeenCalledWith('ep-noid', 'RECOVERED');
    });
});
