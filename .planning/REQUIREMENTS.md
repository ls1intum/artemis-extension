# Requirements: Artemis VS Code Extension

**Defined:** 2026-02-23
**Core Value:** Students can interact with Artemis courses, exercises, and the Iris AI tutor without leaving VS Code.

## v1 Requirements

Requirements for v1.0 React Webview Migration. Each maps to roadmap phases.

### Build Infrastructure

- [x] **BUILD-01**: Extension builds React webview bundles alongside extension host with dual-target configuration (Node.js CJS + browser IIFE)
- [x] **BUILD-02**: Webviews enforce nonce-based Content Security Policy with no inline scripts or styles
- [x] **BUILD-03**: React error boundaries wrap all view components to catch rendering errors gracefully

### Messaging & State Management

- [x] **MSG-01**: Extension host and webviews communicate through typed message contracts with discriminated unions (replacing `any`-typed handlers)
- [x] **MSG-02**: Webview UI state persists across tab hide/show cycles via getState/setState
- [x] **MSG-03**: All message event listeners are cleaned up when webview is disposed (no memory leaks)
- [x] **MSG-04**: Webview-side state is managed through Zustand stores with postMessage integration to extension host

### Component Library

- [x] **COMP-01**: All 20+ existing UI components (Button, ListItem, Container, Badge, BackLink, etc.) are ported to React with identical visual design
- [x] **COMP-02**: All components use VS Code CSS variables (`var(--vscode-*)`) for theme compliance
- [x] **COMP-03**: ExerciseDetail and ExamExerciseDetail share components via React composition (formalizing existing ~70% code reuse)

### View Migration

- [x] **VIEW-01**: All 14+ webview screens render through React components instead of HTML string generation
- [x] **VIEW-02**: Views are migrated incrementally (simple → complex) with old and new coexisting during transition
- [x] **VIEW-03**: Webviews implement ready-signal handshake to prevent postMessage race conditions during hydration

### Critical Views

- [ ] **CRIT-01**: Exam countdown timers use Web Workers with absolute timestamps (no drift from background tab throttling)
- [ ] **CRIT-02**: Iris chat message streaming uses React.memo and separated streaming state (no flicker during token delivery)

### Cleanup

- [ ] **CLEAN-01**: All legacy `generateXxxHtml()` functions and inline JS/CSS templates are removed
- [ ] **CLEAN-02**: HTML-string-based ViewRouter is replaced with React conditional rendering
- [ ] **CLEAN-03**: Production builds use tree-shaking and minification with verified bundle size

## Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Developer Experience

- **DX-01**: Hot module replacement for webview development (instant feedback without manual reload)
- **DX-02**: VS Code Messenger integration for RPC-like typed protocols with devtools

### Architecture

- **ARCH-01**: Stateless webview pattern (full refactor of state ownership to extension host)
- **ARCH-02**: Advanced streaming optimizations (virtualized message list for large chat histories)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Visual redesign | Migration preserves existing look and feel, not a redesign |
| Test migration | View tests will be updated in a follow-up milestone |
| New features | No new user-facing capabilities, pure infrastructure migration |
| Backend changes | Extension host services (auth, API, WebSocket, telemetry) stay as-is |
| React Router | Webviews aren't SPAs; extension controls view state via messages |
| Redux/MobX | Overkill for webview state; Zustand + Context sufficient |
| CSS-in-JS libraries | No benefit over VS Code CSS variables, adds bundle bloat |
| retainContextWhenHidden | High memory overhead; getState/setState preferred |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BUILD-01 | Phase 1 | Complete |
| BUILD-02 | Phase 1 | Complete |
| BUILD-03 | Phase 1 | Complete |
| MSG-01 | Phase 3 | Complete |
| MSG-02 | Phase 3 | Complete |
| MSG-03 | Phase 3 | Complete |
| MSG-04 | Phase 4 | Complete |
| COMP-01 | Phase 2 | Complete |
| COMP-02 | Phase 2 | Complete |
| COMP-03 | Phase 2 | Complete |
| VIEW-01 | Phases 3-6 | Complete |
| VIEW-02 | Phase 3 | Complete |
| VIEW-03 | Phase 3 | Complete |
| CRIT-01 | Phase 5 | Pending |
| CRIT-02 | Phase 6 | Pending |
| CLEAN-01 | Phase 7 | Pending |
| CLEAN-02 | Phase 7 | Pending |
| CLEAN-03 | Phase 7 | Pending |

**Coverage:**
- v1 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0

---
*Requirements defined: 2026-02-23*
*Last updated: 2026-02-23 after roadmap creation*
