# React Test Helpers

Test utilities for React component and store testing in the VS Code webview context.

## Helpers

### createMockVsCodeApi(overrides?)

Creates a mock VS Code API object for testing webview components.

**Usage:**

```typescript
import { createMockVsCodeApi } from '@test/react/__helpers__/vscodeApi';

const mockApi = createMockVsCodeApi();
render(<MyComponent vscodeApi={mockApi} />);

// With overrides
const mockApi = createMockVsCodeApi({
  getState: vi.fn(() => ({ username: 'testuser' })),
});
```

**Override pattern:**

```typescript
const mockApi = createMockVsCodeApi({
  postMessage: vi.fn((msg) => console.log('Message sent:', msg)),
  getState: vi.fn(() => myPersistedState),
  setState: vi.fn(),
});
```

### dispatchExtensionMessage(message)

Dispatches a message from the extension to the webview, simulating extension-to-webview communication.

**Usage:**

```typescript
import { dispatchExtensionMessage } from '@test/react/__helpers__/vscodeApi';

// Typed format (preferred)
dispatchExtensionMessage({
  type: 'showLoading',
  payload: { message: 'Loading...' },
});

// Legacy command format
dispatchExtensionMessage({
  command: 'loginError',
  error: 'Invalid credentials',
});
```

**Note:** Components listen for these messages via `window.addEventListener('message', handler)`.

### renderWithProviders(ui, options?)

Custom render function that wraps React Testing Library's render with VS Code webview API support.

**Usage:**

```typescript
import { renderWithProviders } from '@test/react/__helpers__/renderWithProviders';

const { vscodeApi } = renderWithProviders(<MyComponent />, {
  vscodeApi: customMockApi, // optional
});

// Use returned vscodeApi for assertions
expect(vscodeApi.postMessage).toHaveBeenCalled();
```

## Patterns

### Testing Components

Standard component test pattern with React Testing Library:

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@webview/components/Button';

it('calls onClick when clicked', async () => {
  const handleClick = vi.fn();
  render(<Button onClick={handleClick}>Click me</Button>);

  await userEvent.click(screen.getByRole('button'));

  expect(handleClick).toHaveBeenCalledOnce();
});
```

### Testing Zustand Stores

Store test pattern with beforeEach reset to ensure isolation:

```typescript
import { renderHook, act } from '@testing-library/react';
import { useDashboardStore } from '@webview/stores/useDashboardStore';

beforeEach(() => {
  useDashboardStore.setState({
    recentCourses: [],
    isLoading: false,
    error: null,
  });
});

it('sets loading state when loadDashboard called', () => {
  const { result } = renderHook(() => useDashboardStore());
  const mockApi = createMockVsCodeApi();

  act(() => {
    result.current.loadDashboard(mockApi);
  });

  expect(result.current.isLoading).toBe(true);
});
```

### Testing Bridge Communication

**Outgoing messages (webview → extension):**

```typescript
it('sends login command via postMessage', async () => {
  const mockApi = createMockVsCodeApi();
  render(<LoginView vscodeApi={mockApi} />);

  await userEvent.click(screen.getByRole('button', { name: /login/i }));

  expect(mockApi.postMessage).toHaveBeenCalledWith({
    type: 'command',
    command: 'login',
    payload: expect.objectContaining({ username: 'user' }),
  });
});
```

**Incoming messages (extension → webview):**

```typescript
it('shows loading state on showLoading message', async () => {
  render(<LoginView vscodeApi={mockApi} />);

  dispatchExtensionMessage({
    type: 'showLoading',
    payload: { message: 'Loading...' },
  });

  await waitFor(() => {
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
```

### Testing with Persisted State

Mock `getState` to simulate restored state:

```typescript
it('restores persisted state from getState', () => {
  const mockApi = createMockVsCodeApi({
    getState: vi.fn(() => ({
      username: 'saved-user',
      rememberMe: true,
    })),
  });

  render(<LoginView vscodeApi={mockApi} />);

  const usernameInput = screen.getByTestId('username') as HTMLInputElement;
  expect(usernameInput.value).toBe('saved-user');
});
```

> **Note:** Passwords must never be included in persisted state.
> They are only held in React component state for the duration of the login form submission.

## Anti-Patterns

- **Don't test implementation details** (internal state, CSS class names)
- **Always await userEvent interactions** (e.g., `await userEvent.click(...)`)
- **Always reset store state in beforeEach** to prevent cross-test pollution
- **Use screen queries, not container** for better accessibility-focused tests
- **Don't test CSS module class names** — they're hashed in production and may be identity-proxied in tests
- **Focus on behavior** — interactions, DOM structure, aria attributes, not styling
