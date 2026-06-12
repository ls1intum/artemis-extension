import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Resolve the plain-JS verifier (in scripts/, no path alias). join(__dirname, ...)
// keeps the require argument computed (not an upward-relative literal, per lint rule)
// and avoids import.meta (disallowed under the CommonJS type-check target).
const { forbiddenInputs } = require(join(__dirname, '../../../scripts/verify-clean-bundle.js')) as {
    forbiddenInputs: (metafilePath: string) => string[];
};

function metaWith(inputs: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'meta-'));
    const file = join(dir, 'meta.json');
    writeFileSync(file, JSON.stringify({ inputs: Object.fromEntries(inputs.map(i => [i, {}])) }));
    return file;
}

describe('verify-clean-bundle', () => {
    it('flags recorder/consent inputs', () => {
        const f = metaWith([
            'src/extension/services/recording/sessionRecorder.ts',
            'src/extension/services/auth/consentService.ts',
            'src/extension/services/eq/errorQuotientEngine.ts',
        ]);
        expect(forbiddenInputs(f)).toHaveLength(2);
    });

    it('passes a clean input set', () => {
        const f = metaWith([
            'src/extension/services/eq/errorQuotientEngine.ts',
            'src/extension/dataCollection/noop.ts',
        ]);
        expect(forbiddenInputs(f)).toEqual([]);
    });
});
