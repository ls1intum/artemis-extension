---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: E2E & Integration Testing
status: unknown
last_updated: "2026-02-28T22:00:00Z"
progress:
  total_phases: 5
  completed_phases: 4
  total_plans: 17
  completed_plans: 16
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-28)

**Core value:** Students can interact with Artemis courses, exercises, and the Iris AI tutor without leaving VS Code.
**Current focus:** v1.2 Phase 20 — E2E View Coverage, Interactions, Accessibility & Cleanup

## Current Position

Phase: 20 of 20 (E2E View Coverage, Interactions, Accessibility & Cleanup)
Plan: 04 complete — 4/6 Phase 20 plans done
Status: In progress
Last activity: 2026-02-28 — 20-04 complete: E2EX-01 Dashboard assertion added to login-flow test, E2EX-02 exercise submission → build progress interaction test created

Progress: [██████░░░░] 59% (v1.2, 13/17 plans done across phases 16-20) — v1.0 + v1.1 complete (15 phases, 62 plans)

## Performance Metrics

**v1.0 Milestone (Complete):**
- Phases: 7 (24 plans) | Total time: 1.88 hours | Avg/plan: 5.7 min

**v1.1 Milestone (Complete):**
- Phases: 8 (38 plans) | Timeline: 3 days | 167 commits
- Phase 8: 15 min | Phase 9: 7 min | Phase 10: 10 min | Phase 11: 16 min
- Phase 12: ~110 min | Phase 13: ~115 min | Phase 14: ~20 min | Phase 15: 4 min

**v1.2 Milestone (In Progress):**
- Phase 16 Plan 01: 7 min | 2 tasks | 3 files
- Phase 16 Plan 02: ~3 min | 2 tasks | 14 files | 61 new tests (876 total)
- Phase 16 Plan 03: 12 min | 2 tasks | 20 files | 876 tests passing order-independently
- Phase 17 Plan 01: 22 min | 2 tasks | 5 files | 15 new tests (WebSocketStatusBar override rule + reconnect flash)
- Phase 17 Plan 02: ~3 min | 2 tasks | 2 files | 6 new tests (visibility listener + hide/show state persistence)
- Phase 17 Plan 03: 3 min | 1 task | 1 file | 7 new tests (sender-swap + dispatch + error recovery)
- Phase 18 Plan 01: 2 min | 2 tasks | 6 files | 0 new tests (circular dependency resolution via interface extraction, 880 total)
- Phase 18 Plan 02: 4 min | 2 tasks | 4 files | 12 new tests (storeHydration flow, 892 total)
- Phase 18 Plan 03: ~2 min | 2 tasks | 4 files | 4 new tests (exam fetch error visibility + retry flow, 880 total)
- Phase 19 Plan 01: ~2 min | 2 tasks | 6 files | GitHub Actions CI workflow + JUnit reporter config (mocha-junit-reporter installed)
- Phase 19 Plan 02: ~1 min | 1 task | 1 file | ADR 001 E2E framework selection (vscode-extension-tester retained)
- Phase 20 Plan 01: ~2 min | 2 tasks | 4 files | axe-core injection helper (WCAG 2.1 AA) + knip dead-code tooling + E2EV-01 confirmed
- Phase 20 Plan 02: ~5 min | 2 tasks | 4 files | 4 E2E smoke tests for Dashboard, CourseList, CourseDetail, ExerciseDetail (E2EV-02 through E2EV-05)
- Phase 20 Plan 03: ~3 min | 2 tasks | 7 files | 7 E2E smoke tests for exam views + IrisChat + ServiceStatus + GitCredentials + RecommendedExtensions (E2EV-06 through E2EV-12) — 12/12 view coverage
- Phase 20 Plan 04: ~5 min | 2 tasks | 2 files | E2EX-01 Dashboard heading assertion in login-flow test + E2EX-02 exercise submission → build progress interaction test (triple-gated skip)

## Accumulated Context

### Decisions

- Framework decision: keep `vscode-extension-tester` 8.22.0 — wdio-vscode-service has no sidebar webview iframe support; Playwright excluded (issue #22351)
- Test architecture: sandwich testing — Vitest for webview side, Mocha + @vscode/test-electron for host side, vscode-extension-tester for Selenium UI
- No new packages required — entire stack already installed
- Store reset pattern: direct getState() reference (not structuredClone/JSON.parse) + setState(state, true) replace flag; configurable:true required on initial acquireVsCodeApi defineProperty for re-definition in beforeEach
- Fixture factory pattern: Partial<XxxMessage['payload']> override parameter with spread after minimal defaults — return type annotation enforces shape, no type assertions needed
- createGenericInitPayload takes view as required first arg (not override) because view is the state machine discriminator
- [Phase 16]: Per-test default-state resets are redundant when global resetTestState() is wired: remove all beforeEach blocks whose sole purpose is resetting stores to initial values
- [Phase 17-02]: Use hasAuthCookie() not isAuthenticated() in visibility listener — AuthManager exposes hasAuthCookie() only; void IIFE pattern for async listener returning void
- [Phase 17-02]: ControllableWebviewView + SpyWebview pattern established for hide/show visibility testing with message capture
- [Phase 17-01]: Reconnect flash only fires on Reconnecting→Connected transition, not Disconnected→Connected (initial connect); prevents spurious 2s show/hide on first session
- [Phase 17-01]: Override visibility rule in _applyVisibility(): disconnect/reconnect always show; hide only when no pending flash timeout (avoids immediate hide before 2s flash completes)
- [Phase 17-03]: Inject test handlers via `(handler as any).commandHandlers.set()` to test dispatch seam without triggering real command side effects; assert sender restoration via `(handler as any)._sendMessage` field access
- [Phase 18-03]: ExamConductionView retry must call store.setError(null) + store.setLoading(true) before postMessage ready — original only sent ready signal, leaving the view stuck in error state
- [Phase 18-01]: IChatWebviewProvider reason parameter must be optional (reason?: string) to match concrete class's optional ChatContextReason default — TypeScript contravariance rejects narrow optional type satisfying required broad type
- [Phase 18-01]: IArtemisWebviewProvider is intentionally empty — ProviderRegistry only stores/retrieves, no methods called through getter externally
- [Phase 18-01]: getSelectedContext() must be in IChatWebviewProvider — called in extension.ts:284 through registry getter (missed by plan's grep)
- [Phase 18-02]: Mock useExamTimer hook in storeHydration tests — esbuild-plugin-inline-worker Web Worker constructor fails in Vitest SSR; use vi.mock() same pattern as ExamTimer.test.tsx
- [Phase 18-02]: Wrap render() in await act() for complex views (ExamConduction, ExamExerciseDetail, IrisChatView) — concurrent React work on mount causes 'Should not already be working' during cleanup
- [Phase 19-01]: dorny/test-reporter path must be workspace-root-relative (iris-thaumantias/reports/*.xml), not working-directory-relative — avoids missing artifact
- [Phase 19-01]: compile-tests before test:unit in CI — Mocha consumes compiled JS from out/, not TypeScript source; mkdir -p reports before test runs prevents JUnit reporter failure
- [Phase 19-02]: ADR scoped to E2E framework selection only — no broader test architecture overview; docs/adr/ directory established in iris-thaumantias for future ADRs
- [Phase 20-01]: axe injection via cached AXE_SOURCE (module load time) + driver.executeScript + driver.executeAsyncScript with WCAG 2.1 AA tag set ['wcag2a','wcag2aa','wcag21a','wcag21aa']
- [Phase 20-01]: path.resolve from __dirname needs 4 `..` not 3 — compiled output is at out/test/e2e/ui/, which is 4 levels from the package root
- [Phase 20-01]: Existing knip.json (knip@5 schema, ignoreDependencies vscode, ignore esbuild.js) preserved — more complete than plan template; entry points match plan requirements
- [Phase 20-02]: Login once per suite in before() — avoids repeated 5s login delays and reduces test flakiness
- [Phase 20-02]: Credential skip in before() skips entire suite (not per-test) — correct Mocha behavior when getCredentials() throws
- [Phase 20-02]: CourseList navigation fallback — accept Dashboard if no Courses button found; some server configs may not show browse-courses entry point
- [Phase 20-02]: CourseDetail/ExerciseDetail use this.skip() (not assert.fail) when no courses/exercises — produces Mocha pending not failure for data-dependent navigation tests
- [Phase 20]: ExamStart/ExamConduction/ExamExerciseDetail tests skip at every navigation step — live exam required in CI would always produce pending status, not failure
- [Phase 20]: IrisChat uses ActivityBar.getViewControl('Chat') — separate VS Code sidebar panel, not accessible via openArtemisView()
- [Phase 20]: E2EV-10 remapped to GitCredentials, E2EV-11 to RecommendedExtensions — BuildFeedback/ProblemStatement are subcomponents, not standalone views
- [Phase 20-04]: E2EX-01 uses waitForElement h1 CSS selector (not XPath) — h1 is standard semantic element; absence of form #username confirms Dashboard showing
- [Phase 20-04]: E2EX-02 triple-gated skip — ARTEMIS_USER + ARTEMIS_PASS + ARTEMIS_EXERCISE_ID all required; sequential it() tests valid for Mocha interaction flows; graceful skip at each navigation step
- [Phase 20-04]: E2EX-02 assert.ok on progressIndicator is the core assertion (not this.skip) — build progress is the required outcome, not optional

### Pending Todos

None.

### Blockers/Concerns

**Critical pitfalls (Phase 16-01 resolved two of these):**
- ~~Zustand store state leaks~~ — RESOLVED: resetTestState() in global beforeEach (16-01)
- ~~Bridge handshake helper missing~~ — RESOLVED: simulateHandshake() with act() wrapping (16-01)
- postMessage dropped before webview listener ready — handled by simulateHandshake() pattern established in 16-01

**Watch items (not blockers yet):**
- Authenticated E2E test strategy — decide env-var credentials vs test-mode bypass at Phase 20 planning
- Vitest memory pressure if test count exceeds ~1200 — monitor, remediate with separate project config if needed

## Session Continuity

Last session: 2026-02-28
Stopped at: Phase 20 Plan 04 complete — E2EX-01 Dashboard assertion in login-flow test, E2EX-02 exercise submission interaction test with triple-gated skip (ARTEMIS_EXERCISE_ID). 4/6 Phase 20 plans done.
Resume file: None

---

*Created: 2026-02-23 (v1.0)*
*Updated: 2026-02-28 (20-04 complete)*
