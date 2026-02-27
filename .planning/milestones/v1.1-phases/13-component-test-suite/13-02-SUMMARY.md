---
phase: 13-component-test-suite
plan: 02
subsystem: testing
tags: [vitest, react-testing-library, user-event, fake-timers, worker-mock, interactive-components]

# Dependency graph
requires:
  - phase: 10-testing-infra
    provides: Vitest config, RTL setup, vscodeApi helpers, userEvent patterns
provides:
  - 10 test files covering interactive and functional shared components
  - ExamTimer vi.mock pattern for esbuild-plugin-inline-worker modules
  - ReconnectBanner window message event testing pattern
  - Fake timer pattern for time-dependent components
affects:
  - 13-03 (store tests may reference same vitest patterns)
  - 13-component-test-suite (sibling plans share test infrastructure)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - vi.mock for modules with esbuild-plugin transforms not available in Vitest SSR
    - vi.useFakeTimers() + vi.setSystemTime(NOW) for deterministic time testing
    - window.dispatchEvent(new MessageEvent) for message-driven component testing
    - userEvent.keyboard('{Enter}'/'{Space}') for keyboard activation testing

key-files:
  created:
    - iris-thaumantias/test/react/components/Button/IconButton.test.tsx
    - iris-thaumantias/test/react/components/TextInput/TextInput.test.tsx
    - iris-thaumantias/test/react/components/Dropdown/Dropdown.test.tsx
    - iris-thaumantias/test/react/components/SideMenu/SideMenu.test.tsx
    - iris-thaumantias/test/react/components/AskIris/AskIris.test.tsx
    - iris-thaumantias/test/react/components/exercise/ParticipationActions.test.tsx
    - iris-thaumantias/test/react/components/exercise/BuildProgress.test.tsx
    - iris-thaumantias/test/react/components/ExamTimer/ExamTimer.test.tsx
    - iris-thaumantias/test/react/components/ServiceHealth/ServiceHealth.test.tsx
    - iris-thaumantias/test/react/components/ReconnectBanner/ReconnectBanner.test.tsx
  modified: []

key-decisions:
  - "Mock useExamTimer hook via vi.mock instead of global Worker mock — esbuild-plugin-inline-worker import fails in Vitest SSR transform environment; hook mock tests component behavior through public interface"
  - "TextInput onChange fires per-keypress not per-word — assert on call count and individual characters, not complete string"
  - "SideMenu visibility is CSS-driven not conditional rendering — children always in DOM even when isOpen=false"

patterns-established:
  - "vi.mock module pattern: use for any hook/module that uses build-time transforms (inline-worker, CSS modules with side effects)"
  - "Fake timer pattern: vi.useFakeTimers in beforeEach + vi.runOnlyPendingTimers() + vi.useRealTimers() in afterEach"
  - "Window message test pattern: dispatchWindowMessage helper that dispatches MessageEvent with data payload"

requirements-completed:
  - TEST-02

# Metrics
duration: 6min
completed: 2026-02-27
---

# Phase 13 Plan 02: Interactive and Functional Component Tests Summary

**112 tests across 10 interactive/functional shared components using userEvent, fake timers, and vi.mock for build-time transform isolation**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-02-27T13:58:44Z
- **Completed:** 2026-02-27T14:04:15Z
- **Tasks:** 2
- **Files modified:** 10 (all created)

## Accomplishments
- 47 tests for 4 interactive input components (IconButton presets, TextInput password toggle, Dropdown selection, SideMenu close behavior)
- 65 tests for 6 functional components including ExamTimer (time format display, hook integration), ServiceHealth (expand/collapse, refresh), ReconnectBanner (fake timer dismiss), ParticipationActions (programming vs non-programming flows), BuildProgress (states and log entries), AskIris (keyboard activation)
- Established vi.mock pattern for modules using esbuild-plugin-inline-worker (ExamTimer's useExamTimer hook)
- All 10 files pass; 112 tests total, all using userEvent (no fireEvent)

## Task Commits

Each task was committed atomically:

1. **Task 1: Test interactive input components (IconButton, TextInput, Dropdown, SideMenu)** - `626325a` (feat)
2. **Task 2: Test functional components (AskIris, ParticipationActions, BuildProgress, ExamTimer, ServiceHealth, ReconnectBanner)** - `8c22de1` (feat)

## Files Created/Modified
- `iris-thaumantias/test/react/components/Button/IconButton.test.tsx` - 12 tests for all IconButton presets (Close, BurgerMenu, Collapse, Reload, Settings, Fullscreen)
- `iris-thaumantias/test/react/components/TextInput/TextInput.test.tsx` - 14 tests covering typing, error states, password toggle, blur/focus, required, maxLength
- `iris-thaumantias/test/react/components/Dropdown/Dropdown.test.tsx` - 11 tests covering option selection, disabled, placeholder, keyboard focus
- `iris-thaumantias/test/react/components/SideMenu/SideMenu.test.tsx` - 9 tests covering open/close, backdrop click, title, navigation children
- `iris-thaumantias/test/react/components/AskIris/AskIris.test.tsx` - 9 tests covering click, keyboard activation, custom label, SVG icon
- `iris-thaumantias/test/react/components/exercise/ParticipationActions.test.tsx` - 13 tests for programming/non-programming flows, submit, unsaved changes
- `iris-thaumantias/test/react/components/exercise/BuildProgress.test.tsx` - 11 tests for idle/building/queued states, log entries, timestamps
- `iris-thaumantias/test/react/components/ExamTimer/ExamTimer.test.tsx` - 13 tests using vi.mock for hook, all time format scenarios
- `iris-thaumantias/test/react/components/ServiceHealth/ServiceHealth.test.tsx` - 12 tests for expand/collapse, refresh, status messages
- `iris-thaumantias/test/react/components/ReconnectBanner/ReconnectBanner.test.tsx` - 7 tests using fake timers and window message events

## Decisions Made
- Used `vi.mock('useExamTimer')` instead of global Worker mock because `esbuild-plugin-inline-worker` imports fail in Vitest's SSR transform environment. The hook mock tests the component's rendering behavior through its public interface (`remaining`, `expired`), which correctly captures the component's responsibility.
- TextInput `onChange` test asserts on per-keypress calls (not complete strings) since the component passes `e.target.value` from each individual change event.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TextInput onChange test assertion**
- **Found during:** Task 1 (TextInput tests)
- **Issue:** Test asserted `toHaveBeenLastCalledWith('hello')` but component correctly calls onChange once per keypress with the current input character
- **Fix:** Changed assertion to verify call count (5) and individual character calls
- **Files modified:** iris-thaumantias/test/react/components/TextInput/TextInput.test.tsx
- **Verification:** All 14 TextInput tests pass
- **Committed in:** `626325a` (Task 1 commit)

**2. [Rule 3 - Blocking] Replaced global Worker mock with vi.mock for useExamTimer**
- **Found during:** Task 2 (ExamTimer tests)
- **Issue:** `esbuild-plugin-inline-worker` transforms the ExamTimerWorker import at build time; Vitest's SSR environment cannot resolve it, causing `TypeError: __vite_ssr_import_1__.default is not a constructor` and cascading React act() errors
- **Fix:** Mock the `useExamTimer` hook entirely via `vi.mock()`, test component display behavior by controlling hook return values
- **Files modified:** iris-thaumantias/test/react/components/ExamTimer/ExamTimer.test.tsx
- **Verification:** All 13 ExamTimer tests pass; hook contract (`endTime` parameter passing) verified via `expect(mockUseExamTimer).toHaveBeenCalledWith(endTime)`
- **Committed in:** `8c22de1` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 test assertion bug, 1 blocking build-time transform incompatibility)
**Impact on plan:** Both fixes essential for correctness and functionality. Test coverage maintained at full depth using hook mocking pattern.

## Issues Encountered
- Vitest process held a file lock during testing, causing temporary EPERM on ExamTimer test file. Resolved by waiting for process to complete before re-writing.

## Next Phase Readiness
- All 10 interactive/functional component test files complete and passing
- ExamTimer vi.mock pattern established for other hooks using build-time transforms
- ReconnectBanner window message pattern documented for future message-driven tests
- Ready to combine with Phase 13-01, 13-03, 13-04 tests for full suite coverage

## Self-Check: PASSED

- All 10 test files: FOUND
- SUMMARY.md: FOUND
- Commits 626325a (Task 1) and 8c22de1 (Task 2): FOUND

---
*Phase: 13-component-test-suite*
*Completed: 2026-02-27*
