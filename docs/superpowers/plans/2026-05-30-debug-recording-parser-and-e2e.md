# Debug-Recording: Parser-Vervollständigung, Compile-Guard & Breakpoint-E2E

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the parser round-trip gap that PR #233 left for the two debug-recording event types, make that class of gap a compile error, and add real end-to-end coverage for breakpoint recording.

**Architecture:** PR #233 added `debugSession` + `breakpointChange` to the `RecordedEvent` union, the collectors, the listeners and the viewer, but never added the matching validators in `parseRecordedData.ts` (whose `default: return null` silently drops them — the only prod consumer, `replayCommand.ts`, discards them). We (1) add the two validators, (2) replace the prose-only "remember to add a case" affordance with a `satisfies Record<RecordedEvent['type'], EventParser>` dispatch table so a missing validator is a TYPE ERROR, (3) sync the `validate-recording` CLI's known-types list, and (4) add an e2e test that drives the **real** `vscode.debug` API through the **real** recorder pipeline (the listener path that white-box injection cannot reach).

**Tech Stack:** TypeScript, VS Code extension API (`vscode.debug`), Mocha + `@vscode/test-electron` (labels `unit` + `recorder-e2e`), `mocha-junit-reporter` (results in `reports/mocha-results.xml`, NOT stdout).

---

## Context the implementer must know

- **Working dir:** `/Users/liamberger/Documents/private/MA/artemis-extension/extension` for all extension commands.
- **Branch:** `feat/debug-recording` (PR #233, base `dev`). This work extends that PR. Do NOT branch off main.
- **Test results are in XML, not stdout.** After `npm run test:unit`, read `reports/mocha-results.xml` for the authoritative pass/fail (the junit reporter writes there; stdout can show a misleading unrelated stack). Pipe stdout to a temp file with `tee` and clean it up afterwards.
- **Parser idiom (mirror exactly):** each per-variant parser has signature `(d: Record<string, unknown>, timestamp: number) => SomeEvent | null`, validates each field with the primitive guards (`isString`, `isBoolean`, `isFiniteNumber`, `isOneOf`, `isStringOrUndefined`), builds the typed object, and runs optional-bearing results through `stripUndefined(...)` so the output round-trips against the on-disk JSONL (which omits `undefined` keys). `isStringOrUndefined` is a real type guard (narrows); `isOptString` only returns `boolean`.
- **Array sub-shapes** get their own `parseX(data: unknown): X | null` helper that the variant parser loops over, bailing to `null` on the first bad entry (see `parseSerializedDiagnostic` / `parseDiagnostics`).
- **Empty arrays are accepted** by the existing array parsers (`parseSelectionChange`, `parseDiagnostics` have no length check). Match that — do NOT add a non-empty constraint to `breakpoints`.
- **Field shapes** (from `recording/types.ts`):
  - `DebugSessionEvent`: `type:'debugSession'`, `timestamp`, `action: 'started'|'terminated'|'activeChanged'`, optional `sessionId`, `sessionName`, `sessionType`, `parentSessionId` (all `string`).
  - `BreakpointChangeEvent`: `type:'breakpointChange'`, `timestamp`, `action: 'added'|'removed'|'changed'`, `breakpoints: { id:string; uri:string; line:number; column:number; enabled:boolean; condition?:string; hitCondition?:string; logMessage?:string }[]`.
- **The collector never emits an empty `breakpoints` array or out-of-root breakpoints** (`_emitBreakpointChange` returns early when the in-root filter leaves nothing). So on disk every `breakpointChange` has ≥1 in-root breakpoint — but the parser must still accept any type-valid shape.
- **e2e self-containment:** `recording.e2e.test.ts` instantiates `new SessionRecorder(storageUri)` directly and calls `recorder.enable()`. The `observationRegistry` listeners (incl. the new `onDidChangeBreakpoints` listener) ARE active after `enable()`. The breakpoint **startup snapshot**, however, is an external startup contributor registered in `sessionRecorderWiring.ts` (NOT inside the recorder), so the e2e must register an equivalent contributor itself to exercise that path.
- **`vscode.debug.breakpoints` is global + persistent** across the test host. Clear it defensively at the start and end of each new test: `vscode.debug.removeBreakpoints([...vscode.debug.breakpoints])`.
- **Shared-global / consent assumption (verified):** the activated extension registers its OWN breakpoint listener and startup-snapshot contributor via `sessionRecorderWiring.ts`. In a fresh `@vscode/test-electron` host, consent is pending/declined, so that recorder is NOT enabled and it writes to `context.globalStorageUri` (a different dir than the test's `mkdtemp` storage). So the shared `vscode.debug.breakpoints` global is safe to clear and cannot contaminate (or be contaminated by) these tests. These tests therefore assume the production recorder stays disabled in the host — true today; if a future test opened a workspace with extended consent, the defensive `removeBreakpoints([...])` would also wipe the production session's breakpoints.
- **Production breakpoint startup contributor location:** `extension/src/extension/activation/sessionRecorderWiring.ts` (registration at lines ~212-216). The Task 4 contributor lambda is a faithful copy of it.

---

### Task 1: Add the two validators and replace the switch with a compile-enforced dispatch table

**Files:**
- Modify: `extension/src/extension/services/telemetry/recording/parseRecordedData.ts`
- Test: `extension/test/unit/services/telemetry/recording/parseRecordedData.test.ts`

- [ ] **Step 1: Write the failing round-trip + rejection tests**

Add these tests to `parseRecordedData.test.ts`. Put the happy-path cases inside the existing `suite('parseRecordedEvent — per-variant happy path', ...)` (after the last `test(...)` in it) and the rejection cases in a new suite at the end of the file.

ALSO add this dispatcher-level test to the EXISTING `suite('parseRecordedEvent — dispatcher-level rejection', ...)` (right after the `'unknown type literal returns null'` test) — it locks in the prototype-safety fix from Step 5 and would have caught the regression the review found:

```ts
    test('prototype-named type literals return null (no Object.prototype leakage)', () => {
        for (const t of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', '__proto__']) {
            assert.strictEqual(parseRecordedEvent({ type: t, timestamp: ts }), null, `type '${t}' must parse to null`);
        }
    });
```

```ts
    // ── debugSession ───────────────────────────────────────────────────
    test('debugSession — started with all session fields', () => {
        const e: RecordedEvent = {
            type: 'debugSession', timestamp: ts, action: 'started',
            sessionId: 's1', sessionName: 'Launch', sessionType: 'java', parentSessionId: 'p0',
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('debugSession — activeChanged with no session fields', () => {
        const e: RecordedEvent = { type: 'debugSession', timestamp: ts, action: 'activeChanged' };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    // ── breakpointChange ───────────────────────────────────────────────
    test('breakpointChange — added with full breakpoint payload', () => {
        const e: RecordedEvent = {
            type: 'breakpointChange', timestamp: ts, action: 'added',
            breakpoints: [{
                id: 'b1', uri: 'file:///workspace/ex1/Main.java', line: 9, column: 4,
                enabled: true, condition: 'x > 0', hitCondition: '>= 3', logMessage: 'hit',
            }],
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('breakpointChange — removed with minimal breakpoint (no optionals)', () => {
        const e: RecordedEvent = {
            type: 'breakpointChange', timestamp: ts, action: 'removed',
            breakpoints: [{ id: 'b1', uri: 'file:///workspace/ex1/Main.java', line: 0, column: 0, enabled: false }],
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('breakpointChange — empty breakpoints array is accepted (matches other array parsers)', () => {
        const e: RecordedEvent = { type: 'breakpointChange', timestamp: ts, action: 'changed', breakpoints: [] };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });
```

And the rejection suite (append at end of file):

```ts
suite('parseRecordedEvent — debug/breakpoint per-variant rejection', () => {
    test('debugSession rejects an invalid action', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'debugSession', timestamp: ts, action: 'paused' }), null);
    });
    test('debugSession rejects a missing action', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'debugSession', timestamp: ts }), null);
    });
    test('debugSession rejects a non-string sessionId', () => {
        assert.strictEqual(
            parseRecordedEvent({ type: 'debugSession', timestamp: ts, action: 'started', sessionId: 42 }),
            null,
        );
    });
    test('breakpointChange rejects an invalid action', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'breakpointChange', timestamp: ts, action: 'moved', breakpoints: [] }), null);
    });
    test('breakpointChange rejects a missing action', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'breakpointChange', timestamp: ts, breakpoints: [] }), null);
    });
    test('breakpointChange rejects a non-array breakpoints', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'breakpointChange', timestamp: ts, action: 'added', breakpoints: {} }), null);
    });
    test('breakpointChange rejects a breakpoint missing a required field', () => {
        assert.strictEqual(
            parseRecordedEvent({
                type: 'breakpointChange', timestamp: ts, action: 'added',
                breakpoints: [{ id: 'b1', uri: 'file:///x', line: 1 /* column missing */, enabled: true }],
            }),
            null,
        );
    });
    test('breakpointChange rejects a breakpoint with a wrong-typed optional', () => {
        assert.strictEqual(
            parseRecordedEvent({
                type: 'breakpointChange', timestamp: ts, action: 'added',
                breakpoints: [{ id: 'b1', uri: 'file:///x', line: 1, column: 0, enabled: true, condition: 5 }],
            }),
            null,
        );
    });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm run compile-tests && npx vscode-test --label unit 2>&1 | tee /tmp/dbg_parser_test.txt | tail -20`
Expected: the new `debugSession` / `breakpointChange` happy-path tests FAIL (`parseRecordedEvent` returns `null` → `deepStrictEqual` mismatch), because the dispatcher's `default` branch rejects these types. The rejection tests AND the new prototype-named-type test already PASS — `null` is the current behaviour (the prototype test is a green-now guard for the Step 5 refactor, not a red-now test). Confirm by reading `reports/mocha-results.xml`. Clean up: `rm /tmp/dbg_parser_test.txt`.

- [ ] **Step 3: Add the type imports**

In `parseRecordedData.ts`, add `BreakpointChangeEvent,` and `DebugSessionEvent,` to the `import type { ... } from './types';` block, placed as shown below. Exact position is not load-bearing (tsc ignores import order; the `simple-import-sort` lint rule will reorder if needed), so just keep it tidy: `BreakpointChangeEvent` before `BuildResultEvent`, and `DebugSessionEvent` before `DiagnosticsEvent`.

```ts
    BreakpointChangeEvent,
    BuildResultEvent,
```
```ts
    DebugSessionEvent,
    DiagnosticsEvent,
```

- [ ] **Step 4: Implement the two validators**

Add these to `parseRecordedData.ts` in the "Per-variant parsers" section, immediately AFTER `parseTaskFeedbackView` (i.e. just before the `// ── Public dispatcher ──` banner):

```ts
function parseDebugSession(d: Record<string, unknown>, timestamp: number): DebugSessionEvent | null {
    if (!isOneOf(d.action, ['started', 'terminated', 'activeChanged'] as const)) { return null; }
    if (!isStringOrUndefined(d.sessionId) || !isStringOrUndefined(d.sessionName)
        || !isStringOrUndefined(d.sessionType) || !isStringOrUndefined(d.parentSessionId)) {
        return null;
    }
    return stripUndefined({
        type: 'debugSession' as const,
        timestamp,
        action: d.action,
        sessionId: d.sessionId,
        sessionName: d.sessionName,
        sessionType: d.sessionType,
        parentSessionId: d.parentSessionId,
    });
}

function parseRecordedBreakpoint(data: unknown): BreakpointChangeEvent['breakpoints'][number] | null {
    if (!isObject(data)) { return null; }
    if (!isString(data.id) || !isString(data.uri)) { return null; }
    if (!isFiniteNumber(data.line) || !isFiniteNumber(data.column)) { return null; }
    if (!isBoolean(data.enabled)) { return null; }
    if (!isStringOrUndefined(data.condition) || !isStringOrUndefined(data.hitCondition)
        || !isStringOrUndefined(data.logMessage)) {
        return null;
    }
    return stripUndefined({
        id: data.id,
        uri: data.uri,
        line: data.line,
        column: data.column,
        enabled: data.enabled,
        condition: data.condition,
        hitCondition: data.hitCondition,
        logMessage: data.logMessage,
    });
}

function parseBreakpointChange(d: Record<string, unknown>, timestamp: number): BreakpointChangeEvent | null {
    if (!isOneOf(d.action, ['added', 'removed', 'changed'] as const)) { return null; }
    if (!Array.isArray(d.breakpoints)) { return null; }
    const breakpoints: BreakpointChangeEvent['breakpoints'] = [];
    for (const raw of d.breakpoints) {
        const parsed = parseRecordedBreakpoint(raw);
        if (!parsed) { return null; }
        breakpoints.push(parsed);
    }
    return { type: 'breakpointChange', timestamp, action: d.action, breakpoints };
}
```

- [ ] **Step 5: Replace the `switch` dispatcher with the compile-enforced table**

Replace the existing `parseRecordedEvent` function (the `switch (data.type) { ... default: return null; }` body, currently ~lines 604-644) AND its doc comment with:

```ts
type EventParser = (d: Record<string, unknown>, timestamp: number) => RecordedEvent | null;

/**
 * Dispatch table from every `RecordedEvent['type']` literal to its validator.
 *
 * The `satisfies Record<RecordedEvent['type'], EventParser>` clause makes the
 * table EXHAUSTIVE at compile time: adding a variant to the `RecordedEvent`
 * union without registering a parser here is a TYPE ERROR (missing key), and a
 * typo'd key that is not a real event type is also a TYPE ERROR (excess key).
 * This replaces the previous prose-only "remember to add a case" affordance —
 * which silently failed for `debugSession` / `breakpointChange` in PR #233,
 * letting them land on disk with no validator.
 */
const EVENT_PARSERS = {
    textChange: parseTextChange,
    save: parseSave,
    fileSwitch: parseFileSwitch,
    diagnostics: parseDiagnostics,
    buildResult: parseBuildResult,
    windowFocus: parseWindowFocus,
    fileSnapshot: parseFileSnapshot,
    sessionStart: parseSessionStart,
    sessionEnd: parseSessionEnd,
    consentChange: parseConsentChange,
    startupPhaseComplete: parseStartupPhaseComplete,
    configurationSnapshot: parseConfigurationSnapshot,
    configurationChange: parseConfigurationChange,
    irisChatMessage: parseIrisChatMessage,
    irisChatSendAttempt: parseIrisChatSendAttempt,
    irisChatFeedback: parseIrisChatFeedback,
    eqSnapshot: parseEqSnapshot,
    eqEngineState: parseEqEngineState,
    intervention: parseIntervention,
    viewNavigation: parseViewNavigation,
    panelVisibility: parsePanelVisibility,
    selectionChange: parseSelectionChange,
    visibleRangeChange: parseVisibleRangeChange,
    terminalCommand: parseTerminalCommand,
    terminalOpenClose: parseTerminalOpenClose,
    fileSnapshotError: parseFileSnapshotError,
    fileCreate: parseFileCreate,
    fileDelete: parseFileDelete,
    fileRename: parseFileRename,
    textDocumentOpen: parseTextDocumentOpen,
    textDocumentClose: parseTextDocumentClose,
    testResultsOverviewView: parseTestResultsOverviewView,
    taskFeedbackView: parseTaskFeedbackView,
    debugSession: parseDebugSession,
    breakpointChange: parseBreakpointChange,
} satisfies Record<RecordedEvent['type'], EventParser>;

/**
 * Parse one line of an `events.jsonl` recording. Returns `null` on any shape
 * failure (unknown type, missing/mistyped field) so the replay path can skip
 * the offending line instead of dereferencing `undefined`.
 */
export function parseRecordedEvent(data: unknown): RecordedEvent | null {
    if (!isObject(data)) { return null; }
    if (!isFiniteNumber(data.timestamp)) { return null; }
    if (!isString(data.type)) { return null; }
    // Own-property check FIRST: EVENT_PARSERS is a plain object literal, so a
    // bare `EVENT_PARSERS[data.type]` would resolve inherited Object.prototype
    // members for adversarial `type` values like 'toString' / 'constructor' /
    // '__proto__' (returning garbage or throwing). The old `switch` returned
    // null for those; this preserves that exact behaviour.
    if (!Object.prototype.hasOwnProperty.call(EVENT_PARSERS, data.type)) { return null; }
    const parser = (EVENT_PARSERS as Record<string, EventParser>)[data.type];
    return parser(data, data.timestamp);
}
```

> **Why the own-property guard (do not drop it):** the review verified that without it, `parseRecordedEvent({type:'toString',timestamp})` returns the string `"[object Undefined]"`, `'constructor'`/`'__proto__'` return garbage objects, and `'valueOf'`/`'hasOwnProperty'`/`'isPrototypeOf'`/`'propertyIsEnumerable'` THROW, and `replayCommand.ts` does NOT wrap `parseRecordedEvent` in try/catch, so a throw would abort the entire replay session. The `hasOwnProperty.call` form is used for portability: it has no lib dependency and identical behaviour. `Object.hasOwn` would also work here (the repo targets ES2022), so either is fine. The dispatcher-level prototype test added in Step 1 locks this in.

Then update the FILE HEADER comment (top of file, the paragraph beginning "The `RecordedEvent` validator is strict per-variant: each of the 33 type literals..."). Replace that paragraph with:

```ts
 * The `RecordedEvent` validator is strict per-variant: every `type` literal in
 * the union has a dedicated validator, wired through the `EVENT_PARSERS` table.
 * That table is `satisfies Record<RecordedEvent['type'], EventParser>`, so
 * adding a new event variant to `recording/types.ts` without adding its parser
 * here fails to compile — schema drift cannot silently land.
```

- [ ] **Step 6: Run check-types and the parser tests to verify green**

Run: `npm run check-types 2>&1 | tail -5`
Expected: no errors (the table is exhaustive; the two new parsers are wired).

Run: `npm run compile-tests && npx vscode-test --label unit 2>&1 | tee /tmp/dbg_parser_test.txt | tail -20`
Expected: all parser tests pass, including the new ones. Confirm via `reports/mocha-results.xml` (0 failures). The pre-existing per-variant tests must STILL pass — they prove the switch→table refactor preserved behaviour. Clean up: `rm /tmp/dbg_parser_test.txt`.

- [ ] **Step 7: Prove the guard actually fires**

Temporarily delete the `breakpointChange: parseBreakpointChange,` line from `EVENT_PARSERS`, then run `npm run check-types 2>&1 | tail -10`.
Expected: **TWO** errors, not one. The intended one is `TS1360: Type '{...}' does not satisfy the expected type 'Record<...>'. Property 'breakpointChange' is missing` — that is the proof the guard fires. There is also an incidental `TS6133: 'parseBreakpointChange' is declared but its value is never read` (because `noUnusedLocals: true` is set and the function is now unreferenced); ignore it. **Restore the line** and re-run `npm run check-types` → clean.

- [ ] **Step 8: Commit**

```bash
git add extension/src/extension/services/telemetry/recording/parseRecordedData.ts extension/test/unit/services/telemetry/recording/parseRecordedData.test.ts
git commit -m "fix(recording): validate debugSession/breakpointChange events + compile-enforce parser exhaustiveness"
```

---

### Task 2: Sync the validate-recording CLI's known-types list

**Files:**
- Modify: `extension/scripts/validate-recording.ts`

- [ ] **Step 1: Add the missing types to `KNOWN_EVENT_TYPES`**

In `validate-recording.ts`, the `KNOWN_EVENT_TYPES` set is independently maintained and stale (unknown types only produce warnings, so this is cleanliness, not a hard failure). Add the two new debug types, and — since we are editing this list — the four other types already missing relative to the parser (`configurationSnapshot`, `configurationChange`, `testResultsOverviewView`, `taskFeedbackView`). Add a `// Debug` group:

```ts
    // Build
    'buildResult',
    // Config
    'configurationSnapshot', 'configurationChange',
    // Views
    'testResultsOverviewView', 'taskFeedbackView',
    // Debug
    'debugSession', 'breakpointChange',
```

(Insert these alongside the existing entries; do not remove any. If you prefer to keep scope minimal, at minimum add `'debugSession', 'breakpointChange'` — but the four pre-existing omissions are real and trivial to fix here.)

- [ ] **Step 2: Verify the script still type-checks**

Run: `npm run check-types 2>&1 | tail -5`
Expected: no errors.

NOTE: `validate-recording` exits 0 regardless of warnings (only `error`-severity issues affect the exit code; unknown types are `warn`-severity, code `UNKNOWN_TYPE`, and are printed ONLY under `--verbose` — see `validate-recording.ts:144-151,390`). So an exit-0 check does NOT verify this sync. The real verification lives in Task 3, Step 2: the e2e runs `validate-recording --verbose` on a recording that contains `breakpointChange` events and asserts the output contains no `unknown event type 'breakpointChange'` / `'debugSession'` warning. That assertion fails if this task is skipped.

- [ ] **Step 3: Commit**

```bash
git add extension/scripts/validate-recording.ts
git commit -m "chore(recording): add debug + previously-missing event types to validate-recording known list"
```

---

### Task 3: E2E — live breakpoint add/remove through the real listener

**Files:**
- Modify: `extension/test/e2e/recording.e2e.test.ts`

- [ ] **Step 1: Extend the imports**

In `recording.e2e.test.ts`:
- Add `BreakpointChangeEvent,` to the existing `import type { ... } from '@extension/services/telemetry/recording/types';` block.
- Add a value import of the parser:
  ```ts
  import { parseRecordedEvent } from '@extension/services/telemetry/recording/parseRecordedData';
  ```

- [ ] **Step 2: Add the live add/remove test inside the existing `suite('Session Recorder — E2E (VS Code only)', ...)`** (after the last test in the suite, before the closing `});`):

```ts
    test('breakpoint add/remove flows through the live listener into JSONL with exact payloads', async () => {
        // vscode.debug.breakpoints is a persistent global — clear any leftover state first.
        vscode.debug.removeBreakpoints([...vscode.debug.breakpoints]);
        await sleep(150);

        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-storage-bp-'));
        const storageUri = vscode.Uri.file(storageDir);
        const workspaceUri = vscode.Uri.file(workspaceDir);

        recorder = new SessionRecorder(storageUri);
        recorder.enable();
        await recorder.startSession(30, 'bp-test', workspaceUri.toString());
        await sleep(300); // startup phase

        // One in-root breakpoint (recorded) + one out-of-root (must be filtered out).
        // The files need not exist on disk — breakpoints carry a location regardless.
        const inRootUri = vscode.Uri.file(path.join(workspaceDir, 'Bp.java'));
        const outOfRootUri = vscode.Uri.file(path.join(os.tmpdir(), `outside-bp-${process.pid}.java`));
        const inRootBp = new vscode.SourceBreakpoint(
            new vscode.Location(inRootUri, new vscode.Position(9, 4)),
            true, 'x > 0', undefined, 'log here',
        );
        const outOfRootBp = new vscode.SourceBreakpoint(
            new vscode.Location(outOfRootUri, new vscode.Position(2, 0)),
        );

        // Add both → onDidChangeBreakpoints{added} → listener filters to in-root only.
        vscode.debug.addBreakpoints([inRootBp, outOfRootBp]);
        await sleep(400);
        // Remove the in-root one → onDidChangeBreakpoints{removed}.
        vscode.debug.removeBreakpoints([inRootBp]);
        await sleep(400);

        await recorder.endSession();

        const recordingsDir = path.join(storageDir, 'recordings');
        const sessionDirs = fs.readdirSync(recordingsDir).filter(d =>
            fs.statSync(path.join(recordingsDir, d)).isDirectory(),
        );
        assert.strictEqual(sessionDirs.length, 1, 'exactly one session dir');
        const sessionDir = path.join(recordingsDir, sessionDirs[0]);
        const events: RecordedEvent[] = fs.readFileSync(path.join(sessionDir, 'events.jsonl'), 'utf-8')
            .trim().split('\n').map(l => JSON.parse(l) as RecordedEvent);

        const bpEvents = events.filter((e): e is BreakpointChangeEvent => e.type === 'breakpointChange');

        // Exactly one 'added' and one 'removed' (no active debug session ⇒ no 'changed' noise).
        const added = bpEvents.filter(e => e.action === 'added');
        const removed = bpEvents.filter(e => e.action === 'removed');
        assert.strictEqual(added.length, 1, `exactly 1 'added' breakpointChange (got ${added.length})`);
        assert.strictEqual(removed.length, 1, `exactly 1 'removed' breakpointChange (got ${removed.length})`);

        // 'added' carries exactly the in-root breakpoint with the exact payload.
        assert.strictEqual(added[0].breakpoints.length, 1, 'out-of-root breakpoint filtered from added');
        const b = added[0].breakpoints[0];
        assert.strictEqual(b.uri, inRootUri.toString(), 'added uri = in-root');
        assert.strictEqual(b.line, 9, 'added line is 0-based 9');
        assert.strictEqual(b.column, 4, 'added column is 0-based 4');
        assert.strictEqual(b.enabled, true, 'added enabled');
        assert.strictEqual(b.condition, 'x > 0', 'added condition preserved');
        assert.strictEqual(b.logMessage, 'log here', 'added logMessage preserved');
        assert.strictEqual(b.id, inRootBp.id, 'added id correlates with the SourceBreakpoint');

        // The out-of-root URI must never appear in any recorded breakpoint.
        const allUris = bpEvents.flatMap(e => e.breakpoints.map(bp => bp.uri));
        assert.ok(!allUris.includes(outOfRootUri.toString()), 'out-of-root breakpoint filtered everywhere');

        // 'removed' references the in-root breakpoint by id.
        assert.ok(removed[0].breakpoints.some(bp => bp.id === inRootBp.id), 'removed references in-root bp id');

        // Timestamp monotonicity across the whole stream.
        for (let i = 1; i < events.length; i++) {
            assert.ok(events[i].timestamp >= events[i - 1].timestamp, `timestamp regression at event[${i}]`);
        }

        // The recording validates clean (exit 0 = no error-severity issues).
        // Run with --verbose so warnings print, then assert the validate-recording
        // known-types sync (Task 2) actually took effect: no UNKNOWN_TYPE warning
        // for the new event types. This is the ONLY assertion that verifies Task 2.
        const validate = runCliCheck('validate-recording', sessionDir, ['--verbose']);
        const validateOut = String(validate.stdout);
        assert.ok(!validateOut.includes("unknown event type 'breakpointChange'"), 'breakpointChange is a known validate-recording type');
        assert.ok(!validateOut.includes("unknown event type 'debugSession'"), 'debugSession is a known validate-recording type');

        // The validated parser round-trips the new events (regression guard for the
        // parseRecordedData gap this work closes).
        for (const e of bpEvents) {
            assert.deepStrictEqual(parseRecordedEvent(e), e, 'breakpointChange round-trips through parseRecordedEvent');
        }

        vscode.debug.removeBreakpoints([...vscode.debug.breakpoints]);
    });
```

- [ ] **Step 2a: Extend the `runCliCheck` helper to accept extra args and return the result**

The existing helper (`recording.e2e.test.ts`, near the bottom) asserts exit 0 and returns `void`. Extend it (backward-compatible — existing call sites pass no extra args and ignore the return value):

```ts
function runCliCheck(
    script: 'validate-recording' | 'roundtrip-recording',
    sessionDir: string,
    extraArgs: string[] = [],
): ReturnType<typeof spawnSync> {
    const extensionRoot = path.resolve(__dirname, '..', '..', '..');
    const scriptPath = path.join(extensionRoot, 'scripts', `${script}.ts`);
    const result = spawnSync('npx', ['tsx', scriptPath, sessionDir, ...extraArgs], {
        cwd: extensionRoot,
        encoding: 'utf-8',
        timeout: 60_000,
    });
    assert.strictEqual(
        result.status,
        0,
        `${script} failed (exit ${result.status}):\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    return result;
}
```

- [ ] **Step 3: Compile and run the recorder-e2e suite**

Run: `npm run test:recorder-e2e 2>&1 | tee /tmp/dbg_e2e.txt | tail -40`
Expected: the new test passes alongside the existing ones.

**Empirical-verification gate (important — real `vscode.debug` API):** the exact-count assertions (`added.length === 1`, `removed.length === 1`) assume one `addBreakpoints` call coalesces into a single `onDidChangeBreakpoints{added}` and that no `changed` events fire without an active debug session. If the run shows a different count (e.g. VS Code split the add, or emitted a `changed`), inspect the actual `breakpointChange` events in `/tmp/dbg_e2e.txt` and relax the count assertions to aggregate checks that are still meaningful (e.g. "exactly one recorded breakpoint with `inRootBp.id` whose first-seen action is `added`; out-of-root never present; a `removed` referencing the id exists"). Do NOT weaken the in-root-filter and exact-payload assertions, only the event-count shape. The `b.id === inRootBp.id` correlation is also an observed-behaviour assumption (VS Code echoes back the same `SourceBreakpoint` instance and its construction-time id): if a host build ever fails it, correlate by `uri`+`line`+`column` instead of `id`. Document any relaxation with a comment explaining the observed VS Code behaviour. Clean up: `rm /tmp/dbg_e2e.txt`.

- [ ] **Step 4: Commit**

```bash
git add extension/test/e2e/recording.e2e.test.ts
git commit -m "test(recording): e2e for live breakpoint add/remove through the recorder pipeline"
```

---

### Task 4: Wiring test — the production startup breakpoint-snapshot contributor

**Decision (option c):** The snapshot's *collector* (`collectInitialBreakpointSnapshot`) is already unit-tested (debugRecording.test.ts T8). The genuinely uncovered seam is the *wiring* — that `sessionRecorderWiring.ts` actually registers a startup contributor which reads `vscode.debug.breakpoints` and emits the in-root snapshot. We test that REAL registration (not a duplicated lambda) by mirroring the existing, passing `'configurationSnapshot is emitted at startup'` test in `sessionRecorderWiring.test.ts`: it builds the real `wireSessionRecorder`, runs a session, and reads the recorded events from disk.

**Files:**
- Modify: `extension/test/unit/activation/sessionRecorderWiring.test.ts`

**Context the implementer must know:**
- The harness `makeWiringHarness(sandbox, configState)` calls the real `wireSessionRecorder(...)` with stubbed deps and a real `SessionRecorder` writing to `harness.tmpDir`. Consent is stubbed extended (`stubConsent(true)`), so the recorder is `enable()`d (its live `onDidChangeBreakpoints` listener is active).
- `readAllRecordedEvents(harness.tmpDir)` reads the session's `events.jsonl` (already used by the `configurationSnapshot` test).
- The wiring's breakpoint contributor lambda is at `sessionRecorderWiring.ts:212-216`: it reads `ctx.exerciseRoot` (passed via `startSession(id, participant?, exerciseRoot?)`) and `vscode.debug.breakpoints`, filters in-root via `collectInitialBreakpointSnapshot`, and emits one `breakpointChange{action:'added'}`.
- This is a unit test under `@vscode/test-electron`, so the real `vscode.debug` API is available. We set breakpoints with `vscode.debug.addBreakpoints` BEFORE `startSession` (phase is idle, so the live listener does NOT record the add — only the startup contributor captures them). `vscode.debug.breakpoints` is a persistent global; clear it before and after.

- [ ] **Step 1: Extend the imports**

In `sessionRecorderWiring.test.ts`, add `BreakpointChangeEvent` to the existing recording-types import (the file already imports event types like `ConfigurationSnapshotEvent`, `InterventionEvent`). If they are imported from `@extension/services/telemetry/recording/types`, add `BreakpointChangeEvent` there; otherwise add a `import type { BreakpointChangeEvent } from '@extension/services/telemetry/recording/types';`. `vscode`, `path`, `os`, `assert` are already imported.

- [ ] **Step 2: Write the failing test**

Add inside the existing `suite('sessionRecorderWiring — suppression and configuration provenance', ...)`, after the `'configurationSnapshot is emitted at startup'` test:

```ts
    test('initial breakpoint snapshot is emitted at startup for in-root breakpoints only', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        const exerciseRoot = vscode.Uri.file(path.join(harness.tmpDir, 'ex'));
        const inRootUri = vscode.Uri.file(path.join(exerciseRoot.fsPath, 'Main.java'));
        const outOfRootUri = vscode.Uri.file(path.join(os.tmpdir(), `wiring-bp-out-${process.pid}.java`));
        const inRootBp = new vscode.SourceBreakpoint(new vscode.Location(inRootUri, new vscode.Position(4, 0)));
        const outOfRootBp = new vscode.SourceBreakpoint(new vscode.Location(outOfRootUri, new vscode.Position(0, 0)));
        try {
            // Pre-existing breakpoints BEFORE the session (idle phase ⇒ the live
            // listener does not record the add; only the startup contributor does).
            vscode.debug.removeBreakpoints([...vscode.debug.breakpoints]);
            vscode.debug.addBreakpoints([inRootBp, outOfRootBp]);

            await harness.recorder.startSession(42, undefined, exerciseRoot.toString());
            await harness.recorder.endSession();

            const events = await readAllRecordedEvents(harness.tmpDir);
            const snap = events.find(e => e.type === 'breakpointChange') as BreakpointChangeEvent | undefined;
            assert.ok(snap, 'breakpoint snapshot missing — startup contributor not registered by the wiring?');
            assert.strictEqual(snap!.action, 'added', 'snapshot action is added');
            assert.strictEqual(snap!.breakpoints.length, 1, 'only the in-root breakpoint is captured (out-of-root filtered)');
            assert.strictEqual(snap!.breakpoints[0].uri, inRootUri.toString(), 'snapshot uri = in-root');
            assert.strictEqual(snap!.breakpoints[0].line, 4, 'snapshot line 0-based 4');
            assert.strictEqual(snap!.breakpoints[0].id, inRootBp.id, 'snapshot bp id matches the SourceBreakpoint');
        } finally {
            vscode.debug.removeBreakpoints([...vscode.debug.breakpoints]);
            await harness.dispose();
        }
    });
```

- [ ] **Step 3: Run the wiring unit suite**

Run: `npm run compile-tests && npx vscode-test --label unit 2>&1 | tee /tmp/dbg_wiring.txt | tail -20`
Expected: the new test passes (the production wiring registers the breakpoint contributor, so the snapshot is recorded with only the in-root breakpoint). Confirm via `reports/mocha-results.xml` (0 failures). Clean up: `rm /tmp/dbg_wiring.txt`.

**Empirical-verification gate:** this test exercises the real wiring + real `vscode.debug` global. If the snapshot is absent, first confirm `vscode.debug.addBreakpoints` populated `vscode.debug.breakpoints` (log it) and that `startSession`'s `exerciseRoot` arg reached the contributor; the in-root filter depends on `exerciseRoot` being a parent of `inRootUri` (it is: `<tmpDir>/ex` vs `<tmpDir>/ex/Main.java`). The `id` correlation is an observed-behaviour assumption (VS Code keeps the same `SourceBreakpoint` instance); if a host build ever breaks it, correlate by `uri`+`line` instead. Do not weaken the in-root-filter / count assertions.

- [ ] **Step 4: Commit**

```bash
git add extension/test/unit/activation/sessionRecorderWiring.test.ts
git commit -m "test(recording): wiring test for the startup breakpoint-snapshot contributor"
```

---

## Final verification (run after all tasks)

- [ ] `npm run check-types` → clean (incl. the exhaustiveness guard).
- [ ] `npm run lint` → clean (`eslint src test`). This is the mandatory final step.
- [ ] `npm run test:unit 2>&1 | tee /tmp/dbg_final_unit.txt | tail -20` → read `reports/mocha-results.xml`, 0 failures (covers the parser tests from Task 1 AND the wiring test from Task 4). `rm /tmp/dbg_final_unit.txt`.
- [ ] `npm run test:recorder-e2e 2>&1 | tee /tmp/dbg_final_e2e.txt | tail -30` → the new live add/remove test (Task 3) + existing tests pass. `rm /tmp/dbg_final_e2e.txt`.
- [ ] Code review per CLAUDE.md (codex or superpowers self-review) before offering to push.

## Self-review notes (author)

- **Spec coverage:** parser fix (Task 1) + guard (Task 1, Step 5/7) + validate-recording sync (Task 2) + live breakpoint e2e (Task 3) + startup-snapshot wiring test (Task 4). All four scope items from the user's "e2e + Parser-Fix + Guard" choice are covered.
- **Type consistency:** `EventParser` signature matches every existing parser `(d, timestamp)`. `parseRecordedBreakpoint` return type is `BreakpointChangeEvent['breakpoints'][number]` (indexed, no duplicate literal). `isStringOrUndefined` (narrowing guard) used for all optional strings so no casts are needed in the returned object.
- **Task 4 decision (option c, chosen 2026-05-30):** the snapshot is tested at its REAL seam. The collector (`collectInitialBreakpointSnapshot`) is already unit-tested (T8); the uncovered part is the production *registration* in `sessionRecorderWiring.ts`. Task 4 therefore adds a wiring unit test that runs the real `wireSessionRecorder` (mirroring the existing `'configurationSnapshot is emitted at startup'` test) and asserts the in-root snapshot is recorded. This avoids the duplicated-lambda smell of testing a copy in the e2e, and is lower-risk to write because it clones a proven test pattern. The live add/remove e2e (Task 3) covers the listener path that white-box injection cannot reach.
- **Empirical gates:** Task 3 (live e2e) and Task 4 (wiring test) both include explicit "run, observe real `vscode.debug` behaviour, relax count/ordering assertions if needed" steps, because the real debug API timing/coalescing is not guaranteed by the docs.

## Review outcome (4-lens adversarial review, 2026-05-30)

Codex was rate-limited, so the plan was reviewed by a 4-agent adversarial workflow (lenses: parser correctness, TS guard semantics, vscode.debug API realism, breaking-changes/completeness). Findings, all addressed in this revision:
- **HIGH (fixed):** the original table lookup `(EVENT_PARSERS as Record<string, EventParser|undefined>)[data.type]` leaked `Object.prototype` members for adversarial `type` values (`toString`/`constructor`/`__proto__` etc.) — returning garbage or throwing (the throw would abort a whole replay session, since `replayCommand.ts` does not try/catch `parseRecordedEvent`). Fixed with an `Object.prototype.hasOwnProperty.call` own-property guard (Task 1 Step 5) + a dispatcher-level prototype test (Task 1 Step 1).
- **MEDIUM (fixed):** Task 2 was effectively unverified (`validate-recording` exits 0 regardless of warnings; warnings only print under `--verbose`). Now verified by a `--verbose` stdout assertion in Task 3 Step 2 + the `runCliCheck` extension in Step 2a.
- **MEDIUM (fixed):** documented the shared-global / default-consent assumption the e2e relies on.
- **LOW (fixed):** Step 7 now notes the incidental `TS6133` alongside the intended `TS1360`; the `sessionRecorderWiring.ts` path is now given in full.
- **Confirmed non-issues:** the no-cast optional handling (narrowing `isStringOrUndefined`) is correct as written; the switch→table refactor is behaviour-preserving (every case is uniform); `replaySession` ignores the newly-kept debug/breakpoint events harmlessly; no viewer change and no type-sync needed (viewer uses raw `JSON.parse`, `types.ts` unchanged); the table is exhaustive (one parser per union member, compile-enforced by the `satisfies` clause, so the count is self-correcting and not hardcoded here).
