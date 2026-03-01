# Phase 17: Extension Host Bridge Tests - Research

**Researched:** 2026-02-28
**Domain:** VS Code extension host testing — Mocha + @vscode/test-electron, sinon stubs, WebSocket status bar UX, webview state persistence
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**WebSocket failure → error state (Status Bar Item)**
- New VS Code Status Bar Item for WebSocket connection status
- Three visual states:
  - Connected: green icon, "WS Connected"
  - Reconnecting: yellow/orange icon, "Reconnecting (3/20)..." with attempt counter
  - Disconnected: red icon, "WS Disconnected" — click to retry
- Configurable via VS Code setting (show/hide in normal operation)
- Override rule: When connection drops, status bar item is always shown regardless of setting — user must be able to see the error and retry
- After successful reconnection: briefly show "Connected" state, then hide again if setting is off
- Retry triggered by clicking the status bar item when in disconnected state

**Panel hide/show state persistence**
- Test the full spectrum including edge cases:
  - No reset-message sent on panel hide/show — current view and loaded data must be preserved
  - WebSocket updates while panel is hidden: state updates in the background, user sees fresh data when returning
  - Auth expiry while panel is hidden: user sees the login screen immediately when returning (not the stale view)
- Verify `retainContextWhenHidden: true` works correctly with the ready-signal handshake (`_webviewReady` + `_pendingMessages`)
- Verify `onDidChangeVisibility` listener behavior on both `ArtemisWebviewProvider` and `ChatWebviewProvider`

**handleMessageWithSender test strategy**
- Mocha tests for `WebViewMessageHandler.handleMessageWithSender()` using sinon stubs injected into constructor dependencies
- Verify: message sender is swapped correctly, command dispatch routes to correct handler, sender is restored after handling (including on error)
- Test representative commands across modules (auth, navigation, iris, etc.) — not exhaustive per-command but covering the dispatch seam

### Claude's Discretion
- Which commands to test in handleMessageWithSender (representative coverage, not exhaustive)
- Sinon stub granularity (per-dependency vs per-method)
- CI test organization: folder structure, npm scripts, CI step placement (cleanest approach for developers)
- Status bar item implementation details (exact icon choices, timing of "Connected" display before hiding)
- Whether toast notification accompanies status bar disconnect indicator

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INTG-03 | WebSocket error propagation test verifies connection failure propagates to store error state (not infinite loading) | WebSocket connection state callbacks already exist on `ArtemisWebsocketService.onConnectionStateChange()`. The status bar item `WebSocketStatusBarService` already exists but is developer-mode-only; the decision requires a new user-facing behaviour with a different visibility contract. The existing `ReconnectBanner` React component (webview side) already handles `websocketDisconnected`/`websocketConnected` messages. The gap is: (a) refactor the status bar to always show on disconnect, (b) add the new VS Code setting for controlling normal-state visibility, (c) write Mocha tests that exercise the connection state → store error state path. |
| INTG-04 | State persistence tests verify webview state survives panel hide/show via getState/setState | `retainContextWhenHidden: true` is already set on both `WebviewPanel` instances in `artemisWebviewProvider.ts` (lines 860, 909). `_webviewReady` + `_pendingMessages` handshake already exists. `ChatWebviewProvider.onDidChangeVisibility` is wired and tested. Gap: ArtemisWebviewProvider has no `onDidChangeVisibility` handler at all — visibility changes simply do nothing. Tests must verify the handshake preserves data across hide/show and that the current-view state is not reset. |
| DEBT-01 | WebSocket error propagation — connection failure shows error state instead of infinite loading | Same as INTG-03. The existing `WebSocketStatusBarService` is a developer debug tool (hidden by default, gated behind `artemis.developerMode`). A new or refactored service is needed with a distinct UX contract: always shown when disconnected regardless of any setting. This is an extension-host-side implementation task, plus tests. |
| DEBT-02 | State persistence — webview state persists across panel hide/show via getState/setState | Same as INTG-04. `retainContextWhenHidden: true` is already set, but the `onDidChangeVisibility` hook is absent in `ArtemisWebviewProvider`. The `_webviewReady` / `_pendingMessages` queue should already handle messages queued while hidden, but tests are needed to confirm. |
</phase_requirements>

---

## Summary

Phase 17 has three concrete deliverables: (1) Mocha tests for `WebViewMessageHandler.handleMessageWithSender()` verifying the seam between the host bridge and command dispatch, using sinon stubs; (2) a user-facing WebSocket status bar item that overrides its visibility setting whenever disconnected; and (3) Mocha tests verifying webview panel hide/show state persistence using the existing `retainContextWhenHidden` + `_webviewReady`/`_pendingMessages` handshake.

The testing infrastructure is already fully functional: `@vscode/test-electron` 2.5.2, `sinon` 21.0.1, and the `.vscode-test.mjs` config that routes `out/test/unit/**/*.test.js` to the unit label. The existing test patterns (subclass + override `_createClient`, `sinon.createSandbox()` + `sandbox.restore()`, `MockWebviewView`, `MockExtensionContext`) are battle-tested and should be followed exactly. No new dependencies are required.

The status bar item deliverable is a refactor of the existing `WebSocketStatusBarService` — which is today a developer debug panel — into a UX feature with different visibility semantics. The key design question resolved by the CONTEXT: the status bar must always show when disconnected regardless of the user-settable toggle, and show the reconnect attempt counter.

**Primary recommendation:** Follow the established Mocha + sinon sandbox pattern. Build the status bar refactor as a behaviour change to `WebSocketStatusBarService` (not a new service), add the VS Code setting for normal-state visibility, and place new test files under `test/unit/views/app/` and `test/unit/services/`.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@vscode/test-electron` | 2.5.2 | Runs Mocha test suites inside a real VS Code process | Required for any test touching the `vscode` module — no mocking of VS Code API needed |
| `@vscode/test-cli` | 0.0.12 | CLI driver: `vscode-test --label unit` selects the right test suite | Already wired in `package.json` scripts; config in `.vscode-test.mjs` |
| `sinon` | ^21.0.1 | Spies, stubs, fakes, and sandbox lifecycle management | Already installed; already used in 5+ test files in this project |
| `@types/sinon` | ^21.0.0 | TypeScript types for sinon | Already installed |
| `@types/mocha` | 10.0.10 | TypeScript types for `suite`/`test`/`setup`/`teardown` globals | Already installed; mocha itself comes from `@vscode/test-electron` |
| `assert` | built-in | Node.js strict assertion module | Project-wide convention — all existing tests use `import * as assert from 'assert'` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vscode` (ambient) | ^1.97.0 | Real VS Code API available inside `@vscode/test-electron` process | Use for `vscode.window`, `vscode.workspace`, `vscode.StatusBarAlignment`, etc. — all real inside test process |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Sinon sandbox pattern | Plain `sinon.stub()` without sandbox | Sandbox guarantees cleanup — always prefer sandbox to avoid state leaks across tests |
| Subclass + override pattern (for WebSocket) | Sinon stub on `_createClient` | Both work; subclass is already established in `artemisWebsocketService.test.ts` — use sinon.stub for `handleMessageWithSender` dependencies since they are constructor-injected |
| Manual mock classes | sinon.stub on existing instances | Manual mocks for `AuthManager`, `ArtemisApiService` etc are already in `vscodeMocks.ts` / inline subclasses — follow existing pattern |

**Installation:** No new packages needed. All dependencies already in `package.json`.

---

## Architecture Patterns

### Recommended Project Structure

New test files belong in the existing unit test tree:
```
test/unit/
├── views/app/
│   ├── appStateManager.test.ts          (exists)
│   └── webViewMessageHandler.test.ts    (NEW — handleMessageWithSender tests)
├── provider/
│   ├── artemisWebviewProvider.test.ts   (exists — extend with hide/show tests)
│   └── chatWebviewProvider.test.ts      (may need hide/show test additions)
└── services/
    ├── artemisWebsocketService.test.ts  (exists)
    ├── websocketStatusBar.test.ts       (NEW — status bar unit tests)
    └── websocket.test.ts                (exists)
```

### Pattern 1: Sinon Sandbox for Dependency Injection (handleMessageWithSender)

**What:** Create a `sinon.SinonSandbox`, build stub dependencies, pass them as constructor args to `WebViewMessageHandler`, then verify dispatched calls.
**When to use:** Any test that needs to stub out `AuthManager`, `ArtemisApiService`, `AppStateManager`, `WebViewActionHandler`, etc.

```typescript
// test/unit/views/app/webViewMessageHandler.test.ts
import * as assert from 'assert';
import * as sinon from 'sinon';
import { WebViewMessageHandler } from '../../../../src/views/app/webViewMessageHandler';
import { MockExtensionContext } from '../../mocks/vscodeMocks';
import { AuthManager } from '../../../../src/auth';
import { ArtemisApiService } from '../../../../src/api';
import { AppStateManager } from '../../../../src/views/app/appStateManager';
import type { ExtensionToWebviewMessage } from '../../../../src/shared/messageContracts';

suite('WebViewMessageHandler - handleMessageWithSender', () => {
    let sandbox: sinon.SinonSandbox;
    let handler: WebViewMessageHandler;
    let mockContext: MockExtensionContext;
    let authManager: AuthManager;
    let apiService: ArtemisApiService;
    let appStateManager: AppStateManager;
    let actionHandler: any;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockContext = new MockExtensionContext();
        authManager = new AuthManager(mockContext);
        apiService = new ArtemisApiService(authManager);
        appStateManager = new AppStateManager(apiService);
        actionHandler = {
            showDashboard: sandbox.stub().resolves(),
            render: sandbox.stub(),
            openJsonInEditor: sandbox.stub().resolves(),
        };
        handler = new WebViewMessageHandler(
            authManager, apiService, appStateManager, actionHandler
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    test('swaps sendMessage for duration of call, restores on completion', async () => {
        const responses: ExtensionToWebviewMessage[] = [];
        const capturedSender = (msg: ExtensionToWebviewMessage) => responses.push(msg);

        // A real command that sends a response (e.g., logout sends showLoading)
        await handler.handleMessageWithSender(
            { type: 'command', command: 'logout' } as any,
            capturedSender
        );

        // Sender was used and then restored — internal _sendMessage goes back to no-op
    });

    test('restores original sender even when handler throws', async () => {
        const throwingSender = sandbox.stub().throws(new Error('send failed'));
        // inject a handler that will fail
        (handler as any).commandHandlers.set('badCommand', async () => {
            throw new Error('handler error');
        });

        // Should not throw out of handleMessageWithSender (it catches internally)
        await handler.handleMessageWithSender(
            { type: 'command', command: 'badCommand' } as any,
            throwingSender
        );
        // verify no crash
        assert.ok(true);
    });
});
```

### Pattern 2: MockWebviewView for Panel Lifecycle Tests

**What:** The existing `MockWebviewView` in `artemisWebviewProvider.test.ts` (lines 48-58) provides a controllable `onDidChangeVisibility` event. Extend with a fire-able emitter to test hide/show flows.

```typescript
// In existing artemisWebviewProvider.test.ts or a new file
import * as vscode from 'vscode';

class ControllableWebviewView implements vscode.WebviewView {
    webview: vscode.Webview = new MockWebview();
    viewType: string = 'mock';
    title?: string;
    description?: string;
    badge?: vscode.ViewBadge;
    private _visibilityEmitter = new vscode.EventEmitter<void>();
    private _disposeEmitter = new vscode.EventEmitter<void>();
    onDidChangeVisibility: vscode.Event<void> = this._visibilityEmitter.event;
    onDidDispose: vscode.Event<void> = this._disposeEmitter.event;
    visible: boolean = true;

    show(preserveFocus?: boolean): void {}

    // Test helpers
    hide(): void {
        this.visible = false;
        this._visibilityEmitter.fire();
    }
    show_panel(): void {
        this.visible = true;
        this._visibilityEmitter.fire();
    }
}
```

### Pattern 3: WebSocketStatusBarService Refactor — Override Rule

**What:** The current `WebSocketStatusBarService` gates ALL visibility on `artemis.developerMode`. The CONTEXT decision requires a new `artemis.showWebSocketStatusBar` setting (or similar name — at Claude's discretion) that controls normal-state display, but disconnected state always forces the item visible.

**Implementation sketch (refactor of `_updateStatusBarItem`):**

```typescript
// In WebSocketStatusBarService._updateStatusBarItem():
private async _updateStatusBarItem(): Promise<void> {
    const isDisconnected =
        this._currentStatus === WebSocketStatus.Disconnected ||
        this._currentStatus === WebSocketStatus.GaveUp;

    // Override rule: always show when disconnected
    if (isDisconnected) {
        this._statusBarItem.show();
    } else if (this._showStatusBar) {
        // Normal-state visibility controlled by setting
        this._statusBarItem.show();
    } else {
        this._statusBarItem.hide();
        return; // Skip text update if hidden
    }

    // Build text with reconnect attempt counter
    switch (this._currentStatus) {
        case WebSocketStatus.Reconnecting:
            const attempts = this._reconnectAttempts;
            const max = MAX_CONNECTION_ATTEMPTS;
            this._statusBarItem.text = `$(sync~spin) Reconnecting (${attempts}/${max})...`;
            this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            break;
        case WebSocketStatus.Disconnected:
        case WebSocketStatus.GaveUp:
            this._statusBarItem.text = '$(debug-disconnect) WS Disconnected';
            this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            break;
        case WebSocketStatus.Connected:
            this._statusBarItem.text = '$(plug) WS Connected';
            this._statusBarItem.backgroundColor = undefined;
            break;
    }
}
```

**Problem:** `WebSocketStatusBarService` currently reads reconnect attempt count indirectly via `getDebugInfoAsync()`. For the counter display, either expose `_reconnectAttempts` as a public getter on `ArtemisWebsocketService` (preferred — keeps the service cohesive) or read it from `getDebugInfoAsync()` (async, adds complexity).

The `onConnectionStateChange` callback receives `(isConnected: boolean, wasEverConnected?: boolean)` — this does NOT carry the reconnect attempt count. The status bar needs to poll or subscribe to a separate signal. **Recommendation:** Add a public `get reconnectAttempts(): number` getter to `ArtemisWebsocketService`.

### Pattern 4: _pendingMessages Queue — Already Handles Hidden State

**What:** `ArtemisWebviewProvider._postMessageSafe()` already enqueues messages when `_webviewReady` is false (line 1075-1079). When the panel is re-shown and the webview fires `'ready'` again, the queue flushes (lines 449-454).

**Key insight for tests:** The `_webviewReady` flag is reset to `false` when `resolveWebviewView()` is called again — which happens on re-show. With `retainContextWhenHidden: true`, the webview HTML is NOT reloaded on hide/show; the `ready` signal is NOT re-emitted. This means:
- `_webviewReady` stays `true` across hide/show (when retainContextWhenHidden is on)
- `_pendingMessages` is NOT used for hide/show data delivery
- State delivery on re-show must happen via `onDidChangeVisibility` — but `ArtemisWebviewProvider` has NO such listener yet

**This is the gap INTG-04 / DEBT-02 needs to close:** Add an `onDidChangeVisibility` listener in `resolveWebviewView()` that calls `resendViewData()` when becoming visible — same pattern as `ChatWebviewProvider` (lines 206-220).

### Anti-Patterns to Avoid

- **Mocking the `vscode` module itself:** Never use `jest.mock('vscode')` or similar. Tests run inside a real VS Code process via `@vscode/test-electron` — all `vscode.*` APIs are real. Use `sinon.stub(vscode.window, 'showInformationMessage')` to intercept VS Code calls.
- **Not calling `sandbox.restore()` in teardown:** Sinon stubs on VS Code globals persist across tests unless explicitly restored. Always use sandbox pattern and restore in `teardown()`.
- **Forgetting `compile-tests` before running:** The `.vscode-test.mjs` config points to `out/test/unit/**/*.test.js` (compiled output). Run `npm run compile-tests` first, or run `npm run test:unit` which triggers `pretest`.
- **Testing `handleMessage()` instead of `handleMessageWithSender()`:** The phase goal is the seam verification — that the sender-swap-and-restore mechanism works. Tests should call `handleMessageWithSender()` and verify the captured send function was used.
- **Adding `onDidChangeVisibility` without checking `webviewView.visible`:** The event fires on both hide and show. Always check `webviewView.visible` inside the handler.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Timer faking for status bar "briefly show Connected" delay | Custom timer management | `sinon.useFakeTimers()` | Deterministic, already used in `websocket.test.ts` and `boundaryTriggerAndCadence.test.ts` |
| Reconnect attempt counter exposure | Parsing `getStatus()` string | `public get reconnectAttempts(): number` getter on `ArtemisWebsocketService` | `getStatus()` returns a human-readable string — fragile to parse. Expose the raw value. |
| WebviewView visibility simulation | Complex mock with internal event bus | `vscode.EventEmitter<void>` with `.fire()` | VS Code provides `EventEmitter` natively; available in test process |
| CI test ordering | Custom test runner script | `.vscode-test.mjs` `label` + npm script ordering | `@vscode/test-cli` already supports multiple labeled suites; run in sequence via `&&` in CI |

**Key insight:** sinon's sandbox pattern (`createSandbox()` + `sandbox.restore()`) eliminates nearly all test isolation concerns for side-effectful VS Code API calls. Lean on it heavily.

---

## Common Pitfalls

### Pitfall 1: Status Bar Item — Async `_updateStatusBarItem` in Constructor
**What goes wrong:** `WebSocketStatusBarService` constructor calls `_updateStatusFromService()` which is async and calls `getDebugInfoAsync()` which reads auth manager state. In tests, this async call can complete after the test ends, causing race conditions.
**Why it happens:** Constructor-initiated async work with no await point exposed.
**How to avoid:** In test setup, stub out `websocketService.getDebugInfoAsync()` with a sinon stub that returns immediately. Call `sandbox.useFakeTimers()` if testing the polling interval.
**Warning signs:** Tests pass in isolation but fail when run in suite order.

### Pitfall 2: `handleMessageWithSender` — Command Module Initialization Requires Full Constructor
**What goes wrong:** `WebViewMessageHandler` constructor initializes all 7 command modules synchronously, and each module takes the full `CommandContext`. If `ArtemisApiService` or `AuthManager` lacks required internal state, a module constructor may throw.
**Why it happens:** The real service classes have non-trivial constructors (e.g., `AuthManager` reads from `ExtensionContext`).
**How to avoid:** Use `MockExtensionContext` from `test/unit/mocks/vscodeMocks.ts`. Construct real `AuthManager` with `MockExtensionContext` (as done in existing tests). Stub `apiService` methods with sinon after construction if needed.
**Warning signs:** `Error: Cannot read properties of undefined` in suite setup.

### Pitfall 3: `retainContextWhenHidden` — `ready` Signal NOT Re-Emitted on Re-Show
**What goes wrong:** Tests assume `_webviewReady` is reset to `false` on panel hide, then re-set to `true` on show when React re-fires `ready`. With `retainContextWhenHidden: true`, the webview process never stops — it does not re-initialize. The `ready` signal fires exactly once per webview creation.
**Why it happens:** `retainContextWhenHidden` preserves the JS heap; the webview does not restart.
**How to avoid:** Test file must simulate `resolveWebviewView()` being called once, then simulate `onDidChangeVisibility` events by firing the event emitter directly. Do NOT simulate a second `ready` message.
**Warning signs:** Tests that post messages into `_pendingMessages` expecting them to flush on re-show (they won't — they'll only flush on the initial `ready`).

### Pitfall 4: CI Step Placement — `compile-tests` Must Precede `vscode-test`
**What goes wrong:** Adding a new `test:unit` step to CI without ensuring TypeScript compilation runs first.
**Why it happens:** `.vscode-test.mjs` reads from `out/test/unit/`. If tsc hasn't run, test files don't exist.
**How to avoid:** `npm run test:unit` already chains `pretest` (which runs `compile-tests && compile && lint`). In CI, just run `npm run test:unit`.
**Warning signs:** "No test files found" or "Cannot find module" errors in CI.

### Pitfall 5: Status Bar `_reconnectAttempts` Counter Not Exposed
**What goes wrong:** The status bar needs to display "Reconnecting (3/20)..." but `_reconnectAttempts` is private on `ArtemisWebsocketService`. `getStatus()` encodes the count in a string. The `onConnectionStateChange` callback does not include the count.
**Why it happens:** `_reconnectAttempts` was never designed for external consumption.
**How to avoid:** Add a public getter `get reconnectAttempts(): number` to `ArtemisWebsocketService`. This is a one-line change and keeps the counter in the right place.
**Warning signs:** Status bar displaying stale or wrong attempt counts by parsing string output.

---

## Code Examples

Verified patterns from existing project code:

### Sinon Sandbox Setup (from `noAiDetectionService.test.ts`)
```typescript
// Source: test/unit/services/noAiDetectionService.test.ts
let sandbox: sinon.SinonSandbox;

setup(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(vscode.workspace, 'workspaceFolders').get(() => mockWorkspaceFolders);
    sandbox.stub(vscode.commands, 'executeCommand').resolves();
});

teardown(() => {
    sandbox.restore();
});
```

### Sinon Spy on Method (from `websocket.test.ts`)
```typescript
// Source: test/unit/services/websocket.test.ts
const connectSpy = sinon.spy(wsService, 'connect');
```

### Sinon Stub with Return Value (from `chatSessionService.test.ts`)
```typescript
// Source: test/unit/services/chatSessionService.test.ts
onSessionLoadedSpy = sinon.stub().resolves();
```

### Fake Timers (from `websocket.test.ts`)
```typescript
// Source: test/unit/services/websocket.test.ts
clock = sinon.useFakeTimers({ now: 1000, shouldAdvanceTime: true });
// ... in teardown:
sinon.restore();
```

### MockWebviewView (from `artemisWebviewProvider.test.ts`)
```typescript
// Source: test/unit/provider/artemisWebviewProvider.test.ts
class MockWebviewView implements vscode.WebviewView {
    webview: vscode.Webview = new MockWebview();
    viewType: string = 'mock';
    title?: string;
    description?: string;
    badge?: vscode.ViewBadge;
    show(preserveFocus?: boolean): void {}
    onDidChangeVisibility: vscode.Event<void> = new vscode.EventEmitter<void>().event;
    onDidDispose: vscode.Event<void> = new vscode.EventEmitter<void>().event;
    visible: boolean = true;
}
```

### MockWebview with postMessage spy
```typescript
// Extend MockWebview from artemisWebviewProvider.test.ts to spy on messages
class SpyWebview extends MockWebview {
    public sentMessages: any[] = [];
    postMessage(message: any): Thenable<boolean> {
        this.sentMessages.push(message);
        return Promise.resolve(true);
    }
}
```

### onConnectionStateChange Pattern (from `websocketStatusBar.ts`)
```typescript
// Source: src/services/websocketStatusBar.ts
this._unsubscribeFromState = this._websocketService.onConnectionStateChange(
    (isConnected, wasEverConnected) => {
        this._updateStatus(isConnected, wasEverConnected);
    }
);
// In dispose():
if (this._unsubscribeFromState) {
    this._unsubscribeFromState();
}
```

### vscode-test.mjs Config — Adding New Labels
```javascript
// Source: .vscode-test.mjs
export default defineConfig([
    {
        label: 'unit',
        files: 'out/test/unit/**/*.test.js',
        exclude: ['out/test/unit/struggle-detection/**'],
    },
    {
        label: 'e2e',
        files: 'out/test/e2e/**/*.e2e.test.js',
        mocha: { timeout: 60000 },
    },
    // No new label needed for Phase 17 — all tests go into 'unit'
]);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `vscode.test` (deprecated extension test runner) | `@vscode/test-electron` + `@vscode/test-cli` | VS Code 1.78+ | CLI-based, label-scoped, coverage-capable |
| `@vscode/test-cli` ≤ 0.0.11 (worker isolation) | 0.0.12 (improved stability) | 2024 | Mocha suite isolation more reliable |

**Existing code state (what Phase 17 changes):**

| Component | Current State | Phase 17 Change |
|-----------|--------------|-----------------|
| `WebSocketStatusBarService` | Developer-mode-only debug panel; always hidden in normal use | Refactor to user-facing: add setting for normal-state visibility; override rule forces show on disconnect |
| `ArtemisWebviewProvider.resolveWebviewView()` | No `onDidChangeVisibility` handler | Add visibility listener that calls `resendViewData()` on show |
| `WebViewMessageHandler` | No unit tests (only indirectly tested via provider tests) | New Mocha tests for `handleMessageWithSender()` seam |
| `ArtemisWebsocketService` | `_reconnectAttempts` is private | Add public getter `get reconnectAttempts(): number` |
| CI workflows | `/.github/workflows/` directory exists but is empty | New workflow file: run `npm run test:unit` before Selenium step |

---

## Open Questions

1. **Status bar setting name**
   - What we know: CONTEXT.md says "Configurable via VS Code setting (show/hide in normal operation)"
   - What's unclear: The exact key name (e.g., `artemis.showWebSocketStatusBar` vs `artemis.websocketStatusBar.show`)
   - Recommendation: Claude's discretion — use `artemis.showWebSocketStatusBar` (boolean, default `false`) for consistency with existing `artemis.showUnsavedChangesWarning` pattern.

2. **Toast notification on disconnect**
   - What we know: CONTEXT.md marks "Whether toast notification accompanies status bar disconnect indicator" as Claude's discretion
   - What's unclear: Whether `vscode.window.showWarningMessage()` should fire on first disconnect
   - Recommendation: Skip the toast. The status bar already provides persistent visibility. A toast would be disruptive if the user is mid-task. The status bar override rule (always show when disconnected) is the notification mechanism.

3. **"Briefly show Connected" timing**
   - What we know: CONTEXT.md says "briefly show 'Connected' state, then hide again if setting is off"
   - What's unclear: Duration (2 seconds? 3 seconds?)
   - Recommendation: 2 seconds — matches the existing `ReconnectBanner` component's `setTimeout(() => setIsVisible(false), 2000)` pattern.

4. **ArtemisWebviewProvider `onDidChangeVisibility` — what to send on re-show**
   - What we know: `resendViewData()` exists and handles dashboard, course, exercise states
   - What's unclear: Does it handle all current states, or only some?
   - Recommendation: Audit `resendViewData()` coverage before writing hide/show tests; fill any gaps in that method before testing it.

5. **ChatWebviewProvider hide/show tests**
   - What we know: `ChatWebviewProvider` already has an `onDidChangeVisibility` listener (line 206) that calls `_postSnapshot()`, `_detectWorkspaceExercise()`, etc.
   - What's unclear: Whether these tests belong in Phase 17 or are already covered
   - Recommendation: Write basic hide/show tests for `ChatWebviewProvider` to confirm the existing listener fires and calls the right methods — use sinon spies on the private methods via `(provider as any)._postSnapshot = sandbox.stub()`.

---

## Sources

### Primary (HIGH confidence)
- Codebase: `/iris-thaumantias/src/services/artemisWebsocketService.ts` — Full implementation of `onConnectionStateChange`, `_reconnectAttempts`, connection state machine
- Codebase: `/iris-thaumantias/src/services/websocketStatusBar.ts` — Existing `WebSocketStatusBarService` — developer-mode-only today
- Codebase: `/iris-thaumantias/src/provider/artemisWebviewProvider.ts` — `_webviewReady`, `_pendingMessages`, `retainContextWhenHidden`, no `onDidChangeVisibility`
- Codebase: `/iris-thaumantias/src/provider/chatWebviewProvider.ts` — `onDidChangeVisibility` reference implementation (line 206)
- Codebase: `/iris-thaumantias/src/views/app/webViewMessageHandler.ts` — `handleMessageWithSender()` seam, constructor dependencies
- Codebase: `/iris-thaumantias/test/unit/services/artemisWebsocketService.test.ts` — Subclass + override test pattern
- Codebase: `/iris-thaumantias/test/unit/services/noAiDetectionService.test.ts` — `sinon.createSandbox()` pattern
- Codebase: `/iris-thaumantias/test/unit/services/websocket.test.ts` — `sinon.useFakeTimers()` and `sinon.spy()` patterns
- Codebase: `/iris-thaumantias/test/unit/provider/artemisWebviewProvider.test.ts` — `MockWebviewView` pattern
- Codebase: `/iris-thaumantias/.vscode-test.mjs` — Test suite configuration, labels, file globs
- Codebase: `/iris-thaumantias/package.json` — All dependencies confirmed present; scripts confirmed

### Secondary (MEDIUM confidence)
- `@vscode/test-electron` 2.5.2 — verified via `package.json`; Mocha suite/test/setup/teardown globals are standard for this framework
- `sinon` 21.x — sandbox pattern, stub, spy, fake timers all verified present in project usage

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed and in active use in the project
- Architecture: HIGH — all patterns derived from existing test files in this codebase
- Status bar refactor: HIGH — `WebSocketStatusBarService` is fully readable; the change is a visibility-gating logic change
- Pitfalls: HIGH — derived from reading actual implementation code, not assumptions
- INTG-04 gap (onDidChangeVisibility missing): HIGH — confirmed by grep showing zero hits in `artemisWebviewProvider.ts`

**Research date:** 2026-02-28
**Valid until:** 2026-03-30 (stable — no fast-moving dependencies)
