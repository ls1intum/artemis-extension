/**
 * The Pyris hint ladder derives which rung it is answering at from `episode.hints.length`
 * on the help_request payload (struggle_help_request_system_prompt.j2: prior >= 2 -> the
 * rung-3 ceiling). That makes the count load-bearing for the non-spoiler guarantee, so it
 * is pinned here on both sides: what the slot counts, and what actually goes on the wire.
 *
 * The count is every hint DELIVERED for the episode, not only the ones the student asked
 * for -- an unsolicited ambient->active escalation appends one too. Miscounting it down
 * would let the gate climb past the ceiling; miscounting it up would strand a student at
 * rung 3 early.
 */
import { describe, expect, it, vi } from 'vitest';

import type { PendingStamp } from '@extension/services/struggleIntervention/slot/guard';
import { SlotManager } from '@extension/services/struggleIntervention/slot/slotManager';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';

import { fakeDeps, simulateDelivered } from './helpers';

const hint = (text: string, level: 'ambient' | 'active') => ({ level, text, atSessionS: 0 });

/** The hints array as the help_request POST carried it, per call. */
function postedHintCounts(postIntervention: ReturnType<typeof vi.fn>): number[] {
    return postIntervention.mock.calls
        .filter(([, body]) => body.intent === 'help_request')
        .map(([, body]) => body.episode.hints.length);
}

describe('hint-ladder rung count', () => {
    it('an unsolicited escalation counts toward the rung, exactly like a requested follow-up', () => {
        const slot = new SlotManager();
        const episode = { episodeId: 'ep-1', isNew: true, hints: [], createdAtMs: 0 };

        slot.takeDelivered(0, episode, hint('opening', 'ambient'));
        expect(slot.snapshot().state).toMatchObject({ kind: 'delivered', level: 'ambient' });
        expect((slot.snapshot().state as { episode: { hints: unknown[] } }).episode.hints).toHaveLength(1);

        // Nobody asked for this one: the engine raised the level on its own.
        slot.escalate(hint('escalated', 'active'));
        expect((slot.snapshot().state as { episode: { hints: unknown[] } }).episode.hints).toHaveLength(2);

        slot.appendFollowup(hint('requested follow-up', 'active'));
        const hints = (slot.snapshot().state as { episode: { hints: { text: string }[] } }).episode.hints;
        expect(hints.map(h => h.text)).toEqual(['opening', 'escalated', 'requested follow-up']);
    });

    it('the help_request POST carries every delivered hint, so Pyris sees the real rung', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-ladder');

        // First request: only the opening hint exists -> Pyris computes rung 2.
        await svc._sendHelpRequest();
        expect(postedHintCounts(deps.postIntervention as ReturnType<typeof vi.fn>)).toEqual([1]);

        // The server answers; the follow-up is appended to the same episode.
        const gen = svc._slot.generation();
        const stamp: PendingStamp = { episodeId: 'ep-ladder', generation: gen, hardEvent: false, requestToken: 'tok-2' };
        const localToken = svc._guard.issue('help_request', stamp);
        svc._inFlightMarker = { requestToken: 'tok-2', episodeId: 'ep-ladder', generation: gen, intent: 'help_request', localToken };
        svc.onServerActive('ep-ladder', 1, undefined, undefined, undefined, 0.9, 'follow-up', 201);
        await Promise.resolve();
        await Promise.resolve();

        // Second request now reports two delivered hints -> Pyris clamps to the rung-3 ceiling.
        await svc._sendHelpRequest();
        expect(postedHintCounts(deps.postIntervention as ReturnType<typeof vi.fn>)).toEqual([1, 2]);
    });
});
