# Phase 1: Foundation & Build Pipeline - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish React build infrastructure for the webview migration. Delivers dual-target builds (Node.js CJS + browser IIFE), nonce-based CSP enforcement, React error boundaries, and typed message bridge scaffold. No views are migrated in this phase — this is pure infrastructure that all subsequent phases build on.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion

User deferred all decisions for this infrastructure phase. Claude has full flexibility on:

- **Build tooling configuration** — How dual-target builds are structured (esbuild config, entry points, output paths)
- **CSP implementation** — Nonce generation and injection approach for webview HTML, ensuring no inline scripts or styles
- **Error boundary design** — Fallback UI when React rendering fails (error message, retry mechanism, detail level)
- **Message bridge scaffold** — Type structure for extension-webview communication (discriminated unions, base types, handshake pattern)
- **Build coexistence** — How React bundles sit alongside existing HTML generation during the multi-phase transition
- **Project structure** — Where React source files, shared types, and build outputs live

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Key constraints from requirements:
- Must use nonce-based CSP (no inline scripts or styles)
- Dual-target: Node.js CJS for extension host, browser IIFE for webviews
- Error boundaries must catch errors gracefully without crashing the webview
- Message contracts use discriminated unions (replacing existing `any`-typed handlers)
- VS Code CSS variables (`var(--vscode-*)`) for theming (relevant for error boundary UI)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-build-pipeline*
*Context gathered: 2026-02-23*
