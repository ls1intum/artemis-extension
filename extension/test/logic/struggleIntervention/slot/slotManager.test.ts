import { beforeEach, describe, expect, it } from 'vitest';

import type { EpisodeHint } from '@extension/services/struggleIntervention/slot/episode';
import { newEpisode } from '@extension/services/struggleIntervention/slot/episode';
import { SlotManager } from '@extension/services/struggleIntervention/slot/slotManager';

const NOW = 1_000;
let counter = 0;
const idgen = () => `ep-${++counter}`;

const makeEp = () => newEpisode(NOW, idgen);
const makeHint = (level: 'ambient' | 'active' = 'ambient', text = 'some hint'): EpisodeHint => ({
    level,
    text,
    atSessionS: 0,
});

beforeEach(() => {
    counter = 0;
});

describe('SlotManager', () => {
    describe('initial state', () => {
        it('starts free with generation 0 and inSession false', () => {
            const sm = new SlotManager();
            const snap = sm.snapshot();
            expect(snap.state.kind).toBe('free');
            expect(snap.generation).toBe(0);
            expect(snap.inSession).toBe(false);
            expect(sm.isFree()).toBe(true);
            expect(sm.generation()).toBe(0);
        });
    });

    describe('takeParked', () => {
        it('transitions FREE -> PARKED, stores episode + hint, bumps generation by 1', () => {
            const sm = new SlotManager();
            const ep = makeEp();
            const hint = makeHint('ambient', 'ambient text');

            const snap = sm.takeParked(NOW, ep, hint);

            expect(snap.state.kind).toBe('parked');
            expect(snap.generation).toBe(1);
            expect(sm.generation()).toBe(1);
            if (snap.state.kind === 'parked') {
                expect(snap.state.episode.episodeId).toBe(ep.episodeId);
                expect(snap.state.episode.hints).toHaveLength(1);
                expect(snap.state.episode.hints[0]).toEqual(hint);
                expect(snap.state.frozenText).toBe(hint.text);
                expect(snap.state.level).toBe('ambient');
                expect(snap.state.generation).toBe(1);
            }
        });

        it('throws when slot is already PARKED', () => {
            const sm = new SlotManager();
            sm.takeParked(NOW, makeEp(), makeHint());
            expect(() => sm.takeParked(NOW, makeEp(), makeHint())).toThrow();
        });

        it('throws when slot is DELIVERED', () => {
            const sm = new SlotManager();
            sm.takeDelivered(NOW, makeEp(), makeHint('active'));
            expect(() => sm.takeParked(NOW, makeEp(), makeHint())).toThrow();
        });
    });

    describe('takeDelivered', () => {
        it('transitions FREE -> DELIVERED, stores episode + hint, bumps generation by 1', () => {
            const sm = new SlotManager();
            const ep = makeEp();
            const hint = makeHint('active', 'active text');

            const snap = sm.takeDelivered(NOW, ep, hint);

            expect(snap.state.kind).toBe('delivered');
            expect(snap.generation).toBe(1);
            if (snap.state.kind === 'delivered') {
                expect(snap.state.episode.episodeId).toBe(ep.episodeId);
                expect(snap.state.episode.hints).toHaveLength(1);
                expect(snap.state.episode.hints[0]).toEqual(hint);
                expect(snap.state.level).toBe('active');
                expect(snap.state.generation).toBe(1);
            }
        });

        it('stores the hint level as delivered level', () => {
            const sm = new SlotManager();
            const snap = sm.takeDelivered(NOW, makeEp(), makeHint('ambient', 'direct ambient delivery'));
            if (snap.state.kind === 'delivered') {
                expect(snap.state.level).toBe('ambient');
            }
        });

        it('throws when slot is not FREE', () => {
            const sm = new SlotManager();
            sm.takeDelivered(NOW, makeEp(), makeHint('active'));
            expect(() => sm.takeDelivered(NOW, makeEp(), makeHint('active'))).toThrow();
        });
    });

    describe('revealParked', () => {
        it('transitions PARKED -> DELIVERED, keeps same episode and hints unchanged, bumps generation', () => {
            const sm = new SlotManager();
            const ep = makeEp();
            const hint = makeHint('ambient', 'ambient text');
            sm.takeParked(NOW, ep, hint);
            const gen1 = sm.generation(); // 1

            const snap = sm.revealParked(hint);

            expect(snap.state.kind).toBe('delivered');
            expect(snap.generation).toBe(gen1 + 1);
            if (snap.state.kind === 'delivered') {
                expect(snap.state.episode.episodeId).toBe(ep.episodeId);
                // hint was already added by takeParked; revealParked must NOT re-add it
                expect(snap.state.episode.hints).toHaveLength(1);
                expect(snap.state.level).toBe('ambient');
                expect(snap.state.generation).toBe(gen1 + 1);
            }
        });

        it('throws when slot is FREE', () => {
            const sm = new SlotManager();
            expect(() => sm.revealParked(makeHint())).toThrow();
        });

        it('throws when slot is DELIVERED', () => {
            const sm = new SlotManager();
            sm.takeDelivered(NOW, makeEp(), makeHint('active'));
            expect(() => sm.revealParked(makeHint())).toThrow();
        });
    });

    describe('replaceParked', () => {
        it('PARKED -> PARKED with NEW episode, old hint evaporates, new hint stored, bumps generation', () => {
            const sm = new SlotManager();
            const ep1 = makeEp();
            sm.takeParked(NOW, ep1, makeHint('ambient', 'old hint'));
            const gen1 = sm.generation(); // 1

            const ep2 = makeEp();
            const newHint = makeHint('ambient', 'new hint');
            const snap = sm.replaceParked(NOW, ep2, newHint);

            expect(snap.state.kind).toBe('parked');
            expect(snap.generation).toBe(gen1 + 1);
            if (snap.state.kind === 'parked') {
                expect(snap.state.episode.episodeId).toBe(ep2.episodeId);
                expect(snap.state.episode.episodeId).not.toBe(ep1.episodeId);
                // old hint NOT carried; only the new hint
                expect(snap.state.episode.hints).toHaveLength(1);
                expect(snap.state.episode.hints[0]).toEqual(newHint);
                expect(snap.state.frozenText).toBe(newHint.text);
                expect(snap.state.generation).toBe(gen1 + 1);
            }
        });

        it('throws when slot is FREE', () => {
            const sm = new SlotManager();
            expect(() => sm.replaceParked(NOW, makeEp(), makeHint())).toThrow();
        });

        it('throws when slot is DELIVERED', () => {
            const sm = new SlotManager();
            sm.takeDelivered(NOW, makeEp(), makeHint('active'));
            expect(() => sm.replaceParked(NOW, makeEp(), makeHint())).toThrow();
        });
    });

    describe('replaceWithDelivered', () => {
        it('PARKED -> DELIVERED with NEW episode, old parked hint NOT carried, bumps generation', () => {
            const sm = new SlotManager();
            const ep1 = makeEp();
            sm.takeParked(NOW, ep1, makeHint('ambient', 'old parked hint'));
            const gen1 = sm.generation(); // 1

            const ep2 = makeEp();
            const activeHint = makeHint('active', 'first active delivery');
            const snap = sm.replaceWithDelivered(NOW, ep2, activeHint);

            expect(snap.state.kind).toBe('delivered');
            expect(snap.generation).toBe(gen1 + 1);
            if (snap.state.kind === 'delivered') {
                expect(snap.state.episode.episodeId).toBe(ep2.episodeId);
                expect(snap.state.episode.episodeId).not.toBe(ep1.episodeId);
                expect(snap.state.episode.hints).toHaveLength(1);
                expect(snap.state.episode.hints[0]).toEqual(activeHint);
                expect(snap.state.level).toBe('active');
                expect(snap.state.generation).toBe(gen1 + 1);
            }
        });

        it('throws when slot is FREE', () => {
            const sm = new SlotManager();
            expect(() => sm.replaceWithDelivered(NOW, makeEp(), makeHint('active'))).toThrow();
        });

        it('throws when slot is DELIVERED', () => {
            const sm = new SlotManager();
            sm.takeDelivered(NOW, makeEp(), makeHint('active'));
            expect(() => sm.replaceWithDelivered(NOW, makeEp(), makeHint('active'))).toThrow();
        });
    });

    describe('escalate', () => {
        it('DELIVERED ambient -> DELIVERED active, same episode, appends hint, bumps generation', () => {
            const sm = new SlotManager();
            const ep = makeEp();
            const ambientHint = makeHint('ambient', 'ambient');
            // path: free -> parked -> delivered ambient
            sm.takeParked(NOW, ep, ambientHint);
            sm.revealParked(ambientHint);
            const gen2 = sm.generation(); // 2

            const activeHint = makeHint('active', 'active escalation');
            const snap = sm.escalate(activeHint);

            expect(snap.state.kind).toBe('delivered');
            expect(snap.generation).toBe(gen2 + 1);
            if (snap.state.kind === 'delivered') {
                expect(snap.state.episode.episodeId).toBe(ep.episodeId);
                expect(snap.state.episode.hints).toHaveLength(2);
                expect(snap.state.episode.hints[0]).toEqual(ambientHint);
                expect(snap.state.episode.hints[1]).toEqual(activeHint);
                expect(snap.state.level).toBe('active');
                expect(snap.state.generation).toBe(gen2 + 1);
            }
        });

        it('also works from takeDelivered ambient (direct ambient delivery)', () => {
            const sm = new SlotManager();
            const ep = makeEp();
            sm.takeDelivered(NOW, ep, makeHint('ambient', 'direct ambient'));
            const gen1 = sm.generation();

            const activeHint = makeHint('active', 'escalated');
            const snap = sm.escalate(activeHint);

            expect(snap.state.kind).toBe('delivered');
            expect(snap.generation).toBe(gen1 + 1);
            if (snap.state.kind === 'delivered') {
                expect(snap.state.level).toBe('active');
                expect(snap.state.episode.hints).toHaveLength(2);
            }
        });

        it('throws when slot is FREE', () => {
            const sm = new SlotManager();
            expect(() => sm.escalate(makeHint('active'))).toThrow();
        });

        it('throws when slot is PARKED', () => {
            const sm = new SlotManager();
            sm.takeParked(NOW, makeEp(), makeHint('ambient'));
            expect(() => sm.escalate(makeHint('active'))).toThrow();
        });

        it('throws when DELIVERED at active level (can only escalate from ambient)', () => {
            const sm = new SlotManager();
            sm.takeDelivered(NOW, makeEp(), makeHint('active'));
            expect(() => sm.escalate(makeHint('active'))).toThrow();
        });
    });

    describe('free', () => {
        it('transitions DELIVERED -> FREE and bumps generation', () => {
            const sm = new SlotManager();
            sm.takeDelivered(NOW, makeEp(), makeHint('active'));
            const gen1 = sm.generation();

            const snap = sm.free();

            expect(snap.state.kind).toBe('free');
            expect(snap.generation).toBe(gen1 + 1);
            expect(sm.isFree()).toBe(true);
        });

        it('transitions PARKED -> FREE and bumps generation', () => {
            const sm = new SlotManager();
            sm.takeParked(NOW, makeEp(), makeHint());
            const gen1 = sm.generation();

            const snap = sm.free();

            expect(snap.state.kind).toBe('free');
            expect(snap.generation).toBe(gen1 + 1);
        });

        it('transitions FREE -> FREE and still bumps generation', () => {
            const sm = new SlotManager();
            const snap = sm.free();
            expect(snap.state.kind).toBe('free');
            expect(snap.generation).toBe(1);
        });
    });

    describe('discardParkedToFree', () => {
        it('transitions PARKED -> FREE and bumps generation', () => {
            const sm = new SlotManager();
            sm.takeParked(NOW, makeEp(), makeHint());
            const gen1 = sm.generation();

            const snap = sm.discardParkedToFree();

            expect(snap.state.kind).toBe('free');
            expect(snap.generation).toBe(gen1 + 1);
            expect(sm.isFree()).toBe(true);
        });

        it('throws when slot is FREE', () => {
            const sm = new SlotManager();
            expect(() => sm.discardParkedToFree()).toThrow();
        });

        it('throws when slot is DELIVERED', () => {
            const sm = new SlotManager();
            sm.takeDelivered(NOW, makeEp(), makeHint('active'));
            expect(() => sm.discardParkedToFree()).toThrow();
        });
    });

    describe('setInSession', () => {
        it('flips inSession to true and does NOT bump generation', () => {
            const sm = new SlotManager();
            const gen0 = sm.generation();

            const snap = sm.setInSession(true);

            expect(snap.inSession).toBe(true);
            expect(snap.generation).toBe(gen0);
        });

        it('flips inSession to false and does NOT bump generation', () => {
            const sm = new SlotManager();
            sm.setInSession(true);
            const gen = sm.generation();

            const snap = sm.setInSession(false);

            expect(snap.inSession).toBe(false);
            expect(snap.generation).toBe(gen);
        });

        it('does not bump generation even after semantic transitions', () => {
            const sm = new SlotManager();
            sm.takeParked(NOW, makeEp(), makeHint());
            const gen1 = sm.generation(); // 1

            sm.setInSession(true);

            expect(sm.generation()).toBe(gen1);
        });
    });

    describe('generation() method', () => {
        it('always matches snapshot().generation', () => {
            const sm = new SlotManager();
            expect(sm.generation()).toBe(sm.snapshot().generation);

            sm.takeParked(NOW, makeEp(), makeHint());
            expect(sm.generation()).toBe(sm.snapshot().generation);

            sm.setInSession(true);
            expect(sm.generation()).toBe(sm.snapshot().generation);

            sm.revealParked(makeHint());
            expect(sm.generation()).toBe(sm.snapshot().generation);
        });
    });
});
