// Build the FULL (Desktop/Marketplace) variant with the recorder EXCLUDED and package
// it from a staging dir so the source package.json is never mutated. Verifies the
// bundle is recorder-free BEFORE any VSIX is written. Produces <name>-<ver>.vsix.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const staging = path.join(root, 'build', 'desktop-pkg');
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: root, ...opts });

// Build the full variant (recorder off; writes dist/ + non-suffixed metafiles).
run('npm run check-types && npm run lint:src');
run('node esbuild.js --production --variant=full');

// Fail-closed: the Desktop bundle must contain NO recorder/consent code.
run('node scripts/verify-clean-bundle.js --profile=desktop');

fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

for (const entry of ['dist', 'media', 'LICENSE', '.vscodeignore']) {
    const from = path.join(root, entry);
    if (!fs.existsSync(from)) { continue; }
    fs.cpSync(from, path.join(staging, entry), { recursive: true });
}

// README + CHANGELOG are single-sourced at the repo root; copy them so the
// Marketplace listing shows the same description and a Changelog tab.
const repoRoot = path.join(root, '..');
for (const doc of ['README.md', 'CHANGELOG.md']) {
    const from = path.join(repoRoot, doc);
    if (!fs.existsSync(from)) {
        throw new Error(`[package-desktop] expected ${doc} at the repo root (${from}) but it is missing`);
    }
    fs.cpSync(from, path.join(staging, doc));
}

// Generate the clean Desktop manifest into staging (drops recorder + consent, keeps struggle).
run(`node scripts/generate-clean-manifest.js ${path.join(staging, 'package.json')} --profile=desktop`);

// Package from staging. Nothing rebuilds: the staged manifest has no vscode:prepublish.
const pkg = JSON.parse(fs.readFileSync(path.join(staging, 'package.json'), 'utf8'));
const vsixName = `${pkg.name}-${pkg.version}.vsix`;
const vsixOut = path.join(root, vsixName);
const hasVsce = (() => {
    try { execSync('vsce --version', { stdio: 'ignore' }); return true; } catch { return false; }
})();
const vsceCmd = hasVsce ? 'vsce' : 'npx --yes @vscode/vsce@3.9.1';
run(`${vsceCmd} package --no-dependencies --out ${vsixOut}`, { cwd: staging });
console.log(`[package-desktop] wrote ${vsixOut}`);
