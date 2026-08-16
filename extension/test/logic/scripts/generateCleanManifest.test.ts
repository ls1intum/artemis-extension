import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type ConfigProp = { type?: string; default?: unknown };
type WalkthroughStep = { id: string; description: string };
type Manifest = {
    contributes: {
        configuration: { properties: Record<string, ConfigProp> };
        commands: { command: string }[];
        menus?: { commandPalette?: { command: string; when?: string }[] };
        walkthroughs?: { id: string; steps: WalkthroughStep[] }[];
    };
    scripts: Record<string, string>;
};

const { cleanManifest } = require(
    join(__dirname, '../../../scripts/generate-clean-manifest.js')
) as { cleanManifest: (m: Manifest, profile: string) => Manifest };

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
            menus: {
                commandPalette: [
                    { command: 'artemis.replaySession', when: 'iris.recorder.active' },
                    { command: 'artemis.openRecordingsFolder', when: 'iris.recorder.active' },
                    { command: 'artemis.login' },
                ],
            },
            walkthroughs: [
                {
                    id: 'artemisGetStarted',
                    steps: [
                        { id: 'signIn', description: 'go\n[Sign in](command:artemis.login)' },
                    ],
                },
            ],
        },
        scripts: { 'vscode:prepublish': 'npm run package', package: 'noop' },
    };
}

describe('generate-clean-manifest: cleanManifest', () => {
    it('throws on an unknown profile', () => {
        expect(() => cleanManifest(baseManifest(), 'bogus')).toThrow(/unknown profile 'bogus'/);
    });

    it('throws when the profile is missing (fail-closed, never defaults)', () => {
        expect(() => (cleanManifest as (m: Manifest) => Manifest)(baseManifest()))
            .toThrow(/unknown profile 'undefined'/);
    });

    describe('desktop profile', () => {
        it('drops the recorder group but keeps struggle', () => {
            const m = cleanManifest(baseManifest(), 'desktop');
            expect(m.contributes.configuration.properties['artemis.dataCollectionConsent']).toBeUndefined();
            expect(m.contributes.commands.map(c => c.command)).toEqual([
                'artemis.login', 'artemis.showStruggleScore',
            ]);
            // struggle settings keep their real defaults on Desktop
            expect(m.contributes.configuration.properties['artemis.struggleDetection.enabled'].default).toBe(true);
        });
        it('drops the recorder commandPalette entries (no dangling ref)', () => {
            const cp = cleanManifest(baseManifest(), 'desktop').contributes.menus!.commandPalette!;
            expect(cp.map(e => e.command)).toEqual(['artemis.login']);
        });
    });

    describe('openvsx profile', () => {
        it('applies the cloud setting-default overrides', () => {
            const props = cleanManifest(baseManifest(), 'openvsx').contributes.configuration.properties;
            expect(props['artemis.startPage'].default).toBe('workspace-exercise');
            expect(props['artemis.struggleDetection.enabled'].default).toBe(false);
            expect(props['artemis.struggleDetection.showInterventions'].default).toBe(false);
        });
        it('removes consent + recording + struggle-score commands', () => {
            const m = cleanManifest(baseManifest(), 'openvsx');
            expect(m.contributes.configuration.properties['artemis.dataCollectionConsent']).toBeUndefined();
            expect(m.contributes.commands.map(c => c.command)).toEqual(['artemis.login']);
        });
        it('throws if an override key is missing (renamed/removed setting)', () => {
            const m = baseManifest();
            delete m.contributes.configuration.properties['artemis.startPage'];
            expect(() => cleanManifest(m, 'openvsx')).toThrow(/cannot override unknown setting 'artemis\.startPage'/);
        });
    });

    it('drops the prepublish hook for both profiles', () => {
        expect(cleanManifest(baseManifest(), 'desktop').scripts['vscode:prepublish']).toBeUndefined();
        expect(cleanManifest(baseManifest(), 'openvsx').scripts['vscode:prepublish']).toBeUndefined();
    });

    it('throws on a dangling command reference left after a drop', () => {
        const m = baseManifest();
        m.contributes.menus!.commandPalette!.push({ command: 'artemis.replaySession', when: 'editorFocus' });
        // Force a menu that references a dropped command but is NOT a commandPalette entry
        (m.contributes.menus as Record<string, unknown>)['editor/context'] = [{ command: 'artemis.replaySession' }];
        expect(() => cleanManifest(m, 'desktop')).toThrow(/dangling command refs/);
    });

    it('throws on a dangling reference via a menu `alt` after a drop', () => {
        const m = baseManifest();
        (m.contributes.menus as Record<string, unknown>)['editor/context'] = [
            { command: 'artemis.login', alt: 'artemis.replaySession' },
        ];
        expect(() => cleanManifest(m, 'desktop')).toThrow(/dangling command refs/);
    });

    describe('walkthroughs', () => {
        it('desktop keeps the walkthrough', () => {
            const m = cleanManifest(baseManifest(), 'desktop');
            expect(m.contributes.walkthroughs?.map(w => w.id)).toEqual(['artemisGetStarted']);
        });

        it('openvsx drops the walkthrough entirely', () => {
            const m = cleanManifest(baseManifest(), 'openvsx');
            expect(m.contributes.walkthroughs).toBeUndefined();
        });

        it('throws when a surviving walkthrough step links a dropped command', () => {
            const m = baseManifest();
            m.contributes.walkthroughs![0].steps.push({
                id: 'replay',
                description: 'x\n[Replay](command:artemis.replaySession)',
            });
            expect(() => cleanManifest(m, 'desktop')).toThrow(/dangling command refs/);
        });

        it('does not trip on a step link that carries URI-encoded arguments', () => {
            const m = baseManifest();
            m.contributes.walkthroughs![0].steps.push({
                id: 'settings',
                description: 'x\n[Open](command:workbench.action.openSettings?%5B%22artemis.startPage%22%5D)',
            });
            expect(() => cleanManifest(m, 'desktop')).not.toThrow();
        });
    });
});

describe('generate-clean-manifest against the real package.json', () => {
    const realManifest = (): Manifest => JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8'));

    it('desktop: drops recorder + consent, keeps struggle', () => {
        const m = cleanManifest(realManifest(), 'desktop');
        const cmds = m.contributes.commands.map(c => c.command);
        const cp = (m.contributes.menus?.commandPalette ?? []).map(e => e.command);
        expect(cmds).not.toContain('artemis.replaySession');
        expect(cmds).not.toContain('artemis.openRecordingsFolder');
        expect(cp).not.toContain('artemis.replaySession');
        expect(m.contributes.configuration.properties['artemis.dataCollectionConsent']).toBeUndefined();
        expect(cmds).toContain('artemis.showStruggleScore'); // struggle kept on Desktop
    });

    it('openvsx: drops recorder + struggle groups and applies cloud defaults', () => {
        const m = cleanManifest(realManifest(), 'openvsx');
        const cmds = m.contributes.commands.map(c => c.command);
        expect(cmds).not.toContain('artemis.replaySession');
        expect(cmds).not.toContain('artemis.showStruggleScore');
        expect(m.contributes.configuration.properties['artemis.struggleDetection.enabled'].default).toBe(false);
    });

    it('openvsx: drops the walkthrough, desktop keeps it', () => {
        expect(cleanManifest(realManifest(), 'openvsx').contributes.walkthroughs).toBeUndefined();
        expect(cleanManifest(realManifest(), 'desktop').contributes.walkthroughs?.[0].id)
            .toBe('artemisGetStarted');
    });
});
