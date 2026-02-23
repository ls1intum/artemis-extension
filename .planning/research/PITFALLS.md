# Pitfalls Research

**Domain:** React Webview Migration in VS Code Extension
**Researched:** 2026-02-23
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: CSP Violations from React Development Builds

**What goes wrong:**
React development builds (especially from Vite or Create React App) inject inline scripts and use `eval()` for HMR, which violate VS Code's Content Security Policy. Webviews fail to load with CSP errors in console, showing blank screens in production.

**Why it happens:**
React bundlers optimize for standard web development with HMR and source maps. VS Code webviews require strict CSP (`script-src 'nonce-${nonce}'`) that disables inline scripts by default. Developers test with relaxed CSP during development, then ship broken production builds.

**How to avoid:**
- Configure bundler to externalize all scripts (no inline)
- Use nonce-based CSP for script loading: `script-src 'nonce-${nonce}'`
- Set proper CSP meta tag in webview HTML template
- Extract all inline styles to external files
- Configure `publicPath` to use `${webview.asWebviewUri()}` for all assets
- Test with production CSP settings during development

**Warning signs:**
- Console errors: "Refused to execute inline script because it violates CSP"
- Console errors: "Refused to load the script because it violates CSP directive"
- Webview works in dev but blank in production
- Style-src CSP errors from CSS-in-JS libraries

**Phase to address:**
Phase 1 (Build Pipeline Setup) — Must configure bundler correctly from the start to prevent CSP violations throughout migration.

---

### Pitfall 2: State Loss on Webview Hide/Show Without Persistence

**What goes wrong:**
VS Code destroys webview contents when moving to background tab. All React state (form inputs, scroll position, expanded sections, chat history) is lost when user switches tabs. Exam timers reset. Chat conversations disappear.

**Why it happens:**
Webview lifecycle differs from normal web apps. Contents are created when visible and destroyed when hidden (unless `retainContextWhenHidden: true`). React state lives in memory that gets wiped. Developers assume webview behaves like SPA tabs.

**How to avoid:**
- Implement state persistence using `vscode.getState()` / `vscode.setState()`
- Use message passing to save critical state to extension host before hide
- Listen for `onDidChangeViewState` to save state when visibility changes
- Store state in JSON-serializable format only
- For exam timers: sync time with extension host, use Web Workers for accurate timing
- For chat: persist messages to extension host, reload on show
- Document when `retainContextWhenHidden` is acceptable (high memory cost warning)

**Warning signs:**
- Users report "everything disappeared when I switched tabs"
- Exam timer shows wrong time after tab switch
- Form data lost after navigating away
- Chat history missing after returning to view
- Scroll position always resets to top

**Phase to address:**
Phase 2 (State Management Foundation) — Establish state persistence patterns before migrating views with critical state.

---

### Pitfall 3: postMessage Race Conditions During Initialization

**What goes wrong:**
Extension host sends messages to webview before React hydration completes. Messages arrive but no handlers exist yet. Webview sends messages before extension host listener is registered. Critical data updates are silently dropped. Initial state never loads.

**Why it happens:**
VS Code webview and extension host initialize asynchronously. No guaranteed message delivery order. `postMessage()` returns `true` even if webview isn't ready to receive. React renders asynchronously. Message handlers register after component mount, but messages may arrive earlier.

**How to avoid:**
- Implement message queuing in webview: buffer messages until React mounts
- Webview sends "ready" message after React hydration completes
- Extension host queues messages until receiving "ready" signal
- Use request-response pattern with timeouts for critical messages
- Add retry logic with exponential backoff (500ms, 1000ms, 2000ms)
- Log all postMessage calls with timestamps for debugging
- Never assume immediate message delivery

**Warning signs:**
- Webview loads but shows no data
- Data appears after manual refresh but not on first load
- Intermittent "sometimes works, sometimes doesn't" behavior
- Console logs show messages sent but not received
- First message of sequence arrives, subsequent messages don't

**Phase to address:**
Phase 3 (Message Bridge Modernization) — Create robust message bridge before migrating complex views that depend on initial data.

---

### Pitfall 4: Exam Timer Accuracy Loss from Tab Throttling

**What goes wrong:**
Browser throttles `setTimeout`/`setInterval` to 1 second in background tabs. Exam countdown timers drift by minutes. Students see incorrect remaining time. Timers don't fire when exam ends. Time-sensitive actions trigger at wrong moments.

**Why it happens:**
Browsers throttle timers in inactive tabs for battery/performance. VS Code webviews inherit this behavior. React components using `setInterval` for countdown face 1-second minimum delays in background. Accumulates drift over time (5+ minute exams).

**How to avoid:**
- Use Web Workers for timer logic (not throttled in background)
- Calculate remaining time from absolute timestamps, not intervals
- Store exam end time as ISO string, compute delta on each render
- Use `performance.now()` for millisecond precision
- Sync time with extension host periodically to detect drift
- Use Page Visibility API to detect background state and adjust
- For critical timers: combine Worker + periodic sync + visibility detection
- Test timer accuracy by backgrounding tab for 5+ minutes

**Warning signs:**
- Timer drifts when tab is backgrounded
- Countdown updates slowly or irregularly in background
- Timer shows wrong time after returning to tab
- Exam auto-submit triggers late or early
- Console shows timer callbacks delayed by 1000ms

**Phase to address:**
Phase 4 (Exam Views Migration) — Must implement accurate timers before migrating ExamExerciseDetail view.

---

### Pitfall 5: Chat Streaming Flicker from Excessive Re-renders

**What goes wrong:**
Iris chat re-renders entire message list on every streamed token. Screen flickers. Scrollbar jumps. Previous messages re-render unnecessarily. Chat becomes unusable during streaming. Performance degrades with message history.

**Why it happens:**
React re-renders parent component when state updates. Streaming updates state rapidly (10-100 tokens/second). Without memoization, all child messages re-render. Array `.map()` creates new component instances each render. Scroll position doesn't auto-follow during updates.

**How to avoid:**
- Wrap message components in `React.memo()` with custom comparator
- Use `useMemo()` to memoize computed message content
- Use `useCallback()` for event handlers to prevent child re-renders
- Keep streaming message in separate state from history
- Only update current message during stream, append to history on complete
- Virtualize message list (react-window/react-virtual) for 100+ messages
- Use React 19 compiler for automatic memoization if available
- Implement auto-scroll with `scrollIntoView({ behavior: 'smooth' })`
- Profile with React DevTools to identify unnecessary renders

**Warning signs:**
- Screen flickers during message streaming
- Previous messages visibly re-render while new message streams
- Scroll position jumps randomly during streaming
- Chat becomes laggy with 50+ messages
- React DevTools shows all messages re-rendering on each token
- CPU usage spikes during streaming

**Phase to address:**
Phase 5 (Iris Chat Migration) — Must optimize re-renders before migrating chat view with streaming.

---

### Pitfall 6: Bundle Size Bloat from Improper Tree-Shaking

**What goes wrong:**
Webview bundle includes entire React ecosystem (React, ReactDOM, development warnings, source maps). Bundle grows to 500KB+ minified. Extension size exceeds marketplace limits. Webview load time increases 3-5 seconds. Users on slow connections experience timeouts.

**Why it happens:**
Default bundler configs include development builds in production. All React components imported, even unused ones. Shared code between ExerciseDetail and ExamExerciseDetail duplicates instead of reuses. UI component library imports entire package instead of individual components. No minification or compression configured.

**How to avoid:**
- Configure production mode: `NODE_ENV=production`
- Enable tree-shaking with ES modules (`import` not `require`)
- Use named imports: `import { Button } from 'components'` not `import * as Components`
- Configure minification for webview builds (Terser/esbuild minify)
- Split vendor bundle from application code
- Use bundle analyzer (webpack-bundle-analyzer/esbuild-analyzer)
- Set size budget: fail build if bundle exceeds 200KB gzipped
- Extract shared code between ExerciseDetail/ExamExerciseDetail to shared components
- Consider esbuild over webpack (10-100x faster, smaller bundles)
- Test bundle size in CI

**Warning signs:**
- Extension package size exceeds 5MB
- Webview takes 3+ seconds to load
- Bundle analyzer shows duplicate code paths
- React DevTools bundle includes development warnings
- Bundle includes unused libraries (moment.js, lodash full)

**Phase to address:**
Phase 1 (Build Pipeline Setup) — Configure optimal bundling from the start to prevent size bloat.

---

### Pitfall 7: Big-Bang Migration Breaking All Views Simultaneously

**What goes wrong:**
Migrate all 14 views at once. Multiple views break in different ways. Can't isolate which changes caused which bugs. Testing surface too large. Rollback loses all progress. Team blocked on fixing migration issues. Feature development halts for weeks.

**Why it happens:**
Pressure to "just switch to React" without incremental plan. Underestimating migration complexity (1475-line views with real-time features). Lack of feature flag infrastructure. Assumption that "it's just a re-render, same logic." Optimism bias about testing coverage catching all issues.

**How to avoid:**
- Migrate one view at a time, starting with simplest
- Add feature flag to toggle between HTML and React rendering per view
- Migration order: DashboardView → CourseListView → CourseDetailView → ExerciseDetailView → ExamExerciseDetailView (increasing complexity)
- Keep HTML template code until React version proven stable
- Run both renderers in parallel for A/B testing
- Establish shared component library before migrating complex views
- Extract reusable logic from HTML templates before React migration
- Gate React views behind environment variable until production-ready
- Measure success criteria: render time, bundle size, error rate

**Warning signs:**
- Multiple views broken at once with unclear root cause
- Git history shows massive commits touching all view files
- Team discusses "throw away old code and start fresh"
- Testing plan says "test everything after migration complete"
- No rollback plan exists
- Development branch diverges from main for weeks

**Phase to address:**
Phase 0 (Migration Strategy) — Establish incremental migration plan and feature flag infrastructure before any view migration.

---

### Pitfall 8: No Hot Module Reload Due to Webview Sandbox Restrictions

**What goes wrong:**
React Fast Refresh/HMR doesn't work in VS Code webviews. Every code change requires full extension reload (10-30 seconds). Developer productivity drops 80%. Change-test cycle becomes painful. Developers avoid iterating on UI.

**Why it happens:**
HMR requires WebSocket connection. VS Code webview blocks WebSockets for security. Standard HMR configs fail silently. `publicPath` misconfiguration breaks module loading. Developers don't test HMR setup until deep into migration.

**How to avoid:**
- Accept that full HMR is impossible in webviews (security constraint)
- Implement manual reload trigger: webview sends command to extension host → extension triggers `location.reload()`
- Watch for file changes, send reload command via postMessage bridge
- Configure `publicPath` to local dev server for asset loading
- Use `vscode-webview-hmr` library for proxy-based HMR workaround
- Set expectations: slower DX than normal React, but better than HTML templates
- Optimize build speed to minimize reload time (esbuild over webpack)
- Consider developing components in isolation with Storybook, then integrate into webview

**Warning signs:**
- Developers complain about slow iteration speed
- Pull requests have fewer UI polish commits
- Team discusses "too painful to adjust styling"
- HMR configuration present but never works
- File watchers configured but changes don't appear

**Phase to address:**
Phase 1 (Build Pipeline Setup) — Set realistic DX expectations and optimize reload speed from the start.

---

### Pitfall 9: Shared Code Between ExerciseDetail/ExamExerciseDetail Duplicated Not Composed

**What goes wrong:**
Copy-paste ExerciseDetail code into ExamExerciseDetail React component. 70% duplicated code. Bug fixes require updating both components. Logic drifts between exam and regular views. Maintenance burden doubles.

**Why it happens:**
Time pressure to migrate both views quickly. Template code difficult to extract into shared functions. React composition patterns not established yet. "Make it work, refactor later" mentality. Lack of shared component library before migration.

**How to avoid:**
- Before migrating either view: extract shared logic to reusable hooks
- Create shared components: `ExerciseHeader`, `SubmissionStatus`, `BuildProgress`, `RepositoryActions`
- Use composition pattern: `ExerciseDetail` and `ExamExerciseDetail` both compose from shared components
- Props differentiate exam vs regular mode, not separate implementations
- Establish shared UI library in Phase 1, use in all view migrations
- Code review checklist: "Does this duplicate existing logic?"
- Add ESLint rule for duplicate code detection
- Document component composition patterns before migration

**Warning signs:**
- ExerciseDetail.tsx and ExamExerciseDetail.tsx files are similar length (1400+ lines each)
- Copy-paste imports between files
- Same logic in both files with slight variations
- Bug fixed in one view but not the other
- Pull request diff shows mostly duplicated code

**Phase to address:**
Phase 2 (Shared Component Library) — Extract and test shared components before migrating ExerciseDetail or ExamExerciseDetail.

---

### Pitfall 10: React Development Mode Shipped to Production

**What goes wrong:**
Production build includes React development warnings, prop-type checking, and debugging tools. Bundle size 3x larger. Performance significantly slower. Console filled with development warnings in user environments. Extension rejected from marketplace for size.

**Why it happens:**
`NODE_ENV` not set correctly in build script. Development dependencies included in production bundle. Bundler optimization not enabled. Testing only in development mode. Build configuration not verified for production.

**How to avoid:**
- Explicitly set `NODE_ENV=production` in build scripts
- Configure bundler production mode: `mode: 'production'` (webpack) or `minify: true` (esbuild)
- Separate dev and prod build commands: `npm run build:dev` vs `npm run build:prod`
- Add size check in CI: fail if bundle includes `process.env.NODE_ENV !== 'production'` checks
- Test production build locally before releases
- Use bundle analyzer to verify no dev dependencies in output
- Document build process in README

**Warning signs:**
- Console shows React development warnings in packaged extension
- Bundle includes `react-dom.development.js` instead of `react-dom.production.min.js`
- Bundle size unexpectedly large (500KB+ for simple view)
- Performance profiling shows prop validation overhead
- Users report console spam

**Phase to address:**
Phase 1 (Build Pipeline Setup) — Configure proper production builds from the start.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `retainContextWhenHidden: true` everywhere | No state persistence code needed | High memory overhead, VS Code slowdown with multiple extensions | Only for views with complex state that cannot be serialized (3D renderers, canvas editors) |
| Inline styles instead of CSS modules | Faster initial migration | No theming, poor performance, larger bundle | Never — extract styles from start |
| `any` types in message contracts | Skip TypeScript errors | Runtime errors, no IDE autocomplete, brittle refactoring | Only for complex third-party types during initial migration, must be replaced |
| Single massive React component per view | Minimal file changes | Difficult to test, no reusability, hard to optimize renders | Never — refactor HTML templates to logical components first |
| Ignoring CSP errors in dev | Fast iteration without config | Broken production builds, wasted debugging time | Never — configure CSP correctly from start |
| Skip state persistence for "simple" views | Less code to write | User frustration, support requests, negative reviews | Only for truly stateless views (static content, about pages) |
| Manual postMessage without types | Quick prototype | Message contract drift, typos at runtime | Only for throwaway POC code, never in main migration |

## Integration Gotchas

Common mistakes when connecting React webviews to VS Code extension host.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| postMessage bridge | Assuming synchronous delivery | Implement request-response pattern with timeouts, queue messages until webview ready |
| WebSocket (Iris streaming) | Opening WebSocket from webview directly | Extension host owns WebSocket, streams data via postMessage to webview |
| File system access | Using `fs` module in webview | postMessage to extension host, host handles file operations, returns results |
| Authentication tokens | Storing tokens in webview localStorage | Extension host manages tokens, sends to webview via secure postMessage |
| Theme detection | Hardcoding dark/light styles | Read `vscode-theme-kind` class from body, listen for theme change messages |
| Command execution | Calling VS Code API from webview | postMessage to extension host, host executes `vscode.commands.executeCommand()` |
| Resource URIs | Using `file://` paths directly | Convert with `webview.asWebviewUri()` for CSP compliance |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Rendering entire message list on each token | Chat flickers during streaming | Separate streaming message from history, virtualize list | 20+ messages |
| Not memoizing expensive computations | UI freezes during re-renders | Use `useMemo()` for formatting, parsing, validation | Views with 50+ list items |
| Re-creating event handlers on every render | Child components re-render unnecessarily | Use `useCallback()` for all handlers passed as props | Nested component trees 3+ levels deep |
| Loading entire course data into one component | Initial load takes 5+ seconds | Lazy load exercise lists, pagination, infinite scroll | Courses with 30+ exercises |
| No code splitting | Bundle exceeds 500KB, slow first load | Split by route, lazy load heavy views | 5+ complex views migrated |
| Polling extension host for updates | High CPU usage, battery drain | Use event-based updates via postMessage only when data changes | Update checks every 1 second |
| Storing large objects in component state | Re-renders serialize/compare large objects | Normalize state, store IDs and lookups separately | State objects 100+ KB |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Relaxing CSP to allow `'unsafe-inline'` | XSS vulnerabilities, extension marketplace rejection | Configure bundler properly, use nonce-based CSP |
| Trusting postMessage data without validation | Malicious extension could send crafted messages | Validate message schema with zod/joi before processing |
| Including API tokens in webview bundle | Token exposure in packaged extension | Extension host manages tokens, never send to webview |
| Using `eval()` or `Function()` for dynamic code | CSP violations, arbitrary code execution | Pre-compile all code, use data-driven rendering |
| Loading external resources without CSP | Data exfiltration, resource injection | Whitelist only trusted domains in CSP, prefer bundled assets |
| Exposing internal extension APIs via postMessage | Unauthorized command execution | Implement message handler allowlist, validate sender origin |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Losing scroll position on state updates | Disorienting, user loses context | Store scroll position in state, restore after render with `scrollTo()` |
| No loading states during async operations | Appears frozen, users click multiple times | Show skeleton UI, loading spinners, disable buttons during load |
| Exam timer not prominent during countdown | User runs out of time unexpectedly | Sticky header with large timer, warnings at 5min/1min remaining |
| Chat messages not auto-scrolling | User misses new messages | Auto-scroll to bottom on new message, detect manual scroll up to disable |
| No error state when postMessage fails | Silent failures, user confused | Show toast notifications, retry buttons, fallback to refresh action |
| Theme colors hardcoded, not respecting VS Code theme | Jarring contrast with rest of VS Code | Use CSS variables from VS Code theme, listen for theme changes |
| Large lists not virtualized | Sluggish scrolling with 100+ items | Implement virtualization (react-window) for any list that can exceed 50 items |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **React view renders correctly:** Often missing state persistence — verify tab switch preserves state (background webview 5+ minutes, return, check state)
- [ ] **postMessage working in dev:** Often missing production CSP config — verify messages work with production CSP meta tag
- [ ] **Timer counting down:** Often missing background throttling protection — verify timer accurate after backgrounding tab for 5 minutes
- [ ] **Chat streaming smoothly:** Often missing memoization for large history — verify smooth streaming with 50+ message history
- [ ] **Bundle size acceptable in dev:** Often includes dev dependencies in prod — verify production build is minified and tree-shaken
- [ ] **View migrated to React:** Often duplicates shared code — verify shared components used, not copy-pasted logic
- [ ] **All tests passing:** Often tests use HTML template assertions — verify tests updated to query React components
- [ ] **Feature flag enabled:** Often no rollback plan — verify HTML template code retained for rollback
- [ ] **HMR working in dev:** Often misconfigured, appears to work but doesn't — verify actual module updates without full reload
- [ ] **Message bridge initialized:** Often race condition on first load — verify first postMessage always received (test cold start 10 times)

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| CSP violations in production | LOW | Add proper CSP meta tag, rebuild with `publicPath` config, redeploy |
| State lost on hide/show | MEDIUM | Implement `getState/setState`, identify critical state, add persistence layer, test tab switching |
| postMessage race conditions | MEDIUM | Add message queue in webview, implement ready handshake, add retry logic with timeouts |
| Timer drift from throttling | HIGH | Refactor to Web Worker, use absolute timestamps, sync with extension host, test extensively |
| Chat streaming flicker | MEDIUM | Profile with React DevTools, add `React.memo()` to message components, separate streaming state |
| Bundle size bloat | LOW | Enable production mode, analyze bundle, remove unused deps, configure minification |
| Big-bang migration broke everything | HIGH | Add feature flags, revert to HTML templates, migrate incrementally starting with simplest view |
| No HMR in webviews | LOW | Accept limitation, optimize build speed with esbuild, set team expectations |
| Duplicated ExerciseDetail code | HIGH | Extract shared components, refactor both views to use composition, add lint rules |
| Dev mode shipped to prod | LOW | Set `NODE_ENV=production`, rebuild, verify bundle with analyzer, add CI check |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| CSP violations | Phase 1: Build Pipeline | Production build loads in webview without console errors |
| State loss on hide/show | Phase 2: State Management | Background tab 5 min, return, state intact |
| postMessage race conditions | Phase 3: Message Bridge | 100 cold starts, all receive initial data |
| Timer drift | Phase 4: Exam Views | Background 10 min, timer accurate within 1 second |
| Chat streaming flicker | Phase 5: Iris Chat | Stream 100 tokens, no previous message re-renders |
| Bundle size bloat | Phase 1: Build Pipeline | Production bundle under 200KB gzipped |
| Big-bang migration | Phase 0: Migration Strategy | Feature flags exist, views migrate one at a time |
| No HMR | Phase 1: Build Pipeline | Dev reload time under 5 seconds |
| Duplicated code | Phase 2: Shared Components | ExerciseDetail & ExamExerciseDetail share 70%+ components |
| Dev mode in prod | Phase 1: Build Pipeline | Bundle analyzer shows production React build |

## Sources

### Official Documentation
- [Webview API - Visual Studio Code Extension API](https://code.visualstudio.com/api/extension-guides/webview)
- [Bundling Extensions - Visual Studio Code Extension API](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
- [Custom Editor API - Visual Studio Code Extension API](https://code.visualstudio.com/api/extension-guides/custom-editors)

### VS Code Webview Issues & Discussions
- [WebViewPanel regression - postMessage race condition (Issue #125546)](https://github.com/microsoft/vscode/issues/125546)
- [Help webview extensions add CSP (Issue #79340)](https://github.com/microsoft/vscode/issues/79340)
- [Best way to integrate React in webviews (Discussion #723)](https://github.com/microsoft/vscode-discussions/discussions/723)
- [Hot Module Replacement in VS Code Webview with React (Discussion #739)](https://github.com/microsoft/vscode-discussions/discussions/739)
- [Let custom editors retain context (Issue #113507)](https://github.com/microsoft/vscode/issues/113507)

### React Performance & Optimization
- [React Compiler v1.0 – React](https://react.dev/blog/2025/10/07/react-compiler-1)
- [React Performance Optimization 2025 - Growin](https://www.growin.com/blog/react-performance-optimization-2025/)
- [Streaming Backends & React: Controlling Re-render Chaos](https://www.sitepoint.com/streaming-backends-react-controlling-re-render-chaos/)
- [6 Common React Anti-Patterns - ITNEXT](https://itnext.io/6-common-react-anti-patterns-that-are-hurting-your-code-quality-904b9c32e933)

### VS Code Extension Development with React
- [Using React in Visual Studio Code Webviews - Ken Muse](https://www.kenmuse.com/blog/using-react-in-vs-code-webviews/)
- [How to Build a VS Code Extension using React Webviews - Medium](https://medium.com/snowflake/how-to-build-a-vs-code-extension-using-react-webviews-0e2481ce1ba2)
- [Reactception: extending VS Code with React - Medium](https://medium.com/younited-tech-blog/reactception-extending-vs-code-extension-with-webviews-and-react-12be2a5898fd)
- [Use React in VSCode WebView with HMR - Elio Struyf](https://www.eliostruyf.com/react-vscode-webview-hot-module-replacement/)

### Timer Accuracy & Background Throttling
- [Why browsers throttle JavaScript timers - Read the Tea Leaves](https://nolanlawson.com/2025/08/31/why-do-browsers-throttle-javascript-timers/)
- [Heavy throttling of chained JS timers in Chrome 88 - Chrome Developers](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- [Learn why setInterval breaks when throttled - Pontis Technology](https://pontistechnology.com/learn-why-setinterval-javascript-breaks-when-throttled/)

### Bundle Optimization
- [Configuring VSCode Extensions: Webpack, React, and TypeScript - Medium](https://medium.com/@captaincolinr/vscode-react-extension-guide-10ea25cb983f)
- [Webpack 5 Optimization Strategies - Medium](https://medium.com/@emre.kzltprkk/how-we-achieved-10x-faster-builds-webpack-5-optimization-strategies-for-large-scale-react-1cf27297ea07)

### Migration Strategies
- [Incremental vs Big Bang Migration - Medium](https://medium.com/@navidbarsalari/%EF%B8%8F-incremental-vs-big-bang-migration-choosing-the-right-path-for-your-product-498521839a4d)
- [Big Bang vs Trickle Migration - Brainhub](https://brainhub.eu/library/big-bang-migration-vs-trickle-migration)
- [Mitigate Migration Risk with Feature Flags - CloudBees](https://www.cloudbees.com/blog/mitigate-infrastructure-migration-risk-with-feature-flags)

### State Management & Lifecycle
- [VSCode Webview Lifecycle - Symposium](https://symposium.dev/references/vscode-webview-lifecycle.html)
- [State Persistence - Symposium](https://symposium.dev/design/vscode-extension/state-persistence.html)

---
*Pitfalls research for: React webview migration in VS Code extension*
*Researched: 2026-02-23*
