# Phase 16: Integration Test Infrastructure - Research

**Researched:** 2026-02-28
**Domain:** Zustand store reset + VS Code webview bridge test helpers + contract test scaffolding
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Store reset strategy:** Capture-at-import — snapshot each store's state at import time (before any test mutates it) and restore from that snapshot in `beforeEach`. Zero maintenance; new fields are automatically included.
- **Central registry:** One file (`test/react/__helpers__/resetStores.ts` or similar) imports all 9 Zustand stores and resets them. Explicit, easy to debug.
- **Unified reset function:** Bundle stores + mock VsCodeApi into a single `resetTestState()` function that handles both concerns.
- **Global hook placement:** `resetTestState()` runs in a global `beforeEach` in `vitest.setup.ts`. The existing `afterEach` (RTL cleanup + `vi.clearAllMocks()`) stays as-is.
- **Bridge handshake API:** `simulateHandshake(initPayload?)` — a single async function. Simulates extension→webview direction only. Optional `initPayload` dispatches the view-init message after the ready signal. Returns a promise. Wraps dispatch in `act()` internally. Lives in `test/react/__helpers__/`.
- **Contract test scope:** Verify message payload shapes only — each of the 13 state transitions gets a test asserting the correct `ExtensionToWebviewMessage` type discriminant and typed payload shape. Pure contract tests, no React rendering.
- **Contract test file:** `test/react/flows/bridgeContracts.test.ts` — separate from `messageContracts.test.ts`. The two coexist with distinct purposes.
- **Fixture factories:** `createDashboardPayload()`, `createExerciseDetailPayload()`, etc. — typed, reusable across contract and flow tests.
- **Existing test cleanup:** Remove redundant per-test store resets that reset to the store's default initial state. Keep `setState` calls that set up specific scenario state. If a `beforeEach` block only contained the now-global reset, remove the entire block.
- **Verification criterion:** Run full Vitest suite twice in sequence — no order-dependent failures = success.

### Claude's Discretion

- Internal implementation details of capture-at-import (deep clone strategy, timing).
- Exact file naming and organization within `__helpers__/`.
- Fixture factory function signatures and default values.
- Whether `bridgeContracts.test.ts` uses `describe` blocks per state group or flat test structure.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INTG-01 | Extension host bridge contract tests verify typed postMessage payloads for all 13 AppStateManager state transitions | Bridge contract test pattern, fixture factory pattern, AppStateManager state enumeration |
</phase_requirements>

---

## Summary

Phase 16 builds three shared test helpers that all subsequent integration and E2E tests depend on: a global store reset that runs before each test, a bridge handshake helper that simulates the extension→webview ready exchange, and bridge contract test scaffolding that verifies each of the 13 AppStateManager state transitions produces the correct typed payload shape.

The standard Zustand testing pattern — capture initial state at import time, restore with `setState(snapshot, true)` in `beforeEach` — maps directly onto the locked decision for capture-at-import. The project's 9 stores all follow the uniform `create<T>()(devtools(...))` pattern, so a single central registry file can reset all of them identically. The bridge handshake helper needs `act()` wrapping because `dispatchExtensionMessage()` fires a DOM `MessageEvent` that triggers React state updates; without `act()`, assertions may run before React processes those updates.

The 13 AppStateManager state transitions are enumerated from `AppState` plus the `AppStateManager` method bodies. The message type for each is the corresponding `*InitMessage` or `*Message` in `messageContracts.ts`. Fixture factories produce minimal valid payloads for each type and are typed against those interfaces.

**Primary recommendation:** Implement the global store reset and bridge handshake helper before writing any contract tests; they are the dependencies that make the contract tests isolation-safe.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.0.18 | Test runner + assertion | Already in use; all react tests run through it |
| @testing-library/react | ^16.3.2 | `act()` import | RTL re-exports `act` from React; wrapping MessageEvent dispatches |
| zustand | ^5.0.11 | Store under test | Project standard; stores define `getState()` and `setState()` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| happy-dom | ^20.7.0 | DOM environment | Already configured in vitest.config.mts; MessageEvent works in it |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Capture-at-import snapshot | `__mocks__/zustand.ts` wrapper | The wrapper approach requires ES module mock hoisting which is finicky in Vitest; capture-at-import is simpler and already locked |
| `act()` from RTL | `act()` from `react` | Identical at runtime; RTL re-exports React's `act`. Either import works. |

**Installation:** No new packages required — entire stack already installed.

---

## Architecture Patterns

### Recommended Project Structure

```
test/react/__helpers__/
├── vitest.setup.ts         # Global beforeEach calls resetTestState() — MODIFIED
├── vscodeApi.ts            # Existing: dispatchExtensionMessage, createMockVsCodeApi
├── renderWithProviders.tsx # Existing: RTL render wrapper
├── resetStores.ts          # NEW: central store registry + resetTestState()
└── simulateHandshake.ts    # NEW: bridge handshake helper

test/react/flows/
├── messageContracts.test.ts    # Existing: compile-time type-drift detection
└── bridgeContracts.test.ts     # NEW: runtime payload shape per state transition

test/react/fixtures/            # NEW directory (or __helpers__/fixtures/)
├── dashboardPayload.ts
├── courseListPayload.ts
├── courseDetailPayload.ts
├── exerciseDetailPayload.ts
├── examStartPayload.ts
├── examConductionPayload.ts
├── examExerciseDetailPayload.ts
├── serviceStatusPayload.ts
├── gitCredentialsPayload.ts
└── index.ts                    # Re-exports all factories
```

### Pattern 1: Capture-at-Import Store Reset

**What:** Snapshot each store's state immediately when the module is imported (before any test runs), then restore that snapshot in `beforeEach` using `setState(snapshot, true)`.

**When to use:** Always — this is the global reset for all 9 stores.

**Why `setState(snapshot, true)`:** The second argument `true` is the "replace" flag — it overwrites the entire state instead of shallowly merging. Without `true`, action functions get stripped from the state object during a partial merge, corrupting the store.

**Example:**

```typescript
// test/react/__helpers__/resetStores.ts
import { useDashboardStore } from '../../../src/views/webview/react/stores/useDashboardStore';
import { useNavigationStore } from '../../../src/views/webview/react/stores/useNavigationStore';
import { useChatStore } from '../../../src/views/webview/react/stores/useChatStore';
import { useCourseListStore } from '../../../src/views/webview/react/stores/useCourseListStore';
import { useCourseDetailStore } from '../../../src/views/webview/react/stores/useCourseDetailStore';
import { useExerciseDetailStore } from '../../../src/views/webview/react/stores/useExerciseDetailStore';
import { useExamStartStore } from '../../../src/views/webview/react/stores/useExamStartStore';
import { useExamConductionStore } from '../../../src/views/webview/react/stores/useExamConductionStore';
import { useExamExerciseDetailStore } from '../../../src/views/webview/react/stores/useExamExerciseDetailStore';
import { createMockVsCodeApi } from './vscodeApi';

// Capture initial state at import time, before any test mutates stores
const initialStates = [
    { store: useDashboardStore, state: useDashboardStore.getState() },
    { store: useNavigationStore, state: useNavigationStore.getState() },
    { store: useChatStore, state: useChatStore.getState() },
    { store: useCourseListStore, state: useCourseListStore.getState() },
    { store: useCourseDetailStore, state: useCourseDetailStore.getState() },
    { store: useExerciseDetailStore, state: useExerciseDetailStore.getState() },
    { store: useExamStartStore, state: useExamStartStore.getState() },
    { store: useExamConductionStore, state: useExamConductionStore.getState() },
    { store: useExamExerciseDetailStore, state: useExamExerciseDetailStore.getState() },
] as const;

/**
 * Resets all Zustand stores to their initial state and re-initializes
 * the mock VsCodeApi. Call this in a global beforeEach.
 */
export function resetTestState(): void {
    for (const { store, state } of initialStates) {
        // true = replace flag: overwrites entire state, does not merge
        (store as { setState: (s: unknown, replace: boolean) => void })
            .setState(state, true);
    }

    // Re-initialize the global mock VsCodeApi
    const freshApi = createMockVsCodeApi();
    Object.defineProperty(global.window, 'acquireVsCodeApi', {
        writable: true,
        configurable: true,
        value: () => freshApi,
    });
}
```

**vitest.setup.ts modification:**

```typescript
// test/react/__helpers__/vitest.setup.ts
/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom" />

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { createMockVsCodeApi } from './vscodeApi';
import { resetTestState } from './resetStores';   // NEW

// Global reset before each test — prevents store state from leaking
beforeEach(() => {                                  // NEW
    resetTestState();                               // NEW
});                                                 // NEW

// Cleanup after each test (unchanged)
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

// Create default mock VS Code API (for initial definition)
const mockVsCodeApi = createMockVsCodeApi();

Object.defineProperty(global.window, 'acquireVsCodeApi', {
    writable: true,
    value: () => mockVsCodeApi,
});
```

### Pattern 2: Bridge Handshake Helper

**What:** A single async function `simulateHandshake(initPayload?)` that simulates the extension→webview communication sequence: dispatching the view-init message, wrapped in `act()` so React processes state updates before the caller's assertions run.

**When to use:** At the top of any integration or flow test that needs the component to be in its "initialized" state before assertions.

**Why `act()` is required:** `dispatchExtensionMessage()` fires `window.dispatchEvent(new MessageEvent('message', { data }))`. This causes `useEffect` message handlers in components to run, which call Zustand `setState`. React batches these updates. Without `act()`, the test's assertion may execute before React has flushed the update queue, causing intermittent failures.

**Example:**

```typescript
// test/react/__helpers__/simulateHandshake.ts
import { act } from '@testing-library/react';
import { dispatchExtensionMessage } from './vscodeApi';
import type { ExtensionToWebviewMessage } from '../../../src/shared/messageContracts';

/**
 * Simulates the extension→webview handshake.
 *
 * The webview signals readiness by posting { type: 'ready' }.
 * The extension responds with the view-init message.
 * This helper simulates the extension's response side.
 *
 * Wraps dispatch in act() so React processes all resulting
 * state updates before control returns to the caller.
 *
 * @param initPayload - Optional view-init message to dispatch after ready.
 *   Pass undefined to simulate a handshake with no init data
 *   (e.g., when testing the loading state before init arrives).
 */
export async function simulateHandshake(
    initPayload?: ExtensionToWebviewMessage
): Promise<void> {
    await act(async () => {
        if (initPayload) {
            dispatchExtensionMessage(initPayload as Record<string, unknown>);
        }
    });
}
```

**Usage in a test:**

```typescript
import { simulateHandshake } from '../../__helpers__/simulateHandshake';
import { createDashboardPayload } from '../../fixtures';

it('shows course cards after init', async () => {
    render(<DashboardView vscodeApi={mockApi} />);
    await simulateHandshake(createDashboardPayload({
        courses: [{ courseData: { course: { id: 1, title: 'Algorithms' } }, exercises: [] }],
    }));
    expect(screen.getByText('Algorithms')).toBeInTheDocument();
});
```

### Pattern 3: Bridge Contract Test Scaffolding

**What:** One test per AppStateManager state transition asserting the correct `ExtensionToWebviewMessage` type discriminant and payload shape. No React rendering. Tests use fixture factories to produce typed minimal payloads.

**When to use:** New file `test/react/flows/bridgeContracts.test.ts`.

**Why no rendering:** Contract tests verify the message protocol, not UI behavior. Keeping them render-free makes them fast and immune to component-level changes. The existing `messageContracts.test.ts` already verifies compile-time type correctness; `bridgeContracts.test.ts` verifies runtime structural contracts per state machine transition.

**The 13 AppStateManager state transitions and their message types:**

| # | AppStateManager Method | `AppState` | Message Type |
|---|------------------------|-----------|-------------|
| 1 | `showLogin()` | `login` | `logoutSuccess` |
| 2 | `showDashboard()` | `dashboard` | `dashboardInit` |
| 3 | `showCourseList()` | `course-list` | `courseListInit` |
| 4 | `showCourseDetail()` | `course-detail` | `courseDetailInit` |
| 5 | `showArchivedCourseDetail()` | `course-detail` | `courseDetailInit` |
| 6 | `showExerciseDetail()` | `exercise-detail` | `exerciseDetailInit` |
| 7 | `showAiConfig()` | `ai-config` | *(no dedicated init msg; uses generic)* |
| 8 | `showServiceStatus()` | `service-status` | `serviceStatusInit` |
| 9 | `showStruggleDetection()` | `struggle-detection` | *(no dedicated init msg)* |
| 10 | `showRecommendedExtensions()` | `recommended-extensions` | `recommendedExtensionsInit` |
| 11 | `showGitCredentials()` | `git-credentials` | `gitCredentialsInit` |
| 12 | `showExamStart()` | `exam-start` | `examStartInit` |
| 13 | `showExamConduction()` | `exam-conduction` | `examConductionInit` |

Note: `showExamExerciseDetail()` produces `exam-exercise-detail` state and uses `examExerciseDetailInit`. This is a 14th method but may have been counted differently. The CONTEXT.md specifies 13; `exam-exercise-detail` may be excluded from the bridge contract scope (it is not a standalone view init from the extension side in the same way). Confirm by counting the message types the extension host sends on each `AppState` entry.

**Fixture factory pattern:**

```typescript
// test/react/fixtures/dashboardPayload.ts
import type { DashboardInitMessage } from '../../../src/shared/messageContracts';

export function createDashboardPayload(
    overrides?: Partial<DashboardInitMessage['payload']>
): DashboardInitMessage {
    return {
        type: 'dashboardInit',
        payload: {
            courses: [],
            ...overrides,
        },
    };
}
```

**Contract test pattern:**

```typescript
// test/react/flows/bridgeContracts.test.ts
import { describe, it, expect } from 'vitest';
import { isExtensionMessage } from '../../../src/shared/messageContracts';
import {
    createDashboardPayload,
    createCourseListPayload,
    // ... other factories
} from '../fixtures';

describe('Bridge contracts: dashboardInit', () => {
    it('payload satisfies DashboardInitMessage shape', () => {
        const msg = createDashboardPayload();
        expect(msg.type).toBe('dashboardInit');
        expect(isExtensionMessage(msg)).toBe(true);
        expect(Array.isArray(msg.payload.courses)).toBe(true);
    });

    it('payload with courses carries course data', () => {
        const msg = createDashboardPayload({
            courses: [{ courseData: { course: { id: 1, title: 'Test' } }, exercises: [] }],
        });
        expect(msg.payload.courses[0].courseData.course.id).toBe(1);
    });
});
```

### Anti-Patterns to Avoid

- **Using `setState` without `true` replace flag:** `store.setState(initialState)` merges rather than replaces; action functions survive but new state fields may be missing if the initial state object is a subset. Always pass `true`.
- **Calling `getState()` inside `beforeEach` instead of at module import time:** If state has already been mutated before the first test runs (e.g., by a module-level side effect), the "initial" state snapshot will be contaminated. Capture at import time.
- **`simulateHandshake` without `await`:** The function returns a Promise. Callers must `await` it or React's state updates will not be flushed before assertions.
- **Using `dispatchExtensionMessage` directly in integration tests without `act()`:** Works for simple cases but will produce "not wrapped in act()" warnings in Vitest ^4 and may cause assertion-before-update races on slower CI machines.
- **Importing stores inside `beforeEach`:** Dynamic imports inside test hooks do not capture state at module load time; they create the store fresh on every call (or return the cached module). Import at the top of the helper file.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Flushing React state after DOM events | Manual `setTimeout(() => {}, 0)` polling | `await act(async () => {...})` | `act()` integrates with React's internal scheduler; polling is fragile under concurrent mode |
| Deep equality check for state comparison | Custom deep-equal utility | Snapshot with `structuredClone` captured at import time; `setState(snapshot, true)` restores it | `structuredClone` handles nested objects, arrays, and all primitives without hand-rolling |
| Per-test store imports | Importing stores individually in every test file that needs reset | Central `resetStores.ts` imported once by `vitest.setup.ts` | Single source of truth; adding a 10th store means updating one file, not every test |

**Key insight:** The Zustand `setState(state, true)` replace pattern is the canonical approach documented by the Zustand maintainers. The replace flag exists precisely for test teardown use cases.

---

## Common Pitfalls

### Pitfall 1: State Capture Timing (Import Order)

**What goes wrong:** The snapshot captured in `resetStores.ts` contains already-mutated state if any other module that imports a store runs side effects at module evaluation time.

**Why it happens:** Vitest evaluates modules in dependency order. If a module imports a store and calls `store.setState(...)` at module level (not inside a function), that mutation happens before `resetStores.ts` captures the initial state.

**How to avoid:** Audit all top-level module code in the 9 store files and any helper that imports them. The 9 stores in this project use `create<T>()(devtools(...))` with no module-level side effects — the initial state is the argument to `devtools(...)`, which is clean.

**Warning signs:** The very first test that runs fails with a non-default store value despite no explicit mutation in that test.

### Pitfall 2: `setState(state, true)` Replaces Action Functions

**What goes wrong:** If the captured snapshot was obtained via `getState()` on a store whose state includes action functions (Zustand's vanilla pattern), then `setState(snapshot, true)` restores those same function references — which is correct. But if the snapshot was serialized to JSON and deserialized (e.g., `JSON.parse(JSON.stringify(initialState))`), the action functions are stripped, and the store loses its actions.

**Why it happens:** `JSON.stringify` drops function-valued properties.

**How to avoid:** Do NOT use `JSON.parse(JSON.stringify(...))` to snapshot the store state. Use `structuredClone()` only for plain data fields, or simply hold a reference to the `getState()` result without cloning (a reference is fine because Zustand stores are immutable-update stores — `setState` creates new state objects, so the reference to the original state object remains valid).

**Warning signs:** Tests throw `store.someAction is not a function` after a reset.

### Pitfall 3: Bridge Race Condition Without `act()`

**What goes wrong:** `simulateHandshake()` is called without `await`, or `dispatchExtensionMessage()` is called directly without `act()`. The assertion runs before React processes the `MessageEvent`-triggered state update.

**Why it happens:** `window.dispatchEvent` is synchronous, but React's state update from `useState`/`useReducer` inside `useEffect` message handlers is not immediately applied to the DOM. The component re-render is deferred to the next microtask boundary.

**How to avoid:** Always `await simulateHandshake(...)`. Always wrap direct `dispatchExtensionMessage()` calls that need immediate assertion in `await act(async () => { dispatchExtensionMessage(...); })`.

**Warning signs:** `waitFor(() => expect(...))` passes after a long timeout, or tests pass locally but fail on CI (slower machine exposes the race).

### Pitfall 4: Removing Wrong `beforeEach` Blocks During Cleanup

**What goes wrong:** Removing a `beforeEach` that sets up scenario-specific state (not just the default reset), thinking it's redundant now that global reset exists.

**Why it happens:** Both "reset to default" and "set up specific scenario" calls look similar: `store.setState({...})`.

**How to avoid:** Only remove `beforeEach` blocks whose entire body is `store.setState` with the store's documented initial state values. If the `setState` sets non-default values (e.g., `isLoading: true`, specific course data), keep it — that is scenario setup, not cleanup.

**Warning signs:** Test that previously verified a specific state now fails because it relied on `beforeEach` scenario setup that was removed.

### Pitfall 5: `acquireVsCodeApi` Mock Not Reset Between Tests

**What goes wrong:** The `mockVsCodeApi` defined at module level in `vitest.setup.ts` accumulates call history across tests. After `vi.clearAllMocks()` runs in `afterEach`, the spies are cleared, but if `resetTestState()` creates a fresh `mockVsCodeApi` via `createMockVsCodeApi()`, components that captured the old reference still hold the stale mock.

**Why it happens:** `window.acquireVsCodeApi` is called once on component mount (or during module initialization in the webview bootstrap). If the component caches the result, updating `window.acquireVsCodeApi` between tests has no effect.

**How to avoid:** Since `vi.clearAllMocks()` already clears spy call history, the `acquireVsCodeApi` reset in `resetTestState()` is belt-and-suspenders. The primary mechanism for mock freshness is `vi.clearAllMocks()` in `afterEach`. Verify which components call `acquireVsCodeApi()` at render time vs. module time. If any call it at module level, a fresh instance per test requires more invasive mocking.

**Warning signs:** `expect(mockApi.postMessage).toHaveBeenCalledTimes(1)` fails with count > 1 because previous test's calls were not cleared.

---

## Code Examples

Verified patterns from official sources and existing codebase:

### Store Reset with `setState(state, true)`

```typescript
// Source: Zustand official testing guide + pmndrs/zustand discussion #2829
// The "true" second argument = replace mode (not merge)
store.setState(capturedInitialState, true);
```

### `act()` for DOM MessageEvent dispatch

```typescript
// Source: https://react.dev/reference/react/act
// Pattern: wrap any DOM event that triggers React state updates
import { act } from '@testing-library/react';

await act(async () => {
    window.dispatchEvent(new MessageEvent('message', { data: payload }));
});
```

### Fixture factory with TypeScript `satisfies`

```typescript
// Pattern consistent with existing messageContracts.test.ts usage
import type { DashboardInitMessage } from '../../../src/shared/messageContracts';

export function createDashboardPayload(
    overrides?: Partial<DashboardInitMessage['payload']>
): DashboardInitMessage {
    return {
        type: 'dashboardInit',
        payload: {
            courses: [],
            ...overrides,
        },
    } satisfies DashboardInitMessage;
}
```

### Existing pattern confirmed in `DashboardView.test.tsx`

```typescript
// Per-test store reset pattern to be REPLACED by global reset:
beforeEach(() => {
    useDashboardStore.setState({
        recentCourses: [],
        workspaceExercise: null,
        isLoading: false,
        error: null,
    });
});
// This whole beforeEach block is a candidate for removal once global reset is in place.
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `__mocks__/zustand.ts` wrapper with `afterEach` | Direct `getState()` capture + `setState(state, true)` in `beforeEach` | Zustand v5 (2024) | Simpler, no mock hoisting complexity; works identically in Vitest ESM mode |
| `act()` sync version | `await act(async () => {...})` | React 18 (2022) | Sync `act` deprecated; async version is the standard |
| Per-test store reset in individual test files | Global `beforeEach` in `vitest.setup.ts` | Established best practice | One change resets all stores; eliminates missing-reset bugs |

**Deprecated/outdated:**
- `store.getState()` captured inside `beforeEach`: captures state after tests may have mutated it. Capture at module import time instead.
- `JSON.parse(JSON.stringify(store.getState()))` for deep clone: strips action functions.

---

## Open Questions

1. **Count of 13 state transitions in CONTEXT.md**
   - What we know: `AppStateManager` has `showLogin`, `showDashboard`, `showCourseList`, `showCourseDetail`, `showArchivedCourseDetail`, `showExerciseDetail`, `showAiConfig`, `showServiceStatus`, `showStruggleDetection`, `showRecommendedExtensions`, `showGitCredentials`, `showExamStart`, `showExamConduction` — that is 13. `showExamExerciseDetail` is a 14th method.
   - What's unclear: Whether `showExamExerciseDetail` is counted as the 13th by excluding one of the others, or if the CONTEXT.md count is off by one.
   - Recommendation: During implementation, count by checking which `AppState` values have a corresponding `*Init` message in `messageContracts.ts`. Each one that has a dedicated init message gets a contract test. States without a dedicated init message (`ai-config`, `struggle-detection`) still get a test verifying the transition is observable, but via a different message type.

2. **`structuredClone` availability in happy-dom**
   - What we know: `structuredClone` is a global in Node.js 17+ and all modern browsers. happy-dom 20.x runs in Node.js.
   - What's unclear: Whether happy-dom's Node.js environment exposes `structuredClone` globally without import.
   - Recommendation: Use direct object reference from `getState()` rather than `structuredClone`. Zustand's immutable update model guarantees the initial state object is never mutated in place — a reference is safe.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.18 |
| Config file | `iris-thaumantias/vitest.config.mts` |
| Quick run command | `npm run test:react -- --reporter=verbose --testPathPattern=bridgeContracts` |
| Full suite command | `npm run test:react` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INTG-01 | Bridge contract tests verify typed payloads for all 13 AppStateManager state transitions | integration (no render) | `npm run test:react -- --reporter=verbose bridgeContracts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test:react -- bridgeContracts`
- **Per wave merge:** `npm run test:react`
- **Phase gate:** Full suite green twice in sequence (order-independence check)

### Wave 0 Gaps

- [ ] `test/react/__helpers__/resetStores.ts` — global store reset registry (INTG-01 + all future phases)
- [ ] `test/react/__helpers__/simulateHandshake.ts` — bridge handshake helper (INTG-01 + Phase 17, 18)
- [ ] `test/react/fixtures/index.ts` + per-transition factory files — typed fixture factories (INTG-01)
- [ ] `test/react/flows/bridgeContracts.test.ts` — the contract tests themselves (INTG-01)
- [ ] Modification of `vitest.setup.ts` to add global `beforeEach(resetTestState)` (prerequisite for all phases)

---

## Sources

### Primary (HIGH confidence)

- Zustand official testing discussion (pmndrs/zustand #2829) — `setState(state, true)` replace pattern for test reset
- Zustand official discussion (pmndrs/zustand #1829) — Vitest-specific reset patterns
- `https://react.dev/reference/react/act` — `await act(async () => {...})` is the current standard; sync act deprecated
- Existing codebase (`vitest.config.mts`, `vitest.setup.ts`, `vscodeApi.ts`, `renderWithProviders.tsx`) — confirmed environment and existing helpers
- `messageContracts.ts` (1511 lines) — confirmed all 13 `*Init` message types and their payload shapes
- `appStateManager.ts` — confirmed 13+ state transition methods

### Secondary (MEDIUM confidence)

- `https://blog.peslostudios.com/blog/zustand-writing-tests-for-your-data-store/` — confirmed `setState(initialState, true)` replace flag semantics; verified against Zustand source behavior
- DashboardView.test.tsx existing pattern — confirmed per-test `beforeEach(store.setState(...))` pattern that global reset will replace

### Tertiary (LOW confidence)

- WebSearch results on Vitest `act()` warnings — indicate ongoing ecosystem concern about `act()` wrapping for async state updates; not a concern for this project's pattern since `await act(async () => {...})` is used correctly

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all libraries already installed and in use
- Architecture: HIGH — patterns derived directly from existing codebase conventions and official Zustand testing guidance
- Pitfalls: HIGH — two of the five pitfalls (store state capture timing, replace flag) are verified from official sources; three are derived from existing codebase inspection

**Research date:** 2026-02-28
**Valid until:** 2026-08-28 (stable APIs; Zustand 5.x and Vitest 4.x lifecycle)
