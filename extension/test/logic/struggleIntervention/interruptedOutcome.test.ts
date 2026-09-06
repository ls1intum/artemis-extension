import { describe, expect, it, vi } from 'vitest';

import { newEpisode } from '@extension/services/struggleIntervention/slot/episode';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';

import { fakeDeps } from './helpers';

const deliveredHint = { level: 'active' as const, text: 'hint', atSessionS: 0 };
const parkedHint = { level: 'ambient' as const, text: 'hint', atSessionS: 0 };

describe('INTERRUPTED outcome persistence (#350)', () => {
    it('delivered + resetSession writes INTERRUPTED with the owning exercise id', () => {
        const setEpisodeOutcome = vi.fn(async () => ({ applied: true }));
        const svc = new StruggleInterventionService(fakeDeps({ getExerciseId: () => 99, setEpisodeOutcome }));
        svc._slot.takeDelivered(0, newEpisode(0, () => 'ep-int', 7), deliveredHint); // episode owned by exercise 7
        svc.resetSession();
        expect(setEpisodeOutcome).toHaveBeenCalledTimes(1);
        expect(setEpisodeOutcome).toHaveBeenCalledWith(7, 'ep-int', 'INTERRUPTED'); // owning 7, not current 99
    });

    it('parked + resetSession does NOT write (DISCARDED stays in-memory)', () => {
        const setEpisodeOutcome = vi.fn(async () => ({ applied: true }));
        const svc = new StruggleInterventionService(fakeDeps({ setEpisodeOutcome }));
        svc._slot.takeParked(0, newEpisode(0, () => 'ep-p', 7), parkedHint);
        svc.resetSession();
        expect(setEpisodeOutcome).not.toHaveBeenCalled();
    });

    it('delivered + onConsentRevoked does NOT write', () => {
        const setEpisodeOutcome = vi.fn(async () => ({ applied: true }));
        const svc = new StruggleInterventionService(fakeDeps({ setEpisodeOutcome }));
        svc._slot.takeDelivered(0, newEpisode(0, () => 'ep-int', 7), deliveredHint);
        svc.onConsentRevoked();
        expect(setEpisodeOutcome).not.toHaveBeenCalled();
    });

    it('delivered with unknown owning exercise does NOT write', () => {
        const setEpisodeOutcome = vi.fn(async () => ({ applied: true }));
        const svc = new StruggleInterventionService(fakeDeps({ setEpisodeOutcome }));
        svc._slot.takeDelivered(0, newEpisode(0, () => 'ep-int', undefined), deliveredHint);
        svc.resetSession();
        expect(setEpisodeOutcome).not.toHaveBeenCalled();
    });

    it('applied=false does NOT enrol a pending backfill (no backfill for INTERRUPTED)', async () => {
        const setEpisodeOutcome = vi.fn(async () => ({ applied: false }));
        const svc = new StruggleInterventionService(fakeDeps({ getExerciseId: () => 7, setEpisodeOutcome }));
        svc._slot.takeDelivered(0, newEpisode(0, () => 'ep-int', 7), deliveredHint);
        svc.resetSession();
        await Promise.resolve(); // let the write promise settle
        expect(svc._pendingOutcomes.size).toBe(0);
    });

    it('a rejecting write on reset does not throw or leak an unhandled rejection', async () => {
        const setEpisodeOutcome = vi.fn(async () => { throw new Error('network'); });
        const svc = new StruggleInterventionService(fakeDeps({ getExerciseId: () => 7, setEpisodeOutcome }));
        svc._slot.takeDelivered(0, newEpisode(0, () => 'ep-int', 7), deliveredHint);
        expect(() => svc.resetSession()).not.toThrow();
        await Promise.resolve(); // the .catch must swallow the rejection
    });
});
