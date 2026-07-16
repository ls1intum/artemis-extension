import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const { resolveBuildVariant } = require(
    join(__dirname, '../../../scripts/resolveBuildVariant.js')
) as {
    resolveBuildVariant: (o: { argv?: string[]; env?: Record<string, string> }) => {
        variant: string; isOpenVsx: boolean; recording: boolean;
    };
};

describe('resolveBuildVariant', () => {
    it('defaults to full (recorder off) with no flag or env', () => {
        expect(resolveBuildVariant({ argv: [], env: {} })).toEqual({
            variant: 'full', isOpenVsx: false, recording: false,
        });
    });
    it('reads --variant= from argv', () => {
        expect(resolveBuildVariant({ argv: ['node', 'esbuild.js', '--variant=openvsx'], env: {} }))
            .toEqual({ variant: 'openvsx', isOpenVsx: true, recording: false });
    });
    it('reads IRIS_BUILD_VARIANT from env', () => {
        expect(resolveBuildVariant({ argv: [], env: { IRIS_BUILD_VARIANT: 'local-recording' } }).recording).toBe(true);
    });
    it('argv flag wins over env', () => {
        expect(resolveBuildVariant({ argv: ['--variant=full'], env: { IRIS_BUILD_VARIANT: 'local-recording' } }).recording)
            .toBe(false);
    });
    it('throws on an unknown variant', () => {
        expect(() => resolveBuildVariant({ argv: ['--variant=bogus'], env: {} })).toThrow(/unknown variant 'bogus'/);
    });
    it('refuses local-recording under GITHUB_ACTIONS', () => {
        expect(() => resolveBuildVariant({ argv: ['--variant=local-recording'], env: { GITHUB_ACTIONS: 'true' } }))
            .toThrow(/refused under CI/);
    });
    it('refuses local-recording under CI=true', () => {
        expect(() => resolveBuildVariant({ argv: [], env: { IRIS_BUILD_VARIANT: 'local-recording', CI: 'true' } }))
            .toThrow(/refused under CI/);
    });
    it('does NOT treat CI=false as CI', () => {
        expect(resolveBuildVariant({ argv: ['--variant=local-recording'], env: { CI: 'false' } }).recording).toBe(true);
    });
});
