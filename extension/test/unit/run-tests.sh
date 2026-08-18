#!/usr/bin/env bash
set -euo pipefail

# Run the full test pipeline: compile tests, build, lint, then execute tests.
# `test:all` only executes; `pretest` is what compiles out/, builds dist/ and
# lints, and npm does not run it on its own because there is no `test` script.
npm run pretest
npm run test:all
