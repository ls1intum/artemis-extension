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
            'src/extension/services/telemetry/recording/sessionRecorder.ts',
            'src/extension/services/auth/consentService.ts',
            'src/extension/services/telemetry/metrics/errorQuotientEngine.ts',
        ]);
        expect(forbiddenInputs(f)).toHaveLength(3);
    });

    it('passes a clean input set', () => {
        const f = metaWith([
            'src/extension/services/telemetry/types.ts',
            'src/extension/dataCollection/noop.ts',
        ]);
        expect(forbiddenInputs(f)).toEqual([]);
    });

    it('flags the struggle engine entry points', () => {
        const f = metaWith([
            'src/extension/services/telemetry/telemetryManager.ts',
            'src/extension/services/telemetry/decision/interventionDecisionEngine.ts',
            'src/extension/services/telemetry/eventPipeline/boundaryTriggerEmitter.ts',
            'src/extension/services/telemetry/types.ts', // allowed
        ]);
        expect(forbiddenInputs(f)).toHaveLength(3);
    });

    it('flags the struggle-detection webview view files', () => {
        const f = metaWith([
            'src/webview/views/StruggleDetection/StruggleDetectionView.tsx',
            'src/webview/views/StruggleDetection/StruggleDetectionView.module.css',
            'src/webview/views/StruggleDetection/stub.tsx', // allowed
            'src/webview/views/StruggleDetection/types.ts', // allowed
        ]);
        expect(forbiddenInputs(f)).toHaveLength(2);
    });

    it('is fail-closed: flags unlisted telemetry-subtree files, allows only types.ts', () => {
        const f = metaWith([
            'src/extension/services/telemetry/uriFilter.ts', // recorder util, never explicitly listed
            'src/extension/services/telemetry/someNewFile.ts', // any future addition
            'src/extension/services/telemetry/types.ts', // allowlisted exception
        ]);
        expect(forbiddenInputs(f)).toEqual([
            'src/extension/services/telemetry/uriFilter.ts',
            'src/extension/services/telemetry/someNewFile.ts',
        ]);
    });
});
