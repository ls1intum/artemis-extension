# Architecture

**Analysis Date:** 2026-02-23

## Pattern Overview

**Overall:** VS Code Extension with Layered Services Architecture

A VS Code educational extension integrating with the Artemis learning platform. Uses a layered architecture separating concerns: authentication, API communication, business logic, WebSocket real-time updates, telemetry, and UI views. Messages flow through command handlers to coordinate state changes and external interactions.

**Key Characteristics:**
- **Extension-driven initialization** - Single activation via `extension.ts`, manages lifecycle and service registration
- **Dual webview architecture** - Separate login/dashboard view (`ArtemisWebviewProvider`) and chat view (`ChatWebviewProvider`)
- **Real-time synchronization** - WebSocket/STOMP layer (`ArtemisWebsocketService`) pushes updates to UI without polling
- **Telemetry-first design** - Struggle detection monitors user behavior across exercise sessions, triggers interventions
- **Type-safe data models** - Domain models with `.fromJSON()` constructors for strict API response parsing
- **Service registry pattern** - `ProviderRegistry` provides central access to providers; services register themselves

## Layers

**Extension Entry:**
- Purpose: Initialize all services, register providers, set up commands and listeners
- Location: `src/extension.ts`
- Contains: Service instantiation, command registration, lifecycle management
- Depends on: All layers (auth, API, services, providers)
- Used by: VS Code extension runtime

**Authentication & Authorization:**
- Purpose: Manage login/logout, session cookies, JWT tokens, auth headers
- Location: `src/auth/auth.ts` (AuthManager)
- Contains: Cookie persistence, header generation, token management
- Depends on: VS Code context.secrets for secure storage
- Used by: API service, WebSocket service, message handlers

**API Communication:**
- Purpose: RESTful HTTP requests to Artemis server
- Location: `src/api/artemisApi.ts` (ArtemisApiService)
- Contains: Endpoints for courses, exercises, submissions, Iris, PlantUML rendering
- Depends on: AuthManager for headers, logger
- Used by: Providers, views, services

**WebSocket/Real-Time:**
- Purpose: STOMP over WebSocket for live updates (submissions, results, build status)
- Location: `src/services/artemisWebsocketService.ts` (ArtemisWebsocketService)
- Contains: Connection management, subscription handling, reconnection logic, message dispatch
- Depends on: AuthManager, @stomp/stompjs, ws
- Used by: Providers, telemetry, UI state updates

**Data Models:**
- Purpose: Domain objects with validation and serialization
- Location: `src/models/` - core.ts, submissions.ts, context.ts, iris.ts, auth.ts, build.ts, telemetry.ts
- Contains: `ArtemisUser`, `ArtemisCourse`, `ArtemisExercise`, `ArtemisResult`, `ProgrammingSubmission`, `IrisHealthStatus`, etc.
- Depends on: None (pure data)
- Used by: API service, WebSocket handlers, views

**Business Logic (Services):**
- Purpose: Stateful operations, session management, telemetry, git interactions
- Location: `src/services/` (except artemisWebsocketService)
- Key services:
  - `TelemetryManager` + subtree - Struggle detection, error quotient, intervention decision
  - `ChatSessionService`, `ChatMessageService` - Iris chat state
  - `ExerciseRegistry` - Track opened exercises
  - `GitService` - Repository operations
  - `FileMonitorService`, `WorkspaceDetectionService` - File system monitoring
- Depends on: API service, WebSocket service, models
- Used by: Providers, views

**Provider/View Coordination:**
- Purpose: Bridge VS Code webview lifecycle with app state
- Location: `src/provider/` - ArtemisWebviewProvider, ChatWebviewProvider, BuildErrorCodeLensProvider
- Contains: View HTML generation, message routing, state transitions, WebSocket handlers
- Depends on: All other layers
- Used by: VS Code extension runtime

**UI Views (Frontend):**
- Purpose: HTML/CSS/JS rendered in webviews
- Location: `src/views/` - Organized by logical screens (dashboard, courseList, exerciseDetail, irisChat, etc.)
- Contains: View classes with `generateHtml()` methods, reusable components
- Depends on: Models, styles, icons, utilities
- Used by: Providers (send to webview), message handlers receive commands from webview

**Message Handling:**
- Purpose: Coordinate webview commands with backend services
- Location: `src/views/app/webViewMessageHandler.ts`, `src/views/app/commands/` (7 command modules)
- Contains: Command routing, authentication, navigation, Iris, PlantUML, health checks
- Depends on: All services, API, state manager
- Used by: Providers (dispatch incoming webview messages)

## Data Flow

**Login Flow:**
1. User opens VS Code → extension activates → checks `AuthManager.hasArtemisToken()`
2. Login view displayed if not authenticated
3. User submits credentials → webview sends `login` command
4. `AuthCommandModule` handles → calls API.login() → gets Set-Cookie response
5. `AuthManager` stores cookie in secrets → context set to `iris:authenticated=true`
6. `ArtemisWebsocketService` connects with stored cookie/token
7. Dashboard view loads via `API.getCoursesForDashboard()`

**Submission & Real-Time Updates:**
1. User submits exercise → API.submitExercise() posts code
2. WebSocket listener subscribed to `/topic/exercise/participation/{participationId}/results`
3. Server sends `ResultDTO` over STOMP
4. `ArtemisWebsocketService.onNewResult()` fires callbacks
5. `ArtemisWebviewProvider._handleNewResult()` updates UI, triggers CodeLens refresh
6. Telemetry observes result → triggers struggle detection engine

**State Management:**
- `AppStateManager` holds current screen state (login, dashboard, course-detail, exercise-detail, etc.)
- View transitions stored: `showDashboard()`, `showCourseDetail()`, `showExerciseDetail()` etc.
- Data cached: courses, current exercise, exam data (not refetched on every view change)
- `ProviderRegistry` singleton provides global access to active providers

**Iris Chat Session Lifecycle:**
1. User selects course/exercise context
2. Chat context changes trigger `telemetryManager.startExerciseSession(exerciseId)`
3. User types message → `IrisCommandModule.handle()` sends via API.sendIrisMessage()
4. Response streamed back, stored in `ChatSessionService`
5. Struggle score from telemetry attached to message payload
6. Chat persisted locally in session storage

## Key Abstractions

**Command Handler Pattern:**
- Purpose: Decouple webview messages from implementation
- Examples: `src/views/app/commands/authCommands.ts`, `navigationCommands.ts`, `irisCommands.ts`
- Pattern: Each module exports `getHandlers()` → Map<command, handler function>
- Handler signature: `(message: any) => Promise<void>`
- Used for: Auth, navigation, repository ops, Iris messages, PlantUML, health checks

**View Generator Pattern:**
- Purpose: Render HTML views server-side, update dynamically
- Examples: `src/views/dashboard/dashboardView.ts`, `courseDetailView.ts`, `exerciseDetailView.ts`
- Pattern: Class with `generateHtml(state, data)` → string
- Reuses components: `ButtonComponent`, `ListItemComponent`, `ContainerComponent` etc.
- CSS organized parallel to TypeScript structure

**Service Registry Pattern:**
- Purpose: Provide singleton access to providers globally
- Implementation: `src/services/ProviderRegistry.ts`
- Stores: ArtemisWebviewProvider, ChatWebviewProvider references
- Used by: Commands that need to call provider methods without parameter threading

**Message Handler Pattern (WebSocket):**
- Purpose: Decouple WebSocket events from response
- Implementation: Handlers implement `WebSocketMessageHandler` interface
- Methods: `onNewResult()`, `onNewSubmission()`, `onSubmissionProcessing()`
- Multiple handlers can register → all notified on event
- Example: Both UI provider and telemetry listen to results

**Telemetry Pipeline:**
- Purpose: Aggregate behavioral signals → struggle score → intervention
- Flow: Build results → `ErrorQuotientEngine` (calculates EQ score) → `ThrashingDetector` (detects compilation loops) → `InterventionDecisionEngine` (decides intervention) → `AdaptiveCadence` (times hints)
- Decision stored in `DiagnosticPersistenceService` → attached to Iris messages

## Entry Points

**Extension Activation:**
- Location: `src/extension.ts`
- Triggers: First command execution in extension
- Responsibilities:
  - Initialize logger, auth manager, API service
  - Register WebView providers for login and chat
  - Set up command handlers (login, logout, health check, WebSocket status, PlantUML render)
  - Initialize telemetry manager and consent service
  - Listen for configuration changes

**Login Webview:**
- Location: `src/provider/artemisWebviewProvider.ts` (ArtemisWebviewProvider)
- Type: vscode.WebviewViewProvider
- View ID: `artemis.loginView`
- Responsibilities: Render login/dashboard UI, dispatch webview messages to command handlers, update app state

**Chat Webview:**
- Location: `src/provider/chatWebviewProvider.ts` (ChatWebviewProvider)
- Type: vscode.WebviewViewProvider
- View ID: `iris.chatView` (when `iris:authenticated == true`)
- Responsibilities: Render Iris chat UI, manage chat sessions, send/receive messages

**Build Error CodeLens:**
- Location: `src/provider/buildErrorCodeLensProvider.ts` (BuildErrorCodeLensProvider)
- Type: vscode.CodeLensProvider
- Responsibilities: Show "Go to Error" links in source code from build results

## Error Handling

**Strategy:** Centralized logging + user-facing dialogs + graceful degradation

**Patterns:**

- **API Errors:** `ArtemisApiService.makeRequest()` catches all responses
  - 401: Clear auth, show "session expired" message
  - Other: Extract error detail from response body, log, show user message
  - File: `src/api/artemisApi.ts` lines 27-90

- **WebSocket Reconnection:** Exponential backoff with caps
  - Start: 500ms, backoff multiplier 1.5x, max 10s, max 20 attempts
  - Grace period: 5 second delay before notifying UI of disconnect
  - File: `src/services/artemisWebsocketService.ts` lines 55-58

- **View Transitions:** Try/catch in message handlers, show error dialogs
  - Example: `AuthCommandModule._handleLogin()` catches network errors
  - File: `src/views/app/commands/authCommands.ts`

- **Model Parsing:** `.fromJSON()` constructors validate data
  - Throw if required fields missing
  - File: `src/models/core.ts` examples lines 27-71
  - Tests: `test/models/artemis.test.ts`

## Cross-Cutting Concerns

**Logging:**
- Centralized service: `src/services/loggingService.ts`
- Levels: debug, info, warn, error, plantUml, configLog
- Categories: GENERAL, AUTH, API, WEBSOCKET, VIEW, TELEMETRY, etc.
- Usage: `logger.info('Message', LogCategory.GENERAL)`

**Validation:**
- Type narrowing via `.fromJSON()` model constructors
- Command handlers validate message structure
- Type guards for discriminated unions (`WebviewMessage` subtypes)

**Authentication:**
- Handled by `AuthManager` - single source of truth for credentials
- All API requests auto-inject auth headers via `ArtemisApiService.makeRequest()`
- WebSocket uses cookie from AuthManager

**Configuration:**
- VS Code settings in `package.json` contributes.configuration
- Key settings: `artemis.serverUrl`, `artemis.iris.sendUncommittedChanges`, `artemis.debugMode`, `artemis.dataCollectionConsent`
- Accessed via `vscode.workspace.getConfiguration()`

**Session Management:**
- Extension-scoped subscriptions (context.subscriptions) handle disposal
- WebSocket service disposable, stores in subscriptions
- Telemetry manager explicitly disposed on deactivate
- File: `src/extension.ts` lines 162-163, 600-607

---

*Architecture analysis: 2026-02-23*
