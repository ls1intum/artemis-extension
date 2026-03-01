# Phase 16: Integration Test Infrastructure - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Shared test helpers exist that all subsequent integration and E2E tests can rely on — store state cannot leak between tests, and bridge handshake race conditions cannot silently corrupt test results. Covers: global store reset, bridge handshake helper, and bridge contract test scaffolding for all 13 AppStateManager state transitions.

</domain>

<decisions>
## Implementation Decisions

### Store reset strategy
- Use capture-at-import: snapshot each store's state at import time (before any test mutates it) and restore from that snapshot in beforeEach — zero maintenance, new fields automatically included
- Central registry: one file (`test/react/__helpers__/resetStores.ts` or similar) imports all 9 Zustand stores and resets them — explicit, easy to debug
- Bundle stores + mock VsCodeApi into a single `resetTestState()` function that handles both concerns
- `resetTestState()` runs in a global `beforeEach` in `vitest.setup.ts`; the existing `afterEach` (RTL cleanup + `vi.clearAllMocks()`) stays as-is

### Bridge handshake helper
- API: `simulateHandshake(initPayload?)` — a single async function
- Simulates extension→webview direction only (Vitest tests run webview-side, don't need to verify extension behavior)
- Optional `initPayload` parameter: if provided, dispatches the view-init message after the ready signal
- Returns a promise, wraps dispatch in `act()` internally so React processes state updates before the test continues
- Lives in `test/react/__helpers__/` alongside existing helpers

### Contract test scope
- Verify message payload shapes only — each of the 13 state transitions gets a test asserting the correct `ExtensionToWebviewMessage` type discriminant and typed payload shape
- Pure contract tests, no React rendering — fast, focused
- New file: `test/react/flows/bridgeContracts.test.ts` — separate from the existing `messageContracts.test.ts` (which handles compile-time type-drift)
- The two files coexist: `messageContracts` checks type definitions don't drift, `bridgeContracts` checks runtime payload shapes per state transition
- Test data via fixture factory functions: `createDashboardPayload()`, `createExerciseDetailPayload()`, etc. — typed, reusable across contract and flow tests

### Existing test cleanup
- Remove redundant per-test store resets in this phase — proves the global reset works by making tests depend on it
- Only remove `beforeEach` blocks that reset to the store's default initial state; tests that set up specific scenario state keep their `setState` calls
- If a test file's `beforeEach` only contained the now-global store reset (nothing else), remove the entire `beforeEach` block
- Verify by running the full Vitest suite twice in sequence — no order-dependent failures = success (matches success criterion #1)

### Claude's Discretion
- Internal implementation details of capture-at-import (deep clone strategy, timing)
- Exact file naming and organization within `__helpers__/`
- Fixture factory function signatures and default values
- Whether `bridgeContracts.test.ts` uses `describe` blocks per state group or flat test structure

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `test/react/__helpers__/vscodeApi.ts`: `dispatchExtensionMessage()` and `createMockVsCodeApi()` — handshake helper builds on top of these
- `test/react/__helpers__/renderWithProviders.tsx`: custom RTL render with VsCodeApi injection — contract tests may not need this (no rendering) but flow tests use it
- `test/react/flows/messageContracts.test.ts`: existing type-drift detection — contract test scaffolding complements this

### Established Patterns
- All 9 stores use `create<T>()(devtools(...))` pattern — capture-at-import works uniformly
- Store tests already follow `beforeEach(() => store.setState({...}))` — consistent pattern to search-and-remove
- Flow tests use `dispatchExtensionMessage()` for bridge simulation — handshake helper wraps this same mechanism

### Integration Points
- `vitest.setup.ts`: global beforeEach added here for `resetTestState()`
- All 9 stores in `src/views/webview/react/stores/`: imported by central registry
- `src/views/app/appStateManager.ts`: defines the 13 state transitions and their message types — contract tests verify these
- `src/provider/artemisWebviewProvider.ts`: defines `ExtensionToWebviewMessage` payloads — fixture factories must match these types

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 16-integration-test-infrastructure*
*Context gathered: 2026-02-28*
