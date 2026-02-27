---
phase: 15-command-handler-gap-closure
plan: 01
subsystem: webview-extension-bridge
tags: [command-handlers, link-handling, image-preview, trusted-domains, user-security]

dependency_graph:
  requires:
    - "09-03: ProblemStatement component sends openExternalLink/openImagePreview commands"
  provides:
    - "Working link clicks in problem statements with security confirmation"
    - "Image preview support for data URIs and remote URLs"
    - "Trusted domain persistence via globalState"
  affects:
    - "Extension command palette (new clearTrustedDomains command)"
    - "User security workflow for external links"

tech_stack:
  added:
    - "crypto module for temp file naming"
  patterns:
    - "Modal confirmation dialogs for untrusted domains"
    - "globalState persistence for trusted domains"
    - "globalStorageUri for temp image files"
    - "Data URI parsing with base64 and URL-encoded support"

key_files:
  created: []
  modified:
    - "iris-thaumantias/src/views/app/commands/types.ts: Extended CommandContext with extensionContext field"
    - "iris-thaumantias/src/views/app/webViewMessageHandler.ts: Added extensionContext constructor parameter"
    - "iris-thaumantias/src/provider/artemisWebviewProvider.ts: Wire extensionContext through constructor"
    - "iris-thaumantias/src/extension.ts: Registered clearTrustedDomains command"
    - "iris-thaumantias/package.json: Added artemis.clearTrustedDomains command declaration"
    - "iris-thaumantias/src/views/app/commands/utilityCommands.ts: Implemented openExternalLink and openImagePreview handlers"

decisions:
  - "Use modal dialogs (no Cancel button) — VS Code provides implicit dismiss via Escape/close button"
  - "Trust domain granularity at hostname level (not full URL)"
  - "No temp file cleanup for v1.1 — VS Code cleans globalStorageUri on uninstall"
  - "Images don't require confirmation — content vs navigation distinction"
  - "Protocol validation defense-in-depth — webview already blocks dangerous protocols, extension adds validation"

metrics:
  duration_minutes: 3.6
  tasks_completed: 2
  tasks_total: 2
  commits: 2
  files_modified: 6
  lines_added: 254
  verification_passed: true
  completed_at: "2026-02-25T12:52:48Z"
---

# Phase 15 Plan 01: Command Handler Gap Closure Summary

**One-liner:** Implemented openExternalLink and openImagePreview command handlers with trusted domain persistence, protocol validation, data URI decoding, and clearTrustedDomains command palette entry.

## Overview

This plan closed the integration gap between the Phase 09-03 ProblemStatement component (which sends openExternalLink/openImagePreview commands on link/image clicks) and the extension command system. Two handlers were implemented with full security validation, user confirmation workflows, and persistent trusted domain storage.

## Tasks Completed

### Task 1: Extend CommandContext and register clearTrustedDomains command (commit: fa7e51b)

**Objective:** Prepare the command infrastructure for globalState/globalStorageUri access and add command palette entry for clearing trusted domains.

**Implementation:**
1. Added `extensionContext: vscode.ExtensionContext` field to `CommandContext` interface in `types.ts`
2. Updated `WebViewMessageHandler` constructor to accept `extensionContext` parameter
3. Wired `extensionContext` through `ArtemisWebviewProvider` constructor to both `WebViewMessageHandler` instantiation sites (constructor and `setBuildDiagnostics`)
4. Registered `artemis.clearTrustedDomains` command in `package.json`
5. Implemented `clearTrustedDomains` command handler in `extension.ts` with modal confirmation dialog

**Key decisions:**
- Modal dialog with single "Clear" button (no Cancel button) — VS Code's modal provides implicit dismiss via Escape/close button
- Stores trusted domains in `globalState.get('artemis.trustedDomains')` as string array

**Verification:**
- TypeScript compilation: ✅ No new errors
- Command registration: ✅ Verified in package.json
- Command implementation: ✅ Verified in extension.ts
- Context field: ✅ Verified in types.ts

### Task 2: Implement openExternalLink and openImagePreview handlers (commit: 623d3f6)

**Objective:** Implement full link/image handling with security validation, user confirmation, and data URI support.

**Implementation:**

**openExternalLink handler:**
1. Input validation: Extract `url` from `message.payload.url`, validate string type
2. Protocol validation: Parse URL, only allow `http:` and `https:`, show error with "Copy URL" fallback for invalid protocols
3. Domain extraction: Extract hostname for trusted domain checking
4. Trusted domain check: Read `artemis.trustedDomains` from globalState, validate array type (corruption recovery)
5. Confirmation dialog (untrusted domains): Modal with "Open" and "Trust this domain" buttons, truncate long URLs (>80 chars)
6. Trusted domain persistence: Save domain to globalState on "Trust this domain"
7. Error handling: Wrap in try/catch, log errors, show error message with "Copy URL" fallback

**openImagePreview handler:**
1. Input validation: Extract `uri` from `message.payload.uri`, validate string type
2. Data URI handling:
   - Parse data URI: split on first comma, check for `;base64` in metadata
   - Extract mime type (default to `image/png`)
   - Decode: base64 or URL-encoded
   - Infer file extension from mime type map (`.png`, `.jpg`, `.gif`, `.svg`, `.webp`)
   - Generate temp file name: `image-{randomHex}.{ext}`
   - Create temp file URI via `globalStorageUri`
   - Ensure directory exists via `workspace.fs.createDirectory`
   - Write file via `workspace.fs.writeFile`
   - Open in VS Code viewer via `vscode.open` command
3. Remote URL handling: Validate protocol (http/https only), open in default browser via `env.openExternal`
4. Error handling: Wrap in try/catch, log errors, show error message with "Copy URL" fallback

**Helper methods implemented:**
- `isAllowedProtocol(url: string): boolean` — Parse URL, check protocol is `http:` or `https:`
- `extractDomain(url: string): string | null` — Parse URL, return hostname
- `truncateUrl(url: string, maxLength: number = 80): string` — Truncate with ellipsis if needed
- `parseDataUri(dataUri: string): { mimeType: string; data: Buffer } | null` — Parse data URI, decode base64 or URL-encoded
- `getExtensionFromMime(mimeType: string): string` — Map mime type to file extension (default `.png`)

**Key decisions:**
- No confirmation dialog for images — images are content, not navigation
- No temp file cleanup for v1.1 — VS Code cleans `globalStorageUri` on extension uninstall, skip cleanup for simplicity
- Protocol validation is defense-in-depth — webview CSP already blocks `javascript:`, `data:`, `file:` protocols, but extension validates too
- Error messages include "Copy URL" fallback button for user recovery

**Verification:**
- TypeScript compilation: ✅ No new errors
- Handlers registered: ✅ Verified in `getHandlers()` return object
- Handler implementations: ✅ Both methods implemented with full logic
- Helper methods: ✅ All 5 helper methods implemented

## Deviations from Plan

None — plan executed exactly as written. All user decisions were locked and followed precisely.

## Verification Results

All verification criteria passed:

1. **TypeScript compilation:** ✅ `npx tsc --noEmit` — 0 new errors (10 pre-existing errors from modules)
2. **Handler registration:** ✅ `grep 'openExternalLink\|openImagePreview' utilityCommands.ts` — 4 occurrences (registration + implementations)
3. **Command registration:** ✅ `grep 'artemis.clearTrustedDomains' package.json` — command declared
4. **Command implementation:** ✅ `grep 'artemis.clearTrustedDomains' extension.ts` — command implemented
5. **Context field:** ✅ `grep 'extensionContext' types.ts` — field exists in CommandContext

## Testing Notes

**Manual testing required:**
1. Click link in problem statement → confirmation dialog appears → "Open" works
2. Click link again → "Trust this domain" works → no future prompts for that domain
3. Click data URI image → opens in VS Code image viewer
4. Click remote URL image → opens in default browser
5. Run "Artemis: Clear Trusted Domains" from command palette → confirmation dialog → trusted domains cleared
6. Try `javascript:` or `file:` URL → error message with "Copy URL" button

**Expected behavior:**
- Links show modal confirmation for untrusted domains with "Open" and "Trust this domain" buttons
- Trusted domains open directly without prompt
- Data URI images open in VS Code viewer
- Remote URL images open in default browser
- Invalid protocols show error with "Copy URL" fallback
- clearTrustedDomains command clears globalState and shows confirmation

## Integration Impact

**Upstream dependencies (satisfied):**
- Phase 09-03: ProblemStatement component already sends `openExternalLink` and `openImagePreview` commands on link/image clicks

**Downstream impact:**
- Users can now click links in problem statements with security confirmation workflow
- Trusted domains persist across sessions via globalState
- Image previews work for both data URIs (embedded images) and remote URLs
- Command palette includes "Artemis: Clear Trusted Domains" for privacy management

**Files affected:**
- `types.ts`: CommandContext interface extended
- `webViewMessageHandler.ts`: Constructor signature updated
- `artemisWebviewProvider.ts`: extensionContext wired through
- `extension.ts`: clearTrustedDomains command registered
- `package.json`: Command declared
- `utilityCommands.ts`: Two handlers + 5 helper methods added

## Known Limitations

1. **No temp file cleanup:** Data URI images are written to `globalStorageUri` and not cleaned up until extension uninstall. This is acceptable for v1.1 — most problem statements use remote URLs, not embedded data URIs.

2. **Trust domain granularity:** Trusting a domain trusts ALL links from that domain. Future enhancement could add path-level or per-URL granularity if needed.

3. **No domain whitelist:** There's no pre-populated whitelist of trusted domains (e.g., `artemis.tum.de`). Users must explicitly trust domains on first click.

4. **No rate limiting:** Opening many links quickly doesn't trigger rate limiting. This is acceptable for v1.1 — problem statements typically have few links.

## Performance Notes

- **Duration:** 3.6 minutes (213 seconds)
- **Commits:** 2 (one per task)
- **Files modified:** 6
- **Lines added:** ~254 lines (226 in utilityCommands.ts, 28 across other files)

Both handlers are synchronous with async I/O (globalState read/write, file I/O). Performance impact is negligible — link clicks and image previews are rare user actions.

## Future Enhancements

1. **Pre-populated whitelist:** Add `artemis.tum.de` and other known-safe domains to default trusted list
2. **Path-level trust:** Allow trusting specific URL paths instead of entire domains
3. **Temp file cleanup:** Add periodic cleanup or cleanup-on-restart for data URI temp files
4. **Link preview:** Show link destination in confirmation dialog (already done via truncated URL)
5. **Domain untrust:** Add command to untrust specific domain (vs clearing all)

## Self-Check: PASSED

Verified all commits and files exist:

**Commits:**
- ✅ FOUND: fa7e51b (Task 1: extend CommandContext and register clearTrustedDomains)
- ✅ FOUND: 623d3f6 (Task 2: implement openExternalLink and openImagePreview handlers)

**Modified files:**
- ✅ FOUND: types.ts
- ✅ FOUND: webViewMessageHandler.ts
- ✅ FOUND: artemisWebviewProvider.ts
- ✅ FOUND: extension.ts
- ✅ FOUND: package.json
- ✅ FOUND: utilityCommands.ts

All claims verified. Plan execution complete.
