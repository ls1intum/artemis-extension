# Phase 20: E2E View Coverage, Interactions, Accessibility & Cleanup - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Write E2E smoke tests for all 12 webview views, implement login and exercise submission interaction flows, add axe-core accessibility checks on every view DOM, and remove all migration-era code (HTML string generation, coexistence router, shims, unused exports).

</domain>

<decisions>
## Implementation Decisions

### Smoke Test Strategy
- Log in with real credentials (ARTEMIS_USER/ARTEMIS_PASS env vars) before testing authenticated views
- Navigate to specific views using VS Code commands (viewRouter.ts/navigationCommands.ts), not UI click-through
- Assert one distinctive primary UI element per view (e.g., Dashboard: course cards container, ExamConduction: timer, IrisChat: chat input)
- Accept empty/loading states as valid — smoke tests prove the view mounts and renders its container, no dependency on specific server data

### Login Flow (E2EX-01)
- After login, assert the Dashboard view loads with its primary element visible
- Proves the full auth → navigation → render pipeline

### Exercise Submission Flow (E2EX-02)
- Skip gracefully if ARTEMIS_USER/ARTEMIS_PASS env vars are missing (this.skip() pattern from login-flow.ui.test.ts)
- Exercise ID provided via env var (ARTEMIS_EXERCISE_ID)
- Assert the BuildFeedback view or build progress indicator element appears after submission

### Accessibility
- axe-core checks run as a separate test suite (own file), not inline with smoke tests
- Each view gets its own individual test (`it()` block) — 12 separate assertions
- Hard fail on any axe violation — zero tolerance
- WCAG 2.1 AA standard ruleset, no exceptions or excludes

### Cleanup
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

</decisions>

<specifics>
## Specific Ideas

- Follow the existing login.ui.test.ts and login-flow.ui.test.ts patterns for new E2E tests
- Use helpers.ts utilities (openArtemisView, switchToWebviewFrame, waitForElement, takeScreenshot)
- Reuse the getCredentials() + this.skip() pattern for credential-dependent tests

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `test/e2e/ui/helpers.ts`: openArtemisView, switchToWebviewFrame, switchBackFromWebview, waitForElement, takeScreenshot, getCredentials
- `test/e2e/ui/login.ui.test.ts`: Existing smoke test pattern for Login view (form, inputs, button assertions)
- `test/e2e/ui/login-flow.ui.test.ts`: Existing interaction flow pattern with credential skip and Workbench command execution
- `src/views/app/navigationCommands.ts`: Commands for navigating to specific views
- `src/views/app/viewRouter.ts`: View routing logic

### Established Patterns
- vscode-extension-tester v8.22.0 with Selenium WebDriver
- describe/it/before/after pattern (not suite/test — E2E uses Mocha BDD style)
- WebviewView frame switching for DOM access inside webview
- Screenshot capture on key test moments
- Credential-gated tests with this.skip() when env vars missing
- run-tests.sh: compile → build VSIX → extest setup → run tests

### Integration Points
- 12 React views in `src/views/webview/react/views/`: Login, Dashboard, CourseList, CourseDetail, ExerciseDetail, ExamStart, ExamConduction, ExamExerciseDetail, IrisChat, GitCredentials, RecommendedExtensions, ServiceStatus
- Note: GitCredentials and RecommendedExtensions may not be in the original 12 webview views from requirements — BuildFeedback and ProblemStatement are listed in requirements instead
- VS Code commands for navigation (Workbench.executeCommand pattern)
- package.json scripts: test:ui for E2E, run-tests.sh for full pipeline

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 20-e2e-view-coverage-interactions-accessibility-cleanup*
*Context gathered: 2026-02-28*
