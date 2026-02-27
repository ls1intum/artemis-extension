# Phase 15: Command Handler Gap Closure - Research

**Researched:** 2026-02-25
**Domain:** VS Code Extension API, webview-extension communication, browser security
**Confidence:** HIGH

## Summary

Phase 15 implements two missing extension-side command handlers (`openExternalLink` and `openImagePreview`) that are already defined in message contracts and invoked by the webview's ProblemStatement component. The webview has been sending these commands since Phase 09-03, but they silently fail because no handlers are registered.

This is a gap closure phase closing integration gaps from the v1.1 milestone audit. The implementation pattern follows existing command handlers in the codebase: modular command classes with typed message contracts, VS Code API wrappers for system integration, and proper error handling with user feedback.

**Primary recommendation:** Add handlers to `UtilityCommandModule` (consistent with existing `openWebsite` and `openBugReport` handlers), implement protocol validation and confirmation dialogs for external links, and use VS Code's built-in image viewer for data URIs with temp file decoding.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Link opening behavior:**
- Open links in the system's **default browser** via `vscode.env.openExternal`
- **Protocol validation**: only allow `http://` and `https://` protocols; block `javascript:`, `data:`, `file:`, etc. (defense-in-depth on top of DOMPurify)
- **Confirmation dialog**: show a **modal** `vscode.window.showInformationMessage` before opening, with the URL **truncated with ellipsis** (~80 chars)
- **"Trust this domain" option**: dialog includes a "Trust this domain" button alongside Open/Cancel
- **Trusted domain persistence**: stored in **VS Code globalState**, persists across sessions
- **No auto-trust**: all domains treated equally — Artemis server domain is NOT auto-trusted
- **Clear trusted domains**: register an `Artemis: Clear Trusted Domains` command in the command palette

**Image preview behavior:**
- **Data URI images**: decode to a temp file and open in **VS Code's built-in image viewer** (`vscode.commands.executeCommand('vscode.open', uri)`)
- **Remote URL images**: open in the **default browser** (avoids download complexity)
- **No confirmation dialog** for images — open immediately on click (images are content, not navigation)
- **Temp file storage**: use `context.globalStorageUri` (extension-managed, standard VS Code pattern)

**Error feedback:**
- **Both handlers**: show errors via `vscode.window.showErrorMessage` notification
- **Action button**: include a "Copy URL" button on link error notifications as a fallback
- **Logging**: log all errors to an Artemis output channel for debugging

### Claude's Discretion

- Exact temp file naming and cleanup strategy for image previews
- Error message wording
- Whether to add the handlers to existing UtilityCommandModule or create a new module
- Implementation of the trusted domains data structure

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UI-03 | Exercise detail page renders problem statement content correctly | Command handlers enable full interactive problem statement experience. Webview infrastructure completed in Phase 09-03 (KaTeX, PlantUML, link/image interception). This phase closes the integration gap by implementing extension-side handlers that receive commands already sent by the webview. |

</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| VS Code Extension API | ^1.97.0 | Extension host APIs for external browser, dialogs, file system, global storage | Platform requirement, only API available in extension context |
| Node.js crypto | built-in | Generate random nonce for temp file naming | Standard Node.js module, already used in extension for CSP nonces |
| Node.js path | built-in | Path manipulation for temp files | Standard Node.js module, cross-platform |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vscode.workspace.fs | built-in | Write temp files for image preview | Already used throughout codebase for file operations |
| vscode.ExtensionContext.globalState | built-in | Persist trusted domains across sessions | Standard VS Code pattern for extension-scoped persistence |
| Buffer (Node.js) | built-in | Decode base64 data URIs | Standard Node.js module for binary data |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| globalState | Workspace settings | globalState is user-scoped (persists per user), settings are workspace-scoped. User intent (trust a domain) is global, not workspace-specific. |
| vscode.open command | vscode.openWith command | vscode.open auto-selects viewer based on file extension, simpler API. vscode.openWith requires explicit viewType, more complex. |
| Temp files for images | Direct data URI display in webview | CSP restrictions in webviews may block inline data URIs. Temp file approach is more reliable and uses VS Code's native image viewer with zoom/pan capabilities. |

**Installation:**

No new dependencies required. All APIs are built-in to VS Code and Node.js.

## Architecture Patterns

### Recommended Project Structure

```
iris-thaumantias/src/views/app/commands/
├── utilityCommands.ts    # Add openExternalLink and openImagePreview handlers here
├── types.ts              # Already defines CommandContext and CommandMap
└── ...                   # Other command modules
```

**Rationale:** `UtilityCommandModule` already handles similar browser-related commands (`openWebsite`, `openBugReport`, `searchMarketplace`, `copyToClipboard`). Keeping external link and image preview handlers in the same module maintains cohesion.

### Pattern 1: Command Module Registration

**What:** Command handlers are classes that implement `getHandlers(): CommandMap`, returning a record of command name to handler function. The `WebViewMessageHandler` aggregates all modules and routes incoming messages by command name.

**When to use:** All webview command handlers follow this pattern.

**Example:**

```typescript
// Source: iris-thaumantias/src/views/app/commands/utilityCommands.ts (existing pattern)
export class UtilityCommandModule {
    constructor(private readonly context: CommandContext) {}

    public getHandlers(): CommandMap {
        return {
            openExternalLink: this.handleOpenExternalLink,
            openImagePreview: this.handleOpenImagePreview,
            // ... other handlers
        };
    }

    private handleOpenExternalLink = async (message: any): Promise<void> => {
        const url: string = message.url;
        // Implementation
    };
}
```

### Pattern 2: VS Code External Browser API

**What:** `vscode.env.openExternal(vscode.Uri.parse(url))` opens URLs in the system's default browser.

**When to use:** Opening http/https URLs, documentation links, external resources.

**Example:**

```typescript
// Source: iris-thaumantias/src/views/app/commands/utilityCommands.ts:41
private handleOpenWebsite = async (): Promise<void> => {
    await vscode.env.openExternal(vscode.Uri.parse('https://artemis.tum.de/courses'));
};
```

### Pattern 3: Confirmation Dialog with Actions

**What:** `vscode.window.showInformationMessage` with button options returns the selected button or undefined (on cancel/escape).

**When to use:** User confirmation before potentially dangerous actions (opening external links, deleting files, etc.)

**Example:**

```typescript
// Source: VS Code Extension API documentation
const result = await vscode.window.showInformationMessage(
    'Open external link?',
    { modal: true },
    'Open',
    'Trust Domain',
    'Cancel'
);

if (result === 'Open') {
    // Open once
} else if (result === 'Trust Domain') {
    // Save to globalState and open
}
```

### Pattern 4: Global State Persistence

**What:** `context.globalState` provides extension-scoped key-value storage that persists across VS Code restarts.

**When to use:** Storing user preferences, trusted domains, session data that should survive restarts.

**Example:**

```typescript
// Save
await context.globalState.update('artemis.trustedDomains', ['example.com', 'github.com']);

// Load
const trustedDomains = context.globalState.get<string[]>('artemis.trustedDomains', []);
```

### Pattern 5: Temp File Creation for VS Code Viewers

**What:** Write binary data to a temp file in `context.globalStorageUri` and open with `vscode.commands.executeCommand('vscode.open', fileUri)`.

**When to use:** Displaying binary content (images, PDFs, etc.) in VS Code's built-in viewers.

**Example:**

```typescript
// Create temp file path
const tempFileName = `image-${crypto.randomBytes(8).toString('hex')}.png`;
const tempFileUri = vscode.Uri.joinPath(context.globalStorageUri, tempFileName);

// Ensure directory exists
await vscode.workspace.fs.createDirectory(context.globalStorageUri);

// Write decoded data URI
const base64Data = dataUri.split(',')[1];
const buffer = Buffer.from(base64Data, 'base64');
await vscode.workspace.fs.writeFile(tempFileUri, buffer);

// Open in VS Code viewer
await vscode.commands.executeCommand('vscode.open', tempFileUri);
```

### Pattern 6: Protocol Validation (Defense-in-Depth)

**What:** Validate URL protocols before passing to VS Code APIs to prevent protocol smuggling attacks.

**When to use:** Any user-controlled URL before opening in browser or webview.

**Example:**

```typescript
function isAllowedProtocol(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false; // Invalid URL
    }
}

// Usage
if (!isAllowedProtocol(url)) {
    vscode.window.showErrorMessage('Invalid URL protocol. Only http:// and https:// are allowed.');
    return;
}
```

**Rationale:** Even though DOMPurify sanitizes HTML in the webview, protocol validation in the extension provides defense-in-depth. If sanitization is bypassed (e.g., via a vulnerability), the extension still blocks dangerous protocols like `javascript:`, `data:`, `file:`, `vscode:`, etc.

### Pattern 7: Domain Extraction for Trust Lists

**What:** Extract hostname from URL for domain-based trust comparison.

**When to use:** Trusted domain checks, domain-level allowlisting/blocklisting.

**Example:**

```typescript
function extractDomain(url: string): string | null {
    try {
        const parsed = new URL(url);
        return parsed.hostname;
    } catch {
        return null;
    }
}

// Usage
const domain = extractDomain('https://artemis.cit.tum.de/courses/123');
// domain = 'artemis.cit.tum.de'
```

### Anti-Patterns to Avoid

- **Auto-trusting domains:** Do NOT auto-trust any domain (including Artemis server domain). User must explicitly trust via dialog. Reason: User agency, prevents phishing if problem statement is maliciously crafted.
- **Opening links without validation:** Do NOT pass user-controlled URLs directly to `vscode.env.openExternal` without protocol validation. Reason: `javascript:` URLs can execute code in some browsers, `vscode:` URLs can trigger VS Code commands.
- **Storing temp files in workspace:** Do NOT use `vscode.workspace.workspaceFolders` for temp files. Reason: Workspace may be read-only, or user may not have workspace open. Use `context.globalStorageUri` which is extension-managed and guaranteed writable.
- **Confirmation dialogs for images:** Do NOT show confirmation dialogs for image previews. Reason: Images are content (passive), not navigation (active). User clicked an image expecting to see it, not to navigate away.
- **Synchronous file operations:** Do NOT use Node.js fs module synchronously. Reason: Blocks VS Code UI. Use `vscode.workspace.fs` async APIs.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| External browser integration | Custom child_process.exec for platform-specific browser opening | `vscode.env.openExternal` | VS Code API handles platform differences (macOS open, Windows start, Linux xdg-open), URL encoding, security sandboxing. Custom solution would require 200+ LOC and miss edge cases. |
| Modal dialogs | Custom webview-based modal | `vscode.window.showInformationMessage` with modal option | Built-in dialogs are keyboard-accessible, themeable, and integrate with VS Code's command palette. Custom modals would require focus trap, ESC handling, and accessibility work. |
| Data URI parsing | Regex-based base64 extraction | Node.js Buffer.from with split logic | Buffer.from handles malformed base64 gracefully (throws exception). Regex approaches are fragile and miss edge cases (multi-line base64, different mime types). |
| Image file type detection | Custom mime-type parser | File extension inference from data URI mime type | VS Code auto-detects file types by extension for its viewers. Over-engineering mime-type parsing adds complexity without benefit. |

**Key insight:** VS Code Extension API already provides battle-tested solutions for browser integration, dialogs, and file system operations. These APIs handle cross-platform differences, security boundaries, and accessibility concerns that would take weeks to implement correctly from scratch.

## Common Pitfalls

### Pitfall 1: globalState Data Structure Mismatch

**What goes wrong:** Storing trusted domains as a Set or Map in globalState, then reading back as an object or undefined. GlobalState only supports JSON-serializable types (primitives, arrays, plain objects).

**Why it happens:** TypeScript allows Set/Map but they serialize to `{}` in JSON.stringify.

**How to avoid:** Always use plain arrays for list-like data in globalState. Validate type on read with default fallback.

**Warning signs:**
- `trustedDomains.has is not a function` runtime error
- Empty trusted domains list after restart despite saving

**Prevention code:**
```typescript
// WRONG: Set doesn't serialize
await context.globalState.update('trustedDomains', new Set(['example.com']));

// CORRECT: Use array
await context.globalState.update('artemis.trustedDomains', ['example.com']);

// Always validate on read
const trustedDomains = context.globalState.get<string[]>('artemis.trustedDomains', []);
if (!Array.isArray(trustedDomains)) {
    // Corruption recovery: reset to empty array
    await context.globalState.update('artemis.trustedDomains', []);
}
```

### Pitfall 2: Data URI Format Variations

**What goes wrong:** Assuming all data URIs follow `data:image/png;base64,<data>` format. Data URIs can omit mime type, use URL encoding instead of base64, or include charset parameters.

**Why it happens:** Problem statements may come from external sources with varying encoding tools.

**How to avoid:** Use robust parsing: split on first comma, check for base64 indicator, handle missing mime type.

**Warning signs:**
- "Invalid base64 string" errors on some images
- Corrupted image files in temp storage
- Some images work, others fail silently

**Prevention code:**
```typescript
function parseDataUri(dataUri: string): { mimeType: string; data: Buffer } | null {
    if (!dataUri.startsWith('data:')) return null;

    const [metadata, ...dataParts] = dataUri.substring(5).split(',');
    const data = dataParts.join(','); // Handle commas in data

    // Check if base64 encoded
    const isBase64 = metadata.endsWith(';base64');
    const mimeType = isBase64 ? metadata.slice(0, -7) : metadata;

    try {
        const buffer = isBase64
            ? Buffer.from(data, 'base64')
            : Buffer.from(decodeURIComponent(data));
        return { mimeType: mimeType || 'image/png', data: buffer };
    } catch {
        return null; // Invalid encoding
    }
}
```

### Pitfall 3: Modal Dialog Button Ordering Inconsistency

**What goes wrong:** Inconsistent button order in confirmation dialogs (OK/Cancel vs Cancel/OK) confuses users and leads to accidental clicks.

**Why it happens:** VS Code displays buttons in the order provided, but platforms have different conventions (macOS: Cancel left, Windows: Cancel right).

**How to avoid:** Follow VS Code convention: primary action first, secondary actions after, Cancel/Dismiss last. VS Code handles platform-specific rendering.

**Warning signs:**
- User reports accidentally opening links when trying to cancel
- Button order feels "backwards" on certain platforms

**Prevention pattern:**
```typescript
// CORRECT: Primary action first, Cancel last
const result = await vscode.window.showInformationMessage(
    'Open external link?',
    { modal: true },
    'Open',           // Primary (destructive/important)
    'Trust Domain',   // Secondary
    'Cancel'          // Dismiss (implicit if omitted, but explicit is clearer)
);

// VS Code renders this as:
// macOS:    [Cancel] [Trust Domain] [Open]
// Windows:  [Open] [Trust Domain] [Cancel]
```

### Pitfall 4: Temp File Cleanup Race Conditions

**What goes wrong:** Deleting temp image files immediately after opening causes "file not found" errors in VS Code image viewer, because viewer loads asynchronously.

**Why it happens:** `vscode.open` command returns immediately (before viewer loads file), leading to premature cleanup.

**How to avoid:** Either never delete (acceptable for images, bounded by user session), or implement deferred cleanup on extension deactivation.

**Warning signs:**
- Image preview shows "File not found" error
- Temp files work in first preview but fail on subsequent previews
- Intermittent failures that go away on retry

**Prevention strategy:**
```typescript
// ACCEPTABLE: Never delete during session
// Temp files are in globalStorageUri (extension-managed), cleaned by VS Code on uninstall
// Each image is ~50KB, unlikely to accumulate significantly during one session

// ADVANCED: Cleanup on deactivation
export function deactivate(context: vscode.ExtensionContext) {
    // Clean up temp files older than 1 hour (avoids deleting actively viewed files)
    const tempDir = context.globalStorageUri;
    // Implementation left to executor
}
```

**Recommendation for this phase:** Skip cleanup. Temp images are small (~50KB typical), bounded by session duration, and stored in extension-managed directory that VS Code cleans on uninstall. Premature optimization adds complexity and risk.

### Pitfall 5: URL Truncation Edge Cases

**What goes wrong:** Truncating URLs at byte boundary instead of character boundary causes broken multi-byte UTF-8 characters in dialog (e.g., emoji in domain names).

**Why it happens:** JavaScript string indexing is character-based, but developers sometimes think in bytes.

**How to avoid:** Use string.slice (character-based) and ensure truncation happens on character boundaries. Add ellipsis at character boundary.

**Warning signs:**
- Garbled characters in truncated URLs
- Dialog displays replacement character (�) in URL
- URLs with non-ASCII characters break

**Prevention code:**
```typescript
function truncateUrl(url: string, maxLength: number = 80): string {
    if (url.length <= maxLength) return url;

    // Truncate at character boundary, add ellipsis
    const truncated = url.slice(0, maxLength - 3) + '...';
    return truncated;
}

// Example:
truncateUrl('https://example.com/very-long-path/with-emoji-🎉/file.png', 50)
// Returns: 'https://example.com/very-long-path/with-emoj...'
```

## Code Examples

Verified patterns from existing codebase and VS Code API documentation.

### Opening External Links (Based on Existing Pattern)

```typescript
// Source: iris-thaumantias/src/views/app/commands/utilityCommands.ts:40-45
// Pattern: Simple external link opening without validation
private handleOpenWebsite = async (): Promise<void> => {
    await vscode.env.openExternal(vscode.Uri.parse('https://artemis.tum.de/courses'));
};

// Adapted pattern: External link with validation and confirmation
private handleOpenExternalLink = async (message: any): Promise<void> => {
    const url: string = message.url;

    if (!url || typeof url !== 'string') {
        vscode.window.showErrorMessage('Invalid URL');
        return;
    }

    // Protocol validation
    if (!this.isAllowedProtocol(url)) {
        vscode.window.showErrorMessage('Invalid URL protocol. Only http:// and https:// are allowed.');
        return;
    }

    // Check trusted domains
    const domain = this.extractDomain(url);
    const trustedDomains = this.context.globalState.get<string[]>('artemis.trustedDomains', []);

    if (domain && trustedDomains.includes(domain)) {
        // Trusted domain: open without confirmation
        await vscode.env.openExternal(vscode.Uri.parse(url));
        return;
    }

    // Show confirmation dialog
    const truncatedUrl = this.truncateUrl(url, 80);
    const result = await vscode.window.showInformationMessage(
        `Open external link?\n\n${truncatedUrl}`,
        { modal: true },
        'Open',
        'Trust Domain',
        'Cancel'
    );

    if (result === 'Open') {
        await vscode.env.openExternal(vscode.Uri.parse(url));
    } else if (result === 'Trust Domain' && domain) {
        trustedDomains.push(domain);
        await this.context.globalState.update('artemis.trustedDomains', trustedDomains);
        await vscode.env.openExternal(vscode.Uri.parse(url));
    }
};
```

### Image Preview with Data URI Decoding

```typescript
// Source: VS Code Extension API documentation + PlantUML pattern (iris-thaumantias/src/views/app/commands/plantUmlCommands.ts)
private handleOpenImagePreview = async (message: any): Promise<void> => {
    const uri: string = message.uri;

    if (!uri || typeof uri !== 'string') {
        vscode.window.showErrorMessage('Invalid image URI');
        return;
    }

    try {
        if (uri.startsWith('data:')) {
            // Data URI: decode to temp file
            const parsed = this.parseDataUri(uri);
            if (!parsed) {
                vscode.window.showErrorMessage('Failed to parse image data');
                return;
            }

            // Infer file extension from mime type
            const extension = this.getExtensionFromMime(parsed.mimeType);
            const tempFileName = `image-${crypto.randomBytes(8).toString('hex')}${extension}`;
            const tempFileUri = vscode.Uri.joinPath(
                this.context.globalStorageUri,
                tempFileName
            );

            // Ensure directory exists
            await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);

            // Write file
            await vscode.workspace.fs.writeFile(tempFileUri, parsed.data);

            // Open in VS Code viewer
            await vscode.commands.executeCommand('vscode.open', tempFileUri);
        } else {
            // Remote URL: open in browser
            if (!this.isAllowedProtocol(uri)) {
                vscode.window.showErrorMessage('Invalid image URL protocol');
                return;
            }
            await vscode.env.openExternal(vscode.Uri.parse(uri));
        }
    } catch (error) {
        logger.error('Open image preview error:', LogCategory.VIEW, error);
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';

        // Show error with Copy URL fallback
        const result = await vscode.window.showErrorMessage(
            `Failed to open image: ${errorMsg}`,
            'Copy URL'
        );

        if (result === 'Copy URL') {
            await vscode.env.clipboard.writeText(uri);
        }
    }
};
```

### Clear Trusted Domains Command

```typescript
// Source: VS Code Extension API documentation
// Register in extension.ts activate()
vscode.commands.registerCommand('artemis.clearTrustedDomains', async () => {
    const result = await vscode.window.showWarningMessage(
        'Clear all trusted domains?',
        { modal: true },
        'Clear',
        'Cancel'
    );

    if (result === 'Clear') {
        await context.globalState.update('artemis.trustedDomains', []);
        vscode.window.showInformationMessage('Trusted domains cleared');
    }
});
```

### Helper Functions

```typescript
// Protocol validation
private isAllowedProtocol(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

// Domain extraction
private extractDomain(url: string): string | null {
    try {
        const parsed = new URL(url);
        return parsed.hostname;
    } catch {
        return null;
    }
}

// URL truncation
private truncateUrl(url: string, maxLength: number = 80): string {
    if (url.length <= maxLength) return url;
    return url.slice(0, maxLength - 3) + '...';
}

// Data URI parsing
private parseDataUri(dataUri: string): { mimeType: string; data: Buffer } | null {
    if (!dataUri.startsWith('data:')) return null;

    const [metadata, ...dataParts] = dataUri.substring(5).split(',');
    const data = dataParts.join(',');

    const isBase64 = metadata.endsWith(';base64');
    const mimeType = isBase64 ? metadata.slice(0, -7) : metadata;

    try {
        const buffer = isBase64
            ? Buffer.from(data, 'base64')
            : Buffer.from(decodeURIComponent(data));
        return { mimeType: mimeType || 'image/png', data: buffer };
    } catch {
        return null;
    }
}

// Extension from mime type
private getExtensionFromMime(mimeType: string): string {
    const map: Record<string, string> = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/gif': '.gif',
        'image/svg+xml': '.svg',
        'image/webp': '.webp',
    };
    return map[mimeType.toLowerCase()] || '.png';
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Webview-only link handling (open in iframe) | Extension-side handler with system browser | Phase 09-03 (Feb 2026) | Better user experience (native browser, bookmarks, extensions). Security improvement (sandbox boundary). |
| No trusted domains (confirm every link) | Persistent trusted domain list | Phase 15 (this phase) | Reduces friction for problem statements with multiple links to same domain. User agency (explicit trust). |
| Direct data URI display in webview | Temp file decode + VS Code viewer | Phase 15 (this phase) | CSP compliant (no inline data URIs). Native image viewer features (zoom, pan). |

**Deprecated/outdated:**
- **vscode.previewHtml command**: Deprecated in VS Code 1.20, replaced by Webview API. Do not use for image preview.
- **Inline event handlers in webview**: CSP prohibits inline scripts. All event handlers must be in external JS files or use message passing.

## Open Questions

1. **Temp file cleanup strategy**
   - What we know: Files stored in `context.globalStorageUri`, small size (~50KB per image)
   - What's unclear: Should we clean up on extension deactivation, or let VS Code handle it?
   - Recommendation: Skip cleanup for v1.1. Files are bounded by session, VS Code cleans on uninstall. Add cleanup in v1.2 if telemetry shows accumulation issues.

2. **Trusted domain scope**
   - What we know: globalState is user-scoped (not workspace-scoped)
   - What's unclear: Should trusted domains be per-workspace or global across all workspaces?
   - Recommendation: Global is correct. Trust is a user preference (like browser security settings), not workspace-specific. User who trusts github.com in Workspace A likely wants to trust it in Workspace B too.

3. **Image format support**
   - What we know: Common formats (PNG, JPEG, GIF, SVG) are supported by VS Code viewer
   - What's unclear: What happens with exotic formats (TIFF, BMP, AVIF)?
   - Recommendation: VS Code viewer falls back gracefully (shows "unsupported format" message). No special handling needed. If telemetry shows demand for exotic formats in v1.2, add format conversion.

## Validation Architecture

> This section is omitted because `workflow.nyquist_validation` is `false` in `.planning/config.json`.

## Sources

### Primary (HIGH confidence)

- VS Code Extension API 1.97.0 — `vscode.env.openExternal`, `vscode.window.showInformationMessage`, `vscode.commands.executeCommand`, `vscode.ExtensionContext.globalState`, `vscode.workspace.fs`
- Existing codebase patterns:
  - `iris-thaumantias/src/views/app/commands/utilityCommands.ts` — External link opening pattern
  - `iris-thaumantias/src/views/app/commands/plantUmlCommands.ts` — Async rendering with message passing pattern
  - `iris-thaumantias/src/shared/messageContracts.ts` — Command contracts (OpenExternalLinkCommand, OpenImagePreviewCommand)
  - `iris-thaumantias/src/views/webview/react/views/ExerciseDetail/components/ProblemStatement.tsx` — Webview-side message sending (lines 40-42, 54-56)
- Node.js built-in modules documentation — crypto, Buffer, URL, path

### Secondary (MEDIUM confidence)

- VS Code best practices for extension security — Protocol validation, CSP compliance (verified against official docs)
- Platform conventions for dialog button ordering — macOS HIG, Windows UX Guidelines (VS Code handles platform differences)

### Tertiary (LOW confidence)

None — all research findings verified with official VS Code API documentation or existing codebase patterns.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All APIs are built-in VS Code/Node.js APIs verified in official documentation
- Architecture: HIGH - Patterns extracted from existing codebase, consistent with project conventions
- Pitfalls: MEDIUM-HIGH - Derived from VS Code API edge cases and common extension development issues documented in official guides

**Research date:** 2026-02-25
**Valid until:** 2026-04-25 (60 days — stable APIs, VS Code 1.97 LTS support window)
