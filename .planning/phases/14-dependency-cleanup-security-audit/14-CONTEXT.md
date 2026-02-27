# Phase 14: Dependency Cleanup & Security Audit - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Remove unused dependencies, correct misplaced deps, verify CSP security posture, and validate production builds. Scope includes npm audit for known vulnerabilities. Does NOT include version bumps, feature additions, or architecture changes.

</domain>

<decisions>
## Implementation Decisions

### Dependency Removal Strategy
- Aggressive removal with manual review of each flagged dep before deletion
- Use knip for dead-dependency analysis (proven in this codebase from v1.0 Phase 7)
- Re-derive production whitelist from actual import analysis — roadmap list (dompurify, lucide-react, react, zustand, shiki, streamdown) is a starting point, not definitive
- Flag deps that could be replaced with lighter alternatives but do NOT replace in this phase — document for future consideration
- Systematic audit of dep placement (dependencies vs devDependencies) — not just clsx, check all
- Regenerate lock file after removals to ensure clean dependency tree
- Include npm audit — address high/critical vulnerabilities found
- No standalone audit report needed — git diff of package.json changes is sufficient

### Clean Environment Testing
- Use `code --profile-temp` for clean VS Code profile testing (no Docker)
- Full feature matrix smoke test: every view, every interaction, error states, themes
- Semi-automated approach: script handles .vsix install + VS Code launch with temp profile; human verifies features visually
- `vsce package` must complete with zero warnings
- Theme testing (light/dark): Claude's discretion based on CSS theme-dependency analysis

### CSP Nonce Hardening
- Full CSP audit of all directives (script-src, style-src, img-src, font-src, connect-src)
- Tighten overly permissive directives (e.g., unsafe-inline) if changes don't break functionality — test after each change
- Audit for inline event handlers (onclick, onerror, etc.) in HTML templates and React output
- Audit localResourceRoots to ensure only necessary directories are allowed
- Verify nonce entropy: minimum 16 bytes (128 bits) from crypto.randomBytes
- Verify nonce is regenerated per webview load, not cached
- Audit nonce flow: confirm nonce is not logged, not sent via postMessage, not stored in webview state
- Add inline code comment above CSP construction explaining each directive
- Add grep-based test that fails if unsafe-inline or unsafe-eval appears without nonce

### Bundle Size Governance
- Track total .vsix size in CI output but do NOT enforce as a build-failing threshold
- Total .vsix size only — no per-chunk tracking
- Text-based size report via esbuild metafile (no visual treemap)
- Update baseline if cleanup reduces size significantly below 3.44 MB

### Claude's Discretion
- Theme testing scope (both themes vs dark-only) based on CSS analysis
- Exact knip configuration for this codebase
- Which npm audit findings warrant immediate fixes vs deferred
- Specific CSP directive values for each resource type
- Exact bundle size threshold for baseline update (what constitutes "significant" reduction)

</decisions>

<specifics>
## Specific Ideas

- knip was already used in v1.0 Phase 7 for this codebase — reuse/update that configuration
- Semi-automated testing: a shell script that runs `vsce package`, installs the .vsix in a temp profile, and launches VS Code is preferred over fully manual steps
- CSP regression guard should be a simple grep-based test, not an elaborate security framework

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 14-dependency-cleanup-security-audit*
*Context gathered: 2026-02-27*
