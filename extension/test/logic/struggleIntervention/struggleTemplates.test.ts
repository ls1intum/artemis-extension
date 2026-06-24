import { describe, expect, it } from 'vitest';

import type { StruggleSignal } from '@extension/services/struggleIntervention/struggleContract';
import { templateForSignal } from '@extension/services/struggleIntervention/struggleTemplates';

function sig(primary: StruggleSignal['alert']['primaryBoundary'], dominant?: StruggleSignal['dominantComponents'][number]['name']): StruggleSignal {
    return {
        alert: { tSessionS: 1, primaryBoundary: primary, boundaryTypes: [primary], severity: 0.7, path: 'armed', inWarmup: false, inGrace: false },
        trajectory: [], dominantComponents: dominant ? [{ name: dominant, value: 1 }] : [], sessionSeconds: 1,
    };
}

describe('templateForSignal', () => {
    it('keys on the failing-build boundary', () => {
        expect(templateForSignal(sig('FM'))).toMatch(/test|error/i);
        expect(templateForSignal(sig('FM_PLUS'))).toMatch(/test|error/i);
    });
    it('keys on a long paste', () => {
        expect(templateForSignal(sig('N1'))).toMatch(/pasted|understand/i);
    });
    it('keys on a sustained-stuck state / region persistence', () => {
        expect(templateForSignal(sig('STATE'))).toMatch(/step back|same spot|logic/i);
        expect(templateForSignal(sig('E4', 'regionPersistence'))).toMatch(/step back|same spot|logic/i);
    });
    it('always returns a non-empty generic nudge', () => {
        expect(templateForSignal(sig('E4')).length).toBeGreaterThan(0);
    });
});
