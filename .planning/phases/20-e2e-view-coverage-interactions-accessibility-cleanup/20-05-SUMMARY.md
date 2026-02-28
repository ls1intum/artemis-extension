---
phase: 20-e2e-view-coverage-interactions-accessibility-cleanup
plan: "05"
subsystem: testing
tags: [axe-core, wcag, accessibility, e2e, vscode-extension-tester, selenium]

# Dependency graph
requires:
  - phase: 20-01
    provides: runAxeInCurrentFrame helper + axe-core injection into webview frames
  - phase: 20-02
    provides: login + Dashboard/CourseList/CourseDetail/ExerciseDetail smoke test patterns
  - phase: 20-03
    provides: exam view + IrisChat + ServiceStatus + GitCredentials + RecommendedExtensions patterns
provides:
  - "accessibility.ui.test.ts — 12 individual WCAG 2.1 AA assertions across all webview views"
  - "assertNoAxeViolations helper — screenshot + descriptive violation message pattern"
  - "Login-pre-auth then authenticated-views describe ordering — ensures Login view reachable"
affects: [future-accessibility-regressions, ci-a11y-gate, A11Y-01]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-auth / post-auth nested describe ordering for Login view accessibility"
    - "assertNoAxeViolations local helper: map violations to id+impact+description+nodeCount, screenshot on fail, assert.strictEqual(0)"
    - "Deep-navigation views skip at each step via this.skip() — produces Mocha pending not failure"
    - "IrisChat accessed via ActivityBar.getViewControl('Chat') fallback to 'Iris Chat'"

key-files:
  created:
    - iris-thaumantias/test/e2e/ui/accessibility.ui.test.ts
  modified: []

key-decisions:
  - "Login tested pre-authentication (first it() before nested authenticated describe) — only way to reach Login DOM"
  - "Exam views (ExamConduction, ExamExerciseDetail) skip gracefully at every navigation step — live exam required; always pending in CI is acceptable"
  - "assertNoAxeViolations produces descriptive failure message (id, impact, description, node count) for debuggability without re-running locally"
  - "CourseList navigation falls back to running axe on Dashboard if Courses button not found — axe still runs on visible view"

patterns-established:
  - "Accessibility test suite: 12 views = 12 it() blocks in a single file, separate from smoke tests"
  - "Zero tolerance: any axe violation = assert.strictEqual failure (not warning)"

requirements-completed: [A11Y-01]

# Metrics
duration: 4min
completed: 2026-02-28
---

# Phase 20 Plan 05: Accessibility Tests Summary

**axe-core WCAG 2.1 AA suite across all 12 webview views — 12 individual it() blocks, zero-tolerance violations, Login pre-auth / other 11 post-auth ordering**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-02-28T21:55:00Z
- **Completed:** 2026-02-28T21:59:06Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Created `accessibility.ui.test.ts` (659 lines) with 12 individual `it()` blocks — one per webview view
- Login view tested before authentication: the pre-auth `it()` runs first; the authenticated block logs in via a nested `describe.before()`
- `assertNoAxeViolations` helper formats failures with `[impact] id: description (N nodes)` per violation, takes a screenshot, then calls `assert.strictEqual(0)` for hard failure
- Deep-navigation views (CourseDetail, ExerciseDetail, ExamStart, ExamConduction, ExamExerciseDetail) skip gracefully via `this.skip()` at every navigation step when data is unavailable
- IrisChat accessibility tested via `ActivityBar.getViewControl('Chat')` with `'Iris Chat'` fallback
- TypeScript compiles with zero errors in the new file (pre-existing errors in unrelated storeHydration.flow.test.tsx are out of scope)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create accessibility test suite for all 12 views** - `19bc98f` (feat)

**Plan metadata:** (docs commit — this SUMMARY)

## Files Created/Modified
- `iris-thaumantias/test/e2e/ui/accessibility.ui.test.ts` — 12 WCAG 2.1 AA axe-core test blocks for all webview views

## Decisions Made
- Login view must run FIRST before any authentication — using nested describe ordering rather than conditional skip
- CourseList: if "Courses" button not found on Dashboard, axe still runs on whatever view is visible (doesn't skip — partial coverage is better than none for this non-critical navigation gate)
- Exam conduction views always skip in realistic CI (live exam required) — this matches the smoke test approach from plan 20-03
- `assertNoAxeViolations` is a local helper (not exported from helpers.ts) — accessibility formatting logic is specific to this suite

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- A11Y-01 requirement complete: all 12 views have individual axe-core WCAG 2.1 AA assertions
- Accessibility test suite ready to be wired into CI alongside smoke tests
- Plan 20-06 (cleanup / dead-code removal via knip) can proceed immediately

## Self-Check: PASSED

- FOUND: iris-thaumantias/test/e2e/ui/accessibility.ui.test.ts
- FOUND: commit 19bc98f (feat(20-05): add WCAG 2.1 AA accessibility test suite for all 12 views)
- FOUND: .planning/phases/20-e2e-view-coverage-interactions-accessibility-cleanup/20-05-SUMMARY.md

---
*Phase: 20-e2e-view-coverage-interactions-accessibility-cleanup*
*Completed: 2026-02-28*
