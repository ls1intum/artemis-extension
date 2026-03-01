---
phase: 16-integration-test-infrastructure
plan: 03
subsystem: testing
tags: [vitest, zustand, react-testing-library, store-reset, test-cleanup]

# Dependency graph
requires:
  - phase: 16-01
    provides: Global resetTestState() in vitest.setup.ts beforeEach that resets all 9 Zustand stores before every test
provides:
  - All 22 test files (9 store + 8 view + 5 flow) cleaned of redundant default-state beforeEach resets
  - Verified order independence: full suite (876 tests) passes identically on two consecutive runs
  - Global resetTestState() proven as sole mechanism for preventing store state leakage
affects:
  - 17-bridge-message-integration
  - 18-store-integration-tests
  - 19-view-integration-tests
  - 20-e2e-ui-tests

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Remove per-test default-state resets: only beforeEach blocks that set scenario-specific non-default state are retained"
    - "Preserved scenario-specific resets: IrisChatView (isWebSocketConnected: true), irisChat.flow (same), ExamExerciseDetailView (hideDeveloperTools: true), exerciseSubmission.flow (vi.useRealTimers() setup)"

key-files:
  created: []
  modified:
    - iris-thaumantias/test/react/stores/useDashboardStore.test.ts
    - iris-thaumantias/test/react/stores/useNavigationStore.test.ts
    - iris-thaumantias/test/react/stores/useChatStore.test.ts
    - iris-thaumantias/test/react/stores/useCourseListStore.test.ts
    - iris-thaumantias/test/react/stores/useCourseDetailStore.test.ts
    - iris-thaumantias/test/react/stores/useExerciseDetailStore.test.ts
    - iris-thaumantias/test/react/stores/useExamStartStore.test.ts
    - iris-thaumantias/test/react/stores/useExamConductionStore.test.ts
    - iris-thaumantias/test/react/stores/useExamExerciseDetailStore.test.ts
    - iris-thaumantias/test/react/views/Dashboard/DashboardView.test.tsx
    - iris-thaumantias/test/react/views/CourseList/CourseListView.test.tsx
    - iris-thaumantias/test/react/views/CourseDetail/CourseDetailView.test.tsx
    - iris-thaumantias/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx
    - iris-thaumantias/test/react/views/ExamStart/ExamStartView.test.tsx
    - iris-thaumantias/test/react/views/ExamConduction/ExamConductionView.test.tsx
    - iris-thaumantias/test/react/views/ExamExerciseDetail/ExamExerciseDetailView.test.tsx
    - iris-thaumantias/test/react/flows/exerciseSubmission.flow.test.tsx
    - iris-thaumantias/test/react/flows/navigation.flow.test.tsx
    - iris-thaumantias/test/react/flows/courseNavigation.flow.test.tsx
    - iris-thaumantias/test/react/flows/errors.flow.test.tsx

key-decisions:
  - "Keep beforeEach when isWebSocketConnected: true is set — store default is false, so true is scenario-specific and must remain"
  - "ExamExerciseDetailView: keep useExerciseDetailStore reset (hideDeveloperTools: true is non-default) but remove useExamExerciseDetailStore reset (loading: true is the initial state)"
  - "exerciseSubmission.flow: keep beforeEach block but remove store resets — vi.useRealTimers() is non-state setup that must remain"
  - "useExamStartStore/useExamConductionStore/useExamExerciseDetailStore all have loading: true as initial state — their resets were redundant despite looking non-standard"

patterns-established:
  - "Default state identification: always check the store source file to confirm the actual initial value — loading: true stores exist"
  - "Scenario-specific threshold: non-default values that configure all tests in a describe block (e.g., isWebSocketConnected: true in IrisChat suite) are scenario-specific, not boilerplate"

requirements-completed: [INTG-01]

# Metrics
duration: 12min
completed: 2026-02-28
---

# Phase 16 Plan 03: Remove Redundant Store Resets Summary

**Removed per-test default-state resets from 20 test files across store/view/flow layers, proven via two consecutive 876/876 passing runs that global resetTestState() fully prevents store state leakage**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-02-28T13:30:00Z
- **Completed:** 2026-02-28T13:42:00Z
- **Tasks:** 2
- **Files modified:** 20

## Accomplishments

- Removed redundant `beforeEach` store resets from 9 store test files, 8 view test files, and 4 of 5 flow test files (20 files total)
- Preserved scenario-specific resets: `IrisChatView.test.tsx` and `irisChat.flow.test.tsx` retain `isWebSocketConnected: true`; `ExamExerciseDetailView.test.tsx` retains `hideDeveloperTools: true`; `exerciseSubmission.flow.test.tsx` retains `vi.useRealTimers()` call
- Full Vitest suite (876 tests, 67 files) passes identically on two consecutive runs — order independence confirmed

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove redundant store resets from store and view test files** - `1659487` (refactor)
2. **Task 2: Remove redundant store resets from flow test files and verify order independence** - `f6f8b34` (refactor)

## Files Created/Modified

- `iris-thaumantias/test/react/stores/useDashboardStore.test.ts` — Removed beforeEach, removed unused `beforeEach` import
- `iris-thaumantias/test/react/stores/useNavigationStore.test.ts` — Removed beforeEach, removed unused `beforeEach` import
- `iris-thaumantias/test/react/stores/useChatStore.test.ts` — Removed beforeEach, removed unused `beforeEach` import
- `iris-thaumantias/test/react/stores/useCourseListStore.test.ts` — Removed beforeEach, removed unused `beforeEach` import
- `iris-thaumantias/test/react/stores/useCourseDetailStore.test.ts` — Removed beforeEach, removed unused `beforeEach` import
- `iris-thaumantias/test/react/stores/useExerciseDetailStore.test.ts` — Removed beforeEach, removed unused `beforeEach` import
- `iris-thaumantias/test/react/stores/useExamStartStore.test.ts` — Removed beforeEach (`loading: true` is initial state), removed unused `beforeEach` import
- `iris-thaumantias/test/react/stores/useExamConductionStore.test.ts` — Removed beforeEach (`loading: true` is initial state), removed unused `beforeEach` import
- `iris-thaumantias/test/react/stores/useExamExerciseDetailStore.test.ts` — Removed beforeEach (`loading: true` is initial state), removed unused `beforeEach` import
- `iris-thaumantias/test/react/views/Dashboard/DashboardView.test.tsx` — Removed beforeEach, removed unused `beforeEach` import
- `iris-thaumantias/test/react/views/CourseList/CourseListView.test.tsx` — Removed beforeEach, removed unused `beforeEach` import
- `iris-thaumantias/test/react/views/CourseDetail/CourseDetailView.test.tsx` — Removed beforeEach, removed unused `beforeEach` import
- `iris-thaumantias/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx` — Removed beforeEach (both stores were default), removed unused `beforeEach` import
- `iris-thaumantias/test/react/views/ExamStart/ExamStartView.test.tsx` — Removed beforeEach, removed unused `beforeEach` import
- `iris-thaumantias/test/react/views/ExamConduction/ExamConductionView.test.tsx` — Removed beforeEach, removed unused `beforeEach` import
- `iris-thaumantias/test/react/views/ExamExerciseDetail/ExamExerciseDetailView.test.tsx` — Removed useExamExerciseDetailStore reset (default), kept useExerciseDetailStore reset (`hideDeveloperTools: true` is non-default)
- `iris-thaumantias/test/react/flows/exerciseSubmission.flow.test.tsx` — Removed store resets, kept `vi.useRealTimers()`, removed unused `useNavigationStore` import
- `iris-thaumantias/test/react/flows/navigation.flow.test.tsx` — Removed beforeEach, removed unused `beforeEach` import
- `iris-thaumantias/test/react/flows/courseNavigation.flow.test.tsx` — Removed beforeEach (3 stores all default), removed unused `useNavigationStore` import
- `iris-thaumantias/test/react/flows/errors.flow.test.tsx` — Removed beforeEach block in "API error responses in views" describe (useCourseListStore default reset)

## Decisions Made

- `useExamStartStore`, `useExamConductionStore`, and `useExamExerciseDetailStore` have `loading: true` as their actual initial state (confirmed by reading store source files). Their `beforeEach` resets setting `loading: true` were therefore redundant and removed.
- `IrisChatView.test.tsx` and `irisChat.flow.test.tsx` keep their `beforeEach` blocks because `isWebSocketConnected: true` is non-default (store initializes to `false`). These configure the WebSocket-connected scenario for all tests in those files.
- `ExamExerciseDetailView.test.tsx` keeps its `beforeEach` but removes only the `useExamExerciseDetailStore` reset — the `useExerciseDetailStore` reset remains because `hideDeveloperTools: true` is scenario-specific.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Re-added useExamExerciseDetailStore import after incorrect removal**
- **Found during:** Task 1 (after first test run post-edit)
- **Issue:** Removed the `useExamExerciseDetailStore` import when trimming the `beforeEach` block, but the store is still used directly in individual test bodies (`useExamExerciseDetailStore.setState(...)`)
- **Fix:** Re-added the import while keeping the `beforeEach` block streamlined (only `useExerciseDetailStore` reset retained)
- **Files modified:** `iris-thaumantias/test/react/views/ExamExerciseDetail/ExamExerciseDetailView.test.tsx`
- **Verification:** 876/876 tests passing
- **Committed in:** `1659487` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Minor correction during Task 1 execution. No scope creep.

## Issues Encountered

The three exam stores (`useExamStartStore`, `useExamConductionStore`, `useExamExerciseDetailStore`) use `loading: true` as their initial state because exam views render loading skeletons until data arrives. The test files' `beforeEach` blocks all set `loading: true` — which appeared potentially non-default at first but was confirmed redundant by reading the store source files.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 16 complete: global store reset infrastructure verified end-to-end — no per-test default reset boilerplate anywhere
- Phase 17 (bridge message integration tests) and Phase 18 (store integration tests) can be authored without any per-test store cleanup
- Test suite baseline: 876 tests / 67 files, identical results on consecutive runs

## Self-Check: PASSED

- FOUND: iris-thaumantias/test/react/stores/useDashboardStore.test.ts (modified)
- FOUND: iris-thaumantias/test/react/stores/useNavigationStore.test.ts (modified)
- FOUND: iris-thaumantias/test/react/stores/useChatStore.test.ts (modified)
- FOUND: iris-thaumantias/test/react/stores/useCourseListStore.test.ts (modified)
- FOUND: iris-thaumantias/test/react/stores/useCourseDetailStore.test.ts (modified)
- FOUND: iris-thaumantias/test/react/stores/useExerciseDetailStore.test.ts (modified)
- FOUND: iris-thaumantias/test/react/stores/useExamStartStore.test.ts (modified)
- FOUND: iris-thaumantias/test/react/stores/useExamConductionStore.test.ts (modified)
- FOUND: iris-thaumantias/test/react/stores/useExamExerciseDetailStore.test.ts (modified)
- FOUND commit: 1659487 (Task 1)
- FOUND commit: f6f8b34 (Task 2)
- Test suite: 67 files / 876 tests passing on two consecutive runs

---
*Phase: 16-integration-test-infrastructure*
*Completed: 2026-02-28*
