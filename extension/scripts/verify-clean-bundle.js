// Fail-closed proof that the Open VSX bundle excludes recorder/consent/replay/struggle-engine.
// Reads the variant metafiles and asserts no forbidden input path is present.
const fs = require('fs');
const path = require('path');

// The whole telemetry-engine subtree (struggle detection, metrics, intervention,
// session recorder, replay, URI filtering) is excluded from the clean Open VSX
// build via the @telemetry seam. Deny the entire subtree by DEFAULT (fail-closed):
// any file under it is forbidden unless explicitly allowlisted. This replaces an
// earlier hand-picked denylist that silently let unlisted files (e.g. uriFilter.ts)
// through if they were ever pulled into the clean bundle.
const TELEMETRY_SUBTREE = 'src/extension/services/telemetry/';
const TELEMETRY_ALLOWED = [
    // Shared type + config declarations only (no engine/recorder/consent logic).
    'src/extension/services/telemetry/types.ts',
];

// Excluded code that lives OUTSIDE the telemetry subtree.
const FORBIDDEN = [
    'src/extension/services/auth/consentService.ts',
    'src/extension/activation/sessionRecorderWiring.ts',
    // Struggle-detection webview view, excluded via the @struggleView alias.
    // stub.tsx, types.ts, and index.ts are NOT forbidden (stub is the alias target).
    'src/webview/views/StruggleDetection/StruggleDetectionView.tsx',
    'src/webview/views/StruggleDetection/StruggleDetectionView.module.css',
];

function isForbiddenInput(input) {
    const p = input.replace(/\\/g, '/');
    if (p.includes(TELEMETRY_SUBTREE)) {
        return !TELEMETRY_ALLOWED.some(allowed => p.includes(allowed));
    }
    return FORBIDDEN.some(f => p.includes(f));
}

function forbiddenInputs(metafilePath) {
    const meta = JSON.parse(fs.readFileSync(metafilePath, 'utf8'));
    return Object.keys(meta.inputs || {}).filter(isForbiddenInput);
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
    console.log('OK: clean bundle contains no recorder/consent/replay, struggle-engine, or struggle-view inputs');
}

module.exports = { forbiddenInputs, FORBIDDEN };
if (require.main === module) { main(); }
