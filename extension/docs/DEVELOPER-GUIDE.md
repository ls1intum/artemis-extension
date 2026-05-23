# Artemis Extension Developer Guide

**Last updated:** 2026-02-24

This guide provides comprehensive documentation for developing and extending the Artemis VS Code extension. The extension uses a React-based webview architecture with Zustand for state management, esbuild for bundling, and a typed message contract system for extension-webview communication.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Adding a New View](#adding-a-new-view)
4. [Message Contracts](#message-contracts)
5. [Store Architecture](#store-architecture)
6. [Build Pipeline](#build-pipeline)
7. [Testing](#testing)
8. [Conventions](#conventions)

---

## Architecture Overview

The Artemis extension follows a **dual-context architecture** with clear separation between Node.js (extension host) and browser (webview) contexts.

### Dual Webview Pattern

The extension provides two separate webview panels:

1. **ArtemisWebviewProvider** — Main views for courses, exercises, login, settings
2. **ChatWebviewProvider** — Dedicated Iris AI chat interface

Both use the same React architecture but are rendered in separate webview panels for better lifecycle management.

### Extension Host → Webview Communication

- **Extension Host (Node.js):** Handles authentication, API calls, WebSocket connections, state management, and navigation routing
- **Webview (Browser):** React components render UI, manage local UI state with Zustand, send commands back to extension host
- **Communication:** Bidirectional `postMessage` with typed message contracts (see [Message Contracts](#message-contracts))
- **Routing:** Server-side routing via `data-view` attribute — extension host decides which view to render

### Ready-Signal Handshake

To prevent race conditions during view initialization:

1. Extension host renders HTML with `data-view` attribute
2. React app mounts and hydrates
3. Webview sends `{ type: 'ready' }` signal
4. Extension host sends initialization data
5. View is fully interactive

This ensures messages are never sent before React is ready to receive them.

**Architecture Diagram:** See [diagrams/extension-architecture.mmd](diagrams/extension-architecture.mmd)

---

## Project Structure

```
extension/
├── src/
│   ├── api/                          # Artemis REST API client
│   │   └── artemisApiService.ts
│   ├── auth/                         # Authentication manager
│   │   └── authManager.ts
│   ├── models/                       # TypeScript domain models
│   ├── provider/                     # VS Code webview providers
│   │   ├── artemisWebviewProvider.ts
│   │   └── chatWebviewProvider.ts
│   ├── services/                     # Extension services
│   │   ├── telemetry/               # Telemetry and analytics
│   │   └── artemisWebsocketService.ts
│   ├── shared/                       # Shared between extension and webview
│   │   └── messageContracts.ts      # Typed message definitions
│   ├── types/                        # TypeScript type definitions
│   ├── utils/                        # Utility functions
│   ├── views/
│   │   ├── app/                      # Extension host view logic
│   │   │   ├── appStateManager.ts   # Navigation state
│   │   │   ├── viewRouter.ts        # HTML generation
│   │   │   └── commands/            # Command handlers
│   │   └── webview/
│   │       └── react/               # React webview bundle
│   │           ├── App.tsx          # View router component
│   │           ├── ErrorBoundary.tsx
│   │           ├── index.tsx        # Entry point
│   │           ├── components/      # Shared components
│   │           │   ├── Badge/
│   │           │   ├── Button/
│   │           │   ├── Container/
│   │           │   ├── Dropdown/
│   │           │   ├── IconButton/
│   │           │   ├── ListItem/
│   │           │   └── TextInput/
│   │           ├── stores/          # Zustand stores
│   │           │   ├── useChatStore.ts
│   │           │   ├── useCourseDetailStore.ts
│   │           │   ├── useCourseListStore.ts
│   │           │   ├── useDashboardStore.ts
│   │           │   ├── useExerciseDetailStore.ts
│   │           │   └── useNavigationStore.ts
│   │           └── views/           # View components
│   │               ├── CourseDetail/
│   │               ├── CourseList/
│   │               ├── Dashboard/
│   │               ├── ExerciseDetail/
│   │               ├── GitCredentials/
│   │               ├── IrisChat/
│   │               ├── Login/
│   │               ├── RecommendedExtensions/
│   │               └── ServiceStatus/
│   └── extension.ts                 # Extension entry point
├── test/                             # Test files
│   ├── api/
│   ├── auth/
│   ├── models/
│   ├── services/
│   ├── utils/
│   └── views/
│       └── app/
│           └── appStateManager.test.ts
├── dist/                             # Build output
│   ├── extension.js                 # Extension host bundle
│   ├── webview-react.js            # React webview bundle
│   ├── webview-react.css           # CSS bundle with modules
│   ├── base.css                     # Global styles
│   └── meta.json                    # Bundle metadata (production only)
├── docs/                             # Documentation
│   ├── DEVELOPER-GUIDE.md           # This file
│   └── diagrams/                    # Mermaid diagrams
│       ├── extension-architecture.mmd
│       ├── message-flow.mmd
│       └── store-interactions.mmd
├── esbuild.js                        # Build configuration
├── package.json                      # Dependencies and scripts
└── tsconfig.json                     # TypeScript configuration
```

**Key Directories:**

- **`src/extension/controller/`** — Extension host logic (state management, routing, command handlers)
- **`src/webview/`** — React components and Zustand stores
- **`src/shared/`** — Code shared between extension and webview (message contracts, types)
- **`dist/`** — Build output (2 bundles: extension.js and webview-react.js)

---

## Adding a New View

This section describes the conventions for adding a new React view to the extension.

### 1. Create View Directory

```
src/webview/views/YourViewName/
├── YourViewNameView.tsx       # Main view component
├── YourViewNameView.module.css # CSS Modules stylesheet
├── types.ts                    # View-specific types
├── components/                 # View-specific components (optional)
│   └── YourComponent.tsx
└── index.ts                    # Barrel export
```

**File naming convention:** Use PascalCase for view names, suffix with `View.tsx`.

### 2. Define Message Contracts

Add message types to `src/shared/messageContracts.ts`:

**Extension → Webview (initialization):**

```typescript
export interface YourViewInitMessage {
    type: 'yourViewInit';
    payload: {
        // View-specific data
        data: YourDataType;
    };
}

// Add to ExtensionToWebviewMessage union
export type ExtensionToWebviewMessage =
    | ...
    | YourViewInitMessage;
```

**Webview → Extension (commands):**

```typescript
export interface YourCommandCommand {
    type: 'command';
    command: 'yourCommand';
    payload: {
        // Command parameters
    };
}

// Add to WebviewToExtensionMessage union
export type WebviewToExtensionMessage =
    | ...
    | YourCommandCommand;
```

### 3. Create Zustand Store (if needed)

Create `src/webview/stores/useYourViewStore.ts`:

```typescript
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { VsCodeApi } from '../../shared/messageContracts';

interface YourViewState {
    data: YourDataType | null;
    isLoading: boolean;
    error: string | null;

    // Actions
    setData: (data: YourDataType) => void;
    setLoading: (loading: boolean) => void;
    reload: (vscodeApi: VsCodeApi) => void;
}

export const useYourViewStore = create<YourViewState>()(
    devtools(
        (set) => ({
            data: null,
            isLoading: false,
            error: null,

            setData: (data) => {
                set({ data, isLoading: false, error: null }, false, 'setData');
            },

            setLoading: (loading) => {
                set({ isLoading: loading }, false, 'setLoading');
            },

            reload: (vscodeApi) => {
                set({ isLoading: true, error: null }, false, 'reload');
                vscodeApi.postMessage({
                    type: 'command',
                    command: 'reloadYourView',
                });
            },
        }),
        {
            name: 'YourViewStore',
            enabled: process.env.NODE_ENV === 'development',
        }
    )
);
```

**DevTools conventions:**

- Wrap `create()` with `devtools()` middleware
- Use curried syntax: `create<State>()(devtools(...))`
- Provide human-readable name: `{ name: 'YourViewStore' }`
- Enable development-only: `{ enabled: process.env.NODE_ENV === 'development' }`
- Add action names as third parameter to `set()`: `set({ ... }, false, 'actionName')`

### 4. Implement View Component

Create `src/webview/views/YourViewName/YourViewNameView.tsx`:

```typescript
import { useEffect } from 'react';
import type { VsCodeApi } from '../../../shared/messageContracts';
import { useYourViewStore } from '../../stores/useYourViewStore';
import styles from './YourViewNameView.module.css';

interface YourViewNameViewProps {
    vscodeApi: VsCodeApi;
}

export function YourViewNameView({ vscodeApi }: YourViewNameViewProps) {
    const { data, isLoading, setData } = useYourViewStore();

    // Register message handler
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;

            switch (message.type) {
                case 'yourViewInit':
                    setData(message.payload.data);
                    break;
                // Handle other message types
            }
        };

        window.addEventListener('message', handleMessage);

        // Send ready signal
        vscodeApi.postMessage({ type: 'ready' });

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, [vscodeApi, setData]);

    if (isLoading) {
        return <div className={styles.loading}>Loading...</div>;
    }

    return (
        <div className={styles.container}>
            {/* Your view content */}
        </div>
    );
}
```

### 5. Register View in App.tsx

Add view import and switch case in `src/webview/App.tsx`:

```typescript
import { YourViewNameView } from './views/YourViewName';

export function App({ vscodeApi }: AppProps) {
    const viewName = document.getElementById('root')?.getAttribute('data-view');

    switch (viewName) {
        // ... existing cases
        case 'yourViewName':
            return <YourViewNameView vscodeApi={vscodeApi} />;
        // ...
    }
}
```

### 6. Update View Routing State Map

Add a state mapping entry in `src/extension/controller/viewRouter.ts`:

```typescript
const STATE_TO_VIEW: Record<AppState, string> = {
    // ... existing entries
    'your-view': 'yourViewName',
};
```

### 7. Add Command Handlers (if needed)

Add message handler in `src/extension/controller/commands/` in the appropriate command file:

```typescript
case 'yourCommand':
    // Handle command
    await this._appStateManager.transitionToYourView(message.payload);
    break;
```

### 8. Update AppStateManager (if needed)

Add state transition method in `src/extension/controller/appStateManager.ts`:

```typescript
public async transitionToYourView(params: YourParams): Promise<void> {
    this.currentState = 'your-view';
    // Fetch data, update state, trigger render
    this._updateView();
}
```

**Summary Checklist:**

- [ ] Create view directory with `YourViewNameView.tsx`, `YourViewNameView.module.css`, `types.ts`, `index.ts`
- [ ] Add message contracts to `messageContracts.ts`
- [ ] Create Zustand store with DevTools middleware (if needed)
- [ ] Implement view component with ready-signal handshake
- [ ] Register view in `App.tsx` switch statement
- [ ] Update `_stateToViewName()` in `viewRouter.ts`
- [ ] Add command handler in message handler
- [ ] Add state transition method in `appStateManager.ts` (if needed)

---

## Message Contracts

The extension uses **typed message contracts** for all communication between extension host and webview. All contracts are defined in `src/shared/messageContracts.ts`.

### Message Flow Pattern

**Extension → Webview:**

```typescript
// Message format
interface YourMessage {
    type: 'messageType';  // Discriminant
    payload: {
        // Message data
    };
}

// Send from extension host
panel.webview.postMessage({
    type: 'messageType',
    payload: { ... },
});
```

**Webview → Extension:**

```typescript
// Command format
interface YourCommand {
    type: 'command';      // All webview commands use type: 'command'
    command: 'commandName'; // Specific command discriminant
    payload: {
        // Command parameters
    };
}

// Send from webview
vscodeApi.postMessage({
    type: 'command',
    command: 'commandName',
    payload: { ... },
});
```

### Ready Signal Handshake

Every view **must** send a ready signal after React hydration:

```typescript
useEffect(() => {
    // Register message handlers

    // Send ready signal
    vscodeApi.postMessage({ type: 'ready' });

    return () => {
        // Cleanup
    };
}, [vscodeApi]);
```

This prevents race conditions where the extension host sends initialization data before React is ready.

### Type Guards

Use provided type guards for runtime validation:

```typescript
import { isExtensionMessage, isWebviewMessage } from '../shared/messageContracts';

// In webview
const handleMessage = (event: MessageEvent) => {
    if (!isExtensionMessage(event.data)) {
        return; // Invalid message
    }

    // event.data is now typed as ExtensionToWebviewMessage
    switch (event.data.type) {
        case 'dashboardInit':
            // TypeScript knows payload structure
            break;
    }
};

// In extension host
if (!isWebviewMessage(message)) {
    return; // Invalid message
}

// message is now typed as WebviewToExtensionMessage
if (message.type === 'command') {
    switch (message.command) {
        case 'login':
            // TypeScript knows payload structure
            break;
    }
}
```

### Adding a New Message Type

1. **Define the interface:**

```typescript
export interface YourNewMessage {
    type: 'yourNewMessage';
    payload: {
        data: string;
    };
}
```

2. **Add to the union type:**

```typescript
export type ExtensionToWebviewMessage =
    | ...
    | YourNewMessage;
```

3. **Update type guard (if needed):**

The `isExtensionMessage` function includes an array of valid type strings. Add your new type if it's not already covered by existing patterns.

**Message Flow Diagram:** See [diagrams/message-flow.mmd](diagrams/message-flow.mmd)

---

## Store Architecture

The extension uses **Zustand** for client-side state management in the webview. Each store manages state for specific views or cross-view concerns.

### Current Stores

| Store | Responsibility | Persistence | Consuming Views |
|-------|---------------|-------------|-----------------|
| `useNavigationStore` | Current view, view history | None | All views (routing) |
| `useDashboardStore` | Dashboard courses, workspace exercise | None | DashboardView |
| `useCourseListStore` | Course list, filters, sorting | Filters only | CourseListView |
| `useCourseDetailStore` | Single course detail, exercises | None | CourseDetailView |
| `useExerciseDetailStore` | Exercise details, submissions, results | None | ExerciseDetailView |
| `useChatStore` | Iris chat messages, context, sessions | `forceContextPicker` flag | IrisChatView |

### Store Pattern

All stores follow this pattern:

```typescript
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface YourState {
    // State
    data: YourData | null;
    isLoading: boolean;

    // Actions
    setData: (data: YourData) => void;
    loadData: (vscodeApi: VsCodeApi) => void;
}

export const useYourStore = create<YourState>()(
    devtools(
        (set, get) => ({
            data: null,
            isLoading: false,

            setData: (data) => {
                set({ data, isLoading: false }, false, 'setData');
            },

            loadData: (vscodeApi) => {
                set({ isLoading: true }, false, 'loadData');
                vscodeApi.postMessage({
                    type: 'command',
                    command: 'loadData',
                });
            },
        }),
        {
            name: 'YourStore',
            enabled: process.env.NODE_ENV === 'development',
        }
    )
);
```

### DevTools Integration

All stores use Zustand DevTools middleware for debugging:

- **Development only:** `enabled: process.env.NODE_ENV === 'development'`
- **Named actions:** Third parameter to `set()` provides action names in timeline
- **Redux DevTools:** Install [Redux DevTools extension](https://github.com/reduxjs/redux-devtools) to inspect state changes
- **Timeline view:** See all state mutations with action names and payloads

**Using DevTools:**

1. Install Redux DevTools browser extension
2. Run extension in development mode (`npm run dev`)
3. Open DevTools → Redux tab
4. Select store from dropdown (e.g., "CourseListStore")
5. View state changes in timeline with action names

### Persistence

Most stores **do not persist state** across view changes. The extension host is the source of truth and re-sends data on view load.

**Exceptions (minimal persistence):**

- `useCourseListStore`: Persists filter/sort preferences
- `useChatStore`: Persists `forceContextPicker` flag

Use `vscodeApi.setState()` / `vscodeApi.getState()` for view-specific persistence:

```typescript
// Save state
vscodeApi.setState({ filters: { searchTerm, typeFilter } });

// Restore state
const savedState = vscodeApi.getState<{ filters: Filters }>();
if (savedState) {
    setSearchTerm(savedState.filters.searchTerm);
}
```

### Store Interaction Patterns

**Views consume stores:**

```typescript
export function YourView({ vscodeApi }: YourViewProps) {
    const { data, isLoading, setData } = useYourStore();

    // Use state and actions
}
```

**No cross-store dependencies:**

Each store is independent. If multiple views need the same data, the extension host sends it to each view separately.

**Store Interactions Diagram:** See [diagrams/store-interactions.mmd](diagrams/store-interactions.mmd)

---

## Build Pipeline

The extension uses **esbuild** for fast, optimized bundling. The build pipeline produces two bundles: extension.js (Node.js) and webview-react.js (browser).

### Build Modes

**Development Build:**

```bash
npm run compile
```

- Builds extension.js and webview-react.js
- Includes source maps (always enabled)
- No minification
- Fast iteration

**Watch Mode:**

```bash
npm run dev
```

- Coordinated watch mode for both extension and webview
- Rebuilds on file changes
- Source maps enabled
- Ideal for local development

**Production Build:**

```bash
npm run package
```

- Type checking (`tsc --noEmit`)
- Linting (`eslint`)
- Minified bundles
- Source maps included (for debugging)
- Generates `dist/meta.json` with bundle metadata

**Package VSIX:**

```bash
npm run package:vsix
```

- Runs production build
- Creates `.vsix` file for distribution
- Excludes dev files via `.vscodeignore`

### Bundle Analysis

**Generate bundle visualization:**

```bash
npm run analyze
```

- Opens interactive HTML visualization of bundle contents
- Requires `dist/meta.json` (run `npm run package` first)
- Shows treemap, sunburst, and network views

**One-command build + analyze:**

```bash
npm run build:analyze
```

- Runs production build
- Generates metafile
- Opens analyzer automatically

### Build Configuration

**esbuild.js** defines two build contexts:

1. **Extension Context (`extensionCtx`)**
   - Entry: `src/extension.ts`
   - Output: `dist/extension.js`
   - Platform: `node`
   - Format: `cjs`
   - External: `vscode` module

2. **Webview React Context (`webviewReactCtx`)**
   - Entry: `src/webview/index.tsx`
   - Output: `dist/webview-react.js`, `dist/webview-react.css`
   - Platform: `browser`
   - Format: `iife`
   - Plugins: CSS Modules, inline Worker bundling

**Source Maps:**

Source maps are **always enabled** (`sourcemap: true`) for both dev and production builds. This improves debugging without significant bloat since `sourcesContent: false` prevents embedding full source code.

**Metafile:**

Production builds generate `dist/meta.json` with bundle metadata for analysis. This file is excluded from VSIX packaging via `.vscodeignore`.

### Pre-commit Hooks

**Husky + lint-staged** runs on every commit:

- Runs `eslint --fix` on staged `*.ts` and `*.tsx` files
- Auto-formats code
- Prevents commits with fixable linting errors
- Configured in `package.json` under `lint-staged`

**Setup:**

```bash
npm install  # Runs `prepare` script, installs hooks
```

Hooks are stored in `.husky/pre-commit`.

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run compile` | Development build with type checking and linting |
| `npm run dev` | Watch mode for both extension and webview |
| `npm run package` | Production build (minified, with metafile) |
| `npm run package:vsix` | Create distributable `.vsix` file |
| `npm run analyze` | Open bundle analyzer (requires `dist/meta.json`) |
| `npm run build:analyze` | Build + analyze in one command |
| `npm run check-types` | Run TypeScript type checker without emitting |
| `npm run lint` | Run ESLint on `src/` and `test/` |
| `npm run test` | Run unit tests |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run clean` | Remove `dist/`, `out/`, and `.vsix` files |

---

## Testing

The extension uses the VS Code test framework with TypeScript-compiled tests.

### Test Structure

```
test/
├── api/                  # API service tests
├── auth/                 # Authentication tests
├── models/               # Model tests
├── services/             # Service tests
├── utils/                # Utility tests
├── views/
│   └── app/
│       └── appStateManager.test.ts  # State management tests
├── e2e/                  # End-to-end tests
└── mocks/                # Mock implementations
    └── vscodeMocks.ts    # VS Code API mocks
```

### Running Tests

**All tests:**

```bash
npm test
```

**With coverage:**

```bash
npm run test:coverage
```

**Specific test suite:**

```bash
npm run test:struggle  # Struggle detection tests only
npm run test:e2e       # E2E tests only
```

**Watch mode:**

Tests do not have a watch mode. Use `npm run watch-tests` to recompile tests on change, then run `npm test`.

### Writing Tests

**Unit test example:**

```typescript
import * as assert from 'assert';
import { YourClass } from '../../src/your-module';

suite('YourClass Test Suite', () => {
    let instance: YourClass;

    setup(() => {
        instance = new YourClass();
    });

    test('should do something', () => {
        const result = instance.doSomething();
        assert.strictEqual(result, expectedValue);
    });
});
```

**Mock VS Code API:**

Use `MockExtensionContext` from `test/mocks/vscodeMocks.ts` for extension context mocking.

### Test Coverage

Run tests with coverage:

```bash
npm run test:coverage
```

Coverage reports are generated in `coverage/` directory. This directory is excluded from VSIX packaging.

### Test Compilation

Tests are compiled separately from the main build:

```bash
npm run compile-tests
```

Output: `out/` directory (excluded from VSIX).

**Pre-test script:**

The `pretest` script automatically runs `compile-tests`, `compile`, and `lint` before tests execute.

---

## Conventions

### File Naming

- **Components:** PascalCase with file extension matching component name
  - `ButtonComponent.tsx` → exports `ButtonComponent`
  - `YourView.tsx` → exports `YourView`
- **CSS Modules:** Match component name with `.module.css` suffix
  - `Button.module.css` for `Button.tsx`
- **Types:** `types.ts` for view-specific types, `index.ts` for barrel exports
- **Stores:** `useYourStore.ts` (camelCase with `use` prefix)

### Component Naming

- **Views:** Suffix with `View` (e.g., `LoginView`, `DashboardView`)
- **Components:** Descriptive name without suffix (e.g., `Button`, `Dropdown`, `Container`)
- **Hooks:** Prefix with `use` (e.g., `useExtensionMessage`, `useChatStore`)

### CSS Modules

All styles use **CSS Modules** to prevent global namespace pollution.

**Import pattern:**

```typescript
import styles from './YourComponent.module.css';

export function YourComponent() {
    return <div className={styles.container}>Content</div>;
}
```

**Class name convention:**

Use **camelCase** for CSS class names to avoid bracket notation in TypeScript:

```css
/* Good */
.containerHeader { }
.errorMessage { }

/* Bad (requires styles['error-message']) */
.error-message { }
```

**Conditional classes:**

Use `clsx` for conditional class composition:

```typescript
import clsx from 'clsx';
import styles from './Button.module.css';

<button className={clsx(styles.button, variant === 'primary' && styles.primary)} />
```

### VS Code Theming

Use **VS Code CSS variables** for theming to match the editor's color scheme:

```css
.container {
    background-color: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    border: 1px solid var(--vscode-panel-border);
}

.button {
    background-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
}

.button:hover {
    background-color: var(--vscode-button-hoverBackground);
}
```

**Common variables:**

- `--vscode-editor-background` — Main background
- `--vscode-editor-foreground` — Main text color
- `--vscode-panel-border` — Border color
- `--vscode-button-background` — Primary button background
- `--vscode-button-foreground` — Button text
- `--vscode-errorForeground` — Error text color
- `--vscode-inputValidation-errorBackground` — Error background
- `--vscode-focusBorder` — Focus outline color

See [VS Code Theme Color Reference](https://code.visualstudio.com/api/references/theme-color) for full list.

### TypeScript Conventions

**Path aliases:**

The codebase uses TypeScript path aliases for all upward-going imports. Sibling imports (`./foo`) stay relative.

| Alias | Maps to | Use for |
|-------|---------|---------|
| `@extension/*` | `src/extension/*` | Anything inside the extension host layer |
| `@webview/*` | `src/webview/*` | Anything inside the React webview layer |
| `@shared/*` | `src/shared/*` | Types and contracts shared across layers |
| `@test/*` | `test/*` | Test helpers, mocks, fixtures |
| `@root/package.json` | `./package.json` | The extension package's `package.json` (only valid `@root/` target) |

```typescript
// Good
import { Button } from '@webview/components/Button';
import { logger } from '@extension/services/loggingService';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

// Bad (ESLint will reject)
import { Button } from '../../components/Button';
```

ESLint enforces this via `no-restricted-imports` (static imports/exports) and `no-restricted-syntax` (dynamic `import()`, `require()`, `vi.mock()`). Layer-boundary patterns continue to forbid `@webview` from `@extension` code and vice versa.

**Strict typing:**

- Enable `strict: true` in `tsconfig.json`
- Avoid `any` — use `unknown` for runtime type guards
- Use discriminated unions for message types
- Prefer interfaces for object shapes, types for unions

**Type imports:**

Use `import type` for type-only imports to avoid bundling:

```typescript
import type { VsCodeApi } from '@shared/messageContracts';
```

### Git Conventions

**Commit messages:**

Follow conventional commit format:

```
<type>(<scope>): <description>

<body>
```

**Types:**

- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code refactoring
- `test`: Test-related changes
- `docs`: Documentation
- `chore`: Build, tooling, dependencies

**Scopes:**

Use phase-plan format for GSD work (e.g., `feat(07-04): ...`), or module name (e.g., `fix(auth): ...`).

**Pre-commit hooks:**

ESLint auto-fix runs on staged files. Commit will fail if linting errors cannot be auto-fixed.

### Component Patterns

**Props interface:**

Always define props interface:

```typescript
interface YourComponentProps {
    title: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary';
}

export function YourComponent({ title, onClick, variant = 'primary' }: YourComponentProps) {
    // ...
}
```

**Event handlers:**

Pass values directly, not event objects:

```typescript
// Good
<Dropdown onChange={(value) => handleChange(value)} />

// Bad (harder to test)
<Dropdown onChange={(event) => handleChange(event.target.value)} />
```

**Avoid dangerouslySetInnerHTML:**

Use inline SVG or import SVG as React components instead of `dangerouslySetInnerHTML` for security.

---

## Additional Resources

- **VS Code Extension API:** https://code.visualstudio.com/api
- **Zustand Documentation:** https://github.com/pmndrs/zustand
- **esbuild Documentation:** https://esbuild.github.io/
- **React Documentation:** https://react.dev/
- **TypeScript Handbook:** https://www.typescriptlang.org/docs/

---

**Questions or issues?** Open an issue on the [GitHub repository](https://github.com/ls1intum/artemis-extension).
