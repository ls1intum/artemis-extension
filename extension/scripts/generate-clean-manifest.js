// Produce a clean package.json WITHOUT mutating the source manifest. Two fail-closed
// profiles select what is dropped:
//   desktop  drop the recorder group only (struggle detection stays)
//   openvsx  drop recorder + struggle + walkthrough groups and apply cloud/Theia setting defaults
// CLI: generate-clean-manifest.js <out-path> --profile=desktop|openvsx. See docs/adr/002 + 003.
const fs = require('fs');
const path = require('path');

// Cloud/Theia-tailored setting defaults (openvsx profile only). See ADR 002.
const CLOUD_SETTING_DEFAULTS = {
    'artemis.startPage': 'workspace-exercise',
    'artemis.showStartPageSuggestion': false,
    'artemis.showSetDefaultClonePathPrompt': false,
};

const RECORDER_COMMANDS = new Set(['artemis.replaySession', 'artemis.openRecordingsFolder']);
// Every command registered in code the Open VSX build drops. The developer commands come from
// the `@telemetry` seam module, which resolves to noop.ts there, so contributing them without
// dropping them advertises a palette entry with no handler behind it. Kept honest by
// "openvsx: contributes no command whose only registration site is dropped from the bundle".
const STRUGGLE_COMMANDS = new Set([
    'artemis.showStruggleScore',
    'artemis.forceStruggleIntervention',
    'artemis.toggleStruggleWarmupSkip',
]);

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
    // The legacy struggle settings were removed from the source manifest (#352), so only
    // the struggle commands remain to drop for the clean build.
    dropCommandsAndMenuRefs(m, STRUGGLE_COMMANDS);
}

// Open VSX only. In EduIDE auth comes from the environment token and the workspace is
// preprovisioned, so every step but "Meet Iris" asks the student to do something that
// is already done for them. This manifest is also what VSCodium and other Open VSX
// clients install into ordinary desktop VS Code (see docs/adr/002), so the drop equally
// means those desktop installs get no tour; `onboarding.ts` guards on whether this
// manifest contributes the walkthrough rather than on `isTheia` alone for that reason.
function dropWalkthroughGroup(m) {
    const c = m.contributes || {};
    delete c.walkthroughs;
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

// `[label](command:some.command)` and `[label](command:some.command?%5B%22arg%22%5D)`.
// The class stops at `?` so an argument payload is not read as part of the id.
const COMMAND_LINK_RE = /\(command:([^)?\s]+)/g;

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
    for (const w of c.walkthroughs || []) {
        for (const s of w.steps || []) {
            for (const [, cmd] of String(s.description || '').matchAll(COMMAND_LINK_RE)) {
                if (removed.has(cmd)) { refs.push(`walkthroughs.${w.id}.${s.id}: ${cmd}`); }
            }
        }
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
            dropWalkthroughGroup(m);
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
