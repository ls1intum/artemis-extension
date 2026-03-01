# Artemis VS Code Extension

## What This Is

A VS Code extension that integrates with the Artemis learning platform, providing students with course browsing, exercise management, code submission, real-time build feedback, AI tutoring (Iris chat), and exam support — all within their editor. Uses React 18 components with Zustand state management, TypeScript strict mode, and comprehensive test coverage — integration tests for the extension host ↔ webview bridge, E2E smoke tests for all 12 views, and axe-core WCAG 2.1 AA accessibility verification.

## Core Value

Students can interact with Artemis courses, exercises, and the Iris AI tutor without leaving VS Code.

## Requirements

### Validated

- ✓ Authentication — Login/logout with cookie-based sessions, token persistence
- ✓ Course browsing — Dashboard, course list, course detail views
- ✓ Exercise management — Exercise detail view with submission status, repository actions, build progress
- ✓ Code submission — Submit exercises, view results, real-time WebSocket updates
- ✓ Iris AI chat — Chat sessions with context switching, message streaming, code highlights
- ✓ Exam support — Exam start, conduction, and exercise detail views with timing
- ✓ Telemetry — Struggle detection, error quotient, intervention hints
- ✓ Build feedback — Build error CodeLens, build log parsing
- ✓ Real-time updates — WebSocket/STOMP for submissions, results, build status
- ✓ React webview migration — All 12 views render through React components — v1.0
- ✓ Typed message contracts — Discriminated unions replacing any-typed handlers — v1.0
- ✓ React component library — 22 components with CSS Modules and VS Code theme compliance — v1.0
- ✓ React build pipeline — Dual-target esbuild (Node.js CJS + browser IIFE) with nonce-based CSP — v1.0
- ✓ Exam timer accuracy — Web Worker timers with absolute timestamps, drift-free in background tabs — v1.0
- ✓ Chat streaming smoothness — RAF-based token buffering with React.memo, no flicker — v1.0
- ✓ Lucide icon system — Tree-shaking verified, fullscreen panels restored, KaTeX/PlantUML rendering — v1.1
- ✓ TypeScript strict mode — Zero `any` types, strict compiler flags, ESLint enforcement — v1.1
- ✓ Bundle analysis tooling — esbuild-visualizer, 3.44 MB baseline documented as architectural minimum — v1.1
- ✓ Comprehensive testing — 809 tests (components, stores, flows) with Vitest + RTL + happy-dom — v1.1
- ✓ Dependency cleanup — knip audit, CSP nonce hardening, production .vsix verified — v1.1
- ✓ Architecture audit — Anti-patterns documented, tech debt cataloged, improvement priorities set — v1.1
- ✓ Integration test infrastructure — Global store reset, bridge handshake helpers, typed fixture factories for 13 state transitions — v1.2
- ✓ Extension host bridge tests — WebSocket error propagation, panel hide/show persistence, handleMessageWithSender Mocha tests — v1.2
- ✓ Store hydration flow tests — Round-trip tests for all 12 Init message types — v1.2
- ✓ Circular dependency resolution — Interface extraction for ProviderRegistry import cycles — v1.2
- ✓ Exam fetch error visibility — Error state + retry flow for ExamStart/ExamConduction — v1.2
- ✓ E2E infrastructure — GitHub Actions CI (Vitest + Mocha + JUnit), ADR 001 framework decision — v1.2
- ✓ E2E view coverage — Smoke tests for all 12 views, login + submission interaction tests — v1.2
- ✓ Accessibility — axe-core WCAG 2.1 AA assertions on all 12 rendered view DOMs — v1.2
- ✓ Legacy cleanup — Migration-era code removed, knip audit, unused exports purged — v1.2

### Active

(None — milestone planning required)

### Out of Scope

- Visual redesign — Migration preserved existing look and feel, not a redesign
- Hot module replacement — DX improvement deferred (DX-01)
- VS Code Messenger RPC — Protocol upgrade deferred (DX-02)
- Code splitting — IIFE format prevents splitting (VS Code Issue #93041), requires ESM switch (DX-03)
- Backend changes — Extension host services (auth, API, WebSocket, telemetry) stay as-is

## Context

- **Codebase:** ~167K LOC TypeScript/TSX (source + tests), 12 React views, 22 shared components, 9 Zustand stores
- **Architecture:** React 18 webviews with CSS Modules, esbuild dual-target build, typed message contracts (discriminated unions)
- **Build artifacts:** extension.js (323KB CJS), webview-react.js (3.44MB IIFE, accepted baseline), webview-react.css (~74KB), .vsix (3.3 MB)
- **Testing:** Vitest + RTL + happy-dom (unit/integration), Mocha + @vscode/test-electron (host-side), vscode-extension-tester + Selenium (E2E). CI via GitHub Actions (Vitest + Mocha + JUnit)
- **Known tech debt:** 12 TS2345 type errors in storeHydration tests (runtime unaffected), `simulateHandshake` orphaned export, 229 test ESLint errors (intentional), 18 knip false-positive unused exports
- **Tech stack:** React 18.3.1, Zustand, esbuild, CSS Modules, Shiki (27 languages), KaTeX, Streamdown, Lucide, Web Workers, axe-core

## Constraints

- **Functionality parity**: Every existing view works identically after migration
- **Exam timing**: Countdown timers use Web Workers with absolute timestamps (drift-free)
- **Chat streaming**: RAF-based token buffering with React.memo (no flicker)
- **VS Code API**: Nonce-based CSP, postMessage bridge, getState/setState persistence
- **No backend changes**: Extension host services remain unchanged
- **IIFE bundle format**: VS Code webview constraint, 3.44 MB accepted baseline

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| React 18.3.1 for webviews | Safer than React 19 for webviews, includes deprecation warnings | ✓ Good |
| Same visual design | Reduce scope and risk — separate migration from redesign | ✓ Good |
| esbuild dual-target | Faster than webpack/Vite, simpler config for CJS + IIFE | ✓ Good |
| Zustand for state | Lightweight, works with postMessage, 9 independent stores | ✓ Good |
| CSS Modules | camelCase class names, VS Code CSS variables, no CSS-in-JS bloat | ✓ Good |
| Incremental migration | View-by-view with coexistence router, not big-bang | ✓ Good |
| Web Worker timers | Absolute timestamps prevent background tab drift | ✓ Good |
| RAF token buffering | Sentence boundary detection, no per-token setState | ✓ Good |
| Shiki syntax highlighting | Singleton highlighter with lazy init for chat code blocks | ✓ Good |
| Tests separate milestone | Keep v1.0 focused; test updates in v1.1 | ✓ Good (validated — v1.1 delivered 809 tests) |
| IIFE bundle format | Single file, VS Code webview constraint (Issue #93041). 3.44 MB accepted baseline | ✓ Accepted |
| Lucide with direct imports | Tree-shaking verified, ESLint barrel import prevention | ✓ Good |
| TypeScript strict incremental | 15 gap-closure plans vs big-bang — eliminated 934+ violations systematically | ✓ Good |
| 3.44 MB bundle baseline | Shiki 2.36 MB + KaTeX 1.63 MB is architectural minimum for IIFE | ✓ Accepted |
| knip for dependency analysis | Dual-entry config (extension.ts + index.tsx) for VS Code extension structure | ✓ Good |
| vscode-extension-tester for E2E | wdio-vscode-service lacks sidebar webview iframe support; Playwright excluded (issue #22351) | ✓ Good |
| Sandwich testing architecture | Vitest for webview, Mocha for host, Selenium for E2E — each layer tests its boundary | ✓ Good |
| Interface extraction for circular deps | IChatWebviewProvider/IArtemisWebviewProvider in src/types/ — dependency inversion | ✓ Good |
| Store reset via global beforeEach | resetTestState() with configurable:true on acquireVsCodeApi — zero order-dependent failures | ✓ Good |
| Fixture factory pattern | Partial override parameter with spread after minimal defaults — type-safe, composable | ✓ Good |
| E2E local-only (no CI Selenium) | Selenium + xvfb flakiness risk; CI runs Vitest + Mocha only | ✓ Accepted |

## Architecture Decisions

**Source:** Phase 8 Architecture Review (2026-02-25)
**Reference:** .planning/milestones/v1.1-phases/08-architecture-review/08-AUDIT.md (if archived) or .planning/phases/08-architecture-review/08-AUDIT.md

### Patterns to Preserve

#### Dual State Management (AppStateManager + Zustand)

**Pattern:** Extension host uses `AppStateManager` (class-based, 13 states, API data caching). React webview uses 9 Zustand stores (feature-scoped, UI state). Data flows one-way: API → AppStateManager → postMessage → Zustand → React.

**Status:** Intentional technical debt. Works correctly. Consolidation deferred indefinitely.

---

#### View-Scoped Zustand Stores (9 separate stores)

**Pattern:** Each view has its own store. Each store owns loading/error state independently. Repetitive patterns are INTENTIONAL.

**Status:** Working as designed. Consolidation would create god-store anti-pattern.

---

#### IIFE Bundle Format

**Pattern:** Webview bundle uses IIFE format, not ESM. 3.44 MB accepted baseline.

**Status:** Platform constraint (VS Code Issue #93041). Bundle analysis tooling in place.

---

#### Web Worker Exam Timers

**Pattern:** Exam timers run in Web Workers with absolute timestamps.

**Status:** Exemplary implementation. Do NOT change without thorough testing.

---

#### postMessage Bridge

**Pattern:** Extension ↔ webview communication uses raw `postMessage` with typed discriminated unions.

**Status:** Type-safe as of v1.1 (Phase 12). VS Code Messenger upgrade deferred (DX-02).

---

### Known Tech Debt

| Item | Impact | Status |
|------|--------|--------|
| ~~WebSocket error propagation~~ | ~~HIGH~~ | ✓ RESOLVED v1.2 — error state replaces infinite loading (Phase 17) |
| ~~State persistence (getState/setState)~~ | ~~MEDIUM~~ | ✓ RESOLVED v1.2 — onDidChangeVisibility + resendViewData (Phase 17) |
| ~~Circular dependencies (ProviderRegistry)~~ | ~~LOW~~ | ✓ RESOLVED v1.2 — interface extraction to src/types/ (Phase 18) |
| Test file ESLint errors | LOW | 229 errors in test/ directory, intentional (mock patterns use any) |
| STOMP library any boundaries | LOW | 2 justified suppressions at library boundary |
| storeHydration type errors | LOW | 12 TS2345 compile-time errors (runtime unaffected, all 12 tests pass) |
| simulateHandshake orphaned export | LOW | Exported in test helpers but never imported — consumers use inline pattern |
| knip false-positive unused exports | LOW | 18 entries — barrel re-exports, React Props, test-consumed APIs |

### Data Caching Policy

- Exercise detail: ALWAYS refetch (ensures latest submission status)
- Course detail: Use cached data (performance)
- Dashboard: Use cached data (performance)

### Tech Stack Rationale

| Choice | Why | Alternatives Considered |
|--------|-----|-------------------------|
| React 18.3.1 | Stable, battle-tested in VS Code webviews | React 19 (too new) |
| Zustand | Lightweight (~2KB), no Provider boilerplate | Redux (complex), Context API (verbose) |
| CSS Modules | No runtime cost, VS Code CSS variables support | Styled Components/Emotion (bundle bloat) |
| esbuild | 10-100x faster than webpack, dual-target support | webpack (slow), Vite (ESM-only) |
| Shiki | VS Code themes, accurate highlighting, 27 languages | Highlight.js (heavy), Prism (manual) |
| KaTeX | Math rendering for problem statements, CSP-compliant | MathJax (heavier, CSP issues) |
| Lucide | Tree-shakeable icons, VS Code theme integration | Custom icon font (no tree-shaking, CSP issues) |
| Vitest + RTL | Fast, React-native testing, happy-dom for webview context | Jest (slower), Cypress (E2E overkill) |

---

*Last updated: 2026-03-01 after v1.2 milestone*
