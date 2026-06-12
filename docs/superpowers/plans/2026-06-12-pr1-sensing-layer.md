# PR 1: Sensing Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a single sensing layer (`services/sensing/`) so exactly one place subscribes to VS Code APIs; rewire the recorder and the EQ pipeline onto it with zero behavior change (recordings stay schema-v2 identical).

**Architecture:** A `SensorHub` interface plus a `VsCodeSensorHub` implementation own all `vscode.*` event subscriptions and state reads. The recorder (`ObservationRegistry`, `TerminalCollector`, `StartupCapture`), the EQ pipeline (`CompileEquivalentEmitter` via a new save-triggered diagnostics-settle channel) and the v1 services (`InactivityService`, `DiagnosticPersistenceService`) consume hub channels instead of subscribing themselves. All policy logic (phase gates, generation tokens, URI filters, debounces) stays where it is.

**Tech Stack:** TypeScript strict, VS Code extension API, `@vscode/test-cli` (mocha in a real extension host), eslint, esbuild.

**Spec:** `docs/superpowers/specs/2026-06-12-struggle-engine-v2-port.md` (sections 3, 4, 8/PR 1, 10).

**Branch:** `refactor/sensing-layer`, branched off `feat/struggle-engine-v2`, merges back into it. Repo root: `/Users/liamberger/Documents/private/MA/artemis-extension`; all `npm` commands run in `extension/`.

---

## Decision Log (read before executing)

1. **Hub injection is optional with an owned default.** `TelemetryManager`, `SessionRecorder`, `InactivityService` and `DiagnosticPersistenceService` accept an optional `SensorHub`; when omitted they construct and own a private `VsCodeSensorHub`. Production (`extension.ts`) creates exactly ONE hub and injects it everywhere. Rationale: the ~30 existing test construction sites stay untouched, which is tier (a) of the equivalence proof. The single-hub rule is a production wiring invariant, documented on the class.
1a. **Hub channels are lazy relays.** A channel subscribes to its underlying VS Code API only while at least one consumer is attached and unsubscribes when the last detaches. This preserves the pre-refactor property that consent-scoped consumers (the recorder) produce consent-scoped VS Code listeners (proven by the untouched `terminalShellExecution.test.ts`, which monkey-patches the shell-execution APIs after construction and asserts listeners appear only after `enable()`), and makes default-constructed test hubs cost nothing while idle.
1b. **Settle signals carry a monotonic ordering token (`savedSeq`) and the EQ emitter drops cross-session settles.** v1 cleared its pending save timer in `onSessionStart`; the hub-owned settle timer cannot be cleared per consumer. Instead, every save signal draws a strictly monotonic sequence number (`nextSensorSeq()`, module-level counter in `sensing/sequence.ts`); `onSessionStart` draws one too; the emitter drops any settled dump whose `savedSeq` is below the session-start token. All these events happen on one JS thread, so the counter gives a strict total order with no same-millisecond ambiguity (timestamps would be ambiguous there). Same observable behavior as v1: no save snapshot from session A can leak into session B.
2. **Consumers depend on the `SensorHub` interface, not the class.** Tests inject a controllable `TestSensorHub` (new shared test double). This is also the seam Engine v2 (PR 2) will use.
3. **Reads on payload objects are allowed downstream.** The hub delivers rich VS Code objects (editors, documents, executions). Consumers may call methods on those (e.g. `editor.document.getText()`, `execution.read()`). The prohibition covers global `vscode.workspace/window/languages/debug` namespace access (subscriptions and state reads) outside `services/sensing/`.
4. **`onDidChangeConfiguration` stays outside the hub.** Extension settings are not behavioral sensing. Same for UI-owned APIs (status bar, output channels, webviews).
5. **Known micro-difference (deliberate, documented):** the `artemis.struggleDetection.enabled` gate for the EQ save path moves from save-time to settle-time (500 ms later). Effect exists only when the setting is toggled inside that 500 ms window; recordings are unaffected (recorder path independent). Everything else must be exactly equivalent.
6. **No eslint enforcement rule for the sensing invariant in this PR** (YAGNI; review + the architecture note in PR 5 carry it).
7. **Timestamps:** the hub stamps `ts = Date.now()` synchronously when a VS Code event arrives. In this PR the recorder keeps stamping its own `Date.now()` inside `eventCollectors` (unchanged behavior). Engine v2 will consume `ts` in PR 2.

## File Map

Create:
- `extension/src/extension/services/sensing/types.ts` (signal types)
- `extension/src/extension/services/sensing/sequence.ts` (monotonic ordering token)
- `extension/src/extension/services/sensing/sensorHub.ts` (interface + VS Code impl)
- `extension/src/extension/services/sensing/collectors/diagnosticsSettle.ts`
- `extension/src/extension/services/sensing/index.ts` (barrel)
- `extension/test/unit/services/sensing/sensorHub.test.ts`
- `extension/test/unit/services/sensing/diagnosticsSettle.test.ts`
- `extension/test/__shared__/testSensorHub.ts`
- `extension/test/unit/services/telemetry/recording/observationLifecycle.test.ts`
- `extension/test/unit/services/telemetry/eqSettlePath.test.ts`

Modify:
- `extension/src/extension/services/telemetry/recording/observation/observationRegistry.ts`
- `extension/src/extension/services/telemetry/recording/observation/terminalCollector.ts`
- `extension/src/extension/services/telemetry/recording/eventCollectors.ts` (collectDiagnostics signature)
- `extension/src/extension/services/telemetry/recording/sessionRecorder.ts`
- `extension/src/extension/services/telemetry/recording/startup/startupCapture.ts`
- `extension/src/extension/services/telemetry/recording/lifecycleController.ts`
- `extension/src/extension/services/telemetry/eventPipeline/compileEquivalentEmitter.ts`
- `extension/src/extension/services/telemetry/telemetryManager.ts`
- `extension/src/extension/services/telemetry/inactivityService.ts`
- `extension/src/extension/services/telemetry/diagnosticPersistenceService.ts`
- `extension/src/extension.ts`
- `extension/src/extension/dataCollection/types.ts`
- `extension/src/extension/dataCollection/index.ts`
- `extension/src/extension/activation/sessionRecorderWiring.ts`
- `extension/test/unit/activation/sessionRecorderWiring.test.ts` (construction site only)
- `.claude/CLAUDE.md` (branch note), `CHANGELOG.md`

---

### Task 1: Branch, baseline, BEFORE capture

- [ ] **Step 1.1: Create the branch**

```bash
git -C /Users/liamberger/Documents/private/MA/artemis-extension checkout -b refactor/sensing-layer feat/struggle-engine-v2
```

- [ ] **Step 1.2: Baseline test run (must be green before any change)**

```bash
cd /Users/liamberger/Documents/private/MA/artemis-extension/extension
npm run compile-tests 2>&1 | tail -5
npm run test:unit 2>&1 | tee /tmp/pr1-baseline-unit.txt | tail -15
npm run test:struggle 2>&1 | tee /tmp/pr1-baseline-struggle.txt | tail -15
npm run test:recorder-e2e 2>&1 | tee /tmp/pr1-baseline-recorder-e2e.txt | tail -15
```

Expected: all suites PASS. If anything fails, STOP and report; do not start on a red baseline.

- [ ] **Step 1.3 [MANUAL, Liam + assistant]: capture the BEFORE recording**

Launch the extension dev host from this branch, enable extended consent, start an exercise session and perform a 3-minute scripted sequence: open a Java file, type ~5 lines, save twice, select text, scroll, run `ls` in the terminal, switch files, end session. Copy the newest folder from the recordings directory (command palette: "Artemis: Open Recordings Folder") to `/tmp/recording-before/`. This is tier (c) input; the same script is repeated AFTER the refactor in Task 10.

### Task 2: Sensing types + SensorHub

**Files:**
- Create: `extension/src/extension/services/sensing/types.ts`
- Create: `extension/src/extension/services/sensing/sensorHub.ts`
- Create: `extension/src/extension/services/sensing/index.ts`
- Test: `extension/test/unit/services/sensing/sensorHub.test.ts`

- [ ] **Step 2.1: Write the failing test**

```typescript
// extension/test/unit/services/sensing/sensorHub.test.ts
import * as vscode from 'vscode';
import * as assert from 'assert';

import type { TextChangeSignal } from '@extension/services/sensing/types';
import { VsCodeSensorHub } from '@extension/services/sensing/sensorHub';

suite('VsCodeSensorHub', () => {
    test('relays text changes with an arrival timestamp', async () => {
        const hub = new VsCodeSensorHub();
        // Open FIRST: VS Code fires onDidChangeTextDocument for the initial
        // content fill, so subscribing before open would see 2 events.
        const doc = await vscode.workspace.openTextDocument({ content: 'abc', language: 'plaintext' });
        const received: TextChangeSignal[] = [];
        const sub = hub.onDidChangeTextDocument(signal => received.push(signal));

        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, new vscode.Position(0, 0), 'x');
        const before = Date.now();
        await vscode.workspace.applyEdit(edit);
        // onDidChangeTextDocument fires synchronously during applyEdit.
        assert.strictEqual(received.length, 1);
        assert.strictEqual(received[0].event.document.uri.toString(), doc.uri.toString());
        assert.ok(received[0].ts >= before && received[0].ts <= Date.now());

        sub.dispose();
        hub.dispose();
    });

    test('dispose() stops relaying', async () => {
        const hub = new VsCodeSensorHub();
        let count = 0;
        hub.onDidChangeTextDocument(() => count++);
        hub.dispose();

        const doc = await vscode.workspace.openTextDocument({ content: 'abc' });
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, new vscode.Position(0, 0), 'y');
        await vscode.workspace.applyEdit(edit);
        assert.strictEqual(count, 0);
    });

    test('underlying VS Code subscription attaches lazily and detaches with the last listener', () => {
        const original = vscode.window.onDidOpenTerminal;
        let active = 0;
        (vscode.window as { onDidOpenTerminal: typeof vscode.window.onDidOpenTerminal }).onDidOpenTerminal =
            ((_listener: (t: vscode.Terminal) => void) => {
                active++;
                return new vscode.Disposable(() => { active--; });
            }) as typeof vscode.window.onDidOpenTerminal;
        try {
            const hub = new VsCodeSensorHub();
            assert.strictEqual(active, 0, 'no listener before a consumer attaches');
            const s1 = hub.onDidOpenTerminal(() => { /* consumer 1 */ });
            const s2 = hub.onDidOpenTerminal(() => { /* consumer 2 */ });
            assert.strictEqual(active, 1, 'one shared listener for many consumers');
            s1.dispose();
            assert.strictEqual(active, 1, 'listener stays while a consumer remains');
            s2.dispose();
            assert.strictEqual(active, 0, 'last consumer detaches the listener');
            hub.dispose();
        } finally {
            (vscode.window as { onDidOpenTerminal: typeof vscode.window.onDidOpenTerminal }).onDidOpenTerminal = original;
        }
    });

    test('state reads delegate to the live VS Code namespace', () => {
        const hub = new VsCodeSensorHub();
        assert.deepStrictEqual(hub.readAllDiagnostics(), vscode.languages.getDiagnostics());
        assert.strictEqual(hub.readWindowFocused(), vscode.window.state.focused);
        assert.strictEqual(hub.readActiveTextEditor(), vscode.window.activeTextEditor);
        assert.strictEqual(hub.readVisibleTextEditors().length, vscode.window.visibleTextEditors.length);
        assert.strictEqual(hub.readTerminals().length, vscode.window.terminals.length);
        assert.strictEqual(hub.readBreakpoints().length, vscode.debug.breakpoints.length);
        hub.dispose();
    });
});
```

- [ ] **Step 2.2: Run to verify it fails**

```bash
npm run compile-tests
```

Expected: tsc FAILS with "Cannot find module '@extension/services/sensing/sensorHub'".

- [ ] **Step 2.3: Implement types.ts**

```typescript
// extension/src/extension/services/sensing/types.ts
/**
 * Typed payloads for the sensing layer (see services/sensing/sensorHub.ts).
 *
 * `ts` is the canonical arrival timestamp: Date.now() captured synchronously
 * when the VS Code event fires, before any fan-out. Downstream consumers that
 * need event time must use this value instead of re-stamping, so that live
 * operation and offline replay agree (struggle-engine requirement).
 */
import type * as vscode from 'vscode';

export interface Stamped {
    readonly ts: number;
}

export interface TextChangeSignal extends Stamped { readonly event: vscode.TextDocumentChangeEvent }
export interface SaveSignal extends Stamped {
    /** Strictly monotonic arrival token (see sensing/sequence.ts). */
    readonly seq: number;
    readonly document: vscode.TextDocument;
}
export interface ActiveEditorSignal extends Stamped { readonly editor: vscode.TextEditor | undefined }
export interface DiagnosticsChangeSignal extends Stamped { readonly uris: readonly vscode.Uri[] }
/** Bulk diagnostics dump taken 500 ms after a save burst (language-server settle). */
export interface DiagnosticsSettledSignal extends Stamped {
    /**
     * Ordering token of the most recent save in the coalesced burst. Consumers
     * with session semantics (EQ emitter) compare it against their own
     * session-start token to drop settles whose triggering save predates the
     * session (PR1 decision log #1b). Tokens, not timestamps: a save and a
     * session switch in the same millisecond must still be strictly ordered.
     */
    readonly savedSeq: number;
    readonly entries: ReadonlyArray<[vscode.Uri, vscode.Diagnostic[]]>;
}
export interface WindowStateSignal extends Stamped { readonly state: vscode.WindowState }
export interface SelectionSignal extends Stamped { readonly event: vscode.TextEditorSelectionChangeEvent }
export interface VisibleRangesSignal extends Stamped { readonly event: vscode.TextEditorVisibleRangesChangeEvent }
export interface TerminalSignal extends Stamped { readonly terminal: vscode.Terminal }
export interface FileSetSignal extends Stamped { readonly files: readonly vscode.Uri[] }
export interface FileRenameSignal extends Stamped {
    readonly files: ReadonlyArray<{ readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }>;
}
export interface TextDocumentSignal extends Stamped { readonly document: vscode.TextDocument }
export interface DebugSessionSignal extends Stamped { readonly session: vscode.DebugSession | undefined }
export interface BreakpointsSignal extends Stamped { readonly event: vscode.BreakpointsChangeEvent }
export interface ShellExecutionStartSignal extends Stamped { readonly event: vscode.TerminalShellExecutionStartEvent }
export interface ShellExecutionEndSignal extends Stamped { readonly event: vscode.TerminalShellExecutionEndEvent }
```

- [ ] **Step 2.3b: Implement sequence.ts**

```typescript
// extension/src/extension/services/sensing/sequence.ts
/**
 * Strictly monotonic ordering token for sensor events. All sensing and
 * session-lifecycle code runs on the extension host's single JS thread, so
 * consuming one counter yields a strict total order: an event that happened
 * before another always carries a smaller token. Used where timestamp
 * comparison would be ambiguous within one millisecond (decision log #1b).
 */
let counter = 0;

export function nextSensorSeq(): number {
    counter += 1;
    return counter;
}
```

- [ ] **Step 2.4: Implement sensorHub.ts (interface + VS Code impl, settle channel arrives in Task 3)**

```typescript
// extension/src/extension/services/sensing/sensorHub.ts
import * as vscode from 'vscode';

import type { PlatformCapabilities } from '@extension/theia';

import { nextSensorSeq } from './sequence';
import type {
    ActiveEditorSignal, BreakpointsSignal, DebugSessionSignal, DiagnosticsChangeSignal,
    DiagnosticsSettledSignal, FileRenameSignal, FileSetSignal, SaveSignal, SelectionSignal,
    ShellExecutionEndSignal, ShellExecutionStartSignal, TerminalSignal, TextChangeSignal,
    TextDocumentSignal, VisibleRangesSignal, WindowStateSignal,
} from './types';

/**
 * The single place that reads VS Code APIs for behavioral sensing.
 *
 * Every consumer (session recorder, EQ logger, struggle engine) attaches to
 * these typed channels instead of subscribing to `vscode.*` itself, and uses
 * the read* methods instead of global state reads. Policy (phase gates,
 * URI filters, debouncing, consent) lives in the consumers, NOT here.
 *
 * Production creates exactly ONE hub (extension.ts) and injects it
 * everywhere. The default-constructed hubs in TelemetryManager/SessionRecorder
 * exist only so tests can construct those classes standalone.
 */
export interface SensorHub extends vscode.Disposable {
    readonly onDidChangeTextDocument: vscode.Event<TextChangeSignal>;
    readonly onDidSaveTextDocument: vscode.Event<SaveSignal>;
    readonly onDidChangeActiveTextEditor: vscode.Event<ActiveEditorSignal>;
    readonly onDidChangeDiagnostics: vscode.Event<DiagnosticsChangeSignal>;
    /** Save-triggered settle snapshot (500 ms after a save burst). */
    readonly onDiagnosticsSettled: vscode.Event<DiagnosticsSettledSignal>;
    readonly onDidChangeWindowState: vscode.Event<WindowStateSignal>;
    readonly onDidChangeTextEditorSelection: vscode.Event<SelectionSignal>;
    readonly onDidChangeTextEditorVisibleRanges: vscode.Event<VisibleRangesSignal>;
    readonly onDidOpenTerminal: vscode.Event<TerminalSignal>;
    readonly onDidCloseTerminal: vscode.Event<TerminalSignal>;
    readonly onDidCreateFiles: vscode.Event<FileSetSignal>;
    readonly onDidDeleteFiles: vscode.Event<FileSetSignal>;
    readonly onDidRenameFiles: vscode.Event<FileRenameSignal>;
    readonly onDidOpenTextDocument: vscode.Event<TextDocumentSignal>;
    readonly onDidCloseTextDocument: vscode.Event<TextDocumentSignal>;
    readonly onDidStartDebugSession: vscode.Event<DebugSessionSignal>;
    readonly onDidTerminateDebugSession: vscode.Event<DebugSessionSignal>;
    readonly onDidChangeActiveDebugSession: vscode.Event<DebugSessionSignal>;
    readonly onDidChangeBreakpoints: vscode.Event<BreakpointsSignal>;
    /** Not fired on platforms without the shellIntegration API (Theia). */
    readonly onDidStartTerminalShellExecution: vscode.Event<ShellExecutionStartSignal>;
    readonly onDidEndTerminalShellExecution: vscode.Event<ShellExecutionEndSignal>;

    readAllDiagnostics(): ReadonlyArray<[vscode.Uri, vscode.Diagnostic[]]>;
    readDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[];
    readWindowFocused(): boolean;
    readVisibleTextEditors(): readonly vscode.TextEditor[];
    readActiveTextEditor(): vscode.TextEditor | undefined;
    readTerminals(): readonly vscode.Terminal[];
    readBreakpoints(): readonly vscode.Breakpoint[];
}

/**
 * A hub channel that subscribes to its VS Code source event only while at
 * least one consumer is attached, and unsubscribes when the last detaches
 * (PR1 decision log #1a). Fan-out is synchronous in attach order.
 */
class LazyRelay<TRaw, TSignal> implements vscode.Disposable {
    private readonly _listeners = new Set<(signal: TSignal) => void>();
    private _source: vscode.Disposable | undefined;

    constructor(
        private readonly _subscribe: (handler: (raw: TRaw) => void) => vscode.Disposable,
        private readonly _map: (raw: TRaw) => TSignal,
    ) {}

    readonly event: vscode.Event<TSignal> = (listener, thisArgs?, disposables?) => {
        const bound: (signal: TSignal) => void =
            thisArgs !== undefined ? listener.bind(thisArgs) : listener;
        this._listeners.add(bound);
        if (this._listeners.size === 1) {
            this._source = this._subscribe(raw => this._fan(this._map(raw)));
        }
        const subscription = new vscode.Disposable(() => {
            this._listeners.delete(bound);
            if (this._listeners.size === 0) {
                this._source?.dispose();
                this._source = undefined;
            }
        });
        disposables?.push(subscription);
        return subscription;
    };

    private _fan(signal: TSignal): void {
        // Copy: a listener may attach/detach during fan-out.
        for (const listener of [...this._listeners]) {
            listener(signal);
        }
    }

    dispose(): void {
        this._listeners.clear();
        this._source?.dispose();
        this._source = undefined;
    }
}

/** Inert subscription for APIs the current platform does not provide. */
const NOOP_SUBSCRIPTION = new vscode.Disposable(() => { /* platform lacks this API */ });

export class VsCodeSensorHub implements SensorHub {
    private readonly _disposables: vscode.Disposable[] = [];

    /** Create a lazily-subscribing channel and track it for dispose(). */
    private _relay<TRaw, TSignal>(
        subscribe: (handler: (raw: TRaw) => void) => vscode.Disposable,
        map: (raw: TRaw) => TSignal,
    ): vscode.Event<TSignal> {
        const relay = new LazyRelay(subscribe, map);
        this._disposables.push(relay);
        return relay.event;
    }

    readonly onDidChangeTextDocument = this._relay(
        h => vscode.workspace.onDidChangeTextDocument(h),
        (event: vscode.TextDocumentChangeEvent): TextChangeSignal => ({ ts: Date.now(), event }),
    );
    readonly onDidSaveTextDocument = this._relay(
        h => vscode.workspace.onDidSaveTextDocument(h),
        (document: vscode.TextDocument): SaveSignal => ({ ts: Date.now(), seq: nextSensorSeq(), document }),
    );
    readonly onDidChangeActiveTextEditor = this._relay(
        h => vscode.window.onDidChangeActiveTextEditor(h),
        (editor: vscode.TextEditor | undefined): ActiveEditorSignal => ({ ts: Date.now(), editor }),
    );
    readonly onDidChangeDiagnostics = this._relay(
        h => vscode.languages.onDidChangeDiagnostics(h),
        (event: vscode.DiagnosticChangeEvent): DiagnosticsChangeSignal => ({ ts: Date.now(), uris: event.uris }),
    );
    readonly onDidChangeWindowState = this._relay(
        h => vscode.window.onDidChangeWindowState(h),
        (state: vscode.WindowState): WindowStateSignal => ({ ts: Date.now(), state }),
    );
    readonly onDidChangeTextEditorSelection = this._relay(
        h => vscode.window.onDidChangeTextEditorSelection(h),
        (event: vscode.TextEditorSelectionChangeEvent): SelectionSignal => ({ ts: Date.now(), event }),
    );
    readonly onDidChangeTextEditorVisibleRanges = this._relay(
        h => vscode.window.onDidChangeTextEditorVisibleRanges(h),
        (event: vscode.TextEditorVisibleRangesChangeEvent): VisibleRangesSignal => ({ ts: Date.now(), event }),
    );
    readonly onDidOpenTerminal = this._relay(
        h => vscode.window.onDidOpenTerminal(h),
        (terminal: vscode.Terminal): TerminalSignal => ({ ts: Date.now(), terminal }),
    );
    readonly onDidCloseTerminal = this._relay(
        h => vscode.window.onDidCloseTerminal(h),
        (terminal: vscode.Terminal): TerminalSignal => ({ ts: Date.now(), terminal }),
    );
    readonly onDidCreateFiles = this._relay(
        h => vscode.workspace.onDidCreateFiles(h),
        (event: vscode.FileCreateEvent): FileSetSignal => ({ ts: Date.now(), files: event.files }),
    );
    readonly onDidDeleteFiles = this._relay(
        h => vscode.workspace.onDidDeleteFiles(h),
        (event: vscode.FileDeleteEvent): FileSetSignal => ({ ts: Date.now(), files: event.files }),
    );
    readonly onDidRenameFiles = this._relay(
        h => vscode.workspace.onDidRenameFiles(h),
        (event: vscode.FileRenameEvent): FileRenameSignal => ({ ts: Date.now(), files: event.files }),
    );
    readonly onDidOpenTextDocument = this._relay(
        h => vscode.workspace.onDidOpenTextDocument(h),
        (document: vscode.TextDocument): TextDocumentSignal => ({ ts: Date.now(), document }),
    );
    readonly onDidCloseTextDocument = this._relay(
        h => vscode.workspace.onDidCloseTextDocument(h),
        (document: vscode.TextDocument): TextDocumentSignal => ({ ts: Date.now(), document }),
    );
    readonly onDidStartDebugSession = this._relay(
        h => vscode.debug.onDidStartDebugSession(h),
        (session: vscode.DebugSession): DebugSessionSignal => ({ ts: Date.now(), session }),
    );
    readonly onDidTerminateDebugSession = this._relay(
        h => vscode.debug.onDidTerminateDebugSession(h),
        (session: vscode.DebugSession): DebugSessionSignal => ({ ts: Date.now(), session }),
    );
    readonly onDidChangeActiveDebugSession = this._relay(
        h => vscode.debug.onDidChangeActiveDebugSession(h),
        (session: vscode.DebugSession | undefined): DebugSessionSignal => ({ ts: Date.now(), session }),
    );
    readonly onDidChangeBreakpoints = this._relay(
        h => vscode.debug.onDidChangeBreakpoints(h),
        (event: vscode.BreakpointsChangeEvent): BreakpointsSignal => ({ ts: Date.now(), event }),
    );
    // Capability-dependent and derived channels are assigned in the constructor.
    readonly onDidStartTerminalShellExecution: vscode.Event<ShellExecutionStartSignal>;
    readonly onDidEndTerminalShellExecution: vscode.Event<ShellExecutionEndSignal>;
    readonly onDiagnosticsSettled: vscode.Event<DiagnosticsSettledSignal>;

    constructor(capabilities?: PlatformCapabilities) {
        // Shell-execution API is Desktop-only; the capability flag guards the
        // subscription so Theia builds never touch the missing API.
        const hasShellExecution = capabilities?.hasTerminalShellExecution !== false;
        this.onDidStartTerminalShellExecution = this._relay(
            hasShellExecution ? h => vscode.window.onDidStartTerminalShellExecution(h) : () => NOOP_SUBSCRIPTION,
            (event: vscode.TerminalShellExecutionStartEvent): ShellExecutionStartSignal => ({ ts: Date.now(), event }),
        );
        this.onDidEndTerminalShellExecution = this._relay(
            hasShellExecution ? h => vscode.window.onDidEndTerminalShellExecution(h) : () => NOOP_SUBSCRIPTION,
            (event: vscode.TerminalShellExecutionEndEvent): ShellExecutionEndSignal => ({ ts: Date.now(), event }),
        );
        // Task 3 replaces this inert stub with the DiagnosticsSettleCollector wiring.
        this.onDiagnosticsSettled = this._relay(
            () => NOOP_SUBSCRIPTION,
            (signal: DiagnosticsSettledSignal) => signal,
        );
    }

    readAllDiagnostics(): ReadonlyArray<[vscode.Uri, vscode.Diagnostic[]]> {
        return vscode.languages.getDiagnostics();
    }
    readDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[] {
        return vscode.languages.getDiagnostics(uri);
    }
    readWindowFocused(): boolean { return vscode.window.state.focused; }
    readVisibleTextEditors(): readonly vscode.TextEditor[] { return vscode.window.visibleTextEditors; }
    readActiveTextEditor(): vscode.TextEditor | undefined { return vscode.window.activeTextEditor; }
    readTerminals(): readonly vscode.Terminal[] { return vscode.window.terminals; }
    readBreakpoints(): readonly vscode.Breakpoint[] { return vscode.debug.breakpoints; }

    dispose(): void {
        while (this._disposables.length > 0) {
            this._disposables.pop()?.dispose();
        }
    }
}
```

- [ ] **Step 2.5: Create the barrel**

```typescript
// extension/src/extension/services/sensing/index.ts
export type { SensorHub } from './sensorHub';
export { VsCodeSensorHub } from './sensorHub';
export { nextSensorSeq } from './sequence';
export type * from './types';
```

- [ ] **Step 2.6: Run tests, verify pass**

```bash
npm run compile-tests && npm run test:unit 2>&1 | tail -10
```

Expected: PASS including the 3 new `VsCodeSensorHub` tests.

- [ ] **Step 2.7: Lint + commit**

```bash
npm run lint && npm run check-types
git add src/extension/services/sensing test/unit/services/sensing
git commit -m "refactor(sensing): add SensorHub, the single VS Code event/state reader"
```

### Task 3: DiagnosticsSettleCollector (save-triggered settle snapshot)

**Files:**
- Create: `extension/src/extension/services/sensing/collectors/diagnosticsSettle.ts`
- Modify: `extension/src/extension/services/sensing/sensorHub.ts` (wire collector)
- Test: `extension/test/unit/services/sensing/diagnosticsSettle.test.ts`

This moves the VS-Code-reading half of `CompileEquivalentEmitter.handleSaveEvent` (500 ms LS settle timer + `vscode.languages.getDiagnostics()` dump, see `compileEquivalentEmitter.ts:58-82,132-158` on the base branch) into sensing. Semantics to preserve exactly: only saves of recordable URIs arm the timer (`shouldRecordUri(doc.uri)` without exercise root); rapid saves coalesce into ONE timer; the dump happens at settle time.

- [ ] **Step 3.1: Write the failing test**

```typescript
// extension/test/unit/services/sensing/diagnosticsSettle.test.ts
import * as vscode from 'vscode';
import * as assert from 'assert';

import { DiagnosticsSettleCollector } from '@extension/services/sensing/collectors/diagnosticsSettle';
import { nextSensorSeq } from '@extension/services/sensing/sequence';
import type { DiagnosticsSettledSignal, SaveSignal } from '@extension/services/sensing/types';

function fakeSaveSignal(path: string, scheme = 'file'): SaveSignal {
    const uri = scheme === 'file' ? vscode.Uri.file(path) : vscode.Uri.parse(`${scheme}:${path}`);
    return { ts: Date.now(), seq: nextSensorSeq(), document: { uri } as vscode.TextDocument };
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

suite('DiagnosticsSettleCollector', () => {
    let emitter: vscode.EventEmitter<SaveSignal>;
    let collector: DiagnosticsSettleCollector;
    let received: DiagnosticsSettledSignal[];
    const dump: Array<[vscode.Uri, vscode.Diagnostic[]]> = [
        [vscode.Uri.file('/w/A.java'), [new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), 'boom', vscode.DiagnosticSeverity.Error)]],
    ];

    setup(() => {
        emitter = new vscode.EventEmitter<SaveSignal>();
        collector = new DiagnosticsSettleCollector(emitter.event, () => dump);
        received = [];
        collector.onDidSettle(signal => received.push(signal));
    });

    teardown(() => {
        collector.dispose();
        emitter.dispose();
    });

    test('emits one settled dump 500ms after a save, carrying the save ordering token', async () => {
        const save = fakeSaveSignal('/w/A.java');
        emitter.fire(save);
        assert.strictEqual(received.length, 0, 'must not emit before the settle window');
        await sleep(600);
        assert.strictEqual(received.length, 1);
        assert.strictEqual(received[0].entries, dump);
        assert.strictEqual(received[0].savedSeq, save.seq);
        assert.ok(received[0].ts >= save.ts);
    });

    test('coalesces rapid saves into a single emission with the LAST save token', async () => {
        emitter.fire(fakeSaveSignal('/w/A.java'));
        await sleep(100);
        const second = fakeSaveSignal('/w/B.java');
        emitter.fire(second);
        await sleep(600);
        assert.strictEqual(received.length, 1);
        assert.strictEqual(received[0].savedSeq, second.seq);
    });

    test('ignores non-recordable URIs', async () => {
        emitter.fire(fakeSaveSignal('/x', 'untitled'));
        await sleep(600);
        assert.strictEqual(received.length, 0);
    });

    test('dispose cancels a pending settle', async () => {
        emitter.fire(fakeSaveSignal('/w/A.java'));
        collector.dispose();
        await sleep(600);
        assert.strictEqual(received.length, 0);
    });
});
```

- [ ] **Step 3.2: Run to verify it fails** (`npm run compile-tests` fails: module not found)

- [ ] **Step 3.3: Implement the collector**

```typescript
// extension/src/extension/services/sensing/collectors/diagnosticsSettle.ts
import * as vscode from 'vscode';

import { shouldRecordUri } from '@extension/services/telemetry/uriFilter';

import type { DiagnosticsSettledSignal, SaveSignal } from '../types';

/**
 * Save-triggered diagnostics settle snapshot.
 *
 * After a save on a recordable URI, waits DIAGNOSTICS_SETTLE_MS for the
 * language server to update, then emits one bulk diagnostics dump. Saves
 * within the window coalesce into a single timer, exactly matching the v1
 * CompileEquivalentEmitter save path this replaces (engineering choice,
 * calibrated for LS latency).
 */
export class DiagnosticsSettleCollector implements vscode.Disposable {
    static readonly DIAGNOSTICS_SETTLE_MS = 500;

    private _timer: ReturnType<typeof setTimeout> | undefined;
    private _lastSaveSeq = 0;
    private readonly _subscription: vscode.Disposable;
    private readonly _onDidSettle = new vscode.EventEmitter<DiagnosticsSettledSignal>();
    public readonly onDidSettle = this._onDidSettle.event;

    constructor(
        onSave: vscode.Event<SaveSignal>,
        private readonly _readAllDiagnostics: () => ReadonlyArray<[vscode.Uri, vscode.Diagnostic[]]>,
    ) {
        this._subscription = onSave(({ seq, document }) => {
            if (!shouldRecordUri(document.uri)) {
                return;
            }
            this._lastSaveSeq = seq;
            if (this._timer) {
                clearTimeout(this._timer);
            }
            this._timer = setTimeout(() => {
                this._timer = undefined;
                this._onDidSettle.fire({
                    ts: Date.now(),
                    savedSeq: this._lastSaveSeq,
                    entries: this._readAllDiagnostics(),
                });
            }, DiagnosticsSettleCollector.DIAGNOSTICS_SETTLE_MS);
        });
    }

    dispose(): void {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = undefined;
        }
        this._subscription.dispose();
        this._onDidSettle.dispose();
    }
}
```

- [ ] **Step 3.4: Wire it into VsCodeSensorHub**

In `sensorHub.ts`, add `import { DiagnosticsSettleCollector } from './collectors/diagnosticsSettle';` and replace the inert `onDiagnosticsSettled` stub in the constructor with the derived lazy channel (the collector, and through it the underlying save listener, exists only while someone consumes settled diagnostics):

```typescript
        this.onDiagnosticsSettled = this._relay(
            handler => {
                const collector = new DiagnosticsSettleCollector(
                    this.onDidSaveTextDocument,
                    () => this.readAllDiagnostics(),
                );
                return vscode.Disposable.from(collector.onDidSettle(handler), collector);
            },
            (signal: DiagnosticsSettledSignal) => signal,
        );
```

LazyRelay contract here: the subscribe function already delivers mapped signals, so the map function is the identity.

- [ ] **Step 3.5: Run tests, verify pass** (`npm run compile-tests && npm run test:unit`)

- [ ] **Step 3.6: Lint + commit**

```bash
npm run lint && npm run check-types
git add src/extension/services/sensing test/unit/services/sensing
git commit -m "refactor(sensing): save-triggered diagnostics settle channel"
```

### Task 4: TestSensorHub shared test double

**Files:**
- Create: `extension/test/__shared__/testSensorHub.ts`

No production code; this is the controllable hub for lifecycle tests here and for Engine v2 tests in PR 2.

- [ ] **Step 4.1: Implement**

```typescript
// extension/test/__shared__/testSensorHub.ts
/**
 * Controllable SensorHub for tests: every channel is backed by a public
 * EventEmitter (fire via `hub.emit.<channel>.fire(...)`), state reads return
 * stubbable values (assign `hub.stub.<name>`).
 */
import * as vscode from 'vscode';

import type { SensorHub } from '@extension/services/sensing/sensorHub';
import type {
    ActiveEditorSignal, BreakpointsSignal, DebugSessionSignal, DiagnosticsChangeSignal,
    DiagnosticsSettledSignal, FileRenameSignal, FileSetSignal, SaveSignal, SelectionSignal,
    ShellExecutionEndSignal, ShellExecutionStartSignal, TerminalSignal, TextChangeSignal,
    TextDocumentSignal, VisibleRangesSignal, WindowStateSignal,
} from '@extension/services/sensing/types';

export class TestSensorHub implements SensorHub {
    readonly emit = {
        textChange: new vscode.EventEmitter<TextChangeSignal>(),
        save: new vscode.EventEmitter<SaveSignal>(),
        activeEditor: new vscode.EventEmitter<ActiveEditorSignal>(),
        diagnostics: new vscode.EventEmitter<DiagnosticsChangeSignal>(),
        diagnosticsSettled: new vscode.EventEmitter<DiagnosticsSettledSignal>(),
        windowState: new vscode.EventEmitter<WindowStateSignal>(),
        selection: new vscode.EventEmitter<SelectionSignal>(),
        visibleRanges: new vscode.EventEmitter<VisibleRangesSignal>(),
        terminalOpen: new vscode.EventEmitter<TerminalSignal>(),
        terminalClose: new vscode.EventEmitter<TerminalSignal>(),
        fileCreate: new vscode.EventEmitter<FileSetSignal>(),
        fileDelete: new vscode.EventEmitter<FileSetSignal>(),
        fileRename: new vscode.EventEmitter<FileRenameSignal>(),
        docOpen: new vscode.EventEmitter<TextDocumentSignal>(),
        docClose: new vscode.EventEmitter<TextDocumentSignal>(),
        debugStart: new vscode.EventEmitter<DebugSessionSignal>(),
        debugTerminate: new vscode.EventEmitter<DebugSessionSignal>(),
        debugActive: new vscode.EventEmitter<DebugSessionSignal>(),
        breakpoints: new vscode.EventEmitter<BreakpointsSignal>(),
        shellStart: new vscode.EventEmitter<ShellExecutionStartSignal>(),
        shellEnd: new vscode.EventEmitter<ShellExecutionEndSignal>(),
    };

    readonly stub = {
        allDiagnostics: [] as Array<[vscode.Uri, vscode.Diagnostic[]]>,
        diagnosticsByUri: new Map<string, vscode.Diagnostic[]>(),
        windowFocused: true,
        visibleTextEditors: [] as vscode.TextEditor[],
        activeTextEditor: undefined as vscode.TextEditor | undefined,
        terminals: [] as vscode.Terminal[],
        breakpoints: [] as vscode.Breakpoint[],
    };

    readonly onDidChangeTextDocument = this.emit.textChange.event;
    readonly onDidSaveTextDocument = this.emit.save.event;
    readonly onDidChangeActiveTextEditor = this.emit.activeEditor.event;
    readonly onDidChangeDiagnostics = this.emit.diagnostics.event;
    readonly onDiagnosticsSettled = this.emit.diagnosticsSettled.event;
    readonly onDidChangeWindowState = this.emit.windowState.event;
    readonly onDidChangeTextEditorSelection = this.emit.selection.event;
    readonly onDidChangeTextEditorVisibleRanges = this.emit.visibleRanges.event;
    readonly onDidOpenTerminal = this.emit.terminalOpen.event;
    readonly onDidCloseTerminal = this.emit.terminalClose.event;
    readonly onDidCreateFiles = this.emit.fileCreate.event;
    readonly onDidDeleteFiles = this.emit.fileDelete.event;
    readonly onDidRenameFiles = this.emit.fileRename.event;
    readonly onDidOpenTextDocument = this.emit.docOpen.event;
    readonly onDidCloseTextDocument = this.emit.docClose.event;
    readonly onDidStartDebugSession = this.emit.debugStart.event;
    readonly onDidTerminateDebugSession = this.emit.debugTerminate.event;
    readonly onDidChangeActiveDebugSession = this.emit.debugActive.event;
    readonly onDidChangeBreakpoints = this.emit.breakpoints.event;
    readonly onDidStartTerminalShellExecution = this.emit.shellStart.event;
    readonly onDidEndTerminalShellExecution = this.emit.shellEnd.event;

    readAllDiagnostics(): ReadonlyArray<[vscode.Uri, vscode.Diagnostic[]]> { return this.stub.allDiagnostics; }
    readDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[] {
        return this.stub.diagnosticsByUri.get(uri.toString()) ?? [];
    }
    readWindowFocused(): boolean { return this.stub.windowFocused; }
    readVisibleTextEditors(): readonly vscode.TextEditor[] { return this.stub.visibleTextEditors; }
    readActiveTextEditor(): vscode.TextEditor | undefined { return this.stub.activeTextEditor; }
    readTerminals(): readonly vscode.Terminal[] { return this.stub.terminals; }
    readBreakpoints(): readonly vscode.Breakpoint[] { return this.stub.breakpoints; }

    dispose(): void {
        for (const emitter of Object.values(this.emit)) {
            emitter.dispose();
        }
    }
}
```

- [ ] **Step 4.2: Compile + lint + commit**

```bash
npm run compile-tests && npm run lint
git add test/__shared__/testSensorHub.ts
git commit -m "test(sensing): controllable TestSensorHub double"
```

### Task 5: Recorder stack onto the hub

**Files:**
- Modify: `extension/src/extension/services/telemetry/recording/eventCollectors.ts:87-95`
- Modify: `extension/src/extension/services/telemetry/recording/observation/observationRegistry.ts`
- Modify: `extension/src/extension/services/telemetry/recording/observation/terminalCollector.ts:43-74`
- Modify: `extension/src/extension/services/telemetry/recording/sessionRecorder.ts` (constructor + shutdown)
- Modify: `extension/src/extension/services/telemetry/recording/startup/startupCapture.ts:86,92,125,135,156,167`
- Modify: `extension/src/extension/services/telemetry/recording/lifecycleController.ts:412`

Principle: MOVE the subscription, keep every handler body. The proof is the unchanged recorder test suite.

- [ ] **Step 5.1: collectDiagnostics takes the diagnostics instead of reading them**

```typescript
// eventCollectors.ts — replace the function at lines 87-95
export function collectDiagnostics(uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[]): DiagnosticsEvent {
    return {
        type: 'diagnostics',
        timestamp: Date.now(),
        uri: uri.toString(),
        diagnostics: diagnostics.map(serializeDiagnostic),
    };
}
```

Call sites (the only two, verified by grep): `observationRegistry.ts:142` and `startupCapture.ts:92`, both updated below.

- [ ] **Step 5.2: ObservationRegistry subscribes to hub channels**

In `observationRegistry.ts`:
1. Add `import type { SensorHub } from '@extension/services/sensing';` and extend the deps:

```typescript
interface ObservationRegistryDeps {
    state: RecorderLifecycleState;
    snapshots: SnapshotManager;
    record: (
        event: RecordedEvent,
        opts: { allowDuringStartup?: boolean; allowDuringEnding?: boolean },
        generation: number,
    ) => void;
    hub: SensorHub;
}
```

(`capabilities` is removed from the deps; the shell-execution capability gate now lives in `VsCodeSensorHub`. Remove the `PlatformCapabilities` import.)

2. In `enable()`, replace every `vscode.<ns>.onDid*` subscription with the matching hub channel and destructure the signal. The handler BODIES stay byte-identical. Mapping (all 15 registrations plus the terminal collector):

```typescript
    enable(): void {
        const recordingPhase = (): boolean => this._deps.state.phase === 'recording';
        const hub = this._deps.hub;

        const textChange = hub.onDidChangeTextDocument(({ event }) => {
            // ...body unchanged (lines 104-107)...
        });
        this._eventListenerDisposables.push(textChange);

        const save = hub.onDidSaveTextDocument(({ document: doc }) => {
            // ...body unchanged (lines 113-115)...
        });
        this._eventListenerDisposables.push(save);

        const editorSwitch = hub.onDidChangeActiveTextEditor(({ editor }) => {
            // ...body unchanged (lines 121-133)...
        });
        this._eventListenerDisposables.push(editorSwitch);

        const diagnosticsChange = hub.onDidChangeDiagnostics(({ uris }) => {
            if (!recordingPhase()) { return; }
            for (const uri of uris) {
                if (!shouldRecordUri(uri, this._exerciseRootUri)) { continue; }
                this._deps.record(
                    collectDiagnostics(uri, hub.readDiagnostics(uri)),
                    {},
                    this._deps.state.currentGeneration,
                );
            }
        });
        this._eventListenerDisposables.push(diagnosticsChange);

        const windowFocus = hub.onDidChangeWindowState(({ state }) => {
            // ...body unchanged (lines 149-150)...
        });
        this._eventListenerDisposables.push(windowFocus);

        const selectionChange = hub.onDidChangeTextEditorSelection(({ event }) => {
            // ...body unchanged (lines 158-173, debounce + generation capture)...
        });
        this._eventListenerDisposables.push(selectionChange);

        const visibleRangeChange = hub.onDidChangeTextEditorVisibleRanges(({ event }) => {
            // ...body unchanged (lines 179-194)...
        });
        this._eventListenerDisposables.push(visibleRangeChange);

        const terminalOpen = hub.onDidOpenTerminal(({ terminal }) => {
            // ...body unchanged (lines 200-206)...
        });
        this._eventListenerDisposables.push(terminalOpen);

        const terminalClose = hub.onDidCloseTerminal(({ terminal }) => {
            // ...body unchanged (lines 211-217)...
        });
        this._eventListenerDisposables.push(terminalClose);

        const fileCreate = hub.onDidCreateFiles(({ files }) =>
            this._emitMultiFileEvent(files, 'fileCreate'));
        this._eventListenerDisposables.push(fileCreate);

        const fileDelete = hub.onDidDeleteFiles(({ files }) =>
            this._emitMultiFileEvent(files, 'fileDelete'));
        this._eventListenerDisposables.push(fileDelete);

        const fileRename = hub.onDidRenameFiles(({ files }) => {
            // ...body unchanged (lines 236-248), iterating `files`...
        });
        this._eventListenerDisposables.push(fileRename);

        const textDocumentOpen = hub.onDidOpenTextDocument(({ document: doc }) =>
            this._emitTextDocumentEvent(doc, 'textDocumentOpen'));
        this._eventListenerDisposables.push(textDocumentOpen);

        const textDocumentClose = hub.onDidCloseTextDocument(({ document: doc }) =>
            this._emitTextDocumentEvent(doc, 'textDocumentClose'));
        this._eventListenerDisposables.push(textDocumentClose);

        const debugStart = hub.onDidStartDebugSession(({ session }) =>
            this._recordDebugSession('started', session));
        this._eventListenerDisposables.push(debugStart);

        const debugTerminate = hub.onDidTerminateDebugSession(({ session }) =>
            this._recordDebugSession('terminated', session));
        this._eventListenerDisposables.push(debugTerminate);

        const debugActive = hub.onDidChangeActiveDebugSession(({ session }) =>
            this._recordDebugSession('activeChanged', session));
        this._eventListenerDisposables.push(debugActive);

        const breakpointChange = hub.onDidChangeBreakpoints(({ event }) => {
            this._emitBreakpointChange('added', event.added);
            this._emitBreakpointChange('removed', event.removed);
            this._emitBreakpointChange('changed', event.changed);
        });
        this._eventListenerDisposables.push(breakpointChange);

        // Capability gating happens inside the hub: on platforms without the
        // shell-execution API these channels simply never fire.
        this._terminalCollector.register(hub, this._eventListenerDisposables);
    }
```

CAUTION (debug sessions): `onDidStartDebugSession`/`onDidTerminateDebugSession` deliver a non-optional session; the hub signal types carry `session: vscode.DebugSession | undefined` only for `activeChanged`. The destructuring above is type-correct because `_recordDebugSession` already accepts `vscode.DebugSession | undefined`.

3. Update the class doc comment first paragraph to: "Owns the recorder's handler attachment to the SensorHub (the hub owns the actual VS Code subscriptions), plus the debounce state for selection/visibleRange events." Keep the rest.

- [ ] **Step 5.3: TerminalCollector consumes hub channels**

```typescript
// terminalCollector.ts — new signature + subscriptions; bodies unchanged
import type { SensorHub } from '@extension/services/sensing';

    register(hub: SensorHub, disposables: vscode.Disposable[]): void {
        const recordingPhase = (): boolean => this._deps.state.phase === 'recording';

        const shellExecStart = hub.onDidStartTerminalShellExecution(({ event }) => {
            // ...body unchanged (lines 47-54)...
        });
        disposables.push(shellExecStart);

        const shellExecEnd = hub.onDidEndTerminalShellExecution(({ event }) => {
            // ...body unchanged (lines 59-71)...
        });
        disposables.push(shellExecEnd);
    }
```

- [ ] **Step 5.4: SessionRecorder takes an optional hub and owns the default**

In `sessionRecorder.ts`:
1. Imports: `import { VsCodeSensorHub } from '@extension/services/sensing'; import type { SensorHub } from '@extension/services/sensing';`
2. Constructor: append a 5th parameter `sensorHub?: SensorHub`. First lines of the body:

```typescript
        this._sensorHub = sensorHub ?? new VsCodeSensorHub(capabilities);
        this._ownsHub = sensorHub === undefined;
```

with fields `private readonly _sensorHub: SensorHub;` and `private readonly _ownsHub: boolean;`.
3. Pass `hub: this._sensorHub` into the `ObservationRegistry` deps object and into the `StartupCapture` deps object (Step 5.5) and the `LifecycleController` deps object (Step 5.6); delete the `capabilities` entry from the ObservationRegistry deps.
4. In `shutdown()`, after the existing teardown completes, add:

```typescript
        if (this._ownsHub) {
            this._sensorHub.dispose();
        }
```

- [ ] **Step 5.5: StartupCapture reads via the hub**

Add `hub: SensorHub` to its deps interface, then replace the five reads:

```typescript
// line 86
        const allDiagnostics = this._deps.hub.readAllDiagnostics();
// line 92 — IMPORTANT: keep the fresh per-URI read at emit time. The bulk
// tuple from line 86 is only used for iteration and the emptiness check;
// today's code re-reads getDiagnostics(uri) inside collectDiagnostics, so:
                collectDiagnostics(uri, this._deps.hub.readDiagnostics(uri)),
// line 125
                    focused: this._deps.hub.readWindowFocused(),
// line 135
        for (const editor of this._deps.hub.readVisibleTextEditors()) {
// line 156
        const activeUri = this._deps.hub.readActiveTextEditor()?.document.uri;
// line 167
        for (const terminal of this._deps.hub.readTerminals()) {
```

- [ ] **Step 5.6: LifecycleController active-editor seed via the hub**

Add `hub: SensorHub` to `LifecycleControllerDeps`; replace line 412:

```typescript
        this._deps.observation.seedActiveEditor(this._deps.hub.readActiveTextEditor()?.document.uri.toString());
```

- [ ] **Step 5.7: Compile, run the recorder suites**

```bash
npm run compile-tests && npm run test:unit 2>&1 | tail -10
npm run test:recorder-e2e 2>&1 | tail -10
```

Expected: PASS with the same test counts as the Task 1 baseline (no assertion was touched). In particular `terminalShellExecution.test.ts` passes unchanged: it monkey-patches the shell-execution APIs after recorder construction and asserts listeners appear only after `enable()`; this holds because hub channels subscribe lazily (decision log #1a).

- [ ] **Step 5.8: Lint + commit**

```bash
npm run lint && npm run check-types
git add src/extension/services/telemetry/recording src/extension/services/sensing
git commit -m "refactor(recording): consume the sensor hub instead of subscribing to VS Code"
```

### Task 6: Targeted lifecycle tests (equivalence tier b)

**Files:**
- Test: `extension/test/unit/services/telemetry/recording/observationLifecycle.test.ts`

Driven through `TestSensorHub` injected into a real `SessionRecorder` (in-memory fs like `sessionRecorder.test.ts`). Stub all initial-state reads empty so startup emits only `windowFocus`.

- [ ] **Step 6.1: Write the tests (they must pass against the Task 5 code; if one fails, the refactor broke semantics — fix the refactor, not the test)**

```typescript
// extension/test/unit/services/telemetry/recording/observationLifecycle.test.ts
import * as vscode from 'vscode';
import * as assert from 'assert';

import { SessionRecorder } from '@extension/services/telemetry/recording/sessionRecorder';
import type { RecordingFs } from '@extension/services/telemetry/recording/storageWriter';
import { RecordingStorageWriter } from '@extension/services/telemetry/recording/storageWriter';
import type { RecordedEvent } from '@extension/services/telemetry/recording/types';
import type { SelectionSignal } from '@extension/services/sensing/types';

import { TestSensorHub } from '../../../../__shared__/testSensorHub';

class MemFs implements RecordingFs {
    appendedChunks: string[] = [];
    syncChunks: string[] = [];
    mkdir(): Promise<string | undefined> { return Promise.resolve(undefined); }
    writeFile(): Promise<void> { return Promise.resolve(); }
    appendFile(_p: string, data: string): Promise<void> { this.appendedChunks.push(data); return Promise.resolve(); }
    rm(): Promise<void> { return Promise.resolve(); }
    appendFileSync(_p: string, data: string): void { this.syncChunks.push(data); }
}

function writtenEvents(fs: MemFs): RecordedEvent[] {
    return [...fs.appendedChunks, ...fs.syncChunks]
        .flatMap(chunk => chunk.split('\n').filter(Boolean))
        .map(line => JSON.parse(line) as RecordedEvent);
}

function selectionSignal(path: string): SelectionSignal {
    const uri = vscode.Uri.file(path);
    const editor = {
        document: { uri },
        selections: [new vscode.Selection(0, 0, 0, 1)],
    } as unknown as vscode.TextEditor;
    return {
        ts: Date.now(),
        event: {
            textEditor: editor,
            kind: vscode.TextEditorSelectionChangeKind.Keyboard,
            selections: editor.selections,
        } as vscode.TextEditorSelectionChangeEvent,
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function makeRecorder(): { recorder: SessionRecorder; fs: MemFs; hub: TestSensorHub } {
    const fs = new MemFs();
    const writer = new RecordingStorageWriter('/fake-base', fs, 'test-version');
    const hub = new TestSensorHub();
    const recorder = new SessionRecorder(
        vscode.Uri.file('/fake-base'),
        { hasTerminalShellExecution: false, hasVscodeGitExtension: false },
        undefined,
        writer,
        hub,
    );
    return { recorder, fs, hub };
}

suite('Observation lifecycle via SensorHub (PR1 tier-b equivalence)', () => {
    test('selection bursts within the debounce window record exactly one event', async () => {
        const { recorder, fs, hub } = makeRecorder();
        recorder.enable();
        await recorder.startSession(1);

        hub.emit.selection.fire(selectionSignal('/w/F.java'));
        await sleep(50);
        hub.emit.selection.fire(selectionSignal('/w/F.java'));
        await sleep(300); // > 200ms debounce
        await recorder.endSession();

        const selections = writtenEvents(fs).filter(e => e.type === 'selectionChange');
        assert.strictEqual(selections.length, 1);
        await recorder.shutdown();
    });

    test('consent downgrade discards buffered debounce payloads', async () => {
        const { recorder, fs, hub } = makeRecorder();
        recorder.enable();
        await recorder.startSession(1);

        hub.emit.selection.fire(selectionSignal('/w/F.java'));
        recorder.disable(); // GDPR path: pending payload must never hit disk
        await sleep(300);
        await recorder.shutdown();

        const selections = writtenEvents(fs).filter(e => e.type === 'selectionChange');
        assert.strictEqual(selections.length, 0);
    });

    test('session end flushes the pending payload into the ending session', async () => {
        const { recorder, fs, hub } = makeRecorder();
        recorder.enable();
        await recorder.startSession(1);

        hub.emit.selection.fire(selectionSignal('/w/F.java'));
        await recorder.endSession(); // flushDebouncesForEnd, no 200ms wait

        const events = writtenEvents(fs);
        const selIdx = events.findIndex(e => e.type === 'selectionChange');
        const endIdx = events.findIndex(e => e.type === 'sessionEnd');
        assert.ok(selIdx !== -1, 'flushed selection must be recorded');
        assert.ok(endIdx > selIdx, 'sessionEnd must come after the flushed payload');
        await recorder.shutdown();
    });

    test('debounce payload from session A never leaks into session B (generation token)', async () => {
        const { recorder, fs, hub } = makeRecorder();
        recorder.enable();
        await recorder.startSession(1);
        hub.emit.selection.fire(selectionSignal('/w/F.java'));
        await recorder.endSession();   // flushes into session A
        await recorder.startSession(2);
        await sleep(300);              // stale timer (if any) would fire here
        await recorder.endSession();
        await recorder.shutdown();

        const events = writtenEvents(fs);
        const secondStart = events.findIndex(
            e => e.type === 'sessionStart' && (e as { exerciseId?: number }).exerciseId === 2,
        );
        const leaked = events.slice(secondStart).filter(e => e.type === 'selectionChange');
        assert.strictEqual(leaked.length, 0);
    });
});
```

- [ ] **Step 6.2: Run, expect pass**

```bash
npm run compile-tests && npm run test:unit 2>&1 | tail -10
```

If a test fails, the Task 5 rewiring changed semantics. Debug the refactor (compare with the base-branch behavior); do NOT weaken the test.

- [ ] **Step 6.3: Lint + commit**

```bash
npm run lint
git add test/unit/services/telemetry/recording/observationLifecycle.test.ts
git commit -m "test(recording): lifecycle equivalence tests driven through the sensor hub"
```

### Task 7: EQ pipeline split + TelemetryManager + v1 services onto the hub

**Files:**
- Modify: `extension/src/extension/services/telemetry/eventPipeline/compileEquivalentEmitter.ts`
- Modify: `extension/src/extension/services/telemetry/telemetryManager.ts`
- Modify: `extension/src/extension/services/telemetry/inactivityService.ts:45-95`
- Modify: `extension/src/extension/services/telemetry/diagnosticPersistenceService.ts:23-96,154-171`
- Test: `extension/test/unit/services/telemetry/eqSettlePath.test.ts` (new)

- [ ] **Step 7.1: Write the failing test**

```typescript
// extension/test/unit/services/telemetry/eqSettlePath.test.ts
import * as vscode from 'vscode';
import * as assert from 'assert';

import { nextSensorSeq } from '@extension/services/sensing/sequence';
import { TelemetryManager } from '@extension/services/telemetry/telemetryManager';

import { TestSensorHub } from '../../../__shared__/testSensorHub';

function errorEntry(path: string, message: string): [vscode.Uri, vscode.Diagnostic[]] {
    const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), message, vscode.DiagnosticSeverity.Error);
    diag.source = 'java';
    diag.code = 'E001';
    return [vscode.Uri.file(path), [diag]];
}

suite('EQ settle path via SensorHub', () => {
    test('a settled diagnostics dump produces one EQ snapshot with source=save', () => {
        const hub = new TestSensorHub();
        const tm = new TelemetryManager(undefined, hub);
        const calculated: { source: string }[] = [];
        tm.onDidCalculateEQ(e => calculated.push(e));
        tm.startExerciseSession(1);

        hub.emit.diagnosticsSettled.fire({
            ts: Date.now(),
            savedSeq: nextSensorSeq(), // save AFTER session start: must be processed
            entries: [errorEntry('/w/A.java', 'boom')],
        });
        assert.strictEqual(calculated.length, 1);
        assert.strictEqual(calculated[0].source, 'save');

        // Identical dump inside the dedup window: no second snapshot.
        hub.emit.diagnosticsSettled.fire({
            ts: Date.now(),
            savedSeq: nextSensorSeq(),
            entries: [errorEntry('/w/A.java', 'boom')],
        });
        assert.strictEqual(calculated.length, 1);

        tm.dispose();
        hub.dispose();
    });

    test('a settle whose save predates the session start is dropped (cross-session guard)', () => {
        const hub = new TestSensorHub();
        const tm = new TelemetryManager(undefined, hub);
        const calculated: unknown[] = [];
        tm.onDidCalculateEQ(e => calculated.push(e));

        const staleSaveSeq = nextSensorSeq(); // save happened, THEN the session switched
        tm.startExerciseSession(1);           // draws a later token internally
        hub.emit.diagnosticsSettled.fire({
            ts: Date.now(),
            savedSeq: staleSaveSeq,
            entries: [errorEntry('/w/A.java', 'boom')],
        });
        assert.strictEqual(calculated.length, 0, 'stale settle must not leak into the new session');

        tm.dispose();
        hub.dispose();
    });
});
```

- [ ] **Step 7.2: Run to verify it fails** (compile error: TelemetryManager has no 2nd parameter)

- [ ] **Step 7.3: Split CompileEquivalentEmitter**

In `compileEquivalentEmitter.ts`:
1. DELETE: `LS_SETTLE_DELAY_MS`, the `_saveTimeout` field, `handleSaveEvent()` entirely, and the timer-clearing branches in `dispose()` and `reset()`.
2. REPLACE `createErrorSnapshotFromDiagnostics` with the parameterized version (no `vscode.languages` call):

```typescript
    /**
     * Create an ErrorSnapshot from a settled diagnostics dump (sensor event).
     * Filters to exercise files, severity=Error, and excludes lint sources.
     */
    public createErrorSnapshotFromDiagnostics(
        entries: ReadonlyArray<[vscode.Uri, vscode.Diagnostic[]]>,
        timestamp: number,
    ): ErrorSnapshot {
        const errorFamilies = new Set<string>();
        let errorCount = 0;

        for (const [uri, diagnostics] of entries) {
            if (!shouldRecordUri(uri, this._exerciseRoot)) {
                continue;
            }
            for (const d of diagnostics) {
                if (isCompilerDiagnostic(d)) {
                    errorFamilies.add(getErrorFamily(d));
                    errorCount++;
                }
            }
        }

        return { timestamp, hasErrors: errorCount > 0, errorFamilies, errorCount };
    }
```

3. ADD the settle entry point (the new public API replacing `handleSaveEvent`):

```typescript
    /**
     * Handle a settled diagnostics dump from the sensing layer (save-triggered,
     * 500 ms LS settle; see sensing/collectors/diagnosticsSettle.ts). Fires
     * onDidEmitCompileEquivalent when the snapshot is novel.
     */
    public handleDiagnosticsSettled(signal: DiagnosticsSettledSignal): void {
        if (signal.savedSeq < this._sessionStartSeq) {
            // The triggering save belongs to the previous session; v1 cleared
            // its pending save timer at this boundary (decision log #1b).
            return;
        }
        const snapshot = this.createErrorSnapshotFromDiagnostics(signal.entries, signal.ts);
        if (!this._shouldAddSnapshot(snapshot)) {
            return;
        }
        this._lastSnapshot = snapshot;
        this._onDidEmitCompileEquivalent.fire({
            timestamp: snapshot.timestamp,
            source: 'save',
            snapshot,
        });
    }
```

with `import type { DiagnosticsSettledSignal } from '@extension/services/sensing';`.

4. ADD the cross-session guard state: field `private _sessionStartSeq = 0;`, import `nextSensorSeq` from `@extension/services/sensing`, and extend `onSessionStart` (currently `reset()` + `setExerciseRoot`):

```typescript
    public onSessionStart(context: SessionStartContext): void {
        this.reset();
        this.setExerciseRoot(context.exerciseRoot);
        this._sessionStartSeq = nextSensorSeq();
    }
```

This replaces the v1 behavior where `reset()` cleared the pending `_saveTimeout` at every session boundary: the hub-owned settle timer cannot be cleared per consumer, so the emitter drops stale settles via `savedSeq` instead. Same observable behavior (no save snapshot from session A can leak into session B), enforced by the Step 7.1 cross-session test.

- [ ] **Step 7.4: TelemetryManager onto the hub**

1. Constructor signature: `constructor(exerciseRegistry?: ExerciseRegistry, sensorHub?: SensorHub)`. Body start:

```typescript
        this._sensorHub = sensorHub ?? new VsCodeSensorHub();
        this._ownsHub = sensorHub === undefined;
```

(fields `private readonly _sensorHub: SensorHub; private readonly _ownsHub: boolean;`; imports `import { VsCodeSensorHub } from '@extension/services/sensing'; import type { SensorHub } from '@extension/services/sensing';`). Note in a comment: production injects the shared hub from extension.ts; the default exists for tests and is desktop-only (no capability gating).
2. Pass the hub to the v1 services: `new DiagnosticPersistenceService(this._sensorHub)` and `new InactivityService(this._sensorHub)`.
3. In `_setupEventHandlers()` replace the four direct subscriptions (lines 302-323 and 381-386):

```typescript
        // Settled diagnostics (save + 500ms LS settle) → CompileEquivalentEmitter.
        // Note: the isEnabled gate moved from save-time to settle-time (PR1
        // decision log #5) — only observable when the setting flips inside
        // the 500 ms settle window.
        const settleListener = this._sensorHub.onDiagnosticsSettled(signal => {
            if (this._isEnabled) {
                this._compileEmitter.handleDiagnosticsSettled(signal);
            }
        });
        this._disposables.push(settleListener);

        // Text change → BoundaryTriggerEmitter (paste detection)
        const changeListener = this._sensorHub.onDidChangeTextDocument(({ event }) => {
            if (this._isEnabled) {
                this._triggerEmitter.handleTextDocumentChange(event);
            }
        });
        this._disposables.push(changeListener);

        // Selection change → BoundaryTriggerEmitter (selection-maintained)
        const selectionListener = this._sensorHub.onDidChangeTextEditorSelection(({ event }) => {
            if (this._isEnabled) {
                this._triggerEmitter.handleSelectionChange(event);
            }
        });
        this._disposables.push(selectionListener);
```

and at lines 381-386:

```typescript
        const windowStateListener = this._sensorHub.onDidChangeWindowState(({ state }) => {
            if (state.focused && this._activeExerciseId !== undefined) {
                this._log('Window regained focus with active exercise session');
            }
        });
        this._disposables.push(windowStateListener);
```

4. In `dispose()`, after the `_disposables` drain loop:

```typescript
        if (this._ownsHub) {
            this._sensorHub.dispose();
        }
```

5. The `onDidChangeConfiguration` listener at line 154 stays (decision log #4).

- [ ] **Step 7.5: InactivityService onto the hub**

Constructor becomes optional-owned-default (five direct `new InactivityService()` sites exist in `boundaryTriggerAndCadence.test.ts` and must keep compiling unchanged):

```typescript
    constructor(sensorHub?: SensorHub) {
        this._hub = sensorHub ?? new VsCodeSensorHub();
        this._ownsHub = sensorHub === undefined;
        this._startTracking(this._hub);
        this._startPatternCheck();
    }
```

with fields `private readonly _hub: SensorHub; private readonly _ownsHub: boolean;` and, in `dispose()` after the existing teardown, `if (this._ownsHub) { this._hub.dispose(); }`. `_startTracking` replaces the three subscriptions, bodies unchanged:

```typescript
    private _startTracking(hub: SensorHub): void {
        this._disposables.push(hub.onDidChangeTextDocument(({ event }) => {
            if (event.document.uri.scheme !== 'file' || event.contentChanges.length === 0) {
                return;
            }
            this._recordActivity();
        }));
        this._disposables.push(hub.onDidSaveTextDocument(({ document }) => {
            if (document.uri.scheme === 'file') {
                this._recordActivity();
            }
        }));
        this._disposables.push(hub.onDidChangeTextEditorSelection(({ event }) => {
            if (event.textEditor.document.uri.scheme === 'file') {
                this._recordWeakActivity();
            }
        }));
    }
```

- [ ] **Step 7.6: DiagnosticPersistenceService onto the hub**

Same optional-owned-default pattern: `constructor(sensorHub?: SensorHub)` with `this._hub = sensorHub ?? new VsCodeSensorHub(); this._ownsHub = sensorHub === undefined;` (fields as in 7.5) and hub disposal in `dispose()` when owned. Then replace:
- line 55-57: `const diagnosticListener = this._hub.onDidChangeDiagnostics(({ uris }) => { this._handleDiagnosticChange(uris); });`
- `_handleDiagnosticChange(uris: readonly vscode.Uri[])` (signature change), inner read: `const diagnostics = this._hub.readDiagnostics(uri);`, and pass `uris` to `_markMissingDiagnosticsResolved(uris)`.
- line 77: `const allDiagnostics = this._hub.readAllDiagnostics();`
- line 161: `const currentDiagnostics = this._hub.readDiagnostics(uri);`

- [ ] **Step 7.7: Run all suites + the sensing-invariant grep**

```bash
npm run compile-tests && npm run test:unit 2>&1 | tail -10
npm run test:struggle 2>&1 | tail -10
grep -rn "vscode\.\(workspace\|window\|languages\|debug\)\.onDid\|vscode\.languages\.getDiagnostics\|vscode\.window\.state\|vscode\.window\.visibleTextEditors\|vscode\.window\.activeTextEditor\|vscode\.window\.terminals\|vscode\.debug\.breakpoints" src/extension/services/telemetry src/extension/services/sensing
```

Expected: tests PASS (incl. the Task 7.1 test); the grep lists ONLY `src/extension/services/sensing/sensorHub.ts` lines plus the allowed `telemetryManager.ts` `onDidChangeConfiguration` line.

- [ ] **Step 7.8: Lint + commit**

```bash
npm run lint && npm run check-types
git add src/extension/services/telemetry test/unit/services/telemetry/eqSettlePath.test.ts
git commit -m "refactor(telemetry): EQ pipeline and v1 services consume the sensor hub"
```

### Task 8: Production wiring + clean-bundle proof

**Files:**
- Modify: `extension/src/extension.ts` (around lines 44, 66)
- Modify: `extension/src/extension/dataCollection/types.ts`
- Modify: `extension/src/extension/dataCollection/index.ts`
- Modify: `extension/src/extension/activation/sessionRecorderWiring.ts`
- Modify: `extension/test/unit/activation/sessionRecorderWiring.test.ts` (construction site only)

- [ ] **Step 8.1: extension.ts creates the single hub**

After `const capabilities = detectPlatformCapabilities();` (line 44) is in scope and before the `TelemetryManager` construction (line 66), insert:

```typescript
	const sensorHub = new VsCodeSensorHub(capabilities);
	context.subscriptions.push(sensorHub);
```

and change line 66 to:

```typescript
	const telemetryManager = new TelemetryManager(exerciseRegistry, sensorHub);
```

Then locate the `wireDataCollection(` call in extension.ts (single call site, `grep -n "wireDataCollection(" src/extension.ts`) and add `sensorHub,` to its deps object.

- [ ] **Step 8.2: Thread through the data-collection seam**

`dataCollection/types.ts`: add to `DataCollectionDeps`:

```typescript
    sensorHub: SensorHub;
```

with `import type { SensorHub } from '@extension/services/sensing';` (type-only import: the noop bundle must not pull in sensing-consumer code; sensing itself is in both variants).

`dataCollection/index.ts`: pass `sensorHub: deps.sensorHub` into the `wireSessionRecorder({...})` call. `noop.ts` needs no change (it ignores deps).

`sessionRecorderWiring.ts`: add `sensorHub: SensorHub;` to `RecorderWiringDeps`, destructure it, and construct:

```typescript
    const sessionRecorder = new SessionRecorderImpl(
        context.globalStorageUri, capabilities, exerciseRegistry, undefined, sensorHub,
    );
```

Also `grep -n "vscode.debug.breakpoints\|vscode.window.\|vscode.languages." src/extension/activation/sessionRecorderWiring.ts` and replace any behavioral-state read with the matching `sensorHub.read*()` call (the startup breakpoint contributor reads `vscode.debug.breakpoints` → `sensorHub.readBreakpoints()`).

- [ ] **Step 8.3: Update the wiring test construction site**

In `sessionRecorderWiring.test.ts` (line ~235 area), add `sensorHub: new TestSensorHub()` (import from `test/__shared__/testSensorHub`) to the deps object passed to `wireSessionRecorder`. Assertions stay untouched.

- [ ] **Step 8.4: Full check incl. clean bundle**

```bash
npm run check-types && npm run lint
npm run compile-tests && npm run test:unit 2>&1 | tail -8
node esbuild.js --production --variant=openvsx && node scripts/verify-clean-bundle.js
```

Expected: everything green; verify-clean-bundle confirms the openvsx bundle contains no recorder/consent code (sensing IS allowed in the clean bundle; recording/* must stay out).

- [ ] **Step 8.5: Commit**

```bash
git add src/extension.ts src/extension/dataCollection src/extension/activation/sessionRecorderWiring.ts test/unit/activation/sessionRecorderWiring.test.ts
git commit -m "refactor(activation): wire the single sensor hub through telemetry and recording"
```

### Task 9: Branch-convention note + CHANGELOG

- [ ] **Step 9.1: `.claude/CLAUDE.md` branching note**

Append to the Branching section:

```markdown
- **Temporary (struggle engine v2):** work happens on the integration branch
  `feat/struggle-engine-v2`. Its PRs branch off and merge back into that branch,
  NOT into `dev`. The final merge into `dev` is a separate manual decision.
```

- [ ] **Step 9.2: CHANGELOG entry** (follow the existing Unreleased/Added-Changed format at the top of `CHANGELOG.md`)

```markdown
- refactor(sensing): single `SensorHub` now owns all VS Code event subscriptions
  and state reads for telemetry; session recorder, EQ pipeline and inactivity/
  diagnostics services consume hub channels. No behavior change; recordings stay
  schema-v2 identical.
```

- [ ] **Step 9.3: Commit**

```bash
git -C /Users/liamberger/Documents/private/MA/artemis-extension add .claude/CLAUDE.md CHANGELOG.md
git -C /Users/liamberger/Documents/private/MA/artemis-extension commit -m "docs: integration-branch note and sensing refactor changelog"
```

### Task 10: Final verification, AFTER capture, PR

- [ ] **Step 10.1: Full gate**

```bash
npm run compile-tests && npm run lint && npm run check-types
npm run test:unit 2>&1 | tail -5
npm run test:struggle 2>&1 | tail -5
npm run test:recorder-e2e 2>&1 | tail -5
npm run test:react 2>&1 | tail -5
```

Expected: all PASS. NEVER skip a failing test.

- [ ] **Step 10.2 [MANUAL, Liam + assistant]: AFTER capture + field diff (equivalence tier c)**

Repeat the exact Task 1.3 script on this branch; copy the recording to `/tmp/recording-after/`. Then compare structure (timestamps normalized away):

```bash
node -e '
const fs = require("fs");
const load = p => fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map(JSON.parse);
const strip = e => { const { timestamp, ...rest } = e; return rest; };
const a = load(process.argv[1]).map(strip);
const b = load(process.argv[2]).map(strip);
console.log("events before:", a.length, "after:", b.length);
const seq = x => x.map(e => e.type).join(",");
console.log(seq(a) === seq(b) ? "type sequence identical" : "TYPE SEQUENCE DIFFERS — inspect manually");
' /tmp/recording-before/events.jsonl /tmp/recording-after/events.jsonl
```

Two human-driven sessions are never byte-identical; judge per scripted action: every action must produce the same event types with the same non-timestamp fields. Do NOT normalize ordering or debounce-relative structure (spec section 10). Document the verdict in the PR description.

- [ ] **Step 10.3: Push + PR**

```bash
git push -u origin refactor/sensing-layer
gh pr create --base feat/struggle-engine-v2 --title "refactor(sensing): single sensor hub for recorder and EQ pipeline" --body "<summary of the four equivalence tiers and their results>"
```

PR body: summarize scope (one sensing layer, policy unchanged), the three automated equivalence tiers (unchanged suites, lifecycle tests, clean bundle) and the manual before/after diff verdict. Plain engineering prose.

---

## Self-Review Notes

- Type consistency: `SensorHub` interface name is used by every consumer; `VsCodeSensorHub` only in extension.ts, default params and hub tests. `collectDiagnostics(uri, diagnostics)` updated at exactly its two call sites.
- Two v1 semantics are preserved by dedicated mechanisms, not by accident: enable-scoped VS Code listeners (lazy relays, decision log #1a; asserted by the untouched `terminalShellExecution.test.ts`) and the session-boundary clearing of the pending save timer (`savedSeq` ordering-token guard, decision log #1b; asserted by the new cross-session test in Step 7.1). The token is a counter, not a timestamp, so a save and a session switch within the same millisecond are still strictly ordered.
- Startup diagnostics keep today's fresh per-URI read at emit time (Step 5.5); the bulk dump is only the iteration source, exactly as on the base branch.
- The plan deliberately shows handler bodies as "unchanged (lines X-Y)" references into the CURRENT file state at branch point `feat/struggle-engine-v2` (commit `da56ebd5`): the refactor moves subscriptions, never bodies. Executors: copy the referenced body verbatim; if a referenced line range does not match, STOP (base branch drifted).
- Out of scope (lands in PR 2): hub channels for buildResult (stays a websocket handler behind `buildResultGuard` in both consumers) and taskFeedbackView; removal of the v1 decision path.

