# Roadmap: Artemis VS Code Extension

## Milestones

- ✅ **v1.0 React Webview Migration** — Phases 1-7 (shipped 2026-02-24)
- ✅ **v1.1 Production Ready** — Phases 8-15 (shipped 2026-02-27)
- 🚧 **v1.2 E2E & Integration Testing** — Phases 16-20 (in progress)

## Phases

<details>
<summary>✅ v1.0 React Webview Migration (Phases 1-7) — SHIPPED 2026-02-24</summary>

- [x] Phase 1: Foundation & Build Pipeline (2/2 plans) — completed 2026-02-23
- [x] Phase 2: Shared Component Library (4/4 plans) — completed 2026-02-23
- [x] Phase 3: Simple Views Migration (4/4 plans) — completed 2026-02-23
- [x] Phase 4: Main UI Views (5/5 plans) — completed 2026-02-24
- [x] Phase 5: Exam Views with Timer Accuracy (2/2 plans) — completed 2026-02-24
- [x] Phase 6: Iris Chat with Streaming (3/3 plans) — completed 2026-02-24
- [x] Phase 7: Cleanup & Optimization (4/4 plans) — completed 2026-02-24

Full details: milestones/v1.0-ROADMAP.md

</details>

<details>
<summary>✅ v1.1 Production Ready (Phases 8-15) — SHIPPED 2026-02-27</summary>

- [x] Phase 8: Architecture Review (2/2 plans) — completed 2026-02-25
- [x] Phase 9: UI Polish & Icons (3/3 plans) — completed 2026-02-25
- [x] Phase 10: Testing Infrastructure (2/2 plans) — completed 2026-02-25
- [x] Phase 11: Bundle Optimization (4/4 plans) — completed 2026-02-25
- [x] Phase 12: TypeScript Strict Mode (15/15 plans) — completed 2026-02-26
- [x] Phase 13: Component Test Suite (8/8 plans) — completed 2026-02-27
- [x] Phase 14: Dependency Cleanup & Security Audit (3/3 plans) — completed 2026-02-27
- [x] Phase 15: Command Handler Gap Closure (1/1 plan) — completed 2026-02-25

Full details: milestones/v1.1-ROADMAP.md

</details>

### 🚧 v1.2 E2E & Integration Testing (In Progress)

**Milestone Goal:** Comprehensive test coverage with integration tests for the extension host ↔ webview message bridge, full E2E smoke tests for all 12 views, and resolution of carried tech debt.

- [x] **Phase 16: Integration Test Infrastructure** — Shared test helpers, store reset, bridge handshake utilities, contract scaffolding (completed 2026-02-28)
- [x] **Phase 17: Extension Host Bridge Tests** — Mocha host-side tests, WebSocket error propagation fix, state persistence fix (completed 2026-02-28)
- [x] **Phase 18: Webview Flow Test Completeness** — Vitest store hydration round-trips for all 12 views, circular dep fix, exam error fix (completed 2026-02-28)
- [x] **Phase 19: E2E Infrastructure & CI** — Framework decision documented (ADR 001), GitHub Actions workflow (completed 2026-02-28)
- [x] **Phase 20: E2E View Coverage, Interactions, Accessibility & Cleanup** — All 12 view smoke tests, interaction tests, axe-core, migration-era code removal (completed 2026-02-28)

## Phase Details

### Phase 16: Integration Test Infrastructure
**Goal**: Shared test helpers exist that all subsequent integration and E2E tests can rely on — store state cannot leak between tests, and bridge handshake race conditions cannot silently corrupt test results
**Depends on**: Nothing (first v1.2 phase)
**Requirements**: INTG-01
**Success Criteria** (what must be TRUE):
  1. Running the full Vitest suite twice in sequence produces identical results — no order-dependent failures from Zustand store state leaking between tests
  2. `resetAllStores()` is called automatically in `beforeEach` globally via `vitest.setup.ts` — no individual test file needs to call it
  3. A shared bridge handshake helper exists that simulates the `ready` message before asserting bridge responses — no test needs to manage handshake timing manually
  4. Bridge contract test scaffolding exists covering all 13 AppStateManager state transitions with typed payload shape verification
**Plans**: 3 plans
- [x] 16-01-PLAN.md — Store reset infrastructure + handshake helper (complete 2026-02-28)
- [ ] 16-02-PLAN.md — Fixture factories + bridge contract tests
- [ ] 16-03-PLAN.md — Cleanup redundant per-test store resets

### Phase 17: Extension Host Bridge Tests
**Goal**: The extension host side of the postMessage bridge is verified with Mocha tests running in a real VS Code process — WebSocket connection failures show error state instead of infinite loading, and webview state persists across panel hide/show
**Depends on**: Phase 16
**Requirements**: INTG-03, INTG-04, DEBT-01, DEBT-02
**Success Criteria** (what must be TRUE):
  1. A WebSocket connection failure causes the relevant Zustand store to enter error state — the user sees an error message, not an infinite loading spinner
  2. Hiding and re-showing a webview panel restores the previous UI state — the user does not start from the loading screen again
  3. `WebViewMessageHandler.handleMessageWithSender()` Mocha tests pass in `@vscode/test-electron` with sinon-injected stubs — the host-side bridge seam is verified without mocking the `vscode` module
  4. All host-side integration tests run and pass in CI as part of the Mocha test phase before any Selenium tests run
**Plans**: 3 plans
- [ ] 17-01-PLAN.md — WebSocket status bar refactor + reconnect getter + tests (DEBT-01, INTG-03)
- [ ] 17-02-PLAN.md — Panel hide/show state persistence + onDidChangeVisibility + tests (DEBT-02, INTG-04)
- [ ] 17-03-PLAN.md — handleMessageWithSender Mocha tests for bridge seam (INTG-03, INTG-04)

### Phase 18: Webview Flow Test Completeness
**Goal**: The webview side of the bridge has Vitest coverage for all 12 `*Init` message types verifying correct store hydration, circular import cycles are resolved, and silent exam fetch failures show an error to the user
**Depends on**: Phase 16
**Requirements**: INTG-02, DEBT-03, DEBT-04
**Success Criteria** (what must be TRUE):
  1. All 12 `*Init` message types have a passing `storeHydration.flow.test.tsx` test — dispatching each init message hydrates the correct Zustand store with the expected shape
  2. Zero circular dependency cycles exist in the ProviderRegistry import graph — the 2 documented cycles are resolved
  3. A failing exam fetch (network error, 4xx, 5xx) results in a visible error state in the ExamStart or ExamConduction view — the user is not left on a blank or perpetually loading screen
**Plans**: 3 plans
- [ ] 18-01-PLAN.md — Circular dependency fix: extract provider interfaces to src/types/ (DEBT-03)
- [ ] 18-02-PLAN.md — Store hydration flow tests for all 12 Init message types (INTG-02)
- [ ] 18-03-PLAN.md — Exam error UX: wire fetch error visibility in ExamStart/ExamConduction (DEBT-04)

### Phase 19: E2E Infrastructure & CI
**Goal**: A working GitHub Actions CI pipeline runs all test layers in order on Linux with Xvfb, the E2E framework decision is documented, and screenshots are captured automatically on test failure
**Depends on**: Phase 17
**Requirements**: E2EI-01, E2EI-02, E2EI-03
**Success Criteria** (what must be TRUE):
  1. A GitHub Actions push triggers a workflow that runs Vitest, then Mocha extension host tests, then Selenium E2E tests — all producing clear pass/fail output in CI
  2. The CI workflow completes successfully on ubuntu-latest using `xvfb-run -a` with no manual display configuration needed
  3. A failing E2E test automatically saves a screenshot as a CI artifact — the failure is debuggable without re-running locally
  4. The E2E framework decision (vscode-extension-tester retained, wdio-vscode-service and Playwright excluded) is recorded with rationale — discoverable by future contributors
**Plans**: 2 plans
- [ ] 19-01-PLAN.md — CI workflow + JUnit reporting (E2EI-02, E2EI-03)
- [x] 19-02-PLAN.md — E2E framework ADR (E2EI-01) — complete 2026-02-28

### Phase 20: E2E View Coverage, Interactions, Accessibility & Cleanup
**Goal**: All 12 webview views have a passing E2E smoke test in CI, critical user interaction flows are verified end-to-end, every rendered view DOM passes axe-core accessibility checks, and all migration-era code is removed
**Depends on**: Phase 19
**Requirements**: E2EV-01, E2EV-02, E2EV-03, E2EV-04, E2EV-05, E2EV-06, E2EV-07, E2EV-08, E2EV-09, E2EV-10, E2EV-11, E2EV-12, E2EX-01, E2EX-02, A11Y-01, CLEAN-01, CLEAN-02, CLEAN-03
**Success Criteria** (what must be TRUE):
  1. Every one of the 12 webview views has a passing smoke test that opens the view in a real VS Code window and asserts the primary UI element is visible
  2. The login flow E2E test enters credentials, clicks login, and asserts the authenticated Dashboard state is reached — verified in CI with env var credentials
  3. The exercise submission E2E test opens an exercise, triggers submission, and asserts build progress feedback appears — the critical student workflow is verified end-to-end
  4. All 12 rendered view DOMs pass axe-core accessibility assertions with zero WCAG violations
  5. No HTML string generation, coexistence router code, migration shims, legacy fallbacks, or unused exports remain — `knip` reports zero unused exports after cleanup
**Plans**: 6 plans
- [ ] 20-01-PLAN.md — E2E infrastructure: install axe-core + knip, add axe helper, confirm E2EV-01 (E2EV-01, A11Y-01, CLEAN-03)
- [ ] 20-02-PLAN.md — Smoke tests: Dashboard, CourseList, CourseDetail, ExerciseDetail (E2EV-02, E2EV-03, E2EV-04, E2EV-05)
- [ ] 20-03-PLAN.md — Smoke tests: ExamStart, ExamConduction, ExamExerciseDetail, IrisChat, ServiceStatus, GitCredentials, RecommendedExtensions (E2EV-06, E2EV-07, E2EV-08, E2EV-09, E2EV-10, E2EV-11, E2EV-12)
- [ ] 20-04-PLAN.md — Interaction tests: login flow + exercise submission (E2EX-01, E2EX-02)
- [ ] 20-05-PLAN.md — Accessibility: axe-core WCAG 2.1 AA for all 12 views (A11Y-01)
- [ ] 20-06-PLAN.md — Cleanup: remove legacy code, fallbacks, unused exports (CLEAN-01, CLEAN-02, CLEAN-03)

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation & Build Pipeline | v1.0 | 2/2 | Complete | 2026-02-23 |
| 2. Shared Component Library | v1.0 | 4/4 | Complete | 2026-02-23 |
| 3. Simple Views Migration | v1.0 | 4/4 | Complete | 2026-02-23 |
| 4. Main UI Views | v1.0 | 5/5 | Complete | 2026-02-24 |
| 5. Exam Views with Timer Accuracy | v1.0 | 2/2 | Complete | 2026-02-24 |
| 6. Iris Chat with Streaming | v1.0 | 3/3 | Complete | 2026-02-24 |
| 7. Cleanup & Optimization | v1.0 | 4/4 | Complete | 2026-02-24 |
| 8. Architecture Review | v1.1 | 2/2 | Complete | 2026-02-25 |
| 9. UI Polish & Icons | v1.1 | 3/3 | Complete | 2026-02-25 |
| 10. Testing Infrastructure | v1.1 | 2/2 | Complete | 2026-02-25 |
| 11. Bundle Optimization | v1.1 | 4/4 | Complete | 2026-02-25 |
| 12. TypeScript Strict Mode | v1.1 | 15/15 | Complete | 2026-02-26 |
| 13. Component Test Suite | v1.1 | 8/8 | Complete | 2026-02-27 |
| 14. Dependency Cleanup | v1.1 | 3/3 | Complete | 2026-02-27 |
| 15. Command Handler Gap Closure | v1.1 | 1/1 | Complete | 2026-02-25 |
| 16. Integration Test Infrastructure | 3/3 | Complete    | 2026-02-28 | - |
| 17. Extension Host Bridge Tests | 3/3 | Complete    | 2026-02-28 | - |
| 18. Webview Flow Test Completeness | 3/3 | Complete    | 2026-02-28 | - |
| 19. E2E Infrastructure & CI | 2/2 | Complete    | 2026-02-28 | - |
| 20. E2E View Coverage & Cleanup | 6/6 | Complete   | 2026-02-28 | - |

---

*Created: 2026-02-23 (v1.0)*
*Updated: 2026-02-28 (19-02 complete)*
