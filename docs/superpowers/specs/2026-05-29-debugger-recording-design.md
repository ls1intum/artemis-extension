# Debugger Recording (Lifecycle + Breakpoints) Design

**Date:** 2026-05-29
**Status:** Approved (design), reviewed, pending implementation plan
**Branch:** `feat/debug-recording` (off `dev`)

## Goal

Capture VS Code debugger activity in the existing session recording so it can be
replayed in the recording-viewer. Scope is deliberately limited to debug-session
lifecycle and breakpoint changes, captured through the high-level `vscode.debug.*`
event APIs only. No `DebugAdapterTracker`, therefore no stepping, no variable or
watch inspection, no debug-console I/O, no call stack. No struggle-detection
(EQ / decision engine) integration.

## Motivation

The recorder currently captures editor, file, diagnostics, build, terminal, chat
and intervention events, but nothing about debugging. A researcher replaying a
session cannot see whether or when a student debugged, or where they suspected a
problem (breakpoints). This adds that signal at low cost and lays the data
foundation for a possible later "debugging phase" analysis (V2.0 Phase-aware
Proactivity), without wiring detection now.

## Scope

### In scope
- Debug-session lifecycle: started, terminated, active-session changed.
- Breakpoint changes: added, removed, changed (source breakpoints only).
- Initial breakpoint snapshot at recording start (see Design Decisions).
- Capture to `events.jsonl` via the existing recording pipeline.
- Rendering in the recording-viewer (timeline + event stream + filters).

### Out of scope (YAGNI)
- `DebugAdapterTracker` and the Debug Adapter Protocol.
- Stepping (step in/out/over, continue, pause), breakpoint-hit / stopped events.
- Variable, watch, and call-stack inspection.
- Debug-console / REPL input and output.
- Non-source breakpoints: function breakpoints (no source URI). The VS Code API
  has no data-breakpoint class.
- Any EQ / decision-engine / intervention integration.

## Architecture

Reuse the existing "add a recorded event type" pipeline end to end. No new
infrastructure.

```
vscode.debug.* listeners   (observationRegistry.enable)
        | record(event, {}, gen)
        v
lifecycleController.recordInternal   (phase + generation gate, count++)
        v
storageWriter.appendEvent            (buffer, flush at 10 events / 1s)
        v
events.jsonl
```

Event types are defined once in the extension and generated into the viewer with
`npm run sync-types`. The viewer renders them through the established
filter / color / switch pattern. The universal sink
(`lifecycleController.recordInternal`, `storageWriter`) is unchanged.

## Event Schema (`recording/types.ts`)

Two event types, because session and breakpoint events have different shapes and
lifecycles.

```ts
export interface DebugSessionEvent {
    type: 'debugSession';
    timestamp: number;
    action: 'started' | 'terminated' | 'activeChanged';
    // Present for started / terminated, and for activeChanged when a session
    // became active. Omitted (undefined) for activeChanged -> no active session.
    sessionId?: string;        // vscode.DebugSession.id
    sessionName?: string;      // .name
    sessionType?: string;      // .type, e.g. 'java'
    parentSessionId?: string;  // .parentSession?.id, for compound configurations
}

export interface BreakpointChangeEvent {
    type: 'breakpointChange';
    timestamp: number;
    action: 'added' | 'removed' | 'changed';
    breakpoints: {
        id: string;            // vscode.Breakpoint.id, stable per breakpoint; correlates add/remove/change
        uri: string;           // absolute file:// URI (SourceBreakpoint only), same as all file events
        line: number;          // 0-based, from location.range.start.line; consistent with serializeRange
        column: number;        // 0-based, from location.range.start.character (always populated)
        enabled: boolean;
        condition?: string;
        hitCondition?: string;
        logMessage?: string;   // logpoints
    }[];
}
```

Both interfaces are appended to the `RecordedEvent` union, keeping the existing
family grouping (not alphabetical).

## Capture (`observation/observationRegistry.ts::enable()`)

Four event listeners plus one startup snapshot. Each listener follows the
existing inline pattern used by the terminal and file listeners: check
`recordingPhase()`, capture `gen`, call `this._deps.record(event, {}, gen)`, push
the disposable to `_eventListenerDisposables`. Teardown is automatic;
`disposeSubscriptions()` is not changed.

- `vscode.debug.onDidStartDebugSession(s)` -> `debugSession` / `started`
- `vscode.debug.onDidTerminateDebugSession(s)` -> `debugSession` / `terminated`
- `vscode.debug.onDidChangeActiveDebugSession(s?)` -> `debugSession` /
  `activeChanged`; session fields are set when `s` is defined and omitted when
  it is `undefined`
- `vscode.debug.onDidChangeBreakpoints(e)` -> up to three `breakpointChange`
  events, one each for non-empty `e.added`, `e.removed`, `e.changed`

The four `on*` listeners gate on `recordingPhase()`. The initial snapshot below
uses `allowDuringStartup` instead, mirroring how file snapshots are taken.

### Initial breakpoint snapshot

`onDidChangeBreakpoints` is delta-only; it does not report breakpoints that
already exist when recording starts (persisted in `.vscode`, or set before
consent was granted). Breakpoints are workspace-global in VS Code
(`vscode.debug.breakpoints`), independent of any debug session. So at
**recording-session start** the recorder reads `vscode.debug.breakpoints`, filters
to in-root source breakpoints, and emits one `breakpointChange` with
`action: 'added'` carrying their stable ids, on the startup path
(`allowDuringStartup`). This mirrors how the recorder snapshots already-open files
at session start.

Because the snapshot fires whenever a recording session starts, the
"consent upgraded to Extended mid-exercise" case is covered: enabling recording
starts a recording session, which snapshots the current breakpoints. Breakpoints
changed during a consent-disabled gap are not captured individually, but the next
recording session's snapshot captures the full current state.

The snapshot carries the same stable `id`s as later delta events, so a consumer
reconstructing breakpoint state deduplicates by `id`. Any benign race (a
breakpoint changing in the same tick as the snapshot) is therefore harmless: the
duplicate carries the same id and collapses.

## Collector (`eventCollectors.ts`)

`debugSession` events are built inline (trivial field copy from
`vscode.DebugSession`, including `parentSession?.id`). Breakpoints use a pure,
testable collector:

```ts
collectBreakpointChange(
    action: 'added' | 'removed' | 'changed',
    sourceBreakpoints: vscode.SourceBreakpoint[],
): BreakpointChangeEvent
```

It maps each source breakpoint to `{ id, uri, line, column, enabled, condition,
hitCondition, logMessage }`, where `line = location.range.start.line` and
`column = location.range.start.character` (both 0-based, consistent with
`serializeRange`). `id`, `enabled`, `condition`, `hitCondition` and `logMessage`
are inherited from the base `vscode.Breakpoint`.

The listener filters first: keep only `bp instanceof vscode.SourceBreakpoint`
whose `location.uri` passes `shouldRecordUri(uri, exerciseRoot)`. Function
breakpoints (no URI) are dropped. If nothing remains after filtering, no event is
emitted. This keeps the collector pure and puts gating in the listener,
consistent with every other listener.

## Consent and Paths (inherited, no special case)

- Listeners only exist while the recorder is enabled, which happens only at
  consent level Extended. There is no per-event-type consent check, and none is
  added.
- Per-event phase gate: `recordingPhase()` (`state.phase === 'recording'`); the
  startup snapshot uses `allowDuringStartup`.
- Breakpoint URIs are stored as absolute `file://` strings and filtered to the
  exercise root via `shouldRecordUri` (including the `path.sep` prefix guard so
  `/workspace/ex10` does not match root `/workspace/ex1`). Breakpoints set outside
  the exercise root are intentionally not recorded.
- `debugSession` events carry no URI, so they are gated only by phase / consent.
  A debug session for a file outside the exercise root still records its
  lifecycle (it carries no path); acceptable and low risk.
- `condition` / `logMessage` are user-authored text, like `textChange` content,
  and are acceptable under Extended consent.

## Viewer Rendering

1. `npm run sync-types` regenerates `recording-viewer/src/generated/recordingTypes.ts`
   (never hand-edited).
2. `constants.ts`:
   - Add `'debugSession'` and `'breakpointChange'` to `ALL_EVENT_TYPES`. Array
     position sets the swim-lane order; place them near the file / terminal
     cluster.
   - Add `MARKER_COLORS` entries: `debugSession: '#f59e0b'` (amber),
     `breakpointChange: '#ef4444'` (red). `#f59e0b` avoids colliding with
     `irisChatSendAttempt`'s `#fb923c`. `MARKER_COLORS` is
     `Record<EventType, string>`, so a missing entry is a compile error.
   - `SWIM_LANE_TYPES` is derived; no change.
3. `TrackingTimeline.tsx` (`eventSummary`) and `EventStream.tsx` (`EventDetail`):
   add one `case` per type to each switch. Both switches are independent; both
   must be updated or one view degrades silently. `breakpointChange` shows the
   action, breakpoint count and first file (`shortenUri`), truncating long
   fields; line numbers are rendered as `line + 1` (0-based stored, 1-based
   shown). `debugSession` shows the action and session name / type.

## Edge Cases and Error Handling

- `onDidChangeBreakpoints` carries three arrays (`added` / `removed` / `changed`);
  each is processed independently and empty arrays emit nothing. The VS Code API
  does not guarantee one event per user action, so no coalescing is assumed: if
  the editor fires several events for a bulk action, each is recorded faithfully.
  No debouncing is applied (breakpoint changes are low-frequency).
- Non-`SourceBreakpoint` entries are skipped.
- `onDidChangeActiveDebugSession(undefined)` emits `activeChanged` with the
  session fields omitted. It is recorded unconditionally (no URI to filter on),
  like started / terminated.
- Multiple or compound debug sessions are recorded as independent `debugSession`
  events keyed by `sessionId`; `parentSessionId` links a child to its parent.
  No further parent/child correlation is attempted.
- Generation token is captured synchronously at listener fire, preventing
  cross-session contamination.
- JSONL consumers already `JSON.parse` per line in try / catch (no change).

## Testing

New file: `extension/test/unit/services/telemetry/recording/debugRecording.test.ts`.
The event-construction logic lives in pure collectors that are unit-tested
directly (genuine red-green). The phase/generation gating of the new union
members is verified white-box via `injectEvent` (real `vscode.Event` emitters
cannot be fired from tests, so the listener registration itself is covered by
compile + the manual smoke test, not a unit test).

Pure-collector tests (fail before the collectors exist):
- **T3 debugSession structure:** `collectDebugSession('started', session)` carries
  `sessionId` / `sessionName` / `sessionType` / `parentSessionId` and the action.
- **T4 activeChanged(undefined):** `collectDebugSession('activeChanged', undefined)`
  leaves all session fields undefined.
- **T6 breakpoint collector:** `collectBreakpointChange` maps fields, keeps 0-based
  line / column, copies inherited `id` / `condition` / `logMessage`.
- **T7 URI filter:** `filterRecordableSourceBreakpoints` keeps in-root source
  breakpoints, drops function breakpoints and out-of-root ones.
- **T8 initial snapshot:** `collectInitialBreakpointSnapshot` returns the in-root
  breakpoints with the given timestamp, and `null` when none are in-root.
- **T9 multi-breakpoint array:** `collectBreakpointChange('changed', [a, b, c])`
  returns one event with three breakpoint entries (a bulk array maps to one
  event, regardless of how the editor batches firings).

White-box gating tests (regression, exercising the sink):
- **T1 Phase gate:** `debugSession` / `breakpointChange` injected before
  `startSession` (idle) or after `disable()` are dropped.
- **T2 Generation gate:** an event recorded with a stale generation is dropped.
- **T5 structure-in-stream:** while recording, an injected `debugSession` and
  `breakpointChange` land in the JSONL with their fields intact.

Viewer (mandatory, not optional): the registration compile guard
(`MARKER_COLORS` is `Record<EventType, string>` and the `_MissingEventTypes`
guard) only proves the types are registered, NOT that the render switches handle
them (both switches have a fallthrough default). So `eventSummary`
(`TrackingTimeline.tsx`) and `EventDetail` (`EventStream.tsx`) are exported and a
Vitest test renders both new event types through both functions, asserting the
output text (a missing case renders only the timestamp / `null`, failing the
test). Finish with extension `tsc` + eslint and viewer build + tests.

## Files Touched

**Extension**
- `extension/src/extension/services/telemetry/recording/types.ts` (two interfaces + union)
- `extension/src/extension/services/telemetry/recording/eventCollectors.ts` (`collectDebugSession`, `collectBreakpointChange`, `filterRecordableSourceBreakpoints`, `collectInitialBreakpointSnapshot`)
- `extension/src/extension/services/telemetry/recording/observation/observationRegistry.ts` (four listeners + two emit helpers)
- `extension/src/extension/activation/sessionRecorderWiring.ts` (startup-contributor breakpoint snapshot)
- `extension/test/unit/services/telemetry/recording/debugRecording.test.ts` (new)

**Viewer**
- `recording-viewer/src/generated/recordingTypes.ts` (via sync, not hand-edited)
- `recording-viewer/src/constants.ts` (filters + colors)
- `recording-viewer/src/components/TrackingTimeline.tsx` (export + render `eventSummary`)
- `recording-viewer/src/components/EventStream.tsx` (export + render `EventDetail`)
- viewer render test (mandatory, covers both new types in both functions)

## Design Decisions

- **Two event types over one.** Session and breakpoint events have different
  shapes; a single combined type forces mixed-shape `case` handling in the
  viewer. Two discriminated types render cleanly.
- **Stable breakpoint `id`.** `vscode.Breakpoint.id` is recorded per breakpoint
  so a consumer can correlate `added` / `removed` / `changed` deltas and the
  startup snapshot, even when a breakpoint is removed and re-added at the same
  location. Without it, `uri + line` is ambiguous. Decided now because it is a
  schema / replay-contract decision, expensive to retrofit.
- **0-based line / column.** Stored 0-based (raw `Position` values), consistent
  with `serializeRange` and every other position in the recorded format. The
  viewer adds `+1` for display. This reverses an earlier 1-based proposal, which
  would have made breakpoints the only event with a different indexing
  convention (a latent off-by-one footgun).
- **`undefined` over empty-string sentinels.** Session fields are optional and
  left `undefined` when there is no active session, matching `fromUri` / `toUri`
  / `participantId` elsewhere.
- **Action enum `started` / `terminated`.** Mirrors the VS Code API verbs
  (`onDidStartDebugSession` / `onDidTerminateDebugSession`) and avoids confusion
  with the DAP "stopped" (paused) concept. This diverges from the project's
  `opened` / `closed` lifecycle convention (terminals, views) deliberately,
  because those fit files / panels, not a debug session; the divergence is noted
  in a code comment.
- **Snapshot at recording-session start, reading workspace-global breakpoints.**
  Breakpoints are not tied to a debug session, so the snapshot belongs to the
  recording lifecycle, not the debug lifecycle. This also covers
  "recording enabled while breakpoints already exist" without extra logic.
- **`parentSessionId` for compound configs.** `vscode.DebugSession.parentSession`
  is recorded as `parentSessionId` so concurrent / compound sessions are not
  uninterpretable. Cheap (one optional field), not "full" debugger capture.
- **Absolute URIs, no relativization.** Consistent with every other file event.
  Note this can include the local path / username, the same exposure as existing
  events.
