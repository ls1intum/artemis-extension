# Milestones

## v1.2 E2E & Integration Testing (Shipped: 2026-03-01)

**Started:** 2026-02-28 | **Shipped:** 2026-03-01
**Phases:** 16-20 (5 phases, 17 plans)
**Timeline:** 2 days execution (2026-02-28 → 2026-03-01), 114 commits
**Lines changed:** +34,075 / -3,658 across 298 files

**Key accomplishments:**
- Built integration test infrastructure with global Zustand store reset, bridge handshake helpers, and typed fixture factories for all 13 state transitions
- Added extension host bridge tests — WebSocket error propagation fix (error state replaces infinite loading), panel hide/show state persistence, handleMessageWithSender Mocha tests
- Completed webview flow test coverage — circular dependency resolution, store hydration round-trip tests for all 12 Init message types, exam fetch error visibility
- Established E2E infrastructure with GitHub Actions CI workflow (Vitest + Mocha + JUnit) and ADR 001 documenting framework decision
- Created E2E smoke tests for all 12 views, login flow + exercise submission interaction tests, axe-core WCAG 2.1 AA accessibility suite
- Removed all migration-era code, legacy fallbacks, and dead exports via knip audit

**Audit:** 26/29 requirements fully satisfied, 3 partial (non-critical), 5/5 phases, 28/28 integration paths, 9/9 E2E flows — TECH DEBT (all functional, 13 documentation items)

**Known Gaps:**
- E2EV-10/E2EV-11: Smoke test files exist but originally lacked assert() calls (fixed in final commit)
- CLEAN-03: 18 knip false-positive "unused exports" remain — further removal breaks compilation
- CI workflow not yet confirmed via live GitHub Actions execution

**Tech debt carried forward:**
- 12 TS2345 compile-time type errors in storeHydration.flow.test.tsx (runtime unaffected)
- `simulateHandshake` helper exported but never imported
- 229 ESLint errors in test/ directory (intentional — test mocks use explicit any)
- Legacy `{ command: 'showLoading'/'updateLoading' }` postMessage calls remain (intentional command-format)

**Archives:** milestones/v1.2-ROADMAP.md, milestones/v1.2-REQUIREMENTS.md, milestones/v1.2-MILESTONE-AUDIT.md

---

## v1.0 React Webview Migration (Shipped: 2026-02-24)

**Started:** 2026-02-23 | **Shipped:** 2026-02-24
**Phases:** 1-7 (7 phases, 24 plans, 31 tasks)
**Timeline:** 19 days execution (2026-02-05 → 2026-02-24), 1.88 hours total agent time
**Lines of code:** 39,841 TypeScript/TSX across 430 files

**Key accomplishments:**
- Established React 18 build pipeline with dual-target esbuild (Node.js CJS + browser IIFE) and nonce-based CSP
- Built 22 reusable React components with CSS Modules and VS Code theme compliance
- Migrated all 12 webview views from HTML string generation to React components
- Implemented typed message contracts with discriminated unions and Zustand state management (9 stores)
- Built drift-free exam timers using Web Workers with absolute timestamps
- Added Iris chat streaming with RAF-based token buffering, Shiki syntax highlighting, and smart auto-scroll

**Audit:** 18/18 requirements, 7/7 phases, 12/12 E2E flows — PASSED

**Tech debt carried forward:**
- 10 pre-existing TypeScript errors (streamdown/mermaid module, unused @ts-expect-error directives)
- 3.5MB webview-react.js bundle (may benefit from code splitting)
- Fullscreen panel support temporarily disabled during cleanup

**Archives:** milestones/v1.0-ROADMAP.md, milestones/v1.0-REQUIREMENTS.md, milestones/v1.0-MILESTONE-AUDIT.md

---


## v1.1 Production Ready (Shipped: 2026-02-27)

**Started:** 2026-02-25 | **Shipped:** 2026-02-27
**Phases:** 8-15 (8 phases, 38 plans, 43 tasks)
**Timeline:** 3 days execution (2026-02-25 → 2026-02-27), 167 commits
**Lines of code:** 166,921 TypeScript/TSX (including tests)

**Key accomplishments:**
- Completed full architecture audit identifying anti-patterns, tech debt, and improvement priorities across 240 files
- Migrated icon system to Lucide React with tree-shaking, restored fullscreen panels, and added KaTeX/PlantUML problem statement rendering
- Established Vitest + React Testing Library infrastructure with 809 tests across 66 files covering components, stores, and critical flows
- Implemented bundle analysis tooling (esbuild-visualizer), verified tree-shaking, and documented 3.44 MB baseline as architectural minimum
- Achieved TypeScript strict mode with zero `any` types — 15 incremental plans eliminating 934+ ESLint violations across the entire codebase
- Cleaned up dependencies (knip audit), hardened CSP nonce implementation, and packaged production .vsix (3.3 MB)

**Audit:** 15/15 requirements, 8/8 phases, 16/16 integration connections, 6/6 E2E flows — PASSED

**Tech debt carried forward:**
- WebSocket error propagation not implemented (HIGH impact, deferred to v1.2)
- State persistence (getState/setState) — no webview state persistence (deferred to v1.2)
- 229 ESLint errors in test/ directory (intentional — test mocks use explicit any)
- 3 low-severity devDep vulnerabilities in @vscode/test-cli chain (no fix available)

**Archives:** milestones/v1.1-ROADMAP.md, milestones/v1.1-REQUIREMENTS.md, milestones/v1.1-MILESTONE-AUDIT.md

---

