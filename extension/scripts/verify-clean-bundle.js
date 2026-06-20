// Fail-closed proof that the Open VSX bundle excludes recorder/consent/replay/struggle-engine.
// Reads the variant metafiles and asserts no forbidden input path is present.
const fs = require('fs');
const path = require('path');

const FORBIDDEN = [
    'src/extension/services/telemetry/recording/',
    'src/extension/services/telemetry/replay/',
    'src/extension/services/auth/consentService.ts',
    'src/extension/activation/sessionRecorderWiring.ts',
    // Struggle-detection webview view — excluded from the clean webview build via @struggleView alias.
    // stub.tsx, types.ts, and index.ts are NOT forbidden (stub is the alias target in openvsx).
    'src/webview/views/StruggleDetection/StruggleDetectionView.tsx',
    'src/webview/views/StruggleDetection/StruggleDetectionView.module.css',
    // Struggle-detection engine — excluded from the clean build via @telemetry/noop.
    'src/extension/services/telemetry/telemetryManager.ts',
    'src/extension/services/telemetry/metrics/',
    'src/extension/services/telemetry/eventPipeline/',
    'src/extension/services/telemetry/decision/',
    'src/extension/services/telemetry/intervention/',
    'src/extension/services/telemetry/interventionService.ts',
    'src/extension/services/telemetry/interventionFilter.ts',
    'src/extension/services/telemetry/buildResultTracker.ts',
    'src/extension/services/telemetry/inactivityService.ts',
    'src/extension/services/telemetry/diagnosticPersistenceService.ts',
    'src/extension/services/telemetry/debugDashboard.ts',
    'src/extension/services/telemetry/buildResultGuard.ts',
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
    console.log('OK: clean bundle contains no recorder/consent/replay or struggle-engine inputs');
}

module.exports = { forbiddenInputs, FORBIDDEN };
if (require.main === module) { main(); }
