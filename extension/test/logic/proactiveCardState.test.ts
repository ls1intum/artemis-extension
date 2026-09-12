import { describe, expect, it } from 'vitest';

import { deriveProactiveCardState, type ProactiveCardSignals } from '@extension/services/proactiveCardState';

const base: ProactiveCardSignals = {
    irisAvailability: 'enabled',
    noAi: false,
    courseProactiveEnabled: true,
    consentMissing: false,
    serverUnavailable: false,
};

describe('deriveProactiveCardState (§14 matrix)', () => {
    it('all signals ok → available', () => {
        expect(deriveProactiveCardState(base)).toEqual({ state: 'available', reason: undefined });
    });

    it('.noai present → unavailable/noai (§14 case 3), beats iris-off', () => {
        expect(deriveProactiveCardState({ ...base, noAi: true, irisAvailability: 'disabled' }))
            .toEqual({ state: 'unavailable', reason: 'noai' });
    });

    it('iris disabled / no LLM opt-in → unavailable/iris-off (§14 case 2)', () => {
        expect(deriveProactiveCardState({ ...base, irisAvailability: 'disabled' }))
            .toEqual({ state: 'unavailable', reason: 'iris-off' });
    });

    it('course proactive off (Iris on) → off-course (§14 case 1)', () => {
        expect(deriveProactiveCardState({ ...base, courseProactiveEnabled: false }))
            .toEqual({ state: 'off-course', reason: 'course-off' });
    });

    it('missing consent → degraded/consent-missing (#342, student-fixable)', () => {
        expect(deriveProactiveCardState({ ...base, consentMissing: true }))
            .toEqual({ state: 'degraded', reason: 'consent-missing' });
    });

    it('404-latched server → degraded/limited (§14 case 5)', () => {
        expect(deriveProactiveCardState({ ...base, serverUnavailable: true }))
            .toEqual({ state: 'degraded', reason: 'limited' });
    });

    it('precedence: 404 beats missing consent (a consent hint must not promise an absent feature)', () => {
        expect(deriveProactiveCardState({ ...base, consentMissing: true, serverUnavailable: true }))
            .toEqual({ state: 'degraded', reason: 'limited' });
    });

    it('precedence: course-off beats missing consent (reason only; the level mask is orthogonal)', () => {
        expect(deriveProactiveCardState({ ...base, courseProactiveEnabled: false, consentMissing: true }))
            .toEqual({ state: 'off-course', reason: 'course-off' });
    });

    it('transient unavailable (§14 case 6) self-heals → available (no false "off")', () => {
        // settings could not be read this tick → courseProactiveEnabled undefined; not degraded/off/disabled.
        expect(deriveProactiveCardState({ ...base, irisAvailability: 'unavailable', courseProactiveEnabled: undefined }))
            .toEqual({ state: 'available', reason: undefined });
    });

    it('precedence: course-off is checked only after iris is confirmed enabled', () => {
        // disabled + course-off → unavailable (iris-off wins; you cannot be "off for the course" if Iris is off)
        expect(deriveProactiveCardState({ ...base, irisAvailability: 'disabled', courseProactiveEnabled: false }))
            .toEqual({ state: 'unavailable', reason: 'iris-off' });
    });

    it('precedence: noai beats course-off and degraded too', () => {
        expect(deriveProactiveCardState({ ...base, noAi: true, courseProactiveEnabled: false, consentMissing: true, serverUnavailable: true }))
            .toEqual({ state: 'unavailable', reason: 'noai' });
    });
});
