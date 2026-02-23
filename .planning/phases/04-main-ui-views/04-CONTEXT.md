# Phase 4: Main UI Views - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate the core application flow (Dashboard → CourseList → CourseDetail → ExerciseDetail → ExerciseStarted) from HTML-string views to React components. Views receive real-time WebSocket updates for build status and submission results. ExerciseDetail components are extracted for reuse in Phase 5 (ExamExerciseDetail). Navigation, loading states, and error handling are included. New capabilities (new views, new features) are out of scope.

</domain>

<decisions>
## Implementation Decisions

### Migration fidelity
- Match current layout with minor fixes for visual inconsistencies (alignment, spacing)
- Dashboard layout stays as-is — no structural changes
- Preserve current information density per list item — don't add or remove fields
- ExerciseDetail components extracted cleanly from the start for Phase 5 (ExamExerciseDetail) reuse — composable component design, not monolithic

### Real-time update behavior
- Build status changes (building → passed/failed) update silently in place — no animation or notification
- Submission results update the relevant section in place — same silent approach
- Re-fetch data when navigating to a view (not WebSocket-only)
- Match current build progress indicator for in-progress builds
- Subtle "Reconnecting..." banner at top when WebSocket connection drops

### Navigation flow
- Clickable breadcrumbs: each segment is a link (e.g., click "Dashboard" from ExerciseDetail to jump there)
- Abbreviated breadcrumb labels to save space (e.g., "SE" not "Software Engineering")
- Breadcrumbs scroll horizontally on overflow
- Breadcrumbs sticky at top of webview while content scrolls
- Breadcrumbs hidden on Dashboard (root level) — only appear when navigated deeper
- Instant view swaps — no transition animations
- Back navigation: re-fetch data but restore UI state (scroll position, expanded sections)

### Loading & error states
- Skeleton placeholders on every navigation (including revisits)
- Fixed skeleton count (not matching previous item count)
- In-place skeletons maintaining scroll position
- Skeletons replace stale content entirely until fresh data arrives
- Inline error message with "Retry" text link (not styled button) for data fetch failures
- Auto-retry once after short delay; if still fails, show error with manual retry
- Helpful empty state messages explaining why it's empty and what to do
- Reuse Phase 1 error boundary for unexpected React crashes (no new error boundary)

### ExerciseStarted view
- Match current layout with minor fixes (same approach as other views)
- Same skeleton loading pattern as all other views

### View-specific interactions
- Exercise categories in CourseDetail always expanded (not collapsible)
- Action buttons (start, submit, etc.) match current placement and styling
- Subtle hover state (background color change) on clickable list items (courses, exercises)
- Long exercise descriptions shown in full — no truncation or "Show more"

### Claude's Discretion
- ExerciseStarted auto-navigation behavior (redirect vs stay put)
- Exact skeleton placeholder design per view
- Error message wording for different failure scenarios
- Empty state message copy per view
- WebSocket reconnection banner timing and dismissal

</decisions>

<specifics>
## Specific Ideas

- Breadcrumbs should feel native to VS Code — not a heavy UI element, just a subtle navigation aid
- Hover states on list items should use VS Code theme variables for consistency
- "Reconnecting..." banner should be unobtrusive — a thin bar, not a modal or large alert

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-main-ui-views*
*Context gathered: 2026-02-23*
