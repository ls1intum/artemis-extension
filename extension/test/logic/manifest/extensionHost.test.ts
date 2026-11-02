import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const EXTENSION_ROOT = join(__dirname, '../../..');

const { cleanManifest } = require(join(EXTENSION_ROOT, 'scripts/generate-clean-manifest.js')) as {
    cleanManifest: (m: unknown, profile: string) => Manifest;
};

type Manifest = {
    extensionKind?: string[];
    contributes: { configuration: { properties: Record<string, { scope?: string }> } };
};

const source = readFileSync(join(EXTENSION_ROOT, 'package.json'), 'utf8');

/** `cleanManifest` mutates its argument, so every manifest under test is its own parse. */
const manifests: [string, Manifest][] = [
    ['source', JSON.parse(source) as Manifest],
    ['desktop', cleanManifest(JSON.parse(source), 'desktop')],
    ['openvsx', cleanManifest(JSON.parse(source), 'openvsx')],
];

describe.each(manifests)('%s manifest', (_name, manifest) => {
    it('runs the extension only next to the workspace', () => {
        // A `ui` entry lets VS Code run the extension on the local computer of a WSL, SSH or Dev
        // Container window, where git and every path belong to the wrong machine: a folder picked
        // in WSL is then cloned to `C:\home\...` with Windows git.
        expect(manifest.extensionKind).toEqual(['workspace']);
    });

    it('keeps the default clone folder per machine', () => {
        // A path is only valid on the host that wrote it; `machine` keeps local and remote values
        // apart and out of Settings Sync.
        expect(manifest.contributes.configuration.properties['artemis.defaultClonePath'].scope).toBe('machine');
    });
});
