# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-23)

**Core value:** Students can interact with Artemis courses, exercises, and the Iris AI tutor without leaving VS Code.
**Current focus:** Phase 4 - Main UI Views

## Current Position

Phase: 4 of 7 (Main UI Views)
Plan: 5 of 5
Status: Complete
Last activity: 2026-02-24 — Completed plan 04-05 (CSS + Render Loop Gap Closure)

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 14
- Average duration: 5.0 minutes
- Total execution time: 1.18 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 2 | 6 min | 3 min |
| 02 | 3 | 14 min | 4.7 min |
| 03 | 4 | 17.8 min | 4.5 min |
| 04 | 5 | 32.4 min | 6.5 min |

**Recent Trend:**
- Last 5 plans: 04-02 (7.4 min), 04-03 (6 min), 04-04 (8 min), 04-05 (3 min)
- Trend: Improving (latest plan 3 min, well below phase average)

**Detailed Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| 01-01 | 3 min | - | - |
| 01-02 | 3 min | - | - |
| 02-01 | 5 min | 3 tasks | 13 files |
| 02-03 | 4 min | 2 tasks | 13 files |
| 02-04 | 5 min | 2 tasks | 8 files |
| Phase 03 P01 | 6 min | 2 tasks | 10 files |
| Phase 03 P02 | 3.5 min | 2 tasks | 8 files |
| Phase 03 P03 | 3.8 min | 2 tasks | 8 files |
| Phase 03 P04 | 4.5 | 2 tasks | 8 files |
| Phase 04 P01 | 8 min | 2 tasks | 31 files |
| Phase 04 P02 | 7.4 min | 2 tasks | 11 files |
| Phase 04 P03 | 6 min | 2 tasks | 10 files |
| Phase 04 P03 | 6 | 2 tasks | 10 files |
| Phase 04 P04 | 8 | 2 tasks | 22 files |
| Phase 04 P05 | 3 | 2 tasks | 5 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- React 18.3.1 chosen over React 19 (safer for webviews, includes deprecation warnings)
- esbuild for bundling (faster than webpack/Vite, simpler dual-target config)
- Zustand for state management (lightweight, works with postMessage)
- Incremental migration strategy (view-by-view, not big-bang)
- Same visual design (no redesign during migration)
- React 18 automatic JSX transform (react-jsx) eliminates manual React imports
- ErrorBoundary accepts vscodeApi as prop to avoid multiple acquireVsCodeApi calls
- IIFE bundle format for React webview (consistent with webview-components)
- NODE_ENV define for production/development (enables React optimizations)
- Nonce-based CSP without unsafe-inline (prevents XSS, standard VS Code pattern)
- Discriminated unions with 'type' discriminant (enables exhaustive switch checking)
- Runtime type guards using 'unknown' not 'any' (maintains strict typing discipline)
- Used clsx for conditional class composition instead of manual string concatenation
- Consolidated 7 icon button files into IconButton component with named presets
- Inline SVG icons in React components instead of dangerouslySetInnerHTML
- camelCase CSS class names in modules to avoid bracket notation in TypeScript
- Added .css loader to esbuild for global styles alongside CSS Modules plugin
- [Phase 02]: HelpPopup supports both controlled and uncontrolled state patterns
- [Phase 02]: ServiceHealth manages expandable state internally with useState
- [Phase 02]: TextInput uses password toggle with inline SVG eye icons (show/hide state managed internally)
- [Phase 02]: Dropdown uses native select element for accessibility (no hand-rolled dropdown)
- [Phase 02]: Container defers collapsible behavior to future iteration (keep stateless)
- [Phase 02]: ListItem is presentational-only, selected prop injected by parent List component
- [Phase 02]: List uses Children.map + cloneElement to inject selected and id props into children
- [Phase 02]: Exercise components use typed props (status, scores, test cases) rather than domain model imports for clean reuse
- [Phase 03]: Persist only durable state (form values) via setState, not transient status messages
- [Phase 03]: Bridge new typed message format to legacy command handlers for backward compatibility
- [Phase 03]: Router checks _reactViews map BEFORE switch statement to implement coexistence pattern
- [Phase 03]: Ready-signal handshake prevents race conditions (webview sends ready after hydration, extension queues messages)
- [Phase 03]: Minimal state persistence for ServiceStatus: only serverUrl persisted, health results transient
- [Phase 03]: ServiceHealth component from Phase 2 reused without modification in ServiceStatus view
- [Phase 03]: Client-side filtering only for RecommendedExtensions (no server request on category change)
- [Phase 03]: Extension cards composed from Phase 2 components (Badge, Button) rather than recreating exact legacy card layout
- [Phase 03]: Persist only selectedCategory state for RecommendedExtensions, not extension data (install status may change)
- [Phase 03]: Login persists all form values including password per user decision
- [Phase 03]: Simplified loading spinner replaces complex CSS animation (single @keyframes rule)
- [Phase 03]: LoginView handles both typed and legacy message formats for backward compatibility
- [Phase 04]: Zustand chosen for lightweight state management without Redux boilerplate
- [Phase 04]: Fixed skeleton count (5 items) for SkeletonList per research recommendation
- [Phase 04]: Dashboard data always re-fetched (no persisted state) per user decision
- [Phase 04]: Container header prop used instead of title prop for flexibility
- [Phase 04]: IconButton.Reload named method used instead of preset prop pattern
- [Phase 04]: Client-side filtering for CourseList (no server request on filter change)
- [Phase 04]: Persist CourseList filter state across tab cycles using getState/setState
- [Phase 04]: Dropdown and TextInput onChange receive value directly (string), not event object
- [Phase 04]: Exercise categories always expanded (no collapse UI) per user decision
- [Phase 04]: Workspace exercise highlighted with 'Open' badge using selected prop
- [Phase 04]: resendViewData() pattern for reload handlers to update React views without re-rendering
- [Phase 04]: Dashboard unified with other views to use ready signal for initial load (eliminates render loop)
- [Phase 04]: Reload handlers bypass actionHandler navigation methods to avoid render() calls

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-02-24 (plan execution)
Stopped at: Completed 04-05-PLAN.md - CSS + Render Loop Gap Closure
Resume file: None
