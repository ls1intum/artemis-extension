# Stack Research: v1.1 Production Readiness

**Domain:** VS Code Extension Enhancement (Type Safety, Bundle Optimization, Testing, UI Polish)
**Researched:** 2026-02-25
**Confidence:** HIGH

## Overview

This research focuses on specific stack additions needed to make the Artemis VS Code extension production-ready. The existing React 18.3.1 + esbuild + Zustand architecture (established in v1.0) remains unchanged. We're adding capabilities for: 1) 100% type safety, 2) bundle size reduction, 3) comprehensive testing, and 4) complete Lucide icon migration.

## Core Technologies (Already in Place from v1.0)

| Technology | Version | Purpose | Notes |
|------------|---------|---------|-------|
| React | 18.3.1 | Webview UI framework | Already installed, no changes needed |
| esbuild | 0.27.2 | Dual-target bundler (Node.js CJS + browser IIFE) | Already installed, config changes needed |
| TypeScript | 5.9.3 | Type system | Upgrade to strict mode |
| Zustand | 5.0.11 | State management | Already installed, no changes needed |
| lucide-react | 0.575.0 | Icon system | Already installed, need full migration |

## New Stack Additions for v1.1

### 1. Type Safety (Strict TypeScript)

| Package | Version | Purpose | Installation |
|---------|---------|---------|--------------|
| TypeScript | 5.9.3 (current) | Strict mode enabled via tsconfig | Already installed |

**Configuration Changes (tsconfig.json):**

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "useUnknownInCatchVariables": true,
    "alwaysStrict": true,
    "noUncheckedIndexedAccess": true
  }
}
```

**Why:** TypeScript's strict mode catches entire categories of bugs at compile time. With TypeScript 6.0 (upcoming), strict mode is enabled by default. Enabling this now prevents future migration pain and catches runtime errors earlier.

**Migration Strategy:** Enable flags incrementally starting with `noImplicitAny` and `strictNullChecks`, then add remaining flags. Fix errors file-by-file rather than all at once.

### 2. Bundle Size Optimization

| Tool | Version | Purpose | Installation |
|------|---------|---------|--------------|
| esbuild (built-in) | 0.27.2 | Metafile generation for analysis | Already installed |
| esbuild-visualizer | 0.7.0 | Visual bundle size analysis | `npm install -D esbuild-visualizer` |
| @rnx-kit/esbuild-bundle-analyzer | Latest | Advanced bundle comparison | `npm install -D @rnx-kit/esbuild-bundle-analyzer` |

**esbuild Configuration Changes:**

```javascript
// esbuild.js - Add metafile generation
{
  metafile: true,
  // Enable tree shaking (automatic with bundle: true)
  bundle: true,
  // For code splitting (requires format: 'esm')
  splitting: false, // IIFE format doesn't support splitting
  treeShaking: true, // Explicit tree shaking
}
```

**Analysis Commands:**

```bash
# Generate metafile during build
node esbuild.js --production  # Outputs dist/meta.json

# Visualize with esbuild-visualizer
npx esbuild-visualizer --metadata=dist/meta.json --open

# Or use official esbuild analyzer
# Upload dist/meta.json to https://esbuild.github.io/analyze/
```

**Optimization Strategies:**

1. **Tree Shaking:** Already enabled with `bundle: true`. Requires ESM imports (`import` not `require`).
2. **Manual Chunking:** esbuild doesn't support manual chunks like Rollup. Consider dynamic imports for large libraries (e.g., `const shiki = await import('shiki')`).
3. **Bundle Analysis:** Use metafile to identify large dependencies. Common culprits: Shiki (syntax highlighting), DOMPurify, STOMP client.
4. **Code Splitting Limitation:** IIFE format (required for VS Code webviews with single file) doesn't support `splitting: true`. Alternative: Multiple entry points with shared chunks, but requires webview architecture changes (deferred to ARCH-01).

**What NOT to Change:**

- Do NOT switch from esbuild to webpack. esbuild is 10-100x faster and the extension build is already optimized for dual-target output.
- Do NOT switch to ESM format for webview bundle. VS Code webviews require IIFE format for single-file loading with CSP.
- Do NOT add Rollup. esbuild handles the current use case; Rollup's advanced chunking isn't usable with IIFE.

### 3. Comprehensive Testing

| Package | Version | Purpose | Installation |
|---------|---------|---------|--------------|
| vitest | Latest (^3.0.0) | Test runner (Jest-compatible, 10-20x faster) | `npm install -D vitest` |
| @vitest/ui | Latest | Interactive test UI and coverage viewer | `npm install -D @vitest/ui` |
| @vitest/coverage-v8 | Latest | V8-based coverage (faster than Istanbul) | `npm install -D @vitest/coverage-v8` |
| @testing-library/react | Latest (~16.1.0) | React component testing utilities | `npm install -D @testing-library/react` |
| @testing-library/jest-dom | Latest (~6.7.0) | Custom matchers for DOM testing | `npm install -D @testing-library/jest-dom` |
| @testing-library/user-event | Latest (~14.6.0) | User interaction simulation | `npm install -D @testing-library/user-event` |
| happy-dom | Latest (~16.7.0) | Fast DOM environment (2-3x faster than jsdom) | `npm install -D happy-dom` |
| @vitejs/plugin-react | Latest | React transform support for Vitest | `npm install -D @vitejs/plugin-react` |

**Why Vitest over Jest:**

- **Performance:** 10-20x faster in watch mode with HMR-based test running
- **ESM Native:** No experimental flags needed (Jest requires `--experimental-vm-modules`)
- **Vite Integration:** Uses same esbuild-powered transform as build pipeline
- **Jest Compatible:** Drop-in API replacement (`describe`, `test`, `expect`, etc.)
- **2026 Ecosystem:** Recommended by Nuxt, SvelteKit, Astro, Angular tooling

**Why happy-dom over jsdom:**

- **Speed:** 2-3x faster than jsdom, crucial for large test suites
- **Memory:** Lower memory footprint for CI/CD environments
- **Trade-off:** Less complete browser API than jsdom, but covers 95% of use cases
- **Fallback:** If specific browser APIs are missing, can switch to jsdom per-test with `@vitest/browser`

**Configuration (vitest.config.ts):**

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: './test/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/test/**'],
    },
  },
});
```

**Setup File (test/setup.ts):**

```typescript
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
```

**TypeScript Types (tsconfig.json):**

```json
{
  "compilerOptions": {
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  }
}
```

**Test Scripts (package.json):**

```json
{
  "scripts": {
    "test:unit": "vitest",
    "test:unit:ui": "vitest --ui",
    "test:coverage": "vitest --coverage",
    "test:watch": "vitest --watch"
  }
}
```

**What This Replaces:**

- Current `@vscode/test-electron` for extension host tests: KEEP (necessary for VS Code API integration tests)
- Current `vscode-extension-tester` for UI tests: KEEP (necessary for end-to-end webview tests)
- New Vitest: ADD for React component unit tests (store logic, components, utilities)

**Testing Strategy:**

1. **Unit Tests (Vitest):** React components, Zustand stores, utility functions
2. **Integration Tests (@vscode/test-electron):** Extension host services (auth, WebSocket, telemetry)
3. **UI Tests (vscode-extension-tester):** End-to-end webview interactions

### 4. Icon System (Complete Lucide Migration)

| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| lucide-react | 0.575.0 | Icon components | Already installed |

**What's Needed:** Migration work, not new dependencies.

**Current State:**

- lucide-react 0.575.0 installed (1701 icons, published 5 days ago)
- Tree-shakeable (ESM, each icon is a separate component)
- Zero bundle impact for unused icons

**Migration Tasks:**

1. Find remaining VS Code Codicon references (`$(icon-name)`)
2. Replace with Lucide equivalents (`import { IconName } from 'lucide-react'`)
3. Remove `react-icons` if present (check dependencies)
4. Standardize icon sizes (16px for inline, 20px for buttons, 24px for headers)

**Why Lucide over react-icons:**

- **Bundle Size:** Lucide is fully tree-shakeable (ESM). react-icons bundles entire icon sets.
- **Consistency:** Single design system. react-icons mixes Font Awesome, Material, Bootstrap, etc.
- **Performance:** Inline SVG with optimized paths. react-icons uses more complex SVG structures.
- **2026 Benchmark:** Lucide shows linear bundle growth (100KB for 50 icons). react-icons shows exponential growth (250KB for 50 icons from mixed sets).

**What NOT to Add:**

- Do NOT install `react-icons` (already using lucide-react)
- Do NOT install icon fonts (Font Awesome, Material Icons) - SVG components are faster and more flexible
- Do NOT use VS Code Codicons in React components - they're for native VS Code UI only

## Installation Commands

### Type Safety
```bash
# No new packages, just tsconfig changes
```

### Bundle Optimization
```bash
npm install -D esbuild-visualizer @rnx-kit/esbuild-bundle-analyzer
```

### Testing
```bash
npm install -D vitest @vitest/ui @vitest/coverage-v8 \
  @testing-library/react @testing-library/jest-dom @testing-library/user-event \
  happy-dom @vitejs/plugin-react
```

### Icons
```bash
# Already installed, no action needed
```

## Alternatives Considered

| Category | Recommended | Alternative | When to Use Alternative |
|----------|-------------|-------------|-------------------------|
| Test Runner | Vitest | Jest | Legacy codebases with extensive Jest plugins, or if happy-dom lacks needed APIs |
| DOM Environment | happy-dom | jsdom | If specific browser APIs missing (e.g., `MutationObserver`, `IntersectionObserver`) |
| Coverage Provider | @vitest/coverage-v8 | @vitest/coverage-istanbul | If v8 coverage is inaccurate (rare with modern TypeScript) |
| Bundle Analyzer | esbuild-visualizer | @rnx-kit/esbuild-bundle-analyzer | For CI/CD comparison of bundle sizes across PRs |
| Bundler | esbuild | webpack | If need advanced code splitting (requires architecture change to multi-file webview) |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Jest + ts-jest | 10-20x slower than Vitest, requires experimental ESM flags | Vitest (Jest-compatible API) |
| webpack | 10-100x slower than esbuild for same output | esbuild (already in use) |
| Rollup | Doesn't support IIFE format code splitting | esbuild with dynamic imports |
| jsdom (initially) | 2-3x slower than happy-dom | happy-dom (fallback to jsdom if APIs missing) |
| react-icons | Poor tree shaking, mixed design systems | lucide-react (already installed) |
| vscode-codicon (in React) | Not designed for React, bundle bloat | lucide-react for webview UI |
| Custom bundle splitting | esbuild IIFE doesn't support `splitting: true` | Dynamic imports or defer to ARCH-01 |

## Integration with Existing Build Pipeline

### Current esbuild Setup (Dual-Target)

```javascript
// esbuild.js (simplified view)
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
};

const webviewConfig = {
  entryPoints: ['src/webview/index.tsx'],
  bundle: true,
  outfile: 'dist/webview-react.js',
  platform: 'browser',
  format: 'iife',
  plugins: [cssModulesPlugin, inlineWorkerPlugin],
};
```

### Additions for v1.1

```javascript
// Add metafile generation for both targets
const extensionConfig = {
  // ... existing config
  metafile: true,
  treeShaking: true,
};

const webviewConfig = {
  // ... existing config
  metafile: true,
  treeShaking: true,
  // Code splitting not supported with IIFE
  // splitting: false, // implicit with format: 'iife'
};

// Write metafiles for analysis
await writeFile('dist/meta-extension.json', JSON.stringify(extensionResult.metafile));
await writeFile('dist/meta-webview.json', JSON.stringify(webviewResult.metafile));
```

### Bundle Analysis Workflow

```bash
# 1. Build with metafile generation
npm run package

# 2. Analyze webview bundle (3.5MB target)
npx esbuild-visualizer --metadata=dist/meta-webview.json --open

# 3. Compare before/after optimization
npx @rnx-kit/esbuild-bundle-analyzer compare \
  dist/meta-webview-before.json \
  dist/meta-webview-after.json
```

## Version Compatibility Matrix

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| vitest ^3.0.0 | React 18.3.1 | Via @vitejs/plugin-react |
| @testing-library/react ~16.1.0 | React 18.3.1 | React 18 specific version |
| happy-dom ~16.7.0 | Vitest ^3.0.0 | Built-in environment support |
| @vitest/coverage-v8 | Vitest ^3.0.0 | Matches Vitest major version |
| lucide-react 0.575.0 | React 18.3.1 | ESM tree-shakeable |
| esbuild 0.27.2 | TypeScript 5.9.3 | Full TS support including decorators |

## Dependency Cleanup Opportunities

Based on existing package.json analysis:

### Keep
- `@vscode/test-cli`, `@vscode/test-electron`: Extension host integration tests
- `vscode-extension-tester`: UI end-to-end tests
- `esbuild`, `esbuild-css-modules-plugin`, `esbuild-plugin-inline-worker`: Build pipeline
- `clsx`: Utility (lightweight, 2KB)
- `typescript-plugin-css-modules`: Editor IntelliSense for CSS Modules

### Add (for v1.1)
- `vitest`, `@vitest/ui`, `@vitest/coverage-v8`
- `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`
- `happy-dom`, `@vitejs/plugin-react`
- `esbuild-visualizer`, `@rnx-kit/esbuild-bundle-analyzer`

### Investigate for Removal (during dependency audit)
- Check if any icon libraries other than `lucide-react` are present
- Check for duplicate TypeScript type packages
- Check for unused ESLint plugins (if any beyond @typescript-eslint)

## Stack Patterns by Use Case

### If Bundle Size < 2MB After Initial Optimization
- Use dynamic imports sparingly (complexity cost)
- Focus on tree-shaking verification
- Consider lazy loading for Shiki (syntax highlighting) since it's only used in chat view

### If Bundle Size Still > 2MB After Tree-Shaking
- Profile with metafile to find largest dependencies
- Consider splitting Shiki into separate worker bundle (already using inline worker plugin)
- Evaluate if Streamdown (markdown renderer) can be replaced with lighter alternative
- Flag for ARCH-01 (stateless webview with multi-file architecture)

### If TypeScript Errors > 100 After Enabling Strict Mode
- Use `// @ts-expect-error` with explanation for VS Code API edge cases
- Create type assertion helpers (e.g., `assertIsDefined<T>(val: T | undefined): asserts val is T`)
- Enable strict flags one at a time rather than all at once

### If happy-dom Missing Required APIs
- Switch to jsdom for specific test files: `// @vitest-environment jsdom`
- Or use `@vitest/browser` for real browser testing (slower, but complete API)
- Document which tests need jsdom in test comments

## Performance Benchmarks (Expected)

| Metric | Before | After | Target |
|--------|--------|-------|--------|
| Bundle Size (webview) | 3.5MB | 2.0MB | < 2MB |
| Test Suite Speed | N/A (no component tests) | ~100ms for 50 tests | < 200ms |
| Type Safety | 10 `any` errors | 0 strict mode errors | 0 errors |
| Tree Shaking | Unknown | Verified via metafile | 90%+ of unused code removed |
| Build Time | ~2s | ~2s (esbuild unchanged) | < 3s |

## Sources

### Type Safety
- [TypeScript: TSConfig Option: strict](https://www.typescriptlang.org/tsconfig/strict.html) — Official strict mode documentation
- [How to Enable and Use TypeScript Strict Mode Effectively](https://oneuptime.com/blog/post/2026-02-20-typescript-strict-mode-guide/view) — 2026 best practices (MEDIUM confidence)
- [What Are the New tsconfig Defaults in TypeScript 6.0?](https://docs.bswen.com/blog/2026-02-21-typescript-60-tsconfig-defaults/) — TypeScript 6.0 defaults (MEDIUM confidence)

### Bundle Optimization
- [esbuild - API](https://esbuild.github.io/api/) — Official esbuild documentation
- [A Look at esbuild's Advanced Features: Code Splitting, Tree Shaking, and More](https://codedamn.com/news/javascript/a-look-at-esbuild-advanced-features) — esbuild optimization guide (MEDIUM confidence)
- [esbuild - Bundle Size Analyzer](https://esbuild.github.io/analyze/) — Official bundle analyzer tool
- [esbuild-visualizer - npm](https://www.npmjs.com/package/esbuild-visualizer) — Third-party visualizer package
- [Bundling Extensions | Visual Studio Code Extension API](https://code.visualstudio.com/api/working-with-extensions/bundling-extension) — VS Code bundling guidance

### Testing
- [Vitest vs Jest 2026: Performance Benchmarks and Migration Guide](https://www.sitepoint.com/vitest-vs-jest-2026-migration-benchmark/) — Vitest performance analysis (HIGH confidence)
- [Vitest vs. Jest: Choosing The Right Testing Framework](https://saucelabs.com/resources/blog/vitest-vs-jest-comparison) — Framework comparison (MEDIUM confidence)
- [How to Unit Test React Components with Vitest and React Testing Library](https://oneuptime.com/blog/post/2026-01-15-unit-test-react-vitest-testing-library/view) — Setup guide (MEDIUM confidence)
- [Vitest with React Testing Library: A Modern Approach to Testing React Apps](https://blog.incubyte.co/blog/vitest-react-testing-library-guide/) — Integration patterns (MEDIUM confidence)
- [jsdom vs happy-dom: Navigating the Nuances of JavaScript Testing](https://blog.seancoughlin.me/jsdom-vs-happy-dom-navigating-the-nuances-of-javascript-testing) — DOM environment comparison (MEDIUM confidence)
- [Coverage | Guide | Vitest](https://vitest.dev/guide/coverage.html) — Official coverage documentation

### Icons
- [Lucide React – Lucide](https://lucide.dev/guide/packages/lucide-react) — Official Lucide React documentation
- [The Hidden Bundle Cost of React Icons: A Next.js 16 Turbopack Benchmark](https://medium.nkcroft.com/the-hidden-bundle-cost-of-react-icons-why-lucide-wins-in-2026-1ddb74c1a86c) — Performance benchmark (MEDIUM confidence)
- [lucide-react 0.575.0 on npm](https://libraries.io/npm/lucide-react) — Current version information

---
*Stack research for: Artemis VS Code Extension v1.1 Production Readiness*
*Researched: 2026-02-25*
*Confidence: HIGH (official docs + verified 2026 sources)*
