# Engine v2 Golden-Replay Verification

A **local** verification that the TypeScript Engine v2 port (`extension/src/extension/services/struggle/`) faithfully reproduces the frozen Python reference engine, by replaying recorded study sessions through the TS engine and comparing the per-tick output tick-for-tick.

This is **not** a CI gate, and **no study-derived data is committed** to this repository. Only the harness, the runner, and this methodology document live here. The session recordings, the generated goldens, and all per-session numbers stay local (the local output directory is gitignored).

## Why

PR 2b ported the data-derived engine from the Python reference; PR 2c switched it live. Component tests proved each piece in isolation. This verification closes the loop end-to-end: it confirms that, fed the same inputs, the ported engine produces the same severity curve, dynamics, boundaries, gates, and alerts as the reference — on real sessions, not synthetic fixtures.

## The two reference sides

| | Python reference (frozen, never edited) | TS engine (under test) |
|---|---|---|
| Location | `IrisStudyData/analysis/lib/engine_v2.py` | `extension/src/extension/services/struggle/` |
| Entry | `run_pipeline(pid, …)` + `full_alerts(…)` | `StruggleEngine` driven by a `SensorHub`, ticked via `advanceTo` |
| Per-tick output | `feat` rows + `run_state_machine` audit | `TickRecord` / `AlertRecord` |

The recorded `events.jsonl` is the same format the extension's session recorder writes, so the TS side replays exactly the stream the recorder produced.

## The three declared deviations

The reference consumes whole-session, retrospective artifacts for three signals; the live TS engine derives them causally (online, no look-ahead). These are the spec's declared deviations:

1. **A8** (`f_a8`, region-persistence severity bonus) — reference canonicalizes transient method names over the whole session; live canonicalizes session-so-far.
2. **N2** (`f_n2`, distant-active-error bonus) — reference uses each error's last-seen time and eventual-resolution flag (look-ahead); live is active-until-removal.
3. **N1** (paste boundary) — reference uses the recorded v1 paste-trigger set; live uses the deterministic paste heuristic.

Everything else (base severity `f_typing`/`f_gap`/`f_n4`, the `FM`/`FM_PLUS`/`E4`/`STATE` boundaries, the decay `V(t)`, the gates, and the alert state machine) is deviation-free.

## Two comparison modes

Because `V(t)` carries decay memory, a deviation that shifts `S` at one tick contaminates `V` onward, so end-to-end exactness can only be asserted when the deviation-affected signals are held identical. Hence two modes:

- **exact** — proves the ported *math*. The Python generator exports, per tick, the reference's `f_a8`/`f_n2` and the reference's paste event times; the harness drives the engine with scripted A8/N2 trackers and injected paste (causal paste derivation suppressed), while base features, builds, terminal, decay, gates, and the state machine are derived by the TS engine from the recorded events. Every quantity must match: `S`/`V`/`S_base`/features to 6 decimals; boundaries and alerts (incl. pre-gate types, primary, path, warmup/grace flags) exactly.
- **causal** — characterizes the *live* engine. The TS engine derives A8/N2/paste online; the harness reports (does not assert) the divergence from the offline reference. This quantifies the real-world impact of the three deviations. Its numbers are produced locally and intentionally not committed.

## Guarded invariants

The harness asserts up front (failing loud rather than producing silently-wrong output):
- the golden's `theta`/`graceS` match the TS `SPEC` constants (within float tolerance for `graceS`, whose derivation carries IEEE noise below any gating granularity);
- every `taskFeedbackView` close has a matching prior open (mirrors the reference);
- every `textChange` URI has a prior `fileSnapshot`/`textDocumentOpen` baseline.

## Reproduce locally

1. Generate the goldens from the frozen reference (in the analysis repo, with its venv):

   ```
   IrisStudyData/analysis/.venv/bin/python IrisStudyData/analysis/scripts/26_export_ts_goldens.py --out <local-goldens-dir>
   ```

2. Run the verification (from `extension/`), pointing at the study data root and the goldens:

   ```
   IRIS_STUDY_DATA=<study-data-root> GOLDEN_DIR=<local-goldens-dir> npm run test:golden-replay
   ```

   Without `IRIS_STUDY_DATA`/`GOLDEN_DIR` set, the dataset suite skips (the harness unit tests still run), so the target is safe on any machine.

## Outcome

Exact mode passes for every replayed session: the port reproduces the reference engine's per-tick severity, dynamics, boundaries, and alerts with no divergence (6-decimal numeric tolerance; exact boundary/alert match). Causal mode shows the expected, bounded divergence attributable to the three declared deviations, with the live engine's intervention behavior matching the reference; the per-session figures are recorded locally for the thesis evaluation and are not committed here.

## Code map

- `extension/test/golden-replay/` — harness (replay sensor hub, text reconstruction, build-result rehydration, scripted trackers), comparator, invariants, schema, and the dataset suite. Test-tree only; never shipped.
- `extension/vitest.golden-replay.config.mts` + `npm run test:golden-replay` — the dedicated local target (excluded from the default `test:react` run).
- `IrisStudyData/analysis/scripts/26_export_ts_goldens.py` — the golden generator (lives with the data; not in this repo).
