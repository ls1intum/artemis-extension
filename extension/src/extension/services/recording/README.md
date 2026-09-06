# Session Recorder

Records a JSONL event stream of everything a student does during an exercise
(text edits, saves, diagnostics, selections, terminal commands, Iris chat,
struggle interventions, build results) plus file-content snapshots. Only
active when consent is **extended**. Writes to
`{globalStorageUri}/recordings/{sessionId}/`.

## Layout

```
recording/
├── sessionRecorder.ts         Facade: public API + module wiring (504 LOC)
├── types.ts                   All RecordedEvent interfaces (discriminated union)
├── storageWriter.ts           JSONL writer + snapshot I/O + lane mutex
├── recordingStatusBar.ts      Status-bar Play/Stop indicator
├── eventCollectors.ts         Pure fns: vscode.* objects → RecordedEvent
├── index.ts                   Barrel (SessionRecorder + RecordingStatusBarService)
│
│   (uriFilter.ts now lives at services/sensing/uriFilter.ts — moved out of
│    recording/ so the struggle engine can import it without coupling into recording/)
│
├── lifecycleController.ts     RecorderLifecycleState (pure state: phase FSM,
│                              generation counters, ActiveSessionState) plus
│                              LifecycleController (_doStart / _doFinalize /
│                              _doDisable orchestration, recordInternal,
│                              writeLifecycleEvent). Both classes co-located.
│
├── snapshots/
│   └── snapshotManager.ts     File snapshots with retry (max 3) + in-flight
│                              dedup. fileSnapshotError via lifecycle bypass.
│
├── startup/
│   └── startupCapture.ts      Sync emission of startup events: initial
│                              diagnostics → external contributors →
│                              initial-state (windowFocus, selection,
│                              visibleRange, fileSwitch, terminalOpen).
│
└── observation/
    └── observationRegistry.ts Every vscode.* listener (text/save/diagnostics/
                               selection/visibleRange/focus/terminal/file-ops)
                               + per-URI debounce state + pending terminal
                               executions.
```

## Roles at a glance

| Module | Owns | Talks to |
|---|---|---|
| **SessionRecorder** (facade) | Wiring + writer + onDidChangeState event | All modules |
| **RecorderLifecycleState** | phase, generation, ActiveSessionState | (nothing — pure state) |
| **LifecycleController** | FSM transitions, central sink, bypass channel | state, writer, snapshots, startup, observation |
| **SnapshotManager** | `_snapshotedUris`, retry counter, in-flight dedup | state, writer, record fn, lifecycleAppend |
| **ObservationRegistry** | All listeners, debounce timers, terminal pending | state, snapshots, record fn |
| **StartupCapture** | Contributor list + sync startup emission | record fn only |

## Data flow

```
vscode.* event fires
   │
   ▼
ObservationRegistry listener
   • phase check (recording?)
   • uri filter (shouldRecordUri)
   • capture generation at trigger time
   • for debounced events: per-URI timer + pending-payload map
   │
   ▼
LifecycleController.recordInternal(event, opts, gen)
   • gen match check
   • phase gate (recording / starting+allowDuringStartup / ending+allowDuringEnding)
   • state.incrementEventCount()
   • writer.appendEvent(event)
   │
   ▼
JSONL line on disk (via writer's lane mutex)
```

Lifecycle events (`sessionStart`, `sessionEnd`, `consentChange`,
`startupPhaseComplete`, `fileSnapshotError`) bypass the phase gate via
`writeLifecycleEvent` — they're written synchronously at controlled
lifecycle points.

## Key invariants

- **Commit boundary:** `sessionStart` on disk = `state.activeSession.sessionStartWritten` true. Pre-commit aborts call `writer.abort()`. Post-commit aborts go through `_doFinalize` (with `reason: 'user-end' | 'deactivate' | 'consent-downgrade'`).
- **Generation token:** every async callback captures `state.currentGeneration` at trigger time and passes it to `recordInternal`. Stale callbacks from a rotated session are dropped.
- **Phase FSM:** `idle → starting → recording → ending → idle`  (normal) /  `{any} → disabling → disabled` (consent downgrade). Only `LifecycleController.disable()` may force-flip from any phase.
- **Three teardown paths:** regular end flushes debounces; consent downgrade *discards* them (GDPR); dispose runs through dispose-specific finalize.
- **Listener lifetime:** enable-scoped (registered once at consent-enable, disposed at consent-disable / dispose). Session boundaries only update `setExerciseContext(uri | null)`.

## Schema

Event types live in `types.ts` as a discriminated union on `type`. Schema version
is `2`. Metadata for each recorded session (`metadata.json`) carries
`schemaVersion`, `recorderVersion`, `sessionId`, `exerciseId`, timestamps,
and `eventCount`.

## External touchpoints

Not everything recorder-related lives here. The core is self-contained, but:

- `activation/sessionRecorderWiring.ts` — wires the recorder into the extension
  (instantiates it, registers the three startup contributors: panel
  visibility, the pinned legacy configuration snapshot, and the initial
  breakpoint snapshot).
- `sensing/buildResultGuard.ts` — shared `shouldAcceptBuildResult()` used by
  both the struggle coordinator and the recorder's `onNewResult` path.

## Tooling

Three CLI scripts in `extension/scripts/` validate recordings:

- `validate-recording.ts` — 14 structural invariant checks
- `event-coverage.ts` — compares present types against `types.ts` source
- `roundtrip-recording.ts` — replays `textChange` events on initial snapshots
  to reconstruct final file content; optional `--compare <ref>` for byte-exact diff

Run via `npm run validate-recording -- <dir>` etc.
