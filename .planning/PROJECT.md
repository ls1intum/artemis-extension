# Artemis VS Code Extension

## What This Is

A VS Code extension that integrates with the Artemis learning platform, providing students with course browsing, exercise management, code submission, real-time build feedback, AI tutoring (Iris chat), and exam support — all within their editor. Uses React components with Zustand state management for all webview UI.

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

### Active

## Current Milestone: v1.1 Production Ready

**Goal:** Make the extension 100% production-ready with full type safety, UI polish, comprehensive testing, dependency cleanup, and architecture improvements.

**Target features:**
- UI Polish & Icons — Lucide icons throughout, Dashboard grid layout, visual consistency
- Bug Fixes & Tech Debt — Fix all TypeScript errors, reduce bundle size, restore fullscreen panel
- Testing & Quality — Expand UI tests, add React component tests, improve coverage
- Dependency Cleanup — Remove unused deps, consolidate icon system on Lucide, optimize build
- Architecture & Type Safety — 100% type-safe codebase, no `any` types, strict mode compliance

### Out of Scope

- Visual redesign — Migration preserved existing look and feel, not a redesign
- Hot module replacement — DX improvement deferred (DX-01)
- VS Code Messenger RPC — Protocol upgrade deferred (DX-02)
- Stateless webview pattern — Full state refactor deferred (ARCH-01)
- Virtualized message list — Large chat history optimization deferred (ARCH-02)
- Backend changes — Extension host services (auth, API, WebSocket, telemetry) stay as-is

## Context

- **Codebase:** 39,841 LOC TypeScript/TSX, 12 React views, 22 shared components, 9 Zustand stores
- **Architecture:** React 18 webviews with CSS Modules, esbuild dual-target build, typed message contracts
- **Build artifacts:** extension.js (665KB CJS), webview-react.js (3.5MB IIFE), webview-react.css (~74KB)
- **Known issues:** 10 pre-existing TypeScript errors, 3.5MB bundle size (code splitting candidate), fullscreen panel temporarily disabled
- **Tech stack:** React 18.3.1, Zustand, esbuild, CSS Modules, Shiki, Streamdown, Web Workers

## Constraints

- **Functionality parity**: Every existing view works identically after migration
- **Exam timing**: Countdown timers use Web Workers with absolute timestamps (drift-free)
- **Chat streaming**: RAF-based token buffering with React.memo (no flicker)
- **VS Code API**: Nonce-based CSP, postMessage bridge, getState/setState persistence
- **No backend changes**: Extension host services remain unchanged

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
| Tests separate milestone | Keep v1.0 focused; test updates in v1.1 | ⚠️ Revisit |
| IIFE bundle format | Single file, consistent with webview constraints | ⚠️ Revisit (3.5MB) |

## Architecture Decisions

**Source:** Phase 8 Architecture Review (2026-02-25)
**Reference:** .planning/phases/08-architecture-review/08-AUDIT.md

This section documents current architectural patterns discovered during the Phase 8 audit, including decisions that should be preserved and those that should be revisited.

### Decisions to Preserve (Do NOT Refactor in v1.1)

#### Dual State Management (AppStateManager + Zustand)

**Pattern:** Extension host uses `AppStateManager` (class-based, 13 states, API data caching). React webview uses 9 Zustand stores (feature-scoped, UI state). Data flows one-way: API → AppStateManager → postMessage → Zustand → React.

**Rationale:** v1.0 React migration preserved extension host architecture to reduce scope and risk. Migration to single state system would require rewriting extension host services.

**Files:** `src/views/app/appStateManager.ts`, `src/views/webview/react/stores/*.ts`

**Status:** Intentional technical debt. Works correctly for one-way data flow. **Do NOT attempt** migration before Phase 13 (comprehensive testing in place).

---

#### View-Scoped Zustand Stores (9 separate stores)

**Pattern:** Each view has its own store (Dashboard, CourseList, CourseDetail, ExerciseDetail, + 4 exam views, + Chat, + Navigation). Each store owns loading/error state independently.

**Rationale:** Clear separation of concerns, no cross-store dependencies, easier to reason about. Matches React component hierarchy. Repetitive loading/error patterns are INTENTIONAL.

**Files:** `src/views/webview/react/stores/*.ts`

**Status:** Working as designed. Consolidation would create god-store anti-pattern. Acceptable enhancement: Extract global UI state (toasts, global errors) into separate `useUIStore`.

---

#### IIFE Bundle Format (webview-react.js)

**Pattern:** Webview bundle uses IIFE (Immediately Invoked Function Expression) format, not ESM.

**Rationale:** VS Code webviews require single-file bundles. ESM code splitting is NOT supported in VS Code webviews (VS Code Issue #93041). Tree-shaking DOES work with IIFE.

**Files:** `esbuild.js` — webview bundle config: `format: 'iife'`

**Status:** Platform constraint, not a choice. Current 3.5MB bundle is large but acceptable (~500ms load). Phase 11 will optimize via tree-shaking. Code splitting deferred to v1.2+ pending VS Code platform support.

---

#### Web Worker Exam Timers

**Pattern:** Exam timers run in Web Workers with absolute timestamps, not main thread `setTimeout`.

**Rationale:** Main thread timers are throttled in background tabs (up to 1s intervals). Web Workers run at full speed, preventing drift. Matches Artemis webapp behavior.

**Files:** `src/views/webview/react/workers/examTimer.worker.ts`, `src/views/webview/react/components/ExamTimer/ExamTimer.tsx`

**Status:** Exemplary implementation. **Do NOT change** without thorough testing (accuracy is critical for exams).

---

#### postMessage Bridge (not VS Code Messenger)

**Pattern:** Extension ↔ webview communication uses raw `postMessage` with plain object messages.

**Rationale:** VS Code Messenger adds complexity and bundle size. postMessage is VS Code standard, well-documented. Message contracts can be typed via discriminated unions (Phase 12).

**Files:** `src/views/app/webViewMessageHandler.ts`, `src/provider/artemisWebviewProvider.ts`

**Status:** Working as designed. Type safety gap will be addressed in Phase 12 (TYPE-03). VS Code Messenger upgrade deferred to v1.2+ (DX-02).

---

### Decisions to Revisit

#### Message Contract Type Safety

**Current:** All postMessage payloads typed as `any`. No compile-time checks for message structure.

**Issue:** Runtime errors possible if message shape changes. Adding new message types is error-prone.

**Plan:** Phase 12 (TYPE-03) will migrate to TypeScript discriminated unions with exhaustive checking. Create `src/shared/messageContracts.ts` with typed message contracts.

**Status:** Flagged for v1.1 remediation (HIGH impact, MEDIUM effort).

---

#### WebSocket Error Propagation

**Current:** WebSocket/STOMP errors logged but NOT sent to webview UI. Users see "loading..." forever if connection fails.

**Issue:** Poor UX, no error feedback for connection failures.

**Plan:** Phase 13 will add error propagation: `postMessage({ type: 'websocketError', payload: {...} })` when WebSocket errors occur. Add `websocketError` state to Zustand stores for UI display.

**Status:** Flagged for v1.1 remediation (HIGH impact, LOW effort — Quick Win).

---

#### State Persistence (getState/setState)

**Current:** Webview does NOT use `vscode.getState()` / `vscode.setState()`. Transient UI state lost on panel hide/show.

**Issue:** Navigation breadcrumbs, scroll position, form drafts lost if VS Code destroys webview content.

**Plan:** v1.2 deferred. Add debounced `setState()` to Zustand stores for transient UI state. Document as known limitation for v1.1.

**Status:** Known limitation (MEDIUM impact, MEDIUM effort).

---

#### Circular Dependencies

**Current:** 2 circular imports via `ProviderRegistry` (low impact but confusing).

**Issue:** Harder to understand module graph, may confuse bundlers.

**Plan:** Phase 13 will extract interfaces (`IArtemisWebviewProvider`, `IChatWebviewProvider`) to break cycles. Alternative: Import services directly instead of via barrel file.

**Status:** Flagged for v1.1 remediation (LOW impact, LOW effort — Quick Win).

---

### Data Caching Policy

**Current:** Inconsistent caching behavior:
- Exercise detail: ALWAYS refetch (ensures latest submission status)
- Course detail: Use cached data (performance)
- Dashboard: Use cached data (performance)

**Rationale:** Exercise/exam data changes frequently (submissions, results) → always fresh. Course data changes rarely → can be cached. Users can manually refresh via reload commands.

**Files:** `src/views/app/appStateManager.ts` (see comments for detailed policy)

**Status:** Working as designed. Policy documented in code comments (Finding 8 remediation).

---

### Tech Stack Rationale

| Choice | Why | Alternatives Considered |
|--------|-----|-------------------------|
| React 18.3.1 | Stable, battle-tested in VS Code webviews, includes React 19 migration warnings | React 19 (too new, breaking changes) |
| Zustand | Lightweight (~2KB), no Provider boilerplate, DevTools support, easy testing | Redux (complex), Context API (verbose) |
| CSS Modules | No runtime cost, VS Code CSS variables support, TypeScript typing | Styled Components/Emotion (bundle bloat, runtime overhead) |
| esbuild | 10-100x faster than webpack, dual-target support, tree-shaking built-in | webpack (slow), Vite (ESM-only) |
| Shiki | VS Code themes, accurate highlighting, lazy load | Highlight.js (heavy), Prism (manual language loading) |
| RAF token buffering | Sentence-level updates (smooth UX), prevents React re-render thrashing | Per-token setState (flicker, poor performance) |

---

*Architecture Decisions documented: 2026-02-25 (Phase 8 Architecture Review)*
*Last updated: 2026-02-25*
