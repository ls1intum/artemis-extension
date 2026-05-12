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
- No per-task click handling in exam mode. `ExamExerciseDetailView` uses a plaintext fallback rather than the SSR'd HTML, so there are no `[task]` spans to click. **However**, exam mode already mounts `SubmissionStatus` with the existing "See test results" overlay; since this change removes the overlay-mount from `SubmissionStatus`, the exam view must also be updated. Exam mode mounts its own untracked `TestResultsOverlay` instance (no `viewId`, no command posted, no recorder event). Test-results viewing in exam mode is deliberately not tracked for this iteration — could be added later by passing tracking callbacks to the same plumbing.

## User-Facing Behaviour

1. Student is on an exercise-detail view that has a server-rendered problem statement. Tasks are visible inline as `[task]` markdown entries already rendered by Artemis (Bild 1).
2. Student clicks "doOverlap" task. A modal appears titled **"Feedback for task: doOverlap"** showing only the 4 tests linked to that task, grouped by failed/passed.
3. Student closes the modal (X button or Escape key).
4. Student clicks the existing "See test results" button below the submission status. The same modal type appears titled **"Test Results"** with all tests.
5. Throughout, both opens and closes are recorded to the JSONL session recording with `durationMs` on each close event.

## Architecture

Three layers, communicating through `postCommand`:

```
┌─ Webview (React) ─────────────────────────────────────────────────┐
│  ProblemStatement.tsx                                             │
│    └─ <div onClick={handleSsrClick}>                              │
│         {dangerouslySetInnerHTML: serverRenderedHtml}             │
│       handleSsrClick: detect .artemis-task[data-test-ids]        │
│         → derive viewId, taskName, testIds, counts               │
│         → emit onTaskClick                                        │
│                                                                   │
│  ExerciseDetailView.tsx                                           │
│    - holds openOverviewView | null, openTaskView | null           │
│    - mounts BOTH TestResultsOverlay instances (moved out of      │
│      SubmissionStatus)                                            │
│    - posts taskFeedbackOpened/Closed + overview equivalents      │
│                                                                   │
│  SubmissionStatus.tsx (existing, simplified)                      │
│    - "See test results" button stays here                         │
│    - overlay rendering REMOVED — moved to ExerciseDetailView      │
│    - new callback prop: onOpenTestResults(): void                 │
│                                                                   │
│  TestResultsOverlay.tsx (existing, parameterised)                 │
│    - new prop: taskName?: string  → switches header text         │
│    - onClose: (reason: 'button'|'escape')             │
└────────────────────────────────────────────────────────────────────┘
                            │ postMessage (4 new commands)
                            ▼
┌─ Extension provider ───────────────────────────────────────────────┐
│  ArtemisWebviewProvider                                           │
│    - new EventEmitters:                                           │
│        onDidOpenTestResultsOverview: Event<{viewId, …counts}>     │
│        onDidCloseTestResultsOverview: Event<{viewId, durationMs}> │
│        onDidOpenTaskFeedback: Event<{viewId, taskName, testIds…}> │
│        onDidCloseTaskFeedback: Event<{viewId, taskName, dur…}>    │
│    - WebviewMessageHandler dispatches commands → fires events     │
└────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─ Activation wiring (sessionRecorderWiring.ts) ─────────────────────┐
│  Subscribes to the 4 new provider events, calls recorder methods. │
│  Matches the existing pattern used for chat/intervention events.  │
└────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─ Recorder ─────────────────────────────────────────────────────────┐
│  sessionRecorder.ts (4 new public methods)                        │
│  recording/types.ts (2 new event types added to RecordedEvent)    │
└────────────────────────────────────────────────────────────────────┘
```

Key architectural decisions:

- **Provider-events + wiring-subscription pattern.** Following the existing recorder integration style (`onDidSendIrisChatMessage`, `onDidProvideIrisChatFeedback`, the EQ/intervention emitters), `ArtemisWebviewProvider` exposes four typed `vscode.Event`s. `sessionRecorderWiring.ts` subscribes and calls the recorder methods. The command-handler layer (`webViewMessageHandler.ts`) only translates webview messages into provider-event payloads. The recorder is NOT injected into `CommandContext`.
- **Webview measures `durationMs` locally.** On open, the React state stores `openedAt = Date.now()`. On close, the diff is computed and sent with the close command. Extension is a pass-through; it does not maintain open-view state.
- **`viewId` is generated webview-side** via `crypto.randomUUID()` with a `Date.now() + Math.random()` fallback. Same UUID rides both `opened` and `closed` events.
- **Captured-payload pattern.** When the modal opens, a full snapshot of the close-event identity fields (`viewId`, `exerciseId`, `participationId`, `resultId`, `taskName`) is frozen into the view state. The close event references this snapshot — never the live DOM or store. This survives SSR re-renders or exercise-data mutations between open and close.
- **Two kinds of "close" with distinct reasons.** Real user-triggered closes (`'button' | 'escape'`) are always emitted. A user opening one modal while another is open emits a `closeReason: 'replaced'` close for the previously-open one before the new `opened`. No close events are synthesised in any other situation: if the user navigates away or VS Code is restarted while a modal is open, no `closed` event is emitted, and analysis treats this as a censored interval bounded by `sessionEnd.timestamp`.

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
        participationId?: number;
        resultId?: number;
        durationMs: number;
        closeReason: 'button' | 'escape' | 'replaced';
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
        participationId?: number;
        resultId?: number;
        taskName: string;
        durationMs: number;
        closeReason: 'button' | 'escape' | 'replaced';
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
    participationId?: number;
    resultId?: number;
    durationMs: number;
    closeReason: 'button' | 'escape' | 'replaced';
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
    participationId?: number;
    resultId?: number;
    taskName: string;
    durationMs: number;
    closeReason: 'button' | 'escape' | 'replaced';
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
    onClose: (reason: 'button' | 'escape') => void;  // signature widened, reason required
    testCases: TestCase[];
    loading?: boolean;
    taskName?: string;  // NEW
}
```

Note: `'replaced'` is NOT a value the overlay itself can produce — it's the caller's responsibility to emit it before opening another overlay. The overlay union is the three user-driven reasons only.

Header rendering:

```tsx
const title = taskName ? `Feedback for task: ${taskName}` : 'Test Results';
```

Empty state:

```tsx
const emptyMessage = taskName ? 'No tests in this task.' : 'No test results available.';
```

Four close triggers, all calling `onClose(reason)`. Three are user actions; `'replaced'` is emitted from `ExerciseDetailView` (not the overlay) when the user opens a different modal:

| Source | Code change | Where |
|---|---|---|
| `<IconButton.Close>` | `onClick={() => onClose('button')}` | inside overlay |
| Escape `keydown` | call `onClose('escape')` (currently calls `onClose()`) | inside overlay |
| Modal replaced by opening the other one | `ExerciseDetailView` calls its own close handler with `'replaced'` | in parent before opening new modal |

`onClose` signature is widened to require the `reason` (no more optional). Both callers of the overlay (the two instances in `ExerciseDetailView`) are migrated in this same change.

### 2. `ProblemStatement.tsx` (existing, modified)

The component is already typed as `ProblemStatementProps` in `extension/src/webview/views/ExerciseDetail/types.ts` and currently takes `serverRenderedHtml?: string`. We add one new optional prop without renaming anything else:

```ts
// types.ts
export interface ProblemStatementProps {
    serverRenderedHtml?: string;                                              // existing
    onTaskClick?: (task: { taskName: string; testIds: number[] }) => void;    // NEW
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

### 3. `SubmissionStatus.tsx` (existing, simplified — required change)

Currently `SubmissionStatus` both renders the "See test results" button AND mounts the `<TestResultsOverlay>`. The overlay rendering is moved out so that `ExerciseDetailView` can own the open/close lifecycle, generate `viewId`s, and enforce the single-modal invariant.

Concrete diff:

```ts
// SubmissionStatusProps
interface SubmissionStatusProps {
    // …existing fields…
    onOpenTestResults?: () => void;   // NEW — replaces the toggle callback
    // REMOVED: onToggleTestResults, showTestResults (overlay state lives in parent now)
}
```

The button click handler just calls `onOpenTestResults?.()`. The `<TestResultsOverlay>` mount and the `useState` for `showTestResults` are deleted from this file.

The parent (`ExerciseDetailView`) keeps the boolean visibility via its own state and mounts the overlay there.

### 4. `ExerciseDetailView.tsx` (existing, expanded)

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
        participationId?: number;
        resultId?: number;
        taskName?: string;
    };
}

const [openOverviewView, setOpenOverviewView] = useState<OpenViewState | null>(null);
const [openTaskView, setOpenTaskView] = useState<(OpenViewState & { taskName: string; filtered: TestCase[] }) | null>(null);
```

Single-modal invariant: opening either modal first closes any other open view with `closeReason: 'replaced'`.

```ts
const handleOverviewOpen = () => {
    if (openTaskView) { handleTaskClose('replaced'); }
    // …generate viewId, open
};

const handleTaskOpen = ({ taskName, testIds }) => {
    if (openOverviewView) { handleOverviewClose('replaced'); }
    // …generate viewId, open
};
```

Two `<TestResultsOverlay>` instances mounted in JSX; both use `createPortal` so they live at `document.body`. Only one is open at any time per invariant.

### 5. `TestCase` shape (existing, expanded)

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

### 6. `viewId` helper

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
4. The extension's command handler reads the payload and calls `providerRegistry.getArtemisWebviewProvider()?.fireXxxOpened(payload)`.
5. The provider's EventEmitter fires. `sessionRecorderWiring.ts` (subscribed) calls `sessionRecorder.recordTestResultsOverviewOpened(...)` or `recordTaskFeedbackOpened(...)`.
6. Recorder phase-guards and appends the JSONL line.

### Close

1. Close is triggered by one of two user sources (X button, Escape key) — or synthetically via `'replaced'` from the parent when opening another modal. The current full-screen modal layout has no clickable backdrop area, so backdrop is intentionally NOT a close source for this implementation.
2. Webview computes `durationMs = Date.now() - openedAt`.
3. Webview posts the `…Closed` command with the snapshotted `viewId`, `exerciseId`, optional `participationId`/`resultId`/`taskName`, `durationMs`, and `closeReason`.
4. Same command-handler → provider-event → wiring → recorder path as on open. The recorder method called is `recordTestResultsOverviewClosed(...)` or `recordTaskFeedbackClosed(...)`.

### Re-open of the same task

Each open generates a new `viewId`. Two consecutive opens of "doOverlap" become two independent `(opened, closed)` pairs. Analysis can group by `taskName` to aggregate per-task engagement across reopens.

### Race conditions (explicit handling)

| Scenario | Behaviour |
|---|---|
| SSR re-render while modal open | Modal state is independent of DOM. `closeIdentity` is frozen at open. Close still emits the original payload. |
| `exerciseData` re-fetched mid-view | Same as above. The `participationId`/`resultId` in the close event are from the open snapshot, not the new data. |
| Click on a child element inside `.artemis-task` (icon, stats span) | `event.target.closest('.artemis-task[data-test-ids]')` walks up the tree. Works on any descendant click. |
| Webview never closes the modal (exercise switch, IDE shutdown) | No `closed` event. Recorder file shows an unmatched `opened`. Analysis treats as censored — `durationMs ≤ sessionEnd.timestamp - opened.timestamp`. |
| Modal A open, user clicks button for modal B | `closed` for A is emitted with `closeReason: 'replaced'` **before** the `opened` for B. Single-modal invariant preserved. |
| Feedback record has no `testCase.id` | `transformFeedbacksToTestCases` writes `id: undefined`. `filterTestCasesByIds` excludes it. Modal shows only the subset with matching IDs — possibly fewer than the task's full `testIds.length` or empty. The `opened`-event `totalTests` reflects the **filtered** length (what the user actually sees), not the SSR `testIds.length`. |
| All `testCase.id`s missing across feedbacks | Filtered list is empty. Modal still opens (so the click is recorded), shows the empty-state copy. The `opened` event carries `totalTests: 0`. This degenerate case is visible in analysis. |
| Result re-fetched after open: testIds gone | Live `testCases` prop changes; modal may end up empty if no IDs match anymore. The captured snapshot in close-identity is unchanged. |
| SSR rendered against `studentParticipations[0]` but view shows practice-mode participation | `feedback.testCase.id` is exercise-level, identical across participations, so IDs still match. **Caveat:** if the two participations have run different subsets of tests, only the tests with feedback records in the currently-displayed participation are visible. The `opened` event uses the visible counts. |
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
    participationId?: number;
    resultId?: number;
    durationMs: number;
    closeReason: 'button' | 'escape' | 'replaced';
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
    participationId?: number;
    resultId?: number;
    taskName: string;
    durationMs: number;
    closeReason: 'button' | 'escape' | 'replaced';
};
```

These payload types are also re-exported as named types (`TestResultsOverviewOpenedPayload`, etc.) so the provider's EventEmitters and `sessionRecorderWiring.ts` can reference the same shape without duplication.

All four are added to `COMMANDS_REQUIRING_PAYLOAD`.

### Command handlers and provider events

The wiring follows the existing pattern used for Iris-chat and intervention telemetry: the webview provider exposes typed `vscode.Event`s, and `sessionRecorderWiring.ts` subscribes. The command-handler layer does NOT call the recorder directly, and `CommandContext` is NOT modified.

**On `ArtemisWebviewProvider`** — four new EventEmitters and their public `Event` getters:

```ts
private readonly _onDidOpenTestResultsOverview = new vscode.EventEmitter<TestResultsOverviewOpenedPayload>();
private readonly _onDidCloseTestResultsOverview = new vscode.EventEmitter<TestResultsOverviewClosedPayload>();
private readonly _onDidOpenTaskFeedback = new vscode.EventEmitter<TaskFeedbackOpenedPayload>();
private readonly _onDidCloseTaskFeedback = new vscode.EventEmitter<TaskFeedbackClosedPayload>();

readonly onDidOpenTestResultsOverview = this._onDidOpenTestResultsOverview.event;
readonly onDidCloseTestResultsOverview = this._onDidCloseTestResultsOverview.event;
readonly onDidOpenTaskFeedback = this._onDidOpenTaskFeedback.event;
readonly onDidCloseTaskFeedback = this._onDidCloseTaskFeedback.event;
```

The payload types live alongside the command definitions in `shared/messageContracts/webviewCommands.ts` so the same shapes describe both the wire format and the provider event.

**Provider-registry extension** (`extension/src/extension/services/ui/providerRegistry.ts`) — add `ArtemisWebviewProvider` to the registry, symmetric with the existing chat-provider accessor:

```ts
export interface IProviderRegistry {
    getChatWebviewProvider(): IChatWebviewProvider | undefined;
    setChatWebviewProvider(provider: IChatWebviewProvider): void;
    // NEW
    getArtemisWebviewProvider(): IArtemisWebviewProvider | undefined;
    setArtemisWebviewProvider(provider: IArtemisWebviewProvider): void;
}
```

A new minimal interface `IArtemisWebviewProvider` (in a new `extension/src/extension/types/IArtemisWebviewProvider.ts`) declares only what the command handlers and wiring need:

```ts
export interface IArtemisWebviewProvider {
    fireTestResultsOverviewOpened(payload: TestResultsOverviewOpenedPayload): void;
    fireTestResultsOverviewClosed(payload: TestResultsOverviewClosedPayload): void;
    fireTaskFeedbackOpened(payload: TaskFeedbackOpenedPayload): void;
    fireTaskFeedbackClosed(payload: TaskFeedbackClosedPayload): void;
    readonly onDidOpenTestResultsOverview: vscode.Event<TestResultsOverviewOpenedPayload>;
    readonly onDidCloseTestResultsOverview: vscode.Event<TestResultsOverviewClosedPayload>;
    readonly onDidOpenTaskFeedback: vscode.Event<TaskFeedbackOpenedPayload>;
    readonly onDidCloseTaskFeedback: vscode.Event<TaskFeedbackClosedPayload>;
}
```

`ArtemisWebviewProvider` implements it. The four EventEmitters are added alongside the existing navigation/panel emitters in `artemisWebviewProvider.ts` and pushed onto `_disposables` so they are disposed together with the provider. The activation site (`extension.ts`, where `setChatWebviewProvider` is called today around line 100) also calls `setArtemisWebviewProvider`.

**New file** `extension/src/extension/controller/commands/testResultsTrackingCommands.ts` — four handlers, each a thin pass-through:

```ts
private handleTaskFeedbackOpened = async (message: WebviewToExtensionMessage): Promise<void> => {
    try {
        const payload = getPayload<WebCmd<'taskFeedbackOpened'>>(message);
        const provider = this.context.providerRegistry.getArtemisWebviewProvider();
        provider?.fireTaskFeedbackOpened(payload);
    } catch (error: unknown) {
        logger.warn('Failed to handle taskFeedbackOpened command', LogCategory.VIEW, error);
    }
};
```

If the provider is not registered (theoretical race during shutdown), the event is silently dropped. No exception leaks.

**`CommandContext` is NOT modified.** All access goes through the existing `providerRegistry` field.

**`sessionRecorderWiring.ts`** — extend the existing `wireSessionRecorder` function to subscribe to the four new events:

```ts
disposables.push(artemisWebviewProvider.onDidOpenTestResultsOverview(payload => {
    sessionRecorder.recordTestResultsOverviewOpened(payload);
}));
disposables.push(artemisWebviewProvider.onDidCloseTestResultsOverview(payload => {
    sessionRecorder.recordTestResultsOverviewClosed(payload);
}));
disposables.push(artemisWebviewProvider.onDidOpenTaskFeedback(payload => {
    sessionRecorder.recordTaskFeedbackOpened(payload);
}));
disposables.push(artemisWebviewProvider.onDidCloseTaskFeedback(payload => {
    sessionRecorder.recordTaskFeedbackClosed(payload);
}));
```

This way the phase-guard inside the recorder remains the single gate. The provider events fire unconditionally; the wiring forwards; the recorder decides whether to actually write.

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

`extension/test/unit/controller/testResultsTrackingCommands.test.ts` — new file:

- Each of the four command handlers reads `getPayload` and fires the matching provider EventEmitter.
- Handlers do NOT call the recorder directly (the wiring layer does).
- A missing payload (the `getPayload` failure case) is logged but does not throw uncaught. Note: `getPayload` only catches the missing-payload case — it does NOT runtime-validate field shapes, so this test does not assert anything about a malformed-but-present payload (TypeScript types guard that path).

`extension/test/unit/activation/sessionRecorderWiring.test.ts` — extend:

- `wireSessionRecorder` subscribes to the four new provider events.
- Firing each event invokes the corresponding recorder method exactly once with the payload as-is.
- Disposing the wiring removes the subscriptions (no leak).

Contract layer (TypeScript compile-time):

- The four new `WebCmd` payload types exist and shape-match what the recorder method accepts (this is checked by the type system via shared payload types between `webviewCommands.ts` and the provider event emitters).
- All four command names appear in `COMMANDS_REQUIRING_PAYLOAD`. (Asserted by a small unit test that imports the constant and the `WebviewCmd` keys.)

### React tests (Vitest, webview-side)

`extension/test/react/components/exercise/TestResultsOverlay.test.tsx` — extend:

- `taskName` prop renders `"Feedback for task: …"` header; absent renders `"Test Results"`.
- Empty-state message switches based on `taskName`.
- `onClose('button')` fires on X-button click.
- `onClose('escape')` fires on Escape keydown.

`extension/test/react/views/ExerciseDetail/ProblemStatement.test.tsx` — extend:

- Click on a `.artemis-task[data-test-ids]` span calls `onTaskClick` with the parsed `taskName` and `testIds`.
- Click on a `.artemis-task` without `data-test-ids` does NOT fire.
- Click on a non-task element does NOT fire.
- Multiple `data-test-ids` with whitespace and trailing commas parse correctly.

`extension/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx` — extend:

- Clicking "See test results" posts `testResultsOverviewOpened` with computed counts.
- Closing the overlay posts `testResultsOverviewClosed` with a positive `durationMs` and the same `viewId`.
- Clicking a task in the problem statement posts `taskFeedbackOpened` with filtered `testIds` and counts.
- Opening overview while task modal is open posts `taskFeedbackClosed` (with `closeReason: 'replaced'`) first, then `testResultsOverviewOpened`.
- The close event uses the `viewId` from the open event (snapshot pattern).

### Manual test plan

- Open an exercise with a known multi-task problem statement. Verify task spans have visible affordance (underline + pointer cursor).
- Click a task → modal opens with only that task's tests.
- Close via each of: X-button, Escape. Inspect the recording JSONL to confirm `closeReason` is set correctly.
- Reproduce the SSR re-render case: change theme while modal is open. Verify the modal stays open and the close event references the original snapshot.
- Open task modal, then click "See test results" (single-modal invariant). Verify exactly two events fire: `taskFeedbackClosed` then `testResultsOverviewOpened`.
- Open modal, close VS Code window. Verify the recording shows an unmatched `opened` and no close event of any kind.

## Files Touched

```
Modified:
  extension/src/extension/services/telemetry/recording/types.ts
  extension/src/extension/services/telemetry/recording/sessionRecorder.ts
  extension/src/extension/provider/artemisWebviewProvider.ts                (4 new EventEmitters + fireXxx methods, implements IArtemisWebviewProvider)
  extension/src/extension/controller/webViewMessageHandler.ts               (register the 4 new commands)
  extension/src/extension/activation/sessionRecorderWiring.ts               (subscribe to the 4 new provider events)
  extension/src/extension/services/ui/providerRegistry.ts                   (add getArtemisWebviewProvider/setArtemisWebviewProvider)
  extension/src/extension.ts (around line 100, where setChatWebviewProvider is wired today; call setArtemisWebviewProvider on startup)
  extension/src/shared/messageContracts/webviewCommands.ts                  (4 new WebCmd + COMMANDS_REQUIRING_PAYLOAD entries; export payload types)
  extension/src/webview/components/exercise/TestResultsOverlay.tsx          (taskName prop, onClose(reason))
  extension/src/webview/components/exercise/SubmissionStatus.tsx            (remove overlay mount + showTestResults prop; replace onToggleTestResults with onOpenTestResults callback)
  extension/src/webview/views/ExerciseDetail/types.ts                       (ProblemStatementProps gets onTaskClick)
  extension/src/webview/views/ExerciseDetail/components/ProblemStatement.tsx (click handler via event delegation)
  extension/src/webview/views/ExerciseDetail/components/ProblemStatement.module.css (cursor + underline on .artemis-task)
  extension/src/webview/views/ExerciseDetail/ExerciseDetailView.tsx         (own both overlay instances + viewId lifecycle + tracking)
  extension/src/webview/views/ExamExerciseDetail/ExamExerciseDetailView.tsx (mount own untracked overlay after the prop rename on SubmissionStatus)
  extension/src/webview/utils/exerciseStatus.ts                             (populate TestCase.id, add filterTestCasesByIds helper)

Created:
  extension/src/extension/types/IArtemisWebviewProvider.ts
  extension/src/extension/controller/commands/testResultsTrackingCommands.ts
  extension/src/webview/utils/viewId.ts
  extension/test/unit/services/telemetry/recording/sessionRecorderViewEvents.test.ts
  extension/test/unit/controller/testResultsTrackingCommands.test.ts
```

## Out of Scope / Future Work

- Per-test scroll/viewport tracking inside the modal (intersection observer). Postpone until base events are validated.
- Synthetic close-on-deactivate events. Requires central tracking of open views and reliable extension-side teardown hook.
- Server-side `interactive.js` integration. Currently the SSR HTML's `data-feedback` attribute and the bundled `interactive.js` are unused by design.
- Per-task feedback view in exam mode. Exam currently shows a plaintext fallback rather than the SSR HTML; integrating SSR into exam mode is out of scope for this branch.
- Pedagogical enhancements (e.g., "Ask Iris about this test" button inside the modal). Tracked as a separate feature.
