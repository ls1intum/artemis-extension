import { describe, it, expect } from 'vitest';
import { raterLaneColor } from '../src/utils/raterColor';

describe('raterLaneColor', () => {
    it('is deterministic for a given rater id', () => {
        expect(raterLaneColor('r_abc')).toBe(raterLaneColor('r_abc'));
    });
    it('differs across rater ids', () => {
        const a = raterLaneColor('r_abc');
        const b = raterLaneColor('r_xyz');
        expect(a).not.toBe(b);
    });
    it('uses a distinct neutral color for the legacy lane', () => {
        expect(raterLaneColor('legacy')).toBe('hsl(0 0% 50%)');
        expect(raterLaneColor('legacy')).not.toBe(raterLaneColor('r_abc'));
    });
});
