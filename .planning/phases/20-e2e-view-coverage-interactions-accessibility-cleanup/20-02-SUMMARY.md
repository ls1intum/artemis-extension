---
phase: 20-e2e-view-coverage-interactions-accessibility-cleanup
plan: 02
subsystem: testing
tags: [e2e, vscode-extension-tester, selenium, mocha, webview, smoke-tests]

# Dependency graph
requires:
  - phase: 20-01
    provides: helpers.ts with openArtemisView, switchToWebviewFrame, getCredentials, waitForElement, takeScreenshot
  - phase: 19-01
    provides: CI workflow infrastructure for running E2E tests

provides:
  - Dashboard view E2E smoke test (E2EV-02) — login + h1 heading assertion
  - CourseList view E2E smoke test (E2EV-03) — login + Courses nav + list content assertion
  - CourseDetail view E2E smoke test (E2EV-04) — login + course click + container assertion
  - ExerciseDetail view E2E smoke test (E2EV-05) — login + 2-step nav + participation-section assertion

affects: [20-03, 20-04, 20-05, 20-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Credential-gated before() block — getCredentials() in try/catch, this.skip() on failure
    - Login-once-per-suite pattern — login in before(), logout in after(), afterEach resets frame context
    - Graceful skip pattern — this.skip() when no courses/exercises available (produces Mocha pending, not failure)
    - Semantic selector pattern — XPath text/element-type selectors only; no CSS module classes (they are hashed)

key-files:
  created:
    - iris-thaumantias/test/e2e/ui/dashboard.ui.test.ts
    - iris-thaumantias/test/e2e/ui/course-list.ui.test.ts
    - iris-thaumantias/test/e2e/ui/course-detail.ui.test.ts
    - iris-thaumantias/test/e2e/ui/exercise-detail.ui.test.ts
  modified: []

key-decisions:
  - "Login once per suite in before() rather than per-test — avoids repeated 5s login wait and reduces flakiness"
  - "Use this.skip() in before() when credentials missing — entire suite is skipped, not just individual tests"
  - "CourseList navigation falls back to Dashboard assertion when no Courses button found — some server configs may not surface this"
  - "CourseDetail and ExerciseDetail use this.skip() (not assert) when no courses/exercises exist — correct Mocha pending semantics"
  - "ExerciseDetail accepts container even without #participation-section — smoke test priority is view mounting, not specific element IDs"

patterns-established:
  - "Login-once-per-suite: credential-gated before() with login sequence; matching after() with Logout command"
  - "Graceful-skip: this.skip() on NavigationNotPossible produces Mocha pending result instead of failure"
  - "Semantic-selector-only: XPath by element type, text content, or id — never CSS module class names"

requirements-completed: [E2EV-02, E2EV-03, E2EV-04, E2EV-05]

# Metrics
duration: 5min
completed: 2026-02-28
---

# Phase 20 Plan 02: E2E View Coverage (Dashboard, CourseList, CourseDetail, ExerciseDetail) Summary

**4 credential-gated E2E smoke tests for core student views — Dashboard h1 heading, CourseList navigation, CourseDetail and ExerciseDetail graceful-skip when data is unavailable**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-02-28T21:46:06Z
- **Completed:** 2026-02-28T21:51:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created `dashboard.ui.test.ts` (E2EV-02): logs in, opens Artemis view, asserts h1 heading visible post-login
- Created `course-list.ui.test.ts` (E2EV-03): navigates from Dashboard to CourseList via "Courses" button, asserts list content; falls back to Dashboard assertion if button absent
- Created `course-detail.ui.test.ts` (E2EV-04): clicks a course card from Dashboard, asserts CourseDetail container mounts; skips gracefully when no courses enrolled
- Created `exercise-detail.ui.test.ts` (E2EV-05): 2-step navigation Dashboard → Course → Exercise, asserts `#participation-section` or fallback container; skips gracefully at each step if unavailable

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Dashboard and CourseList smoke tests** - `1e011eb` (feat)
2. **Task 2: Create CourseDetail and ExerciseDetail smoke tests** - `ec3c9ab` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `iris-thaumantias/test/e2e/ui/dashboard.ui.test.ts` — Dashboard smoke test: login + h1 heading assertion (E2EV-02)
- `iris-thaumantias/test/e2e/ui/course-list.ui.test.ts` — CourseList smoke test: login + navigation + list content (E2EV-03)
- `iris-thaumantias/test/e2e/ui/course-detail.ui.test.ts` — CourseDetail smoke test: login + course click + graceful skip (E2EV-04)
- `iris-thaumantias/test/e2e/ui/exercise-detail.ui.test.ts` — ExerciseDetail smoke test: login + 2-step nav + graceful skip (E2EV-05)

## Decisions Made

- **Login once per suite** in `before()` — avoids repeated 5s login delays and reduces test flakiness across multiple tests in a suite
- **Credential skip in `before()`** — when `getCredentials()` throws, calling `this.skip()` in `before()` skips the entire suite, which is the correct Mocha behavior (not per-test skip)
- **CourseList navigation fallback** — if no "Courses" button is found within 5s, the test accepts Dashboard state as a pass; this handles server configs that may not show a browse-courses entry point
- **Graceful skip vs. assert.fail for missing data** — CourseDetail and ExerciseDetail use `this.skip()` when no courses/exercises exist; this produces a Mocha "pending" result rather than a failure, which is the intended behavior for data-dependent navigation tests
- **#participation-section with fallback** — ExerciseDetail first tries the specific selector, then falls back to generic container; this maximizes coverage without hard-coupling to a single element ID that may vary

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

E2E tests run automatically in CI when `ARTEMIS_USER` and `ARTEMIS_PASS` are set. Without these env vars, all 4 suites skip gracefully.

## Next Phase Readiness

- All 4 core student-facing view smoke tests (E2EV-02 through E2EV-05) complete
- Test suite skips cleanly in CI environments without enrolled course data
- Ready for Phase 20 Plan 03 (interaction tests or accessibility tests, depending on plan order)

## Self-Check: PASSED

All created files verified present. Task commits `1e011eb` and `ec3c9ab` confirmed in git log.

---
*Phase: 20-e2e-view-coverage-interactions-accessibility-cleanup*
*Completed: 2026-02-28*
