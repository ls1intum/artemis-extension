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
    const inputs = meta && meta.inputs;
    // Fail-closed: a real esbuild metafile always has a populated `inputs` object. An
    // empty/missing/array `inputs` means the file is malformed or not a metafile at all
    // (e.g. a plain package.json), so refuse it rather than pass vacuously.
    if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs) || Object.keys(inputs).length === 0) {
        throw new Error(`verify-clean-bundle: '${metafilePath}' has no usable 'inputs' (malformed or not an esbuild metafile)`);
    }
    return Object.keys(inputs).filter(input => check(input.replace(/\\/g, '/')));
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
