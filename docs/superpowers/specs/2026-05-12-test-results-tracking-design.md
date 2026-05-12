# Test-Results View Tracking & Per-Task Feedback Modal — Design

**Date:** 2026-05-12
**Branch:** `feat/test-results-tracking` (off `feature/server-side-problem-statement-rendering-v2`)
**Status:** Draft for review

## Problem Statement

The extension currently shows all test feedbacks via a single "all-tests" modal (`TestResultsOverlay`) triggered from the "See test results" button in `SubmissionStatus`. Two gaps remain:

1. **No per-task feedback view.** Artemis' web client lets students click a `[task]` entry inside the problem statement to see only the tests belonging to that task (Bild 2 of the user's screenshots). Our extension renders the same `<span class="artemis-task" data-task-name="…" data-test-ids="…">` markup server-side (SSR), but no click handler is attached, so this drill-down doesn't exist in the extension.
2. **No recorder events for either view.** For the thesis evaluation we need to know whether and how long students engage with test feedback. Today neither overall-view opens nor per-task interactions emit anything to the session recorder.

## Goal

- Add click-handling so users can open a per-task feedback view directly from the SSR'd problem statement.
- Reuse the existing `TestResultsOverlay` component, parameterised by an optional `taskName` and an `onClose(reason)` callback.
- Emit two new recorder event types — `testResultsOverviewView` and `taskFeedbackView` — each as a discriminated union over `action: 'opened' | 'closed'`, paired by a webview-generated `viewId` UUID with a `durationMs` on close.

## Non-Goals

- No change to the SSR backend or to the `ProblemStatementRenderRequest` DTO. `includeJs: false` stays.
- No new modal styling. Existing `TestResultsOverlay` layout (header, summary, failed/passed sections, item rows) is used unchanged.
- No JUnit-message parsing (no Method/Scenario/Input/Expected/Actual split). The raw `message` continues to render as-is.
- No synthetic close-on-deactivate or close-on-unmount events. Analysis treats unclosed views as censored intervals.
- No tracking of scroll position, hover, or per-test "viewed" signals inside the modal.
- No change to the exam-mode exercise view (`ExamExerciseDetailView`). Per-task click handling only lives where the SSR'd problem statement is rendered (regular exercise detail). The "See test results" button itself is not used in exam mode.

## User-Facing Behaviour

1. Student is on an exercise-detail view that has a server-rendered problem statement. Tasks are visible inline as `[task]` markdown entries already rendered by Artemis (Bild 1).
2. Student clicks "doOverlap" task. A modal appears titled **"Feedback for task: doOverlap"** showing only the 4 tests linked to that task, grouped by failed/passed.
3. Student closes the modal (X button, Escape key, or backdrop click).
4. Student clicks the existing "See test results" button below the submission status. The same modal type appears titled **"Test Results"** with all tests.
5. Throughout, both opens and closes are recorded to the JSONL session recording with `durationMs` on each close event.

## Architecture

Three layers, communicating through `postCommand`:

```
┌─ Webview (React) ─────────────────────────────────────────────────┐
│  ProblemStatement.tsx                                             │
│    └─ <div onClick={handleSsrClick}>                              │
│         {dangerouslySetInnerHTML: SSR-HTML}                       │
│       handleSsrClick: detect .artemis-task[data-test-ids]        │
│         → derive viewId, taskName, testIds, counts               │
│         → emit onTaskClick                                        │
│                                                                   │
│  ExerciseDetailView.tsx                                           │
│    - holds openOverviewView | null, openTaskView | null           │
│    - mounts two TestResultsOverlay instances                      │
│    - posts taskFeedbackOpened/Closed + overview equivalents      │
│                                                                   │
│  TestResultsOverlay.tsx (existing, parameterised)                 │
│    - new prop: taskName?: string  → switches header text         │
│    - onClose: (reason?: 'button'|'escape'|'backdrop') => void    │
└────────────────────────────────────────────────────────────────────┘
                            │ postMessage
                            ▼
┌─ Extension command handlers ───────────────────────────────────────┐
│  webViewMessageHandler.ts (or new ssrTrackingCommands.ts)         │
│    case 'testResultsOverviewOpened' → recorder.recordTRO.opened()│
│    case 'testResultsOverviewClosed' → recorder.recordTRO.closed()│
│    case 'taskFeedbackOpened'        → recorder.recordTF.opened() │
│    case 'taskFeedbackClosed'        → recorder.recordTF.closed() │
└────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─ Recorder ─────────────────────────────────────────────────────────┐
│  sessionRecorder.ts (4 new public methods)                        │
│  recording/types.ts (2 new event types added to RecordedEvent)    │
└────────────────────────────────────────────────────────────────────┘
```

Key architectural decisions:

- **Webview measures `durationMs` locally.** On open, the React state stores `openedAt = Date.now()`. On close, the diff is computed and sent with the close command. Extension is a pass-through.
- **`viewId` is generated webview-side** via `crypto.randomUUID()` with a `Date.now() + Math.random()` fallback. Same UUID rides both `opened` and `closed` events.
- **Captured-payload pattern.** When the modal opens, a full snapshot of the close-event payload (`viewId`, `exerciseId`, `taskName`) is frozen into the view state. The close event references this snapshot — never the live DOM or store. This survives SSR re-renders or exercise-data mutations between open and close.
- **No synthetic close events.** If the user navigates away or VS Code is restarted while the modal is open, no `closed` event is emitted. Analysis treats this as a censored interval bounded by `sessionEnd.timestamp`.

## Recorder Event Schema

Added to `extension/src/extension/services/telemetry/recording/types.ts`. Both new event types are appended to the `RecordedEvent` union.

```ts
export type TestResultsOverviewViewEvent =
    | {
        type: 'testResultsOverviewView';
        action: 'opened';
        timestamp: number;
        viewId: string;
        exerciseId: number;
        participationId?: number;
        resultId?: number;
        totalTests: number;
        passedTests: number;
        failedTests: number;
    }
    | {
        type: 'testResultsOverviewView';
        action: 'closed';
        timestamp: number;
        viewId: string;
        exerciseId: number;
        durationMs: number;
        closeReason?: 'button' | 'escape' | 'backdrop';
    };

export type TaskFeedbackViewEvent =
    | {
        type: 'taskFeedbackView';
        action: 'opened';
        timestamp: number;
        viewId: string;
        exerciseId: number;
        participationId?: number;
        resultId?: number;
        taskName: string;
        testIds: number[];
        totalTests: number;
        passedTests: number;
        failedTests: number;
    }
    | {
        type: 'taskFeedbackView';
        action: 'closed';
        timestamp: number;
        viewId: string;
        exerciseId: number;
        taskName: string;
        durationMs: number;
        closeReason?: 'button' | 'escape' | 'backdrop';
    };
```

Public API on `sessionRecorder.ts`:

```ts
recordTestResultsOverviewOpened(payload: {
    viewId: string;
    exerciseId: number;
    participationId?: number;
    resultId?: number;
    totalTests: number;
    passedTests: number;
    failedTests: number;
}): void;

recordTestResultsOverviewClosed(payload: {
    viewId: string;
    exerciseId: number;
    durationMs: number;
    closeReason?: 'button' | 'escape' | 'backdrop';
}): void;

recordTaskFeedbackOpened(payload: {
    viewId: string;
    exerciseId: number;
    participationId?: number;
    resultId?: number;
    taskName: string;
    testIds: number[];
    totalTests: number;
    passedTests: number;
    failedTests: number;
}): void;

recordTaskFeedbackClosed(payload: {
    viewId: string;
    exerciseId: number;
    taskName: string;
    durationMs: number;
    closeReason?: 'button' | 'escape' | 'backdrop';
}): void;
```

All four methods follow the existing pattern from `recordIrisChatSent`:

```ts
public recordX(payload: ...): void {
    if (this._phase !== 'recording') { return; }
    this._lifecycle.recordInternal({
        type: '…',
        action: '…',
        timestamp: Date.now(),
        ...payload,
    }, {}, this._currentGeneration);
}
```

The phase guard is critical: when consent is downgraded or the recorder is idle, these methods become no-ops.

## UI Changes

### 1. `TestResultsOverlay.tsx` (existing, modified)

New optional prop:

```ts
interface TestResultsOverlayProps {
    open: boolean;
    onClose: (reason?: 'button' | 'escape' | 'backdrop') => void;  // signature widened
    testCases: TestCase[];
    loading?: boolean;
    taskName?: string;  // NEW
}
```

Header rendering:

```tsx
const title = taskName ? `Feedback for task: ${taskName}` : 'Test Results';
```

Empty state:

```tsx
const emptyMessage = taskName ? 'No tests in this task.' : 'No test results available.';
```

Three close triggers, all calling `onClose(reason)`:

| Source | Code change |
|---|---|
| `<IconButton.Close>` | `onClick={() => onClose('button')}` |
| Escape `keydown` | call `onClose('escape')` (currently calls `onClose()`) |
| Backdrop `<div>` click | NEW: `onClick={() => onClose('backdrop')}`, with `e.stopPropagation()` on `.modal` |

Backward compatibility: `reason` is optional. Existing callers that pass `() => void` keep compiling — the widened signature accepts that.

### 2. `ProblemStatement.tsx` (existing, modified)

New optional prop:

```ts
interface ProblemStatementProps {
    html: string;
    onTaskClick?: (task: { taskName: string; testIds: number[] }) => void;
}
```

Click handler:

```tsx
const handleClick: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!onTaskClick) { return; }
    const target = event.target as HTMLElement;
    const taskEl = target.closest<HTMLElement>('.artemis-task[data-test-ids]');
    if (!taskEl) { return; }
    const taskName = taskEl.getAttribute('data-task-name') ?? '';
    const rawIds = taskEl.getAttribute('data-test-ids') ?? '';
    const testIds = rawIds.split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => Number.isFinite(n));
    if (!taskName || testIds.length === 0) { return; }
    onTaskClick({ taskName, testIds });
};
```

Affordance — one CSS rule:

```css
.problemStatement .artemis-task[data-test-ids] {
    cursor: pointer;
    text-decoration: underline;
}
```

### 3. `ExerciseDetailView.tsx` (existing, expanded)

Two view states plus their handlers:

```ts
interface OpenViewState {
    viewId: string;
    openedAt: number;
    // Identity fields the close event needs (snapshotted at open). `durationMs`
    // and `closeReason` are computed at close time from `openedAt` and the trigger
    // source — they are NOT stored here.
    closeIdentity: {
        viewId: string;
        exerciseId: number;
        taskName?: string;
    };
}

const [openOverviewView, setOpenOverviewView] = useState<OpenViewState | null>(null);
const [openTaskView, setOpenTaskView] = useState<(OpenViewState & { taskName: string; filtered: TestCase[] }) | null>(null);
```

Single-modal invariant: opening either modal first closes any other open view synthetically (as `closeReason: 'button'` since the user actively clicked something else).

```ts
const handleOverviewOpen = () => {
    if (openTaskView) { handleTaskClose('button'); }
    // …generate viewId, open
};

const handleTaskOpen = ({ taskName, testIds }) => {
    if (openOverviewView) { handleOverviewClose('button'); }
    // …generate viewId, open
};
```

Two `<TestResultsOverlay>` instances mounted in JSX; both use `createPortal` so they live at `document.body`. Only one is open at any time per invariant.

### 4. `TestCase` shape (existing, expanded)

Defined in `extension/src/webview/components/exercise/SubmissionStatus.tsx`:

```ts
export interface TestCase {
    name: string;
    passed: boolean;
    message?: string;
    type?: 'structural' | 'behavioral';
    id?: number;  // NEW — populated from feedback.testCase.id
}
```

`transformFeedbacksToTestCases` in `extension/src/webview/utils/exerciseStatus.ts` populates `id` when available. Existing consumers ignore the new optional field.

A new helper `filterTestCasesByIds` lives in `extension/src/webview/utils/exerciseStatus.ts` (colocated with `transformFeedbacksToTestCases`):

```ts
export function filterTestCasesByIds(all: TestCase[], ids: number[]): TestCase[] {
    const idSet = new Set(ids);
    return all.filter(tc => tc.id !== undefined && idSet.has(tc.id));
}
```

### 5. `viewId` helper

New file `extension/src/webview/utils/viewId.ts`:

```ts
export function makeViewId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
```

## Click-Handling & Modal Lifecycle

### Open

1. User clicks a `.artemis-task[data-test-ids]` span inside the rendered problem statement, **or** clicks "See test results" button.
2. The webview generates a `viewId`, snapshots `openedAt = Date.now()` and the full close-payload into state.
3. Webview posts the appropriate `…Opened` command with all open-event fields.
4. Extension's command handler maps to `sessionRecorder.recordTestResultsOverviewOpened(...)` or `recordTaskFeedbackOpened(...)`.
5. Recorder phase-guards and appends the JSONL line.

### Close

1. Close is triggered by one of three sources (button, escape, backdrop).
2. Webview computes `durationMs = Date.now() - openedAt`.
3. Webview posts the `…Closed` command with the snapshotted `viewId`, `exerciseId`, optional `taskName`, `durationMs`, and `closeReason`.
4. Extension maps to `recordTestResultsOverviewClosed(...)` or `recordTaskFeedbackClosed(...)`.

### Re-open of the same task

Each open generates a new `viewId`. Two consecutive opens of "doOverlap" become two independent `(opened, closed)` pairs. Analysis can group by `taskName` to aggregate per-task engagement across reopens.

### Race conditions (explicit handling)

| Scenario | Behaviour |
|---|---|
| SSR re-render while modal open | Modal state is independent of DOM. `closePayload` is frozen at open. Close still emits the original payload. |
| `exerciseData` re-fetched mid-view | Same as above. The `participationId`/`resultId` in the close event are from the open snapshot, not the new data. |
| Click on a child element inside `.artemis-task` (icon, stats span) | `event.target.closest('.artemis-task[data-test-ids]')` walks up the tree. Works on any descendant click. |
| Webview never closes the modal (exercise switch, IDE shutdown) | No `closed` event. Recorder file shows an unmatched `opened`. Analysis treats as censored — `durationMs ≤ sessionEnd.timestamp - opened.timestamp`. |
| Modal A open, user clicks button for modal B | Synthetic `closed` (reason: `'button'`) for A is emitted **before** the `opened` for B. Single-modal invariant preserved. |
| Build result arrives during open task modal | `testCases` prop updates live. The visible test list reflects the latest data. The `opened`-event payload retains the original counts; the `closed` event does not re-report new counts. |
| Two `[task]` markdown entries with the same `data-task-name` | Each open gets its own `viewId`. Analysis groups by `viewId` for unambiguous pairing; secondary grouping by `taskName` is approximate. |

## Data Flow — Webview ↔ Extension wiring

### New webview-to-extension commands

Defined in `extension/src/shared/messageContracts/webviewCommands.ts`. Append four new `WebCmd` variants and corresponding payloads:

```ts
testResultsOverviewOpened: {
    viewId: string;
    exerciseId: number;
    participationId?: number;
    resultId?: number;
    totalTests: number;
    passedTests: number;
    failedTests: number;
};
testResultsOverviewClosed: {
    viewId: string;
    exerciseId: number;
    durationMs: number;
    closeReason?: 'button' | 'escape' | 'backdrop';
};
taskFeedbackOpened: {
    viewId: string;
    exerciseId: number;
    participationId?: number;
    resultId?: number;
    taskName: string;
    testIds: number[];
    totalTests: number;
    passedTests: number;
    failedTests: number;
};
taskFeedbackClosed: {
    viewId: string;
    exerciseId: number;
    taskName: string;
    durationMs: number;
    closeReason?: 'button' | 'escape' | 'backdrop';
};
```

All four are added to `COMMANDS_REQUIRING_PAYLOAD`.

### Command handlers

A new file `extension/src/extension/controller/commands/testResultsTrackingCommands.ts` (parallel to `utilityCommands.ts`) holds the four handlers. Each handler reads `getPayload<WebCmd<…>>(message)` and forwards to the recorder.

Sample handler:

```ts
private handleTaskFeedbackOpened = async (message: WebviewToExtensionMessage): Promise<void> => {
    try {
        const payload = getPayload<WebCmd<'taskFeedbackOpened'>>(message);
        this.context.sessionRecorder.recordTaskFeedbackOpened(payload);
    } catch (error: unknown) {
        logger.warn('Failed to record task-feedback open event', LogCategory.TELEMETRY, error);
    }
};
```

Registration follows the existing pattern in `webViewMessageHandler.ts`.

## Error Handling & Edge Cases

- **Phase guard:** All four recorder methods short-circuit if `this._phase !== 'recording'`. Webview is unaware of recording state — it posts the command regardless, the extension drops silently.
- **Consent downgrade mid-view:** If the user revokes consent while a modal is open, the next close command is dropped by the phase guard. The recording file ends with an unmatched open. This is consistent with how `irisChatMessage` events behave under the same scenario.
- **Malformed `data-test-ids`:** If the attribute is missing, empty, or contains non-numeric values, the click handler short-circuits and emits no event. No partial events.
- **Missing `data-task-name`:** Same — short-circuit, no event.
- **Webview crash mid-event-emission:** `postMessage` is fire-and-forget; if the message never reaches the extension, the close is lost. No retry. (This is acceptable because user-action events are inherently best-effort; the recorder is not transactional.)
- **`crypto.randomUUID` unavailable:** Fallback to `Date.now() + Math.random()` string. UUIDs are only for in-session pairing, not cryptographic identity.

## Testing Strategy

### Unit tests (Mocha, extension-side)

`extension/test/unit/services/telemetry/recording/sessionRecorderViewEvents.test.ts` — new file:

- Recorder methods emit the correct event shape with all four `(type, action)` combinations.
- Recorder methods are no-ops outside the `recording` phase.
- `recordInternal` is called with the current generation.

### React tests (Vitest, webview-side)

`extension/test/react/components/exercise/TestResultsOverlay.test.tsx` — extend:

- `taskName` prop renders `"Feedback for task: …"` header; absent renders `"Test Results"`.
- Empty-state message switches based on `taskName`.
- `onClose('button')` fires on X-button click.
- `onClose('escape')` fires on Escape keydown.
- `onClose('backdrop')` fires on backdrop click but not on modal-content click (`stopPropagation`).

`extension/test/react/views/ExerciseDetail/ProblemStatement.test.tsx` — extend:

- Click on a `.artemis-task[data-test-ids]` span calls `onTaskClick` with the parsed `taskName` and `testIds`.
- Click on a `.artemis-task` without `data-test-ids` does NOT fire.
- Click on a non-task element does NOT fire.
- Multiple `data-test-ids` with whitespace and trailing commas parse correctly.

`extension/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx` — extend:

- Clicking "See test results" posts `testResultsOverviewOpened` with computed counts.
- Closing the overlay posts `testResultsOverviewClosed` with a positive `durationMs` and the same `viewId`.
- Clicking a task in the problem statement posts `taskFeedbackOpened` with filtered `testIds` and counts.
- Opening overview while task modal is open posts `taskFeedbackClosed` first (synthetic), then `testResultsOverviewOpened`.
- The close event uses the `viewId` from the open event (snapshot pattern).

### Manual test plan

- Open an exercise with a known multi-task problem statement. Verify task spans have visible affordance (underline + pointer cursor).
- Click a task → modal opens with only that task's tests.
- Close via each of: X-button, Escape, backdrop click. Inspect the recording JSONL to confirm `closeReason` is set correctly.
- Reproduce the SSR re-render case: change theme while modal is open. Verify the modal stays open and the close event references the original snapshot.
- Open task modal, then click "See test results" (single-modal invariant). Verify exactly two events fire: `taskFeedbackClosed` then `testResultsOverviewOpened`.
- Open modal, close VS Code window. Verify the recording shows an unmatched `opened` and no synthetic close.

## Files Touched

```
Modified:
  extension/src/extension/services/telemetry/recording/types.ts
  extension/src/extension/services/telemetry/recording/sessionRecorder.ts
  extension/src/extension/controller/webViewMessageHandler.ts
  extension/src/shared/messageContracts/webviewCommands.ts
  extension/src/webview/components/exercise/TestResultsOverlay.tsx
  extension/src/webview/components/exercise/TestResultsOverlay.module.css   (backdrop click affordance)
  extension/src/webview/components/exercise/SubmissionStatus.tsx           (optional — propagate onClose(reason?))
  extension/src/webview/views/ExerciseDetail/components/ProblemStatement.tsx
  extension/src/webview/views/ExerciseDetail/components/ProblemStatement.module.css
  extension/src/webview/views/ExerciseDetail/ExerciseDetailView.tsx
  extension/src/webview/utils/exerciseStatus.ts                            (populate TestCase.id)

Created:
  extension/src/extension/controller/commands/testResultsTrackingCommands.ts
  extension/src/webview/utils/viewId.ts
  extension/test/unit/services/telemetry/recording/sessionRecorderViewEvents.test.ts
```

## Out of Scope / Future Work

- Per-test scroll/viewport tracking inside the modal (intersection observer). Postpone until base events are validated.
- Synthetic close-on-deactivate events. Requires central tracking of open views and reliable extension-side teardown hook.
- Server-side `interactive.js` integration. Currently the SSR HTML's `data-feedback` attribute and the bundled `interactive.js` are unused by design.
- Per-task feedback view in exam mode. Exam currently shows a plaintext fallback rather than the SSR HTML; integrating SSR into exam mode is out of scope for this branch.
- Pedagogical enhancements (e.g., "Ask Iris about this test" button inside the modal). Tracked as a separate feature.
