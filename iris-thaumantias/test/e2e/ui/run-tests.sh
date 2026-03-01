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
restore_prepublish() {
  if [ -n "$PREPUBLISH_SCRIPT" ]; then
    npm pkg set "scripts.vscode:prepublish=$PREPUBLISH_SCRIPT"
  fi
}
trap restore_prepublish EXIT
npx @vscode/vsce package --no-dependencies --skip-license -o test-extension.vsix

echo "=== Phase 4: Setting up test environment ==="
extest get-vscode
extest get-chromedriver
extest install-vsix --vsix_file test-extension.vsix

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

  extest run-tests "$test_file" --mocha_config .mocharc.ui.yml 2>&1 | tee "$log_file"
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
