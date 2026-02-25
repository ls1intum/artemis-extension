# Requirements: Artemis VS Code Extension

**Defined:** 2026-02-25
**Core Value:** Students can interact with Artemis courses, exercises, and the Iris AI tutor without leaving VS Code.

## v1.1 Requirements

Requirements for v1.1 Production Ready. Each maps to roadmap phases.

### UI Polish

- [x] **UI-01**: All custom SVG icons (IconDefinitions.ts) migrated to Lucide React components with named imports for tree-shaking
- [x] **UI-02**: Fullscreen panel support re-enabled and functional
- [x] **UI-03**: Exercise detail page renders problem statement content correctly

### Type Safety

- [ ] **TYPE-01**: All 10 pre-existing TypeScript errors resolved (zero compilation errors)
- [ ] **TYPE-02**: TypeScript strict mode enabled incrementally (noImplicitAny, strictNullChecks, strictFunctionTypes, etc.)
- [ ] **TYPE-03**: ESLint @typescript-eslint/no-explicit-any rule enforced — no `any` types in codebase

### Bundle Optimization

- [ ] **BUNDLE-01**: Bundle analyzer (esbuild-visualizer) integrated and top dependencies by size profiled
- [ ] **BUNDLE-02**: Tree-shaking verified — only used Lucide icons and Shiki languages bundled

### Testing

- [x] **TEST-01**: Vitest + React Testing Library + happy-dom configured with VS Code API mocks and test:react script
- [ ] **TEST-02**: Unit tests for shared React components (22 components) and Zustand stores (9 stores)
- [ ] **TEST-03**: Expanded UI tests for critical flows (course browsing, exercise submission, Iris chat)

### Architecture Review

- [x] **ARCH-01**: Codebase architecture audit completed — anti-patterns identified, structure decisions evaluated
- [x] **ARCH-02**: Architecture improvements documented and implemented based on audit findings

### Dependency Cleanup & Security

- [ ] **CLEAN-01**: Unused dependencies removed, misplaced deps corrected (e.g. clsx), production .vsix verified in clean environment
- [ ] **CLEAN-02**: CSP nonce implementation verified (crypto.randomBytes usage), no inline scripts or styles without nonce

## v1.2+ Requirements

Deferred to future release. Tracked but not in current roadmap.

### Performance

- **PERF-01**: CI bundle size budget enforcement (fail if >4MB or +10% growth)
- **PERF-02**: Code splitting investigation if bundle remains >2MB after v1.1 optimization (ESM switch — DX-03)

### Developer Experience

- **DX-01**: Hot Module Replacement for faster webview development iteration
- **DX-02**: VS Code Messenger RPC protocol upgrade
- **DX-03**: ESM bundle format for webviews (enables code splitting)

### Testing

- **TEST-04**: 80%+ test coverage overall, 90%+ on critical paths
- **TEST-05**: Visual regression testing for UI consistency

## Out of Scope

| Feature | Reason |
|---------|--------|
| Dashboard grid layout | Visual redesign deferred — focus on icons and functionality first |
| Code splitting for webviews | IIFE format prevents splitting (esbuild Issue #16, VS Code Issue #93041). Requires ESM switch (DX-03) |
| 100% test coverage | Diminishing returns above 80%. Target 70-80% overall in v1.2+ |
| Hot Module Replacement | Significant build config changes, acceptable iteration speed currently (DX-01) |
| Custom icon font | No tree-shaking, CORS/CSP complications in webviews, maintenance burden |
| Backend/extension host changes | Extension host services remain unchanged per constraint |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ARCH-01 | Phase 8 | Complete |
| ARCH-02 | Phase 8 | Complete |
| UI-01 | Phase 9 | Complete |
| UI-02 | Phase 9 | Complete |
| UI-03 | Phase 9 | Complete |
| TEST-01 | Phase 10 | Complete |
| BUNDLE-01 | Phase 11 | Pending |
| BUNDLE-02 | Phase 11 | Pending |
| TYPE-01 | Phase 12 | Pending |
| TYPE-02 | Phase 12 | Pending |
| TYPE-03 | Phase 12 | Pending |
| TEST-02 | Phase 13 | Pending |
| TEST-03 | Phase 13 | Pending |
| CLEAN-01 | Phase 14 | Pending |
| CLEAN-02 | Phase 14 | Pending |
| UI-03 (integration) | Phase 15 | Pending |

**Coverage:**
- v1.1 requirements: 15 total
- Mapped to phases: 15/15 ✓
- Unmapped: 0
- Gap closure: Phase 15 supplements UI-03 (missing command handlers)

---
*Requirements defined: 2026-02-25*
*Last updated: 2026-02-25 (Phase 8 complete — ARCH-01, ARCH-02 satisfied)*
