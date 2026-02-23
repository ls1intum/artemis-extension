# Roadmap: Artemis React Webview Migration

## Overview

This roadmap transforms 14 HTML-string-based webviews into React components through a disciplined, incremental migration. Starting with build infrastructure and shared components, we progress through simple views to validate patterns before tackling complex time-sensitive views (exam timers, chat streaming). The journey culminates in cleanup of legacy code and bundle optimization. Each phase delivers verifiable capabilities while maintaining functionality parity with the existing extension.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation & Build Pipeline** - Establish React infrastructure with proper CSP, dual-target builds, and message bridge
- [ ] **Phase 2: Shared Component Library** - Extract 20+ reusable React components matching existing visual design
- [ ] **Phase 3: Simple Views Migration** - Migrate 4 standalone views to validate patterns with minimal state
- [ ] **Phase 4: Main UI Views** - Migrate core application flow with real-time updates and complex state
- [ ] **Phase 5: Exam Views with Timer Accuracy** - Migrate time-sensitive views with Web Worker timers
- [ ] **Phase 6: Iris Chat with Streaming** - Migrate chat provider with optimized message streaming
- [ ] **Phase 7: Cleanup & Optimization** - Remove legacy code and optimize production bundles

## Phase Details

### Phase 1: Foundation & Build Pipeline
**Goal**: React builds successfully with proper CSP configuration and message bridge scaffold
**Depends on**: Nothing (first phase)
**Requirements**: BUILD-01, BUILD-02, BUILD-03
**Success Criteria** (what must be TRUE):
  1. Extension builds React webview bundles alongside extension host with dual-target configuration (Node.js CJS + browser IIFE)
  2. Webviews enforce nonce-based Content Security Policy with no inline scripts or styles
  3. React error boundaries catch rendering errors gracefully without crashing the webview
  4. Typed message contracts exist for extension-webview communication (scaffold ready for use)
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — React build pipeline + error boundary (BUILD-01, BUILD-03) [2/2 tasks, 198s]
- [ ] 01-02-PLAN.md — CSP enforcement + typed message contracts (BUILD-02)

### Phase 2: Shared Component Library
**Goal**: Reusable React components exist matching existing visual design for composition in views
**Depends on**: Phase 1
**Requirements**: COMP-01, COMP-02, COMP-03
**Success Criteria** (what must be TRUE):
  1. All 20+ existing UI components (Button, ListItem, Container, Badge, BackLink, etc.) render identically to current HTML versions
  2. All components use VS Code CSS variables (var(--vscode-*)) and adapt to theme changes
  3. ExerciseDetail and ExamExerciseDetail can share components via React composition (no code duplication)
  4. Component props are fully typed with TypeScript interfaces
**Plans**: 4 plans

Plans:
- [ ] 02-01-PLAN.md — CSS Modules infrastructure + core atomic components (Button, IconButton, Badge, BackLink)
- [ ] 02-02-PLAN.md — Form components (TextInput, Dropdown) + layout components (Container, ListItem, List)
- [ ] 02-03-PLAN.md — Composite UI components (HelpPopup, SideMenu, AskIris, ServiceHealth)
- [ ] 02-04-PLAN.md — Shared exercise components (SubmissionStatus, ParticipationActions, BuildProgress) + barrel index (COMP-03)

### Phase 3: Simple Views Migration
**Goal**: 4 standalone views successfully migrated with validated state persistence and message passing patterns
**Depends on**: Phase 2
**Requirements**: VIEW-01, VIEW-02, VIEW-03, MSG-01, MSG-02, MSG-03
**Success Criteria** (what must be TRUE):
  1. LoginView, ServiceStatusView, GitCredentialsView, and RecommendedExtensionsView render through React components
  2. Views persist their state across tab hide/show cycles using getState/setState
  3. Webviews implement ready-signal handshake to prevent postMessage race conditions during hydration
  4. Message event listeners are cleaned up when webview is disposed (no memory leaks detectable)
**Plans**: TBD

Plans:
- TBD (will be created during planning)

### Phase 4: Main UI Views
**Goal**: Core application flow (Dashboard → CourseList → CourseDetail → ExerciseDetail) renders through React with real-time updates
**Depends on**: Phase 3
**Requirements**: VIEW-01 (continued), MSG-04
**Success Criteria** (what must be TRUE):
  1. Dashboard, CourseListView, CourseDetailView, ExerciseDetailView, and ExerciseStartedView all render through React
  2. Webview-side state is managed through Zustand stores with postMessage integration to extension host
  3. Real-time WebSocket updates (build status, submission results) trigger React re-renders without full webview reload
  4. ExerciseDetail components are extracted for reuse in ExamExerciseDetail (Phase 5)
**Plans**: TBD

Plans:
- TBD (will be created during planning)

### Phase 5: Exam Views with Timer Accuracy
**Goal**: Exam-related views render with accurate countdown timers that don't drift in background tabs
**Depends on**: Phase 4
**Requirements**: VIEW-01 (continued), CRIT-01
**Success Criteria** (what must be TRUE):
  1. ExamStartView, ExamConductionView, and ExamExerciseDetailView all render through React
  2. ExamExerciseDetail reuses ExerciseDetail components from Phase 4 via composition
  3. Exam countdown timers use Web Workers with absolute timestamps and remain accurate when tab is backgrounded
  4. Timer displays update smoothly without drift or throttling issues
**Plans**: TBD

Plans:
- TBD (will be created during planning)

### Phase 6: Iris Chat with Streaming
**Goal**: Chat webview renders with smooth message streaming optimized for token-by-token delivery
**Depends on**: Phase 5
**Requirements**: VIEW-01 (continued), CRIT-02
**Success Criteria** (what must be TRUE):
  1. IrisChatView renders through React with separate ChatWebviewProvider
  2. Message streaming uses React.memo and separated streaming state to prevent flicker during token delivery
  3. Chat sessions support context switching and message history without performance degradation
  4. Code highlights in messages render correctly with syntax highlighting
**Plans**: TBD

Plans:
- TBD (will be created during planning)

### Phase 7: Cleanup & Optimization
**Goal**: All legacy HTML generation code removed and production bundles optimized
**Depends on**: Phase 6
**Requirements**: CLEAN-01, CLEAN-02, CLEAN-03
**Success Criteria** (what must be TRUE):
  1. All legacy generateXxxHtml() functions and inline JS/CSS templates are deleted from codebase
  2. HTML-string-based ViewRouter is replaced with React conditional rendering
  3. Production builds use tree-shaking and minification with bundle size under target (verified with analyzer)
  4. Documentation reflects React architecture with updated developer guides
**Plans**: TBD

Plans:
- TBD (will be created during planning)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Build Pipeline | 2/2 | Complete | 2026-02-23 |
| 2. Shared Component Library | 0/TBD | Not started | - |
| 3. Simple Views Migration | 0/TBD | Not started | - |
| 4. Main UI Views | 0/TBD | Not started | - |
| 5. Exam Views with Timer Accuracy | 0/TBD | Not started | - |
| 6. Iris Chat with Streaming | 0/TBD | Not started | - |
| 7. Cleanup & Optimization | 0/TBD | Not started | - |
