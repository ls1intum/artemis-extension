import { describe, expect, it } from 'vitest';

import { stripMarkdown } from '@shared/stripMarkdown';

describe('stripMarkdown', () => {
    it('strips single-asterisk and single-underscore emphasis', () => {
        expect(stripMarkdown('on the *last* index')).toBe('on the last index');
        expect(stripMarkdown('a _really_ big deal')).toBe('a really big deal');
    });
    it('strips **bold** and __bold__', () => {
        expect(stripMarkdown('the **loop** bound')).toBe('the loop bound');
        expect(stripMarkdown('a __bold__ move')).toBe('a bold move');
    });
    it('strips ~~strikethrough~~', () => {
        expect(stripMarkdown('this is ~~wrong~~ ok')).toBe('this is wrong ok');
    });
    it('strips inline code backticks, keeping the text', () => {
        expect(stripMarkdown('the `x` var')).toBe('the x var');
    });
    it('drops a fenced code block', () => {
        expect(stripMarkdown('a\n```java\nint x = 1;\n```\nb').replace(/\s+/g, ' ').trim()).toBe('a b');
    });
    it('keeps link text and image alt text', () => {
        expect(stripMarkdown('see [docs](http://x/y) here')).toBe('see docs here');
        expect(stripMarkdown('see ![diagram](http://x/y.png) now')).toBe('see diagram now');
    });
    it('keeps inline-code contents opaque (does not re-strip markdown inside code)', () => {
        expect(stripMarkdown('check `__init__` method')).toBe('check __init__ method');
        expect(stripMarkdown('the `*x*` token')).toBe('the *x* token');
    });
    it('preserves a lone asterisk in prose, an intra-word underscore, and delimiter runs', () => {
        expect(stripMarkdown('use a * b not a_b')).toBe('use a * b not a_b');
        expect(stripMarkdown('call foo_bar here')).toBe('call foo_bar here');
        expect(stripMarkdown('id foo__bar__baz end')).toBe('id foo__bar__baz end');
    });
    it('uses Unicode word boundaries (does not split é_x_é)', () => {
        expect(stripMarkdown('word é_x_é done')).toBe('word é_x_é done');
    });
    it('leaves backslash-escaped delimiters untouched (open or close escaped)', () => {
        expect(stripMarkdown('a \\*literal\\* and \\_x\\_ b')).toBe('a \\*literal\\* and \\_x\\_ b');
        expect(stripMarkdown('a *literal\\* b')).toBe('a *literal\\* b'); // only the closing marker escaped
    });
    it('drops a literal sentinel in the input without corrupting the result', () => {
        // U+E000 is the private-use sentinel; a message carrying it must not hijack code restoration.
        const S = String.fromCharCode(0xe000);
        expect(stripMarkdown(`x${S}0${S}y and \`code\` z`)).toBe('x0y and code z');
    });
    it('does not throw on a ) inside a link URL, and keeps the words', () => {
        expect(() => stripMarkdown('see [docs](http://x/a(b)c) here')).not.toThrow();
        expect(stripMarkdown('see [docs](http://x/a(b)c) here')).toContain('docs');
    });
    it('stays linear on adversarial delimiter and malformed-link runs (a quadratic impl would time out)', () => {
        // ~300 KB each: the linear implementation finishes in a few ms; an O(n^2) scan exceeds the
        // vitest timeout. Spaced stars and unterminated links/images are all left unchanged.
        for (const seed of ['*a ', '[a ', '[a](', '![a ', '![a](']) {
            const adv = seed.repeat(Math.floor(300000 / seed.length));
            expect(stripMarkdown(adv)).toBe(adv);
        }
    });
});
