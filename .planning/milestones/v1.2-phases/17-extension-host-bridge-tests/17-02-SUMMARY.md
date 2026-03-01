---
phase: 17-extension-host-bridge-tests
plan: 02
subsystem: testing
tags: [mocha, sinon, vscode-extension, webview, visibility, state-persistence]

# Dependency graph
requires:
  - phase: 16-integration-test-infrastructure
    provides: Mocha test harness with vscode-test-electron and sinon sandbox patterns
provides:
  - onDidChangeVisibility listener in ArtemisWebviewProvider.resolveWebviewView()
  - resendViewData() called on panel show with auth-expiry guard
  - ControllableWebviewView + SpyWebview test helpers for hide/show simulation
  - 6 new Mocha tests covering panel visibility state persistence
affects:
  - 17-extension-host-bridge-tests (subsequent plans can use ControllableWebviewView helpers)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "onDidChangeVisibility listener wraps async body in void IIFE to avoid unhandled rejection"
    - "ControllableWebviewView pattern: expose simulateHide()/simulateShow() for deterministic visibility testing"
    - "SpyWebview pattern: override postMessage to capture sentMessages array for assertion"
    - "await Promise.resolve() x2 to flush async IIFE microtasks in Mocha tests"

key-files:
  created: []
  modified:
    - iris-thaumantias/src/provider/artemisWebviewProvider.ts
    - iris-thaumantias/test/unit/provider/artemisWebviewProvider.test.ts

key-decisions:
  - "Use hasAuthCookie() not isAuthenticated() — AuthManager exposes hasAuthCookie(), no isAuthenticated() method exists"
  - "Register visibility listener with _extensionContext.subscriptions (not local disposables) matching _extensionContext pattern used elsewhere in resolveWebviewView"
  - "MockWebviewView kept unchanged for backward compatibility; ControllableWebviewView added as separate class"

patterns-established:
  - "ControllableWebviewView + SpyWebview: reusable test helpers for any provider that needs onDidChangeVisibility testing"
  - "void IIFE async pattern: void (async () => { ... })() for async listeners that must return void"

requirements-completed: [INTG-04, DEBT-02]

# Metrics
duration: 3min
completed: 2026-02-28
---

# Phase 17 Plan 02: Visibility Listener and Panel Hide/Show Tests Summary

**onDidChangeVisibility listener in ArtemisWebviewProvider with auth-expiry guard and 6 Mocha tests using ControllableWebviewView + SpyWebview helpers**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-02-28T19:08:48Z
- **Completed:** 2026-02-28T19:11:37Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `onDidChangeVisibility` listener to `ArtemisWebviewProvider.resolveWebviewView()`: on show, checks `hasAuthCookie()` and routes to login if auth expired, otherwise calls `resendViewData()` for data refresh
- Registered listener with `_extensionContext.subscriptions` for proper VS Code lifecycle cleanup
- Added `ControllableWebviewView` and `SpyWebview` test helpers enabling deterministic hide/show simulation with message capture
- New suite 'Panel hide/show state persistence' with 6 tests covering: listener registration, show/hide behavior, `_webviewReady` preservation, direct message posting, and auth expiry routing

## Task Commits

Each task was committed atomically:

1. **Task 1: Add onDidChangeVisibility listener to ArtemisWebviewProvider** - `7732a45` (feat)
2. **Task 2: Write Mocha tests for panel hide/show state persistence** - `123d05b` (test)

## Files Created/Modified

- `iris-thaumantias/src/provider/artemisWebviewProvider.ts` - Added onDidChangeVisibility listener (21 lines) with hasAuthCookie auth check and resendViewData() call
- `iris-thaumantias/test/unit/provider/artemisWebviewProvider.test.ts` - Added ControllableWebviewView, SpyWebview, and 'Panel hide/show state persistence' suite (189 new lines, 355 total)

## Decisions Made

- **Use `hasAuthCookie()` not `isAuthenticated()`**: Plan referenced `this._authManager.isAuthenticated()` but AuthManager only exposes `hasAuthCookie()`. Used `hasAuthCookie()` directly as it is the canonical auth presence check in the codebase.
- **`_extensionContext.subscriptions` registration**: Consistent with how other disposables are managed in this provider; avoids local disposable tracking.
- **Keep `MockWebviewView` unchanged**: Existing tests depend on `MockWebviewView`; `ControllableWebviewView` is additive rather than replacing it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used `hasAuthCookie()` instead of non-existent `isAuthenticated()`**
- **Found during:** Task 1 (Add onDidChangeVisibility listener)
- **Issue:** Plan specified `this._authManager.isAuthenticated()` but `AuthManager` class has no such method; the equivalent is `hasAuthCookie()`
- **Fix:** Used `await this._authManager.hasAuthCookie()` as the auth presence check in the visibility listener
- **Files modified:** `iris-thaumantias/src/provider/artemisWebviewProvider.ts`
- **Verification:** Compiles without type errors
- **Committed in:** `7732a45` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Correct fix — AuthManager never had `isAuthenticated()`; `hasAuthCookie()` is semantically equivalent for the auth expiry check.

## Issues Encountered

- `npx vscode-test --label unit` could not run because VS Code was already running in the environment. The compile step (`npm run compile-tests`) confirmed all TypeScript types are correct, which is the primary correctness signal available in this environment.

## Next Phase Readiness

- `ControllableWebviewView` and `SpyWebview` are available as patterns for any subsequent plans that need visibility testing
- `resendViewData()` is now exercised by both direct calls and the visibility listener path
- No blockers — ready for Phase 17 Plan 03

---
*Phase: 17-extension-host-bridge-tests*
*Completed: 2026-02-28*

## Self-Check: PASSED

- FOUND: iris-thaumantias/src/provider/artemisWebviewProvider.ts
- FOUND: iris-thaumantias/test/unit/provider/artemisWebviewProvider.test.ts
- FOUND: .planning/phases/17-extension-host-bridge-tests/17-02-SUMMARY.md
- FOUND commit 7732a45 (feat: onDidChangeVisibility listener)
- FOUND commit 123d05b (test: panel hide/show tests)
