import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The oldest VS Code this extension supports is stated once, in `engines.vscode`, and two
 * other things have to agree with it or the claim is not worth anything.
 *
 * `@types/vscode` is the compile-time half. Held at the floor, it makes the compiler reject an
 * API that a supported VS Code does not have. Raised on its own, the runtime requirement stays
 * put while the compiler starts accepting newer calls, so the break reaches a student on an
 * older VS Code instead of CI. Renovate is told to leave the package alone; this test is what
 * catches the same bump made by hand.
 *
 * `.vscode-test.mjs` is the runtime half: it downloads the build the host tests run against.
 * Reading the version from `engines` rather than repeating it is what keeps the manifest's
 * compatibility claim exercised rather than merely asserted.
 */

const EXTENSION_ROOT = join(__dirname, '../../..');

const manifest = JSON.parse(readFileSync(join(EXTENSION_ROOT, 'package.json'), 'utf8')) as {
    engines: { vscode: string };
    devDependencies: Record<string, string>;
};

describe('the supported VS Code floor', () => {
    it('is the version @types/vscode is pinned to', () => {
        const floor = manifest.engines.vscode.replace(/^[\^~]/, '');

        expect(manifest.devDependencies['@types/vscode']).toBe(floor);
    });

    it('is what the host test runner downloads, read from engines rather than repeated', () => {
        const runner = readFileSync(join(EXTENSION_ROOT, '.vscode-test.mjs'), 'utf8');

        expect(runner).toContain('engines.vscode');
    });
});
