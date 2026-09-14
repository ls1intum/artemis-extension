import type { GlossaryKey } from '@webview/views/StruggleDetection/glossary';
import { boundaryText, discreteText, GLOSSARY, reasonText } from '@webview/views/StruggleDetection/glossary';

const ALL_KEYS: GlossaryKey[] = [
    'FM', 'E4', 'N1', 'STATE',
    'fired', 'no-candidate', 'b2-fluent-typing', 'b4-grace-filter', 'd1-warmup', 'below-threshold', 'cooldown', 'not-rearmed',
    'test-stagnation', 'urgency', 'theta',
];

test('every glossary key has spelled-out text distinct from its code', () => {
    for (const k of ALL_KEYS) {
        const entry = GLOSSARY[k];
        expect(entry).toBeDefined();
        expect(entry.text.length).toBeGreaterThanOrEqual(12);
        expect(entry.text.toLowerCase()).not.toBe(entry.code.toLowerCase());
    }
});

test('reasonText returns the spelled-out wording', () => {
    expect(reasonText('b2-fluent-typing')).toMatch(/typing fluently/i);
});

test('boundaryText returns text and code for all boundary types', () => {
    const boundaries = ['FM', 'E4', 'N1', 'STATE'] as const;
    for (const b of boundaries) {
        const result = boundaryText(b);
        expect(result.text.length).toBeGreaterThanOrEqual(12);
        expect(result.code).toBeDefined();
    }
});

test('discreteText returns spelled-out wording for test-stagnation', () => {
    const result = discreteText('test-stagnation');
    expect(result).toMatch(/tests are stuck/i);
});

test('GLOSSARY is exhaustive — all keys from ALL_KEYS resolve', () => {
    for (const k of ALL_KEYS) {
        expect(GLOSSARY[k]).toBeDefined();
    }
});

test('every boundary has a short pipeline label, no longer than its full text', () => {
    const boundaries = ['FM', 'E4', 'N1', 'STATE'] as const;
    for (const b of boundaries) {
        const entry = GLOSSARY[b];
        expect(entry.short, `${b} short label`).toBeDefined();
        expect(entry.short!.length).toBeGreaterThan(0);
        expect(entry.short!.length).toBeLessThanOrEqual(entry.text.length);
    }
});
