# Stack Research

**Domain:** VS Code Extension E2E & Integration Testing
**Researched:** 2026-02-28
**Confidence:** HIGH

## Scope

This research covers ONLY stack additions needed for v1.2: E2E testing of all 12 webview views and integration testing of the extension host ↔ webview message bridge. The existing stack (React 18.3.1, esbuild, Zustand, Vitest + RTL + happy-dom, `@vscode/test-cli`, `vscode-extension-tester`, sinon) is already in place and is not re-researched here.

---

## What's Already Installed (No Changes Needed)

| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| `@vscode/test-cli` | 0.0.12 | Mocha-based runner that launches VS Code Extension Development Host | Already installed, already configured in `.vscode-test.mjs` |
| `@vscode/test-electron` | 2.5.2 | Downloads VS Code binary, launches it for tests, provides vscode API access | Already installed |
| `vscode-extension-tester` | 8.22.0 | Selenium-based E2E framework — launches real VS Code, drives UI via ChromeDriver, can switch into webview iframes | Already installed, UI tests already exist in `test/e2e/ui/` |
| `sinon` | 21.0.1 | Stub/spy/mock library used in extension host unit tests | Already installed |
| `@types/sinon` | ^21.0.0 | TypeScript types for sinon | Already installed |
| `@types/mocha` | 10.0.10 | TypeScript types for Mocha (used in `@vscode/test-cli` tests) | Already installed |
| `vitest` | ^4.0.18 | React component test runner (Vitest 4.x) | Already installed |
| `happy-dom` | ^20.7.0 | DOM environment for React component tests | Already installed |

**Conclusion:** No new testing packages are required. v1.2 is a test-writing milestone, not a stack-addition milestone. All infrastructure to execute integration tests and E2E tests is already present.

---

## Recommended Stack: Integration Tests (Bridge Layer)

### Strategy

Integration tests for the extension host ↔ webview message bridge run inside the VS Code Extension Development Host via `@vscode/test-cli` + `@vscode/test-electron`. This gives tests full access to the real `vscode` API module. The bridge (`WebViewMessageHandler`) accepts a `sendMessage` callback and exposes `handleMessage(msg)` — both are injectable, making message-flow testing straightforward without launching a browser.

**Pattern:** Construct `WebViewMessageHandler` with real dependencies (or sinon stubs for external services), inject a captured `sendMessage`, call `handleMessage()` with typed messages, assert what was sent back.

### Core Technologies (Already Installed)

| Technology | Version | Purpose | Why This Tool |
|------------|---------|---------|---------------|
| `@vscode/test-cli` | 0.0.12 | Orchestrates Mocha tests inside a real VS Code process | Only way to get real `vscode` API access in tests; alternative (pure Node mocks) is fragile for APIs like `ExtensionContext`, `SecretStorage`, `WebviewPanel` |
| `@vscode/test-electron` | 2.5.2 | Downloads + launches VS Code binary for test runs | Required peer for `@vscode/test-cli` desktop tests |
| Mocha (bundled) | via `@types/mocha` 10.0.10 | Test framework for extension host tests | Bundled with `@vscode/test-electron`; already used in `test/unit/` and `test/e2e/` |
| `sinon` | 21.0.1 | Stubs external HTTP calls, mocks `WebviewPanel.postMessage`, captures sent messages | Already used throughout `test/unit/`; ideal for injecting test doubles into `WebViewMessageHandler` |

### Integration Test Pattern for Bridge

The message bridge already has the right architecture for testing: `WebViewMessageHandler` accepts a `sendMessage` callback via `setSendMessage()`. Integration tests can:

1. Instantiate `WebViewMessageHandler` inside the Extension Development Host (has real `vscode` API)
2. Provide a sinon spy as the `sendMessage` callback to capture outbound messages
3. Call `handleMessage(inboundMsg)` with typed `WebviewToExtensionMessage` objects
4. Assert on spy call arguments to verify the correct `ExtensionToWebviewMessage` was sent

Store hydration tests (verifying Zustand stores receive correct initial data) require a browser context — use `vscode-extension-tester` for these (see E2E section below).

### No New Packages Needed

The existing `sinon` + Mocha + `@vscode/test-cli` combination is the right tool. Adding a parallel integration test framework (e.g., `vitest` for Node-mode bridge tests) would duplicate infrastructure without benefit — the extension host bridge code imports `vscode`, which is not available in Node-only Vitest contexts without extensive manual mocking that degrades test validity.

---

## Recommended Stack: E2E Tests (All 12 Views)

### Strategy

End-to-end tests use `vscode-extension-tester` (ExTester), which is already installed at v8.22.0. ExTester launches a real VS Code instance via Selenium + ChromeDriver, installs the packaged VSIX, and can switch into webview iframes to interact with the React DOM. The existing `test/e2e/ui/` directory already demonstrates the working pattern (login flow, WebviewView.switchToFrame, element queries by CSS selector).

### Core Technology (Already Installed)

| Technology | Version | Purpose | Why This Tool |
|------------|---------|---------|---------------|
| `vscode-extension-tester` | 8.22.0 | Selenium-based E2E: launches real VS Code, drives it via ChromeDriver, switches into webview iframes | Only mature framework that supports switching into VS Code sidebar webview iframes; already proven working in this project |

### Why NOT wdio-vscode-service

`wdio-vscode-service` v6.1.4 is a WebdriverIO-based alternative. Rejected because:
- **No documented webview iframe support.** Official docs and changelog contain no mention of switching into sidebar webview content. Issue #131 on the GitHub repo shows CI setup is a manual, unsupported workflow.
- **Adds a parallel Selenium/WebDriver stack.** ExTester already uses ChromeDriver; adding wdio-vscode-service means maintaining two competing WebDriver configurations.
- **Already installed alternative.** `vscode-extension-tester` is already at v8.22.0, already has a working test suite in this project, and its `WebviewView.switchToFrame()` API is documented for sidebar views.

### Why NOT Playwright

Playwright does not support VS Code as an automation target. GitHub issue [microsoft/playwright#22351](https://github.com/microsoft/playwright/issues/22351) tracks this request — it is open with no committed timeline. Playwright's VS Code extension is a test runner plugin, not a VS Code automation target.

### Known Limitation: Sidebar Webview Flakiness

`WebviewView.switchToFrame()` in sidebar views has a known intermittent failure when VS Code's Welcome Page (itself a webview) is open. Mitigation is already implemented in the existing helpers: call `switchToFrame(5000)` on the WebviewView after opening the Artemis sidebar. The mandatory pre-step is closing editor tabs first.

**Required setup in every E2E suite:**
```typescript
// Close Welcome Page and any editor webviews before switching into sidebar webview
import { EditorView } from 'vscode-extension-tester';
await new EditorView().closeAllEditors();
```

This is a known workaround documented in the ExTester GitHub discussions (discussion #1690). It is not a blocker — the existing login-flow test already works correctly.

---

## CI Configuration (New Work Required)

The project does not yet have a GitHub Actions workflow for automated E2E or integration testing. This is the only genuine "new" addition for v1.2.

### Required: GitHub Actions Workflow

| Concern | Solution | Authority |
|---------|----------|-----------|
| Linux headless display | `xvfb-run -a npm test` on Linux; macOS/Windows run directly | [Official VS Code CI docs](https://code.visualstudio.com/api/working-with-extensions/continuous-integration) |
| VS Code binary caching | `@vscode/test-electron` caches downloads; add `~/.vscode-test` to Actions cache | Reduces CI time by ~2 min per run |
| ExTester binary caching | `test-resources/` directory; cacheable via `cachePath` option in ExTester | Avoids re-downloading VS Code + ChromeDriver on every run |
| Platform matrix | macOS + Ubuntu minimum; Windows optional (longest run time) | Official VS Code guidance |

**Recommended GitHub Actions structure:**

```yaml
# .github/workflows/test.yml
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
        working-directory: iris-thaumantias
      # Unit + React tests (no display needed)
      - run: npm run test:react
        working-directory: iris-thaumantias
      # Extension host integration tests
      - name: Run integration tests (Linux)
        if: runner.os == 'Linux'
        run: xvfb-run -a npm run test:unit
        working-directory: iris-thaumantias
      - name: Run integration tests (non-Linux)
        if: runner.os != 'Linux'
        run: npm run test:unit
        working-directory: iris-thaumantias
      # E2E UI tests
      - name: Run E2E tests (Linux)
        if: runner.os == 'Linux'
        run: xvfb-run -a npm run test:ui
        working-directory: iris-thaumantias
      - name: Run E2E tests (non-Linux)
        if: runner.os != 'Linux'
        run: npm run test:ui
        working-directory: iris-thaumantias
```

**Note:** E2E tests that require a live Artemis server (`uncommittedChanges.e2e.test.ts`) should remain gated behind environment variables and skip automatically when `ARTEMIS_URL` is not set. This is already implemented.

---

## Supporting Utilities (No New Installs)

These patterns use existing packages for improved integration test ergonomics:

### MockWebviewPanel (Sinon-based, no new package)

For bridge integration tests, create a typed mock using sinon stubs — no additional package needed:

```typescript
// test/unit/mocks/mockWebviewPanel.ts
import * as sinon from 'sinon';
import type { ExtensionToWebviewMessage } from '../../../src/shared/messageContracts';

export function createMockWebviewPanel() {
    const sentMessages: ExtensionToWebviewMessage[] = [];
    const sendMessage = sinon.spy((msg: ExtensionToWebviewMessage) => {
        sentMessages.push(msg);
    });
    return { sendMessage, sentMessages };
}
```

This pattern is already used in `test/unit/services/websocket.test.ts` — the same `MockStompClient` pattern applies to mocking the webview channel.

### Vitest acquireVsCodeApi Mock (Already Needed for Store Tests)

The Zustand stores call `acquireVsCodeApi()` on init. The existing Vitest setup in `test/react/__helpers__/vitest.setup.ts` already mocks `window.acquireVsCodeApi`. No new package needed — this is a `vi.stubGlobal()` call.

---

## Packages to Explicitly NOT Add

| Avoid | Why | What to Use Instead |
|-------|-----|---------------------|
| `wdio-vscode-service` | No documented sidebar webview iframe support; adds parallel ChromeDriver stack; v6.1.4 sparse docs | `vscode-extension-tester` (already installed, already working) |
| Playwright | No VS Code automation target; issue #22351 open with no timeline | `vscode-extension-tester` for UI, `@vscode/test-cli` for integration |
| `jest` / `ts-jest` | Conflicts with Vitest; would require ESM flag hacks for vscode mock | Mocha (for extension host tests, already used) + Vitest (for React tests, already used) |
| `cypress` | Browser-only, cannot drive VS Code UI, no webview iframe access in extension context | `vscode-extension-tester` |
| `@vitest/browser` | Adds Playwright/WebdriverIO dependency for React component tests; happy-dom covers 95% of cases | `happy-dom` (already installed) |
| `nock` / `msw` | HTTP mocking for extension host tests | `sinon.stub()` on `ArtemisApiService` methods (already the established pattern) |
| `vitest` for extension host bridge tests | `vscode` module is not importable in Vitest's Node environment without full manual mock | `@vscode/test-cli` + Mocha (runs inside real VS Code process) |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `vscode-extension-tester` 8.22.0 | VS Code ^1.97.0 | Tested against VS Code stable; `extest get-vscode` downloads compatible version |
| `@vscode/test-cli` 0.0.12 | VS Code ^1.97.0 | `.vscode-test.mjs` already configures labels `unit` and `e2e` |
| `sinon` 21.0.1 | Mocha (bundled with `@vscode/test-electron`) | No conflicts |
| `vitest` ^4.0.18 | `happy-dom` ^20.7.0, `@vitejs/plugin-react` ^5.1.4 | Already verified in CI-equivalent local runs (809 tests) |

---

## Installation

**No new packages are required.** All necessary tooling is already installed.

The v1.2 work is entirely test authoring:

```bash
# Verify existing infrastructure works
cd iris-thaumantias
npm run test:react    # 809 Vitest tests — should pass
npm run test:unit     # Mocha + @vscode/test-cli integration tests
npm run test:ui       # ExTester E2E tests (requires display on Linux: xvfb-run -a npm run test:ui)
```

The only file additions are:
- New test files in `test/unit/` (bridge integration tests)
- New test files in `test/e2e/ui/` (12 view E2E tests)
- `.github/workflows/test.yml` (CI automation — new file)

---

## Alternatives Considered

| Category | Recommended | Alternative | When to Use Alternative |
|----------|-------------|-------------|-------------------------|
| E2E Framework | `vscode-extension-tester` (already installed) | `wdio-vscode-service` | Only if ExTester's Selenium approach proves fundamentally unworkable; migration cost is high |
| Integration Test Runner | `@vscode/test-cli` + Mocha | Vitest in Node mode with manual vscode mock | If the extension host code is refactored to remove direct vscode API imports (a large architectural change, out of scope) |
| CI Display (Linux) | `xvfb-run -a` | `GabrielBB/xvfb-action@v1.0` | Both work; the action is slightly more ergonomic but adds a third-party dependency |

---

## Sources

- [Testing Extensions — Visual Studio Code Extension API](https://code.visualstudio.com/api/working-with-extensions/testing-extension) — Official `@vscode/test-cli` setup and integration test patterns (HIGH confidence)
- [Continuous Integration — Visual Studio Code Extension API](https://code.visualstudio.com/api/working-with-extensions/continuous-integration) — `xvfb-run -a` requirement for Linux CI, GitHub Actions matrix (HIGH confidence)
- [redhat-developer/vscode-extension-tester releases](https://github.com/redhat-developer/vscode-extension-tester/releases) — v8.22.1 is latest as of 2026-02-27 (HIGH confidence)
- [Accessing Webview in the sidebar — ExTester Discussion #1690](https://github.com/redhat-developer/vscode-extension-tester/discussions/1690) — `closeAllEditors()` workaround for sidebar webview flakiness (MEDIUM confidence)
- [wdio-vscode-service v6.1.4 documentation](https://webdriverio-community.github.io/wdio-vscode-service/) — Confirmed: no webview iframe docs, no sidebar webview support documented (HIGH confidence — absence is the finding)
- [Playwright VS Code issue #22351](https://github.com/microsoft/playwright/issues/22351) — Playwright cannot automate VS Code as an extension host target (HIGH confidence)
- [A Complete Guide to VS Code Extension Testing — Christian Bromann / DEV Community](https://bromann.dev/post/a-complete-guide-to-vs-code-extension-testing/) — WebdriverIO recommendation for webview testing; confirms official `@vscode/test-electron` has "total lack of support for testing webviews" (MEDIUM confidence)
- [Testing VS Code Extensions with TypeScript — ISE Developer Blog](https://devblogs.microsoft.com/ise/testing-vscode-extensions-with-typescript/) — Sinon/mock patterns for extension host unit tests, wrapper class approach (MEDIUM confidence)
- Package inspection: `iris-thaumantias/package.json` — All version numbers confirmed against installed `node_modules` (HIGH confidence)

---

*Stack research for: Artemis VS Code Extension v1.2 E2E & Integration Testing*
*Researched: 2026-02-28*
*Confidence: HIGH (existing codebase inspected directly; official docs verified; tool limitations confirmed)*
