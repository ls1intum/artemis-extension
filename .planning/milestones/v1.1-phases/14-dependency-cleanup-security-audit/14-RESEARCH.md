# Phase 14: Dependency Cleanup & Security Audit - Research

**Researched:** 2026-02-27
**Domain:** npm dependency hygiene, VS Code webview CSP, production extension packaging, bundle governance
**Confidence:** HIGH

## Summary

Phase 14 closes out v1.1 Production Ready by auditing the dependency graph of `iris-thaumantias`, hardening the Content Security Policy, and validating the production `.vsix` in a clean environment. The codebase is well-understood after 13 prior phases, so this phase is primarily a cleanup and verification exercise with no architectural changes allowed.

The most significant finding is that `getNonce()` in `src/utils/webviewHelpers.ts` uses `Math.random()` — not `crypto.randomBytes` — which is a direct conflict with the phase success criterion. This is a real security gap, not a theoretical one. All CSP directives in `getReactWebviewHtml` are otherwise well-formed (no `unsafe-inline`, no `unsafe-eval`), but the nonce is cryptographically weak. There is also a dead private method `openFullscreenPanel` with an inline `<style>` injection pattern that bypasses the CSP entirely — knip should surface this as unused code, and it can be deleted.

On the dependency side: `clsx` is in `devDependencies` but is used in 24 production React component files. `@types/katex` is in `dependencies` but should be in `devDependencies`. The production whitelist from CONTEXT.md (dompurify, lucide-react, react, zustand, shiki, streamdown) needs re-derivation from actual import analysis because `react-dom`, `react-textarea-autosize`, `use-stick-to-bottom`, `@stomp/stompjs`, `ws`, and `katex` are all confirmed used in production source. The existing npm audit identifies 1 high-severity vulnerability (minimatch ReDoS) and 4 low/moderate vulnerabilities, all in devDependencies transitive chains — no production dependency vulnerabilities.

**Primary recommendation:** Use `npx knip@5` with a minimal config file for the VS Code extension context (knip's default VS Code plugin needs workspace-entry, not npm-package-entry). Fix `getNonce()` to use `crypto.randomBytes`. Move `clsx` to `dependencies`, move `@types/katex` to `devDependencies`. Delete dead `openFullscreenPanel` method. The production .vsix testing approach is `code --transient` (not `--profile-temp` — VS Code 1.109.x calls the flag `--transient`).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Dependency Removal Strategy:**
- Aggressive removal with manual review of each flagged dep before deletion
- Use knip for dead-dependency analysis (proven in this codebase from v1.0 Phase 7)
- Re-derive production whitelist from actual import analysis — roadmap list (dompurify, lucide-react, react, zustand, shiki, streamdown) is a starting point, not definitive
- Flag deps that could be replaced with lighter alternatives but do NOT replace in this phase — document for future consideration
- Systematic audit of dep placement (dependencies vs devDependencies) — not just clsx, check all
- Regenerate lock file after removals to ensure clean dependency tree
- Include npm audit — address high/critical vulnerabilities found
- No standalone audit report needed — git diff of package.json changes is sufficient

**Clean Environment Testing:**
- Use `code --profile-temp` for clean VS Code profile testing (no Docker)
- Full feature matrix smoke test: every view, every interaction, error states, themes
- Semi-automated approach: script handles .vsix install + VS Code launch with temp profile; human verifies features visually
- `vsce package` must complete with zero warnings
- Theme testing (light/dark): Claude's discretion based on CSS theme-dependency analysis

**CSP Nonce Hardening:**
- Full CSP audit of all directives (script-src, style-src, img-src, font-src, connect-src)
- Tighten overly permissive directives (e.g., unsafe-inline) if changes don't break functionality — test after each change
- Audit for inline event handlers (onclick, onerror, etc.) in HTML templates and React output
- Audit localResourceRoots to ensure only necessary directories are allowed
- Verify nonce entropy: minimum 16 bytes (128 bits) from crypto.randomBytes
- Verify nonce is regenerated per webview load, not cached
- Audit nonce flow: confirm nonce is not logged, not sent via postMessage, not stored in webview state
- Add inline code comment above CSP construction explaining each directive
- Add grep-based test that fails if unsafe-inline or unsafe-eval appears without nonce

**Bundle Size Governance:**
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

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CLEAN-01 | Unused dependencies removed, misplaced deps corrected (e.g. clsx), production .vsix verified in clean environment | knip 5.85.0 confirmed available; import analysis shows clsx in devDependencies but used in 24 production files; @types/katex in dependencies but should be devDependencies; clean-environment test uses `code --transient` flag (VS Code 1.109.x); `vsce` 3.7.1 installed at PATH |
| CLEAN-02 | CSP nonce implementation verified (crypto.randomBytes usage), no inline scripts or styles without nonce | `getNonce()` in `src/utils/webviewHelpers.ts` uses `Math.random()` not `crypto.randomBytes` — confirmed vulnerability; dead `openFullscreenPanel` method injects `<style>` without nonce but is never called (dead code); CSP header in `getReactWebviewHtml` has no `unsafe-inline` or `unsafe-eval` in production path; `localResourceRoots` inconsistency found: sidebar uses `this._extensionUri` (full tree) while fullscreen panels use `dist/` subdirectory only |
</phase_requirements>

---

## Standard Stack

### Core Tools

| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| knip | 5.85.0 (npx) | Dead dependency and unused export detection | Used in v1.0 Phase 7 for this codebase; already familiar with project structure |
| npm audit | Built-in | Vulnerability scanning | Standard npm built-in; produces machine-readable JSON |
| vsce | 3.7.1 (installed at PATH) | Package `.vsix` and validate packaging warnings | Already installed; used in `npm run package:vsix` |
| Node.js `crypto` module | Built-in (Node 22.x) | Cryptographically secure nonce generation | Built-in, no dependency needed; `crypto.randomBytes()` is CSPRNG |

### Supporting Tools

| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| esbuild metafile | Built-in (esbuild 0.27.2) | Text-based bundle size report | Already generated at `dist/meta-webview.json`; use `esbuild.analyzeMetafile()` for text output |
| `code --transient` | VS Code 1.109.x CLI | Clean-environment testing | The actual flag name in VS Code 1.109.x (CONTEXT.md says `--profile-temp` — the correct current flag is `--transient`) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| knip | depcheck | knip understands TypeScript, VS Code extension entry points, and dev vs prod dependency usage; depcheck is simpler but less accurate |
| `crypto.randomBytes` | `crypto.getRandomValues` (Web Crypto) | `getRandomValues` is the browser API; extension host runs in Node.js where `crypto.randomBytes` is the correct API |
| Manual dep audit | `npm-check` | npm-check adds a dependency; manual + knip is sufficient for a one-time audit |

---

## Architecture Patterns

### Pattern 1: Cryptographically Secure Nonce Generation

**What:** Replace `Math.random()` with `crypto.randomBytes(16)` for nonce generation.

**Current (insecure):**
```typescript
// src/utils/webviewHelpers.ts — CURRENT (uses Math.random)
export function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
```

**Fixed (crypto.randomBytes — 16 bytes = 128 bits entropy):**
```typescript
import * as crypto from 'crypto';

// Returns 32 hex characters = 16 bytes = 128 bits entropy (CSP spec requires >=128 bits)
export function getNonce(): string {
    return crypto.randomBytes(16).toString('hex');
}
```

**When to use:** Every webview load. The nonce must be unique per HTML response — never cached or stored.

**Source:** VS Code official docs (webview security), Node.js crypto docs. The CSP spec (W3C) requires nonces be at least 128 bits from a cryptographically secure source.

### Pattern 2: Knip Configuration for VS Code Extension

**What:** Knip needs a config file to understand the VS Code extension entry pattern (extension host + webview bundle entry points are not auto-detected).

**knip.json at `iris-thaumantias/knip.json`:**
```json
{
  "entry": [
    "src/extension.ts",
    "src/views/webview/react/index.tsx"
  ],
  "project": [
    "src/**/*.{ts,tsx}"
  ],
  "ignoreDependencies": [
    "vscode"
  ],
  "ignore": [
    "test/**"
  ]
}
```

**Notes:**
- `"vscode"` must be in `ignoreDependencies` — it's an implicit peer dep not listed in package.json
- Test files should be ignored for production dep analysis
- Without this config, knip uses the npm package entry point and produces inaccurate results for VS Code extensions

**When to use:** One-time analysis run as `npx knip` from the `iris-thaumantias/` directory.

### Pattern 3: CSP Directive Audit Approach

**Current CSP in `getReactWebviewHtml`:**
```
default-src 'none';
img-src ${webview.cspSource} https:;
font-src ${webview.cspSource};
style-src ${webview.cspSource} 'nonce-${nonce}';
script-src 'nonce-${nonce}';
```

**Analysis:**
- `default-src 'none'` — correct, deny-all default
- `script-src 'nonce-${nonce}'` — correct, nonce-only (after fix, will be cryptographically secure)
- `style-src ${webview.cspSource} 'nonce-${nonce}'` — correct, allows webview-origin CSS + nonce inline styles
- `img-src ${webview.cspSource} https:` — allows HTTPS images; reasonable for Artemis problem statements that embed external images. Acceptable as-is.
- `font-src ${webview.cspSource}` — correct, fonts served from dist/
- Missing `connect-src` — no XHR/fetch from webview (all communication via postMessage); `default-src 'none'` covers this implicitly

**Tightening opportunities:**
- `img-src https:` is broad but intentional — Artemis problem statements contain external images from arbitrary HTTPS sources. Changing to specific domains would break problem statement rendering. Document as intentional.
- No `unsafe-inline`, no `unsafe-eval` — already tight.

### Pattern 4: localResourceRoots Inconsistency Fix

**What:** Three webview creation sites in `artemisWebviewProvider.ts` have different `localResourceRoots` values.

**Current state:**
```typescript
// Line 421 — sidebar webview (resolveWebviewView):
localResourceRoots: [this._extensionUri]  // Full extension tree

// Line 879 — openExerciseFullscreen:
localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'dist')]  // dist/ only

// Line 931 — openCourseFullscreen:
localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'dist')]  // dist/ only

// Line 1105 — dead openFullscreenPanel (never called):
localResourceRoots: [this._extensionUri]  // Full extension tree (dead code)
```

**Recommended standardization:** All webviews that use `getReactWebviewHtml` only need `dist/` resources. Use `vscode.Uri.joinPath(this._extensionUri, 'dist')` everywhere for least-privilege.

```typescript
localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'dist')]
```

**Exception:** The `chatWebviewProvider.ts` (line 196) uses `[this._extensionUri]` — this should also be narrowed to `dist/` unless it serves resources from other directories (needs verification).

### Pattern 5: Clean Environment Testing

**What:** Semi-automated script to install .vsix in a clean VS Code instance and launch for visual verification.

**Correct flag for VS Code 1.109.x:**
```bash
# CONTEXT.md says --profile-temp but the actual VS Code 1.109.x flag is --transient
code --transient --install-extension ./iris-thaumantias-*.vsix
code --transient
```

**The `--transient` flag:** Runs VS Code with temporary data and extension directories, as if launched for the first time. This is the correct equivalent of `--profile-temp` for the installed VS Code version (1.109.5).

**Smoke test script skeleton (`scripts/smoke-test.sh`):**
```bash
#!/usr/bin/env bash
set -e
VSIX=$(ls iris-thaumantias/*.vsix 2>/dev/null | head -1)
if [ -z "$VSIX" ]; then
    echo "No .vsix found. Run: cd iris-thaumantias && vsce package"
    exit 1
fi
echo "Installing $VSIX in transient profile..."
code --transient --install-extension "$VSIX"
echo "Launching VS Code with transient profile for smoke test..."
code --transient
echo "Manual verification required:"
echo "  1. Login view renders"
echo "  2. Dashboard, CourseList, CourseDetail, ExerciseDetail navigate correctly"
echo "  3. Iris Chat loads and sends messages"
echo "  4. Exam flow (start, conduction, exercise detail) functional"
echo "  5. Error states visible (network off, wrong server URL)"
echo "  6. Light theme + Dark theme render correctly"
```

### Pattern 6: Bundle Size Reporting (Text-Based)

**What:** Use esbuild's `analyzeMetafile()` API to produce a text-based size report — no visual treemap.

**Note:** The metafile already exists at `dist/meta-webview.json` after any production build. The CONTEXT.md decision is text-only via the metafile.

```javascript
// In esbuild.js or a standalone analyze:text script
const esbuild = require('esbuild');
const fs = require('fs');
const meta = JSON.parse(fs.readFileSync('dist/meta-webview.json', 'utf8'));
const text = await esbuild.analyzeMetafile(meta, { verbose: false });
console.log(text);
```

**package.json script addition:**
```json
"analyze:text": "node -e \"const e=require('esbuild'),f=require('fs'); e.analyzeMetafile(JSON.parse(f.readFileSync('dist/meta-webview.json','utf8'))).then(console.log)\""
```

### Anti-Patterns to Avoid

- **Removing deps before confirming non-usage:** knip output must be manually verified. At least two deps (`ws`, `@stomp/stompjs`) are bundled into `dist/extension.js` (CJS, extension host) — they will not appear in webview import analysis.
- **Fixing npm audit transitive deps by downgrading direct deps:** All current vulnerabilities (minimatch, ajv, diff, mocha) are deep in devDependencies transitive chains. The correct fix is to update the direct dep that pulls them in (e.g., `@vscode/test-cli`), not to add overrides.
- **Using `code --profile-temp`:** This flag does not exist in VS Code 1.109.5. Use `code --transient`.
- **Caching or logging the nonce:** Nonce must be generated fresh per `getReactWebviewHtml()` call and never persisted, logged, or sent to the webview via postMessage.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dead dependency detection | Manual grep of import statements | knip 5.85.0 (npx) | Handles circular deps, type-only imports, re-exports, barrel files |
| Vulnerability scanning | Manual CVE search | `npm audit` | Checks against npm advisory database, produces JSON for scripting |
| Secure random nonce | `Math.random()` + alphabet | `crypto.randomBytes(16).toString('hex')` | CSPRNG required; Math.random is predictable |
| Bundle size analysis | Custom JSON parser of meta-webview.json | `esbuild.analyzeMetafile()` | Official esbuild API, produces formatted text output |

---

## Common Pitfalls

### Pitfall 1: knip Reports Extension Host Deps as "Unused"

**What goes wrong:** knip analyzes `src/extension.ts` as entry point and correctly traces React webview imports, but may flag `ws`, `@stomp/stompjs` as unused if it doesn't trace them through the extension host build.

**Why it happens:** `ws` is imported in `src/services/artemisWebsocketService.ts` which is imported by `artemisWebviewProvider.ts` — it IS reachable from `src/extension.ts`. However, knip's VS Code plugin may have edge cases with the dual-entry pattern.

**How to avoid:** Run knip, then manually verify any flagged production dependency by searching imports before removing it. Never remove a dep solely on knip's output.

**Warning signs:** knip flags `ws` or `@stomp/stompjs` — these have confirmed imports in `src/services/artemisWebsocketService.ts`.

### Pitfall 2: CSS Modules and clsx Affect CSP Analysis

**What goes wrong:** Some components use `clsx` (24 files confirmed) with CSS module class names. If `clsx` is wrongly removed, class composition breaks at runtime with no build-time error.

**Why it happens:** `clsx` is currently in `devDependencies` — it gets bundled by esbuild regardless of that placement (esbuild bundles from `node_modules/`), but the correct placement is `dependencies` since it is production code.

**How to avoid:** Move `clsx` to `dependencies` as planned. Do not remove it.

### Pitfall 3: @types/* in Wrong Section Causes No Runtime Impact But Is a Red Flag

**What goes wrong:** `@types/katex` is in `dependencies`, not `devDependencies`. This causes it to be listed as a production dependency and bundled in the `node_modules` of the installed extension (though esbuild bundles katex's actual code, not its types).

**Why it happens:** @types packages are type-only declarations — they have zero runtime impact regardless of placement. But they inflate the declared production deps and could appear in `npm audit` scan scope.

**How to avoid:** Move `@types/katex` to `devDependencies`.

### Pitfall 4: Inline Style Injection in Dead Code

**What goes wrong:** The `openFullscreenPanel` private method (line 1089 of `artemisWebviewProvider.ts`) injects inline `<style>` without a nonce — a CSP violation. However, this method is NEVER CALLED (confirmed by search — only the declaration exists at line 1089, no callers).

**Why it happens:** Dead code from an earlier iteration. The inline style injection would fail at runtime if called because the CSP `style-src` only allows nonce-backed styles and `webview.cspSource`.

**How to avoid:** Delete the entire `openFullscreenPanel` method. Knip should flag it as unused. The public `openExerciseFullscreen` and `openCourseFullscreen` methods (which ARE called) correctly use `getReactWebviewHtml` without inline styles.

### Pitfall 5: Math.random() Nonce Is Predictable

**What goes wrong:** The current `getNonce()` in `webviewHelpers.ts` uses `Math.random()` producing ~32 bits of entropy (JS's V8 uses xorshift128+ with ~128 bits of state, but Math.random output is predictable if state is known). The CSP W3C spec requires nonces come from a cryptographically secure pseudo-random number generator.

**Why it happens:** VS Code sample extensions historically used `Math.random()` nonce generation as a shortcut. The webview runs in a local trusted context, but the CSP spec requirement is unambiguous.

**How to avoid:** Replace with `crypto.randomBytes(16).toString('hex')` — 128 bits of true CSPRNG entropy, producing a 32-character hex string (same length as current output, drop-in replacement).

### Pitfall 6: npm audit Minimatch "High" Is Transitive devDependency Only

**What goes wrong:** `npm audit` reports `minimatch` as HIGH severity — this looks alarming. However, all affected `minimatch` nodes are in: `@eslint/config-array`, `@eslint/eslintrc`, `eslint`, `@vscode/vsce`, `vscode-extension-tester`, and `@vscode/test-cli`. None are production (bundled) dependencies.

**Why it happens:** npm audit does not distinguish between production and dev transitive deps in its severity rating.

**How to avoid:** Assess each finding in context. The `minimatch` vulnerability is a ReDoS (Denial of Service) in glob pattern matching — not exploitable in the VS Code extension context where inputs come from the local filesystem or trusted Artemis server. Document as accepted risk in devDependencies. The only fixable high/moderate finding is updating `@vscode/test-cli` — but audit says fixing it requires downgrading to `0.0.11` (a major version downgrade), which is worse. This should be documented as deferred pending upstream fix.

---

## Code Examples

### Verified: crypto.randomBytes Nonce

```typescript
// src/utils/webviewHelpers.ts
import * as crypto from 'crypto';

/**
 * Generate a cryptographically secure nonce for Content Security Policy.
 *
 * Uses Node.js crypto.randomBytes() (CSPRNG) to produce 16 bytes (128 bits)
 * of entropy, encoded as a 32-character lowercase hex string.
 *
 * Per W3C CSP Level 2 spec, nonces must:
 * - Come from a cryptographically secure source
 * - Be at least 128 bits of entropy
 * - Be unique per HTML response (never reused or cached)
 * - Not appear in server logs or be sent back via postMessage
 */
export function getNonce(): string {
    return crypto.randomBytes(16).toString('hex');
}
```

**Source:** Node.js crypto docs (https://nodejs.org/api/crypto.html#cryptorandombytessize-callback), W3C CSP Level 2 spec section 8.2.

### Verified: CSP Directive with Documentation Comments

```typescript
// CSP directive breakdown (add above the meta tag in getReactWebviewHtml):
//
// default-src 'none'   — deny everything not explicitly allowed
// script-src 'nonce-X' — only scripts with matching nonce attribute
// style-src cspSource 'nonce-X' — webview-origin CSS files + nonce inline styles
// img-src cspSource https: — webview-origin images + HTTPS (required for problem statement images)
// font-src cspSource   — webview-origin fonts (KaTeX fonts in dist/)
// (connect-src omitted) — no XHR/fetch from webview; all comms via postMessage
const csp = [
    `default-src 'none'`,
    `script-src 'nonce-${nonce}'`,
    `style-src ${webview.cspSource} 'nonce-${nonce}'`,
    `img-src ${webview.cspSource} https:`,
    `font-src ${webview.cspSource}`,
].join('; ');
```

### Verified: knip.json for VS Code Extension

```json
{
  "$schema": "https://unpkg.com/knip@5/schema.json",
  "entry": [
    "src/extension.ts",
    "src/views/webview/react/index.tsx"
  ],
  "project": [
    "src/**/*.{ts,tsx}"
  ],
  "ignoreDependencies": ["vscode"],
  "ignore": ["test/**", "esbuild.js"]
}
```

**Notes:**
- `esbuild.js` ignored because it's a CJS build script that imports `esbuild` and `esbuild-plugin-inline-worker` dynamically — knip can't trace dynamic ESM imports in CJS context
- `test/**` ignored so test-only deps (vitest, @testing-library/*) are not flagged as unused

### Verified: Grep-Based CSP Regression Guard

The CONTEXT.md decision is a grep test that fails if `unsafe-inline` or `unsafe-eval` appears without a nonce. This can be a simple shell-based test or a Vitest test:

```typescript
// test/react/security/csp.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('CSP security invariants', () => {
    it('webviewHelpers.ts does not contain unsafe-inline or unsafe-eval', () => {
        const src = readFileSync(
            join(__dirname, '../../../src/utils/webviewHelpers.ts'),
            'utf8'
        );
        expect(src).not.toMatch(/unsafe-inline/);
        expect(src).not.toMatch(/unsafe-eval/);
    });

    it('webviewHelpers.ts uses crypto.randomBytes for nonce generation', () => {
        const src = readFileSync(
            join(__dirname, '../../../src/utils/webviewHelpers.ts'),
            'utf8'
        );
        expect(src).toMatch(/crypto\.randomBytes/);
        expect(src).not.toMatch(/Math\.random/);
    });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Math.random()` nonce | `crypto.randomBytes(16)` | Longstanding best practice | Cryptographically secure nonce required by W3C CSP spec |
| `--profile-temp` VS Code flag | `--transient` | VS Code 1.109.x | Flag was renamed; `--transient` creates temporary extension + data directories |
| ts-prune for dead code | knip | 2023 | ts-prune maintenance mode; knip handles deps, files, exports, frameworks |
| Manual dep placement audit | knip `--include unlisted` | 2024 | knip can flag deps used in wrong section |

**Deprecated/outdated:**
- **`code --profile-temp`:** This flag is not in VS Code 1.109.5's help output. The current equivalent is `code --transient`.
- **`Math.random()` for security nonces:** Acceptable only in non-security contexts; never for CSP nonces per W3C spec.

---

## Open Questions

1. **Should `react-dom` be added to the production whitelist alongside `react`?**
   - What we know: `react-dom` is in `dependencies`; React 18 requires react-dom for rendering
   - What's unclear: The CONTEXT.md whitelist mentions `react` but not `react-dom` — likely an oversight since both are always required together
   - Recommendation: Add `react-dom` to the confirmed production list during the analysis phase

2. **Is the `chatWebviewProvider.ts` `localResourceRoots: [this._extensionUri]` (full tree) necessary?**
   - What we know: It serves via `getReactWebviewHtml` which only needs `dist/`
   - What's unclear: Whether any chat-specific media outside `dist/` is referenced
   - Recommendation: Narrow to `dist/` unless a specific file path outside dist is discovered during the CSP audit

3. **Does `@vscode/vsce` (indirect dep via `vscode-extension-tester`) pull in the vulnerable `minimatch`?**
   - What we know: Yes, per `npm ls minimatch` — `@vscode/vsce@3.7.1` → `minimatch@3.1.3` (patched version, NOT vulnerable)
   - What's unclear: The audit flags multiple minimatch ranges — `3.1.3` is above the fix point (`3.1.3` = fixed)
   - Recommendation: The minimatch in `@vscode/vsce@3.7.1` is already patched (3.1.3 >= 3.1.3). The HIGH severity minimatch is in `@vscode/test-cli@0.0.12` which pulls in a vulnerable range. Deferred — no fix available without major version downgrade.

---

## Validation Architecture

The `workflow.nyquist_validation` key is not present in `.planning/config.json` (only `"workflow": { "research": true }`). There is no `nyquist_validation: true` flag, so the formal Validation Architecture section is technically skipped. However, the CONTEXT.md explicitly requests a grep-based CSP regression test — that is addressed in Code Examples above.

**Existing test infrastructure:**
- Vitest 4.x with happy-dom — `npm run test:react`
- Coverage at `coverage/react/`
- Test files at `test/react/**`

**Phase-relevant tests to add:**
- `test/react/security/csp.test.ts` — grep-based guard that `webviewHelpers.ts` uses `crypto.randomBytes` and has no `unsafe-inline`/`unsafe-eval`
- No other automated tests needed — dep placement and package.json changes are verified by `npm run check-types` + `npm run lint` + `vsce package --no-dependencies`

---

## Sources

### Primary (HIGH confidence)

- Node.js crypto docs (https://nodejs.org/api/crypto.html#cryptorandombytessize-callback) — `crypto.randomBytes` API
- W3C CSP Level 2 spec (https://www.w3.org/TR/CSP2/#script-src-nonce-usage) — nonce entropy requirements
- VS Code Webview Security docs (https://code.visualstudio.com/api/extension-guides/webview#content-security-policy) — CSP pattern for extensions
- Direct codebase analysis — `src/utils/webviewHelpers.ts` (Math.random nonce), `src/provider/artemisWebviewProvider.ts` (localResourceRoots, dead openFullscreenPanel), `package.json` (clsx in devDeps, @types/katex in deps)
- `npm audit --json` output — 5 vulnerabilities (0 critical, 1 high, 1 moderate, 3 low) all in devDependencies chains
- `code --help` output — confirmed `--transient` flag exists in VS Code 1.109.5; `--profile-temp` does not
- `npx knip --version` — 5.85.0 confirmed available
- `which vsce` — 3.7.1 installed at `/Users/liamberger/.nvm/versions/node/v22.19.0/bin/vsce`

### Secondary (MEDIUM confidence)

- knip documentation (https://knip.dev/) — VS Code extension plugin support, knip.json config format
- Phase 7 RESEARCH.md (`.planning/milestones/v1.0-phases/07-cleanup-optimization/07-RESEARCH.md`) — Prior knip usage context for this codebase

### Tertiary (LOW confidence)

- None identified

---

## Metadata

**Confidence breakdown:**
- Dependency analysis: HIGH — direct package.json inspection + import grep
- CSP/nonce findings: HIGH — direct source code inspection of webviewHelpers.ts
- npm audit findings: HIGH — live `npm audit` run
- Clean environment testing: HIGH — `code --help` confirmed `--transient` flag
- knip configuration: MEDIUM — knip 5.x config format from docs, VS Code extension pattern from prior Phase 7 research

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (30 days — stable tooling)
