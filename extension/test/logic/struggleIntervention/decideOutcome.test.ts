import { describe, expect, it } from 'vitest';

import { decideOutcome } from '@extension/services/struggleIntervention/decideOutcome';

describe('decideOutcome', () => {
    const base = { optedIn: true, inFlight: false, hasExercise: true, noaiMarker: false, serverAvailable: true };
    it('not opted in → local fallback', () => {
        expect(decideOutcome({ ...base, optedIn: false })).toBe('fallback');
    });
    it('.noai marker → local fallback even when opted in (spec §9)', () => {
        expect(decideOutcome({ ...base, noaiMarker: true })).toBe('fallback');
    });
    it('server unavailable → local fallback even when opted in (spec §9/§11: no-AI lamp remains)', () => {
        expect(decideOutcome({ ...base, serverAvailable: false })).toBe('fallback');
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
