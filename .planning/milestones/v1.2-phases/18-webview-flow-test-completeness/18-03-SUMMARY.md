---
phase: 18-webview-flow-test-completeness
plan: "03"
subsystem: webview-react
tags: [error-handling, exam-views, message-handler, vitest]
dependency_graph:
  requires: []
  provides: [exam-fetch-error-visibility, error-retry-flow]
  affects: [ExamStartView, ExamConductionView]
tech_stack:
  added: []
  patterns: [extension-message-error-handler, store-setError-dispatch]
key_files:
  created: []
  modified:
    - iris-thaumantias/src/views/webview/react/views/ExamStart/ExamStartView.tsx
    - iris-thaumantias/src/views/webview/react/views/ExamConduction/ExamConductionView.tsx
    - iris-thaumantias/test/react/views/ExamStart/ExamStartView.test.tsx
    - iris-thaumantias/test/react/views/ExamConduction/ExamConductionView.test.tsx
decisions:
  - "ExamConductionView retry now calls store.setError(null) + store.setLoading(true) before postMessage ready — transitions back to loading skeleton while re-fetching"
  - "Error handler checks typedMessage.payload truthy before destructuring to avoid errors on malformed messages"
metrics:
  duration: "~2 min"
  tasks_completed: 2
  files_modified: 4
  tests_added: 4
  tests_total: 880
  completed_date: "2026-02-28"
requirements_satisfied: [DEBT-04]
---

# Phase 18 Plan 03: Exam Fetch Error Visibility Summary

**One-liner:** Wire `{ type: 'error' }` message handler in ExamStartView and ExamConductionView so extension host failures display an actionable error + retry button instead of infinite loading.

## What Was Built

Both exam views previously ignored `error` messages from the extension host — users would stay on the loading skeleton indefinitely when an exam fetch failed. This plan closes that gap:

- `ExamStartView.handleMessage` now handles `type === 'error'` by calling `setError(payload.message)`, which sets `loading: false` via the store action and transitions the view to the `ErrorMessage` component with retry button.
- `ExamConductionView.handleMessage` now handles `type === 'error'` the same way via `store.setError(payload.message)`.
- `ExamConductionView` retry was missing `store.setError(null)` and `store.setLoading(true)` — added both so clicking retry transitions back to loading skeleton while the ready signal triggers a re-fetch.
- 4 new tests prove the full error-display and retry flow for both views.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Wire error message handler in ExamStartView and ExamConductionView | cbf4bbf | ExamStartView.tsx, ExamConductionView.tsx |
| 2 | Add exam error flow tests to ExamStartView and ExamConductionView test files | f185371 | ExamStartView.test.tsx, ExamConductionView.test.tsx |

## Decisions Made

- **ExamConductionView retry fix (Rule 1 - Bug):** The existing retry in ExamConductionView only sent `{ type: 'ready' }` but did not clear error state or set loading. Added `store.setError(null)` and `store.setLoading(true)` to correctly transition back to loading state before re-fetching. This was identified in the plan's action spec.
- Error handler guards with `typedMessage.payload` truthy check before destructuring — consistent with the existing `examConductionInit` handler pattern.

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- `cd iris-thaumantias && npx tsc --noEmit` — passes with zero errors
- `npm run test:react -- test/react/views/ExamStart/ --reporter=verbose` — ExamStartView error tests pass
- `npm run test:react -- test/react/views/ExamConduction/ --reporter=verbose` — ExamConductionView error tests pass
- `npm run test:react` — 880 tests, 67 files, all green, no regressions

## Self-Check

Files exist:
- [x] iris-thaumantias/src/views/webview/react/views/ExamStart/ExamStartView.tsx — modified
- [x] iris-thaumantias/src/views/webview/react/views/ExamConduction/ExamConductionView.tsx — modified
- [x] iris-thaumantias/test/react/views/ExamStart/ExamStartView.test.tsx — modified
- [x] iris-thaumantias/test/react/views/ExamConduction/ExamConductionView.test.tsx — modified

Commits exist:
- [x] cbf4bbf — feat(18-03): wire error message handler
- [x] f185371 — test(18-03): add exam fetch error flow tests

## Self-Check: PASSED
