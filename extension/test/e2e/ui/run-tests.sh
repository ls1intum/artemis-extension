#!/bin/bash
set -e

# UI Test Runner for Artemis Extension
# Compiles tests, builds extension VSIX, and runs Selenium-based UI tests.
# Each test file gets its own VS Code + ChromeDriver instance for isolation.

cd "$(dirname "$0")/../../.."

# Load credentials from .env if present (never committed — listed in .gitignore)
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

echo "=== Phase 1: Compiling tests ==="
# tsc emits JS despite type errors (noEmitOnError is not set).
# Pre-existing type errors in streamdown/CodeBlock are unrelated to UI tests.
tsc -p . --outDir out || true

echo "=== Phase 2: Building extension ==="
node esbuild.js --production

echo "=== Phase 3: Packaging VSIX ==="
# Temporarily remove vscode:prepublish to avoid failing type checks during vsce package.
# Save and restore just the prepublish script (not the entire package.json).
PREPUBLISH_SCRIPT=$(node -e "console.log(require('./package.json').scripts['vscode:prepublish'] || '')")
npm pkg delete scripts.vscode:prepublish
TMP_SETTINGS=""
cleanup() {
  if [ -n "$PREPUBLISH_SCRIPT" ]; then
    npm pkg set "scripts.vscode:prepublish=$PREPUBLISH_SCRIPT"
  fi
  if [ -n "$TMP_SETTINGS" ] && [ -f "$TMP_SETTINGS" ]; then
    rm -f "$TMP_SETTINGS"
  fi
}
trap cleanup EXIT
npx @vscode/vsce package --no-dependencies --skip-license -o test-extension.vsix

echo "=== Phase 4: Setting up test environment ==="
extest get-vscode
extest get-chromedriver
extest install-vsix --vsix_file test-extension.vsix

# Compose the final settings.json passed to each `extest run-tests`. By
# default we use the committed `code-settings.json` unchanged. If
# ARTEMIS_URL is set (typically from .env), we splice it in as
# `artemis.serverUrl` so contributors can switch between test servers
# without editing the committed file. See .env.example.
SETTINGS_FILE="test/e2e/ui/code-settings.json"
if [ -n "${ARTEMIS_URL:-}" ]; then
  TMP_SETTINGS=$(mktemp "${TMPDIR:-/tmp}/code-settings.XXXXXX.json")
  SETTINGS_FILE="$SETTINGS_FILE" TMP_SETTINGS="$TMP_SETTINGS" node -e "
    const fs = require('fs');
    const settings = JSON.parse(fs.readFileSync(process.env.SETTINGS_FILE, 'utf8'));
    settings['artemis.serverUrl'] = process.env.ARTEMIS_URL;
    fs.writeFileSync(process.env.TMP_SETTINGS, JSON.stringify(settings, null, 4));
  "
  SETTINGS_FILE="$TMP_SETTINGS"
  echo "Using ARTEMIS_URL=${ARTEMIS_URL} from environment"
fi

echo "=== Phase 5: Running UI tests (isolated per file) ==="
mkdir -p reports/ui

PASS=0
FAIL=0
FAILED_FILES=()

set +e
for test_file in out/test/e2e/ui/*.ui.test.js; do
  name=$(basename "$test_file" .ui.test.js)
  log_file="reports/ui/${name}.log"

  echo ""
  echo "--- Running: ${name} ---"

  # --code_settings disables the GitHub Copilot Chat first-run modal
  # ("Welcome to VS Code / Sign in to continue") that ships built-in with
  # recent VS Code builds (observed since 1.116) and blocks Selenium from
  # reaching extension elements. The load-bearing setting is
  # `workbench.welcomePage.experimentalOnboarding: false`, identified via
  # redhat-developer/vscode-extension-tester#2345. See issue #176.
  extest run-tests "$test_file" --mocha_config .mocharc.ui.yml --code_settings "$SETTINGS_FILE" 2>&1 | tee "$log_file"
  rc=${PIPESTATUS[0]}

  if [ $rc -eq 0 ]; then
    echo "--- PASS: ${name} ---"
    PASS=$((PASS + 1))
  else
    echo "--- FAIL: ${name} (exit $rc) ---"
    FAIL=$((FAIL + 1))
    FAILED_FILES+=("$name")
  fi
done
set -e

TOTAL=$((PASS + FAIL))

echo ""
echo "==============================="
echo "  UI Test Summary"
echo "==============================="
echo "  Total : ${TOTAL}"
echo "  Passed: ${PASS}"
echo "  Failed: ${FAIL}"

if [ ${#FAILED_FILES[@]} -gt 0 ]; then
  echo ""
  echo "  Failed tests:"
  for f in "${FAILED_FILES[@]}"; do
    echo "    - ${f}"
  done
fi

echo "==============================="
echo "  Logs in: reports/ui/"
echo "==============================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
