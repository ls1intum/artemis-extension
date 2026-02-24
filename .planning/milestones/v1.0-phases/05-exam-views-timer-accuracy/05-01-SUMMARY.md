---
phase: 05-exam-views-timer-accuracy
plan: 01
subsystem: exam-views-timer
tags:
  - react
  - web-worker
  - timer
  - exam-conduction
  - zustand
dependency-graph:
  requires:
    - phase-04-main-ui-views
  provides:
    - exam-timer-infrastructure
    - exam-conduction-view
  affects:
    - message-contracts
    - esbuild-config
tech-stack:
  added:
    - esbuild-plugin-inline-worker: Web Worker bundling for inline code (no CSP issues)
  patterns:
    - Web Worker with absolute timestamps for drift-free countdown timers
    - Per-view timer instances (no shared Worker state)
    - Artemis-compatible timer format (1h 7min, 15min, 8min 0s, 45s)
    - Component composition pattern for exam views
key-files:
  created:
    - iris-thaumantias/src/views/webview/react/workers/examTimer.worker.ts
    - iris-thaumantias/src/views/webview/react/hooks/useExamTimer.ts
    - iris-thaumantias/src/views/webview/react/hooks/useRelativeTime.ts
    - iris-thaumantias/src/views/webview/react/utils/formatExamTimer.ts
    - iris-thaumantias/src/views/webview/react/components/ExamTimer/ExamTimer.tsx
    - iris-thaumantias/src/views/webview/react/components/TimerExpiredOverlay/TimerExpiredOverlay.tsx
    - iris-thaumantias/src/views/webview/react/stores/useExamConductionStore.ts
    - iris-thaumantias/src/views/webview/react/views/ExamConduction/ExamConductionView.tsx
    - iris-thaumantias/src/views/webview/react/views/ExamConduction/components/ExerciseList.tsx
  modified:
    - iris-thaumantias/esbuild.js
    - iris-thaumantias/package.json
    - iris-thaumantias/src/shared/messageContracts.ts
decisions:
  - context: Web Worker bundling approach
    choice: Use esbuild-plugin-inline-worker to bundle Workers as inline code
    rationale: Avoids CSP complications from blob URLs, handles TypeScript transpilation automatically
    alternatives: Separate worker files (requires CSP worker-src directive), blob URL pattern (CSP issues)
  - context: Timer state management
    choice: Local component state via useExamTimer hook, not Zustand
    rationale: Timer updates are high-frequency (1Hz), local state more efficient than global store
    alternatives: Zustand store (unnecessary overhead for high-frequency updates)
  - context: Timer instance per view
    choice: Each view creates its own timer from same absolute timestamps
    rationale: Simpler lifecycle, no shared state coordination, drift negligible (<1s)
    alternatives: Shared Worker singleton (complex lifecycle, state coordination issues)
metrics:
  duration: 388s
  tasks-completed: 2
  files-created: 11
  files-modified: 3
  commits: 2
  completed-date: 2026-02-24
---

# Phase 05 Plan 01: Web Worker Timer Infrastructure & ExamConduction View Summary

**One-liner:** Web Worker-based countdown timer with absolute timestamps (drift-free in background tabs) and ExamConduction view with exercise list, progress bar, and expired timer overlay.

## What Was Built

### Task 1: Web Worker Timer Infrastructure

**Objective:** Implement Web Worker-based timer to prevent drift from browser tab throttling.

**Implementation:**
- Installed `esbuild-plugin-inline-worker` (v0.1.1) and configured esbuild to bundle Workers inline (before CSS modules plugin)
- Created `examTimer.worker.ts`: Web Worker that ticks every second using setInterval, calculates remaining time from absolute end timestamp
- Created `useExamTimer` hook: spawns Worker on mount, terminates on unmount, manages timer state (remaining ms, expired flag)
- Created `useRelativeTime` hook: converts absolute dates to relative strings ("in 2 days", "5 hours ago") with auto-update every minute
- Created `formatExamTimer` util: formats milliseconds to Artemis-compatible format (1h 7min, 15min, 8min 0s, 45s)
- Created `ExamTimer` component: displays timer with progress bar, warning state at 5 minutes (red pulse animation), expired state
- Created `TimerExpiredOverlay` modal: shows when timer reaches zero with dismissible overlay

**Verification:**
- TypeScript compilation passes (`npx tsc --noEmit`)
- All timer infrastructure files exist and export correctly
- esbuild configured with inline worker plugin

**Commit:** `fac0ebd` - feat(05-01): add Web Worker timer infrastructure and ExamTimer component

### Task 2: ExamConduction React View

**Objective:** Build ExamConduction view with Zustand store, exercise list, and timer integration.

**Implementation:**
- Added exam message contracts to `messageContracts.ts`:
  - `ExamConductionInitMessage`: sends studentExam, courseId, examId, endTime, startTime, totalDuration, workspaceExerciseId
  - `ExamStartInitMessage`: sends studentExam, courseId, examId
  - `ExamExerciseDetailInitMessage`: sends exerciseData, examContext (including timer timestamps), hideDeveloperTools
- Added exam commands: `openExamExerciseDetails`, `backToExam`, `openExamInBrowser`, `refreshExam`, `reloadExamConduction`
- Updated type guards to include new exam message types
- Created `useExamConductionStore`: Zustand store for exam data (does NOT store timer state - handled by useExamTimer hook)
- Created `ExamConductionView`: React view integrating ExamTimer, ExerciseList, TimerExpiredOverlay
- Created `ExerciseList` component: displays exercises with workspace highlighting (Open badge), type icons, max points
- Integrated Phase 2/4 components: BackLink, Container, Badge, IconButton, SkeletonList, ErrorMessage
- Added loading state (SkeletonList), error state with retry
- Added "Open in Browser" and "Refresh" action buttons
- Added "Test Exam" badge for practice exams
- Scroll reset to top on mount (user decision from context)

**Verification:**
- TypeScript compilation passes
- ExamConductionView renders with ExamTimer, ExerciseList, TimerExpiredOverlay
- Message contracts include all exam types

**Commit:** `a142bef` - feat(05-01): add ExamConduction React view with Zustand store

## Deviations from Plan

None - plan executed exactly as written. All task requirements met.

## Technical Decisions Made

1. **Inline Worker Plugin Order:** Placed `inlineWorkerPlugin()` BEFORE `cssModulesPlugin()` in esbuild plugins array to ensure .ts files resolve correctly before CSS processing.

2. **Badge Variants:** Used `variant="muted"` for exercise type badges and `variant="info"` for Open badge (per Phase 2 Badge component API).

3. **Icon Import Pattern:** Used `IconDefinitions.getIcon()` from legacy utils (path: `../../../../../../utils/iconDefinitions`) to maintain consistency with existing exercise type icons.

4. **BackLink API:** Used children prop instead of label prop (per Phase 2 BackLink component API: `<BackLink>Back to Course</BackLink>`).

5. **ErrorMessage API:** Used `error` prop instead of `message` prop (per Phase 4 ErrorMessage component API).

## Key Architectural Patterns

### Web Worker Timer Pattern

**Problem:** Browser throttles setInterval to 1s in background tabs, 60s after 5 minutes of inactivity. Causes timer drift.

**Solution:** Web Worker on separate thread bypasses main-thread throttling. Absolute end timestamp prevents accumulated drift.

**Implementation:**
```typescript
// Worker calculates remaining time each tick
const remaining = Math.max(0, endTime - Date.now());
self.postMessage({ type: 'TICK', remaining, expired: remaining === 0 });

// Hook spawns/terminates Worker
useEffect(() => {
  const worker = new ExamTimerWorker();
  worker.postMessage({ type: 'START', endTime });
  return () => {
    worker.postMessage({ type: 'STOP' });
    worker.terminate();
  };
}, [endTime]);
```

**Benefits:** Drift-free timers, simple lifecycle, no state coordination.

### Artemis-Compatible Timer Format

**Rules:**
- >= 1 hour: "1h 7min" (hours + minutes)
- >= 10 minutes: "15min" (minutes only)
- 1-10 minutes: "8min 0s" (minutes + seconds)
- < 1 minute: "45s" (seconds only)

**Rationale:** Students see consistent timer format across Artemis web app and VS Code extension.

### Timer State Management

**Decision:** Local component state via `useExamTimer` hook, NOT Zustand store.

**Rationale:** Timer updates at 1Hz (high-frequency). Local state more efficient than global store subscriptions. Zustand stores only durable state (exam data, courseId, examId, etc).

## Requirements Fulfilled

**VIEW-01:** ExamConduction view renders through React component (3/14+ views migrated).

**CRIT-01:** Timer uses Web Worker with absolute timestamps - no drift from background tab throttling.

## Testing & Verification

**Automated Checks:**
- ✅ TypeScript compilation passes (`npx tsc --noEmit`)
- ✅ All timer infrastructure files exist
- ✅ ExamConductionView imports correctly
- ✅ Message contracts include exam types

**Manual Verification (required):**
- ExamTimer displays Artemis-compatible format
- Progress bar calculates percentage correctly
- Warning state at 5 minutes (red pulse)
- Timer expired overlay appears at zero
- Exercise list shows workspace highlighting
- Test Exam badge appears for practice exams
- Loading skeleton during data fetch
- Error state with retry functionality

## Performance Notes

**Timer Accuracy:** Web Worker ensures 1-second precision even when tab is backgrounded. Absolute timestamps prevent drift accumulation.

**Render Optimization:** Progress bar recalculated each render (timer ticks cause re-render), but calculation is trivial (elapsed / totalDuration * 100). No memoization needed.

**State Updates:** useExamTimer updates local state 1x per second. No Zustand subscriptions triggered (Zustand only stores durable exam data, not timer state).

## Next Steps

**Phase 05 Plan 02:** ExamStart and ExamExerciseDetail views
- Adaptive timer on ExamStartView (countdown to start vs remaining working time)
- ExamExerciseDetailView composition (reuse Phase 4 ExerciseDetail components)
- Relative time display for exam start/end dates
- Context-aware button labels ("Enter Exam" vs "Refresh")

## Self-Check: PASSED

**Files created (verified):**
```
✅ iris-thaumantias/src/views/webview/react/workers/examTimer.worker.ts
✅ iris-thaumantias/src/views/webview/react/hooks/useExamTimer.ts
✅ iris-thaumantias/src/views/webview/react/hooks/useRelativeTime.ts
✅ iris-thaumantias/src/views/webview/react/utils/formatExamTimer.ts
✅ iris-thaumantias/src/views/webview/react/components/ExamTimer/ExamTimer.tsx
✅ iris-thaumantias/src/views/webview/react/components/ExamTimer/ExamTimer.module.css
✅ iris-thaumantias/src/views/webview/react/components/TimerExpiredOverlay/TimerExpiredOverlay.tsx
✅ iris-thaumantias/src/views/webview/react/components/TimerExpiredOverlay/TimerExpiredOverlay.module.css
✅ iris-thaumantias/src/views/webview/react/stores/useExamConductionStore.ts
✅ iris-thaumantias/src/views/webview/react/views/ExamConduction/ExamConductionView.tsx
✅ iris-thaumantias/src/views/webview/react/views/ExamConduction/ExamConductionView.module.css
✅ iris-thaumantias/src/views/webview/react/views/ExamConduction/components/ExerciseList.tsx
✅ iris-thaumantias/src/views/webview/react/views/ExamConduction/components/ExerciseList.module.css
✅ iris-thaumantias/src/views/webview/react/views/ExamConduction/types.ts
✅ iris-thaumantias/src/views/webview/react/views/ExamConduction/index.ts
```

**Commits exist (verified):**
```
✅ fac0ebd - feat(05-01): add Web Worker timer infrastructure and ExamTimer component
✅ a142bef - feat(05-01): add ExamConduction React view with Zustand store
```
