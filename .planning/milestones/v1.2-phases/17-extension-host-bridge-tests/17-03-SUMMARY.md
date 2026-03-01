---
phase: 17-extension-host-bridge-tests
plan: "03"
subsystem: extension-host-tests
tags: [testing, mocha, sinon, webview-bridge, command-dispatch]
dependency_graph:
  requires: []
  provides: [webViewMessageHandler-test-coverage]
  affects: [iris-thaumantias/test/unit/views/app/]
tech_stack:
  added: []
  patterns: [sinon-sandbox, tdd-green, private-field-injection-via-any, command-map-inspection]
key_files:
  created:
    - iris-thaumantias/test/unit/views/app/webViewMessageHandler.test.ts
  modified: []
decisions:
  - "Use (handler as any).commandHandlers.set() to inject controlled test handlers for sender-swap tests without needing real command implementations"
  - "Stub all vscode.window and vscode.commands APIs in setup() to prevent UI side effects and avoid cross-test contamination"
  - "Construct real AuthManager/ArtemisApiService/AppStateManager rather than mocks to verify module initialization works end-to-end"
metrics:
  duration_seconds: 180
  completed_date: "2026-02-28"
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 0
---

# Phase 17 Plan 03: WebViewMessageHandler handleMessageWithSender Tests Summary

Mocha tests for `WebViewMessageHandler.handleMessageWithSender()` verifying sender-swap-and-restore mechanism, command dispatch routing, and error recovery using sinon stubs.

## Objective

Write tests for the critical host-side bridge seam: `handleMessageWithSender()` temporarily overrides `_sendMessage` so responses target the correct webview panel (important for fullscreen panels coexisting with the sidebar).

## What Was Built

### Test File: `webViewMessageHandler.test.ts` (238 lines)

**Suite: `WebViewMessageHandler - handleMessageWithSender`**

**Sender swap mechanism (3 tests):**
- `uses provided sender during call` — injects a capture handler that reads `(handler as any)._sendMessage` and calls it; asserts the override sender received the call, not the original
- `restores original sender after call completes` — sets original sender, calls with override, asserts `(handler as any)._sendMessage === originalSender` afterward
- `restores original sender even when handler throws` — injects a failing handler, calls with override, verifies original is restored (tests the `finally` block in `handleMessageWithSender`)

**Command dispatch (3 tests):**
- `routes command-type messages via the command field` — injects handler for key `testRoute`, sends `{type: 'command', command: 'testRoute'}`, asserts handler called
- `routes non-command messages via the type field` — injects handler for key `customType`, sends `{type: 'customType'}`, asserts handler called
- `unknown command does not crash` — sends nonexistent command, asserts no exception thrown

**Real command module integration (1 test):**
- `registered handlers include representative commands from all 7 modules` — inspects `commandHandlers` Map, asserts presence of `login`, `logout`, `browseCourses`, `viewCourseDetails`, `cloneRepository`, `submitExercise`, `askIrisAboutExercise`

## Test Results

All 7 new tests pass. The 20 pre-existing failures in `WebSocketStatusBarService` and `chatContextManager` are unrelated to this plan.

**Total test count:** 539 passing (unit suite, excluding pre-existing failures)

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `webViewMessageHandler.test.ts` exists in `test/unit/views/app/` (238 lines, > 100 minimum)
- Sender swap mechanism fully tested (override used during call, original restored after, restored on throw)
- Command dispatch routing verified for both `{type: 'command', command: ...}` and direct `{type: ...}` formats
- Unknown command handling verified: no crash, graceful return
- All 7 command modules confirmed to initialize and register handlers in test environment

## Self-Check: PASSED

- `/Users/liamberger/Documents/private/artemis-extension/iris-thaumantias/test/unit/views/app/webViewMessageHandler.test.ts` — FOUND
- Commit `0ea0e10` — FOUND
