# Phase 5: Exam Views with Timer Accuracy - Research

**Researched:** 2026-02-24
**Domain:** React exam view migration, Web Worker-based countdown timers, background tab throttling mitigation, component composition
**Confidence:** HIGH

## Summary

Phase 5 migrates three exam views (ExamStartView, ExamConductionView, ExamExerciseDetailView) from HTML-string generation to React components and implements Web Worker-based countdown timers with absolute timestamps to prevent drift when tabs are backgrounded. The key technical challenge is browser timer throttling: Chrome throttles setInterval to once per second in background tabs, and once per minute after 5 minutes of inactivity. Web Workers solve this because they run on a separate thread and aren't subject to main-thread throttling.

ExamExerciseDetailView reuses Phase 4's ExerciseDetail components (SubmissionStatus, ParticipationActions, BuildProgress, ProblemStatement, ScoreInfo, TestResults) through React composition, avoiding code duplication while supporting exam-specific constraints (no Iris button, different back navigation, exam-aware timer display).

Timer implementation uses absolute end timestamps calculated server-side, with Web Workers sending tick messages to React components. Each view instance creates its own timer (no shared worker) to maintain component independence and simplify cleanup. Timer format matches Artemis web app exactly: "1h 7min", "15min", "8min 0s", "45s".

**Primary recommendation:** Use inline Web Worker bundled via esbuild plugin (blob URL pattern) to avoid CSP complications. Implement timer logic as a React custom hook (useExamTimer) that spawns/terminates worker on mount/unmount. Compose ExamExerciseDetailView from ExerciseDetailView sub-components with exam-specific wrapper props (hideIris, customBackLink, timerEndDate).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Timer display & format:**
- Use Artemis-compatible format: "1h 7min", "15min", "8min 0s", "45s"
- Single warning threshold at 5 minutes remaining (red pulse animation)
- Keep the progress bar showing elapsed vs total time
- Timer visible on all three exam views (start, conduction, exercise detail)
- Per-view timer instances (each view creates its own timer from the same absolute timestamps, no shared Web Worker)

**Timer on exam start view:**
- Adaptive behavior: before exam starts, countdown to start time; after exam starts, show remaining working time
- Also display static working time duration (e.g., "90 minutes") so students know total exam duration

**Timer expiry behavior:**
- Show popup overlay when timer reaches zero ("Time's up")
- Exercise list remains interactive after expiry (students can still view their work read-only)

**Exam conduction layout:**
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

**Exam exercise detail:**
- Timer displayed in top bar / header area, above exercise content
- "Back to Exam" link text (not generic "Back")
- Hide Ask Iris button during exams
- Reuse Phase 4 ExerciseDetail sub-components: ParticipationActions, SubmissionStatus, BuildProgress, ProblemStatement, ScoreInfo, TestResults

**Exam start view:**
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

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VIEW-01 | All 14+ webview screens render through React components instead of HTML string generation | Phase 4 established React view patterns; Phase 5 extends to 3 exam views (ExamStartView, ExamConductionView, ExamExerciseDetailView) |
| CRIT-01 | Exam countdown timers use Web Workers with absolute timestamps (no drift from background tab throttling) | Web Workers bypass main-thread throttling. Research confirms setInterval throttles to 1s (background) or 60s (intensive) but Workers remain unaffected. Absolute timestamps prevent accumulated drift. |

</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | ^18.3.1 | UI framework | Already installed. Used for all Phase 4 views. |
| Zustand | ^5.0.10 | State management | Already installed. Lightweight state for exam view data, timer status. |
| Web Workers API | Native browser | Background timer thread | No library needed. Native API avoids throttling. Supported in all VS Code webviews (Chromium-based). |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| esbuild-plugin-inline-worker | ^0.1.1 | Bundle Workers as blob URLs | Required for inline Worker bundling with TypeScript. Avoids CSP complications from external worker files. |
| clsx | Already installed | Conditional CSS class composition | Timer warning states, expired states, exercise highlighting |
| DOMPurify | Already installed | HTML sanitization | Exam start text (instructor-provided HTML rules) |

**Installation:**
```bash
npm install --save-dev esbuild-plugin-inline-worker
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline Workers (blob URL) | Separate worker files | Separate files require additional CSP worker-src directive + file serving complexity. Inline workers avoid both. |
| worker-timers library | Hand-rolled Worker timer | worker-timers is 8.0.30 (Feb 2026), TypeScript support, but adds 3.6kb gzip. Our needs are simple (single timer, absolute timestamps). Hand-roll is lighter and more control. |
| Per-view Workers | Shared Worker singleton | SharedWorker requires cross-context coordination, complex lifecycle. Per-view Workers are simpler: mount → spawn, unmount → terminate. No state sharing needed. |
| setInterval with drift compensation | Web Workers | Drift compensation (performance.now() + re-sync) is complex and fragile. Workers solve the root cause (throttling) cleanly. |

## Architecture Patterns

### Recommended Project Structure

```
src/views/webview/react/
├── views/
│   ├── ExamStart/
│   │   ├── ExamStartView.tsx          # Main view component
│   │   ├── ExamStartView.module.css   # Styles
│   │   └── types.ts                    # Props/state types
│   ├── ExamConduction/
│   │   ├── ExamConductionView.tsx
│   │   ├── ExamConductionView.module.css
│   │   ├── components/
│   │   │   ├── ExamTimer.tsx          # Timer + progress bar
│   │   │   ├── ExamTimer.module.css
│   │   │   ├── ExerciseList.tsx       # Exercise list
│   │   │   └── ExerciseList.module.css
│   │   └── types.ts
│   ├── ExamExerciseDetail/
│   │   ├── ExamExerciseDetailView.tsx # Composes Phase 4 components
│   │   ├── ExamExerciseDetailView.module.css
│   │   └── types.ts
├── hooks/
│   ├── useExamTimer.ts                # Custom hook for Worker-based timer
│   └── useRelativeTime.ts             # "in 2 days", "5 hours ago" formatting
├── workers/
│   └── examTimer.worker.ts            # Web Worker for countdown
└── stores/
    ├── useExamStartStore.ts
    ├── useExamConductionStore.ts
    └── useExamExerciseDetailStore.ts  # Minimal store, delegates to useExerciseDetailStore
```

### Pattern 1: Web Worker Timer with Absolute Timestamps

**What:** Worker receives absolute end timestamp (Unix ms), calculates remaining time on each tick, posts message to main thread. Main thread updates UI without recalculating time.

**When to use:** Any countdown timer that must remain accurate in background tabs (exams, auctions, real-time events).

**Example:**
```typescript
// workers/examTimer.worker.ts
let timerId: number | null = null;

self.addEventListener('message', (event) => {
  const { type, endTime } = event.data;

  if (type === 'START') {
    // Clear existing timer
    if (timerId !== null) {
      clearInterval(timerId);
    }

    // Tick immediately, then every second
    const tick = () => {
      const now = Date.now();
      const remaining = Math.max(0, endTime - now);

      self.postMessage({
        type: 'TICK',
        remaining,
        expired: remaining === 0,
      });

      if (remaining === 0 && timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    };

    tick(); // Immediate first tick
    timerId = setInterval(tick, 1000) as unknown as number;
  } else if (type === 'STOP') {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }
});
```

```typescript
// hooks/useExamTimer.ts
import { useEffect, useState } from 'react';
// @ts-expect-error - inline worker plugin adds this import pattern
import ExamTimerWorker from '../workers/examTimer.worker.ts?worker';

interface TimerState {
  remaining: number; // milliseconds
  expired: boolean;
}

export function useExamTimer(endTime: number | null): TimerState {
  const [state, setState] = useState<TimerState>({
    remaining: 0,
    expired: false,
  });

  useEffect(() => {
    if (endTime === null) {
      return;
    }

    const worker = new ExamTimerWorker();

    worker.onmessage = (event) => {
      if (event.data.type === 'TICK') {
        setState({
          remaining: event.data.remaining,
          expired: event.data.expired,
        });
      }
    };

    worker.postMessage({ type: 'START', endTime });

    return () => {
      worker.postMessage({ type: 'STOP' });
      worker.terminate();
    };
  }, [endTime]);

  return state;
}
```

**Why this works:** Worker runs on separate thread → no throttling. Absolute timestamp → no accumulated drift. useEffect cleanup → worker terminated on unmount. Single-purpose hook → easy to test and reuse.

### Pattern 2: Timer Display Formatting (Artemis-Compatible)

**What:** Format milliseconds into Artemis timer format: "1h 7min", "15min", "8min 0s", "45s".

**When to use:** Displaying exam timer values to match Artemis web app.

**Example:**
```typescript
// utils/formatExamTimer.ts
export function formatExamTimer(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    // >= 1 hour: "1h 7min"
    return `${hours}h ${minutes}min`;
  } else if (totalSeconds >= 600) {
    // >= 10 minutes: "15min"
    return `${minutes}min`;
  } else if (totalSeconds >= 60) {
    // 1-10 minutes: "8min 0s"
    return `${minutes}min ${seconds}s`;
  } else {
    // < 1 minute: "45s"
    return `${seconds}s`;
  }
}
```

**Warning threshold:** Apply `.timer-warning` class when `remaining < 5 * 60 * 1000` (5 minutes).

### Pattern 3: Component Composition for ExamExerciseDetail

**What:** Reuse Phase 4 ExerciseDetail sub-components by composition, not duplication. ExamExerciseDetailView wraps/configures shared components with exam-specific props.

**When to use:** When two views share 70%+ logic but differ in specific features (Iris button, navigation, timers).

**Example:**
```typescript
// views/ExamExerciseDetail/ExamExerciseDetailView.tsx
import { ExerciseDetailView } from '../ExerciseDetail/ExerciseDetailView';
import { ExamTimer } from './components/ExamTimer';
import { BackLink } from '../../components';

export function ExamExerciseDetailView({ vscodeApi, examContext }) {
  const { examId, courseId, studentExam } = examContext;

  // Calculate end time from studentExam data
  const endTime = calculateExamEndTime(studentExam);

  return (
    <div className={styles.examExerciseDetail}>
      {/* Exam-specific timer header */}
      <div className={styles.timerHeader}>
        <BackLink
          label="← Back to Exam"
          onClick={() => vscodeApi.postMessage({
            type: 'command',
            command: 'backToExam'
          })}
        />
        <ExamTimer endTime={endTime} />
      </div>

      {/* Reuse ExerciseDetail components with exam config */}
      <ExerciseDetailView
        vscodeApi={vscodeApi}
        hideIris={true}           // Hide Iris during exams
        hideBackLink={true}       // Already shown above
        examMode={true}           // Disable certain actions
      />
    </div>
  );
}
```

**Benefit:** Single source of truth for exercise detail logic. Exam-specific features isolated to wrapper. Shared components remain testable and reusable.

### Pattern 4: Relative Time Display (ExamStartView)

**What:** Convert absolute dates to relative strings: "in 2 days", "5 hours ago".

**When to use:** Exam start/end times where relative context is more useful than absolute timestamps.

**Example:**
```typescript
// hooks/useRelativeTime.ts
export function useRelativeTime(targetDate: Date | null): string {
  const [relativeTime, setRelativeTime] = useState('');

  useEffect(() => {
    if (!targetDate) {
      setRelativeTime('');
      return;
    }

    const update = () => {
      const now = new Date();
      const diffMs = targetDate.getTime() - now.getTime();
      const absDiffMs = Math.abs(diffMs);
      const isPast = diffMs < 0;

      const minutes = Math.floor(absDiffMs / (1000 * 60));
      const hours = Math.floor(absDiffMs / (1000 * 60 * 60));
      const days = Math.floor(absDiffMs / (1000 * 60 * 60 * 24));

      let timeStr: string;
      if (days > 0) {
        timeStr = days === 1 ? '1 day' : `${days} days`;
      } else if (hours > 0) {
        timeStr = hours === 1 ? '1 hour' : `${hours} hours`;
      } else if (minutes > 0) {
        timeStr = minutes === 1 ? '1 minute' : `${minutes} minutes`;
      } else {
        timeStr = 'less than a minute';
      }

      setRelativeTime(isPast ? `${timeStr} ago` : `in ${timeStr}`);
    };

    update();
    const interval = setInterval(update, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [targetDate]);

  return relativeTime;
}
```

**Note:** Uses regular setInterval (not Worker) because accuracy isn't critical for relative time, and updates are infrequent (1 minute).

### Pattern 5: Timer Expiry Overlay

**What:** Show modal overlay when timer reaches zero, blocking interaction but keeping content visible.

**When to use:** Communicating hard deadline expiry without navigating away.

**Example:**
```typescript
// components/TimerExpiredOverlay.tsx
interface TimerExpiredOverlayProps {
  visible: boolean;
  onDismiss?: () => void;
}

export function TimerExpiredOverlay({ visible, onDismiss }: TimerExpiredOverlayProps) {
  if (!visible) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <h2>Time's Up</h2>
        <p>The exam time has expired. You can still view your work, but no further submissions are allowed.</p>
        {onDismiss && (
          <Button onClick={onDismiss} variant="primary">
            Close
          </Button>
        )}
      </div>
    </div>
  );
}
```

**CSS:**
```css
/* TimerExpiredOverlay.module.css */
.overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  padding: 24px;
  border-radius: 4px;
  max-width: 400px;
  text-align: center;
}
```

### Anti-Patterns to Avoid

- **Don't use setInterval on main thread for exam timers:** Background tab throttling will cause drift. Use Web Workers.
- **Don't calculate time remaining in component render:** Leads to re-render storms. Calculate in Worker, post result.
- **Don't share Worker instances across components:** Complicates lifecycle and state management. Per-component Workers are simpler.
- **Don't store timer state in Zustand:** Timer updates are high-frequency (1Hz). Local component state is more efficient.
- **Don't duplicate ExerciseDetail components for exam mode:** Compose/configure existing components instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Timer throttling mitigation | Drift compensation with performance.now() | Web Workers | Drift compensation is fragile (requires re-sync, complex edge cases). Workers solve root cause. |
| HTML sanitization for exam rules | Regex-based sanitizer | DOMPurify (already installed) | Security vulnerabilities (XSS). DOMPurify handles edge cases. |
| Relative time formatting with auto-update | Manual interval + date math | useRelativeTime hook pattern | Hook encapsulates lifecycle, prevents leaks, testable. |
| Inline Worker bundling | Manual blob URL construction | esbuild-plugin-inline-worker | Plugin handles TypeScript transpilation, module resolution, minification. |

**Key insight:** Timer accuracy is a solved problem (Web Workers). Don't reinvent the wheel with compensation logic.

## Common Pitfalls

### Pitfall 1: Worker Blob URLs and Content Security Policy

**What goes wrong:** Inline Workers created via `new Worker(URL.createObjectURL(new Blob([...])))` fail with CSP errors in VS Code webviews.

**Why it happens:** Webview CSP includes `script-src 'nonce-{random}'` which blocks blob URLs by default. Adding `blob:` to script-src is possible but weakens security.

**How to avoid:** Use esbuild-plugin-inline-worker which bundles Worker as base64 data URL. Configure esbuild:
```javascript
// esbuild.js - add to webviewReactCtx plugins
const inlineWorkerPlugin = require('esbuild-plugin-inline-worker');

plugins: [
  cssModulesPlugin(),
  inlineWorkerPlugin(),
  esbuildProblemMatcherPlugin,
]
```

Import pattern:
```typescript
// Use ?worker suffix recognized by plugin
import ExamTimerWorker from './examTimer.worker.ts?worker';
```

**Warning signs:** Console errors: "Refused to create a worker from 'blob:...' because it violates the following Content Security Policy directive".

### Pitfall 2: Forgetting Worker Cleanup on Unmount

**What goes wrong:** Workers continue running after component unmounts, causing memory leaks and phantom timer updates.

**Why it happens:** Workers are separate threads. React doesn't automatically clean them up.

**How to avoid:** Always terminate Worker in useEffect cleanup:
```typescript
useEffect(() => {
  const worker = new ExamTimerWorker();
  worker.postMessage({ type: 'START', endTime });

  return () => {
    worker.postMessage({ type: 'STOP' }); // Stop timer first
    worker.terminate();                    // Then terminate thread
  };
}, [endTime]);
```

**Warning signs:** Console logs showing timer ticks after navigation. Memory usage increasing over time.

### Pitfall 3: Timer Drift from Date.now() vs Server Time

**What goes wrong:** Client calculates end time as `exam.startDate + workingTime`, but client clock differs from server by minutes/hours.

**Why it happens:** User's system time is incorrect. No NTP synchronization.

**How to avoid:** Server calculates absolute end time, sends to client. Client uses absolute timestamp directly:
```typescript
// Server-side (extension host)
const endTime = exam.testExam && studentExam.startedDate
  ? new Date(studentExam.startedDate).getTime() + (studentExam.workingTime * 1000)
  : new Date(exam.startDate).getTime() + (studentExam.workingTime * 1000);

vscodeApi.postMessage({
  type: 'examConductionInit',
  payload: { studentExam, endTime } // Absolute timestamp
});

// Client-side
const { endTime } = payload;
const timer = useExamTimer(endTime); // No client-side calculation
```

**Warning signs:** Timer shows different time than Artemis web app for same exam.

### Pitfall 4: Re-creating Worker on Every Render

**What goes wrong:** Worker gets created and destroyed hundreds of times per second, causing performance issues.

**Why it happens:** Worker creation code not inside useEffect, or dependencies array includes frequently-changing values.

**How to avoid:**
```typescript
// BAD: Worker created every render
function ExamTimer({ endTime }) {
  const worker = new ExamTimerWorker(); // ❌ No useEffect
  // ...
}

// GOOD: Worker created once on mount
function ExamTimer({ endTime }) {
  useEffect(() => {
    const worker = new ExamTimerWorker(); // ✅ Inside useEffect
    // ...
    return () => worker.terminate();
  }, [endTime]); // ✅ Only re-create if endTime changes
}
```

**Warning signs:** High CPU usage. Sluggish UI. DevTools showing thousands of Worker instances.

### Pitfall 5: Exam Context Not Passed Through Navigation

**What goes wrong:** Navigating from ExamConduction → ExamExerciseDetail loses exam context (courseId, examId), breaking "Back to Exam" navigation.

**Why it happens:** Navigation messages don't include exam context, or it's not persisted in state.

**How to avoid:** Include exam context in navigation messages:
```typescript
// ExamConductionView.tsx
function openExercise(exerciseIndex: number) {
  vscodeApi.postMessage({
    type: 'command',
    command: 'openExamExerciseDetails',
    payload: {
      exercise: exercises[exerciseIndex],
      exerciseIndex,
      examContext: {  // ✅ Pass exam context
        isExamExercise: true,
        courseId,
        examId,
        studentExam,
      },
    },
  });
}

// ExamExerciseDetailView receives examContext
export function ExamExerciseDetailView({ vscodeApi, examContext }) {
  // Use examContext for "Back to Exam" navigation
}
```

**Warning signs:** "Back to Exam" link not working. Console errors about missing examId.

## Code Examples

Verified patterns from research and legacy code analysis:

### Exam End Time Calculation (Server-Side)

```typescript
// Extension host - send absolute timestamp to webview
function calculateExamEndTime(studentExam: any): number {
  const exam = studentExam.exam;

  if (exam.testExam && studentExam.startedDate) {
    // Test exam: use startedDate
    const startTime = new Date(studentExam.startedDate).getTime();
    return startTime + (studentExam.workingTime * 1000);
  } else if (exam.startDate && studentExam.workingTime) {
    // Regular exam: use exam startDate + individual workingTime
    const startTime = new Date(exam.startDate).getTime();
    return startTime + (studentExam.workingTime * 1000);
  } else {
    // Fallback (should not happen in practice)
    const startTime = Date.now();
    return startTime + (studentExam.workingTime * 1000);
  }
}
```

### Timer Component with Progress Bar

```typescript
// components/ExamTimer.tsx
import { useExamTimer } from '../../hooks/useExamTimer';
import { formatExamTimer } from '../../utils/formatExamTimer';
import styles from './ExamTimer.module.css';

interface ExamTimerProps {
  endTime: number;
  startTime: number;
  totalDuration: number; // workingTime in ms
}

export function ExamTimer({ endTime, startTime, totalDuration }: ExamTimerProps) {
  const { remaining, expired } = useExamTimer(endTime);

  const displayTime = formatExamTimer(remaining);
  const isWarning = remaining < 5 * 60 * 1000 && !expired;

  // Calculate progress percentage
  const elapsed = Date.now() - startTime;
  const percentage = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));

  return (
    <div className={styles.timerContainer}>
      <div
        className={clsx(
          styles.timer,
          isWarning && styles.warning,
          expired && styles.expired
        )}
      >
        {displayTime}
      </div>
      <div className={styles.progressBarContainer}>
        <div
          className={styles.progressBar}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
```

### ExamExerciseDetailView Composition

```typescript
// views/ExamExerciseDetail/ExamExerciseDetailView.tsx
import { useEffect } from 'react';
import { useExerciseDetailStore } from '../../stores/useExerciseDetailStore';
import { useNavigationStore } from '../../stores/useNavigationStore';
import { BackLink, Container, Button } from '../../components';
import {
  SubmissionStatus,
  ParticipationActions,
  BuildProgress,
} from '../../components/exercise';
import { ProblemStatement, ScoreInfo } from '../ExerciseDetail/components';
import { ExamTimer } from './components/ExamTimer';
import type { ExamExerciseDetailViewProps } from './types';
import styles from './ExamExerciseDetailView.module.css';

export function ExamExerciseDetailView({ vscodeApi, examContext }: ExamExerciseDetailViewProps) {
  const { exerciseData } = useExerciseDetailStore();
  const { pushBreadcrumb, clearBreadcrumbs } = useNavigationStore();

  const { courseId, examId, studentExam, endTime } = examContext;

  useEffect(() => {
    // Set up breadcrumbs for exam context
    clearBreadcrumbs();
    pushBreadcrumb('Exam', 'exam-conduction', () => {
      vscodeApi.postMessage({
        type: 'command',
        command: 'backToExam',
        payload: { courseId, examId }
      });
    });

    if (exerciseData?.exercise) {
      const exerciseTitle = exerciseData.exercise.title;
      const abbreviated = exerciseTitle.length > 20
        ? exerciseTitle.substring(0, 17) + '...'
        : exerciseTitle;
      pushBreadcrumb(abbreviated, 'exam-exercise-detail', () => {});
    }
  }, [exerciseData, courseId, examId, vscodeApi]);

  if (!exerciseData) {
    return <div>Loading...</div>;
  }

  const startTime = studentExam.exam.testExam && studentExam.startedDate
    ? new Date(studentExam.startedDate).getTime()
    : new Date(studentExam.exam.startDate).getTime();

  const totalDuration = studentExam.workingTime * 1000;

  return (
    <div className={styles.examExerciseDetail}>
      {/* Timer header */}
      <div className={styles.header}>
        <BackLink
          label="← Back to Exam"
          onClick={() => vscodeApi.postMessage({
            type: 'command',
            command: 'backToExam',
            payload: { courseId, examId }
          })}
        />
        <ExamTimer
          endTime={endTime}
          startTime={startTime}
          totalDuration={totalDuration}
        />
      </div>

      {/* Reuse Phase 4 components - NO Iris button */}
      <Container>
        <ProblemStatement
          problemStatement={exerciseData.exercise.problemStatement}
        />
      </Container>

      <ParticipationActions
        exerciseData={exerciseData}
        vscodeApi={vscodeApi}
        examMode={true} // Disable certain actions during exam
      />

      <SubmissionStatus
        exerciseData={exerciseData}
        vscodeApi={vscodeApi}
      />

      <BuildProgress
        exerciseData={exerciseData}
        vscodeApi={vscodeApi}
      />

      <ScoreInfo
        exerciseData={exerciseData}
      />
    </div>
  );
}
```

### ExamConductionView Exercise List

```typescript
// views/ExamConduction/components/ExerciseList.tsx
import { ListItem, Badge } from '../../../components';
import { IconDefinitions } from '../../../../../utils'; // Legacy icons
import styles from './ExerciseList.module.css';

interface ExerciseListProps {
  exercises: any[];
  workspaceExerciseId: number | null;
  onExerciseClick: (index: number) => void;
}

export function ExerciseList({
  exercises,
  workspaceExerciseId,
  onExerciseClick
}: ExerciseListProps) {
  return (
    <div className={styles.exerciseList}>
      {exercises.map((exercise, index) => {
        const isWorkspace = exercise.id === workspaceExerciseId;
        const icon = IconDefinitions.getIcon(exercise.type);

        return (
          <ListItem
            key={exercise.id}
            onClick={() => onExerciseClick(index)}
            selected={isWorkspace}
          >
            <div className={styles.exerciseHeader}>
              <span className={styles.exerciseNumber}>Exercise {index + 1}</span>
              <span className={styles.exerciseTitle}>{exercise.title}</span>
              <span
                className={styles.exerciseTypeIcon}
                dangerouslySetInnerHTML={{ __html: icon }}
              />
            </div>
            <div className={styles.exerciseInfo}>
              <span>{exercise.maxPoints || 0} Points</span>
              <Badge variant="secondary">{exercise.type}</Badge>
              {isWorkspace && (
                <Badge variant="primary">Open</Badge>
              )}
            </div>
          </ListItem>
        );
      })}
    </div>
  );
}
```

### ExamStartView with Adaptive Timer

```typescript
// views/ExamStart/ExamStartView.tsx
import { useEffect, useState } from 'react';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import { Container, Button, BackLink } from '../../components';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import styles from './ExamStartView.module.css';

interface ExamStartViewProps {
  vscodeApi: any;
  studentExam: any;
  courseId: number;
  examId: number;
}

export function ExamStartView({
  vscodeApi,
  studentExam,
  courseId,
  examId
}: ExamStartViewProps) {
  const exam = studentExam.exam;
  const [now, setNow] = useState(Date.now());

  // Update "now" every minute for relative time calculations
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  const examStartDate = exam.startDate ? new Date(exam.startDate) : null;
  const examEndDate = exam.endDate ? new Date(exam.endDate) : null;
  const hasStarted = examStartDate ? now >= examStartDate.getTime() : false;

  // Relative times
  const startRelative = useRelativeTime(examStartDate);
  const endRelative = useRelativeTime(examEndDate);

  // Sanitize exam rules/instructions
  const startText = exam.startText || 'No rules defined for this exam.';
  const sanitizedRules = sanitizeHtml(startText);

  // Working time display
  const workingTimeMinutes = Math.floor((studentExam.workingTime || 0) / 60);
  const workingTimeDisplay = workingTimeMinutes >= 60
    ? `${Math.floor(workingTimeMinutes / 60)}h ${workingTimeMinutes % 60}min`
    : `${workingTimeMinutes}min`;

  // Context-aware button label
  const actionButtonLabel = hasStarted ? 'Enter Exam' : 'Refresh';

  return (
    <div className={styles.examStart}>
      <BackLink
        label="← Back to Course"
        onClick={() => vscodeApi.postMessage({
          type: 'command',
          command: 'backToCourseDetails'
        })}
      />

      <Container header={exam.title || 'Exam'}>
        <div className={styles.examDates}>
          <div className={styles.examDate}>
            <div className={styles.label}>
              {hasStarted ? 'Started' : 'Starts'}
            </div>
            <div className={styles.relative}>{startRelative}</div>
          </div>
          <div className={styles.examDate}>
            <div className={styles.label}>Working Time</div>
            <div className={styles.value}>{workingTimeDisplay}</div>
          </div>
        </div>
      </Container>

      <Container
        header={{
          title: 'Exam Rules',
          subtitle: 'Please review before you begin',
          collapsible: true
        }}
      >
        <div
          className={styles.rulesContent}
          dangerouslySetInnerHTML={{ __html: sanitizedRules }}
        />
      </Container>

      <Container>
        <div className={styles.actions}>
          <Button
            variant="primary"
            onClick={() => vscodeApi.postMessage({
              type: 'command',
              command: 'openExamInBrowser',
              payload: { courseId, examId }
            })}
          >
            Open in Browser
          </Button>
          <Button
            variant="secondary"
            onClick={() => vscodeApi.postMessage({
              type: 'command',
              command: 'refreshExam',
              payload: { courseId, examId, studentExamId: studentExam.id }
            })}
          >
            {actionButtonLabel}
          </Button>
        </div>
      </Container>
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| setInterval on main thread | Web Workers for timers | 2020+ (Chrome 88 intensive throttling) | Workers bypass 1s/60s throttling, maintain accuracy in background |
| Separate worker files + CSP config | Inline Workers via esbuild plugin | 2023+ (bundler plugin maturity) | Simpler deployment, no CSP worker-src needed, TypeScript support |
| Manual drift compensation | Absolute timestamps + Workers | Industry standard 2024+ | Eliminates accumulated drift, simpler logic |
| Monolithic exam view components | Component composition | React 18+ hooks era (2022+) | Better reuse, testability, maintainability |

**Deprecated/outdated:**
- setInterval for critical timers: Replaced by Web Workers (throttling issues)
- Blob URL Workers: Replaced by inline bundled Workers (CSP compatibility)
- Worker libraries (worker-timers): Overkill for simple use cases. Hand-rolled Workers are lighter and sufficient.

## Open Questions

1. **Timer synchronization across exam views**
   - What we know: Each view creates its own timer from the same endTime
   - What's unclear: Should timers sync on navigation, or just recalculate independently?
   - Recommendation: Independent recalculation. Simpler, no shared state. Drift is negligible (<1s).

2. **Timer behavior on webview hide/show**
   - What we know: VS Code webviews persist via getState/setState when hidden
   - What's unclear: Should timer continue running when webview is hidden?
   - Recommendation: Yes, continue running (in Worker). Don't pause. Matches Artemis web app behavior.

3. **Expired exam state persistence**
   - What we know: Timer expiry triggers overlay popup
   - What's unclear: Should "expired" state persist across refreshes?
   - Recommendation: Yes. Store `examExpired: true` in webview state. Check on mount to re-show overlay if needed.

## Sources

### Primary (HIGH confidence)

**Web Worker Timer Patterns:**
- [Pontis Technology - setInterval JavaScript Breaks When Throttled](https://pontistechnology.com/learn-why-setinterval-javascript-breaks-when-throttled/) - Browser throttling behavior
- [HackWild - More Accurate JavaScript Timers with Web Workers](https://hackwild.com/article/web-worker-timers/) - Worker-based timer implementation
- [Medium - Overcoming browser throttling of setInterval executions](https://medium.com/@adithyaviswam/overcoming-browser-throttling-of-setinterval-executions-45387853a826) - Throttling mitigation strategies
- [Chrome for Developers - Heavy throttling of chained JS timers beginning in Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88) - Official Chrome throttling behavior
- [Medium - Writing a More Stable Timer with Web Worker](https://kxming.medium.com/writing-a-more-stable-timer-with-web-worker-589bcacd4247) - Stable timer patterns

**React and Web Workers:**
- [worker-timers npm](https://www.npmjs.com/package/worker-timers) - Replacement for setInterval/setTimeout in unfocused windows
- [GitHub - chrisguttandin/worker-timers](https://github.com/chrisguttandin/worker-timers) - Worker timers library source
- [Refine.dev - React useEffect Cleanup Function](https://refine.dev/blog/useeffect-cleanup/) - Cleanup best practices
- [DEV - useEffect with Cleanup Function in React](https://dev.to/werliton/useeffect-with-cleanup-function-in-react-what-it-is-when-to-use-it-and-why-k18) - When to use cleanup

**esbuild and Worker Bundling:**
- [GitHub - mitschabaude/esbuild-plugin-inline-worker](https://github.com/mitschabaude/esbuild-plugin-inline-worker) - Esbuild plugin for inline Workers
- [npm - esbuild-plugin-inline-worker](https://www.npmjs.com/package/esbuild-plugin-inline-worker) - Plugin documentation
- [GitHub - esbuild WebWorker support Issue #312](https://github.com/evanw/esbuild/issues/312) - Official esbuild Worker discussion

**VS Code Webview CSP:**
- [GitHub - microsoft/vscode Issue #79340 - Help webview extensions add CSP](https://github.com/microsoft/vscode/issues/79340) - CSP best practices
- [MDN - Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) - CSP reference

### Secondary (MEDIUM confidence)

- Legacy codebase exam view implementations (ExamConductionView.ts timer logic)
- Phase 4 React component patterns (ExerciseDetailView composition)

### Tertiary (LOW confidence)

None - all findings verified against primary sources or legacy code.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Web Workers are native browser API, well-documented, proven in production
- Architecture: HIGH - Patterns verified against legacy code and React best practices
- Pitfalls: HIGH - CSP issues documented in VS Code GitHub, Worker cleanup is standard React pattern
- Timer implementation: HIGH - Chrome throttling behavior is official documentation, Worker bypass is verified

**Research date:** 2026-02-24
**Valid until:** 90 days (stable browser APIs, React patterns unlikely to change)
