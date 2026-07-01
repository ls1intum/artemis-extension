import { describe, expect, it } from 'vitest';

import { cleanTopic, episodeTopic, outcomeMeta, rowOutcome } from '@webview/views/IrisChat/components/episodeSummary';
import type { ChatMessage } from '@webview/views/IrisChat/types';

/** Minimal proactive ChatMessage builder for the summary helpers. */
function msg(content: string, outcome?: ChatMessage['proactiveOutcome']): ChatMessage {
    return {
        localId: `l-${content.slice(0, 6)}`,
        role: 'assistant',
        origin: 'proactive',
        content,
        timestamp: 0,
        proactiveEpisodeId: 'ep-1',
        proactiveOutcome: outcome,
    };
}

describe('rowOutcome', () => {
    it('returns undefined when no message carries an outcome', () => {
        expect(rowOutcome([msg('a'), msg('b')])).toBeUndefined();
    });
    it('returns the single explicit outcome', () => {
        expect(rowOutcome([msg('a'), msg('b', 'DISMISSED')])).toBe('DISMISSED');
    });
    it('last explicit reaction wins over an earlier one', () => {
        expect(rowOutcome([msg('a', 'DISMISSED'), msg('b'), msg('c', 'RECOVERED')])).toBe('RECOVERED');
    });
});

describe('outcomeMeta', () => {
    it('maps each outcome to glyph + word + tone', () => {
        expect(outcomeMeta('RECOVERED')).toEqual({ glyph: '✓', word: 'Resolved', tone: 'success' });
        expect(outcomeMeta('DISMISSED')).toEqual({ glyph: '✕', word: 'Dismissed', tone: 'muted' });
        expect(outcomeMeta('ABANDONED')).toEqual({ glyph: '⧗', word: 'Timed out', tone: 'muted' });
    });
    it('maps undefined to a neutral "Earlier hint"', () => {
        expect(outcomeMeta(undefined)).toEqual({ glyph: '·', word: 'Earlier hint', tone: 'neutral' });
    });
});

describe('cleanTopic', () => {
    it('strips inline code and bold and collapses whitespace', () => {
        expect(cleanTopic('In `isValidSelection`, the   **loop** bound')).toBe('In isValidSelection, the loop bound');
    });
    it('drops a fenced code block', () => {
        expect(cleanTopic('Check this\n```java\nint x = 1;\n```\nnow')).toBe('Check this now');
    });
    it('preserves literal asterisks/underscores in prose (does not mangle code-ish text)', () => {
        expect(cleanTopic('use a * b not a_b')).toBe('use a * b not a_b');
    });
    it('keeps link text and does not crash on a ) inside the URL', () => {
        // best-effort: the link regex may leave residue, but it must not throw and must keep the words.
        expect(() => cleanTopic('see [docs](http://x/a(b)c) here')).not.toThrow();
        expect(cleanTopic('see [docs](http://x/y) here')).toBe('see docs here');
    });
    it('cuts at a word boundary and appends an ellipsis', () => {
        const orig = 'The loop bound must stop before the last index or you overflow the array badly';
        const t = cleanTopic(orig);
        expect(t.endsWith('…')).toBe(true);
        expect(t.length).toBeLessThanOrEqual(49); // <= MAX_TOPIC + ellipsis
        const body = t.slice(0, -1); // drop the ellipsis
        expect(orig.startsWith(body)).toBe(true);
        expect(orig[body.length]).toBe(' '); // the cut landed on a whitespace boundary, not mid-word
    });
    it('falls back to "Proactive hint" for empty/whitespace content', () => {
        expect(cleanTopic('   ')).toBe('Proactive hint');
        expect(cleanTopic('')).toBe('Proactive hint');
    });
});

describe('episodeTopic', () => {
    it('prefers a praise label when present', () => {
        expect(episodeTopic([msg('the raw first hint body')], 'Loop bound fixed')).toBe('Loop bound fixed');
    });
    it('falls back to a clean topic from the FIRST message', () => {
        expect(episodeTopic([msg('In `isValidSelection`, fix the bound'), msg('later stale-check')]))
            .toBe('In isValidSelection, fix the bound');
    });
    it('ignores a blank praise label', () => {
        expect(episodeTopic([msg('first hint')], '   ')).toBe('first hint');
    });
});
