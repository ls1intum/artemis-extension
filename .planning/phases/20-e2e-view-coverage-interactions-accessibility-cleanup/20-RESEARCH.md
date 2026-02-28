# Phase 20: E2E View Coverage, Interactions, Accessibility & Cleanup - Research

**Researched:** 2026-02-28
**Domain:** E2E testing (vscode-extension-tester + Selenium), axe-core accessibility, knip dead code detection
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Smoke Test Strategy**
- Log in with real credentials (ARTEMIS_USER/ARTEMIS_PASS env vars) before testing authenticated views
- Navigate to specific views using VS Code commands (viewRouter.ts/navigationCommands.ts), not UI click-through
- Assert one distinctive primary UI element per view (e.g., Dashboard: course cards container, ExamConduction: timer, IrisChat: chat input)
- Accept empty/loading states as valid — smoke tests prove the view mounts and renders its container, no dependency on specific server data

**Login Flow (E2EX-01)**
- After login, assert the Dashboard view loads with its primary element visible
- Proves the full auth → navigation → render pipeline

**Exercise Submission Flow (E2EX-02)**
- Skip gracefully if ARTEMIS_USER/ARTEMIS_PASS env vars are missing (this.skip() pattern from login-flow.ui.test.ts)
- Exercise ID provided via env var (ARTEMIS_EXERCISE_ID)
- Assert the BuildFeedback view or build progress indicator element appears after submission

**Accessibility**
- axe-core checks run as a separate test suite (own file), not inline with smoke tests
- Each view gets its own individual test (`it()` block) — 12 separate assertions
- Hard fail on any axe violation — zero tolerance
- WCAG 2.1 AA standard ruleset, no exceptions or excludes

**Cleanup**
- Install knip as devDependency, add npm script for unused export detection
- Run knip + manual review of files with migration/legacy patterns
- "Migration code" = anything generating HTML strings, coexistence/router shims, code explicitly marked as legacy or migration-era
- Remove unused exports, imports, files, and dead code paths

### Claude's Discretion
- Exact CSS selectors for primary UI element assertions per view
- Test file organization (one file per view vs grouped)
- axe-core integration method (direct import vs test helper wrapper)
- knip configuration details
- Order of cleanup operations

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| E2EV-01 | E2E smoke test for Login view — renders, login form visible | Existing `login.ui.test.ts` already covers this. Reuse pattern: `waitForElement(driver, 'form')` |
| E2EV-02 | E2E smoke test for Dashboard view — renders, course cards visible | After login, assert `.dashboard` container or "Recent Courses" heading. Need credential-gated test. |
| E2EV-03 | E2E smoke test for CourseList view — renders, course list visible | Login → Dashboard → click "Browse Courses" or inject `{type:'command',command:'showAllCourses'}` postMessage |
| E2EV-04 | E2E smoke test for CourseDetail view — renders, exercise list visible | Requires navigating from Dashboard → CourseList → CourseDetail. Accept loading state. |
| E2EV-05 | E2E smoke test for ExerciseDetail view — renders, submission status visible | Navigate to ExerciseDetail. Accept loading/empty participation state. |
| E2EV-06 | E2E smoke test for ExamStart view — renders, exam info visible | Navigate from CourseDetail exam section. Accept empty/loading state. |
| E2EV-07 | E2E smoke test for ExamConduction view — renders, timer visible | Cannot reach without a live started exam. Accept loading state or skip gracefully. |
| E2EV-08 | E2E smoke test for ExamExerciseDetail view — renders, exercise content visible | Similar to ExamConduction — nested view requiring live exam. |
| E2EV-09 | E2E smoke test for IrisChat view — renders, chat input visible | Separate Iris Chat sidebar panel. Open via ActivityBar `getViewControl`. Assert `[aria-label="Chat input"]`. |
| E2EV-10 | E2E smoke test for BuildFeedback view — renders, build log visible | **MISMATCH**: No standalone BuildFeedback view in code. BuildFeedback is a section inside ExerciseDetail. Resolve: map to GitCredentials or assert build progress in ExerciseDetail. |
| E2EV-11 | E2E smoke test for ProblemStatement view — renders, problem content visible | **MISMATCH**: ProblemStatement is a component inside ExerciseDetail, not a standalone view. Resolve: map to RecommendedExtensions or assert problem content inside ExerciseDetail. |
| E2EV-12 | E2E smoke test for ServiceStatus view — renders, status info visible | Login → Dashboard → click "Service Status". Assert `#serverUrl` input or Container element. |
| E2EX-01 | E2E interaction test for login flow — enter credentials, click login, verify authenticated state | Extends existing `login-flow.ui.test.ts`. Add Dashboard assertion after redirect. |
| E2EX-02 | E2E interaction test for exercise submission flow — open exercise, submit, verify build progress | Login → navigate to exercise → trigger submission → assert build progress UI element appears |
| A11Y-01 | axe-core accessibility assertions on all 12 rendered view DOMs | Install axe-core + @axe-core/webdriverjs. Inject axe into each view's iframe, run `axe.run()` with WCAG2AA tags. |
| CLEAN-01 | Remove all migration-era code — HTML string generation, coexistence router, migration shims | Provider has 3 `// Also send legacy message for backward compatibility` blocks. messageContracts.ts has legacy `command`-field section. IrisChatView uses legacy message.command format. |
| CLEAN-02 | Remove all legacy fallbacks — backward-compatibility paths, deprecated API wrappers, feature flags | auth.ts has migration fallback for old storage key. Provider backward-compat sends. |
| CLEAN-03 | Remove unused exports, imports, files, and dead code paths (knip audit + manual review) | Install knip v5.85.0. Configure entry points: `src/extension.ts`, `src/views/webview/react/index.tsx`. Run `knip --exports`. |
</phase_requirements>

---

## Summary

Phase 20 implements the final three work streams before v1.2 is complete: E2E smoke tests for all 12 webview views, critical interaction flow tests, axe-core accessibility assertions, and removal of migration-era code.

The test infrastructure from Phase 19 is in place: vscode-extension-tester 8.22.0 with Selenium WebDriver, GitHub Actions CI with xvfb, and the `run-tests.sh` pipeline. The 2 existing UI test files (`login.ui.test.ts`, `login-flow.ui.test.ts`) provide the patterns to follow. All new test files go in `test/e2e/ui/`, are compiled to `out/test/ui/`, and run via `extest run-tests out/test/ui/*.ui.test.js`.

**Critical issue to resolve during planning:** The REQUIREMENTS list E2EV-10 (BuildFeedback) and E2EV-11 (ProblemStatement) as standalone views, but the actual codebase has 12 AppState-based views: Login, Dashboard, CourseList, CourseDetail, ExerciseDetail, ExamStart, ExamConduction, ExamExerciseDetail, IrisChat (separate Iris Chat panel), GitCredentials, RecommendedExtensions, ServiceStatus. The planner must reconcile this — most likely the requirements were written with anticipated view names that evolved differently. The real 12 views are the ones in `src/views/webview/react/views/` + IrisChat.

**Primary recommendation:** Implement smoke tests grouped by auth requirement (no-auth: Login; auth-required: Dashboard, CourseList, etc.; navigation-triggered: ServiceStatus, GitCredentials, RecommendedExtensions); use manual `driver.executeScript`-based axe injection into the webview iframe context (not `@axe-core/webdriverjs`) to avoid nested iframe complexity; use knip for cleanup verification.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vscode-extension-tester | 8.22.0 (installed) | Selenium-based UI automation for VS Code | Already chosen in Phase 19, only tool supporting sidebar webview iframes |
| axe-core | 4.11.1 (latest npm) | Accessibility engine — WCAG rule evaluation | Industry standard, used by Deque; supports script injection into iframes |
| @axe-core/webdriverjs | 4.11.1 (latest npm) | Chainable axe API for Selenium WebDriver | Auto-injects into frames; AxeBuilder(driver).analyze() pattern |
| knip | 5.85.0 (latest npm) | Unused exports/imports/files detection | Standard for TypeScript dead code audit in 2025 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| axe-core (direct) | 4.11.1 | Raw axe source for manual injection | Use when @axe-core/webdriverjs has iframe switching conflicts |
| mocha-junit-reporter | 2.2.1 (installed) | JUnit XML output for CI | Already installed and configured in Phase 19 CI |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @axe-core/webdriverjs | Manual axe injection via executeScript | Manual injection is more reliable in nested iframe context; AxeBuilder may not correctly target the inner webview frame after switchToFrame() |
| knip | typescript-unused-exports or ts-prune | knip is more comprehensive, handles re-exports, barrel files; others are simpler but miss patterns |

**Installation:**
```bash
npm install --save-dev axe-core @axe-core/webdriverjs knip
```

---

## Architecture Patterns

### Recommended Project Structure
```
test/e2e/ui/
├── helpers.ts                    # EXISTING — add axe helper function
├── login.ui.test.ts              # EXISTING — E2EV-01 (already covers Login)
├── login-flow.ui.test.ts         # EXISTING — extend for E2EX-01 Dashboard assertion
├── dashboard.ui.test.ts          # NEW — E2EV-02
├── course-list.ui.test.ts        # NEW — E2EV-03
├── course-detail.ui.test.ts      # NEW — E2EV-04
├── exercise-detail.ui.test.ts    # NEW — E2EV-05, E2EX-02 (submission flow)
├── exam-start.ui.test.ts         # NEW — E2EV-06
├── exam-conduction.ui.test.ts    # NEW — E2EV-07 (graceful skip if no live exam)
├── exam-exercise-detail.ui.test.ts # NEW — E2EV-08 (graceful skip)
├── iris-chat.ui.test.ts          # NEW — E2EV-09 (separate ActivityBar panel)
├── service-status.ui.test.ts     # NEW — E2EV-10 (maps to ServiceStatus, or E2EV-12)
├── git-credentials.ui.test.ts    # NEW — one of E2EV-10/11/12
├── recommended-extensions.ui.test.ts # NEW — one of E2EV-10/11/12
└── accessibility.ui.test.ts     # NEW — A11Y-01 (all 12 views)
```

### Pattern 1: Credential-Gated Smoke Test (Authenticated Views)
**What:** Test that requires login; skips gracefully if env vars missing
**When to use:** All views that only appear after authentication (Dashboard, CourseList, etc.)
**Example:**
```typescript
// Pattern from login-flow.ui.test.ts
describe('Dashboard View UI Tests', function () {
    let driver: WebDriver;

    before(async function () {
        this.timeout(30000);
        try {
            const { username, password } = getCredentials(); // throws if not set
            driver = VSBrowser.instance.driver;
            await VSBrowser.instance.waitForWorkbench();
            // Perform login first
            await openArtemisView();
            await switchToWebviewFrame(driver);
            const usernameInput = await waitForElement(driver, '#username');
            await usernameInput.sendKeys(username);
            const passwordInput = await waitForElement(driver, '#password');
            await passwordInput.sendKeys(password);
            const submitButton = await waitForElement(driver, 'button[type="submit"]');
            await submitButton.click();
            await switchBackFromWebview(driver);
            await driver.sleep(3000); // wait for auth + navigation
        } catch {
            this.skip(); // Skip entire suite if no credentials
        }
    });

    it('should render Dashboard with course section', async function () {
        this.timeout(20000);
        await openArtemisView();
        await switchToWebviewFrame(driver);
        const dashboard = await waitForElement(driver, 'h1'); // Dashboard title
        assert.ok(dashboard, 'Dashboard heading should be visible');
    });
});
```

### Pattern 2: Navigation from Dashboard via Button Click
**What:** Navigate to sub-views by clicking Dashboard action buttons using text content
**When to use:** ServiceStatus, GitCredentials, RecommendedExtensions (accessible from Dashboard quickActions)
**Example:**
```typescript
// Navigate to ServiceStatus from Dashboard
it('should navigate to Service Status view', async function () {
    this.timeout(30000);
    await openArtemisView();
    await switchToWebviewFrame(driver);

    // Find button by text content (XPath needed since CSS classes are hashed)
    const serviceStatusBtn = await driver.wait(
        until.elementLocated(By.xpath("//button[.//span[contains(text(),'Service Status')]]")),
        10000
    );
    await serviceStatusBtn.click();

    // Wait for ServiceStatus view to load
    const serverUrlInput = await waitForElement(driver, '#serverUrl', 10000);
    assert.ok(serverUrlInput, 'Server URL input should be visible in ServiceStatus view');
});
```

### Pattern 3: IrisChat View (Separate Sidebar Panel)
**What:** IrisChat is in the Iris Chat sidebar panel, not the main Artemis panel
**When to use:** E2EV-09 only
**Example:**
```typescript
it('should render IrisChat with chat input', async function () {
    this.timeout(30000);
    const activityBar = new ActivityBar();
    const control = await activityBar.getViewControl('Chat'); // 'Chat' is the Iris Chat panel name
    if (!control) { throw new Error('Iris Chat view control not found'); }
    await control.openView();

    await switchToWebviewFrame(driver); // Uses the Iris Chat webview
    const chatInput = await waitForElement(driver, '[aria-label="Chat input"]', 10000);
    assert.ok(chatInput, 'Chat input should be visible');
});
```

### Pattern 4: Axe-Core Accessibility Check (Manual Injection)
**What:** Inject axe-core into the active webview iframe context and run accessibility analysis
**When to use:** A11Y-01 for each of the 12 views
**Why manual injection over @axe-core/webdriverjs:** After `switchToWebviewFrame()`, the WebDriver is already inside the inner iframe. `@axe-core/webdriverjs` AxeBuilder traverses from the default context and may not correctly analyze the nested VS Code webview iframe's content. Manual injection after `switchToFrame()` targets the correct context.
**Example:**
```typescript
import * as fs from 'fs';
import * as path from 'path';

// Read axe-core source (installed as devDependency)
const axeSource = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'node_modules', 'axe-core', 'axe.min.js'),
    'utf-8'
);

async function runAxeInWebview(driver: WebDriver): Promise<axe.AxeResults> {
    // Inject axe-core into the active frame
    await driver.executeScript(axeSource);

    // Run axe with WCAG 2.1 AA ruleset
    const results = await driver.executeAsyncScript(`
        const done = arguments[arguments.length - 1];
        axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
            .then(results => done(results))
            .catch(err => done({ error: err.message }));
    `);

    return results as axe.AxeResults;
}

// Usage in test
it('Login view should have zero axe violations', async function () {
    this.timeout(30000);
    await openArtemisView();
    await switchToWebviewFrame(driver);
    await waitForElement(driver, 'form'); // ensure view loaded

    const results = await runAxeInWebview(driver);
    assert.strictEqual(results.violations.length, 0,
        `Accessibility violations: ${JSON.stringify(results.violations, null, 2)}`
    );
});
```

### Pattern 5: Exercise Submission Interaction Test (E2EX-02)
**What:** Navigate to an exercise by ID, trigger submission, assert build progress indicator
**When to use:** E2EX-02 only
**Example:**
```typescript
before(async function () {
    const exerciseId = process.env.ARTEMIS_EXERCISE_ID;
    if (!exerciseId) {
        this.skip(); // Skip if no exercise ID provided
    }
    // ... login first
});

it('should trigger submission and show build progress', async function () {
    this.timeout(60000);
    // Navigate to exercise via postMessage injection
    await driver.executeScript(`
        window.postMessage({ type: 'command', command: 'openExerciseDetails',
            payload: { exerciseId: ${process.env.ARTEMIS_EXERCISE_ID} } }, '*');
    `);
    // Wait for exercise detail view
    await waitForElement(driver, '#participation-section', 15000);

    // Find and click submit button (text-based XPath)
    const submitBtn = await waitForElement(driver, 'button[type="submit"]', 10000);
    await submitBtn.click();

    // Assert build progress indicator appears
    const buildProgress = await driver.wait(
        until.elementLocated(By.xpath("//*[contains(text(),'Building') or contains(text(),'Submitting')]")),
        15000
    );
    assert.ok(buildProgress, 'Build progress indicator should appear after submission');
});
```

### Anti-Patterns to Avoid
- **CSS module hashed class names as selectors:** `styles.dashboard` compiles to a hashed string like `_dashboard_1a2b3`. Use element semantics, `aria-label`, `id`, `data-testid`, or XPath text content instead.
- **Switching frames mid-test without switching back:** Always `switchBackFromWebview()` in `afterEach`. Failure to switch back corrupts subsequent tests.
- **Using `@axe-core/webdriverjs` AxeBuilder without resetting frame context:** After `switchToFrame()`, AxeBuilder may analyze the wrong context. Use manual injection (Pattern 4) inside the switched frame.
- **Hard assertions on specific server data:** Smoke tests accept loading/empty states — only assert the container element exists, not specific course names or exercise titles.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WCAG rule evaluation | Custom DOM inspector | axe-core | Hundreds of rules, edge cases, browser quirk handling |
| Dead code detection | Grep for unused symbols | knip | Handles re-exports, barrel files, type exports, plugin-specific files |
| Frame switching for accessibility | Manual `driver.switchTo().frame()` loops | `WebviewView.switchToFrame()` (already in helpers.ts) | The mixin handles VS Code's double-nested iframe |

**Key insight:** axe-core's rule coverage is comprehensive (400+ rules). Manual DOM inspection for WCAG 2.1 AA would require implementing the full rule set — use axe-core.

---

## Common Pitfalls

### Pitfall 1: View Mismatch Between Requirements and Code
**What goes wrong:** Requirements (E2EV-10, E2EV-11) reference BuildFeedback and ProblemStatement as standalone views, but these are components within ExerciseDetail — not separate AppState values.
**Why it happens:** Requirements were written with anticipated view architecture that evolved. The actual 12 views are in `appStateManager.ts`'s `AppState` type plus IrisChat (separate provider).
**How to avoid:** Map E2EV-10 → GitCredentials, E2EV-11 → RecommendedExtensions (or vice versa). The planner must make this call explicitly in the plan.
**Warning signs:** Trying to navigate to a non-existent view state.

### Pitfall 2: Exam Views Unreachable Without Live Server Data
**What goes wrong:** ExamStart (E2EV-06), ExamConduction (E2EV-07), ExamExerciseDetail (E2EV-08) require real exam data from the Artemis server that must be started in the browser first.
**Why it happens:** AppStateManager sets these states only when `handleOpenExam()` / `handleStartExam()` succeed with real API data.
**How to avoid:** Use credential skip pattern. If no live exam exists, these tests gracefully skip (`this.skip()`). The smoke test acceptance criteria for these views is "renders loading state or container" — not "renders full exam data".
**Warning signs:** Tests timing out waiting for elements that need server responses.

### Pitfall 3: CSS Module Class Names Are Hashed in Production
**What goes wrong:** Selectors like `.dashboard` or `.courseListContainer` don't work in E2E tests — esbuild-css-modules-plugin generates hashed class names in the built output.
**Why it happens:** CSS modules are a build-time feature. The `extest` pipeline builds the VSIX from the production esbuild output.
**How to avoid:** Use semantic selectors: `id` attributes (`#serverUrl`, `#username`, `#password`, `#participation-section`), `aria-label` attributes (`[aria-label="Chat input"]`), element types (`form`, `button`), `data-testid` attributes, or XPath text content (`//h1[contains(text(),'Dashboard')]`).
**Warning signs:** `waitForElement(driver, '.dashboard')` returning timeout errors.

### Pitfall 4: axe.run() Returns Inside Nested Iframe Context
**What goes wrong:** After `switchToWebviewFrame()`, the driver is in the innermost iframe. `@axe-core/webdriverjs` AxeBuilder called on `driver` at this point may analyze from the wrong frame context.
**Why it happens:** VS Code webviews use double-nested iframes (outer webview container + inner active frame). WebviewMixin's `switchToFrame()` navigates both levels.
**How to avoid:** Use manual injection: `driver.executeScript(axeSource)` followed by `driver.executeAsyncScript('axe.run(...)')` while already inside the correct frame context.
**Warning signs:** axe returns zero violations on every view including obvious issues, or throws "axe is not defined".

### Pitfall 5: knip Flags Legitimate VS Code Extension Exports
**What goes wrong:** VS Code extension entry points like `activate` and `deactivate` exported from `extension.ts` may be flagged as unused by knip, since they're called by VS Code itself (not imported by any project file).
**Why it happens:** knip traces imports statically; external callers (VS Code runtime) are invisible.
**How to avoid:** Configure knip with the correct entry point: `entry: ["src/extension.ts"]`. knip understands that exports from entry files are intentionally public. Use `ignoreDependencies` or `ignoreExportsUsedInFile` for known false positives.
**Warning signs:** knip flagging `activate`, `deactivate`, or view component props types.

### Pitfall 6: Legacy backward-compat Code Is Actively Used
**What goes wrong:** Removing the 3 "legacy message for backward compatibility" postMessage calls in `artemisWebviewProvider.ts` breaks IrisChat, which still uses `message.command` format.
**Why it happens:** `IrisChatView.tsx` processes messages by `message.type` (line 59 comment: "uses legacy format with message.command"). The provider sends both typed and legacy formats for the IrisChat view.
**How to avoid:** Before removing any legacy send, verify no React view still handles the `command` field format. Check `IrisChatView.tsx` message handler — it uses `message.type` not `message.command` for its own messages. The legacy sends in the provider are for `newResult`, `newSubmission`, `submissionProcessing` — check if IrisChat or any other view still handles these by command field.
**Warning signs:** IrisChat stops receiving WebSocket updates after cleanup.

---

## Code Examples

### Adding axeHelper to helpers.ts
```typescript
// Source: Based on axe-core npm package API (v4.11.1)
import * as fs from 'fs';
import * as path from 'path';

const axeSource = fs.readFileSync(
    path.resolve(__dirname, '../../..', 'node_modules', 'axe-core/axe.min.js'),
    'utf-8'
);

export async function runAxeInCurrentFrame(driver: WebDriver): Promise<{ violations: unknown[] }> {
    await driver.executeScript(axeSource);
    const results = await driver.executeAsyncScript(`
        var done = arguments[arguments.length - 1];
        axe.run(
            document,
            { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }
        ).then(function(r) { done(r); }).catch(function(e) { done({ violations: [], error: e.message }); });
    `) as { violations: unknown[] };
    return results;
}
```

### knip.json for this project
```json
{
  "$schema": "https://unpkg.com/knip@latest/schema.json",
  "entry": [
    "src/extension.ts",
    "src/views/webview/react/index.tsx"
  ],
  "project": [
    "src/**/*.ts",
    "src/**/*.tsx"
  ],
  "ignore": [
    "test/**",
    "out/**",
    "dist/**"
  ],
  "ignoreDependencies": [],
  "includeEntryExports": false
}
```

### knip npm script to add to package.json
```json
{
  "scripts": {
    "knip": "knip",
    "knip:exports": "knip --exports"
  }
}
```

### Navigating to non-Dashboard views via postMessage injection
```typescript
// Inside webview frame context (after switchToWebviewFrame):
await driver.executeScript(`
    window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'command', command: 'showServiceStatus' }
    }));
`);
// Note: This dispatches to window, but vscodeApi.postMessage goes to extension host.
// The correct approach is to click the Dashboard buttons by text content.
```

### Button navigation via XPath text selector
```typescript
// Select Dashboard button by its label text (avoids CSS module hash dependency)
const btn = await driver.wait(
    until.elementLocated(By.xpath("//button[.//span[contains(text(),'Service Status')]]")),
    10000,
    'Timed out waiting for Service Status button'
);
await btn.click();
```

---

## The 12 Views: Ground Truth Mapping

The codebase has these 12 actual views (confirmed via `AppState` type in `appStateManager.ts` + IrisChat separate panel):

| # | View Name | AppState | How to Navigate | Primary Selector |
|---|-----------|----------|-----------------|-----------------|
| 1 | Login | `login` | Initial state (no auth) | `form` / `#username` |
| 2 | Dashboard | `dashboard` | After login success | `h1` (title element) |
| 3 | CourseList | `course-list` | Dashboard → "Browse Courses" | `h2` with "All Courses" text |
| 4 | CourseDetail | `course-detail` | CourseList → select course | Exercise list container |
| 5 | ExerciseDetail | `exercise-detail` | CourseDetail → select exercise | `#participation-section` |
| 6 | ExamStart | `exam-start` | CourseDetail → select exam | `.examStartView` equivalent element |
| 7 | ExamConduction | `exam-conduction` | ExamStart → start exam (needs live exam) | Timer element (ExamTimer component) |
| 8 | ExamExerciseDetail | `exam-exercise-detail` | ExamConduction → select exercise | Exercise content container |
| 9 | IrisChat | (separate provider) | ActivityBar → Iris Chat panel | `[aria-label="Chat input"]` |
| 10 | GitCredentials | `git-credentials` | Dashboard → "Git Credentials" | `.git-card-header` or `.git-card-form` |
| 11 | RecommendedExtensions | `recommended-extensions` | Dashboard → "Recommended Extensions" | `.recommended-container` or `h2` text |
| 12 | ServiceStatus | `service-status` | Dashboard → "Service Status" | `#serverUrl` |

**Requirements E2EV-10 (BuildFeedback) and E2EV-11 (ProblemStatement) are MISMATCHES**: these are subcomponents of ExerciseDetail, not standalone views. The planner must remap: E2EV-10 → GitCredentials, E2EV-11 → RecommendedExtensions (or swap), treating the requirement IDs as labels for the 10th and 11th views respectively.

---

## Cleanup Scope (CLEAN-01, CLEAN-02, CLEAN-03)

### Confirmed Legacy Code Locations

**`src/provider/artemisWebviewProvider.ts` (CLEAN-01, CLEAN-02):**
- Lines ~989, ~1009, ~1047: Three blocks sending duplicate legacy postMessage format alongside typed format:
  ```typescript
  // Also send legacy message for backward compatibility
  this._view.webview.postMessage({ command: 'newResult', result: result });
  ```
  Before removing: verify no React view handles `message.command === 'newResult'` (check IrisChatView.tsx message switch — it uses `message.type`, not `message.command`).

**`src/shared/messageContracts.ts` (CLEAN-01):**
- Lines ~554-600: Section labeled `// Legacy Command Messages (Extension → Webview)` with `BuildLogParsedMessage`, `GitIdentityInfoMessage`, `PlantUmlRenderedMessage` using `command` field. Remove if receivers are updated.

**`src/auth/auth.ts` (CLEAN-02):**
- Line ~104: `// 3. Check old storage location (artemis-auth-cookie) - fallback for migration` — remove old key migration check.

**`src/views/app/commands/navigationCommands.ts` (CLEAN-01):**
- Line 87: `// This is a legacy command - extract text field with runtime check` — `openRulesInEditor` command is flagged as legacy.

**`src/views/webview/react/views/IrisChat/IrisChatView.tsx` (investigation needed):**
- Line 59 comment: "uses legacy format with message.command" — but the actual handler switches on `typedMessage.type`. The comment may be outdated.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `axe-webdriverjs` (deprecated) | `@axe-core/webdriverjs` | ~2021 (axe-core-npm monorepo) | Same API, new package name |
| Manual `executeScript` axe injection | `@axe-core/webdriverjs` AxeBuilder | ~2019 | AxeBuilder handles injection; manual still valid for nested iframes |
| `ts-prune` / `typescript-unused-exports` | `knip` | ~2023 | knip is comprehensive, handles all dead code types |

**Deprecated/outdated:**
- `axe-webdriverjs` (npm): Deprecated, moved to `@axe-core/webdriverjs`. Do not install the old package.

---

## Open Questions

1. **Should E2EV-07/08 gracefully skip or attempt to run?**
   - What we know: ExamConduction and ExamExerciseDetail require a live started exam on the Artemis server.
   - What's unclear: Will CI have access to an exam-enabled account? Is there a test account with a pre-started exam?
   - Recommendation: Use the same `this.skip()` pattern with `ARTEMIS_EXERCISE_ID` env var check. Tests run in CI only when env var is set.

2. **Is the `IrisChat` panel opened by `getViewControl('Chat')` or `getViewControl('Iris Chat')`?**
   - What we know: package.json contributes view `iris-chat` with name `"Chat"`.
   - What's unclear: The ActivityBar label shown to the user vs the `getViewControl()` argument.
   - Recommendation: Use `getViewControl('Chat')` based on the `name` field in package.json. If that fails, fall back to `getViewControl('Artemis')` and look for the Iris panel.

3. **Do the legacy `command`-field sends in the provider need to stay for IrisChat?**
   - What we know: IrisChatView.tsx processes messages via `typedMessage.type` switch (not `message.command`). The legacy sends are for `newResult`, `newSubmission`, `submissionProcessing`.
   - What's unclear: Whether any path in IrisChatView or another component still reads `message.command` for these events.
   - Recommendation: Search for `message.command\|message\[.command.\]` in all React view files. If none found, the legacy sends are safe to remove.

4. **Does knip correctly handle VS Code extension `activate`/`deactivate` exports?**
   - What we know: knip treats entry file exports as used by default when `includeEntryExports: false`.
   - What's unclear: Whether the esbuild entry points and tsconfig are correctly parsed by knip.
   - Recommendation: Run `knip --reporter compact` first in a Wave 0 step to see what it flags before making any deletions.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vscode-extension-tester 8.22.0 + Mocha (via extest) |
| Config file | `.mocharc.ui.yml` (timeout: 30000, spec: `out/test/ui/**/*.ui.test.js`) |
| Quick run command | `bash test/e2e/ui/run-tests.sh` (full pipeline, 3-5 min) |
| Full suite command | `bash test/e2e/ui/run-tests.sh` (same; no subset command exists) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| E2EV-01 | Login view renders login form | E2E smoke | `bash test/e2e/ui/run-tests.sh` | ✅ `login.ui.test.ts` |
| E2EV-02 | Dashboard renders after login | E2E smoke | `bash test/e2e/ui/run-tests.sh` | ❌ Wave 0 |
| E2EV-03 | CourseList renders course list | E2E smoke | `bash test/e2e/ui/run-tests.sh` | ❌ Wave 0 |
| E2EV-04 | CourseDetail renders exercise list | E2E smoke | `bash test/e2e/ui/run-tests.sh` | ❌ Wave 0 |
| E2EV-05 | ExerciseDetail renders submission status | E2E smoke | `bash test/e2e/ui/run-tests.sh` | ❌ Wave 0 |
| E2EV-06 | ExamStart renders exam info | E2E smoke | `bash test/e2e/ui/run-tests.sh` | ❌ Wave 0 |
| E2EV-07 | ExamConduction renders timer | E2E smoke (credential-gated) | `bash test/e2e/ui/run-tests.sh` | ❌ Wave 0 |
| E2EV-08 | ExamExerciseDetail renders exercise content | E2E smoke (credential-gated) | `bash test/e2e/ui/run-tests.sh` | ❌ Wave 0 |
| E2EV-09 | IrisChat renders chat input | E2E smoke | `bash test/e2e/ui/run-tests.sh` | ❌ Wave 0 |
| E2EV-10 | GitCredentials renders git card | E2E smoke (auth) | `bash test/e2e/ui/run-tests.sh` | ❌ Wave 0 |
| E2EV-11 | RecommendedExtensions renders extension list | E2E smoke (auth) | `bash test/e2e/ui/run-tests.sh` | ❌ Wave 0 |
| E2EV-12 | ServiceStatus renders server URL field | E2E smoke (auth) | `bash test/e2e/ui/run-tests.sh` | ❌ Wave 0 |
| E2EX-01 | Login flow — enter creds, assert Dashboard | E2E interaction | `bash test/e2e/ui/run-tests.sh` | Partial (`login-flow.ui.test.ts` — lacks Dashboard assertion) |
| E2EX-02 | Submission flow — open exercise, submit, assert progress | E2E interaction | `bash test/e2e/ui/run-tests.sh` | ❌ Wave 0 |
| A11Y-01 | All 12 views pass axe-core WCAG 2.1 AA | E2E accessibility | `bash test/e2e/ui/run-tests.sh` | ❌ Wave 0 |
| CLEAN-01 | Remove migration-era code | Manual + knip audit | `npm run knip` (after install) | ❌ Wave 0 (knip not installed) |
| CLEAN-02 | Remove legacy fallbacks | Manual review | N/A | N/A |
| CLEAN-03 | Zero unused exports (knip) | Automated (`npm run knip`) | `npm run knip` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** No fast sub-suite; full `run-tests.sh` required (builds VSIX each time)
- **Per wave merge:** `bash test/e2e/ui/run-tests.sh` (full pipeline)
- **Phase gate:** All UI tests green + `npm run knip` reports zero unused exports before verification

### Wave 0 Gaps
- [ ] `test/e2e/ui/dashboard.ui.test.ts` — covers E2EV-02
- [ ] `test/e2e/ui/course-list.ui.test.ts` — covers E2EV-03
- [ ] `test/e2e/ui/course-detail.ui.test.ts` — covers E2EV-04
- [ ] `test/e2e/ui/exercise-detail.ui.test.ts` — covers E2EV-05, E2EX-02
- [ ] `test/e2e/ui/exam-start.ui.test.ts` — covers E2EV-06
- [ ] `test/e2e/ui/exam-conduction.ui.test.ts` — covers E2EV-07
- [ ] `test/e2e/ui/exam-exercise-detail.ui.test.ts` — covers E2EV-08
- [ ] `test/e2e/ui/iris-chat.ui.test.ts` — covers E2EV-09
- [ ] `test/e2e/ui/git-credentials.ui.test.ts` — covers E2EV-10
- [ ] `test/e2e/ui/recommended-extensions.ui.test.ts` — covers E2EV-11
- [ ] `test/e2e/ui/service-status.ui.test.ts` — covers E2EV-12
- [ ] `test/e2e/ui/accessibility.ui.test.ts` — covers A11Y-01 (all 12 views)
- [ ] `knip.json` at project root — knip configuration
- [ ] `npm run knip` script in `package.json` — covers CLEAN-03 automated check
- [ ] `npm install --save-dev axe-core @axe-core/webdriverjs knip` — install new dependencies
- [ ] Update `test/e2e/ui/helpers.ts` — add `runAxeInCurrentFrame()` helper
- [ ] Update `test/e2e/ui/login-flow.ui.test.ts` — add Dashboard assertion for E2EX-01

---

## Sources

### Primary (HIGH confidence)
- Codebase direct inspection — `test/e2e/ui/helpers.ts`, `login.ui.test.ts`, `login-flow.ui.test.ts` — existing patterns confirmed
- `src/views/app/appStateManager.ts` — AppState type confirms 13 states (12 views + IrisChat separate)
- `src/provider/artemisWebviewProvider.ts` — legacy send locations confirmed
- `package.json` — vscode-extension-tester 8.22.0, no axe-core/knip installed
- `@redhat-developer/page-objects/out/components/WebviewMixin.js` — double-nested iframe switchToFrame() confirmed
- npm registry — axe-core 4.11.1, @axe-core/webdriverjs 4.11.1, knip 5.85.0 (live version checks)

### Secondary (MEDIUM confidence)
- [axe-core-npm README](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/webdriverjs/README.md) — AxeBuilder API, setLegacyMode, analyze()
- [knip.dev configuration reference](https://knip.dev/reference/configuration) — entry, project, ignore options
- WebSearch verified: `@axe-core/webdriverjs` v4.11.1, AxeBuilder constructor + analyze() API

### Tertiary (LOW confidence)
- IrisChat panel ActivityBar label: using `name: "Chat"` from package.json — not verified by running the actual extension

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — packages verified via npm registry, installed versions confirmed
- Architecture: HIGH — patterns extracted from existing test files and source code
- Pitfalls: HIGH (CSS modules, legacy code) / MEDIUM (axe iframe behavior) — CSS modules confirmed via esbuild config; axe iframe pitfall is best-practice reasoning, not tested
- View mapping: HIGH — confirmed via AppState type and filesystem

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (30 days — stable test infrastructure)
