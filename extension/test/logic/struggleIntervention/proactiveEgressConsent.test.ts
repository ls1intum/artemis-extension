import { describe, expect, it } from 'vitest';

import {
    isProactiveEgressEnabled,
    type ProactiveEgressLevel,
    shouldAskForProactiveEgress,
} from '@extension/services/struggleIntervention/proactiveEgressConsent';

describe('proactive egress gate', () => {
    it('only "enabled" permits egress', () => {
        expect(isProactiveEgressEnabled('enabled' as ProactiveEgressLevel)).toBe(true);
        expect(isProactiveEgressEnabled('ask' as ProactiveEgressLevel)).toBe(false);
        expect(isProactiveEgressEnabled('disabled' as ProactiveEgressLevel)).toBe(false);
    });

    it('does not ask while the server cannot answer', () => {
        // Asking a student to allow proactive help is only honest once Artemis can act on it.
        // The server side (Artemis #13023) is not released, so an accepted prompt would be
        // followed by nothing at all, with no way for the student to tell why. Until then the
        // extension stays quiet and the setting keeps its default, which the egress gate above
        // already reads as "no".
        expect(shouldAskForProactiveEgress('ask' as ProactiveEgressLevel)).toBe(false);
    });

    it('never asks once the student has decided', () => {
        expect(shouldAskForProactiveEgress('enabled' as ProactiveEgressLevel)).toBe(false);
        expect(shouldAskForProactiveEgress('disabled' as ProactiveEgressLevel)).toBe(false);
    });
});
