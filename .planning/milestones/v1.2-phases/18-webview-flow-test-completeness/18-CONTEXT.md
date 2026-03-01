# Phase 18: Webview Flow Test Completeness - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Verify the webview side of the extension host bridge: all 12 `*Init` message types correctly hydrate Zustand stores, the 2 circular ProviderRegistry import cycles are resolved, and silent exam fetch failures show a visible error to the user. No new features — testing, debt fix, and error visibility only.

</domain>

<decisions>
## Implementation Decisions

### Test organization
- Single `storeHydration.flow.test.tsx` file in `test/react/flows/`
- One `describe` block per Init message type (12 blocks total) — clean 1:1 mapping to success criteria
- Reuse existing fixture factories from `test/react/fixtures/` (Phase 16 created typed payloads); add missing fixtures as needed
- Tests verify Message → Store only — no rendering assertions (view tests already cover that)

### Hydration test depth
- Each test asserts: (a) store is no longer in initial state, (b) 2-3 key fields match expected values from the fixture
- No exhaustive field-level shape verification (would be brittle)
- No edge cases for partial/missing payloads — that's store-level logic tested in `test/react/stores/`

### Circular dependency fix (DEBT-03)
- Interface extraction approach — extract minimal provider interfaces to `src/types/`
- Only extract methods that ProviderRegistry actually calls on providers (minimal surface area)
- `IProviderRegistry` already exists as a pattern reference
- Manual madge verification at phase completion — no permanent CI lint rule

### Exam error UX (DEBT-04)
- Inline error state in both ExamStart and ExamConduction views
- Loading state replaced by error message + "Try again" button on fetch failure
- Manual retry only (no auto-retry) — avoids hammering a failing server
- Use `ExamErrorHandler.getExamErrorMessage()` for mapped, user-friendly error messages

### Claude's Discretion
- Exact error state component styling and layout
- Which specific key fields to assert in each hydration test
- Fixture factory structure for any missing Init message payloads
- Internal structure of extracted provider interfaces

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `test/react/fixtures/` — Typed fixture factories from Phase 16 (examStartPayload, examConductionPayload, etc.)
- `test/react/__helpers__/resetStores.ts` — Store reset infrastructure for clean test isolation
- `test/react/flows/` — Existing flow test patterns (courseNavigation, exerciseSubmission, auth, etc.)
- `ExamErrorHandler` (`src/services/examErrorHandler.ts`) — Already maps Artemis error keys to user-friendly messages
- `IProviderRegistry` interface already defined in `src/services/ProviderRegistry.ts`

### Established Patterns
- Flow tests use Vitest with `describe`/`it` blocks and fixture-based test data
- Zustand stores in `src/views/webview/react/stores/` — 9 stores covering all views
- Store tests in `test/react/stores/` — isolated unit tests per store
- Error states in views follow inline replacement pattern (loading → error + retry)

### Integration Points
- `src/shared/messageContracts.ts` — Defines all Init message types shared between extension host and webview
- `src/views/webview/react/App.tsx` — Message listener that dispatches Init messages to stores
- `src/services/ProviderRegistry.ts` — Imports `ChatWebviewProvider` and `ArtemisWebviewProvider` (circular dep source)
- `src/views/webview/react/views/ExamStart/ExamStartView.tsx` and `ExamConduction/ExamConductionView.tsx` — Views needing error state

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 18-webview-flow-test-completeness*
*Context gathered: 2026-02-28*
