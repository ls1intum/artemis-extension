# Architecture Research: Production Readiness Integration

**Domain:** VS Code Extension Webview Architecture (Production Readiness)
**Researched:** 2026-02-25
**Confidence:** HIGH

## Executive Summary

This research focuses on how production readiness features (Lucide icons, bundle optimization, strict TypeScript, comprehensive testing) integrate with the existing React webview architecture. The extension uses a dual-target esbuild setup (CJS for extension host, IIFE for webviews) with React 18, Zustand stores, CSS Modules, and typed message contracts.

**Key Findings:**
- **Lucide migration** requires component-level imports, minimal architecture changes
- **Bundle optimization** limited by IIFE format (code splitting unsupported), focus on tree-shaking
- **Strict TypeScript** requires incremental migration with typescript-strict-plugin for selective enforcement
- **Testing expansion** needs dual strategy: Vitest for React components, existing Mocha for extension host

## Current Architecture

### System Overview

```
┌────────────────────────────────────────────────────────────┐
│                    Extension Host (Node.js)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Auth Service │  │ API Service  │  │   WebSocket  │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                 │              │
│  ┌──────┴─────────────────┴─────────────────┴───────┐      │
│  │           WebviewProvider (postMessage)          │      │
│  └──────────────────────┬───────────────────────────┘      │
├────────────────────────┴────────────────────────────────────┤
│                  Message Bridge (nonce CSP)                 │
├─────────────────────────────────────────────────────────────┤
│                 React Webview (Browser IIFE)                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  ReactApp (view router) → 12 View Components        │   │
│  │    ↓ reads from                                      │   │
│  │  9 Zustand Stores (useChatStore, useDashboard...)   │   │
│  │    ↓ render                                          │   │
│  │  22 Shared Components (Button, ListItem, Badge...)  │   │
│  └──────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│               Web Workers (exam timers, background)          │
└─────────────────────────────────────────────────────────────┘
```

### Build Pipeline

```
esbuild.js (dual-target build)
├── Extension Host Bundle (CJS)
│   ├── Entry: src/extension.ts
│   ├── Format: CommonJS (Node.js)
│   ├── Platform: node
│   ├── External: ['vscode']
│   └── Output: dist/extension.js (665KB)
│
└── Webview Bundle (IIFE)
    ├── Entry: src/views/webview/react/index.tsx
    ├── Format: IIFE (browser)
    ├── Platform: browser
    ├── Plugins:
    │   ├── cssModulesPlugin() → camelCase class names
    │   └── inlineWorkerPlugin() → Web Worker bundling
    └── Output: dist/webview-react.js (3.5MB) ← OPTIMIZATION TARGET
```

**Critical constraint:** IIFE format does NOT support code splitting in esbuild ([Issue #16](https://github.com/evanw/esbuild/issues/16)). Code splitting only works with ESM format.

### Component Architecture

| Layer | Count | Responsibilities | File Pattern |
|-------|-------|------------------|--------------|
| **Views** | 12 | Full-page UI, Zustand integration | `src/views/webview/react/views/{ViewName}/` |
| **Stores** | 9 | State management, postMessage handlers | `src/views/webview/react/stores/use{Name}Store.ts` |
| **Components** | 22 | Reusable UI primitives | `src/views/webview/react/components/{Name}/{Name}.tsx` |
| **Message Contracts** | 1 | Typed extension ↔ webview messages | `src/shared/messageContracts.ts` |

### Current Icon System

**Custom SVG System:**
- **File:** `src/utils/iconDefinitions.ts`
- **Format:** Raw SVG strings in Record<string, string>
- **Usage:** `dangerouslySetInnerHTML` in components
- **Size impact:** All SVGs bundled regardless of usage

**Partial Lucide Usage:**
- Already imported in `DashboardView.tsx`
- Package installed: `lucide-react@0.575.0`
- Migration incomplete

## Production Readiness Integration Points

### 1. Lucide React Icon Migration

**Architecture Changes: MINIMAL (component-level only)**

#### What Changes
- **Modified:** All components currently using `IconDefinitions.ts` or inline SVGs
- **Removed:** `src/utils/iconDefinitions.ts` (entire file)
- **Pattern change:** From `dangerouslySetInnerHTML` to `<LucideIcon />` component

#### Bundle Size Impact
- **Before:** All custom SVGs bundled (~50+ icons)
- **After:** Only imported Lucide icons bundled (tree-shaking)
- **Import pattern critical:**
  ```typescript
  // ✅ CORRECT (tree-shakeable)
  import { Check, X, Menu } from 'lucide-react';

  // ❌ WRONG (imports entire library)
  import * as Icons from 'lucide-react';
  ```

**Source:** [Lucide React documentation](https://lucide.dev/guide/packages/lucide-react) confirms tree-shaking works with named imports. [2026 Bundle Analysis](https://medium.nkcroft.com/the-hidden-bundle-cost-of-react-icons-why-lucide-wins-in-2026-1ddb74c1a86c) shows Lucide outperforms react-icons by 60%+ with proper imports.

#### Implementation Pattern

**IconButton.tsx refactor:**
```typescript
// Before: Custom SVG
<svg width="16" height="16">
  <path d="M12 4L4 12M4 4L12 12" stroke="currentColor"/>
</svg>

// After: Lucide component
import { X, Check, Menu } from 'lucide-react';

<IconButton icon={<X size={16} />} ariaLabel="Close" />
```

**No store changes, no message contract changes, no build config changes.**

#### New Components
None. Lucide icons drop into existing `IconButton` component pattern.

#### Modified Components
- `Button.tsx`, `IconButton.tsx`, `BackLink.tsx`, `Dropdown.tsx`
- All view files using icons (12 views)
- Estimated: 30-40 file modifications

#### Data Flow
**Before:** IconDefinitions → dangerouslySetInnerHTML → DOM
**After:** lucide-react → React component → DOM

No state flow changes. Icons are presentational only.

---

### 2. Bundle Optimization (IIFE Constraints)

**Architecture Changes: BUILD CONFIG ONLY**

#### Code Splitting Limitation

**Critical finding:** esbuild does NOT support code splitting for IIFE format. From [esbuild Issue #2144](https://github.com/evanw/esbuild/issues/2144): "splitting currently only works with the 'esm' format."

**Impact:** Cannot split `webview-react.js` into route-based chunks while maintaining IIFE format required by VS Code webviews.

**Alternative:** Switch to ESM format + dynamic imports. This requires:
1. VS Code webview HTML changes (module scripts)
2. Runtime module loader overhead
3. Potential CSP complications

**Recommendation:** Defer to DX-03 deferred work item. Not viable for v1.1.

#### What IS Possible: Tree-Shaking Optimization

**Modified:** `esbuild.js` only (build config)

```javascript
// Enhanced production build
const webviewReactCtx = await esbuild.context({
  // ... existing config
  minify: production,
  treeShaking: true,  // Explicit (already default)
  metafile: true,     // Already present for analysis

  // NEW: Bundle analyzer integration
  plugins: [
    inlineWorkerPlugin(),
    cssModulesPlugin(),
    {
      name: 'bundle-analyzer',
      setup(build) {
        build.onEnd(async (result) => {
          if (production && result.metafile) {
            // Generate visual bundle analysis
            const text = await esbuild.analyzeMetafile(result.metafile);
            console.log(text);
          }
        });
      }
    },
    esbuildProblemMatcherPlugin,
  ],
});
```

**New npm script:**
```json
"analyze": "npx esbuild-visualizer --metadata=dist/meta.json --open"
```

Already exists in `package.json` line 184. Just needs documentation.

#### What Gets Smaller

| Category | Before | After | How |
|----------|--------|-------|-----|
| Lucide icons | N/A | Tree-shaken | Named imports only |
| Unused Zustand features | Bundled | Tree-shaken | ESM imports |
| React DevTools | Bundled (dev) | Excluded | `process.env.NODE_ENV` check |
| CSS Modules unused classes | Bundled | Removed | cssModulesPlugin dead code elim |

**Expected reduction:** 10-15% (350-525KB off 3.5MB) without code splitting.

**Source:** [esbuild FAQ](https://esbuild.github.io/faq/) confirms tree-shaking works across formats. [Webpack vs esbuild 2026](https://www.mindfulchase.com/explore/troubleshooting-tips/build-bundling/troubleshooting-build,-plugin,-and-performance-issues-in-esbuild.html) shows minification + tree-shaking typically achieves 10-20% reduction.

#### New Components
- Bundle analyzer script (shell/npm script)
- CI bundle size tracking (optional: store meta.json in git, diff on PR)

#### Modified Components
- `esbuild.js` (build config)
- `package.json` (document existing `analyze` script)

#### Data Flow
No runtime data flow changes. This is build-time optimization only.

---

### 3. Strict TypeScript Migration

**Architecture Changes: COMPILER CONFIG + INCREMENTAL FILE UPDATES**

#### Current State
```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,  // Already enabled!
    // But 10 pre-existing errors remain unfixed
  }
}
```

**Problem:** `strict: true` is enabled but not enforced. Errors exist in:
- Legacy non-React code (pre-migration)
- Extension host services (auth, API, WebSocket)
- Message handlers (any-typed event objects)

#### Incremental Migration Strategy

**Pattern 1: Use typescript-strict-plugin for Selective Enforcement**

**Install:**
```bash
npm install -D typescript-strict-plugin
```

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "strict": true,
    "plugins": [
      { "name": "typescript-plugin-css-modules" },
      {
        "name": "typescript-strict-plugin",
        "paths": ["./src/views/webview/react/**/*"]  // Enforce in React code ONLY
      }
    ]
  }
}
```

**Effect:** New React code MUST be strict-compliant. Legacy code can be fixed incrementally.

**Source:** [TypeScript Strict Plugin](https://github.com/allegro/typescript-strict-plugin) allows per-directory strict enforcement. [2026 Migration Guide](https://oneuptime.com/blog/post/2026-02-20-typescript-strict-mode-guide/view) recommends incremental approach starting with new code.

#### Common Fixes Required

**1. Implicit Any (noImplicitAny)**
```typescript
// Before
function handleMessage(msg) {  // 'msg' is any
  vscode.postMessage(msg);
}

// After
function handleMessage(msg: WebviewToExtensionMessage) {
  vscode.postMessage(msg);
}
```

**2. Nullable Types (strictNullChecks)**
```typescript
// Before
const session = sessions.find(s => s.id === id);
session.messages = [];  // Error: session possibly undefined

// After
const session = sessions.find(s => s.id === id);
if (session) {
  session.messages = [];
}
// OR
const session = sessions.find(s => s.id === id)!;  // Non-null assertion (use sparingly)
```

**3. Uninitialized Properties (strictPropertyInitialization)**
```typescript
// Before
class MyService {
  apiClient: ApiClient;  // Error: not initialized
}

// After
class MyService {
  apiClient: ApiClient | null = null;
  // OR
  apiClient!: ApiClient;  // Definite assignment assertion
}
```

#### New Components
- **TypeScript Strict Plugin** (dev dependency)
- **Type guard utilities** (optional: `src/utils/typeGuards.ts`)

#### Modified Components
- `tsconfig.json` (add plugin config)
- All files with TypeScript errors (10+ files)
- Potentially: message handler files (5-10 files)

#### Data Flow Changes
**None at runtime.** Type annotations don't affect compiled JavaScript. This is compile-time only.

---

### 4. Comprehensive Testing Expansion

**Architecture Changes: NEW TESTING LAYER + TEST INFRASTRUCTURE**

#### Current Testing Setup

**Framework:** Mocha + @vscode/test-cli
**Structure:**
```
test/
├── ui/                   # vscode-extension-tester (Selenium)
│   ├── login.ui.test.ts
│   └── login-flow.ui.test.ts
├── auth/                 # Unit tests (extension host)
├── provider/             # Unit tests (extension host)
└── utils/                # Unit tests (extension host)
```

**Config:** `.vscode-test.mjs` defines two test labels:
- `unit` → All tests except e2e
- `e2e` → Integration tests (requires Artemis server)

**Gap:** No React component tests. 10,174 LOC of React code (22 components, 12 views) untested.

#### Dual Testing Strategy

**Why Not Mocha for React?** Mocha runs in Node.js. React components need DOM. Options:
1. **jsdom** (Node.js DOM simulation) — works but incomplete, missing Web APIs
2. **happy-dom** (faster jsdom alternative) — same limitations
3. **Vitest Browser Mode** (real browser) — full DOM + Web APIs

**Recommendation:** Add Vitest for React components, keep Mocha for extension host.

**Source:** [2026 Testing Trends](https://www.nucamp.co/blog/testing-in-2026-jest-react-testing-library-and-full-stack-testing-strategies) recommend Vitest for Vite/ESM projects. [VS Code Extension Testing Guide](https://devblogs.microsoft.com/ise/testing-vscode-extensions-with-typescript/) confirms official tools don't support webview testing.

#### New Testing Architecture

```
Extension Testing (unchanged)
├── Mocha (@vscode/test-cli)
│   ├── Extension host unit tests
│   ├── Integration tests (extension + VS Code APIs)
│   └── UI tests (vscode-extension-tester)
│
└── NEW: React Component Testing
    └── Vitest + React Testing Library
        ├── Component unit tests (Button, ListItem, etc.)
        ├── View integration tests (Dashboard, Chat, etc.)
        └── Store tests (Zustand actions/selectors)
```

#### Implementation: Vitest Setup

**Install:**
```bash
npm install -D vitest @testing-library/react @testing-library/user-event \
  @vitest/ui jsdom @types/testing-library__react
```

**vitest.config.ts (new file):**
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './test/react/setup.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'out', 'test/ui/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
```

**test/react/setup.ts (new file):**
```typescript
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Mock VS Code API
global.acquireVsCodeApi = vi.fn(() => ({
  postMessage: vi.fn(),
  getState: vi.fn(),
  setState: vi.fn(),
}));

// Cleanup after each test
afterEach(() => {
  cleanup();
});
```

**package.json scripts:**
```json
{
  "scripts": {
    "test:react": "vitest",
    "test:react:ui": "vitest --ui",
    "test:react:coverage": "vitest --coverage",
    "test:all": "npm run test:react && vscode-test"
  }
}
```

#### Example Component Test

**Button.test.tsx (new file):**
```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('renders with correct text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
  });

  it('calls onClick handler when clicked', async () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);

    await userEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('disables button when disabled prop is true', () => {
    render(<Button disabled>Click me</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
```

#### Example Store Test

**useChatStore.test.ts (new file):**
```typescript
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useChatStore } from './useChatStore';

describe('useChatStore', () => {
  it('adds message to store', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.addMessage({
        localId: '123',
        role: 'user',
        content: 'Hello Iris',
        timestamp: Date.now(),
      });
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toBe('Hello Iris');
  });

  it('clears all messages', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.addMessage({ /* ... */ });
      result.current.addMessage({ /* ... */ });
      result.current.clearMessages();
    });

    expect(result.current.messages).toHaveLength(0);
  });
});
```

#### New Components

| Component | Purpose | Location |
|-----------|---------|----------|
| `vitest.config.ts` | Vitest configuration | Root |
| `test/react/setup.ts` | Test environment setup | test/react/ |
| `*.test.tsx` files | Component tests | Colocated with components |
| `*.test.ts` files (stores) | Store tests | Colocated with stores |

**Colocated pattern:**
```
src/views/webview/react/components/Button/
├── Button.tsx
├── Button.module.css
└── Button.test.tsx  ← NEW
```

#### Modified Components
- `package.json` (add Vitest scripts and deps)
- `.gitignore` (add `coverage/` directory)
- CI config (run both Mocha and Vitest)

#### Data Flow Changes
**None.** Tests don't affect runtime. Vitest runs in separate process.

---

## Integration Dependencies and Build Order

### Phase 1: Foundation (No Dependencies)
1. **Lucide Migration** (icon system replacement)
   - New: Install lucide-react (already installed)
   - Modified: 30-40 component files
   - Test: Visual regression (manual)
   - Risk: LOW (presentational only)

2. **TypeScript Strict Plugin** (incremental enforcement)
   - New: Install typescript-strict-plugin
   - Modified: tsconfig.json
   - Test: `npm run check-types` passes
   - Risk: LOW (no runtime changes)

### Phase 2: Infrastructure (Depends on Phase 1)
3. **Bundle Optimization** (build config)
   - New: Bundle analyzer script
   - Modified: esbuild.js
   - Test: `npm run analyze`, measure bundle size
   - Risk: LOW (build-time only)
   - **Dependency:** Should follow Lucide migration to measure tree-shaking impact

4. **Vitest Testing Setup** (new test layer)
   - New: vitest.config.ts, test/react/setup.ts
   - Modified: package.json (scripts, devDeps)
   - Test: Run `npm run test:react` (empty suite passes)
   - Risk: MEDIUM (new build tool, potential conflicts)

### Phase 3: Implementation (Depends on Phase 2)
5. **Fix TypeScript Errors** (incremental)
   - New: Type guard utilities (optional)
   - Modified: 10+ files with errors
   - Test: `npm run check-types` zero errors
   - Risk: MEDIUM (potential runtime behavior changes)
   - **Dependency:** Requires strict plugin from Phase 1

6. **Write React Component Tests** (test coverage)
   - New: 50-100 test files
   - Modified: None (tests only)
   - Test: `npm run test:react:coverage` target 80%+
   - Risk: LOW (no production code changes)
   - **Dependency:** Requires Vitest setup from Phase 2

### Parallel vs Sequential

**Can be done in parallel:**
- Lucide migration + TypeScript strict plugin (independent)
- Bundle optimization + Vitest setup (different domains)

**Must be sequential:**
- Bundle optimization AFTER Lucide migration (to measure impact)
- Component tests AFTER Vitest setup (infrastructure required)
- TypeScript error fixes AFTER strict plugin (enforcement tool required)

### Critical Path
1. Lucide migration (foundation for bundle optimization)
2. Bundle optimization (validate tree-shaking works)
3. Vitest setup (foundation for testing)
4. Component tests (quality gate)

**Total estimated duration:** 2-3 weeks for all phases.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Code Splitting with IIFE

**What people try:** Enable `splitting: true` in esbuild config for IIFE format.

**Why it fails:** esbuild only supports code splitting with ESM format. IIFE generates a single file by design.

**Do this instead:** Accept single bundle OR switch to ESM format (requires webview HTML changes, CSP updates, module loader overhead). Recommend: defer to DX-03.

---

### Anti-Pattern 2: Barrel Imports for Icons

**What people do:**
```typescript
import * as Icons from 'lucide-react';
<Icons.Check />
```

**Why it's wrong:** Imports entire Lucide library (~50KB compressed). Tree-shaking fails with namespace imports.

**Do this instead:**
```typescript
import { Check, X, Menu } from 'lucide-react';
<Check />
```

**Source:** [Lucide React documentation](https://lucide.dev/guide/packages/lucide-react) explicitly warns against barrel imports.

---

### Anti-Pattern 3: Testing React Components with Mocha

**What people do:** Try to use Mocha + jsdom for React component tests.

**Why it's wrong:**
- jsdom incomplete (missing Web APIs like IntersectionObserver)
- No React Testing Library integration
- Slow compared to Vitest
- Maintenance burden (two test frameworks)

**Do this instead:** Use Vitest with jsdom or Vitest Browser Mode. Modern, fast, React-native.

**Source:** [2026 Testing Strategies](https://www.nucamp.co/blog/testing-in-2026-jest-react-testing-library-and-full-stack-testing-strategies) show Vitest 10-20x faster than Jest/Mocha for React.

---

### Anti-Pattern 4: Enabling All Strict Flags at Once

**What people do:**
```json
{
  "strict": true,
  "noImplicitAny": true,
  "strictNullChecks": true,
  // ... all flags enabled
}
```

Then try to fix 100+ errors across entire codebase.

**Why it's wrong:** Overwhelming. Blocks progress. High risk of introducing bugs in "quick fixes."

**Do this instead:** Use typescript-strict-plugin to enforce strict mode only in new code (React components). Fix legacy code incrementally.

**Source:** [Incremental Migration Guide](https://preetmishra.com/blog/migrating-to-typescript-strict-mode-at-an-early-stage-startup) recommends phased approach.

---

### Anti-Pattern 5: Running All Tests in Single Process

**What people do:** Try to run Mocha extension tests + Vitest React tests in same process.

**Why it's wrong:** Different environments (Node.js vs jsdom), different assertion libraries, different mocking strategies. Conflicts inevitable.

**Do this instead:** Separate test commands:
```json
{
  "test:extension": "vscode-test --label unit",
  "test:react": "vitest",
  "test:all": "npm run test:react && npm run test:extension"
}
```

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| **Current (v1.1)** | Single IIFE bundle (~3MB), Lucide tree-shaking, Vitest for React |
| **v1.2-1.5** | Bundle size monitoring in CI, lazy-load heavy dependencies (Shiki, Streamdown) |
| **v2.0+** | Consider ESM format + dynamic imports for route-based splitting (DX-03) |

### When to Consider Code Splitting

**Trigger:** Bundle size exceeds 5MB despite optimization.

**Approach:**
1. Switch webview bundle format from IIFE to ESM
2. Update webview HTML to use `<script type="module">`
3. Add dynamic imports for route boundaries:
   ```typescript
   const DashboardView = lazy(() => import('./views/Dashboard'));
   const ChatView = lazy(() => import('./views/IrisChat'));
   ```
4. Update CSP to allow module scripts
5. Add loading fallback for Suspense boundaries

**Estimated impact:** 40-60% reduction in initial load (load only active view).

**Complexity:** HIGH (requires CSP changes, webview provider updates, testing in multiple VS Code versions).

---

## Summary: Integration Overview

### New Components Required

| Component | Type | Purpose | Size |
|-----------|------|---------|------|
| **vitest.config.ts** | Config | Vitest configuration | ~50 lines |
| **test/react/setup.ts** | Setup | Test environment mocks | ~30 lines |
| **Bundle analyzer script** | Script | Visualize bundle composition | ~20 lines |
| **Component test files** | Tests | React component coverage | ~2000-5000 lines |
| **Store test files** | Tests | Zustand store coverage | ~500-1000 lines |

**Total new code:** ~3000-6000 lines (mostly tests).

### Modified Components

| Component | Changes | Impact |
|-----------|---------|--------|
| **esbuild.js** | Add bundle analyzer plugin | Build-time only |
| **tsconfig.json** | Add typescript-strict-plugin | Compile-time only |
| **package.json** | Add Vitest scripts/deps | Dev dependencies |
| **30-40 component files** | Replace IconDefinitions with Lucide | Runtime (icons) |
| **10+ files with TS errors** | Fix strict mode violations | Runtime (type safety) |

### Data Flow Changes

**Runtime data flow:** UNCHANGED
- Lucide renders same as custom SVGs (just different source)
- TypeScript annotations compile away
- Tests run in separate process

**Build-time data flow:** ENHANCED
- Bundle analyzer provides visibility
- Vitest adds component test layer
- TypeScript strict plugin enforces quality

### No Changes Required

- **Message contracts** (typed communication unchanged)
- **Zustand stores** (state management unchanged)
- **Extension host services** (auth, API, WebSocket unchanged)
- **CSS Modules** (styling system unchanged)
- **Web Workers** (background tasks unchanged)
- **Webview provider** (postMessage bridge unchanged)

---

## Sources

### Bundle Optimization
- [esbuild API Documentation](https://esbuild.github.io/api/)
- [Code splitting limitations - Issue #16](https://github.com/evanw/esbuild/issues/16)
- [VS Code Extension Building Guide 2026](https://abdulkadersafi.com/blog/building-vs-code-extensions-in-2026-the-complete-modern-guide)
- [Configuring VSCode Extensions with Webpack and React](https://medium.com/@captaincolinr/vscode-react-extension-guide-10ea25cb983f)

### Lucide React
- [Lucide React Documentation](https://lucide.dev/guide/packages/lucide-react)
- [React Icon Libraries Bundle Size Analysis 2026](https://medium.nkcroft.com/the-hidden-bundle-cost-of-react-icons-why-lucide-wins-in-2026-1ddb74c1a86c)
- [Best React Icon Libraries for 2026](https://mighil.com/best-react-icon-libraries)

### TypeScript Strict Mode
- [TypeScript Strict Mode Guide 2026](https://oneuptime.com/blog/post/2026-02-20-typescript-strict-mode-guide/view)
- [TypeScript Strict Plugin](https://github.com/allegro/typescript-strict-plugin)
- [Incremental Migration to Strict Mode](https://preetmishra.com/blog/migrating-to-typescript-strict-mode-at-an-early-stage-startup)
- [Understanding TypeScript's Strict Compiler Option](https://betterstack.com/community/guides/scaling-nodejs/typescript-strict-option/)

### Testing
- [Vitest Component Testing Guide](https://vitest.dev/guide/browser/component-testing)
- [Testing in 2026: Jest, React Testing Library, and Full Stack Strategies](https://www.nucamp.co/blog/testing-in-2026-jest-react-testing-library-and-full-stack-testing-strategies)
- [VS Code Extension Testing Documentation](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [Complete Guide to VS Code Extension Testing](https://dev.to/sourishkrout/a-complete-guide-to-vs-code-extension-testing-268p)
- [Using React in VS Code Webviews](https://www.kenmuse.com/blog/using-react-in-vs-code-webviews/)

---

*Architecture research for: Artemis Extension v1.1 Production Readiness*
*Researched: 2026-02-25*
