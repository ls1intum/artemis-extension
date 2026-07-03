// Produce a clean package.json (no consent/struggle settings, no excluded-feature
// commands, no rebuild-on-package hook) and apply the cloud/Theia setting-default
// overrides, WITHOUT mutating the source manifest. CLI writes to argv[2]. See ADR 002/003.
const fs = require('fs');
const path = require('path');

// Cloud/Theia-tailored setting defaults (clean variant only). See ADR 002.
const OPENVSX_SETTING_DEFAULTS = {
    'artemis.startPage': 'workspace-exercise',
    'artemis.showStartPageSuggestion': false,
    'artemis.showSetDefaultClonePathPrompt': false,
};

// Settings whose backing feature is excluded from the clean build. Removed
// ENTIRELY (not just defaulted) so the manifest advertises no absent feature:
// the struggle engine is provably absent from the EduIDE bundle (verify-clean-
// bundle.js), so its settings must not appear either.
const DROPPED_SETTINGS = [
    'artemis.dataCollectionConsent',
    'artemis.struggleDetection.enabled',
    'artemis.struggleDetection.showInterventions',
];

// Commands whose backing feature is excluded from the clean build.
const DROPPED_COMMANDS = new Set([
    'artemis.replaySession',
    'artemis.openRecordingsFolder',
    'artemis.showStruggleScore',
]);

function cleanManifest(m) {
    const props = m.contributes && m.contributes.configuration && m.contributes.configuration.properties;
    if (props) {
        for (const key of DROPPED_SETTINGS) { delete props[key]; }
    }

    for (const [key, value] of Object.entries(OPENVSX_SETTING_DEFAULTS)) {
        if (!props || !props[key]) {
            throw new Error(`generate-clean-manifest: cannot override unknown setting '${key}'`);
        }
        props[key].default = value;
    }

    if (Array.isArray(m.contributes && m.contributes.commands)) {
        m.contributes.commands = m.contributes.commands.filter(c => !DROPPED_COMMANDS.has(c.command));
    }

    if (m.scripts) { delete m.scripts['vscode:prepublish']; }

    return m;
}

function main() {
    const srcManifest = path.join(__dirname, '..', 'package.json');
    const outPath = process.argv[2];
    if (!outPath) { throw new Error('usage: generate-clean-manifest.js <out-path>'); }

    const m = cleanManifest(JSON.parse(fs.readFileSync(srcManifest, 'utf8')));

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(m, null, 2) + '\n');
    console.log(`[clean-manifest] wrote ${outPath}`);
}

module.exports = { cleanManifest };
if (require.main === module) { main(); }
