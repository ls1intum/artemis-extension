# Phase 17: Extension Host Bridge Tests - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

The extension host side of the postMessage bridge is verified with Mocha tests running in a real VS Code process. WebSocket connection failures show error state instead of infinite loading, webview state persists across panel hide/show, and `handleMessageWithSender()` command dispatch is tested with sinon stubs. A new WebSocket status bar item surfaces connection state to the user.

</domain>

<decisions>
## Implementation Decisions

### WebSocket failure → error state (Status Bar Item)
- New VS Code Status Bar Item for WebSocket connection status
- Three visual states:
  - **Connected:** green icon, "WS Connected"
  - **Reconnecting:** yellow/orange icon, "Reconnecting (3/20)..." with attempt counter
  - **Disconnected:** red icon, "WS Disconnected" — click to retry
- Configurable via VS Code setting (show/hide in normal operation)
- **Override rule:** When connection drops, status bar item is always shown regardless of setting — user must be able to see the error and retry
- After successful reconnection: briefly show "Connected" state, then hide again if setting is off
- Retry triggered by clicking the status bar item when in disconnected state

### Panel hide/show state persistence
- Test the full spectrum including edge cases:
  - No reset-message sent on panel hide/show — current view and loaded data must be preserved
  - WebSocket updates while panel is hidden: state updates in the background, user sees fresh data when returning to the panel
  - Auth expiry while panel is hidden: user sees the login screen immediately when returning (not the stale view followed by login on next API call)
- Verify `retainContextWhenHidden: true` works correctly with the ready-signal handshake (`_webviewReady` + `_pendingMessages`)
- Verify `onDidChangeVisibility` listener behavior on both `ArtemisWebviewProvider` and `ChatWebviewProvider`

### handleMessageWithSender test strategy
- Mocha tests for `WebViewMessageHandler.handleMessageWithSender()` using sinon stubs injected into constructor dependencies
- Verify: message sender is swapped correctly, command dispatch routes to correct handler, sender is restored after handling (including on error)
- Test representative commands across modules (auth, navigation, iris, etc.) — not exhaustive per-command but covering the dispatch seam

### Claude's Discretion
- Which commands to test in handleMessageWithSender (representative coverage, not exhaustive)
- Sinon stub granularity (per-dependency vs per-method)
- CI test organization: folder structure, npm scripts, CI step placement (cleanest approach for developers)
- Status bar item implementation details (exact icon choices, timing of "Connected" display before hiding)
- Whether toast notification accompanies status bar disconnect indicator

</decisions>

<specifics>
## Specific Ideas

- Status bar item should use color coding: green/yellow-orange/red for connected/reconnecting/disconnected states
- Reconnecting state should show attempt counter (e.g., "3/20") so users know retries are happening
- Auth expiry while panel is hidden should immediately route to login screen — no stale view shown first

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `WebViewMessageHandler` (`src/views/app/webViewMessageHandler.ts`): Clean seam at `handleMessageWithSender()` — swaps `_sendMessage`, delegates to `handleMessage()`, restores. Directly testable with sinon stubs for all constructor dependencies.
- `ArtemisWebsocketService` (`src/services/artemisWebsocketService.ts`): Existing reconnection logic with exponential backoff (500ms–10s, max 20 attempts, 5s grace period). Status bar item hooks into this.
- `test/mocks/vscodeMocks.ts`: Existing mock classes for `ExtensionContext`, `SecretStorage`, `Memento`, `TextDocument` — extend for status bar item mocks.
- Command modules (`src/views/app/commands/`): 7 modules with `getHandlers()` pattern — sinon can stub individual module handlers.

### Established Patterns
- Mocha + `@vscode/test-electron` for host-side tests running in real VS Code process
- `suite()`/`test()`/`setup()`/`teardown()` structure with `assert` module
- Custom mock classes in `test/mocks/` rather than external mocking libraries (but sinon specified in roadmap for this phase)
- `retainContextWhenHidden: true` set on both webview providers
- Ready-signal handshake: `_webviewReady` flag + `_pendingMessages` queue in `ArtemisWebviewProvider`

### Integration Points
- `ArtemisWebviewProvider.resolveWebviewView()`: Panel lifecycle hooks — hide/show tests intercept here
- `ChatWebviewProvider.onDidChangeVisibility`: Existing visibility listener to test
- `ArtemisWebsocketService`: Connection state changes need to emit events for status bar item
- `package.json` contributes.configuration: New setting for status bar item visibility
- CI pipeline (`.github/`): New test step between unit tests and Selenium

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 17-extension-host-bridge-tests*
*Context gathered: 2026-02-28*
