import { describe, expect, it } from 'vitest';

import { newEpisode } from '@extension/services/struggleIntervention/slot/episode';
import type { Decision } from '@extension/services/struggleIntervention/slot/reconcile';
import { reconcile } from '@extension/services/struggleIntervention/slot/reconcile';
import type { SlotState } from '@extension/services/struggleIntervention/slot/slotManager';

let counter = 0;
const idgen = () => `ep-${++counter}`;
const ep = () => newEpisode(0, idgen);

const FREE: SlotState = { kind: 'free' };

const PARKED = (): SlotState => ({
    kind: 'parked',
    episode: ep(),
    level: 'ambient',
    frozenText: 'old text',
    generation: 1,
});

const DELIVERED_AMBIENT = (): SlotState => ({
    kind: 'delivered',
    episode: ep(),
    level: 'ambient',
    generation: 1,
});

const DELIVERED_ACTIVE = (): SlotState => ({
    kind: 'delivered',
    episode: ep(),
    level: 'active',
    generation: 1,
});

const decision = (action: Decision['action'], hardEvent = false, text: string | null = 'hint text'): Decision => ({
    action,
    hardEvent,
    text,
});

// Covers the §6 reconcile matrix.
describe('reconcile', () => {
    it('FREE + silent -> suppress', () => {
        expect(reconcile(FREE, decision('silent'))).toEqual({ kind: 'suppress' });
    });

    it('FREE + ambient -> take-parked (carries text)', () => {
        const result = reconcile(FREE, decision('ambient', false, 'hello'));
        expect(result).toEqual({ kind: 'take-parked', text: 'hello' });
    });

    it('FREE + active -> take-delivered (carries text)', () => {
        const result = reconcile(FREE, decision('active', false, 'world'));
        expect(result).toEqual({ kind: 'take-delivered', text: 'world' });
    });

    it('PARKED + silent -> discard-free (no text)', () => {
        expect(reconcile(PARKED(), decision('silent'))).toEqual({ kind: 'discard-free' });
    });

    it('PARKED + ambient -> replace-parked (new episode stays hidden, carries text)', () => {
        const result = reconcile(PARKED(), decision('ambient', false, 'new ambient'));
        expect(result).toEqual({ kind: 'replace-parked', text: 'new ambient' });
    });

    it('PARKED + active -> replace-delivered (fresh first delivery, NOT escalate, NOT replace-parked)', () => {
        const result = reconcile(PARKED(), decision('active', true, 'fresh active'));
        expect(result).toEqual({ kind: 'replace-delivered', text: 'fresh active' });
    });

    it('PARKED + active without hardEvent -> replace-delivered (hardEvent irrelevant here)', () => {
        const result = reconcile(PARKED(), decision('active', false, 'also active'));
        expect(result).toEqual({ kind: 'replace-delivered', text: 'also active' });
    });

    it('DELIVERED(ambient) + active + hardEvent -> escalate', () => {
        expect(reconcile(DELIVERED_AMBIENT(), decision('active', true))).toEqual({ kind: 'escalate' });
    });

    it('DELIVERED(ambient) + active but NOT hardEvent -> suppress (no escalation without hardEvent)', () => {
        expect(reconcile(DELIVERED_AMBIENT(), decision('active', false))).toEqual({ kind: 'suppress' });
    });

    it('DELIVERED(active) + active + hardEvent -> suppress (slot already at active level)', () => {
        expect(reconcile(DELIVERED_ACTIVE(), decision('active', true))).toEqual({ kind: 'suppress' });
    });

    it('DELIVERED(ambient) + ambient -> suppress (no auto-deepen)', () => {
        expect(reconcile(DELIVERED_AMBIENT(), decision('ambient'))).toEqual({ kind: 'suppress' });
    });

    it('DELIVERED(ambient) + silent -> suppress', () => {
        expect(reconcile(DELIVERED_AMBIENT(), decision('silent'))).toEqual({ kind: 'suppress' });
    });

    it('DELIVERED(active) + ambient -> suppress (softer, downgrade)', () => {
        expect(reconcile(DELIVERED_ACTIVE(), decision('ambient'))).toEqual({ kind: 'suppress' });
    });

    it('DELIVERED(active) + silent -> suppress', () => {
        expect(reconcile(DELIVERED_ACTIVE(), decision('silent'))).toEqual({ kind: 'suppress' });
    });

    it('DELIVERED(active) + active without hardEvent -> suppress', () => {
        expect(reconcile(DELIVERED_ACTIVE(), decision('active', false))).toEqual({ kind: 'suppress' });
    });
});
