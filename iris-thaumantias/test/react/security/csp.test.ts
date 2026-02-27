import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('CSP security invariants', () => {
    const webviewHelpersPath = join(__dirname, '../../../src/utils/webviewHelpers.ts');
    const src = readFileSync(webviewHelpersPath, 'utf8');

    it('uses crypto.randomBytes for nonce generation', () => {
        expect(src).toMatch(/crypto\.randomBytes/);
    });

    it('does not use Math.random for nonce generation', () => {
        expect(src).not.toMatch(/Math\.random/);
    });

    it('does not contain unsafe-inline in CSP directives', () => {
        expect(src).not.toMatch(/unsafe-inline/);
    });

    it('does not contain unsafe-eval in CSP directives', () => {
        expect(src).not.toMatch(/unsafe-eval/);
    });

    it('uses default-src none as CSP baseline', () => {
        expect(src).toMatch(/default-src 'none'/);
    });

    it('uses nonce-based script-src', () => {
        expect(src).toMatch(/script-src 'nonce-/);
    });
});
