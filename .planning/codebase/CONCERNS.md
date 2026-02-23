# Codebase Concerns

**Analysis Date:** 2026-02-23

## Tech Debt

**Extensive Use of Type `any` Throughout Codebase:**
- Issue: 250+ instances of `any`, `any[]`, and type-unsafe patterns scattered across the codebase. Critical areas include API response handling, UI state management, and data transformation.
- Files: `src/views/app/appStateManager.ts` (uses `any` for coursesData, currentCourseData, currentExerciseData), `src/views/courseList/courseListView.ts` (generateHtml parameters), `src/api/artemisApi.ts`, `src/views/exerciseDetail/exerciseDetailView.ts` (exerciseData parameter)
- Impact: Type checking cannot catch contract violations when API responses change shape. Refactoring is error-prone. IDE autocomplete is degraded.
- Fix approach: Incrementally replace with proper TypeScript interfaces. Start with API responses in `src/types/` (already has some patterns), then propagate through view layers. Use strict tsconfig settings to enforce.

**Disconnected WebSocket Reconnection Logic:**
- Issue: 33 instances of `setTimeout` and `setInterval` scattered across services. WebSocket service has 20+ reconnection references including manual state tracking (_isConnecting, _isDisconnecting, _connectionGaveUp). Difficult to coordinate and test.
- Files: `src/services/artemisWebsocketService.ts` (exponential backoff with manual timing), `src/extension.ts` (500ms and 1000ms delays on activation), `src/services/telemetry/interventionService.ts`, `src/services/telemetry/eventPipeline/compileEquivalentEmitter.ts`
- Impact: Race conditions possible during rapid auth state changes. Reconnection delays may stack or conflict. Hard to test timing-dependent behavior without mocking timers everywhere.
- Fix approach: Create a dedicated TimingService or use RxJS operators (debounceTime, timeout) to centralize timing logic. Replace setTimeout calls with method that can be mocked in tests.

**Large Monolithic View Files:**
- Issue: Several view files exceed 1400 lines, mixing HTML generation, state management, and business logic.
- Files: `src/views/examExerciseDetail/examExerciseDetailView.ts` (1487 lines), `src/views/exerciseDetail/exerciseDetailView.ts` (1475 lines), `src/views/irisChat/irisChatView.ts` (1106 lines)
- Impact: Difficult to test individual features. Changes to one aspect (e.g., styling) require full file recompilation. High cognitive load for maintainers.
- Fix approach: Extract HTML template generation into separate classes. Move state transitions to dedicated managers. Break into logical modules (TemplateRenderer, StateHandler, DataTransformer).

**Untyped Event Handler Callbacks:**
- Issue: ConnectionStateCallbacks stored in Map with generic callback functions. WebSocketMessageHandler interface uses loose contracts.
- Files: `src/services/artemisWebsocketService.ts` (line 70), `src/types/index.ts`
- Impact: Callers can pass functions with incompatible signatures. Memory leaks possible if unsubscribe function not called.
- Fix approach: Create typed callback managers with guaranteed cleanup. Use EventEmitter pattern instead of raw callback maps.

## Known Bugs

**WebSocket Reconnection May Not Recover After Manual Disconnection:**
- Symptoms: After user logs out (disconnect) and logs back in, WebSocket may not automatically reconnect even though session is valid.
- Files: `src/extension.ts` (lines 52-65, 81-91), `src/services/artemisWebsocketService.ts` (line 388-395)
- Trigger: 1) User logs in → WebSocket connects. 2) User changes server URL. 3) User logs in again → WebSocket doesn't auto-reconnect OR takes 10+ seconds.
- Workaround: User can manually run "Connect to Artemis WebSocket" command.
- Root cause: State reset on disconnect clears `_wasConnectedOnce`, so reconnect logic treats it like initial connection. Delays in extension.ts (500ms/1000ms) can conflict with async auth verification.

**Silent Failure When PlantUML Render Fails:**
- Symptoms: PlantUML diagram shows nothing in webview, user must check developer console for error.
- Files: `src/extension.ts` (lines 493-555), error handling swallows details
- Trigger: Server returns invalid SVG or network timeout during render.
- Workaround: None — user must retry manually.
- Root cause: Promise rejection in `artemisApiService.renderPlantUmlToSvg()` is caught but only generic message shown.

**Memory Leak Risk in WebSocket Message Handler Registration:**
- Symptoms: Long sessions with frequent subscriptions/unsubscriptions may accumulate orphaned callbacks, increasing memory usage.
- Files: `src/services/artemisWebsocketService.ts` (lines 104-117 onConnectionStateChange), `src/provider/artemisWebviewProvider.ts` (line 99)
- Trigger: Webview provider registers handler but if connection state changes rapidly or provider is hidden/shown repeatedly, callbacks may not be unsubscribed properly.
- Workaround: Manually call the returned unsubscribe function (pattern is correct but easy to forget).
- Root cause: Callback accumulation relies on caller discipline; no timeout or forced cleanup.

**Race Condition in Auth State Updates:**
- Symptoms: During rapid login/logout/login cycles, UI context may be out of sync with auth state, showing authenticated view when logged out or vice versa.
- Files: `src/extension.ts` (lines 49-100), `src/auth/auth.ts`
- Trigger: 1) User logs in. 2) Before WebSocket connects (500ms delay), user immediately logs out. 3) WebSocket still tries to connect with stale cookie.
- Workaround: Wait for stable state (UI feedback) before next action.
- Root cause: updateAuthContext sets context immediately but WebSocket connect is asynchronous without cancellation token.

## Security Considerations

**Cookie Stored in Memory with No Automatic Expiration:**
- Risk: If extension crashes or is forcefully closed, session cookie remains in memory. If someone gains access to VS Code process, they can extract cookie.
- Files: `src/auth/auth.ts` (lines with memoryCookie field)
- Current mitigation: Cookie is cleared on logout or error. Secrets storage (VS Code globalState) is used as primary store.
- Recommendations: Add timeout (e.g., clear memory cookie after 1 hour). Consider encrypting cookie at rest. Document security assumptions in README.

**Plaintext Server URL Configuration:**
- Risk: Server URL stored in VS Code settings can be read from `.vscode/settings.json` if repository is checked in.
- Files: `src/utils/constants.ts`, package.json configuration schema
- Current mitigation: Settings are per-user (usually in user-level config).
- Recommendations: Consider adding warning if user sets server URL in workspace-level settings. Document that server URL + login credentials form a complete credential set.

**JWT Token Handling on 401:**
- Risk: When 401 is received, token is cleared but user is asked to log in via modal. If this modal is ignored, subsequent requests will fail without clear feedback.
- Files: `src/api/artemisApi.ts` (lines 41-57)
- Current mitigation: Modal is shown, user can manually log in again.
- Recommendations: Add timeout to clear local auth state if user doesn't re-login within 5 minutes. Refresh token rotation if backend supports it.

**No Input Validation on Clone Path Configuration:**
- Risk: User can configure `artemis.defaultClonePath` to arbitrary paths including system directories.
- Files: `src/views/app/commands/repositoryCommands.ts` (uses defaultClonePath)
- Current mitigation: Clone operation may fail if path is invalid, but no upfront validation.
- Recommendations: Validate path on configuration change. Show warning if path is in restricted directory (e.g., /System, /bin).

## Performance Bottlenecks

**Synchronous HTML Generation with No Caching:**
- Problem: View files generate entire HTML strings on every state change. CSS files read from disk repeatedly.
- Files: `src/views/courseList/courseListView.ts` (generateHtml), `src/views/utils/cssLoader.ts`
- Cause: No caching of CSS or template fragments.
- Improvement path: Cache CSS reads at extension startup. Implement incremental HTML updates instead of full regeneration. Use virtual DOM pattern for large lists.

**Large View State Causes Full Webview Redraw:**
- Problem: When courseData is updated, entire HTML is regenerated and sent to webview, even if only one exercise status changed.
- Files: `src/views/exerciseDetail/exerciseDetailView.ts`, `src/provider/artemisWebviewProvider.ts`
- Cause: No differential update mechanism.
- Improvement path: Implement message-based updates from webview side (only update changed fields). Or use web components that handle their own state.

**Dashboard Load Time Linearly Scales with Number of Courses:**
- Problem: `getCoursesForDashboard()` fetches all courses and all exercises in each course. No pagination or lazy loading.
- Files: `src/api/artemisApi.ts` (line 110), `src/views/app/appStateManager.ts` (line 84)
- Cause: No filtering or pagination on API call.
- Improvement path: Add limit parameter to API calls. Implement infinite scroll. Fetch recent courses first, fetch archived courses on demand.

**Struggle Detection Telemetry Processing May Block UI:**
- Problem: `TelemetryManager` processes build diagnostics, calculates Error Quotient, and updates status bar synchronously.
- Files: `src/services/telemetry/telemetryManager.ts`, `src/services/telemetry/metrics/errorQuotientEngine.ts`
- Cause: No background processing or worker threads.
- Improvement path: Move EQ calculation to background worker or debounce updates. Update UI at 1Hz max rather than on every diagnostic change.

## Fragile Areas

**WebSocket Connection State Machine:**
- Files: `src/services/artemisWebsocketService.ts` (entire file, especially lines 200-260 reconnection logic)
- Why fragile: Complex state with multiple flags (_isConnecting, _isDisconnecting, _wasConnectedOnce, _connectionGaveUp). Hard to reason about transitions. No formal state machine (e.g., Redux/XState).
- Safe modification: Add unit tests for all state transitions. Create state diagram. Consider migrating to explicit state machine library.
- Test coverage: No tests for reconnection backoff edge cases. No tests for race conditions during concurrent connect/disconnect.

**Webview Message Routing:**
- Files: `src/views/app/webViewMessageHandler.ts` (routes all messages), `src/views/app/viewRouter.ts`
- Why fragile: All webview commands go through single message handler. Adding new command requires editing multiple files. Command names are string literals.
- Safe modification: Create type-safe command registry. Use typed messages instead of any.
- Test coverage: Limited E2E tests for message routing.

**Iris Chat Session Management:**
- Files: `src/services/irisSessionManager.ts`, `src/services/chatSessionService.ts`, `src/services/chatMessageService.ts`
- Why fragile: Multiple services manage different aspects of sessions (lifecycle, messages, context). Unclear ownership.
- Safe modification: Document dependencies between services. Create integration tests for session lifecycle (create → send → receive → close).
- Test coverage: Unit tests exist but integration tests are sparse.

**Data Transformation Pipeline for Exercise Details:**
- Files: `src/views/utils/exerciseDataTransformer.ts` (317 lines)
- Why fragile: Transforms API response into view format. Any API schema change breaks transformation.
- Safe modification: Add schema validation at transformation boundary. Use type-safe transformation libraries (e.g., Zod).
- Test coverage: Needs more test cases for edge cases (missing fields, null submissions, etc.).

**File Monitor Service Interaction with Build Results:**
- Files: `src/services/fileMonitorService.ts`, `src/services/telemetry/buildResultTracker.ts`
- Why fragile: Timing-dependent. File watch events can arrive before or after build results.
- Safe modification: Implement explicit ordering. Use event stream with buffering/flushing.
- Test coverage: No tests for timing-dependent interactions.

## Scaling Limits

**WebSocket Subscriptions Are Not Memory-Bounded:**
- Current capacity: No documented limit on number of active Iris sessions subscribed simultaneously.
- Limit: Each subscription holds a closure capturing onMessage callback. If user opens 100+ chat sessions and doesn't close them, memory grows unbounded.
- Scaling path: Implement subscription pooling. Add limit check before subscription (warn if > 10 active). Implement session timeout and auto-cleanup.

**Diagnostic Cache Has No Size Limit:**
- Current capacity: `DiagnosticPersistenceService` stores diagnostics indefinitely.
- Limit: In a workspace with 1000+ build failures accumulated over time, memory usage could become significant.
- Scaling path: Implement LRU eviction (keep only last 100 builds per exercise). Archive old diagnostics to disk.

**Course/Exercise List Rendering:**
- Current capacity: Dashboard works well with 20-50 courses.
- Limit: With 200+ courses, full HTML generation and webview rendering becomes slow.
- Scaling path: Implement virtual scrolling in webview. Paginate API responses.

## Dependencies at Risk

**@stomp/stompjs 7.2.1 and ws 8.19.0:**
- Risk: WebSocket library has sporadic issues with edge cases (connection drops, stale connections). STOMP client not actively maintained.
- Impact: If bugs surface in production, few alternatives without major refactor.
- Migration plan: Audit STOMP client for known issues. Consider migrating to native WebSocket + minimal STOMP polyfill if needed. Keep pinned versions updated.

**RxJS 7.8.2:**
- Risk: Heavy dependency introduced but not used consistently. Some code uses RxJS, other code uses Promise.
- Impact: Bundle size includes full RxJS library but only partial usage.
- Migration plan: Either embrace RxJS fully for all async operations, or remove and stick with Promises + async/await.

**esbuild 0.27.2:**
- Risk: Build tool is relatively young compared to webpack. Occasional breaking changes between minor versions.
- Impact: CI/CD may break after package update.
- Migration plan: Pin esbuild version in package-lock.json (already done). Test after any minor version update before deploying.

## Missing Critical Features

**No Offline Mode:**
- Problem: Extension requires constant Artemis server connectivity. If server is down or network is unavailable, extension shows error states and blocks work.
- Blocks: Users cannot work on exercises during network outages or server maintenance windows.
- Path: Cache course/exercise metadata locally. Allow viewing cached exercise details. Queue operations (submissions) for retry when network returns.

**No Consent Management UI for Data Collection:**
- Problem: `dataCollectionConsent` setting exists but no UI to manage it. User must edit settings.json manually.
- Blocks: Users cannot easily change data collection preferences. Compliance with GDPR/privacy regulations may be questionable.
- Path: Create dedicated view for consent management. Show clear description of what each level collects. Implement consent flow on first activation.

**No Search/Filter in Course List:**
- Problem: Users with 50+ courses must scroll through entire list.
- Blocks: Poor UX for large course numbers.
- Path: Add search field to course list view. Filter as user types.

## Test Coverage Gaps

**WebSocket Connection Lifecycle:**
- What's not tested: Full reconnection flow with multiple failures. Race conditions during concurrent connect/disconnect. Callback cleanup and memory leak scenarios.
- Files: `src/services/artemisWebsocketService.ts`
- Risk: Reconnection logic may have subtle bugs that only appear under stress (many rapid connect/disconnect cycles).
- Priority: High

**API Error Handling:**
- What's not tested: 500 errors, timeout scenarios, malformed JSON responses, rate limiting (429 status).
- Files: `src/api/artemisApi.ts`
- Risk: Error paths are rarely exercised. Users hitting errors get poor feedback.
- Priority: High

**Struggle Detection Decision Logic:**
- What's not tested: EQ calculation edge cases (very high error rate, very low activity). Decision engine with boundary triggers firing simultaneously.
- Files: `src/services/telemetry/decision/interventionDecisionEngine.ts`, `src/services/telemetry/metrics/errorQuotientEngine.ts`
- Risk: Struggle detection may give incorrect guidance or show false positives.
- Priority: High

**Webview Message Routing:**
- What's not tested: Command not found scenarios. Malformed messages. Concurrent message handling.
- Files: `src/views/app/webViewMessageHandler.ts`, `src/views/app/viewRouter.ts`
- Risk: Invalid messages could crash extension or cause state inconsistency.
- Priority: Medium

**File Cloning and Git Operations:**
- What's not tested: Clone fails halfway (disk full, permissions). Git operations on repositories with special branch names or credentials.
- Files: `src/views/app/commands/repositoryCommands.ts` (914 lines)
- Risk: Users lose work or get stuck in inconsistent repository state.
- Priority: Medium

**Exam Mode State Transitions:**
- What's not tested: Switching between exam exercises. Submission during exam timeout. Viewing exam results after exam ends.
- Files: `src/views/examExerciseDetail/examExerciseDetailView.ts`, `src/views/examConduction/examConductionView.ts`
- Risk: High-stakes feature with minimal test coverage.
- Priority: Critical

---

*Concerns audit: 2026-02-23*
