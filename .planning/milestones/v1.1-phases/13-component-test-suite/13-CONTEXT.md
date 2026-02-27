# Phase 13: Component Test Suite - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Comprehensive unit and integration tests for React components, Zustand stores, and critical user flows. This phase writes tests for the existing React webview layer (~23 shared components, 9 stores, 5 hooks, 12 views) using the Vitest + React Testing Library infrastructure established in Phase 10. Coverage target is 80% overall (combined React + extension host), 90%+ on critical paths and all stores.

</domain>

<decisions>
## Implementation Decisions

### Critical flows (90%+ coverage)
- **Course browsing**: Test CourseListView and CourseDetailView independently with mocked store data (view-level isolation, not full navigation path)
- **Exercise submission**: Full participation lifecycle — start participation → submit → build progress → results → score display
- **Iris chat**: Context-aware conversation — type message → send → streaming response → final message with code blocks, PLUS exercise context selection, referenced files, conversation history
- **Auth / login**: Full auth lifecycle — login + session persistence + token refresh + logout + re-authentication
- **Navigation**: Dedicated integration tests for useNavigationStore routing between views and back/forward navigation
- Full postMessage round-trip verification in flow tests — components send correct messages AND handle expected responses
- Simulated streaming with delays for WebSocket-dependent features (chat streaming, build progress) to test progressive rendering
- Exam timer Web Worker tested for tick accuracy, pause/resume, and expiry notification
- Error boundaries and reconnection states in a **separate dedicated error suite**, not mixed into happy-path flow tests
- ServiceHealth and ReconnectBanner included in the error suite

### Component test depth
- **Simple components** (Badge, Container, BackLink, EmptyState, Skeleton): Render + accessibility — verify rendering, correct props display, proper ARIA attributes, semantic HTML, keyboard interaction where applicable
- **Interactive components** (Button, TextInput, Dropdown, ChatInput, SideMenu): Full interaction testing — click handlers, keyboard navigation, focus management, disabled states, input validation (8-15 test cases per component)
- **Display-heavy components** (CodeBlock, MessageBubble, ScoreInfo, TestResults, ProblemStatement): Content rendering fidelity — verify data transforms into correct DOM structure, code highlighting structure works, scores display correctly, test results grouped right
- **Custom hooks** (useExamTimer, useStreamingMessage, useAutoScroll, useWebSocketUpdates, useRelativeTime): Tested through components that use them, no separate hook test files

### Coverage ambition
- **Overall target**: 80% combined (React webview + extension host tests count together)
- **All 9 Zustand stores**: 90%+ coverage — every action, selector, and state transition tested
- **Critical paths** (auth, message contracts, submission): 90%+ coverage
- **Enforcement**: Track and report only — generate coverage reports but don't fail builds on thresholds
- **Message contracts**: Dedicated tests verifying type-safe postMessage contracts between webview and extension host (catches contract drift)
- **CodeBlock / Shiki**: Test structure only (renders `<pre>`/`<code>` with correct language class). Do NOT verify actual Shiki syntax tokens

### Test resilience
- **Testing style**: Mixed by layer — behavior-driven for components/views (test what users see and do), implementation-aware for stores and hooks (test internal state transitions)
- **No snapshot testing** — use explicit assertions everywhere, no toMatchSnapshot()
- **DOM selectors**: Testing Library queries exclusively — getByRole, getByText, getByLabelText (no data-testid attributes)
- **Timers**: vi.useFakeTimers() for all time-dependent features (exam timer, relative time, streaming delays). Advance time programmatically for deterministic, fast tests

### Claude's Discretion
- Test file organization and naming conventions
- Specific mock data shapes and fixtures
- Test helper utilities and factory functions
- Order of test implementation across waves/plans
- How to mock the VS Code extension host bridge for round-trip tests
- Worker mocking strategy for happy-dom environment

</decisions>

<specifics>
## Specific Ideas

- Problem statement rendering (KaTeX, PlantUML, HTML sanitization) gets normal component coverage, NOT elevated to critical flow status
- Existing Phase 10 sample tests (Button.test.tsx, useDashboardStore.test.ts, LoginView.test.tsx) serve as patterns to follow and extend
- Extension host unit tests already exist (services, providers, utils) and contribute to the combined 80% target

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 13-component-test-suite*
*Context gathered: 2026-02-27*
