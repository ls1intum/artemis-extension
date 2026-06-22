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
    it('flags struggle-engine, intervention, recorder, and consent inputs', () => {
        const f = metaWith([
            'src/extension/services/struggle/struggleEngine.ts',
            'src/extension/services/intervention/interventionService.ts',
            'src/extension/services/recording/sessionRecorder.ts',
            'src/extension/services/auth/consentService.ts',
        ]);
        expect(forbiddenInputs(f)).toHaveLength(4);
    });

    it('passes a clean input set (seam stubs + dataCollection noop)', () => {
        const f = metaWith([
            'src/extension/telemetry/noop.ts',
            'src/extension/dataCollection/noop.ts',
            'src/webview/views/StruggleDetection/stub.tsx',
        ]);
        expect(forbiddenInputs(f)).toEqual([]);
    });

    it('is fail-closed: flags ANY file under the struggle/intervention subtrees', () => {
        const f = metaWith([
            'src/extension/services/struggle/config.ts',
            'src/extension/services/struggle/decision/decisionEngine.ts',
            'src/extension/services/intervention/debug/struggleDebug.ts',
        ]);
        expect(forbiddenInputs(f)).toHaveLength(3);
    });

    it('flags the struggle-detection webview view files, allows stub/types', () => {
        const f = metaWith([
            'src/webview/views/StruggleDetection/StruggleDetectionView.tsx',
            'src/webview/views/StruggleDetection/StruggleDetectionView.module.css',
            'src/webview/views/StruggleDetection/stub.tsx', // allowed (alias target)
            'src/webview/views/StruggleDetection/types.ts', // allowed (type-only)
        ]);
        expect(forbiddenInputs(f)).toHaveLength(2);
    });

    it('flags sessionRecorderWiring (lives outside the subtrees)', () => {
        const f = metaWith(['src/extension/activation/sessionRecorderWiring.ts']);
        expect(forbiddenInputs(f)).toHaveLength(1);
    });
});
