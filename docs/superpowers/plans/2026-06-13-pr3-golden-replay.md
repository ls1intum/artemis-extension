# PR 3 — Engine v2 Golden-Replay Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the TypeScript Engine v2 port reproduces the frozen Python reference (`IrisStudyData/analysis/lib/engine_v2.py`) by replaying the 10 real study sessions through the TS engine and comparing tick-for-tick — as a **local-only** verification (deliberately NOT a CI gate, per Liam's decision), with no study-derived data committed to the repo.

**Architecture:** All replay/harness/runner code lives in the **test tree** (`extension/test/golden-replay/`) and runs as a **dedicated local Vitest target** (`npm run test:golden-replay`, excluded from the default test run, additionally guarded by `skipIf(!IRIS_STUDY_DATA)`). It never enters the shipped import graph, so the Open-VSX clean bundle is unaffected by construction. A `ReplaySensorHub` reconstructs file text + signals from a recorded session's `events.jsonl` and drives the existing `StruggleEngine`. A Python generator (in IrisStudyData, where the data is) exports the reference engine's per-tick output as JSON goldens. Comparison runs in two modes: **exact** (engine-math fidelity, tolerance 0 / 6-decimal, with the reference's `f_a8`/`f_n2`/paste signals injected) and **causal** (honest end-to-end characterization of the 3 declared live deviations). Only harness/runner/methodology code is committed; goldens, sessions, and per-session results stay local + gitignored.

**Tech Stack:** TypeScript (strict, `@extension/*` aliases), Vitest (with an extended `vscode` stub), Python 3 + pandas/numpy/pyarrow (reference, read-only — frozen, never modified).

**Codex review:** plan reviewed across 3 rounds; all critical/high findings folded in (test-tree+Vitest target, injectable trackers seam, full text reconstruction, ResultDTO rehydration, no-study-data, schema/ordering/invariant fixes) before approval.

---

## Context for the implementer

Engine v2 (the struggle-detection engine) was ported from a frozen Python reference into `extension/src/extension/services/struggle/` in PR 2b and switched live in PR 2c. This PR adds an **offline verification** that the port is faithful to the reference on real study data.

**Branch:** All work happens on a new branch `feat/struggle-golden-replay` cut from the integration branch `feat/struggle-engine-v2` (NOT from `dev`). It merges back into `feat/struggle-engine-v2` via squash PR. `dev` stays untouched.

**The two sides being compared:**

| | Python reference (FROZEN) | TS engine (under test) |
|---|---|---|
| Location | `/Users/liamberger/Documents/private/IrisStudyData/analysis/lib/engine_v2.py` | `extension/src/extension/services/struggle/` |
| Entry | `run_pipeline(pid, builds, pastes, emm, errors)` + `full_alerts(pipe, theta, grace_s)` | `StruggleEngine` driven by a `SensorHub`, ticked via `advanceTo` |
| Per-tick output | `feat` DataFrame rows + `run_state_machine` audit rows | `TickRecord` (+ `AlertRecord`) on `onDidTick`/`onDidAlert` |

**Field correspondence (verified against both sources):**

| Python `feat` column (engine_v2.py:350-369) | TS `TickRecord` field |
|---|---|
| `t` | `t` |
| `effective_window_s` | `features.effectiveWindowS` |
| `n_1char_inserts` | `features.nOneCharInserts` *(confirm exact field name when reading FeatureVector)* |
| `scroll_events` | `features.scrollEvents` *(confirm)* |
| `typing_rate`, `n4_ratio`, `longest_gap_s` | `features.typingRate`, `n4Ratio`, `longestGapS` |
| `f_typing`, `f_gap`, `f_n4` | `features.fTyping`, `fGap`, `fN4` |
| `f_fb`, `f_a8`, `f_n2` | `features.fFb`, `fA8`, `fN2` |
| `S_base`, `S`, `V`, `fast_decay` | `sBase`, `s`, `v`, `fastDecay` |
| `ts_state`, `n4_state` | `features.tsState`, `n4State` *(confirm)* |
| boundary flags `FM/FM_PLUS/E4/N1/STATE` | `boundariesPreGate` |

| Python `run_state_machine` audit (engine_v2.py:592-602) | TS `AlertRecord` |
|---|---|
| `t`, `v` | `t`, `v` |
| `types_pre_gate`, `types`, `primary` | `typesPreGate`, `types`, `primary` |
| `path` (`armed`/`e6`), `in_warmup`, `in_grace` | `path`, `inWarmup`, `inGrace` |

> **Implementer:** before Task 2, READ `services/struggle/types.ts` (the `FeatureVector` interface) to confirm the exact field names for the 1-char-insert count, scroll count, `tsState`, `n4State`. Use the real names; the table above marks the uncertain ones.

**Session format (`IrisStudyData/VSCode Recorded Data/P{n}-Name-.../`):** `metadata.json` (`startTime`, `endTime`, `eventCount` in epoch-ms) + `events.jsonl` (one JSON event per line, `{type, timestamp, ...payload}`). Time base = seconds since `metadata.startTime`. This is the exact format the recorder writes (`RecordedEvent`). All 10 sessions have startup `fileSnapshot` events (verified).

---

## THE CENTRAL DESIGN DECISION: the declared causal deviations

The Python reference consumes **retrospective, whole-session artifacts** for three signals; the live TS engine derives them **causally (online, no look-ahead)**. These are the declared deviations from the spec (`ENGINE_V2_SPEC.md`; port memory). Located precisely:

1. **A8 (`f_a8`, +0.15 severity)** — Python `_canonical_method_map` (engine_v2.py:93) maps transient method names to the *most frequent name over the whole session*. Live TS canonicalizes session-so-far. (`signals/regionPersistence.ts` + `signals/javaMethods.ts`.)
2. **N2 (`f_n2`, +0.10)** — Python `active = (e_first <= t) & ((t <= e_last) | ~resolved)` (engine_v2.py:328) needs look-ahead (`e_last`, `resolved`). Live TS is active-until-removal. (`signals/errorDistance.ts`.)
3. **N1 (paste boundary)** — Python `paste_t` from `paste_events.parquet` (recorded v1 paste-trigger union). Live TS uses the deterministic paste rule. (`sensing/` paste channel → `onPasteDetected`.)

Everything else (`f_typing`/`f_gap`/`f_n4`/`S_base`, `typing_rate`/`longest_gap_s`/`n4_ratio`, the `FM`/`FM_PLUS`/`E4`/`STATE` boundaries, decay `V(t)`, gates, state machine) is **deviation-free**: it depends only on events both sides observe identically.

`V(t)` has cross-tick memory (decay), so a deviation that flips `S` at tick *i* contaminates `V` at tick *i* and onward until it re-converges. Therefore end-to-end `V`/alert exactness **cannot** be asserted in the presence of any deviation disagreement — which is why the exact claim requires injecting the reference's deviation-affected signals.

### Two comparison modes (both local)

- **Mode `exact` — engine-math fidelity (the rigorous tolerance-0 claim).** Feed the TS engine the *same* deviation-affected signals the reference used: the Python generator exports, per tick, the reference's `f_a8`/`f_n2` (0/1) and the reference's paste **event times**; the harness drives the engine with scripted A8/N2 tracker doubles (returning the golden's `f_a8`/`f_n2`) and fires `onPasteDetected` at the golden's paste event times **with causal paste derivation suppressed** (no double N1). Everything else (`f_typing`/`f_gap`/`f_n4`, builds, terminal, decay, gates, state machine) is derived by the TS engine from the recorded events. Then **every** quantity must match: `S_base`/`S`/`V`/`f_*`/`typing_rate`/`longest_gap_s`/`n4_ratio` to 6 decimals, all boundaries + all alerts (`t`, `typesPreGate`, `types`, `primary`, `path`, `inWarmup`, `inGrace`) **exactly**. This isolates and proves the ported *math* on real-session inputs, independent of the sensing layer.
- **Mode `causal` — honest end-to-end characterization.** The TS engine derives everything causally (no injection, real paste derivation); compare to the Python retrospective goldens and **report** the divergence (per-tick `S`/`V` deltas, alert count/timing diffs, deviation-disagreement tick counts). NOT asserted exact; documents what the *live extension* does versus the offline reference, and quantifies deviation impact (thesis Ch. 6/8). Results stay local.

**Rejected alternatives (for the record):** (A) *causal adapters in Python* — duplicates causal logic in a second language, fragile, and the duplicate would itself be unverified. (B) *partitioned no-injection assertion* — cannot prove `V`/alert exactness end-to-end because of decay memory.

### Engine seam (the ONLY production change): injectable A8/N2 trackers

Exact mode needs scripted A8/N2. The cleanest seam is **dependency injection of the trackers** (not a replay-mode branch in `_runTick`). N1 needs no engine change (it is already a hub channel, `onPasteDetected` at struggleEngine.ts:266).

In `StruggleEngine`:
- Define narrow interfaces matching today's trackers' used surface, e.g.
  ```ts
  export interface A8TrackerLike { recordChange(tS: number, uriKey: string, method: string | null): void; activeAt(tS: number): boolean; reset(): void; }
  export interface N2TrackerLike { ingestSelection(tS: number, uriKey: string, endLine: number): void; ingestSnapshot(tS: number, uriKey: string, errors: ...): void; activeAt(tS: number): boolean; reset(): void; }
  ```
  (Read `regionPersistence.ts`/`errorDistance.ts` for the exact method set; the interfaces must be the engine-used subset.)
- Add an optional ctor option `trackers?: { a8?: () => A8TrackerLike; n2?: () => N2TrackerLike }`; `_resetState()` uses `this._opts.trackers?.a8?.() ?? new A8Tracker()` (same for n2). Default path byte-identical to today.
- The harness's **exact** mode passes factories returning scripted doubles seeded from the golden's per-tick `f_a8`/`f_n2`. Its **causal** mode passes nothing (real trackers).

If the implementer finds a method on the concrete tracker the engine calls that the interface misses, widen the interface — do not cast.

---

## File Structure

**New — committed (all under the TEST TREE, never ships):**
- `extension/test/golden-replay/goldenTypes.ts` — golden JSON schema + strict `parseGoldenSession` validator + the injection-signal shape.
- `extension/test/golden-replay/textReconstruction.ts` — per-URI text state from `fileSnapshot` + `textChange` deltas (reuse the algorithm in `extension/scripts/roundtrip-recording.ts`; extract a shared helper if clean, else port faithfully).
- `extension/test/golden-replay/fakeVscode.ts` — minimal `Uri` (valid `scheme`/`fsPath`/`toString`), `TextDocument` (`uri`, `getText`), `TextEditor` (`document.uri`, `selections[].end.line`, `visibleRanges`) shims for replay.
- `extension/test/golden-replay/replaySensorHub.ts` — `RecordedEvent[]` → `SensorHub` signals (with text reconstruction, diagnostics map, ResultDTO rehydration, paste derive|inject).
- `extension/test/golden-replay/buildResultRehydrate.ts` — recorded `buildResult` event → minimal `ResultDTO`.
- `extension/test/golden-replay/scriptedTrackers.ts` — `A8TrackerLike`/`N2TrackerLike` doubles backed by a per-tick lookup from the golden.
- `extension/test/golden-replay/struggleReplay.ts` — the harness: drive `StruggleEngine` over the grid, return `{ durationS, ticks, alerts }`; modes exact|causal.
- `extension/test/golden-replay/goldenCompare.ts` — `compareExact` + `summarizeCausal`, structured diff (first divergence, max delta, counts).
- `extension/test/golden-replay/invariants.ts` — up-front guards (feedbackView matched-close; every `textChange` URI has reconstructed text state — from a startup `fileSnapshot` or a prior open — before its first change; `golden.theta===SPEC.THETA_FULL && golden.graceS===SPEC.GRACE_S`).
- `extension/test/golden-replay/goldenReplay.test.ts` — the local Vitest suite: `describe.skipIf(!process.env.IRIS_STUDY_DATA)`, loops the 10 sessions, exact (assert) + causal (report).
- `extension/test/golden-replay/*.unit.test.ts` — fast unit tests for the harness pieces (synthetic data only; run in the dedicated target).
- `extension/vitest.golden-replay.config.mts` — dedicated config including ONLY `test/golden-replay/**`.
- `docs/struggle/golden-replay-verification.md` — methodology + reproduction steps ONLY (no per-pid numbers).

**New — local, NOT committed (outside the repo):**
- `/Users/liamberger/Documents/private/IrisStudyData/analysis/scripts/26_export_ts_goldens.py` — per session: `run_pipeline` + `full_alerts` → golden JSON (incl. per-tick `f_a8`/`f_n2` + paste event times). Writes to a local dir.

**Modified — committed:**
- `extension/src/extension/services/struggle/struggleEngine.ts` — injectable-tracker ctor option (the only `src/` change).
- `extension/test/react/__helpers__/vscode.stub.ts` (or the shared stub the configs use) — extend additively with a working `EventEmitter` + minimal `Disposable` (the engine constructs real `vscode.EventEmitter`s; today's stub only has `DiagnosticSeverity` + `Uri.parse`). Additive → safe for existing suites.
- `extension/package.json` — `"test:golden-replay": "vitest run --config vitest.golden-replay.config.mts"`; ensure the default `test:react`/vitest include does NOT pick up `test/golden-replay/**`.
- `extension/vitest.config.mts` — exclude `test/golden-replay/**` from the default include.
- `.gitignore` — ignore the local goldens/output dir (e.g. `extension/.golden-replay/`).
- `CHANGELOG.md` — generic Internal entry (no baked-in numbers).

---

## Task 0: Branch + plan

- [ ] **Step 1:** `cd /Users/liamberger/Documents/private/MA/artemis-extension && git status && git branch --show-current` → branch `feat/struggle-engine-v2`, clean tree.
- [ ] **Step 2:** `git checkout -b feat/struggle-golden-replay`
- [ ] **Step 3:** `git add docs/superpowers/plans/2026-06-13-pr3-golden-replay.md && git commit -m "docs(struggle): PR3 golden-replay verification plan"`

---

## Task 1: Engine seam — injectable A8/N2 trackers (only production change)

**Files:** Modify `extension/src/extension/services/struggle/struggleEngine.ts`; Test `extension/test/logic/struggle/engineTrackerInjection.test.ts` (vitest logic; needs the extended vscode stub from Task 2 Step 0 — do Task 2 Step 0 first, or co-locate the stub extension here).

- [ ] **Step 0 (prereq): extend the shared vscode stub** with a real-enough `EventEmitter` (subscribe/fire/dispose) + minimal `Disposable`. Run an existing engine-touching logic test to confirm no regression.
- [ ] **Step 1: Write failing test** — construct `StruggleEngine` with injected scripted A8 (`activeAt(t)=t>=100`) + N2 (`activeAt=false`) via the new ctor option, drive a synthetic idle session, assert `TickRecord.features.fA8===1` for `t>=100` regardless of edits, and assert the default (no option) path is unchanged on an existing scenario expectation.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the `A8TrackerLike`/`N2TrackerLike` interfaces (engine-used subset, read the concrete trackers) + the `trackers?` ctor option used in `_resetState`. Default byte-identical.
- [ ] **Step 4: Run → PASS.** Also run the full vitest logic suite + (compile-tests) unit label to confirm no regression.
- [ ] **Step 5: Commit**

```bash
git add extension/src/extension/services/struggle/struggleEngine.ts extension/test/react/__helpers__/vscode.stub.ts extension/test/logic/struggle/engineTrackerInjection.test.ts
git commit -m "feat(struggle): injectable A8/N2 trackers for replay verification"
```

---

## Task 2: Golden schema + parser + invariants

**Files:** Create `extension/test/golden-replay/goldenTypes.ts`, `invariants.ts`; Test `goldenTypes.unit.test.ts`.

- [ ] **Step 1: Write failing test** — `parseGoldenSession` accepts a minimal well-formed golden, rejects a malformed one; `assertSpecConstants(golden)` throws when `golden.theta !== SPEC.THETA_FULL` or `golden.graceS !== SPEC.GRACE_S`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `GoldenTick` (all fields incl. `nOneCharInserts`, `scrollEvents`, `tsState`, `n4State`), `GoldenAlert` (incl. `typesPreGate`), `GoldenInject` `{ fA8: [number, 0|1][]; fN2: [number, 0|1][]; pasteEventTimes: number[] }`, `GoldenSession`. Import `BoundaryType` from `@extension/services/struggle/constants`. Strict validator (no unchecked casts). In `invariants.ts`: `assertSpecConstants`, `assertFeedbackViewMatched(events)`, `assertSnapshotBeforeChange(events)`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(struggle): golden-replay schema, parser, invariants`.

---

## Task 3: Text reconstruction + fake vscode shims

**Files:** Create `textReconstruction.ts`, `fakeVscode.ts`; Test `textReconstruction.unit.test.ts`.

- [ ] **Step 1: Read `extension/scripts/roundtrip-recording.ts`** — it already replays `fileSnapshot` + `textChange` to reconstruct file text. Extract/port its reconstruction into `textReconstruction.ts` (`class FileTextState { seedSnapshot(uri, text); applyChanges(uri, changes[]): void; getText(uri): string | undefined }`). If a clean shared extraction from the script is possible without coupling, prefer it; else port faithfully and note the shared origin.
- [ ] **Step 2: Write failing test** — seed a snapshot, apply a couple of `textChange` change arrays (VS Code semantics: offsets vs the pre-event state, descending application), assert reconstructed text. Mirror the Python `apply_event_changes` validation order.
- [ ] **Step 3: Run → FAIL → implement → PASS.**
- [ ] **Step 4: Implement `fakeVscode.ts`** — `makeUri(recordedUriString)` producing `{ scheme, fsPath, path, toString() }` that satisfies `shouldRecordUri()` (uriFilter.ts:57 uses `scheme` + `fsPath`); `makeDocument(uri, getText)`; `makeEditor(uri, selections, visibleRanges)`. Unit-test that `shouldRecordUri(makeUri(<a recorded session uri>))` is true.
- [ ] **Step 5: Commit** `feat(struggle): replay text reconstruction + fake vscode shims`.

---

## Task 4: ReplaySensorHub + buildResult rehydration

**Files:** Create `replaySensorHub.ts`, `buildResultRehydrate.ts`; Test `replaySensorHub.unit.test.ts`, `buildResultRehydrate.unit.test.ts`.

- [ ] **Step 1: Read** `services/recording/types.ts` (the `textChange`, `diagnostics`, `selectionChange`, `visibleRangeChange`, `terminalCommand`, `buildResult`, `taskFeedbackView`, `fileSnapshot` member shapes), `services/recording/eventCollectors.ts` (how `buildResult` was recorded), `services/struggle/signals/buildDelta.ts` (which `ResultDTO` fields it consumes: `submission.buildFailed`, `feedbacks[].detailText`/positive — confirm), `services/sensing/sensorHub.ts` (the `SensorHub` interface + signal payload shapes).
- [ ] **Step 2: buildResult rehydration (TDD).** Write failing parity tests: a rehydrated `ResultDTO` from a recorded `buildResult` event, fed to `buildDelta.ingest`, classifies as the expected delta across all six classes — `compile-error`, `first`, `identical-set`, `improved`, `worse`, `same-count` — asserted against the **TS build-delta contract** (synthetic expected values, not "Python by implication"). Implement `buildResultRehydrate.ts` → PASS.
- [ ] **Step 3: ReplaySensorHub (TDD).** Write failing tests on a small synthetic `RecordedEvent[]` (sessionStart + fileSnapshot + 2 textChanges + diagnostics + terminalCommand + buildResult + taskFeedbackView): subscribe to each engine-consumed channel, `pumpUpTo`, assert each fires once with the mapped payload at the correct session-relative time; `readDiagnostics(uri)` reflects state-at-pump; `readTextDocuments()` returns startup-snapshot docs.
- [ ] **Step 4: Implement `ReplaySensorHub`.** Back each channel with a `vscode.EventEmitter`. `constructor(events, { pasteMode: 'derive' | 'inject'; injectedPasteEventTimes?: number[] })`. Maintain `FileTextState`; fake docs return reconstructed text. Map:

| RecordedEvent | Hub signal |
|---|---|
| `fileSnapshot` | seed `FileTextState`; contribute to `readTextDocuments()` startup set |
| `textDocumentOpen` | `onDidOpenTextDocument` (fake doc with reconstructed text) |
| `textChange` | apply to `FileTextState`; fire `onDidChangeTextDocument` (fake doc `getText()` = post-change text; `contentChanges` carry `range.start.line`, `rangeLength`, `text`) |
| `selectionChange` | `onDidChangeTextEditorSelection` (fake editor; `selections[0].end.line`) |
| `visibleRangeChange` | `onDidChangeTextEditorVisibleRanges` |
| `diagnostics` | update diagnostics map; `onDidChangeDiagnostics` |
| `terminalCommand` | `onDidEndTerminalShellExecution` |
| `buildResult` | rehydrate → `onBuildResult({ result })` |
| `taskFeedbackView` | `onTaskFeedbackView` |
| paste | `pasteMode==='derive'`: detect from `textChange` via the live paste heuristic (reuse `sensing/` paste detector) and fire `onPasteDetected`; `pasteMode==='inject'`: fire `onPasteDetected` at each `injectedPasteEventTimes` and DERIVE NOTHING (no double N1) |

`pumpUpTo(tS)` fires all not-yet-fired signals with session-relative time ≤ `tS`, **preserving original event order for equal timestamps**, and enqueues a derived/injected paste **immediately after its parent/scheduled time** so the engine's stable queue-drain order matches.
- [ ] **Step 5: Run → PASS. Commit** `feat(struggle): replay sensor hub + buildResult rehydration`.

---

## Task 5: Replay harness

**Files:** Create `struggleReplay.ts`, `scriptedTrackers.ts`; Test `struggleReplay.unit.test.ts`.

- [ ] **Step 1: Write failing tests** — `scriptedTrackers`: an `A8TrackerLike` built from `[[t, v]]` returns `v` at `activeAt(t)` and `false` elsewhere. `replaySession(events, { mode: 'causal' })`: a synthetic idle session yields ticks `[10,20,...]` and a `STATE` alert (mirror `struggleCoordinator.test.ts`'s idle case). `replaySession(events, { mode: 'exact', inject })`: with injected `fA8`/`fN2`/paste, the resulting tick features equal the injected values.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `struggleReplay.ts`**

```ts
export interface ReplayResult { durationS: number; ticks: TickRecord[]; alerts: AlertRecord[]; }
export function replaySession(events: RecordedEvent[], opts: { mode: 'exact'; inject: GoldenInject } | { mode: 'causal' }): ReplayResult {
    // assert invariants (feedbackView matched-close, snapshot-before-change)
    // sessionStartMs + durationS from metadata (passed in) / sessionStart
    // hub = new ReplaySensorHub(events, opts.mode==='exact'
    //         ? { pasteMode: 'inject', injectedPasteEventTimes: opts.inject.pasteEventTimes }
    //         : { pasteMode: 'derive' })
    // trackers = opts.mode==='exact' ? { a8: () => scriptedA8(opts.inject.fA8), n2: () => scriptedN2(opts.inject.fN2) } : undefined
    // engine = new StruggleEngine(hub, fixedClock, { preDebouncedIntake: true, trackers })
    // collect onDidTick/onDidAlert; engine.start({ sessionStartMs })
    // for tS of ticksFor(durationS): hub.pumpUpTo(tS); engine.advanceTo(sessionStartMs + tS*1000)
    // engine.stop(); return { durationS, ticks, alerts }
}
```
Deterministic injected clock (no real timers). `ticksFor(durationS)` mirrors Python `ticks_for`.
- [ ] **Step 4: Run → PASS. Commit** `feat(struggle): replay harness (exact + causal)`.

---

## Task 6: Comparator

**Files:** Create `goldenCompare.ts`; Test `goldenCompare.unit.test.ts`.

- [ ] **Step 1: Write failing tests** — `compareExact`: identical → ok; `v` perturbed 1e-7 → ok (6-dec tol); 1e-5 → not ok with first-diverging tick; flipped `primary` or differing `typesPreGate` → not ok. `summarizeCausal`: returns counts (ticks compared, `fA8`/`fN2`/paste-disagreement ticks, max abs `S`/`V` delta, alert count delta) without throwing.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `const TOL = 1e-6;` `compareExact` (tick count; every numeric field within TOL incl. `nOneCharInserts`/`scrollEvents`/`typingRate`/`n4Ratio`/`longestGapS`/`sBase`/`s`/`v`/`f*`; `tsState`/`n4State` exact; boundaries deep-equal; alerts deep-equal on `t`/`typesPreGate`/`types`/`primary`/`path`/`inWarmup`/`inGrace`). Report the FIRST divergence with full context. `summarizeCausal` partitions by deviation-signal agreement, asserts nothing.
- [ ] **Step 4: Run → PASS. Commit** `feat(struggle): golden comparison (exact + causal report)`.

---

## Task 7: Vitest target + Python generator + the verification run

**Files:** Create `vitest.golden-replay.config.mts`, `goldenReplay.test.ts`; Modify `package.json`, `vitest.config.mts`, `.gitignore`; Create (local, NOT committed) `IrisStudyData/analysis/scripts/26_export_ts_goldens.py`.

- [ ] **Step 1: Dedicated Vitest target.** `vitest.golden-replay.config.mts` includes only `test/golden-replay/**`, same `vscode` alias as the default config. Add `"test:golden-replay"` script. Exclude `test/golden-replay/**` from the default `vitest.config.mts` include so the normal `test:react` run never collects it.
- [ ] **Step 2: The local suite `goldenReplay.test.ts`** — `describe.skipIf(!process.env.IRIS_STUDY_DATA)`. Resolve sessions dir + goldens dir from env (`IRIS_STUDY_DATA`, `GOLDEN_DIR`). Per pid: read `events.jsonl` + metadata (durationS), parse golden, `assertSpecConstants`; run exact (assert `compareExact.ok`, surfacing the first divergence) + causal (collect `summarizeCausal`, log a table). When the env is unset, the whole suite is skipped — proving CI-safety.
- [ ] **Step 3: Python generator (local).** Implement `26_export_ts_goldens.py`: for each pid P1..P10 (golden replay is fidelity, not eval — all 10 usable, no labels touched), load the four artifacts filtered to pid, `pipe = ev2.run_pipeline(...)`, `theta = params['v2_theta_full']`, `grace_s = params['grace_s']`, `res = ev2.full_alerts(pipe, theta, grace_s)`. Emit `GoldenSession` JSON: per-tick from `pipe['feat']` (round floats to 6 decimals), boundaries from `pipe['boundaries']['flags']` (BOUNDARY priority order), alerts from `res['audit']`, `inject` = per-tick `f_a8`/`f_n2` arrays + paste **event times** (`inputs['paste_t']`). Write to a local `$OUT` dir. NEVER edit the frozen lib.
- [ ] **Step 4: Run the generator locally; sanity-check** tick counts per pid against the `24_engine_v2.py` console output / `RESULTS_v2_freeze.md`.
- [ ] **Step 5: Run the verification locally over all 10 sessions.**
  - `cd extension && IRIS_STUDY_DATA="/Users/liamberger/Documents/private/IrisStudyData" GOLDEN_DIR="<local-out>" npm run test:golden-replay`
  - **Exact mode is the moment of truth.** Any mismatch is a real port/harness/mapping bug — diagnose via the first-divergence report and fix the ROOT CAUSE (engine, harness, mapping; never the frozen Python, never the golden, never the tolerance). If a divergence is a genuine justified port choice, document it and get sign-off; do not loosen tolerance.
  - Record causal-mode numbers **locally** for the report (do not commit them).
- [ ] **Step 6: `.gitignore`** the local out dir. **Commit** the target + suite (NOT data):

```bash
git add extension/vitest.golden-replay.config.mts extension/vitest.config.mts extension/package.json extension/test/golden-replay/goldenReplay.test.ts .gitignore
git commit -m "feat(struggle): local golden-replay vitest target"
```

---

## Task 8: Report + finalize

**Files:** Create `docs/struggle/golden-replay-verification.md`; Modify `CHANGELOG.md`.

- [ ] **Step 1: Report — methodology + reproduction ONLY.** Describe the two modes, the injection rationale, the declared deviations + the guarded invariants, and the exact steps to reproduce locally (generator script path + invocation + the `test:golden-replay` command with env vars). State the exact-mode pass criterion (6-dec S/V, exact boundaries/alerts) and that causal-mode numbers are produced locally and intentionally not committed. **No per-pid results, no study-derived numbers/conclusions.**
- [ ] **Step 2: CHANGELOG** — generic Internal entry, no baked-in numbers, e.g.: "Added a local (non-CI) golden-replay verification that replays recorded sessions through the Engine v2 TS port and checks engine-math fidelity against the frozen reference; study data and per-session results stay local."
- [ ] **Step 3: Commit** `docs(struggle): golden-replay verification methodology`.

---

## Final gates (before the PR)

- [ ] `cd extension && npm run check-types` → exit 0
- [ ] `npm run lint` → exit 0
- [ ] `npm run knip` → exit 0 (the golden-replay test modules are exercised by their unit tests + the suite; if knip flags any, prefer wiring; an ignore must be justified in `knip.json`)
- [ ] `npm run test:react` (vitest default) → green AND confirm it did NOT collect `test/golden-replay/**`
- [ ] `npm run test:golden-replay` with NO `IRIS_STUDY_DATA` → suite skipped, exit 0 (CI-safety proof); with the dataset → exact mode passes
- [ ] `npm run compile-tests && npx vscode-test --label unit` → 0 failures (engine seam didn't regress)
- [ ] `node esbuild.js --production && node esbuild.js --production --variant=openvsx && node scripts/verify-clean-bundle.js` → **clean bundle still green** (replay code is in `test/`, never bundled; the engine seam adds no recording import). Confirm.

## Out of scope (raised at plan review)

Task #8's title mentions "Review-Panel." This plan delivers the verification only. A new panel is out of scope because the recording-viewer already renders schema-v3 `struggleScore`/`alert` events (PR 2c), so replay output can be inspected there if needed (optional later `--emit-recording` from the harness), and "local-only" argues against shipping new UI. Confirm this satisfies the "Review-Panel" intent.

## Invariants
- Frozen reference: never edit `engine_v2.py`, `replay.py`, `features.py`, or any IrisStudyData artifact. Read-only.
- No study-derived data in the repo: goldens, sessions, runner output, and per-pid numbers stay local + gitignored. Only harness/runner/methodology code is committed.
- No re-tuning, no tolerance-loosening: a mismatch is fixed in the port or harness, never by changing constants or tolerances.
- Eval-set burn (P1/P3/P7/P9) is irrelevant — golden replay touches no labels.
