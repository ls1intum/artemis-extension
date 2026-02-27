# Phase 10: Testing Infrastructure - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish comprehensive testing foundation with Vitest for React components in the VS Code webview. Configure Vitest + React Testing Library + happy-dom with VS Code API mocks. Create reusable mock patterns. Validate setup with sample component tests. Reorganize existing test directory structure. Writing comprehensive tests for all components is Phase 13 — this phase builds the infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Test directory structure
- Reorganize existing tests into `test/unit/` (current extension unit tests) and `test/e2e/` (current e2e + UI/Playwright tests)
- New React tests go in `test/react/` with paths mirroring `src/views/webview/react/` structure
- Example: `test/react/components/Button/Button.test.tsx` mirrors `src/views/webview/react/components/Button/Button.tsx`
- Zustand store tests live in `test/react/stores/` (part of React test tree)
- Test helpers for React tests in `test/react/__helpers__/`
- Cross-runner shared helpers in `test/__shared__/`
- File naming: `ComponentName.test.tsx` (matches existing `.test.ts` convention)

### npm script naming
- Rename existing scripts to match new structure:
  - `test:unit` (was `test`) — runs vscode-test unit tests from `test/unit/`
  - `test:e2e` — combines old `test:e2e` + `test:ui` from `test/e2e/`
  - `test:react` — new Vitest runner for React component tests
  - `test:react:coverage` — Vitest with coverage
  - `test:all` — runs all test suites
- Update `.vscode-test.mjs` configuration to point at new `test/unit/` and `test/e2e/` paths

### Sample test targets
- **Button component** — primary sample test validating rendering, click handlers, variant props
- **One Zustand store** (e.g. useDashboardStore) — validates store testing patterns
- **One bridge-using component** (e.g. LoginView) — validates postMessage mock and webview bridge patterns end-to-end
- Tests should include **meaningful assertions** (interactions, state changes, message payloads), not just smoke/render tests

### Coverage policy
- Coverage reporting enabled via `test:react:coverage` script
- **No thresholds enforced** in Phase 10 — thresholds deferred to Phase 13 when real coverage exists
- Reporters: text (terminal) + HTML (browsable) + lcov (CI/IDE gutters)
- Coverage scope includes both components (.tsx) and Zustand stores (.ts)
- Coverage output directory gitignored

### Webview bridge mocking
- `acquireVsCodeApi` defined as **global mock** in Vitest setup file — all tests get it automatically, override per-test if needed
- `postMessage` is a **vi.fn() spy** — tests can assert on messages sent, payloads, and call counts
- `dispatchExtensionMessage()` **helper function** for simulating incoming messages from the extension host (typed window `message` events)
- CSS module imports handled with **identity proxy** pattern (class names returned as-is)
- Custom **`renderWithProviders()`** wrapper that sets up Zustand store providers and common context
- Mock patterns documented in dedicated **README** at `test/react/__helpers__/README.md`

### Claude's Discretion
- Whether to auto-mock the `vscode` module — Claude should analyze if any React-side code transitively imports it and decide accordingly
- Exact Vitest configuration details (plugins, transforms, resolve aliases)
- Happy-dom configuration specifics
- How to handle the existing `test/ui/run-tests.sh` migration to `test/e2e/`
- Test timeout values

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. The emphasis is on a clean, reusable foundation that Phase 13 can build on without rework.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 10-testing-infrastructure*
*Context gathered: 2026-02-25*
