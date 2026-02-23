# Phase 3: Simple Views Migration - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate 4 standalone views (LoginView, ServiceStatusView, GitCredentialsView, RecommendedExtensionsView) from HTML string generation to React components. Establish typed messaging, state persistence, and ready-signal handshake patterns that all future phases will reuse. No new features — pure infrastructure migration with optional visual polish.

</domain>

<decisions>
## Implementation Decisions

### Migration order
- GitCredentials first — simple form with messaging, establishes the core pattern
- ServiceStatus second — mostly static, validates component composition
- RecommendedExtensions third — adds client-side filtering, validates UI state persistence
- Login last — most complex (multi-state, loading, embedded health checks), benefits from patterns established by earlier views
- One plan per view, each delivering end-to-end: React component + provider hookup + message contracts + state persistence
- Each plan is independently verifiable

### Coexistence strategy
- Always use React version if available — no feature flags or toggles
- Router checks if a React component exists for the requested view; if yes, render React; if no, fall back to HTML generation
- Rollback via git revert — old HTML code stays in codebase untouched until Phase 7
- No deprecation markers or modifications to legacy HTML generation code
- Old code untouched until Phase 7 cleanup

### State persistence
- Persist form inputs + UI state across tab hide/show (getState/setState)
- Login: persist all form values including username and password
- RecommendedExtensions: persist active category filter selection
- GitCredentials: persist name and email form values
- Transient status/feedback messages (e.g., "Git identity saved") clear on tab hide — they're stale by the time user returns
- ServiceStatus: minimal persistence needed (mostly static display)

### Visual fidelity
- Match existing layout and structure, allow minor polish (spacing, alignment fixes)
- Use Phase 2 shared components exclusively — no view-specific CSS modules
- Simplify animations — replace complex CSS animations (loading dots) with simpler alternatives (spinner)
- RecommendedExtensions cards composed from Phase 2 components (ListItem, Badge, Button) rather than recreating exact current card layout

### Claude's Discretion
- Exact message contract type structure (discriminated unions design)
- Ready-signal handshake implementation details
- How the router detects React component availability
- Error boundary placement within views
- Exact state serialization format for getState/setState

</decisions>

<specifics>
## Specific Ideas

- GitCredentials sets the pattern because it has the right balance: form inputs, messaging (save/load), and status feedback without being overwhelming
- Login view is last specifically because its complexity (dual states, loading transitions, embedded ServiceHealthComponent) will be easier once patterns are battle-tested
- Animation simplification preference — user prefers cleaner, simpler feedback over preserving exact CSS animations

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-simple-views-migration*
*Context gathered: 2026-02-23*
