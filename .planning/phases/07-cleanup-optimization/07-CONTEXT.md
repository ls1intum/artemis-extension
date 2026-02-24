# Phase 7: Cleanup & Optimization - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Remove all legacy HTML-generation code, replace the HTML-string-based ViewRouter with React conditional rendering, optimize production bundles, and create comprehensive developer documentation. All views have been migrated to React in Phases 1–6; this phase strips the old code and polishes the final architecture.

</domain>

<decisions>
## Implementation Decisions

### Legacy Code Removal
- Clean sweep — delete all `generateXxxHtml()` functions and inline JS/CSS templates at once
- Remove the coexistence router entirely (it was a migration tool)
- Remove all `useReact` feature flags and migration toggles
- Remove all migration scaffolding: coexistence helpers, legacy adapters, HTML string builders
- Remove legacy CSS/styles that were only used by HTML-string views
- Audit and remove legacy-only npm dependencies
- Remove all TODO/FIXME comments that reference migration or legacy code
- Remove coexistence router state from extension host
- No exclusions — everything legacy is fair game
- No publishing concerns — cleanup is internal

### File Organization
- Reorganize directory structure to reflect React-only architecture (Claude proposes layout during planning)
- Update all import paths to match new structure (no path aliases)
- Consolidate shared extension-webview types (Claude recommends location based on current structure)
- Clean up build output directory to a predictable layout (dist/extension/, dist/webview/, etc.)

### Dead Code Detection
- Use automated tooling (knip or ts-prune) via npx — one-time run, not added as devDependency
- Manual follow-up to verify and remove detected dead code

### Testing
- Convert or remove legacy test files that test old HTML-string views
- Aim for full React test coverage — not just parity with legacy
- Both snapshot tests and behavioral/interaction tests for all React views
- Testing framework: Claude's discretion based on existing project setup

### Commit Strategy
- Atomic commits per logical area removed (per view, per utility group)
- Easy to revert individual removals if needed

### ViewRouter Replacement
- Simple postMessage-based view-type switching (extension tells webview which view to show)
- No lazy loading — eager loading for all view components
- No URL-based or hash-based routing within webviews

### Error Handling
- One consistent ErrorBoundary component used by all views
- Error fallback shows what went wrong + retry button to reload the view
- Webview errors reported back to extension host via postMessage for logging
- Standardized toast/banner pattern for async errors (failed API calls, message timeouts) across all views

### State Management
- Full audit and consolidation of Zustand stores — merge overlapping stores
- Enforce consistent naming and structure conventions (useXxxStore, standard action patterns)
- Keep per-store persistence logic (no shared middleware)
- Add Zustand DevTools middleware in development builds
- Remove any leftover state from the old coexistence router

### Bundle Optimization
- Baseline current bundle size, then optimize (no fixed budget number)
- Single bundle per entry point — no code splitting
- Permanent `npm run analyze` script using bundle analyzer
- No CI bundle size enforcement
- Source maps included in production builds

### Build Pipeline
- Proper dev/prod build differentiation (React DevTools + warnings in dev, stripped in prod)
- Strict build-time validation: fail on type errors and unused exports
- Pre-commit hooks using husky/lint-staged: ESLint + TypeScript check (no Prettier)
- Optimized .vsixignore to exclude dev files, docs, tests from published extension
- Coordinated watch mode: single `npm run dev` watches both extension host and webview
- Optimized dev builds for faster iteration
- Build config: Claude evaluates current layout and consolidates/removes old configs as needed

### Documentation
- Comprehensive developer guide in English
- Conventions list (not step-by-step tutorial) for how to add new views
- Mermaid diagrams in separate files (docs/diagrams/), linked from the guide
- Document extension-webview message contracts (types, patterns, how to add new messages)
- Document store architecture (which stores exist, what they manage, interactions)
- No CONTRIBUTING.md, no CSP documentation
- Documentation location: Claude's discretion based on project structure

### Claude's Discretion
- ViewRouter architecture pattern (centralized switch vs route registry)
- Entry point strategy (separate per panel vs single with internal routing)
- Shared type location (src/shared/ folder vs separate package)
- Verification approach for legacy removal
- Exact directory structure proposal for file reorganization
- Build config consolidation strategy
- Testing framework choice
- Documentation file location

</decisions>

<specifics>
## Specific Ideas

- Error fallback should show actual error details + retry — not just a vague "something went wrong"
- Zustand DevTools enabled in dev for debugging stores
- Coordinated watch: one command to rule both build targets
- Bundle analyzer as permanent npm script for ongoing visibility
- Pre-commit hooks catch issues before they enter the codebase (ESLint + tsc only, no Prettier)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-cleanup-optimization*
*Context gathered: 2026-02-24*
