import { describe, it, expect } from 'vitest';
import { normalizeRaterName, deriveRaterId, RaterNameError } from '../../server/raterIdentity';

describe('normalizeRaterName', () => {
    it('trims surrounding whitespace', () => {
        expect(normalizeRaterName('  alice  ')).toBe('alice');
    });
    it('collapses internal whitespace to single spaces', () => {
        expect(normalizeRaterName('al   ice\tbob')).toBe('al ice bob');
    });
    it('NFC-normalizes unicode (combining sequence vs precomposed)', () => {
        const combining = 'Álice'; // A + combining acute
        const precomposed = 'Álice';
        expect(normalizeRaterName(combining)).toBe(normalizeRaterName(precomposed));
    });
    it('preserves case in display name', () => {
        expect(normalizeRaterName('Alice')).toBe('Alice');
        expect(normalizeRaterName('ALICE')).toBe('ALICE');
    });
    it('throws RaterNameError with "required" message on empty after trim', () => {
        expect(() => normalizeRaterName('   ')).toThrow(RaterNameError);
        expect(() => normalizeRaterName('   ')).toThrow(/required/i);
        expect(() => normalizeRaterName('')).toThrow(RaterNameError);
    });
    it('throws RaterNameError with "80" message on names longer than 80 chars', () => {
        expect(() => normalizeRaterName('a'.repeat(81))).toThrow(RaterNameError);
        expect(() => normalizeRaterName('a'.repeat(81))).toThrow(/80/);
        expect(normalizeRaterName('a'.repeat(80))).toBe('a'.repeat(80));
    });
    it('length cap is measured in UTF-16 code units (pins emoji/CJK behavior)', () => {
        // '😀' is one user-perceived char but two UTF-16 code units, so 40 emojis
        // consume the 80-unit budget exactly and 41 overflow it.
        expect(normalizeRaterName('😀'.repeat(40))).toBe('😀'.repeat(40));
        expect(() => normalizeRaterName('😀'.repeat(41))).toThrow(RaterNameError);
    });
});

describe('deriveRaterId', () => {
    it('produces a stable 24-char r_-prefixed id', () => {
        const id = deriveRaterId('alice');
        expect(id).toMatch(/^r_[A-Za-z0-9_-]{22}$/);
        expect(deriveRaterId('alice')).toBe(id);
    });
    it('case-folds: same id for "Alice" and "alice"', () => {
        expect(deriveRaterId('Alice')).toBe(deriveRaterId('alice'));
    });
    it('case-folds with stable en-US locale (Turkish-i safety regression guard)', () => {
        // Stable across machines: a future refactor dropping the locale arg
        // would let a Turkish-locale runtime produce different ids for 'IRIS'
        // vs 'iris' (because Turkish maps I -> ı, not i). This pins en-US.
        expect(deriveRaterId('IRIS')).toBe(deriveRaterId('iris'));
        expect(deriveRaterId('İris')).not.toBe(deriveRaterId('iris')); // dotted-capital-I is a different code point
    });
    it('treats typos as different raters', () => {
        expect(deriveRaterId('alice')).not.toBe(deriveRaterId('alise'));
    });
    it('treats NFC-equivalent inputs as the same rater', () => {
        const combining = 'Álice';
        const precomposed = 'Álice';
        expect(deriveRaterId(normalizeRaterName(combining))).toBe(deriveRaterId(normalizeRaterName(precomposed)));
    });
    it('rejects names that fail normalization', () => {
        expect(() => deriveRaterId('   ')).toThrow(RaterNameError);
    });
});
