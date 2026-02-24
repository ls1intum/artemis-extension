---
phase: 05-exam-views-timer-accuracy
plan: 02
subsystem: exam-views
tags:
  - react
  - exam-views
  - zustand
  - router
  - dompurify
dependency-graph:
  requires:
    - phase-05-plan-01
    - phase-04-main-ui-views
  provides:
    - exam-start-view
    - exam-exercise-detail-view
    - exam-views-router-integration
  affects:
    - react-app-router
    - webview-provider
    - view-router
tech-stack:
  added:
    - dompurify: HTML sanitization for exam rules
    - "@types/dompurify": TypeScript types for DOMPurify
  patterns:
    - Adaptive timer (countdown to start / remaining working time)
    - HTML sanitization with DOMPurify for user-generated content
    - Phase 4 component composition (ProblemStatement, ScoreInfo, TestResults)
    - Exam-specific UI overrides (hide Ask Iris, show timer header)
key-files:
  created:
    - iris-thaumantias/src/views/webview/react/stores/useExamStartStore.ts
    - iris-thaumantias/src/views/webview/react/views/ExamStart/ExamStartView.tsx
    - iris-thaumantias/src/views/webview/react/views/ExamStart/ExamStartView.module.css
    - iris-thaumantias/src/views/webview/react/views/ExamStart/types.ts
    - iris-thaumantias/src/views/webview/react/views/ExamStart/index.ts
    - iris-thaumantias/src/views/webview/react/stores/useExamExerciseDetailStore.ts
    - iris-thaumantias/src/views/webview/react/views/ExamExerciseDetail/ExamExerciseDetailView.tsx
    - iris-thaumantias/src/views/webview/react/views/ExamExerciseDetail/ExamExerciseDetailView.module.css
    - iris-thaumantias/src/views/webview/react/views/ExamExerciseDetail/types.ts
    - iris-thaumantias/src/views/webview/react/views/ExamExerciseDetail/index.ts
  modified:
    - iris-thaumantias/package.json
    - iris-thaumantias/package-lock.json
    - iris-thaumantias/src/shared/messageContracts.ts
    - iris-thaumantias/src/views/webview/react/App.tsx
    - iris-thaumantias/src/views/app/viewRouter.ts
    - iris-thaumantias/src/provider/artemisWebviewProvider.ts
    - iris-thaumantias/src/views/app/commands/navigationCommands.ts
decisions:
  - context: Adaptive timer behavior
    choice: Show countdown to start before exam, remaining working time after exam starts
    rationale: Students need different information depending on exam state (before vs during)
    alternatives: Always show same timer format (less intuitive)
  - context: Date display format
    choice: Relative time only (no absolute dates)
    rationale: User decision from context - relative time is more intuitive ("in 2 days" vs "2026-02-26")
    alternatives: Show both absolute and relative (more cluttered UI)
  - context: Exam rules sanitization
    choice: Use DOMPurify for HTML sanitization
    rationale: Already installed in project, industry-standard library, prevents XSS attacks
    alternatives: Manual sanitization (error-prone), no sanitization (security risk)
  - context: Component reuse pattern
    choice: ExamExerciseDetail composes Phase 4 components directly
    rationale: Avoids duplication, maintains consistency, simplifies maintenance
    alternatives: Duplicate components for exam mode (unnecessary code duplication)
metrics:
  duration: 443s
  tasks-completed: 2
  files-created: 10
  files-modified: 7
  commits: 2
  completed-date: 2026-02-24
---

# Phase 05 Plan 02: ExamStart and ExamExerciseDetail React Views Summary

**One-liner:** ExamStart view with adaptive timer, sanitized rules, and context-aware buttons; ExamExerciseDetail composing Phase 4 components with exam-specific overrides; all 3 exam views wired into React coexistence router.

## What Was Built

### Task 1: ExamStart and ExamExerciseDetail React views with Zustand stores

**Objective:** Build ExamStart and ExamExerciseDetail views with adaptive timer, component composition, and Zustand state management.

**Implementation:**

**ExamStart View:**
- Created `useExamStartStore` Zustand store with exam data, courseId, examId, loading, error
- Created `ExamStartView.tsx` with adaptive timer behavior:
  - Before exam starts: countdown to start time using `useExamTimer(examStartDate)`
  - After exam starts: remaining working time using `useExamTimer(endTime)` with progress bar
  - Display: "Exam starts in: [timer]" vs "Time remaining: [timer]"
- Relative date display using `useRelativeTime` hook (no absolute dates)
  - Labels: "Started" / "Starts" and "Ended" / "Ends" based on current time
- Static working time display formatted as duration (e.g., "90 minutes", "2h 30min")
- Exam rules section with DOMPurify sanitization:
  - Installed `dompurify` and `@types/dompurify` packages
  - Sanitize HTML with `DOMPurify.sanitize()` before rendering
  - Text cleaning: remove HTML comments, normalize newlines, collapse multiple newlines, trim br tags
  - Collapsible details element with header "Exam Rules" and subtitle "Please review before you begin"
- Context-aware action buttons:
  - "Open in Browser" (primary) - sends `openExamInBrowser` command
  - "Enter Exam" when started, "Refresh" when not started - sends `refreshExam` command
- BackLink "← Back to Course" at top
- Layout: header card with exam title + dates + working time, rules card (collapsible), action buttons

**ExamExerciseDetail View:**
- Created `useExamExerciseDetailStore` for exam context (courseId, examId, studentExam, timer timestamps)
- Exercise data reuses `useExerciseDetailStore` from Phase 4 (no duplication)
- Component composition pattern - imports and reuses Phase 4 components:
  - `ProblemStatement` from `../ExerciseDetail/components/ProblemStatement`
  - `ScoreInfo` from `../ExerciseDetail/components/ScoreInfo`
  - `TestResults` from `../ExerciseDetail/components/TestResults`
  - `SubmissionStatus`, `ParticipationActions`, `BuildProgress` from shared exercise components
- Timer header area with BackLink "← Back to Exam" + ExamTimer component with progress bar
  - BackLink sends `backToExam` command (no payload - handler uses appStateManager context)
- TimerExpiredOverlay when working time expires
- Exercise content below timer using Phase 4 components
- ParticipationActions with `isExamExercise={true}` prop (hides "Open in browser" options)
- NO Ask Iris section (hidden during exams)
- NO fullscreen button (exam mode)
- WebSocket real-time updates using `useWebSocketUpdates` hook
- ReconnectBanner for WebSocket disconnect state
- Loading state: SkeletonList, Error state: ErrorMessage with retry

**Message handler pattern:**
- Listen for `examStartInit` / `examExerciseDetailInit` messages
- Send `{ type: 'ready' }` signal after listener registered
- Cleanup: remove listener on unmount

**Verification:**
- TypeScript compilation passes (`npx tsc --noEmit`)
- All views import correctly with proper types

**Commit:** `8232949` - feat(05-02): add ExamStart and ExamExerciseDetail React views with Zustand stores

### Task 2: Wire all 3 exam views into router, provider ready-signal, and resendViewData

**Objective:** Connect all 3 exam views (ExamStart, ExamConduction, ExamExerciseDetail) to the extension infrastructure.

**Implementation:**

**1. Updated `App.tsx`:**
- Imported all 3 exam views: `ExamStartView`, `ExamConductionView`, `ExamExerciseDetailView`
- Added 3 cases to switch statement:
  - `case 'examStart': return <ExamStartView vscodeApi={vscodeApi} />;`
  - `case 'examConduction': return <ExamConductionView vscodeApi={vscodeApi} />;`
  - `case 'examExerciseDetail': return <ExamExerciseDetailView vscodeApi={vscodeApi} />;`

**2. Updated `viewRouter.ts`:**
- Added exam views to `_reactViews` map:
  - `['exam-start', true]` // Phase 5: migrated
  - `['exam-conduction', true]` // Phase 5: migrated
  - `['exam-exercise-detail', true]` // Phase 5: migrated
- `_stateToViewName` already has correct mappings (verified)

**3. Updated `artemisWebviewProvider.ts` - ready signal handler:**
Added 3 new else-if branches in ready signal handler:

- **exam-conduction**: Calculate timer timestamps (startTime, endTime, totalDuration), detect workspace exercise, send `examConductionInit` message with studentExam, courseId, examId, timestamps, workspaceExerciseId
- **exam-start**: Send `examStartInit` message with studentExam, courseId, examId
- **exam-exercise-detail**: Calculate timer timestamps, send `examExerciseDetailInit` message with exerciseData, examContext (courseId, examId, studentExam, timestamps), hideDeveloperTools

**4. resendViewData method:**
Already supports all 3 exam views (added in Plan 01) - verified same logic as ready signal handlers

**5. Updated `navigationCommands.ts`:**
- Added `handleReloadExamConduction` command handler:
  - Fetches fresh studentExam data from API
  - Calls `startStudentExam` to get conduction details
  - Updates appStateManager with fresh data
  - Calls `resendViewData()` for in-place reload (no webview destruction)
- Registered `reloadExamConduction: this.handleReloadExamConduction` in command map
- Existing `handleBackToExam` already works correctly (calls `appStateManager.backToExam()` then `render()`)

**Verification:**
- TypeScript compilation passes
- App.tsx has all 3 exam cases
- viewRouter.ts has exam views in _reactViews map
- Provider sends correct init messages on ready signal
- resendViewData handles all 3 exam states

**Commit:** `3da7e1f` - feat(05-02): wire all 3 exam views into router, provider, and resendViewData

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed BackToExamCommand message contract**
- **Found during:** Task 1 TypeScript compilation
- **Issue:** BackToExamCommand message contract (added in Plan 01) included payload with courseId and examId, but the handler `handleBackToExam` doesn't use any payload - it calls `appStateManager.backToExam()` which already knows the current exam context
- **Fix:** Removed unused payload from BackToExamCommand interface in messageContracts.ts
- **Files modified:** iris-thaumantias/src/shared/messageContracts.ts
- **Commit:** Included in Task 1 commit `8232949`
- **Rationale:** Type definition must match handler implementation. Payload was unnecessary since appStateManager maintains exam context

## Technical Decisions Made

1. **Adaptive Timer Implementation:** Used conditional logic to determine timer behavior based on `hasStarted` flag. Before exam starts, show countdown to `examStartDate`. After exam starts, calculate `endTime = startTime + workingTime*1000` and show remaining time. This provides context-appropriate information to students.

2. **Working Time Display:** Static formatted duration (not a timer) using helper function `formatWorkingTime()`. Shows "2h 30min" or "90 minutes" depending on duration. Complements the adaptive timer by showing total allocated time.

3. **HTML Sanitization:** Used DOMPurify for exam rules because exam startText is user-generated content (instructors write rules). Sanitization prevents XSS attacks while preserving formatting. Applied same text cleaning as legacy view (remove HTML comments, normalize newlines, etc.) before sanitization.

4. **TestResults Component Mapping:** ExamExerciseDetail receives feedbacks array from API, but TestResults component expects testCases array. Mapped feedbacks to testCases format: `{ name: feedback.text, passed: feedback.positive, message: feedback.detailText }`.

5. **Timer State Management:** ExamExerciseDetail uses local `showExpiredOverlay` state managed via useEffect that checks `examContext.endTime`. Alternative would be to use timer hook, but this is simpler for one-time check.

## Key Architectural Patterns

### Adaptive Timer Pattern

**Problem:** ExamStart view needs to show different timer information depending on exam state (before vs during).

**Solution:** Conditional timer behavior based on `hasStarted` flag.

**Implementation:**
```typescript
const hasStarted = examStartDate ? Date.now() >= examStartDate.getTime() : false;

let timerEndTime: number | null = null;
let timerLabel = '';

if (!hasStarted && examStartDate) {
    // Countdown to exam start
    timerEndTime = examStartDate.getTime();
    timerLabel = 'Exam starts in:';
} else if (hasStarted && studentExam?.workingTime) {
    // Remaining working time
    const startTime = /* calculate based on testExam vs regular exam */;
    timerEndTime = startTime + studentExam.workingTime * 1000;
    timerLabel = 'Time remaining:';
}

const { remaining, expired } = useExamTimer(timerEndTime);
```

**Benefits:** Context-appropriate information for students, single component handles both states, reuses same timer infrastructure.

### Component Composition Pattern

**Problem:** ExamExerciseDetail needs same functionality as ExerciseDetail (problem statement, test results, scores) but with exam-specific overrides (timer, no Iris, back to exam link).

**Solution:** Compose Phase 4 components directly instead of duplicating.

**Implementation:**
```typescript
import { ProblemStatement, ScoreInfo, TestResults } from '../ExerciseDetail/components';
import { SubmissionStatus, ParticipationActions, BuildProgress } from '../../components/exercise';

// Reuse exercise detail store for exercise data
const { exerciseData, setExerciseData } = useExerciseDetailStore();

// Use exam store only for exam context
const { examContext, setExamExerciseData } = useExamExerciseDetailStore();

// Render Phase 4 components with exam props
<ParticipationActions isExamExercise={true} {...otherProps} />
<ProblemStatement markdown={problemStatementHtml} {...otherProps} />
<TestResults testCases={mappedFeedbacks} />
```

**Benefits:** Zero duplication, maintains consistency with ExerciseDetail, simplifies maintenance, respects single source of truth.

### HTML Sanitization Pattern

**Problem:** Exam rules contain user-generated HTML from instructors that must be displayed safely.

**Solution:** DOMPurify sanitization with text cleaning preprocessing.

**Implementation:**
```typescript
const sanitizeRules = (html: string): string => {
    if (!html) return 'No rules defined for this exam.';

    let processed = html;
    // Remove HTML comments
    processed = processed.replace(/<!--[\s\S]*?-->/g, '');
    // Normalize newlines
    processed = processed.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Remove newlines around block elements
    // ... (block tag processing)
    // Collapse multiple newlines
    processed = processed.replace(/\n{3,}/g, '\n\n');
    // Trim br tags
    processed = processed.replace(/^(\s*<br\s*\/?>\s*)+/i, '').replace(/(\s*<br\s*\/?>\s*)+$/i, '');
    processed = processed.trim();

    // Sanitize with DOMPurify
    return DOMPurify.sanitize(processed);
};
```

**Benefits:** Prevents XSS attacks, preserves formatting, matches legacy behavior, industry-standard library.

## Requirements Fulfilled

**VIEW-01:** All 3 exam views (ExamStart, ExamConduction, ExamExerciseDetail) migrated to React and routed through coexistence router (3/14+ views complete for Phase 5).

**CRIT-01:** Timer accuracy maintained through Web Worker infrastructure (from Plan 01) - all exam views use same drift-free timer pattern.

## Testing & Verification

**Automated Checks:**
- ✅ TypeScript compilation passes (`npx tsc --noEmit`)
- ✅ All exam views import correctly
- ✅ App.tsx has cases for all 3 exam views
- ✅ viewRouter.ts _reactViews map includes exam views
- ✅ Provider ready signal sends typed init messages
- ✅ resendViewData supports all exam states

**Manual Verification (required):**
- ExamStartView renders with adaptive timer (countdown before start, remaining time after start)
- ExamStartView displays relative dates (no absolute dates)
- ExamStartView sanitizes rules HTML correctly
- ExamStartView shows context-aware buttons ("Enter Exam" vs "Refresh")
- ExamExerciseDetailView imports Phase 4 components (ProblemStatement, ScoreInfo, TestResults)
- ExamExerciseDetailView hides Ask Iris section
- ExamExerciseDetailView shows timer header with "Back to Exam" link
- ExamExerciseDetailView shows ParticipationActions without "Open in browser" option
- All 3 exam views receive init messages on ready signal
- Reload handlers update views without destroying webview

## Performance Notes

**Component Composition:** ExamExerciseDetail reuses Phase 4 components with zero duplication. Single source of truth for exercise rendering logic reduces bundle size and maintenance burden.

**HTML Sanitization:** DOMPurify sanitization happens once on mount (when exam rules are received). Sanitized HTML is then cached in component state. No repeated sanitization on re-renders.

**Adaptive Timer:** Conditional logic in ExamStartView determines which timer to show. Timer calculation is trivial (timestamp arithmetic). useExamTimer hook manages Web Worker lifecycle - no performance impact from adaptive behavior.

## Next Steps

**Phase 05 Plan 03:** (if exists) Continue exam views migration

**Phase 06:** Code analysis and optimization
- Identify dead code from legacy views
- Bundle size optimization
- Performance profiling

## Self-Check: PASSED

**Files created (verified):**
```
✅ iris-thaumantias/src/views/webview/react/stores/useExamStartStore.ts
✅ iris-thaumantias/src/views/webview/react/views/ExamStart/ExamStartView.tsx
✅ iris-thaumantias/src/views/webview/react/views/ExamStart/ExamStartView.module.css
✅ iris-thaumantias/src/views/webview/react/views/ExamStart/types.ts
✅ iris-thaumantias/src/views/webview/react/views/ExamStart/index.ts
✅ iris-thaumantias/src/views/webview/react/stores/useExamExerciseDetailStore.ts
✅ iris-thaumantias/src/views/webview/react/views/ExamExerciseDetail/ExamExerciseDetailView.tsx
✅ iris-thaumantias/src/views/webview/react/views/ExamExerciseDetail/ExamExerciseDetailView.module.css
✅ iris-thaumantias/src/views/webview/react/views/ExamExerciseDetail/types.ts
✅ iris-thaumantias/src/views/webview/react/views/ExamExerciseDetail/index.ts
```

**Commits exist (verified):**
```
✅ 8232949 - feat(05-02): add ExamStart and ExamExerciseDetail React views with Zustand stores
✅ 3da7e1f - feat(05-02): wire all 3 exam views into router, provider, and resendViewData
```
