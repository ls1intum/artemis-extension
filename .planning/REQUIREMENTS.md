# Requirements: Artemis VS Code Extension

**Defined:** 2026-02-28
**Core Value:** Students can interact with Artemis courses, exercises, and the Iris AI tutor without leaving VS Code

## v1.2 Requirements

Requirements for milestone v1.2: E2E & Integration Testing + Cleanup. Each maps to roadmap phases.

### Integration Testing

- [x] **INTG-01**: Extension host bridge contract tests verify typed postMessage payloads for all 13 AppStateManager state transitions
- [x] **INTG-02**: Store hydration round-trip tests verify extension host command → postMessage → Zustand store update for all 12 views
- [x] **INTG-03**: WebSocket error propagation test verifies connection failure propagates to store error state (not infinite loading)
- [x] **INTG-04**: State persistence tests verify webview state survives panel hide/show via getState/setState

### E2E Infrastructure

- [x] **E2EI-01**: E2E framework decision finalized (vscode-extension-tester vs wdio-vscode-service) with documented rationale
- [x] **E2EI-02**: CI workflow runs all E2E tests on GitHub Actions with xvfb on Linux
- [x] **E2EI-03**: Screenshot captured automatically on E2E test failure for debugging

### E2E View Coverage

- [x] **E2EV-01**: E2E smoke test for Login view — renders, login form visible
- [ ] **E2EV-02**: E2E smoke test for Dashboard view — renders, course cards visible
- [ ] **E2EV-03**: E2E smoke test for CourseList view — renders, course list visible
- [ ] **E2EV-04**: E2E smoke test for CourseDetail view — renders, exercise list visible
- [ ] **E2EV-05**: E2E smoke test for ExerciseDetail view — renders, submission status visible
- [ ] **E2EV-06**: E2E smoke test for ExamStart view — renders, exam info visible
- [ ] **E2EV-07**: E2E smoke test for ExamConduction view — renders, timer visible
- [ ] **E2EV-08**: E2E smoke test for ExamExerciseDetail view — renders, exercise content visible
- [ ] **E2EV-09**: E2E smoke test for IrisChat view — renders, chat input visible
- [ ] **E2EV-10**: E2E smoke test for BuildFeedback view — renders, build log visible
- [ ] **E2EV-11**: E2E smoke test for ProblemStatement view — renders, problem content visible
- [ ] **E2EV-12**: E2E smoke test for ServiceStatus view — renders, status info visible

### E2E Interaction Tests

- [ ] **E2EX-01**: E2E interaction test for login flow — enter credentials, click login, verify authenticated state
- [ ] **E2EX-02**: E2E interaction test for exercise submission flow — open exercise, submit, verify build progress

### Accessibility

- [x] **A11Y-01**: axe-core accessibility assertions on all 12 rendered view DOMs

### Tech Debt

- [x] **DEBT-01**: WebSocket error propagation — connection failure shows error state instead of infinite loading
- [x] **DEBT-02**: State persistence — webview state persists across panel hide/show via getState/setState
- [x] **DEBT-03**: Circular dependencies — resolve 2 ProviderRegistry import cycles
- [x] **DEBT-04**: Silent exam fetch errors — exam fetch failures show error feedback to user

### Cleanup

- [ ] **CLEAN-01**: Remove all migration-era code — HTML string generation, coexistence router, migration shims from v1.0 React migration
- [ ] **CLEAN-02**: Remove all legacy fallbacks — backward-compatibility paths, deprecated API wrappers, feature flags for old behavior
- [x] **CLEAN-03**: Remove unused exports, imports, files, and dead code paths (knip audit + manual review)

## Future Requirements

### Deferred Testing

- **E2EF-01**: Exam Web Worker real integration test — requires browser environment, deferred until Vitest worker plugin matures
- **E2EF-02**: Navigation flow E2E — multi-view click-through in real VS Code, high flakiness risk
- **E2EF-03**: Visual regression testing — cross-platform rendering differences make this maintenance-heavy

## Out of Scope

| Feature | Reason |
|---------|--------|
| Visual regression / screenshot diffing | Cross-platform rendering differences cause constant false positives |
| @vscode/test-web browser environment | Extension uses Node.js APIs unavailable in web environment |
| Playwright for VS Code E2E | No VS Code extension automation target (issue #22351 open) |
| 100% E2E coverage mirroring unit tests | Test pyramid — E2E tests verify integration contracts, not every branch |
| Full UI automation with live Artemis server | Fragile, slow, network-dependent — reserved for manual/scheduled runs |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INTG-01 | Phase 16 | In Progress (16-01 done) |
| INTG-02 | Phase 18 | Complete |
| INTG-03 | Phase 17 | Complete |
| INTG-04 | Phase 17 | Complete |
| E2EI-01 | Phase 19 | Complete |
| E2EI-02 | Phase 19 | Complete |
| E2EI-03 | Phase 19 | Complete |
| E2EV-01 | Phase 20 | Complete |
| E2EV-02 | Phase 20 | Pending |
| E2EV-03 | Phase 20 | Pending |
| E2EV-04 | Phase 20 | Pending |
| E2EV-05 | Phase 20 | Pending |
| E2EV-06 | Phase 20 | Pending |
| E2EV-07 | Phase 20 | Pending |
| E2EV-08 | Phase 20 | Pending |
| E2EV-09 | Phase 20 | Pending |
| E2EV-10 | Phase 20 | Pending |
| E2EV-11 | Phase 20 | Pending |
| E2EV-12 | Phase 20 | Pending |
| E2EX-01 | Phase 20 | Pending |
| E2EX-02 | Phase 20 | Pending |
| A11Y-01 | Phase 20 | Complete |
| DEBT-01 | Phase 17 | Complete |
| DEBT-02 | Phase 17 | Complete |
| DEBT-03 | Phase 18 | Complete |
| DEBT-04 | Phase 18 | Complete |
| CLEAN-01 | Phase 20 | Pending |
| CLEAN-02 | Phase 20 | Pending |
| CLEAN-03 | Phase 20 | Complete |

**Coverage:**
- v1.2 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0

---
*Requirements defined: 2026-02-28*
*Last updated: 2026-02-28 — traceability updated after roadmap creation (v1.2, phases 16-20)*
