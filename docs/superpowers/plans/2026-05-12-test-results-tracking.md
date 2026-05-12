# Test-Results View Tracking & Per-Task Feedback Modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recorder-tracked view events when a user opens the all-tests overlay or clicks a `[task]` entry in the server-rendered problem statement, plus a new per-task feedback modal reusing the existing `TestResultsOverlay` component.

**Architecture:** Webview owns view state (viewId, openedAt, captured close-identity snapshot). Provider events bridge command-handler layer to `sessionRecorderWiring.ts`, which calls the four new recorder methods (matches the existing IrisChat / intervention pattern). No changes to the SSR backend, no `includeJs:true`.

**Tech Stack:** TypeScript, React (webview), Mocha + sinon (extension unit tests), Vitest (webview tests), VS Code extension API.

**Spec:** `docs/superpowers/specs/2026-05-12-test-results-tracking-design.md` (HEAD 64c5b360 on `feat/test-results-tracking`).

---

## Task 1: Add recorder event types

**Files:**
- Modify: `extension/src/extension/services/telemetry/recording/types.ts`

- [ ] **Step 1: Append the two new event types to the file, just above the `RecordedEvent` discriminated union (around line 334).**

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
        closeReason: 'button' | 'escape' | 'backdrop' | 'replaced';
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
        closeReason: 'button' | 'escape' | 'backdrop' | 'replaced';
    };
```

- [ ] **Step 2: Append both types to the `RecordedEvent` union.**

Locate the existing union (ends with `| TextDocumentCloseEvent;`). Add two more variants:

```ts
export type RecordedEvent =
    | TextChangeEvent
    // ...existing entries...
    | TextDocumentCloseEvent
    | TestResultsOverviewViewEvent
    | TaskFeedbackViewEvent;
```

- [ ] **Step 3: Run typecheck to verify nothing else needs updating yet.**

Run: `cd extension && npm run check-types`
Expected: PASS (no compile errors).

- [ ] **Step 4: Commit.**

```bash
git add extension/src/extension/services/telemetry/recording/types.ts
git commit -m "feat(recorder): add TestResultsOverviewView and TaskFeedbackView event types"
```

---

## Task 2: Add 4 new recorder public methods

**Files:**
- Modify: `extension/src/extension/services/telemetry/recording/sessionRecorder.ts`
- Create: `extension/test/unit/services/telemetry/recording/sessionRecorderViewEvents.test.ts`

- [ ] **Step 1: Write the failing test file.**

Use the same `FakeFs` + `makeRecorder` pattern already established in `extension/test/unit/services/telemetry/recording/chatRecording.test.ts`. The test reads events from the fake FS rather than stubbing private internals:

```ts
import * as assert from 'assert';
import * as vscode from 'vscode';
import { SessionRecorder } from '../../../../../src/extension/services/telemetry/recording/sessionRecorder';
import type {
    RecordedEvent,
    TestResultsOverviewViewEvent,
    TaskFeedbackViewEvent,
} from '../../../../../src/extension/services/telemetry/recording/types';
import { RecordingStorageWriter } from '../../../../../src/extension/services/telemetry/recording/storageWriter';
import type { RecordingFs } from '../../../../../src/extension/services/telemetry/recording/storageWriter';

class FakeFs implements RecordingFs {
    appendedChunks: string[] = [];
    writtenFiles: { path: string; data: string }[] = [];
    removedPaths: string[] = [];
    syncChunks: string[] = [];
    mkdir(_p: string, _opts: { recursive: boolean }) { return Promise.resolve(undefined); }
    writeFile(p: string, data: string) { this.writtenFiles.push({ path: p, data }); return Promise.resolve(); }
    appendFile(_p: string, data: string) { this.appendedChunks.push(data); return Promise.resolve(); }
    rm(p: string) { this.removedPaths.push(p); return Promise.resolve(); }
    appendFileSync(_p: string, data: string) { this.syncChunks.push(data); }
}

function collectWrittenEvents(fs: FakeFs): RecordedEvent[] {
    const events: RecordedEvent[] = [];
    for (const chunk of [...fs.appendedChunks, ...fs.syncChunks]) {
        for (const line of chunk.split('\n').filter(Boolean)) {
            try { events.push(JSON.parse(line) as RecordedEvent); } catch { /* skip */ }
        }
    }
    return events;
}

function makeRecorder(): { recorder: SessionRecorder; fs: FakeFs } {
    const fs = new FakeFs();
    const writer = new RecordingStorageWriter('/fake-base', fs, 'test-version');
    const recorder = new SessionRecorder(
        vscode.Uri.file('/fake-base'),
        { hasTerminalShellExecution: false, hasVscodeGitExtension: false },
        undefined,
        writer,
    );
    return { recorder, fs };
}

suite('SessionRecorder — view events', () => {
    let recorder: SessionRecorder;
    let fs: FakeFs;

    setup(async () => {
        const ctx = makeRecorder();
        recorder = ctx.recorder;
        fs = ctx.fs;
        recorder.enable();
        await recorder.startSession(42, 'participant-1');
    });

    teardown(async () => {
        try { await recorder.dispose(); } catch { /* ignore */ }
    });

    test('recordTestResultsOverviewOpened emits opened event with counts', async () => {
        recorder.recordTestResultsOverviewOpened({
            viewId: 'v1', exerciseId: 42,
            totalTests: 5, passedTests: 3, failedTests: 2,
        });
        await recorder.endSession();
        const overview = collectWrittenEvents(fs).filter(
            (e): e is TestResultsOverviewViewEvent => e.type === 'testResultsOverviewView',
        );
        assert.strictEqual(overview.length, 1);
        assert.strictEqual(overview[0].action, 'opened');
        assert.strictEqual(overview[0].viewId, 'v1');
        assert.strictEqual(overview[0].action === 'opened' && overview[0].totalTests, 5);
    });

    test('recordTestResultsOverviewClosed emits closed event with durationMs and closeReason', async () => {
        recorder.recordTestResultsOverviewClosed({
            viewId: 'v1', exerciseId: 42,
            durationMs: 1234, closeReason: 'button',
        });
        await recorder.endSession();
        const closed = collectWrittenEvents(fs).filter(
            (e): e is TestResultsOverviewViewEvent => e.type === 'testResultsOverviewView' && e.action === 'closed',
        );
        assert.strictEqual(closed.length, 1);
        assert.strictEqual(closed[0].action === 'closed' && closed[0].durationMs, 1234);
        assert.strictEqual(closed[0].action === 'closed' && closed[0].closeReason, 'button');
    });

    test('recordTaskFeedbackOpened emits with testIds and taskName', async () => {
        recorder.recordTaskFeedbackOpened({
            viewId: 'v2', exerciseId: 42, taskName: 'doOverlap',
            testIds: [101, 102, 103], totalTests: 3, passedTests: 0, failedTests: 3,
        });
        await recorder.endSession();
        const task = collectWrittenEvents(fs).filter(
            (e): e is TaskFeedbackViewEvent => e.type === 'taskFeedbackView',
        );
        assert.strictEqual(task.length, 1);
        assert.strictEqual(task[0].taskName, 'doOverlap');
        assert.deepStrictEqual(task[0].action === 'opened' ? task[0].testIds : undefined, [101, 102, 103]);
    });

    test('recordTaskFeedbackClosed emits with closeReason "replaced"', async () => {
        recorder.recordTaskFeedbackClosed({
            viewId: 'v2', exerciseId: 42, taskName: 'doOverlap',
            durationMs: 500, closeReason: 'replaced',
        });
        await recorder.endSession();
        const closed = collectWrittenEvents(fs).filter(
            (e): e is TaskFeedbackViewEvent => e.type === 'taskFeedbackView' && e.action === 'closed',
        );
        assert.strictEqual(closed.length, 1);
        assert.strictEqual(closed[0].action === 'closed' && closed[0].closeReason, 'replaced');
    });

    test('all four methods are no-ops outside recording phase', async () => {
        const { recorder: idleRecorder, fs: idleFs } = makeRecorder();
        // No enable() / startSession() — phase stays 'idle'
        idleRecorder.recordTestResultsOverviewOpened({ viewId: 'x', exerciseId: 1, totalTests: 0, passedTests: 0, failedTests: 0 });
        idleRecorder.recordTestResultsOverviewClosed({ viewId: 'x', exerciseId: 1, durationMs: 0, closeReason: 'button' });
        idleRecorder.recordTaskFeedbackOpened({ viewId: 'y', exerciseId: 1, taskName: 't', testIds: [], totalTests: 0, passedTests: 0, failedTests: 0 });
        idleRecorder.recordTaskFeedbackClosed({ viewId: 'y', exerciseId: 1, taskName: 't', durationMs: 0, closeReason: 'button' });
        const events = collectWrittenEvents(idleFs).filter(
            e => e.type === 'testResultsOverviewView' || e.type === 'taskFeedbackView',
        );
        assert.strictEqual(events.length, 0);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

```bash
cd extension && npm run compile-tests && npm run test:unit 2>&1 | tee /tmp/sessionRecorder-view-events-test.txt | grep -E "ProblemStatement|view events|RecorderViewEvents|fail|pass" | head -20
```
Expected: FAIL with "recordTestResultsOverviewOpened is not a function" or similar.

- [ ] **Step 3: Add the four methods to `sessionRecorder.ts`.**

Add immediately after `recordIrisChatFeedback(...)`:

```ts
recordTestResultsOverviewOpened(payload: {
    viewId: string;
    exerciseId: number;
    participationId?: number;
    resultId?: number;
    totalTests: number;
    passedTests: number;
    failedTests: number;
}): void {
    if (this._phase !== 'recording') { return; }
    this._lifecycle.recordInternal({
        type: 'testResultsOverviewView',
        action: 'opened',
        timestamp: Date.now(),
        ...payload,
    }, {}, this._currentGeneration);
}

recordTestResultsOverviewClosed(payload: {
    viewId: string;
    exerciseId: number;
    participationId?: number;
    resultId?: number;
    durationMs: number;
    closeReason: 'button' | 'escape' | 'backdrop' | 'replaced';
}): void {
    if (this._phase !== 'recording') { return; }
    this._lifecycle.recordInternal({
        type: 'testResultsOverviewView',
        action: 'closed',
        timestamp: Date.now(),
        ...payload,
    }, {}, this._currentGeneration);
}

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
}): void {
    if (this._phase !== 'recording') { return; }
    this._lifecycle.recordInternal({
        type: 'taskFeedbackView',
        action: 'opened',
        timestamp: Date.now(),
        ...payload,
    }, {}, this._currentGeneration);
}

recordTaskFeedbackClosed(payload: {
    viewId: string;
    exerciseId: number;
    participationId?: number;
    resultId?: number;
    taskName: string;
    durationMs: number;
    closeReason: 'button' | 'escape' | 'backdrop' | 'replaced';
}): void {
    if (this._phase !== 'recording') { return; }
    this._lifecycle.recordInternal({
        type: 'taskFeedbackView',
        action: 'closed',
        timestamp: Date.now(),
        ...payload,
    }, {}, this._currentGeneration);
}
```

- [ ] **Step 4: Run tests to verify they pass.**

```bash
cd extension && npm run compile-tests && npm run test:unit 2>&1 | tail -5; grep -E "tests=|failures=" extension/reports/mocha-results.xml | head -1
```
Expected: 5 new tests pass, total `failures="0"`.

- [ ] **Step 5: Commit.**

```bash
git add extension/src/extension/services/telemetry/recording/sessionRecorder.ts extension/test/unit/services/telemetry/recording/sessionRecorderViewEvents.test.ts
git commit -m "feat(recorder): add public API for test-results and task-feedback view events"
```

---

## Task 3: Add webview command payload types

**Files:**
- Modify: `extension/src/shared/messageContracts/webviewCommands.ts`

- [ ] **Step 1: Add four `WebviewCmd` constants.**

Locate the `WebviewCmd` const object. Add (near the end, before the closing `}`):

```ts
    // Test-results tracking
    TestResultsOverviewOpened: 'testResultsOverviewOpened',
    TestResultsOverviewClosed: 'testResultsOverviewClosed',
    TaskFeedbackOpened: 'taskFeedbackOpened',
    TaskFeedbackClosed: 'taskFeedbackClosed',
```

- [ ] **Step 2: Add their payload definitions to `WebviewCmdPayloads`.**

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
    closeReason: 'button' | 'escape' | 'backdrop' | 'replaced';
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
    closeReason: 'button' | 'escape' | 'backdrop' | 'replaced';
};
```

- [ ] **Step 3: Add all four to `COMMANDS_REQUIRING_PAYLOAD`.**

Append to the `Set`:

```ts
    WebviewCmd.TestResultsOverviewOpened,
    WebviewCmd.TestResultsOverviewClosed,
    WebviewCmd.TaskFeedbackOpened,
    WebviewCmd.TaskFeedbackClosed,
```

- [ ] **Step 4: Export named payload type aliases at the bottom of the file (after `WebviewCmdPayloads`).**

```ts
export type TestResultsOverviewOpenedPayload = WebviewCmdPayloads['testResultsOverviewOpened'];
export type TestResultsOverviewClosedPayload = WebviewCmdPayloads['testResultsOverviewClosed'];
export type TaskFeedbackOpenedPayload = WebviewCmdPayloads['taskFeedbackOpened'];
export type TaskFeedbackClosedPayload = WebviewCmdPayloads['taskFeedbackClosed'];
```

- [ ] **Step 5: Run typecheck.**

```bash
cd extension && npm run check-types
```
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add extension/src/shared/messageContracts/webviewCommands.ts
git commit -m "feat(messages): add webview commands for test-results view tracking"
```

---

## Task 4: Create IArtemisWebviewProvider interface

**Files:**
- Create: `extension/src/extension/types/IArtemisWebviewProvider.ts`

- [ ] **Step 1: Create the file.**

```ts
import type * as vscode from 'vscode';
import type {
    TestResultsOverviewOpenedPayload,
    TestResultsOverviewClosedPayload,
    TaskFeedbackOpenedPayload,
    TaskFeedbackClosedPayload,
} from '../../shared/messageContracts/webviewCommands';

/**
 * Minimal contract for the Artemis webview provider, exposing only what the
 * command-handler layer and sessionRecorderWiring need. Keeps the provider
 * decoupled from the heavyweight `ArtemisWebviewProvider` class type.
 */
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

- [ ] **Step 2: Run typecheck.**

```bash
cd extension && npm run check-types
```
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add extension/src/extension/types/IArtemisWebviewProvider.ts
git commit -m "feat(provider): add IArtemisWebviewProvider interface for view-tracking events"
```

---

## Task 5: Extend IProviderRegistry

**Files:**
- Modify: `extension/src/extension/services/ui/providerRegistry.ts`

- [ ] **Step 1: Add the new accessor/setter to the interface and factory.**

Full file content after change:

```ts
import type { IChatWebviewProvider } from '../../types/IChatWebviewProvider';
import type { IArtemisWebviewProvider } from '../../types/IArtemisWebviewProvider';

export interface IProviderRegistry {
    getChatWebviewProvider(): IChatWebviewProvider | undefined;
    setChatWebviewProvider(provider: IChatWebviewProvider): void;
    getArtemisWebviewProvider(): IArtemisWebviewProvider | undefined;
    setArtemisWebviewProvider(provider: IArtemisWebviewProvider): void;
}

export function createProviderRegistry(): IProviderRegistry {
    let chatProvider: IChatWebviewProvider | undefined;
    let artemisProvider: IArtemisWebviewProvider | undefined;
    return {
        getChatWebviewProvider: () => chatProvider,
        setChatWebviewProvider: (provider) => { chatProvider = provider; },
        getArtemisWebviewProvider: () => artemisProvider,
        setArtemisWebviewProvider: (provider) => { artemisProvider = provider; },
    };
}
```

- [ ] **Step 2: Run typecheck.**

```bash
cd extension && npm run check-types
```
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add extension/src/extension/services/ui/providerRegistry.ts
git commit -m "feat(provider-registry): expose ArtemisWebviewProvider via registry"
```

---

## Task 6: Add EventEmitters + fireXxx methods to ArtemisWebviewProvider

**Files:**
- Modify: `extension/src/extension/provider/artemisWebviewProvider.ts`

- [ ] **Step 1: Add imports.**

Near the top, alongside existing imports:

```ts
import type {
    TestResultsOverviewOpenedPayload,
    TestResultsOverviewClosedPayload,
    TaskFeedbackOpenedPayload,
    TaskFeedbackClosedPayload,
} from '../../shared/messageContracts/webviewCommands';
import type { IArtemisWebviewProvider } from '../types/IArtemisWebviewProvider';
```

- [ ] **Step 2: Declare the class as implementing the interface.**

Change the class declaration:

```ts
export class ArtemisWebviewProvider implements IArtemisWebviewProvider {
```

If the class already implements something, append: `... implements vscode.WebviewViewProvider, IArtemisWebviewProvider`.

- [ ] **Step 3: Add four private EventEmitters as class fields.**

In the field declarations area (near other private emitters or near the top of class body):

```ts
private readonly _onDidOpenTestResultsOverview = new vscode.EventEmitter<TestResultsOverviewOpenedPayload>();
private readonly _onDidCloseTestResultsOverview = new vscode.EventEmitter<TestResultsOverviewClosedPayload>();
private readonly _onDidOpenTaskFeedback = new vscode.EventEmitter<TaskFeedbackOpenedPayload>();
private readonly _onDidCloseTaskFeedback = new vscode.EventEmitter<TaskFeedbackClosedPayload>();

public readonly onDidOpenTestResultsOverview = this._onDidOpenTestResultsOverview.event;
public readonly onDidCloseTestResultsOverview = this._onDidCloseTestResultsOverview.event;
public readonly onDidOpenTaskFeedback = this._onDidOpenTaskFeedback.event;
public readonly onDidCloseTaskFeedback = this._onDidCloseTaskFeedback.event;
```

- [ ] **Step 4: Push them into `_disposables` so they are disposed with the provider.**

Find the constructor (or the place where other `EventEmitter`s are pushed onto `_disposables`). Add:

```ts
this._disposables.push(
    this._onDidOpenTestResultsOverview,
    this._onDidCloseTestResultsOverview,
    this._onDidOpenTaskFeedback,
    this._onDidCloseTaskFeedback,
);
```

- [ ] **Step 5: Add four public `fireXxx` methods, anywhere logical in the class body (e.g., near other event-firing methods).**

```ts
public fireTestResultsOverviewOpened(payload: TestResultsOverviewOpenedPayload): void {
    this._onDidOpenTestResultsOverview.fire(payload);
}
public fireTestResultsOverviewClosed(payload: TestResultsOverviewClosedPayload): void {
    this._onDidCloseTestResultsOverview.fire(payload);
}
public fireTaskFeedbackOpened(payload: TaskFeedbackOpenedPayload): void {
    this._onDidOpenTaskFeedback.fire(payload);
}
public fireTaskFeedbackClosed(payload: TaskFeedbackClosedPayload): void {
    this._onDidCloseTaskFeedback.fire(payload);
}
```

- [ ] **Step 6: Run typecheck.**

```bash
cd extension && npm run check-types
```
Expected: PASS. If errors point to `IArtemisWebviewProvider`, check that all 8 fields (4 fire, 4 event) are present and types match.

- [ ] **Step 7: Commit.**

```bash
git add extension/src/extension/provider/artemisWebviewProvider.ts
git commit -m "feat(provider): emit view-tracking events from ArtemisWebviewProvider"
```

---

## Task 7: Wire setArtemisWebviewProvider in extension.ts

**Files:**
- Modify: `extension/src/extension.ts`

- [ ] **Step 1: Locate line 138 where `providerRegistry.setChatWebviewProvider(chatWebviewProvider)` is called.**

Confirm with: `grep -n "setChatWebviewProvider" extension/src/extension.ts`.

- [ ] **Step 2: Add the symmetric call for the Artemis provider, immediately after.**

The `artemisWebviewProvider` variable is created earlier in the same file. Search for it and add right after the chat-provider registration:

```ts
providerRegistry.setChatWebviewProvider(chatWebviewProvider);
providerRegistry.setArtemisWebviewProvider(artemisWebviewProvider);  // NEW
```

- [ ] **Step 3: Run typecheck.**

```bash
cd extension && npm run check-types
```
Expected: PASS. If error says `artemisWebviewProvider` is not assignable to `IArtemisWebviewProvider`, recheck Task 6 — the class must implement the interface.

- [ ] **Step 4: Commit.**

```bash
git add extension/src/extension.ts
git commit -m "feat(activation): register ArtemisWebviewProvider in provider registry"
```

---

## Task 8: Extend sessionRecorderWiring with the 4 new subscriptions

**Files:**
- Modify: `extension/src/extension/activation/sessionRecorderWiring.ts`

- [ ] **Step 1: Locate `wireSessionRecorder` and find a sensible insertion point.**

Right after the existing Iris/intervention subscriptions, add:

```ts
// Test-results view tracking — only wires up if the Artemis provider was
// registered in the registry. Webview commands flow into provider events;
// here we subscribe and forward to the recorder. Phase guard inside the
// recorder methods drops events when recording is inactive.
const artemisProvider = providerRegistry.getArtemisWebviewProvider();
if (artemisProvider) {
    disposables.push(artemisProvider.onDidOpenTestResultsOverview(payload => {
        sessionRecorder.recordTestResultsOverviewOpened(payload);
    }));
    disposables.push(artemisProvider.onDidCloseTestResultsOverview(payload => {
        sessionRecorder.recordTestResultsOverviewClosed(payload);
    }));
    disposables.push(artemisProvider.onDidOpenTaskFeedback(payload => {
        sessionRecorder.recordTaskFeedbackOpened(payload);
    }));
    disposables.push(artemisProvider.onDidCloseTaskFeedback(payload => {
        sessionRecorder.recordTaskFeedbackClosed(payload);
    }));
}
```

Note: the function already takes a `providerRegistry: IProviderRegistry` (or accesses one). If not, you need to pass it in via the `RecorderWiringDeps` object — search for that interface in the same file. If missing, add `providerRegistry: IProviderRegistry` to `RecorderWiringDeps` and update the call site in `extension.ts` to pass it.

- [ ] **Step 2: Run typecheck.**

```bash
cd extension && npm run check-types
```
Expected: PASS.

- [ ] **Step 3: Run existing wiring tests.**

```bash
cd extension && npm run compile-tests && npm run test:unit 2>&1 | tail -3 && grep -E "tests=|failures=" extension/reports/mocha-results.xml | head -1
```
Expected: `failures="0"` — no regression in the existing `sessionRecorderWiring.test.ts`.

- [ ] **Step 4: Commit.**

```bash
git add extension/src/extension/activation/sessionRecorderWiring.ts
git commit -m "feat(wiring): subscribe to view-tracking events and forward to recorder"
```

---

## Task 9: Create testResultsTrackingCommands module

**Files:**
- Create: `extension/src/extension/controller/commands/testResultsTrackingCommands.ts`
- Create: `extension/test/unit/controller/testResultsTrackingCommands.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import * as assert from 'assert';
import * as sinon from 'sinon';
import { TestResultsTrackingCommandModule } from '../../../src/extension/controller/commands/testResultsTrackingCommands';
import type { CommandContext } from '../../../src/extension/controller/commands/types';
import { WebviewCmd } from '../../../src/shared/messageContracts/webviewCommands';

suite('TestResultsTrackingCommandModule', () => {
    let fireOverviewOpenedStub: sinon.SinonStub;
    let fireOverviewClosedStub: sinon.SinonStub;
    let fireTaskOpenedStub: sinon.SinonStub;
    let fireTaskClosedStub: sinon.SinonStub;
    let module: TestResultsTrackingCommandModule;

    setup(() => {
        fireOverviewOpenedStub = sinon.stub();
        fireOverviewClosedStub = sinon.stub();
        fireTaskOpenedStub = sinon.stub();
        fireTaskClosedStub = sinon.stub();
        const provider = {
            fireTestResultsOverviewOpened: fireOverviewOpenedStub,
            fireTestResultsOverviewClosed: fireOverviewClosedStub,
            fireTaskFeedbackOpened: fireTaskOpenedStub,
            fireTaskFeedbackClosed: fireTaskClosedStub,
            // unused readonly events satisfied by sinon-fakeable getters
            onDidOpenTestResultsOverview: sinon.stub(),
            onDidCloseTestResultsOverview: sinon.stub(),
            onDidOpenTaskFeedback: sinon.stub(),
            onDidCloseTaskFeedback: sinon.stub(),
        };
        const context = {
            providerRegistry: { getArtemisWebviewProvider: () => provider },
        } as unknown as CommandContext;
        module = new TestResultsTrackingCommandModule(context);
    });

    test('handles testResultsOverviewOpened by firing provider event', async () => {
        const payload = { viewId: 'v', exerciseId: 1, totalTests: 3, passedTests: 1, failedTests: 2 };
        const handlers = module.getHandlers();
        await handlers[WebviewCmd.TestResultsOverviewOpened]({
            type: 'command', command: WebviewCmd.TestResultsOverviewOpened, payload,
        } as never);
        sinon.assert.calledOnceWithExactly(fireOverviewOpenedStub, payload);
    });

    test('handles taskFeedbackClosed with replaced reason', async () => {
        const payload = { viewId: 'v', exerciseId: 1, taskName: 't', durationMs: 50, closeReason: 'replaced' as const };
        await module.getHandlers()[WebviewCmd.TaskFeedbackClosed]({
            type: 'command', command: WebviewCmd.TaskFeedbackClosed, payload,
        } as never);
        sinon.assert.calledOnceWithExactly(fireTaskClosedStub, payload);
    });

    test('drops events silently when provider is not registered', async () => {
        const ctxNoProvider = { providerRegistry: { getArtemisWebviewProvider: () => undefined } } as unknown as CommandContext;
        const mod = new TestResultsTrackingCommandModule(ctxNoProvider);
        const payload = { viewId: 'v', exerciseId: 1, totalTests: 0, passedTests: 0, failedTests: 0 };
        await assert.doesNotReject(
            mod.getHandlers()[WebviewCmd.TestResultsOverviewOpened]({
                type: 'command', command: WebviewCmd.TestResultsOverviewOpened, payload,
            } as never),
        );
    });

    test('logs and does not throw on missing payload (getPayload failure)', async () => {
        await assert.doesNotReject(
            module.getHandlers()[WebviewCmd.TaskFeedbackOpened]({
                type: 'command', command: WebviewCmd.TaskFeedbackOpened,
                // no payload
            } as never),
        );
        sinon.assert.notCalled(fireTaskOpenedStub);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

```bash
cd extension && npm run compile-tests 2>&1 | tail -3
```
Expected: TypeScript error "Cannot find module testResultsTrackingCommands".

- [ ] **Step 3: Create the implementation file.**

```ts
import type { CommandContext, CommandMap } from './types';
import { getPayload, WebviewCmd } from '../../../shared/messageContracts';
import type { WebviewToExtensionMessage, WebCmd } from '../../../shared/messageContracts';
import { logger, LogCategory } from '../../services/loggingService';

export class TestResultsTrackingCommandModule {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.TestResultsOverviewOpened]: this.handleTestResultsOverviewOpened,
            [WebviewCmd.TestResultsOverviewClosed]: this.handleTestResultsOverviewClosed,
            [WebviewCmd.TaskFeedbackOpened]: this.handleTaskFeedbackOpened,
            [WebviewCmd.TaskFeedbackClosed]: this.handleTaskFeedbackClosed,
        };
    }

    private handleTestResultsOverviewOpened = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'testResultsOverviewOpened'>>(message);
            this.context.providerRegistry.getArtemisWebviewProvider()?.fireTestResultsOverviewOpened(payload);
        } catch (error: unknown) {
            logger.warn('Failed to handle testResultsOverviewOpened command', LogCategory.VIEW, error);
        }
    };

    private handleTestResultsOverviewClosed = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'testResultsOverviewClosed'>>(message);
            this.context.providerRegistry.getArtemisWebviewProvider()?.fireTestResultsOverviewClosed(payload);
        } catch (error: unknown) {
            logger.warn('Failed to handle testResultsOverviewClosed command', LogCategory.VIEW, error);
        }
    };

    private handleTaskFeedbackOpened = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'taskFeedbackOpened'>>(message);
            this.context.providerRegistry.getArtemisWebviewProvider()?.fireTaskFeedbackOpened(payload);
        } catch (error: unknown) {
            logger.warn('Failed to handle taskFeedbackOpened command', LogCategory.VIEW, error);
        }
    };

    private handleTaskFeedbackClosed = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'taskFeedbackClosed'>>(message);
            this.context.providerRegistry.getArtemisWebviewProvider()?.fireTaskFeedbackClosed(payload);
        } catch (error: unknown) {
            logger.warn('Failed to handle taskFeedbackClosed command', LogCategory.VIEW, error);
        }
    };
}
```

- [ ] **Step 4: Run tests to verify they pass.**

```bash
cd extension && npm run compile-tests && npm run test:unit 2>&1 | tail -3 && grep -E "tests=|failures=" extension/reports/mocha-results.xml | head -1
```
Expected: 4 new tests pass, `failures="0"`.

- [ ] **Step 5: Commit.**

```bash
git add extension/src/extension/controller/commands/testResultsTrackingCommands.ts extension/test/unit/controller/testResultsTrackingCommands.test.ts
git commit -m "feat(commands): add TestResultsTrackingCommandModule"
```

---

## Task 10: Register TestResultsTrackingCommandModule

**Files:**
- Modify: `extension/src/extension/controller/webViewMessageHandler.ts`

- [ ] **Step 1: Import the new module class.**

Add to the existing imports:

```ts
import { TestResultsTrackingCommandModule } from './commands/testResultsTrackingCommands';
```

- [ ] **Step 2: Register the module in the `modules` array.**

Find the array (around line 65) and append the new module:

```ts
const modules = [
    new AuthCommandModule(context),
    new NavigationCommandModule(context),
    (this.repositoryModule = new RepositoryCommandModule(context)),
    new IrisCommandModule(context),
    new HealthCommandModule(context),
    new UtilityCommandModule(context),
    new TestResultsTrackingCommandModule(context),  // NEW
];
```

- [ ] **Step 3: Run typecheck + unit tests.**

```bash
cd extension && npm run check-types && npm run compile-tests && npm run test:unit 2>&1 | tail -3 && grep -E "tests=|failures=" extension/reports/mocha-results.xml | head -1
```
Expected: PASS, `failures="0"`.

- [ ] **Step 4: Commit.**

```bash
git add extension/src/extension/controller/webViewMessageHandler.ts
git commit -m "feat(commands): register TestResultsTrackingCommandModule"
```

---

## Task 11: Add viewId helper

**Files:**
- Create: `extension/src/webview/utils/viewId.ts`

- [ ] **Step 1: Create the file.**

```ts
/**
 * Generate a short opaque identifier used to pair `*Opened` and `*Closed`
 * recorder events. Prefers `crypto.randomUUID()` (available in modern
 * Electron/VS Code webview runtimes); falls back to a timestamp+random
 * string when unavailable. Not for cryptographic use.
 */
export function makeViewId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
```

- [ ] **Step 2: Run typecheck.**

```bash
cd extension && npm run check-types
```
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add extension/src/webview/utils/viewId.ts
git commit -m "feat(webview): add makeViewId helper for view-event pairing"
```

---

## Task 12: Extend TestCase shape and transformer

**Files:**
- Modify: `extension/src/webview/components/exercise/SubmissionStatus.tsx`
- Modify: `extension/src/webview/utils/exerciseStatus.ts`

- [ ] **Step 1: Add `id?: number` to `TestCase` interface in `SubmissionStatus.tsx`.**

Change from:

```ts
export interface TestCase {
    name: string;
    passed: boolean;
    message?: string;
    type?: 'structural' | 'behavioral';
}
```

to:

```ts
export interface TestCase {
    name: string;
    passed: boolean;
    message?: string;
    type?: 'structural' | 'behavioral';
    id?: number;
}
```

- [ ] **Step 2: Update `FeedbackInput` and `TestCaseResult` in `exerciseStatus.ts`.**

Change `FeedbackInput`:

```ts
interface FeedbackInput {
    type?: string;
    text?: string;
    positive?: boolean;
    detailText?: string;
    testCase?: { id?: number; testName?: string };  // id added
}
```

Change `TestCaseResult`:

```ts
interface TestCaseResult {
    name: string;
    passed: boolean;
    message?: string;
    id?: number;
}
```

Update `transformFeedbacksToTestCases` to populate `id`:

```ts
export function transformFeedbacksToTestCases(feedbacks: FeedbackInput[]): TestCaseResult[] {
    const testFeedbacks = feedbacks.filter(f =>
        f.testCase?.testName || ((!f.type || f.type === 'AUTOMATIC') && f.text && !f.text.startsWith('SCAFeedbackIdentifier:'))
    );
    return testFeedbacks.map(f => ({
        name: f.testCase?.testName ?? f.text ?? 'Test',
        passed: f.positive ?? false,
        message: f.detailText,
        id: f.testCase?.id,
    }));
}
```

- [ ] **Step 3: Run typecheck.**

```bash
cd extension && npm run check-types
```
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add extension/src/webview/components/exercise/SubmissionStatus.tsx extension/src/webview/utils/exerciseStatus.ts
git commit -m "feat(testcase): carry testCase.id through to UI test cases for per-task filtering"
```

---

## Task 13: Add filterTestCasesByIds helper

**Files:**
- Modify: `extension/src/webview/utils/exerciseStatus.ts`

- [ ] **Step 1: Add the helper function to the bottom of the file.**

```ts
import type { TestCase } from '../components/exercise/SubmissionStatus';

/**
 * Filter a TestCase array to only the entries whose id is in the given set.
 * Used by the per-task feedback modal to show only the tests linked to the
 * clicked [task] entry in the SSR'd problem statement.
 *
 * Tests without an id are excluded (cannot be matched). Returns a new array
 * preserving the input order.
 */
export function filterTestCasesByIds(all: TestCase[], ids: number[]): TestCase[] {
    const idSet = new Set(ids);
    return all.filter(tc => tc.id !== undefined && idSet.has(tc.id));
}
```

Note: `TestCase` import goes near the existing imports. The `TestCaseResult` local interface in this file is structurally compatible with `TestCase`, so existing callers of `transformFeedbacksToTestCases` are unaffected.

- [ ] **Step 2: Run typecheck.**

```bash
cd extension && npm run check-types
```
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add extension/src/webview/utils/exerciseStatus.ts
git commit -m "feat(webview): add filterTestCasesByIds helper"
```

---

## Task 14: Parameterize TestResultsOverlay

**Files:**
- Modify: `extension/src/webview/components/exercise/TestResultsOverlay.tsx`
- Modify: `extension/src/webview/components/exercise/TestResultsOverlay.module.css` (only if a `.modalContent` class needs to be added)
- Modify: `extension/test/react/components/exercise/TestResultsOverlay.test.tsx` (if exists) or create

- [ ] **Step 1: Check whether a test file exists.**

```bash
ls extension/test/react/components/exercise/TestResultsOverlay.test.tsx 2>&1
```

If missing, create with the test cases below. If existing, extend it.

- [ ] **Step 2: Write/extend test cases for taskName, onClose(reason), backdrop click.**

Add to the test file (replace `existing test` placeholder with whatever is currently in the file, if any):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestResultsOverlay } from '../../../../src/webview/components/exercise/TestResultsOverlay';
import type { TestCase } from '../../../../src/webview/components/exercise/SubmissionStatus';

describe('TestResultsOverlay', () => {
    const testCases: TestCase[] = [
        { name: 'testA', passed: true },
        { name: 'testB', passed: false, message: 'fail msg' },
    ];

    it('renders default title when taskName is absent', () => {
        render(<TestResultsOverlay open onClose={() => undefined} testCases={testCases} />);
        expect(screen.getByText('Test Results')).toBeInTheDocument();
    });

    it('renders task-mode title when taskName is provided', () => {
        render(<TestResultsOverlay open onClose={() => undefined} testCases={testCases} taskName="doOverlap" />);
        expect(screen.getByText('Feedback for task: doOverlap')).toBeInTheDocument();
    });

    it('shows task-specific empty message when taskName given and testCases empty', () => {
        render(<TestResultsOverlay open onClose={() => undefined} testCases={[]} taskName="emptyTask" />);
        expect(screen.getByText('No tests in this task.')).toBeInTheDocument();
    });

    it('shows default empty message when taskName not given and testCases empty', () => {
        render(<TestResultsOverlay open onClose={() => undefined} testCases={[]} />);
        expect(screen.getByText('No test results available.')).toBeInTheDocument();
    });

    it('calls onClose with "button" when X is clicked', async () => {
        const onClose = vi.fn();
        render(<TestResultsOverlay open onClose={onClose} testCases={testCases} />);
        const closeBtn = screen.getByRole('button', { name: /close/i });
        await userEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalledWith('button');
    });

    it('calls onClose with "escape" when Escape is pressed', () => {
        const onClose = vi.fn();
        render(<TestResultsOverlay open onClose={onClose} testCases={testCases} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledWith('escape');
    });

    it('calls onClose with "backdrop" when the backdrop is clicked', async () => {
        const onClose = vi.fn();
        const { container } = render(<TestResultsOverlay open onClose={onClose} testCases={testCases} />);
        // backdrop is the outermost div with class .backdrop (in CSS module)
        const backdrop = container.ownerDocument.body.querySelector('[data-testid="overlay-backdrop"]');
        expect(backdrop).not.toBeNull();
        await userEvent.click(backdrop!);
        expect(onClose).toHaveBeenCalledWith('backdrop');
    });

    it('does not fire onClose when clicking inside the modal content', async () => {
        const onClose = vi.fn();
        render(<TestResultsOverlay open onClose={onClose} testCases={testCases} />);
        await userEvent.click(screen.getByText('testA'));
        expect(onClose).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 3: Run tests to verify they fail.**

```bash
cd extension && npm run test:react -- TestResultsOverlay 2>&1 | tail -20
```
Expected: multiple failures (title text, onClose signature, missing data-testid backdrop).

- [ ] **Step 4: Update `TestResultsOverlay.tsx`.**

Full new file content:

```tsx
import { createPortal } from 'react-dom';
import { useEffect, MouseEvent } from 'react';
import clsx from 'clsx';
import CircleCheck from 'lucide-react/dist/esm/icons/circle-check';
import CircleX from 'lucide-react/dist/esm/icons/circle-x';
import { IconButton } from '../Button';
import type { TestCase } from './SubmissionStatus';
import styles from './TestResultsOverlay.module.css';

export type TestResultsOverlayCloseReason = 'button' | 'escape' | 'backdrop';

interface TestResultsOverlayProps {
    open: boolean;
    onClose: (reason: TestResultsOverlayCloseReason) => void;
    testCases: TestCase[];
    loading?: boolean;
    taskName?: string;
}

export function TestResultsOverlay({ open, onClose, testCases, loading = false, taskName }: TestResultsOverlayProps) {
    useEffect(() => {
        if (!open) { return; }
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose('escape');
            }
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [open, onClose]);

    useEffect(() => {
        if (!open) { return; }
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [open]);

    if (!open) { return null; }

    const passed = testCases.filter((t) => t.passed);
    const failed = testCases.filter((t) => !t.passed);
    const total = testCases.length;
    const passedCount = passed.length;
    const percentage = total > 0 ? (passedCount / total) * 100 : 0;

    let summaryColorClass = styles.summaryFail;
    let progressFillClass = styles.progressFillDanger;
    if (percentage >= 80) {
        summaryColorClass = styles.summarySuccess;
        progressFillClass = styles.progressFillSuccess;
    } else if (percentage >= 40) {
        summaryColorClass = styles.summaryPartial;
        progressFillClass = styles.progressFillWarning;
    }

    const title = taskName ? `Feedback for task: ${taskName}` : 'Test Results';
    const emptyMessage = taskName ? 'No tests in this task.' : 'No test results available.';

    const handleBackdropClick = () => onClose('backdrop');
    const handleModalClick = (e: MouseEvent<HTMLDivElement>) => e.stopPropagation();

    return createPortal(
        <div
            className={styles.backdrop}
            data-testid="overlay-backdrop"
            onClick={handleBackdropClick}
        >
            <div className={styles.modal} onClick={handleModalClick}>
                <div className={styles.header}>
                    <div className={styles.title}>{title}</div>
                    <IconButton.Close onClick={() => onClose('button')} />
                </div>

                {!loading && total > 0 && (
                    <div className={styles.summary}>
                        <div className={clsx(styles.summaryText, summaryColorClass)}>
                            {passedCount} of {total} test{total !== 1 ? 's' : ''} passed ({percentage.toFixed(0)}%)
                        </div>
                        <div className={styles.progressTrack}>
                            <div
                                className={clsx(styles.progressFill, progressFillClass)}
                                style={{ width: `${percentage}%` }}
                            />
                        </div>
                    </div>
                )}

                <div className={styles.testList}>
                    {loading ? (
                        <div className={styles.loading}>Loading test results...</div>
                    ) : total === 0 ? (
                        <div className={styles.empty}>{emptyMessage}</div>
                    ) : (
                        <>
                            {failed.length > 0 && (
                                <>
                                    <div className={clsx(styles.sectionLabel, styles.sectionLabelFailed)}>
                                        Failed ({failed.length})
                                    </div>
                                    {failed.map((tc, i) => (
                                        <TestResultItem key={`fail-${i}`} testCase={tc} />
                                    ))}
                                </>
                            )}
                            {passed.length > 0 && (
                                <>
                                    <div className={clsx(styles.sectionLabel, styles.sectionLabelPassed)}>
                                        Passed ({passed.length})
                                    </div>
                                    {passed.map((tc, i) => (
                                        <TestResultItem key={`pass-${i}`} testCase={tc} />
                                    ))}
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}

function TestResultItem({ testCase }: { testCase: TestCase }) {
    return (
        <div
            className={clsx(styles.testItem, {
                [styles.testItemPassed]: testCase.passed,
                [styles.testItemFailed]: !testCase.passed,
            })}
        >
            <div
                className={clsx(styles.testIcon, {
                    [styles.testIconPassed]: testCase.passed,
                    [styles.testIconFailed]: !testCase.passed,
                })}
            >
                {testCase.passed ? <CircleCheck size={16} /> : <CircleX size={16} />}
            </div>
            <div className={styles.testContent}>
                <div className={styles.testHeader}>
                    <div className={styles.testName}>{testCase.name}</div>
                    {testCase.type && (
                        <span
                            className={clsx(
                                styles.typeBadge,
                                testCase.type === 'structural' ? styles.typeBadgeStructural : styles.typeBadgeBehavioral
                            )}
                        >
                            {testCase.type}
                        </span>
                    )}
                </div>
                {testCase.message && <div className={styles.testMessage}>{testCase.message}</div>}
            </div>
        </div>
    );
}
```

- [ ] **Step 5: Run React tests.**

```bash
cd extension && npm run test:react -- TestResultsOverlay 2>&1 | tail -10
```
Expected: all new tests pass.

- [ ] **Step 6: Commit.**

```bash
git add extension/src/webview/components/exercise/TestResultsOverlay.tsx extension/test/react/components/exercise/TestResultsOverlay.test.tsx
git commit -m "feat(overlay): add taskName, onClose(reason), and backdrop click to TestResultsOverlay"
```

---

## Task 15: Simplify SubmissionStatus

**Files:**
- Modify: `extension/src/webview/components/exercise/SubmissionStatus.tsx`

- [ ] **Step 1: Remove the `TestResultsOverlay` import.**

Delete:

```ts
import { TestResultsOverlay } from './TestResultsOverlay';
```

- [ ] **Step 2: Update `SubmissionStatusProps` — replace `onToggleTestResults` and `showTestResults` with `onOpenTestResults`. Keep `loadingTestResults` available since `testCases` props remain on the public API.**

Change from:

```ts
onToggleTestResults?: () => void;
showTestResults?: boolean;
loadingTestResults?: boolean;
```

to:

```ts
onOpenTestResults?: () => void;
```

(Delete `loadingTestResults` and `showTestResults` from the props interface; the overlay isn't mounted here anymore so neither is needed.)

- [ ] **Step 3: Update the destructure and the button.**

Remove from destructure:

```ts
onToggleTestResults,
showTestResults = false,
loadingTestResults = false,
```

Add:

```ts
onOpenTestResults,
```

Change the button:

```tsx
{hasTestInfo && (
    <Button variant="link" onClick={onOpenTestResults}>
        See test results
    </Button>
)}
```

- [ ] **Step 4: Delete the `<TestResultsOverlay>` JSX block at the bottom of the programming-exercise branch (the block starting with `{hasTestInfo && (` and containing the overlay).**

Remove the entire block:

```tsx
{hasTestInfo && (
    <TestResultsOverlay
        open={showTestResults}
        onClose={() => onToggleTestResults?.()}
        testCases={testCases}
        loading={loadingTestResults}
    />
)}
```

- [ ] **Step 5: Run typecheck.**

```bash
cd extension && npm run check-types 2>&1 | tail -10
```

Expected: errors in `ExerciseDetailView.tsx` and `ExamExerciseDetailView.tsx` complaining about removed props. Those are handled in Tasks 16 (ExerciseDetailView is later, but exam mode is breaking now). Continue to Task 16 to fix exam, then Task 20 to fix ExerciseDetailView, then come back to verify here.

- [ ] **Step 6: Commit.**

The commit is incomplete (downstream views broken) but the SubmissionStatus change is atomic. Commit it; the immediately-following tasks restore the views.

```bash
git add extension/src/webview/components/exercise/SubmissionStatus.tsx
git commit -m "refactor(submission-status): remove overlay mount, expose onOpenTestResults callback"
```

---

## Task 16: Update ExamExerciseDetailView to own its overlay

**Files:**
- Modify: `extension/src/webview/views/ExamExerciseDetail/ExamExerciseDetailView.tsx`

- [ ] **Step 1: Find the SubmissionStatus invocation (around line 224).**

Currently:

```tsx
<SubmissionStatus
    // …
    onToggleTestResults={() => setShowTestResults(prev => !prev)}
    showTestResults={showTestResults}
/>
```

- [ ] **Step 2: Replace the toggle props with `onOpenTestResults` and mount the overlay locally.**

Find the existing `showTestResults` useState declaration earlier in the file. Keep it.

Change the SubmissionStatus props to:

```tsx
<SubmissionStatus
    // …keep all other props…
    onOpenTestResults={() => setShowTestResults(true)}
/>
```

(Delete `onToggleTestResults` and `showTestResults` lines from the JSX.)

Then at the end of the JSX (e.g., before the closing `</div>` or `</>` of the component), add:

```tsx
<TestResultsOverlay
    open={showTestResults}
    onClose={() => setShowTestResults(false)}
    testCases={testCases}
/>
```

- [ ] **Step 3: Add the `TestResultsOverlay` import at the top.**

```tsx
import { TestResultsOverlay } from '../../components/exercise/TestResultsOverlay';
```

- [ ] **Step 4: Run typecheck — exam side should be clean now.**

```bash
cd extension && npm run check-types 2>&1 | tail -10
```

Expected: errors remaining only in `ExerciseDetailView.tsx`. Those are fixed in Task 20.

- [ ] **Step 5: Commit.**

```bash
git add extension/src/webview/views/ExamExerciseDetail/ExamExerciseDetailView.tsx
git commit -m "refactor(exam-view): mount own (untracked) TestResultsOverlay after SubmissionStatus split"
```

---

## Task 17: Add click handler and types to ProblemStatement

**Files:**
- Modify: `extension/src/webview/views/ExerciseDetail/types.ts`
- Modify: `extension/src/webview/views/ExerciseDetail/components/ProblemStatement.tsx`
- Modify: `extension/test/react/views/ExerciseDetail/components/ProblemStatement.test.tsx` (extend)

- [ ] **Step 1: Add the new optional prop to `types.ts`.**

In `extension/src/webview/views/ExerciseDetail/types.ts`, update `ProblemStatementProps`:

```ts
export interface ProblemStatementProps {
    serverRenderedHtml?: string;
    onTaskClick?: (task: { taskName: string; testIds: number[] }) => void;
}
```

- [ ] **Step 2: Write failing tests for the click behavior.**

Append to `extension/test/react/views/ExerciseDetail/components/ProblemStatement.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProblemStatement } from '../../../../../src/webview/views/ExerciseDetail/components/ProblemStatement';

describe('ProblemStatement — task click handler', () => {
    const sampleHtml = `<html><body>
        <span class="artemis-task" data-task-name="doOverlap" data-test-ids="101,102,103">doOverlap</span>
        <span class="artemis-task" data-task-name="noIds">noIds</span>
        <p>some prose</p>
    </body></html>`;

    it('fires onTaskClick with parsed name and ids when a .artemis-task[data-test-ids] is clicked', async () => {
        const onTaskClick = vi.fn();
        const { container } = render(
            <ProblemStatement serverRenderedHtml={sampleHtml} onTaskClick={onTaskClick} />
        );
        const target = container.querySelector<HTMLElement>('.artemis-task[data-test-ids]');
        expect(target).not.toBeNull();
        await userEvent.click(target!);
        expect(onTaskClick).toHaveBeenCalledTimes(1);
        expect(onTaskClick).toHaveBeenCalledWith({
            taskName: 'doOverlap',
            testIds: [101, 102, 103],
        });
    });

    it('does NOT fire onTaskClick when clicking a .artemis-task without data-test-ids', async () => {
        const onTaskClick = vi.fn();
        const { container } = render(
            <ProblemStatement serverRenderedHtml={sampleHtml} onTaskClick={onTaskClick} />
        );
        const targets = container.querySelectorAll<HTMLElement>('.artemis-task');
        const noIdsTarget = Array.from(targets).find(el => !el.hasAttribute('data-test-ids'));
        expect(noIdsTarget).not.toBeUndefined();
        await userEvent.click(noIdsTarget!);
        expect(onTaskClick).not.toHaveBeenCalled();
    });

    it('does NOT fire onTaskClick when clicking outside any task span', async () => {
        const onTaskClick = vi.fn();
        const { container } = render(
            <ProblemStatement serverRenderedHtml={sampleHtml} onTaskClick={onTaskClick} />
        );
        const prose = container.querySelector<HTMLElement>('p');
        await userEvent.click(prose!);
        expect(onTaskClick).not.toHaveBeenCalled();
    });

    it('parses test-id list tolerating whitespace and trailing comma', async () => {
        const html = '<html><body><span class="artemis-task" data-task-name="t" data-test-ids=" 1 , 2 , 3 , ">t</span></body></html>';
        const onTaskClick = vi.fn();
        const { container } = render(<ProblemStatement serverRenderedHtml={html} onTaskClick={onTaskClick} />);
        await userEvent.click(container.querySelector<HTMLElement>('.artemis-task[data-test-ids]')!);
        expect(onTaskClick).toHaveBeenCalledWith({ taskName: 't', testIds: [1, 2, 3] });
    });
});
```

- [ ] **Step 3: Run tests to verify they fail.**

```bash
cd extension && npm run test:react -- ProblemStatement 2>&1 | tail -15
```
Expected: 4 failures — onTaskClick is not wired.

- [ ] **Step 4: Add the click handler in `ProblemStatement.tsx`.**

Update the component signature and add the handler:

```tsx
import { useEffect, useMemo, useRef, useState, MouseEvent } from 'react';
// ...keep existing imports...

export function ProblemStatement({
    serverRenderedHtml,
    onTaskClick,
}: ProblemStatementProps) {
    // ...keep existing refs and state...

    const handleClick = (event: MouseEvent<HTMLDivElement>) => {
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

    // ...keep existing return statement, but add onClick on the rendered div...
    return (
        <Container header={<h3>Exercise Description</h3>}>
            {bodyHtml ? (
                <div
                    ref={contentRef}
                    className={styles.problemStatement}
                    onClick={handleClick}
                    dangerouslySetInnerHTML={{ __html: bodyHtml }}
                />
            ) : timedOut ? (
                /* unchanged */
            ) : (
                /* unchanged */
            )}
        </Container>
    );
}
```

(Keep the rest of the file as-is; only add the `onClick` to the dangerouslySetInnerHTML div, and the `handleClick` function.)

- [ ] **Step 5: Run tests to verify they pass.**

```bash
cd extension && npm run test:react -- ProblemStatement 2>&1 | tail -10
```
Expected: 4 new tests pass.

- [ ] **Step 6: Commit.**

```bash
git add extension/src/webview/views/ExerciseDetail/types.ts extension/src/webview/views/ExerciseDetail/components/ProblemStatement.tsx extension/test/react/views/ExerciseDetail/components/ProblemStatement.test.tsx
git commit -m "feat(problem-statement): emit onTaskClick when a [task] span is clicked"
```

---

## Task 18: Add CSS affordance to ProblemStatement

**Files:**
- Modify: `extension/src/webview/views/ExerciseDetail/components/ProblemStatement.module.css`

- [ ] **Step 1: Append the affordance rule.**

Add at the bottom of the file:

```css
.problemStatement .artemis-task[data-test-ids] {
    cursor: pointer;
    text-decoration: underline;
}
.problemStatement .artemis-task[data-test-ids]:hover {
    filter: brightness(1.2);
}
```

- [ ] **Step 2: Commit.**

```bash
git add extension/src/webview/views/ExerciseDetail/components/ProblemStatement.module.css
git commit -m "style(problem-statement): pointer cursor and underline on clickable task spans"
```

---

## Task 19: Wire ExerciseDetailView with tracking and dual overlay

**Files:**
- Modify: `extension/src/webview/views/ExerciseDetail/ExerciseDetailView.tsx`

- [ ] **Step 1: Add new imports.**

```tsx
import { TestResultsOverlay } from '../../components/exercise/TestResultsOverlay';
import { makeViewId } from '../../utils/viewId';
import { filterTestCasesByIds } from '../../utils/exerciseStatus';
import type { TestCase } from '../../components/exercise/SubmissionStatus';
import { WebviewCmd } from '../../../shared/messageContracts';
```

- [ ] **Step 2: Replace the existing `showTestResults` state with two new view states.**

Find:

```tsx
const [showTestResults, setShowTestResults] = useState(false);
```

Replace with:

```tsx
interface OpenViewState {
    viewId: string;
    openedAt: number;
    closeIdentity: {
        viewId: string;
        exerciseId: number;
        participationId?: number;
        resultId?: number;
        taskName?: string;
    };
}

const [openOverviewView, setOpenOverviewView] = useState<OpenViewState | null>(null);
const [openTaskView, setOpenTaskView] = useState<(OpenViewState & {
    taskName: string;
    filtered: TestCase[];
}) | null>(null);
```

- [ ] **Step 3: Add open/close handlers.**

Add near other handlers (e.g., near `handleBackToCourse`):

```tsx
const handleOverviewClose = (reason: 'button' | 'escape' | 'backdrop' | 'replaced') => {
    if (!openOverviewView) { return; }
    postCommand(vscodeApi, WebviewCmd.TestResultsOverviewClosed, {
        viewId: openOverviewView.closeIdentity.viewId,
        exerciseId: openOverviewView.closeIdentity.exerciseId,
        participationId: openOverviewView.closeIdentity.participationId,
        resultId: openOverviewView.closeIdentity.resultId,
        durationMs: Date.now() - openOverviewView.openedAt,
        closeReason: reason,
    });
    setOpenOverviewView(null);
};

const handleTaskClose = (reason: 'button' | 'escape' | 'backdrop' | 'replaced') => {
    if (!openTaskView) { return; }
    postCommand(vscodeApi, WebviewCmd.TaskFeedbackClosed, {
        viewId: openTaskView.closeIdentity.viewId,
        exerciseId: openTaskView.closeIdentity.exerciseId,
        participationId: openTaskView.closeIdentity.participationId,
        resultId: openTaskView.closeIdentity.resultId,
        taskName: openTaskView.taskName,
        durationMs: Date.now() - openTaskView.openedAt,
        closeReason: reason,
    });
    setOpenTaskView(null);
};

const handleOverviewOpen = () => {
    if (!exerciseData?.exercise?.id) { return; }
    if (openTaskView) { handleTaskClose('replaced'); }
    const viewId = makeViewId();
    const openedAt = Date.now();
    const exerciseId = exerciseData.exercise.id;
    const participationId = latestParticipation?.id;
    const resultId = latestResult?.id;
    const totalTests = testCases.length;
    const passedTests = testCases.filter(t => t.passed).length;
    const failedTests = totalTests - passedTests;
    postCommand(vscodeApi, WebviewCmd.TestResultsOverviewOpened, {
        viewId, exerciseId, participationId, resultId,
        totalTests, passedTests, failedTests,
    });
    setOpenOverviewView({
        viewId,
        openedAt,
        closeIdentity: { viewId, exerciseId, participationId, resultId },
    });
};

const handleTaskOpen = ({ taskName, testIds }: { taskName: string; testIds: number[] }) => {
    if (!exerciseData?.exercise?.id) { return; }
    if (openOverviewView) { handleOverviewClose('replaced'); }
    const filtered = filterTestCasesByIds(testCases, testIds);
    const viewId = makeViewId();
    const openedAt = Date.now();
    const exerciseId = exerciseData.exercise.id;
    const participationId = latestParticipation?.id;
    const resultId = latestResult?.id;
    const totalTests = filtered.length;
    const passedTests = filtered.filter(t => t.passed).length;
    const failedTests = totalTests - passedTests;
    postCommand(vscodeApi, WebviewCmd.TaskFeedbackOpened, {
        viewId, exerciseId, participationId, resultId,
        taskName, testIds, totalTests, passedTests, failedTests,
    });
    setOpenTaskView({
        viewId,
        openedAt,
        taskName,
        filtered,
        closeIdentity: { viewId, exerciseId, participationId, resultId, taskName },
    });
};
```

Note: `latestParticipation`, `latestResult`, `testCases` are existing variables in the file's render scope. Verify they're available at the point you add these handlers; if not, lift them out of conditional branches.

- [ ] **Step 4: Update the `<SubmissionStatus>` invocation.**

Replace the existing `onToggleTestResults`/`showTestResults` props with:

```tsx
onOpenTestResults={handleOverviewOpen}
```

(Delete both old lines.)

- [ ] **Step 5: Pass `onTaskClick` to `<ProblemStatement>`.**

Find where ProblemStatement is rendered and add:

```tsx
<ProblemStatement
    serverRenderedHtml={serverRenderedPS?.html}
    onTaskClick={handleTaskOpen}
/>
```

- [ ] **Step 6: Mount both overlay instances at the end of the JSX, before the closing wrapper.**

```tsx
<TestResultsOverlay
    open={openOverviewView != null}
    onClose={handleOverviewClose}
    testCases={testCases}
/>

<TestResultsOverlay
    open={openTaskView != null}
    onClose={handleTaskClose}
    testCases={openTaskView?.filtered ?? []}
    taskName={openTaskView?.taskName}
/>
```

- [ ] **Step 7: Run typecheck — should now be clean across the project.**

```bash
cd extension && npm run check-types
```
Expected: PASS.

- [ ] **Step 8: Extend the existing ExerciseDetailView test file with overall pairing checks.**

Append to `extension/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx`:

```tsx
it('posts testResultsOverviewOpened + Closed pair with matching viewId on open and close', async () => {
    useExerciseDetailStore.setState({
        exerciseData: makeExerciseDataWithParticipation({ hasResult: true }),
        isLoading: false,
    });
    const mockApi = createMockVsCodeApi();
    render(<ExerciseDetailView vscodeApi={mockApi} />);

    await userEvent.click(screen.getByRole('button', { name: /see test results/i }));
    expect(mockApi.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'testResultsOverviewOpened' })
    );
    const openedCall = mockApi.postMessage.mock.calls.find(c => c[0].command === 'testResultsOverviewOpened')!;
    const openedViewId = openedCall[0].payload.viewId;
    expect(typeof openedViewId).toBe('string');

    // Close via Escape key → expect a closed message with the same viewId
    fireEvent.keyDown(document, { key: 'Escape' });
    const closedCall = mockApi.postMessage.mock.calls.find(c => c[0].command === 'testResultsOverviewClosed')!;
    expect(closedCall[0].payload.viewId).toBe(openedViewId);
    expect(closedCall[0].payload.closeReason).toBe('escape');
    expect(closedCall[0].payload.durationMs).toBeGreaterThanOrEqual(0);
});

it('posts taskFeedbackClosed with closeReason "replaced" when opening overview while task modal is open', async () => {
    useExerciseDetailStore.setState({
        exerciseData: makeExerciseDataWithParticipation({ hasResult: true }),
        isLoading: false,
    });
    const mockApi = createMockVsCodeApi();
    render(<ExerciseDetailView vscodeApi={mockApi} />);

    // Synthesise a task click by directly invoking the click handler — we
    // verify the message contract, not the SSR-DOM-click path (which is
    // covered in ProblemStatement.test.tsx).
    // ...assume a helper or test-only escape hatch exists; otherwise this
    // test belongs as a manual smoke check (see task 21).
});
```

If injecting a task click directly is not feasible without a test-only escape hatch, mark the second test `.skip` with a comment pointing to the manual check in Task 21. The replaced-flow is also covered by manual smoke testing.

- [ ] **Step 9: Run React tests.**

```bash
cd extension && npm run test:react -- ExerciseDetailView 2>&1 | tail -10
```
Expected: existing tests still pass; new test(s) added pass.

- [ ] **Step 10: Commit.**

```bash
git add extension/src/webview/views/ExerciseDetail/ExerciseDetailView.tsx extension/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx
git commit -m "feat(exercise-detail): wire overview + task feedback tracking with dual overlays"
```

---

## Task 20: Final verification

**Files:** none modified — verification only.

- [ ] **Step 1: Full typecheck.**

```bash
cd extension && npm run check-types
```
Expected: PASS.

- [ ] **Step 2: Full lint.**

```bash
cd extension && npm run lint
```
Expected: PASS.

- [ ] **Step 3: Unit tests.**

```bash
cd extension && npm run compile-tests && npm run test:unit 2>&1 | tail -3 && grep -E "tests=|failures=" extension/reports/mocha-results.xml | head -1
```
Expected: `failures="0"`, tests count increased over the baseline by at least 9 (5 sessionRecorder + 4 testResultsTrackingCommands).

- [ ] **Step 4: React tests.**

```bash
cd extension && npm run test:react 2>&1 | grep -E "Test Files|Tests" | tail -3
```
Expected: all green; tests count increased over baseline by at least 11 (7 TestResultsOverlay + 4 ProblemStatement task-click).

- [ ] **Step 5: Knip dead-code check.**

```bash
cd extension && npx knip 2>&1 | tail -10
```
Expected: clean (only pre-existing config hints).

- [ ] **Step 6: Manual smoke (extension running in VS Code Extension Development Host).**

1. Run the extension in the host (F5 in VS Code), open an Artemis course with a programming exercise.
2. Open the exercise. Verify task entries in the problem statement now show pointer cursor and underline.
3. Click a task. Modal opens titled "Feedback for task: <taskName>" with only that task's tests.
4. Close via X button. Inspect `~/.../recordings/<session>/events.jsonl` for the open/close pair with matching `viewId` and `closeReason: 'button'`.
5. Reopen via Escape close → confirm `closeReason: 'escape'`.
6. Reopen via backdrop click → confirm `closeReason: 'backdrop'`.
7. Open a task modal, then click "See test results" button → confirm a `taskFeedbackClosed` with `closeReason: 'replaced'` is emitted, immediately followed by `testResultsOverviewOpened`.
8. Open modal, close VS Code window → confirm no synthetic close event in the recording (last event for that view is `opened`).

- [ ] **Step 7: Push.**

```bash
git push -u origin feat/test-results-tracking
```

- [ ] **Step 8: Open PR (optional, per user direction).**

```bash
gh pr create --base dev --head feat/test-results-tracking \
    --title "feat: track test-results views and add per-task feedback modal" \
    --body "$(cat <<'EOF'
## Summary
- Add per-task feedback modal triggered by clicking a `[task]` entry in the SSR'd problem statement (Artemis web-client parity).
- Add recorder events `testResultsOverviewView` and `taskFeedbackView` (discriminated union over `opened|closed`, paired by viewId, with durationMs and closeReason).
- Wire via the existing provider-events + sessionRecorderWiring pattern.

## Spec & Plan
- Design: `docs/superpowers/specs/2026-05-12-test-results-tracking-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-12-test-results-tracking.md`

## Test plan
- [ ] Click task → modal shows only that task's tests
- [ ] Close via X / Escape / backdrop → recorder event with correct closeReason
- [ ] Open one modal while the other is open → 'replaced' closeReason fires for the displaced view
- [ ] Recording shows unmatched opened when VS Code is closed mid-view
EOF
)"
```
