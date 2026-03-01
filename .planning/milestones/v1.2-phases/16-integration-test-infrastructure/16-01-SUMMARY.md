---
phase: 16-integration-test-infrastructure
plan: 01
subsystem: testing
tags: [vitest, zustand, react-testing-library, act, store-reset, test-helpers]

# Dependency graph
requires: []
provides:
  - Global Zustand store reset (resetTestState) running before every Vitest test via global beforeEach
  - simulateHandshake() helper for race-condition-safe extension-to-webview bridge simulation using act()
  - Central store registry capturing initial state at import time for all 9 Zustand stores
affects:
  - 17-bridge-message-integration
  - 18-store-integration-tests
  - 19-view-integration-tests
  - 20-e2e-ui-tests

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Capture-at-import store reset: capture Zustand store state at module level at import time, restore with setState(state, true) in beforeEach"
    - "act() wrapping for bridge simulation: all extension-to-webview dispatches wrapped in await act(async () => {}) to ensure React processes updates before assertions"

key-files:
  created:
    - iris-thaumantias/test/react/__helpers__/resetStores.ts
    - iris-thaumantias/test/react/__helpers__/simulateHandshake.ts
  modified:
    - iris-thaumantias/test/react/__helpers__/vitest.setup.ts

key-decisions:
  - "Direct getState() reference (not structuredClone/JSON.parse) for capturing initial store state — safe because Zustand uses immutable updates"
  - "setState(state, true) with replace=true flag to overwrite entire state object, preserving action functions captured in initial snapshot"
  - "configurable:true required on initial acquireVsCodeApi defineProperty so resetTestState() can redefine it on each beforeEach call"

patterns-established:
  - "Store reset pattern: capture-at-import with replace flag — do NOT use JSON.parse or structuredClone, do NOT import stores inside reset function"
  - "Bridge simulation pattern: always await act(async () => { dispatchExtensionMessage(...) }) — never use sync act()"

requirements-completed: [INTG-01]

# Metrics
duration: 7min
completed: 2026-02-28
---

# Phase 16 Plan 01: Integration Test Infrastructure Foundation Summary

**Global Zustand store reset (9 stores, capture-at-import pattern) and race-condition-safe bridge handshake helper wired into Vitest global beforeEach — all 815 tests pass on consecutive runs**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-02-28T12:26:09Z
- **Completed:** 2026-02-28T12:33:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created `resetStores.ts` — captures initial state of all 9 Zustand stores at import time and exports `resetTestState()` that restores them using the replace flag, preventing state leakage between tests
- Created `simulateHandshake.ts` — async helper wrapping `dispatchExtensionMessage` in `await act(async () => {...})` for race-condition-free bridge simulation in integration tests
- Modified `vitest.setup.ts` — added global `beforeEach` calling `resetTestState()`, ensuring every test starts from a clean store state without per-test boilerplate

## Task Commits

Each task was committed atomically:

1. **Task 1: Create store reset registry and bridge handshake helper** - `9e91338` (feat)
2. **Task 2: Wire global beforeEach into vitest.setup.ts** - `3f21980` (feat)

## Files Created/Modified

- `iris-thaumantias/test/react/__helpers__/resetStores.ts` — Central store registry: imports all 9 Zustand stores at module level, captures initial state, exports resetTestState()
- `iris-thaumantias/test/react/__helpers__/simulateHandshake.ts` — Bridge handshake helper: async simulateHandshake(initPayload?) wrapped in act()
- `iris-thaumantias/test/react/__helpers__/vitest.setup.ts` — Added beforeEach(resetTestState) and configurable:true on acquireVsCodeApi property definition

## Decisions Made

- Used direct `store.getState()` reference (not `structuredClone` or `JSON.parse`) for capturing initial store state — safe because Zustand uses immutable state updates; clone would strip action functions
- `setState(state, true)` replace-flag required to overwrite entire state instead of merging, ensuring action functions from the original snapshot are restored correctly
- `configurable: true` required on the initial `acquireVsCodeApi` `Object.defineProperty` call in `vitest.setup.ts` — without it, `resetTestState()` cannot redefine the property on subsequent calls (TypeError: Cannot redefine property)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added configurable:true to initial acquireVsCodeApi defineProperty**
- **Found during:** Task 2 (Wire global beforeEach into vitest.setup.ts)
- **Issue:** Existing `Object.defineProperty(global.window, 'acquireVsCodeApi', { writable: true, ... })` did not include `configurable: true`. The `resetTestState()` function called by `beforeEach` tries to redefine the property on every test, but a non-configurable property cannot be redefined — causing `TypeError: Cannot redefine property: acquireVsCodeApi` and failing all 815 tests
- **Fix:** Added `configurable: true` to the initial property definition in `vitest.setup.ts`
- **Files modified:** `iris-thaumantias/test/react/__helpers__/vitest.setup.ts`
- **Verification:** Full suite 815/815 passing on two consecutive runs
- **Committed in:** `3f21980` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Auto-fix necessary for correctness — plan spec required resetTestState() to re-define acquireVsCodeApi but the initial definition blocked redefinition. No scope creep.

## Issues Encountered

The plan specified `configurable: true` in `resetStores.ts` but did not specify it in the original `vitest.setup.ts` definition. Without that flag, the first `beforeEach` call fails immediately. This was caught during Task 2 test run and fixed inline under Rule 1.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Global store reset infrastructure is in place — Phase 17 bridge message integration tests can be authored without per-test store cleanup boilerplate
- `simulateHandshake()` is available for all bridge tests in Phases 17-19
- The `resetTestState()` per-test resets referenced in existing store tests are now additive (they still work alongside the global reset) — Plan 03 will remove them as specified

## Self-Check: PASSED

- FOUND: iris-thaumantias/test/react/__helpers__/resetStores.ts
- FOUND: iris-thaumantias/test/react/__helpers__/simulateHandshake.ts
- FOUND: iris-thaumantias/test/react/__helpers__/vitest.setup.ts
- FOUND: .planning/phases/16-integration-test-infrastructure/16-01-SUMMARY.md
- FOUND commit: 9e91338 (Task 1)
- FOUND commit: 3f21980 (Task 2)
- Test suite: 66 files / 815 tests passing on two consecutive runs

---
*Phase: 16-integration-test-infrastructure*
*Completed: 2026-02-28*
