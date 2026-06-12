import { describe, expect, it } from 'vitest';

import {
    BUILD_ERROR_FAMILY_MAX_CHARS,
    buildErrorFamiliesFromFeedbacks,
} from '@extension/services/eq/buildErrorFamily';

describe('buildErrorFamiliesFromFeedbacks', () => {
    it('maps each failed feedback with text to a build:<text> family', () => {
        const families = buildErrorFamiliesFromFeedbacks([
            { positive: false, text: 'NullPointerException in test A' },
            { positive: false, text: 'AssertionError in test B' },
        ]);
        expect(families).toEqual([
            'build:NullPointerException in test A',
            'build:AssertionError in test B',
        ]);
    });

    it('ignores passing, ungraded, and text-less feedbacks', () => {
        const families = buildErrorFamiliesFromFeedbacks([
            { positive: true, text: 'passed' },
            { positive: undefined, text: 'not yet graded' },
            { positive: false, text: undefined },
            { positive: false, text: '' },
            { positive: false, text: 'real failure' },
        ]);
        expect(families).toEqual(['build:real failure']);
    });

    it('truncates the family key at BUILD_ERROR_FAMILY_MAX_CHARS (200) chars', () => {
        const longText = 'x'.repeat(500);
        const [family] = buildErrorFamiliesFromFeedbacks([{ positive: false, text: longText }]);
        expect(BUILD_ERROR_FAMILY_MAX_CHARS).toBe(200);
        expect(family).toBe(`build:${'x'.repeat(200)}`);
    });

    it('keeps two failures distinct when they share the first 50 chars but differ before 200 (regression against the old 50-char merge)', () => {
        // Prefix is > 50 chars, so a 50-char truncation would collapse both into one family.
        const prefix = 'CompilationError: cannot find symbol in a very long line ';
        const families = buildErrorFamiliesFromFeedbacks([
            { positive: false, text: `${prefix}variable fooooooooo` },
            { positive: false, text: `${prefix}variable barrrrrrrr` },
        ]);
        expect(new Set(families).size).toBe(2);
    });

    it('returns an empty array for undefined or empty feedbacks', () => {
        expect(buildErrorFamiliesFromFeedbacks(undefined)).toEqual([]);
        expect(buildErrorFamiliesFromFeedbacks([])).toEqual([]);
    });
});
