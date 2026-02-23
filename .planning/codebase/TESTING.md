# Testing Patterns

**Analysis Date:** 2026-02-23

## Test Framework

**Runner:**
- Framework: Mocha (via @vscode/test-cli)
- Version: Part of VS Code Test infrastructure
- Config: `@vscode/test-cli` v0.0.12
- Test execution: `vscode-test` command

**Test Types:**
- Unit tests labeled: `unit`
- E2E tests labeled: `e2e`
- Struggle Detection tests: `grep "Struggle Detection"`

**Assertion Library:**
- Built-in Node.js `assert` module: `import * as assert from 'assert'`
- Methods used: `assert.ok()`, `assert.strictEqual()`, `assert.deepStrictEqual()`, `assert.throws()`
- No external assertion library (Chai, Jest matchers, etc.)

**Run Commands:**
```bash
npm test                      # Run all unit tests
npm run test:coverage         # Run unit tests with coverage report
npm run test:struggle         # Run Struggle Detection tests only
npm run test:e2e             # Run E2E tests
npm run test:all             # Run all tests (unit + E2E) with linting
npm run coverage:all         # Full suite with coverage
```

## Test File Organization

**Location:**
- Co-located with source under `test/` mirror structure
- Example: `src/auth/auth.ts` → `test/auth/auth.test.ts`
- Example: `src/models/core.ts` → `test/models/artemis.test.ts`
- Example: `src/utils/buildLogParser.ts` → `test/utils/buildLogParser.test.ts`
- Mock utilities in `test/mocks/` directory

**Naming:**
- Test files use `.test.ts` suffix: `auth.test.ts`, `buildLogParser.test.ts`
- Test suites use descriptive names: `'AuthManager Test Suite'`, `'BuildLogParser Test Suite'`
- Individual tests use clear descriptions: `'should store and retrieve credentials'`

**Directory Structure:**
```
test/
├── auth/
│   └── auth.test.ts
├── models/
│   ├── artemis.test.ts
│   ├── context.test.ts
│   └── telemetry.test.ts
├── api/
│   └── artemisApi.test.ts
├── provider/
│   ├── artemisWebviewProvider.test.ts
│   ├── contextStore.test.ts
│   └── exerciseRegistry.test.ts
├── utils/
│   ├── buildLogParser.test.ts
│   ├── plantUmlProcessor.test.ts
│   ├── pathUtils.test.ts
│   └── workspaceFileChecker.test.ts
├── struggle-detection/
│   ├── struggleDetection.test.ts
│   ├── errorQuotientEngine.test.ts
│   ├── boundaryTriggerAndCadence.test.ts
│   ├── ScenarioLoader.ts
│   ├── EvaluationEngine.ts
│   └── types.ts
└── mocks/
    └── vscodeMocks.ts
```

## Test Structure

**Suite Organization:**
```typescript
import * as assert from 'assert';
import { AuthManager } from '../../src/auth/auth';
import { MockExtensionContext } from '../mocks/vscodeMocks';

suite('AuthManager Test Suite', () => {
    let context: MockExtensionContext;
    let authManager: AuthManager;

    setup(() => {
        // Run before each test
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
    });

    test('should store and retrieve credentials', async () => {
        // Arrange
        const jwt = 'jwt=12345';
        const url = 'https://artemis.example.com';

        // Act
        await authManager.storeArtemisCredentials(jwt, url, true);
        const storedJwt = await context.secrets.get('artemis-token');

        // Assert
        assert.strictEqual(storedJwt, jwt);
    });

    teardown(() => {
        // Run after each test
        // Cleanup if needed
    });
});
```

**Patterns:**
- `suite()` - Create a test suite (replaces describe)
- `setup()` - Run before each test (replaces beforeEach)
- `teardown()` - Run after each test (replaces afterEach)
- `test()` - Define individual test (replaces it)
- Arrange-Act-Assert pattern used throughout

## Mocking

**Framework:** Custom mock classes in `test/mocks/vscodeMocks.ts`

**Mock Classes Provided:**
- `MockSecretStorage` - Implements `vscode.SecretStorage`
- `MockMemento` - Implements `vscode.Memento`
- `MockExtensionContext` - Implements `vscode.ExtensionContext`
- `MockTextDocument` - Implements `vscode.TextDocument`

**Patterns:**

```typescript
// Using MockExtensionContext for dependency injection
class MockAuthManager extends AuthManager {
    constructor(context: vscode.ExtensionContext) {
        super(context);
    }
}

const mockContext = new MockExtensionContext();
const authManager = new MockAuthManager(mockContext);
await authManager.storeArtemisCredentials(jwt, url, true);
const stored = await mockContext.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
```

**Mocking fetch:**
```typescript
const originalFetch = global.fetch;
let mockFetch: any;

suite('API Test', () => {
    setup(() => {
        mockFetch = async (url: string, options: any) => ({
            ok: true,
            status: 200,
            json: async () => ({}),
            text: async () => '',
        });
        global.fetch = mockFetch;
    });

    teardown(() => {
        global.fetch = originalFetch;
    });

    test('should call API endpoint', async () => {
        global.fetch = async (url: any, options: any) => {
            assert.strictEqual(url, 'expected-url');
            return { ok: true, status: 200, json: async () => ({}) };
        };
        // Test continues
    });
});
```

**What to Mock:**
- VS Code APIs (ExtensionContext, SecretStorage, etc.)
- Global fetch for API calls
- Services with external dependencies
- File system operations

**What NOT to Mock:**
- Model classes (ArtemisUser, ArtemisCourse, etc.)
- Pure utility functions (parsers, formatters)
- Error classes
- Type conversions (fromJSON methods)

## Fixtures and Factories

**Test Data:**
```typescript
// Using helper functions to create test entities
function createLogEntry(log: string): BuildLogEntry {
    return new BuildLogEntry(1, new Date().toISOString(), log);
}

test('should parse Gradle error format', () => {
    const log = 'src/de/tum/in/ase/eist/BubbleSort.java:15: error: cannot find symbol';
    const entries = [createLogEntry(log)];

    const result = BuildLogParser.parseFirstError(entries);

    assert.ok(result);
    assert.strictEqual(result?.filePath, 'src/de/tum/in/ase/eist/BubbleSort.java');
});
```

**Model Construction:**
```typescript
// Creating test models with fromJSON pattern
const user = ArtemisUser.fromJSON({
    login: 'testuser',
    id: 1,
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.com',
    activated: true
});

const course = ArtemisCourse.fromJSON({
    id: 1,
    title: 'CS101',
    shortName: 'CS1',
    description: 'Computer Science 101'
});
```

**Location:**
- Fixtures co-located in test files where used
- No separate fixtures directory or factory pattern library
- Helpers defined inline in test suites
- Specialized tests (struggle-detection) have dedicated helper files: `test/struggle-detection/ScenarioLoader.ts`

## Coverage

**Requirements:** No enforced minimum

**View Coverage:**
```bash
npm run test:coverage      # Generate coverage report for unit tests
npm run coverage:all       # Generate coverage for full test suite
```

**Coverage Tools:**
- Built into @vscode/test-cli
- Output format: Standard coverage directory (likely `coverage/` or similar)
- No coverage thresholds configured

## Test Types

**Unit Tests:**
- Scope: Individual classes and functions
- Approach: Test methods in isolation with mocked dependencies
- Examples: `test/auth/auth.test.ts`, `test/api/artemisApi.test.ts`
- Focus on behavior verification

**Integration Tests:**
- Scope: Multiple components working together
- Approach: Use mocked VS Code APIs but real service logic
- Examples: `test/provider/artemisWebviewProvider.test.ts`, `test/provider/contextStore.test.ts`
- Verify component interactions

**E2E Tests:**
- Framework: Part of test suite (separate label `e2e`)
- Run with: `npm run test:e2e`
- Scope: Full extension startup and user workflows
- May use VS Code test extension infrastructure

**Struggle Detection Tests:**
- Specialized test suite focusing on telemetry and struggle detection
- Run with: `npm run test:struggle`
- Located in: `test/struggle-detection/`
- Uses helper utilities: `ScenarioLoader.ts`, `EvaluationEngine.ts`

## Common Patterns

**Async Testing:**
```typescript
test('should store and retrieve credentials', async () => {
    // Mark test as async
    const jwt = 'jwt=12345';

    // Await async operations
    await authManager.storeArtemisCredentials(jwt, url, true);
    const stored = await context.secrets.get(key);

    // Assert after awaiting
    assert.strictEqual(stored, jwt);
});
```

**Error Testing:**
```typescript
test('should throw on invalid input', () => {
    // Use assert.throws for error verification
    assert.throws(() => ProfileInfo.fromJSON(null), /Invalid/);
    assert.throws(() => ProfileInfo.fromJSON(undefined), /Invalid/);
});

test('should handle API errors', async () => {
    global.fetch = async () => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
    } as any);

    try {
        await apiService.getCurrentUser();
        assert.fail('Should have thrown error');
    } catch (error: unknown) {
        assert.ok(error instanceof ApiError);
        assert.strictEqual(error.status, 401);
    }
});
```

**Checking instanceof:**
```typescript
test('ApiError is catchable as Error', () => {
    try {
        throw new ApiError('fail', 500);
    } catch (e) {
        assert.ok(e instanceof Error);
        assert.ok(e instanceof ApiError);
    }
});
```

**Optional Field Testing:**
```typescript
test('handles missing optional fields', () => {
    const p = ProfileInfo.fromJSON({ activeProfiles: ['dev'] });
    assert.deepStrictEqual(p.activeProfiles, ['dev']);
    assert.strictEqual(p.ribbonEnv, undefined);
    assert.strictEqual(p.inProduction, undefined);
});
```

**Model fromJSON Testing:**
Models follow a consistent pattern tested extensively:
```typescript
test('parses complete valid JSON', () => {
    const p = ProfileInfo.fromJSON({
        activeProfiles: ['prod', 'iris'],
        ribbonEnv: 'prod',
        inProduction: true,
    });
    assert.ok(p instanceof ProfileInfo);
    assert.deepStrictEqual(p.activeProfiles, ['prod', 'iris']);
    assert.strictEqual(p.ribbonEnv, 'prod');
    assert.strictEqual(p.inProduction, true);
});

test('throws on invalid input', () => {
    assert.throws(() => ProfileInfo.fromJSON(null), /Invalid/);
    assert.throws(() => ProfileInfo.fromJSON(undefined), /Invalid/);
});
```

## Test Statistics

- **Total test files:** 28 `.test.ts` files across the codebase
- **Test suites:** Organized by feature area (auth, models, api, providers, utils, struggle-detection)
- **Coverage approach:** Comprehensive model testing with fromJSON patterns
- **Focus areas:**
  - Authentication and credential management
  - Data model serialization/deserialization
  - API error handling
  - Context and state management
  - Struggle detection algorithms

---

*Testing analysis: 2026-02-23*
