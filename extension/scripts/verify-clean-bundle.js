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
    'src/extension/services/struggleIntervention/',
    'src/extension/services/recording/',
];

// Excluded code that lives OUTSIDE the forbidden subtrees.
const FORBIDDEN = [
    'src/extension/services/auth/consentService.ts',
    'src/extension/activation/sessionRecorderWiring.ts',
];

// Files under src/webview/views/StruggleDetection/ that ARE allowed in the
// clean bundle: stub.tsx is the no-op the @struggleView alias resolves to;
// types.ts and index.ts are type/re-export only.
const STRUGGLE_VIEW_ALLOWED = ['stub.tsx', 'types.ts', 'index.ts'];
const STRUGGLE_VIEW_PREFIX = 'src/webview/views/StruggleDetection/';

// recharts must never enter the clean bundle (it is a dev-only live-view dep).
const FORBIDDEN_MODULES = ['node_modules/recharts'];

function isForbiddenInput(input) {
    const p = input.replace(/\\/g, '/');
    if (FORBIDDEN_SUBTREES.some(s => p.includes(s))) { return true; }
    if (FORBIDDEN.some(f => p.includes(f))) { return true; }
    if (FORBIDDEN_MODULES.some(m => p.includes(m))) { return true; }
    // Forbid every file under StruggleDetection/ except the three allowed stubs.
    const sdIdx = p.indexOf(STRUGGLE_VIEW_PREFIX);
    if (sdIdx !== -1) {
        const filename = p.slice(sdIdx + STRUGGLE_VIEW_PREFIX.length);
        // Only allow the explicitly whitelisted filenames (no subdirectories).
        if (!STRUGGLE_VIEW_ALLOWED.includes(filename)) { return true; }
    }
    return false;
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
    console.log('OK: clean bundle contains no struggle-engine, intervention, recorder, consent, struggle-view, or recharts inputs');
}

module.exports = { forbiddenInputs, FORBIDDEN, FORBIDDEN_SUBTREES, FORBIDDEN_MODULES, STRUGGLE_VIEW_ALLOWED };
if (require.main === module) { main(); }
