# Pitfalls Research

**Domain:** VS Code Extension Production Readiness (Type Safety, Bundle Optimization, Testing, Dependency Cleanup)
**Researched:** 2026-02-25
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: IIFE Bundle Format Prevents Code Splitting

**What goes wrong:**
VS Code webviews require IIFE format bundles, but esbuild's code splitting feature is fundamentally incompatible with IIFE format. Attempting to enable code splitting results in build failures or runtime errors. This is a hard constraint: the 3.5MB bundle cannot be split into multiple chunks while maintaining IIFE format.

**Why it happens:**
- IIFE format doesn't support dynamic module loading (no `import()` or module resolution)
- Webview asset locations vary across machines, making dynamic chunk loading unreliable
- Code splitting requires either ESM format or complex webpack `publicPath` workarounds
- esbuild's single entry point limitation: "Builds with a single entry point will not generate chunks"

**How to avoid:**
- Accept IIFE as single-file constraint and focus on tree-shaking instead
- Use bundle analysis tools (esbuild-visualizer, esbuild Bundle Size Analyzer) to identify large dependencies
- Implement lazy initialization for heavy libraries (Shiki highlighter already does this correctly)
- Split concerns into separate extension contexts if truly needed (multiple webviews with independent bundles)
- Consider dynamic imports for Web Workers (can use blob URLs), but not main webview code

**Warning signs:**
- Bundle metafile shows duplicate dependencies across potential split points
- Large libraries (Shiki: ~500KB, React: ~140KB) dominate bundle size
- Dependencies with poor tree-shaking (Font Awesome, Material Icons with side effects)

**Phase to address:**
Phase 2 (Bundle Optimization) — Document constraint, focus on tree-shaking and lazy loading, not code splitting

---

### Pitfall 2: Big-Bang TypeScript Strict Mode Migration Halts Development

**What goes wrong:**
Enabling `strict: true` on a 39,841 LOC codebase generates thousands of type errors instantly. Teams attempt to fix all errors at once, halting feature development for weeks or months. Migration stalls, merge conflicts accumulate, and the team eventually reverts the change.

**Why it happens:**
- 10 pre-existing TypeScript errors mentioned in PROJECT.md will multiply under strict mode
- `strictNullChecks` alone can expose 100+ issues per 10,000 LOC
- Third-party library types (Zustand stores, VS Code API, postMessage contracts) may lack strict-compatible types
- `any` types in message handlers, WebSocket callbacks, and API responses hide entire error chains

**How to avoid:**
- **Gradual migration strategy**: Enable strict flags incrementally, not all at once
- Phase 1: `noImplicitAny` on new code only (use `typescript-strict-plugin` to exempt existing files)
- Phase 2: Fix high-traffic files first (authentication, message handlers, Zustand stores)
- Phase 3: Enable `strictNullChecks` module-by-module
- Phase 4: Remaining strict flags (`strictFunctionTypes`, `strictBindCallApply`, etc.)
- **Never add new `any` types** — enforce via ESLint rule `@typescript-eslint/no-explicit-any: error`
- **File-by-file tracking**: Use `// @ts-check` or per-file `strict: true` via `typescript-strict-plugin`

**Warning signs:**
- More than 50 type errors appear when enabling a single strict flag
- Developers bypass types with `as any` or `@ts-ignore` to "make progress"
- Type errors in core message contracts spread to 10+ dependent files
- CI builds break after merging parallel branches that both added `any` types

**Phase to address:**
Phase 4 (Type Safety) — Must be gradual, estimated 2-3 weeks for 40K LOC

---

### Pitfall 3: Icon Library Migration Bloats Bundle Without Proper Tree-Shaking

**What goes wrong:**
Migrating from custom SVGs to Lucide React seems to reduce bundle size, but incorrect import patterns cause the entire Lucide library (~2000+ icons) to bundle. Bundle size increases instead of decreasing. Dead code elimination fails silently because developers use barrel imports or dynamic icon selection.

**Why it happens:**
- **Barrel import anti-pattern**: `import { Icon1, Icon2 } from 'lucide-react'` works but bundlers may include entire module graph
- **Inconsistent imports**: Mixing `import Icon from 'lucide-react/dist/esm/icons/icon'` and `import { Icon } from 'lucide-react'` defeats tree-shaking
- **Dynamic icon selection**: `const Icon = icons[iconName]` prevents static analysis — bundler includes all possible icons
- **Side effects configuration**: CSS imports or initialization code marked as side effects prevent removal
- **Build mode mismatch**: Tree-shaking disabled in development mode, bloat only visible in production

**How to avoid:**
- **Use named imports consistently**: `import { CheckCircle, XCircle } from 'lucide-react'` (Lucide has `"sideEffects": false` in package.json)
- **Verify with bundle analyzer**: Run `npm run analyze` after migration to confirm only used icons are bundled
- **Avoid dynamic icon lookups**: Create explicit icon mapping files instead of `icons[key]` patterns
- **Audit custom SVG removal**: Search codebase for orphaned SVG files, icon font imports, or icon component wrappers
- **Test production bundle**: Development mode doesn't tree-shake — always verify production build size

**Warning signs:**
- Bundle size increases after "optimization" commit
- Bundle analyzer shows 100+ Lucide icons when only 20 are used in UI
- Import statements use inconsistent patterns across files (barrel imports + direct imports)
- CSS file size grows unexpectedly (icon fonts not removed, both systems coexist)

**Phase to address:**
Phase 1 (UI Polish & Icons) — Must include bundle analysis verification before merge

---

### Pitfall 4: Testing React Components Without Mocking Webview Bridge

**What goes wrong:**
React component tests fail with `vscode is not defined` or `acquireVsCodeApi is not a function`. Tests pass by mocking `window.vscode` with `jest.fn()`, but this hides real bugs in message contracts. Components render but postMessage calls are never verified, causing runtime failures in production.

**Why it happens:**
- Webview components depend on `acquireVsCodeApi()` which only exists in VS Code webview context
- jsdom doesn't provide VS Code globals — `window.vscode` is undefined
- Message contracts (`postMessage(type, payload)`) are TypeScript-safe but runtime-unchecked
- Zustand stores may depend on message responses — mocks must simulate entire request/response cycle
- VS Code postMessage is **asynchronous** — synchronous test assertions fail

**How to avoid:**
- **Create comprehensive VSCode API mock** in test setup:
  ```typescript
  const mockVscode = {
    postMessage: jest.fn(),
    getState: jest.fn(() => ({})),
    setState: jest.fn()
  };
  global.acquireVsCodeApi = jest.fn(() => mockVscode);
  ```
- **Verify message contracts**: Assert on `postMessage` calls with correct discriminated union types
- **Mock message responses**: Simulate extension responses by triggering `window.addEventListener('message', ...)` handlers
- **Test Zustand store integration**: Use Zustand testing guide pattern with `renderHook` and message mock responses
- **Consider Vitest browser mode**: Run tests in real Chromium/Playwright for accurate WebView environment (but slower than jsdom)
- **UI tests with vscode-extension-tester**: For critical flows (login, chat, submission), use E2E tests that run actual webview

**Warning signs:**
- Component tests pass but webview crashes with "Cannot read property 'postMessage' of undefined"
- Tests don't verify message contract types (only check that `postMessage` was called, not what was sent)
- Zustand store tests fail with "Cannot read property of undefined" from uninitialized state
- Message handlers with `switch(message.type)` have untested branches

**Phase to address:**
Phase 3 (Testing & Quality) — Create shared test utilities for webview mocking, document patterns

---

### Pitfall 5: CSP Nonce Generation Using Weak Randomness

**What goes wrong:**
Webview uses `Math.random()` to generate CSP nonces instead of cryptographically secure random. Attackers can predict nonce values and inject malicious scripts, bypassing Content Security Policy. Extension passes review but is vulnerable to XSS attacks in multi-user environments or when handling untrusted Artemis API responses.

**Why it happens:**
- CSP nonce requirements are subtle — weak nonces "work" during development
- `Math.random()` is tempting because it's simpler than Node.js crypto APIs
- VS Code extension samples sometimes use weak examples for brevity
- Nonce regenerates on every webview load — seems "random enough" at first glance

**How to avoid:**
- **Use crypto.randomBytes()**: `crypto.randomBytes(16).toString('base64')`
- **Never use Math.random()**: Cryptographically weak, predictable, violates security best practices
- **Verify nonce in script tags**: Ensure `<script nonce="${nonce}">` matches CSP header nonce
- **Audit third-party script loading**: Shiki, DOMPurify, or other libraries must not bypass nonce-based CSP
- **Test CSP violations**: Use browser DevTools to confirm CSP blocks inline scripts without nonce

**Warning signs:**
- Code contains `Math.random()` anywhere near nonce generation
- CSP policy includes `'unsafe-inline'` in `script-src` directive (defeats nonce purpose)
- Browser console shows CSP warnings in development but not in production
- Third-party libraries inject scripts that don't pass nonce through

**Phase to address:**
Phase 0 (Audit) — Verify current nonce implementation before any changes; Phase 5 if issues found

---

### Pitfall 6: Dependency Cleanup Removes Production Dependencies

**What goes wrong:**
Automated dependency analysis (depcheck, knip) flags `dompurify` or `lucide-react` as "unused" because tree-shaking makes them invisible to static analysis. Developer removes them, CI passes (because build compiles without errors), but webview crashes at runtime with "Cannot find module" errors.

**Why it happens:**
- **Dynamic imports**: `const DOMPurify = await import('dompurify')` hides dependency from static analysis
- **CSS-only imports**: `import 'lucide-react/dist/esm/lucide-react.css'` flagged as side-effect
- **esbuild bundles dependencies**: Extension works locally because esbuild inlined the code, but published `.vsix` may exclude it
- **devDependencies vs dependencies confusion**: Build tools (esbuild, TypeScript) should be devDependencies; runtime libraries (React, Zustand) must be dependencies
- **Peer dependencies**: React Testing Library expects React as peer — removing React breaks tests

**How to avoid:**
- **Whitelist known runtime dependencies**: `dompurify`, `lucide-react`, `react`, `react-dom`, `zustand`, `shiki`, `streamdown`, `@stomp/stompjs`, `ws`
- **Verify with production build**: After removing dependencies, run `npm run package` and test `.vsix` in clean VS Code install
- **Check esbuild external config**: Ensure runtime dependencies are bundled, not marked as external
- **Audit dynamic imports**: Search codebase for `import()` statements and `require()` calls — ensure dependencies are declared
- **Review package.json after automated cleanup**: Don't blindly accept tool suggestions

**Warning signs:**
- Dependency tool reports suggest removing packages that appear in `src/` code
- Build succeeds but extension activation fails with module not found errors
- Bundle size doesn't decrease after removing "unused" dependencies (they were tree-shaken already)
- Tests pass locally but fail in CI after dependency cleanup

**Phase to address:**
Phase 6 (Dependency Cleanup) — Manual audit required, don't fully trust automated tools

---

### Pitfall 7: Testing Adds Massive devDependencies Without Size Audit

**What goes wrong:**
Adding React Testing Library, Vitest, and @testing-library/react brings 50+ transitive dependencies totaling 100MB+ to `node_modules`. CI builds slow from 2 minutes to 8 minutes. VSIX package size increases because test fixtures or `@types/*` packages accidentally bundled into production. Published extension includes test utilities in final artifact.

**Why it happens:**
- **npm installs devDependencies by default** in development environments
- **esbuild bundles test utilities** if imported by production code (even transitively)
- **@types packages conflict**: Multiple React type versions create declaration merging errors
- **Vitest browser mode dependencies**: Playwright (200MB+ with browsers) installed even if not using browser mode
- **vscode-extension-tester includes Electron**: Doubles package size with bundled Chromium

**How to avoid:**
- **Audit bundle before/after**: Compare `dist/` sizes before and after adding test dependencies
- **Use `npm ci --production`**: CI should test production installs without devDependencies
- **Separate test imports**: Never import test utilities (Vitest, RTL) from `src/` — only from `test/`
- **Explicit esbuild entry points**: Ensure esbuild config points only to `src/extension.ts` and `src/webview/index.tsx`
- **Review esbuild metafile**: After adding tests, run `npm run analyze` to verify test deps aren't bundled
- **Pin major versions**: `@testing-library/react` version must match React version exactly

**Warning signs:**
- `node_modules/` grows from 200MB to 500MB+ after adding tests
- CI build time doubles without obvious changes
- VSIX package size increases from 4MB to 8MB+ (should stay ~4-5MB)
- Production bundle includes `vitest`, `@testing-library`, or `playwright` in metafile

**Phase to address:**
Phase 3 (Testing & Quality) — Size audit mandatory after installing test dependencies

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Using `any` for message types | Avoids complex discriminated unions | Runtime crashes from type mismatches, debugging hell | Never — message contracts are critical |
| Disabling strict mode per-file (`@ts-nocheck`) | Bypasses migration blockers | Errors proliferate, hard to re-enable | Only for legacy third-party code |
| `retainContextWhenHidden` for all webviews | Simpler state management | High memory usage, poor multi-webview performance | Only for chat view (preserves context), never for dashboard |
| Inline `postMessage` calls without types | Faster to write | No type safety, breaks on refactor | Never — always use typed message factories |
| Dynamic icon imports (`icons[key]`) | Flexible icon system | Defeats tree-shaking, bundles all icons | Only if bounded set is explicitly imported |
| Skipping bundle analysis | Faster development | Bundle bloat undetected until production | Never for phases touching dependencies |
| `jest.fn()` mocks without verification | Tests pass quickly | Bugs slip through, false confidence | Only for non-critical interactions |
| `// @ts-ignore` to bypass errors | Unblocks development | Error spreads to dependents | Only for known third-party type bugs, add TODO comment |

## Integration Gotchas

Common mistakes when connecting to external services and tooling.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| esbuild bundle analysis | Running `esbuild --analyze` without metafile | Add `metafile: true` to build, then use `esbuild-visualizer` or official analyzer |
| Lucide React icons | Importing from barrel: `import { Icon } from 'lucide-react'` | Named imports work, verify with analyzer: should only bundle used icons |
| Zustand in tests | Mocking entire store module | Use official Zustand test pattern with `act()` and `renderHook` |
| vscode-extension-tester | Expecting component-level assertions | E2E only — use for flows, not component props |
| Vitest browser mode | Assuming works like jsdom | Requires Playwright/WebDriverIO installed, separate config, slower |
| postMessage contracts | Assuming synchronous message handling | All webview messages are async — use `await` or callbacks |
| CSP nonce in scripts | Forgetting nonce in dynamically created scripts | DOMPurify and Shiki must include nonce in generated script tags |
| TypeScript strict flags | Enabling all at once | Gradual: `noImplicitAny` → `strictNullChecks` → others |
| Tree-shaking verification | Trusting development build | Tree-shaking only runs in production mode — always test prod build |
| Web Workers in webview | Using `importScripts()` or direct file paths | Workers must use `blob:` URLs, fetch code and convert |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Bundle size unchecked | Webview loads slowly on cold start | Run bundle analyzer monthly, set size budgets (webview < 4MB) | 5MB+ bundles (current state: 3.5MB) |
| All icons bundled | Initial load time increases with each icon added | Verify tree-shaking after icon migration, use analyzer | 100+ icons bundled (should be ~20) |
| Synchronous Shiki highlighting | Chat freezes when rendering code blocks | Already fixed: lazy init + worker, preserve pattern | Large code snippets (>500 lines) |
| Non-memoized React components | Chat re-renders entire history on new message | Already fixed: React.memo + RAF batching, preserve pattern | 100+ chat messages |
| `retainContextWhenHidden` on all views | Memory usage grows with open webviews | Only use for chat (needs context), use getState/setState elsewhere | 3+ webviews open simultaneously |
| No bundle size budget in CI | Bundle gradually grows from 3.5MB to 10MB+ | Add size check in CI: fail if webview bundle > 4MB | Incremental growth unnoticed |
| Unoptimized images/icons | SVG icons unnecessarily large | Use optimized SVG sprites or icon fonts, lazy-load images | 50+ custom SVGs (migrating to Lucide solves this) |
| Importing entire lodash | 100KB+ for a few utility functions | Use lodash-es with tree-shaking or replace with native APIs | 10+ lodash functions imported |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Weak CSP nonce (Math.random) | XSS attacks, script injection | Use crypto.randomBytes(16).toString('base64') |
| Including `'unsafe-inline'` in CSP | Defeats CSP purpose entirely | Use nonce-based script-src, extract all inline scripts |
| Not sanitizing Artemis API responses | XSS from malicious exercise descriptions | DOMPurify already used correctly — preserve pattern |
| Storing auth tokens in webview state | Exposed to XSS, persisted to disk | Keep in extension host only, use message bridge |
| Dynamic script injection without nonce | CSP violations, security warnings | Shiki/DOMPurify must include nonce in generated tags |
| Not validating message types | Extension crashes from malformed webview messages | Use discriminated unions + runtime type guards (Zod/io-ts) |
| Trusting file paths from postMessage | Path traversal attacks | Validate paths against workspace root, sanitize inputs |
| Exposing debug commands in production | Users can trigger internal state resets | Hide debug commands behind `artemis.developerMode` config |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Webview flickers on type safety refactor | Refactor breaks memoization, causes re-renders | Test with React DevTools Profiler before merge |
| Icons missing after migration | UI shows blank spaces or fallback text | Bundle analyzer + visual regression tests required |
| Tests break production for real users | CI passes but webview crashes | Test production `.vsix` in clean environment before release |
| Strict mode breaks autocomplete | Type errors prevent IntelliSense | Fix message contracts first (highest value types) |
| Bundle size increases after "optimization" | Slower webview load, worse UX | Enforce bundle size budget in CI (fail if >4MB) |
| Removing "unused" deps breaks runtime features | Iris chat fails to load, build errors not visible | Manual testing of all webviews after dependency cleanup |
| Loading indicators removed during refactor | User sees frozen UI during slow operations | Preserve loading states, test with throttled network |
| Type changes break existing data | User state corrupted after upgrade | Test migration with real persisted state (getState/setState) |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Icon migration:** Bundle analyzer confirms only ~20 icons bundled, not entire library
- [ ] **Type safety:** Zero `any` types in message contracts, Zustand stores, and API responses
- [ ] **Tree-shaking:** Production build tested, bundle size reduced or stayed same
- [ ] **Component tests:** WebView bridge mocked correctly, postMessage calls verified with types
- [ ] **Zustand test mocks:** Store reset pattern implemented from official Zustand docs
- [ ] **E2E test coverage:** Critical flows (login, chat, submission) tested with vscode-extension-tester
- [ ] **CSP nonce security:** Verified crypto.randomBytes usage, no Math.random in codebase
- [ ] **Dependency cleanup:** Production `.vsix` tested after removal, all webviews still work
- [ ] **Bundle size budget:** CI fails if webview bundle exceeds 4MB (or 10% growth from baseline)
- [ ] **Strict mode gradual rollout:** Per-file tracking shows progress, not big-bang "enable strict: true"
- [ ] **Memory profile:** `retainContextWhenHidden` only on chat view, others use getState/setState
- [ ] **Test dependency isolation:** `dist/` size unchanged after adding test frameworks
- [ ] **Type error count tracking:** Dashboard shows decreasing trend, not plateau or increase
- [ ] **Dynamic import auditing:** All `import()` and `require()` calls have declared dependencies

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| IIFE code splitting attempted | LOW | Revert to single bundle, focus on tree-shaking and lazy loading instead |
| Big-bang strict mode merge blocked | HIGH | Revert, switch to gradual strategy, use `typescript-strict-plugin` for new code only |
| Icon library bloats bundle | MEDIUM | Audit imports with bundle analyzer, fix dynamic icon lookups, use explicit mapping |
| Component tests mock webview incorrectly | MEDIUM | Create shared test utilities, audit existing tests, document patterns |
| Weak CSP nonce in production | HIGH (security) | Immediate hotfix with crypto.randomBytes, audit all script injection points |
| Production dependency removed | MEDIUM | Restore from package.json history, test `.vsix` before release |
| Test dependencies bundled in production | LOW | Update esbuild config, exclude test paths, verify metafile |
| Bundle size exceeds 5MB | MEDIUM | Bundle analyzer to find largest deps, lazy-load heavy libraries, consider external deps |
| TypeScript errors spread across codebase | HIGH | Identify root cause (likely message contract), fix in isolation, propagate fix |
| Zustand store state corrupted after refactor | MEDIUM | Add migration logic for persisted state, test with real user data |
| CSP violations block webview scripts | HIGH | Audit all script tags for nonce, check DOMPurify/Shiki nonce passthrough |
| E2E tests flaky after refactor | MEDIUM | Increase timeouts, add explicit waits, isolate state between tests |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| IIFE code splitting limitation | Phase 2 (Bundle Optimization) | Document constraint, metafile shows single bundle |
| Big-bang strict mode migration | Phase 4 (Type Safety) | Gradual strategy, per-file tracking dashboard |
| Icon library tree-shaking failure | Phase 1 (UI Polish & Icons) | Bundle analyzer shows ~20 icons, not 2000+ |
| Webview bridge mocking incorrect | Phase 3 (Testing & Quality) | Shared test utilities created, postMessage verified |
| Weak CSP nonce generation | Phase 0 (Audit) | Verify current implementation uses crypto.randomBytes |
| Production dependency removed | Phase 6 (Dependency Cleanup) | Manual whitelist, test `.vsix` after removal |
| Test deps bundled in production | Phase 3 (Testing & Quality) | Metafile verified, `dist/` size unchanged |
| Bundle size unchecked growth | Phase 2 (Bundle Optimization) | CI budget enforced (fail if >4MB or +10%) |
| Type errors spread uncontrolled | Phase 4 (Type Safety) | Fix message contracts first, monitor error count |
| Memory leaks from retainContextWhenHidden | Phase 5 (Architecture Improvements) | Audit all webviews, only chat uses retainContextWhenHidden |
| Dynamic imports hide dependencies | Phase 6 (Dependency Cleanup) | Audit all `import()` / `require()` calls |
| Strict mode breaks IntelliSense | Phase 4 (Type Safety) | Test autocomplete in 5 most-used files after changes |

## Sources

### Bundle Optimization & Code Splitting
- [Building VS Code Extensions in 2026: The Complete Guide](https://abdulkadersafi.com/blog/building-vs-code-extensions-in-2026-the-complete-modern-guide)
- [Split webpack bundles are very difficult to load in webviews · Issue #93041](https://github.com/microsoft/vscode/issues/93041)
- [esbuild - API](https://esbuild.github.io/api/)
- [Code splitting in esbuild: Caveats and setup - makandra dev](https://makandracards.com/makandra/595482-code-splitting-esbuild-caveats-setup)
- [Webview API | Visual Studio Code Extension API](https://code.visualstudio.com/api/extension-guides/webview)

### TypeScript Strict Mode Migration
- [Enabling TypeScript Strict Mode in a Legacy React Project—A Gradual Approach](https://webdev-sb.blogspot.com/2025/03/enabling-typescript-strict-mode-in.html)
- [Migrating to TypeScript Strict Mode at an Early-Stage Startup](https://preetmishra.com/blog/migrating-to-typescript-strict-mode-at-an-early-stage-startup)
- [0014 - Adopt Typescript Strict flag | Bitwarden Contributing Documentation](https://contributing.bitwarden.com/architecture/adr/typescript-strict/)
- [Understanding TypeScript's Strict Compiler Option | Better Stack Community](https://betterstack.com/community/guides/scaling-nodejs/typescript-strict-option/)

### Icon Library & Tree-Shaking
- [Lucide React – Lucide](https://lucide.dev/guide/packages/lucide-react)
- [Lucide React: A Technical Deep Dive Into Modern Icon System Architecture](https://expertbeacon.com/lucide-react-technical-guide/)
- [How I Reduced Our React Bundle by 62%](https://medium.com/@jaivalsuthar/how-i-reduced-our-react-bundle-by-62-a-junior-developers-optimization-journey-e0f5a2ca6ee6)
- [Tree Shaking Font Awesome Icons](https://www.skovy.dev/blog/tree-shaking-font-awesome)
- [Most popular mistake to ruin Webpack bundle optimization](https://codecrumbs.io/library/most-popular-mistake-webpack/)

### React Component Testing
- [Testing React Apps · Jest](https://jestjs.io/docs/tutorial-react)
- [Testing - Zustand](https://zustand.docs.pmnd.rs/guides/testing)
- [Component Testing | Guide | Vitest](https://vitest.dev/guide/browser/component-testing)
- [A Complete Guide to VS Code Extension Testing](https://dev.to/sourishkrout/a-complete-guide-to-vs-code-extension-testing-268p)
- [Replacing JSDOM: Exploring Browser-Native Component Testing Solutions](https://github.com/CMSgov/design-system/discussions/3453)

### VS Code Webview Architecture
- [Webview API | Visual Studio Code Extension API](https://code.visualstudio.com/api/extension-guides/webview)
- [What I've learned so far while bringing VS Code's Webviews to the web](https://blog.mattbierner.com/vscode-webview-web-learnings/)
- [Escaping misconfigured VSCode extensions - Trail of Bits](https://blog.trailofbits.com/2023/02/21/vscode-extension-escape-vulnerability/)
- [Using React in Visual Studio Code Webviews - Ken Muse](https://www.kenmuse.com/blog/using-react-in-vs-code-webviews/)

### Bundle Analysis & Optimization
- [esbuild - Bundle Size Analyzer](https://esbuild.github.io/analyze/)
- [esbuild-visualizer - npm](https://www.npmjs.com/package/esbuild-visualizer)
- [Analyzing Your Esbuild Bundles Made Easy with @viz-kit/esbuild-analyzer](https://medium.com/@bishal.vishwakarmaa/analyzing-your-esbuild-bundles-made-easy-with-viz-kit-esbuild-analyzer-c4faf691ee14)

### Dependency Management
- [dependency-cleaner - Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=jack-thomson.dependency-cleaner)
- [Declutter your JavaScript & TypeScript projects | Knip](https://knip.dev/)
- [GitHub - juliensanmartin/vscode-depcheck](https://github.com/juliensanmartin/vscode-depcheck)

### Security (CSP & Nonce)
- [Webview API | Visual Studio Code Extension API](https://code.visualstudio.com/api/extension-guides/webview)
- [Content Security Policy (CSP) - HTTP | MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)
- [Hacking the VSCode Markdown Preview](https://kiesthardt.com/blog/hacking-vscode-csp/)

---
*Pitfalls research for: VS Code Extension Production Readiness*
*Researched: 2026-02-25*
*Confidence: HIGH for VS Code constraints, MEDIUM for testing strategies, HIGH for bundle optimization*
