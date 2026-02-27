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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 7 | 24 | Established incremental migration pattern |
| v1.1 | 8 | 38 | Added gap-closure planning, milestone audit gates |

### Cumulative Quality

| Milestone | Tests | Coverage | Tech Debt Items |
|-----------|-------|----------|-----------------|
| v1.0 | 0 | N/A | 3 (TS errors, bundle, fullscreen) |
| v1.1 | 809 | Tracked (no threshold) | 5 (WebSocket, state persistence, circular deps, test lint, STOMP boundary) |

### Top Lessons (Verified Across Milestones)

1. Incremental approaches beat big-bang — validated in both v1.0 (view migration) and v1.1 (strict TypeScript)
2. Audit/review before optimization prevents wasted effort — Phase 8 directed all v1.1 work
3. Scope estimation for type system and testing work is consistently 3-5x underestimated
