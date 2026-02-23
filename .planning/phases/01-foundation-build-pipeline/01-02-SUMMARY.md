---
phase: 01-foundation-build-pipeline
plan: 02
subsystem: build-pipeline
tags: [csp, message-contracts, security, type-safety]
requires: [BUILD-02]
provides: [webview-html-generation, typed-messaging]
affects: [extension-host, webview-runtime]
tech-stack:
  added: [nonce-based-csp, discriminated-unions]
  patterns: [type-guards, runtime-validation]
key-files:
  created:
    - iris-thaumantias/src/utils/webviewHelpers.ts
    - iris-thaumantias/src/shared/messageContracts.ts
  modified: []
decisions:
  - title: "Nonce-based CSP without unsafe-inline"
    rationale: "Prevents XSS attacks by requiring all scripts and styles to have matching nonces. Standard VS Code pattern using Math.random() is sufficient for local webview context."
    alternatives: "Could use stricter crypto.randomBytes, but Math.random() is the VS Code convention for webview nonces."
    impact: "All React webviews must be loaded through getReactWebviewHtml() to receive proper nonces."
  - title: "Discriminated unions with 'type' discriminant"
    rationale: "Enables exhaustive switch checking and TypeScript type narrowing across postMessage boundary."
    alternatives: "Could use string enums or literal unions, but discriminated unions provide better IntelliSense and type safety."
    impact: "All extension-webview messages must follow the established type contracts."
  - title: "Runtime type guards using 'unknown' not 'any'"
    rationale: "Maintains strict typing discipline. 'unknown' forces explicit type checks before use."
    alternatives: "Could use 'any' for convenience, but sacrifices type safety."
    impact: "Message handlers must use type guards before accessing message properties."
metrics:
  duration_minutes: 3
  tasks_completed: 2
  files_created: 2
  files_modified: 0
  lines_added: 129
  commits: 2
  completed_date: 2026-02-23
---

# Phase 1 Plan 2: CSP Enforcement + Typed Message Contracts Summary

**One-liner:** Nonce-based CSP HTML generation with discriminated union message contracts for type-safe extension-webview communication.

## What Was Built

Created secure webview infrastructure with Content Security Policy enforcement and typed message contracts:

1. **webviewHelpers.ts**: CSP-compliant HTML generation
   - `getNonce()`: Generates 32-character alphanumeric nonces
   - `getReactWebviewHtml()`: Produces HTML with nonce-based CSP (no unsafe-inline/unsafe-eval)
   - Default-src 'none' policy (deny all by default)
   - Uses webview.cspSource for proper resource URIs

2. **messageContracts.ts**: Typed bidirectional messaging
   - `ExtensionToWebviewMessage`: init, stateUpdate, error
   - `WebviewToExtensionMessage`: ready, command, error
   - `VsCodeApi` interface for webview context
   - Runtime type guards using `unknown` (not `any`)

## Success Criteria - Met

- [x] CSP-compliant HTML generation ready for React webview loading
- [x] Typed message contracts provide compile-time safety for extension-webview communication
- [x] Type guards enable runtime validation of messages across postMessage boundary
- [x] No regressions in existing extension builds

## Verification Results

All verification steps passed:

```bash
# Type checking
npm run check-types  # ✓ No errors

# Build compilation
npm run compile      # ✓ All bundles built successfully

# Linting
npm run lint         # ✓ No warnings or errors

# Manual checks
# ✓ CSP contains no 'unsafe-inline' or 'unsafe-eval'
# ✓ CSP default-src is 'none'
# ✓ All script and style tags have nonce attribute
# ✓ Message contracts use 'unknown' not 'any'
# ✓ Discriminated unions enable exhaustive switch checking
```

## Tasks Completed

| Task | Name | Status | Commit | Files |
|------|------|--------|--------|-------|
| 1 | Create webviewHelpers.ts | ✓ | 813981b | iris-thaumantias/src/utils/webviewHelpers.ts |
| 2 | Create messageContracts.ts | ✓ | 1d36c93 | iris-thaumantias/src/shared/messageContracts.ts |

## Deviations from Plan

None - plan executed exactly as written.

### Pre-existing Work

Found untracked React files from plan 01-01 (App.tsx, ErrorBoundary.tsx, index.tsx) in `src/views/webview/react/`. These were not created by this plan but were necessary for build verification. They remain untracked as they're outside this plan's scope.

## Technical Details

### Content Security Policy

The generated CSP is restrictive and secure:

```
default-src 'none';
img-src ${webview.cspSource} https:;
font-src ${webview.cspSource};
style-src ${webview.cspSource} 'nonce-${nonce}';
script-src 'nonce-${nonce}';
```

Key security properties:
- Default-src 'none' denies all content by default
- No 'unsafe-inline' or 'unsafe-eval' anywhere
- Scripts and styles require matching nonce attribute
- Images allow https: for external resources (e.g., exercise images)

### Message Contracts

Discriminated unions enable type-safe messaging:

```typescript
// Extension → Webview
type ExtensionToWebviewMessage =
  | { type: 'init'; payload: { /* TBD */ } }
  | { type: 'stateUpdate'; payload: Partial<WebviewState> }
  | { type: 'error'; payload: { message: string } };

// Webview → Extension
type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'command'; payload: { command: string; args?: unknown } }
  | { type: 'error'; payload: { ... } };
```

TypeScript narrows types in switch statements:

```typescript
function handleMessage(msg: ExtensionToWebviewMessage) {
  switch (msg.type) {
    case 'init':
      // TypeScript knows msg.payload exists here
      break;
    case 'stateUpdate':
      // TypeScript knows msg.payload is Partial<WebviewState>
      break;
    case 'error':
      // TypeScript knows msg.payload has message: string
      break;
    // Omitting a case produces a compile error
  }
}
```

## Integration Points

### For Phase 3 (View Migration)

When migrating views in Phase 3:

1. **Load webviews via getReactWebviewHtml()**
   ```typescript
   import { getReactWebviewHtml } from '../utils/webviewHelpers';
   webview.html = getReactWebviewHtml(webview, extensionUri);
   ```

2. **Import message contracts in both contexts**
   ```typescript
   // Extension host
   import { WebviewToExtensionMessage } from '../shared/messageContracts';

   // Webview bundle
   import { ExtensionToWebviewMessage } from '../../shared/messageContracts';
   ```

3. **Use type guards for message validation**
   ```typescript
   import { isWebviewMessage } from '../shared/messageContracts';

   webview.onDidReceiveMessage(msg => {
     if (isWebviewMessage(msg)) {
       // TypeScript knows msg is WebviewToExtensionMessage
     }
   });
   ```

### Tightening Contracts in Phase 3

Current contracts are scaffolds with loose typing:

```typescript
// Phase 1 (loose)
{ type: 'init'; payload: { /* TBD */ } }

// Phase 3 (tight)
{ type: 'init'; payload: {
  view: 'dashboard' | 'courseList' | ...;
  initialState: DashboardState | CourseListState | ...;
} }
```

Each view will define its own state types and message payloads.

## Build Artifacts

Files created:
- `iris-thaumantias/src/utils/webviewHelpers.ts` (57 lines)
- `iris-thaumantias/src/shared/messageContracts.ts` (72 lines)

## Next Steps (Phase 3)

1. Implement React views using getReactWebviewHtml()
2. Tighten message contracts with view-specific state types
3. Add message handlers in extension host and webview code
4. Implement ready-signal handshake to prevent race conditions

## Self-Check: PASSED

Verified all created files exist:
```bash
✓ FOUND: iris-thaumantias/src/utils/webviewHelpers.ts
✓ FOUND: iris-thaumantias/src/shared/messageContracts.ts
```

Verified all commits exist:
```bash
✓ FOUND: 813981b (Task 1: webviewHelpers.ts)
✓ FOUND: 1d36c93 (Task 2: messageContracts.ts)
```

All files created, all commits recorded, all verification steps passed.
