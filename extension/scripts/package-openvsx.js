// Build the clean variant and package it from a staging directory so the source
// tree (esp. package.json) is never mutated. Produces <name>-<ver>-openvsx.vsix.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const staging = path.join(root, 'build', 'openvsx-pkg');
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: root, ...opts });

// Build the clean variant (writes dist/).
run('npm run check-types && npm run lint:src');
run('node esbuild.js --production --variant=openvsx');

// Fail-closed: abort before staging if any recorder/struggle input leaked in.
run('node scripts/verify-clean-bundle.js --profile=openvsx');

fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

for (const entry of ['dist', 'media', 'LICENSE', '.vscodeignore']) {
    const from = path.join(root, entry);
    if (!fs.existsSync(from)) { continue; }
    fs.cpSync(from, path.join(staging, entry), { recursive: true });
}

// The user README and CHANGELOG are single-sourced at the repo root (the
// extension/ copies are generated + git-ignored). Copy them in so the Open VSX
// listing shows the same description and a Changelog tab as the marketplace build.
// Fail closed if either is missing: a silently description-less store page is
// worse than a hard stop.
const repoRoot = path.join(root, '..');
for (const doc of ['README.md', 'CHANGELOG.md']) {
    const from = path.join(repoRoot, doc);
    if (!fs.existsSync(from)) {
        throw new Error(`[package-openvsx] expected ${doc} at the repo root (${from}) but it is missing`);
    }
    fs.cpSync(from, path.join(staging, doc));
}

run(`node scripts/generate-clean-manifest.js ${path.join(staging, 'package.json')} --profile=openvsx`);

// Package from staging. Nothing rebuilds: the clean manifest has no vscode:prepublish.
const pkg = JSON.parse(fs.readFileSync(path.join(staging, 'package.json'), 'utf8'));
const vsixName = `${pkg.name}-${pkg.version}-openvsx.vsix`;
const vsixOut = path.join(root, vsixName);
// Prefer the pinned vsce already on PATH (the release workflow installs it under
// RUNNER_TEMP) for deterministic, supply-chain-controlled packaging; fall back to a
// pinned npx for local runs where vsce is not on PATH.
const hasVsce = (() => {
    try { execSync('vsce --version', { stdio: 'ignore' }); return true; } catch { return false; }
})();
const vsceCmd = hasVsce ? 'vsce' : 'npx --yes @vscode/vsce@3.9.1';
run(`${vsceCmd} package --no-dependencies --out ${vsixOut}`, { cwd: staging });
console.log(`[package-openvsx] wrote ${vsixOut}`);
