# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-23)

**Core value:** Students can interact with Artemis courses, exercises, and the Iris AI tutor without leaving VS Code.
**Current focus:** Phase 3 - Simple Views Migration

## Current Position

Phase: 3 of 7 (Simple Views Migration)
Plan: 2 of 4
Status: In Progress
Last activity: 2026-02-23 — Completed plan 03-01 (GitCredentials Migration)

Progress: [█████▒▒▒▒▒] 43%

## Performance Metrics

**Velocity:**
- Total plans completed: 6
- Average duration: 4.3 minutes
- Total execution time: 0.43 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 2 | 6 min | 3 min |
| 02 | 3 | 14 min | 4.7 min |
| 03 | 1 | 6 min | 6 min |

**Recent Trend:**
- Last 5 plans: 02-01 (5 min), 02-03 (4 min), 02-04 (5 min), 03-01 (6 min)
- Trend: Steady progress

**Detailed Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| 01-01 | 3 min | - | - |
| 01-02 | 3 min | - | - |
| 02-01 | 5 min | 3 tasks | 13 files |
| 02-03 | 4 min | 2 tasks | 13 files |
| 02-04 | 5 min | 2 tasks | 8 files |
| Phase 03 P01 | 6 | 2 tasks | 10 files |

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

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-02-23 (plan execution)
Stopped at: Completed 03-01-PLAN.md - GitCredentials Migration
Resume file: None
