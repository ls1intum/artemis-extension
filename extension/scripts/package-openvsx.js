// Build the clean variant and package it from a staging directory so the source
// tree (esp. package.json) is never mutated. Produces <name>-<ver>-openvsx.vsix.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const staging = path.join(root, 'build', 'openvsx-pkg');
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: root, ...opts });

// 1. Build the clean variant (writes dist/).
run('npm run check-types && npm run lint:src');
run('node esbuild.js --production --variant=openvsx');

// 2. Reset the staging dir.
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

// 3. Copy packaged assets + the clean dist into staging. (No CHANGELOG: the full
//    build does not ship one either - it lives at the repo root, not extension/.)
for (const entry of ['dist', 'media', 'LICENSE', 'README.md', '.vscodeignore']) {
    const from = path.join(root, entry);
    if (!fs.existsSync(from)) { continue; }
    fs.cpSync(from, path.join(staging, entry), { recursive: true });
}

// 4. Generate the clean manifest into staging.
run(`node scripts/generate-clean-manifest.js ${path.join(staging, 'package.json')}`);

// 5. Package from staging (no rebuild: clean manifest has no vscode:prepublish).
const pkg = JSON.parse(fs.readFileSync(path.join(staging, 'package.json'), 'utf8'));
const vsixName = `${pkg.name}-${pkg.version}-openvsx.vsix`;
const vsixOut = path.join(root, vsixName);
run(`npx --yes @vscode/vsce@3.9.1 package --no-dependencies --out ${vsixOut}`, { cwd: staging });
console.log(`[package-openvsx] wrote ${vsixOut}`);
