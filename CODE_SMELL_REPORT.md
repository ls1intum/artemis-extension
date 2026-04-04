# Code Smell Report — Artemis VS Code Extension

**Date:** 2026-04-04
**Branch:** `dev` (commit `c696ea3a`)
**Scope:** Full codebase — 197 source files, 82 test files
**Method:** 6 parallel deep-dive analyses (Architecture, Telemetry, Services, Frontend, Types/Tests, Controller/API)
**ESLint:** 0 errors, 0 warnings

---

## Table of Contents

- [CRITICAL — Fix Immediately](#critical--fix-immediately)
  - [C1: God Classes / God Files](#c1-god-classes--god-files)
  - [C2: No Dependency Injection — 18x Direct `new`](#c2-no-dependency-injection--18x-direct-new)
  - [C3: Duplicated EQ Threshold Mapping](#c3-duplicated-eq-threshold-mapping)
  - [C4: Shotgun Surgery — ActiveContext Type](#c4-shotgun-surgery--activecontext-type)
  - [C5: Type Guards Accept Invalid Messages](#c5-type-guards-accept-invalid-messages)
- [HIGH — Fix Before Submission](#high--fix-before-submission)
  - [H1: Inconsistent Error Handling](#h1-inconsistent-error-handling)
  - [H2: Missing Disposal / Resource Cleanup](#h2-missing-disposal--resource-cleanup)
  - [H3: Test Coverage ~30%](#h3-test-coverage-30)
  - [H4: Race Conditions in Telemetry Layer](#h4-race-conditions-in-telemetry-layer)
  - [H5: Webview — Extreme Prop Drilling](#h5-webview--extreme-prop-drilling)
- [MEDIUM — Maintainability & Quality](#medium--maintainability--quality)
  - [M1: Barrel Export Bloat](#m1-barrel-export-bloat)
  - [M2: Magic Numbers in Telemetry Layer](#m2-magic-numbers-in-telemetry-layer)
  - [M3: Duplicated Logic](#m3-duplicated-logic)
  - [M4: Fat Components (Frontend)](#m4-fat-components-frontend)
  - [M5: Missing Memoization (Frontend)](#m5-missing-memoization-frontend)
  - [M6: Store Bloat (Frontend)](#m6-store-bloat-frontend)
  - [M7: API Response Types Too Broad](#m7-api-response-types-too-broad)
  - [M8: Type Duplication — 3 Exercise Representations](#m8-type-duplication--3-exercise-representations)
  - [M9: Temporal Coupling](#m9-temporal-coupling)
  - [M10: Accessibility Gaps (Frontend)](#m10-accessibility-gaps-frontend)
  - [M11: Provider Handles Business Logic](#m11-provider-handles-business-logic)
  - [M12: Missing Input Validation on Webview Messages](#m12-missing-input-validation-on-webview-messages)
  - [M13: API Client Error Handling & Validation Gaps](#m13-api-client-error-handling--validation-gaps)
  - [M14: Inconsistent Message Dispatch Patterns](#m14-inconsistent-message-dispatch-patterns)
  - [M15: Long Methods in Telemetry Layer](#m15-long-methods-in-telemetry-layer)
  - [M16: Primitive Obsession in Telemetry Layer](#m16-primitive-obsession-in-telemetry-layer)
  - [M17: Complex Conditionals](#m17-complex-conditionals)
  - [M18: Mapper Bloat and Runtime Error Risk](#m18-mapper-bloat-and-runtime-error-risk)
- [LOW — Nice to Have](#low--nice-to-have)
- [Strengths](#strengths)

---

## CRITICAL — Fix Immediately

### C1: God Classes / God Files

Five files exceed 600 lines and carry multiple distinct responsibilities.

| File | Lines | Responsibilities |
|------|-------|------------------|
| `src/extension/controller/commands/repositoryCommands.ts` | 775 | Git operations, repository cloning, build log viewing, source navigation, git identity management |
| `src/extension/services/iris/contextStore.ts` | 713 | In-memory caching, persistence/serialization, session management, priority calculation, history trimming, event notification |
| `src/extension/provider/chatWebviewProvider.ts` | 702 | Webview lifecycle, message dispatch, session management, context switching, file monitoring, diagnostics, persistence |
| `src/extension/services/telemetry/telemetryManager.ts` | 676 | EQ calculation orchestration, session lifecycle, WebSocket message handling, debug status bar UI, configuration monitoring |
| `src/extension/provider/artemisWebviewProvider.ts` | 604 | View lifecycle, message routing, state synchronization, service coordination (9+ services), navigation, business logic |

**Details:**

**telemetryManager.ts** — Constructor directly instantiates 10+ services (DiagnosticPersistenceService, InactivityService, ThrashingDetector, BuildResultTracker, InterventionService, InterventionFilter, ErrorQuotientEngine, CompileEquivalentEmitter, BoundaryTriggerEmitter, AdaptiveCadence, InterventionDecisionEngine). Manually maintains `_sessionServices` array. Mixes 5 concerns: telemetry aggregation, session lifecycle, WebSocket handling, debug UI, config monitoring.

**chatWebviewProvider.ts** — Constructor creates 9 service instances with cross-dependencies and lambda-based late binding to handle circular references. Single provider manages entire Iris chat lifecycle.

**artemisWebviewProvider.ts** — 14 instance properties, constructor receives 10+ parameters, creates 9 services. `navigateToStartPage()` (lines 306-376) contains complex switch + nested state mutations. `showDashboard()` contains business logic (fetch courses, set state, render, archive check).

**repositoryCommands.ts** — 8 internal state fields, 10+ command handlers mixed in same class. Mixes low-level I/O (token fetching, API calls, error messages) with high-level orchestration.

**Suggested refactoring:**
- Split `chatWebviewProvider` into: ChatSessionOrchestrator (session lifecycle), ChatViewProvider (UI lifecycle), ChatCommandDispatcher (message routing)
- Split `telemetryManager` into: EQCalculator (algorithm), SessionLifecycleManager, TelemetryOrchestrator (coordinator)
- Split `repositoryCommands` into: GitOperationsModule, CloneModule, BuildLogModule

---

### C2: No Dependency Injection — 18x Direct `new`

Services are directly instantiated everywhere instead of being injected via constructor parameters or a DI container.

**Locations:**

```
chatWebviewProvider.ts:70    → new ContextStore(this._extensionContext)
chatWebviewProvider.ts:84    → new FileMonitorService()
chatWebviewProvider.ts:95    → new ChatDiagnosticsService(...)
chatWebviewProvider.ts:96    → new IrisChatSessionService(...)
chatWebviewProvider.ts:100   → new ChatMessageService(...)
chatWebviewProvider.ts:106   → new ChatContextManager(...)
chatWebviewProvider.ts:111   → new IrisWebSocketMessageHandler(...)
chatWebviewProvider.ts:118   → new IrisWebSocketSessionClient(...)
artemisWebviewProvider.ts:79-104  → 9 direct instantiations
telemetryManager.ts:99-114   → 10 direct instantiations
repositoryCommands.ts:34     → new GitService()
viewInitDataService.ts:15    → new GitService()  ← DUPLICATE instance
```

**Impact:**
- Untestable without mocks/stubs
- No ability to swap implementations
- Hidden coupling between services
- `GitService` instantiated twice independently — state inconsistency risk

**Suggested fix:** Introduce a lightweight service container or use constructor injection consistently. At minimum, pass services as constructor parameters.

---

### C3: Duplicated EQ Threshold Mapping

Two independent sources of truth for mapping EQ score to recommended action:

**Source 1** — `telemetryManager.ts:462-476`:
```typescript
// Hardcoded thresholds in _getRecommendedAction()
if (eq >= 0.60) return 'proactive';
if (eq >= 0.35) return 'notification';
if (eq >= 0.15) return 'subtle';
return 'none';
```

**Source 2** — `interventionDecisionEngine.ts:102-113`:
```typescript
// Configurable thresholds via constructor injection
this._thresholds = { none: 0.15, subtle: 0.35, notification: 0.60 };
```

The decision engine uses injectable thresholds (correct), but `telemetryManager` has its own hardcoded copy. If thresholds are changed in one place, the other becomes silently inconsistent.

**Fix:** Remove the hardcoded mapping from `telemetryManager` and delegate all threshold decisions to `InterventionDecisionEngine`.

---

### C4: Shotgun Surgery — ActiveContext Type

`ActiveContext` (defined in `shared/types/context.ts:10-19`) is used in **11+ files**. Adding a single field requires updates across:

1. `services/iris/contextStore.ts` — stores and returns it
2. `services/iris/chatSessionService.ts` — validates settings based on it
3. `services/iris/chatContextManager.ts` — switches context, maps to storage
4. `services/iris/chatMessageService.ts` — builds message payloads based on type/courseId
5. `provider/chatWebviewProvider.ts` — public API delegates methods based on it
6. `shared/types/context.ts` — definition
7. Plus 5 more files in domain and shared layers

Similarly affected: `ResultDTO` (8+ files), `WebviewCmd` enum (7+ files per new command), `IrisServiceDeps` interface (3 services + creation site).

**Mitigation:** Extract ActiveContext mutations into a dedicated ContextMutator service. Reduce direct field access from consumers.

---

### C5: Type Guards Accept Invalid Messages

**File:** `shared/messageContracts/typeGuards.ts`

```typescript
// Line 52: Accepts ANY unknown message type
default:
    return true;
```

Problems:
1. `default: return true` — any message type not explicitly handled passes the guard
2. No payload **shape** validation — only checks payload exists, not that fields match expected types/ranges
3. `COMMANDS_REQUIRING_PAYLOAD` (static Set, lines 188-222) requires manual maintenance — new commands without updating the set pass without payload validation
4. A payload with all fields set to `null` passes if the field is marked optional

**Fix:** Make the switch exhaustive via `never` type in default case. Add field-level validation (consider Zod or io-ts). Auto-generate guards from type definitions.

---

## HIGH — Fix Before Submission

### H1: Inconsistent Error Handling

The codebase uses 4+ different error handling patterns without a clear strategy:

| Pattern | Example | Problem |
|---------|---------|---------|
| **Throw** | `chatDiagnosticsService.ts` throws when context missing | Caller must try/catch |
| **Return null/false** | `chatSessionService.ts:88-100` catches errors → returns `false` | Caller can't distinguish error from "not found" |
| **Silent catch** | `workspaceDetectionService.ts:369-447` — `.catch()` without handling | Errors vanish silently |
| **Fire-and-forget** | `extension.ts:64` — `void connect().catch(log)` | User gets no indication of failure |
| **Catch-all → null** | `artemisApi.ts:144-163` — `getLatestPendingSubmission` catches ALL errors → return null | 403 Forbidden, 500 Server Error, network timeout — all become "no submission found" |

**Affected files:**
- `iris/chatSessionService.ts:88-100` — error → false (swallowed)
- `iris/chatMessageService.ts:211-215` — error → undefined (indistinguishable from disabled feature)
- `iris/chatSessionService.ts:318-332` — fire-and-forget `.catch(log)`, state silently corrupted on failure
- `iris/chatDiagnosticsService.ts:112-183` — some methods throw, others return strings with missing data
- `workspace/workspaceDetectionService.ts:376-396` — nested promise chains burying errors
- `exerciseDataLoader.ts:22-45` — swallows all errors, returns incomplete data without indication
- `artemisApi.ts:387-393` — `Promise.all` with per-item `.catch()` → empty messages, no error visible

**Fix:** Adopt a consistent pattern. Recommendation: use a `Result<T, E>` type at service boundaries. Throw only for programmer errors. Return explicit error states for expected failures.

---

### H2: Missing Disposal / Resource Cleanup

VS Code extensions must dispose all resources. Several services leak event listeners, timers, or subscriptions:

| File | Issue |
|------|-------|
| `services/telemetry/recording/sessionRecorder.ts` | **Debounce timers `_selectionDebounceTimer` and `_visibleRangeDebounceTimer` are NOT cleared in `endSession()`** — can fire after session ends, calling `_record()` on disposed recorder |
| `services/workspace/fileMonitorService.ts:40-90` | `_fileUpdateTimer` set at line 82; if `dispose()` called before initialization completes, timer leaks |
| `services/iris/chatSessionService.ts` | Holds references to Iris WebSocket client but **doesn't implement `vscode.Disposable`** |
| `services/iris/chatMessageService.ts` | Creates listeners but has no `dispose()` method |
| `services/iris/contextStore.ts:137-140` | `_onDidChangeActiveContext` emitter disposed only if explicitly invoked |
| `services/workspace/noAiDetectionService.ts:83-117` | `_setupFileWatcher()` can be called multiple times — old listener remains while new one is created |
| `services/websocket/websocketStatusBar.ts:62-63` | `_reconnectHideTimeout` not cleared on config change or dispose |
| `controller/commands/repositoryCommands.ts:51-65` | `dispose()` clears listeners but `clonedRepositories` Map and `currentRepoContext` are never cleared |

**Fix:** Implement `vscode.Disposable` on all services with listeners/timers. Clear all timers in both `dispose()` and `endSession()`.

---

### H3: Test Coverage ~30%

Only ~12 of ~65 service modules have unit tests. Major gaps:

| Module | Files Without Tests | Risk |
|--------|-------------------|------|
| **Telemetry orchestration** | `telemetryManager.ts` | Core struggle detection flow untested |
| **Intervention** | `interventionService.ts` | User-facing intervention logic untested |
| **API client** | `artemisApi.ts` | Network boundary with no unit tests |
| **Git operations** | `gitService.ts` | File system operations untested |
| **Caching** | `courseDataCache.ts` | Cache invalidation logic untested |
| **Domain parsers** | `auth.ts`, `build.ts`, `iris.ts` | Data integrity at parsing boundary untested |
| **Controllers** | `viewActionService.ts`, `viewRouter.ts`, `exerciseDataLoader.ts` | Orchestration logic untested |
| **Providers** | `buildErrorCodeLensProvider.ts`, `chatViewStatePresenter.ts`, `baseWebviewProvider.ts` | UI integration untested |
| **UI Services** | `buildDiagnosticsService.ts`, `exerciseOpeningService.ts`, `fullscreenPanelManager.ts`, `startPageResolver.ts`, `viewInitDataService.ts` | All untested |

**Struggle detection test gaps:**
- No tests for paper-validated EQ thresholds (Jadud 2006 specific values)
- No tests for intervention state transitions (dismiss → new struggle → re-intervene?)
- No tests for rate-limiting (multiple struggles within cooldown period)
- No tests for confidence level assertions (only boolean `detectedStruggle` checked, not `eqConfidence`)
- No tests for `recommendedAction` correctness (EQ → action mapping)
- Scenario files not version-controlled with tests — `if (scenarios.length === 0) { this.skip(); }` silently skips

**Existing test issues:**
- `noAiDetectionService.test.ts:82` — hardcoded `setTimeout(resolve, 100)` → flaky on slow CI
- `webViewMessageHandler.test.ts:52-100` — 20+ stubs per test, tests verify stubs not real behavior
- `contextStore.test.ts:113` — explicit timeout increase suggests timing issues
- `struggleDetection.test.ts` — 30-120 second timeouts suggest tests are slow

---

### H4: Race Conditions in Telemetry Layer

Three identified race conditions in the event-driven telemetry pipeline:

**1. Session switch vs. trigger firing:**
`boundaryTriggerEmitter.ts` — Idle timer can fire while session is switching. The trigger event from old session gets processed in context of new session because `_activeExerciseId` on TelemetryManager has already changed. Cooldown mitigates but doesn't eliminate.

**2. EQ read after reset:**
`telemetryManager.ts:374` — `_evaluateAndIntervene` reads `_eqEngine.getCurrentEQ()`, but between trigger emission and handler execution, the EQ engine may have been reset for a new session. Result: trigger from session A reads EQ from session B.

**3. Recording after session end:**
`sessionRecorder.ts` — `_isRecording` flag checked at handler entry, but can change mid-handler. Debounce timers not cleared in `endSession()` can fire and call `_record()` on disposed recorder.

**Fix:** Pass `exerciseId`/`sessionId` as parameters in trigger events. Validate session identity before processing. Clear all debounce timers on session end.

---

### H5: Webview — Extreme Prop Drilling

**ParticipationActions.tsx** receives **30+ props** including 13+ callback handlers (onStart, onSubmit, onSync, onClone, onOpenRepository, onPullChanges, etc.).

**ExerciseDetailView.tsx:336-396** creates 13 inline arrow functions as props:
```tsx
<ParticipationActions
  onStart={() => postCommand(WebviewCmd.StartExercise)}
  onSubmit={() => postCommand(WebviewCmd.SubmitExercise)}
  onSync={() => postCommand(WebviewCmd.SyncExercise)}
  onClone={() => postCommand(WebviewCmd.CloneExercise)}
  // ... 9 more inline callbacks
/>
```

All state mutations thread through separate callback props instead of children accessing store actions directly.

**Fix:** Use Zustand store selectors in child components. Extract command dispatch to a custom hook (`useExerciseCommands`).

---

## MEDIUM — Maintainability & Quality

### M1: Barrel Export Bloat

**`telemetry/index.ts`** — 16 re-exports including all internal implementations:
```typescript
export { ErrorQuotientEngine } from './metrics/errorQuotientEngine';
export { BoundaryTriggerEmitter } from './eventPipeline/boundaryTriggerEmitter';
export { AdaptiveCadence } from './intervention/adaptiveCadence';
// ... 13 more
```
Consumers can import any internal component. No clear public API boundary.

**`types/index.ts`** — Re-exports entire domain module (458 lines) + all shared types via `export *`. Any type change propagates to all importers.

**`workspace/index.ts`** — 13 exports from 4 different internal modules.

**Fix:** Only export the public facade (e.g., only `TelemetryManager` from telemetry). Internal types should be imported directly when needed.

---

### M2: Magic Numbers in Telemetry Layer

| Value | File | Line | Issue |
|-------|------|------|-------|
| `0.85` | `interventionFilter.ts` | 85 | Severe EQ override threshold — no named constant, no paper reference |
| `10240` | `sessionRecorder.ts` | 63 | Max terminal output chars — unnamed |
| `200`ms | `sessionRecorder.ts` | 200 | Selection debounce delay — no rationale |
| `300`ms | `sessionRecorder.ts` | 408, 420 | Visible range debounce — no rationale |
| `50` | `eventCollectors.ts` | 100 | Error family truncation length — unnamed |
| `5000`ms | `storageWriter.ts` | 15 | Flush interval — engineering choice, named but undocumented |

Most telemetry constants are properly named and cited (EQ weights, trigger thresholds). These are the remaining gaps.

---

### M3: Duplicated Logic

| Pattern | File 1 | File 2 | Description |
|---------|--------|--------|-------------|
| `_shouldDedup()` | `errorQuotientEngine.ts:164-192` | `compileEquivalentEmitter.ts:199-231` | Identical snapshot deduplication logic |
| `getErrorFamily()` | `compileEquivalentEmitter.ts:274-278` | `snapshotReconstructor.ts:25-29` | Identical error family extraction |
| Semester parsing | `useCourseListStore.ts:34-62` | `useCourseDetailStore.ts` | Same parsing logic in both stores |
| Debounce+clear pattern | `boundaryTriggerEmitter.ts:120-142` | `sessionRecorder.ts:400-421` | Similar timer management repeated |
| Message type routing | `useExtensionMessage` hook | Used 5+ times with similar switch/case | Duplicated message handling |

**Fix:** Extract shared utilities: `shouldDeduplicateSnapshot()`, `getErrorFamily()`, `parseSemester()`, `DebouncedTimer` class.

---

### M4: Fat Components (Frontend)

| File | Lines | Issue |
|------|-------|-------|
| `ExerciseDetailView.tsx` | 462 | 20+ local variable declarations, complex time calculation inline (25 lines), test case filtering inline, `[...array].sort()` without memo |
| `IrisChatView.tsx` | 429 | DOM click handlers, context switching animations, extension message routing (lines 67-145), state persistence — 3 useState + 5 message handlers |
| `ContextSelector.tsx` | 387 | 7 useState hooks, dropdown state, search filtering, conditional rendering with 4+ branches, click-outside handler |
| `CourseListView.tsx` | 352 | Filter state management, semester parsing, rendering all mixed |
| `ParticipationActions.tsx` | 350 | 5 conditional render functions, 30+ props, deeply nested conditional JSX (lines 222-309) |

---

### M5: Missing Memoization (Frontend)

Only **5 instances of `useMemo`** across ~7000 LOC of webview code.

| File | Issue | Impact |
|------|-------|--------|
| `ExerciseDetailView.tsx:167-171` | `[...array].sort(...)[0]` executed **twice** per render | O(n log n) per render |
| `ExerciseDetailView.tsx:177-184` | `testFeedbacks.filter()` + `testCases.map()` every render | Recalculation on every render |
| `CourseDetailView.tsx:182-183` | `filteredExercises()` and `sortedExams()` store getters called every render | Not memoized in store |
| `useCourseListStore.ts:143-244` | `filteredCourses()` — 100+ line derived function | Runs on every access |

---

### M6: Store Bloat (Frontend)

| Store | State Fields | Issue |
|-------|-------------|-------|
| `useChatStore` | 16 | Chat messages + streaming state + context selection + UI toggles + connection status. `setIrisState()` is god method accepting generic object. |
| `useExerciseDetailStore` | 13 | Exercise data + submission processing + repo status + cloned notice + dirty pages. `updateBuildStatus()` is 123+ lines. |
| `useCourseDetailStore` | 12 | Course data + filter state + sort state. `filteredExercises()` contains 143+ lines of complex logic. |
| `useCourseListStore` | 8 | Data + filters + sort. Semester parsing logic duplicated. |

---

### M7: API Response Types Too Broad

`shared/types/apiResponses.ts` contains **18 instances** of `[key: string]: unknown` catch-all:
```typescript
export interface CourseDashboardResponse {
    courses?: CourseDashboardEntry[];
    [key: string]: unknown;  // Accepts anything
}
```

This makes type narrowing downstream useless — any field access requires runtime checks.

**Fix:** Remove catch-all. Use strict interfaces. If extensibility is needed, add explicit `unknownFields?: Record<string, unknown>`.

---

### M8: Type Duplication — 3 Exercise Representations

Three separate representations of "Exercise":
1. `ExerciseDetail` (apiResponses.ts:41-58) — API response, `type?: string`
2. `Exercise` (domainTypes.ts:27-35) — Message contract shape
3. `ArtemisExercise` (domain/core.ts:97-127) — Domain model, `type: 'programming' | 'modeling' | ...`

Conversion happens manually at 3+ call sites (navigationCommands.ts:160, exerciseOpeningService.ts:47, irisCommands.ts:65) without validation. If API returns `type: null`, the cast to specific union succeeds silently.

**Fix:** Single canonical `Exercise` type with discriminated union for type. Validate at API boundary only.

---

### M9: Temporal Coupling

Methods with undocumented order dependencies that fail silently if called out of sequence:

| File | Methods | Required Order |
|------|---------|---------------|
| `chatSessionService.ts:306-332` | `resetSession()` → `createSession()` → `postMessage()` → `createNewSession()` | Not enforced; wrong order → state corruption |
| `authFlowHandler.ts:52-93` | `checkServerUrlChange()` must precede `checkExistingAuthentication()` | Not enforced; stale credentials if reversed |
| `contextStore.ts:244-258` | `upsertExercise()` → `recalculatePriorities()` → `trimHistory()` → `saveState()` | Implicit order, documented but not enforced |
| `chatContextManager.ts:85-130` | `registerExercise/Course` → `setActiveContext` → `resetSessionForContextChange` | Documented but not enforced |
| `workspaceDetectionService.ts:362-431` | Registry must be populated before detection | Silently returns undefined if not |

---

### M10: Accessibility Gaps (Frontend)

- Hamburger menu button lacks `aria-expanded`; side menu is `<div>` not `<nav>`
- Search input in dropdown lacks `aria-label`
- SVG icons not marked `aria-hidden`
- Dismiss buttons use `x` symbol without `aria-label`
- "More options" button uses text symbol, dropdown items lack ARIA attributes
- Only **36 ARIA attributes** across ~7000 LOC webview code

---

### M11: Provider Handles Business Logic

Providers should only manage webview lifecycle and delegate to services. Instead:

| File | Lines | Issue |
|------|-------|-------|
| `artemisWebviewProvider.ts` | 262-285 | `openExerciseDetails()` orchestrates fetch → state → render → telemetry → WebSocket check inline |
| `artemisWebviewProvider.ts` | 306-335 | `showDashboard()` contains business logic: fetch courses, set state, render, background archive check with promise chaining |
| `baseWebviewProvider.ts` | 73-95 | Message queue deduplication in provider base class, not in a message service |
| `chatViewStatePresenter.ts` | 12-44 | Mixes snapshot serialization with posting messages to webview |

---

### M12: Missing Input Validation on Webview Messages

| File | Lines | Issue |
|------|-------|-------|
| `chatWebviewProvider.ts` | 347-430 | `_handleCommand()` uses `getPayload()` which throws on missing payload, but no field-level validation. E.g., line 359 extracts `{ context, itemId, itemName }` and only checks `typeof itemId === 'number'` **after** extraction. |
| `irisCommands.ts` | 18-74 | `handleAskIrisAboutExercise()` extracts 6 fields, checks only `exerciseId` is defined. No validation of `exerciseTitle`, `courseId`, or optional field types. |
| `navigationCommands.ts` | 55-69 | `handleOpenExamInBrowser()` extracts `{ courseId, examId }` — null-check on `serverUrl` but **not** on payload fields. |

---

### M13: API Client Error Handling & Validation Gaps

| File | Lines | Issue |
|------|-------|-------|
| `artemisApi.ts` | 76-95 | Response body parsing is lenient: attempts JSON, falls back to text, then concatenates. No validation that error messages are safe strings (could be HTML from 5xx). |
| `artemisApi.ts` | 144-163 | `getLatestPendingSubmission()` catches ALL errors → return null. Network error, 403, 500 all treated as "no submission". |
| `artemisApi.ts` | 170-178 | `getLatestResultWithFeedbacks()` checks response is not null/'null' string, but no validation that parsed JSON has required `feedbacks` field. |
| `artemisApi.ts` | 407-463 | `sendChatMessage()` retries on 400 (resend without uncommittedFiles). No validation that retry will succeed for different reasons; only one retry, no backoff. |

---

### M14: Inconsistent Message Dispatch Patterns

- `artemisWebviewProvider` correctly delegates to `WebViewMessageHandler` (map-based dispatch)
- `chatWebviewProvider` **bypasses** it with a local switch statement (lines 347-430), then has a **nested switch** for utility commands (lines 432-446)
- Same dispatch pattern implemented differently in two providers

---

### M15: Long Methods in Telemetry Layer

| File | Method | Lines | Issue |
|------|--------|-------|-------|
| `recording/sessionRecorder.ts` | `_registerEventListeners` | 133 lines | 11+ listener registrations with debouncing logic mixed in |
| `telemetryManager.ts` | `_setupEventHandlers` | 79 lines | 11+ event listener registrations |
| `telemetryManager.ts` | `_buildDebugTooltip` | 31 lines | Multi-line string building |

**Fix:** Extract each listener registration into a focused method: `_registerTextChangeListener()`, `_registerSaveListener()`, etc.

---

### M16: Primitive Obsession in Telemetry Layer

- EQ score passed as raw `number` (0.0-1.0 range). At display time, multiplied by 100 for percentage. No branded type to prevent mixing 0-1 and 0-100 ranges.
- Threshold checks use bare numbers (`0.45`, `0.8`) without named constants.
- `sessionRecorder.ts:270` — `triggerType as 'execution-error' | 'multiline-paste' | ...` — redundant type assertion, weak typing. Should come from `TriggerType` type.

---

### M17: Complex Conditionals

| File | Lines | Issue |
|------|-------|-------|
| `interventionFilter.ts` | 66-96 | `shouldInterveneEQ` has 5 sequential guards. Could extract to policy object pattern. |
| `compileEquivalentEmitter.ts` | 199-231 | `_shouldAddSnapshot` checks 5 conditions in nested if/else. Extract named boolean helpers. |
| `telemetryManager.ts` | 513-529 | `_getEQEmoji` has 6 chained if statements. Better as threshold lookup Map. |
| `inactivityService.ts` | 150-171 | `_classifyPattern` has 5 nested if/else for state classification. |

---

### M18: Mapper Bloat and Runtime Error Risk

Only ONE mapper exists (`toCourseDetailData` in `domainMappers.ts`), and it's unsafe:

```typescript
export function toCourseDetailData(course: CourseDashboardCourse, opts?) {
    return {
        course: {
            ...course,
            id: course.id!,           // Non-null assertion — fails silently if null
            title: course.title || 'Untitled Course',  // Fallback without validation
        } as CourseDetailData['course'],  // Type cast bypasses safety
    };
}
```

No mappers exist for Exercise conversion, ErrorResult, or SubmissionSummary. WebSocket handlers receive raw JSON with no shape validation before use.

---

## LOW — Nice to Have

| Issue | Location | Description |
|-------|----------|-------------|
| Hardcoded UI strings | `websocketStatusBar.ts:226,249,254` | `'WS Connected'`, `'WS Disconnected'` not localizable |
| Hardcoded filenames | `noAiDetectionService.ts:104` | `'**/.noai'` glob not configurable |
| Hardcoded allowed extensions | `workspaceFileChecker.ts:13-44` | Entire whitelist hardcoded |
| Hardcoded reconnect timings | `artemisWebsocketService.ts:56-61` | Delays, timeouts, heartbeat interval not configurable |
| Hardcoded monitoring intervals | `fileMonitorService.ts:82-85` | 5s periodic, 2s throttle hardcoded |
| Inconsistent store init | Webview stores | Some use `devtools()`, others use factory pattern |
| Test-only methods in production | `inactivityService.ts:220-230` | `_testRecordActivity()` in production code |
| Naming asymmetry | `inactivityService.ts` | `_recordActivity()` vs `_recordWeakActivity()` — no `_recordStrongActivity()` |
| Mutation of cached data | `courseDataCache.ts:73-84` | `injectEntry()` mutates `_data.courses` directly |
| Callback ID fragility | `websocketStatusBar.ts:104-108` | `cb_${++counter}` for callback IDs |
| Missing error boundaries | Webview | Only one ErrorBoundary at root; IrisChat or ExerciseDetail crash → white screen |
| `@ts-expect-error` | `MessageBubble.tsx:87` | Type safety gap for streamdown import |

---

## Cross-Model Independent Review (Opus / Sonnet / Haiku)

Three independent AI reviews (Claude Opus 4.6, Sonnet 4.6, Haiku 4.5) were run against the codebase with access to the original report above. Their mandate was to **challenge the original report, find missed issues, and re-prioritize for thesis success**. Below is the consolidated synthesis.

### Severity Re-Assessment of Original Report

All three models agree that the original report overstates several architectural issues as "CRITICAL" when they are not thesis-relevant:

| Original Finding | Original Severity | Consensus Re-Assessment | Rationale |
|-----------------|-------------------|------------------------|-----------|
| C1: God Classes | CRITICAL | **MEDIUM** | Large but cohesive. TelemetryManager as single orchestrator actually aids thesis readability. No examiner penalizes file length. |
| C2: No DI (18x `new`) | CRITICAL | **MEDIUM** | Real testability concern, but GitService is stateless (no state inconsistency). No thesis examiner cares about DI containers. |
| C4: Shotgun Surgery (ActiveContext) | CRITICAL | **LOW** | Normal for a core domain type. Not changing during thesis period. |
| C5: Type Guards `default: return true` | CRITICAL | **LOW** | Webview is controlled internal component, not external attacker. Defensible for extensibility. |
| H4: Race Conditions in Telemetry | HIGH | **MEDIUM** (partially incorrect) | Opus points out Node.js is single-threaded — items #1 and #2 from original report are theoretically impossible via event loop semantics. The *real* cross-exercise contamination vector is WebSocket results (see NEW-1 below). |
| H2: SessionRecorder Debounce Timers | HIGH | **LOW** (for data integrity) | Opus verified: `_isRecording` guard at lines 406/418 prevents stale recordings. Timer leak is a resource issue, not a data integrity issue. |
| H3: Test Coverage ~30% | HIGH | **HIGH** (but better than stated) | Report missed substantial React/Vitest suite and scenario-based confusion matrix tests. Real gaps: InterventionFilter, InterventionService, TelemetryManager orchestration, end-to-end flow. |

### New Correctness Bugs Found (Not in Original Report)

All three models independently discovered issues the original report missed. These are ordered by thesis impact.

#### NEW-1: Subtle Hint Bypasses ALL InterventionFilter Guardrails (CRITICAL)
**Found by:** Opus, Sonnet, Haiku (all three independently)
**File:** `telemetryManager.ts:386-391`

```typescript
if (!decision.shouldIntervene) {
    // Still show subtle hint if warranted
    if (decision.level === 'subtle') {
        this._interventionService.showSubtleHintEQ(decision);
    }
    return;
}
```

When `shouldIntervene === false` but `level === 'subtle'`, the subtle hint fires anyway. This means:
- **5-minute exercise warmup** — bypassed for subtle hints
- **2-minute progress grace period** — bypassed
- **3 interventions per session limit** — bypassed (subtle hints don't call `_recordIntervention()`, so `sessionInterventionCount` is never incremented)
- **5-minute cooldown** — bypassed (`_canIntervene()` never called)
- **Adaptive cadence dismiss tracking** — bypassed

Additionally, `showSubtleHintEQ` fires `_onDidShowIntervention`, which SessionRecorder records as `action='shown'` with `shouldIntervene=false`. This contaminates intervention count data in recordings.

**Thesis impact:** If evaluation counts intervention events, all subtle hints appear as "shown" interventions that bypassed guardrails. Intervention frequency analysis and guardrail effectiveness claims are wrong for the subtle level. A student can receive **unlimited** subtle hints per session.

#### NEW-2: Cross-Exercise Build Result Contamination via WebSocket (HIGH)
**Found by:** Opus
**File:** `telemetryManager.ts:181-212` (`onNewResult`)

The code itself documents the issue at line 188:
```
// ResultDTO has no exerciseId field, so we can't filter by exercise directly.
```

The `onNewResult` handler has no exercise-scoping guard. WebSocket topic `/user/topic/newResults` delivers results for ALL participations. If a student submits exercise A, switches to exercise B, and exercise A's build completes, that result is fed into exercise B's EQ engine.

**Thesis impact:** False-positive struggle detection. A compile error from exercise A appearing in exercise B's EQ creates phantom struggle events.

#### NEW-3: `classifyBuildResult` Returns `'success'` for Genuinely Failed Builds (HIGH)
**Found by:** Sonnet
**File:** `compileEquivalentEmitter.ts:242-257`

Classification logic:
1. `buildFailed === true` → `compiler-error`
2. `passedTestCaseCount < testCaseCount` → `test-failure`
3. Otherwise → `success`

When `submission.buildFailed` is `undefined` (field omitted by Artemis server) AND test counts are absent, a genuinely failed build is classified as `'success'`. The `result.successful` field exists and is parsed but is **never consulted** by `classifyBuildResult`.

**Thesis impact:** EQ scores systematically underestimated for exercise types where `buildFailed` is not explicitly set.

#### NEW-4: InterventionFilter `_lastProgressTime` Not Reset on Session Start (MEDIUM-HIGH)
**Found by:** Opus, Haiku
**File:** `interventionFilter.ts:99-103`

`onSessionStart()` resets `_exerciseStartTime` but NOT `_lastProgressTime`. If a student makes progress at minute 3 of exercise A, switches to exercise B within 2 minutes, the progress grace period from exercise A silently suppresses the first intervention in exercise B.

**Fix:** Add `this._lastProgressTime = 0;` to `onSessionStart()`.

#### NEW-5: Cursor Movement Fully Re-Arms Idle Timer — Stuck Students Never Trigger Idle (MEDIUM)
**Found by:** Sonnet
**File:** `inactivityService.ts:120-128`

`_recordWeakActivity()` fires `_onDidResumeActivity` on cursor movement after idle period. This re-arms the idle timer in BoundaryTriggerEmitter. A student who is confused and slowly scrolling through code (cursor-only, no edits) will **never** trigger the idle intervention because each cursor movement resets the 30s idle timer.

**Thesis impact:** Systematic false-negative for idle trigger. If thesis reports idle trigger rates, this behavior must be disclosed. Per Pu et al. 2025, cursor/caret movement should not suppress idle detection for "thinking" students.

#### NEW-6: `_hasEnoughExerciseTime()` Comment Says "Conservative" but Code Is Permissive (MEDIUM)
**Found by:** Sonnet
**File:** `interventionFilter.ts:39-47`

When `_exerciseStartTime === undefined`, the comment says "be more conservative" but the code returns `true`, completely bypassing the 5-minute minimum exercise time gate. If `onSessionStart` was never called (or a trigger fires before it completes), interventions fire immediately.

#### NEW-7: `ThrashingDetector` Output Never Used in Any Decision (MEDIUM for thesis)
**Found by:** Sonnet
**File:** `thrashingDetector.ts`

`ThrashingDetector` is fully wired (`_sessionServices`, event listeners, ring buffer, score calculation), but `getThrashingScore()` is only consumed by the debug status bar tooltip and the debug dialog. It has **zero influence on any intervention decision**. A thesis reviewer asking "what does thrashing detection do?" would find it does nothing.

**Options:** Integrate it into decisions, remove it, or explicitly document it as "instrumentation-only for future work."

#### NEW-8: `DiagnosticPersistenceService.onSessionStart` Is a No-Op — Stale Diagnostics Leak (MEDIUM)
**Found by:** Sonnet
**File:** `diagnosticPersistenceService.ts:217-220`

`onSessionStart` is explicitly a no-op (`/* no-op: this service resets on session end */`). If exercise switching happens without clean `endExerciseSession` → `startExerciseSession` sequencing, stale diagnostics from exercise A remain tracked and pollute exercise B's diagnostic events, potentially triggering premature "all errors resolved" → `recordProgress()`.

#### NEW-9: 500ms LS Delay May Be Insufficient for Java Exercises (LOW-MEDIUM)
**Found by:** Opus
**File:** `compileEquivalentEmitter.ts:62-74`

The 500ms delay for Language Server diagnostic stabilization is an engineering constant. Java (Eclipse JDT LS, which Artemis primarily uses) can take 1-5 seconds for large projects. Snapshot created after 500ms may capture stale diagnostics, leading to incorrect EQ scores for Java exercises.

**Thesis impact:** Worth acknowledging in limitations section.

#### NEW-10: `deactivate()` Fires SessionRecorder.endSession() as Fire-and-Forget (LOW-MEDIUM)
**Found by:** Opus
**File:** `extension.ts:251-260`

`void activeSessionRecorder.endSession()` — async but called with `void`. If final flush fails, recording data silently lost. During evaluation, closing VS Code loses the tail end of session recordings.

### Model Agreement Matrix

| Finding | Opus | Sonnet | Haiku |
|---------|------|--------|-------|
| NEW-1: Subtle hint bypasses filters | Found | Found | Found |
| NEW-2: Cross-exercise WebSocket contamination | Found | — | — |
| NEW-3: classifyBuildResult silent success | — | Found | — |
| NEW-4: _lastProgressTime not reset | Found | — | Found |
| NEW-5: Cursor re-arms idle timer | — | Found | — |
| NEW-6: "Conservative" comment is permissive | — | Found | — |
| NEW-7: ThrashingDetector unused | — | Found | — |
| NEW-8: DiagnosticPersistence no-op leak | — | Found | — |
| NEW-9: 500ms LS delay for Java | Found | — | — |
| NEW-10: deactivate() fire-and-forget | Found | — | — |
| C1/C2/C4/C5 overstated | All three agree | | |
| H4 race conditions incorrect (single-threaded) | Found | Partially | — |
| Original C3 confirmed critical | All three agree | | |

### Consolidated Priority for Thesis

**Must fix (affects evaluation data correctness):**
1. **NEW-1** — Subtle hint bypass (all 3 models agree, 3-line fix)
2. **C3** (original) — Duplicated EQ thresholds (all 3 confirm, delegate to DecisionEngine)
3. **NEW-2** — Cross-exercise build result contamination (add exerciseId guard or document as limitation)
4. **NEW-3** — `classifyBuildResult` silent success (check `result.successful` as fallback)
5. **NEW-4** — `_lastProgressTime` not reset (one-line fix)

**Should fix or disclose in thesis:**
6. **NEW-5** — Cursor movement suppresses idle trigger (disclose or change weak activity behavior)
7. **NEW-6** — "Conservative" fallback is permissive (fix comment or fix logic)
8. **NEW-7** — ThrashingDetector unused (document or remove)
9. **NEW-8** — DiagnosticPersistence no-op on session start (add reset logic)

**Acknowledge in limitations:**
10. **NEW-9** — 500ms LS delay for Java exercises
11. **NEW-10** — Session recording lost on VS Code close

---

## Strengths

What the codebase does well:

- **ESLint clean** — 0 errors, 0 warnings across entire codebase
- **Paper-validated constants properly named and cited** — ErrorQuotientEngine, AdaptiveCadence, BoundaryTriggerEmitter all reference source papers with page numbers
- **Excellent JSDoc documentation** — Complex functions documented with paper references and design rationale
- **SessionResettable pattern** — Elegant lifecycle management across 10+ services
- **Discriminated unions for message contracts** — ExtensionMessages and WebviewCommands use proper tagged unions
- **Disposable pattern** — Generally correct (with the noted exceptions)
- **Clear directory structure** — extension/webview/shared separation is clean and logical
- **Strong separation in telemetry layer** — Each algorithm component (EQ, triggers, decision, cadence) is its own focused module
- **Comprehensive struggle detection scenarios** — YAML-based test scenarios with evaluation engine
- **Design decision documentation** — Engineering choices explicitly marked as paper-validated vs. adapted vs. engineering-only
