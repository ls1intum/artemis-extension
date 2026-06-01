// Produce a clean package.json (no consent setting, no recording commands, no
// rebuild-on-package hook) WITHOUT mutating the source manifest. Writes to argv[2].
const fs = require('fs');
const path = require('path');

const srcManifest = path.join(__dirname, '..', 'package.json');
const outPath = process.argv[2];
if (!outPath) { throw new Error('usage: generate-clean-manifest.js <out-path>'); }

const m = JSON.parse(fs.readFileSync(srcManifest, 'utf8'));

const props = m.contributes?.configuration?.properties;
if (props) { delete props['artemis.dataCollectionConsent']; }

const dropCmds = new Set(['artemis.replaySession', 'artemis.openRecordingsFolder']);
if (Array.isArray(m.contributes?.commands)) {
    m.contributes.commands = m.contributes.commands.filter(c => !dropCmds.has(c.command));
}

// Drop the prepublish hook so `vsce package` cannot rebuild/clobber the staged dist/.
if (m.scripts) { delete m.scripts['vscode:prepublish']; }

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(m, null, 2) + '\n');
console.log(`[clean-manifest] wrote ${outPath}`);
