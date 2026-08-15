import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type ConfigProp = { type?: string; default?: unknown };
type Manifest = {
    contributes: {
        configuration: { properties: Record<string, ConfigProp> };
        commands: { command: string }[];
        menus?: { commandPalette?: { command: string; when?: string }[] };
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
        it('drops the recorder group, keeps the struggle-score command', () => {
            const m = cleanManifest(baseManifest(), 'desktop');
            expect(m.contributes.configuration.properties['artemis.dataCollectionConsent']).toBeUndefined();
            expect(m.contributes.commands.map(c => c.command)).toEqual([
                'artemis.login', 'artemis.showStruggleScore',
            ]);
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
});

describe('generate-clean-manifest against the real package.json', () => {
    const realManifest = (): Manifest => JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8'));

    it('neither profile emits any artemis.struggleDetection.* property (settings removed, #352)', () => {
        for (const profile of ['desktop', 'openvsx'] as const) {
            const props = cleanManifest(realManifest(), profile).contributes.configuration.properties;
            expect(Object.keys(props).filter(k => k.startsWith('artemis.struggleDetection'))).toEqual([]);
        }
    });

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
    });

    /**
     * The drop lists (RECORDER_COMMANDS / STRUGGLE_COMMANDS) are hand-maintained while the code
     * they describe is not, and `verify-clean-bundle.js` only proves the excluded code is absent
     * from the BUNDLE, not from the MANIFEST. Without this check, a command added to an excluded
     * module ships as a palette entry with no handler behind it ("command not found").
     *
     * The check is deliberately NOT a scan for `registerCommand('<id>')` call sites: registrations
     * also go through constants (`registerCommand(HINT_COMMAND, ...)`), so a syntactic scan
     * silently misses them. It asks a form-independent question instead: does a file that
     * survives the build contain both this command id and a `registerCommand` call? That holds
     * for the literal and the constant form alike, since a command's id and its registration sit
     * in the same file here.
     *
     * The check is necessary, not sufficient: it cannot prove the two occurrences belong
     * together. It targets the failure that actually happens (a command whose module is dropped
     * from a variant), where the id vanishes from the surviving source entirely.
     *
     * Classification comes from `verify-clean-bundle.js` itself, so the two cannot drift.
     */
    const { isForbiddenInput } = require(
        join(__dirname, '../../../scripts/verify-clean-bundle.js')
    ) as { isForbiddenInput: (p: string, profile: string) => boolean };

    const SRC = join(__dirname, '../../../src');

    function allSourceFiles(dir: string): string[] {
        return readdirSync(dir, { recursive: true, encoding: 'utf8' })
            .map(entry => join(dir, entry))
            .filter(p => /\.(ts|tsx)$/.test(p) && statSync(p).isFile());
    }

    /** Command ids with no registering file left in the source surviving `profile`. */
    function unbackedCommands(commands: string[], profile: string): string[] {
        const registrars = allSourceFiles(SRC)
            .filter(p => !isForbiddenInput(p, profile))
            .map(p => readFileSync(p, 'utf8'))
            .filter(text => text.includes('registerCommand'));
        // Quoted, so an id is not "found" inside a longer one: 'artemis.login' must not match
        // 'artemis.loginView.focus'.
        return commands.filter(c => !registrars.some(t => t.includes(`'${c}'`) || t.includes(`"${c}"`)));
    }

    for (const profile of ['desktop', 'openvsx'] as const) {
        it(`${profile}: contributes no command whose id occurs only in code the bundle drops`, () => {
            const contributed = realManifest().contributes.commands.map(c => c.command);

            // Canary: the classification must actually exclude something that matters, otherwise
            // a broken predicate (or a moved file) would turn the assertion below into a
            // vacuous pass. This set is precisely what the profile's drop list must cover.
            const dropped = unbackedCommands(contributed, profile);
            expect(dropped.length).toBeGreaterThan(0);

            const shipped = cleanManifest(realManifest(), profile).contributes.commands.map(c => c.command);
            expect(shipped.filter(c => dropped.includes(c))).toEqual([]);
        });
    }
});
