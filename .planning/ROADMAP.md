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

- [ ] **Phase 8: Architecture Review** - Audit codebase for anti-patterns and improvement opportunities
- [ ] **Phase 9: UI Polish & Icons** - Lucide icon migration and fullscreen panel restoration
- [ ] **Phase 10: Testing Infrastructure** - Vitest setup with React Testing Library and webview mocks
- [ ] **Phase 11: Bundle Optimization** - Bundle analyzer integration and tree-shaking verification
- [ ] **Phase 12: TypeScript Strict Mode** - Zero compilation errors with strict mode enabled
- [ ] **Phase 13: Component Test Suite** - Comprehensive tests for components, stores, and flows
- [ ] **Phase 14: Dependency Cleanup** - Remove unused deps and verify production security

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
- [ ] 08-02-PLAN.md — End-to-end flow tracing, audit document compilation, and PROJECT.md updates

### Phase 9: UI Polish & Icons
**Goal**: Migrate to Lucide icon system for professional, theme-aware UI consistency
**Depends on**: Phase 8 (architecture review may identify UI patterns to preserve)
**Requirements**: UI-01, UI-02, UI-03
**Success Criteria** (what must be TRUE):
  1. All custom SVG icons from IconDefinitions.ts replaced with Lucide React components using named imports
  2. Fullscreen panel support re-enabled and functions correctly in webviews
  3. Exercise detail page problem statements render with correct formatting and styling
  4. Icon system uses consistent theming via CSS variables (light/dark theme adaptation verified)
**Plans**: TBD

Plans:
- [ ] TBD

### Phase 10: Testing Infrastructure
**Goal**: Establish comprehensive testing foundation with Vitest for React components
**Depends on**: Nothing (independent infrastructure setup, can run parallel with Phase 9)
**Requirements**: TEST-01
**Success Criteria** (what must be TRUE):
  1. Vitest configured with React Testing Library, happy-dom, and VS Code API mocks
  2. Test scripts operational (test:react, test:react:ui, test:react:coverage)
  3. VS Code webview bridge mocking patterns documented and reusable (acquireVsCodeApi, postMessage contracts)
  4. Sample component test validates setup (at least one shared component tested)
**Plans**: TBD

Plans:
- [ ] TBD

### Phase 11: Bundle Optimization
**Goal**: Reduce bundle size from 3.5MB to <2.5MB via tree-shaking and analysis
**Depends on**: Phase 9 (Lucide migration establishes tree-shaking baseline)
**Requirements**: BUNDLE-01, BUNDLE-02
**Success Criteria** (what must be TRUE):
  1. Bundle analyzer integrated (esbuild-visualizer) with metafile generation
  2. Top dependencies profiled by size with optimization opportunities identified
  3. Tree-shaking verified (only used Lucide icons and Shiki languages bundled)
  4. Bundle size reduced by 10-30% from baseline (target: 2.5MB-3.2MB range)
  5. IIFE code splitting constraint documented in PROJECT.md with rationale
**Plans**: TBD

Plans:
- [ ] TBD

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
**Plans**: TBD

Plans:
- [ ] TBD

### Phase 13: Component Test Suite
**Goal**: Comprehensive unit tests for React components, Zustand stores, and critical user flows
**Depends on**: Phase 10 (Vitest infrastructure), can overlap with Phase 12 (write tests while fixing types)
**Requirements**: TEST-02, TEST-03
**Success Criteria** (what must be TRUE):
  1. Unit tests written for 22 shared React components (Button, Input, CodeBlock, etc.)
  2. Unit tests written for 9 Zustand stores (auth, courses, chat, etc.)
  3. Integration tests expanded for critical flows (course browsing, exercise submission, Iris chat)
  4. Test coverage reaches 70-80% overall, 90%+ on critical paths (auth, message contracts, submission)
**Plans**: TBD

Plans:
- [ ] TBD

### Phase 14: Dependency Cleanup & Security Audit
**Goal**: Remove unused dependencies and verify production-ready security posture
**Depends on**: Phases 8-13 (all features complete to safely audit dependencies)
**Requirements**: CLEAN-01, CLEAN-02
**Success Criteria** (what must be TRUE):
  1. Unused dependencies removed with production whitelist verified (dompurify, lucide-react, react, zustand, shiki, streamdown)
  2. Misplaced dependencies corrected (clsx moved to dependencies if needed)
  3. Production .vsix tested in clean environment (all features functional)
  4. CSP nonce implementation verified (crypto.randomBytes usage confirmed, no inline scripts without nonce)
  5. Bundle size meets <2.5MB target or documented rationale for variance
**Plans**: TBD

Plans:
- [ ] TBD

## Progress

**Execution Order:** Numeric order (8 → 9 → 10 → 11 → 12 → 13 → 14)

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
| 8. Architecture Review | v1.1 | 1/2 | In Progress | 2026-02-25 |
| 9. UI Polish & Icons | v1.1 | 0/? | Not started | - |
| 10. Testing Infrastructure | v1.1 | 0/? | Not started | - |
| 11. Bundle Optimization | v1.1 | 0/? | Not started | - |
| 12. TypeScript Strict Mode | v1.1 | 0/? | Not started | - |
| 13. Component Test Suite | v1.1 | 0/? | Not started | - |
| 14. Dependency Cleanup | v1.1 | 0/? | Not started | - |

---

*Created: 2026-02-23 (v1.0)*
*Updated: 2026-02-25 (Phase 8 Plan 01 complete)*
