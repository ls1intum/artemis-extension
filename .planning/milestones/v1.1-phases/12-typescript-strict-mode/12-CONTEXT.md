# Phase 12: TypeScript Strict Mode - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Achieve 100% type safety with zero compilation errors and strict mode enabled across the entire codebase (extension host + webview). Resolve all pre-existing TypeScript errors, enable strict compiler flags, and enforce no-any ESLint rules. No new features — purely code quality and type safety enforcement.

</domain>

<decisions>
## Implementation Decisions

### Migration strategy
- Fix the 10 pre-existing TypeScript errors first, then enable strict flags
- Enable all strict flags at once (not incrementally per-flag)
- Apply strict flags to both tsconfig files (extension host + webview) simultaneously
- No `@ts-ignore` or `@ts-expect-error` suppression comments allowed — every error must be properly fixed

### any-type handling
- Prefer specific interfaces and union types when replacing `any` (not `unknown` as default)
- Single shared types file for message contracts between extension host and webview (single source of truth)
- Type assertions (`as SomeType`) allowed minimally — must include a comment explaining why a type guard isn't possible
- Claude's discretion on whether `any` is genuinely unavoidable at third-party boundaries (e.g., VS Code API callbacks)

### Enforcement rules
- Enable full `strict: true` umbrella (includes strictBindCallApply, strictPropertyInitialization, noImplicitThis, alwaysStrict, useUnknownInCatchVariables, plus the three listed)
- Do NOT enable `noUncheckedIndexedAccess` — skip this flag
- ESLint `@typescript-eslint/no-explicit-any` set to error from the start (not warn-then-flip)
- Enable full strict @typescript-eslint ruleset (no-unsafe-assignment, no-unsafe-return, no-unsafe-member-access, etc.)

### Error resolution
- If a type error reveals a genuine runtime bug, fix the bug (don't just fix the type)
- Refactor code where necessary to achieve proper types — no half-measures or minimal workarounds
- Add explicit return type annotations to all functions (not just where inference fails)
- Same strictness treatment for exported and internal functions — no tiered approach

### Claude's Discretion
- Determining where `any` is genuinely unavoidable at third-party library boundaries
- Choosing which specific @typescript-eslint strict rules to enable from the full ruleset
- Sequencing of error fixes within the pre-existing errors batch
- Deciding when a type assertion is justified vs when a type guard is the right approach

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-typescript-strict-mode*
*Context gathered: 2026-02-25*
