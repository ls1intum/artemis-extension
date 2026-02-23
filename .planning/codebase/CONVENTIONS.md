# Coding Conventions

**Analysis Date:** 2026-02-23

## Naming Patterns

**Files:**
- PascalCase for classes and interfaces: `artemisWebsocketService.ts`, `AuthManager.ts`, `ArtemisApiService.ts`
- camelCase for services and utility files: `loggingService.ts`, `contextStore.ts`, `fileMonitorService.ts`
- Index files use `index.ts` for barrel exports: `src/auth/index.ts`, `src/services/index.ts`
- Test files mirror source structure with `.test.ts` suffix: `test/auth/auth.test.ts`, `test/models/artemis.test.ts`
- View components use descriptive names ending with `View`: `exerciseDetailView.ts`, `loginView.ts`, `dashboardView.ts`

**Functions:**
- camelCase for all functions and methods: `getServerUrl()`, `makeRequest()`, `getCurrentUser()`, `setLogLevel()`
- Private methods prefix with underscore: `private _formatMessage()`, `private _shouldLog()`
- Async functions use clear verb-noun pattern: `getCurrentUser()`, `makeRequest()`, `getCourseForDashboard()`
- Event handlers use `on` or `handle` prefix: `onDidChange()`, `onDidChangeConfiguration()`, `handleError()`

**Variables:**
- camelCase for all variables: `let mockFetch`, `const authManager`, `public readonly authManager`
- Boolean flags use `is` or `has` prefix: `isConnected`, `isAuthenticated`, `hasCookie`, `isDirty`
- Constants use UPPER_SNAKE_CASE: `ARTEMIS_SERVER_URL_DEFAULT`, `SECRET_KEYS.ARTEMIS_TOKEN`
- Private fields use underscore prefix with camelCase: `private outputChannel`, `private subscriptions`

**Types:**
- PascalCase for all type names: `ApiError`, `ArtemisUser`, `ArtemisCourse`, `AuthenticationResult`
- Enums use PascalCase with UPPER_SNAKE_CASE members: `enum LogLevel { DEBUG = 0, INFO = 1, ERROR = 3 }`
- Interfaces use PascalCase prefix (no `I` prefix): `WebSocketMessageHandler`, `ActiveContext`, `TrackedExercise`
- Type aliases use PascalCase: `type ChatContextType = 'exercise' | 'course' | 'lecture' | 'general'`
- Union types use descriptive names: `type ContextSource = 'user-selected' | 'workspace-detected' | 'default'`

## Code Style

**Formatting:**
- No explicit formatter configured (Prettier not used)
- Indentation: 4 spaces (inferred from tsconfig and source files)
- Line length: No strict limit enforced
- Semicolons: Required (enforced by ESLint `semi: "warn"`)
- Braces: Required around control structures (enforced by ESLint `curly: "warn"`)

**Linting:**
- Tool: ESLint 9.39.2 with TypeScript support
- Config file: `eslint.config.mjs` (modern flat config format)
- Parser: `@typescript-eslint/parser` v8.54.0
- Plugin: `@typescript-eslint/eslint-plugin` v8.54.0

**Key Rules:**
- `no-console: "error"` - Console logging forbidden in all source code except loggingService.ts (with eslint-disable comments)
- `no-console: "off"` - Allowed in test files and JavaScript config files
- `@typescript-eslint/naming-convention: ["warn", { selector: "import", format: ["camelCase", "PascalCase"] }]`
- `eqeqeq: "warn"` - Use `===` instead of `==`
- `no-throw-literal: "warn"` - Throw Error objects, not literals
- Imports must use camelCase or PascalCase (checked at parse time)

## Import Organization

**Order:**
1. VS Code API imports: `import * as vscode from 'vscode'`
2. External packages: `import * as assert from 'assert'`, `import { AuthManager } from '../auth'`
3. Type imports: `import type { CourseDashboardResponse, ... } from '../types'`
4. Relative imports for local modules: `import { logger, LogLevel } from '../services/loggingService'`
5. Barrel imports preferred: `import { AuthManager, ... } from '../auth/index'` or `import { ... } from '../auth'`

**Path Aliases:**
- No configured path aliases (aliases not found in tsconfig.json)
- Relative paths used throughout: `../auth`, `../../src/types`, etc.

**Import Style:**
- Named imports for specific exports: `import { AuthManager } from '../auth'`
- Namespace imports for modules: `import * as vscode from 'vscode'`
- Type imports explicitly marked: `import type { SomeType } from '../types'` (when only types imported)
- Destructured imports preferred: `const { id, title } = course` over accessing properties

## Error Handling

**Patterns:**
- Custom error classes extend Error: `class ApiError extends Error { ... }`
- ApiError includes status code and optional detail field: `ApiError(message, status, detail?)`
- Error checking via `instanceof`: `if (error instanceof ApiError) { ... }`
- Try-catch blocks used for async operations and JSON parsing
- No throwing literals; always throw Error instances
- Errors logged via centralized logger: `logger.error('Message', LogCategory.API, error)`

**Example Pattern:**
```typescript
try {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new ApiError(`API failed: ${response.status}`, response.status);
    }
    return await response.json();
} catch (error) {
    if (error instanceof ApiError) {
        logger.error('API error', LogCategory.API, error);
        throw error;
    }
    throw new ApiError('Unknown error', 500);
}
```

## Logging

**Framework:** Centralized LoggingService singleton at `src/services/loggingService.ts`

**Usage:**
- Import the logger instance: `import { logger, LogLevel, LogCategory } from './services/loggingService'`
- Use logger methods instead of console: `logger.info()`, `logger.error()`, `logger.warn()`, `logger.debug()`
- Include LogCategory for organization: `logger.info('Message', LogCategory.AUTH, ...args)`
- Category-specific convenience methods available: `logger.auth()`, `logger.api()`, `logger.websocket()`, `logger.telemetry()`

**Patterns:**
- Info level for normal operations: `logger.info('User logged in', LogCategory.AUTH)`
- Error level for exceptions: `logger.error('Request failed', LogCategory.API, error)`
- Warn level for degraded states: `logger.warn('Connection unstable', LogCategory.WEBSOCKET)`
- Debug level for detailed tracing: `logger.debug('Property value: ' + value, LogCategory.GENERAL)`
- Avoid console.* directly - ESLint enforces this with `no-console: "error"`

**LogCategories:**
```typescript
enum LogCategory {
    GENERAL = 'General',
    WEBSOCKET = 'WebSocket',
    IRIS_CHAT = 'Iris Chat',
    CONTEXT = 'Context',
    EXERCISE = 'Exercise',
    SUBMISSION = 'Submission',
    AUTH = 'Auth',
    API = 'API',
    PLANTUML = 'PlantUML',
    FILE_MONITOR = 'File Monitor',
    TELEMETRY = 'Telemetry',
    SESSION = 'Session',
    BUILD = 'Build',
    TEST = 'Test',
    CONFIG = 'Config',
    VIEW = 'View',
    EXAM = 'Exam'
}
```

## Comments

**When to Comment:**
- Public methods and classes should have JSDoc comments
- Complex algorithms warrant explanation
- Non-obvious workarounds should document why they exist
- Business logic that differs from standard patterns

**JSDoc/TSDoc:**
```typescript
/**
 * Retrieve the server URL from VS Code configuration
 * @returns The configured Artemis server URL or default
 * @throws Never - returns default if not configured
 */
protected getServerUrl(): string { ... }

/**
 * Centralized logging service for the Artemis extension.
 * All logging should go through this service instead of using console.* directly.
 *
 * Features:
 * - Configurable log levels
 * - Category-based filtering
 * - Output channel integration for VS Code
 */
class LoggingService { ... }
```

## Function Design

**Size Guidelines:**
- Most utility functions: 20-50 lines
- Service methods: 30-80 lines
- Complex business logic: split into smaller functions
- No strict limit, but readability is priority

**Parameters:**
- Prefer parameter objects for 3+ arguments: `makeRequest(endpoint, options = {})`
- Use destructuring in function signatures: `const { id, title } = course`
- Optional parameters with defaults: `async initialize(outputChannel?: vscode.OutputChannel)`

**Return Values:**
- Async functions return Promises: `async getCourses(): Promise<CourseDashboardCourse[]>`
- Use union types for results: `Promise<T | null>` for nullable results
- Throw errors rather than returning error objects

## Module Design

**Exports:**
- Named exports for classes and functions: `export class AuthManager { ... }`
- Default exports not used
- Type exports explicitly marked: `export type ChatContextType = ...`
- Barrel files aggregate exports: `src/services/index.ts` re-exports common services

**Barrel Files:**
```typescript
// src/services/index.ts
export { AuthManager } from './auth/auth';
export { ArtemisApiService } from './api/artemisApi';
export { LoggingService, logger, LogLevel, LogCategory } from './services/loggingService';
// ... more exports
```

**Singleton Pattern:**
- Used for services that maintain state: LoggingService, ProviderRegistry
- Private constructor prevents instantiation: `private constructor() { }`
- Static `getInstance()` method: `public static getInstance(): LoggingService { ... }`
- Example: `const logger = LoggingService.getInstance()`

## Class Design

**Constructors:**
- Used to inject dependencies: `constructor(authManager: AuthManager)`
- Avoid side effects in constructors
- Initialize with parameters, not during construction

**Access Modifiers:**
- Public for API surface: `public async getCurrentUser()`
- Protected for internal use by subclasses: `protected getServerUrl()`
- Private for implementation details: `private shouldLog()`
- Readonly for immutable fields: `public readonly status: number`

---

*Convention analysis: 2026-02-23*
