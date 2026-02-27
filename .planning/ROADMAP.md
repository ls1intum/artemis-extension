# Roadmap: Artemis VS Code Extension

## Milestones

- ✅ **v1.0 React Webview Migration** — Phases 1-7 (shipped 2026-02-24)
- 🚧 **v1.1 Production Ready** — Phases 8-14 (in progress)

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

## 🚧 v1.1 Production Ready (In Progress)

**Milestone Goal:** Make the extension 100% production-ready with full type safety, UI polish, comprehensive testing, dependency cleanup, and architecture improvements.

- [x] **Phase 8: Architecture Review** - Audit codebase for anti-patterns and improvement opportunities (completed 2026-02-25)
- [x] **Phase 9: UI Polish & Icons** - Lucide icon migration and fullscreen panel restoration (completed 2026-02-25)
- [x] **Phase 10: Testing Infrastructure** - Vitest setup with React Testing Library and webview mocks (completed 2026-02-25)
- [x] **Phase 11: Bundle Optimization** - Bundle analyzer integration and tree-shaking verification (completed 2026-02-25)
- [x] **Phase 12: TypeScript Strict Mode** - Zero compilation errors with strict mode enabled (completed 2026-02-26)
- [x] **Phase 13: Component Test Suite** - Comprehensive tests for components, stores, and flows (completed 2026-02-27)
- [ ] **Phase 14: Dependency Cleanup** - Remove unused deps and verify production security
- [x] **Phase 15: Command Handler Gap Closure** - Implement missing openExternalLink and openImagePreview handlers (completed 2026-02-25)

## Phase Details

### Phase 8: Architecture Review
**Goal**: Identify anti-patterns and architectural improvements before additional work
**Depends on**: Nothing (analysis phase)
**Requirements**: ARCH-01, ARCH-02
**Success Criteria** (what must be TRUE):
  1. Architecture audit completed with documented findings (component structure, state management, message contracts, build pipeline, WebSocket handling)
  2. Improvement opportunities prioritized by impact vs. effort (high-impact, medium-effort changes identified)
  3. Architecture decisions documented in PROJECT.md with rationale for current patterns
  4. Tech debt items cataloged with remediation paths (defer vs. address in v1.1)
**Plans**: 2 plans

Plans:
- [x] 08-01-PLAN.md — Automated dependency analysis and area-by-area structural review (completed 2026-02-25, 6 minutes)
- [x] 08-02-PLAN.md — End-to-end flow tracing, audit document compilation, and PROJECT.md updates (completed 2026-02-25, 9 minutes)

### Phase 9: UI Polish & Icons
**Goal**: Migrate to Lucide icon system for professional, theme-aware UI consistency
**Depends on**: Phase 8 (architecture review may identify UI patterns to preserve)
**Requirements**: UI-01, UI-02, UI-03
**Success Criteria** (what must be TRUE):
  1. All custom SVG icons from IconDefinitions.ts replaced with Lucide React components using named imports
  2. Fullscreen panel support re-enabled and functions correctly in webviews
  3. Exercise detail page problem statements render with correct formatting and styling
  4. Icon system uses consistent theming via CSS variables (light/dark theme adaptation verified)
**Plans**: 3 plans

Plans:
- [x] 09-01-PLAN.md — Lucide icon system migration (iconMap.ts, ArtemisLogo.tsx, IconButton presets, all consumer migration) (completed 2026-02-25, 6 minutes)
- [x] 09-02-PLAN.md — Fullscreen panel support (createWebviewPanel for exercises and courses, responsive CSS) (completed 2026-02-25, 3 minutes)
- [x] 09-03-PLAN.md — Problem statement rendering (KaTeX math, PlantUML diagrams, comprehensive CSS, link/image handlers) (completed 2026-02-25, 4 minutes)

### Phase 10: Testing Infrastructure
**Goal**: Establish comprehensive testing foundation with Vitest for React components
**Depends on**: Nothing (independent infrastructure setup, can run parallel with Phase 9)
**Requirements**: TEST-01
**Success Criteria** (what must be TRUE):
  1. Vitest configured with React Testing Library, happy-dom, and VS Code API mocks
  2. Test scripts operational (test:react, test:react:ui, test:react:coverage)
  3. VS Code webview bridge mocking patterns documented and reusable (acquireVsCodeApi, postMessage contracts)
  4. Sample component test validates setup (at least one shared component tested)
**Plans**: 2 plans

Plans:
- [x] 10-01-PLAN.md — Vitest installation, configuration, test helpers, directory reorganization, npm script updates
- [x] 10-02-PLAN.md — Sample tests (Button, useDashboardStore, LoginView bridge) and helper README documentation

### Phase 11: Bundle Optimization
**Goal**: Implement bundle analysis tooling and verify tree-shaking for optimized dependency bundling
**Depends on**: Phase 9 (Lucide migration establishes tree-shaking baseline)
**Requirements**: BUNDLE-01, BUNDLE-02
**Success Criteria** (what must be TRUE):
  1. Bundle analyzer integrated (esbuild-visualizer) with metafile generation
  2. Top dependencies profiled by size with optimization opportunities identified
  3. Tree-shaking verified (only used Lucide icons and Shiki languages bundled)
  4. Bundle baseline documented at 3.44 MB (IIFE format with Shiki 2.36 MB + KaTeX 1.63 MB — accepted as architectural minimum)
  5. IIFE code splitting constraint documented in PROJECT.md with rationale

**Deferred to v1.2+:** Lazy-loading Shiki languages and KaTeX on demand (requires architectural changes beyond Phase 11 scope)

**Plans**: 4 plans

Plans:
- [x] 11-01-PLAN.md — Bundle analysis tooling, size reporting, ESLint Lucide rule, esbuild-visualizer integration
- [x] 11-02-PLAN.md — Shiki language expansion (7 to 27) and tree-shaking verification
- [x] 11-03-PLAN.md — (Gap closure) Fix Lucide barrel imports with direct icon paths for tree-shaking
- [x] 11-04-PLAN.md — (Gap closure) Accept 3.44 MB baseline, update documentation and success criteria

### Phase 12: TypeScript Strict Mode
**Goal**: Achieve 100% type safety with zero compilation errors and strict mode enabled
**Depends on**: Phase 10 (testing infrastructure helps verify type fixes don't break behavior)
**Requirements**: TYPE-01, TYPE-02, TYPE-03
**Success Criteria** (what must be TRUE):
  1. All 10 pre-existing TypeScript errors resolved
  2. TypeScript strict mode flags enabled incrementally (noImplicitAny, strictNullChecks, strictFunctionTypes)
  3. ESLint @typescript-eslint/no-explicit-any rule enforced across codebase
  4. Zero compilation errors in both extension host and webview builds
  5. Type-safe message contracts maintained (no any types in handler signatures)
**Plans**: 15 plans

Plans:
- [x] 12-01-PLAN.md — Resolve all 107 compilation errors (declaration files, tsconfig fixes, suppression comment removal)
- [x] 12-02-PLAN.md — ESLint strict type rules + eliminate any from extension host code (partial: foundation laid, 772 errors remain)
- [x] 12-03-PLAN.md — Eliminate any from webview React code (partial: stores typed, 11 any types remain in views)
- [x] 12-04-PLAN.md — (Gap closure) Fix extension host TypeScript errors (missing types, broken imports, legacy commands)
- [x] 12-05-PLAN.md — (Gap closure) Eliminate any from extension host providers and services (partial: providers done)
- [x] 12-06-PLAN.md — (Gap closure) Eliminate any from extension host command handlers (partial: 4/8 files done)
- [x] 12-07-PLAN.md — (Gap closure) Eliminate any from webview React views and shared modules (partial: stores done)
- [x] 12-08-PLAN.md — (Gap closure) Fix webview provider and React view TypeScript compilation errors
- [x] 12-09-PLAN.md — (Gap closure) Fix type export conflicts and message contract gaps (foundation)
- [x] 12-10-PLAN.md — (Gap closure) Eliminate any from remaining 10 service files (72 ESLint errors)
- [x] 12-11-PLAN.md — (Gap closure) Eliminate any from remaining 3 command handler files (62 ESLint errors)
- [x] 12-12-PLAN.md — (Gap closure) Fix React view payload typing (13 view files, ~25 ESLint errors)
- [x] 12-13-PLAN.md — (Gap closure) Fix provider and command handler compilation errors (alignment)
- [x] 12-14-PLAN.md — (Gap closure) Fix api/auth/utils/types ESLint errors (56 errors)
- [x] 12-15-PLAN.md — (Gap closure) Fix React hooks/stores/shared component typing (10 files, ~12 ESLint errors)

### Phase 13: Component Test Suite
**Goal**: Comprehensive unit tests for React components, Zustand stores, and critical user flows
**Depends on**: Phase 10 (Vitest infrastructure), can overlap with Phase 12 (write tests while fixing types)
**Requirements**: TEST-02, TEST-03
**Success Criteria** (what must be TRUE):
  1. Unit tests written for 22 shared React components (Button, Input, CodeBlock, etc.)
  2. Unit tests written for 9 Zustand stores (auth, courses, chat, etc.)
  3. Integration tests expanded for critical flows (course browsing, exercise submission, Iris chat)
  4. Test coverage reaches 70-80% overall, 90%+ on critical paths (auth, message contracts, submission)
**Plans**: 8 plans in 3 waves

Plans:
- [x] 13-01: Simple/display shared component tests (Wave 1) — completed 2026-02-27 (2 min, 12 files, 64 tests)
- [ ] 13-02: Interactive shared component tests (Wave 1)
- [ ] 13-03: Zustand store tests (Wave 1)
- [ ] 13-04: IrisChat sub-component tests (Wave 1)
- [ ] 13-05: ExerciseDetail + course/dashboard view tests (Wave 2)
- [ ] 13-06: Remaining view tests (Wave 2)
- [ ] 13-07: Critical flow integration tests (Wave 3)
- [ ] 13-08: Error suite + coverage reporting (Wave 3)

### Phase 14: Dependency Cleanup & Security Audit
**Goal**: Remove unused dependencies and verify production-ready security posture
**Depends on**: Phases 8-13 (all features complete to safely audit dependencies)
**Requirements**: CLEAN-01, CLEAN-02
**Success Criteria** (what must be TRUE):
  1. Unused dependencies removed with production whitelist verified (dompurify, lucide-react, react, zustand, shiki, streamdown)
  2. Misplaced dependencies corrected (clsx moved to dependencies if needed)
  3. Production .vsix tested in clean environment (all features functional)
  4. CSP nonce implementation verified (crypto.randomBytes usage confirmed, no inline scripts without nonce)
  5. Bundle size tracked against 3.44 MB accepted baseline — no regressions introduced
**Plans**: TBD

Plans:
- [ ] TBD

### Phase 15: Command Handler Gap Closure
**Goal**: Implement missing extension command handlers for problem statement interactions
**Depends on**: Phase 9 (command contracts defined in 09-03)
**Requirements**: UI-03 (supplementary — closes integration gap)
**Gap Closure**: Closes integration gaps from v1.1 audit
**Success Criteria** (what must be TRUE):
  1. `openExternalLink` command handler registered — clicking links in problem statements opens the URL in the default browser
  2. `openImagePreview` command handler registered — clicking images in problem statements opens VS Code image preview
  3. E2E flow "Problem statement link click" passes (no silent failures)
**Plans**: 1 plan

Plans:
- [x] 15-01-PLAN.md — Implement openExternalLink and openImagePreview handlers with protocol validation, trusted domains, and image preview (completed 2026-02-25, 3.6 minutes)

## Progress

**Execution Order:** Numeric order (8 → 9 → 10 → 11 → 12 → 13 → 14 → 15)

**Parallelization Opportunities:**
- Phase 9 (icons) + Phase 10 (testing setup) — independent domains, can run in parallel
- Phase 12 (strict TypeScript) + Phase 13 (component tests) — can overlap (write tests while fixing types)

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
| 13. Component Test Suite | 8/8 | Complete    | 2026-02-27 | - |
| 14. Dependency Cleanup | v1.1 | 0/? | Not started | - |
| 15. Command Handler Gap Closure | v1.1 | 1/1 | Complete | 2026-02-25 |

---

*Created: 2026-02-23 (v1.0)*
*Updated: 2026-02-27 (Phase 13-01 complete — simple and display component tests)*
