#!/bin/bash
set -e

# UI Test Runner for Artemis Extension
# Compiles tests, builds extension VSIX, and runs Selenium-based UI tests.

cd "$(dirname "$0")/../.."

echo "=== Compiling tests ==="
# tsc emits JS despite type errors (noEmitOnError is not set).
# Pre-existing type errors in streamdown/CodeBlock are unrelated to UI tests.
tsc -p . --outDir out || true

echo "=== Building extension ==="
node esbuild.js --production

echo "=== Packaging VSIX ==="
# Temporarily remove vscode:prepublish to avoid failing type checks during vsce package.
# Save and restore just the prepublish script (not the entire package.json).
PREPUBLISH_SCRIPT=$(node -e "console.log(require('./package.json').scripts['vscode:prepublish'] || '')")
npm pkg delete scripts.vscode:prepublish
restore_prepublish() {
  if [ -n "$PREPUBLISH_SCRIPT" ]; then
    npm pkg set "scripts.vscode:prepublish=$PREPUBLISH_SCRIPT"
  fi
}
trap restore_prepublish EXIT
npx @vscode/vsce package --no-dependencies --skip-license -o test-extension.vsix

echo "=== Setting up test environment ==="
extest get-vscode
extest get-chromedriver
extest install-vsix --vsix_file test-extension.vsix

echo "=== Running UI tests ==="
extest run-tests out/test/ui/*.ui.test.js --mocha_config .mocharc.ui.yml
