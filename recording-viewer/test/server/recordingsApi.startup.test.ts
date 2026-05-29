import { describe, it, expect } from 'vitest';
import { validateStartupConfig, resolveSessionSecret } from '../../server/startupValidation';

describe('validateStartupConfig', () => {
    it('passes when both tokens differ', () => {
        expect(() => validateStartupConfig({ liveToken: 'a', researcherToken: 'b' })).not.toThrow();
    });
    it('passes when only liveToken set', () => {
        expect(() => validateStartupConfig({ liveToken: 'a', researcherToken: undefined })).not.toThrow();
    });
    it('passes when only researcherToken set', () => {
        expect(() => validateStartupConfig({ liveToken: undefined, researcherToken: 'r' })).not.toThrow();
    });
    it('passes when both undefined (no auth configured)', () => {
        expect(() => validateStartupConfig({ liveToken: undefined, researcherToken: undefined })).not.toThrow();
    });
    it('fails fast when both tokens are set and identical', () => {
        expect(() => validateStartupConfig({ liveToken: 'same', researcherToken: 'same' })).toThrow(/identical/);
    });
});

describe('resolveSessionSecret', () => {
    it('returns the env value when present', () => {
        expect(resolveSessionSecret('explicit-value', () => { throw new Error('should not warn'); })).toBe('explicit-value');
    });
    it('generates ephemeral and warns when env is absent', () => {
        const warnings: string[] = [];
        const secret = resolveSessionSecret(undefined, (msg) => warnings.push(msg));
        expect(secret).toMatch(/^[0-9a-f]{64}$/);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/SESSION_SECRET/);
        expect(warnings[0]).toMatch(/restart/);
    });
    it('generates ephemeral and warns when env is empty string', () => {
        const warnings: string[] = [];
        const secret = resolveSessionSecret('', (msg) => warnings.push(msg));
        expect(secret).toMatch(/^[0-9a-f]{64}$/);
        expect(warnings).toHaveLength(1);
    });
});
