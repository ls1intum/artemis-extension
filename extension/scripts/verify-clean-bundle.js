// Fail-closed proof that the Open VSX (EduIDE/cloud) bundle excludes the
// struggle-detection engine, intervention delivery, the session recorder, and
// consent. Reads the variant metafiles and asserts no forbidden input is present.
const fs = require('fs');
const path = require('path');

// The struggle engine + intervention delivery + session recorder are excluded
// from the clean build via the @telemetry and @dataCollection seams. Deny these
// subtrees by DEFAULT (fail-closed): ANY file under them is forbidden. The
// @telemetry contract (src/extension/telemetry/*) is type-only and erased, so it
// never appears as a bundle input.
const FORBIDDEN_SUBTREES = [
    'src/extension/services/struggle/',
    'src/extension/services/intervention/',
    'src/extension/services/recording/',
];

// Excluded code that lives OUTSIDE the forbidden subtrees.
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
    return FORBIDDEN_SUBTREES.some(s => p.includes(s)) || FORBIDDEN.some(f => p.includes(f));
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
    console.log('OK: clean bundle contains no struggle-engine, intervention, recorder, consent, or struggle-view inputs');
}

module.exports = { forbiddenInputs, FORBIDDEN, FORBIDDEN_SUBTREES };
if (require.main === module) { main(); }
