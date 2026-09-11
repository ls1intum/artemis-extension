import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const EXTENSION_ROOT = join(__dirname, '../../..');

// The packaging script is CommonJS and lives outside `src`, so it is loaded the way the packaging
// step loads it. Built from EXTENSION_ROOT rather than written as an upward relative literal, which
// the lint config forbids.
const { cleanManifest } = require(join(EXTENSION_ROOT, 'scripts/generate-clean-manifest.js')) as {
    cleanManifest: (m: unknown, profile: string) => Manifest;
};

type Manifest = { contributes: { configuration: { properties: Record<string, { default?: unknown }> } } };

const manifest = JSON.parse(readFileSync(join(EXTENSION_ROOT, 'package.json'), 'utf8')) as Manifest;
const contributedKeys = Object.keys(manifest.contributes.configuration.properties);

/**
 * The source tree minus the one file that names every setting key whether or not anything
 * reads it. `constants.ts` is the `VSCODE_CONFIG` table: a key listed there and nowhere else
 * is exactly the dead setting this suite is looking for, so it must not count as a reader.
 */
const CONFIG_TABLE = join(EXTENSION_ROOT, 'src/extension/utils/constants.ts');

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { return sourceFiles(full); }
        return /\.tsx?$/.test(entry) && full !== CONFIG_TABLE ? [full] : [];
    });
}

const sources = sourceFiles(join(EXTENSION_ROOT, 'src')).map(f => readFileSync(f, 'utf8'));
const configTable = readFileSync(CONFIG_TABLE, 'utf8');

/**
 * The `VSCODE_CONFIG` member whose value is this key's last segment, if there is one. Most
 * readers go through that constant rather than the literal, so a literal-only search reports
 * live settings as dead.
 */
function configConstantFor(key: string): string | undefined {
    const segment = key.slice(key.lastIndexOf('.') + 1);
    return configTable.match(new RegExp(`(\\w+):\\s*'${segment}'`))?.[1];
}

/**
 * Whether anything outside the `VSCODE_CONFIG` table reads this setting: the key as a quoted
 * string (how the two direct `getConfiguration(...).get('...')` call sites spell it) or the
 * constant that stands for it. Quoted rather than bare, or a setting called `serverUrl` would
 * count every unrelated `serverUrl` property in the codebase as its reader.
 *
 * Deliberately blind to which build a reader survives into: that question belongs to the profile
 * assertions below and to scripts/verify-clean-bundle.js, which checks the bundle itself.
 */
function isRead(key: string): boolean {
    const segment = key.slice(key.lastIndexOf('.') + 1);
    const constant = configConstantFor(key);
    const quoted = [`'${segment}'`, `"${segment}"`, `'${key}'`, `"${key}"`];
    return sources.some(src =>
        quoted.some(q => src.includes(q)) || (constant !== undefined && src.includes(constant)));
}

describe('contributes.configuration', () => {
    // The floor, not a proof: it catches a setting the source no longer mentions at all, which is
    // what a removed feature usually leaves behind. It does NOT catch a setting whose `.get()` is
    // gone while a configuration-change listener or a Settings deep link still names it, so a
    // feature removal still needs reading, not just a green run here.
    it('contributes no setting that nothing in the extension mentions', () => {
        expect(contributedKeys.filter(key => !isRead(key))).toEqual([]);
    });
});

/**
 * What each packaged variant offers the student. A setting reaches the Settings UI whether or
 * not the code behind it is in the bundle, so dropping a feature from a build without dropping
 * its setting leaves an inert switch that still describes the feature. These lists are the
 * record of that decision: change one only together with the seam that makes it true.
 */
describe('build profiles', () => {
    const keysFor = (profile: string) =>
        Object.keys(cleanManifest(JSON.parse(JSON.stringify(manifest)), profile).contributes.configuration.properties);

    it('contributes the recorder consent only in the recording build', () => {
        expect(contributedKeys).toContain('artemis.dataCollectionConsent');
        expect(keysFor('desktop')).not.toContain('artemis.dataCollectionConsent');
        expect(keysFor('openvsx')).not.toContain('artemis.dataCollectionConsent');
    });

    it('contributes the proactive-help consent only where the detection engine is bundled', () => {
        // Open VSX resolves the `@telemetry` seam to noop.ts: nothing reads the setting, no
        // consent prompt fires, and no proactive control is built. Contributing it there offers
        // a switch for local struggle detection the bundle does not contain.
        expect(keysFor('desktop')).toContain('artemis.iris.proactiveCodeEgress');
        expect(keysFor('openvsx')).not.toContain('artemis.iris.proactiveCodeEgress');
    });
});
