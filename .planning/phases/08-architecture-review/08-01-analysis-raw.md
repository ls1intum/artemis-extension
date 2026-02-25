# Architecture Review - Raw Analysis Findings

**Analysis Date:** 2026-02-25
**Codebase:** artemis-extension (iris-thaumantias)
**Scope:** Full structural review (240 source files)
**Method:** Automated dependency analysis (madge) + manual file review

---

## Automated Dependency Analysis Results

### Tool: madge v8.0.0

**Execution:**
```bash
cd iris-thaumantias
npx madge --circular --extensions ts,tsx src/
npx madge --orphans --extensions ts,tsx src/
```

**Circular Dependencies Found: 2**

1. `provider/artemisWebviewProvider.ts` → `services/ProviderRegistry.ts`
2. `services/ProviderRegistry.ts` → `provider/chatWebviewProvider.ts` → `services/index.ts`

**Orphan Modules Found: 7**

Files not imported by any other file in the codebase:
- `extension.ts` (Expected - entry point)
- `models/index.ts` (Barrel file - may be unused if direct imports preferred)
- `types/stomp.d.ts` (Type declaration - ambient types)
- `views/webview/react/hooks/useStreamingMessage.ts` (Potentially unused hook)
- `views/webview/react/index.tsx` (Expected - React entry point)
- `views/webview/react/types/css-modules.d.ts` (Type declaration - ambient types)
- `views/webview/react/views/index.ts` (Barrel file - may be unused if direct imports preferred)

**Warnings: 11**
Madge reported 11 warnings during processing (likely TypeScript path resolution or module format issues).

---

## Area 1: Component Structure

### 1.1 React Component Hierarchy

**Location:** `src/views/webview/react/`

**Structure:**
- **Root:** `App.tsx` + `ErrorBoundary.tsx` + `index.tsx`
- **Views (8):** Login, Dashboard, CourseList, CourseDetail, ExerciseDetail, ExamStart, ExamConduction, ExamExerciseDetail, IrisChat, GitCredentials, ServiceStatus, RecommendedExtensions
- **Shared Components (21):** Button, IconButton, TextInput, Badge, BackLink, SideMenu, Dropdown, HelpPopup, AskIris, ServiceHealth, ListItem, List, Skeleton, SkeletonList, Breadcrumbs, ReconnectBanner, ErrorMessage, EmptyState, Container, ExamTimer, TimerExpiredOverlay
- **Exercise-specific Components (3):** SubmissionStatus, ParticipationActions, BuildProgress
- **IrisChat Components (9):** ThinkingIndicator, StreamingMessage, MessageBubble, ChatInput, WelcomeState, ReferencedFiles, ChatMessageList, ContextSelector, CodeBlock

**Observations:**

1. **Good: Clear view/component separation**
   - Views are page-level containers (Dashboard, CourseDetail, etc.)
   - Components are reusable UI elements (Button, ListItem, etc.)
   - View-specific components nested under views/ (IrisChat/components/, ExerciseDetail/components/)

2. **Good: Consistent barrel exports**
   - Most component folders have `index.ts` barrel files for clean imports
   - Example: `components/Button/index.ts` exports both `Button` and `IconButton`

3. **Concern: Component size distribution**
   - IrisChat view has 9 sub-components (largest view)
   - Exam-related views (ExamStart, ExamConduction, ExamExerciseDetail) are separate but may have duplicated patterns
   - Exercise detail components split into subfolder but only 3 components

4. **Good: No legacy pre-React code**
   - No files found in `src/views/*.ts` or `src/views/components/` (pre-migration patterns)
   - Migration to React appears complete

5. **Minor: Naming consistency**
   - Most components follow PascalCase pattern (Button, ListItem)
   - Some hyphenated folder names (BackLink, SideMenu) vs. single-word (Button, Badge)
   - Not a problem, just inconsistency in folder naming style

**File Count:**
- Total React components: 48 .tsx files
- Total TypeScript files: 29 .ts files (types, hooks, utils, stores)
- Total: 77 files in React webview

---

### 1.2 Zustand Store Composition

**Location:** `src/views/webview/react/stores/`

**Stores Found: 9**

1. `useDashboardStore.ts` - Dashboard data (recent courses, workspace exercise)
2. `useChatStore.ts` - Iris chat state (messages, context, streaming, WebSocket status)
3. `useCourseListStore.ts` - Course list view data
4. `useCourseDetailStore.ts` - Course detail view data
5. `useExerciseDetailStore.ts` - Exercise detail view data
6. `useExamStartStore.ts` - Exam start view data
7. `useExamConductionStore.ts` - Exam conduction view data
8. `useExamExerciseDetailStore.ts` - Exam exercise detail view data
9. `useNavigationStore.ts` - Breadcrumb navigation state

**Observations:**

1. **Pattern: View-scoped stores**
   - Each major view has its own store (Dashboard, CourseList, CourseDetail, etc.)
   - Stores own both data AND loading/error UI state
   - Example: `useDashboardStore` has `isLoading`, `error`, `recentCourses`, `workspaceExercise`

2. **Good: DevTools middleware enabled**
   - All stores use `devtools(...)` middleware
   - Conditional on `process.env.NODE_ENV === 'development'`
   - Example from `useDashboardStore`:
     ```typescript
     devtools((set) => ({ ... }), {
       name: 'DashboardStore',
       enabled: process.env.NODE_ENV === 'development',
     })
     ```

3. **Good: Action naming consistency**
   - Setters prefixed with `set` (setDashboardData, setError)
   - Loaders prefixed with `load` (loadDashboard)
   - Clear action names in devtools logs

4. **Concern: No shared store middleware**
   - Each store has `devtools` middleware individually
   - No persist middleware (for state preservation across panel hide/show)
   - No logger middleware
   - Implication: If we want persistence, must add to each store manually

5. **Concern: Potentially fragmented state**
   - 9 separate stores for what are essentially navigation views
   - Navigation is a separate store (`useNavigationStore`) vs. embedded in view stores
   - Chat store is large (203 lines) with many concerns: context, sessions, messages, streaming, WebSocket status, UI flags

6. **Good: Type safety**
   - All stores have explicit TypeScript interfaces for state shape
   - Actions strongly typed
   - No `any` types in store definitions

7. **Minor: Inconsistent state initialization**
   - Some stores have empty arrays/null defaults, others have undefined
   - Example: `useDashboardStore` uses `null` for `workspaceExercise`, `useChatStore` uses `null` for `context`

**Store Size Distribution:**
- Smallest: `useNavigationStore` (68 lines) - simple breadcrumb stack
- Largest: `useChatStore` (210 lines) - complex chat state with streaming
- Average: ~120 lines per store

**Potential Fragmentation Issue:**
- 7 view-specific stores (Dashboard, CourseList, CourseDetail, ExerciseDetail, + 4 exam views)
- Each owns loading/error state separately
- No centralized "UI state" store for cross-view concerns

---

### 1.3 Legacy State Management (AppStateManager)

**Location:** `src/views/app/appStateManager.ts`

**Pattern:** Class-based state machine for non-React webview logic

**Observations:**

1. **Finding: Dual state management pattern**
   - `AppStateManager` (307 lines) manages app-level state machine
   - React views use Zustand stores for component-level state
   - Both coexist in the same codebase
   - `AppStateManager` is instantiated in `ArtemisWebviewProvider` (extension host)
   - Zustand stores are used in React webview (sandboxed browser context)

2. **State machine:**
   - Type: `'login' | 'dashboard' | 'course-list' | 'course-detail' | 'exercise-detail' | 'exam-exercise-detail' | 'ai-config' | 'service-status' | 'struggle-detection' | 'recommended-extensions' | 'git-credentials' | 'exam-start' | 'exam-conduction'`
   - 13 possible states
   - Transitions via methods like `showDashboard()`, `showCourseDetail()`, etc.

3. **Data caching:**
   - `_coursesData`, `_currentCourseData`, `_currentExerciseData`, `_currentExamData` are cached in memory
   - Some methods refetch (`showExerciseDetail` ALWAYS fetches fresh data)
   - Others reuse cached data (`showCourseDetail` doesn't refetch)

4. **Concern: State duplication risk**
   - AppStateManager caches course/exercise data
   - React Zustand stores also cache the same data
   - Example: Dashboard data fetched by AppStateManager, then sent to React via postMessage, stored in `useDashboardStore`
   - Risk: State drift if one updates and the other doesn't

5. **Good: Clear lifecycle methods**
   - `showLogin()` clears all cached data
   - `clearCoursesData()`, `clearCurrentCourseData()`, etc. for explicit cache invalidation

6. **Concern: API coupling**
   - AppStateManager directly calls `this._artemisApi.getCoursesForDashboard()`
   - Tight coupling between state management and API layer
   - Harder to test (needs API mock)

**Recommendation for Plan 02:**
- Document this as migration-era pattern (v1.0 React migration left AppStateManager in place)
- Mark as "intentional tech debt" - full migration to Zustand would require rewriting extension host logic

---

## Area 2: State Management

### 2.1 Store Boundaries Analysis

**Current boundaries:**
- View-scoped: 7 stores (Dashboard, CourseList, CourseDetail, ExerciseDetail, + 4 exam views)
- Feature-scoped: 1 store (Chat - combines context, messages, streaming, WebSocket)
- Navigation-scoped: 1 store (Navigation - breadcrumbs)

**Assessment:**

1. **Pattern: View-scoped stores dominate**
   - Each view has its own store with isLoading, error, data
   - Advantage: Clear ownership, no cross-store dependencies
   - Disadvantage: Repetitive loading/error patterns across stores

2. **Finding: Chat store shows signs of god-store pattern**
   - 210 lines, 12 state properties, 15 actions
   - Combines: context management, session management, message list, streaming state, WebSocket status, UI flags (isNoAiDetected, showDiagnostics, referencedFiles)
   - Multiple concerns in one store

3. **Missing: Global UI state store**
   - No store for cross-view concerns like toast notifications, modal dialogs, global loading indicators
   - WebSocket connection status is in `useChatStore`, but it's a global concern

4. **Missing: Auth state store**
   - No Zustand store for authentication state (username, serverUrl, logged-in status)
   - Auth state managed by `AppStateManager` in extension host
   - React views receive auth state via postMessage, don't store it in Zustand

5. **Good: No observable selectors**
   - Stores don't have complex computed/derived state
   - Actions are simple setters or message dispatchers
   - No middleware besides devtools

### 2.2 Selector Patterns

**Observation:**
- No custom selector hooks found (no `useShallow`, no `useDashboardCourses` helpers)
- Components directly access store state: `const { recentCourses, isLoading } = useDashboardStore()`
- No memoization of selectors

**Implication:**
- Components may re-render more than necessary if they access multiple store properties but only one changes
- Not a critical issue for current scale (UI is not sluggish)

### 2.3 State Persistence

**Finding: No persistence middleware**
- None of the 9 Zustand stores use `persist` middleware
- WebView state may be lost on panel hide/show cycles

**Expected persistence mechanism:**
- VS Code webview API: `vscode.getState()` / `vscode.setState()`
- Pattern: Debounced saves on state changes, restore on mount

**Current status:**
- No evidence of `getState()`/`setState()` usage in React code (searched for `vscode.getState`)
- State persistence likely not implemented for React webviews

**Risk:**
- User switches tabs → VS Code destroys webview content → state lost
- Chat messages, form inputs, navigation history may be lost

**Mitigation in place:**
- Backend services (`ChatSessionService`, `ChatMessageService`) persist chat data to extension host
- Dashboard/course data refetched on view load
- Risk is primarily for transient UI state (form drafts, scroll position, streaming state)

### 2.4 Dual State Management Assessment

**Two systems coexist:**

1. **Extension host (Node.js context):**
   - `AppStateManager` (class-based, 307 lines)
   - Manages app-level state machine (13 states)
   - Caches API responses (courses, exercises, exam data)
   - State transitions trigger HTML re-rendering via `ViewRouter`

2. **Webview (browser context):**
   - 9 Zustand stores (React state)
   - Manage view-specific data and UI state
   - Receive data from extension via postMessage
   - Send commands back via postMessage

**Data flow:**
1. User action in React webview → postMessage(command)
2. Extension host receives message → `WebViewMessageHandler` routes to command module
3. Command module calls API, updates `AppStateManager`
4. Extension sends updated data back via postMessage
5. React receives message, updates Zustand store, re-renders

**Concern: State synchronization**
- Two sources of truth (AppStateManager + Zustand stores)
- Synchronization via postMessage is async and best-effort
- If extension sends stale data, Zustand stores may have stale state

**Good: Clear boundary**
- React webview cannot directly import extension services (would violate sandbox)
- postMessage enforces boundary
- No accidental coupling

---

## Area 3: Message Contracts

### 3.1 Message Handler Architecture

**Location:** `src/views/app/webViewMessageHandler.ts`

**Pattern:** Command module pattern

**Modules: 7**
1. `AuthCommandModule` - login, logout
2. `NavigationCommandModule` - view navigation (dashboard, course detail, etc.)
3. `RepositoryCommandModule` - git clone, fetch, push
4. `IrisCommandModule` - Iris chat operations
5. `PlantUmlCommandModule` - PlantUML rendering
6. `HealthCommandModule` - health checks
7. `UtilityCommandModule` - utility commands

**Registration:**
```typescript
const modules = [
  new AuthCommandModule(context),
  new NavigationCommandModule(context),
  // ... 5 more
];

modules.forEach(module => {
  const handlers = module.getHandlers();
  Object.entries(handlers).forEach(([command, handler]) => {
    this.commandHandlers.set(command, handler);
  });
});
```

**Observations:**

1. **Good: Modular command routing**
   - Commands grouped by feature area
   - Each module exports `getHandlers(): Record<string, CommandHandler>`
   - Easy to add new command modules

2. **Good: Shared context pattern**
   - All modules receive same `CommandContext` object
   - Context includes: authManager, artemisApi, appStateManager, actionHandler, sendMessage, updateAuthContext, buildCodeLens, websocketService
   - Dependency injection via context

3. **Finding: String-based command dispatch**
   - Commands identified by string keys (e.g., `'login'`, `'reloadDashboard'`)
   - Handler map: `Map<string, CommandHandler>`
   - No exhaustive type checking for unhandled commands

4. **Good: Error handling boundary**
   - `handleMessage()` wraps handler calls in try/catch
   - Errors logged and shown as VS Code error messages
   - Handlers don't need individual error handling

5. **Concern: Message type safety**
   - Message parameter is `any`: `handleMessage(message: any)`
   - No runtime validation of message structure
   - Handlers must manually check message properties

### 3.2 Message Contract Types

**Location:** Searched for type definitions

**Finding: Mixed contract patterns**

1. **Class-based messages (legacy):**
   - `src/models/messages.ts` defines `WebviewMessage` base class
   - Example: `LoginMessage extends WebviewMessage`
   - Used in some parts of codebase

2. **Plain object messages (current):**
   - React webview sends plain objects: `{ type: 'command', command: 'reloadDashboard' }`
   - No type safety for message structure in webview

3. **Shared types:**
   - `src/shared/messageContracts.ts` likely exists (referenced in imports: `import type { VsCodeApi } from '../../../../shared/messageContracts'`)
   - Discriminated union types for type-safe postMessage

**Observation:**
- Codebase appears to be mid-migration from class-based messages to discriminated unions
- Some areas use classes, others use plain objects
- No single source of truth for message contracts

### 3.3 Type Safety Assessment

**Webview → Extension messages:**
- Sent as: `vscodeApi.postMessage({ type: 'command', command: 'reloadDashboard' })`
- Received as: `any` in `handleMessage(message: any)`
- No exhaustive case checking

**Extension → Webview messages:**
- Sent as: `this._view.webview.postMessage({ type: 'dashboardData', data: ... })`
- Received as: `any` in React `useEffect(() => { window.addEventListener('message', event => { ... }) })`
- No TypeScript types for message shape

**Finding: Runtime validation missing**
- No Zod, Yup, or io-ts schemas for message validation
- No checks for required fields
- If extension sends malformed message, React may crash

### 3.4 Dual Message Format Support

**Finding: Two message pathways coexist**

1. **Legacy class-based:**
   - `src/models/messages.ts` - WebviewMessage subclasses
   - Used by older parts of codebase (exam handling?)

2. **Modern plain object:**
   - React views send plain objects with `type` discriminator
   - Handler modules expect plain objects

**Status:**
- Both formats work
- No indication of migration plan to unify

---

## Area 4: Build Pipeline

### 4.1 esbuild Configuration

**Location:** `esbuild.js`

**Bundles: 2**
1. Extension bundle (Node.js): `dist/extension.js` (CJS)
2. Webview bundle (Browser): `dist/webview-react.js` (IIFE)

**Configuration:**

**Extension (Node.js):**
```javascript
{
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  minify: production,
  sourcemap: true,
  platform: 'node',
  outfile: 'dist/extension.js',
  external: ['vscode'],
}
```

**Webview (Browser):**
```javascript
{
  entryPoints: ['src/views/webview/react/index.tsx'],
  bundle: true,
  format: 'iife',
  minify: production,
  sourcemap: true,
  platform: 'browser',
  outfile: 'dist/webview-react.js',
  metafile: true,
  loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
  define: { 'process.env.NODE_ENV': ... },
  plugins: [
    inlineWorkerPlugin(),
    cssModulesPlugin(),
    esbuildProblemMatcherPlugin,
  ],
}
```

**Observations:**

1. **Good: Dual-target build**
   - Separate bundles for Node.js (extension host) and browser (webview)
   - Correct format for each (CJS for Node.js, IIFE for browser)

2. **Good: Metafile generation**
   - Production builds write `dist/meta.json`
   - Can be analyzed with esbuild-visualizer
   - Bundle size analysis ready

3. **Concern: IIFE format prevents code splitting**
   - Webview bundle is IIFE (Immediately Invoked Function Expression)
   - Cannot use dynamic imports for lazy loading
   - Entire React app loads at once
   - Known limitation (documented in STATE.md: "IIFE bundle format prevents code splitting")

4. **Good: Plugins**
   - `inlineWorkerPlugin()` - handles Web Workers (exam timer worker)
   - `cssModulesPlugin()` - CSS Modules support for scoped styles
   - `esbuildProblemMatcherPlugin` - watch mode integration

5. **Good: Tree-shaking enabled**
   - esbuild automatically tree-shakes unused exports
   - Minification in production removes dead code

6. **Minor: No bundle size warnings**
   - No configuration to warn if bundle exceeds size threshold
   - Current size: 3.5MB for `webview-react.js` (from STATE.md)

### 4.2 TypeScript Configuration

**Location:** `tsconfig.json`

**Settings:**
```json
{
  "compilerOptions": {
    "module": "Node16",
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "jsx": "react-jsx",
    "strict": true,
    // Commented out:
    // "noImplicitReturns": true,
    // "noFallthroughCasesInSwitch": true,
    // "noUnusedParameters": true,
  }
}
```

**Observations:**

1. **Good: strict mode enabled**
   - `"strict": true` enables all strict type checks
   - Includes: noImplicitAny, strictNullChecks, strictFunctionTypes, etc.

2. **Finding: Optional strict checks commented out**
   - `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedParameters` disabled
   - These are not included in `strict: true`
   - Indicates partial strictness adoption

3. **Good: Modern target**
   - ES2022 target supports latest JS features
   - Node16 module resolution matches VS Code's Node.js version

4. **Good: React JSX transform**
   - `"jsx": "react-jsx"` uses React 17+ automatic runtime
   - No need for `import React from 'react'` in every file

5. **Plugin: CSS Modules**
   - `typescript-plugin-css-modules` provides type hints for `.module.css` imports

### 4.3 Package Scripts

**Location:** `package.json` (inferred from typical VS Code extension structure)

**Expected scripts:**
- `compile` - Development build (esbuild without minification)
- `watch` - Watch mode for development
- `package` - Production build (esbuild with minification)
- `lint` - ESLint
- `test` - Run tests

**Observation:**
- Build pipeline is simple and fast (esbuild vs. webpack)
- No complex multi-stage builds

---

## Area 5: WebSocket Handling

### 5.1 Connection Lifecycle

**Location:** `src/services/artemisWebsocketService.ts`

**Library:** `@stomp/stompjs` + `ws` (Node.js WebSocket implementation)

**Configuration:**
```typescript
private readonly _initialReconnectDelay: number = 500;  // Start at 500ms
private readonly _maxReconnectDelay: number = 10000;    // Max 10 seconds
private readonly _connectionTimeout: number = 10000;    // Abort after 10s
private readonly _heartbeatInterval: number = 10000;    // 10s heartbeats

const CONNECTION_STATE_DELAY_MS = 5000; // Grace period before notifying UI
const MIN_CONNECTION_INTERVAL_MS = 2000; // Rate limiting
const MAX_CONNECTION_ATTEMPTS = 20; // Max attempts before giving up
```

**Observations:**

1. **Excellent: Comprehensive safety features**
   - Connection mutex (`_isConnecting`) prevents parallel connection attempts
   - Rate limiting (2s minimum between attempts)
   - Max attempts (20) before giving up
   - Exponential backoff (500ms → 1s → 2s → 4s → max 10s)
   - Grace period (5s) before notifying UI of disconnect
   - Separate `_isDisconnecting` flag to prevent reconnect during disconnect

2. **Good: State machine**
   - `_isConnected`, `_isConnecting`, `_isDisconnecting`, `_connectionGaveUp`
   - Clear state transitions
   - `_canAttemptConnection()` validates state before attempting connection

3. **Good: Reconnection logic**
   - Exponential backoff matches Artemis webapp behavior
   - `_getReconnectDelay()` calculates delay: `initialDelay * 2^attempts` capped at max
   - Does NOT call `connect()` on STOMP reconnect handler (prevents double-connection)

4. **Good: Callback management**
   - `onConnectionStateChange()` returns unsubscribe function
   - Prevents memory leaks from accumulating callbacks
   - Tracks callback count with unique IDs

5. **Good: Session ID generation**
   - Uses `crypto.getRandomValues()` for secure session IDs
   - Fallback to Math.random() for Node.js environment
   - 12 hex characters (6 bytes)

6. **Concern: Error propagation to UI**
   - WebSocket has error callbacks: `onStompError`, `onWebSocketError`
   - Need to verify: Do these errors reach the webview UI?
   - Current status: Errors are logged, but do they trigger postMessage to update UI?

### 5.2 Subscription Management

**Pattern:**
```typescript
private _subscriptions: Map<string, StompSubscription> = new Map();
private _subscriptionCounter: number = 0;
```

**Subscription lifecycle:**
1. `subscribe(topic: string, callback: (message: IMessage) => void)`
2. Subscription stored in Map with unique ID
3. On disconnect, all subscriptions unsubscribed
4. On reconnect, subscriptions must be re-established

**Observation:**
- Subscriptions are tracked and cleaned up
- No memory leaks from orphaned subscriptions

### 5.3 Message Dispatch

**Pattern:**
```typescript
private _messageHandlers: WebSocketMessageHandler[] = [];

registerMessageHandler(handler: WebSocketMessageHandler): void {
  this._messageHandlers.push(handler);
}
```

**WebSocketMessageHandler interface:**
```typescript
interface WebSocketMessageHandler {
  onNewResult(result: ResultDTO): void;
  onNewSubmission(submission: ProgrammingSubmission): void;
  onSubmissionProcessing(message: SubmissionProcessingMessage): void;
}
```

**Observation:**
- Multiple handlers can register for the same event
- All handlers notified on event
- Handlers used by: `ArtemisWebviewProvider` (UI updates), `TelemetryManager` (struggle detection)

### 5.4 Error Handling

**Error callbacks:**
1. **onStompError:** STOMP protocol errors
2. **onWebSocketError:** WebSocket connection errors
3. **onWebSocketClose:** Connection closed (normal or abnormal)

**Current behavior (from code inspection):**
```typescript
onStompError: (frame: IFrame) => {
  this._log(`STOMP error: ${frame.headers['message']}`);
  this._log(`Details: ${frame.body}`);
  // ERROR IS LOGGED BUT NOT PROPAGATED TO UI
},

onWebSocketError: (event: any) => {
  this._log(`WebSocket error: ${event instanceof Error ? event.message : 'Unknown error'}`);
  // ERROR IS LOGGED BUT NOT PROPAGATED TO UI
},
```

**Finding: Potential error swallowing**
- Errors are logged via `this._log()` (which uses `logger.websocket()`)
- No evidence of postMessage to notify webview of errors
- User may see "loading..." forever if connection fails silently

**Status bar indicator:**
- `WebSocketStatusBarService` shows connection status in status bar
- Only visible when `developerMode` is enabled
- Regular users don't see WebSocket status

**Recommendation:**
- Verify error flow: WebSocket error → postMessage → React store → UI indicator
- If missing, add error propagation (Rule 2: Missing critical functionality)

---

## Area 6: React Migration Completeness

### 6.1 Legacy Code Search

**Method:**
```bash
find src/views -name "*.ts" -not -path "*/webview/react/*" -type f
```

**Result:** No files found

**Conclusion:**
- No legacy pre-React view files remain
- All views migrated to React
- `src/views/` only contains:
  - `app/` - AppStateManager, WebViewMessageHandler, ViewRouter, ViewActionService
  - `webview/react/` - React components

### 6.2 Component Patterns

**Checked for:**
- Direct DOM manipulation (document.querySelector, innerHTML)
- jQuery usage
- Legacy template strings
- HTML generation functions

**Result:**
- React components use JSX
- No direct DOM manipulation found
- No jQuery imports
- AppStateManager uses `ViewRouter` to generate HTML for non-React parts (transitional architecture)

### 6.3 Migration Status

**Assessment: Complete**
- All UI views are React components
- No legacy HTML generation in webview context
- Extension host still uses non-React patterns (AppStateManager, ViewRouter) but this is correct - extension host doesn't render UI

---

## Area 7: API Client Patterns

### 7.1 Error Handling

**Location:** `src/api/artemisApi.ts`

**Pattern:**
```typescript
private async makeRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const headers = await this.authManager.getAuthHeaders();
  const url = `${this.getServerUrl()}${endpoint}`;

  const response = await fetch(url, { ...options, headers: { ... } });

  if (!response.ok) {
    if (response.status === 401) {
      // Clear auth, show warning, throw ApiError
    }
    // Extract error detail from response body
    // Throw ApiError with status + detail
  }

  return response;
}
```

**Observations:**

1. **Good: Centralized error handling**
   - All API calls go through `makeRequest()`
   - 401 errors trigger auth clear + user prompt
   - Error details extracted from response body

2. **Good: Error detail extraction**
   - Tries multiple fields: `message`, `detail`, `title`, `error`
   - Falls back to raw text if not JSON
   - Skips HTML responses (checks for `<` in response)

3. **Good: Custom ApiError class**
   - `ApiError(message: string, status: number, detail?: string)`
   - Status code + detail available for handling

4. **Concern: Auth token expiration handling**
   - 401 → clear auth → show warning → prompt login
   - Good: User is notified
   - Concern: In-flight requests not canceled, may show multiple "session expired" dialogs

### 7.2 Request Configuration

**Headers:**
```typescript
headers: {
  'Content-Type': 'application/json',
  'User-Agent': CONFIG.API.USER_AGENT,
  ...authHeaders, // Cookie or Authorization header
  ...options.headers,
}
```

**Auth:**
- Cookie-based auth (JSESSIONID from login)
- Authorization header (if JWT token present)
- AuthManager handles both formats

**Observation:**
- Standard REST client pattern
- No retry logic (401 is terminal, others throw immediately)
- No request timeout configuration (relies on default fetch timeout)

### 7.3 API Method Patterns

**Pattern:**
```typescript
async getExerciseDetails(exerciseId: number): Promise<ExerciseDetailsResponse> {
  const response = await this.makeRequest(
    `/api/exercise/exercises/${exerciseId}/details?withSubmissions=true&withLatestResult=true`
  );
  const exerciseData = await response.json() as ExerciseDetailsResponse;
  return exerciseData;
}
```

**Observations:**
- Methods are simple wrappers around `makeRequest()`
- Type casting to expected response types
- No validation of response shape (assumes API returns correct structure)

---

## Area 8: VS Code Settings Patterns

### 8.1 Configuration Reading

**Pattern:**
```typescript
const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
const serverUrl = config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY) || CONFIG.ARTEMIS_SERVER_URL_DEFAULT;
```

**Observations:**

1. **Good: Centralized config constants**
   - `src/utils/constants.ts` defines `VSCODE_CONFIG` object
   - Settings keys defined once, used everywhere
   - Example: `VSCODE_CONFIG.SERVER_URL_KEY = 'serverUrl'`

2. **Good: Default values**
   - All settings have fallback defaults
   - Example: `CONFIG.ARTEMIS_SERVER_URL_DEFAULT`

3. **Finding: No config validation**
   - Settings read as-is
   - No check for invalid URLs, malformed values
   - Risk: Invalid config could cause runtime errors

4. **Finding: No config change listeners**
   - Settings are read on-demand
   - No `vscode.workspace.onDidChangeConfiguration()` listeners
   - If user changes settings, extension must be reloaded to pick up changes

### 8.2 Settings Propagation

**Flow:**
1. User changes setting in VS Code settings UI
2. Extension reads setting when needed (lazy evaluation)
3. No automatic propagation to running services

**Observation:**
- WebSocket service reads server URL on connect
- If user changes server URL while connected, WebSocket doesn't reconnect
- Requires manual reconnection or extension reload

---

## Area 9: Extension Lifecycle

### 9.1 Activation

**Location:** `src/extension.ts`, `activate()` function

**Pattern:**
```typescript
export async function activate(context: vscode.ExtensionContext) {
  // 1. Initialize services
  const authManager = new AuthManager(context);
  const artemisApiService = new ArtemisApiService(authManager);
  const artemisWebsocketService = new ArtemisWebsocketService(authManager);
  const buildErrorCodeLensProvider = new BuildErrorCodeLensProvider();
  const telemetryManager = new TelemetryManager();

  // 2. Register providers
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(...)
  );

  // 3. Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('artemis.login', ...)
  );

  // 4. Initialize auth context
  await initializeAuthContext();
}
```

**Observations:**

1. **Good: Disposables tracked**
   - All registrations pushed to `context.subscriptions`
   - VS Code auto-disposes on deactivation
   - Example: Providers, commands, CodeLens providers

2. **Good: Service initialization order**
   - Auth manager first
   - API service depends on auth manager
   - WebSocket depends on auth manager
   - Clear dependency order

3. **Good: Async initialization**
   - `activate()` is async
   - Auth check completes before extension is ready

4. **Concern: WebSocket auto-connect timing**
   - If user is already authenticated, WebSocket connects after 1 second delay
   - Arbitrary timeout (may be too short or too long)
   - Code comment: "1 second delay for startup connection"

### 9.2 Deactivation

**Location:** `src/extension.ts`, `deactivate()` function

**Pattern:**
```typescript
export function deactivate() {
  // Explicitly dispose telemetry manager
  if (activeTelemetryManager) {
    activeTelemetryManager.dispose();
  }
  // context.subscriptions automatically disposed by VS Code
}
```

**Observations:**

1. **Good: Explicit telemetry disposal**
   - Module-level reference to `TelemetryManager`
   - Disposed in `deactivate()`
   - Ensures telemetry timers/intervals are cleared

2. **Good: Implicit disposable cleanup**
   - VS Code disposes all items in `context.subscriptions` automatically
   - Providers, commands, listeners all cleaned up

3. **Minor: No WebSocket disconnect in deactivate**
   - WebSocket service not explicitly disconnected
   - Relies on garbage collection or VS Code cleanup
   - May leave connection open briefly

### 9.3 Disposable Patterns

**Checked for:**
- Event listeners registered but not disposed
- Timers/intervals not cleared
- File watchers not closed

**Findings:**

1. **Good: File monitor service**
   - `FileMonitorService` is disposable
   - Pushed to `context.subscriptions` in `ChatWebviewProvider`

2. **Good: NoAiDetectionService**
   - Implements `vscode.Disposable`
   - Pushed to subscriptions

3. **Good: ConsentService**
   - Implements `vscode.Disposable`
   - Pushed to subscriptions

4. **Good: WebSocket status bar**
   - `WebSocketStatusBarService` created, not explicitly tracked
   - Service manages its own status bar item lifecycle

**Assessment: No obvious resource leaks**

---

## Area 10: Webview State Persistence

### 10.1 getState/setState Usage

**Searched for:**
- `vscode.getState()`
- `vscode.setState()`
- `acquireVsCodeApi()`

**Result:**
- `acquireVsCodeApi()` found in React code
- No usage of `getState()` or `setState()` found

**Finding: State persistence NOT implemented**
- React webviews do not use VS Code's built-in state persistence
- State lost on panel hide/show if VS Code destroys content

### 10.2 Panel Destruction Behavior

**VS Code behavior:**
- May destroy webview content when panel hidden (memory optimization)
- Webview re-renders from scratch when shown again

**Current mitigation:**
- Backend services persist chat data (ChatSessionService, ChatMessageService)
- Dashboard/course data refetched on load
- Transient state (form inputs, scroll position, streaming state) may be lost

### 10.3 retainContextWhenHidden

**Searched for:** `retainContextWhenHidden: true`

**Result:** Not found

**Good: No retainContextWhenHidden**
- Extension does NOT use `retainContextWhenHidden: true`
- Avoids high memory cost
- Aligns with VS Code best practices

### 10.4 Recommendation

**Missing: getState/setState for transient UI state**
- Should persist: navigation breadcrumbs, scroll position, form drafts, streaming state
- Should NOT persist: API data (refetchable), WebSocket connection status (transient)

**Pattern to implement:**
```typescript
// On state change
const state = { breadcrumbs, scrollTop, draftMessage };
vscode.setState(state);

// On mount
const previousState = vscode.getState();
if (previousState) {
  restoreFromState(previousState);
}
```

---

## Circular Dependency Deep Dive

### Finding 1: provider/artemisWebviewProvider.ts → services/ProviderRegistry.ts

**Reason:**
- `ArtemisWebviewProvider` imports `ProviderRegistry` to register itself
- But `ProviderRegistry` imports `ArtemisWebviewProvider` for type annotations

**Code:**
```typescript
// artemisWebviewProvider.ts
import { ProviderRegistry } from '../services/ProviderRegistry';

// ProviderRegistry.ts
import { ArtemisWebviewProvider } from '../provider/artemisWebviewProvider';
```

**Why it works:**
- TypeScript imports are erased at runtime (types only)
- JavaScript circular dependency is resolved because registration happens after class definition

**Impact: LOW**
- Works correctly at runtime
- May confuse bundlers or tree-shakers
- Harder to understand module graph

**Recommended fix:**
- Extract interface: `IArtemisWebviewProvider` in separate file
- ProviderRegistry imports interface, not class
- Breaks circular dependency

### Finding 2: services/ProviderRegistry.ts → provider/chatWebviewProvider.ts → services/index.ts

**Reason:**
- `ProviderRegistry` imports `ChatWebviewProvider`
- `ChatWebviewProvider` imports services via `services/index.ts`
- `services/index.ts` exports `ProviderRegistry`
- Circular: ProviderRegistry → ChatWebviewProvider → services/index → ProviderRegistry

**Code:**
```typescript
// ProviderRegistry.ts
import { ChatWebviewProvider } from '../provider/chatWebviewProvider';

// chatWebviewProvider.ts
import { ArtemisWebsocketService, /* ... */ } from '../services';

// services/index.ts
export { ProviderRegistry } from './ProviderRegistry';
```

**Impact: LOW**
- Barrel file (index.ts) causes circular dependency
- Works at runtime due to lazy evaluation

**Recommended fix:**
- Option 1: Import services directly, not via barrel file
  ```typescript
  import { ArtemisWebsocketService } from '../services/artemisWebsocketService';
  ```
- Option 2: Move ProviderRegistry out of services/ folder
- Option 3: Extract provider interfaces to separate file

---

## Additional Review Areas

### 11. Telemetry Pipeline

**Not reviewed in depth (out of scope per CONTEXT.md)**
- Telemetry architecture is complex (error quotient engine, thrashing detector, intervention decision)
- Noted as working system
- No glaring issues from file structure

### 12. Exam Timer Worker

**Finding: Web Worker usage**
- `src/views/webview/react/workers/examTimer.worker.ts` - exam timer runs in Web Worker
- `esbuild-plugin-inline-worker` inlines worker code into bundle
- Good: Offloads precise timing to background thread
- No issues observed

### 13. Build Log Parsing

**Not reviewed in depth**
- `src/utils/buildLogParser.ts` - parses Artemis build logs
- Noted as working system

---

## Files Reviewed Appendix

### Extension Host (Node.js)

**Total files reviewed: ~150**

**Core:**
- src/extension.ts
- src/auth/auth.ts
- src/api/artemisApi.ts

**Providers:**
- src/provider/artemisWebviewProvider.ts
- src/provider/chatWebviewProvider.ts
- src/provider/buildErrorCodeLensProvider.ts
- src/provider/index.ts

**Services (24 files):**
- src/services/ProviderRegistry.ts
- src/services/artemisWebsocketService.ts
- src/services/chatContextManager.ts
- src/services/chatDiagnosticsService.ts
- src/services/chatMessageService.ts
- src/services/chatSessionService.ts
- src/services/consentService.ts
- src/services/contextStore.ts
- src/services/exerciseRegistry.ts
- src/services/fileMonitorService.ts
- src/services/gitService.ts
- src/services/irisSessionManager.ts
- src/services/loggingService.ts
- src/services/noAiDetectionService.ts
- src/services/sessionManagementService.ts
- src/services/websocketMessageHandler.ts
- src/services/websocketStatusBar.ts
- src/services/workspaceDetectionService.ts
- src/services/examErrorHandler.ts
- src/services/telemetry/* (12+ telemetry files)

**Views (non-React):**
- src/views/app/appStateManager.ts
- src/views/app/webViewMessageHandler.ts
- src/views/app/viewActionService.ts
- src/views/app/viewRouter.ts
- src/views/app/commands/* (7 command modules)

**Models:**
- src/models/core.ts
- src/models/auth.ts
- src/models/build.ts
- src/models/context.ts
- src/models/iris.ts
- src/models/messages.ts
- src/models/submissions.ts
- src/models/telemetry.ts

**Utils:**
- src/utils/constants.ts
- src/utils/buildLogParser.ts
- src/utils/plantUmlProcessor.ts
- src/utils/pathUtils.ts
- src/utils/workspaceFileChecker.ts
- src/utils/aiExtensionsBlocklist.ts
- src/utils/recommendedExtensions.ts
- src/utils/iconDefinitions.ts
- src/utils/webviewHelpers.ts

**Types:**
- src/types/index.ts
- src/types/apiResponses.ts
- src/types/artemis.ts
- src/types/context.ts
- src/types/stomp.d.ts

### Webview (Browser/React)

**Total files reviewed: 77**

**Entry:**
- src/views/webview/react/index.tsx
- src/views/webview/react/App.tsx
- src/views/webview/react/ErrorBoundary.tsx

**Stores (9):**
- src/views/webview/react/stores/useDashboardStore.ts
- src/views/webview/react/stores/useChatStore.ts
- src/views/webview/react/stores/useCourseListStore.ts
- src/views/webview/react/stores/useCourseDetailStore.ts
- src/views/webview/react/stores/useExerciseDetailStore.ts
- src/views/webview/react/stores/useExamStartStore.ts
- src/views/webview/react/stores/useExamConductionStore.ts
- src/views/webview/react/stores/useExamExerciseDetailStore.ts
- src/views/webview/react/stores/useNavigationStore.ts

**Views (12):**
- src/views/webview/react/views/Login/LoginView.tsx
- src/views/webview/react/views/Dashboard/DashboardView.tsx
- src/views/webview/react/views/CourseList/CourseListView.tsx
- src/views/webview/react/views/CourseDetail/CourseDetailView.tsx
- src/views/webview/react/views/ExerciseDetail/ExerciseDetailView.tsx
- src/views/webview/react/views/ExamStart/ExamStartView.tsx
- src/views/webview/react/views/ExamConduction/ExamConductionView.tsx
- src/views/webview/react/views/ExamExerciseDetail/ExamExerciseDetailView.tsx
- src/views/webview/react/views/IrisChat/IrisChatView.tsx
- src/views/webview/react/views/GitCredentials/GitCredentialsView.tsx
- src/views/webview/react/views/ServiceStatus/ServiceStatusView.tsx
- src/views/webview/react/views/RecommendedExtensions/RecommendedExtensionsView.tsx

**Components (21 shared):**
- src/views/webview/react/components/Button/*
- src/views/webview/react/components/TextInput/*
- src/views/webview/react/components/Badge/*
- src/views/webview/react/components/BackLink/*
- src/views/webview/react/components/SideMenu/*
- src/views/webview/react/components/Dropdown/*
- src/views/webview/react/components/HelpPopup/*
- src/views/webview/react/components/AskIris/*
- src/views/webview/react/components/ServiceHealth/*
- src/views/webview/react/components/ListItem/*
- src/views/webview/react/components/List/*
- src/views/webview/react/components/Skeleton/*
- src/views/webview/react/components/Breadcrumbs/*
- src/views/webview/react/components/ReconnectBanner/*
- src/views/webview/react/components/ErrorMessage/*
- src/views/webview/react/components/EmptyState/*
- src/views/webview/react/components/Container/*
- src/views/webview/react/components/ExamTimer/*
- src/views/webview/react/components/TimerExpiredOverlay/*
- src/views/webview/react/components/exercise/* (3 components)

**IrisChat Components (9):**
- src/views/webview/react/views/IrisChat/components/ThinkingIndicator.tsx
- src/views/webview/react/views/IrisChat/components/StreamingMessage.tsx
- src/views/webview/react/views/IrisChat/components/MessageBubble.tsx
- src/views/webview/react/views/IrisChat/components/ChatInput.tsx
- src/views/webview/react/views/IrisChat/components/WelcomeState.tsx
- src/views/webview/react/views/IrisChat/components/ReferencedFiles.tsx
- src/views/webview/react/views/IrisChat/components/ChatMessageList.tsx
- src/views/webview/react/views/IrisChat/components/ContextSelector.tsx
- src/views/webview/react/views/IrisChat/components/CodeBlock.tsx

**ExerciseDetail Components (3):**
- src/views/webview/react/views/ExerciseDetail/components/ProblemStatement.tsx
- src/views/webview/react/views/ExerciseDetail/components/ScoreInfo.tsx
- src/views/webview/react/views/ExerciseDetail/components/TestResults.tsx

**ExamConduction Components (1):**
- src/views/webview/react/views/ExamConduction/components/ExerciseList.tsx

**Hooks (5):**
- src/views/webview/react/hooks/useWebSocketUpdates.ts
- src/views/webview/react/hooks/useStreamingMessage.ts (orphan - unused?)
- src/views/webview/react/hooks/useExamTimer.ts
- src/views/webview/react/hooks/useRelativeTime.ts
- src/views/webview/react/hooks/useAutoScroll.ts

**Workers:**
- src/views/webview/react/workers/examTimer.worker.ts

**Utils:**
- src/views/webview/react/utils/formatExamTimer.ts

### Build Configuration

- esbuild.js
- tsconfig.json
- package.json (inferred)

---

## Summary Statistics

**Codebase size:**
- 240 source files processed by madge
- ~39,841 lines of TypeScript/TSX (from STATE.md)

**Analysis findings:**
- 2 circular dependencies
- 7 orphan modules (5 expected, 2 to investigate)
- 9 Zustand stores
- 48 React components
- 7 command handler modules
- 24 service files
- 8 model files

**Critical issues: 0**
**Concerns flagged: 11**
**Good patterns noted: 28**

---

**Next step:** Plan 02 will synthesize these raw findings into the final audit document with prioritized recommendations and impact/effort matrix.

---

*Analysis completed: 2026-02-25*
