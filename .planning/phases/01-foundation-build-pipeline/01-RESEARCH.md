# Phase 1: Foundation & Build Pipeline - Research

**Researched:** 2026-02-23
**Domain:** VS Code webview React build infrastructure (esbuild, CSP, TypeScript)
**Confidence:** HIGH

## Summary

Phase 1 establishes the React build pipeline for webview migration by configuring dual-target esbuild builds (Node.js CJS for extension host, browser IIFE for webviews), implementing nonce-based Content Security Policy, adding React error boundaries, and scaffolding typed message contracts.

The existing extension already uses esbuild 0.27.2 with a dual-target setup (extension.ts → CJS, webview/components.ts → IIFE), but currently generates HTML via string templates with inline scripts/styles. The migration requires: (1) adding React to the webview build target, (2) introducing nonce generation for CSP enforcement, (3) wrapping React trees with error boundaries, and (4) replacing `any`-typed message handlers with TypeScript discriminated unions.

This phase delivers **pure infrastructure** — no views are migrated. All subsequent phases depend on these foundations being production-ready.

**Primary recommendation:** Extend the existing esbuild.js configuration with a third build context for React webviews, leverage React 18.3.1 for stable webview compatibility (avoiding React 19's breaking changes), use the VS Code sample getNonce pattern for CSP, and adopt discriminated unions with a `type` discriminant property for all message contracts.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None — user deferred all implementation decisions to Claude.

### Claude's Discretion
User granted full flexibility on:
- **Build tooling configuration** — How dual-target builds are structured (esbuild config, entry points, output paths)
- **CSP implementation** — Nonce generation and injection approach for webview HTML, ensuring no inline scripts or styles
- **Error boundary design** — Fallback UI when React rendering fails (error message, retry mechanism, detail level)
- **Message bridge scaffold** — Type structure for extension-webview communication (discriminated unions, base types, handshake pattern)
- **Build coexistence** — How React bundles sit alongside existing HTML generation during the multi-phase transition
- **Project structure** — Where React source files, shared types, and build outputs live

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BUILD-01 | Extension builds React webview bundles alongside extension host with dual-target configuration (Node.js CJS + browser IIFE) | Existing esbuild setup provides foundation; React requires new build context with React JSX transform, external React dependencies not applicable (webview is sandboxed) |
| BUILD-02 | Webviews enforce nonce-based Content Security Policy with no inline scripts or styles | VS Code samples provide getNonce() pattern; CSP meta tag uses webview.cspSource + nonce for script-src/style-src; React must load via external script tags with nonce attribute |
| BUILD-03 | React error boundaries wrap all view components to catch rendering errors gracefully | React 18 error boundaries use class components with componentDidCatch and getDerivedStateFromError; fallback UI should use VS Code CSS variables for theme compliance |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.3.1 | UI component framework | Latest stable before React 19 breaking changes; includes deprecation warnings for smoother future upgrades; proven in webview environments |
| React DOM | 18.3.1 | React rendering for browser | Matches React core version; provides createRoot API for React 18 concurrent features |
| TypeScript | 5.9.3 | Type safety and tooling | Already in project; discriminated unions enable type-safe message contracts |
| esbuild | 0.27.2 | Build tool and bundler | Already in project; extremely fast (bundles React apps in < 2 seconds); automatic tree-shaking when minify enabled |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/react | 18.3.x | TypeScript definitions for React | Development only (devDependency) |
| @types/react-dom | 18.3.x | TypeScript definitions for React DOM | Development only (devDependency) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| React 18.3.1 | React 19 | React 19 has breaking changes (removed deprecated APIs); 18.3.1 provides deprecation warnings as stepping stone |
| esbuild | webpack/Vite | esbuild already integrated; 10-100x faster than webpack; simpler dual-target config than Vite |
| Discriminated unions | string constants | Unions provide exhaustive type checking; TypeScript narrows types automatically after discriminant check |

**Installation:**
```bash
npm install react@18.3.1 react-dom@18.3.1
npm install --save-dev @types/react@18.3 @types/react-dom@18.3
```

## Architecture Patterns

### Recommended Project Structure
```
iris-thaumantias/
├── src/
│   ├── extension.ts              # Extension host (Node.js CJS)
│   ├── shared/                   # NEW: Shared between host and webview
│   │   └── messageContracts.ts   # Discriminated union types
│   ├── views/
│   │   ├── webview/
│   │   │   ├── components.ts      # Existing IIFE bundle
│   │   │   └── react/            # NEW: React webview entry
│   │   │       ├── index.tsx      # React entry point (createRoot)
│   │   │       ├── App.tsx        # Root component with ErrorBoundary
│   │   │       └── ErrorFallback.tsx  # Error boundary fallback UI
│   │   ├── app/
│   │   │   └── viewRouter.ts      # Keep during transition
│   │   └── [views]/               # Existing HTML generation (migrate later)
│   └── utils/
│       └── webviewHelpers.ts      # NEW: getNonce(), getWebviewHtml()
├── dist/
│   ├── extension.js               # Extension host bundle (CJS)
│   ├── webview-components.js      # Existing components (IIFE)
│   └── webview-react.js           # NEW: React bundle (IIFE)
└── esbuild.js                     # Build configuration
```

### Pattern 1: Dual-Target esbuild Configuration

**What:** Three separate esbuild contexts in watch/build mode — extension (Node.js CJS), existing webview components (browser IIFE), and new React webview (browser IIFE with JSX)

**When to use:** This phase (BUILD-01)

**Example:**
```javascript
// Source: Official esbuild API docs (https://esbuild.github.io/api/)
// Adapted from Complete Guide to Setting Up React with TypeScript and esbuild (2026)

async function main() {
  // 1. Extension host (Node.js)
  const extensionCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'], // VS Code runtime provides this
    minify: production,
    sourcemap: !production,
  });

  // 2. Existing webview components (Browser IIFE)
  const webviewComponentsCtx = await esbuild.context({
    entryPoints: ['src/views/webview/components.ts'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    outfile: 'dist/webview-components.js',
    minify: production,
    sourcemap: !production,
  });

  // 3. NEW: React webview (Browser IIFE + JSX)
  const webviewReactCtx = await esbuild.context({
    entryPoints: ['src/views/webview/react/index.tsx'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    outfile: 'dist/webview-react.js',
    loader: { '.tsx': 'tsx', '.ts': 'ts' },
    minify: production,
    sourcemap: !production,
    define: {
      'process.env.NODE_ENV': production ? '"production"' : '"development"'
    },
    // Tree shaking enabled automatically when minify: true
  });

  if (watch) {
    await Promise.all([
      extensionCtx.watch(),
      webviewComponentsCtx.watch(),
      webviewReactCtx.watch()
    ]);
  } else {
    await Promise.all([
      extensionCtx.rebuild(),
      webviewComponentsCtx.rebuild(),
      webviewReactCtx.rebuild()
    ]);
    await Promise.all([
      extensionCtx.dispose(),
      webviewComponentsCtx.dispose(),
      webviewReactCtx.dispose()
    ]);
  }
}
```

**Key points:**
- All three contexts share `production` and `watch` flags
- React bundle requires JSX loader and NODE_ENV definition for React optimizations
- No external dependencies for webview bundles (sandboxed environment)
- Tree shaking automatic when `minify: true` (production builds)

### Pattern 2: Nonce-Based CSP Implementation

**What:** Generate unique nonce per webview load, inject into CSP meta tag, apply to script/style tags

**When to use:** This phase (BUILD-02)

**Example:**
```typescript
// Source: VS Code webview-sample (https://github.com/microsoft/vscode-extension-samples)

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  scriptPath: string
): string {
  const nonce = getNonce();
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', scriptPath)
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'styles.css')
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             img-src ${webview.cspSource} https:;
             font-src ${webview.cspSource};
             style-src ${webview.cspSource} 'nonce-${nonce}';
             script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet" nonce="${nonce}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
```

**Key points:**
- Nonce regenerated on every webview load (not cached)
- `webview.cspSource` provides correct origin for VS Code resources
- No inline scripts (`onclick`, event handlers) or styles allowed
- External script/style tags require matching `nonce` attribute
- React hydration point: `<div id="root"></div>`

### Pattern 3: React 18 Error Boundary

**What:** Class component wrapper that catches rendering errors and displays fallback UI

**When to use:** This phase (BUILD-03)

**Example:**
```typescript
// Source: React 18 Error Boundaries (https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary)
// Adapted for VS Code theming

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log to VS Code output channel via postMessage
    const vscode = acquireVsCodeApi();
    vscode.postMessage({
      type: 'error',
      error: {
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack
      }
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '20px',
          color: 'var(--vscode-errorForeground)',
          backgroundColor: 'var(--vscode-inputValidation-errorBackground)',
          border: '1px solid var(--vscode-inputValidation-errorBorder)',
          borderRadius: '4px'
        }}>
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: '10px',
              padding: '8px 16px',
              backgroundColor: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer'
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

**Key points:**
- Class component required (hooks don't support error boundaries)
- `getDerivedStateFromError` updates state for fallback render
- `componentDidCatch` logs error details (send to extension host via postMessage)
- Fallback UI uses VS Code CSS variables for theme compliance
- Wrap root component: `<ErrorBoundary><App /></ErrorBoundary>`

### Pattern 4: Typed Message Contracts with Discriminated Unions

**What:** TypeScript unions with a `type` discriminant property for type-safe extension-webview communication

**When to use:** This phase (scaffolding only — actual messages defined in Phase 3)

**Example:**
```typescript
// Source: TypeScript Handbook (https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html)
// Adapted from How to Handle Discriminated Unions in TypeScript (2026)

// Shared types (src/shared/messageContracts.ts)
export type ExtensionToWebviewMessage =
  | { type: 'init'; state: InitialState }
  | { type: 'stateUpdate'; state: Partial<AppState> }
  | { type: 'error'; message: string };

export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'action'; action: string; payload?: unknown }
  | { type: 'error'; error: { message: string; stack?: string } };

// Webview handler (automatic type narrowing)
window.addEventListener('message', (event) => {
  const message = event.data as ExtensionToWebviewMessage;

  switch (message.type) {
    case 'init':
      // TypeScript knows: message.state exists
      setState(message.state);
      break;
    case 'stateUpdate':
      // TypeScript knows: message.state exists (partial)
      updateState(message.state);
      break;
    case 'error':
      // TypeScript knows: message.message exists
      showError(message.message);
      break;
    default:
      // Exhaustiveness check: compile error if case missing
      const _exhaustive: never = message;
  }
});

// Extension host sender (type-safe at call site)
webview.postMessage({ type: 'init', state: { user: 'test' } }); // ✓ Valid
webview.postMessage({ type: 'init' }); // ✗ Error: missing 'state'
```

**Key points:**
- `type` property is the discriminant (consistent naming convention)
- TypeScript narrows union type automatically in switch cases
- `default: never` case catches unhandled message types at compile time
- Shared types prevent drift between extension and webview code
- No `any` types — full type safety across postMessage boundary

### Pattern 5: React 18 Hydration in VS Code Webview

**What:** Use `createRoot` (not `hydrateRoot`) since webview HTML is not server-rendered

**When to use:** React entry point (`src/views/webview/react/index.tsx`)

**Example:**
```typescript
// Source: React 18 createRoot (https://react.dev/reference/react-dom/client/createRoot)

import { createRoot } from 'react-dom/client';
import { App } from './App';

// VS Code webview API (must be called once and cached)
const vscode = acquireVsCodeApi();

// Create React root and render
const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const root = createRoot(container);
root.render(
  <App vscodeApi={vscode} />
);

// Signal ready state to extension host
vscode.postMessage({ type: 'ready' });
```

**Key points:**
- Use `createRoot`, not `hydrateRoot` (no SSR/SSG in webviews)
- Call `acquireVsCodeApi()` once at module scope (caches API object)
- Send `ready` signal after render to prevent race conditions
- Error boundaries wrap `<App>` in parent component

### Anti-Patterns to Avoid

- **Inline scripts/styles:** Violates CSP; move all logic to bundled JS, all styles to CSS files
- **`ReactDOM.render()`:** Deprecated in React 18; use `createRoot().render()` instead
- **CommonJS for webview:** Browser doesn't support `require()`; use IIFE format
- **Sharing React instance:** Extension host (Node.js) and webview (browser) need separate bundles
- **`any` in message handlers:** Defeats type safety; use discriminated unions
- **Missing nonce on scripts:** CSP blocks execution; every script/style tag needs nonce attribute

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Nonce generation | Custom crypto logic | VS Code sample `getNonce()` (32-char alphanumeric) | Battle-tested pattern; security audited; handles edge cases |
| Error boundaries | Try-catch in components | React ErrorBoundary class | Catches render errors; try-catch misses lifecycle errors; standard pattern |
| Build orchestration | Custom script runner | esbuild context API with watch mode | Atomic rebuilds; incremental compilation; built-in watch |
| Message type narrowing | Manual type guards | TypeScript discriminated unions | Exhaustive checking; compiler enforces completeness |
| Tree shaking | Manual dead code elimination | esbuild automatic tree shaking (minify: true) | Analyzes ES modules; removes unused exports; zero config |

**Key insight:** VS Code webview development has well-established patterns (nonces, postMessage contracts, esbuild configs) that handle edge cases (CSP violations, race conditions, build atomicity) better than custom solutions. React error boundaries are the only way to catch rendering errors (try-catch doesn't work for lifecycle methods).

## Common Pitfalls

### Pitfall 1: Inline Event Handlers Break CSP

**What goes wrong:** Using `onclick="handler()"` in HTML or `<button onClick={() => ...}>` compiled to inline attributes causes CSP violations

**Why it happens:** Developers familiar with HTML string generation use inline handlers; React's JSX `onClick` is safe (synthetic events, not inline attributes) but legacy code patterns persist

**How to avoid:**
- React JSX: `<button onClick={handleClick}>` (synthetic event listener, not inline attribute)
- HTML generation: Replace inline handlers with data attributes + `addEventListener` in bundled script
- Verify: Open DevTools Console in webview — CSP violations logged as errors

**Warning signs:**
- Console errors: `Refused to execute inline event handler`
- Buttons don't respond to clicks (CSP blocks inline handlers)

### Pitfall 2: Race Condition Between Webview Load and postMessage

**What goes wrong:** Extension host sends messages before webview React app finishes mounting, messages lost

**Why it happens:** `webview.postMessage()` can execute before webview's `window.addEventListener('message')` is registered

**How to avoid:**
- Webview sends `{ type: 'ready' }` message after React `createRoot().render()` completes
- Extension host queues messages until receiving 'ready' signal
- Webview uses `getState()` to retrieve any state set before hydration

**Warning signs:**
- Webview displays stale/empty data on first load
- Refreshing fixes the issue (timing changes)
- Messages work after webview is visible longer

### Pitfall 3: NODE_ENV Not Defined Causes React Warnings

**What goes wrong:** React runs in development mode in production builds, flooding console with warnings and degrading performance

**Why it happens:** React checks `process.env.NODE_ENV` to toggle dev warnings; esbuild doesn't define it by default

**How to avoid:**
```javascript
// In esbuild config
define: {
  'process.env.NODE_ENV': production ? '"production"' : '"development"'
}
```

**Warning signs:**
- Production builds show "[HMR]" warnings (React dev mode)
- Bundle size larger than expected (dev-only code not stripped)
- Console filled with React development warnings

### Pitfall 4: Missing Tree Shaking Configuration

**What goes wrong:** Production bundles include unused React code, bloating bundle size

**Why it happens:** Tree shaking requires both `bundle: true` and `minify: true`; developers enable bundling but not minification

**How to avoid:**
```javascript
// In esbuild config (production builds)
bundle: true,
minify: true, // Enables tree shaking automatically
```

**Warning signs:**
- Production bundle size > 200KB for simple React app (should be ~130KB with React 18)
- Importing a single function brings entire library into bundle

### Pitfall 5: Forgetting to Commit BEFORE Testing CSP

**What goes wrong:** Developers test CSP changes but forget to rebuild, test stale bundle, conclude changes don't work

**Why it happens:** esbuild watch mode only rebuilds on file save; HTML generation in TypeScript doesn't trigger watch

**How to avoid:**
- Run `npm run compile` before testing webview changes
- Use watch mode during development: `npm run watch`
- Add console.log in webview entry point to verify bundle freshness

**Warning signs:**
- CSP changes don't take effect after code modification
- Nonce stays the same across webview reloads (indicates stale HTML)

## Code Examples

Verified patterns from official sources:

### React Entry Point with Error Boundary

```typescript
// src/views/webview/react/index.tsx
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary';
import { App } from './App';

declare global {
  interface Window {
    acquireVsCodeApi: () => {
      postMessage: (message: any) => void;
      getState: () => any;
      setState: (state: any) => void;
    };
  }
}

const vscode = acquireVsCodeApi();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container not found');
}

const root = createRoot(container);
root.render(
  <ErrorBoundary>
    <App vscodeApi={vscode} />
  </ErrorBoundary>
);

// Signal ready
vscode.postMessage({ type: 'ready' });
```

### Webview HTML Template with CSP

```typescript
// src/utils/webviewHelpers.ts
import * as vscode from 'vscode';

export function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function getReactWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const nonce = getNonce();
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview-react.js')
  );
  const baseCssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'base.css')
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             img-src ${webview.cspSource} https:;
             font-src ${webview.cspSource};
             style-src ${webview.cspSource} 'nonce-${nonce}';
             script-src 'nonce-${nonce}';">
  <link href="${baseCssUri}" rel="stylesheet" nonce="${nonce}">
  <title>Artemis</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
```

### Message Contract Scaffold

```typescript
// src/shared/messageContracts.ts

// Extension → Webview messages
export type ExtensionToWebviewMessage =
  | { type: 'init'; payload: { user: string; serverUrl: string } }
  | { type: 'stateUpdate'; payload: Partial<AppState> }
  | { type: 'error'; payload: { message: string } };

// Webview → Extension messages
export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'command'; payload: { command: string; args?: unknown } }
  | { type: 'error'; payload: { message: string; stack?: string } };

// State types (define in Phase 3 when migrating first view)
export interface AppState {
  // TBD: Define based on first migrated view
}

// Type guards for runtime validation
export function isExtensionMessage(msg: any): msg is ExtensionToWebviewMessage {
  return msg && typeof msg.type === 'string' && ['init', 'stateUpdate', 'error'].includes(msg.type);
}

export function isWebviewMessage(msg: any): msg is WebviewToExtensionMessage {
  return msg && typeof msg.type === 'string' && ['ready', 'command', 'error'].includes(msg.type);
}
```

### esbuild Configuration (Full Example)

```javascript
// esbuild.js
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  },
};

async function main() {
  // Extension host (Node.js CJS)
  const extensionCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    logLevel: 'silent',
    plugins: [esbuildProblemMatcherPlugin],
  });

  // Existing webview components (Browser IIFE)
  const webviewComponentsCtx = await esbuild.context({
    entryPoints: ['src/views/webview/components.ts'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    outfile: 'dist/webview-components.js',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    logLevel: 'silent',
    plugins: [esbuildProblemMatcherPlugin],
  });

  // NEW: React webview (Browser IIFE + JSX)
  const webviewReactCtx = await esbuild.context({
    entryPoints: ['src/views/webview/react/index.tsx'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    outfile: 'dist/webview-react.js',
    loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    logLevel: 'silent',
    define: {
      'process.env.NODE_ENV': production ? '"production"' : '"development"',
    },
    plugins: [esbuildProblemMatcherPlugin],
  });

  if (watch) {
    await Promise.all([
      extensionCtx.watch(),
      webviewComponentsCtx.watch(),
      webviewReactCtx.watch(),
    ]);
  } else {
    await Promise.all([
      extensionCtx.rebuild(),
      webviewComponentsCtx.rebuild(),
      webviewReactCtx.rebuild(),
    ]);
    await Promise.all([
      extensionCtx.dispose(),
      webviewComponentsCtx.dispose(),
      webviewReactCtx.dispose(),
    ]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `ReactDOM.render()` | `createRoot().render()` | React 18 (Mar 2022) | Enables concurrent features; required for React 18+ |
| webpack | esbuild | 2020-2021 | 10-100x faster builds; simpler config; <2s for typical React app |
| Server-provided nonces | Client-generated nonces | VS Code webview pattern (2018+) | Webview HTML generated server-side (extension host), nonce per load |
| String constants | Discriminated unions | TypeScript 2.0+ (2016) | Exhaustive type checking; automatic type narrowing |
| `eval()` CSP | Nonce-based CSP | CSP Level 2 (2015) | No `'unsafe-eval'` needed; strict security |

**Deprecated/outdated:**
- `ReactDOM.render()`: Removed in React 19, deprecated in React 18 (use `createRoot()`)
- `webview.cspSource` only: Incomplete CSP (now requires nonces for scripts/styles)
- `any` typed message handlers: No type safety across postMessage (use discriminated unions)

## Open Questions

1. **CSS Loading Strategy**
   - What we know: Existing extension copies CSS files to dist/ via esbuild plugin; React can import CSS (esbuild bundles it)
   - What's unclear: Should React views use imported CSS (bundled into JS) or link tags with nonce? Imported CSS avoids nonce management but increases JS bundle size.
   - Recommendation: Use link tags + nonce for Phase 1 (matches existing pattern, easier debugging); evaluate CSS-in-JS in later phase if bundle size becomes concern

2. **View Coexistence Strategy**
   - What we know: Existing HTML generation stays active during migration; ViewRouter must support both legacy and React views
   - What's unclear: Should ViewRouter detect view type and route to different HTML generators, or should each view handle coexistence internally?
   - Recommendation: ViewRouter branches on view type (legacy vs React); keeps routing logic centralized; easier to remove legacy code in Phase 7

3. **React Dev Tools Support**
   - What we know: React Dev Tools can connect to webviews via `__REACT_DEVTOOLS_GLOBAL_HOOK__`
   - What's unclear: Does VS Code webview CSP allow React Dev Tools connection? If blocked, how do developers debug React state?
   - Recommendation: Test React Dev Tools in Phase 1 verification; if blocked, document workaround (console.log state, or temporarily relax CSP for dev builds only)

## Validation Architecture

> Note: config.json has `workflow.research: true` but no `workflow.nyquist_validation` setting, so Nyquist validation is disabled. Skipping validation architecture section.

## Sources

### Primary (HIGH confidence)
- [VS Code Webview API (official docs)](https://code.visualstudio.com/api/extension-guides/webview) - CSP patterns, webview lifecycle
- [VS Code Extension Samples - webview-sample](https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts) - getNonce() implementation
- [esbuild API Documentation](https://esbuild.github.io/api/) - Build configuration, platform/format options
- [React 18 Documentation - createRoot](https://react.dev/reference/react-dom/client/createRoot) - React 18 rendering API
- [React 18 Documentation - Error Boundaries](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary) - Error boundary lifecycle
- [TypeScript Handbook - Unions and Intersections](https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html) - Discriminated unions
- [React Changelog](https://github.com/facebook/react/blob/main/CHANGELOG.md) - React 18.3.1 details

### Secondary (MEDIUM confidence)
- [Using React in VS Code Webviews - Ken Muse](https://www.kenmuse.com/blog/using-react-in-vs-code-webviews/) - Practical React + VS Code patterns
- [Complete Guide to Setting Up React with TypeScript and esbuild (2026)](https://medium.com/@robinviktorsson/complete-guide-to-setting-up-react-with-typescript-and-esbuild-2025-88767a3a5593) - Modern esbuild + React setup
- [Building VS Code Extensions in 2026: The Complete Guide](https://abdulkadersafi.com/blog/building-vs-code-extensions-in-2026-the-complete-modern-guide) - Current best practices
- [How to Handle Discriminated Unions in TypeScript (2026)](https://oneuptime.com/blog/post/2026-01-24-typescript-discriminated-unions/view) - Message contract patterns
- [How to Implement React Error Boundaries (2026)](https://oneuptime.com/blog/post/2026-02-20-react-error-boundaries/view) - Error boundary best practices
- [esbuild with React (Medium)](https://ramkumarkhub.medium.com/esbuild-bundle-with-react-a26db2ffaef2) - Practical esbuild config examples

### Tertiary (LOW confidence)
- None identified during research

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - React 18.3.1 and esbuild already industry-standard for VS Code extensions; official docs comprehensive
- Architecture: HIGH - VS Code samples provide canonical patterns; esbuild docs cover dual-target configs exhaustively
- Pitfalls: MEDIUM - Common issues documented in blog posts and GitHub issues; some edge cases discovered through practitioner reports rather than official docs

**Research date:** 2026-02-23
**Valid until:** 2026-03-25 (30 days — stable ecosystem, React 18 mature, esbuild API stable)
