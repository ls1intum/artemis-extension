// Copy the single-source user README and CHANGELOG from the repo root into
// extension/ so `vsce package` ships them to the marketplace (vsce only reads these
// from the package dir). Both files are git-ignored under extension/: the repo-root
// copies are the source of truth, and this regenerates the extension/ copies at
// package time. Wired into `vscode:prepublish`, so any vsce package/publish syncs
// first. The clean (Open VSX) build strips vscode:prepublish and copies the same
// repo-root docs itself in package-openvsx.js.
const fs = require('fs');
const path = require('path');

const extDir = path.join(__dirname, '..');
const repoRoot = path.join(extDir, '..');

for (const doc of ['README.md', 'CHANGELOG.md']) {
    const from = path.join(repoRoot, doc);
    if (!fs.existsSync(from)) {
        throw new Error(`[sync-marketplace-docs] expected ${doc} at the repo root (${from}) but it is missing`);
    }
    fs.copyFileSync(from, path.join(extDir, doc));
    console.log(`[sync-marketplace-docs] ${doc} -> extension/${doc}`);
}
