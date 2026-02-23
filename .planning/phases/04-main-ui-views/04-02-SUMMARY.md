---
phase: 04-main-ui-views
plan: 02
subsystem: ui
tags: [zustand, react, course-list, search, filter, sort, breadcrumbs]

# Dependency graph
requires:
  - phase: 04-main-ui-views
    plan: 01
    provides: Zustand state management, Skeleton, ErrorMessage, Breadcrumbs, navigation store
  - phase: 03-simple-views-migration
    provides: React infrastructure, Button, Container, ListItem, Badge, Dropdown, TextInput, BackLink, IconButton components
provides:
  - CourseList Zustand store with search/sort/filter logic and semester comparison
  - CourseList React view with legacy layout parity
  - Client-side search by title/semester/description
  - Type filter (all/active/archived) and semester filter dropdowns
  - Sort by title, semester, or exercise count
  - Archived courses loading with separate section
  - State persistence for filter settings across tab cycles
  - Breadcrumb navigation with "Courses" label
affects: [04-03, 04-04]

# Tech tracking
tech-stack:
  patterns:
    - Zustand store for course list state with derived filteredCourses getter
    - Client-side filtering and sorting (no server requests on filter change)
    - State persistence via vscodeApi.getState/setState for filter settings
    - Semester comparison logic (WS24/25, SS25 format) matching legacy behavior
    - Typed message contracts (CourseListInitMessage, ArchivedCoursesLoadedMessage)
    - Bridge pattern for loadArchivedCourses command to typed messages
    - Container header prop uses ReactNode pattern (not object with properties)

key-files:
  created:
    - iris-thaumantias/src/views/webview/react/stores/useCourseListStore.ts
    - iris-thaumantias/src/views/webview/react/views/CourseList/types.ts
    - iris-thaumantias/src/views/webview/react/views/CourseList/CourseListView.tsx
    - iris-thaumantias/src/views/webview/react/views/CourseList/CourseListView.module.css
    - iris-thaumantias/src/views/webview/react/views/CourseList/index.ts
  modified:
    - iris-thaumantias/src/shared/messageContracts.ts
    - iris-thaumantias/src/provider/artemisWebviewProvider.ts
    - iris-thaumantias/src/views/app/viewRouter.ts
    - iris-thaumantias/src/views/app/commands/navigationCommands.ts
    - iris-thaumantias/src/views/webview/react/App.tsx
    - iris-thaumantias/src/views/webview/react/views/index.ts

key-decisions:
  - "Container header prop accepts ReactNode directly, not object with properties (matches Phase 4 Dashboard pattern)"
  - "Client-side filtering only (no server request on filter change) for performance"
  - "Persist filter state (searchTerm, typeFilter, semesterFilter, sortBy) across tab hide/show"
  - "Semester sort uses simple reverse alphabetical for dropdown (WS24/25 > SS25 naturally)"
  - "Load archived button shown only when archived courses not yet loaded"
  - "Search results info displayed only when filters active"
  - "Type filter shows/hides entire sections rather than filtering within sections"
  - "Dropdown onChange receives value directly (string), not event object"
  - "TextInput onChange receives value directly (string), not event object"

patterns-established:
  - "CourseList state persistence pattern for filter settings"
  - "Client-side search/filter/sort pattern reusable in CourseDetail and ExerciseDetail"
  - "Archived data lazy loading pattern (load on demand via button)"
  - "Section headers use ReactNode with custom styling rather than object props"

requirements-completed: [VIEW-01]

# Metrics
duration: 7.4min
completed: 2026-02-23
---

# Phase 04 Plan 02: CourseList Migration Summary

**CourseList React view with Zustand store, client-side search/sort/filter, breadcrumb navigation, and archived courses support matching legacy layout with 5 dropdown filters and persistent state**

## Performance

- **Duration:** 7.4 min
- **Started:** 2026-02-23T23:13:01Z
- **Completed:** 2026-02-23T23:20:24Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- CourseList Zustand store created with search, sort, type filter, semester filter, and semester comparison logic
- CourseList React view matches legacy layout with header, search input, filter dropdowns, course items, archived section
- Client-side search filters by title, semester, description (case-insensitive)
- Type filter toggles between all, active, and archived courses
- Semester filter populated from course data (newest first)
- Sort dropdown reorders by title, semester, or exercise count
- Clear Filters button enabled when filters active
- Active courses section shows course cards with color indicator, title, semester badge, description, stats
- Load Archived Courses button fetches archived courses on demand
- Archived courses section displays after loading with "Archived" label
- Search results info displayed when filters active (e.g., "Found 5 active courses matching...")
- State persistence for filter settings across tab hide/show via getState/setState
- Breadcrumb navigation integration with "Courses" label pushed on mount
- CourseList registered in coexistence router (course-list → React)
- courseListInit message sent on ready signal with active and archived courses
- loadArchivedCourses command bridged to send archivedCoursesLoaded typed message

## Task Commits

Each task was committed atomically:

1. **Task 1: CourseList message contracts and Zustand store** - `f65ee78` (feat)
2. **Task 2: CourseList React view with router wiring** - `d1a4149` (feat)

## Files Created/Modified
- `iris-thaumantias/src/shared/messageContracts.ts` - Added CourseListInitMessage, ArchivedCoursesLoadedMessage, CourseData, ArchivedCourse, Exercise types; added ReloadCoursesCommand, LoadArchivedCoursesCommand, ViewArchivedCourseCommand
- `iris-thaumantias/src/views/webview/react/stores/useCourseListStore.ts` - Zustand store for course list state with search/sort/filter logic, semester comparison, and filteredCourses getter
- `iris-thaumantias/src/views/webview/react/views/CourseList/types.ts` - CourseListViewProps, CourseListPersistedState, re-exported CourseData/ArchivedCourse
- `iris-thaumantias/src/views/webview/react/views/CourseList/CourseListView.tsx` - CourseList React view component with search, filters, course sections
- `iris-thaumantias/src/views/webview/react/views/CourseList/CourseListView.module.css` - CourseList styles matching legacy layout
- `iris-thaumantias/src/views/webview/react/views/CourseList/index.ts` - Barrel export for CourseList
- `iris-thaumantias/src/provider/artemisWebviewProvider.ts` - Added courseListInit message handler in ready signal
- `iris-thaumantias/src/views/app/viewRouter.ts` - Added course-list to React views map
- `iris-thaumantias/src/views/app/commands/navigationCommands.ts` - Bridged loadArchivedCourses to send archivedCoursesLoaded typed message
- `iris-thaumantias/src/views/webview/react/App.tsx` - Added courseList route case
- `iris-thaumantias/src/views/webview/react/views/index.ts` - Exported CourseList components

## Decisions Made
- Container header uses ReactNode pattern directly (not object with properties) matching Dashboard pattern
- Client-side filtering for performance (no server request on filter change)
- Persist filter state across tab cycles using getState/setState pattern
- Semester dropdown uses reverse alphabetical sort (WS24/25 > SS25 naturally sorted)
- Load archived button shown only when archived not yet loaded
- Search results info displayed only when filters active
- Type filter shows/hides entire sections (not filtering within sections)
- Dropdown and TextInput onChange receive value directly (string), not event object

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**1. Component interface mismatches during CourseListView implementation**
- **Issue:** Initial CourseListView used incorrect prop patterns (BackLink label prop, ErrorMessage message prop, Container header object, event.target.value in onChange handlers)
- **Resolution:** Reviewed Phase 2 and Phase 4 component interfaces, corrected to use BackLink children, ErrorMessage error prop, Container header ReactNode, and onChange value parameters
- **Verification:** TypeScript compilation passed with no errors

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- CourseList migration complete with search/filter/sort patterns
- Ready for CourseDetail view migration (Phase 4 Plan 3)
- Client-side filter patterns established for reuse in CourseDetail
- State persistence pattern ready for other views
- Navigation store integration validated with breadcrumbs

## Self-Check: PASSED

All created files verified:
- useCourseListStore.ts: FOUND
- CourseListView.tsx: FOUND
- CourseListView.module.css: FOUND
- types.ts: FOUND

All commits verified:
- f65ee78: Task 1 commit found
- d1a4149: Task 2 commit found

---
*Phase: 04-main-ui-views*
*Completed: 2026-02-23*
