# Phase 5: Exam Views with Timer Accuracy - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate 3 exam views (ExamStartView, ExamConductionView, ExamExerciseDetailView) from legacy HTML string generation to React components. Implement Web Worker-powered countdown timers with absolute timestamps that remain accurate when tabs are backgrounded. ExamExerciseDetail reuses Phase 4's ExerciseDetail components via composition.

</domain>

<decisions>
## Implementation Decisions

### Timer display & format
- Use Artemis-compatible format: "1h 7min", "15min", "8min 0s", "45s"
- Single warning threshold at 5 minutes remaining (red pulse animation)
- Keep the progress bar showing elapsed vs total time
- Timer visible on all three exam views (start, conduction, exercise detail)
- Per-view timer instances (each view creates its own timer from the same absolute timestamps, no shared Web Worker)

### Timer on exam start view
- Adaptive behavior: before exam starts, countdown to start time; after exam starts, show remaining working time
- Also display static working time duration (e.g., "90 minutes") so students know total exam duration

### Timer expiry behavior
- Show popup overlay when timer reaches zero ("Time's up")
- Exercise list remains interactive after expiry (students can still view their work read-only)

### Exam conduction layout
- Timer and progress bar at top of view (page scrolls, timer not sticky)
- Simple exercise list matching current behavior (title, type icon, max points)
- Currently-opened exercise (matching active VS Code workspace) visually highlighted
- Keep both "Open in Browser" and "Refresh" action buttons
- Minimal header: exam title and timer only (no summary row with totals)
- Exercise type icons displayed next to each exercise
- Page scroll (not fixed timer + scrollable list)
- Reset scroll to top when navigating back from exercise detail
- Manual refresh only (no auto-polling)
- Loading skeleton + error states with retry (consistent with Phase 4 patterns)
- Reuse ExamErrorHandler's 20+ Artemis error code mappings for friendly error messages
- Show "Test Exam" label/badge for practice exams

### Exam exercise detail
- Timer displayed in top bar / header area, above exercise content
- "Back to Exam" link text (not generic "Back")
- Hide Ask Iris button during exams
- Reuse Phase 4 ExerciseDetail sub-components: ParticipationActions, SubmissionStatus, BuildProgress, ProblemStatement, ScoreInfo, TestResults

### Exam start view
- Render exam start text (rules/instructions) as sanitized HTML to preserve instructor formatting
- Relative time display only for dates ("in 2 days", "5 hours ago") — no absolute dates
- Context-aware button label: "Enter Exam" when exam is active, "Refresh" when not started
- Show working time duration as static info
- Keep "Open in Browser" button

### Claude's Discretion
- Pre-exam navigation handling (redirect to start vs show "not started" state on conduction view)
- Expired popup content and design (notice with action button or simple dismiss)
- Timer component internal architecture and Web Worker implementation details
- Loading skeleton design for exam views
- Exact spacing, typography, and CSS module structure

</decisions>

<specifics>
## Specific Ideas

- Timer format must match Artemis web app exactly so students see consistent times across platforms
- Expired popup should appear on timer expiry — not just a visual state change, an actual overlay
- Test exams should be clearly labeled so students know it's practice (not graded)
- Context-aware button: "Enter Exam" vs "Refresh" gives students clearer intent than current dual-purpose label

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-exam-views-timer-accuracy*
*Context gathered: 2026-02-24*
