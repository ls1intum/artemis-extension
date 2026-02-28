# Feature Research

**Domain:** VS Code extension E2E and integration testing (React webviews with postMessage bridge)
**Researched:** 2026-02-28
**Confidence:** HIGH

## Context

This research is scoped to v1.2: adding E2E and integration tests to an existing VS Code extension with 12 React webview views, 809 unit/component tests (Vitest + RTL), and a typed postMessage bridge. The project already has:

- `@vscode/test-cli` + `@vscode/test-electron` installed (unit test runner)
- `vscode-extension-tester` v8.22 installed (Selenium-based UI automation)
- `vitest` + `@testing-library/react` + `happy-dom` (component tests)
- Flow tests in `test/react/flows/` (bridge mock + store hydration patterns)
- Skeleton E2E tests under `test/e2e/ui/` (login view, login flow) — not wired to CI

---

## Feature Landscape

### Table Stakes (Users/Maintainers Expect These)

Features expected from a mature, production VS Code extension test suite. Missing these = test infrastructure is considered incomplete for the domain.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Extension host integration tests | Standard for any VS Code extension using the VS Code API | MEDIUM | Run via `@vscode/test-electron` inside Extension Development Host with access to full `vscode.*` API. Already have `test/unit/` tests using this runner — integration tests follow the same pattern but exercise provider/bridge behavior instead of pure logic. |
| postMessage bridge integration tests | The bridge is the core communication channel; all 12 views depend on it | MEDIUM | Existing flow tests in `test/react/flows/` already cover OUTBOUND (postMessage spy) and INBOUND (dispatchExtensionMessage) in Vitest/happy-dom. Gap: no host-side verification that AppStateManager actually calls `webview.postMessage()` with correct typed payloads. |
| Store hydration tests | Zustand store initialization from bridge messages is critical to every view | MEDIUM | Already partly covered in flow tests (stores are hydrated via dispatchExtensionMessage). Gap: no tests verifying the full round-trip — extension host receives a command and hydrates store via postMessage response. |
| E2E framework decision and setup | Every mature extension has a chosen E2E framework; ad-hoc Selenium scripts are not sufficient | HIGH | Two options exist for VS Code: `vscode-extension-tester` (Selenium, already installed, RedHat, lower-level) vs `wdio-vscode-service` (WebdriverIO, higher-level page objects, explicitly recommended by VS Code team for webview testing). Decision must precede all E2E test writing. |
| E2E smoke tests for all 12 views | Verifies each view renders without crash and shows minimal expected UI | HIGH | Project has 12 views: Login, Dashboard, CourseList, CourseDetail, ExerciseDetail, ExamStart, ExamConduction, ExamExerciseDetail, IrisChat, BuildFeedback, ProblemStatement, ServiceStatus. Currently only Login is smoke tested. Webview tests require iframe context switching. |
| CI integration for E2E | E2E tests not in CI are not real tests | MEDIUM | Linux CI requires `xvfb-run -a` wrapper. macOS/Windows run directly. `@vscode/test-cli` handles VS Code download/launch. Existing `test:unit` script uses `vscode-test`; E2E needs same runner plus xvfb setup. GitHub Actions matrix recommended. |
| Test isolation (no shared state) | Tests that leak state cause false failures and intermittent CI | MEDIUM | Zustand stores persist across tests unless reset. Already handled in flow tests via `beforeEach` store resets. Must enforce same pattern in all integration/E2E tests. |

### Differentiators (Valuable but Not Universal)

Features that distinguish a high-quality test suite. Not every VS Code extension has these, but they provide measurable confidence gains.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Message bridge contract tests (host-side) | Verifies that AppStateManager sends the correct typed discriminated-union messages | HIGH | Extension host unit tests already exist but don't verify message payloads dispatched to webview. Test pattern: mock `vscode.Webview`, call extension host methods, assert `postMessage` called with correct typed payload. Requires Extension Development Host environment (`@vscode/test-electron`). |
| WebSocket mock for integration tests | Enables testing STOMP/WebSocket-triggered store updates without a live server | HIGH | The WebSocket error propagation gap (HIGH tech debt) cannot be tested without this. Mock pattern: intercept `ArtemisWebsocketService` at the boundary, simulate `onMessage` callbacks, verify store updates. Already mocked in flow tests via `vi.mock()` — same pattern needed in host-side integration tests. |
| State persistence tests (getState/setState) | Verifies that webview state is persisted correctly across hide/show panel cycles | MEDIUM | Known gap: no webview state persistence currently (MEDIUM tech debt). Integration test proves the absence, then drives the fix. Pattern: `createMockVsCodeApi({ getState: () => savedState })` already exists in flow tests. |
| Exam timer Web Worker integration test | Verifies Worker message accuracy separate from component rendering | HIGH | Current examTimer.flow.test.tsx mocks `useExamTimer` because `esbuild-plugin-inline-worker` is unavailable in Vitest SSR. A proper integration test would exercise the actual Worker binary in a browser environment. Requires `@vscode/test-web` or a separate browser test environment — significant infrastructure cost. |
| Screenshot capture on E2E test failure | Debugging aid for intermittent CI failures | LOW | `vscode-extension-tester` WebDriver already has `driver.takeScreenshot()`. Pattern exists in `test/e2e/ui/helpers.ts`. Wire to `afterEach` on failure automatically. |
| Navigation flow E2E tests | Verifies breadcrumb routing across view transitions in real VS Code | HIGH | Current navigation.flow.test.tsx tests Zustand store in isolation. E2E version would click through views and verify URL/breadcrumb state — requires authenticated session setup which is complex in E2E context. |
| Accessibility tests on webview DOM | axe-core assertions on rendered webview HTML | MEDIUM | Can run axe-core inside Vitest/happy-dom environment on each view's rendered output. `@testing-library/jest-dom` + `jest-axe` or `axe-core` directly. Not VS Code-specific — runs in Vitest layer. Catches missing ARIA roles, color contrast issues. |
| CSP invariant tests | Verifies nonce-based CSP is not accidentally weakened | LOW | Already implemented in `test/react/security/csp.test.ts` as source file inspection. Approach is correct and complete. |

### Anti-Features (Avoid These)

Features that seem appropriate but introduce more cost than value in this specific VS Code extension context.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full UI automation of all 12 views with credential login | "Test everything end-to-end like a real user" | Requires live Artemis server, real credentials in CI, network dependency, 3-5 minute run time. The existing login-flow.ui.test.ts already skips when credentials are absent. Fragile, slow, hard to debug. | Smoke tests verify view renders; integration tests verify bridge behavior; flow tests verify user interaction patterns. Reserve credential-based tests for manual/scheduled runs against staging, not PR CI. |
| Visual regression / screenshot diffing | "Catch unintended UI changes" | Webviews render differently per OS, VS Code version, and theme. Screenshot diffing produces constant false positives in cross-platform CI. High maintenance. | CSS Modules + component tests (RTL) already prevent most CSS regressions. Use manual visual review for intentional design changes. |
| Testing every Zustand store action in E2E | "Verify everything at the highest level" | E2E tests are 10-100x slower than Vitest tests. Store logic is already tested at unit/flow level. Duplicating at E2E layer adds maintenance with zero confidence gain. | Keep store tests in Vitest (fast, deterministic). E2E tests verify view-level behavior, not store internals. |
| `@vscode/test-web` browser environment | "More coverage by testing web extension" | This extension uses Node.js APIs (file system, git) that are unavailable in web environment. Building a web-compatible version is not on the roadmap (constraint: IIFE bundle format). | Skip `@vscode/test-web`. Focus on `@vscode/test-electron` for host tests + `vscode-extension-tester` for UI E2E. |
| Playwright for VS Code extension E2E | "Playwright is the modern E2E standard" | Playwright tests VS Code extensions via Electron automation, not via the VS Code extension test runner. This means no access to `vscode.*` API in tests. `wdio-vscode-service` or `vscode-extension-tester` (both WebDriver-based) are the only options that can interact with the VS Code workbench AND access VS Code APIs. Playwright is for testing web apps, not VS Code extensions. | Use `vscode-extension-tester` (already installed) or `wdio-vscode-service` for UI automation. Use `@vscode/test-electron` for extension host API access. |
| 100% E2E coverage mirroring unit tests | "Every unit test scenario should also have an E2E test" | E2E tests are fundamentally different in purpose: verify integration contracts and critical paths, not cover every branch. Mirroring creates thousands of slow tests. | Test pyramid: unit/component tests (fast, many) > integration tests (medium) > E2E smoke tests (slow, few). Current 809 Vitest tests are the base. Integration + E2E add contract verification on top. |

---

## Feature Dependencies

```
vscode-extension-tester (already installed v8.22)
    └──enables──> E2E smoke tests for all 12 views
                      └──requires──> iframe context switching (switchToWebviewFrame pattern)
                      └──requires──> VS Code launch config pointing to built extension
                      └──blocks──> CI integration (must work locally first)

@vscode/test-electron (already installed v2.5.2)
    └──enables──> Extension host integration tests
                      └──requires──> Compiled TypeScript output (out/ directory)
                      └──enables──> Message bridge contract tests (host-side)
                      └──enables──> WebSocket mock integration tests
                      └──enables──> State persistence tests

Vitest flow tests (already exist: auth, exercise, exam, iris, navigation, errors)
    └──pattern-reused-by──> New integration tests in @vscode/test-electron suite
    └──complements──> E2E smoke tests (different test layers)

postMessage bridge (typed discriminated unions, v1.1 ✓)
    └──tested-by──> Message bridge contract tests (host-side)
    └──tested-by──> Existing flow tests (webview-side)

AppStateManager (extension host, 13 states)
    └──tested-by──> Extension host integration tests
    └──NOT tested by──> Vitest flow tests (those mock the bridge entirely)

WebSocket/STOMP service (ArtemisWebsocketService)
    └──mocked-by──> vi.mock() in flow tests (pattern exists)
    └──needs──> Mock in host-side integration tests for WebSocket error propagation tests

Exam Web Worker (esbuild-plugin-inline-worker)
    └──blocked-in-vitest──> Worker binary not available in SSR transform
    └──testable-via──> Real Extension Development Host (needs @vscode/test-electron integration)
    └──currently-covered-by──> useExamTimer hook mock in examTimer.flow.test.tsx
```

### Dependency Notes

- **E2E tests require compiled output:** `vscode-extension-tester` launches VS Code with the extension loaded from `dist/`. Tests cannot run before `npm run compile`. The existing `test:e2e` script already chains `compile-tests && vscode-test`.
- **Integration tests require Extension Development Host:** Any test needing `vscode.*` API runs via `@vscode/test-electron`, not Vitest. These are slower (VS Code launches) but have access to real extension host context.
- **Flow tests and integration tests complement, not replace each other:** Flow tests (Vitest) are fast, cover interaction patterns with mocked bridge. Integration tests (`@vscode/test-electron`) are slower, verify the actual bridge + AppStateManager behavior.
- **WebSocket mock pattern already established:** `vi.mock('../../../src/views/webview/react/hooks/useWebSocketUpdates', ...)` in exerciseSubmission.flow.test.tsx. Same pattern extends to host-side ArtemisWebsocketService mocking.
- **vscode-extension-tester vs wdio-vscode-service decision blocks all E2E work:** Must choose before writing any view smoke tests. `vscode-extension-tester` is already installed but lower-level. `wdio-vscode-service` has explicit webview page objects. This is the first task of the milestone.

---

## Test Category Reference

Specific to VS Code extension testing (not generic web testing):

| Category | Runner | Speed | What It Verifies | Count Target |
|----------|--------|-------|-----------------|--------------|
| React component tests | Vitest + happy-dom | Fast (ms) | Rendering, props, user events | Already 809 |
| React flow tests | Vitest + happy-dom | Fast (ms) | postMessage round-trips (mocked bridge) | Already ~50 |
| Extension host unit tests | @vscode/test-electron | Medium (s) | Pure logic in extension host (no VS Code API) | Already ~30 |
| Extension host integration tests | @vscode/test-electron | Medium (s) | AppStateManager + bridge dispatch + WebSocket mock | NEW: ~20-30 |
| E2E webview smoke tests | vscode-extension-tester | Slow (10-30s/test) | Each view renders, minimal DOM present | NEW: ~12 (1 per view) |
| E2E interaction tests | vscode-extension-tester | Slow | User flows in real VS Code | NEW: ~5-8 critical paths |
| CI smoke tests (no credentials) | vscode-extension-tester | Slow | Extension loads, sidebar visible | NEW: entry gate |

---

## MVP Definition

### Launch With (v1.2 Core)

Minimum testing coverage to claim "comprehensive E2E and integration testing" — the v1.2 milestone goal.

- [ ] **E2E framework decision** — Pick `vscode-extension-tester` (keep existing) or migrate to `wdio-vscode-service`. Essential prerequisite for all E2E work.
- [ ] **Extension host integration tests** — Cover AppStateManager message dispatch: verify typed postMessage payloads sent to webview for each of the 13 state transitions. Uses `@vscode/test-electron`.
- [ ] **Message bridge contract tests** — Mock `vscode.Webview`, call extension host handlers, assert correct discriminated-union message shapes. Prevents bridge contract drift.
- [ ] **E2E smoke tests for all 12 views** — Each view: extension loads, sidebar opens, webview iframe accessible, minimal expected element visible. No credentials needed for pre-login views. ~12 tests.
- [ ] **CI integration** — `test:e2e` job in GitHub Actions with xvfb-run on Linux. Separate from `test:react` (Vitest). Both must pass on PR.
- [ ] **WebSocket error propagation integration test** — Tests the HIGH tech debt gap: ArtemisWebsocketService failure propagates to store error state (drives the fix).
- [ ] **Store hydration round-trip test** — Extension host receives command → processes → dispatches postMessage → Zustand store hydrated. Verifies the full path not covered by flow tests.

### Add After Core (v1.2 Extended)

Features to add once core integration infrastructure is working.

- [ ] **State persistence integration tests** — Tests the MEDIUM tech debt: webview state survives panel hide/show via `getState`/`setState`. Drives the fix.
- [ ] **E2E interaction tests for critical paths** — Auth flow (login button → loading → logged-in state transition visible in real VS Code), exercise submission flow (Start Exercise → Submit → build progress). ~5 tests.
- [ ] **Accessibility assertions** — axe-core on rendered view DOM in Vitest layer. Add to each of the 12 view test files.
- [ ] **Screenshot-on-failure** — Wire `takeScreenshot` to `afterEach` in E2E tests automatically when test fails.

### Future Consideration (v1.3+)

Defer until core E2E infrastructure is proven stable.

- [ ] **Exam Web Worker real integration test** — Requires browser environment or custom Vitest worker plugin to test actual Worker binary. Complex infrastructure change. The hook mock provides sufficient coverage for now.
- [ ] **Navigation flow E2E** — Clicking through Dashboard → CourseList → CourseDetail → ExerciseDetail in real VS Code. Requires authenticated state, complex setup. High value but high flakiness risk.
- [ ] **Visual regression tests** — Defer indefinitely. Cross-platform rendering differences make this maintenance-heavy with low signal-to-noise ratio.

---

## Feature Prioritization Matrix

| Feature | Confidence Gain | Implementation Cost | Priority |
|---------|----------------|---------------------|----------|
| E2E framework decision | N/A (prerequisite) | LOW (research + config) | **P0** |
| Extension host integration tests (bridge) | HIGH | MEDIUM | **P1** |
| Message bridge contract tests | HIGH | MEDIUM | **P1** |
| E2E smoke tests for all 12 views | HIGH | HIGH (iframe switching per view) | **P1** |
| CI integration (xvfb + GitHub Actions) | HIGH | MEDIUM | **P1** |
| WebSocket error propagation test | HIGH | HIGH (drives tech debt fix) | **P1** |
| Store hydration round-trip test | HIGH | MEDIUM | **P1** |
| State persistence integration test | MEDIUM | MEDIUM | **P2** |
| E2E interaction tests (auth + submission) | MEDIUM | HIGH | **P2** |
| Accessibility assertions (axe-core) | MEDIUM | LOW | **P2** |
| Screenshot-on-failure | LOW | LOW | **P2** |
| Exam Worker real integration test | LOW | HIGH | **P3** |
| Navigation flow E2E | MEDIUM | HIGH (flakiness risk) | **P3** |

**Priority key:**
- P0: Must decide/complete before any other work begins
- P1: Must have for v1.2 milestone completion
- P2: Should have, add when P1 work is stable
- P3: Nice to have, defer to v1.3+

---

## Existing Test Infrastructure Assessment

What already exists and how new tests build on it.

### Already Working (Do Not Change)

| Infrastructure | Location | Status |
|----------------|----------|--------|
| `createMockVsCodeApi()` | `test/react/__helpers__/vscodeApi.ts` | Solid mock for webview-side bridge testing |
| `dispatchExtensionMessage()` | `test/react/__helpers__/vscodeApi.ts` | Simulates INBOUND messages in Vitest |
| Zustand store reset pattern | `beforeEach` in all flow tests | Must be replicated in all new tests |
| `switchToWebviewFrame()` helper | `test/e2e/ui/helpers.ts` | Works with vscode-extension-tester |
| `takeScreenshot()` helper | `test/e2e/ui/helpers.ts` | Available for on-failure capture |
| `.vscode-test.mjs` config | root | Labels: `unit` and `e2e`. Add `integration` label here. |

### Gaps to Fill

| Gap | Impact | Notes |
|-----|--------|-------|
| No host-side bridge contract tests | HIGH | AppStateManager → webview.postMessage never verified |
| No WebSocket failure propagation tests | HIGH | Drives the HIGH tech debt fix in v1.2 |
| Only 2 views have E2E smoke tests (Login only) | HIGH | 10 of 12 views have zero E2E coverage |
| E2E tests not wired to CI | HIGH | `test:e2e` exists in package.json but not in CI workflow |
| No store hydration round-trip (full path) | MEDIUM | Flow tests mock the bridge; integration tests must not |

---

## Sources

### Official Documentation

- [VS Code Testing Extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension) — `@vscode/test-cli`, `@vscode/test-electron`, Mocha, Extension Development Host (MEDIUM confidence — verified current)
- [VS Code Continuous Integration](https://code.visualstudio.com/api/working-with-extensions/continuous-integration) — xvfb-run, GitHub Actions matrix, platform-specific setup (HIGH confidence — official docs)
- [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview) — postMessage, acquireVsCodeApi, iframe sandbox model (HIGH confidence — official docs)

### Framework Documentation

- [WebdriverIO VS Code Extension Testing](https://webdriver.io/docs/extension-testing/vscode-extensions/) — wdio-vscode-service, webview iframe switching via `getAllWebviews()`, page objects (MEDIUM confidence — verified current)
- [wdio-vscode-service API](https://webdriverio-community.github.io/wdio-vscode-service/) — Page object classes: ActivityBar, WebviewView, etc. (MEDIUM confidence — verified current)
- [vscode-extension-tester GitHub](https://github.com/redhat-developer/vscode-extension-tester) — Selenium-based, already installed in project (HIGH confidence — already used in project)

### Community Patterns

- [A Complete Guide to VS Code Extension Testing](https://dev.to/sourishkrout/a-complete-guide-to-vs-code-extension-testing-268p) — Test pyramid, official packages lack webview support, WebdriverIO recommended (MEDIUM confidence — verified)
- [Testing VSCode Extensions with TypeScript](https://devblogs.microsoft.com/ise/testing-vscode-extensions-with-typescript/) — Mock patterns, wrapper abstraction, vscode API mocking (MEDIUM confidence — Microsoft DevBlogs, authoritative)
- [VS Code Extension Testing Discussion](https://github.com/microsoft/vscode-discussions/discussions/9) — Official guidance that @vscode/test-electron lacks webview support (MEDIUM confidence — from microsoft/vscode-discussions)

### Project-Specific Findings (HIGH confidence — from codebase inspection)

- Existing `test/react/flows/` pattern: `createMockVsCodeApi` + `dispatchExtensionMessage` is the established integration test pattern for the webview side
- `vscode-extension-tester` v8.22.0 already installed — no new dependency needed for Selenium-based E2E
- `@vscode/test-cli` v0.0.12 + `@vscode/test-electron` v2.5.2 already installed — no new dependency needed for host tests
- `test:e2e` script exists but only covers `out/test/e2e/**/*.e2e.test.js` — not wired to CI
- Web Worker mocking constraint is documented in `examTimer.flow.test.tsx` comments — real Worker tests require browser environment

---
*Feature research for: VS Code extension E2E and integration testing (Artemis extension, v1.2 milestone)*
*Researched: 2026-02-28*
*Confidence: HIGH — Verified against official VS Code docs, project codebase inspection, and community sources*
