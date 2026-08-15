// Fail-closed proof that a shipped bundle excludes forbidden inputs. Two profiles:
//   desktop  forbids the recorder feature only (struggle detection is ALLOWED)
//   openvsx  forbids the recorder feature AND the struggle engine + struggle view
// Reads the variant metafiles and asserts no forbidden input path is present.
// CLI: verify-clean-bundle.js --profile=desktop|openvsx.
const fs = require('fs');
const path = require('path');

// Recorder feature entry points. Both recorder layouts are listed (nested under
// services/telemetry/ and split out into services/recording/) so the set holds either
// way. NOTE: services/sensing/ is the SHARED SensorHub used by the Desktop struggle
// engine and is deliberately NOT here.
const RECORDER_FORBIDDEN = [
    'src/extension/services/telemetry/recording/',
    'src/extension/services/telemetry/replay/',
    'src/extension/services/recording/',
    'src/extension/services/auth/consentService.ts',
    'src/extension/activation/sessionRecorderWiring.ts',
    'src/extension/dataCollection/index.ts',
    'src/extension/dataCollection/recording.ts',
];

// Struggle engine (Open VSX only). The whole services/telemetry/ subtree is denied by
// default with types.ts allowed; the split-out struggle subtrees are denied outright.
const TELEMETRY_SUBTREE = 'src/extension/services/telemetry/';
const TELEMETRY_ALLOWED = ['src/extension/services/telemetry/types.ts'];
const STRUGGLE_SUBTREES = [
    'src/extension/services/struggle/',
    'src/extension/services/intervention/',
    'src/extension/services/struggleIntervention/',
];
// The `@telemetry` seam module itself. esbuild aliases the import to noop.ts for Open VSX, so
// this file is normally unreachable there -- but only for code that goes through the alias. A
// direct `../telemetry/index` import would bypass the seam and pull the wiring (and its
// commands) back in, which nothing else here would notice. The rest of src/extension/telemetry/
// (noop.ts, contract.ts, formatTick.ts, ...) is the seam's shared surface and stays allowed.
const TELEMETRY_SEAM_ENTRY = 'src/extension/telemetry/index.ts';
// The struggle-detection webview lives under this prefix. Only the alias stub and the
// type/re-export files are allowed in the clean bundle; every OTHER file (view, hook,
// nested module) is forbidden. Prefix+allowlist (not an explicit file list) so new view
// files are still caught.
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
    return p.endsWith(TELEMETRY_SEAM_ENTRY)
        || STRUGGLE_SUBTREES.some(s => p.includes(s))
        || STRUGGLE_MODULES.some(m => p.includes(m));
}

/**
 * Is this source path excluded from the given variant's bundle? Exported so other checks
 * (e.g. the clean-manifest test) classify code the same way this verifier does, instead of
 * keeping a second copy of the exclusion rules that drifts from this one.
 */
function isForbiddenInput(inputPath, profile) {
    assertProfile(profile);
    const p = inputPath.replace(/\\/g, '/');
    return profile === 'openvsx'
        ? isRecorderForbidden(p) || isStruggleForbidden(p)
        : isRecorderForbidden(p);
}

function assertProfile(profile) {
    if (profile !== 'desktop' && profile !== 'openvsx') {
        throw new Error(`verify-clean-bundle: unknown profile '${profile}' (expected desktop | openvsx)`);
    }
}

function forbiddenInputs(metafilePath, profile) {
    // Eagerly, so a bad profile is reported as such rather than as a missing metafile.
    assertProfile(profile);
    const check = p => isForbiddenInput(p, profile);
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

module.exports = { forbiddenInputs, isForbiddenInput, RECORDER_FORBIDDEN };
if (require.main === module) { main(); }
