// Produce a clean package.json (no consent setting, no recording commands, no
// rebuild-on-package hook) and apply the cloud/Theia setting-default overrides,
// WITHOUT mutating the source manifest. CLI writes to argv[2]. See docs/adr/002.
const fs = require('fs');
const path = require('path');

// Cloud/Theia-tailored setting defaults (clean variant only). See ADR 002.
// NOTE: the two struggleDetection.* entries are temporary — remove them once the
// cloud intervention pipeline is live.
const OPENVSX_SETTING_DEFAULTS = {
    'artemis.startPage': 'workspace-exercise',
    'artemis.showStartPageSuggestion': false,
    'artemis.struggleDetection.enabled': false,
    'artemis.struggleDetection.showInterventions': false,
    'artemis.showSetDefaultClonePathPrompt': false,
};

// Commands whose backing feature is excluded from the clean build.
const DROPPED_COMMANDS = new Set([
    'artemis.replaySession',
    'artemis.openRecordingsFolder',
    'artemis.showStruggleScore',
]);

function cleanManifest(m) {
    const props = m.contributes && m.contributes.configuration && m.contributes.configuration.properties;
    if (props) { delete props['artemis.dataCollectionConsent']; }

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
