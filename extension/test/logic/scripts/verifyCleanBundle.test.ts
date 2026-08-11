import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const { forbiddenInputs } = require(join(__dirname, '../../../scripts/verify-clean-bundle.js')) as {
    forbiddenInputs: (metafilePath: string, profile: string) => string[];
};

function metaWith(inputs: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'meta-'));
    const file = join(dir, 'meta.json');
    writeFileSync(file, JSON.stringify({ inputs: Object.fromEntries(inputs.map(i => [i, {}])) }));
    return file;
}

function writeRawMeta(content: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), 'meta-'));
    const file = join(dir, 'meta.json');
    writeFileSync(file, JSON.stringify(content));
    return file;
}

describe('verify-clean-bundle', () => {
    it('throws on an unknown profile', () => {
        expect(() => forbiddenInputs(metaWith([]), 'bogus')).toThrow(/unknown profile 'bogus'/);
    });

    describe('desktop profile (recorder forbidden, struggle allowed)', () => {
        it('forbids recorder/consent/replay/seam inputs (both layouts)', () => {
            const f = metaWith([
                'src/extension/services/telemetry/recording/sessionRecorder.ts', // dev layout
                'src/extension/services/telemetry/replay/replayEngine.ts',        // dev layout
                'src/extension/services/recording/sessionRecorder.ts',            // struggle layout
                'src/extension/services/auth/consentService.ts',
                'src/extension/activation/sessionRecorderWiring.ts',
                'src/extension/dataCollection/index.ts',
                'src/extension/dataCollection/recording.ts',
            ]);
            expect(forbiddenInputs(f, 'desktop')).toHaveLength(7);
        });
        it('ALLOWS the shared SensorHub and the struggle engine', () => {
            const f = metaWith([
                'src/extension/services/sensing/sensorHub.ts',
                'src/extension/services/telemetry/telemetryManager.ts',
                'src/extension/services/struggle/struggleEngine.ts',
                'src/extension/dataCollection/noop.ts',
            ]);
            expect(forbiddenInputs(f, 'desktop')).toEqual([]);
        });
    });

    describe('openvsx profile (recorder + struggle forbidden)', () => {
        it('forbids the struggle engine (dev telemetry subtree) but allows types.ts', () => {
            const f = metaWith([
                'src/extension/services/telemetry/telemetryManager.ts',
                'src/extension/services/telemetry/uriFilter.ts',
                'src/extension/services/telemetry/types.ts', // allowed
            ]);
            expect(forbiddenInputs(f, 'openvsx')).toEqual([
                'src/extension/services/telemetry/telemetryManager.ts',
                'src/extension/services/telemetry/uriFilter.ts',
            ]);
        });
        it('forbids the struggle split layout', () => {
            const f = metaWith([
                'src/extension/services/struggle/struggleEngine.ts',
                'src/extension/services/intervention/interventionService.ts',
                'src/extension/services/struggleIntervention/struggleInterventionService.ts',
            ]);
            expect(forbiddenInputs(f, 'openvsx')).toHaveLength(3);
        });
        it('allows the type-only telemetry contract seam (struggle layout)', () => {
            const f = metaWith([
                'src/extension/telemetry/noop.ts', // NOT services/telemetry/ - type-contract seam
                'src/extension/telemetry/contract.ts',
                'src/extension/dataCollection/noop.ts',
            ]);
            expect(forbiddenInputs(f, 'openvsx')).toEqual([]);
        });
        /**
         * The seam's REAL entry, as opposed to its noop. esbuild aliases `@telemetry` to noop.ts
         * here, so this file only reaches the bundle via an import that bypasses the alias -- and
         * it carries the engine wiring plus the developer commands. It matched no forbidden
         * prefix before (TELEMETRY_SUBTREE is `services/telemetry/`, a layout this branch does
         * not use), so that bypass would have shipped silently.
         */
        it('forbids the real telemetry seam entry, while Desktop keeps it', () => {
            const f = metaWith(['src/extension/telemetry/index.ts']);
            expect(forbiddenInputs(f, 'openvsx')).toEqual(['src/extension/telemetry/index.ts']);
            expect(forbiddenInputs(metaWith(['src/extension/telemetry/index.ts']), 'desktop')).toEqual([]);
        });
        it('forbids every StruggleDetection view/hook file except stub/types/index', () => {
            const f = metaWith([
                'src/webview/views/StruggleDetection/StruggleDetectionView.tsx',
                'src/webview/views/StruggleDetection/components/EpisodeHistoryPanel.tsx',
                'src/webview/views/StruggleDetection/hooks/useSlotCountdowns.ts',
                'src/webview/views/StruggleDetection/glossary.ts',
                'src/webview/views/StruggleDetection/stub.tsx', // allowed (alias target)
                'src/webview/views/StruggleDetection/types.ts', // allowed
                'src/webview/views/StruggleDetection/index.ts', // allowed
            ]);
            expect(forbiddenInputs(f, 'openvsx')).toEqual([
                'src/webview/views/StruggleDetection/StruggleDetectionView.tsx',
                'src/webview/views/StruggleDetection/components/EpisodeHistoryPanel.tsx',
                'src/webview/views/StruggleDetection/hooks/useSlotCountdowns.ts',
                'src/webview/views/StruggleDetection/glossary.ts',
            ]);
        });
    });

    describe('fail-closed on a malformed metafile', () => {
        it('throws on empty inputs', () => {
            expect(() => forbiddenInputs(writeRawMeta({ inputs: {} }), 'desktop')).toThrow(/no usable 'inputs'/);
        });
        it('throws on missing inputs', () => {
            expect(() => forbiddenInputs(writeRawMeta({}), 'desktop')).toThrow(/no usable 'inputs'/);
        });
        it('throws on null inputs', () => {
            expect(() => forbiddenInputs(writeRawMeta({ inputs: null }), 'desktop')).toThrow(/no usable 'inputs'/);
        });
        it('throws on array inputs', () => {
            expect(() => forbiddenInputs(writeRawMeta({ inputs: [] }), 'openvsx')).toThrow(/no usable 'inputs'/);
        });
    });
});
