# Stack Research: React Webview Migration

**Domain:** VS Code Extension Webviews
**Researched:** 2026-02-23
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| React | 18.3.1 | UI component framework | React 19 is stable but React 18.3 is the safer choice for VS Code extensions in 2026. React 18.3 was released specifically to add warnings for React 19 deprecated APIs, making it the ideal bridge version. React 19's new compiler and Server Components are not applicable to webview environments. Stick with 18.3 for stability in sandboxed webviews. |
| TypeScript | 5.9.3 | Type safety | Already in use. No changes needed. TypeScript 5.9.3 fully supports React JSX with automatic runtime. |
| esbuild | 0.27.2 → 0.28.0+ | Bundler | Keep esbuild. It has built-in JSX transformation with zero configuration beyond file extensions. Native React JSX support via `jsx: "automatic"` loader option. Vite would add unnecessary complexity (HMR not useful in webview context, extra dev server overhead). esbuild's 10-100x faster bundling is perfect for watch mode during development. Update to latest 0.28.x for React automatic JSX runtime improvements. |

### React Ecosystem

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| react | 18.3.1 | Core React library | Required for all React webviews |
| react-dom | 18.3.1 | React DOM rendering | Required for rendering to webview DOM |
| @types/react | 18.3.18 | TypeScript types for React | Required for TypeScript development |
| @types/react-dom | 18.3.6 | TypeScript types for React DOM | Required for TypeScript development |

### State Management

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Zustand | 5.0.3 | Lightweight state management | Use for shared state across webview (current view state, exam timers, chat message history). Perfect for VS Code webviews: no providers needed, works outside React tree for postMessage integration, 1KB bundle size, TypeScript-first API. |
| React Context API | Built-in | Component-scoped state | Use for local component state that doesn't need persistence (e.g., dropdown open/closed, form field focus). DO NOT use for app-level state that crosses postMessage boundary. |

### Typed Messaging

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/vscode-webview | 1.57.5 | TypeScript types for webview API | Required for type-safe `acquireVsCodeApi()` usage |
| Custom message types | N/A | Shared type definitions | Create shared types file (e.g., `src/types/messages.ts`) imported by both extension host and webview code. Define discriminated unions for type-safe postMessage routing. |

### CSS Handling

| Approach | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Plain CSS files | N/A | Component styling | KEEP existing approach. You already have per-view CSS files and a base.css with CSS custom properties. esbuild's `copyCssPlugin` already handles this. Import CSS in React components via link tags in HTML or dynamic imports (esbuild supports CSS imports). DO NOT add CSS Modules (unnecessary build complexity) or styled-components (adds 15KB+ to bundle, runtime overhead). |
| CSS Custom Properties | N/A | VS Code theme integration | Already using `--vscode-*` variables in base.css. Continue this pattern. React components reference these via className. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| @vscode/test-cli | Testing harness | Already in use (0.0.12). No changes needed for React migration. |
| ESLint | Linting | Already configured (9.39.2). Add `eslint-plugin-react-hooks` to enforce Rules of Hooks. |
| npm-run-all2 | Parallel script execution | Already in use for watch mode. No changes needed. |

## Installation

```bash
# Core React
npm install react@18.3.1 react-dom@18.3.1

# TypeScript types
npm install -D @types/react@18.3.18 @types/react-dom@18.3.6 @types/vscode-webview@1.57.5

# State management
npm install zustand@5.0.3

# Development tools
npm install -D eslint-plugin-react-hooks@5.1.0

# Update esbuild to latest 0.28.x for better JSX support
npm install -D esbuild@0.28.0
```

## esbuild Configuration Changes

### Update `iris-thaumantias/esbuild.js`

```javascript
// Webview build context (add JSX configuration)
const webviewCtx = await esbuild.context({
  entryPoints: [
    'src/views/webview/components.ts', // Rename to .tsx
    'src/views/webview/react-entry.tsx' // NEW: React app entry point
  ],
  bundle: true,
  format: 'iife',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: 'browser',
  outdir: 'dist', // Change from outfile to outdir for multiple entries
  jsx: 'automatic', // Enable automatic JSX runtime
  jsxImportSource: 'react', // Use React's JSX runtime
  loader: {
    '.tsx': 'tsx',
    '.ts': 'ts',
    '.css': 'css', // Handle CSS imports
  },
  logLevel: 'silent',
  plugins: [
    esbuildProblemMatcherPlugin,
  ],
});
```

## TypeScript Configuration Changes

### Update `iris-thaumantias/tsconfig.json`

```json
{
  "compilerOptions": {
    "module": "Node16",
    "target": "ES2022",
    "lib": ["ES2022", "DOM"], // ADD "DOM" for webview code
    "jsx": "react-jsx", // Enable automatic JSX runtime
    "jsxImportSource": "react", // Use React's JSX runtime
    "esModuleInterop": true, // ADD for React imports
    "skipLibCheck": true, // ADD to avoid type conflicts
    "sourceMap": true,
    "strict": true
  }
}
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| React 18.3 | React 19.2.4 | Only if you need React 19-specific features (Actions, Server Components). React 19's compiler and server features are irrelevant in webview context. React 18.3 is the bridge release with React 19 warnings, making it safer for 2026. |
| esbuild | Vite 8 | Only if you need HMR or are building a multi-framework extension. Vite's HMR requires dev server which adds complexity in VS Code webview context. Vite 8 uses Rolldown (Rust-based), but esbuild is already fast enough for this use case. |
| Zustand | Jotai | If you need Suspense integration or prefer atomic state model. Jotai's atomic approach excels at fine-grained reactivity but requires more setup. Zustand's single-store model is simpler for webview state (view state + postMessage integration). |
| Zustand | Redux Toolkit | Never for this project. Redux is 10% of new projects in 2026. Adds unnecessary boilerplate (actions, reducers, store config) when Zustand provides same features with 90% less code and 1/15th the bundle size. |
| Plain CSS | CSS Modules | Only if you have namespace conflicts between views. Your CSS already uses BEM-like naming (`.list-item__container`) and scoped files per view. CSS Modules add build complexity with marginal benefit. |
| Plain CSS | styled-components | Never for VS Code extensions. Adds 15KB+ to bundle, runtime style injection overhead, and no benefit over CSS custom properties for theming. Your theme integration via `--vscode-*` variables is the correct pattern. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| React 19 | React 19's compiler requires build configuration changes and Server Components are not applicable to webviews. React 18.3 is the stable bridge release with React 19 deprecation warnings. | React 18.3.1 |
| @vscode/webview-ui-toolkit | Deprecated January 1, 2025. Microsoft archived the repository due to FAST Foundation deprecation. No security updates after January 2025. | Plain CSS with VS Code CSS variables + custom React components (you already have Button, ListItem, Container, etc.) |
| CSS-in-JS (styled-components, emotion) | Adds 15KB+ runtime overhead, style injection complexity, and no benefit over CSS custom properties for VS Code theme integration. | Plain CSS files with `--vscode-*` variables |
| Redux / Redux Toolkit | Over-engineered for webview state management. Requires actions, reducers, store setup, and middleware configuration. 90% more code than Zustand for same result. Down to 10% of new projects in 2026. | Zustand (1KB, no boilerplate) |
| Vite | HMR requires dev server (complexity in VS Code context). Vite's speed advantage is negligible when esbuild already bundles in <1s. Adds extra config and dependency (Vite + plugins vs esbuild alone). | esbuild with automatic JSX |
| vscode-messenger | Over-engineered for typed messaging. Adds JSON-RPC protocol layer when simple discriminated union types + postMessage suffice. Requires dual installation (extension + webview package.json). | Custom shared message types (discriminated unions in `src/types/messages.ts`) |
| Next.js / Remix | Framework overkill. SSR, routing, and server features are not applicable to sandboxed webviews. Adds 100KB+ to bundle. | React + esbuild + plain routing logic |

## Stack Patterns by Use Case

### For Webview State Management

**Use Zustand when:**
- State needs to persist across postMessage events (exam timers, chat history, submission status)
- Multiple components need the same state (current view, user session)
- State updates come from extension host via postMessage
- Need to access state outside React components (e.g., in postMessage handlers)

**Use React Context when:**
- State is local to a component tree (form validation, accordion expand/collapse)
- State does NOT cross postMessage boundary
- State is ephemeral (UI-only, not persistence-worthy)

**Use useState/useReducer when:**
- State is local to a single component (input field value, hover state)
- No other components need access
- State resets on unmount

### For CSS Organization

**Keep existing pattern:**
```
media/styles/base.css          → CSS custom properties, theme variables
src/views/[view]/[view].css    → View-specific styles
src/views/components/[name]/[name].css → Component-specific styles
```

**In React migration:**
- Import CSS in component files: `import './button.css'` (esbuild handles this)
- OR keep current approach: load all CSS via `<link>` tags in HTML template
- Continue using CSS custom properties for theming: `var(--vscode-button-background)`
- Class names stay the same: `className="button button--primary"`

### For Typed postMessage Bridge

**Pattern:**
```typescript
// src/types/messages.ts (shared between extension host and webview)
export type WebviewMessage =
  | { type: 'updateExercise'; payload: Exercise }
  | { type: 'updateTimer'; payload: { remainingSeconds: number } }
  | { type: 'chatMessage'; payload: { id: string; content: string } };

export type ExtensionMessage =
  | { type: 'submitExercise'; payload: { commitMessage: string } }
  | { type: 'sendChatMessage'; payload: { message: string } }
  | { type: 'loadExercise'; payload: { exerciseId: number } };

// In webview (React component)
const vscodeApi = acquireVsCodeApi<{ currentView: string }>();

vscodeApi.postMessage({
  type: 'submitExercise',
  payload: { commitMessage: 'My solution' }
} satisfies ExtensionMessage);

window.addEventListener('message', (event) => {
  const message = event.data as WebviewMessage;
  switch (message.type) {
    case 'updateExercise':
      useExerciseStore.setState({ exercise: message.payload });
      break;
    case 'updateTimer':
      useTimerStore.setState({ remaining: message.payload.remainingSeconds });
      break;
  }
});

// In extension host
webviewPanel.webview.postMessage({
  type: 'updateTimer',
  payload: { remainingSeconds: 120 }
} satisfies WebviewMessage);

webviewPanel.webview.onDidReceiveMessage((message: ExtensionMessage) => {
  switch (message.type) {
    case 'submitExercise':
      await submitExercise(message.payload.commitMessage);
      break;
  }
});
```

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| react@18.3.1 | @types/react@18.3.x | React 18.3 is the bridge release with React 19 deprecation warnings |
| react@18.3.1 | zustand@5.x | Zustand 5.x supports React 18 and 19 |
| esbuild@0.28.x | TypeScript 5.9.3 | esbuild handles TypeScript transpilation natively |
| TypeScript 5.9.3 | jsx: "react-jsx" | TypeScript 4.1+ required for automatic JSX runtime |
| @types/vscode@^1.97.0 | @types/vscode-webview@1.57.5 | webview types compatible with VS Code 1.97+ |

## Migration Strategy

### Phase 1: Setup (1 day)
1. Install React + types + Zustand
2. Update esbuild.js for JSX support
3. Update tsconfig.json for React
4. Create shared message types in `src/types/messages.ts`

### Phase 2: Component Library (2-3 days)
1. Port existing components to React (Button, ListItem, Container, etc.)
2. Keep existing CSS files, import in components
3. Test each component in isolation

### Phase 3: View Migration (per view, 1-2 days each)
1. Create Zustand store for view state
2. Create React component tree
3. Wire up postMessage handlers
4. Replace `generateHtml()` with React render
5. Verify functionality parity

### Phase 4: Critical Views (exam, chat)
1. ExamExerciseDetail: ensure timer accuracy (test thoroughly)
2. IrisChat: ensure streaming smoothness (test message rendering)

## Sources

### React
- [React v19 – React](https://react.dev/blog/2024/12/05/react-19) — React 19 release notes
- [React 19 Upgrade Guide – React](https://react.dev/blog/2024/04/25/react-19-upgrade-guide) — Migration guidance
- [@types/react - npm](https://www.npmjs.com/package/@types/react) — TypeScript types

### VS Code Webviews
- [Building VS Code Extensions in 2026: The Complete Guide | Abdulkader Safi](https://abdulkadersafi.com/blog/building-vs-code-extensions-in-2026-the-complete-modern-guide) — 2026 best practices
- [Using React in Visual Studio Code Webviews - Ken Muse](https://www.kenmuse.com/blog/using-react-in-vs-code-webviews/) — React integration patterns
- [Webview API | Visual Studio Code Extension API](https://code.visualstudio.com/api/extension-guides/webview) — Official VS Code API docs

### Build Tools
- [Complete Guide to Setting Up React with TypeScript and esbuild (2026) | by Robin Viktorsson | Medium](https://medium.com/@robinviktorsson/complete-guide-to-setting-up-react-with-typescript-and-esbuild-2025-88767a3a5593) — esbuild + React setup
- [esbuild - Content Types](https://esbuild.github.io/content-types/) — JSX transformation docs
- [Esbuild vs Vite: A Complete Build Tool Comparison | Better Stack Community](https://betterstack.com/community/guides/scaling-nodejs/esbuild-vs-vite/) — Build tool comparison

### State Management
- [State Management in 2026: Redux, Context API, and Modern Patterns](https://www.nucamp.co/blog/state-management-in-2026-redux-context-api-and-modern-patterns) — 2026 state management landscape
- [Zustand vs Jotai: Choosing the Right State Manager for Your React App](https://blog.openreplay.com/zustand-jotai-react-state-manager/) — Zustand vs Jotai comparison
- [Comparison — Jotai, primitive and flexible state management for React](https://jotai.org/docs/basics/comparison) — Jotai official comparison

### CSS
- [Why I moved from Styled Components to (S)CSS modules | blog | puruvj.dev](https://www.puruvj.dev/blog/move-to-css-modules-from-styled-components) — CSS Modules vs styled-components
- [Using React in Visual Studio Code Webviews - Ken Muse](https://www.kenmuse.com/blog/using-react-in-vs-code-webviews/) — CSS in VS Code webviews

### Typed Messaging
- [@types/vscode-webview - npm](https://www.npmjs.com/package/@types/vscode-webview) — TypeScript types for webview API
- [Enhancing communication between extensions and webviews using VS Code Messenger | TypeFox](https://www.typefox.io/blog/vs-code-messenger/) — VS Code Messenger (alternative considered)

### Deprecated
- [Sunsetting the Webview UI Toolkit · Issue #561 · microsoft/vscode-webview-ui-toolkit](https://github.com/microsoft/vscode-webview-ui-toolkit/issues/561) — Toolkit deprecation notice

---
*Stack research for: React Webview Migration in VS Code Extension*
*Researched: 2026-02-23*
*Confidence: HIGH - All recommendations verified with 2026 sources and official documentation*
