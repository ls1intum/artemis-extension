# Struggle Engine v2 Port - Design Spec

**Date:** 2026-06-12
**Integration branch:** `feat/struggle-engine-v2` (see Branch Strategy)
**Status:** Approved design. Implementation plans follow per PR under `docs/superpowers/plans/`.

## 1. Context and Goal

Replace the v1 struggle-detection decision pipeline (Jadud Error Quotient, Pu boundary
triggers, EQ threshold ladder) with Engine v2, the rule engine derived from and validated
on the P1-P10 study data. v1 loses its decision role entirely; the EQ computation survives
only as a passive telemetry logger.

Source of truth for behavior:

- `ENGINE_V2_SPEC.md` Revision 3.1 (frozen) in the study analysis repository
  (`IrisStudyData/analysis/`), including evidence tags per element.
- Frozen parameters (`IrisStudyData/analysis/artifacts/derived_params.json`):
  theta_full 0.6, theta_curve 0.7, grace 32.94 s, warmup 480 s, cooldown 120 s,
  hysteresis 0.1, re-alert window 120 s.

The TypeScript port must reproduce the Python reference (`analysis/lib/engine_v2.py`)
tick-for-tick. Spec fidelity is proven by golden replay of the 10 study sessions (PR 3).
Held-out evaluation on 4 unseen participants: episode F1 0.42 (precision 0.50,
recall 0.86) versus 0.00 for the v1 pipeline. This port does not re-tune anything.

## 2. Requirements

- **R1 Maintainability:** Clean, understandable for an outside developer; the folder
  structure must communicate the architecture (sense / detect / intervene).
- **R2 Single sensing layer:** Exactly ONE place reads from VS Code APIs. The recorder is
  an optional sink: the Open VSX (clean) build without the recorder must work fully.
- **R3 v1 retirement:** All v1 decision components are removed. EQ stays as a passive
  logger (eqSnapshot events in recordings), with no decision role.
- **R4 Single-level delivery:** Alerts go through an `AlertSink` interface to one
  notification-style intervention. UI escalation levels are explicitly future work
  (no data to design them yet).
- **R5 Next-wave telemetry:** Additions needed for the next study wave ship with this
  effort (PR 4).

Non-goals: UI escalation design, backend/Artemis API changes, re-tuning of any frozen
constant.

## 3. Target Architecture (`extension/src/extension/services/`)

```
services/
├─ sensing/                      # the ONLY place that reads VS Code APIs
│  ├─ collectors/                # textChange, selection, visibleRange, windowState,
│  │                             # diagnostics (incl. save-triggered settle snapshot),
│  │                             # terminal, paste heuristic (isLikelyManualPaste),
│  │                             # file ops, debug, breakpoints
│  └─ sensorHub.ts               # typed event bus, one subscription per VS Code API;
│                                # also carries internal (non-VS-Code) sources:
│                                # buildResult (websocket, behind buildResultGuard)
│                                # and taskFeedbackView (own UI layer)
├─ recording/                    # OPTIONAL sink (study instrument): JSONL recorder;
│                                # consumes ONLY the sensorHub; excluded from the
│                                # clean build via the existing dataCollection seam
├─ struggle/                     # Engine v2 (consumes ONLY the sensorHub)
│  ├─ constants.ts               # frozen parameters, evidence tags in comments
│  ├─ signals/                   # featureWindow (typing/gap/scroll/n4, 60 s ring buffer),
│  │                             # feedbackViewState, regionPersistence (A8, lightweight
│  │                             # Java method parser), errorDistance (N2), buildDelta
│  │                             # (failedTests set diff: improved/worse/identical-set/
│  │                             # same-count/first/compile-error)
│  ├─ dynamics/                  # V(t): max/decay 2^(-dt/hl), fast-decay regime
│  ├─ boundaries/                # feedbackMoment (FM/FM+), terminalRun, paste,
│  │                             # stateBoundary (TS<5/min, N4>=10, synthetic entry at
│  │                             # warmup end), coalescer (priority)
│  ├─ gates/                     # warmup480 (FM/E4 breakthrough), fluentTyping (B2),
│  │                             # grace (B4, non-FM boundaries only)
│  ├─ alerting/                  # state machine (armed/in_state_since/last_alert_ts,
│  │                             # hysteresis, cooldown, re-alert), AlertSink interface
│  └─ struggleEngine.ts          # orchestrator: 10 s tick (injectable clock),
│                                # SessionResettable
├─ eq/                           # Jadud EQ as a PASSIVE logger (eqSnapshot events in
│                                # recordings; no decision role); does NOT read VS Code
│                                # itself: diagnostics snapshots arrive as sensor events
│                                # (save-triggered, debounced) from sensing/
└─ intervention/                 # delivery: interventionService (notification, single
                                 # level), implements AlertSink as a pure pass-through
```

These folders are siblings of the existing services (auth, iris, websocket, ...). The
current `services/telemetry/` folder dissolves stepwise across PR 1 and PR 2.

## 4. Removals and Splits

Removed (v1 decision role):

- `interventionDecisionEngine` (threshold ladder)
- `interventionFilter` (warmup/grace move into v2 gates; the session limit is dropped
  without replacement)
- `adaptiveCadence` (dropped without replacement: the engine's validated alert
  discipline - gates, cooldown, hysteresis, re-alert - is the only decision logic;
  extra delivery heuristics would silently change the evaluated behavior and make field
  telemetry uninterpretable)
- `boundaryTriggerEmitter` (idle and selection-maintained triggers are dropped without
  replacement; execution-error is absorbed by the FM boundary; multiline paste becomes
  `sensing/collectors/paste`)
- `inactivityService` (function taken over by `featureWindow.longest_gap`)

Split:

- `compileEquivalentEmitter`: the VS-Code-reading part (diagnostics poll after save,
  500 ms settle debounce) moves to `sensing/collectors/diagnostics`; the EQ pairing
  logic stays in `eq/` and consumes only sensorHub events. After this, ONLY `sensing/`
  reads VS Code.

## 5. Tick Contract (live = replay)

One code path for both modes, injectable clock. The engine core is a deterministic
function over (event queue, tick time): at tick T, FIRST drain and apply all sensor
events with ts <= T (window updates, build delta, feedback view state, boundary
detection), THEN compute S/V/gates/alerting for T. This matches the bin semantics of
the Python reference (`engine_v2.py`). Live, a 10 s timer only calls
`tick(nominalTickTime)`; in replay, event time drives the same `tick()`. First tick at
t=10 relative to session start. Timer jitter is harmless because all computations use
event timestamps and the nominal tick time, never wall-clock "now" inside a tick.

## 6. Recording Schema v3

New events: `struggleScore` (every 10 s: S, V, individual features f_*) and `alert`
(boundary type(s), gate decisions, theta, V). `eqSnapshot` stays (passive EQ).
`configurationSnapshot` gains `engineVersion: 'v2'`. `schemaVersion: 2 -> 3`.

Not automatically tolerant: `parseRecordedData.ts` parses the `RecordedEvent` union
exhaustively and rejects unknown event types. Schema v3 is therefore explicit work in
PR 2: new types, parser branches in `parseRecordedData.ts`, replayEngine and
recording-viewer support (display may be minimal, loading must not break).

## 7. Branch Strategy

Integration branch `feat/struggle-engine-v2` (branched off `dev`, already created). ALL
PR branches below branch off this integration branch and merge ONLY back into it. `dev`
stays untouched; the final merge of `feat/struggle-engine-v2` into `dev` is a separate,
manual decision later and not part of this effort. This deliberately deviates from the
repo convention "PRs branch off dev"; PR 1 adds a note to `.claude/CLAUDE.md` so nobody
follows the wrong rule meanwhile.

## 8. PR Cut (all into `feat/struggle-engine-v2`, Conventional Commits, CHANGELOG)

1. **PR 1 `refactor(sensing)`:** Extract the sensing layer; rewire recorder and EQ
   pipeline onto the sensorHub. Principle: MOVE code, do not rewrite it. The existing
   listener semantics (enable-scoped subscriptions, generation tokens, debounces,
   consent-downgrade teardown, startup ordering) move into the collectors with their
   logic intact. Equivalence proof, three tiers: (a) existing recorder/observation unit
   tests pass unchanged (construction helpers may be updated, assertions may not),
   (b) new targeted lifecycle tests (generation-token invalidation, consent-downgrade
   teardown, debounce timing), (c) one real interactive session recorded before and
   after the refactor, diffed field by field with normalized timestamps. Recorder
   optionality keeps using the EXISTING compile-time seam (`dataCollection/noop.ts`
   substitution): `sensing/` and `struggle/` never import recording-side code;
   `verify-clean-bundle.js` stays green.
2. **PR 2 (split into three PRs, decided 2026-06-13):**
   - **PR 2a `refactor(structure)`:** Mechanical dissolution of `services/telemetry/`:
     recorder + replay → `services/recording/`, passive EQ pipeline + lint denylist →
     `services/eq/`, uriFilter + paste heuristic → `services/sensing/`. Zero behavior
     change; proof = all existing suites green unchanged.
   - **PR 2b `feat(struggle)`:** Engine v2 additive: sensorHub internal sources
     (buildResult behind buildResultGuard, taskFeedbackView) and paste channel,
     `services/struggle/` complete (structure above), port of the 26 Python
     state-machine tests plus new tick/feature tests, new v2 scenario runner.
     The v1 decision path keeps running unchanged; the engine is not yet wired
     to any UI.
   - **PR 2c `feat(struggle)`:** Switchover: v1 decision path removed,
     `intervention/` switched to AlertSink, recording schema v3 including
     parser/replay/viewer support, coordinator rework, old EQ harness retired.
3. **PR 3 `test(replay-goldens)`:** Offline replay of the 10 study sessions through the
   TS engine; comparison against the Python reference (goldens are small JSON fixtures:
   tick times and scores only, no code content). Alert times and boundary/gate decisions:
   exact match (tolerance 0, same tick discretization). S/V curves: fixtures rounded to
   6 decimals (IEEE double drift between Python and JS is possible). Runs in CI.
4. **PR 4 `feat(telemetry)`:** Next-wave additions, one commit each:
   (a) `textChange.reason` (`TextDocumentChangeEvent.reason`: undo/redo),
   (b) `windowState.active` in addition to `focused`,
   (c) problem-statement anchor offsets in the webview,
   (d) paste-origin hash (sha256 comparison clipboard vs. insert; boolean/hash only,
   consent-gated),
   (e) completion-invocation proxy (no-op `CompletionItemProvider` counting invocations
   and TriggerKind).
5. **PR 5 `docs`:** Project docs updated to v2 (architecture description, roadmap),
   README/CHANGELOG, architecture note `services/README.md` (three layers:
   sense / detect / intervene).

## 9. Verification Strategy

- Unit: state-machine tests (ported from Python, identical cases), feature-window tests,
  buildDelta tests, method-parser tests against template files.
- Integration: scenario harness (existing categories obvious/subtle/no-struggle/edge get
  v2 expectations; old EQ expectations move to the eq/ test package or are retired).
- System: golden replay of the 10 real sessions against the Python reference (PR 3);
  proves spec fidelity of the port.
- Manual: smoke test in the extension host (engine without recorder; recorder without
  engine).
- CI: lint, check-types, test:unit green on every PR; no new dependencies without
  pinned versions.

## 10. Risks and Implementation Notes

- The double-subscription untangling (PR 1) touches the recorder, which safeguards study
  integrity. That is why it is its own PR with the three-tier equivalence proof BEFORE
  the engine lands.
- The buildResult path stays behind `buildResultGuard` (cross-exercise filter); the
  regression tests (`telemetryManagerCrossExercise`) must stay green unchanged.
- A8 method parser: regex plus brace counting like the Python reference; declared
  Java-only.
- Live vs. replay is solved by the tick contract (one code path, queue drain rule,
  injected clock); see section 5.
- `taskFeedbackView` events originate in our own UI layer, so the sensorHub needs
  internal (non-VS-Code) sources; type them cleanly as internal sensors.
- PR 1 before/after diff (tier c): normalize ONLY nondeterministic fields. Do not
  normalize away ordering, debounce-relative timing, or startup marker positions, or the
  check can miss real recorder drift.
- Define canonical timestamps per sensor event type up front (save-triggered diagnostics
  snapshots, terminal end, build-result arrival): live/replay parity depends on
  consistent stamping.
