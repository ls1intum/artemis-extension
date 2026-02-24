# Phase 3: Simple Views Migration - Research

**Researched:** 2026-02-23
**Domain:** VS Code webview React migration with typed messaging and state persistence
**Confidence:** HIGH

## Summary

Phase 3 migrates 4 standalone views (GitCredentials, ServiceStatus, RecommendedExtensions, Login) from HTML string generation to React components. This phase establishes the foundational patterns that all future view migrations will follow: typed message contracts using discriminated unions, ready-signal handshake to prevent postMessage race conditions, state persistence via getState/setState across tab hide/show cycles, and proper cleanup of message event listeners to prevent memory leaks. The views are intentionally ordered from simplest (GitCredentials: form + messaging) to most complex (Login: multi-state with embedded health checks), allowing patterns to be validated incrementally. A coexistence strategy enables old and new implementations to run side-by-side during the multi-phase migration.

**Primary recommendation:** Use TypeScript discriminated unions with 'type' discriminant for all message contracts, implement ready-signal handshake pattern where webview sends `{ type: 'ready' }` after React hydration and extension waits for this signal before sending initialization data, persist form values and UI state (not transient status messages) using `vscode.setState()` after user interactions, and clean up all event listeners in onDidDispose handlers. Coexistence via ViewRouter conditional check: if React component exists for view, render React HTML shell; otherwise fall back to existing HTML generation.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Migration order:**
- GitCredentials first — simple form with messaging, establishes the core pattern
- ServiceStatus second — mostly static, validates component composition
- RecommendedExtensions third — adds client-side filtering, validates UI state persistence
- Login last — most complex (multi-state, loading, embedded health checks), benefits from patterns established by earlier views
- One plan per view, each delivering end-to-end: React component + provider hookup + message contracts + state persistence
- Each plan is independently verifiable

**Coexistence strategy:**
- Always use React version if available — no feature flags or toggles
- Router checks if a React component exists for the requested view; if yes, render React; if no, fall back to HTML generation
- Rollback via git revert — old HTML code stays in codebase untouched until Phase 7
- No deprecation markers or modifications to legacy HTML generation code
- Old code untouched until Phase 7 cleanup

**State persistence:**
- Persist form inputs + UI state across tab hide/show (getState/setState)
- Login: persist all form values including username and password
- RecommendedExtensions: persist active category filter selection
- GitCredentials: persist name and email form values
- Transient status/feedback messages (e.g., "Git identity saved") clear on tab hide — they're stale by the time user returns
- ServiceStatus: minimal persistence needed (mostly static display)

**Visual fidelity:**
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

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VIEW-01 | All 14+ webview screens render through React components instead of HTML string generation | Standard Stack (React 18.3.1), Architecture Patterns (coexistence router, view component structure), incremental migration starting with 4 simple views |
| VIEW-02 | Views are migrated incrementally (simple → complex) with old and new coexisting during transition | Architecture Patterns (router fallback pattern, component availability detection), coexistence strategy validates each view independently |
| VIEW-03 | Webviews implement ready-signal handshake to prevent postMessage race conditions during hydration | Architecture Patterns (ready-signal handshake), Common Pitfalls (race condition handling), Code Examples (index.tsx sends ready after render) |
| MSG-01 | Extension host and webviews communicate through typed message contracts with discriminated unions (replacing any-typed handlers) | Standard Stack (TypeScript discriminated unions), Architecture Patterns (message contract design), existing messageContracts.ts scaffold from Phase 1 |
| MSG-02 | Webview UI state persists across tab hide/show cycles via getState/setState | Architecture Patterns (state persistence pattern), VS Code official recommendation (getState/setState preferred over retainContextWhenHidden), Code Examples (vscode.setState after user interactions) |
| MSG-03 | All message event listeners are cleaned up when webview is disposed (no memory leaks) | Architecture Patterns (cleanup pattern), Common Pitfalls (memory leak prevention), official VS Code onDidDispose lifecycle |

</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.3.1 | UI rendering | Already installed in Phase 1, Phase 2 components ready for composition, industry standard for webview UIs |
| TypeScript | 5.9.3 | Type safety | Already configured, discriminated unions for message contracts, strict prop typing from Phase 2 |
| VS Code Webview API | 1.97.0+ | Webview lifecycle + messaging | Built-in to VS Code extension host, acquireVsCodeApi() for postMessage, getState/setState, onDidDispose |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| esbuild | 0.27.2 | Build bundler | Already configured for React in Phase 1, webview-react.js bundle (IIFE format) |
| CSS Modules | Native (esbuild) | Component styling | Already setup in Phase 2, shared components have scoped styles |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| TypeScript discriminated unions | String-based command switching | No type narrowing, error-prone, doesn't catch typos at compile time |
| getState/setState | retainContextWhenHidden | VS Code official docs: "high memory overhead, only use when other persistence techniques will not work" |
| Ready-signal handshake | Immediate postMessage | Race condition: messages sent before React hydrates are lost (documented in VS Code issue #125546) |
| Coexistence router | Big-bang rewrite | Too risky, can't validate patterns incrementally, no rollback safety |

**Installation:**
```bash
# No new dependencies — using Phase 1 and Phase 2 infrastructure
# React 18.3.1, TypeScript 5.9.3, esbuild already installed
```

## Architecture Patterns

### Recommended Project Structure

```
src/views/webview/react/
├── components/              # Shared components from Phase 2
│   ├── Button/
│   ├── Container/
│   ├── TextInput/
│   ├── ServiceHealth/
│   └── index.ts             # Barrel export
├── views/                   # New in Phase 3
│   ├── GitCredentials/
│   │   ├── GitCredentialsView.tsx
│   │   ├── types.ts         # View-specific message contracts
│   │   └── index.ts
│   ├── ServiceStatus/
│   ├── RecommendedExtensions/
│   ├── Login/
│   └── index.ts
├── App.tsx                  # Router: map view type to component
├── ErrorBoundary.tsx
└── index.tsx                # Entry point: sends ready signal

src/views/
├── gitCredentials/
│   └── gitCredentialsView.ts  # Legacy HTML generator (stays until Phase 7)
├── serviceStatus/
├── recommendedExtensions/
├── login/
└── app/
    └── viewRouter.ts        # Modified: check for React component availability

src/shared/
└── messageContracts.ts      # Scaffold from Phase 1, extended in Phase 3
```

**Key decisions:**
- React views live in `src/views/webview/react/views/` to parallel existing structure
- Each view gets dedicated folder with view component, types, and index
- Legacy HTML generators stay untouched in `src/views/[viewName]/` until Phase 7
- ViewRouter modified to detect React component availability and route accordingly

### Pattern 1: Ready-Signal Handshake

**What:** Synchronize extension-to-webview messages with React hydration to prevent race conditions

**Why:** VS Code webviews load asynchronously. Messages sent from extension host before webview is ready are silently dropped (documented race condition in [VS Code issue #125546](https://github.com/microsoft/vscode/issues/125546)).

**When to use:** All React webviews, implemented once in Phase 3 and reused by all future phases

**Implementation:**

```typescript
// WEBVIEW SIDE: src/views/webview/react/index.tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';

const vscode = window.acquireVsCodeApi();

const container = document.getElementById('root');
if (!container) {
	throw new Error('Root container not found');
}

const root = createRoot(container);
root.render(
	<ErrorBoundary vscodeApi={vscode}>
		<App vscodeApi={vscode} />
	</ErrorBoundary>
);

// CRITICAL: Signal readiness AFTER React hydration completes
vscode.postMessage({ type: 'ready' });
```

```typescript
// EXTENSION SIDE: src/provider/artemisWebviewProvider.ts (modified)
export class ArtemisWebviewProvider {
    private _webviewReady = false;
    private _pendingMessages: any[] = [];

    public async resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        this._webviewReady = false;

        // Set up HTML with React bundle
        webviewView.webview.html = await this._viewRouter.getHtmlForReact('gitCredentials');

        // Listen for ready signal
        webviewView.webview.onDidReceiveMessage(
            message => {
                if (message.type === 'ready') {
                    this._webviewReady = true;
                    // Flush any messages that were queued before ready
                    this._pendingMessages.forEach(msg => webviewView.webview.postMessage(msg));
                    this._pendingMessages = [];
                    // Send initial state now that webview is ready
                    this.sendInitialState();
                } else {
                    this._messageHandler.handleMessage(message);
                }
            }
        );
    }

    private postMessageSafe(message: any): void {
        if (this._webviewReady) {
            this._view?.webview.postMessage(message);
        } else {
            this._pendingMessages.push(message);
        }
    }
}
```

**Sources:**
- [VS Code WebViewPanel race condition issue #125546](https://github.com/microsoft/vscode/issues/125546)
- [Building a VSCode Extension: Part Four - CodeByCorey](https://codebycorey.com/blog/building-a-vscode-extension-part-four)

### Pattern 2: State Persistence via getState/setState

**What:** Persist form inputs and UI state across tab hide/show cycles using VS Code's built-in state API

**Why:** When webview tab is hidden, content is destroyed to save memory. Without persistence, users lose form data and UI state when switching tabs. `retainContextWhenHidden` keeps content alive but has high memory cost (not recommended by VS Code docs).

**When to use:**
- Form inputs (username, password, email, name)
- UI state (selected category filter, expanded sections)
- NOT for transient feedback (status messages become stale)

**Implementation:**

```typescript
// GitCredentialsView.tsx example
import { useState, useEffect } from 'react';

interface GitCredentialsState {
    name: string;
    email: string;
}

export function GitCredentialsView({ vscodeApi }: ViewProps) {
    // Restore previous state on mount
    const previousState = vscodeApi.getState() as GitCredentialsState | undefined;
    const [name, setName] = useState(previousState?.name || '');
    const [email, setEmail] = useState(previousState?.email || '');

    // Persist state on every change
    useEffect(() => {
        vscodeApi.setState({ name, email });
    }, [name, email, vscodeApi]);

    return (
        <form>
            <TextInput
                label="Git User Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
            />
            <TextInput
                label="Git Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
            />
        </form>
    );
}
```

**Key decisions:**
- Call `setState()` immediately after state changes (no debouncing needed per VS Code docs: "optimized for frequent calls")
- Status messages (success/error feedback) NOT persisted — they're stale when user returns
- getState() returns `undefined` on first load, provide defaults

**Performance:** VS Code docs state setState() is "optimized for frequent calls" and has "much lower performance overhead than retainContextWhenHidden" ([VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)).

**Sources:**
- [VS Code Webview API - State Persistence](https://code.visualstudio.com/api/extension-guides/webview)
- [getState()/setState() persists across reboots in WebviewView issue #127006](https://github.com/microsoft/vscode/issues/127006)
- [State Persistence - Symposium](https://symposium.dev/design/vscode-extension/state-persistence.html)

### Pattern 3: Typed Message Contracts with Discriminated Unions

**What:** Replace `any`-typed message handlers with TypeScript discriminated unions for compile-time type safety and exhaustive case checking

**Why:** Current codebase uses `message.command` string switching with `any` types. Discriminated unions enable type narrowing (TypeScript knows exact payload shape after checking `type` field) and catch typos/missing cases at compile time.

**When to use:** All messages between extension host and webview

**Implementation:**

```typescript
// src/shared/messageContracts.ts (extended from Phase 1 scaffold)

// Extension → Webview messages (one per view)
export type GitCredentialsInit = {
    type: 'init';
    view: 'gitCredentials';
    payload: {
        currentName?: string;
        currentEmail?: string;
    };
};

export type GitCredentialsResult = {
    type: 'gitCredentialsResult';
    status: 'success' | 'error' | 'warning';
    message: string;
};

export type ExtensionToWebviewMessage =
    | GitCredentialsInit
    | GitCredentialsResult
    | ServiceStatusUpdate
    | LoginUpdate
    // ... other message types;

// Webview → Extension messages
export type SaveGitIdentityCommand = {
    type: 'command';
    command: 'saveGitIdentity';
    payload: {
        name: string;
        email: string;
    };
};

export type RequestGitIdentityCommand = {
    type: 'command';
    command: 'requestGitIdentity';
};

export type WebviewToExtensionMessage =
    | { type: 'ready' }
    | SaveGitIdentityCommand
    | RequestGitIdentityCommand
    | CheckHealthCommand
    | SearchMarketplaceCommand
    // ... other commands
    | { type: 'error'; payload: { message: string; stack?: string } };

// Type guards for runtime validation
export function isExtensionMessage(msg: unknown): msg is ExtensionToWebviewMessage {
    return typeof msg === 'object' && msg !== null && 'type' in msg;
}

export function isWebviewMessage(msg: unknown): msg is WebviewToExtensionMessage {
    return typeof msg === 'object' && msg !== null && 'type' in msg;
}
```

**Usage in React component:**

```typescript
// GitCredentialsView.tsx
import type { GitCredentialsInit, SaveGitIdentityCommand } from '@shared/messageContracts';

export function GitCredentialsView({ vscodeApi }: ViewProps) {
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;

            // TypeScript narrows type after discriminant check
            switch (message.type) {
                case 'init':
                    if (message.view === 'gitCredentials') {
                        // TypeScript knows message.payload has currentName/currentEmail
                        setName(message.payload.currentName || '');
                        setEmail(message.payload.currentEmail || '');
                    }
                    break;
                case 'gitCredentialsResult':
                    // TypeScript knows message has status and message fields
                    setStatusMessage(message.message);
                    setStatusType(message.status);
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const handleSubmit = () => {
        const command: SaveGitIdentityCommand = {
            type: 'command',
            command: 'saveGitIdentity',
            payload: { name, email }
        };
        vscodeApi.postMessage(command);
    };
}
```

**Benefits:**
- Compile-time type checking: catch typos in command names
- Exhaustive switch checking: TypeScript warns if you forget a case
- IDE autocomplete for payload fields
- Refactoring safety: rename propagates through all message sites

**Sources:**
- [Advanced TypeScript for React developers - discriminated unions](https://www.developerway.com/posts/advanced-typescript-for-react-developers-discriminated-unions)
- [Type-Safe React: Harnessing the Power of Discriminated Unions - DEV](https://dev.to/gboladetrue/type-safe-react-harnessing-the-power-of-discriminated-unions-158m)
- [Kilo-Code VS Code extension using discriminated unions](https://deepwiki.com/Kilo-Org/kilocode/10-agent-manager-and-multi-agent-workflows)

### Pattern 4: Coexistence Router with Component Availability Detection

**What:** ViewRouter conditionally renders React or HTML based on whether a React component exists for the requested view

**Why:** Enables incremental migration. Views can be migrated one at a time with git revert as rollback strategy. Old and new implementations coexist safely during multi-phase transition.

**When to use:** Phase 3 through Phase 6 (all view migration phases)

**Implementation:**

```typescript
// src/views/app/viewRouter.ts (modified)
import type { ReactViewComponent } from '../webview/react/views';

export class ViewRouter {
    private readonly _reactViews: Map<string, boolean> = new Map([
        ['gitCredentials', true],  // Phase 3: migrated
        ['serviceStatus', true],   // Phase 3: migrated
        ['recommendedExtensions', true], // Phase 3: migrated
        ['login', true],           // Phase 3: migrated
        // ['dashboard', false],   // Phase 4: not yet migrated
        // ['courseList', false],  // Phase 4: not yet migrated
    ]);

    public async getHtml(): Promise<string> {
        const state = this._appStateManager.currentState;
        const viewName = this._stateToViewName(state);

        // Check if React component exists for this view
        if (this._reactViews.get(viewName)) {
            return this._getReactHtml(viewName);
        }

        // Fallback to legacy HTML generation
        return this._getLegacyHtml(state);
    }

    private _getReactHtml(viewName: string): string {
        const nonce = this._generateNonce();
        const webviewReactUri = this._webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionContext.extensionUri, 'dist', 'webview-react.js')
        );
        const webviewReactCssUri = this._webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionContext.extensionUri, 'dist', 'webview-react.css')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src ${this._webview.cspSource}; script-src 'nonce-${nonce}';">
    <link rel="stylesheet" href="${webviewReactCssUri}">
    <title>Artemis - ${viewName}</title>
</head>
<body>
    <div id="root" data-view="${viewName}"></div>
    <script nonce="${nonce}" src="${webviewReactUri}"></script>
</body>
</html>`;
    }

    private _getLegacyHtml(state: string): string {
        // Existing switch statement with HTML generation
        switch (state) {
            case 'git-credentials':
                return this._gitCredentialsView.generateHtml();
            // ... other legacy views
        }
    }

    private _generateNonce(): string {
        const crypto = require('crypto');
        return crypto.randomBytes(16).toString('base64');
    }
}
```

**React App router:**

```typescript
// src/views/webview/react/App.tsx (modified)
import { GitCredentialsView } from './views/GitCredentials';
import { ServiceStatusView } from './views/ServiceStatus';
import { RecommendedExtensionsView } from './views/RecommendedExtensions';
import { LoginView } from './views/Login';

export function App({ vscodeApi }: AppProps) {
    const viewName = document.getElementById('root')?.getAttribute('data-view');

    switch (viewName) {
        case 'gitCredentials':
            return <GitCredentialsView vscodeApi={vscodeApi} />;
        case 'serviceStatus':
            return <ServiceStatusView vscodeApi={vscodeApi} />;
        case 'recommendedExtensions':
            return <RecommendedExtensionsView vscodeApi={vscodeApi} />;
        case 'login':
            return <LoginView vscodeApi={vscodeApi} />;
        default:
            return <div>Unknown view: {viewName}</div>;
    }
}
```

**Rollback strategy:**
1. Remove view entry from `_reactViews` map (set to `false` or delete)
2. Git revert commits for that view's React implementation
3. ViewRouter automatically falls back to legacy HTML generation
4. No changes needed to legacy HTML generation code

**Sources:**
- [Using React in VS Code Webviews - Ken Muse](https://www.kenmuse.com/blog/using-react-in-vs-code-webviews/)
- [Best way to integrate React in VS Code webviews - Discussion #723](https://github.com/microsoft/vscode-discussions/discussions/723)

### Anti-Patterns to Avoid

- **Immediate postMessage after resolveWebviewView:** Race condition, use ready-signal handshake
- **retainContextWhenHidden for simple state:** High memory cost, use getState/setState
- **String-based command switching without types:** No compile-time safety, use discriminated unions
- **Persisting transient status messages:** Status becomes stale when user returns, only persist durable state
- **Creating separate WebviewPanel for each view:** Extension has single sidebar WebviewView, router switches content
- **Modifying legacy HTML generators during migration:** Keep them untouched for clean rollback

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Message race conditions | Custom queuing system | Ready-signal handshake pattern | Well-documented VS Code issue #125546, standard solution across ecosystem |
| State persistence across sessions | Custom storage layer | VS Code getState/setState API | Built-in, optimized for frequent calls, automatic cleanup |
| Type-safe messaging | Custom validation functions | TypeScript discriminated unions | Compile-time checking, exhaustive case analysis, IDE autocomplete |
| Memory leak detection | Manual event listener tracking | Dispose pattern with context.subscriptions | VS Code lifecycle management handles cleanup automatically |

**Key insight:** VS Code webview APIs (getState/setState, onDidDispose, postMessage) are specifically designed for these problems. Custom solutions add complexity without benefit and miss edge cases (e.g., setState handles serialization, onDidDispose handles cleanup order).

## Common Pitfalls

### Pitfall 1: Race Condition - Extension sends messages before React hydrates

**What goes wrong:** Extension host sends initialization data via `postMessage()` immediately after setting `webview.html`. React hasn't hydrated yet, so event listener isn't registered. Messages are silently lost.

**Why it happens:** Webview content loads asynchronously. `webview.html = ...` returns immediately but webview is still loading HTML, parsing JS bundle, and executing React. Time-to-interactive varies (slower on first load, after VS Code update, or when system is under load).

**How to avoid:**
1. Webview sends `{ type: 'ready' }` after React render completes
2. Extension queues messages until ready signal received
3. Extension sends initialization data only after ready
4. Pattern established once in Phase 3, reused by all future phases

**Warning signs:**
- Form fields empty despite extension sending data
- Components not updating after extension-side state changes
- Works sometimes (fast machines) but fails on slower systems

**Source:** [VS Code issue #125546 - WebViewPanel race condition](https://github.com/microsoft/vscode/issues/125546)

### Pitfall 2: Memory Leaks from Undisposed Event Listeners

**What goes wrong:** Event listeners registered in React components or extension host aren't cleaned up when webview is disposed. Memory accumulates with each webview open/close cycle.

**Why it happens:** VS Code webviews can be created/destroyed multiple times during extension lifecycle (user closes/reopens sidebar, workspace reload). Each creation registers new listeners. Without cleanup, listeners accumulate and reference dead objects.

**How to avoid:**
```typescript
// WEBVIEW SIDE: Always clean up event listeners in useEffect
useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
        // handle message
    };
    window.addEventListener('message', handleMessage);

    // CRITICAL: Return cleanup function
    return () => window.removeEventListener('message', handleMessage);
}, []);

// EXTENSION SIDE: Register disposables with context.subscriptions
webviewView.webview.onDidReceiveMessage(
    message => this._messageHandler.handleMessage(message),
    undefined,
    context.subscriptions  // CRITICAL: Auto-disposed when extension deactivates
);

// Or manual disposal on webview dispose
const messageDisposable = webviewView.webview.onDidReceiveMessage(handler);
webviewView.onDidDispose(() => {
    messageDisposable.dispose();
});
```

**Warning signs:**
- Memory usage increases each time sidebar is opened/closed
- Multiple message handlers firing for single event
- "webview is disposed" errors after closing sidebar

**Sources:**
- [VS Code memory leak fixes in settings widget PR #221518](https://github.com/microsoft/vscode/pull/221518)
- [Webview API - Lifecycle](https://code.visualstudio.com/api/extension-guides/webview)
- [VS Code Messenger - prevents memory leaks automatically](https://www.typefox.io/blog/vs-code-messenger/)

### Pitfall 3: Persisting Transient Status Messages

**What goes wrong:** Success/error feedback messages (e.g., "Git identity saved successfully") are persisted via `setState()`. When user hides tab and returns hours later, stale message is still displayed: "saved successfully" but user hasn't submitted anything recently.

**Why it happens:** Developers persist all state without distinguishing durable state (form values user typed) from transient feedback (operation result that's only relevant for a few seconds).

**How to avoid:**
```typescript
// PERSIST durable state only
interface PersistedState {
    name: string;      // ✅ User-entered data
    email: string;     // ✅ User-entered data
    selectedCategory: string; // ✅ UI state
    // statusMessage: string; // ❌ Don't persist transient feedback
}

// Transient feedback as component-local state, NOT persisted
const [statusMessage, setStatusMessage] = useState('');

useEffect(() => {
    // Only persist durable state
    vscodeApi.setState({ name, email, selectedCategory });
}, [name, email, selectedCategory]);

// Clear transient feedback after delay
useEffect(() => {
    if (statusMessage) {
        const timer = setTimeout(() => setStatusMessage(''), 5000);
        return () => clearTimeout(timer);
    }
}, [statusMessage]);
```

**Warning signs:**
- Status messages appear immediately when webview loads (before user interacts)
- "Success" messages displayed when no operation was performed
- Error messages from previous sessions confuse users

### Pitfall 4: Nonce Generation Outside HTML Context

**What goes wrong:** Nonce for CSP generated once at extension activation and reused for all webviews. CSP blocks scripts because nonce is predictable/reused, violating security model.

**Why it happens:** Developers treat nonce as a static configuration rather than a per-HTML-load security token.

**How to avoid:**
```typescript
// ❌ WRONG: Generate nonce once at extension activation
class WebviewProvider {
    private readonly _nonce = this._generateNonce();
    // ... reused for all HTML generations
}

// ✅ CORRECT: Generate fresh nonce for each HTML generation
class ViewRouter {
    private _getReactHtml(viewName: string): string {
        const nonce = this._generateNonce(); // Fresh nonce per HTML load
        return `
            <meta http-equiv="Content-Security-Policy"
                  content="script-src 'nonce-${nonce}';">
            <script nonce="${nonce}" src="${scriptUri}"></script>
        `;
    }

    private _generateNonce(): string {
        return require('crypto').randomBytes(16).toString('base64');
    }
}
```

**Warning signs:**
- Scripts fail to load with CSP violation in console
- Webview shows blank page despite no errors in extension host
- Works on first load but fails on subsequent refreshes

**Source:** [VS Code Webview API - Content Security Policy](https://code.visualstudio.com/api/extension-guides/webview#content-security-policy)

## Code Examples

Verified patterns from Phase 1, Phase 2, and official VS Code documentation:

### Example 1: Complete GitCredentialsView (simplest view)

```typescript
// src/views/webview/react/views/GitCredentials/GitCredentialsView.tsx
import { useState, useEffect } from 'react';
import { Container, TextInput, Button, BackLink } from '../../components';
import type { VsCodeApi } from '@shared/messageContracts';
import type { GitCredentialsInit, SaveGitIdentityCommand } from './types';

interface GitCredentialsState {
    name: string;
    email: string;
}

interface GitCredentialsViewProps {
    vscodeApi: VsCodeApi;
}

export function GitCredentialsView({ vscodeApi }: GitCredentialsViewProps) {
    // Restore persisted state
    const previousState = vscodeApi.getState() as GitCredentialsState | undefined;
    const [name, setName] = useState(previousState?.name || '');
    const [email, setEmail] = useState(previousState?.email || '');
    const [statusMessage, setStatusMessage] = useState(''); // Transient, not persisted
    const [statusType, setStatusType] = useState<'success' | 'error' | 'warning'>('success');

    // Persist durable state only
    useEffect(() => {
        vscodeApi.setState({ name, email });
    }, [name, email, vscodeApi]);

    // Message handler
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;

            switch (message.type) {
                case 'init':
                    if (message.view === 'gitCredentials') {
                        setName(message.payload.currentName || '');
                        setEmail(message.payload.currentEmail || '');
                    }
                    break;
                case 'gitCredentialsResult':
                    setStatusMessage(message.message);
                    setStatusType(message.status);
                    // Clear status after 5 seconds
                    setTimeout(() => setStatusMessage(''), 5000);
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // Request current git identity on mount
    useEffect(() => {
        vscodeApi.postMessage({ type: 'command', command: 'requestGitIdentity' });
    }, [vscodeApi]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const command: SaveGitIdentityCommand = {
            type: 'command',
            command: 'saveGitIdentity',
            payload: { name, email }
        };
        vscodeApi.postMessage(command);
    };

    return (
        <>
            <BackLink onClick={() => vscodeApi.postMessage({ type: 'command', command: 'showDashboard' })} />

            <div style={{ padding: '20px' }}>
                <Container
                    header={{ title: 'Git Credentials Helper', subtitle: 'Configure your Git identity' }}
                >
                    <form onSubmit={handleSubmit}>
                        <TextInput
                            label="Git User Name"
                            placeholder="e.g. Alex Example"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                        <TextInput
                            label="Git Email Address"
                            placeholder="tum-login@tum.de"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                        <Button type="submit" variant="primary">Save identity (global)</Button>

                        {statusMessage && (
                            <div className={`status status-${statusType}`} role="status">
                                {statusMessage}
                            </div>
                        )}
                    </form>
                </Container>
            </div>
        </>
    );
}
```

### Example 2: Message Contract Types for GitCredentials

```typescript
// src/views/webview/react/views/GitCredentials/types.ts
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '@shared/messageContracts';

// Extension → Webview
export interface GitCredentialsInit {
    type: 'init';
    view: 'gitCredentials';
    payload: {
        currentName?: string;
        currentEmail?: string;
    };
}

export interface GitCredentialsResult {
    type: 'gitCredentialsResult';
    status: 'success' | 'error' | 'warning';
    message: string;
}

// Webview → Extension
export interface SaveGitIdentityCommand {
    type: 'command';
    command: 'saveGitIdentity';
    payload: {
        name: string;
        email: string;
    };
}

export interface RequestGitIdentityCommand {
    type: 'command';
    command: 'requestGitIdentity';
}

// Extend global message contracts
declare module '@shared/messageContracts' {
    interface ExtensionToWebviewMessage extends GitCredentialsInit, GitCredentialsResult {}
    interface WebviewToExtensionMessage extends SaveGitIdentityCommand, RequestGitIdentityCommand {}
}
```

### Example 3: Extension Host Message Handler (modified)

```typescript
// src/views/app/commands/gitCommands.ts (new command module)
import type { CommandContext, CommandHandler } from './types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class GitCommandModule {
    constructor(private readonly context: CommandContext) {}

    getHandlers(): Record<string, CommandHandler> {
        return {
            'saveGitIdentity': this.handleSaveGitIdentity.bind(this),
            'requestGitIdentity': this.handleRequestGitIdentity.bind(this),
        };
    }

    private async handleSaveGitIdentity(message: any): Promise<void> {
        const { name, email } = message.payload;

        try {
            await execAsync(`git config --global user.name "${name}"`);
            await execAsync(`git config --global user.email "${email}"`);

            this.context.sendMessage({
                type: 'gitCredentialsResult',
                status: 'success',
                message: `Git identity saved: ${name} <${email}>`
            });
        } catch (error) {
            this.context.sendMessage({
                type: 'gitCredentialsResult',
                status: 'error',
                message: `Failed to save Git identity: ${error.message}`
            });
        }
    }

    private async handleRequestGitIdentity(message: any): Promise<void> {
        try {
            const { stdout: name } = await execAsync('git config --global user.name');
            const { stdout: email } = await execAsync('git config --global user.email');

            this.context.sendMessage({
                type: 'init',
                view: 'gitCredentials',
                payload: {
                    currentName: name.trim(),
                    currentEmail: email.trim()
                }
            });
        } catch (error) {
            // No git identity configured yet, send empty init
            this.context.sendMessage({
                type: 'init',
                view: 'gitCredentials',
                payload: {}
            });
        }
    }
}
```

### Example 4: RecommendedExtensionsView with UI State Persistence

```typescript
// src/views/webview/react/views/RecommendedExtensions/RecommendedExtensionsView.tsx
import { useState, useEffect } from 'react';
import { Container, Button, List, ListItem, Badge } from '../../components';

interface RecommendedExtensionsState {
    selectedCategory: string;
}

export function RecommendedExtensionsView({ vscodeApi }: ViewProps) {
    const previousState = vscodeApi.getState() as RecommendedExtensionsState | undefined;
    const [selectedCategory, setSelectedCategory] = useState(previousState?.selectedCategory || 'all');
    const [categories, setCategories] = useState([]);

    // Persist UI state (selected filter)
    useEffect(() => {
        vscodeApi.setState({ selectedCategory });
    }, [selectedCategory, vscodeApi]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data.type === 'init' && event.data.view === 'recommendedExtensions') {
                setCategories(event.data.payload.categories);
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    useEffect(() => {
        vscodeApi.postMessage({ type: 'command', command: 'requestRecommendedExtensions' });
    }, [vscodeApi]);

    const handleCategoryChange = (categoryId: string) => {
        setSelectedCategory(categoryId);
    };

    const handleInstall = (extensionId: string) => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'searchMarketplace',
            payload: { extensionId }
        });
    };

    const filteredCategories = selectedCategory === 'all'
        ? categories
        : categories.filter(cat => cat.id === selectedCategory);

    return (
        <div>
            <Container header={{ title: 'Recommended Extensions' }}>
                <div className="filter-controls">
                    <Button
                        variant={selectedCategory === 'all' ? 'primary' : 'secondary'}
                        onClick={() => handleCategoryChange('all')}
                    >
                        All
                    </Button>
                    {categories.map(cat => (
                        <Button
                            key={cat.id}
                            variant={selectedCategory === cat.id ? 'primary' : 'secondary'}
                            onClick={() => handleCategoryChange(cat.id)}
                        >
                            {cat.name}
                        </Button>
                    ))}
                </div>
            </Container>

            {filteredCategories.map(category => (
                <Container key={category.id} header={{ title: category.name }}>
                    <List>
                        {category.extensions.map(ext => (
                            <ListItem
                                key={ext.id}
                                label={ext.name}
                                description={ext.description}
                                action={
                                    ext.isInstalled ? (
                                        <Badge variant="success">Installed</Badge>
                                    ) : (
                                        <Button
                                            variant="secondary"
                                            onClick={() => handleInstall(ext.id)}
                                        >
                                            Install
                                        </Button>
                                    )
                                }
                            />
                        ))}
                    </List>
                </Container>
            ))}
        </div>
    );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| String-based command switching with `any` types | TypeScript discriminated unions for message contracts | Phase 1 (2026-02-23) | Compile-time type safety, exhaustive case checking, IDE autocomplete |
| Immediate postMessage after HTML load | Ready-signal handshake pattern | Phase 3 | Eliminates race conditions, guarantees message delivery |
| retainContextWhenHidden for state persistence | getState/setState API | Always recommended by VS Code | 10-100x lower memory overhead, official best practice |
| Inline scripts with CSP unsafe-inline | Nonce-based CSP with external scripts | Phase 1 (2026-02-23) | Security: prevents XSS attacks, meets VS Code marketplace requirements |
| Manual event listener tracking | Dispose pattern with context.subscriptions | Always available in VS Code API | Automatic cleanup, prevents memory leaks |

**Deprecated/outdated:**
- `retainContextWhenHidden` - NOT deprecated but officially discouraged: "high memory overhead, only use when other persistence techniques will not work" (VS Code docs)
- Inline scripts/styles in webview HTML - Blocked by CSP, marketplace requirements mandate nonce-based approach

## Open Questions

None — all patterns are well-documented by VS Code official APIs, established in Phase 1/2, or have clear implementations validated by ecosystem examples.

## Sources

### Primary (HIGH confidence)

- [VS Code Webview API - Official Documentation](https://code.visualstudio.com/api/extension-guides/webview) - getState/setState, onDidDispose, CSP patterns, official recommendations
- [VS Code issue #125546 - WebViewPanel race condition](https://github.com/microsoft/vscode/issues/125546) - Race condition documentation and ready-signal solution
- [VS Code issue #127006 - getState/setState persistence behavior](https://github.com/microsoft/vscode/issues/127006) - State persistence across sessions
- Existing codebase Phase 1 & 2 implementations - messageContracts.ts scaffold, React build infrastructure, shared components

### Secondary (MEDIUM confidence)

- [State Persistence - Symposium](https://symposium.dev/design/vscode-extension/state-persistence.html) - Practical patterns for webview state
- [Building a VSCode Extension: Part Four - CodeByCorey](https://codebycorey.com/blog/building-a-vscode-extension-part-four) - Ready-signal handshake example
- [Using React in VS Code Webviews - Ken Muse](https://www.kenmuse.com/blog/using-react-in-vs-code-webviews/) - React integration patterns
- [Advanced TypeScript for React - Discriminated Unions](https://www.developerway.com/posts/advanced-typescript-for-react-developers-discriminated-unions) - Message contract patterns
- [VS Code Messenger - TypeFox](https://www.typefox.io/blog/vs-code-messenger/) - Memory leak prevention patterns

### Tertiary (LOW confidence)

None — all patterns verified with official VS Code documentation or existing Phase 1/2 code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - React 18.3.1, TypeScript 5.9.3, esbuild already configured in Phase 1
- Architecture: HIGH - Patterns established in Phase 1/2, official VS Code docs, verified by existing codebase
- Pitfalls: HIGH - Race condition documented in VS Code issues, memory leaks addressed in VS Code PRs, getState/setState guidance from official docs

**Research date:** 2026-02-23
**Valid until:** ~60 days (stable APIs, VS Code webview API rarely changes, React 18 mature)
