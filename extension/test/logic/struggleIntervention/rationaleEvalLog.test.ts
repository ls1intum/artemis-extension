/**
 * `rationale` is the gate's own reason for a decision. It is never shown to the student; its only
 * destination is the local eval log, beside `confidence`, so an analysis can read WHY a run decided
 * as it did and not just what it decided (spec §12).
 *
 * Pinned end to end from the inbound frame, because the value crosses four hops (Pyris -> Artemis
 * event -> subscription -> orchestrator -> log) and a silently dropped optional argument at any of
 * them looks exactly like a model that produced no rationale.
 */
import { describe, expect, it, vi } from 'vitest';

import type { PendingStamp } from '@extension/services/struggleIntervention/slot/guard';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';

import { fakeDeps } from './helpers';

function recorded(deps: ReturnType<typeof fakeDeps>) {
    return (deps.log.record as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([e]) => e);
}

describe('rationale reaches the eval log', () => {
    it('an active decide records the reason next to the confidence', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        const gen = svc._slot.generation();
        const stamp: PendingStamp = { episodeId: 'ep-r', generation: gen, hardEvent: true, requestToken: 'tok' };
        const localToken = svc._guard.issue('decide', stamp);
        svc._inFlightMarker = { requestToken: 'tok', episodeId: 'ep-r', generation: gen, intent: 'decide', localToken };
        svc._candidate = { episodeId: 'ep-r', hints: [], createdAtMs: 0 };

        svc.onServerActive('ep-r', 1, undefined, undefined, undefined, 0.91, 'hint text', 42, 'compile error still present at the anchor');
        await Promise.resolve();

        const entry = recorded(deps).find(e => e.finalAction === 'active');
        expect(entry).toBeDefined();
        expect(entry.confidence).toBe(0.91);
        expect(entry.rationale).toBe('compile error still present at the anchor');
    });

    it('a run with no rationale records none rather than an empty string', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        const gen = svc._slot.generation();
        const stamp: PendingStamp = { episodeId: 'ep-n', generation: gen, hardEvent: true, requestToken: 'tok' };
        const localToken = svc._guard.issue('decide', stamp);
        svc._inFlightMarker = { requestToken: 'tok', episodeId: 'ep-n', generation: gen, intent: 'decide', localToken };
        svc._candidate = { episodeId: 'ep-n', hints: [], createdAtMs: 0 };

        svc.onServerActive('ep-n', 1, undefined, undefined, undefined, 0.7, 'hint text', 43);
        await Promise.resolve();

        const entry = recorded(deps).find(e => e.finalAction === 'active');
        expect(entry).toBeDefined();
        expect(entry.rationale).toBeUndefined();
    });

    it('a silent decide records its own row, with the reason it stayed quiet', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        const gen = svc._slot.generation();
        const stamp: PendingStamp = { episodeId: 'ep-s', generation: gen, hardEvent: true, requestToken: 'tok' };
        const localToken = svc._guard.issue('decide', stamp);
        svc._inFlightMarker = { requestToken: 'tok', episodeId: 'ep-s', generation: gen, intent: 'decide', localToken };
        svc._candidate = { episodeId: 'ep-s', hints: [], createdAtMs: 0 };

        svc.onServerSilent('ep-s', undefined, 0.42, 'the earlier hint already says this');
        await Promise.resolve();

        const rows = recorded(deps).filter(e => e.finalAction === 'silent' && e.source === 'server');
        expect(rows).toHaveLength(1);
        expect(rows[0].confidence).toBe(0.42);
        expect(rows[0].rationale).toBe('the earlier hint already says this');
    });

    it('an uncorrelated silent frame records nothing', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        const gen = svc._slot.generation();
        const stamp: PendingStamp = { episodeId: 'ep-live', generation: gen, hardEvent: true, requestToken: 'tok' };
        const localToken = svc._guard.issue('decide', stamp);
        svc._inFlightMarker = { requestToken: 'tok', episodeId: 'ep-live', generation: gen, intent: 'decide', localToken };

        // A late reply for a superseded episode must not pollute the eval log.
        svc.onServerSilent('ep-stale', undefined, 0.9, 'should never be recorded');
        await Promise.resolve();

        expect(recorded(deps).filter(e => e.finalAction === 'silent' && e.source === 'server')).toHaveLength(0);
    });
});
