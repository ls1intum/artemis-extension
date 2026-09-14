import { describe, expect, it } from 'vitest';

import type { StruggleInterventionEvent, StruggleInterventionRequest, StruggleSignal } from '@extension/services/struggleIntervention/struggleContract';

describe('struggle contract', () => {
    it('a StruggleSignal literal type-checks with the wire field names', () => {
        const signal: StruggleSignal = {
            alert: { tSessionS: 540, primaryBoundary: 'FM', boundaryTypes: ['FM', 'STATE'], severity: 0.72, path: 'armed', inWarmup: false, inGrace: false },
            trajectory: [{ t: 530, s: 0.6 }],
            sessionSeconds: 540,
        };
        const req: StruggleInterventionRequest = {
            struggleSignal: signal,
            uncommittedFiles: { 'src/A.java': 'class A {}' },
            intent: 'decide',
            episode: { episodeId: 'ep-uuid', isNew: true, hints: [] },
            requestToken: 'token-uuid',
        };
        expect(req.struggleSignal.alert.primaryBoundary).toBe('FM');
        expect(req.uncommittedFiles['src/A.java']).toContain('class A');

        const event: StruggleInterventionEvent = { exerciseId: 42, action: 'active', sessionId: 7 };
        expect(event.action).toBe('active');
        expect(event.sessionId).toBe(7);
    });
});
