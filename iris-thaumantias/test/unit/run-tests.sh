#!/usr/bin/env bash
set -euo pipefail

# Run the full test pipeline: compile tests, build, lint, then execute tests.
npm run test:all
