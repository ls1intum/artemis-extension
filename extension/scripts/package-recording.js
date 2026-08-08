// Build a LOCAL recording-capable VSIX (recorder ON) from the SOURCE manifest. The
// build refuses to run under CI (resolveBuildVariant guard). The variant is passed via
// the child env so it survives vsce's vscode:prepublish rebuild and works cross-platform
// (no `VAR=value cmd` prefix). Not for CD.
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const env = { ...process.env, IRIS_BUILD_VARIANT: 'local-recording' };
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: root, env, ...opts });

// check-types + lint:src + esbuild --production, variant from env.
run('npm run package');

const hasVsce = (() => {
    try { execSync('vsce --version', { stdio: 'ignore', env }); return true; } catch { return false; }
})();
const vsceCmd = hasVsce ? 'vsce' : 'npx --yes @vscode/vsce@3.9.1';
// Distinct `-recording` output name so a local recording VSIX is never confused with (or
// overwrites) the shippable Desktop VSIX. vsce triggers vscode:prepublish -> npm run
// package, which inherits `env` and stays local-recording.
const pkg = JSON.parse(require('fs').readFileSync(path.join(root, 'package.json'), 'utf8'));
const vsixOut = path.join(root, `${pkg.name}-${pkg.version}-recording.vsix`);
run(`${vsceCmd} package --no-dependencies --out ${vsixOut}`);
console.log(`[package-recording] wrote ${vsixOut}`);
