# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — React Webview Migration

**Shipped:** 2026-02-24
**Phases:** 7 | **Plans:** 24

### What Was Built
- React 18 build pipeline with dual-target esbuild (CJS + IIFE)
- 22 reusable React components with CSS Modules
- All 12 webview views migrated from HTML string generation to React
- Typed message contracts, Zustand state management (9 stores)
- Web Worker exam timers, RAF-based chat streaming

### What Worked
- Incremental view-by-view migration with coexistence router prevented big-bang risk
- Separating migration from redesign kept scope tight
- esbuild dual-target configuration handled both extension host and webview builds cleanly

### What Was Inefficient
- Deferred testing to v1.1 — left 10 TypeScript errors and no component tests at v1.0 ship
- Fullscreen panel temporarily disabled during cleanup (needed restoration in v1.1)

### Patterns Established
- View-scoped Zustand stores as intentional pattern (not a god-store)
- postMessage bridge with typed contracts over VS Code Messenger
- CSS Modules with VS Code CSS variables for theme compliance

### Key Lessons
1. Separating migration from redesign is the right call — ship working parity first, polish after
2. Deferring tests to next milestone works but creates a catch-up cost — 809 tests took ~115 minutes in Phase 13

### Cost Observations
- Total agent time: 1.88 hours across 7 phases
- Average plan duration: 5.7 minutes
- 430 files modified, 39,841 LOC

---

## Milestone: v1.1 — Production Ready

**Shipped:** 2026-02-27
**Phases:** 8 | **Plans:** 38

### What Was Built
- Architecture audit (240 files analyzed, anti-patterns documented)
- Lucide icon system with tree-shaking, fullscreen panels, KaTeX/PlantUML rendering
- Vitest + React Testing Library infrastructure with 809 tests across 66 files
- Bundle analysis tooling (esbuild-visualizer), 3.44 MB baseline documented
- TypeScript strict mode — zero `any` types, 934+ ESLint violations eliminated
- Dependency cleanup (knip), CSP nonce hardening, production .vsix (3.3 MB)
- Missing command handlers (openExternalLink, openImagePreview)

### What Worked
- Architecture review first (Phase 8) gave clear direction for all subsequent phases
- Incremental gap-closure approach for TypeScript strict mode — 15 plans instead of big-bang converted what could have been a blocker into steady progress
- Top-down type fixing strategy (fix root types first) eliminated cascading errors efficiently
- Vitest + happy-dom for webview testing — fast, accurate, no browser needed
- Milestone audit before completion caught stale REQUIREMENTS.md entries

### What Was Inefficient
- Phase 12 (TypeScript strict) needed 15 plans (12 gap closures) — initial plan underestimated scope by 5x. Better upfront error counting would have informed planning
- Phase 13 testing plans 02-08 had `[ ]` checkmarks in ROADMAP.md despite being complete — STATE.md was source of truth but ROADMAP.md lagged
- WebSocket error propagation identified as HIGH impact Quick Win in Phase 8 but never implemented — fell through the cracks between phases
- Phase 14 missing VERIFICATION.md — inconsistency with other phases

### Patterns Established
- knip with dual-entry config for VS Code extension dependency analysis
- lint:src script for production-only linting (test files excluded from strict ESLint)
- Gap-closure planning: initial plan + N closure plans until success criteria met
- `satisfies` pattern for TypeScript compile-time contract verification in tests

### Key Lessons
1. Gap-closure planning works but initial scope estimation needs improvement — count actual errors/violations upfront before committing to a plan count
2. Architecture review before optimization work prevents wasted effort on wrong priorities
3. ROADMAP.md and STATE.md can drift — single source of truth should be STATE.md; ROADMAP.md updated only at phase boundaries
4. Audit-before-complete catches documentation drift that accumulates over multiple phases
5. Quick Wins identified in audits need explicit tracking or they get deprioritized

### Cost Observations
- 167 commits across 3 days
- Phase 12 (TypeScript strict) was the longest at ~110 minutes — type system work is inherently iterative
- Phase 13 (testing) at ~115 minutes was comparable — comprehensive testing has similar iteration patterns
- Phases 8, 9, 10, 11, 15 were all under 20 minutes each — focused, well-scoped phases execute fast

---

## Milestone: v1.2 — E2E & Integration Testing

**Shipped:** 2026-03-01
**Phases:** 5 | **Plans:** 17

### What Was Built
- Integration test infrastructure: global store reset, handshake helpers, typed fixture factories for 13 state transitions
- Extension host bridge tests: WebSocket error propagation fix, panel hide/show state persistence, handleMessageWithSender Mocha tests
- Webview flow tests: circular dependency resolution, store hydration round-trips for all 12 Init messages, exam fetch error visibility
- E2E infrastructure: GitHub Actions CI (Vitest + Mocha + JUnit), ADR 001 framework decision
- E2E view coverage: smoke tests for all 12 views, login + exercise submission interaction tests
- Accessibility: axe-core WCAG 2.1 AA assertions for all 12 rendered view DOMs
- Legacy cleanup: migration-era code removed, knip audit, unused exports purged

### What Worked
- Sandwich testing architecture (Vitest / Mocha / Selenium) matched naturally to the extension's 3-layer architecture
- Global store reset via resetTestState() in vitest.setup.ts eliminated order-dependent test failures across 876+ tests
- Fixture factory pattern with Partial overrides was composable and type-safe — reused across phases 16, 17, 18
- ADR format for E2E framework decision preserved rationale for future contributors
- Milestone audit caught 3 partial requirements (E2EV-10/11 missing asserts, CLEAN-03 false positives) before archival

### What Was Inefficient
- ROADMAP.md plan checkmarks drifted again — plans 16-02, 16-03, 17-01 through 20-06 all showed `[ ]` despite being complete. Same issue as v1.1
- Some SUMMARY.md frontmatter gaps (17-03, 18-03 missing requirements_completed) — VERIFICATION.md caught the actual status
- storeHydration.flow.test.tsx has 12 TS2345 compile-time type errors that were accepted as runtime-safe — ideally would be fixed with proper generic fixtures
- E2EV-10/E2EV-11 smoke tests initially shipped without assert() calls — caught by audit, fixed in final commit

### Patterns Established
- ControllableWebviewView + SpyWebview pattern for testing panel visibility state
- Interface extraction to src/types/ for breaking circular import cycles
- axe-core injection via cached AXE_SOURCE + driver.executeScript for E2E accessibility
- Triple-gated skip pattern for data-dependent E2E interaction tests (credentials + navigation + data)
- assertNoAxeViolations local helper with screenshot + descriptive violation message

### Key Lessons
1. ROADMAP plan checkmarks continue to drift — need automated sync or accept STATE.md as sole source of truth
2. Milestone audit is essential — caught 3 gaps that would have shipped as silent-pass tests
3. E2E tests in VS Code are inherently data-dependent — graceful skip at each navigation step prevents false failures
4. Separation of test layers (unit / integration / E2E) maps cleanly to extension architecture layers

### Cost Observations
- 114 commits across 2 days (2026-02-28 → 2026-03-01)
- +34,075 / -3,658 lines across 298 files
- Average plan duration: ~5 min (comparable to v1.0)
- Phase 17 Plan 01 was longest at 22 min (WebSocket status bar refactor with override visibility rules)
- Phase 20 Plan 06 was second longest at ~10 min (legacy cleanup + knip audit across multiple files)

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 7 | 24 | Established incremental migration pattern |
| v1.1 | 8 | 38 | Added gap-closure planning, milestone audit gates |
| v1.2 | 5 | 17 | Sandwich testing architecture, E2E infrastructure, milestone audit caught silent-pass tests |

### Cumulative Quality

| Milestone | Tests | Coverage | Tech Debt Items |
|-----------|-------|----------|-----------------|
| v1.0 | 0 | N/A | 3 (TS errors, bundle, fullscreen) |
| v1.1 | 809 | Tracked (no threshold) | 5 (WebSocket, state persistence, circular deps, test lint, STOMP boundary) |
| v1.2 | 892+ (unit/integration) + 12 E2E + 12 a11y | 3-layer coverage | 4 (storeHydration types, orphaned export, test lint, knip false positives) |

### Top Lessons (Verified Across Milestones)

1. Incremental approaches beat big-bang — validated in v1.0 (migration), v1.1 (strict TS), v1.2 (test layers)
2. Audit/review before optimization prevents wasted effort — Phase 8 directed v1.1; milestone audit caught v1.2 gaps
3. Scope estimation for type system and testing work is consistently 3-5x underestimated
4. ROADMAP plan checkmarks drift consistently — verified across v1.1 and v1.2; STATE.md is the true source of truth
5. Milestone audit is non-negotiable — caught stale REQUIREMENTS.md in v1.1, silent-pass tests in v1.2
