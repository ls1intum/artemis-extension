---
phase: 04-main-ui-views
plan: 03
subsystem: ui
tags: [react, zustand, course-detail, breadcrumbs, exercise-search, exam-sorting]

# Dependency graph
requires:
  - phase: 04-02
    provides: CourseList React view with Zustand store and filtering
provides:
  - CourseDetail React view with Zustand store
  - Exercise search/sort with 8 sort options (ID, title, due date, points)
  - Exam sorting by status (active > upcoming > finished)
  - Breadcrumb navigation trail (Dashboard > CourseName)
  - Ask Iris course context integration
  - Workspace exercise highlighting
  - CourseDetail message contracts and commands
affects: [04-04, exercise-detail, iris-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Exercise search filters by title/type (case-insensitive)
    - Exercise sort with 8 options (ascending/descending for ID, title, due date, points)
    - Exam sorting by status: active > upcoming > finished
    - Breadcrumb trail: Dashboard > abbreviated course title
    - Workspace exercise detection and highlighting
    - Developer tools conditional on developerMode config

key-files:
  created:
    - iris-thaumantias/src/views/webview/react/stores/useCourseDetailStore.ts
    - iris-thaumantias/src/views/webview/react/views/CourseDetail/types.ts
    - iris-thaumantias/src/views/webview/react/views/CourseDetail/CourseDetailView.tsx
    - iris-thaumantias/src/views/webview/react/views/CourseDetail/CourseDetailView.module.css
    - iris-thaumantias/src/views/webview/react/views/CourseDetail/index.ts
  modified:
    - iris-thaumantias/src/shared/messageContracts.ts
    - iris-thaumantias/src/views/webview/react/views/index.ts
    - iris-thaumantias/src/views/webview/react/App.tsx
    - iris-thaumantias/src/views/app/viewRouter.ts
    - iris-thaumantias/src/provider/artemisWebviewProvider.ts

key-decisions:
  - "Exercise categories always expanded (no collapse UI) per user decision"
  - "Workspace exercise highlighted with 'Open' badge using selected prop"
  - "Developer tools conditional on developerMode workspace config"
  - "Breadcrumbs clear and rebuild on CourseDetail mount"
  - "Exercise search filters by title OR type (case-insensitive)"
  - "Eight sort options: ID, title, due date, points (ascending/descending)"
  - "Exam sorting: active first, upcoming second, finished last"

patterns-established:
  - "Exercise search uses string.includes for case-insensitive matching"
  - "Sort dropdown with 8 options covers ID, title, due date, points"
  - "Exam status calculated from startDate/endDate vs current time"
  - "Breadcrumb abbreviation: 20 chars max, truncate to 17 + '...'"
  - "Persisted state: exerciseSearchTerm, exerciseSortBy only (not course data)"
  - "Developer tools use hideDeveloperTools flag from init message"

requirements-completed: [VIEW-01]

# Metrics
duration: 6min
completed: 2026-02-23
---

# Phase 04 Plan 03: CourseDetail Migration Summary

**CourseDetail React view with exercise search/sort (8 options), exam sorting by status (active/upcoming/finished), breadcrumb navigation, Ask Iris integration, and workspace exercise highlighting**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-23T23:23:28Z
- **Completed:** 2026-02-23T23:29:38Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- CourseDetail React view matches legacy layout with course header, exams, exercises, Ask Iris, and developer tools
- Exercise search filters by title/type (case-insensitive)
- Exercise sort dropdown with 8 options (ID, title, due date, points - ascending/descending)
- Exam sorting by status: active exams first, then upcoming, then finished
- Breadcrumb navigation: "Dashboard" > abbreviated course title
- Workspace exercise highlighted with "Open" badge
- Ask Iris button sends course context (courseId, courseTitle, courseShortName)
- Developer tools conditional on developerMode workspace config
- Registered in coexistence router (React views map)

## Task Commits

Each task was committed atomically:

1. **Task 1: CourseDetail message contracts and Zustand store** - `b096bec` (feat)
2. **Task 2: CourseDetail React view with router wiring** - `c58b8af` (feat)

## Files Created/Modified
- `iris-thaumantias/src/views/webview/react/stores/useCourseDetailStore.ts` - Zustand store with exercise search/sort logic and exam sorting
- `iris-thaumantias/src/views/webview/react/views/CourseDetail/types.ts` - CourseDetail view props and persisted state types
- `iris-thaumantias/src/views/webview/react/views/CourseDetail/CourseDetailView.tsx` - CourseDetail React component with course header, exams, exercises, Ask Iris
- `iris-thaumantias/src/views/webview/react/views/CourseDetail/CourseDetailView.module.css` - CSS module for CourseDetail layout matching legacy styles
- `iris-thaumantias/src/views/webview/react/views/CourseDetail/index.ts` - Barrel export for CourseDetail view
- `iris-thaumantias/src/shared/messageContracts.ts` - Added CourseDetailInitMessage, CourseDetailData, Exam types, and 7 new commands (reloadCourseDetail, openExerciseDetails, openExam, askIrisAboutCourse, toggleCourseFullscreen, openInEditor)
- `iris-thaumantias/src/views/webview/react/views/index.ts` - Added CourseDetail exports
- `iris-thaumantias/src/views/webview/react/App.tsx` - Added courseDetail case to route switch
- `iris-thaumantias/src/views/app/viewRouter.ts` - Added course-detail to React views map
- `iris-thaumantias/src/provider/artemisWebviewProvider.ts` - Added courseDetailInit handler in ready-signal handler with workspace exercise detection

## Decisions Made
- **Exercise categories always expanded:** Per plan decision, exercise categories are not collapsible. Exams section remains collapsible (collapsed by default unless active exam exists).
- **Workspace exercise highlighted with 'Open' badge:** Using ListItem selected prop instead of custom highlighted prop (following component API).
- **Developer tools conditional on developerMode config:** Read from workspace config, sent in init message as hideDeveloperTools flag.
- **Breadcrumbs clear and rebuild on mount:** Clear existing breadcrumbs, then push "Dashboard" and abbreviated course title.
- **Exercise search filters by title OR type:** Case-insensitive string matching on both fields.
- **Eight sort options:** Latest/Oldest Added (ID), Title A-Z/Z-A, Due Date Earliest/Latest, Points Low-High/High-Low.
- **Exam sorting by status:** Active exams first (based on current time vs startDate/endDate), then upcoming, then finished.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- CourseDetail view complete and registered in coexistence router
- Exercise search and sort working with 8 sort options
- Exam sorting by status implemented (active > upcoming > finished)
- Breadcrumb navigation established
- Ready for Plan 04-04: ExerciseDetail migration

---
*Phase: 04-main-ui-views*
*Completed: 2026-02-23*

## Self-Check: PASSED

All created files verified to exist:
- useCourseDetailStore.ts ✓
- types.ts ✓
- CourseDetailView.tsx ✓
- CourseDetailView.module.css ✓
- index.ts ✓

All commits verified to exist:
- b096bec (Task 1) ✓
- c58b8af (Task 2) ✓
