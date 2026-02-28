# Phase 19: E2E Infrastructure & CI - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Set up a GitHub Actions CI pipeline that runs Vitest and Mocha extension host tests on push/PR, and document the E2E framework decision (vscode-extension-tester retained). E2E tests remain local-only — they do NOT run in CI.

**Deviation from roadmap:** The original success criteria call for Selenium E2E in CI. Per user decision, E2E stays local. CI covers Vitest (React components) and Mocha (extension host) only.

</domain>

<decisions>
## Implementation Decisions

### CI Trigger Strategy
- Trigger on every push to any branch AND on pull requests to main
- Single sequential job with early exit: Vitest → Mocha extension host — if Vitest fails, skip Mocha
- Ubuntu-latest only (no macOS/Windows matrix)
- No VSIX artifact upload — CI is tests-only

### Test Layers in CI
- **Layer 1:** Vitest (React component tests) — `npm run test:react`
- **Layer 2:** Mocha extension host tests — `npm run test:unit`
- **NOT in CI:** Selenium E2E tests — remain local-only via `npm run test:ui` / `run-tests.sh`

### Failure Handling & Reporting
- JUnit XML reports for both Vitest and Mocha, rendered in GitHub Test Summary UI
- GitHub UI notifications only (no Slack, no external notifications)

### Framework Decision Documentation
- ADR in `docs/adr/` (e.g., `001-e2e-framework.md`)
- Full comparison of all three options considered (vscode-extension-tester, wdio-vscode-service, Playwright) with pros/cons and rationale
- ADR focused on E2E decision only — no broader test landscape overview needed

### Claude's Discretion
- Exact GitHub Actions workflow structure and step naming
- JUnit reporter configuration for Vitest and Mocha
- ADR template and formatting
- Whether to update cross-references in existing docs (.planning/codebase/TESTING.md)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `vscode-extension-tester` v8.22.0 already installed with working test helpers (`test/e2e/ui/helpers.ts`)
- `run-tests.sh` handles full local E2E pipeline: compile → build VSIX → extest setup → run tests
- Screenshot capture already implemented in `helpers.ts` (`takeScreenshot()`)
- Webview switching helpers (`switchToWebviewFrame`, `switchBackFromWebview`, `waitForElement`)

### Established Patterns
- Three test layers: `test:react` (Vitest), `test:unit` (Mocha via @vscode/test-cli), `test:ui` (vscode-extension-tester/Selenium)
- Mocha uses `suite()`/`test()` pattern with `@vscode/test-cli`
- Vitest for React component tests (jsdom environment)
- Credentials via `.env` file locally (sourced in `run-tests.sh`, `.env` in `.gitignore`)

### Integration Points
- `.github/workflows/` directory exists at repo root but is empty — no CI workflow yet
- `package.json` scripts: `test:react`, `test:unit`, `test:e2e`, `test:ui`, `test:all`
- esbuild handles both extension bundle (`dist/extension.js`) and webview bundle (`dist/webview-components.js`)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 19-e2e-infrastructure-ci*
*Context gathered: 2026-02-28*
