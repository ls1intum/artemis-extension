# Codebase Structure

**Analysis Date:** 2026-02-23

## Directory Layout

```
iris-thaumantias/
├── src/                           # Main extension source code
│   ├── extension.ts              # Extension activation and setup
│   ├── auth/                     # Authentication and session management
│   ├── api/                      # HTTP API client (REST calls)
│   ├── models/                   # Domain data models with validation
│   ├── provider/                 # VS Code webview provider implementations
│   ├── services/                 # Business logic (telemetry, WebSocket, chat, etc.)
│   ├── types/                    # TypeScript type definitions and interfaces
│   ├── utils/                    # Helper utilities and constants
│   └── views/                    # UI view HTML generation and components
│
├── test/                          # Test suite (unit and E2E)
│   ├── api/                      # API service tests
│   ├── auth/                     # Authentication tests
│   ├── models/                   # Model serialization tests
│   ├── provider/                 # Provider tests
│   ├── services/                 # Service tests
│   ├── struggle-detection/       # Telemetry and struggle detection tests
│   ├── utils/                    # Utility function tests
│   ├── views/                    # View generation tests
│   ├── e2e/                      # End-to-end tests
│   ├── mocks/                    # Mock implementations
│   ├── run-tests.sh             # Test runner script
│   └── run-coverage.sh           # Coverage reporter script
│
├── dist/                          # Compiled output (generated, not committed)
├── out/                           # Test output (generated, not committed)
├── coverage/                      # Test coverage reports (generated)
├── media/                         # Extension icons and images
├── docs/                          # Documentation
├── package.json                   # NPM dependencies and scripts
├── package-lock.json              # Locked dependency versions
├── tsconfig.json                  # TypeScript configuration
├── eslint.config.mjs              # ESLint rules
├── esbuild.js                     # Bundle build script
├── .vscodeignore                  # Files to exclude from packaged VSIX
├── .vscode-test.mjs               # Test runner configuration
├── .vscode/                       # VS Code workspace settings
├── .github/                       # GitHub workflows (CI/CD)
└── CHANGELOG.md                   # Release notes
```

## Directory Purposes

**`src/auth/`:**
- Purpose: User authentication and session credential management
- Contains: AuthManager class for login/logout, cookie/token persistence
- Key files: `src/auth/auth.ts` (AuthManager implementation), `src/auth/index.ts` (exports)
- Accessed by: Extension init, API service, WebSocket service

**`src/api/`:**
- Purpose: HTTP REST client for Artemis server
- Contains: Request execution, endpoint definitions, response deserialization
- Key files: `src/api/artemisApi.ts` (ArtemisApiService), `src/api/index.ts` (exports)
- Endpoints: /api/courses, /api/exercises, /api/submissions, /iris, /plantUml, etc.
- Accessed by: Providers, views, message handlers

**`src/models/`:**
- Purpose: TypeScript domain models with `.fromJSON()` validation
- Contains: Class definitions for Artemis data (User, Course, Exercise, Result, Submission, etc.)
- Key files:
  - `core.ts` - ApiError, ArtemisFeedback, ArtemisUser, ArtemisCourse, ArtemisExercise, ArtemisResult, ArtemisParticipation
  - `submissions.ts` - ArtemisSubmission, ProgrammingSubmission, SubmissionProcessingMessage
  - `context.ts` - SubmissionContext, ExerciseContext, CourseContext, ParticipationContext
  - `iris.ts` - IrisMessage, IrisChatSession, IrisCodeHighlight
  - `auth.ts` - ProfileInfo, LoginCredentials, AuthenticationResult
  - `build.ts` - BuildLogEntry, ParsedBuildError, BuildTimingInfo
  - `telemetry.ts` - StruggleScore, TelemetryEvent, InterventionData
- Pattern: All models use factory pattern: `ModelClass.fromJSON(data: unknown): ModelClass`
- Accessed by: API responses, message handlers

**`src/provider/`:**
- Purpose: VS Code webview provider implementations
- Contains: Webview lifecycle management, message routing, view rendering
- Key files:
  - `artemisWebviewProvider.ts` (ArtemisWebviewProvider) - Login/dashboard view
  - `chatWebviewProvider.ts` (ChatWebviewProvider) - Iris chat view
  - `buildErrorCodeLensProvider.ts` (BuildErrorCodeLensProvider) - CodeLens for errors
  - `index.ts` - Exports
- Used by: Extension activation registers these with VS Code

**`src/services/`:**
- Purpose: Stateful business logic and event coordination
- Contains: Websocket client, telemetry pipeline, session management, registry
- Subdirectories:
  - `telemetry/` - Struggle detection: errorQuotientEngine, thrashingDetector, interventionService, inactivityService, metrics
  - `telemetry/decision/` - Intervention decision logic
  - `telemetry/eventPipeline/` - Build/compile signal emitters
  - `telemetry/intervention/` - Hint delivery strategy (adaptive cadence)
- Key services:
  - `artemisWebsocketService.ts` - STOMP client, connection management, message dispatch
  - `telemetryManager.ts` - Aggregates all telemetry signals, coordinates struggle detection
  - `chatSessionService.ts` - Tracks Iris chat sessions (local state)
  - `chatMessageService.ts` - Persists chat messages
  - `exerciseRegistry.ts` - Maps open exercises in workspace
  - `gitService.ts` - Git operations (clone, fetch, push)
  - `fileMonitorService.ts` - Watches workspace for changes
  - `workspaceDetectionService.ts` - Identifies which exercise is open
  - `loggingService.ts` - Centralized logging
  - `consentService.ts` - Data collection consent management
  - `noAiDetectionService.ts` - Detects .noai files
  - `websocketStatusBar.ts` - Shows WebSocket connection status in status bar
  - `ProviderRegistry.ts` - Singleton access to webview providers
  - `contextStore.ts` - Stores exercise/course context across sessions
- Accessed by: Extension init, providers, views, message handlers

**`src/types/`:**
- Purpose: TypeScript interfaces and types for internal communication
- Contains: Type definitions for API responses, WebSocket messages, context, etc.
- Key files:
  - `index.ts` - Main exports
  - `apiResponses.ts` - API DTOs and response types
  - `artemis.ts` - Artemis entity types
  - `context.ts` - Context discriminated unions
  - `stomp.d.ts` - STOMP protocol types

**`src/utils/`:**
- Purpose: Utility functions and configuration constants
- Contains: String parsing, path normalization, constants, build log parsing, PlantUML processing
- Key files:
  - `constants.ts` - CONFIG, VSCODE_CONFIG, WEBSOCKET_TOPICS
  - `buildLogParser.ts` - Parse build logs into structured errors
  - `plantUmlProcessor.ts` - Process PlantUML markup
  - `pathUtils.ts` - Path normalization
  - `workspaceFileChecker.ts` - Check if files exist in workspace
  - `aiExtensionsBlocklist.ts` - List of conflicting AI extensions
  - `recommendedExtensions.ts` - Recommended VS Code extensions by category
  - `iconDefinitions.ts` - Unicode emoji/icon definitions
  - `index.ts` - Re-exports public API

**`src/views/`:**
- Purpose: HTML/CSS/JS UI rendering and components
- Structure:
  - `app/` - Top-level app container, state management, message handling
    - `appStateManager.ts` - UI state machine (login, dashboard, course-detail, etc.)
    - `webViewMessageHandler.ts` - Message dispatcher to command handlers
    - `viewRouter.ts` - Determine which view HTML to render
    - `viewActionService.ts` - Coordinate view transitions
    - `commands/` - Command handler modules (auth, navigation, repository, iris, etc.)
  - `components/` - Reusable UI components (button, input, listItem, dropdown, etc.)
  - View screens: `dashboard/`, `courseList/`, `courseDetail/`, `exerciseDetail/`, `irisChat/`, `login/`, `examStart/`, `examConduction/`, `serviceStatus/`, `strugggeDetection/`, `gitCredentials/`, `recommendedExtensions/`, `aiChecker/`
  - `utils/` - CSS/file reading utilities
  - `webview/` - Webview runtime code and message bridge
- Pattern: Each view has `.ts` file with `generateHtml()` method returning string
- CSS files parallel structure to TypeScript

**`test/`:**
- Purpose: Unit and integration tests
- Structure mirrors `src/`:
  - `api/` - ArtemisApiService tests
  - `auth/` - AuthManager tests
  - `models/` - Model `.fromJSON()` tests
  - `provider/` - Provider tests
  - `services/` - Service tests (telemetry, sessions, etc.)
  - `struggle-detection/` - Telemetry pipeline tests
  - `utils/` - Utility function tests
  - `views/` - View generation tests
  - `e2e/` - End-to-end webview tests
  - `mocks/` - Mock implementations for testing
- File naming: `{module}.test.ts` using Mocha suite syntax

## Key File Locations

**Entry Points:**
- `src/extension.ts` - Extension activation, initializes all services and registers providers (608 lines)
- `src/provider/artemisWebviewProvider.ts` - Login/dashboard webview provider (400+ lines)
- `src/provider/chatWebviewProvider.ts` - Chat webview provider
- `src/provider/buildErrorCodeLensProvider.ts` - Build error CodeLens

**Configuration:**
- `package.json` - Extension manifest, dependencies, scripts
- `tsconfig.json` - TypeScript compiler options
- `eslint.config.mjs` - ESLint configuration
- `esbuild.js` - Build configuration for bundling
- `.vscode-test.mjs` - Test runner config

**Core Logic:**
- `src/auth/auth.ts` - Authentication manager (140+ lines)
- `src/api/artemisApi.ts` - API service (600+ lines)
- `src/services/artemisWebsocketService.ts` - WebSocket client (500+ lines)
- `src/services/telemetry/telemetryManager.ts` - Telemetry orchestration
- `src/views/app/webViewMessageHandler.ts` - Message dispatcher
- `src/views/app/appStateManager.ts` - UI state machine

**Testing:**
- `test/models/artemis.test.ts` - Model serialization tests
- `test/api/artemisApi.test.ts` - API client tests
- `test/auth/auth.test.ts` - Auth manager tests
- `test/struggle-detection/struggleDetection.test.ts` - Telemetry tests
- `test/run-tests.sh` - Run tests command

## Naming Conventions

**Files:**
- TypeScript: `camelCase.ts` (example: `artemisApi.ts`, `authManager.ts`)
- Classes: `PascalCase` exported from files (example: `class ArtemisApiService` in `artemisApi.ts`)
- Test files: `{module}.test.ts` (example: `artemisApi.test.ts`)
- View directories: `camelCase/` matching view state names (example: `courseDetail/`, `exerciseDetail/`)
- Components: `PascalCaseComponent.ts` (example: `ButtonComponent.ts`, `ListItemComponent.ts`)

**Directories:**
- Feature areas: `camelCase/` (example: `src/views/courseDetail/`, `src/services/telemetry/`)
- Layered structures: `{feature}/{subfeature}/` (example: `src/services/telemetry/decision/`, `src/views/components/button/`)
- Generated output: `dist/`, `out/`, `coverage/` (lowercase, excluded from git)

**TypeScript Code:**
- Classes: `PascalCase` (example: `ArtemisApiService`, `AuthManager`, `ButtonComponent`)
- Functions: `camelCase` (example: `generateHtml()`, `handleMessage()`)
- Constants: `UPPER_SNAKE_CASE` (example: `MAX_CONNECTION_ATTEMPTS`, `CONNECTION_STATE_DELAY_MS`)
- Interfaces: `PascalCase` (example: `CommandHandler`, `CommandContext`, `WebViewActionHandler`)
- Types: `PascalCase` (example: `AppState`, `UserInfo`)
- Variables: `camelCase` (example: `isAuthenticated`, `courseData`)
- Private fields: `_camelCase` (example: `_view`, `_authManager`)

## Where to Add New Code

**New Feature (Example: Exercise Submission UI):**
- Primary implementation:
  - Backend: `src/views/app/commands/submissionCommands.ts` (new command handler module)
  - Frontend: `src/views/exerciseDetail/submissionPanel.ts` (new view component)
  - Model: Add fields to `src/models/submissions.ts` if needed
- Tests: `test/views/exerciseDetail.test.ts` and `test/services/submissionService.test.ts`
- Integration: Register command handler in `src/views/app/webViewMessageHandler.ts` constructor

**New Component/Module (Example: StatusIndicator Component):**
- Implementation: `src/views/components/statusIndicator/statusIndicatorComponent.ts`
- Styling: `src/views/components/statusIndicator/statusIndicator.css`
- Export: Add to `src/views/components/index.ts` if barrel file exists
- Tests: `test/views/statusIndicator.test.ts`
- Usage: Import and use in other view components

**New Utility (Example: Date Formatting):**
- Implementation: `src/utils/dateFormatter.ts`
- Export: Add to `src/utils/index.ts`
- Tests: `test/utils/dateFormatter.test.ts`
- Usage: Import as `import { formatDate } from '../utils'`

**New Service (Example: UserPreferencesService):**
- Implementation: `src/services/userPreferencesService.ts`
- Export: Add to `src/services/index.ts`
- Initialization: Instantiate in `src/extension.ts` and store in context.subscriptions
- Tests: `test/services/userPreferencesService.test.ts`
- Access: Via `ProviderRegistry` singleton or pass as dependency

**New WebSocket Message Type (Example: Exercise Hint):**
- Add model: `src/models/hints.ts` with `ExerciseHint` class
- Add handler: Implement `WebSocketMessageHandler.onNewHint()` in handler interface
- Register: In `ArtemisWebsocketService`, call `registerMessageHandler()` with new handler
- Subscribe: Add STOMP subscription in `ArtemisWebsocketService.connect()`

**API Endpoint (Example: Get Exercise Hints):**
- Add method: `ArtemisApiService.getExerciseHints(exerciseId: number)` in `src/api/artemisApi.ts`
- Response type: Define in `src/types/apiResponses.ts` if needed
- Call: Use `this.makeRequest()` helper with proper error handling
- Tests: Add test case in `test/api/artemisApi.test.ts`

## Special Directories

**`dist/`:**
- Purpose: Compiled extension output (esbuild bundle)
- Generated: By `npm run compile` or `npm run package`
- Committed: No (in .gitignore)
- Entry: `dist/extension.js` - referenced in package.json main field

**`out/`:**
- Purpose: Compiled test files
- Generated: By `npm run compile-tests`
- Committed: No (in .gitignore)
- Used by: VS Code test runner

**`coverage/`:**
- Purpose: Code coverage reports
- Generated: By `npm run test:coverage` or `npm run coverage:all`
- Committed: No (in .gitignore)
- View: Check `coverage/index.html` in browser after test run

**`media/`:**
- Purpose: Extension icons and images
- Committed: Yes
- Contents: Logo images (artemis-logo.png, iris-monochrome.png, artemis-blue.png)
- Usage: Referenced in package.json contributes.viewsContainers and views

**`.vscode/`:**
- Purpose: Workspace settings and launch configurations
- Committed: Yes
- Contents: VS Code settings.json, launch.json for debugging
- Usage: Auto-loaded when opening workspace

**`.github/`:**
- Purpose: GitHub Actions CI/CD workflows
- Committed: Yes
- Contents: .github/workflows/ for automated testing and publishing
- Usage: Triggered on push/PR events

---

*Structure analysis: 2026-02-23*
