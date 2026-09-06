import { describe, expect, it } from 'vitest';

import { decideOutcome } from '@extension/services/struggleIntervention/decideOutcome';

describe('decideOutcome', () => {
    const base = { optedIn: true, inFlight: false, hasExercise: true, noaiMarker: false, serverAvailable: true };
    it('returns silent when egress is not opted in', () => {
        expect(decideOutcome({ ...base, optedIn: false })).toBe('silent');
    });
    it('returns silent when a .noai marker is present, even when opted in (spec §9)', () => {
        expect(decideOutcome({ ...base, noaiMarker: true })).toBe('silent');
    });
    it('returns silent when the server is unavailable, even when opted in (spec §9/§11)', () => {
        expect(decideOutcome({ ...base, serverAvailable: false })).toBe('silent');
    });
    it('opted in, idle, has exercise, server up → post (no session needed — endpoint is exercise-keyed)', () => {
        expect(decideOutcome(base)).toBe('post');
    });
    it('in flight → skip', () => {
        expect(decideOutcome({ ...base, inFlight: true })).toBe('skip');
    });
    it('opted in but no active exercise → skip (defensive; effectively unreachable)', () => {
        expect(decideOutcome({ ...base, hasExercise: false })).toBe('skip');
    });
});
