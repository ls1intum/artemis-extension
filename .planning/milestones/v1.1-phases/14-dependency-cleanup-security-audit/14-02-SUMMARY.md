---
phase: 14-dependency-cleanup-security-audit
plan: 02
subsystem: security/webview
tags: [csp, security, nonce, webview, regression-test]
dependency_graph:
  requires: []
  provides: [CLEAN-02, secure-nonce-generation, csp-regression-guard]
  affects: [artemisWebviewProvider, chatWebviewProvider, webviewHelpers]
tech_stack:
  added: [Node.js crypto module]
  patterns: [grep-based regression testing, CSPRNG nonce generation, least-privilege localResourceRoots]
key_files:
  created:
    - iris-thaumantias/test/react/security/csp.test.ts
  modified:
    - iris-thaumantias/src/utils/webviewHelpers.ts
    - iris-thaumantias/src/provider/artemisWebviewProvider.ts
    - iris-thaumantias/src/provider/chatWebviewProvider.ts
decisions:
  - "Rewrote JSDoc comment to avoid literal unsafe-inline/unsafe-eval strings that would trip the grep-based regression tests"
  - "CSP directive comment uses template literal variables (safe) rather than prose spelling out the forbidden strings"
metrics:
  duration: "3 minutes"
  completed: "2026-02-27"
  tasks_completed: 2
  files_created: 1
  files_modified: 3
---

# Phase 14 Plan 02: CSP Hardening and Regression Guard Summary

**One-liner:** Replaced Math.random() nonce with crypto.randomBytes(16) CSPRNG, narrowed all localResourceRoots to dist/, deleted dead CSP-bypassing method, and added 6-assertion grep-based CSP regression test.

## What Was Built

- **Secure nonce generation:** `getNonce()` now uses `crypto.randomBytes(16).toString('hex')` producing 128 bits of CSPRNG entropy instead of Math.random
- **CSP directive documentation:** Inline comment block above the CSP meta tag explains each directive (default-src, script-src, style-src, img-src, font-src, connect-src omitted)
- **Tightened localResourceRoots:** All three webview providers now use `vscode.Uri.joinPath(this._extensionUri, 'dist')` instead of the broad `this._extensionUri`
  - artemisWebviewProvider sidebar (line 421): narrowed to dist/
  - artemisWebviewProvider exercise fullscreen (line 879): already correct
  - artemisWebviewProvider course fullscreen (line 931): already correct
  - chatWebviewProvider (line 196): narrowed to dist/
- **Dead code removed:** `openFullscreenPanel` private method (52 lines) deleted from artemisWebviewProvider — was never called and contained an unsafe inline `<style>` injection that would have bypassed CSP
- **CSP regression test:** `test/react/security/csp.test.ts` with 6 grep-based assertions that fail if Math.random is reintroduced, or unsafe-inline/unsafe-eval appears in the CSP source

## Verification Results

- `grep -n "crypto.randomBytes" webviewHelpers.ts` — shows import and usage on lines 7 and 17
- `grep -n "Math.random" webviewHelpers.ts` — returns nothing
- `grep -rn "openFullscreenPanel" src/` — returns nothing
- All localResourceRoots confirmed narrowed to dist/
- 6/6 CSP regression tests pass

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] JSDoc comment tripped grep-based test assertions**
- **Found during:** Task 2 execution (running csp.test.ts for the first time)
- **Issue:** The existing JSDoc on `getReactWebviewHtml` contained the literal string "no unsafe-inline or unsafe-eval" — the grep-based test reads the entire source file and would permanently fail on the comment text
- **Fix:** Reworded JSDoc to "no relaxed directives, nonces only" — preserves meaning without containing the guarded literal strings
- **Files modified:** iris-thaumantias/src/utils/webviewHelpers.ts
- **Commit:** cdcc237

## Self-Check: PASSED

All files exist and all commits verified:
- 131e1fa: fix(14-02): harden CSP nonce and tighten localResourceRoots
- cdcc237: test(14-02): add CSP regression guard for nonce and directive invariants
