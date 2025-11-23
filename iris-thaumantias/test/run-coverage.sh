#!/usr/bin/env bash
set -euo pipefail

# Ensure we are in the project root directory
cd "$(dirname "$0")/.."

# Run the full pipeline and produce coverage.
npm run coverage:all

COVERAGE_FILE="coverage/index.html"
if [[ -f "$COVERAGE_FILE" ]]; then
    if command -v open >/dev/null 2>&1; then
        open "$COVERAGE_FILE"
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$COVERAGE_FILE"
    elif command -v wslview >/dev/null 2>&1; then
        wslview "$COVERAGE_FILE"
    else
        echo "Coverage report available at $COVERAGE_FILE"
    fi
else
    echo "Coverage HTML not found at $COVERAGE_FILE"
fi
