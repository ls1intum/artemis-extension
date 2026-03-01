---
phase: 20-e2e-view-coverage-interactions-accessibility-cleanup
plan: 01
subsystem: testing
tags: [axe-core, knip, accessibility, wcag, selenium, webdriver, devDependencies]

# Dependency graph
requires:
  - phase: 19-e2e-infrastructure-ci
    provides: vscode-extension-tester E2E framework, helpers.ts base, login.ui.test.ts
provides:
  - runAxeInCurrentFrame() WCAG 2.1 AA axe-core injection helper in helpers.ts
  - axe-core devDependency installed
  - knip devDependency installed with knip and knip:exports npm scripts
  - knip.json configuration with correct entry points
  - E2EV-01 Login smoke test confirmed covered and annotated
affects:
  - 20-05 (accessibility tests use runAxeInCurrentFrame)
  - 20-06 (knip cleanup verification uses npm run knip:exports)

# Tech tracking
tech-stack:
  added: [axe-core@^4.11.1, knip@^5.85.0]
  patterns:
    - axe injection via driver.executeScript(AXE_SOURCE) with cached module-load-time read
    - async axe.run via driver.executeAsyncScript with WCAG 2.1 AA tag set

key-files:
  created: []
  modified:
    - iris-thaumantias/test/e2e/ui/helpers.ts
    - iris-thaumantias/test/e2e/ui/login.ui.test.ts
    - iris-thaumantias/package.json
    - iris-thaumantias/package-lock.json

key-decisions:
  - "Use 4 levels of .. from __dirname (out/test/e2e/ui/) to reach package root — plan said 3 but that was incorrect; 4 is required"
  - "Keep existing knip.json (knip@5 schema, ignoreDependencies vscode, ignore esbuild.js) rather than overwriting with plan template — functionally equivalent and more complete"
  - "Cache AXE_SOURCE at module load time to avoid repeated fs.readFileSync calls per test"

patterns-established:
  - "axe injection pattern: cache source at module load, inject via executeScript, run via executeAsyncScript with done callback"

requirements-completed: [E2EV-01, A11Y-01, CLEAN-03]

# Metrics
duration: 2min
completed: 2026-02-28
---

# Phase 20 Plan 01: Axe-core + Knip Setup Summary

**axe-core injection helper (WCAG 2.1 AA) and knip dead-code analysis tooling installed as E2E test infrastructure foundations**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-28T20:41:28Z
- **Completed:** 2026-02-28T20:43:35Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Installed axe-core and knip as devDependencies; added `knip` and `knip:exports` npm scripts
- Added `runAxeInCurrentFrame()` helper to helpers.ts: reads axe.min.js at module load, injects into current iframe via executeScript, runs WCAG 2.1 AA analysis via executeAsyncScript
- Confirmed E2EV-01 (Login view smoke test) covered by existing login.ui.test.ts with 4 tests (view open, login form, field input, screenshot)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install axe-core and knip, add npm scripts** - `cf23534` (chore)
2. **Task 2: Add runAxeInCurrentFrame helper and confirm E2EV-01 coverage** - `3d12dc5` (feat)

## Files Created/Modified

- `iris-thaumantias/package.json` - Added knip and knip:exports scripts; axe-core and knip added to devDependencies by npm install
- `iris-thaumantias/package-lock.json` - Updated with axe-core@4.11.1 and knip@5.85.0 dependency trees
- `iris-thaumantias/test/e2e/ui/helpers.ts` - Added AXE_SOURCE cache and runAxeInCurrentFrame() export
- `iris-thaumantias/test/e2e/ui/login.ui.test.ts` - Added E2EV-01 coverage annotation comment

## Decisions Made

- Used 4 `..` levels in `path.resolve(__dirname, ...)` to reach `node_modules/axe-core/axe.min.js` — the plan specified 3 but compiled output is at `out/test/e2e/ui/` which is 4 levels from the package root, not 3.
- Retained existing `knip.json` (knip@5 schema, `ignoreDependencies: ["vscode"]`, ignore `esbuild.js`) rather than replacing with the plan's template. The existing config is functionally equivalent and more complete (correctly ignores esbuild.js to avoid false positives).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected axe.min.js path depth from 3 to 4 levels**
- **Found during:** Task 2 (runAxeInCurrentFrame implementation)
- **Issue:** Plan specified `path.resolve(__dirname, '..', '..', '..', 'node_modules', ...)` (3 levels up), which would resolve to `out/` not the package root. Compiled output is at `out/test/e2e/ui/helpers.js`, requiring 4 levels.
- **Fix:** Used 4 `..` segments in path.resolve
- **Files modified:** iris-thaumantias/test/e2e/ui/helpers.ts
- **Verification:** TypeScript compilation passes with no errors in helpers.ts
- **Committed in:** 3d12dc5 (Task 2 commit)

**2. [Rule 1 - Bug] Preserved existing knip.json rather than overwriting**
- **Found during:** Task 1 (knip.json creation)
- **Issue:** knip.json already existed with a more complete and correct configuration (knip@5 schema, vscode ignoreDependencies, esbuild.js ignore). Overwriting with plan template would lose these refinements.
- **Fix:** Kept existing knip.json unchanged — it already satisfies all plan requirements
- **Files modified:** None (no change made)
- **Verification:** `npm run knip` and `npm run knip:exports` both execute without crashing

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug)
**Impact on plan:** Both auto-fixes improve correctness. No scope creep.

## Issues Encountered

None beyond the two auto-fixed deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `runAxeInCurrentFrame()` exported from helpers.ts — ready for Plan 05 accessibility tests
- `knip` + `knip:exports` scripts operational — ready for Plan 06 cleanup verification
- E2EV-01 confirmed covered — no new Login test file needed
- Pre-existing TypeScript errors in `storeHydration.flow.test.tsx` (unrelated to this plan's changes) remain; out of scope

---
*Phase: 20-e2e-view-coverage-interactions-accessibility-cleanup*
*Completed: 2026-02-28*
