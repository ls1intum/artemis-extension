# Phase 10: Testing Infrastructure - Research

**Researched:** 2026-02-25
**Domain:** React component testing with Vitest, React Testing Library, and VS Code webview mocking
**Confidence:** HIGH

## Summary

This research covers establishing a comprehensive testing foundation for React components in VS Code webviews using Vitest as the test runner, React Testing Library for component testing, happy-dom as the DOM environment, and custom mocking patterns for the VS Code webview bridge (`acquireVsCodeApi`).

Vitest 4.x is the current standard for React testing in 2026, offering exceptional speed, native ESM support, Jest-compatible APIs, and built-in TypeScript support. When paired with React Testing Library, it encourages testing components from a user's perspective rather than implementation details. The happy-dom environment provides a faster, lighter alternative to jsdom for browser API emulation.

The key technical challenge for this phase is mocking the VS Code webview API (`acquireVsCodeApi`, `postMessage`) in a way that's reusable across tests while allowing test-specific overrides. The research identifies proven patterns from the VS Code extension ecosystem and React testing community.

**Primary recommendation:** Use Vitest 4.x with happy-dom environment, React Testing Library 16.x with user-event for interactions, global VS Code API mocks in setup files with per-test override capability, CSS module identity proxy pattern, and a custom `renderWithProviders` helper that wraps Zustand stores for consistent test setup.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Test directory structure:**
- Reorganize existing tests into `test/unit/` (current extension unit tests) and `test/e2e/` (current e2e + UI/Playwright tests)
- New React tests go in `test/react/` with paths mirroring `src/views/webview/react/` structure
- Example: `test/react/components/Button/Button.test.tsx` mirrors `src/views/webview/react/components/Button/Button.tsx`
- Zustand store tests live in `test/react/stores/` (part of React test tree)
- Test helpers for React tests in `test/react/__helpers__/`
- Cross-runner shared helpers in `test/__shared__/`
- File naming: `ComponentName.test.tsx` (matches existing `.test.ts` convention)

**npm script naming:**
- Rename existing scripts to match new structure:
  - `test:unit` (was `test`) — runs vscode-test unit tests from `test/unit/`
  - `test:e2e` — combines old `test:e2e` + `test:ui` from `test/e2e/`
  - `test:react` — new Vitest runner for React component tests
  - `test:react:coverage` — Vitest with coverage
  - `test:all` — runs all test suites
- Update `.vscode-test.mjs` configuration to point at new `test/unit/` and `test/e2e/` paths

**Sample test targets:**
- **Button component** — primary sample test validating rendering, click handlers, variant props
- **One Zustand store** (e.g. useDashboardStore) — validates store testing patterns
- **One bridge-using component** (e.g. LoginView) — validates postMessage mock and webview bridge patterns end-to-end
- Tests should include **meaningful assertions** (interactions, state changes, message payloads), not just smoke/render tests

**Coverage policy:**
- Coverage reporting enabled via `test:react:coverage` script
- **No thresholds enforced** in Phase 10 — thresholds deferred to Phase 13 when real coverage exists
- Reporters: text (terminal) + HTML (browsable) + lcov (CI/IDE gutters)
- Coverage scope includes both components (.tsx) and Zustand stores (.ts)
- Coverage output directory gitignored

**Webview bridge mocking:**
- `acquireVsCodeApi` defined as **global mock** in Vitest setup file — all tests get it automatically, override per-test if needed
- `postMessage` is a **vi.fn() spy** — tests can assert on messages sent, payloads, and call counts
- `dispatchExtensionMessage()` **helper function** for simulating incoming messages from the extension host (typed window `message` events)
- CSS module imports handled with **identity proxy** pattern (class names returned as-is)
- Custom **`renderWithProviders()`** wrapper that sets up Zustand store providers and common context
- Mock patterns documented in dedicated **README** at `test/react/__helpers__/README.md`

### Claude's Discretion

- Whether to auto-mock the `vscode` module — Claude should analyze if any React-side code transitively imports it and decide accordingly
- Exact Vitest configuration details (plugins, transforms, resolve aliases)
- Happy-dom configuration specifics
- How to handle the existing `test/ui/run-tests.sh` migration to `test/e2e/`
- Test timeout values

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

This phase addresses TEST-01 from REQUIREMENTS.md:

| ID | Description | Research Support |
|----|-------------|-----------------|
| TEST-01 | Vitest + React Testing Library + happy-dom configured with VS Code API mocks and test:react script | Standard Stack section provides library versions and configuration patterns; Architecture Patterns section documents webview bridge mocking, renderWithProviders helper, and directory structure; Code Examples demonstrate complete setup files |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.0.18 | Test runner | Blazing-fast Vite-native test framework with Jest-compatible API, native ESM support, TypeScript integration out of the box, and stable Browser Mode (2026 standard for React testing) |
| @testing-library/react | ^16.3.2 | Component testing utilities | Official React adapter for Testing Library philosophy, encourages testing components the way users interact with them, focuses on behavior over implementation details |
| @testing-library/user-event | ^14.x | User interaction simulation | Simulates full user interactions (focus, keyboard, selection) rather than just dispatching events, provides realistic testing that matches browser behavior |
| @testing-library/jest-dom | ^6.9.1 | Custom matchers | Provides semantic matchers (toBeInTheDocument, toBeDisabled, toHaveTextContent) that improve test readability and error messages |
| happy-dom | ^20.7.0 | DOM environment | Faster and lighter than jsdom, emulates browser APIs with better performance for test execution, officially supported by Vitest |
| @vitejs/plugin-react | ^5.1.4 | React JSX transform | Official Vite plugin for React Fast Refresh and JSX transformation in test environment |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @vitest/coverage-v8 | ^4.0.18 | Coverage provider | Use when coverage reporting is needed (v8 is default and faster than istanbul) |
| @vitest/ui | ^4.0.18 | Browser-based test UI | Optional: use for visual test debugging and exploration (adds ~2MB to dev dependencies) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| happy-dom | jsdom | jsdom is more mature with broader API coverage but slower and heavier; happy-dom is faster with 90%+ feature parity for React testing |
| @testing-library/user-event | fireEvent | fireEvent is simpler (just dispatches events) but less realistic; user-event simulates full interactions including focus, visibility checks, and multi-event sequences |
| Vitest | Jest | Jest has larger ecosystem and more tutorials but slower test execution and requires additional config for ESM/TypeScript; Vitest is Vite-native with zero-config TypeScript support |

**Installation:**

```bash
npm install --save-dev vitest @vitejs/plugin-react happy-dom \
  @testing-library/react @testing-library/user-event @testing-library/jest-dom \
  @vitest/coverage-v8
```

## Architecture Patterns

### Recommended Project Structure

```
test/
├── unit/                    # Extension host unit tests (vscode-test)
├── e2e/                     # E2E + UI tests (vscode-test + Playwright)
├── react/                   # React component tests (Vitest)
│   ├── __helpers__/         # Test utilities specific to React tests
│   │   ├── vscodeApi.ts     # VS Code API mock factory
│   │   ├── renderWithProviders.tsx  # Custom render wrapper
│   │   └── README.md        # Mock pattern documentation
│   ├── components/          # Component tests (mirrors src structure)
│   │   └── Button/
│   │       └── Button.test.tsx
│   └── stores/              # Zustand store tests
│       └── useDashboardStore.test.ts
└── __shared__/              # Utilities shared across runners
```

### Pattern 1: Global VS Code API Mock with Per-Test Override

**What:** Define a default `acquireVsCodeApi` mock globally in Vitest setup file, allowing individual tests to override behavior when needed.

**When to use:** For all React component tests that may directly or indirectly use the VS Code API.

**Example:**

```typescript
// test/react/__helpers__/vscodeApi.ts
import { vi } from 'vitest';
import type { VsCodeApi } from '../../../src/shared/messageContracts';

export function createMockVsCodeApi(overrides?: Partial<VsCodeApi>): VsCodeApi {
  return {
    postMessage: vi.fn(),
    getState: vi.fn(() => undefined),
    setState: vi.fn(),
    ...overrides,
  };
}

// vitest.setup.ts
import { createMockVsCodeApi } from './test/react/__helpers__/vscodeApi';

const mockVsCodeApi = createMockVsCodeApi();

global.window = {
  ...global.window,
  acquireVsCodeApi: () => mockVsCodeApi,
};

// Usage in test - override when needed
test('sends message on button click', () => {
  const customVsCodeApi = createMockVsCodeApi({
    postMessage: vi.fn((msg) => console.log('Custom handler:', msg)),
  });

  global.window.acquireVsCodeApi = () => customVsCodeApi;

  // Test component that uses vscodeApi
});
```

**Source:** [VS Code Webview API Documentation](https://code.visualstudio.com/api/extension-guides/webview), [Dev.to: VsCode extension using webview and message posting](https://dev.to/coderallan/vscode-extension-using-webview-and-message-posting-5435)

### Pattern 2: Simulating Extension-to-Webview Messages

**What:** Helper function to dispatch incoming messages from the extension host, triggering webview message event listeners.

**When to use:** When testing components that listen for messages from the extension (e.g., data updates, navigation commands).

**Example:**

```typescript
// test/react/__helpers__/vscodeApi.ts
import type { ExtensionToWebviewMessage } from '../../../src/shared/messageContracts';

export function dispatchExtensionMessage(message: ExtensionToWebviewMessage) {
  const messageEvent = new MessageEvent('message', {
    data: message,
    origin: 'vscode-webview://test',
  });
  window.dispatchEvent(messageEvent);
}

// Usage in test
test('updates dashboard when receiving data', async () => {
  render(<DashboardView vscodeApi={mockVsCodeApi} />);

  dispatchExtensionMessage({
    type: 'dashboardData',
    payload: { recentCourses: [...] },
  });

  await waitFor(() => {
    expect(screen.getByText('Course 1')).toBeInTheDocument();
  });
});
```

**Source:** Derived from [MDN MessageEvent documentation](https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent) and VS Code webview message passing patterns.

### Pattern 3: CSS Module Identity Proxy

**What:** Return CSS class names as-is during tests instead of hashed values, allowing simple className assertions.

**When to use:** Always, unless testing actual CSS-in-JS logic (not applicable for CSS modules).

**Example:**

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    // Vitest handles CSS modules automatically with identity-like behavior
    // No additional config needed for basic cases
  },
});

// Alternative: explicit mock if needed
// vitest.config.ts
export default defineConfig({
  resolve: {
    alias: {
      '\\.module\\.css$': 'identity-obj-proxy',
    },
  },
});
```

**Note:** Vitest 4.x has built-in CSS module support with proxy-like behavior. For most cases, no additional configuration is needed. If explicit identity mapping is required, use resolve.alias instead of Jest's moduleNameMapper.

**Source:** [Vitest GitHub Discussion #1180](https://github.com/vitest-dev/vitest/discussions/1180), [SitePoint: Vitest vs Jest 2026](https://www.sitepoint.com/vitest-vs-jest-2026-migration-benchmark/)

### Pattern 4: Custom Render with Zustand Providers

**What:** Wrapper around React Testing Library's `render` that automatically provides Zustand store context and VS Code API.

**When to use:** For all component tests to ensure consistent test setup and reduce boilerplate.

**Example:**

```typescript
// test/react/__helpers__/renderWithProviders.tsx
import { render, RenderOptions } from '@testing-library/react';
import { ReactElement } from 'react';
import type { VsCodeApi } from '../../../src/shared/messageContracts';
import { createMockVsCodeApi } from './vscodeApi';

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  vscodeApi?: VsCodeApi;
  initialStoreState?: Record<string, unknown>;
}

export function renderWithProviders(
  ui: ReactElement,
  {
    vscodeApi = createMockVsCodeApi(),
    initialStoreState = {},
    ...renderOptions
  }: CustomRenderOptions = {}
) {
  // Set up any Zustand store initial state if needed
  Object.entries(initialStoreState).forEach(([storeName, state]) => {
    // Store-specific initialization logic
  });

  return {
    ...render(ui, renderOptions),
    vscodeApi,
  };
}

// Re-export everything from React Testing Library
export * from '@testing-library/react';
export { userEvent } from '@testing-library/user-event';
```

**Source:** [Medium: Custom rendering in React Testing Library Done Right](https://medium.com/nmc-techblog/custom-rendering-in-react-testing-library-done-right-e260e01ba6f7), [GitHub Gist: Wrapper with Providers](https://gist.github.com/LauraBeatris/f43cda835ab3668084ec235fe66f0a56)

### Pattern 5: Zustand Store Testing

**What:** Test Zustand stores in isolation by importing the hook, calling store actions, and asserting on state changes.

**When to use:** For testing complex store logic, async actions, and state transformations without rendering components.

**Example:**

```typescript
// test/react/stores/useDashboardStore.test.ts
import { renderHook, act } from '@testing-library/react';
import { useDashboardStore } from '../../../src/views/webview/react/stores/useDashboardStore';
import { createMockVsCodeApi } from '../__helpers__/vscodeApi';

describe('useDashboardStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useDashboardStore.setState({
      recentCourses: [],
      workspaceExercise: null,
      isLoading: false,
      error: null
    });
  });

  test('sets loading state when loading dashboard', () => {
    const { result } = renderHook(() => useDashboardStore());
    const vscodeApi = createMockVsCodeApi();

    act(() => {
      result.current.loadDashboard(vscodeApi);
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'command',
      command: 'reloadDashboard',
    });
  });
});
```

**Source:** [Zustand Testing Guide](https://zustand.docs.pmnd.rs/guides/testing), [GitHub Discussion #3018](https://github.com/pmndrs/zustand/discussions/3018)

### Anti-Patterns to Avoid

- **Testing implementation details:** Don't assert on internal state, class names, or component structure. Test observable behavior and user interactions instead. (Source: [Kent C. Dodds: Common mistakes with React Testing Library](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library))
- **Using `container` instead of `screen`:** Always use `screen` for queries to avoid stale references and simplify test maintenance.
- **Not awaiting async interactions:** Forgetting to await `userEvent` actions or `waitFor` assertions leads to "act(...)" warnings and flaky tests.
- **Sharing global state between tests:** Always reset mocks, timers, and store state in `beforeEach` to ensure test isolation.
- **Testing too many scenarios in one test:** Write focused tests with clear arrange-act-assert structure. Use descriptive test names.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| User interaction simulation | Custom click/type helpers | @testing-library/user-event | Handles focus, keyboard events, selection, visibility checks, and browser quirks — implementing this correctly requires hundreds of edge cases |
| DOM matchers | Custom expect extensions | @testing-library/jest-dom | Provides semantic matchers (toBeInTheDocument, toHaveTextContent) with clear error messages and accessibility-aware queries |
| Test environment | Custom jsdom wrapper | happy-dom (via Vitest) | Handles browser API mocking, performance optimization, and compatibility — maintaining a DOM environment is a full-time project |
| VS Code API type safety | Manual type guards | Import VsCodeApi from messageContracts.ts | The project already has typed message contracts; reusing them ensures type safety and prevents drift |

**Key insight:** React component testing has mature, battle-tested solutions. The ecosystem has solved problems like realistic user interactions, DOM querying, and environment setup at scale. Custom solutions miss edge cases and create maintenance burden.

## Common Pitfalls

### Pitfall 1: Forgetting to Reset Zustand Store State Between Tests

**What goes wrong:** Store state from one test persists into the next, causing tests to pass in isolation but fail when run together.

**Why it happens:** Zustand stores are module-scoped singletons. Vitest's default test isolation doesn't reset imported modules between tests in the same file.

**How to avoid:** Always reset store state in `beforeEach`:

```typescript
beforeEach(() => {
  useDashboardStore.setState({
    recentCourses: [],
    isLoading: false,
    error: null
  });
});
```

Or use Zustand's store reset pattern if you have many stores.

**Warning signs:** Tests pass individually but fail when run together; flaky test failures; unexpected initial state in tests.

**Source:** [GitHub Discussion #1829: vitest: Resetting state between tests](https://github.com/pmndrs/zustand/discussions/1829)

### Pitfall 2: Not Awaiting `userEvent` Interactions

**What goes wrong:** Test completes before React updates finish, causing "act(...)" warnings or missed assertions.

**Why it happens:** `userEvent` methods return promises that must be awaited. Forgetting `await` allows the test to proceed before state updates commit.

**How to avoid:** Always `await` userEvent calls and use `waitFor` for assertions on async state changes:

```typescript
// Wrong
userEvent.click(button);
expect(mockFn).toHaveBeenCalled();

// Correct
await userEvent.click(button);
await waitFor(() => expect(mockFn).toHaveBeenCalled());
```

**Warning signs:** Console warnings about "act(...)", intermittent test failures, assertions that should pass but don't.

**Source:** [Medium: React Testing Library + Vitest: The Mistakes That Bite](https://medium.com/@samueldeveloper/react-testing-library-vitest-the-mistakes-that-haunt-developers-and-how-to-fight-them-like-ca0a0cda2ef8)

### Pitfall 3: Testing VS Code API Calls Without Message Type Safety

**What goes wrong:** Tests assert on message structure but don't catch type mismatches that would fail at runtime.

**Why it happens:** Using `any` or loose object matching instead of importing actual message types.

**How to avoid:** Import message contracts and use them in test assertions:

```typescript
import type { WebviewToExtensionMessage } from '../../../src/shared/messageContracts';

expect(mockVsCodeApi.postMessage).toHaveBeenCalledWith<WebviewToExtensionMessage>({
  type: 'command',
  command: 'reloadDashboard',
});
```

**Warning signs:** Tests pass but runtime errors occur; refactoring message contracts doesn't break tests; IDE doesn't autocomplete message types in tests.

**Source:** Derived from TypeScript best practices and project's existing message contract architecture.

### Pitfall 4: Improper TypeScript Configuration for Vitest Globals

**What goes wrong:** TypeScript errors like "Cannot find name 'describe'" or "Property 'toBeInTheDocument' does not exist on type 'Assertion'".

**Why it happens:** TypeScript doesn't know about Vitest's global test functions or jest-dom matchers without explicit type imports.

**How to avoid:** Add types to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  }
}
```

And enable globals in `vitest.config.ts`:

```typescript
export default defineConfig({
  test: {
    globals: true,
  },
});
```

**Warning signs:** Red squiggles in test files despite passing tests; no autocomplete for test functions; manual imports of `describe`/`it`/`expect` in every file.

**Source:** [DEV.to: Mastering Vitest + React Testing Library: Fixing beforeEach, toBeInTheDocument, and JSDOM Gotchas](https://dev.to/cristiansifuentes/mastering-vitest-react-testing-library-fixing-beforeeach-tobeinthedocument-and-jsdom-2379), [Vitest Config: globals](https://vitest.dev/config/globals)

### Pitfall 5: Mixing Test Runner Commands (vscode-test vs Vitest)

**What goes wrong:** Trying to run React tests with `npm test` (vscode-test) or vice versa, leading to config mismatches or missing dependencies.

**Why it happens:** Project has two separate test runners: vscode-test for extension host tests, Vitest for React tests.

**How to avoid:** Use dedicated npm scripts and keep configurations separate:

- `test:unit` → vscode-test for extension tests
- `test:react` → Vitest for React component tests
- `test:all` → Sequential execution of both runners

**Warning signs:** "Cannot find module" errors when switching test commands; tests fail to discover in one runner but work in another.

**Source:** User context decision to maintain separate test runners for different test types.

## Code Examples

Verified patterns from official sources:

### Complete Vitest Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./test/react/__helpers__/vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/views/webview/react/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        '**/index.ts',
        '**/types.ts',
      ],
    },
    include: ['test/react/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

**Source:** [Vitest Config Reference](https://vitest.dev/config/), [NextJS Testing Guide](https://nextjs.org/docs/app/guides/testing/vitest)

### Vitest Setup File

```typescript
// test/react/__helpers__/vitest.setup.ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { createMockVsCodeApi } from './vscodeApi';

// Clean up after each test
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Global VS Code API mock
const mockVsCodeApi = createMockVsCodeApi();

Object.defineProperty(global.window, 'acquireVsCodeApi', {
  writable: true,
  value: () => mockVsCodeApi,
});
```

**Source:** [Testing Library Setup Guide](https://testing-library.com/docs/react-testing-library/setup), [Vitest Setup Files](https://vitest.dev/config/#setupfiles)

### Sample Button Component Test

```typescript
// test/react/components/Button/Button.test.tsx
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Button } from '../../../../src/views/webview/react/components/Button/Button';
import { describe, it, expect, vi } from 'vitest';

describe('Button', () => {
  it('renders with correct text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('calls onClick handler when clicked', async () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);

    await userEvent.click(screen.getByText('Click me'));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('applies primary variant styles by default', () => {
    render(<Button>Submit</Button>);
    const button = screen.getByText('Submit');
    expect(button).toHaveClass('btnPrimary');
  });

  it('applies secondary variant styles when specified', () => {
    render(<Button variant="secondary">Cancel</Button>);
    const button = screen.getByText('Cancel');
    expect(button).toHaveClass('btnSecondary');
  });

  it('disables button when disabled prop is true', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByText('Disabled')).toBeDisabled();
  });

  it('renders icon-only button with correct aria-label', () => {
    const icon = <span>🔍</span>;
    render(<Button icon={icon} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'button');
  });

  it('renders button with icon and label together', () => {
    const icon = <span data-testid="icon">🔍</span>;
    render(<Button icon={icon}>Search</Button>);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
  });
});
```

**Source:** [OneUpTime: How to Unit Test React Components with Vitest](https://oneuptime.com/blog/post/2026-01-15-unit-test-react-vitest-testing-library/view), [Robin Wieruch: Vitest with React Testing Library](https://www.robinwieruch.de/vitest-react-testing-library/)

### Sample Store Test

```typescript
// test/react/stores/useDashboardStore.test.ts
import { renderHook, act } from '@testing-library/react';
import { useDashboardStore } from '../../../../src/views/webview/react/stores/useDashboardStore';
import { createMockVsCodeApi } from '../__helpers__/vscodeApi';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('useDashboardStore', () => {
  beforeEach(() => {
    useDashboardStore.setState({
      recentCourses: [],
      workspaceExercise: null,
      isLoading: false,
      error: null
    });
  });

  it('initializes with empty state', () => {
    const { result } = renderHook(() => useDashboardStore());

    expect(result.current.recentCourses).toEqual([]);
    expect(result.current.workspaceExercise).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets loading state when loading dashboard', () => {
    const { result } = renderHook(() => useDashboardStore());
    const vscodeApi = createMockVsCodeApi();

    act(() => {
      result.current.loadDashboard(vscodeApi);
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('sends reloadDashboard command via VS Code API', () => {
    const { result } = renderHook(() => useDashboardStore());
    const vscodeApi = createMockVsCodeApi();

    act(() => {
      result.current.loadDashboard(vscodeApi);
    });

    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'command',
      command: 'reloadDashboard',
    });
  });

  it('sorts and limits courses to 3 most recent', () => {
    const { result } = renderHook(() => useDashboardStore());
    const courses = [
      { courseData: { course: { title: 'Old Course', startDate: '2024-01-01' } }, exercises: [] },
      { courseData: { course: { title: 'New Course', startDate: '2026-01-01' } }, exercises: [] },
      { courseData: { course: { title: 'Mid Course', startDate: '2025-01-01' } }, exercises: [] },
      { courseData: { course: { title: 'Extra Course', startDate: '2025-06-01' } }, exercises: [] },
    ];

    act(() => {
      result.current.setDashboardData(courses);
    });

    expect(result.current.recentCourses).toHaveLength(3);
    expect(result.current.recentCourses[0].courseData.course.title).toBe('New Course');
    expect(result.current.isLoading).toBe(false);
  });
});
```

**Source:** [Zustand Testing Guide](https://zustand.docs.pmnd.rs/guides/testing), [GitHub Gist: Writing unit tests of zustand state management](https://gist.github.com/mustafadalga/475769fcb77b08a813bf5dae0a145027)

### Sample Component Test with VS Code Bridge

```typescript
// test/react/pages/Dashboard.test.tsx (hypothetical LoginView equivalent)
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { LoginView } from '../../../../src/views/webview/react/views/Login';
import { createMockVsCodeApi, dispatchExtensionMessage } from '../__helpers__/vscodeApi';
import { describe, it, expect, vi } from 'vitest';

describe('LoginView with VS Code bridge', () => {
  it('sends login command when form is submitted', async () => {
    const vscodeApi = createMockVsCodeApi();
    render(<LoginView vscodeApi={vscodeApi} />);

    await userEvent.type(screen.getByLabelText(/username/i), 'testuser');
    await userEvent.type(screen.getByLabelText(/password/i), 'testpass');
    await userEvent.click(screen.getByRole('button', { name: /login/i }));

    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'command',
      command: 'login',
      payload: {
        username: 'testuser',
        password: 'testpass',
      },
    });
  });

  it('displays error message when login fails', async () => {
    const vscodeApi = createMockVsCodeApi();
    render(<LoginView vscodeApi={vscodeApi} />);

    // Simulate extension sending error response
    dispatchExtensionMessage({
      type: 'loginResult',
      success: false,
      error: 'Invalid credentials',
    });

    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
    });
  });

  it('navigates to dashboard when login succeeds', async () => {
    const vscodeApi = createMockVsCodeApi();
    render(<LoginView vscodeApi={vscodeApi} />);

    dispatchExtensionMessage({
      type: 'loginResult',
      success: true,
    });

    await waitFor(() => {
      expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
      // Would check for dashboard content or navigation call
    });
  });
});
```

**Source:** Synthesized from [Dev.to: VsCode extension using webview and message posting](https://dev.to/coderallan/vscode-extension-using-webview-and-message-posting-5435) and React Testing Library patterns.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Jest + jsdom | Vitest + happy-dom | 2024-2025 | 2-5x faster test execution, zero-config TypeScript, native ESM support, built-in coverage via v8 |
| fireEvent for interactions | @testing-library/user-event | 2020-2021 | More realistic user interactions with focus/blur/keyboard events, better matches browser behavior |
| Custom test wrappers | Official Testing Library patterns | Ongoing | Standardized `renderWithProviders` pattern reduces boilerplate, easier onboarding for new contributors |
| Jest moduleNameMapper for CSS | Vitest resolve.alias | 2023-2024 | Unified Vite configuration for dev and test, no separate Jest transform config needed |
| Browser Mode as experimental | Browser Mode stable (Vitest 4.0) | 2026 | Visual regression testing, real browser environment option for complex DOM tests |

**Deprecated/outdated:**
- `@testing-library/react-hooks`: Merged into @testing-library/react as of v13.1.0 (use `renderHook` from main package)
- Jest for Vite projects: Requires additional transform setup (babel-jest, ts-jest), slower than Vitest for Vite-based projects
- identity-obj-proxy with Vitest: Built-in CSS module handling in Vitest 4.x makes explicit identity-obj-proxy unnecessary for most cases

**Source:** [Vitest 4.0 Announcement](https://vitest.dev/blog/vitest-4), [SitePoint: Vitest vs Jest 2026](https://www.sitepoint.com/vitest-vs-jest-2026-migration-benchmark/)

## Open Questions

1. **Should we auto-mock the `vscode` module for React tests?**
   - What we know: React code lives in webview context, which doesn't have access to the Node.js `vscode` module
   - What's unclear: Whether any React-side code transitively imports extension host modules (e.g., via shared utilities)
   - Recommendation: Scan imports during Wave 0 planning. If no transitive imports found, skip auto-mocking. If found, set up vi.mock('vscode') with minimal stub to prevent import errors.

2. **How should we handle test timeout values?**
   - What we know: Default Vitest timeout is 5000ms; React component tests typically complete in <100ms; async tests with waitFor may need longer
   - What's unclear: Whether any tests will involve debounced/delayed interactions that need custom timeouts
   - Recommendation: Start with default 5000ms, add per-test `{ timeout: 10000 }` option if specific tests fail due to legitimate slowness (e.g., animation completion, long debounce)

3. **Should we migrate `test/ui/run-tests.sh` or create a new script?**
   - What we know: Existing `test/ui/` uses Playwright via vscode-extension-tester; new structure puts UI tests in `test/e2e/`
   - What's unclear: Whether to preserve `run-tests.sh` as wrapper or inline commands into `test:e2e` npm script
   - Recommendation: Create new `test/e2e/run-tests.sh` that calls both Mocha e2e tests and Playwright UI tests sequentially, keep shell script for CI flexibility

## Sources

### Primary (HIGH confidence)

- [Vitest Official Documentation](https://vitest.dev/) - Configuration, coverage, environment setup (v4.0.17 as of 2026-02-25)
- [Vitest Config Reference](https://vitest.dev/config/) - Complete configuration options including environment, coverage, and CSS handling
- [React Testing Library Documentation](https://testing-library.com/docs/react-testing-library/intro/) - Core testing philosophy and API (v16.3.2)
- [@testing-library/react npm](https://www.npmjs.com/package/@testing-library/react) - Latest version confirmation (16.3.2)
- [@testing-library/jest-dom npm](https://www.npmjs.com/package/@testing-library/jest-dom) - Custom matcher library (v6.9.1)
- [happy-dom npm](https://www.npmjs.com/package/happy-dom) - DOM environment (v20.7.0)
- [@vitejs/plugin-react npm](https://www.npmjs.com/package/@vitejs/plugin-react) - React plugin (v5.1.4)
- [Vitest 4.0 Announcement](https://vitest.dev/blog/vitest-4) - Browser Mode stable, visual regression testing
- [VS Code Webview API Documentation](https://code.visualstudio.com/api/extension-guides/webview) - Official webview messaging patterns
- [Zustand Testing Guide](https://zustand.docs.pmnd.rs/guides/testing) - Official store testing recommendations
- [Vitest Coverage Configuration](https://vitest.dev/config/coverage) - Coverage provider, reporters, include/exclude patterns
- [Vitest globals Configuration](https://vitest.dev/config/globals) - TypeScript setup for global test functions

### Secondary (MEDIUM confidence)

- [NextJS Testing Guide: Vitest](https://nextjs.org/docs/app/guides/testing/vitest) - Production Vitest configuration patterns (verified with official Next.js docs)
- [Kent C. Dodds: Common mistakes with React Testing Library](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library) - Best practices from Testing Library creator
- [OneUpTime: Unit Test React Components with Vitest](https://oneuptime.com/blog/post/2026-01-15-unit-test-react-vitest-testing-library/view) - 2026 article with current patterns
- [Robin Wieruch: Vitest with React Testing Library](https://www.robinwieruch.de/vitest-react-testing-library/) - Comprehensive setup guide
- [SitePoint: Vitest vs Jest 2026](https://www.sitepoint.com/vitest-vs-jest-2026-migration-benchmark/) - Migration guide and performance comparison
- [Medium: Custom rendering in React Testing Library Done Right](https://medium.com/nmc-techblog/custom-rendering-in-react-testing-library-done-right-e260e01ba6f7) - renderWithProviders pattern
- [GitHub Gist: Wrapper with Providers](https://gist.github.com/LauraBeatris/f43cda835ab3668084ec235fe66f0a56) - Community-verified wrapper pattern
- [Dev.to: VsCode extension using webview and message posting](https://dev.to/coderallan/vscode-extension-using-webview-and-message-posting-5435) - VS Code webview messaging patterns
- [Testing Library: User Event vs fireEvent](https://testing-library.com/docs/user-event/intro/) - Interaction API comparison
- [GitHub: Vitest Discussion #1180](https://github.com/vitest-dev/vitest/discussions/1180) - CSS module mocking with Vitest
- [GitHub: Zustand Discussion #3018](https://github.com/pmndrs/zustand/discussions/3018) - Testing Zustand with Vitest and RTL
- [GitHub: Zustand Discussion #1829](https://github.com/pmndrs/zustand/discussions/1829) - Resetting state between tests

### Tertiary (LOW confidence)

- [Medium: React Testing Library + Vitest: The Mistakes That Bite](https://medium.com/@samueldeveloper/react-testing-library-vitest-the-mistakes-that-haunt-developers-and-how-to-fight-them-like-ca0a0cda2ef8) - Common pitfalls (blog post, not official docs, but patterns verified against primary sources)
- [DEV.to: Mastering Vitest + React Testing Library](https://dev.to/cristiansifuentes/mastering-vitest-react-testing-library-fixing-beforeeach-tobeinthedocument-and-jsdom-2379) - TypeScript gotchas (community post, cross-verified with Vitest docs)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All versions verified via npm registry and official docs as of 2026-02-25
- Architecture: HIGH - Patterns sourced from official Testing Library docs, Vitest docs, and Zustand official guides
- Pitfalls: MEDIUM-HIGH - Combination of official documentation warnings and community-reported issues cross-verified with multiple sources

**Research date:** 2026-02-25
**Valid until:** 2026-04-25 (60 days — testing ecosystem stable, Vitest 4.x is current production standard)
