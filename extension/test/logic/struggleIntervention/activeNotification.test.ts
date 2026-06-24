import { describe, expect, it } from 'vitest';

import { buildActiveNotificationText } from '@extension/services/struggleIntervention/activeNotification';

describe('buildActiveNotificationText', () => {
    it('is a short non-empty nudge that does not leak the full hint', () => {
        const text = buildActiveNotificationText();
        expect(text.length).toBeGreaterThan(0);
        expect(text.toLowerCase()).toContain('iris');
    });
});
