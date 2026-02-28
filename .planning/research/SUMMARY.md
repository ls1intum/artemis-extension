# Project Research Summary

**Project:** Artemis VS Code Extension — v1.2 E2E & Integration Testing Milestone
**Domain:** VS Code Extension Testing (React Webviews, postMessage Bridge, Selenium UI Automation)
**Researched:** 2026-02-28
**Confidence:** HIGH

## Executive Summary

The v1.2 milestone is a test-writing milestone, not a stack-addition milestone. All required infrastructure — `@vscode/test-cli`, `@vscode/test-electron`, `vscode-extension-tester`, `vitest`, `sinon`, `happy-dom` — is already installed. The project has 809 passing React component and flow tests but lacks host-side bridge contract tests, coverage for 10 of 12 views in E2E, and CI automation for any E2E or Selenium test. The recommended approach is a strict three-layer test architecture: Vitest flow tests for the webview side, Mocha + `@vscode/test-electron` for the extension host side, and `vscode-extension-tester` Selenium tests for full VS Code UI validation.

The recommended architecture uses "sandwich testing" — exercising each side of the typed postMessage bridge independently. The webview side is tested by dispatching `MessageEvent` objects directly in Vitest's happy-dom environment using the existing `dispatchExtensionMessage()` helper. The extension host side is tested by calling `WebViewMessageHandler.handleMessageWithSender()` with a sinon spy injected as the `sendResponse` callback. These two layers together verify the full bridge contract without needing VS Code IPC to be involved in every test, which keeps the majority of tests fast. A purpose-built `storeHelpers.ts` with a `resetAllStores()` function is the critical shared utility that prevents Zustand singleton state from leaking between tests.

The primary risks are not architectural — they are operational. Webview iframe flakiness in `vscode-extension-tester` (the Welcome Page interference bug and the inverted wait-order bug in older releases) is the leading cause of CI instability for this type of project. The postMessage race condition (messages dropped before the React app's `window.addEventListener` is registered) is the most common bridge test failure mode. Both have known mitigations: `closeAllEditors()` before every iframe switch for the former, and always simulating the `ready` handshake before asserting bridge responses for the latter. These mitigations must be baked into shared test helpers before any view-specific tests are written.

---

## Key Findings

### Recommended Stack

No new packages are required for v1.2. The entire testing infrastructure is already installed. The only genuinely new artifact is a GitHub Actions CI workflow file (`.github/workflows/test.yml`). The significant decision — whether to migrate from `vscode-extension-tester` to `wdio-vscode-service` for UI testing — is **resolved in favor of keeping `vscode-extension-tester`**: it is already installed at v8.22.0, already has a working test suite, and `wdio-vscode-service` v6.1.4 has no documented support for switching into sidebar webview iframes. Playwright is categorically excluded — it cannot automate VS Code as an extension host target (issue #22351, open with no timeline).

**Core technologies:**
- `vscode-extension-tester` 8.22.0: Selenium-based E2E for all 12 view UI tests — only mature framework with documented sidebar webview iframe support, already proven in this project
- `@vscode/test-cli` 0.0.12 + `@vscode/test-electron` 2.5.2: Mocha test runner inside a real VS Code process — the only way to exercise extension host code that imports the `vscode` module without full manual mocking
- `sinon` 21.0.1: Stub injection for `WebViewMessageHandler` dependency mocking; spy capture of `sendResponse` callback in host-side integration tests
- `vitest` 4.x + `happy-dom`: Webview-side flow and component tests — already running 809 tests, no changes to configuration needed
- GitHub Actions with `xvfb-run -a`: CI automation for headless Linux — the one required new file in the milestone

**Version requirements:** `vscode-extension-tester` 8.22.0 requires VS Code ^1.97.0. All current versions are mutually compatible and verified against installed `node_modules`.

### Expected Features

**Must have (table stakes — v1.2 core):**
- Extension host integration tests (AppStateManager + bridge dispatch) — the host-side gap in current coverage; `WebViewMessageHandler.handleMessageWithSender()` seam already exists for injection-based testing
- Message bridge contract tests — typed discriminated union verification for all 13 state transitions; prevents silent contract drift
- E2E smoke tests for all 12 views — each view must prove it renders in a real VS Code window without crashing; 10 of 12 views currently have zero E2E coverage
- CI integration with GitHub Actions — `test:e2e` is not wired to any CI workflow; E2E tests not in CI are not real tests
- WebSocket error propagation integration test — addresses the HIGH-priority tech debt gap where `ArtemisWebsocketService` failures do not propagate to store error state
- Store hydration round-trip test — verifies the full pipeline from extension host command to Zustand store update, a path not covered by the existing flow tests which mock the bridge

**Should have (v1.2 extended, after core is stable):**
- State persistence integration tests — drives the MEDIUM tech debt fix for webview `getState`/`setState` round-trips
- E2E interaction tests for critical paths — auth flow and exercise submission (~5 tests); requires authenticated session setup
- Accessibility assertions via axe-core on each view's rendered DOM in Vitest
- Screenshot-on-failure wired to `afterEach` in all E2E suites

**Defer (v1.3+):**
- Exam Web Worker real integration test — requires browser environment or custom Vitest worker plugin; significant infrastructure investment
- Navigation flow E2E — high flakiness risk; requires authenticated state across multiple views
- Visual regression / screenshot diffing — cross-platform rendering differences make this maintenance-heavy with poor signal-to-noise ratio

### Architecture Approach

The system has two runtime contexts — an Extension Host (Node.js) and a React Webview (browser IIFE) — connected by a typed postMessage bridge defined in `src/shared/messageContracts.ts`. The v1.2 test layer must span both contexts and the boundary. The key architectural insight is that the bridge seam is already designed for testability: `WebViewMessageHandler.handleMessageWithSender()` accepts a `sendResponse` callback, and the webview side is reachable via `dispatchExtensionMessage()` without launching VS Code. This means most bridge verification can happen in fast, dependency-light tests. Only UI-level claims (does the sidebar actually open, can we switch into the iframe) require the full Selenium stack.

**Major components:**

1. **`test/react/__helpers__/storeHelpers.ts`** (new) — `resetAllStores()` utility that resets all 9 Zustand singletons to initial state; registered in `vitest.setup.ts` `beforeEach`; the foundational guard against state leak between tests
2. **`test/unit/views/app/webViewMessageHandler.test.ts`** (new) — Mocha tests inside the VS Code Extension Development Host; exercises `handleMessageWithSender` with sinon-stub dependencies and a spy `sendResponse` to verify typed outbound message shapes
3. **`test/react/flows/storeHydration.flow.test.tsx`** (new) — Vitest tests covering all 12 `*Init` message types; verifies each one correctly hydrates the corresponding Zustand store via `dispatchExtensionMessage()`
4. **`test/e2e/ui/{view}.ui.test.ts`** (8 new files) — Selenium tests for the 10 views without current E2E coverage (Login and login-flow already exist)
5. **`.github/workflows/test.yml`** (new) — CI workflow with four-phase execution order: Vitest (fastest) → Mocha extension host → optional live E2E → Selenium UI (slowest, xvfb-run on Linux)

### Critical Pitfalls

1. **postMessage dropped before webview listener is ready** — The React app posts `{ type: 'ready' }` when mounted; the extension responds with init data. Bridge tests that bypass this handshake reproduce a documented VS Code race condition (#125546) and silently get empty stores. Prevention: every bridge test must simulate the `ready` handshake before asserting. Never add `setTimeout` delays as a workaround — that masks the race and slows CI permanently.

2. **vscode-extension-tester iframe switching flakiness** — `WebviewView.switchToFrame()` silently targets VS Code's Welcome Page webview instead of the Artemis sidebar, or fails with "Unable to locate element: active-frame" due to a historical wait-order bug (#301). Prevention: always call `await new EditorView().closeAllEditors()` before every `switchToWebviewFrame()` call. This must be built into the shared helper, not left to individual test authors.

3. **Linux CI missing Xvfb** — VS Code (Electron) requires a display server; headless Linux CI runners have none. Both `@vscode/test-electron` and `vscode-extension-tester` tests silently crash. Prevention: wrap all VS Code invocations with `xvfb-run -a` in CI; also pass `--disable-gpu --no-sandbox` in VS Code launch args. Must be done before any CI test run is attempted.

4. **Zustand store state leaks between tests** — All 9 Zustand stores are module-level singletons in Vitest. A test that mutates store state pollutes subsequent tests. Symptoms appear as order-dependent test failures. Prevention: create `resetAllStores()` in `storeHelpers.ts` and call it globally in `beforeEach` in `vitest.setup.ts`. This must be done before any integration test is authored.

5. **Web Worker fake timers silently do nothing** — `vi.useFakeTimers()` has no effect on `setTimeout` inside a Web Worker thread. Tests that call `vi.advanceTimersByTime()` to simulate the exam countdown will hang or time out without ever triggering assertions. Prevention: test the Worker via its message protocol (send `START`, receive `TICK`) with real short-duration timers, not fake timers.

---

## Implications for Roadmap

Based on research, the v1.2 milestone maps cleanly to five phases ordered by dependency and risk.

### Phase 1: Integration Test Infrastructure

**Rationale:** All subsequent test authoring depends on shared helpers being correct. `storeHelpers.ts`, the `ready` handshake helper, and the sinon spy mock factory must exist and be validated before any bridge tests are written. Establishing this infrastructure first means every subsequent phase can assume these primitives are available and correct.

**Delivers:** `storeHelpers.ts` with `resetAllStores()`; `test/react/__helpers__/vscodeApi.ts` extended with `simulateReadyHandshake()` or equivalent; `MockWebviewPanel` sinon factory for host-side tests; `vitest.setup.ts` updated to call `resetAllStores()` globally.

**Addresses:** Extension host integration test foundation (P1 from FEATURES.md), store hydration round-trip tests (P1)

**Avoids:** Zustand state leak pitfall (Pitfall 5), postMessage handshake race pitfall (Pitfall 1), sinon fake timer not restored (PITFALLS.md tech debt checklist)

**Research flag:** Standard patterns — no additional research needed. The `handleMessageWithSender` seam is documented in ARCHITECTURE.md; the sinon spy pattern is established in existing tests.

---

### Phase 2: Extension Host Bridge Tests (Mocha)

**Rationale:** With Phase 1 helpers in place, the host-side bridge tests can be written. These run in Mocha via `@vscode/test-electron`, require the compiled `out/` directory, and exercise `WebViewMessageHandler` and `AppStateManager` with real `vscode` API access. They are the most important tests in the milestone — they verify the bridge behavior that no Vitest test can reach because Vitest cannot import the `vscode` module.

**Delivers:** `test/unit/views/app/webViewMessageHandler.test.ts`; `test/unit/views/app/appStateManager.test.ts`; per-command-module tests; WebSocket error propagation test (the HIGH tech debt gap); store hydration round-trip from host side.

**Uses:** `@vscode/test-cli` + `@vscode/test-electron` + sinon (all already installed); `handleMessageWithSender` seam; Phase 1 mock factory

**Implements:** Integration Point 2 (Message Bridge — Extension Host Side) from ARCHITECTURE.md

**Avoids:** Pitfall 1 (postMessage handshake — verified at unit level here)

**Research flag:** Standard patterns — well-documented. The exact test anatomy is specified in ARCHITECTURE.md with working code examples.

---

### Phase 3: Webview-Side Flow Test Completeness (Vitest)

**Rationale:** Several flow tests are incomplete or missing. `storeHydration.flow.test.tsx` (all 12 `*Init` messages) and `websocket.flow.test.tsx` (disconnect/reconnect) are new files needed for milestone completeness. Expanding existing flow tests (`irisChat`, `courseNavigation`) ensures all views have coverage at the fastest test layer before the slower UI tests run.

**Delivers:** `test/react/flows/storeHydration.flow.test.tsx` (12 `*Init` messages → store verification); `test/react/flows/websocket.flow.test.tsx`; `test/react/flows/dashboard.flow.test.tsx`; expanded `irisChat` and `courseNavigation` coverage.

**Addresses:** Store hydration completeness gap (FEATURES.md), WebSocket update flow coverage, Integration Point 3 from ARCHITECTURE.md

**Avoids:** Pitfall 5 (store state leak — `resetAllStores()` from Phase 1 is the guard)

**Research flag:** Standard patterns — `dispatchExtensionMessage()` pattern is established across 8 existing flow tests. No new patterns needed.

---

### Phase 4: E2E Infrastructure and CI

**Rationale:** The CI workflow and the `switchToWebviewFrame` hardening must exist before any view-specific Selenium tests are authored. These foundational guards (Xvfb, `closeAllEditors()`, VS Code caching) are not optional — they are what make Selenium tests non-flaky. Phase 4 delivers working CI for existing tests first, then Phase 5 adds new view tests into that proven pipeline.

**Delivers:** `.github/workflows/test.yml` (four-phase CI: Vitest → Mocha → optional live E2E → Selenium UI with xvfb-run on Linux); `switchToWebviewFrame` helper hardened with `closeAllEditors()` and explicit `active-frame` wait; VS Code binary caching in CI; `--disable-welcome` flag in VS Code launch args; `this.skip()` guards for tests requiring `ARTEMIS_URL`.

**Uses:** `xvfb-run -a` (Linux), GitHub Actions matrix (ubuntu-latest + macos-latest), `vscode-extension-tester` caching via `cachePath`

**Avoids:** Pitfall 3 (Linux CI Xvfb), Pitfall 2 (iframe flakiness — `closeAllEditors()` guard)

**Research flag:** Standard patterns for Xvfb setup (official VS Code CI docs). The `closeAllEditors()` workaround is documented in ExTester discussion #1690 and confirmed by existing helper code.

---

### Phase 5: E2E View Smoke Tests (10 Remaining Views)

**Rationale:** With CI pipeline working and iframe switching hardened, view-specific smoke tests can be written confidently. Each test follows the same pattern: open Artemis view, switch to iframe, assert minimal expected element is present. Authentication-required views use `ARTEMIS_USER`/`ARTEMIS_PASS` env vars and skip automatically when absent — this matches the existing `login-flow.ui.test.ts` pattern exactly.

**Delivers:** 8 new `.ui.test.ts` files covering Dashboard, CourseList, CourseDetail, ExerciseDetail, ExamStart, ExamConduction, IrisChat, ServiceStatus; all 12 views have at least one passing CI test; screenshot-on-failure wired to `afterEach` in all files.

**Addresses:** E2E smoke tests for all 12 views (P1 from FEATURES.md), screenshot-on-failure (P2)

**Avoids:** Pitfall 2 (iframe flakiness — Phase 4 helpers prevent this); anti-pattern of testing logic already covered by unit tests (ARCHITECTURE.md Anti-Pattern 3)

**Research flag:** Needs attention — the authenticated views (Dashboard through ExamConduction, IrisChat) require a working `loginToArtemis()` helper and test-mode env var setup. This is addressable within the phase but requires care around session state across tests.

---

### Phase Ordering Rationale

- **Helpers before tests:** Phases 1 and 4 both establish shared infrastructure before anything depends on it. Writing tests on a shaky foundation causes re-work.
- **Fast tests before slow tests:** Phases 1-3 are Vitest and Mocha (seconds to minutes). Phases 4-5 are Selenium (minutes to tens of minutes). The CI pipeline mirrors this order — fast feedback first.
- **Bridge contract verification before UI tests:** Phases 2-3 verify the message contract before Phase 5 hits the real webview. If the bridge is broken, Vitest fails within seconds rather than discovering it after a 10-minute Selenium run.
- **CI hardening before new view tests:** Phase 4 before Phase 5 ensures new view tests go into a working pipeline, not a flaky one.

### Research Flags

Phases likely needing deeper attention during planning:
- **Phase 5:** Authenticated view tests require a strategy for how to reach Dashboard state (login via UI vs. injecting auth state via VS Code command). The `Workbench.executeCommand()` pattern exists but login requires real credentials. Consider whether a "test mode" bypass command is feasible within the milestone scope.
- **Phase 2:** `AppStateManager` constructor dependencies — the exact sinon stub signatures need verification against the current source before test scaffolding is finalized. The ARCHITECTURE.md example should be treated as a starting point, not a final spec.

Phases with standard patterns (can proceed without additional research):
- **Phase 1:** `resetAllStores()` pattern is documented in Zustand testing docs; store singleton reset via `setState(initialState, true)` is standard.
- **Phase 3:** All new flow tests follow the `dispatchExtensionMessage()` + `waitFor()` pattern established in 8 existing files.
- **Phase 4:** GitHub Actions workflow structure is specified in STACK.md with a concrete `test.yml` example; `xvfb-run -a` wrapping is well-documented in official VS Code CI docs.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | No new packages required; all versions verified directly against installed `node_modules`; official docs consulted for CI setup; framework decision (keep `vscode-extension-tester`) confirmed by absence of wdio-vscode-service webview iframe docs |
| Features | HIGH | Feature gaps identified by direct codebase inspection; MVP definition is precise and enumerated; P0/P1/P2/P3 priority matrix verified against existing infrastructure |
| Architecture | HIGH | Based on direct inspection of all test files, the `webViewMessageHandler.ts` seam at line 77, and `messageContracts.ts`; patterns specified with working code examples in ARCHITECTURE.md |
| Pitfalls | HIGH (webview/iframe, store leaks), MEDIUM (CI Xvfb, Worker timers) | Webview pitfalls traced to specific GitHub issues with confirmed workarounds; CI Xvfb behavior well-documented in official VS Code CI docs; Worker fake timer limitation confirmed in Vitest docs |

**Overall confidence:** HIGH

### Gaps to Address

- **Authenticated E2E test strategy:** Whether to require real credentials via env vars (existing pattern, simple) or build a test-mode bypass command (more robust, more scope). Research did not prescribe this — decide at the start of Phase 5 planning.
- **`AppStateManager` constructor signature:** The ARCHITECTURE.md test anatomy shows the constructor call with multiple injected dependencies. The exact current constructor signature should be verified against source before Phase 2 scaffolding to ensure mock objects match the required interface.
- **Vitest memory pressure at 1200+ tests:** PITFALLS.md flags a potential memory pressure issue when existing 809 tests plus new integration flow tests exceed ~1200 combined in a single Vitest run. This is a watch item, not a blocker. If it occurs, the remediation is a separate Vitest project config — never modifying the existing `test/react/**` include pattern.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — `iris-thaumantias/test/`, `iris-thaumantias/src/`, `iris-thaumantias/package.json`, `.vscode-test.mjs`, `vitest.config.mts`; all version numbers and existing test patterns confirmed firsthand
- [VS Code Testing Extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension) — `@vscode/test-cli` setup, Mocha extension host patterns
- [VS Code Continuous Integration](https://code.visualstudio.com/api/working-with-extensions/continuous-integration) — xvfb-run requirement, GitHub Actions matrix structure
- [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview) — postMessage, acquireVsCodeApi, iframe sandbox model
- [redhat-developer/vscode-extension-tester releases](https://github.com/redhat-developer/vscode-extension-tester/releases) — v8.22.0 confirmed installed; v8.22.1 is latest as of 2026-02-27

### Secondary (MEDIUM confidence)
- [ExTester Discussion #1690](https://github.com/redhat-developer/vscode-extension-tester/discussions/1690) — `closeAllEditors()` workaround for Welcome Page interference; confirmed against existing `helpers.ts` which already implements this
- [vscode-extension-tester issue #301](https://github.com/redhat-developer/vscode-extension-tester/issues/301) — inverted wait-order bug in `switchToFrame`; confirms need for explicit `active-frame` wait
- [VS Code issue #125546](https://github.com/microsoft/vscode/issues/125546) — postMessage race condition documented; Artemis extension's `ready` handshake is the correct mitigation
- [Vitest discussion #6473](https://github.com/vitest-dev/vitest/discussions/6473) — fake timers do not affect Web Worker threads; confirmed limitation
- [Zustand testing docs](https://docs.pmnd.rs/zustand/guides/testing) — `setState(initialState, true)` pattern for store reset between tests
- [Playwright issue #22351](https://github.com/microsoft/playwright/issues/22351) — Playwright cannot automate VS Code as an extension host target; no committed timeline
- [wdio-vscode-service v6.1.4 documentation](https://webdriverio-community.github.io/wdio-vscode-service/) — absence of sidebar webview iframe support confirmed; informs framework decision

### Tertiary (context, not findings)
- [A Complete Guide to VS Code Extension Testing](https://bromann.dev/post/a-complete-guide-to-vs-code-extension-testing/) — WebdriverIO recommendation for webview testing; informs the framework decision but `vscode-extension-tester` is already installed and working
- [Testing VS Code Extensions with TypeScript — ISE Developer Blog](https://devblogs.microsoft.com/ise/testing-vscode-extensions-with-typescript/) — Sinon/mock patterns; confirms the established approach used in existing `test/unit/` tests

---
*Research completed: 2026-02-28*
*Ready for roadmap: yes*
