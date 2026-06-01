// Fail-closed proof that the Open VSX bundle excludes recorder/consent/replay.
// Reads the variant metafiles and asserts no forbidden input path is present.
const fs = require('fs');
const path = require('path');

const FORBIDDEN = [
    'src/extension/services/telemetry/recording/',
    'src/extension/services/telemetry/replay/',
    'src/extension/services/auth/consentService.ts',
    'src/extension/activation/sessionRecorderWiring.ts',
];

function forbiddenInputs(metafilePath) {
    const meta = JSON.parse(fs.readFileSync(metafilePath, 'utf8'));
    return Object.keys(meta.inputs || {})
        .filter(input => FORBIDDEN.some(f => input.replace(/\\/g, '/').includes(f)));
}

function main() {
    const root = path.join(__dirname, '..');
    const metas = ['dist/meta-extension-openvsx.json', 'dist/meta-webview-openvsx.json']
        .map(p => path.join(root, p));
    const hits = metas.flatMap(m => {
        if (!fs.existsSync(m)) { throw new Error(`missing metafile: ${m} (build openvsx variant first)`); }
        return forbiddenInputs(m).map(i => `${path.basename(m)}: ${i}`);
    });
    if (hits.length > 0) {
        console.error('FAIL: forbidden inputs in clean bundle:\n' + hits.join('\n'));
        process.exit(1);
    }
    console.log('OK: clean bundle contains no recorder/consent/replay inputs');
}

module.exports = { forbiddenInputs, FORBIDDEN };
if (require.main === module) { main(); }
