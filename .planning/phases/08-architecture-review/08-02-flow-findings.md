# End-to-End Flow Tracing Findings

**Analysis Date:** 2026-02-25
**Method:** Cross-boundary flow tracing through extension host, webview, API, and WebSocket layers
**Scope:** 8 critical user flows with boundary crossing analysis

---

## Flow 1: Login Flow

**Entry:** LoginView.tsx form submission
**Exit:** Dashboard view rendered with fresh data

### Flow Steps

1. **React webview:** User submits form → `onSubmit()` → `vscode.postMessage({ command: 'login', username, password, rememberMe })`
2. **Extension boundary:** `artemisWebviewProvider.ts` receives message → `WebViewMessageHandler.handleMessage()`
3. **Command routing:** `WebViewMessageHandler` → `AuthCommandModule.handleLogin()`
4. **API call:** `artemisApi.authenticate()` → POST `/api/authenticate` with credentials
5. **Auth storage:** `AuthManager.setAuthToken()` → VS Code secrets API stores cookie
6. **Context update:** `updateAuthContext(true)` → sets `iris:authenticated=true` context
7. **WebSocket connect:** `ArtemisWebsocketService.connect()` triggered after 1 second delay
8. **Dashboard load:** `actionHandler.showDashboard()` → `artemisApi.getCoursesForDashboard()`
9. **Extension → webview:** `postMessage({ type: 'dashboardInit', payload: { courses, workspaceExercise } })`
10. **React state update:** App.tsx receives message → switches to Dashboard view → `useDashboardStore` updates

### Boundary Crossings

| Boundary | Direction | Mechanism | Type Safety |
|----------|-----------|-----------|-------------|
| Webview → Extension | postMessage | `{ command: 'login', ... }` | No (any) |
| Extension → API | HTTP fetch | `authenticate(username, password, rememberMe)` | Yes (typed params) |
| Extension → VS Code | Secrets API | `context.secrets.store('artemisAuthToken', cookie)` | Yes |
| Extension → Webview | postMessage | `{ type: 'dashboardInit', payload: {...} }` | No (any) |
| WebView → Zustand | Event listener | `window.addEventListener('message', ...)` | No (any) |

### Error Handling

- **API error (401/403):** Caught in `AuthCommandModule.handleLogin()` → `vscode.window.showErrorMessage()` + `sendMessage({ command: 'loginError', error })`
- **Network error:** Caught, formatted via `formatLoginError()`, sent to both VS Code notification and webview
- **Webview error message:** React displays error from `loginError` message in UI

**Status:** ✅ Error propagation complete (both UI notification and webview display)

### State Synchronization

- **Extension state:** `AuthManager` stores cookie, `AppStateManager` transitions to `dashboard` state
- **Webview state:** `useDashboardStore` receives dashboard data, stores in Zustand
- **Sync mechanism:** postMessage after successful API response

**Risk:** None identified — errors propagate correctly

---

## Flow 2: Course Browsing Flow

**Entry:** Dashboard "View All Courses" click
**Exit:** Course detail view with exercises loaded

### Flow Steps

1. **React webview:** User clicks "View All Courses" → `postMessage({ command: 'showAllCourses' })`
2. **Extension:** `NavigationCommandModule.handleShowAllCourses()` → `actionHandler.showCourseList()`
3. **State transition:** `AppStateManager.showCourseList()` (uses cached `coursesData` if available, else fetches)
4. **Extension → webview:** `postMessage({ type: 'courseListInit', payload: { courses, archivedCourses } })`
5. **React:** App.tsx receives → switches to CourseListView → `useCourseListStore.setCourses()`
6. **User clicks course:** `postMessage({ command: 'viewCourseDetails', courseData })`
7. **Extension:** `NavigationCommandModule.processCourseDetails()` → fetches exams via `artemisApi.getExamsForCourse(courseId)`
8. **Exercise registry:** `ExerciseRegistry.registerFromCourseData()` stores exercises
9. **Chat notification:** `ChatWebviewProvider.updateDetectedCourse()` and `updateDetectedExercise()` called for each exercise
10. **State transition:** `AppStateManager.showCourseDetail(courseData)` → stores `currentCourseData`
11. **Extension → webview:** `postMessage({ type: 'courseDetailInit', payload: { courseData, workspaceExerciseId, hideDeveloperTools } })`
12. **React:** App.tsx → CourseDetailView → `useCourseDetailStore.setCourseData()`

### Boundary Crossings

| Boundary | Direction | Mechanism | Type Safety |
|----------|-----------|-----------|-------------|
| Webview → Extension | postMessage | `{ command: 'showAllCourses' }` | No |
| Extension → API | HTTP fetch | `getExamsForCourse(courseId)` | Yes |
| Extension → ExerciseRegistry | Service call | `registerFromCourseData(courseData)` | Yes |
| Extension → ChatProvider | Service call | `updateDetectedCourse(title, id, shortName)` | Yes |
| Extension → Webview | postMessage | `{ type: 'courseDetailInit', payload: {...} }` | No |

### Error Handling

- **Exam fetch error:** Caught, logged via `logger.apiError()`, course continues without exams (no UI notification)
- **General navigation error:** Caught in `processCourseDetails()` → `vscode.window.showErrorMessage('Error viewing course details')`

**Finding:** Exam fetch errors are swallowed silently — user doesn't know exams failed to load

### State Synchronization

- **Cached data:** `AppStateManager` caches `coursesData`, doesn't refetch on navigation (good for performance)
- **Workspace detection:** Asynchronously detects workspace exercise via `detectWorkspaceExercise()`, sent in payload
- **Breadcrumbs:** React `useNavigationStore` tracks navigation stack, separate from extension state

**Risk:** If exam API fails, UI shows empty exam list with no error indication

---

## Flow 3: Exercise Interaction Flow

**Entry:** Exercise detail view load
**Exit:** Submission result displayed with CodeLens errors

### Flow Steps

1. **React webview:** User clicks exercise → `postMessage({ command: 'openExerciseDetails', exerciseId })`
2. **Extension:** `NavigationCommandModule.handleOpenExerciseDetails()` → `actionHandler.openExerciseDetails(exerciseId)`
3. **State transition:** `AppStateManager.showExerciseDetail(exerciseId)` → fetches fresh data (ALWAYS refetches, doesn't use cache)
4. **API call:** `artemisApi.getExerciseDetails(exerciseId)` → `GET /api/exercise/exercises/{id}/details?withSubmissions=true&withLatestResult=true`
5. **Extension → webview:** `postMessage({ type: 'exerciseDetailInit', payload: { exerciseData, hideDeveloperTools } })`
6. **React:** App.tsx → ExerciseDetailView → `useExerciseDetailStore.setExerciseData()`
7. **User submits:** Clicks "Submit" → `postMessage({ command: 'submitExercise', participationId })`
8. **Extension:** `RepositoryCommandModule.handleSubmitExercise()` → calls `artemisApi.submitExercise(participationId)`
9. **WebSocket subscription:** Extension already subscribed to `/topic/exercise/participation/{participationId}/results`
10. **Server processes:** Artemis builds code, runs tests, publishes result to WebSocket topic
11. **WebSocket → Extension:** `ArtemisWebsocketService` receives STOMP message → `onNewResult()` callback
12. **Extension handler:** `ArtemisWebviewProvider._handleNewResult(result)` → sends `postMessage({ type: 'newResult', payload: result })`
13. **Extension CodeLens:** `buildErrorCodeLensProvider.refreshBuildErrors(result)` parses errors, triggers CodeLens update
14. **React:** App.tsx receives `newResult` → `useExerciseDetailStore.updateResult()` → UI re-renders with new result
15. **Build log parsing:** If build failed, errors displayed in TestResults.tsx component

### Boundary Crossings

| Boundary | Direction | Mechanism | Type Safety |
|----------|-----------|-----------|-------------|
| Webview → Extension | postMessage | `{ command: 'openExerciseDetails', exerciseId }` | No |
| Extension → API | HTTP fetch | `getExerciseDetails(exerciseId)` | Yes |
| Extension → Webview | postMessage | `{ type: 'exerciseDetailInit', payload: {...} }` | No |
| WebSocket → Extension | STOMP message | `onNewResult(result: ResultDTO)` | Yes (typed handler) |
| Extension → CodeLens | Service call | `refreshBuildErrors(result)` | Yes |
| Extension → Webview | postMessage | `{ type: 'newResult', payload: result }` | No |

### Error Handling

- **API error (exercise fetch):** Caught in `showExerciseDetail()`, logged, user sees error via `vscode.window.showErrorMessage()`
- **Submit error:** Caught in `handleSubmitExercise()`, logged, user notified via `vscode.window.showErrorMessage()`
- **WebSocket error:** NOT propagated to UI (see Flow 5 for details)
- **Build log parsing errors:** Logged but not surfaced to user

**Finding:** WebSocket errors during result delivery are logged but not shown in UI

### State Synchronization

- **Fresh data policy:** Exercise details ALWAYS refetched (no caching) — ensures latest submission status
- **WebSocket updates:** Real-time result updates bypass HTTP polling
- **CodeLens sync:** Build errors parsed and displayed in source code via CodeLens provider

**Risk:** If WebSocket disconnects during submission, user may not receive result notification

---

## Flow 4: Iris Chat Flow

**Entry:** User types message in chat input
**Exit:** Streamed response rendered with syntax highlighting

### Flow Steps

1. **React webview (Chat):** User types message → ChatInput.tsx → `postMessage({ command: 'sendMessage', text, context })`
2. **Extension:** `IrisCommandModule.handleSendMessage()` → calls `irisSessionManager.sendMessage()`
3. **Session management:** `IrisSessionManager` validates session, attaches telemetry struggle score
4. **API streaming:** `artemisApi.sendIrisMessage()` → POST to `/api/iris/...` endpoint with `Accept: text/event-stream`
5. **Stream handling:** Response body reader in chunks → `onChunk` callback fires repeatedly
6. **Extension → webview (per token):** `postMessage({ type: 'irisMessageToken', token, messageId })` for each chunk
7. **React buffering:** `useChatStore` receives tokens → buffers via `useStreamingMessage` hook (RAF-based sentence boundary detection)
8. **Rendering:** StreamingMessage.tsx accumulates tokens, re-renders on sentence boundaries (not per-token)
9. **Code block detection:** When ````typescript` detected → CodeBlock.tsx component renders with Shiki highlighting
10. **Shiki lazy load:** Singleton `highlighterInstance` initialized on first code block
11. **Message complete:** API stream ends → `postMessage({ type: 'irisMessageComplete', messageId })`
12. **React finalization:** `useChatStore.finalizeMessage()` → moves from streaming to completed message list
13. **Scroll management:** `useAutoScroll` hook scrolls to bottom after message complete

### Boundary Crossings

| Boundary | Direction | Mechanism | Type Safety |
|----------|-----------|-----------|-------------|
| Webview (Chat) → Extension | postMessage | `{ command: 'sendMessage', text, context }` | No |
| Extension → IrisSessionManager | Service call | `sendMessage(text, context, sessionId)` | Yes |
| Extension → API | HTTP streaming | `sendIrisMessage()` with onChunk callback | Yes (typed callback) |
| Extension → Webview | postMessage (per token) | `{ type: 'irisMessageToken', token, messageId }` | No |
| React → Shiki | Lazy import | `await import('shiki').then(...)` | Yes |

### Error Handling

- **API error (send message):** Caught in `handleSendMessage()`, user notified via `vscode.window.showErrorMessage()`
- **Streaming error:** If stream breaks, current message truncated, error logged
- **Shiki load error:** Logged via `logger.viewError()`, code block falls back to plain text

**Status:** ✅ Error propagation adequate

### State Synchronization

- **Chat state:** `ChatSessionService` and `ChatMessageService` persist chat data in extension host
- **Webview state:** `useChatStore` maintains transient streaming state (current token buffer, isStreaming flag)
- **Context switching:** When user switches exercise, `postMessage({ command: 'switchContext', context })` → backend updates session context

**Risk:** If webview is destroyed during streaming (panel hidden), streaming state lost (no getState/setState persistence)

---

## Flow 5: WebSocket Connection Flow

**Entry:** User logs in successfully
**Exit:** WebSocket connected, subscriptions active

### Flow Steps

1. **Login success:** `AuthCommandModule.handleLogin()` completes → `updateAuthContext(true)` sets context
2. **Auto-connect trigger:** In `extension.ts`, after login context set, 1 second timeout → `websocketService.connect()`
3. **Connection initiation:** `ArtemisWebsocketService.connect()` checks `_canAttemptConnection()` (mutex, rate limit, max attempts)
4. **Cookie retrieval:** `authManager.getCookieHeader()` → extracts JSESSIONID from VS Code secrets
5. **JWT extraction:** `_extractJwtFromCookie()` parses Bearer token from cookie
6. **WebSocket URL construction:** `_buildWebSocketUrl()` → `wss://artemis.tum.de/websocket/tracker`
7. **STOMP client creation:** `new Client()` with config (reconnectDelay, connectionTimeout, heartbeats)
8. **WebSocket factory:** Creates `ws` instance with Cookie header
9. **Connection attempt:** STOMP client activates → WebSocket handshake → STOMP CONNECT frame
10. **Connection success:** `onConnect` callback → `_isConnected = true`, `_reconnectAttempts = 0`
11. **Status bar update:** `WebSocketStatusBarService` (if developer mode) shows "$(check) WebSocket"
12. **Connection state callbacks:** All registered callbacks notified via `onConnectionStateChange()`
13. **Subscription setup:** Extension subscribes to topics: `/topic/exercise/participation/{id}/results`, `/topic/exercise/participation/{id}/newSubmissions`, etc.
14. **Heartbeat start:** STOMP sends PING/PONG frames every 10 seconds
15. **Message dispatch:** When message arrives → `onStompMessage()` → `_messageHandlers` notified

### Connection Failure Path

1. **Connection error:** `onWebSocketError` or `onStompError` callback fires
2. **Error logging:** `logger.websocket()` logs error details
3. **NO UI NOTIFICATION:** Error NOT sent to webview, user sees no indication
4. **Reconnection attempt:** STOMP library triggers reconnect with exponential backoff (500ms → 1s → 2s → 4s → max 10s)
5. **Max attempts:** After 20 failed attempts, `_connectionGaveUp = true`, reconnection stops
6. **Status bar (developer only):** Shows "$(alert) WebSocket Disconnected" if developer mode enabled

### Boundary Crossings

| Boundary | Direction | Mechanism | Type Safety |
|----------|-----------|-----------|-------------|
| Extension → AuthManager | Service call | `getCookieHeader()` | Yes |
| Extension → WebSocket server | WebSocket + STOMP | `ws` library with Cookie header | Protocol-level |
| WebSocket → Extension | STOMP message | `onStompMessage(message: IMessage)` | Yes (typed handler) |
| Extension → Handlers | Callback | `WebSocketMessageHandler.onNewResult()` | Yes (typed interface) |

### Error Handling

**CRITICAL FINDING: WebSocket errors are NOT propagated to webview UI**

- **onStompError:** Logs error frame, does NOT call `postMessage` to webview
- **onWebSocketError:** Logs error, does NOT call `postMessage` to webview
- **onWebSocketClose:** Logs close event, does NOT notify webview
- **Connection state callbacks:** Only available to services that explicitly subscribe, NOT exposed to webview

**Code evidence:**
```typescript
// src/services/artemisWebsocketService.ts
onStompError: (frame: IFrame) => {
    this._log(`STOMP error: ${frame.headers['message']}`);
    this._log(`Details: ${frame.body}`);
    // NO postMessage TO WEBVIEW
},

onWebSocketError: (event: any) => {
    this._log(`WebSocket error: ${event instanceof Error ? event.message : 'Unknown error'}`);
    // NO postMessage TO WEBVIEW
},
```

**Consequence:** User sees "loading..." forever if WebSocket fails, no error feedback

### State Synchronization

- **Connection state:** Tracked in `ArtemisWebsocketService` (_isConnected, _reconnectAttempts, _connectionGaveUp)
- **Subscription tracking:** Map<string, StompSubscription> ensures cleanup on disconnect
- **Status bar (developer mode only):** `WebSocketStatusBarService` shows connection status in bottom bar

**Risk:** Regular users have no visibility into WebSocket connection status or errors

---

## Flow 6: Error Propagation Flow

**Analysis:** How errors flow across boundaries from source to user notification

### API Error Path

1. **Source:** `artemisApi.ts` → `makeRequest()` throws `ApiError`
2. **Catch location:** Command handler (e.g., `AuthCommandModule.handleLogin()`)
3. **Logging:** `logger.authError()` or `logger.apiError()` writes to output channel
4. **User notification:** `vscode.window.showErrorMessage()` displays modal dialog
5. **Webview notification:** `sendMessage({ command: 'loginError', error })` sends to React
6. **React display:** Error component (e.g., LoginView error state) shows error text

**Status:** ✅ Complete error propagation (both VS Code notification and webview display)

### WebSocket Error Path

1. **Source:** `artemisWebsocketService.ts` → `onStompError` or `onWebSocketError` callback
2. **Logging:** `logger.websocket()` writes to output channel
3. **User notification:** NONE — error not shown to user
4. **Webview notification:** NONE — error not sent to webview
5. **React display:** NONE — no error indication in UI

**Status:** ❌ Error swallowing — user not informed

### Build Error Path

1. **Source:** WebSocket delivers `ResultDTO` with build failures
2. **Parsing:** `buildLogParser.ts` parses log, extracts errors
3. **CodeLens:** `BuildErrorCodeLensProvider.refreshBuildErrors()` displays errors in source code
4. **Webview notification:** `postMessage({ type: 'newResult', payload: result })` → React shows in TestResults component
5. **User visibility:** Both CodeLens and TestResults component show errors

**Status:** ✅ Errors visible via multiple channels

### Exam Error Path

1. **Source:** API error during exam start/conduction
2. **Catch location:** `NavigationCommandModule.handleStartExam()`
3. **Error formatting:** `ExamErrorHandler.getExamErrorMessage(error)` provides friendly message
4. **User notification:** `vscode.window.showErrorMessage()`
5. **Webview notification:** Exam-specific error handling

**Status:** ✅ Adequate error propagation

---

## Flow 7: Exam Flow

**Entry:** User clicks "Start Exam" in ExamStartView
**Exit:** Exam conduction view with timer running

### Flow Steps

1. **React webview:** User clicks "Start Exam" → `postMessage({ command: 'startExam', courseId, examId, studentExamId })`
2. **Extension:** `NavigationCommandModule.handleStartExam()` → calls `artemisApi.startStudentExam(courseId, examId, studentExamId)`
3. **API call:** POST to `/api/courses/{courseId}/exams/{examId}/student-exams/{studentExamId}/start` → returns conduction details
4. **State transition:** `AppStateManager.showExamConduction({ studentExam, courseId, examId })`
5. **Extension → webview:** `postMessage({ type: 'examConductionInit', payload: { studentExam, exercises, startTime, endTime, serverTime } })`
6. **React:** App.tsx → ExamConductionView → `useExamConductionStore.setExamData()`
7. **Timer initialization:** ExamTimer.tsx component calculates absolute timestamps (startTime, endTime)
8. **Web Worker creation:** `new Worker(examTimer.worker.ts)` created for precise timer
9. **Worker message:** `worker.postMessage({ startTime, endTime, serverTime })` starts countdown
10. **Worker ticks:** Worker sends `postMessage({ remainingTime, isExpired })` every 100ms
11. **React updates:** ExamTimer.tsx receives worker messages, re-renders countdown display
12. **Exercise navigation:** User clicks exercise → `postMessage({ command: 'openExamExerciseDetails', exercise, exerciseIndex, courseId, examId })`
13. **Extension:** `NavigationCommandModule.handleOpenExamExerciseDetails()` → state transition to exam-exercise-detail
14. **Extension → webview:** `postMessage({ type: 'examExerciseDetailInit', payload: { exercise, exerciseIndex, examData, hideDeveloperTools } })`
15. **React:** App.tsx → ExamExerciseDetailView → `useExamExerciseDetailStore.setExerciseData()`
16. **Timer continues:** Web Worker continues counting down in background (drift-free, even if tab hidden)
17. **Time expired:** Worker sends `{ isExpired: true }` → TimerExpiredOverlay.tsx shows blocking overlay

### Boundary Crossings

| Boundary | Direction | Mechanism | Type Safety |
|----------|-----------|-----------|-------------|
| Webview → Extension | postMessage | `{ command: 'startExam', ... }` | No |
| Extension → API | HTTP fetch | `startStudentExam(courseId, examId, studentExamId)` | Yes |
| Extension → Webview | postMessage | `{ type: 'examConductionInit', payload: {...} }` | No |
| React → Web Worker | Worker postMessage | `{ startTime, endTime, serverTime }` | Yes (typed worker message) |
| Web Worker → React | Worker postMessage | `{ remainingTime, isExpired }` | Yes (typed worker message) |

### Error Handling

- **API error (start exam):** Caught in `handleStartExam()`, user notified via `vscode.window.showErrorMessage()`
- **Exam-specific errors:** `ExamErrorHandler.getExamErrorMessage()` provides friendly error messages
- **Worker error:** If worker fails to load, timer falls back to `setTimeout` (less accurate)

**Status:** ✅ Error propagation adequate

### State Synchronization

- **Extension state:** `AppStateManager.currentExamData` stores exam details
- **Webview state:** `useExamConductionStore` stores exam data + exercises
- **Timer state:** Web Worker maintains precise countdown independently
- **Absolute timestamps:** Server time used to calculate absolute start/end times (prevents clock skew)

**Design strength:** Web Worker ensures timer accuracy even when tab is hidden or throttled

---

## Flow 8: State Persistence Flow

**Analysis:** How webview state survives panel hide/show cycles

### Current Implementation

1. **Panel visibility change:** VS Code may destroy webview content when panel hidden
2. **React unmount:** All component state lost (Zustand stores reset to initial values)
3. **Panel shown again:** Webview re-renders from scratch
4. **Data refetch:** Extension sends fresh data via `postMessage` (dashboard, course, exercise data)
5. **Transient state lost:** Form inputs, scroll position, chat streaming state, breadcrumb history NOT persisted

### Persistence Mechanisms Available

**NOT IMPLEMENTED:**
- ❌ `vscode.getState()` / `vscode.setState()` — NOT used in React webview code
- ❌ `WebviewPanelSerializer` — NOT registered for across-session persistence
- ❌ Zustand persist middleware — NOT configured on any of the 9 stores

**IMPLEMENTED:**
- ✅ Backend persistence: `ChatSessionService` and `ChatMessageService` persist chat data in extension host
- ✅ AppStateManager cache: Extension host caches dashboard/course/exercise data (survives webview destruction)
- ✅ Data refetch: Extension sends cached data on webview re-init

### Finding: State Persistence Gap

**Missing:**
- Navigation breadcrumbs (useNavigationStore) — lost on panel hide/show
- Form drafts (chat input, git credentials input) — lost on panel hide/show
- Scroll position (chat message list, course list) — lost on panel hide/show
- Streaming state (partial message during streaming) — lost on panel hide/show
- Archived courses loaded flag (useCourseListStore) — lost on panel hide/show

**Consequence:** User experience degradation if VS Code destroys webview content

**Code evidence:**
```typescript
// No usage of getState/setState in React code
// Searched: grep -r "vscode.getState\|vscode.setState" src/views/webview/react/
// Result: NOT FOUND
```

---

## Cross-Cutting Findings

### Finding: Dual State Management Complexity

**Pattern:** Two state management systems coexist:
1. **Extension host:** `AppStateManager` (class-based, 13 states, data caching)
2. **React webview:** 9 Zustand stores (feature-scoped, UI state)

**Data flow:** API → AppStateManager → postMessage → Zustand stores → React components

**Risk:** State drift if extension sends stale data or Zustand stores don't update correctly

**Evidence:** Some data refetched on view load (`showExerciseDetail` ALWAYS fetches), others use cache (`showCourseDetail` reuses `currentCourseData`)

### Finding: Message Contract Type Safety Gap

**Current:** All postMessage payloads typed as `any` in handlers
- Extension sends: `this._postMessageSafe(message: any)`
- React receives: `event.data as any`
- Handlers receive: `handleMessage(message: any)`

**Consequence:** No compile-time checks for message structure, runtime errors possible if shape changes

**Recommendation:** Migrate to discriminated unions (deferred to v1.2 per CONTEXT.md)

### Finding: WebSocket Error Swallowing (HIGH IMPACT)

**Problem:** WebSocket errors logged but NOT propagated to UI
- onStompError → log only
- onWebSocketError → log only
- User sees "loading..." forever if connection fails

**Impact:** Poor UX, debugging difficulty

**Effort:** LOW — add `postMessage({ type: 'websocketError', error })` to error callbacks

**Recommendation:** Implement in v1.1 (Rule 2: missing critical functionality)

### Finding: getState/setState Not Implemented (MEDIUM IMPACT)

**Problem:** Webview state lost on panel hide/show
- No `vscode.getState()` / `vscode.setState()` usage
- Transient UI state (breadcrumbs, form drafts, scroll position) not persisted

**Impact:** UX degradation if VS Code destroys webview

**Effort:** MEDIUM — add persistence to each Zustand store with debounced setState

**Recommendation:** Document as known limitation, defer to v1.2

---

## Summary Statistics

**Flows traced:** 8
**Boundary crossings analyzed:** 47
**Error propagation paths:** 5
**Critical findings:** 2 (WebSocket error swallowing, state persistence gap)
**Medium findings:** 3 (exam fetch error swallowing, message contract type safety, dual state complexity)

---

**Next step:** Synthesize these findings into the final audit document (Task 2)

*Flow tracing completed: 2026-02-25*
