import { describe, expect, it } from 'vitest';

import { isProactiveEgressEnabled, type ProactiveEgressLevel } from '@extension/services/struggleIntervention/proactiveEgressConsent';

describe('proactive egress gate', () => {
    it('only "enabled" permits egress', () => {
        expect(isProactiveEgressEnabled('enabled' as ProactiveEgressLevel)).toBe(true);
        expect(isProactiveEgressEnabled('ask' as ProactiveEgressLevel)).toBe(false);
        expect(isProactiveEgressEnabled('disabled' as ProactiveEgressLevel)).toBe(false);
    });
});
