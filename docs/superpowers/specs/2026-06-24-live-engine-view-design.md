# Live Engine View — Design Spec

- **Date:** 2026-06-24
- **Status:** Draft for review (brainstorm-approved 2026-06-24)
- **Target:** `artemis-extension`, Engine v3 (`feat/struggle-engine-v3`)
- **Eventual home of this file:** `artemis-extension` → `docs/superpowers/specs/` on a branch off `feat/struggle-engine-v3`.

## Context & Goal

The extension already has a **Struggle Detection page** (`src/webview/views/StruggleDetection/StruggleDetectionView.tsx`), reachable from the Dashboard (HeartPulse button). On `feat/struggle-engine-v3` it shows a reduced status (`urgency`, `isStruggling`).

Goal: rebuild that page so that, **in developer mode**, it shows what the v3 engine is doing **live** — the urgency/severity curve over the session, which boundaries fired, which alerts fired or were suppressed, and **which gate is currently suppressing** an alert. This is an inspection / tuning / thesis-demonstration tool.

The v3 engine already emits everything needed per 10s grid tick via `onDidTick` (`TickRecord`: `t`, `ts`, `features`, `sBase`, `s`, `v`, `fastDecay`, `boundariesPreGate`, `alert`) and `onDidAlert` (`AlertRecord`). The only missing datum is **why** a tick did/did not fire (the gate decision), which today is implicit (`alert === null`).

## Non-Goals

- No student-facing live curve. In non-developer mode the page keeps the existing reduced view. The rich live section is developer-mode only. (Decision 2026-06-24: "im dev modus wird alles gezeigt und sonst nicht".)
- No change to engine behaviour, thresholds, or detection logic. Display only.
- No new end-to-end test in a real VS Code host (consistent with the prior analysis: engine logic is covered by the scenario harness + golden-replay; a live-host e2e would mostly re-test wiring and be flaky).
- No reuse of / change to the separate `recording-viewer` (architecture choice A: live view lives **in the extension page**).

## Core Principle: Self-Explaining UI (no unexplained jargon)

**Hard requirement (Liam, 2026-06-24): nothing cryptic may be shown to a user OR a developer without a plain-language explanation.** Every internal code, abbreviation, gate, boundary, metric, and symbol rendered in the view MUST have:

1. a **fully spelled-out** primary text that states what the value actually is — written out as completely as possible (default to more words, not fewer), and for a number its **unit and range** (e.g. "0.00–1.00", "seconds") — never a terse noun, never the internal code, and
2. an inline explanation reachable without leaving the view (tooltip on hover/focus + a collapsible legend) adding the deeper detail, and
3. a single source of truth: one glossary module (see "Glossary") that both the displayed text and the tooltips read from, so wording never drifts.

Concretely: never render a bare `FM`, `B2`, `θ`, `sBase`, `V(t)` — and do **not** even settle for a terse label like "Urgency". Spell the value out: show e.g. "Current struggle severity right now: 0.62 (0 = none … 1 = severe)", with the code `urgency`/`sBase` only as a small secondary tag for the developer, and a tooltip for the extra detail. The reader must always know exactly what the number or state means with no prior knowledge of the engine.

This principle is acceptance criteria, not decoration: a review of the finished view must find no symbol without a label + explanation.

## Architecture Overview

Three units, each independently understandable and testable:

```
[StruggleEngine.onDidTick] --(TickRecord + decisionTrace)--> [LiveForwarder (host)]
                                                                   |  bounded ring buffer
                                                                   |  (backfill + stream)
                                                                   v  postMessage
                                                            [LiveEngineSection (webview, recharts)]
                                                                   ^  reads labels/tooltips from
                                                                   |
                                                              [engine glossary module]
```

## Component A — Engine: additive decision-trace (determinism-safe)

The decision is owned by `DecisionEngine.decide` → `AlertStateMachine.tick`, which applies, in fixed order: θ-threshold (θ=0.7) + hysteresis / over-θ span / E6, then the gates **B2** (fluent typing, fail-open), **B4** (grace filter), **D1** (warmup), then **cooldown**; plus the discrete **Test-Stagnation** path (breaks warmup, cooldown only).

Change:
- `AlertStateMachine.tick` returns, alongside its existing decision, a **`DecisionTrace`**: the outcome (`fired-edit` | `fired-discrete` | `suppressed` | `no-candidate`), the blocking reason when suppressed (one of `below-threshold` | `b2-fluent-typing` | `b4-grace-filter` | `d1-warmup` | `cooldown` | `hysteresis`), and the raw values used (`urgency`, `theta`, `typingRate`, `boundariesPresent`, `secondsSinceLastAlert`, `inWarmup`, `graceActive`).
- `DecisionEngine.decide` surfaces the trace (it already orchestrates edit + discrete paths).
- `StruggleEngine._runTick` attaches it as `TickRecord.telemetry.decisionTrace`, exactly like the existing `s` / `v` / `fastDecay` telemetry fields.

**Determinism (explicitly preserved):** the trace is a pure function of the `EngineTick` (no clock, no randomness), so it is deterministic. It is **telemetry**, and the golden-replay harness compares alerts + `S`/`V`/`S_base`/features — **not** the telemetry channel (`docs/struggle/golden-replay-verification.md`). The state machine's existing return value and all gating behaviour are unchanged: the trace is read off the same branch decisions, it does not re-decide. No golden, no held-out F1, no research number is touched.

> To verify during planning: the exact set of blocking reasons against `alerting/alertStateMachine.ts` (E6 / over-θ-span may need their own reason label; confirm hysteresis vs over-θ-span are distinguishable). The trace enum is finalised against that file.

## Component B — Host: LiveForwarder + transport

A small host-side service (wired next to the engine in `struggleCoordinator`) that:
- subscribes to `engine.onDidTick` and `engine.onDidAlert`;
- keeps a **bounded ring buffer** of the session's `TickRecord`s (cap N; whole typical session fits, oldest dropped past the cap) so a page opened mid-session can be backfilled;
- clears the buffer on session start / reset;
- when the Struggle Detection page is open **and** developer mode is on: sends a one-shot **backfill** (`StruggleLiveBackfill`, the buffered ticks) on open, then streams each new tick (`StruggleLiveTick`) and alert marker as they arrive.

Buffering runs regardless of page visibility (cheap, bounded); streaming only while visible (no wasted postMessage traffic). The forwarder is read-only: it never calls back into the engine.

Message contracts live with the other webview contracts (`src/shared/messageContracts/`).

## Component C — Webview: LiveEngineSection (recharts)

New developer-only React component inside `StruggleDetectionView`, rendered only when `developerMode` (and only present in the full build — see Build Variants). Chart library: **recharts** (parity with the recording-viewer's look; acceptable as a dev-only, stub-excluded dependency).

Renders:
- **Curve:** `urgency` (= `sBase`) over session time, with the **θ = 0.7** threshold line drawn and labelled. `s` (severity) and `v` (V-curve) as secondary, toggleable lines.
- **Boundary markers:** FM / FM+ / E4 / N1 / STATE as dots on the time axis, each with a labelled tooltip (glossary).
- **Alert markers:** fired (edit / discrete) vs. suppressed, distinct styling.
- **Current-tick panel ("what is the engine doing right now"):** the urgency value vs θ, the active boundaries, and the **decision-trace** rendered in plain language — either "Would alert" or "Holding back: <gate> — <plain explanation>" (e.g. "Holding back: you're typing fluently"). Plus warmup / grace / cooldown status. This is the "welche Gates greifen" surface.
- **Legend / glossary panel:** collapsible, lists every symbol used with its plain explanation.
- **Cadence note:** the curve advances one point every ~10s (the engine's real tick resolution). This is stated in the UI so the 10s granularity does not read as a bug.

Every label/tooltip string is read from the shared glossary module (Self-Explaining UI principle).

## Glossary (single source of truth for labels + tooltips)

A shared module exposing, per code: a **fully spelled-out displayed text** (the primary thing the reader sees), the internal code (a small secondary tag only), and a tooltip with extra detail. The displayed text — not the code, not a terse label — is what appears in the UI. Initial mapping (final wording verified against the engine source during planning):

| Fully spelled-out displayed text (primary) | Internal code (secondary tag) | Tooltip (extra detail) |
|---|---|---|
| Current struggle severity right now, 0.00–1.00 (0 = none … 1 = severe) | `urgency` / `sBase` | The severity for this single 10-second moment, before any time-smoothing. The alert threshold is checked against exactly this number. |
| Raw per-moment severity signal, 0.00–1.00 | `s` | The unsmoothed severity that feeds the smoothed level below. |
| Smoothed struggle level over time with memory/decay, 0.00–1.00 | `v` / `V(t)` | Severity carried across time with decay. Shown for context — the alert threshold does NOT use this. |
| Alert threshold: urgency must rise above this before a nudge is considered (currently 0.70) | `θ` / theta | Drawn as a horizontal line on the curve. |
| Recent-improvement damping is currently active | `fastDecay` | After a build that improved the result, struggle is damped for a while. |
| A build or test run just failed | `FM` | The canonical moment to offer help. |
| A build or test run just failed, and worse than the one before | `FM+` / `FM_PLUS` | *(verify exact semantics in `signals/buildDelta.ts`.)* |
| A terminal command just finished running | `E4` | E.g. a manually started run. |
| A large or multi-line paste was just detected | `N1` | |
| Idle or stuck — a long pause with no productive edits | `STATE` | Prolonged idle, or a selection held without editing. |
| Not nudging because you are typing fluently right now | `B2` | Fail-open: if typing speed is unknown, this does not block. |
| Not nudging — inside the short grace window just after a failed build, where only build-related moments may nudge | `B4` | The failed-build moment itself is the intended point to help. |
| Not nudging — still in the exercise warm-up period, where only a failed build or a finished terminal run may nudge | `D1` | |
| Not nudging — cooling down after a recent nudge | `cooldown` | |
| Not nudging yet — urgency has not stayed above the threshold long enough | `hysteresis` / over-θ span | *(verify split vs E6 during planning.)* |
| Tests are stuck at the same number of passing tests across several builds | Test-Stagnation | Fires on its own path and breaks the warm-up period. |

## Build Variants & Gating

- The live section + recharts land in the **full VS Code build only**. The existing `@struggleView` esbuild alias swaps `StruggleDetectionView` for `stub.tsx` in the Open VSX / Theia (cloud) build, so recharts and the live code stay out of that bundle. Plan must **verify the cloud bundle stays clean** (the stub still drops it; bundle-size check).
- Runtime gate: `developerMode` setting (`artemis.developerMode`) — the same flag the existing "Developer Tools" section uses. Non-dev users see the unchanged reduced view.

## Determinism & Consent

- Read-only live tap of in-memory ticks → local display only. **No egress**, nothing persisted, so it needs **no recording consent** (it is not the recorder). Independent of the `recording` pipeline.
- Engine behaviour and determinism are unaffected (Component A is additive telemetry; Component B is a passive subscriber).

## Testing

- **Engine:** extend the scenario harness (`test/unit/services/struggle/scenarios/`) and/or `alertStateMachine` unit tests to assert `decisionTrace` values for representative ticks (fired, below-threshold, B2, B4, D1, cooldown). The trace is deterministic, so it is golden-/fixture-testable.
- **Webview:** a component test for `LiveEngineSection` driven by a fixture backfill+stream, asserting the curve points, markers, and that the current-tick panel renders the correct plain-language gate explanation. Plus an assertion that **no rendered symbol lacks a glossary entry** (enforces the Self-Explaining principle).
- **No new VS Code-host e2e** (see Non-Goals).

## Open Items (resolve during planning)

1. Exact `DecisionTrace` reason enum vs `alerting/alertStateMachine.ts` (hysteresis / over-θ span / E6 distinctness).
2. Ring-buffer cap N (a full session at 10s/tick over ~90 min ≈ 540 points — choose a cap that holds a full session cheaply).
3. recharts bundle impact in the full build + confirmation the stub keeps it out of the cloud build.
4. FM+ / STATE exact semantics for the glossary wording (read `signals/buildDelta.ts`, boundary tracker).
5. Whether the non-dev reduced view needs any wording cleanup under the Self-Explaining principle (it currently shows `urgency`/`isStruggling`).

## File Touch-List (anticipated)

- `extension/src/extension/services/struggle/alerting/alertStateMachine.ts` — return `DecisionTrace`.
- `extension/src/extension/services/struggle/decision/decisionEngine.ts` — surface the trace.
- `extension/src/extension/services/struggle/struggleEngine.ts` — attach `telemetry.decisionTrace`.
- `extension/src/extension/services/struggle/types.ts` — `DecisionTrace` type + `TickRecord.telemetry` extension.
- `extension/src/extension/services/struggle/<liveForwarder>.ts` (new) + wiring in `struggleCoordinator.ts`.
- `extension/src/shared/messageContracts/` — `StruggleLiveBackfill` / `StruggleLiveTick` / alert-marker messages.
- `extension/src/webview/views/StruggleDetection/StruggleDetectionView.tsx` + new `LiveEngineSection.tsx` (+ CSS).
- `extension/src/webview/views/StruggleDetection/<glossary>.ts` (new, shared label/tooltip source).
- `extension/package.json` — recharts dependency.
- Tests as above.
