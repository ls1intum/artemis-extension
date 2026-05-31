import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { forbiddenInputs } = require('../../../scripts/verify-clean-bundle.js');

function metaWith(inputs: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'meta-'));
    const file = join(dir, 'meta.json');
    writeFileSync(file, JSON.stringify({ inputs: Object.fromEntries(inputs.map(i => [i, {}])) }));
    return file;
}

describe('verify-clean-bundle', () => {
    it('flags recorder/consent inputs', () => {
        const f = metaWith([
            'src/extension/services/telemetry/recording/sessionRecorder.ts',
            'src/extension/services/auth/consentService.ts',
            'src/extension/services/telemetry/metrics/errorQuotientEngine.ts',
        ]);
        expect(forbiddenInputs(f)).toHaveLength(2);
    });

    it('passes a clean input set', () => {
        const f = metaWith([
            'src/extension/services/telemetry/metrics/errorQuotientEngine.ts',
            'src/extension/dataCollection/noop.ts',
        ]);
        expect(forbiddenInputs(f)).toEqual([]);
    });
});
