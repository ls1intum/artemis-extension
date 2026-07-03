import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Resolve the plain-JS generator (in scripts/, no path alias). join(__dirname, ...)
// keeps the require argument computed (lint rule) and avoids import.meta (CJS target).
type ConfigProp = { type?: string; default?: unknown };
type Manifest = {
    contributes: {
        configuration: { properties: Record<string, ConfigProp> };
        commands: { command: string }[];
    };
    scripts: Record<string, string>;
};

const { cleanManifest } = require(
    join(__dirname, '../../../scripts/generate-clean-manifest.js')
) as {
    cleanManifest: (m: Manifest) => Manifest;
};

function baseManifest(): Manifest {
    return {
        contributes: {
            configuration: {
                properties: {
                    'artemis.startPage': { type: 'string', default: 'dashboard' },
                    'artemis.showStartPageSuggestion': { type: 'boolean', default: true },
                    'artemis.struggleDetection.enabled': { type: 'boolean', default: true },
                    'artemis.struggleDetection.showInterventions': { type: 'boolean', default: true },
                    'artemis.showSetDefaultClonePathPrompt': { type: 'boolean', default: true },
                    'artemis.dataCollectionConsent': { type: 'string', default: 'pending' },
                    'artemis.serverUrl': { type: 'string', default: 'https://artemis.tum.de' },
                },
            },
            commands: [
                { command: 'artemis.login' },
                { command: 'artemis.replaySession' },
                { command: 'artemis.openRecordingsFolder' },
                { command: 'artemis.showStruggleScore' },
            ],
        },
        scripts: { 'vscode:prepublish': 'npm run package', package: 'noop' },
    };
}

describe('generate-clean-manifest: cleanManifest', () => {
    it('applies the cloud setting-default overrides', () => {
        const props = cleanManifest(baseManifest()).contributes.configuration.properties;
        expect(props['artemis.startPage'].default).toBe('workspace-exercise');
        expect(props['artemis.showStartPageSuggestion'].default).toBe(false);
        expect(props['artemis.showSetDefaultClonePathPrompt'].default).toBe(false);
    });

    it('leaves non-overridden settings untouched', () => {
        const props = cleanManifest(baseManifest()).contributes.configuration.properties;
        expect(props['artemis.serverUrl'].default).toBe('https://artemis.tum.de');
    });

    it('strips consent + struggleDetection settings and dropped commands (recording + struggle score)', () => {
        const m = cleanManifest(baseManifest());
        const props = m.contributes.configuration.properties;
        expect(props['artemis.dataCollectionConsent']).toBeUndefined();
        expect(props['artemis.struggleDetection.enabled']).toBeUndefined();
        expect(props['artemis.struggleDetection.showInterventions']).toBeUndefined();
        expect(m.contributes.commands.map(c => c.command)).toEqual(['artemis.login']);
    });

    it('drops the prepublish hook', () => {
        expect(cleanManifest(baseManifest()).scripts['vscode:prepublish']).toBeUndefined();
    });

    it('throws if an override key is missing (renamed/removed setting)', () => {
        const m = baseManifest();
        delete m.contributes.configuration.properties['artemis.startPage'];
        expect(() => cleanManifest(m)).toThrow(/cannot override unknown setting 'artemis\.startPage'/);
    });
});
