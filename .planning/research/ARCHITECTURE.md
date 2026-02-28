# Architecture Research: E2E & Integration Testing Integration

**Domain:** VS Code Extension — E2E and Integration Testing Layer
**Researched:** 2026-02-28
**Confidence:** HIGH (based on direct codebase inspection)

---

## System Overview

The existing system splits across two runtime contexts connected by a postMessage bridge. The v1.2 test layer must span both contexts and the boundary between them.

```
┌──────────────────────────────────────────────────────────────────────┐
│                      Extension Host (Node.js)                        │
│                                                                      │
│  ArtemisWebviewProvider    ChatWebviewProvider                       │
│        │                         │                                  │
│  AppStateManager           ContextStore                             │
│  WebViewMessageHandler     ChatMessageService                       │
│  ViewRouter (12 views)     ChatSessionService                       │
│        │                         │                                  │
│  ┌─────┴─────────────────────────┴──────────────────────────┐       │
│  │          postMessage Bridge (typed discriminated unions)   │       │
│  │          src/shared/messageContracts.ts                    │       │
│  └─────────────────────────────┬──────────────────────────────┘      │
├───────────────────────────────┴──────────────────────────────────────┤
│                    React Webview (Browser IIFE)                      │
│                                                                      │
│  App.tsx (data-view router)                                         │
│  ├── 12 View Components (one per AppState)                          │
│  └── 9 Zustand Stores (one per feature domain)                      │
│                                                                      │
│  Message flow: extension postMessage → window.message → store action │
│  Command flow: UI event → vscodeApi.postMessage → extension handler  │
└──────────────────────────────────────────────────────────────────────┘

Testing Layers (new in v1.2):
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 1: Integration Tests (Vitest, already partially exists)       │
│  test/react/flows/*.flow.test.tsx — tests message bridge + stores    │
│  Uses: dispatchExtensionMessage() + createMockVsCodeApi()            │
├──────────────────────────────────────────────────────────────────────┤
│  Layer 2: E2E — Extension Host Unit (Mocha + @vscode/test-cli)       │
│  test/e2e/*.e2e.test.ts — integration against live Artemis API       │
│  Uses: real fetch, real API, real Mocha suite/test runner            │
├──────────────────────────────────────────────────────────────────────┤
│  Layer 3: E2E — UI (vscode-extension-tester + Selenium/ChromeDriver) │
│  test/e2e/ui/*.ui.test.ts — full VS Code window, real webviews       │
│  Uses: VSBrowser, WebviewView, By.css, WebDriver                     │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Existing Test Infrastructure (Inventory)

The extension already has three test systems in place. v1.2 must expand them, not replace them.

### Test Runner 1: Vitest (React / Integration)

**Config:** `iris-thaumantias/vitest.config.mts`
**Command:** `npm run test:react`
**Scope:** `test/react/**/*.test.{ts,tsx}`
**Environment:** happy-dom (browser simulation)
**Coverage:** `src/views/webview/react/**/*.{ts,tsx}` (809 tests across 66 files as of v1.1)

**What already exists:**
- `test/react/__helpers__/vitest.setup.ts` — global `acquireVsCodeApi` mock, cleanup
- `test/react/__helpers__/vscodeApi.ts` — `createMockVsCodeApi()`, `dispatchExtensionMessage()`, `getPostMessageCalls()`
- `test/react/__helpers__/renderWithProviders.tsx` — RTL render wrapper with vscodeApi injection
- `test/react/flows/` — 8 integration flow tests covering auth, navigation, courses, exercises, exams, chat, errors, timers
- `test/react/stores/` — 9 Zustand store unit tests
- `test/react/components/` — component-level unit tests
- `test/react/views/` — per-view tests for all 12 views

### Test Runner 2: Mocha + @vscode/test-cli (Extension Host)

**Config:** `iris-thaumantias/.vscode-test.mjs`
**Command:** `npm run test:unit` / `npm run test:e2e`
**Scope:** `out/test/unit/**/*.test.js` (unit) and `out/test/e2e/**/*.e2e.test.js` (e2e)
**Environment:** Real VS Code process via @vscode/test-electron (spawns VS Code)
**Compile step required:** `tsc -p . --outDir out` before running

**What already exists:**
- `test/unit/mocks/vscodeMocks.ts` — `MockExtensionContext`, `MockSecretStorage`, `MockMemento`, `MockTextDocument`
- `test/unit/auth/`, `test/unit/services/`, `test/unit/api/`, etc. — extension host unit tests
- `test/e2e/uncommittedChanges.e2e.test.ts` — live API integration test (requires Artemis + Iris)
- `test/e2e/run-e2e-tests.sh` — orchestration script (checks Artemis health, starts Iris, runs tests)
- `.vscode-test.mjs` — defines two labels: `unit` (all except e2e) and `e2e` (60s timeout)

### Test Runner 3: vscode-extension-tester (UI/Selenium)

**Config:** `test/e2e/ui/run-tests.sh`
**Command:** `npm run test:ui`
**Scope:** `test/e2e/ui/*.ui.test.ts`
**Environment:** Downloads VS Code + ChromeDriver, installs .vsix, runs Selenium

**What already exists:**
- `test/e2e/ui/setup.ts` — programmatic ExTester setup (downloadCode, downloadChromeDriver, installVsix)
- `test/e2e/ui/helpers.ts` — `openArtemisView()`, `switchToWebviewFrame()`, `switchBackFromWebview()`, `waitForElement()`, `takeScreenshot()`, `getCredentials()`
- `test/e2e/ui/login.ui.test.ts` — login form render tests (no credentials needed)
- `test/e2e/ui/login-flow.ui.test.ts` — full login submit test (needs `ARTEMIS_USER`/`ARTEMIS_PASS` envvars)
- `test/e2e/ui/screenshots/` — screenshot capture directory

---

## Integration Points: New Tests and Existing Architecture

### Integration Point 1: Message Bridge — Webview Side

**What it tests:** Extension sends a message, webview reacts correctly (correct view renders, correct store state, correct postMessage response).

**Mechanism:** `dispatchExtensionMessage()` helper dispatches a `MessageEvent` on `window`. Each view's message handler hook listens via `window.addEventListener('message', ...)`.

**New tests live in:** `test/react/flows/` (already established pattern)

**Anatomy of an integration test:**

```typescript
// test/react/flows/someDomain.flow.test.tsx
import { createMockVsCodeApi, dispatchExtensionMessage } from '../__helpers__/vscodeApi';

it('hydrates store from extension init message', async () => {
    const mockApi = createMockVsCodeApi();
    render(<SomeView vscodeApi={mockApi} />);

    // INBOUND: extension → webview
    dispatchExtensionMessage({
        type: 'someViewInit',
        payload: { /* data matching the contract */ },
    });

    // Assert: store hydrated, UI updated
    await waitFor(() => expect(screen.getByText('expected content')).toBeInTheDocument());

    // OUTBOUND: webview → extension (user action triggers postMessage)
    await userEvent.click(screen.getByRole('button', { name: /action/i }));
    expect(mockApi.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'command', command: 'expectedCommand' })
    );
});
```

**What the v1.2 milestone needs to add here:**
- Complete coverage of all 12 views (currently only some flows exist)
- Store hydration verification for every `*Init` message type
- Error state flows (what happens when extension sends an error message)
- WebSocket update flows via `dispatchExtensionMessage({ type: 'websocketUpdate', ... })`

### Integration Point 2: Message Bridge — Extension Host Side

**What it tests:** Webview sends a command, extension host handler processes it correctly, correct `ExtensionToWebviewMessage` is sent back.

**Mechanism:** `WebViewMessageHandler.handleMessageWithSender()` — already accepts a `sendResponse` callback for testable injection. The unit test sends a typed `WebviewToExtensionMessage` directly to the handler and captures the response callback invocations.

**New tests live in:** `test/unit/` (Mocha, runs in real VS Code process)

**Anatomy of an extension host handler test:**

```typescript
// test/unit/views/app/webViewMessageHandler.test.ts
import { WebViewMessageHandler } from '../../../src/views/app/webViewMessageHandler';
import { MockExtensionContext } from '../mocks/vscodeMocks';

suite('WebViewMessageHandler', () => {
    test('login command triggers auth and sends loginSuccess', async () => {
        const mockAuthManager = { login: sinon.stub().resolves({ username: 'user1' }) };
        const sentMessages: ExtensionToWebviewMessage[] = [];
        const handler = new WebViewMessageHandler(/* inject mocks */);

        await handler.handleMessageWithSender(
            { type: 'command', command: 'login', payload: { username: 'u', password: 'p', rememberMe: false } },
            (msg) => sentMessages.push(msg)
        );

        assert.ok(sentMessages.some(m => m.type === 'loginSuccess'));
    });
});
```

**Key insight:** `handleMessageWithSender` already accepts a `sendResponse` callback (line 77 of `webViewMessageHandler.ts`). This is the seam for integration testing without needing a real webview.

### Integration Point 3: Store Hydration Completeness

**What it tests:** Every `*Init` message (there are 12 view-specific init types) correctly hydrates its corresponding Zustand store.

**Gap in v1.1:** Store tests exist for all 9 stores, but they test store actions directly. Integration-level tests that confirm the full pipeline (extension message → `window.dispatchEvent` → store action → React state update) are incomplete for some views.

**New tests needed:**
- `test/react/flows/courseNavigation.flow.test.tsx` — already exists, expand
- `test/react/flows/examTimer.flow.test.tsx` — already exists (Web Worker timer tests)
- Missing: `dashboard.flow.test.tsx`, `irisChat.flow.test.tsx` completeness
- Each flow test should cover: init, error, loading, success, refresh

### Integration Point 4: UI Tests (Selenium) — 12 Views

**What it tests:** Each of the 12 views renders correctly in a real VS Code window with a real webview.

**Mechanism:** `vscode-extension-tester` downloads VS Code + ChromeDriver, installs the packaged .vsix, launches VS Code, and drives it via Selenium WebDriver. `WebviewView.switchToFrame()` enters the webview iframe context.

**Critical constraint:** UI tests require a pre-built .vsix. The test runner must compile the extension first (`npm run package`), then run UI tests. The `npm run test:ui` script calls `bash test/e2e/ui/run-tests.sh` which calls `extest setup-and-run`.

**New tests live in:** `test/e2e/ui/` (alongside existing `login.ui.test.ts`)

**Anatomy of a UI view test:**

```typescript
// test/e2e/ui/dashboard.ui.test.ts
import { VSBrowser, WebDriver } from 'vscode-extension-tester';
import { openArtemisView, switchToWebviewFrame, waitForElement } from './helpers';

describe('Dashboard UI Tests', function () {
    let driver: WebDriver;

    before(async function () {
        this.timeout(30000);
        driver = VSBrowser.instance.driver;
        await VSBrowser.instance.waitForWorkbench();
    });

    it('renders dashboard with course list after login', async function () {
        this.timeout(30000);
        await openArtemisView();
        await switchToWebviewFrame(driver);
        // Assert dashboard-specific DOM elements
        await waitForElement(driver, '[data-testid="dashboard-view"]');
    });
});
```

**Views that need UI tests (in order of auth dependency):**
1. Login (already exists — `login.ui.test.ts`, `login-flow.ui.test.ts`)
2. Dashboard, CourseList, CourseDetail (requires authenticated session)
3. ExerciseDetail (requires course selection)
4. ExamStart, ExamConduction, ExamExerciseDetail (requires exam enrollment)
5. IrisChat (requires auth + Iris health)
6. ServiceStatus, GitCredentials, RecommendedExtensions (utility views)

---

## Recommended Project Structure

The full test organization after v1.2:

```
iris-thaumantias/
├── test/
│   ├── __shared__/                  # (currently empty — reserve for cross-runner fixtures)
│   │
│   ├── react/                       # Vitest tests (webview context)
│   │   ├── __helpers__/
│   │   │   ├── vitest.setup.ts      # Global mocks, cleanup — EXISTS
│   │   │   ├── vscodeApi.ts         # createMockVsCodeApi, dispatchExtensionMessage — EXISTS
│   │   │   ├── renderWithProviders.tsx  # RTL render wrapper — EXISTS
│   │   │   └── storeHelpers.ts      # NEW: resetAllStores(), seedStore() utilities
│   │   │
│   │   ├── flows/                   # Integration: full message-bridge roundtrips — EXPAND
│   │   │   ├── auth.flow.test.tsx          # EXISTS (login/logout lifecycle)
│   │   │   ├── courseNavigation.flow.test.tsx  # EXISTS (expand)
│   │   │   ├── errors.flow.test.tsx        # EXISTS
│   │   │   ├── examTimer.flow.test.tsx     # EXISTS
│   │   │   ├── exerciseSubmission.flow.test.tsx  # EXISTS
│   │   │   ├── irisChat.flow.test.tsx      # EXISTS (expand streaming, context switch)
│   │   │   ├── messageContracts.test.ts    # EXISTS (contract drift detection)
│   │   │   ├── navigation.flow.test.tsx    # EXISTS
│   │   │   ├── dashboard.flow.test.tsx     # NEW: dashboard init + reload
│   │   │   ├── websocket.flow.test.tsx     # NEW: disconnect/reconnect flows
│   │   │   └── storeHydration.flow.test.tsx  # NEW: all 12 init messages → store state
│   │   │
│   │   ├── stores/                  # Zustand store unit tests — EXISTS (all 9)
│   │   ├── components/              # Component unit tests — EXISTS
│   │   ├── views/                   # Per-view tests — EXISTS (all 12)
│   │   └── security/                # CSP/XSS tests — EXISTS
│   │
│   ├── unit/                        # Mocha tests (extension host context)
│   │   ├── mocks/
│   │   │   └── vscodeMocks.ts       # MockExtensionContext etc. — EXISTS
│   │   ├── auth/                    # Auth unit tests — EXISTS
│   │   ├── api/                     # API service tests — EXISTS
│   │   ├── services/                # Service tests — EXISTS
│   │   ├── provider/                # Provider tests — EXISTS
│   │   ├── views/
│   │   │   └── app/
│   │   │       ├── webViewMessageHandler.test.ts  # NEW: handler integration
│   │   │       ├── appStateManager.test.ts        # NEW: state machine transitions
│   │   │       └── commands/                      # NEW: per-command-module tests
│   │   └── struggle-detection/      # EXISTS
│   │
│   └── e2e/                         # E2E tests (two sub-layers)
│       ├── uncommittedChanges.e2e.test.ts  # EXISTS (live API, Mocha runner)
│       ├── run-e2e-tests.sh                # EXISTS
│       │
│       └── ui/                      # vscode-extension-tester (Selenium)
│           ├── helpers.ts           # EXISTS (openArtemisView, switchToWebviewFrame, etc.)
│           ├── setup.ts             # EXISTS (ExTester programmatic setup)
│           ├── run-tests.sh         # EXISTS
│           ├── screenshots/         # EXISTS (test artifact dir)
│           │
│           ├── login.ui.test.ts          # EXISTS
│           ├── login-flow.ui.test.ts     # EXISTS
│           │
│           ├── dashboard.ui.test.ts      # NEW
│           ├── courseList.ui.test.ts     # NEW
│           ├── courseDetail.ui.test.ts   # NEW
│           ├── exerciseDetail.ui.test.ts # NEW
│           ├── examStart.ui.test.ts      # NEW
│           ├── examConduction.ui.test.ts # NEW
│           ├── irisChat.ui.test.ts       # NEW
│           └── serviceStatus.ui.test.ts  # NEW (no auth required)
```

### Structure Rationale

- **`test/react/flows/`:** The message-bridge integration layer lives in Vitest because it tests the webview side. The `dispatchExtensionMessage()` helper is a complete substitute for the real VS Code postMessage — no VS Code process needed.
- **`test/unit/views/app/`:** Extension host handler tests live in Mocha because they import `vscode` module and must run in a real VS Code process via `@vscode/test-electron`.
- **`test/e2e/ui/`:** Selenium UI tests require the packaged `.vsix`. They run last (longest) and have external dependencies (VS Code download, ChromeDriver, env credentials).
- **`test/__shared__/`:** Reserved for fixtures shared across Mocha and Vitest (e.g., typed API response fixtures, test data factories). Currently empty.

---

## Architectural Patterns

### Pattern 1: Sandwich Testing for Message Bridge

**What:** Test the bridge from both sides independently, not together.

**Webview side (Vitest):** Dispatch a `MessageEvent` directly on `window` and assert the React component re-renders correctly. No real VS Code process.

**Extension side (Mocha):** Call `WebViewMessageHandler.handleMessageWithSender()` with a mock `sendResponse` callback and assert what messages were sent back. No real webview.

**When to use:** All message bridge integration tests. The boundary is already designed for this — `handleMessageWithSender` was built with testability in mind.

**Trade-off:** You don't test the literal `postMessage` call going through the VS Code IPC layer. That's acceptable — VS Code's own `postMessage` is not the thing being tested. The contracts (typed discriminated unions) are what matter.

**Example (webview side):**
```typescript
// Inbound: extension → webview
dispatchExtensionMessage({ type: 'dashboardInit', payload: { courses: [] } });
await waitFor(() => expect(screen.getByTestId('dashboard-view')).toBeInTheDocument());

// Outbound: webview → extension
await userEvent.click(screen.getByText('Reload Courses'));
expect(mockApi.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'command', command: 'reloadCourses' })
);
```

**Example (extension host side):**
```typescript
// Inbound: webview → extension
const responses: ExtensionToWebviewMessage[] = [];
await handler.handleMessageWithSender(
    { type: 'command', command: 'reloadCourses' },
    (msg) => responses.push(msg)
);
assert.ok(responses.some(r => r.type === 'courseListInit'));
```

---

### Pattern 2: Store Reset Between Tests

**What:** Zustand stores persist state across test cases because they are module-level singletons. Every integration test that exercises a store must reset it.

**When to use:** All flow tests and store unit tests.

**Implementation:** Call `useStore.setState(initialState)` in `beforeEach`. A shared helper is the right pattern.

**Example:**
```typescript
// test/react/__helpers__/storeHelpers.ts  (NEW file)
import { useExerciseDetailStore } from '../../../src/views/webview/react/stores/useExerciseDetailStore';
import { useNavigationStore } from '../../../src/views/webview/react/stores/useNavigationStore';
// ...import all 9 stores

export function resetAllStores(): void {
    useExerciseDetailStore.setState(useExerciseDetailStore.getInitialState());
    useNavigationStore.setState({ breadcrumbs: [] });
    // ... reset each store to its initial state
}
```

**Existing pattern:** `navigation.flow.test.tsx` already does `useNavigationStore.setState({ breadcrumbs: [] })` in `beforeEach`. Extract this to a shared helper to avoid duplication across flow tests.

---

### Pattern 3: Mock Injection for Extension Host Tests

**What:** `WebViewMessageHandler` and command modules depend on `AuthManager`, `ArtemisApiService`, `AppStateManager`, `ArtemisWebsocketService`. In unit tests, pass mock implementations through the constructor.

**When to use:** All `test/unit/views/app/` tests.

**Critical seam:** `WebViewMessageHandler.handleMessageWithSender(message, sendResponse)` was designed for this — the `sendResponse` callback overrides the normal `_sendMessage` function temporarily. Pass a spy function to capture sent messages.

**Trade-off:** Each command module test needs mock objects for its full dependency tree. Use `sinon` stubs (already in devDeps) to create lightweight mocks without full mock objects.

**Example:**
```typescript
import sinon from 'sinon';
import { WebViewMessageHandler } from '../../../../src/views/app/webViewMessageHandler';

test('login sends loginSuccess on valid credentials', async () => {
    const fakeAuth = { login: sinon.stub().resolves({ username: 'user1' }) };
    const fakeApi = { /* minimal interface */ } as any;
    const fakeState = new AppStateManager(fakeApi as any);
    const responses: ExtensionToWebviewMessage[] = [];

    const handler = new WebViewMessageHandler(
        fakeAuth as any, fakeApi as any, fakeState,
        {} as any, undefined, undefined, new MockExtensionContext()
    );

    await handler.handleMessageWithSender(
        { type: 'command', command: 'login', payload: { username: 'u', password: 'p', rememberMe: false } },
        (msg) => responses.push(msg)
    );

    assert.ok(responses.some(r => r.type === 'loginSuccess' || r.type === 'showLoggedIn'));
});
```

---

### Pattern 4: UI Test Preconditions via VS Code Commands

**What:** Selenium UI tests need the extension in a specific state (e.g., logged in) before testing a view. Use VS Code command palette via `Workbench.executeCommand()` to trigger state transitions without clicking through the UI.

**When to use:** UI tests for views that require auth (Dashboard, CourseList, etc.).

**Limitation:** The extension must expose commands that manipulate state (or accept test-mode env vars). Currently, login requires real credentials against a live Artemis server.

**Pattern used in existing tests:**
```typescript
// login-flow.ui.test.ts (after() teardown)
const workbench = new Workbench();
await workbench.executeCommand('Logout from Artemis');
```

**For authenticated views:** Tests must either (a) require `ARTEMIS_USER`/`ARTEMIS_PASS` env vars and skip if absent (`this.skip()`), or (b) inject a test auth token directly. Approach (a) matches the existing pattern in the codebase.

---

### Pattern 5: Contract Drift Detection

**What:** A dedicated test file that imports every type from `messageContracts.ts` and verifies shape, type discriminators, and type guard behavior. Catches silent regressions when message types are modified.

**Already implemented:** `test/react/flows/messageContracts.test.ts` covers all current contracts with `satisfies` operator checks and `isExtensionMessage`/`isWebviewMessage` guard tests.

**Expansion needed for v1.2:** As new tech debt fixes add or modify contracts (WebSocket error propagation, state persistence), add corresponding contract tests before or alongside the implementation.

---

## Data Flow: How Tests Interact with Production Code

### Integration Test Data Flow (Vitest)

```
Test code
    │
    ├── dispatchExtensionMessage({ type: 'dashboardInit', payload: {...} })
    │       ↓
    │   window.dispatchEvent(new MessageEvent('message', { data: message }))
    │       ↓
    │   View's useEffect → window.addEventListener('message', handler)
    │       ↓
    │   Store action (e.g., useDashboardStore.setData(payload))
    │       ↓
    │   React re-render
    │       ↓
    │   screen.getByTestId / waitFor assertions
    │
    └── userEvent.click(button)
            ↓
        React event handler
            ↓
        vscodeApi.postMessage({ type: 'command', command: 'reloadDashboard' })
            ↓  (vscodeApi is the mock — postMessage is vi.fn())
        expect(mockApi.postMessage).toHaveBeenCalledWith(...)
```

### Extension Host Handler Test Data Flow (Mocha)

```
Test code
    │
    ├── handler.handleMessageWithSender(
    │       { type: 'command', command: 'login', payload: {...} },
    │       (response) => capturedResponses.push(response)
    │   )
    │       ↓
    │   commandHandlers.get('login')(message, context)
    │       ↓
    │   authManager.login(username, password)  ← stubbed
    │       ↓
    │   context.sendMessage({ type: 'loginSuccess', ... })
    │       ↓  (sendMessage calls the injected sendResponse callback)
    │   capturedResponses.push({ type: 'loginSuccess', ... })
    │
    └── assert.ok(capturedResponses.some(r => r.type === 'loginSuccess'))
```

### UI Test Data Flow (Selenium)

```
Test code
    │
    ├── VSBrowser.instance.waitForWorkbench()
    │       ↓ (VS Code process is already running with .vsix installed)
    │
    ├── openArtemisView()
    │       ↓
    │   activityBar.getViewControl('Artemis').openView()
    │       ↓ (VS Code shows the webview sidebar)
    │
    ├── switchToWebviewFrame(driver)
    │       ↓
    │   WebviewView.switchToFrame(5000)
    │       ↓ (Selenium driver switches to the webview's iframe context)
    │
    ├── waitForElement(driver, '[data-testid="login-form"]')
    │       ↓
    │   driver.wait(until.elementLocated(By.css(...)), 10000)
    │
    └── assert.ok(element, 'element should be present')
```

---

## Build Order and Compilation Dependencies

This is the critical ordering constraint — each layer has different prerequisites.

### Build Dependency Graph

```
npm run compile-tests (tsc → out/)
    │
    ├── required by: npm run test:unit (Mocha, extension host)
    └── required by: npm run test:e2e (Mocha, live API e2e)

npm run package (esbuild → dist/ + .vsix)
    │
    └── required by: npm run test:ui (vscode-extension-tester needs .vsix)

npm run test:react (Vitest, no compilation needed — runs TS directly)
    │
    └── independent: runs without compile or package steps
```

### Execution Order in CI

```
Phase 1 (fastest, no external deps):
  npm run test:react     ← Vitest, happy-dom, no VS Code
  npm run check-types    ← TypeScript compilation check

Phase 2 (requires VS Code process, no external Artemis):
  npm run compile-tests  ← compile test/ to out/
  npm run test:unit      ← Mocha + @vscode/test-electron, spawns VS Code

Phase 3 (requires live Artemis + Iris):
  npm run test:e2e       ← Mocha, live API calls

Phase 4 (slowest — requires .vsix + VS Code download + Artemis):
  npm run package        ← produces .vsix
  npm run test:ui        ← vscode-extension-tester, downloads VS Code + ChromeDriver
```

**Rationale for this order:**
- Fast feedback first — Vitest catches message bridge regressions in seconds
- Extension host unit tests catch handler bugs before UI tests run
- UI tests are the last resort — expensive to run, fragile (browser-based), require live server
- E2E live-API tests are optional in CI (require Artemis to be running)

---

## Component Boundaries: New vs Existing

### New Components Required for v1.2

| Component | Type | Location | Purpose |
|-----------|------|----------|---------|
| `storeHelpers.ts` | Test utility | `test/react/__helpers__/` | `resetAllStores()`, `seedStore()` for deterministic test setup |
| `webViewMessageHandler.test.ts` | Mocha test | `test/unit/views/app/` | Handler integration tests using mock injection |
| `appStateManager.test.ts` | Mocha test | `test/unit/views/app/` | AppStateManager state machine transition tests |
| `commands/*.test.ts` | Mocha tests | `test/unit/views/app/commands/` | Per-command-module unit tests (7 modules) |
| `dashboard.flow.test.tsx` | Vitest test | `test/react/flows/` | Dashboard init + reload integration |
| `websocket.flow.test.tsx` | Vitest test | `test/react/flows/` | WebSocket disconnect/reconnect flows |
| `storeHydration.flow.test.tsx` | Vitest test | `test/react/flows/` | All 12 `*Init` messages → store state verification |
| `{view}.ui.test.ts` (x8) | Mocha/Selenium | `test/e2e/ui/` | UI tests for 8 remaining views |

### Existing Components: No Modification Required

| Component | Why Unchanged |
|-----------|---------------|
| `src/shared/messageContracts.ts` | Test infrastructure is built around it; tests consume it, don't modify it |
| `src/views/app/webViewMessageHandler.ts` | `handleMessageWithSender` seam already exists |
| `src/views/webview/react/` (all views) | Tests exercise views as-is |
| `esbuild.js` | Dual-target build unchanged; tests don't modify build |
| `vitest.config.mts` | Only needs new test paths if flows add new top-level dirs |
| `.vscode-test.mjs` | Already defines `unit` and `e2e` labels with correct globs |

### Existing Components: Possible Minor Extension

| Component | Potential Change | Reason |
|-----------|-----------------|--------|
| `test/react/__helpers__/vscodeApi.ts` | Add `getLastPostMessage()` convenience helper | Reduces boilerplate in flow tests |
| `test/e2e/ui/helpers.ts` | Add `loginToArtemis()`, `waitForView()` helpers | UI tests for authenticated views need these |
| `.vscode-test.mjs` | Add third label for `struggle-detection` if needed | Currently handled via separate script |
| `package.json` scripts | Add `test:integration` alias for `test:react` flows only | Clearer naming for CI pipeline stages |

---

## Anti-Patterns

### Anti-Pattern 1: Testing Both Sides of the Bridge in One Test

**What people do:** Try to wire the real `WebViewMessageHandler` to a real Vitest webview context, making the test span both Node.js and browser environments.

**Why it's wrong:** Vitest runs in happy-dom (not Node.js with VS Code APIs). The `vscode` module cannot be imported in Vitest. Any test that tries to import extension host code (which imports `vscode`) into Vitest will fail at import time.

**Do this instead:** Test each side independently using the sandwich pattern. Vitest tests the webview reaction to messages. Mocha tests the extension handler reaction to commands. The message contract file (`messageContracts.ts`) is shared because it has no `vscode` imports.

---

### Anti-Pattern 2: Skipping Store Resets in Flow Tests

**What people do:** Write multiple `it()` blocks in a flow test without resetting store state between them. A previous test's side effects bleed into the next.

**Why it's wrong:** Zustand stores are module-level singletons. State from test A persists into test B. Tests pass in isolation but fail when run together. Hard to debug.

**Do this instead:** Reset all stores in `beforeEach`. Create `storeHelpers.ts` with a `resetAllStores()` function. The existing flow tests already do this for specific stores — generalize the pattern.

---

### Anti-Pattern 3: UI Tests for Logic Already Covered by Integration Tests

**What people do:** Write Selenium UI tests that verify the same assertions already in Vitest flow tests (e.g., "login form has username and password fields").

**Why it's wrong:** UI tests are 50-100x slower, fragile (flaky on ChromeDriver timing), and require external infrastructure (VS Code download, .vsix build, sometimes a live server). Duplicating integration test assertions in UI tests gives no additional value.

**Do this instead:** UI tests should cover things only testable in a real VS Code window:
- Webview-to-VS Code context (activity bar appears, sidebar opens)
- Frame switching behavior (can we actually enter the webview iframe?)
- Screenshot capture for visual review
- Authentication flows that touch real VS Code state (credentials stored in `SecretStorage`)

---

### Anti-Pattern 4: Hard-Coding Test Credentials

**What people do:** Put `artemis_admin`/`artemis_admin` or real URLs directly in test files.

**Why it's wrong:** Credentials leak in source control. Tests fail in CI where those credentials don't exist. Tests are environment-specific.

**Do this instead:** Read from environment variables with `this.skip()` if absent (the existing pattern in `login-flow.ui.test.ts` and `helpers.ts` is correct). Use `ARTEMIS_USER`, `ARTEMIS_PASS`, `ARTEMIS_URL` env vars exclusively.

---

### Anti-Pattern 5: Running UI Tests Without a .vsix Build

**What people do:** Run `npm run test:ui` without first running `npm run package`, expecting it to pick up source changes.

**Why it's wrong:** `vscode-extension-tester` installs a `.vsix` file, not source files. Source changes are not reflected unless the extension is repackaged.

**Do this instead:** Always sequence `npm run package` before `npm run test:ui`. In CI, make the UI test step depend on the package step. The `run-tests.sh` script should enforce this.

---

## Integration Points Summary Table

| Test Layer | What It Tests | Runner | Needs VS Code | Needs Artemis | Compile Step |
|------------|--------------|--------|--------------|---------------|-------------|
| `test:react` (flow tests) | Message bridge → Zustand → React | Vitest | No | No | No |
| `test:react` (store/component tests) | Individual stores and components | Vitest | No | No | No |
| `test:unit` | Extension host handlers, services, auth | Mocha + test-electron | Yes (spawned) | No | Yes (tsc) |
| `test:e2e` | Live API integration (uncommitted changes flow) | Mocha + test-electron | Yes (spawned) | Yes | Yes (tsc) |
| `test:ui` | Full VS Code window, webview iframe, Selenium | vscode-extension-tester | Yes (downloaded) | Optional | Yes (.vsix) |

---

## Sources

- Direct inspection: `iris-thaumantias/test/` directory (all existing test files)
- Direct inspection: `iris-thaumantias/.vscode-test.mjs` (Mocha test runner config)
- Direct inspection: `iris-thaumantias/vitest.config.mts` (Vitest config)
- Direct inspection: `iris-thaumantias/src/views/app/webViewMessageHandler.ts` (handler seam at line 77)
- Direct inspection: `iris-thaumantias/src/shared/messageContracts.ts` (contract types)
- Direct inspection: `iris-thaumantias/package.json` (all test scripts and devDependencies)
- [vscode-extension-tester documentation](https://github.com/redhat-developer/vscode-extension-tester) — Selenium-based UI testing for VS Code extensions
- [@vscode/test-cli documentation](https://github.com/microsoft/vscode-test-cli) — official VS Code extension test runner

---

*Architecture research for: Artemis Extension v1.2 E2E & Integration Testing*
*Researched: 2026-02-28*
