# Phase 11: Bundle Optimization - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Reduce bundle size from 3.5MB via tree-shaking verification and bundle analysis tooling. Focus on eliminating dead code from existing dependencies — no library replacements. Analyze both extension host and webview bundles. Document IIFE code splitting constraint.

</domain>

<decisions>
## Implementation Decisions

### Size targets & tradeoffs
- Best-effort target of ~3MB (not a hard ceiling)
- Tree-shaking only — no dependency replacements or library swaps
- Build speed is not a concern — optimize freely
- Bundle size is report-only (no build failures on threshold)
- Minification enabled for production/package builds only, unminified for dev builds

### Shiki language bundling
- Bundle ALL 20 Artemis-enabled programming languages: Assembler, Bash, C, C++, C#, Dart, Go, Haskell, Java, JavaScript, Kotlin, MATLAB, OCaml, Python, R, Ruby, Rust, Swift, TypeScript, VHDL
- Plus SQL (for database queries)
- Plus 6 common markup/config languages: JSON, YAML, HTML, CSS, Markdown, XML
- Eager loading — all languages loaded at highlighter initialization
- Keep both Shiki themes (github-dark + github-light) for VS Code theme switching
- Acceptable if total bundle grows slightly due to added languages

### Lucide icon imports
- Add ESLint rule to prevent barrel imports from lucide-react
- Enforce named imports only (e.g., `import { Play } from 'lucide-react'`)
- Verify tree-shaking is working correctly for Lucide during analysis

### Dependency cleanup
- Verify @vscode/webview-ui-toolkit is fully removed (imports + package.json); clean up if remnants found
- Claude profiles all dependencies by size — no specific deps pre-targeted
- Standard esbuild tree-shaking only — no custom plugins or complex optimizations

### Bundle analysis tooling
- HTML treemap report via esbuild-visualizer (or equivalent)
- Separate `npm run analyze` command (not part of normal builds)
- Report files gitignored (generated artifacts, regenerate when needed)
- Normal builds always print total bundle size (KB/MB) to console

### Splitting & externals
- Accept IIFE constraint for webview bundle — no code splitting possible, document in PROJECT.md
- Analyze both extension host and webview bundles
- Mark `vscode` API and Node.js builtins as external in extension host bundle
- Document IIFE constraint as architectural decision in PROJECT.md with rationale

### Claude's Discretion
- Exact esbuild-visualizer integration approach
- Which Shiki language IDs map to which `.mjs` imports
- Metafile generation strategy
- Console size reporting format
- How to structure the `npm run analyze` script

</decisions>

<specifics>
## Specific Ideas

- Artemis programming languages sourced from `ProgrammingLanguage.java` enum in the Artemis server repo (ls1intum/Artemis) — ENABLED_LANGUAGES set is the authoritative list
- Current CodeBlock.tsx already uses `shiki/core` with `createHighlighterCore` and JS regex engine (CSP-safe, no WASM)
- Languages imported as `shiki/langs/{name}.mjs`, themes as `shiki/themes/{name}.mjs`

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-bundle-optimization*
*Context gathered: 2026-02-25*
