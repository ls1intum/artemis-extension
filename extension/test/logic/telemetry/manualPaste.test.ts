import { describe, expect, it } from 'vitest';

import { isLikelyManualPaste } from '@extension/services/telemetry/eventPipeline/compileEquivalentEmitter';

type Change = Parameters<typeof isLikelyManualPaste>[0];

function change(text: string, opts: { rangeLength?: number; isEmpty?: boolean; isSingleLine?: boolean } = {}): Change {
    return {
        text,
        rangeLength: opts.rangeLength ?? 0,
        range: { isEmpty: opts.isEmpty ?? true, isSingleLine: opts.isSingleLine ?? false },
    } as unknown as Change;
}

describe('isLikelyManualPaste respects the configurable minimum line count', () => {
    it('treats a 2-line insert as paste with the default minimum (2)', () => {
        expect(isLikelyManualPaste(change('a\nb'))).toBe(true);
    });

    it('does NOT treat a 2-line insert as paste when the minimum is raised to 3', () => {
        expect(isLikelyManualPaste(change('a\nb'), 3)).toBe(false);
    });

    it('treats a 3-line insert as paste when the minimum is 3', () => {
        expect(isLikelyManualPaste(change('a\nb\nc'), 3)).toBe(true);
    });
});
