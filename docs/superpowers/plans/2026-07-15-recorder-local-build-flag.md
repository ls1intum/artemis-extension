# Recorder Local-Only Build Variant (#336) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exclude the session recorder + data-collection consent from every shipped VSIX (Desktop/Marketplace and Open VSX) while keeping struggle detection in Desktop, and make the recorder a local-only build variant that CI can never produce.

**Architecture:** Replace the two-variant build (`full`/`openvsx`) with three mutually-exclusive variants (`full` = struggle on + recorder off, `openvsx` = both off, `local-recording` = both on, refused under CI), resolved by a pure `resolveBuildVariant.js`. The `@dataCollection` esbuild seam is keyed on the derived `recording` flag (real wrapper vs noop). Manifest generation and bundle verification become fail-closed, profile-parameterized. The Desktop VSIX moves to a staging-based clean packager. Struggle-branch rebase cost is minimized by adding new files and touching shared files minimally.

**Tech Stack:** Node.js CommonJS build scripts, esbuild, `@vscode/vsce`, vitest (logic tests under `test/logic/**`), GitHub Actions.

## Global Constraints

- Working dir for all `npm`/`node` commands: `extension/` (repo root is its parent).
- Logic tests live under `extension/test/logic/**` and run with vitest (`npx vitest run <file>`), NOT vscode-test.
- Dependencies in `package.json` stay pinned to exact versions (no `^`/`~`), except `engines.vscode`.
- No AI/Claude attribution in any commit message, code comment, or doc.
- Commit only the files each task changes (explicit `git add`, never `git add -A`).
- CI detection uses exact string match: `env.GITHUB_ACTIONS === 'true' || env.CI === 'true'`.
- Recorder-forbidden path set must include BOTH the dev layout (`services/telemetry/recording|replay`) and the struggle layout (`services/recording`), and must NOT include the shared `services/sensing/`.
- Verification runs BEFORE any `vsce package` in every packager.

---

## File Structure

**New files:**
- `extension/scripts/resolveBuildVariant.js` — pure variant resolver + fail-safe CI guard.
- `extension/scripts/package-desktop.js` — staging-based clean Desktop packager.
- `extension/scripts/package-recording.js` — local recording VSIX Node wrapper.
- `extension/src/extension/dataCollection/recording.ts` — real seam wrapper that sets the `iris.recorder.active` context key.
- `extension/test/logic/scripts/resolveBuildVariant.test.ts` — variant resolver tests.

**Modified files:**
- `extension/esbuild.js` — use the resolver; key `@dataCollection` on `recording`.
- `extension/scripts/generate-clean-manifest.js` — required-profile switch; drop recorder menu entries; dangling-ref assertion.
- `extension/scripts/verify-clean-bundle.js` — required-profile switch; recorder vs struggle forbidden sets; metafile selection.
- `extension/scripts/package-openvsx.js` — pass `--profile=openvsx`; required pre-stage verify.
- `extension/src/extension/dataCollection/noop.ts` — explicitly set `iris.recorder.active=false`.
- `extension/package.json` — `commandPalette` `when` entries for recorder commands; reword `showInterventions`; `package:vsix`/`package:rec` scripts.
- `extension/test/logic/scripts/generateCleanManifest.test.ts` — profile arg + new cases.
- `extension/test/logic/scripts/verifyCleanBundle.test.ts` — profile arg + new cases.
- `.github/workflows/ci.yml` — Desktop via clean packager; openvsx verify with profile.
- `.github/workflows/release-openvsx.yml` — Marketplace VSIX via clean packager; drop redundant post-verify.
- `.vscode/launch.json` + `.vscode/tasks.json` — "Run Extension (Recording)" config.
- `DEVELOPER.md`, `extension/src/extension/dataCollection/index.ts`, `extension/src/extension.ts` — two-variant → three-variant doc/comment updates.
- `CHANGELOG.md` (repo root) — release-note items.

---

### Task 1: `resolveBuildVariant.js` — pure variant resolver + fail-safe guard

**Files:**
- Create: `extension/scripts/resolveBuildVariant.js`
- Test: `extension/test/logic/scripts/resolveBuildVariant.test.ts`

**Interfaces:**
- Produces: `resolveBuildVariant({ argv, env }) -> { variant: 'full'|'openvsx'|'local-recording', isOpenVsx: boolean, recording: boolean }`. Throws on unknown variant and on `local-recording` under CI. Also exports `VARIANTS: string[]`.

- [ ] **Step 1: Write the failing test**

Create `extension/test/logic/scripts/resolveBuildVariant.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npx vitest run test/logic/scripts/resolveBuildVariant.test.ts`
Expected: FAIL (cannot find `scripts/resolveBuildVariant.js`).

- [ ] **Step 3: Write minimal implementation**

Create `extension/scripts/resolveBuildVariant.js`:

```js
// Pure, testable resolver for the esbuild build variant + derived flags. Three
// mutually-exclusive variants:
//   full             shipped Desktop/Marketplace: struggle on, recorder off
//   openvsx          shipped Open VSX / EduIDE clean: struggle off, recorder off
//   local-recording  local dev only: recorder on; REFUSED under CI (fail-safe)
const VARIANTS = ['full', 'openvsx', 'local-recording'];

function resolveBuildVariant({ argv = [], env = {} } = {}) {
    const flag = argv.find(a => a.startsWith('--variant='));
    const variant = flag ? flag.slice('--variant='.length) : (env.IRIS_BUILD_VARIANT || 'full');
    if (!VARIANTS.includes(variant)) {
        throw new Error(`resolveBuildVariant: unknown variant '${variant}' (expected ${VARIANTS.join(' | ')})`);
    }
    const isCI = env.GITHUB_ACTIONS === 'true' || env.CI === 'true';
    if (variant === 'local-recording' && isCI) {
        throw new Error('resolveBuildVariant: local-recording is a local-only variant and is refused under CI');
    }
    return {
        variant,
        isOpenVsx: variant === 'openvsx',
        recording: variant === 'local-recording',
    };
}

module.exports = { resolveBuildVariant, VARIANTS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && npx vitest run test/logic/scripts/resolveBuildVariant.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/scripts/resolveBuildVariant.js extension/test/logic/scripts/resolveBuildVariant.test.ts
git commit -m "feat(build): add resolveBuildVariant with fail-safe CI guard for #336"
```

---

### Task 2: `generate-clean-manifest.js` — required-profile switch + dangling-ref assertion

**Files:**
- Modify: `extension/scripts/generate-clean-manifest.js`
- Test: `extension/test/logic/scripts/generateCleanManifest.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `cleanManifest(m, profile)` where `profile` is `'desktop'|'openvsx'` (throws otherwise). CLI: `generate-clean-manifest.js <out> --profile=desktop|openvsx`. `desktop` drops the recorder group only (keeps struggle); `openvsx` drops recorder + struggle groups and applies cloud defaults.

- [ ] **Step 1: Write the failing tests**

Replace `extension/test/logic/scripts/generateCleanManifest.test.ts` with:

```ts
import { readFileSync } from 'node:fs';
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && npx vitest run test/logic/scripts/generateCleanManifest.test.ts`
Expected: FAIL (`cleanManifest` ignores the profile arg / throws are missing).

- [ ] **Step 3: Rewrite the generator**

Replace `extension/scripts/generate-clean-manifest.js` with:

```js
// Produce a clean package.json WITHOUT mutating the source manifest. Two fail-closed
// profiles select what is dropped:
//   desktop  drop the recorder group only (struggle detection stays)
//   openvsx  drop recorder + struggle groups and apply cloud/Theia setting defaults
// CLI: generate-clean-manifest.js <out-path> --profile=desktop|openvsx. See docs/adr/002.
const fs = require('fs');
const path = require('path');

// Cloud/Theia-tailored setting defaults (openvsx profile only). See ADR 002.
const CLOUD_SETTING_DEFAULTS = {
    'artemis.startPage': 'workspace-exercise',
    'artemis.showStartPageSuggestion': false,
    'artemis.struggleDetection.enabled': false,
    'artemis.struggleDetection.showInterventions': false,
    'artemis.showSetDefaultClonePathPrompt': false,
};

const RECORDER_COMMANDS = new Set(['artemis.replaySession', 'artemis.openRecordingsFolder']);
const STRUGGLE_COMMANDS = new Set(['artemis.showStruggleScore']);

function dropCommandsAndMenuRefs(m, commandSet) {
    const c = m.contributes || {};
    if (Array.isArray(c.commands)) {
        c.commands = c.commands.filter(cmd => !commandSet.has(cmd.command));
    }
    const cp = c.menus && c.menus.commandPalette;
    if (Array.isArray(cp)) {
        c.menus.commandPalette = cp.filter(e => !commandSet.has(e.command));
    }
}

function dropRecorderGroup(m) {
    const props = m.contributes && m.contributes.configuration && m.contributes.configuration.properties;
    if (props) { delete props['artemis.dataCollectionConsent']; }
    dropCommandsAndMenuRefs(m, RECORDER_COMMANDS);
}

function dropStruggleGroup(m) {
    dropCommandsAndMenuRefs(m, STRUGGLE_COMMANDS);
}

function applyCloudDefaults(m) {
    const props = m.contributes && m.contributes.configuration && m.contributes.configuration.properties;
    for (const [key, value] of Object.entries(CLOUD_SETTING_DEFAULTS)) {
        if (!props || !props[key]) {
            throw new Error(`generate-clean-manifest: cannot override unknown setting '${key}'`);
        }
        props[key].default = value;
    }
}

// Fail-closed hardening: after dropping a command, no remaining menu/keybinding
// contribution may still reference it. `removed` is the exact set that was dropped.
function assertNoDanglingCommandRefs(m, removed) {
    const c = m.contributes || {};
    const refs = [];
    for (const [menuKey, entries] of Object.entries(c.menus || {})) {
        if (!Array.isArray(entries)) { continue; }
        for (const e of entries) {
            // A menu entry can reference a command via `command` OR `alt`.
            if (removed.has(e.command)) { refs.push(`menus.${menuKey}: ${e.command}`); }
            if (removed.has(e.alt)) { refs.push(`menus.${menuKey}.alt: ${e.alt}`); }
        }
    }
    for (const kb of c.keybindings || []) {
        if (removed.has(kb.command)) { refs.push(`keybindings: ${kb.command}`); }
    }
    if (refs.length) {
        throw new Error(`generate-clean-manifest: dangling command refs after drop: ${refs.join(', ')}`);
    }
}

function cleanManifest(m, profile) {
    const removed = new Set();
    switch (profile) {
        case 'desktop':
            dropRecorderGroup(m);
            RECORDER_COMMANDS.forEach(c => removed.add(c));
            break;
        case 'openvsx':
            dropRecorderGroup(m);
            dropStruggleGroup(m);
            applyCloudDefaults(m);
            RECORDER_COMMANDS.forEach(c => removed.add(c));
            STRUGGLE_COMMANDS.forEach(c => removed.add(c));
            break;
        default:
            throw new Error(`generate-clean-manifest: unknown profile '${profile}' (expected desktop | openvsx)`);
    }
    if (m.scripts) { delete m.scripts['vscode:prepublish']; }
    assertNoDanglingCommandRefs(m, removed);
    return m;
}

function main() {
    const args = process.argv.slice(2);
    const outPath = args.find(a => !a.startsWith('--'));
    const profileFlag = args.find(a => a.startsWith('--profile='));
    const profile = profileFlag ? profileFlag.slice('--profile='.length) : undefined;
    if (!outPath) { throw new Error('usage: generate-clean-manifest.js <out-path> --profile=desktop|openvsx'); }
    if (!profile) { throw new Error('generate-clean-manifest: --profile=desktop|openvsx is required'); }

    const srcManifest = path.join(__dirname, '..', 'package.json');
    const m = cleanManifest(JSON.parse(fs.readFileSync(srcManifest, 'utf8')), profile);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(m, null, 2) + '\n');
    console.log(`[clean-manifest] wrote ${outPath} (profile=${profile})`);
}

module.exports = { cleanManifest };
if (require.main === module) { main(); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extension && npx vitest run test/logic/scripts/generateCleanManifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/scripts/generate-clean-manifest.js extension/test/logic/scripts/generateCleanManifest.test.ts
git commit -m "refactor(build): fail-closed profile switch + menu pruning in clean-manifest (#336)"
```

---

### Task 3: `verify-clean-bundle.js` — profile-parameterized fail-closed verifier

**Files:**
- Modify: `extension/scripts/verify-clean-bundle.js`
- Test: `extension/test/logic/scripts/verifyCleanBundle.test.ts`

**Interfaces:**
- Produces: `forbiddenInputs(metafilePath, profile)` where `profile` is `'desktop'|'openvsx'` (throws otherwise). `desktop` forbids the recorder set only (struggle allowed); `openvsx` forbids recorder + struggle. CLI: `verify-clean-bundle.js --profile=desktop|openvsx`.

- [ ] **Step 1: Write the failing tests**

Replace `extension/test/logic/scripts/verifyCleanBundle.test.ts` with:

```ts
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && npx vitest run test/logic/scripts/verifyCleanBundle.test.ts`
Expected: FAIL (`forbiddenInputs` ignores the profile arg).

- [ ] **Step 3: Rewrite the verifier**

Replace `extension/scripts/verify-clean-bundle.js` with:

```js
// Fail-closed proof that a shipped bundle excludes forbidden inputs. Two profiles:
//   desktop  forbids the recorder feature only (struggle detection is ALLOWED)
//   openvsx  forbids the recorder feature AND the struggle engine + struggle view
// Reads the variant metafiles and asserts no forbidden input path is present.
// CLI: verify-clean-bundle.js --profile=desktop|openvsx.
const fs = require('fs');
const path = require('path');

// Recorder feature entry points. Both recorder layouts are listed so the set stays
// correct after the struggle-v3 rebase (dev nests it under services/telemetry/; the
// struggle branch splits it into services/recording/). NOTE: services/sensing/ is the
// SHARED SensorHub used by the Desktop struggle engine and is deliberately NOT here.
const RECORDER_FORBIDDEN = [
    'src/extension/services/telemetry/recording/',
    'src/extension/services/telemetry/replay/',
    'src/extension/services/recording/',
    'src/extension/services/auth/consentService.ts',
    'src/extension/activation/sessionRecorderWiring.ts',
    'src/extension/dataCollection/index.ts',
    'src/extension/dataCollection/recording.ts',
];

// Struggle engine (Open VSX only). On dev the engine is the whole services/telemetry/
// subtree (deny by default, allow types.ts); the struggle branch splits it out.
const TELEMETRY_SUBTREE = 'src/extension/services/telemetry/';
const TELEMETRY_ALLOWED = ['src/extension/services/telemetry/types.ts'];
const STRUGGLE_SUBTREES = [
    'src/extension/services/struggle/',
    'src/extension/services/intervention/',
    'src/extension/services/struggleIntervention/',
];
// The struggle-detection webview lives under this prefix. Only the alias stub and the
// type/re-export files are allowed in the clean bundle; every OTHER file (view, hook,
// nested module) is forbidden. Prefix+allowlist (not an explicit file list) so new view
// files added on the struggle branch are still caught after the rebase.
const STRUGGLE_VIEW_PREFIX = 'src/webview/views/StruggleDetection/';
const STRUGGLE_VIEW_ALLOWED = ['stub.tsx', 'types.ts', 'index.ts'];
const STRUGGLE_MODULES = ['node_modules/recharts'];

function isRecorderForbidden(p) {
    return RECORDER_FORBIDDEN.some(f => p.includes(f));
}

function isStruggleForbidden(p) {
    if (p.includes(TELEMETRY_SUBTREE)) {
        // ...recorder sub-paths under here are already covered by RECORDER_FORBIDDEN.
        return !TELEMETRY_ALLOWED.some(a => p.endsWith(a));
    }
    const viewIdx = p.indexOf(STRUGGLE_VIEW_PREFIX);
    if (viewIdx !== -1) {
        const rest = p.slice(viewIdx + STRUGGLE_VIEW_PREFIX.length);
        return !STRUGGLE_VIEW_ALLOWED.includes(rest); // any nested/other view file is forbidden
    }
    return STRUGGLE_SUBTREES.some(s => p.includes(s))
        || STRUGGLE_MODULES.some(m => p.includes(m));
}

function forbiddenInputs(metafilePath, profile) {
    let check;
    switch (profile) {
        case 'desktop': check = isRecorderForbidden; break;
        case 'openvsx': check = p => isRecorderForbidden(p) || isStruggleForbidden(p); break;
        default: throw new Error(`verify-clean-bundle: unknown profile '${profile}' (expected desktop | openvsx)`);
    }
    const meta = JSON.parse(fs.readFileSync(metafilePath, 'utf8'));
    return Object.keys(meta.inputs || {}).filter(input => check(input.replace(/\\/g, '/')));
}

function main() {
    const profileFlag = process.argv.slice(2).find(a => a.startsWith('--profile='));
    const profile = profileFlag ? profileFlag.slice('--profile='.length) : undefined;
    if (profile !== 'desktop' && profile !== 'openvsx') {
        throw new Error(`verify-clean-bundle: --profile=desktop|openvsx is required (got '${profile}')`);
    }

    const suffix = profile === 'openvsx' ? '-openvsx' : '';
    const root = path.join(__dirname, '..');
    const metas = [`dist/meta-extension${suffix}.json`, `dist/meta-webview${suffix}.json`]
        .map(p => path.join(root, p));
    const hits = metas.flatMap(m => {
        if (!fs.existsSync(m)) { throw new Error(`missing metafile: ${m} (build the ${profile} bundle first)`); }
        return forbiddenInputs(m, profile).map(i => `${path.basename(m)}: ${i}`);
    });
    if (hits.length > 0) {
        console.error(`FAIL (${profile}): forbidden inputs in bundle:\n` + hits.join('\n'));
        process.exit(1);
    }
    console.log(`OK (${profile}): bundle contains no forbidden inputs`);
}

module.exports = { forbiddenInputs, RECORDER_FORBIDDEN };
if (require.main === module) { main(); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extension && npx vitest run test/logic/scripts/verifyCleanBundle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/scripts/verify-clean-bundle.js extension/test/logic/scripts/verifyCleanBundle.test.ts
git commit -m "refactor(build): profile-parameterized fail-closed bundle verifier (#336)"
```

---

### Task 4: esbuild three-variant wiring + `dataCollection/recording.ts` wrapper + noop context key

**Files:**
- Modify: `extension/esbuild.js:6-27`
- Create: `extension/src/extension/dataCollection/recording.ts`
- Modify: `extension/src/extension/dataCollection/noop.ts`
- Modify: `extension/knip.json`
- Modify: `extension/test/react/__helpers__/vscode.stub.ts` (add a `commands` stub)
- Modify: `extension/test/logic/dataCollection/noopSeam.test.ts`

**Interfaces:**
- Consumes: `resolveBuildVariant` (Task 1).
- Produces: builds for `full` (recorder off), `openvsx` (unchanged), `local-recording` (recorder on). Sets/clears the `iris.recorder.active` context key at runtime.

- [ ] **Step 1: Rewrite the esbuild variant block**

In `extension/esbuild.js`, replace the block from `const variantArg = ...` through `console.log(\`[build] variant: ${variant}\`);` (currently lines 9–27) with:

```js
const { resolveBuildVariant } = require('./scripts/resolveBuildVariant');
const { variant, isOpenVsx, recording } = resolveBuildVariant({ argv: process.argv, env: process.env });
const recordingEnabled = String(recording);
const telemetryEnabled = String(!isOpenVsx);
const seamAliases = {
    '@dataCollection': path.join(__dirname, recording
        ? 'src/extension/dataCollection/recording.ts'
        : 'src/extension/dataCollection/noop.ts'),
    '@telemetry': path.join(__dirname, isOpenVsx
        ? 'src/extension/telemetry/noop.ts'
        : 'src/extension/telemetry/index.ts'),
};
const webviewAliases = {
    '@struggleView': path.join(__dirname, isOpenVsx
        ? 'src/webview/views/StruggleDetection/stub.tsx'
        : 'src/webview/views/StruggleDetection/index.ts'),
};
console.log(`[build] variant: ${variant} (recording=${recording})`);
```

(Leave the `const production` / `const watch` lines above it untouched.)

- [ ] **Step 2: Create the recording wrapper**

Create `extension/src/extension/dataCollection/recording.ts`:

```ts
import * as vscode from 'vscode';

import type { CommandMap } from '@extension/controller/commands/types';

import { createRecordingWebviewHandlers as createRealHandlers, wireDataCollection as wireReal } from './index';
import type { DataCollectionDeps, DataCollectionHandle } from './types';

const RECORDER_ACTIVE_KEY = 'iris.recorder.active';

/**
 * Real data-collection seam for the local-recording build variant. Wraps the
 * untouched index.ts wiring and publishes the `iris.recorder.active` context key so
 * the manifest shows recorder commands only when the recorder is actually present.
 */
export function wireDataCollection(deps: DataCollectionDeps): DataCollectionHandle {
    const handle = wireReal(deps);
    void vscode.commands.executeCommand('setContext', RECORDER_ACTIVE_KEY, true);
    let disposed = false;
    return {
        async dispose(): Promise<void> {
            if (disposed) { return; }
            disposed = true;
            try {
                await handle.dispose();
            } finally {
                void vscode.commands.executeCommand('setContext', RECORDER_ACTIVE_KEY, false);
            }
        },
    };
}

export const createRecordingWebviewHandlers: (globalStorageUri: vscode.Uri) => CommandMap = createRealHandlers;
```

- [ ] **Step 3: Update the noop seam to clear the context key**

Replace `extension/src/extension/dataCollection/noop.ts` with:

```ts
import * as vscode from 'vscode';

import type { CommandMap } from '@extension/controller/commands/types';

import type { DataCollectionDeps, DataCollectionHandle } from './types';

const RECORDER_ACTIVE_KEY = 'iris.recorder.active';

/**
 * No-op data-collection seam for the shipped builds (Desktop `full` + Open VSX).
 * Imports nothing from consent/recording, so esbuild keeps that subtree out of the
 * bundle, and explicitly marks the recorder inactive so recorder commands stay hidden.
 */
export function wireDataCollection(_deps: DataCollectionDeps): DataCollectionHandle {
    void vscode.commands.executeCommand('setContext', RECORDER_ACTIVE_KEY, false);
    return {
        async dispose(): Promise<void> {
            void vscode.commands.executeCommand('setContext', RECORDER_ACTIVE_KEY, false);
        },
    };
}

/** No recording webview handlers in the shipped builds. */
export function createRecordingWebviewHandlers(_globalStorageUri: vscode.Uri): CommandMap {
    return {};
}
```

- [ ] **Step 3b: Register the wrapper as a Knip entry**

`recording.ts` is reachable only through the esbuild string alias (TypeScript resolves `@dataCollection` to `index.ts`), so the Knip CI job would report it as unused — exactly like the existing `telemetry/noop.ts` / `StruggleDetection/stub.tsx` entries. In `extension/knip.json`, add `"src/extension/dataCollection/recording.ts"` to the `entry` array:

```json
  "entry": [
    "src/extension.ts",
    "src/webview/index.tsx",
    "src/extension/telemetry/noop.ts",
    "src/extension/dataCollection/recording.ts",
    "src/webview/views/StruggleDetection/stub.tsx",
    "test/**/*.{ts,tsx}",
    ".mocharc.ui.yml",
    ".vscode-test.mjs"
  ],
```

Run: `cd extension && npm run knip`
Expected: no "Unused files" entry for `recording.ts`.

- [ ] **Step 3c: Update the noop-seam test for the new context-key side effect**

`noop.ts` now value-imports `vscode` and calls `vscode.commands.executeCommand`; the shared vitest stub has no `commands`, so the existing `noopSeam.test.ts` would throw. Add a `commands` stub and assert the side effect.

In `extension/test/react/__helpers__/vscode.stub.ts`, add:

```ts
export const commands = {
    executeCommand: async (..._args: unknown[]): Promise<undefined> => undefined,
};
```

Replace `extension/test/logic/dataCollection/noopSeam.test.ts` with:

```ts
import * as vscode from 'vscode';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRecordingWebviewHandlers, wireDataCollection } from '@extension/dataCollection/noop';

describe('no-op data-collection seam', () => {
    afterEach(() => vi.restoreAllMocks());

    it('returns an empty webview handler map', () => {
        expect(createRecordingWebviewHandlers({} as never)).toEqual({});
    });

    it('marks the recorder inactive on wiring and on disposal', async () => {
        const setContext = vi.spyOn(vscode.commands, 'executeCommand');
        const handle = wireDataCollection({} as never);
        expect(setContext).toHaveBeenCalledWith('setContext', 'iris.recorder.active', false);
        setContext.mockClear();
        await expect(handle.dispose()).resolves.toBeUndefined();
        expect(setContext).toHaveBeenCalledWith('setContext', 'iris.recorder.active', false);
    });
});
```

Run: `cd extension && npx vitest run test/logic/dataCollection/noopSeam.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 4: Type-check**

Run: `cd extension && npm run check-types`
Expected: PASS (no errors).

- [ ] **Step 5: Build all three variants and confirm the recorder boundary**

Run:
```bash
cd extension
node esbuild.js --production --variant=full && node scripts/verify-clean-bundle.js --profile=desktop
node esbuild.js --production --variant=openvsx && node scripts/verify-clean-bundle.js --profile=openvsx
node esbuild.js --production --variant=local-recording && grep -c "services/telemetry/recording" dist/meta-extension.json
```
Expected: both `verify-clean-bundle` calls print `OK`; the final `grep -c` prints a non-zero count (recorder present in the local-recording bundle).

- [ ] **Step 6: Confirm the CI guard fails closed**

Run: `cd extension && GITHUB_ACTIONS=true node esbuild.js --variant=local-recording; echo "exit=$?"`
Expected: build aborts with "refused under CI" and `exit=1`.

- [ ] **Step 7: Commit**

```bash
git add extension/esbuild.js extension/src/extension/dataCollection/recording.ts extension/src/extension/dataCollection/noop.ts extension/knip.json extension/test/react/__helpers__/vscode.stub.ts extension/test/logic/dataCollection/noopSeam.test.ts
git commit -m "feat(build): three-variant esbuild wiring + recorder context key (#336)"
```

---

### Task 5: Manifest contributions, npm scripts, and the three packagers

**Files:**
- Modify: `extension/package.json` (`contributes.menus.commandPalette`, `showInterventions` text, `scripts`)
- Create: `extension/scripts/package-desktop.js`
- Create: `extension/scripts/package-recording.js`
- Modify: `extension/scripts/package-openvsx.js`

**Interfaces:**
- Consumes: `generate-clean-manifest.js --profile` (Task 2), `verify-clean-bundle.js --profile` (Task 3), the `local-recording`/`full` variants (Task 4), and the `iris.recorder.active` context key (Task 4).

- [ ] **Step 1: Add recorder `commandPalette` `when` entries**

In `extension/package.json`, inside `contributes.menus.commandPalette` (the array starting at line 109), add these two entries after the existing `artemis.showJwtToken` entry:

```json
        {
          "command": "artemis.replaySession",
          "when": "iris.recorder.active"
        },
        {
          "command": "artemis.openRecordingsFolder",
          "when": "iris.recorder.active"
        }
```

- [ ] **Step 2: Reword the stale `showInterventions` description**

In `extension/package.json`, replace the `markdownDescription` of `artemis.struggleDetection.showInterventions` (line 208) with:

```json
          "markdownDescription": "Show help suggestions when struggle is detected (status bar hint and notification popups). When **disabled**, no UI prompts will appear during struggle. Use this if you prefer to work without interruptions."
```

- [ ] **Step 3: Update the packaging npm scripts**

In `extension/package.json` `scripts`, change `package:vsix` and add `package:openvsx` + `package:rec`:

```json
    "package:vsix": "node scripts/package-desktop.js",
    "package:openvsx": "node scripts/package-openvsx.js",
    "package:rec": "node scripts/package-recording.js",
```

- [ ] **Step 4: Create the Desktop clean packager**

Create `extension/scripts/package-desktop.js`:

```js
// Build the FULL (Desktop/Marketplace) variant with the recorder EXCLUDED and package
// it from a staging dir so the source package.json is never mutated. Verifies the
// bundle is recorder-free BEFORE any VSIX is written. Produces <name>-<ver>.vsix.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const staging = path.join(root, 'build', 'desktop-pkg');
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: root, ...opts });

// 1. Build the full variant (recorder off; writes dist/ + non-suffixed metafiles).
run('npm run check-types && npm run lint:src');
run('node esbuild.js --production --variant=full');

// 1b. Fail-closed: the Desktop bundle must contain NO recorder/consent code.
run('node scripts/verify-clean-bundle.js --profile=desktop');

// 1c. Sync the single-sourced marketplace docs (normally done in vscode:prepublish,
//     which the staged manifest drops).
run('node scripts/sync-marketplace-docs.js');

// 2. Reset the staging dir.
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

// 3. Copy packaged assets + the clean dist into staging.
for (const entry of ['dist', 'media', 'LICENSE', '.vscodeignore']) {
    const from = path.join(root, entry);
    if (!fs.existsSync(from)) { continue; }
    fs.cpSync(from, path.join(staging, entry), { recursive: true });
}

// 3b. README + CHANGELOG are single-sourced at the repo root; copy them so the
//     Marketplace listing shows the same description and a Changelog tab.
const repoRoot = path.join(root, '..');
for (const doc of ['README.md', 'CHANGELOG.md']) {
    const from = path.join(repoRoot, doc);
    if (!fs.existsSync(from)) {
        throw new Error(`[package-desktop] expected ${doc} at the repo root (${from}) but it is missing`);
    }
    fs.cpSync(from, path.join(staging, doc));
}

// 4. Generate the clean Desktop manifest into staging (drops recorder + consent, keeps struggle).
run(`node scripts/generate-clean-manifest.js ${path.join(staging, 'package.json')} --profile=desktop`);

// 5. Package from staging (no rebuild: staged manifest has no vscode:prepublish).
const pkg = JSON.parse(fs.readFileSync(path.join(staging, 'package.json'), 'utf8'));
const vsixName = `${pkg.name}-${pkg.version}.vsix`;
const vsixOut = path.join(root, vsixName);
const hasVsce = (() => {
    try { execSync('vsce --version', { stdio: 'ignore' }); return true; } catch { return false; }
})();
const vsceCmd = hasVsce ? 'vsce' : 'npx --yes @vscode/vsce@3.9.1';
run(`${vsceCmd} package --no-dependencies --out ${vsixOut}`, { cwd: staging });
console.log(`[package-desktop] wrote ${vsixOut}`);
```

- [ ] **Step 5: Create the local recording packager (Node wrapper)**

Create `extension/scripts/package-recording.js`:

```js
// Build a LOCAL recording-capable VSIX (recorder ON) from the SOURCE manifest. The
// build refuses to run under CI (resolveBuildVariant guard). The variant is passed via
// the child env so it survives vsce's vscode:prepublish rebuild and works cross-platform
// (no `VAR=value cmd` prefix). Not for CD.
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const env = { ...process.env, IRIS_BUILD_VARIANT: 'local-recording' };
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: root, env, ...opts });

// check-types + lint:src + esbuild --production, variant from env.
run('npm run package');

const hasVsce = (() => {
    try { execSync('vsce --version', { stdio: 'ignore', env }); return true; } catch { return false; }
})();
const vsceCmd = hasVsce ? 'vsce' : 'npx --yes @vscode/vsce@3.9.1';
// Distinct `-recording` output name so a local recording VSIX is never confused with (or
// overwrites) the shippable Desktop VSIX. vsce triggers vscode:prepublish -> npm run
// package, which inherits `env` and stays local-recording.
const pkg = JSON.parse(require('fs').readFileSync(path.join(root, 'package.json'), 'utf8'));
const vsixOut = path.join(root, `${pkg.name}-${pkg.version}-recording.vsix`);
run(`${vsceCmd} package --no-dependencies --out ${vsixOut}`);
console.log(`[package-recording] wrote ${vsixOut}`);
```

- [ ] **Step 6: Give `package-openvsx.js` its required profile args + pre-stage verify**

In `extension/scripts/package-openvsx.js`, after the openvsx esbuild build line (`run('node esbuild.js --production --variant=openvsx');`) add a required pre-stage verify:

```js
// Fail-closed: abort before staging if any recorder/struggle input leaked in.
run('node scripts/verify-clean-bundle.js --profile=openvsx');
```

And change the manifest generation line to pass the profile:

```js
run(`node scripts/generate-clean-manifest.js ${path.join(staging, 'package.json')} --profile=openvsx`);
```

- [ ] **Step 7: Verify all three packagers**

Run:
```bash
cd extension
node scripts/package-desktop.js && ls *.vsix | grep -vE 'openvsx|recording'
node scripts/package-openvsx.js && ls *-openvsx.vsix
node scripts/package-recording.js && ls *-recording.vsix
```
Expected: `package-desktop.js` and `package-openvsx.js` both finish printing `OK (...)` and produce their distinctly-named VSIX; `package-recording.js` produces `*-recording.vsix` from the source manifest.

- [ ] **Step 8: Confirm the shipped manifests are clean**

Run:
```bash
cd extension && node -e "
const {cleanManifest}=require('./scripts/generate-clean-manifest.js');
const m=cleanManifest(JSON.parse(require('fs').readFileSync('package.json','utf8')),'desktop');
const cmds=m.contributes.commands.map(c=>c.command);
const cp=(m.contributes.menus.commandPalette||[]).map(e=>e.command);
if(cmds.includes('artemis.replaySession')||cp.includes('artemis.replaySession')) throw new Error('recorder leaked into desktop manifest');
if(!cmds.includes('artemis.showStruggleScore')) throw new Error('struggle dropped from desktop manifest');
console.log('desktop manifest OK');
"
```
Expected: prints `desktop manifest OK`.

- [ ] **Step 9: Commit**

```bash
git add extension/package.json extension/scripts/package-desktop.js extension/scripts/package-recording.js extension/scripts/package-openvsx.js
git commit -m "feat(build): desktop clean packager + local recording packager + palette gating (#336)"
```

---

### Task 6: CI + release workflow wiring

**Files:**
- Modify: `.github/workflows/ci.yml:96-101`
- Modify: `.github/workflows/release-openvsx.yml:221-260`

**Interfaces:**
- Consumes: `package-desktop.js` (Task 5), `verify-clean-bundle.js --profile` (Task 3).

- [ ] **Step 1: Update the CI build job**

In `.github/workflows/ci.yml`, replace the four steps at lines 96–101:

```yaml
      - run: npm run package
      - run: npx @vscode/vsce package --no-dependencies
      - name: Build Open VSX (clean) variant
        run: node esbuild.js --production --variant=openvsx
      - name: Verify clean bundle excludes recorder/consent
        run: node scripts/verify-clean-bundle.js
```

with:

```yaml
      - name: Package Desktop VSIX (recorder-free) + verify
        run: node scripts/package-desktop.js
      - name: Build Open VSX (clean) variant
        run: node esbuild.js --production --variant=openvsx
      - name: Verify Open VSX bundle excludes recorder + struggle
        run: node scripts/verify-clean-bundle.js --profile=openvsx
```

- [ ] **Step 2: Update the release build job — Marketplace VSIX via clean packager**

In `.github/workflows/release-openvsx.yml`, remove the now-redundant `- run: npm run package` step (line 221; `package-desktop.js` builds internally), and replace the body of the `Package VSIX` step (id `vsix`, lines 233-248) so it calls the clean packager instead of raw `vsce package`:

```yaml
      - name: Package VSIX
        id: vsix
        run: |
          set -euo pipefail
          node scripts/package-desktop.js
          shopt -s nullglob
          files=( *.vsix )
          if [[ ${#files[@]} -ne 1 ]]; then
            echo "::error::Expected exactly 1 VSIX in extension/, found ${#files[@]}: ${files[*]}"
            exit 1
          fi
          name="${files[0]}"
          sha256=$(sha256sum "$name" | cut -d' ' -f1)
          echo "name=$name" >> "$GITHUB_OUTPUT"
          echo "sha256=$sha256" >> "$GITHUB_OUTPUT"
          echo "Built $name (sha256=$sha256)"
```

(The pinned-vsce install step at lines 226-231 must stay BEFORE this step so `vsce` is on PATH; `package-desktop.js` prefers the on-PATH `vsce`.)

- [ ] **Step 3: Drop the redundant post-package Open VSX verify**

In `.github/workflows/release-openvsx.yml`, the `Package + verify Open VSX (clean) VSIX` step (lines 250-260) runs `node scripts/package-openvsx.js` then `node scripts/verify-clean-bundle.js`. Since `package-openvsx.js` now verifies internally (Task 5 Step 6) and the bare `verify-clean-bundle.js` would throw (missing `--profile`), remove the second line so the step body is:

```yaml
      - name: Package + verify Open VSX (clean) VSIX
        id: openvsx
        run: |
          set -euo pipefail
          node scripts/package-openvsx.js
          name=$(ls *-openvsx.vsix)
          sha256=$(sha256sum "$name" | cut -d' ' -f1)
          echo "name=$name" >> "$GITHUB_OUTPUT"
          echo "sha256=$sha256" >> "$GITHUB_OUTPUT"
          echo "Built $name (sha256=$sha256)"
```

- [ ] **Step 4: Validate the workflow YAML**

Run from the repo root: `python3 -c "import yaml; [yaml.safe_load(open(f)) for f in ['.github/workflows/ci.yml','.github/workflows/release-openvsx.yml']]; print('yaml OK')"` (requires PyYAML; if unavailable, skip — the authoritative gate is CI parsing the workflow on push).
Expected: prints `yaml OK`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/release-openvsx.yml
git commit -m "ci(build): build + gate the Desktop VSIX through the clean packager (#336)"
```

---

### Task 7: Dev ergonomics (F5 recording config) + docs

**Files:**
- Modify: `.vscode/launch.json`, `.vscode/tasks.json`
- Modify: `DEVELOPER.md`, `extension/src/extension/dataCollection/index.ts`, `extension/src/extension.ts`
- Modify: `CHANGELOG.md` (repo root)

**Interfaces:**
- Consumes: the `local-recording` variant (Task 4).

- [ ] **Step 1: Add the recording watch task**

Inject the variant via `options.env` (spec §4.7) and run a one-shot local-recording esbuild BEFORE starting `npm run watch`, so both bundle outputs exist before the extension host launches (a true readiness barrier — `$tsc-watch` alone only tracks tsc, which runs in parallel with esbuild). Reusing the existing `watch` script rather than adding a new `watch:*` npm script avoids the `npm-run-all -p watch:*` wildcard picking it up; `options.env` reaches the one-shot build and every watch child. In `.vscode/tasks.json`, add this task to the `tasks` array:

```json
    {
      "label": "watch (recording) - extension",
      "type": "shell",
      "command": "node esbuild.js && npm run watch",
      "options": {
        "cwd": "${workspaceFolder}/extension",
        "env": { "IRIS_BUILD_VARIANT": "local-recording" }
      },
      "group": "build",
      "isBackground": true,
      "problemMatcher": "$tsc-watch",
      "presentation": { "reveal": "never" }
    }
```

- [ ] **Step 2: Add the recording launch config**

In `.vscode/launch.json`, add this configuration to the `configurations` array:

```json
    {
      "name": "Run Extension (Recording)",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}/extension"
      ],
      "outFiles": [
        "${workspaceFolder}/extension/dist/**/*.js"
      ],
      "preLaunchTask": "watch (recording) - extension"
    }
```

- [ ] **Step 3: Update the two-variant docs/comments to three variants**

In `DEVELOPER.md`, in the "Two VSIX variants" section (heading line 116), rename the heading to "Three build variants" and add a line describing the Desktop `full` variant now excludes the recorder and that `local-recording` is a local-only recorder build (`npm run package:rec` / the "Run Extension (Recording)" launch config), refused under CI. Update the clean-build sentence (line 121) to note the Desktop VSIX is also built by a staging packager (`scripts/package-desktop.js`) that drops the recorder + consent while keeping struggle.

In `extension/src/extension/dataCollection/index.ts`, change the two comments that say "full build only" (lines 12 and 25) to "recording build only" (the seam is now real only for `local-recording`).

In `extension/src/extension.ts`, update the activation comment at line 223 (`// Open VSX build via the @dataCollection alias swap.`) to note the seam is noop for BOTH shipped variants (Desktop `full` + Open VSX) and real only for `local-recording`.

- [ ] **Step 4: Add the changelog release notes**

In the repo-root `CHANGELOG.md`, under the `## [Unreleased]` section, add:

```markdown
- The session recorder and its data-collection consent are now excluded from every shipped build (Desktop/Marketplace and Open VSX). Struggle detection is unaffected on Desktop. The recorder remains available for local development via a dedicated build (`npm run package:rec` or the "Run Extension (Recording)" launch config). The `Artemis: Replay Session` and `Artemis: Open Recordings Folder` commands no longer appear in shipped builds; any existing `artemis.dataCollectionConsent` setting becomes inert (it is not removed from your settings).
```

- [ ] **Step 5: Type-check and lint**

Run: `cd extension && npm run check-types && npm run lint:src`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .vscode/launch.json .vscode/tasks.json DEVELOPER.md extension/src/extension/dataCollection/index.ts extension/src/extension.ts CHANGELOG.md
git commit -m "docs(build): recording launch config + three-variant docs + changelog (#336)"
```

---

## Final verification (run after all tasks)

- [ ] **All logic tests pass:** `cd extension && npx vitest run test/logic/`
- [ ] **Types + lint clean:** `cd extension && npm run check-types && npm run lint`
- [ ] **All three shipped/dev builds + gates:**
```bash
cd extension
node scripts/package-desktop.js       # -> OK (desktop), <name>-<ver>.vsix
# Positive check: the Desktop bundle must STILL contain the struggle engine (spec §5).
# Accept both layouts so this survives the struggle-v3 rebase (dev: telemetryManager; struggle: struggleEngine).
grep -qE "services/telemetry/telemetryManager|services/struggle/struggleEngine" dist/meta-extension.json && echo "struggle present on desktop OK"
node scripts/package-openvsx.js       # -> OK (openvsx), <name>-<ver>-openvsx.vsix
GITHUB_ACTIONS=true node esbuild.js --variant=local-recording; test $? -ne 0 && echo "CI guard OK"
```
- [ ] **Knip (no new dead code):** `cd extension && npm run knip`
- [ ] **Manual F5 palette check:** launch the default "Run Extension" (recorder off); confirm the Command Palette shows neither `Artemis: Replay Session` nor `Artemis: Open Recordings Folder`. Launch "Run Extension (Recording)"; confirm both appear and work.

## Self-review notes (spec coverage)

Every spec section maps to a task: §4.1/§4.2 → Task 1+4; §4.3 → Task 4; §4.4 → Task 2; §4.5 → Task 3; §4.6 → Task 5; §4.7 → Task 4 (seam/key) + Task 5 (menus) + Task 7 (launch); §4.8 → Task 6; §4.9 → Task 5; §4.10 → Tasks 3/5/7; §5 testing → Tasks 1–3; §8 release notes → Task 7. The struggle-branch rebase (§7 of the spec) is a property of the file choices, not a task.

CLI profile parsing + profile→metafile selection for `verify-clean-bundle.js` are exercised end-to-end by the packager runs in Task 5 Step 7 and the Final verification (`package-desktop.js`/`package-openvsx.js` each shell out to `verify-clean-bundle.js --profile=…` against the real metafiles); the unit tests cover the pure `forbiddenInputs`/`cleanManifest` logic and their fail-closed profile guards.
