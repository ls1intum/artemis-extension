# Pitfalls Research

**Domain:** E2E & Integration Testing for VS Code Extension with React Webviews (v1.2)
**Researched:** 2026-02-28
**Confidence:** HIGH (webview iframe/postMessage pitfalls), MEDIUM (CI display server, Worker testing)

---

## Critical Pitfalls

### Pitfall 1: postMessage Dropped Before Webview Listener Is Ready

**What goes wrong:**
The extension sends `postMessage` to hydrate a webview (e.g., `courseListInit`) before the React app inside the webview has mounted and called `window.addEventListener('message', ...)`. The message is silently dropped. The webview renders with no data, the React store stays empty, and the test asserts against an empty UI.

**Why it happens:**
VS Code fires the `onDidChangeViewState` callback (and extension code often calls `postMessage` in response) before the webview's JavaScript has finished executing and registered its listener. This is a documented race condition in VS Code (issue #125546, introduced in 1.56). There is no error — the message vanishes.

The Artemis webview already implements a `ready` handshake: the React app posts `{ type: 'ready' }` when mounted, and only then does `AppStateManager` respond with initial data. Any integration test that **bypasses this handshake** will reproduce the race condition.

**How to avoid:**
- Integration tests must simulate the full handshake: send `ready`, then wait for the extension to respond before asserting.
- Never write a test that calls `webview.postMessage()` directly and immediately asserts the result — always await the response cycle.
- In unit tests of the bridge, mock the `ready` message delivery and verify that the extension handler waits for it before sending `init` messages.

**Warning signs:**
- Test passes locally (slow CI cold-start means webview JS loads faster) but fails in fast CI runs.
- Assertion on Zustand store state returns empty/initial values despite the extension sending data.
- Manually adding `await new Promise(r => setTimeout(r, 500))` fixes a flaky test — this is the footprint of this pitfall.

**Phase to address:**
Phase 1 (Integration test infrastructure) — Establish the handshake helper at the start of bridge testing, before writing a single bridge assertion.

---

### Pitfall 2: vscode-extension-tester Webview iframe Switching Is Inherently Flaky

**What goes wrong:**
`WebviewView.switchToFrame()` fails with "Unable to locate element: active-frame" or silently operates on the VS Code Welcome Page's webview instead of the Artemis sidebar webview. Tests pass when run manually but fail 30-60% of the time in CI due to DOM load timing.

**Why it happens:**
Three compounding problems documented in vscode-extension-tester:

1. **Inverted wait logic** (issue #301): The framework's `switchToFrame` historically called `findElement()` before `wait()`, meaning if `active-frame` had not rendered yet, the find threw immediately and the wait never ran. Fixed in recent releases but confirmed present in older chromedrivers.

2. **Welcome Page interference** (discussion #1690): VS Code opens the Welcome Page as a webview on first launch. The tester's `WebviewView` selects the *first* available webview, which is often the Welcome Page, not the sidebar extension webview.

3. **Multiple sidebar webviews**: Sidebar webviews are not discarded when hidden. If any other sidebar extension has a webview, `switchToFrame` may target it instead.

**How to avoid:**
- Always call `await new EditorView().closeAllEditors()` before switching to the extension webview — this eliminates Welcome Page interference.
- Pin the vscode-extension-tester version and verify the `switchToFrame` wait order is correct in the pinned version's source.
- Add an explicit `driver.wait(until.elementLocated(By.css('*[id="active-frame"]')), 10000)` before relying on frame content queries.
- In CI, set `--disable-welcome` in VS Code launch args via the `.mocharc.ui.yml` or the launch script.

**Warning signs:**
- Tests operate on wrong elements (wrong form fields, wrong text).
- `WebDriver` `NoSuchElementError` on elements that are visually present when running the test suite manually.
- Screenshot captures VS Code's Welcome Page instead of the Artemis login view.

**Phase to address:**
Phase 2 (E2E infrastructure) — Add the `closeAllEditors()` guard and explicit `active-frame` wait to the `switchToWebviewFrame` helper before writing any view tests.

---

### Pitfall 3: Linux CI Missing Xvfb — VS Code Refuses to Start

**What goes wrong:**
VS Code (Electron) requires a display server to launch. On headless Linux CI runners (GitHub Actions `ubuntu-latest`, most Docker-based CI), there is no display server. The test process exits immediately with: `Error: spawn /usr/bin/Xvfb ENOENT` or VS Code's renderer crashes mid-run.

**Why it happens:**
VS Code uses Electron, which requires a GPU/display context even in test mode. Electron supports `--headless` only for specific scenarios; for `@vscode/test-electron` and vscode-extension-tester, a real X display (virtual or not) is required.

**How to avoid:**
- Wrap all Linux VS Code test invocations with `xvfb-run -a`: `xvfb-run -a npm run test:unit`.
- Use `1024x768x24` depth — not 32-bit (which miscounts bits and can crash Xvfb).
- Use a GitHub Actions wrapper like `GabrielBB/xvfb-action` or `coactions/setup-xvfb` to handle cross-platform detection (skips Xvfb on macOS/Windows automatically).
- Set the D-Bus daemon explicitly to avoid D-Bus errors that appear in otherwise-working Xvfb sessions: `export DBUS_SESSION_BUS_ADDRESS=/dev/null`.
- Disable GPU in the VS Code launch args: `--disable-gpu`, `--no-sandbox`.
- For vscode-extension-tester (Selenium-based), also set `DISPLAY=:99` before starting ChromeDriver.

**Warning signs:**
- CI job exits with code 1 immediately on test start, no test output.
- Error contains "ENOENT", "spawn", "Xvfb", or "renderer process is gone".
- Tests pass on macOS/Windows CI matrix but consistently fail on Linux.

**Phase to address:**
Phase 2 (E2E CI setup) — The CI workflow must be configured for Xvfb before any E2E test is authored.

---

### Pitfall 4: Web Worker Timers Are Invisible to Vitest Fake Timers

**What goes wrong:**
The exam timer Web Worker uses `setTimeout` / `setInterval` internally. Tests call `vi.useFakeTimers()` and `vi.advanceTimersByTime(60_000)` expecting to simulate 60 seconds passing. The timer worker is unaffected — it runs in a separate thread with its own clock. Test assertions about countdown state never trigger.

**Why it happens:**
Vitest's `@vitest/web-worker` plugin runs workers in a separate thread. Vitest explicitly states: "fake timers do not impact setTimeout within web workers" and "all mocking is not able to be applied" to workers because the worker runs in an isolated context.

The Artemis exam timer worker uses **absolute timestamps** (this is documented as the correct implementation), so tests must either:
- Test the timer at the boundary (the worker protocol: messages it sends and receives), not by faking time inside the worker.
- Inject a test-controlled clock via worker message (requires modifying the worker implementation).

**How to avoid:**
- Test the worker as a black box via its message protocol: send `START` with a known `endTime`, then receive `TICK` messages.
- Use real timers with a very short test duration (e.g., `endTime = Date.now() + 100`) rather than fake timers.
- Do not attempt to `vi.useFakeTimers()` in tests that exercise the exam Worker — it has no effect and the test will hang or time out.
- Unit test the timer *logic* (the calculation of remaining time from absolute timestamps) separately from the Worker itself — these calculations can be tested synchronously without the Worker.

**Warning signs:**
- Test using `vi.advanceTimersByTime()` waits indefinitely for a timer callback that never fires.
- Worker tests time out at the Vitest default (5000ms) with no assertions having run.
- Wrapping the worker test in `vi.runAllTimersAsync()` has no effect.

**Phase to address:**
Phase 3 (Exam timer tests) — Define the Worker testing approach (boundary/protocol testing) in the phase plan before authoring any timer test.

---

### Pitfall 5: Zustand Store State Leaks Between Tests

**What goes wrong:**
Zustand stores are module-level singletons. A test that calls `useExamConductionStore.getState().setExamData(...)` mutates the shared store. The next test starts with leftover exam data, causing false positives or false negatives in subsequent assertions.

**Why it happens:**
Zustand's `create()` returns a store bound to module scope. In Vitest with `happy-dom`, there is no browser-like page reload between tests. Tests share the same module instance, so store state accumulated in test N is visible in test N+1.

The project currently has 9 Zustand stores across 35 test files. The existing 809 tests are structured as isolated unit tests, but integration tests that exercise multiple stores in sequence are particularly vulnerable.

**How to avoid:**
- Establish a `resetAllStores()` utility in `test/react/__helpers__/` that calls each store's `setState` with its initial state.
- Call `resetAllStores()` in a global `beforeEach` registered in `vitest.setup.ts`.
- Follow the Zustand testing docs: expose a `resetStore` function via the store definition, or use `useStore.setState(initialState, true)` (the `true` flag replaces rather than merges).
- For integration tests specifically: always reset stores in `beforeEach`, not just `afterEach` (a failing test may not reach `afterEach`).

**Warning signs:**
- Tests pass in isolation (`vitest run --reporter=verbose --testNamePattern="..."`) but fail when the full suite runs.
- Test order matters: running tests alphabetically vs. by last-modified produces different results.
- A test that should show an empty course list shows data from a previous test.

**Phase to address:**
Phase 1 (Integration test infrastructure) — Add `resetAllStores()` to `vitest.setup.ts` before writing any integration test that touches stores.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `driver.sleep(5000)` in E2E tests | Test passes reliably locally | CI slow, brittle on faster/slower machines | Never — use `driver.wait(until.elementLocated(...))` instead |
| Skipping webview tests instead of fixing flakiness | Faster CI | Coverage gap grows, flaky tests accumulate | Only as temporary triage with a follow-up issue |
| Mocking `acquireVsCodeApi()` at global scope in Vitest setup | React components render without VS Code context | Shared mock leaks between tests; any test modifying postMessage behavior affects all tests | Only if mock is reset per test |
| Adding 500ms–3s `setTimeout` workaround for postMessage timing | Fixes one test | Masks the race; next developer adds another sleep; CI becomes 30s longer per test | Never — use handshake/ready pattern |
| Using `sinon.useFakeTimers()` without `.restore()` in teardown | Simplifies test | Fake timers leak into following tests, causing unrelated timeouts | Never — always restore in `teardown`/`afterEach` |
| Running E2E tests against a live Artemis server in CI | Real integration coverage | CI becomes environment-dependent, fails if server is down | Only for nightly runs, never blocking PRs |

---

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| postMessage bridge (extension → webview) | Calling `webview.postMessage()` and immediately asserting store state | Wait for `ready` message first; assert after the extension's response arrives |
| postMessage bridge (webview → extension) | Directly calling the extension handler function in tests | Post through the actual `onDidReceiveMessage` handler to test the dispatch logic |
| STOMP/WebSocket mock | Creating a `MockStompClient` that auto-fires `onConnect` synchronously | STOMP connection is async; the mock must be triggered explicitly (as existing tests do with `simulateConnect()`) |
| Zustand store hydration via postMessage | Dispatching messages in the wrong order (e.g., `courseDetailInit` before `courseListInit`) | Integration tests must mirror the real message flow order; document the initialization sequence |
| VS Code `getState()`/`setState()` persistence | Testing persistence by checking `getState()` immediately after `setState()` in the same process | `getState()`/`setState()` round-trips through VS Code's extension host; not synchronous in real webview — test the mock boundary separately |
| vscode-extension-tester sidebar webview | Operating on `WebviewView` without closing editors first | Always `await new EditorView().closeAllEditors()` before calling `switchToWebviewFrame()` |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Each E2E test opens VS Code fresh | Tests are isolated but suite takes 30+ minutes | Use one VS Code instance per suite; reset extension state between tests via commands | At ~20 E2E tests |
| vscode-extension-tester downloading VS Code on every CI run | CI takes 5+ minutes just on VS Code download | Cache `~/.vscode-test` in CI; pin VS Code version | Every CI run |
| Vitest running 809 existing tests + new integration tests in one pass | Memory pressure in happy-dom; false OOMs | Use separate Vitest projects or `--pool=forks` for integration tests | At ~1200 combined tests |
| Real `setTimeout` waits in rate-limiting tests (existing `test:struggle`) | 3-second real waits make test suite slow | Acceptable for isolated tests; isolate slow tests to their own label | When accumulated across many tests |
| E2E tests asserting on text content in multiple locales | Tests fail when VS Code UI language differs from expected | Use data-testid attributes instead of visible text | On non-English CI runners |

---

## Security Mistakes

Domain-specific security issues relevant to testing.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Hardcoding `ARTEMIS_USER` / `ARTEMIS_PASS` in test files | Credentials leaked in git history | Always read from environment variables; never commit credentials |
| Disabling CSP in test environment via `default-src *` | Tests pass but CSP enforcement is untested; security regressions ship undetected | Test with the real nonce-based CSP in place; mock nonce generation to return a predictable value for testing |
| Using `--disable-web-security` in ChromeDriver for E2E tests | Bypasses the same-origin checks that protect users | Find the correct iframe switching pattern instead |
| Logging full WebSocket message bodies in test output | Exam content, chat messages, auth tokens visible in CI logs | Use structured logging with redaction; never log full message bodies in test helpers |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Integration test for bridge hydration**: Often missing the `ready` handshake step — verify the test sends `{ type: 'ready' }` and waits for the extension's response before asserting store state.
- [ ] **E2E test for all 12 views**: Often only tests the login view (easiest to access) — verify each of the 12 views has at least one test: Login, Dashboard, CourseList, CourseDetail, ExerciseDetail, IrisChat, ExamStart, ExamConduction, ExamExerciseDetail, GitCredentials, ServiceStatus, HealthCheck.
- [ ] **CI Xvfb setup**: Often added for unit tests but not for E2E/UI tests — verify `xvfb-run -a` wraps both `test:unit` and `test:ui` steps in the CI workflow.
- [ ] **Store reset in test setup**: Often remembered for unit tests but forgotten in the new integration test setup file — verify `resetAllStores()` is called in `beforeEach` in the integration test vitest setup.
- [ ] **vscode-extension-tester closeAllEditors guard**: Often missing in tests authored after the initial helper — verify every test file that calls `switchToWebviewFrame` is preceded by `closeAllEditors()`.
- [ ] **Web Worker timer boundary tests**: Often written as fake-timer tests that silently never execute — verify Worker tests use real short-duration timers or explicit message protocol assertions, not `vi.advanceTimersByTime()`.
- [ ] **CSP nonce in integration tests**: Often CSP is disabled or `unsafe-inline` is added "just for tests" — verify the nonce is mocked to a known value, not disabled.
- [ ] **teardown restores sinon timers**: Existing websocket tests already do this correctly — verify new integration tests follow the same `teardown` pattern with `clock.restore()`.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| postMessage race condition causing flaky tests | LOW | Add handshake helper; replace sleep-based waits with event-driven waits |
| vscode-extension-tester iframe flakiness | MEDIUM | Pin working version; add `closeAllEditors()`; add explicit `active-frame` wait in `switchToWebviewFrame` helper |
| Xvfb crashes mid-CI-run | LOW | Restart Xvfb with 24-bit depth; add `--no-sandbox --disable-gpu` to VS Code launch args |
| Worker fake-timer tests hanging | LOW | Convert to real-timer boundary tests with short endTime; remove `vi.useFakeTimers()` |
| Zustand state leak breaking suite | LOW | Add `resetAllStores()` to `vitest.setup.ts` and re-run suite |
| E2E tests hitting live Artemis server timing out | MEDIUM | Add `this.skip()` guard when `ARTEMIS_URL` is unreachable (as `uncommittedChanges.e2e.test.ts` already does); extract contract tests from network tests |
| 809 existing tests broken by new test infrastructure | HIGH | Scope infrastructure changes to separate Vitest project config; never modify `vitest.config.mts` in a way that affects `test/react/**` include pattern |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| postMessage handshake race condition | Phase 1: Integration test infrastructure | All bridge tests send `ready` first; no `setTimeout` delays in bridge test code |
| vscode-extension-tester iframe flakiness | Phase 2: E2E infrastructure | `switchToWebviewFrame` helper includes `closeAllEditors()` and explicit `active-frame` wait |
| Linux CI missing Xvfb | Phase 2: CI configuration | CI workflow runs on Linux with `xvfb-run -a`; matrix includes Linux |
| Web Worker fake timer limitation | Phase 3: Exam timer tests | No `vi.useFakeTimers()` in worker tests; boundary protocol tests used instead |
| Zustand store state leak | Phase 1: Integration test infrastructure | `resetAllStores()` in `vitest.setup.ts`; verified by running stores tests in random order |
| Zustand `resetAllStores` missing from new setup file | Phase 1: Integration test infrastructure | `test/react/integration/__helpers__/vitest.setup.ts` imports and calls reset utility |
| Sinon fake timer not restored | Phase 1: Integration test infrastructure | Teardown pattern review; `clock.restore()` in every `teardown`/`afterEach` that uses fake timers |
| E2E tests depend on live server | Phase 2: E2E infrastructure | All E2E tests have `this.skip()` / `test.skip()` guards when external services unreachable |
| CSP nonce disabled in test environment | Phase 2: E2E infrastructure | CSP nonce mocked to predictable value, not disabled; webview CSP test (`csp.test.ts`) extended to cover nonce injection |
| VS Code caching missing in CI | Phase 2: CI configuration | `.vscode-test` directory cached in CI workflow by VS Code version key |
| Missing view coverage (fewer than 12 views tested) | Phase 4–5: View E2E tests | Test matrix enumerates all 12 views; CI report shows ≥1 passing test per view |

---

## Sources

- VS Code postMessage race condition (issue #125546): https://github.com/microsoft/vscode/issues/125546
- Webview integration tests flakiness (issue #153066, resolved by deletion): https://github.com/microsoft/vscode/issues/153066
- vscode-extension-tester active-frame wait order bug (issue #301): https://github.com/redhat-developer/vscode-extension-tester/issues/301
- vscode-extension-tester sidebar webview Welcome Page interference (discussion #1690): https://github.com/redhat-developer/vscode-extension-tester/discussions/1690
- VS Code CI: Xvfb requirements: https://code.visualstudio.com/api/working-with-extensions/continuous-integration
- VS Code renderer crashes with Xvfb (issue #174744): https://github.com/microsoft/vscode/issues/174744
- Vitest fake timers do not affect Web Workers (discussion #6473): https://github.com/vitest-dev/vitest/discussions/6473
- Zustand store reset between tests: https://docs.pmnd.rs/zustand/guides/testing
- vitest-websocket-mock (Vitest fork of jest-websocket-mock): https://github.com/akiomik/vitest-websocket-mock
- Fake timer + MSW compatibility: https://dheerajmurali.com/blog/vitest-usefaketimer-and-msw/
- VS Code webview getState/setState persistence issues (issue #56839): https://github.com/microsoft/vscode/issues/56839

---
*Pitfalls research for: V1.2 E2E & Integration Testing — VS Code Extension with React Webviews*
*Researched: 2026-02-28*
