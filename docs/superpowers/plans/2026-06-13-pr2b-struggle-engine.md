# PR 2b: Struggle Engine v2 (Additive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Engine v2 (frozen spec Rev 3.1, Python reference `IrisStudyData/analysis/lib/engine_v2.py`) into `services/struggle/` as a fully tested, additive library — plus the sensorHub internal sources it consumes. The v1 decision path keeps running unchanged; nothing is wired to UI or recorder yet (that is PR 2c).

**Architecture:** Incremental, event-driven trackers (one per signal family) feeding a deterministic 10-s-tick orchestrator. One code path for live and replay: trackers buffer timestamped events; `advanceTo(t)` computes every due grid tick by draining events with `ts <= tick` first (spec section 5 tick contract). The 26 Python state-machine unit tests are ported against the incremental classes (25 with identical numbers; T10's lapse clause via session stop, see Decision 1).

**Tech Stack:** TypeScript strict; vitest (`test/logic/struggle/`) for the pure core (no vscode at runtime); mocha/vscode-test (`test/unit/services/struggle/`) with TestSensorHub + sinon fake timers for the orchestrator and hub additions.

---

## Context

- **Spec:** `docs/superpowers/specs/2026-06-12-struggle-engine-v2-port.md` (sections 3, 5, 8 item PR 2b). Behavior source of truth: `ENGINE_V2_SPEC.md` Rev 3.1 + `analysis/lib/engine_v2.py` in the study repo (read-only reference; verbatim algorithm excerpts are embedded in this plan so implementers do NOT need that repo).
- **Branch:** `feat/struggle-engine-core` off `feat/struggle-engine-v2`. PREREQUISITE: PR #286 (PR 2a) must be merged first — this plan builds on `services/{sensing,eq,recording}` locations.
- **Frozen parameters** (`derived_params.json`, NOTHING may be re-tuned): tick 10 s, window 60 s, min eff. window 10 s, typing anchor 20/min, gap norm 40 s, N4 ratio 10, TS typing < 5/min, A8 window 300 s / min 30 changes / share 0.8, N2 dist 3 lines / min active 60 s, weights 0.25/0.15/0.10, hl 120 s / fast 30 s / fast max 120 s, warmup 480 s, B2 20/min, cooldown 120 s, hysteresis 0.1, re-alert 120 s, grace 32.94 s, theta_full 0.6.
- **Gates:** every existing suite stays green unchanged (unit 1344 + new, struggle 135, react 865 + new, recorder-e2e 9); check-types, lint, knip, clean-bundle. `services/struggle/` and `services/sensing/` must NEVER import recording-side code (clean bundle).
- **Forbidden:** AI attribution anywhere; `git add -A`/`git add .`; skipping failing tests; re-tuning any frozen constant.
- **Working directory convention:** ALL `npm`/`npx`/`node` commands and ALL `git add` path lists in this plan run FROM `extension/` (git accepts subdir-relative paths; `../CHANGELOG.md` and `../docs/...` reach repo-root files). Only Task 0's branch commands run from the repo root, as marked.

## Decision Log

1. **Incremental-only core, no batch twin.** The Python reference is batch (NumPy arrays); the port is incremental classes (`VTracker`, `AlertStateMachine`, `BoundaryTracker`, signal trackers). 25 of the 26 Python tests port with identical numeric outcomes; T10's "events after the LAST tick lapse" clause has no incremental equivalent (there is no last tick until the session stops) — it is realized by `stop()`: the queue is discarded and no later tick ever consumes it, which IS the lapse rule at session granularity. Declared as a port note, not a behavior change (PR 3 replay stops the engine at session end, reproducing the Python lapse exactly).
2. **Time base:** internally ms epoch timestamps from sensor signals; all spec-level computations in SESSION-RELATIVE SECONDS as `(tsMs - sessionStartMs) / 1000` (doubles), matching `lib/loaders.py`. Tick grid: `t_k = k * 10` s, k >= 1 (first tick at 10 s — never at 0).
3. **Tick contract (drain rule):** trackers buffer events; `advanceTo(nowMs)` runs every grid tick `t_k <= now` in order; at tick `t` each tracker first applies its buffered events with `ts <= t`, THEN features/S/V/boundaries/gates/alerting are computed. Live, a 10-s interval timer only calls `advanceTo(clock.now())` (catch-up safe: a late timer fire processes multiple grid ticks). Replay (PR 3) ingests recorded events in order and calls the same `advanceTo`.
4. **Declared causal deviations from the Python reference** (live engines cannot look ahead; PR 3 generates goldens with matching causal input adapters; the frozen Python engine code itself stays untouched):
   - **A8 canonical method map:** Python canonicalizes transient method names over the WHOLE session; the engine canonicalizes over the session SO FAR (recomputed per tick from running counts; same algorithm: names with <= 3 changes map to the most frequent same-file name with > 3 changes when subsequence/substring).
   - **N2 activity:** Python retroactively ends a resolved instance's activity at its LAST CONFIRMATION; the engine keeps an instance active until the diagnostics snapshot that removes it (causal presence).
   - **N1 paste:** Python unions long inserts with RECORDED v1 trigger events (which had a 60 s cooldown); the engine uses the deterministic per-change rule `text.length >= 11 OR isLikelyManualPaste(change)` with no cooldown.
5. **Recorder-parity debounce:** the recorder records selection (200 ms) and visibleRange (300 ms) per-URI TRAILING debounced, payload stamped at the LAST raw event's trigger time — and the frozen feature derivations (N4 scroll counts!) were computed on those debounced streams. The engine therefore applies an identical trailing debounce in its intake (`TrailingDebouncer`). Constants are duplicated in `struggle/constants.ts` (struggle must not import recording) with a unit parity test asserting equality with `ObservationRegistry.SELECTION_DEBOUNCE_MS` / `VISIBLE_RANGE_DEBOUNCE_MS`. Known live-vs-replay edge: a burst ending < debounce before a tick is counted one tick later live than in replay (<= 300 ms; documented, accepted). **Replay intake (PR 3) feeds ALREADY-debounced recorded streams — the engine must not double-debounce them: the constructor takes `options.preDebouncedIntake` (default false); when true, selection/visibleRange signals bypass the debouncers and enqueue directly.** A unit test covers both modes. On normal `stop()` the engine performs a FINAL DRAIN: flush both debouncers, then `advanceTo(clock.now())` — a grid tick that is already DUE at stop time must not lose events to timer jitter (codex counterexample: burst ends 69.95 s, flush 70.25 s, tick 70 not yet run). Events after the last due tick still lapse (Python rule, Decision 1). `dispose()` without a session is the abort path and discards.
6. **URI filtering at engine intake** with `shouldRecordUri(uri, exerciseRoot)` — mirroring the recorder's observationRegistry, because the Python reference consumed the recorder-filtered streams. Applies to textChange, selection, visibleRanges, diagnostics, paste. Terminal/build/feedbackView are not URI-scoped.
7. **Hub internal sources** are plain `vscode.EventEmitter`s with `emit*` methods on the SensorHub interface (no LazyRelay — there is no underlying VS Code subscription to defer): `onBuildResult`/`emitBuildResult(result)` (producer applies `buildResultGuard` BEFORE emitting, per spec; the producer wiring itself is PR 2c — in 2b the channel is exercised by tests only), `onTaskFeedbackView`/`emitTaskFeedbackView(action, viewId)`. The derived `onPasteDetected` channel IS a LazyRelay over `onDidChangeTextDocument` (exists only while consumed).
8. **Gate logic placement:** the gate ORDER is load-bearing (Python `run_state_machine`: B2 → grace filter → warmup filter → theta → cooldown → armed/e6). The order lives in ONE place, `alerting/alertStateMachine.ts`; `gates/gates.ts` provides the three small pure predicates it calls (satisfies the spec's folder architecture without scattering the sequence).
9. **`stateEntryTimes` is a pure exported helper** in `boundaries/` used by the T8a/b test ports and later by the alert audit (PR 2c records boundary context). The alerting path itself needs only the interval-semantics STATE flag (`state && t > warmup`), which already realizes the "synthetic warmup entry" (T8c/d prove it).
10. **No `spans` port.** Python's time-in-alert spans are evaluation-only bookkeeping; no test among the 26 asserts them and the live engine does not need them. PR 3's metrics work re-derives spans offline if needed.
11. **buildDelta failed-set** = `Set(fb.detailText ?? '' for fb in feedbacks where fb.positive === false)` — exactly the recorder's `collectBuildResult` derivation, because the Python reference compared THOSE strings. Set semantics collapse duplicates like Python's `frozenset`.
12. **Engine session API is self-contained** (`start({ sessionStartMs, exerciseRoot? })` / `stop()`), no `SessionResettable` import from telemetry (interim type; PR 2c adapts the engine into the session fan-out).
13. **Test split:** pure core (constants, dynamics, boundaries, gates, alerting, all signal trackers, javaMethods) → vitest `test/logic/struggle/` (fast, no vscode runtime; vscode types only). Orchestrator + hub additions + scenario runner → mocha `test/unit/services/struggle/` and `test/unit/services/sensing/` (TestSensorHub needs real `vscode.EventEmitter`). The 26-port lives in vitest.
14. **Scenario harness v2 (additive):** a runner driving the FULL engine through TestSensorHub with sinon fake timers, scenarios as typed TS data (not JSON — type-checked, no loader), initial set of 8 scenarios across obvious/subtle/no-struggle/edge. The old v1 harness stays untouched until PR 2c.
15. **Severity formula** lives in `signals/severity.ts` as a pure function over the per-tick feature vector (Python `compute_features` lines S_base/S).

## Reference: Python semantics embedded for implementers

Implementers MUST NOT read the study repo. Everything needed is in the per-task "Reference" blocks below, transcribed from the frozen `engine_v2.py` / `02_event_tables.py` / `lib/replay.py`.

## File Map

```
extension/src/extension/services/sensing/
├── types.ts                      MODIFIED: + BuildResultSignal, TaskFeedbackViewSignal, PasteSignal
├── sensorHub.ts                  MODIFIED: + internal sources, onPasteDetected, readTextDocuments()
└── collectors/paste.ts           MODIFIED: + detectPastes(signal): PasteSignal[] (pure)

extension/src/extension/services/struggle/
├── constants.ts                  frozen SPEC constants + evidence tags + debounce mirrors
├── types.ts                      FeatureVector, TickRecord, AlertRecord, BoundaryType, EngineClock, AlertSink
├── dynamics/decay.ts             FastDecayTracker, VTracker
├── gates/gates.ts                isFluentTyping (B2), isInGrace (B4), survivesWarmup (D1)
├── alerting/alertStateMachine.ts AlertStateMachine (exact §5 order)
├── alerting/alertSink.ts         AlertSink interface (delivery lands in PR 2c)
├── boundaries/boundaryTracker.ts BoundaryTracker (event buffers, tick flags) + stateEntryTimes
├── signals/featureWindow.ts      FeatureWindowTracker (typing/gap/scroll counts, eff window)
├── signals/severity.ts           severityFrom(features) → { sBase, s }
├── signals/feedbackViewState.ts  FeedbackViewTracker (open intervals, overlap query)
├── signals/buildDelta.ts         BuildDeltaTracker (delta classification, FM/FM+/improved)
├── signals/javaMethods.ts        sanitizeJava, parseMethods, methodAtLine (replay.py port)
├── signals/documentShadow.ts     DocumentShadowTracker (before-text per URI)
├── signals/regionPersistence.ts  A8Tracker (5-min window, causal canonical map)
├── signals/errorDistance.ts      N2Tracker (instance tracking, alignLines DP, cursor)
├── intake/trailingDebouncer.ts   TrailingDebouncer (per-key trailing debounce)
└── struggleEngine.ts             orchestrator: intake, tick scheduler, onDidTick/onDidAlert

extension/test/__shared__/testSensorHub.ts   MODIFIED: + 3 channels, emit methods, textDocuments stub
extension/test/logic/struggle/               NEW: core + tracker + 26-port vitest suites
extension/test/unit/services/struggle/       NEW: engine orchestrator + scenario runner (mocha)
extension/test/unit/services/sensing/        MODIFIED: + internal-sources test
```

Commit sequence (Conventional Commits, one per task): `feat(sensing): ...` (Task 1), then `feat(struggle): ...` (Tasks 2-11), `test(struggle): ...` (Task 12), `docs(changelog): ...` (Task 13).

---

### Task 0: Branch + plan doc

- [ ] **Step 0.1:** Verify PR #286 is merged into `feat/struggle-engine-v2` (`git log --oneline origin/feat/struggle-engine-v2 | head -3` must show the squash commit of PR 2a). If not merged: STOP and report BLOCKED.
- [ ] **Step 0.2:**

```bash
cd /Users/liamberger/Documents/private/MA/artemis-extension   # repo root (this task only)
git switch feat/struggle-engine-v2 && git pull
git switch -c feat/struggle-engine-core
git add docs/superpowers/plans/2026-06-13-pr2b-struggle-engine.md
git commit -m "docs(struggle): add PR 2b implementation plan"
cd extension                                                  # all later tasks run from here
```

---

### Task 1: SensorHub internal sources + paste channel

**Files:**
- Modify: `extension/src/extension/services/sensing/types.ts`
- Modify: `extension/src/extension/services/sensing/sensorHub.ts`
- Modify: `extension/src/extension/services/sensing/collectors/paste.ts`
- Modify: `extension/test/__shared__/testSensorHub.ts`
- Test: `extension/test/unit/services/sensing/internalSources.test.ts` (new)
- Test: `extension/test/logic/sensing/pasteDetector.test.ts` (new)

- [ ] **Step 1.1: Add the signal types** to `services/sensing/types.ts` (append; `Stamped` is the existing non-exported base):

```ts
/** Artemis build result pushed by the websocket-owning service (internal source).
 *  The producer applies buildResultGuard BEFORE emitting. */
export interface BuildResultSignal extends Stamped { readonly result: ResultDTO }
/** Task-feedback view lifecycle pushed by the UI layer (internal source). */
export interface TaskFeedbackViewSignal extends Stamped {
    readonly action: 'opened' | 'closed';
    readonly viewId: string;
}
/** One qualifying paste-like text change (derived channel, see collectors/paste.ts). */
export interface PasteSignal extends Stamped {
    readonly uri: vscode.Uri;
    readonly chars: number;
    readonly lines: number;
}
```

Add `import type { ResultDTO } from '@extension/domain/submissions';` at the top (verify the actual alias path for `domain/submissions` — check how `eventCollectors.ts` imports `ResultDTO` and use the same specifier).

- [ ] **Step 1.2: Write the failing paste-detector test** `test/logic/sensing/pasteDetector.test.ts` (vitest):

```ts
import { describe, expect, it } from 'vitest';

import { detectPastes } from '@extension/services/sensing/collectors/paste';
import type { TextChangeSignal } from '@extension/services/sensing/types';

function signal(changes: Array<{ text: string; rangeLength?: number; singleLine?: boolean }>, uri = 'file:///ws/Main.java'): TextChangeSignal {
    return {
        ts: 1000,
        event: {
            document: { uri: { toString: () => uri } },
            contentChanges: changes.map(c => ({
                text: c.text,
                rangeLength: c.rangeLength ?? 0,
                range: {
                    isEmpty: (c.rangeLength ?? 0) === 0,
                    isSingleLine: c.singleLine ?? true,
                },
            })),
        },
    } as unknown as TextChangeSignal;
}

describe('detectPastes (v2 paste rule: long insert OR manual multi-line paste)', () => {
    it('emits for a long single-line insert (>= 11 chars)', () => {
        const out = detectPastes(signal([{ text: 'x'.repeat(11) }]));
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ ts: 1000, chars: 11, lines: 1 });
    });
    it('does not emit for a short single-line insert (10 chars)', () => {
        expect(detectPastes(signal([{ text: 'x'.repeat(10) }]))).toHaveLength(0);
    });
    it('emits for a short multi-line manual paste (3 chars, 2 lines)', () => {
        const out = detectPastes(signal([{ text: 'a\nb' }]));
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ chars: 3, lines: 2 });
    });
    it('does not emit for a formatter rewrite (multi-line, rangeLength > 1000)', () => {
        expect(detectPastes(signal([{ text: 'a\nb', rangeLength: 1001, singleLine: false }]))).toHaveLength(0);
    });
    it('emits once for a change qualifying under BOTH rules (no duplicate)', () => {
        expect(detectPastes(signal([{ text: 'line one is long\nline two' }]))).toHaveLength(1);
    });
    it('emits per qualifying change within one event', () => {
        const out = detectPastes(signal([{ text: 'x'.repeat(20) }, { text: 'short' }, { text: 'a\nb\nc' }]));
        expect(out).toHaveLength(2);
    });
    it('ignores empty-text changes (pure deletions)', () => {
        expect(detectPastes(signal([{ text: '', rangeLength: 50 }]))).toHaveLength(0);
    });
});
```

Run: `npx vitest run test/logic/sensing/pasteDetector.test.ts` from `extension/`. Expected: FAIL (`detectPastes` not exported).

- [ ] **Step 1.3: Implement `detectPastes`** in `collectors/paste.ts` (append below `isLikelyManualPaste`):

```ts
/**
 * Engine-v2 paste rule (N1 boundary input), per change of one textChange event:
 * a change qualifies if its inserted text is LONG (>= 11 chars, "Textlaenge > 10",
 * any line count) OR passes the manual multi-line paste heuristic. Mirrors the
 * study pipeline's paste_events derivation (long inserts united with multiline
 * triggers), made deterministic and cooldown-free — declared causal deviation,
 * see the PR 2b plan, Decision 4.
 */
export const PASTE_LONG_MIN_CHARS = 11;

export function detectPastes(signal: TextChangeSignal): PasteSignal[] {
    const out: PasteSignal[] = [];
    for (const change of signal.event.contentChanges) {
        const text = change.text;
        if (text.length === 0) {
            continue;
        }
        if (text.length >= PASTE_LONG_MIN_CHARS || isLikelyManualPaste(change)) {
            out.push({
                ts: signal.ts,
                uri: signal.event.document.uri,
                chars: text.length,
                lines: text.split('\n').length,
            });
        }
    }
    return out;
}
```

Add `import type { PasteSignal, TextChangeSignal } from '@extension/services/sensing/types';` (type-only — the module must stay loadable under partial vscode mocks). Run the test again. Expected: PASS (7/7).

- [ ] **Step 1.4: Extend the SensorHub interface** in `sensorHub.ts`:

```ts
    // ── Internal (non-VS-Code) sources ─────────────────────────────────
    /** Build results pushed by the websocket-owning service (guarded upstream). */
    readonly onBuildResult: vscode.Event<BuildResultSignal>;
    /** Task-feedback view lifecycle pushed by the UI layer. */
    readonly onTaskFeedbackView: vscode.Event<TaskFeedbackViewSignal>;
    /** Derived: qualifying paste-like changes (see collectors/paste.ts). */
    readonly onPasteDetected: vscode.Event<PasteSignal>;

    emitBuildResult(result: ResultDTO): void;
    emitTaskFeedbackView(action: 'opened' | 'closed', viewId: string): void;

    readTextDocuments(): readonly vscode.TextDocument[];
```

- [ ] **Step 1.5: Implement in `VsCodeSensorHub`:**

```ts
    // Internal sources: plain emitters — there is no VS Code subscription to
    // defer, so the LazyRelay machinery does not apply. ts is stamped at emit.
    private readonly _buildResultEmitter = new vscode.EventEmitter<BuildResultSignal>();
    readonly onBuildResult = this._buildResultEmitter.event;
    private readonly _taskFeedbackViewEmitter = new vscode.EventEmitter<TaskFeedbackViewSignal>();
    readonly onTaskFeedbackView = this._taskFeedbackViewEmitter.event;

    emitBuildResult(result: ResultDTO): void {
        this._buildResultEmitter.fire({ ts: Date.now(), result });
    }
    emitTaskFeedbackView(action: 'opened' | 'closed', viewId: string): void {
        this._taskFeedbackViewEmitter.fire({ ts: Date.now(), action, viewId });
    }

    readTextDocuments(): readonly vscode.TextDocument[] { return vscode.workspace.textDocuments; }
```

Push both emitters onto `this._disposables` in the constructor. The derived paste channel is assigned in the constructor next to `onDiagnosticsSettled`, declared like the other constructor-assigned channels (`readonly onPasteDetected: vscode.Event<PasteSignal>;` near the shell-execution declarations):

```ts
        // Derived channel: per-change paste detection over textChange; the
        // underlying textChange subscription exists only while consumed.
        this.onPasteDetected = this._relay(
            handler => this.onDidChangeTextDocument(signal => {
                for (const paste of detectPastes(signal)) {
                    handler(paste);
                }
            }),
            (signal: PasteSignal) => signal,
        );
```

Import `detectPastes` from `./collectors/paste` and the new types from `./types`; import `ResultDTO` with the same specifier as in Step 1.1.

- [ ] **Step 1.6: Extend `TestSensorHub`** (`test/__shared__/testSensorHub.ts`): add to `emit`: `buildResult: new vscode.EventEmitter<BuildResultSignal>()`, `taskFeedbackView: new vscode.EventEmitter<TaskFeedbackViewSignal>()`, `pasteDetected: new vscode.EventEmitter<PasteSignal>()`; expose `onBuildResult`, `onTaskFeedbackView`, `onPasteDetected`; add `stub.textDocuments = [] as vscode.TextDocument[]` and `readTextDocuments()` returning it; implement the interface emit methods so they stamp `ts: Date.now()` and fire the corresponding emitter (tests that need controlled `ts` fire `hub.emit.buildResult.fire({ ts, result })` directly).

- [ ] **Step 1.7: Write the hub internal-sources test** `test/unit/services/sensing/internalSources.test.ts` (mocha, mirrors the style of the existing `sensorHub.test.ts`):

```ts
import * as assert from 'assert';

import { VsCodeSensorHub } from '@extension/services/sensing';
import type { BuildResultSignal, PasteSignal, TaskFeedbackViewSignal } from '@extension/services/sensing/types';
import type { ResultDTO } from '@extension/domain/submissions';

suite('SensorHub internal sources', () => {
    test('emitBuildResult fans out a stamped signal', () => {
        const hub = new VsCodeSensorHub();
        const seen: BuildResultSignal[] = [];
        const sub = hub.onBuildResult(s => seen.push(s));
        const result = { id: 1 } as ResultDTO;
        const before = Date.now();
        hub.emitBuildResult(result);
        assert.strictEqual(seen.length, 1);
        assert.strictEqual(seen[0].result, result);
        assert.ok(seen[0].ts >= before && seen[0].ts <= Date.now());
        sub.dispose();
        hub.dispose();
    });

    test('emitTaskFeedbackView carries action and viewId', () => {
        const hub = new VsCodeSensorHub();
        const seen: TaskFeedbackViewSignal[] = [];
        const sub = hub.onTaskFeedbackView(s => seen.push(s));
        hub.emitTaskFeedbackView('opened', 'view-1');
        hub.emitTaskFeedbackView('closed', 'view-1');
        assert.deepStrictEqual(seen.map(s => [s.action, s.viewId]), [['opened', 'view-1'], ['closed', 'view-1']]);
        sub.dispose();
        hub.dispose();
    });

    test('emit after dispose is inert (no throw, no delivery)', () => {
        const hub = new VsCodeSensorHub();
        const seen: BuildResultSignal[] = [];
        hub.onBuildResult(s => seen.push(s));
        hub.dispose();
        hub.emitBuildResult({ id: 2 } as ResultDTO);
        assert.strictEqual(seen.length, 0);
    });

    test('onPasteDetected derives qualifying pastes from real text edits', async () => {
        const hub = new VsCodeSensorHub();
        const seen: PasteSignal[] = [];
        const sub = hub.onPasteDetected(s => seen.push(s));
        const doc = await vscode.workspace.openTextDocument({ content: '' });
        const editor = await vscode.window.showTextDocument(doc);
        await editor.edit(b => b.insert(new vscode.Position(0, 0), 'this is a pasted block\nsecond line'));
        assert.strictEqual(seen.length, 1);
        assert.strictEqual(seen[0].lines, 2);
        sub.dispose();
        hub.dispose();
    });
});
```

Add `import * as vscode from 'vscode';`. NOTE for the disposal test: `vscode.EventEmitter.fire` after dispose throws in some VS Code versions — if it does, adjust `emitBuildResult`/`emitTaskFeedbackView` to guard with a `_disposed` flag set in `dispose()` (set BEFORE draining `_disposables`) so the documented behavior "inert after dispose" holds; keep the test as the specification. Note for the paste test: untitled documents have scheme `untitled` — the paste channel does NOT uri-filter (engine intake does), so the event still fires; if `openTextDocument({content})` emits the initial fill as a change event, perform the subscription AFTER `showTextDocument` and before `editor.edit` (mirrors the PR 1 lesson).

Run: `rm -rf out && npm run compile-tests && npm run test:unit 2>&1 | tail -5`. Expected: previous 1344 + 4 new = 1348 passing (plus the react suite for the paste detector: `npm run test:react` → 865 + 7 = 872).

- [ ] **Step 1.8: Gates + commit**

```bash
npm run check-types && npm run lint
git add src/extension/services/sensing/types.ts src/extension/services/sensing/sensorHub.ts src/extension/services/sensing/collectors/paste.ts test/__shared__/testSensorHub.ts test/unit/services/sensing/internalSources.test.ts test/logic/sensing/pasteDetector.test.ts
git commit -m "feat(sensing): internal sources for build results and task feedback, derived paste channel"
```

---

### Task 2: struggle/ constants and types

**Files:**
- Create: `extension/src/extension/services/struggle/constants.ts`
- Create: `extension/src/extension/services/struggle/types.ts`
- Create: `extension/src/extension/services/struggle/intake/trailingDebouncer.ts`
- Test: `extension/test/logic/struggle/constants.test.ts`, `extension/test/logic/struggle/trailingDebouncer.test.ts`
- Test: `extension/test/unit/services/struggle/debounceParity.test.ts`

- [ ] **Step 2.1: Create `constants.ts`** (values are FROZEN — any deviation is a bug):

```ts
// extension/src/extension/services/struggle/constants.ts
/**
 * Frozen Engine-v2 parameters (ENGINE_V2_SPEC.md Rev 3.1; derived_params.json
 * v2_spec_constants, frozen 2026-06-12 on the derivation set P2/P4/P5/P6/P8/P10).
 * NOTHING here may be re-tuned — the held-out evaluation (episode F1 0.42 vs
 * 0.00 for v1) is only valid for exactly these values.
 *
 * Evidence tags ([D] own study data, [L] literature, [D+L] both, ENG declared
 * engineering choice) follow the spec.
 */
export const SPEC = {
    /** Score tick interval; first tick at t = 10 s, never at 0. ENG */
    TICK_S: 10,
    /** Rolling feature window. ENG */
    WINDOW_S: 60,
    /** effective_window_s = max(10, min(60, t)). ENG */
    MIN_EFFECTIVE_WINDOW_S: 10,
    /** f_typing = clip(1 - rate/20, 0, 1). [D+L] (F2 rho=-0.37 6/6; absolute scale vs Estey declared [D]) */
    TYPING_ANCHOR_PER_MIN: 20,
    /** f_gap = clip(gap/40, 0, 1). [D+L] (F2 rho=+0.37 6/6); constant 40 ENG */
    GAP_NORM_S: 40,
    /** f_n4 = clip(ratio/10, 0, 1); N4 state at ratio >= 10. [D] (F2 rho=+0.35 6/6; threshold from D4) */
    N4_RATIO_THRESH: 10,
    /** TS state: typing_rate < 5/min. [D] (D4 TS recall 0.74) */
    TS_TYPING_THRESH_PER_MIN: 5,
    /** A8 region persistence: >= 80 % of changes of the last 5 min in one method, >= 30 changes. [D+L] weak */
    A8_WINDOW_S: 300,
    A8_MIN_CHANGES: 30,
    A8_SHARE: 0.8,
    /** N2: error > 3 lines from cursor, continuously active > 60 s. [D] weak */
    N2_DIST_LINES: 3,
    N2_MIN_ACTIVE_S: 60,
    /** Severity bonuses. ENG (weights), motivated by near-equal MM betas [D] */
    W_FB: 0.25,
    W_A8: 0.15,
    W_N2: 0.10,
    /** V(t) half-lives. hl=120 [D] descriptive (S3), value ENG; fast 30 s after improved build [D+L] (S3: ~36 s) */
    HL_DEFAULT_S: 120,
    HL_FAST_S: 30,
    FAST_DECAY_MAX_S: 120,
    /** D1 warmup; FM/E4 break through. [L] ENG (tested value with cost 0 on derivation set) */
    WARMUP_S: 480,
    /** B2 soft gate: no alert while typing_rate >= 20/min (fail-open). [D+L] (F4 uplift +0.31 at 4/6) */
    B2_TYPING_PER_MIN: 20,
    /** Alert state machine. ENG (sparsity literature-motivated); E6 interval need [D] from D4 */
    COOLDOWN_S: 120,
    HYSTERESIS: 0.1,
    REALERT_S: 120,
    /** B4 grace after a bad-build result; suppresses FOLLOWING non-FM boundaries only. Value = F3 median [D] */
    GRACE_S: 32.94,
    /** theta_full, frozen via episode-F1 grid {0.5, 0.6, 0.7} on the derivation set (median F1 0.4396). [D] */
    THETA_FULL: 0.6,
    /** FM bad deltas (failed_count > 0). [D+L] */
    FM_DELTAS_BAD: ['worse', 'same-count', 'identical-set'] as const,
    /** N1 long-insert threshold ("Textlaenge > 10"); lives in sensing/collectors/paste.ts as PASTE_LONG_MIN_CHARS. */
} as const;

/** Boundary types in audit priority order (spec §3: FM > FM+ > E4 > N1 > STATE). ENG */
export const BOUNDARY_PRIORITY = ['FM', 'FM_PLUS', 'E4', 'N1', 'STATE'] as const;
export type BoundaryType = typeof BOUNDARY_PRIORITY[number];

/**
 * Intake debounces mirroring the recorder (ObservationRegistry.SELECTION_DEBOUNCE_MS /
 * VISIBLE_RANGE_DEBOUNCE_MS): the frozen feature derivations ran on the recorder's
 * debounced streams, so the live engine must see the same stream shape. struggle/
 * must not import recording/ (clean bundle), hence the duplicated values; a unit
 * parity test asserts equality (test/unit/services/struggle/debounceParity.test.ts).
 */
export const SELECTION_DEBOUNCE_MS = 200;
export const VISIBLE_RANGE_DEBOUNCE_MS = 300;
```

- [ ] **Step 2.2: Create `types.ts`:**

```ts
// extension/src/extension/services/struggle/types.ts
import type { BoundaryType } from './constants';

/** Per-tick feature vector (Python compute_features row). All rates per minute,
 *  times in session-relative seconds. */
export interface FeatureVector {
    readonly t: number;
    readonly effectiveWindowS: number;
    readonly nOneCharInserts: number;
    readonly scrollEvents: number;
    readonly typingRate: number;
    readonly n4Ratio: number;
    readonly longestGapS: number;
    readonly fTyping: number;
    readonly fGap: number;
    readonly fN4: number;
    readonly fFb: number;
    readonly fA8: number;
    readonly fN2: number;
    readonly tsState: boolean;
    readonly n4State: boolean;
}

/** Outcome of one engine tick (input for the struggleScore recording in PR 2c). */
export interface TickRecord {
    /** Session-relative tick time in seconds (10, 20, ...). */
    readonly t: number;
    /** Absolute tick timestamp in ms (sessionStartMs + t*1000). */
    readonly ts: number;
    readonly features: FeatureVector;
    readonly sBase: number;
    readonly s: number;
    readonly v: number;
    readonly fastDecay: boolean;
    /** Boundary types pending at this tick BEFORE gates (audit). */
    readonly boundariesPreGate: readonly BoundaryType[];
    readonly alert: AlertRecord | null;
}

/** Audit record of an emitted alert (Python run_state_machine audit row). */
export interface AlertRecord {
    readonly t: number;
    readonly ts: number;
    readonly v: number;
    readonly typesPreGate: readonly BoundaryType[];
    readonly types: readonly BoundaryType[];
    readonly primary: BoundaryType;
    readonly path: 'armed' | 'e6';
    readonly inWarmup: boolean;
    readonly inGrace: boolean;
}

/** Injectable clock/scheduler so tests and replay drive ticks deterministically. */
export interface EngineClock {
    now(): number;
    setInterval(callback: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
}

export interface EngineSessionContext {
    readonly sessionStartMs: number;
    readonly exerciseRoot?: import('vscode').Uri;
}
```

(`AlertSink` lands in Task 9 with `alerting/`.)

- [ ] **Step 2.3: TDD the TrailingDebouncer.** Test `test/logic/struggle/trailingDebouncer.test.ts` (vitest, fake timers):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TrailingDebouncer } from '@extension/services/struggle/intake/trailingDebouncer';

describe('TrailingDebouncer (recorder-parity: trailing, per key, last payload+ts wins)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('emits the LAST payload of a burst after the quiet period', () => {
        const out: number[] = [];
        const d = new TrailingDebouncer<number>(300, v => out.push(v));
        d.push('a', 1); vi.advanceTimersByTime(100);
        d.push('a', 2); vi.advanceTimersByTime(100);
        d.push('a', 3);
        expect(out).toEqual([]);
        vi.advanceTimersByTime(300);
        expect(out).toEqual([3]);
    });

    it('keys debounce independently', () => {
        const out: number[] = [];
        const d = new TrailingDebouncer<number>(300, v => out.push(v));
        d.push('a', 1);
        d.push('b', 2);
        vi.advanceTimersByTime(300);
        expect(out.sort()).toEqual([1, 2]);
    });

    it('flush() emits all pending immediately; dispose() discards', () => {
        const out: number[] = [];
        const d = new TrailingDebouncer<number>(300, v => out.push(v));
        d.push('a', 1);
        d.flush();
        expect(out).toEqual([1]);
        d.push('a', 2);
        d.dispose();
        vi.advanceTimersByTime(1000);
        expect(out).toEqual([1]);
    });
});
```

Run, expect FAIL; then implement:

```ts
// extension/src/extension/services/struggle/intake/trailingDebouncer.ts
/**
 * Per-key trailing debounce mirroring the recorder's observationRegistry
 * semantics: every push resets the key's timer; after `delayMs` of quiet the
 * LAST pushed payload is emitted (the payload carries its own trigger-time
 * timestamp, so downstream sees burst-end event time, not flush time).
 */
export class TrailingDebouncer<T> {
    private readonly _timers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly _pending = new Map<string, T>();
    private _disposed = false;

    constructor(
        private readonly _delayMs: number,
        private readonly _emit: (payload: T) => void,
    ) {}

    push(key: string, payload: T): void {
        if (this._disposed) {
            return;
        }
        this._pending.set(key, payload);
        const existing = this._timers.get(key);
        if (existing !== undefined) {
            clearTimeout(existing);
        }
        this._timers.set(key, setTimeout(() => {
            this._timers.delete(key);
            const value = this._pending.get(key);
            this._pending.delete(key);
            if (value !== undefined) {
                this._emit(value);
            }
        }, this._delayMs));
    }

    /** Emit everything pending now (session end). */
    flush(): void {
        for (const timer of this._timers.values()) {
            clearTimeout(timer);
        }
        this._timers.clear();
        for (const value of this._pending.values()) {
            this._emit(value);
        }
        this._pending.clear();
    }

    /** Discard everything pending (engine teardown). */
    dispose(): void {
        this._disposed = true;
        for (const timer of this._timers.values()) {
            clearTimeout(timer);
        }
        this._timers.clear();
        this._pending.clear();
    }
}
```

Expected: PASS (3/3).

- [ ] **Step 2.4: Constants sanity test** `test/logic/struggle/constants.test.ts` (vitest) — locks the frozen values against accidental edits:

```ts
import { describe, expect, it } from 'vitest';

import { BOUNDARY_PRIORITY, SPEC } from '@extension/services/struggle/constants';

describe('frozen Engine-v2 constants (derived_params.json v2_spec_constants)', () => {
    it('matches the frozen parameter set exactly', () => {
        expect(SPEC).toMatchObject({
            TICK_S: 10, WINDOW_S: 60, MIN_EFFECTIVE_WINDOW_S: 10,
            TYPING_ANCHOR_PER_MIN: 20, GAP_NORM_S: 40, N4_RATIO_THRESH: 10,
            TS_TYPING_THRESH_PER_MIN: 5, A8_WINDOW_S: 300, A8_MIN_CHANGES: 30,
            A8_SHARE: 0.8, N2_DIST_LINES: 3, N2_MIN_ACTIVE_S: 60,
            W_FB: 0.25, W_A8: 0.15, W_N2: 0.10,
            HL_DEFAULT_S: 120, HL_FAST_S: 30, FAST_DECAY_MAX_S: 120,
            WARMUP_S: 480, B2_TYPING_PER_MIN: 20,
            COOLDOWN_S: 120, HYSTERESIS: 0.1, REALERT_S: 120,
            GRACE_S: 32.94, THETA_FULL: 0.6,
        });
        expect([...SPEC.FM_DELTAS_BAD]).toEqual(['worse', 'same-count', 'identical-set']);
        expect([...BOUNDARY_PRIORITY]).toEqual(['FM', 'FM_PLUS', 'E4', 'N1', 'STATE']);
    });
});
```

- [ ] **Step 2.5: Debounce parity test** `test/unit/services/struggle/debounceParity.test.ts` (mocha — imports recording, allowed in tests only):

```ts
import * as assert from 'assert';

import { ObservationRegistry } from '@extension/services/recording/observation/observationRegistry';
import { SELECTION_DEBOUNCE_MS, VISIBLE_RANGE_DEBOUNCE_MS } from '@extension/services/struggle/constants';

suite('struggle intake debounce parity with the recorder', () => {
    test('selection and visibleRange debounce constants match observationRegistry', () => {
        assert.strictEqual(SELECTION_DEBOUNCE_MS, ObservationRegistry.SELECTION_DEBOUNCE_MS);
        assert.strictEqual(VISIBLE_RANGE_DEBOUNCE_MS, ObservationRegistry.VISIBLE_RANGE_DEBOUNCE_MS);
    });
});
```

(Verify `ObservationRegistry` is exported with those statics; adjust the import to the actual export if the class is wrapped in a barrel.)

- [ ] **Step 2.6: Gates + commit**

```bash
npm run check-types && npm run lint
npx vitest run test/logic/struggle 2>&1 | tail -4
rm -rf out && npm run compile-tests && npm run test:unit 2>&1 | tail -4
git add src/extension/services/struggle/constants.ts src/extension/services/struggle/types.ts src/extension/services/struggle/intake/trailingDebouncer.ts test/logic/struggle/constants.test.ts test/logic/struggle/trailingDebouncer.test.ts test/unit/services/struggle/debounceParity.test.ts
git commit -m "feat(struggle): frozen v2 constants, core types, intake debouncer"
```

---

### Task 3: dynamics/decay.ts — V(t) and the fast-decay regime (ports T1c/d, T2)

**Reference (Python, frozen):**

```python
def fast_decay_active(t, improved_t, nonimproved_t) -> bool:
    idx = searchsorted(improved_t, t, side="right") - 1     # last improved <= t
    if idx < 0: return False
    t_imp = improved_t[idx]
    if t - t_imp > 120: return False
    # ends immediately at the next non-improved buildResult in (t_imp, t]
    return count of nonimproved_t in (t_imp, t] == 0

def compute_v(t_ticks, s, improved_t, nonimproved_t):
    v[0] = s[0]                                              # first tick: V = S
    for i in 1..n-1:
        dt = t[i] - t[i-1]
        hl = 30 if fast[i] else 120
        v[i] = max(s[i], v[i-1] * 2 ** (-dt / hl))
```

**Files:**
- Create: `extension/src/extension/services/struggle/dynamics/decay.ts`
- Test: `extension/test/logic/struggle/decay.test.ts`

- [ ] **Step 3.1: Write the failing tests** (ports of T1c, T1d, T2a-T2d — identical numbers):

```ts
import { describe, expect, it } from 'vitest';

import { FastDecayTracker, VTracker } from '@extension/services/struggle/dynamics/decay';

function ticksFor(durationS: number): number[] {
    const out: number[] = [];
    for (let t = 10; t <= durationS; t += 10) { out.push(t); }
    return out;
}

describe('VTracker (Python compute_v port)', () => {
    it('T1c: V(t_first) = S(t_first)', () => {
        const v = new VTracker();
        expect(v.update(10, 0.8, false)).toBe(0.8);
    });
    it('T1d: decay from the 2nd tick with hl=120', () => {
        const v = new VTracker();
        v.update(10, 0.8, false);
        expect(v.update(20, 0.0, false)).toBeCloseTo(0.8 * 2 ** (-10 / 120), 12);
    });
});

describe('FastDecayTracker (Python fast_decay_active port)', () => {
    it('T2a/T2b: regime active from the first tick >= improved-ts, hl=30 inside', () => {
        const fast = new FastDecayTracker();
        const v = new VTracker();
        fast.ingestImproved(95);
        const ticks = ticksFor(260);
        const vs: number[] = [];
        const flags: boolean[] = [];
        for (const t of ticks) {
            const f = fast.activeAt(t);
            flags.push(f);
            vs.push(v.update(t, t === 10 ? 1.0 : 0.0, f));
        }
        const i100 = ticks.indexOf(100);
        expect(flags[i100]).toBe(true);                       // T2a
        expect(vs[i100]).toBeCloseTo(vs[i100 - 1] * 2 ** (-10 / 30), 12); // T2b
        const i220 = ticks.indexOf(220);
        expect(flags[i220]).toBe(false);                      // T2c: ends after 120 s
    });
    it('T2d: a non-improved build ends the regime immediately', () => {
        const fast = new FastDecayTracker();
        fast.ingestImproved(95);
        expect(fast.activeAt(140)).toBe(true);
        fast.ingestNonImproved(145);
        expect(fast.activeAt(150)).toBe(false);
    });
    it('a later improved build restarts the regime after a kill', () => {
        const fast = new FastDecayTracker();
        fast.ingestImproved(95);
        fast.ingestNonImproved(120);
        expect(fast.activeAt(130)).toBe(false);
        fast.ingestImproved(150);
        expect(fast.activeAt(160)).toBe(true);
    });
    it('no regime before any improved build', () => {
        expect(new FastDecayTracker().activeAt(50)).toBe(false);
    });
});
```

Run: `npx vitest run test/logic/struggle/decay.test.ts` — FAIL (module missing).

- [ ] **Step 3.2: Implement** `dynamics/decay.ts`:

```ts
// extension/src/extension/services/struggle/dynamics/decay.ts
/**
 * V(t) dynamics (spec §2): V = max(S, V_prev * 2^(-dt/hl)), hl 120 s default,
 * 30 s in the fast-decay regime. The regime starts at an improved buildResult,
 * restarts on further improved builds, and ends after 120 s OR immediately at
 * the next non-improved buildResult. No hard reset (B5 unsupported, spec §2).
 *
 * Incremental port of compute_v / fast_decay_active (engine_v2.py). Events
 * MUST be ingested in non-decreasing ts order (the engine's drain rule
 * guarantees this); queries activeAt(t) come after all events <= t.
 */
import { SPEC } from '@extension/services/struggle/constants';

export class FastDecayTracker {
    private _lastImprovedS: number | null = null;
    private _killed = false;

    ingestImproved(tS: number): void {
        this._lastImprovedS = tS;
        this._killed = false;
    }

    ingestNonImproved(_tS: number): void {
        if (this._lastImprovedS !== null) {
            this._killed = true;
        }
    }

    activeAt(tS: number): boolean {
        return this._lastImprovedS !== null
            && !this._killed
            && tS - this._lastImprovedS <= SPEC.FAST_DECAY_MAX_S;
    }

    reset(): void {
        this._lastImprovedS = null;
        this._killed = false;
    }
}

export class VTracker {
    private _v: number | null = null;
    private _tPrevS = 0;

    /** Compute V at tick t from severity s; fast selects hl=30 (spec §2). */
    update(tS: number, s: number, fast: boolean): number {
        if (this._v === null) {
            this._v = s;            // first tick: V(t_first) = S(t_first)
        } else {
            const dt = tS - this._tPrevS;
            const hl = fast ? SPEC.HL_FAST_S : SPEC.HL_DEFAULT_S;
            this._v = Math.max(s, this._v * 2 ** (-dt / hl));
        }
        this._tPrevS = tS;
        return this._v;
    }

    get current(): number | null { return this._v; }

    reset(): void {
        this._v = null;
        this._tPrevS = 0;
    }
}
```

Run the tests — PASS (7 assertions across 5 cases). Note the eslint import rule: `'../constants'` is an upward relative — BANNED. Use `@extension/services/struggle/constants` instead (this applies to EVERY cross-directory import inside struggle/ in all tasks below; same-directory `./x` is fine).

- [ ] **Step 3.3: Gates + commit**

```bash
npm run check-types && npm run lint && npx vitest run test/logic/struggle 2>&1 | tail -4
git add src/extension/services/struggle/dynamics/decay.ts test/logic/struggle/decay.test.ts
git commit -m "feat(struggle): V(t) dynamics with fast-decay regime"
```

---

### Task 4: gates + alerting state machine (ports T3, T4, T5, T6, T7, T9)

**Reference (Python `run_state_machine`, frozen — the ORDER is load-bearing):**

```python
armed = True; in_state_since = None; last_alert = -inf
for each tick (t, v):
    # Step 1: V bookkeeping
    if v < theta - 0.1:        armed = True; in_state_since = None
    elif v >= theta and in_state_since is None:  in_state_since = t
    # Step 2: alert condition
    present = boundary types whose flag is set at this tick   # priority order
    if not present: continue
    pre_gate = copy(present)
    if typing_rate is not None and typing_rate >= 20: continue       # B2 (fail-open)
    grace = any(fm_bad <= t and t - fm_bad <= grace_s)               # B4
    if grace: present = [k for k in present if k in (FM, FM_PLUS)]
    if t <= warmup_s and no FM/E4 in present: present = []           # D1
    if not present: continue
    if v < theta: continue
    if t - last_alert < cooldown_s: continue
    e6 = False
    if not armed:
        if in_state_since is not None and t - in_state_since >= 120: e6 = True
        else: continue
    # Step 3: alert
    if e6: in_state_since = t
    last_alert = t; armed = False
    audit: t, v, pre_gate, present, primary=present[0], path=('e6' if e6 else 'armed'),
           in_warmup=(t <= warmup_s), in_grace=grace
```

**Files:**
- Create: `extension/src/extension/services/struggle/gates/gates.ts`
- Create: `extension/src/extension/services/struggle/alerting/alertStateMachine.ts`
- Create: `extension/src/extension/services/struggle/alerting/alertSink.ts`
- Test: `extension/test/logic/struggle/alertStateMachine.test.ts`

- [ ] **Step 4.1: Write the failing tests** (T3-T7, T9 ports; helper drives ticks like the Python `_flags` harness):

```ts
import { describe, expect, it } from 'vitest';

import type { BoundaryType } from '@extension/services/struggle/constants';
import { AlertStateMachine, type MachineParams } from '@extension/services/struggle/alerting/alertStateMachine';

function ticksFor(durationS: number): number[] {
    const out: number[] = [];
    for (let t = 10; t <= durationS; t += 10) { out.push(t); }
    return out;
}

interface DriveSpec {
    v: (t: number, i: number) => number;
    boundaries?: (t: number, i: number) => BoundaryType[];
    typingRate?: (t: number, i: number) => number | null;
    fmBad?: number[];
    params?: Partial<MachineParams>;
}

function drive(durationS: number, spec: DriveSpec) {
    const m = new AlertStateMachine({ thetaFull: 0.6, graceS: 33, ...spec.params });
    const alerts: Array<{ t: number; path: string; types: readonly BoundaryType[]; inGrace: boolean }> = [];
    const fmBad = spec.fmBad ?? [];
    ticksFor(durationS).forEach((t, i) => {
        const lastFm = [...fmBad].reverse().find(f => f <= t);
        const grace = lastFm !== undefined && t - lastFm <= (spec.params?.graceS ?? 33);
        const a = m.tick({
            t,
            v: spec.v(t, i),
            boundaries: spec.boundaries ? spec.boundaries(t, i) : (['STATE'] as BoundaryType[]),
            typingRate: spec.typingRate ? spec.typingRate(t, i) : null,
            graceActive: grace,
        });
        if (a) { alerts.push({ t: a.t, path: a.path, types: a.types, inGrace: a.inGrace }); }
    });
    return alerts;
}

describe('AlertStateMachine (Python run_state_machine port)', () => {
    it('T3a: 0.55 >= theta-0.1 -> NO re-arm', () => {
        const vs = [0.7, 0.55, 0.7];
        const alerts = drive(30, { v: (_t, i) => vs[i], params: { warmupS: 0, cooldownS: 0 } });
        expect(alerts.map(a => a.t)).toEqual([10]);
    });
    it('T3b: 0.45 < theta-0.1 -> re-arm + alert', () => {
        const vs = [0.7, 0.45, 0.7];
        const alerts = drive(30, { v: (_t, i) => vs[i], params: { warmupS: 0, cooldownS: 0 } });
        expect(alerts.map(a => a.t)).toEqual([10, 30]);
    });
    it('T4: cooldown blocks until 120 s despite re-arm', () => {
        const alerts = drive(140, { v: (_t, i) => (i % 2 === 0 ? 0.7 : 0.45), params: { warmupS: 0 } });
        expect(alerts.map(a => a.t)).toEqual([10, 130]);
    });
    it('T5a/T5b: E6 re-alerts at 10/130/250 with paths armed/e6/e6', () => {
        const alerts = drive(260, { v: () => 0.8, params: { warmupS: 0 } });
        expect(alerts.map(a => a.t)).toEqual([10, 130, 250]);
        expect(alerts.map(a => a.path)).toEqual(['armed', 'e6', 'e6']);
    });
    it('T6a: FM exception fires at the FM tick despite grace', () => {
        const fmBad = [95];
        const alerts = drive(140, {
            v: t => (t >= 100 ? 0.8 : 0.3),
            boundaries: t => (t === 100 ? (['FM', 'STATE'] as BoundaryType[]) : (['STATE'] as BoundaryType[])),
            fmBad,
            params: { warmupS: 0, graceS: 32.94 },
        });
        expect(alerts[0]?.t).toBe(100);
        expect(alerts[0]?.types).toEqual(['FM']);
        expect(alerts[0]?.inGrace).toBe(true);
    });
    it('T6b: grace suppresses the state boundary until 95 + 32.94 s', () => {
        const alerts = drive(140, {
            v: t => (t >= 100 ? 0.8 : 0.3),
            fmBad: [95],
            params: { warmupS: 0, graceS: 32.94 },
        });
        expect(alerts[0]?.t).toBe(130);
    });
    for (const [type, expected] of [['FM', true], ['E4', true], ['N1', false], ['FM_PLUS', false]] as const) {
        it(`T7 warmup: ${type} ${expected ? 'breaks through' : 'is blocked'}`, () => {
            const alerts = drive(480, {
                v: () => 0.8,
                boundaries: t => (t === 100 ? ([type] as BoundaryType[]) : []),
                params: { graceS: 33 },
            });
            expect(alerts.length === 1 && alerts[0].t === 100).toBe(expected);
        });
    }
    it('T9a: B2 blocks at typing_rate >= 20', () => {
        const alerts = drive(30, { v: () => 0.8, typingRate: () => 25, params: { warmupS: 0 } });
        expect(alerts).toHaveLength(0);
    });
    it('T9b: B2 lets typing_rate < 20 through', () => {
        const alerts = drive(30, { v: () => 0.8, typingRate: () => 10, params: { warmupS: 0 } });
        expect(alerts).toHaveLength(1);
    });
});
```

Run — FAIL (modules missing).

- [ ] **Step 4.2: Implement `gates/gates.ts`:**

```ts
// extension/src/extension/services/struggle/gates/gates.ts
/**
 * Surviving gates (spec §4); B1/N3/N9 deliberately NOT included. These are the
 * three predicates the alert state machine applies IN ITS FIXED ORDER —
 * the order lives in alerting/alertStateMachine.ts, not here.
 */
import type { BoundaryType } from '@extension/services/struggle/constants';
import { SPEC } from '@extension/services/struggle/constants';

/** B2 (soft, fail-open): no alert while typing fluently. null = no data = open. */
export function isFluentTyping(typingRate: number | null): boolean {
    return typingRate !== null && typingRate >= SPEC.B2_TYPING_PER_MIN;
}

/** B4 grace filter: inside the grace window only FM/FM+ survive (the feedback
 *  moment itself is the canonical intervention point; spec §4). */
export function applyGraceFilter(present: readonly BoundaryType[]): BoundaryType[] {
    return present.filter(k => k === 'FM' || k === 'FM_PLUS');
}

/** D1 warmup: inside warmup only FM/E4 break through (N16 conflict resolution). */
export function survivesWarmup(present: readonly BoundaryType[]): boolean {
    return present.some(k => k === 'FM' || k === 'E4');
}
```

- [ ] **Step 4.3: Implement `alerting/alertSink.ts`:**

```ts
// extension/src/extension/services/struggle/alerting/alertSink.ts
import type { AlertRecord } from '@extension/services/struggle/types';

/** Delivery interface; the notification implementation arrives in PR 2c. */
export interface AlertSink {
    deliver(alert: AlertRecord): void;
}
```

- [ ] **Step 4.4: Implement `alerting/alertStateMachine.ts`:**

```ts
// extension/src/extension/services/struggle/alerting/alertStateMachine.ts
/**
 * Alerting state machine (spec §5) with the gate sequence of spec §4 — an
 * exact port of run_state_machine (engine_v2.py). The ORDER of the checks is
 * load-bearing and verified by the ported unit tests T3-T9:
 *   1. V bookkeeping (hysteresis / over-theta run)
 *   2. boundaries present? -> B2 -> grace filter -> warmup filter -> theta ->
 *      cooldown -> armed/E6
 *   3. alert bookkeeping (E6 resets in_state_since; DECISIONS_v2 #20)
 */
import type { BoundaryType } from '@extension/services/struggle/constants';
import { SPEC } from '@extension/services/struggle/constants';
import { applyGraceFilter, isFluentTyping, survivesWarmup } from '@extension/services/struggle/gates/gates';

export interface MachineParams {
    thetaFull: number;
    graceS: number;
    warmupS: number;
    cooldownS: number;
    hysteresis: number;
    realertS: number;
}

const DEFAULT_PARAMS: MachineParams = {
    thetaFull: SPEC.THETA_FULL,
    graceS: SPEC.GRACE_S,
    warmupS: SPEC.WARMUP_S,
    cooldownS: SPEC.COOLDOWN_S,
    hysteresis: SPEC.HYSTERESIS,
    realertS: SPEC.REALERT_S,
};

export interface MachineTickInput {
    /** Session-relative tick time (s). */
    t: number;
    v: number;
    /** Boundary types pending at this tick, in BOUNDARY_PRIORITY order. */
    boundaries: readonly BoundaryType[];
    /** Current window typing rate; null = no data (B2 fail-open). */
    typingRate: number | null;
    /** B4: inside the grace window after a bad-build result? (computed by the engine) */
    graceActive: boolean;
}

export interface MachineAlert {
    t: number;
    v: number;
    typesPreGate: readonly BoundaryType[];
    types: readonly BoundaryType[];
    primary: BoundaryType;
    path: 'armed' | 'e6';
    inWarmup: boolean;
    inGrace: boolean;
}

export class AlertStateMachine {
    private readonly _p: MachineParams;
    private _armed = true;
    private _inStateSince: number | null = null;
    private _lastAlert = Number.NEGATIVE_INFINITY;

    constructor(params?: Partial<MachineParams>) {
        this._p = { ...DEFAULT_PARAMS, ...params };
    }

    tick(input: MachineTickInput): MachineAlert | null {
        const { t, v } = input;
        const p = this._p;

        // Step 1: V bookkeeping (hysteresis / over-theta run)
        if (v < p.thetaFull - p.hysteresis) {
            this._armed = true;
            this._inStateSince = null;
        } else if (v >= p.thetaFull && this._inStateSince === null) {
            this._inStateSince = t;
        }

        // Step 2: alert condition
        let present = [...input.boundaries];
        if (present.length === 0) {
            return null;
        }
        const preGate = [...present];
        if (isFluentTyping(input.typingRate)) {
            return null;                                    // B2 blocks everything
        }
        if (input.graceActive) {
            present = applyGraceFilter(present);            // B4: only FM/FM+ survive
        }
        if (t <= p.warmupS && !survivesWarmup(present)) {
            present = [];                                   // D1: only FM/E4 break through
        }
        if (present.length === 0) {
            return null;
        }
        if (v < p.thetaFull) {
            return null;
        }
        if (t - this._lastAlert < p.cooldownS) {
            return null;
        }
        let e6 = false;
        if (!this._armed) {
            if (this._inStateSince !== null && t - this._inStateSince >= p.realertS) {
                e6 = true;                                  // E6 re-alert without re-arm
            } else {
                return null;
            }
        }

        // Step 3: alert
        if (e6) {
            this._inStateSince = t;                         // E6 reset (DECISIONS_v2 #20)
        }
        this._lastAlert = t;
        this._armed = false;
        return {
            t,
            v,
            typesPreGate: preGate,
            types: present,
            primary: present[0],                            // BOUNDARY_PRIORITY-sorted input
            path: e6 ? 'e6' : 'armed',
            inWarmup: t <= p.warmupS,
            inGrace: input.graceActive,
        };
    }

    reset(): void {
        this._armed = true;
        this._inStateSince = null;
        this._lastAlert = Number.NEGATIVE_INFINITY;
    }
}
```

Run the tests — PASS (13 cases). NOTE on T7/FM_PLUS: with grace inactive (no fmBad), FM_PLUS is blocked by the WARMUP filter (not grace) — exactly like Python (`survivesWarmup(['FM_PLUS'])` is false).

- [ ] **Step 4.5: Gates + commit**

```bash
npm run check-types && npm run lint && npx vitest run test/logic/struggle 2>&1 | tail -4
git add src/extension/services/struggle/gates/gates.ts src/extension/services/struggle/alerting/alertStateMachine.ts src/extension/services/struggle/alerting/alertSink.ts test/logic/struggle/alertStateMachine.test.ts
git commit -m "feat(struggle): alert state machine with gate sequence"
```

---

### Task 5: boundaries/boundaryTracker.ts (ports T8, T10, T1a/b)

**Reference (Python, frozen):**

```python
def ticks_for(duration_s):           # t = 10, 20, ... <= duration (first at 10)
def assign_to_ticks(t_ticks, event_ts):
    # each event -> FIRST tick >= event_ts; events after the last tick lapse
def state_entry_times(t_ticks, state, warmup_s):
    # entries after warmup; entry at tick i (t > warmup) if state[i] and
    # (i == 0 or not state[i-1]); SYNTHETIC entry at the FIRST warmup-free tick
    # if the state is active at the last warmup tick AND at that first free tick
def build_boundaries(...):
    # FM/FM_PLUS/E4/N1 flags from assign_to_ticks; STATE = (ts_state | n4_state) & (t > warmup)
```

**Files:**
- Create: `extension/src/extension/services/struggle/boundaries/boundaryTracker.ts`
- Test: `extension/test/logic/struggle/boundaries.test.ts`

- [ ] **Step 5.1: Write the failing tests:**

```ts
import { describe, expect, it } from 'vitest';

import { BoundaryTracker, stateEntryTimes, ticksFor } from '@extension/services/struggle/boundaries/boundaryTracker';

describe('tick raster (Python ticks_for port)', () => {
    it('T1a: ticks 10..60 for duration 65', () => {
        expect(ticksFor(65)).toEqual([10, 20, 30, 40, 50, 60]);
    });
    it('T1b: no tick for duration < 10', () => {
        expect(ticksFor(9.9)).toEqual([]);
    });
});

describe('event-to-tick assignment (T10 port, incremental)', () => {
    it('assigns each event to the FIRST tick >= ts; later events wait', () => {
        const b = new BoundaryTracker();
        for (const ts of [10.0, 10.5, 59.0, 61.0]) { b.ingest('E4', ts); }
        const hits: Array<[number, boolean]> = [];
        for (const t of ticksFor(60)) {
            hits.push([t, b.flagsAt(t, false, false).includes('E4')]);
        }
        expect(hits.filter(([, f]) => f).map(([t]) => t)).toEqual([10, 20, 60]);
        // event at 61.0 stays buffered; a 7th tick would consume it:
        expect(b.flagsAt(70, false, false).includes('E4')).toBe(true);
    });
    it('consumes each event exactly once', () => {
        const b = new BoundaryTracker();
        b.ingest('N1', 15);
        expect(b.flagsAt(20, false, false)).toEqual(['N1']);
        expect(b.flagsAt(30, false, false)).toEqual([]);
    });
});

describe('stateEntryTimes (T8a/T8b port)', () => {
    const ticks = ticksFor(600);
    it('T8a: synthetic entry at t=490 when the state spans the warmup end', () => {
        const state = ticks.map(t => t >= 470 && t <= 530);
        const { entries, synthetic } = stateEntryTimes(ticks, state, 480);
        expect(entries).toEqual([490]);
        expect(synthetic).toEqual([true]);
    });
    it('T8b: regular entry after warmup without synthetic flag', () => {
        const state = ticks.map(t => t >= 490 && t <= 530);
        const { entries, synthetic } = stateEntryTimes(ticks, state, 480);
        expect(entries).toEqual([490]);
        expect(synthetic).toEqual([false]);
    });
});

describe('STATE boundary flag (T8c port)', () => {
    it('is pending only after warmup', () => {
        const b = new BoundaryTracker();
        // state active at both ticks; warmup 480
        expect(b.flagsAt(480, true, false)).toEqual([]);
        expect(b.flagsAt(490, true, false)).toEqual(['STATE']);
    });
    it('combines TS and N4 states and respects priority order', () => {
        const b = new BoundaryTracker();
        b.ingest('FM', 485);
        b.ingest('N1', 486);
        expect(b.flagsAt(490, false, true)).toEqual(['FM', 'N1', 'STATE']);
    });
});
```

(T8d — alert at the first warmup-free tick — is covered end-to-end in the engine test, Task 11.)

- [ ] **Step 5.2: Implement:**

```ts
// extension/src/extension/services/struggle/boundaries/boundaryTracker.ts
/**
 * Boundary bookkeeping (spec §3): FM/FM+/E4/N1 events are assigned to the
 * FIRST tick >= event time and evaluated exactly once there; the STATE
 * boundary has interval semantics (pending at every tick with an active TS/N4
 * state after warmup — this realizes the "synthetic warmup entry" without an
 * exit/re-entry). Port of assign_to_ticks / build_boundaries (engine_v2.py).
 *
 * Incremental contract: ingest() in non-decreasing tick consumption order —
 * flagsAt(t) consumes every buffered event with ts <= t and must be called
 * with strictly increasing t (the engine's grid guarantees both).
 */
import type { BoundaryType } from '@extension/services/struggle/constants';
import { BOUNDARY_PRIORITY, SPEC } from '@extension/services/struggle/constants';

/** Score ticks t = 10, 20, ... <= duration (first tick at 10 s). Test/audit helper. */
export function ticksFor(durationS: number): number[] {
    const out: number[] = [];
    const n = Math.floor(durationS / SPEC.TICK_S);
    for (let k = 1; k <= n; k++) { out.push(k * SPEC.TICK_S); }
    return out;
}

/**
 * State entry times after warmup including the synthetic warmup-end entry
 * (spec §3 Warmup-Uebergang; DECISIONS_v2 #12). Pure helper for audit and the
 * T8 test ports; the alerting path uses only the interval-semantics flag.
 */
export function stateEntryTimes(
    ticks: readonly number[],
    state: readonly boolean[],
    warmupS: number,
): { entries: number[]; synthetic: boolean[] } {
    const entries: number[] = [];
    const synthetic: boolean[] = [];
    const firstFree = ticks.findIndex(t => t > warmupS);
    if (firstFree === -1) {
        return { entries, synthetic };
    }
    for (let i = 0; i < ticks.length; i++) {
        if (ticks[i] <= warmupS || !state[i]) {
            continue;
        }
        if (i === 0 || !state[i - 1]) {
            entries.push(ticks[i]);
            synthetic.push(false);
        } else if (i === firstFree) {       // state[i-1] active at the last warmup tick
            entries.push(ticks[i]);
            synthetic.push(true);
        }
    }
    return { entries, synthetic };
}

type EventBoundary = Exclude<BoundaryType, 'STATE'>;

export class BoundaryTracker {
    private readonly _buffers = new Map<EventBoundary, number[]>([
        ['FM', []], ['FM_PLUS', []], ['E4', []], ['N1', []],
    ]);

    /** Buffer an event boundary at session-relative time ts (seconds). */
    ingest(type: EventBoundary, tsS: number): void {
        this._buffers.get(type)!.push(tsS);
    }

    /**
     * Boundary types pending at tick t, in BOUNDARY_PRIORITY order. Consumes
     * every buffered event with ts <= t (exactly-once tick assignment).
     */
    flagsAt(tS: number, tsState: boolean, n4State: boolean, warmupS: number = SPEC.WARMUP_S): BoundaryType[] {
        const present = new Set<BoundaryType>();
        for (const [type, buffer] of this._buffers) {
            let consumed = 0;
            while (consumed < buffer.length && buffer[consumed] <= tS) {
                consumed++;
            }
            if (consumed > 0) {
                present.add(type);
                buffer.splice(0, consumed);
            }
        }
        if ((tsState || n4State) && tS > warmupS) {
            present.add('STATE');
        }
        return BOUNDARY_PRIORITY.filter(k => present.has(k));
    }

    reset(): void {
        for (const buffer of this._buffers.values()) {
            buffer.length = 0;
        }
    }
}
```

Run the tests — PASS.

- [ ] **Step 5.3: Gates + commit**

```bash
npm run check-types && npm run lint && npx vitest run test/logic/struggle 2>&1 | tail -4
git add src/extension/services/struggle/boundaries/boundaryTracker.ts test/logic/struggle/boundaries.test.ts
git commit -m "feat(struggle): boundary tracker with tick assignment and warmup state semantics"
```

---

### Task 6: signals/featureWindow.ts + signals/severity.ts

**Reference (Python `compute_features`, frozen):**

```python
eff = max(10, min(60, t));  w0 = t - eff
n_ins1  = count of 1-char-insert ts in (w0, t]          # rangeLength==0 and len(text)==1
n_scroll = count of scroll ts in (w0, t]                 # debounced visibleRange events
typing_rate = 60 * n_ins1 / eff
ratio = (n_scroll + 0.5) / (n_ins1 + 0.5)
longest_gap:
    tc in (w0, t] (ALL textChange events, not only 1-char):
      if any: pts = [w0, *tc_in_window, t]; gap = max(diff(pts))
      else:   last = last tc <= w0 (else 0.0); gap = min(eff, t - last)
f_typing = clip(1 - typing_rate/20, 0, 1)
f_gap    = clip(longest_gap/40, 0, 1)
f_n4     = clip(ratio/10, 0, 1)
S_base   = (f_typing + f_gap + f_n4) / 3
S        = min(1, S_base + 0.25*f_fb + 0.15*f_a8 + 0.10*f_n2)
ts_state = typing_rate < 5;  n4_state = ratio >= 10
```

**Files:**
- Create: `extension/src/extension/services/struggle/signals/featureWindow.ts`
- Create: `extension/src/extension/services/struggle/signals/severity.ts`
- Test: `extension/test/logic/struggle/featureWindow.test.ts`

- [ ] **Step 6.1: Write the failing tests** (hand-computed expectations, exact spec formulas):

```ts
import { describe, expect, it } from 'vitest';

import { FeatureWindowTracker } from '@extension/services/struggle/signals/featureWindow';
import { severityFrom } from '@extension/services/struggle/signals/severity';

describe('FeatureWindowTracker (Python compute_features core port)', () => {
    it('effective window: max(10, min(60, t))', () => {
        const w = new FeatureWindowTracker();
        expect(w.computeAt(10).effectiveWindowS).toBe(10);
        expect(w.computeAt(40).effectiveWindowS).toBe(40);
        expect(w.computeAt(120).effectiveWindowS).toBe(60);
    });

    it('typing rate normalizes 1-char inserts to per-minute over the effective window', () => {
        const w = new FeatureWindowTracker();
        for (let i = 0; i < 5; i++) { w.ingestTextChange(2 + i, 1); }   // 5 one-char inserts
        const f = w.computeAt(10);
        expect(f.nOneCharInserts).toBe(5);
        expect(f.typingRate).toBeCloseTo(60 * 5 / 10, 12);              // 30/min
        expect(f.tsState).toBe(false);
        expect(f.fTyping).toBe(0);                                      // clip(1-30/20)=0
    });

    it('window is (t-eff, t]: events at exactly w0 are excluded, at t included', () => {
        const w = new FeatureWindowTracker();
        w.ingestTextChange(60, 1);    // exactly w0 for t=120 (eff=60, w0=60) -> excluded
        w.ingestTextChange(60.001, 1);
        w.ingestTextChange(120, 1);   // exactly t -> included
        expect(w.computeAt(120).nOneCharInserts).toBe(2);
    });

    it('n4 ratio uses +0.5 smoothing on raw counts in the window', () => {
        const w = new FeatureWindowTracker();
        for (let i = 0; i < 7; i++) { w.ingestScroll(3 + i); }
        const f = w.computeAt(10);
        expect(f.scrollEvents).toBe(7);
        expect(f.n4Ratio).toBeCloseTo((7 + 0.5) / (0 + 0.5), 12);       // 15
        expect(f.n4State).toBe(true);
        expect(f.fN4).toBe(1);                                          // clip(15/10)=1
    });

    it('longest gap with edits: max diff over [w0, tc..., t]', () => {
        const w = new FeatureWindowTracker();
        w.ingestTextChange(12, 0);    // textChange event without 1-char insert still counts for gaps
        w.ingestTextChange(30, 1);
        const f = w.computeAt(40);    // eff=40, w0=0; pts = [0, 12, 30, 40] -> max gap 18
        expect(f.longestGapS).toBeCloseTo(18, 12);
        expect(f.fGap).toBeCloseTo(18 / 40, 12);
    });

    it('longest gap without edits in window: min(eff, t - last edit before w0)', () => {
        const w = new FeatureWindowTracker();
        w.ingestTextChange(5, 1);
        const f = w.computeAt(120);   // eff=60, w0=60; no tc in window; t-last=115 -> min(60,115)=60
        expect(f.longestGapS).toBe(60);
        expect(f.fGap).toBe(1);
    });

    it('longest gap with no edits ever: min(eff, t - 0)', () => {
        const w = new FeatureWindowTracker();
        expect(w.computeAt(30).longestGapS).toBe(30);     // min(30, 30-0)
        expect(w.computeAt(120).longestGapS).toBe(60);    // min(60, 120)
    });

    it('TS state at typing_rate < 5/min', () => {
        const w = new FeatureWindowTracker();
        expect(w.computeAt(60).tsState).toBe(true);       // 0/min
        for (let i = 0; i < 5; i++) { w.ingestTextChange(61 + i, 1); }
        expect(w.computeAt(70).tsState).toBe(false);      // 5 in 60s window = 5/min
    });
});

describe('severityFrom (spec §1 formula)', () => {
    it('combines the core mean with capped bonuses', () => {
        const s = severityFrom({ fTyping: 0.6, fGap: 0.3, fN4: 0.0 }, { fFb: 1, fA8: 1, fN2: 1 });
        expect(s.sBase).toBeCloseTo(0.3, 12);
        expect(s.s).toBeCloseTo(Math.min(1, 0.3 + 0.25 + 0.15 + 0.10), 12);
    });
    it('caps S at 1', () => {
        const s = severityFrom({ fTyping: 1, fGap: 1, fN4: 1 }, { fFb: 1, fA8: 0, fN2: 0 });
        expect(s.s).toBe(1);
    });
});
```

- [ ] **Step 6.2: Implement `featureWindow.ts`:**

```ts
// extension/src/extension/services/struggle/signals/featureWindow.ts
/**
 * Rolling-window core features (spec §0/§1): 1-char-insert rate, scroll/insert
 * ratio (N4), longest edit gap — computed at tick t over (t - eff, t] with
 * eff = max(10, min(60, t)). Port of compute_features (engine_v2.py).
 *
 * Inputs are session-relative seconds; ingestion in non-decreasing ts order.
 * Scroll events are the DEBOUNCED visibleRange stream (see Decision 5).
 */
import { SPEC } from '@extension/services/struggle/constants';

/** Index of the first element > x (upper bound) in an ascending array. */
function upperBound(arr: readonly number[], x: number): number {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] <= x) { lo = mid + 1; } else { hi = mid; }
    }
    return lo;
}

export interface WindowFeatures {
    readonly effectiveWindowS: number;
    readonly nOneCharInserts: number;
    readonly scrollEvents: number;
    readonly typingRate: number;
    readonly n4Ratio: number;
    readonly longestGapS: number;
    readonly fTyping: number;
    readonly fGap: number;
    readonly fN4: number;
    readonly tsState: boolean;
    readonly n4State: boolean;
}

const clip01 = (x: number): number => Math.min(1, Math.max(0, x));

export class FeatureWindowTracker {
    private readonly _ins1: number[] = [];
    private readonly _tc: number[] = [];
    private readonly _scroll: number[] = [];

    /** One textChange EVENT at ts with its count of 1-char inserts (rangeLength==0, text.length==1). */
    ingestTextChange(tsS: number, oneCharInserts: number): void {
        this._tc.push(tsS);
        for (let i = 0; i < oneCharInserts; i++) {
            this._ins1.push(tsS);
        }
    }

    /** One debounced scroll (visibleRange) event at ts. */
    ingestScroll(tsS: number): void {
        this._scroll.push(tsS);
    }

    computeAt(tS: number): WindowFeatures {
        const eff = Math.max(SPEC.MIN_EFFECTIVE_WINDOW_S, Math.min(SPEC.WINDOW_S, tS));
        const w0 = tS - eff;

        const nIns1 = upperBound(this._ins1, tS) - upperBound(this._ins1, w0);
        const nScroll = upperBound(this._scroll, tS) - upperBound(this._scroll, w0);
        const typingRate = 60 * nIns1 / eff;
        const ratio = (nScroll + 0.5) / (nIns1 + 0.5);

        const lo = upperBound(this._tc, w0);
        const hi = upperBound(this._tc, tS);
        let longestGap: number;
        if (hi > lo) {
            longestGap = 0;
            let prev = w0;
            for (let i = lo; i <= hi; i++) {
                const cur = i < hi ? this._tc[i] : tS;
                longestGap = Math.max(longestGap, cur - prev);
                prev = cur;
            }
        } else {
            const last = hi >= 1 ? this._tc[hi - 1] : 0;
            longestGap = Math.min(eff, tS - last);
        }

        return {
            effectiveWindowS: eff,
            nOneCharInserts: nIns1,
            scrollEvents: nScroll,
            typingRate,
            n4Ratio: ratio,
            longestGapS: longestGap,
            fTyping: clip01(1 - typingRate / SPEC.TYPING_ANCHOR_PER_MIN),
            fGap: clip01(longestGap / SPEC.GAP_NORM_S),
            fN4: clip01(ratio / SPEC.N4_RATIO_THRESH),
            tsState: typingRate < SPEC.TS_TYPING_THRESH_PER_MIN,
            n4State: ratio >= SPEC.N4_RATIO_THRESH,
        };
    }

    reset(): void {
        this._ins1.length = 0;
        this._tc.length = 0;
        this._scroll.length = 0;
    }
}
```

(NOTE on the gap loop: it reproduces Python's `pts = [w0, *tc, t]; max(diff(pts))` exactly, including the final `t - lastTc` segment.)

- [ ] **Step 6.3: Implement `severity.ts`:**

```ts
// extension/src/extension/services/struggle/signals/severity.ts
/**
 * Severity S(t) (spec §1): equal-weighted core mean plus capped context
 * bonuses. Weights are frozen engineering choices motivated by near-equal
 * mixed-model betas; see constants.ts.
 */
import { SPEC } from '@extension/services/struggle/constants';

export function severityFrom(
    core: { fTyping: number; fGap: number; fN4: number },
    bonuses: { fFb: 0 | 1; fA8: 0 | 1; fN2: 0 | 1 },
): { sBase: number; s: number } {
    const sBase = (core.fTyping + core.fGap + core.fN4) / 3;
    const s = Math.min(1, sBase + SPEC.W_FB * bonuses.fFb + SPEC.W_A8 * bonuses.fA8 + SPEC.W_N2 * bonuses.fN2);
    return { sBase, s };
}
```

Run the tests — PASS.

- [ ] **Step 6.4: Gates + commit**

```bash
npm run check-types && npm run lint && npx vitest run test/logic/struggle 2>&1 | tail -4
git add src/extension/services/struggle/signals/featureWindow.ts src/extension/services/struggle/signals/severity.ts test/logic/struggle/featureWindow.test.ts
git commit -m "feat(struggle): rolling-window core features and severity formula"
```

---

### Task 7: signals/feedbackViewState.ts + signals/buildDelta.ts

**Reference (Python, frozen):**

```python
# feedback view (build_inputs): intervals from taskFeedbackView opened/closed by
# viewId; views still open at session end extend to the end. Window query:
# f_fb = 1 if any interval with (start <= t) and (end > w0)
#
# build delta (02_event_tables.py build_episodes_for):
# buildFailed -> delta = "compile-error" (failed set undefined, baseline UNCHANGED)
# else cur = frozenset(failedTests):
#   prev is None      -> "first"
#   cur == prev       -> "identical-set"
#   len(cur)<len(prev)-> "improved"   |  len(cur)>len(prev) -> "worse"
#   else              -> "same-count"
#   prev = cur        # only non-buildFailed builds advance the baseline
#
# engine_v2.build_inputs classification:
# improved_t   = builds with delta == "improved"; nonimproved_t = ALL others
# fm_t   = compile-error OR (failed_count>0 AND delta in {worse,same-count,identical-set})
#          OR (failed_count>0 AND delta == "first")
# fmplus_t = delta == "improved" AND failed_count > 0
```

**Files:**
- Create: `extension/src/extension/services/struggle/signals/feedbackViewState.ts`
- Create: `extension/src/extension/services/struggle/signals/buildDelta.ts`
- Test: `extension/test/logic/struggle/feedbackViewState.test.ts`, `extension/test/logic/struggle/buildDelta.test.ts`

- [ ] **Step 7.1: Failing tests — feedback view:**

```ts
import { describe, expect, it } from 'vitest';

import { FeedbackViewTracker } from '@extension/services/struggle/signals/feedbackViewState';

describe('FeedbackViewTracker (f_fb interval overlap)', () => {
    it('open interval overlaps the window while open', () => {
        const f = new FeedbackViewTracker();
        f.ingest(15, 'opened', 'v1');
        expect(f.openOverlapping(0, 10)).toBe(false);   // opened after t=10
        expect(f.openOverlapping(0, 20)).toBe(true);
        expect(f.openOverlapping(60, 120)).toBe(true);  // still open
    });
    it('closed interval [a,b): start <= t AND end > w0', () => {
        const f = new FeedbackViewTracker();
        f.ingest(15, 'opened', 'v1');
        f.ingest(25, 'closed', 'v1');
        expect(f.openOverlapping(0, 20)).toBe(true);
        expect(f.openOverlapping(20, 80)).toBe(true);   // end 25 > w0 20
        expect(f.openOverlapping(25, 85)).toBe(false);  // end 25 NOT > w0 25
    });
    it('tracks independent viewIds; tolerates unmatched close (logged, not thrown)', () => {
        const f = new FeedbackViewTracker();
        f.ingest(10, 'opened', 'a');
        f.ingest(12, 'closed', 'b');                    // unmatched: ignored
        f.ingest(20, 'closed', 'a');
        expect(f.openOverlapping(15, 75)).toBe(true);
        expect(f.openOverlapping(20, 80)).toBe(false);
    });
});
```

- [ ] **Step 7.2: Implement `feedbackViewState.ts`:**

```ts
// extension/src/extension/services/struggle/signals/feedbackViewState.ts
/**
 * Task-feedback view state (E1, f_fb): open/close intervals per viewId; the
 * window query mirrors Python's (start <= t) & (end > w0) with open views
 * extending to infinity. Unmatched closes are ignored (live tolerance; the
 * offline pipeline raised — declared engineering difference, log-only).
 */
export class FeedbackViewTracker {
    private readonly _openAt = new Map<string, number>();
    private readonly _closed: Array<{ start: number; end: number }> = [];

    ingest(tsS: number, action: 'opened' | 'closed', viewId: string): void {
        if (action === 'opened') {
            this._openAt.set(viewId, tsS);
            return;
        }
        const start = this._openAt.get(viewId);
        if (start === undefined) {
            return;                                  // unmatched close: tolerate
        }
        this._openAt.delete(viewId);
        this._closed.push({ start, end: tsS });
    }

    /** Was a feedback view open anywhere in (w0, t]? (Python overlap predicate) */
    openOverlapping(w0S: number, tS: number): boolean {
        for (const start of this._openAt.values()) {
            if (start <= tS) { return true; }        // open view: end = infinity > w0
        }
        return this._closed.some(iv => iv.start <= tS && iv.end > w0S);
    }

    reset(): void {
        this._openAt.clear();
        this._closed.length = 0;
    }
}
```

- [ ] **Step 7.3: Failing tests — build delta** (failed sets are the recorder-equivalent detailText strings, Decision 11):

```ts
import { describe, expect, it } from 'vitest';

import { BuildDeltaTracker } from '@extension/services/struggle/signals/buildDelta';
import type { ResultDTO } from '@extension/domain/submissions';

function result(failed: string[], buildFailed = false): ResultDTO {
    return {
        id: 1,
        submission: { id: 1, buildFailed },
        feedbacks: failed.map(detail => ({ positive: false, detailText: detail, text: 't' })),
    } as unknown as ResultDTO;
}

describe('BuildDeltaTracker (build_episodes delta_vs_prev + engine classification)', () => {
    it('classifies the full sequence first/identical/improved/worse/same-count', () => {
        const b = new BuildDeltaTracker();
        expect(b.ingest(10, result(['a', 'b'])).delta).toBe('first');
        expect(b.ingest(20, result(['a', 'b'])).delta).toBe('identical-set');
        expect(b.ingest(30, result(['a'])).delta).toBe('improved');
        expect(b.ingest(40, result(['a', 'c'])).delta).toBe('worse');
        expect(b.ingest(50, result(['b', 'd'])).delta).toBe('same-count');
    });
    it('compile-error does NOT advance the baseline', () => {
        const b = new BuildDeltaTracker();
        b.ingest(10, result(['a', 'b']));
        expect(b.ingest(20, result([], true)).delta).toBe('compile-error');
        expect(b.ingest(30, result(['a', 'b'])).delta).toBe('identical-set'); // vs build at t=10
    });
    it('duplicate failure strings collapse (set semantics)', () => {
        const b = new BuildDeltaTracker();
        b.ingest(10, result(['a', 'a', 'b']));
        expect(b.ingest(20, result(['a', 'b'])).delta).toBe('identical-set');
    });
    it('FM classification: compile-error, bad deltas with failures, first-failed', () => {
        const b = new BuildDeltaTracker();
        expect(b.ingest(10, result(['a'])).isFM).toBe(true);              // first + failed
        expect(b.ingest(20, result(['a'])).isFM).toBe(true);              // identical-set
        expect(b.ingest(30, result([])).isFM).toBe(false);                // improved to clean
        expect(b.ingest(40, result([], true)).isFM).toBe(true);           // compile-error
    });
    it('first with zero failures is NOT FM', () => {
        const b = new BuildDeltaTracker();
        expect(b.ingest(10, result([])).isFM).toBe(false);
    });
    it('FM+ = improved AND failures remain', () => {
        const b = new BuildDeltaTracker();
        b.ingest(10, result(['a', 'b', 'c']));
        const r = b.ingest(20, result(['a']));
        expect(r.delta).toBe('improved');
        expect(r.isFMPlus).toBe(true);
        b.ingest(30, result(['a']));                                       // identical
        expect(b.ingest(40, result([])).isFMPlus).toBe(false);             // improved to clean
    });
    it('improved/non-improved split: every non-improved delta counts as non-improved', () => {
        const b = new BuildDeltaTracker();
        expect(b.ingest(10, result(['a'])).improved).toBe(false);          // first
        expect(b.ingest(20, result([], true)).improved).toBe(false);       // compile-error
        expect(b.ingest(30, result([])).improved).toBe(true);
    });
});
```

- [ ] **Step 7.4: Implement `buildDelta.ts`:**

```ts
// extension/src/extension/services/struggle/signals/buildDelta.ts
/**
 * Build-result delta classification (spec §2/§3): failed-test SET diff against
 * the last build WITH test information (compile-error builds have no test info
 * and never advance the baseline). The failed set uses the recorder-equivalent
 * derivation — detailText of feedbacks with positive === false — because the
 * frozen reference compared exactly those strings (PR 2b plan, Decision 11).
 *
 * Port of build_episodes_for (02_event_tables.py) + the FM/FM+/improved
 * classification of build_inputs (engine_v2.py).
 */
import type { ResultDTO } from '@extension/domain/submissions';
import { SPEC } from '@extension/services/struggle/constants';

export type BuildDelta = 'compile-error' | 'first' | 'identical-set' | 'improved' | 'worse' | 'same-count';

export interface BuildClassification {
    readonly tsS: number;
    readonly delta: BuildDelta;
    readonly failedCount: number | null;
    readonly isFM: boolean;
    readonly isFMPlus: boolean;
    readonly improved: boolean;
}

function failedSetOf(result: ResultDTO): Set<string> {
    const out = new Set<string>();
    for (const fb of result.feedbacks ?? []) {
        if (fb.positive === false) {
            out.add(fb.detailText ?? '');
        }
    }
    return out;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) { return false; }
    for (const x of a) {
        if (!b.has(x)) { return false; }
    }
    return true;
}

export class BuildDeltaTracker {
    private _prev: Set<string> | null = null;

    ingest(tsS: number, result: ResultDTO): BuildClassification {
        const buildFailed = result.submission?.buildFailed ?? false;
        let delta: BuildDelta;
        let failedCount: number | null;
        if (buildFailed) {
            delta = 'compile-error';
            failedCount = null;
        } else {
            const cur = failedSetOf(result);
            failedCount = cur.size;
            if (this._prev === null) {
                delta = 'first';
            } else if (setsEqual(cur, this._prev)) {
                delta = 'identical-set';
            } else if (cur.size < this._prev.size) {
                delta = 'improved';
            } else if (cur.size > this._prev.size) {
                delta = 'worse';
            } else {
                delta = 'same-count';
            }
            this._prev = cur;
        }
        const hasFailed = failedCount !== null && failedCount > 0;
        const badDeltas: readonly string[] = SPEC.FM_DELTAS_BAD;
        const isFM = delta === 'compile-error'
            || (hasFailed && badDeltas.includes(delta))
            || (hasFailed && delta === 'first');
        return {
            tsS,
            delta,
            failedCount,
            isFM,
            isFMPlus: delta === 'improved' && hasFailed,
            improved: delta === 'improved',
        };
    }

    reset(): void {
        this._prev = null;
    }
}
```

Run both suites — PASS. (Check the `ArtemisFeedback` field names against `domain/submissions.ts` — `positive`, `detailText` must exist; mirror `collectBuildResult`'s exact predicate.)

- [ ] **Step 7.5: Gates + commit**

```bash
npm run check-types && npm run lint && npx vitest run test/logic/struggle 2>&1 | tail -4
git add src/extension/services/struggle/signals/feedbackViewState.ts src/extension/services/struggle/signals/buildDelta.ts test/logic/struggle/feedbackViewState.test.ts test/logic/struggle/buildDelta.test.ts
git commit -m "feat(struggle): feedback-view state and build-delta classification"
```

---

### Task 8: signals/javaMethods.ts (lib/replay.py parser port)

**Reference (Python, frozen):** `sanitize_java` replaces comments and string/char literals with spaces (length-preserving, newlines kept; escape pairs inside literals blanked); `parse_methods` finds candidates `identifier ( ... ) [throws ...] {` at brace depth 1 on the sanitized text, excluding keywords {if,for,while,switch,catch,do,else,try,finally,return,new,throw,assert,super,this,synchronized}; body span via brace counting; unbalanced body -> span to EOF with closed=False; `method_at_line` returns the method whose line span contains the line — on overlap (unbalanced spans) the LAST preceding signature (largest start_line <= line) wins, implemented as: iterate methods ascending by start_offset, keep the last hit, break once start_line > line.

**Files:**
- Create: `extension/src/extension/services/struggle/signals/javaMethods.ts`
- Test: `extension/test/logic/struggle/javaMethods.test.ts`

- [ ] **Step 8.1: Write the failing tests:**

```ts
import { describe, expect, it } from 'vitest';

import { methodAtLine, parseMethods, sanitizeJava } from '@extension/services/struggle/signals/javaMethods';

const CLS = `public class Planner {
    private int count; // a field

    public Planner(int count) {
        this.count = count;
    }

    public int getCount() {
        if (count > 0) {
            return count;
        }
        return 0;
    }

    public void setCount(int c) throws IllegalArgumentException {
        String s = "not a method() {";
        count = c;
    }
}`;

describe('sanitizeJava', () => {
    it('blanks comments and string literals, preserving length and newlines', () => {
        const s = sanitizeJava(CLS);
        expect(s.length).toBe(CLS.length);
        expect(s.split('\n').length).toBe(CLS.split('\n').length);
        expect(s).not.toContain('a field');
        expect(s).not.toContain('not a method');
    });
    it('handles escaped quotes inside strings', () => {
        const s = sanitizeJava('String x = "a\\"b{"; int y;');
        expect(s).not.toContain('{');           // brace was inside the literal
        expect(s).toContain('int y;');
    });
});

describe('parseMethods', () => {
    it('finds methods and constructors with their line spans', () => {
        const ms = parseMethods(CLS);
        expect(ms.map(m => m.name)).toEqual(['Planner', 'getCount', 'setCount']);
        const get = ms[1];
        expect(get.startLine).toBe(7);
        expect(get.endLine).toBe(12);
        expect(get.closed).toBe(true);
    });
    it('excludes control-flow keywords (the if is not a method)', () => {
        expect(parseMethods(CLS).some(m => m.name === 'if')).toBe(false);
    });
    it('only matches at class-body depth 1 (nested calls are not methods)', () => {
        const src = `class A {\n    void run() {\n        helper(1);\n    }\n}`;
        expect(parseMethods(src).map(m => m.name)).toEqual(['run']);
    });
    it('unbalanced body extends to EOF with closed=false (mid-typing)', () => {
        const src = `class A {\n    void broken() {\n        int x = 1;\n    void after() { }\n}`;
        const ms = parseMethods(src);
        const broken = ms.find(m => m.name === 'broken')!;
        expect(broken.closed).toBe(false);
        expect(broken.endLine).toBe(src.split('\n').length - 1);
    });
    it('throws clause is tolerated between params and body', () => {
        expect(parseMethods(CLS).find(m => m.name === 'setCount')).toBeDefined();
    });
});

describe('methodAtLine', () => {
    it('maps a line inside the body to its method', () => {
        const ms = parseMethods(CLS);
        expect(methodAtLine(ms, 9)?.name).toBe('getCount');
        expect(methodAtLine(ms, 1)).toBeNull();           // field line
    });
    it('on overlapping (unbalanced) spans the LAST preceding signature wins', () => {
        const src = `class A {\n    void broken() {\n        int x;\n    void after() {\n        int y;\n    }\n}`;
        const ms = parseMethods(src);
        expect(methodAtLine(ms, 4)?.name).toBe('after');
    });
});
```

(IMPORTANT — verify the line expectations against the actual `CLS` literal when implementing: lines are 0-based; recount if the fixture is reformatted.)

- [ ] **Step 8.2: Implement `javaMethods.ts`** (faithful port; ~150 lines):

```ts
// extension/src/extension/services/struggle/signals/javaMethods.ts
/**
 * Java method boundaries via regex + brace counting (NOT a full parser),
 * declared Java-only. Port of sanitize_java / parse_methods / method_at_line
 * (lib/replay.py, frozen). Operates on the document text BEFORE a change;
 * candidates are `identifier ( ... ) [throws ...] {` at brace depth 1.
 */

export interface JavaMethod {
    readonly name: string;
    /** 0-based line of the method name. */
    readonly startLine: number;
    /** 0-based line of the closing brace (inclusive); EOF line if unbalanced. */
    readonly endLine: number;
    readonly startOffset: number;
    /** Offset AFTER the closing brace; text.length if unbalanced. */
    readonly endOffset: number;
    readonly closed: boolean;
}

const NON_METHOD_KEYWORDS = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'try', 'finally',
    'return', 'new', 'throw', 'assert', 'super', 'this', 'synchronized',
]);

/** Replace comments and string/char literals with spaces (length-preserving,
 *  newlines kept) so brace/paren counting cannot be fooled by literal content. */
export function sanitizeJava(text: string): string {
    const out = text.split('');
    const n = text.length;
    let i = 0;
    let state: 'code' | 'line' | 'block' | 'string' | 'char' = 'code';
    while (i < n) {
        const c = text[i];
        const next = i + 1 < n ? text[i + 1] : '';
        if (state === 'code') {
            if (c === '/' && next === '/') { state = 'line'; out[i] = out[i + 1] = ' '; i += 2; continue; }
            if (c === '/' && next === '*') { state = 'block'; out[i] = out[i + 1] = ' '; i += 2; continue; }
            if (c === '"') { state = 'string'; out[i] = ' '; }
            else if (c === "'") { state = 'char'; out[i] = ' '; }
            i++;
        } else if (state === 'line') {
            if (c === '\n') { state = 'code'; } else { out[i] = ' '; }
            i++;
        } else if (state === 'block') {
            if (c === '*' && next === '/') { state = 'code'; out[i] = out[i + 1] = ' '; i += 2; continue; }
            if (c !== '\n') { out[i] = ' '; }
            i++;
        } else {
            const quote = state === 'string' ? '"' : "'";
            if (c === '\\' && next !== '') {
                out[i] = ' ';
                if (next !== '\n') { out[i + 1] = ' '; }
                i += 2;
                continue;
            }
            if (c === quote) { state = 'code'; }
            if (c !== '\n') { out[i] = ' '; }
            i++;
        }
    }
    return out.join('');
}

function lineStarts(text: string): number[] {
    const starts = [0];
    let pos = text.indexOf('\n');
    while (pos !== -1) {
        starts.push(pos + 1);
        pos = text.indexOf('\n', pos + 1);
    }
    return starts;
}

function offsetToLine(starts: readonly number[], offset: number): number {
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= offset) { lo = mid + 1; } else { hi = mid; }
    }
    return lo - 1;
}

function matchingDelim(s: string, openIdx: number, open: string, close: string): number | null {
    let depth = 0;
    for (let i = openIdx; i < s.length; i++) {
        if (s[i] === open) { depth++; }
        else if (s[i] === close) {
            depth--;
            if (depth === 0) { return i; }
        }
    }
    return null;
}

const IDENT_PAREN_RE = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
const THROWS_RE = /^\s*(?:throws\s+[\w$.\s,]+?)?\s*\{/;

export function parseMethods(text: string): JavaMethod[] {
    const s = sanitizeJava(text);
    const starts = lineStarts(text);
    const openPositions: number[] = [];
    const closePositions: number[] = [];
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '{') { openPositions.push(i); }
        else if (s[i] === '}') { closePositions.push(i); }
    }
    const countLE = (arr: readonly number[], x: number): number => {
        let lo = 0;
        let hi = arr.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (arr[mid] <= x) { lo = mid + 1; } else { hi = mid; }
        }
        return lo;
    };
    const depthAt = (offset: number): number =>
        countLE(openPositions, offset - 1) - countLE(closePositions, offset - 1);

    const methods: JavaMethod[] = [];
    IDENT_PAREN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IDENT_PAREN_RE.exec(s)) !== null) {
        const name = m[1];
        const nameStart = m.index + m[0].indexOf(name);
        if (NON_METHOD_KEYWORDS.has(name)) { continue; }
        if (depthAt(nameStart) !== 1) { continue; }        // class-body level only
        const parenOpen = m.index + m[0].length - 1;
        const parenClose = matchingDelim(s, parenOpen, '(', ')');
        if (parenClose === null) { continue; }
        const tail = THROWS_RE.exec(s.slice(parenClose + 1));
        if (tail === null) { continue; }
        const bodyOpen = parenClose + 1 + tail[0].length - 1;
        const bodyClose = matchingDelim(s, bodyOpen, '{', '}');
        const [endOffset, closed] = bodyClose === null ? [text.length, false] : [bodyClose + 1, true];
        methods.push({
            name,
            startLine: offsetToLine(starts, nameStart),
            endLine: offsetToLine(starts, endOffset - 1),
            startOffset: nameStart,
            endOffset,
            closed,
        });
    }
    methods.sort((a, b) => a.startOffset - b.startOffset);
    return methods;
}

/** Method whose span contains the 0-based line; on overlapping (unbalanced)
 *  spans the LAST preceding signature wins (largest startLine <= line). */
export function methodAtLine(methods: readonly JavaMethod[], line: number): JavaMethod | null {
    let hit: JavaMethod | null = null;
    for (const m of methods) {
        if (m.startLine <= line && line <= m.endLine) { hit = m; }
        else if (m.startLine > line) { break; }
    }
    return hit;
}
```

PORT-FIDELITY NOTES the implementer must respect:
- Python computes `start_line` from `m.start(1)` (the NAME position, not the match start). The regex `\b...` makes `m.index` equal the name start in TS as well, but compute `nameStart` via `indexOf(name)` defensively as shown.
- `THROWS_RE` is anchored with `^` and applied to a SLICE starting at `parenClose + 1` — equivalent to Python's `re.match(s, pos)`.
- `depthAt(offset)` counts braces with position `<= offset - 1` (strictly before the name) — keep the `- 1`.
- Differences from Python's `lru_cache`: caching happens one level up (the A8 tracker parses once per textChange EVENT, Task 9), so no cache here.

Run the tests — PASS. If the fixture-line assertions fail, FIRST recount the fixture lines (0-based) before touching the parser.

- [ ] **Step 8.3: Gates + commit**

```bash
npm run check-types && npm run lint && npx vitest run test/logic/struggle 2>&1 | tail -4
git add src/extension/services/struggle/signals/javaMethods.ts test/logic/struggle/javaMethods.test.ts
git commit -m "feat(struggle): java method-boundary parser"
```

---

### Task 9: signals/documentShadow.ts + signals/regionPersistence.ts (A8)

**Reference (Python, frozen):**

```python
# edit_method_map (03_method_map.py): one row per SINGLE change of each
# textChange event; line = change.range.startLine in the document state BEFORE
# the event; method parsed from the BEFORE state; changes without a known
# before state are EXCLUDED entirely (missing_snapshot -> continue).
#
# canonical map (engine_v2._canonical_method_map): names with <= 3 changes map
# to the most frequent (> 3 changes) name of the SAME file when the rare name
# is a subsequence of the frequent one or contains it as a substring; targets
# sorted by descending count, first match wins.
#
# f_a8 at tick t (engine_v2.compute_features): sliding window (t-300, t];
# total = ALL changes in the window (unmapped/None keys INCLUDED);
# dom = max count over canonicalized non-None keys;
# f_a8 = 1 iff t >= 300 AND total >= 30 AND dom/total >= 0.8.
```

**Files:**
- Create: `extension/src/extension/services/struggle/signals/documentShadow.ts`
- Create: `extension/src/extension/services/struggle/signals/regionPersistence.ts`
- Test: `extension/test/logic/struggle/regionPersistence.test.ts`

- [ ] **Step 9.1: Failing tests:**

```ts
import { describe, expect, it } from 'vitest';

import { DocumentShadowTracker } from '@extension/services/struggle/signals/documentShadow';
import { A8Tracker, canonicalMethodMap } from '@extension/services/struggle/signals/regionPersistence';

describe('DocumentShadowTracker', () => {
    it('returns the seeded text as before-state, then the synced after-state', () => {
        const d = new DocumentShadowTracker();
        d.seed('file:///a', 'v1');
        expect(d.beforeText('file:///a')).toBe('v1');
        d.sync('file:///a', 'v2');
        expect(d.beforeText('file:///a')).toBe('v2');
    });
    it('unknown uri has no before-state', () => {
        expect(new DocumentShadowTracker().beforeText('file:///x')).toBeUndefined();
    });
});

describe('canonicalMethodMap (session-so-far canonicalization)', () => {
    it('maps rare subsequence names onto the dominant same-file name', () => {
        const counts = new Map<string, number>([
            ['F.java|getName', 10],
            ['F.java|getNam', 2],        // subsequence of getName
            ['F.java|getNameXY', 1],     // contains getName as substring
            ['G.java|getNam', 2],        // different file: no target there
        ]);
        const map = canonicalMethodMap(counts);
        expect(map.get('F.java|getNam')).toBe('getName');
        expect(map.get('F.java|getNameXY')).toBe('getName');
        expect(map.has('G.java|getNam')).toBe(false);
    });
    it('frequent names (> 3) are never remapped', () => {
        const counts = new Map<string, number>([
            ['F.java|run', 10],
            ['F.java|runX', 4],
        ]);
        expect(canonicalMethodMap(counts).size).toBe(0);
    });
});

describe('A8Tracker (region persistence state)', () => {
    function fill(a8: A8Tracker, n: number, t0: number, method: string | null): void {
        for (let i = 0; i < n; i++) {
            a8.recordChange(t0 + i * 0.5, 'file:///F.java', method);
        }
    }
    it('inactive before 5 minutes of history', () => {
        const a8 = new A8Tracker();
        fill(a8, 40, 10, 'work');
        expect(a8.activeAt(290)).toBe(false);   // t < 300
        expect(a8.activeAt(300)).toBe(true);
    });
    it('needs >= 30 changes in the window', () => {
        const a8 = new A8Tracker();
        fill(a8, 29, 290, 'work');
        expect(a8.activeAt(310)).toBe(false);
        fill(a8, 1, 305, 'work');
        expect(a8.activeAt(310)).toBe(true);
    });
    it('unmapped changes dilute the dominance share', () => {
        const a8 = new A8Tracker();
        fill(a8, 30, 200, 'work');               // 30 mapped
        fill(a8, 10, 220, null);                  // 10 unmapped -> share 30/40 = 0.75 < 0.8
        expect(a8.activeAt(300)).toBe(false);
    });
    it('window is sliding: old changes drop out after 300 s', () => {
        const a8 = new A8Tracker();
        fill(a8, 30, 10, 'work');                 // ts 10..24.5
        expect(a8.activeAt(320)).toBe(true);      // window (20, 320]: only 9 changes ... recompute below
    });
    it('transient names canonicalize into the dominant method (causal map)', () => {
        const a8 = new A8Tracker();
        fill(a8, 28, 200, 'getName');
        fill(a8, 4, 215, 'getNam');               // transient (4 > 3? no: <= 3 needed) -> use 3
    });
});
```

STOP — the last two cases above are deliberately marked for the implementer to FINISH precisely (the plan author flags them as needing exact arithmetic rather than hand-waved expectations). Replace them with these exact versions:

```ts
    it('window is sliding: old changes drop out after 300 s', () => {
        const a8 = new A8Tracker();
        // 30 changes at ts 10..24.5 — all inside (20, 320]? No: ts <= 20 excluded.
        // Window for t=320 is (20, 320]: changes at 20.5..24.5 remain = 9 of them.
        fill(a8, 30, 10, 'work');                 // ts = 10, 10.5, ..., 24.5
        expect(a8.activeAt(300)).toBe(true);      // window (0, 300] holds all 30
        expect(a8.activeAt(320)).toBe(false);     // only 9 changes left in window (< 30)
    });
    it('transient names canonicalize into the dominant method (causal map)', () => {
        const a8 = new A8Tracker();
        fill(a8, 28, 200, 'getName');             // dominant: 28 > 3
        fill(a8, 3, 215, 'getNam');               // transient: 3 <= 3, subsequence
        // 31 changes total in (0, 300], all canonicalize to getName -> share 1.0
        expect(a8.activeAt(300)).toBe(true);
    });
```

(`fill` uses 0.5-s spacing: `fill(a8, 30, 10, ...)` produces ts 10.0, 10.5, ..., 24.5; the count inside `(20, 320]` is the 9 changes at 20.5..24.5 — implementer: re-verify this arithmetic before asserting.)

- [ ] **Step 9.2: Implement `documentShadow.ts`:**

```ts
// extension/src/extension/services/struggle/signals/documentShadow.ts
/**
 * Before-text shadow per document URI. The A8 region mapping needs the
 * document state BEFORE each textChange (ranges refer to the pre-change
 * state); VS Code only hands us the post-change document, so the engine keeps
 * the previous getText() per URI: beforeText() returns the shadow, sync()
 * stores the post-change truth for the next event. Seeded at session start
 * from the open documents and on every onDidOpenTextDocument.
 */
export class DocumentShadowTracker {
    private readonly _texts = new Map<string, string>();

    seed(uriKey: string, text: string): void {
        this._texts.set(uriKey, text);
    }

    /** Document text before the current change event; undefined if never seen
     *  (the change is then EXCLUDED from A8, matching the offline pipeline's
     *  missing_snapshot semantics). */
    beforeText(uriKey: string): string | undefined {
        return this._texts.get(uriKey);
    }

    /** Store the post-change document text (event.document.getText()). */
    sync(uriKey: string, text: string): void {
        this._texts.set(uriKey, text);
    }

    drop(uriKey: string): void {
        this._texts.delete(uriKey);
    }

    reset(): void {
        this._texts.clear();
    }
}
```

- [ ] **Step 9.3: Implement `regionPersistence.ts`:**

```ts
// extension/src/extension/services/struggle/signals/regionPersistence.ts
/**
 * A8 region-persistence state (spec §1 f_a8): >= 80 % of the textChanges of
 * the last 5 minutes in the SAME canonicalized method AND >= 30 changes AND
 * >= 5 minutes of history. Port of the F1 definition (engine_v2.py f_a8 +
 * _canonical_method_map) with ONE declared causal deviation: the canonical
 * map is built from session-SO-FAR counts at each tick instead of
 * whole-session counts (PR 2b plan, Decision 4).
 *
 * Keys are `${uriKey}|${method}`; unmapped changes (method null) count toward
 * the window total but never toward dominance.
 */
import { SPEC } from '@extension/services/struggle/constants';

function isSubsequence(short: string, long: string): boolean {
    let i = 0;
    for (const c of long) {
        if (i < short.length && short[i] === c) { i++; }
    }
    return i === short.length;
}

const keyOf = (file: string, method: string): string => `${file}|${method}`;
const splitKey = (key: string): [string, string] => {
    const idx = key.indexOf('|');
    return [key.slice(0, idx), key.slice(idx + 1)];
};

/**
 * F1 canonicalization over the given counts: a name with <= 3 changes maps to
 * the most frequent (> 3) name of the same file when it is a subsequence of
 * that name or contains it as a substring.
 */
export function canonicalMethodMap(counts: ReadonlyMap<string, number>): Map<string, string> {
    const mapping = new Map<string, string>();
    for (const [key, count] of counts) {
        if (count > 3) { continue; }
        const [file, method] = splitKey(key);
        const targets: Array<[string, number]> = [];
        for (const [otherKey, otherCount] of counts) {
            if (otherCount <= 3) { continue; }
            const [otherFile, otherMethod] = splitKey(otherKey);
            if (otherFile === file && otherMethod !== method) {
                targets.push([otherMethod, otherCount]);
            }
        }
        targets.sort((a, b) => b[1] - a[1]);
        for (const [target] of targets) {
            if (isSubsequence(method, target) || method.includes(target)) {
                mapping.set(key, target);
                break;
            }
        }
    }
    return mapping;
}

interface ChangeRow { tsS: number; key: string | null }

export class A8Tracker {
    private readonly _rows: ChangeRow[] = [];
    private readonly _counts = new Map<string, number>();

    /** One single change (change granularity, not event granularity). method
     *  null = change outside any parsed method (counted, never dominant). */
    recordChange(tsS: number, uriKey: string, method: string | null): void {
        const key = method === null ? null : keyOf(uriKey, method);
        this._rows.push({ tsS, key });
        if (key !== null) {
            this._counts.set(key, (this._counts.get(key) ?? 0) + 1);
        }
    }

    activeAt(tS: number): boolean {
        if (tS < SPEC.A8_WINDOW_S) {
            return false;
        }
        const w0 = tS - SPEC.A8_WINDOW_S;
        // Window (w0, t]: binary search both bounds.
        const lo = upperBound(this._rows, w0);
        const hi = upperBound(this._rows, tS);
        const total = hi - lo;
        if (total < SPEC.A8_MIN_CHANGES) {
            return false;
        }
        const canonical = canonicalMethodMap(this._counts);
        const windowCounts = new Map<string, number>();
        for (let i = lo; i < hi; i++) {
            const raw = this._rows[i].key;
            if (raw === null) { continue; }
            const [file, method] = splitKey(raw);
            const mapped = canonical.get(raw) ?? method;
            const key = keyOf(file, mapped);
            windowCounts.set(key, (windowCounts.get(key) ?? 0) + 1);
        }
        let dom = 0;
        for (const c of windowCounts.values()) {
            dom = Math.max(dom, c);
        }
        return dom / total >= SPEC.A8_SHARE;
    }

    reset(): void {
        this._rows.length = 0;
        this._counts.clear();
    }
}

function upperBound(rows: readonly ChangeRow[], x: number): number {
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].tsS <= x) { lo = mid + 1; } else { hi = mid; }
    }
    return lo;
}
```

Run the tests — PASS.

- [ ] **Step 9.4: Gates + commit**

```bash
npm run check-types && npm run lint && npx vitest run test/logic/struggle 2>&1 | tail -4
git add src/extension/services/struggle/signals/documentShadow.ts src/extension/services/struggle/signals/regionPersistence.ts test/logic/struggle/regionPersistence.test.ts
git commit -m "feat(struggle): A8 region persistence with causal canonicalization"
```

---

### Task 10: signals/errorDistance.ts (N2)

**Reference (Python, frozen):**

```python
# error_lifetimes (02_event_tables.py): each diagnostics event is the COMPLETE
# current state for its uri (empty array = all resolved). Identity =
# (uri, code, message); within an identity, concurrent instances are tracked
# across line shifts by an order-preserving min-line-distance alignment
# (_align: DP forming min(m, n) pairs, skips only for the surplus, minimizing
# the sum of |line differences|; matched instances keep t_first, update line;
# unmatched open instances are resolved; unmatched new lines become new
# instances with t_first = event time).
#
# f_n2 at tick t (engine_v2.compute_features): cursor = LAST selectionChange
# at or before t (uri + endLine of the first selection); f_n2 = 1 iff some
# ACTIVE instance has (t - t_first > 60) AND same uri as the cursor AND
# |line_first - cursorLine| > 3. Severity filter: only severity ERROR (0).
# CAUSAL DEVIATION (Decision 4): an instance is active until the snapshot
# that removes it (Python retroactively ended activity at last confirmation).
```

**Files:**
- Create: `extension/src/extension/services/struggle/signals/errorDistance.ts`
- Test: `extension/test/logic/struggle/errorDistance.test.ts`

- [ ] **Step 10.1: Failing tests:**

```ts
import { describe, expect, it } from 'vitest';

import { alignLines, N2Tracker, normalizeDiagnosticCode } from '@extension/services/struggle/signals/errorDistance';

describe('alignLines (order-preserving min-distance alignment)', () => {
    it('pairs equal-length lists in order', () => {
        expect(alignLines([3, 10], [4, 11])).toEqual([[0, 0], [1, 1]]);
    });
    it('forms min(m,n) pairs, skipping the surplus to minimize total distance', () => {
        expect(alignLines([5], [1, 5, 9])).toEqual([[0, 1]]);
        expect(alignLines([1, 5, 9], [5])).toEqual([[1, 0]]);
    });
    it('never crosses pairs (order preserved)', () => {
        // naive nearest-match would pair 10->9 and 11->12 crossing 10->12;
        // order-preserving optimum is (10->9),(11->12)
        expect(alignLines([10, 11], [9, 12])).toEqual([[0, 0], [1, 1]]);
    });
    it('empty sides produce no pairs', () => {
        expect(alignLines([], [1])).toEqual([]);
        expect(alignLines([1], [])).toEqual([]);
    });
});

describe('normalizeDiagnosticCode (one shared identity normalization)', () => {
    it('matches the offline reference: missing -> "None", numbers/strings/objects -> value string', () => {
        expect(normalizeDiagnosticCode(undefined)).toBe('None');
        expect(normalizeDiagnosticCode(null)).toBe('None');
        expect(normalizeDiagnosticCode(1234)).toBe('1234');
        expect(normalizeDiagnosticCode('compiler.err.x')).toBe('compiler.err.x');
        expect(normalizeDiagnosticCode({ value: 'E42' })).toBe('E42');
    });
});

describe('N2Tracker (far long-lived error vs cursor)', () => {
    const URI = 'file:///F.java';
    function err(line: number, code = 'E1', message = 'msg'): { line: number; code: string; message: string } {
        return { line, code, message };
    }

    it('fires only after 60 s of continuous activity, > 3 lines from the cursor, same uri', () => {
        const n2 = new N2Tracker();
        n2.ingestSnapshot(10, URI, [err(20)]);
        n2.ingestSelection(15, URI, 10);              // distance |20-10| = 10 > 3
        expect(n2.activeAt(60)).toBe(false);           // 60 - 10 = 50 <= 60
        expect(n2.activeAt(70.001)).toBe(true);        // > 60 strictly
        expect(n2.activeAt(70)).toBe(false);           // exactly 60: NOT > 60
    });
    it('near errors (<= 3 lines) never fire', () => {
        const n2 = new N2Tracker();
        n2.ingestSnapshot(10, URI, [err(12)]);
        n2.ingestSelection(15, URI, 10);               // distance 2
        expect(n2.activeAt(100)).toBe(false);
    });
    it('cursor in another file never fires', () => {
        const n2 = new N2Tracker();
        n2.ingestSnapshot(10, URI, [err(20)]);
        n2.ingestSelection(15, 'file:///G.java', 0);
        expect(n2.activeAt(100)).toBe(false);
    });
    it('no cursor position -> 0 (missing handling, spec §0)', () => {
        const n2 = new N2Tracker();
        n2.ingestSnapshot(10, URI, [err(20)]);
        expect(n2.activeAt(100)).toBe(false);
    });
    it('an empty snapshot resolves instances (causal: inactive from removal on)', () => {
        const n2 = new N2Tracker();
        n2.ingestSnapshot(10, URI, [err(20)]);
        n2.ingestSelection(15, URI, 10);
        n2.ingestSnapshot(50, URI, []);
        expect(n2.activeAt(120)).toBe(false);
    });
    it('line shifts keep t_first (alignment) and use line_first for distance', () => {
        const n2 = new N2Tracker();
        n2.ingestSnapshot(10, URI, [err(20)]);
        n2.ingestSnapshot(40, URI, [err(23)]);         // same identity, shifted
        n2.ingestSelection(45, URI, 18);               // |line_first 20 - 18| = 2 <= 3 -> near
        expect(n2.activeAt(120)).toBe(false);
        n2.ingestSelection(125, URI, 10);              // |20 - 10| = 10 > 3, t_first = 10
        expect(n2.activeAt(130)).toBe(true);
    });
    it('a new identity resets t_first', () => {
        const n2 = new N2Tracker();
        n2.ingestSnapshot(10, URI, [err(20, 'E1')]);
        n2.ingestSnapshot(50, URI, [err(20, 'E2')]);   // different code: new instance
        n2.ingestSelection(55, URI, 10);
        expect(n2.activeAt(100)).toBe(false);          // 100 - 50 = 50 <= 60
        expect(n2.activeAt(115)).toBe(true);
    });
});
```

- [ ] **Step 10.2: Implement `errorDistance.ts`:**

```ts
// extension/src/extension/services/struggle/signals/errorDistance.ts
/**
 * N2 (spec §1 f_n2): an error diagnostic that has been continuously active
 * for > 60 s, more than 3 lines from the last cursor position in the same
 * file. Instance tracking ports error_lifetimes_for (02_event_tables.py):
 * identity (uri, code, message), order-preserving min-distance line alignment
 * across snapshots; matched instances keep t_first (the distance check uses
 * line_first, NOT the current line). Causal deviation, Decision 4: activity
 * ends at the removing snapshot.
 */
import { SPEC } from '@extension/services/struggle/constants';

const SKIP_COST = 1e7;

/** Order-preserving min-total-distance alignment of two ascending line lists.
 *  Returns index pairs [iOpen, iNew]; always min(m, n) pairs. Port of _align. */
export function alignLines(openLines: readonly number[], newLines: readonly number[]): Array<[number, number]> {
    const m = openLines.length;
    const n = newLines.length;
    if (m === 0 || n === 0) {
        return [];
    }
    const memo = new Map<number, { cost: number; choice: 'match' | 'skip_open' | 'skip_new' }>();
    const idx = (i: number, j: number): number => i * (n + 1) + j;
    const f = (i: number, j: number): number => {
        if (i === m) { return (n - j) * SKIP_COST; }
        if (j === n) { return (m - i) * SKIP_COST; }
        const cached = memo.get(idx(i, j));
        if (cached !== undefined) { return cached.cost; }
        const cMatch = Math.abs(openLines[i] - newLines[j]) + f(i + 1, j + 1);
        const cSkipOpen = SKIP_COST + f(i + 1, j);
        const cSkipNew = SKIP_COST + f(i, j + 1);
        const best = Math.min(cMatch, cSkipOpen, cSkipNew);
        const choice = best === cMatch ? 'match' : best === cSkipOpen ? 'skip_open' : 'skip_new';
        memo.set(idx(i, j), { cost: best, choice });
        return best;
    };
    f(0, 0);
    const pairs: Array<[number, number]> = [];
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
        const choice = memo.get(idx(i, j))!.choice;
        if (choice === 'match') {
            pairs.push([i, j]);
            i++; j++;
        } else if (choice === 'skip_open') {
            i++;
        } else {
            j++;
        }
    }
    return pairs;
}

export interface ErrorDiagnostic {
    /** 0-based start line of the diagnostic range. */
    readonly line: number;
    readonly code: string;
    readonly message: string;
}

/**
 * THE one normalization of vscode.Diagnostic.code into the N2 identity key,
 * shared by live intake (struggleEngine) and replay (PR 3). Matches the
 * offline reference, which keyed with Python str(d.get("code")): a missing
 * code becomes the literal "None" (NOT "undefined"), numbers their decimal
 * string, object codes their value. Live/replay/golden identity equality
 * depends on every consumer using exactly this function.
 */
export function normalizeDiagnosticCode(code: string | number | { value: string | number } | undefined | null): string {
    if (code === undefined || code === null) {
        return 'None';
    }
    if (typeof code === 'object') {
        return String(code.value);
    }
    return String(code);
}

interface Instance {
    line: number;
    readonly lineFirst: number;
    readonly tFirstS: number;
}

export class N2Tracker {
    /** open[`${uri} ${code} ${message}`] -> instances sorted by line. */
    private readonly _open = new Map<string, Instance[]>();
    private readonly _uriOfKey = new Map<string, string>();
    private _cursor: { uriKey: string; line: number } | null = null;

    /** Full current ERROR-severity diagnostics for one uri (empty = resolved). */
    ingestSnapshot(tsS: number, uriKey: string, errors: readonly ErrorDiagnostic[]): void {
        const newByKey = new Map<string, number[]>();
        for (const e of errors) {
            const key = `${uriKey} ${e.code} ${e.message}`;
            const lines = newByKey.get(key);
            if (lines) { lines.push(e.line); } else { newByKey.set(key, [e.line]); }
        }
        const keys = new Set<string>(newByKey.keys());
        for (const [key, uri] of this._uriOfKey) {
            if (uri === uriKey) { keys.add(key); }
        }
        for (const key of keys) {
            const cur = (this._open.get(key) ?? []).sort((a, b) => a.line - b.line);
            const newLines = (newByKey.get(key) ?? []).sort((a, b) => a - b);
            const pairs = alignLines(cur.map(c => c.line), newLines);
            const matchedOpen = new Set(pairs.map(p => p[0]));
            const matchedNew = new Set(pairs.map(p => p[1]));
            const survivors: Instance[] = [];
            for (const [i, j] of pairs) {
                cur[i].line = newLines[j];
                survivors.push(cur[i]);
            }
            void matchedOpen; // unmatched open instances are resolved (dropped)
            newLines.forEach((line, j) => {
                if (!matchedNew.has(j)) {
                    survivors.push({ line, lineFirst: line, tFirstS: tsS });
                }
            });
            if (survivors.length > 0) {
                this._open.set(key, survivors);
                this._uriOfKey.set(key, uriKey);
            } else {
                this._open.delete(key);
                this._uriOfKey.delete(key);
            }
        }
    }

    /** Last cursor position (uri + endLine of the FIRST selection of the event). */
    ingestSelection(_tsS: number, uriKey: string, endLine: number): void {
        this._cursor = { uriKey, line: endLine };
    }

    activeAt(tS: number): boolean {
        if (this._cursor === null) {
            return false;                              // no cursor -> 0 (spec §0)
        }
        for (const [key, instances] of this._open) {
            if (this._uriOfKey.get(key) !== this._cursor.uriKey) { continue; }
            for (const inst of instances) {
                if (tS - inst.tFirstS > SPEC.N2_MIN_ACTIVE_S
                    && Math.abs(inst.lineFirst - this._cursor.line) > SPEC.N2_DIST_LINES) {
                    return true;
                }
            }
        }
        return false;
    }

    reset(): void {
        this._open.clear();
        this._uriOfKey.clear();
        this._cursor = null;
    }
}
```

Run the tests — PASS. (The `void matchedOpen` line: keep or drop the variable — eslint no-unused-vars decides; resolved instances simply do not survive.)

- [ ] **Step 10.3: Gates + commit**

```bash
npm run check-types && npm run lint && npx vitest run test/logic/struggle 2>&1 | tail -4
git add src/extension/services/struggle/signals/errorDistance.ts test/logic/struggle/errorDistance.test.ts
git commit -m "feat(struggle): N2 error-distance tracking with line alignment"
```

---

### Task 11: struggleEngine.ts — the orchestrator (tick contract; T8d end-to-end)

**Files:**
- Create: `extension/src/extension/services/struggle/struggleEngine.ts`
- Test: `extension/test/unit/services/struggle/struggleEngine.test.ts`

**Design (tick contract, Decision 3):** every hub subscription pushes a `{ tsS, apply }` thunk into ONE queue (it does NOT mutate trackers immediately — `fastDecay`, `N2`, and the feedback map are current-state trackers, and a thunk arriving microseconds after a grid time must not leak into that tick). `advanceTo(nowMs)` processes every due grid tick in order: stable-sort the queue by `tsS` (debounced emissions arrive out of order by design), apply all thunks with `tsS <= tick`, then compute the tick. The live timer only calls `advanceTo(clock.now())` and is catch-up safe.

- [ ] **Step 11.1: Write the failing tests** (mocha; TestSensorHub; sinon fake timers ONLY where the default clock/debouncers are exercised):

```ts
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import type { ResultDTO } from '@extension/domain/submissions';
import { StruggleEngine } from '@extension/services/struggle/struggleEngine';
import type { AlertRecord, TickRecord } from '@extension/services/struggle/types';
import { TestSensorHub } from '@test/__shared__/testSensorHub';

function failingResult(failed: string[], buildFailed = false): ResultDTO {
    return {
        id: 1,
        submission: { id: 1, buildFailed },
        feedbacks: failed.map(d => ({ positive: false, detailText: d, text: 't' })),
    } as unknown as ResultDTO;
}

function fakeTextChange(uri: string, oneCharTexts: string[], fullText: string): { ts: number; event: unknown } {
    return {
        ts: 0, // caller overwrites
        event: {
            document: { uri: vscode.Uri.parse(uri), getText: () => fullText },
            contentChanges: oneCharTexts.map(text => ({
                text,
                rangeLength: 0,
                range: { start: { line: 0 }, isEmpty: true, isSingleLine: true },
            })),
        },
    };
}

suite('StruggleEngine (tick contract end-to-end)', () => {
    const START = 1_000_000_000_000;
    let hub: TestSensorHub;
    let engine: StruggleEngine;
    let ticks: TickRecord[];
    let alerts: AlertRecord[];

    setup(() => {
        hub = new TestSensorHub();
        engine = new StruggleEngine(hub);
        ticks = [];
        alerts = [];
        engine.onDidTick(t => ticks.push(t));
        engine.onDidAlert(a => alerts.push(a));
        engine.start({ sessionStartMs: START });
    });
    teardown(() => { engine.dispose(); });

    test('emits one TickRecord per 10 s grid point, catch-up safe', () => {
        engine.advanceTo(START + 60_000);
        assert.deepStrictEqual(ticks.map(t => t.t), [10, 20, 30, 40, 50, 60]);
        assert.strictEqual(ticks[0].ts, START + 10_000);
    });

    test('T8d: an idle session alerts at the first warmup-free tick (t=490)', () => {
        engine.advanceTo(START + 520_000);
        assert.deepStrictEqual(alerts.map(a => a.t), [490]);
        assert.strictEqual(alerts[0].primary, 'STATE');
        assert.strictEqual(alerts[0].path, 'armed');
        // idle severity: fTyping=1, fGap=1, fN4=0.1 -> S = 0.7 >= theta
        const tick49 = ticks.find(t => t.t === 490)!;
        assert.ok(Math.abs(tick49.s - 0.7) < 1e-9);
    });

    test('E6 re-alerts every 120 s while the idle state persists', () => {
        engine.advanceTo(START + 740_000);
        assert.deepStrictEqual(alerts.map(a => a.t), [490, 610, 730]);
        assert.deepStrictEqual(alerts.map(a => a.path), ['armed', 'e6', 'e6']);
    });

    test('an FM boundary breaks through warmup when V is already high', () => {
        // idle until V >= theta (reached well before 400), bad build at 400 s
        engine.advanceTo(START + 400_000);
        hub.emit.buildResult.fire({ ts: START + 400_500, result: failingResult([], true) });
        engine.advanceTo(START + 480_000);
        assert.strictEqual(alerts[0]?.t, 410);
        assert.strictEqual(alerts[0]?.primary, 'FM');
        assert.strictEqual(alerts[0]?.inWarmup, true);
    });

    test('drain rule: an event with ts exactly on the grid belongs to that tick', () => {
        engine.advanceTo(START + 400_000);
        hub.emit.buildResult.fire({ ts: START + 410_000, result: failingResult([], true) });
        engine.advanceTo(START + 420_000);
        assert.strictEqual(alerts[0]?.t, 410);
    });

    test('fluent typing keeps severity low and B2 blocks (no alerts)', () => {
        // 2 one-char inserts per second, continuously
        for (let s = 1; s <= 600; s++) {
            const sig = fakeTextChange('file:///ws/Main.java', ['a', 'b'], 'class A {}');
            (sig as { ts: number }).ts = START + s * 1000;
            hub.emit.textChange.fire(sig as never);
        }
        engine.advanceTo(START + 600_000);
        assert.deepStrictEqual(alerts, []);
        const last = ticks[ticks.length - 1];
        assert.ok(last.features.typingRate >= 20);
    });

    test('uri filter: edits outside the exercise root are ignored', () => {
        engine.dispose();                      // abort path: no drain against real now()
        hub = new TestSensorHub();
        engine = new StruggleEngine(hub);
        ticks = [];
        engine.onDidTick(t => ticks.push(t));
        engine.start({ sessionStartMs: START, exerciseRoot: vscode.Uri.parse('file:///ws/ex1') });
        const inside = fakeTextChange('file:///ws/ex1/Main.java', ['a'], 'x');
        (inside as { ts: number }).ts = START + 5_000;
        hub.emit.textChange.fire(inside as never);
        const outside = fakeTextChange('file:///ws/other/Main.java', ['a'], 'x');
        (outside as { ts: number }).ts = START + 6_000;
        hub.emit.textChange.fire(outside as never);
        engine.advanceTo(START + 10_000);
        assert.strictEqual(ticks[ticks.length - 1].features.nOneCharInserts, 1);
    });

    test('feedback view bonus raises S by 0.25 while open in the window', () => {
        hub.emit.taskFeedbackView.fire({ ts: START + 5_000, action: 'opened', viewId: 'v1' });
        engine.advanceTo(START + 10_000);
        const t10 = ticks[0];
        assert.strictEqual(t10.features.fFb, 1);
        assert.ok(Math.abs(t10.s - Math.min(1, t10.sBase + 0.25)) < 1e-9);
    });

    test('stop() halts ticking; restart resets all state', () => {
        // NOTE: the default clock's now() is the real Date.now(), far beyond
        // START — stop()'s final drain would catch up across years of grid
        // ticks. Use a pinned manual clock for this lifecycle test.
        engine.dispose();
        hub = new TestSensorHub();
        let nowMs = START;
        engine = new StruggleEngine(hub, { now: () => nowMs, setInterval: () => 0, clearInterval: () => { /* manual */ } });
        ticks = [];
        engine.onDidTick(t => ticks.push(t));
        engine.start({ sessionStartMs: START });
        nowMs = START + 30_000;
        engine.advanceTo(nowMs);
        engine.stop();
        engine.advanceTo(START + 60_000);
        assert.strictEqual(ticks.length, 3);
        const START2 = START + 100_000;
        nowMs = START2;
        engine.start({ sessionStartMs: START2 });
        engine.advanceTo(START2 + 10_000);
        const first = ticks[ticks.length - 1];
        assert.strictEqual(first.t, 10);
        assert.strictEqual(first.v, first.s);     // V reset: first tick V = S
    });

    test('live timer drives ticks through the injectable clock (sinon)', () => {
        engine.dispose();
        const clock = sinon.useFakeTimers({ now: START, toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
        try {
            hub = new TestSensorHub();
            engine = new StruggleEngine(hub);
            const seen: number[] = [];
            engine.onDidTick(t => seen.push(t.t));
            engine.start({ sessionStartMs: START });
            clock.tick(30_000);
            assert.deepStrictEqual(seen, [10, 20, 30]);
        } finally {
            clock.restore();
            engine.dispose();
        }
    });

    test('stop() final drain: a due tick still consumes flushed debounced evidence', () => {
        engine.dispose();
        const clock = sinon.useFakeTimers({ now: START, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        try {
            hub = new TestSensorHub();
            // Manual engine clock: now() follows the faked Date, no interval —
            // reproduces "tick 70 due but not yet run" (timer jitter).
            engine = new StruggleEngine(hub, { now: () => Date.now(), setInterval: () => 0, clearInterval: () => { /* manual */ } });
            const seen: TickRecord[] = [];
            engine.onDidTick(t => seen.push(t));
            engine.start({ sessionStartMs: START });
            engine.advanceTo(START + 60_000);                  // ticks 10..60 ran
            clock.tick(69_950);                                 // now = +69.95 s
            const editor = { textEditor: { document: { uri: vscode.Uri.parse('file:///ws/Main.java') } } };
            hub.emit.visibleRanges.fire({ ts: Date.now(), event: editor as never });
            clock.tick(300);                                    // debouncer flushes at +70.25 s
            engine.stop();                                      // tick 70 is DUE and must run
            const t70 = seen.find(t => t.t === 70);
            assert.ok(t70, 'tick 70 must run during the final drain');
            assert.strictEqual(t70!.features.scrollEvents, 1);
        } finally {
            clock.restore();
            engine.dispose();
        }
    });

    test('preDebouncedIntake bypasses the debouncers (replay mode, Decision 5)', () => {
        engine.dispose();
        hub = new TestSensorHub();
        engine = new StruggleEngine(hub, undefined, { preDebouncedIntake: true });
        const seen: TickRecord[] = [];
        engine.onDidTick(t => seen.push(t));
        engine.start({ sessionStartMs: START });
        const editor = { textEditor: { document: { uri: vscode.Uri.parse('file:///ws/Main.java') } } };
        for (let i = 0; i < 3; i++) {
            hub.emit.visibleRanges.fire({ ts: START + 2_000 + i * 100, event: editor as never });
        }
        engine.advanceTo(START + 10_000);
        assert.strictEqual(seen[0].features.scrollEvents, 3);   // every recorded event counts
    });

    test('debounced scroll: a raw visibleRange burst counts once (recorder parity)', () => {
        engine.dispose();
        const clock = sinon.useFakeTimers({ now: START, toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
        try {
            hub = new TestSensorHub();
            engine = new StruggleEngine(hub);
            const seen: TickRecord[] = [];
            engine.onDidTick(t => seen.push(t));
            engine.start({ sessionStartMs: START });
            const editor = {
                textEditor: { document: { uri: vscode.Uri.parse('file:///ws/Main.java') } },
            };
            for (let i = 0; i < 5; i++) {
                clock.tick(50);
                hub.emit.visibleRanges.fire({ ts: Date.now(), event: editor as never });
            }
            clock.tick(10_000);
            const t10 = seen.find(t => t.t === 10)!;
            assert.strictEqual(t10.features.scrollEvents, 1);
        } finally {
            clock.restore();
            engine.dispose();
        }
    });
});
```

NOTE for the implementer: severity expectations like `0.7` for the idle case derive from fTyping=1, fGap=1, fN4=clip(((0+0.5)/(0+0.5))/10)=0.1, sBase=(1+1+0.1)/3=0.7, no bonuses. RE-VERIFY each numeric expectation by hand before trusting a failing test; if your derivation disagrees with the plan, STOP and report (the plan's numbers were hand-computed and codex-reviewed but the test run is the arbiter — never "fix" the engine to match a wrong expectation).

- [ ] **Step 11.2: Implement `struggleEngine.ts`:**

```ts
// extension/src/extension/services/struggle/struggleEngine.ts
/**
 * Engine-v2 orchestrator (spec §0-§5): consumes ONLY the sensorHub, computes
 * S/V/boundaries/gates/alerting on a strict 10-s grid (first tick at +10 s,
 * never at 0). One code path for live and replay (spec §5):
 *
 *   - every subscription pushes a timestamped thunk into one queue;
 *   - advanceTo(now) processes each due grid tick: apply all thunks with
 *     ts <= tick (stable-ordered by ts), THEN compute the tick;
 *   - the live interval timer only calls advanceTo(clock.now()) — timer
 *     jitter and missed timers are harmless (catch-up loop, nominal times).
 *
 * Sensor policy at intake mirrors the recorder (the frozen parameters were
 * derived on recorded streams): shouldRecordUri(uri, exerciseRoot) filtering;
 * selection/visibleRange trailing debounce (Decision 5).
 */
import * as vscode from 'vscode';

import type { ResultDTO } from '@extension/domain/submissions';
import type { SensorHub } from '@extension/services/sensing';
import { shouldRecordUri } from '@extension/services/sensing/uriFilter';
import { AlertStateMachine } from '@extension/services/struggle/alerting/alertStateMachine';
import { BoundaryTracker } from '@extension/services/struggle/boundaries/boundaryTracker';
import {
    SELECTION_DEBOUNCE_MS, SPEC, VISIBLE_RANGE_DEBOUNCE_MS,
} from '@extension/services/struggle/constants';
import { FastDecayTracker, VTracker } from '@extension/services/struggle/dynamics/decay';
import { TrailingDebouncer } from '@extension/services/struggle/intake/trailingDebouncer';
import { BuildDeltaTracker } from '@extension/services/struggle/signals/buildDelta';
import { DocumentShadowTracker } from '@extension/services/struggle/signals/documentShadow';
import { N2Tracker, normalizeDiagnosticCode } from '@extension/services/struggle/signals/errorDistance';
import { FeatureWindowTracker } from '@extension/services/struggle/signals/featureWindow';
import { FeedbackViewTracker } from '@extension/services/struggle/signals/feedbackViewState';
import { methodAtLine, parseMethods } from '@extension/services/struggle/signals/javaMethods';
import { A8Tracker } from '@extension/services/struggle/signals/regionPersistence';
import { severityFrom } from '@extension/services/struggle/signals/severity';
import type {
    AlertRecord, EngineClock, EngineSessionContext, TickRecord,
} from '@extension/services/struggle/types';

const DEFAULT_CLOCK: EngineClock = {
    now: () => Date.now(),
    setInterval: (cb, ms) => setInterval(cb, ms),
    clearInterval: handle => clearInterval(handle as Parameters<typeof clearInterval>[0]),
};

interface QueuedEvent { tsS: number; apply: () => void }

export class StruggleEngine implements vscode.Disposable {
    private readonly _hub: SensorHub;
    private readonly _clock: EngineClock;

    private readonly _onDidTick = new vscode.EventEmitter<TickRecord>();
    readonly onDidTick = this._onDidTick.event;
    private readonly _onDidAlert = new vscode.EventEmitter<AlertRecord>();
    readonly onDidAlert = this._onDidAlert.event;

    // Session state (rebuilt on every start()).
    private _session: EngineSessionContext | undefined;
    private _subscriptions: vscode.Disposable[] = [];
    private _timer: unknown;
    private _queue: QueuedEvent[] = [];
    private _nextTickS = SPEC.TICK_S;
    private _lastFmBadS: number | null = null;

    private _features = new FeatureWindowTracker();
    private _feedback = new FeedbackViewTracker();
    private _shadow = new DocumentShadowTracker();
    private _a8 = new A8Tracker();
    private _n2 = new N2Tracker();
    private _buildDelta = new BuildDeltaTracker();
    private _fastDecay = new FastDecayTracker();
    private _v = new VTracker();
    private _boundaries = new BoundaryTracker();
    private _machine = new AlertStateMachine();
    private _selectionDebounce: TrailingDebouncer<{ tsS: number; uriKey: string; endLine: number }> | undefined;
    private _scrollDebounce: TrailingDebouncer<number> | undefined;
    /** Replay feeds already-debounced recorded streams (Decision 5). */
    private readonly _preDebounced: boolean;

    constructor(
        hub: SensorHub,
        clock: EngineClock = DEFAULT_CLOCK,
        options?: { preDebouncedIntake?: boolean },
    ) {
        this._hub = hub;
        this._clock = clock;
        this._preDebounced = options?.preDebouncedIntake ?? false;
    }

    start(session: EngineSessionContext): void {
        // Teardown only (no final drain): the CALLER ends the previous session
        // explicitly via stop() when drain semantics are wanted (PR 2c session
        // fan-out does stop() then start()). This keeps start() safe for
        // tests/replay that control time themselves.
        this._teardown();
        this._session = session;
        this._resetState();
        this._attach();
        // Seed document shadows from the already-open documents (A8 before-text).
        for (const doc of this._hub.readTextDocuments()) {
            if (this._passesUriFilter(doc.uri)) {
                this._shadow.seed(doc.uri.toString(), doc.getText());
            }
        }
        this._timer = this._clock.setInterval(() => this.advanceTo(this._clock.now()), SPEC.TICK_S * 1000);
    }

    /** Normal session end: final drain, then teardown. A grid tick that is
     *  already DUE at stop time must not lose events to timer jitter (flush
     *  the debouncers, run every due tick); events after the last due tick
     *  lapse (Python rule, Decision 1). */
    stop(): void {
        if (this._session !== undefined) {
            this._selectionDebounce?.flush();
            this._scrollDebounce?.flush();
            this.advanceTo(this._clock.now());
        }
        this._teardown();
    }

    /** Abort path: teardown WITHOUT the final drain (used by dispose; also
     *  what tests with a real default clock rely on — a drain against real
     *  Date.now() would catch up across the whole fake-session span). */
    private _teardown(): void {
        if (this._timer !== undefined) {
            this._clock.clearInterval(this._timer);
            this._timer = undefined;
        }
        for (const sub of this._subscriptions.splice(0)) {
            sub.dispose();
        }
        this._selectionDebounce?.dispose();
        this._scrollDebounce?.dispose();
        this._session = undefined;
    }

    dispose(): void {
        this._teardown();
        this._onDidTick.dispose();
        this._onDidAlert.dispose();
    }

    /** Process every due grid tick <= now. Public: replay and tests drive this directly. */
    advanceTo(nowMs: number): void {
        if (this._session === undefined) {
            return;
        }
        const nowS = (nowMs - this._session.sessionStartMs) / 1000;
        while (this._nextTickS <= nowS) {
            this._runTick(this._nextTickS);
            this._nextTickS += SPEC.TICK_S;
        }
    }

    // ── intake ─────────────────────────────────────────────────────────

    private _relS(tsMs: number): number {
        return (tsMs - (this._session?.sessionStartMs ?? 0)) / 1000;
    }

    private _passesUriFilter(uri: vscode.Uri): boolean {
        return shouldRecordUri(uri, this._session?.exerciseRoot);
    }

    private _enqueue(tsS: number, apply: () => void): void {
        if (tsS < 0) {
            return;                       // pre-session signal: ignore
        }
        this._queue.push({ tsS, apply });
    }

    private _attach(): void {
        const subs = this._subscriptions;
        this._selectionDebounce = new TrailingDebouncer(SELECTION_DEBOUNCE_MS, p => {
            this._enqueue(p.tsS, () => this._n2.ingestSelection(p.tsS, p.uriKey, p.endLine));
        });
        this._scrollDebounce = new TrailingDebouncer<number>(VISIBLE_RANGE_DEBOUNCE_MS, tsS => {
            this._enqueue(tsS, () => this._features.ingestScroll(tsS));
        });

        subs.push(this._hub.onDidChangeTextDocument(signal => {
            const uri = signal.event.document.uri;
            if (!this._passesUriFilter(uri)) {
                return;
            }
            const tsS = this._relS(signal.ts);
            const uriKey = uri.toString();
            const changes = signal.event.contentChanges.map(c => ({
                oneChar: c.rangeLength === 0 && c.text.length === 1,
                startLine: c.range.start.line,
            }));
            const before = this._shadow.beforeText(uriKey);
            const afterText = signal.event.document.getText();
            this._shadow.sync(uriKey, afterText);
            this._enqueue(tsS, () => {
                this._features.ingestTextChange(tsS, changes.filter(c => c.oneChar).length);
                if (before !== undefined) {
                    const methods = parseMethods(before);     // once per event
                    for (const c of changes) {
                        this._a8.recordChange(tsS, uriKey, methodAtLine(methods, c.startLine)?.name ?? null);
                    }
                }
            });
        }));

        subs.push(this._hub.onDidOpenTextDocument(({ document }) => {
            if (this._passesUriFilter(document.uri)) {
                this._shadow.seed(document.uri.toString(), document.getText());
            }
        }));

        subs.push(this._hub.onDidChangeTextEditorSelection(signal => {
            const uri = signal.event.textEditor.document.uri;
            if (!this._passesUriFilter(uri) || signal.event.selections.length === 0) {
                return;
            }
            const payload = {
                tsS: this._relS(signal.ts),
                uriKey: uri.toString(),
                endLine: signal.event.selections[0].end.line,
            };
            if (this._preDebounced) {
                this._enqueue(payload.tsS, () => this._n2.ingestSelection(payload.tsS, payload.uriKey, payload.endLine));
            } else {
                this._selectionDebounce!.push(payload.uriKey, payload);
            }
        }));

        subs.push(this._hub.onDidChangeTextEditorVisibleRanges(signal => {
            const uri = signal.event.textEditor.document.uri;
            if (!this._passesUriFilter(uri)) {
                return;
            }
            const tsS = this._relS(signal.ts);
            if (this._preDebounced) {
                this._enqueue(tsS, () => this._features.ingestScroll(tsS));
            } else {
                this._scrollDebounce!.push(uri.toString(), tsS);
            }
        }));

        subs.push(this._hub.onDidChangeDiagnostics(signal => {
            const tsS = this._relS(signal.ts);
            for (const uri of signal.uris) {
                if (!this._passesUriFilter(uri)) {
                    continue;
                }
                const errors = this._hub.readDiagnostics(uri)
                    .filter(d => d.severity === vscode.DiagnosticSeverity.Error)
                    .map(d => ({
                        line: d.range.start.line,
                        code: normalizeDiagnosticCode(d.code),
                        message: d.message,
                    }));
                const uriKey = uri.toString();
                this._enqueue(tsS, () => this._n2.ingestSnapshot(tsS, uriKey, errors));
            }
        }));

        subs.push(this._hub.onDidEndTerminalShellExecution(signal => {
            const tsS = this._relS(signal.ts);
            this._enqueue(tsS, () => this._boundaries.ingest('E4', tsS));
        }));

        subs.push(this._hub.onPasteDetected(signal => {
            if (!this._passesUriFilter(signal.uri)) {
                return;
            }
            const tsS = this._relS(signal.ts);
            this._enqueue(tsS, () => this._boundaries.ingest('N1', tsS));
        }));

        subs.push(this._hub.onBuildResult(signal => {
            const tsS = this._relS(signal.ts);
            const result: ResultDTO = signal.result;
            this._enqueue(tsS, () => {
                const c = this._buildDelta.ingest(tsS, result);
                if (c.improved) {
                    this._fastDecay.ingestImproved(tsS);
                } else {
                    this._fastDecay.ingestNonImproved(tsS);
                }
                if (c.isFM) {
                    this._boundaries.ingest('FM', tsS);
                    this._lastFmBadS = tsS;
                }
                if (c.isFMPlus) {
                    this._boundaries.ingest('FM_PLUS', tsS);
                }
            });
        }));

        subs.push(this._hub.onTaskFeedbackView(signal => {
            const tsS = this._relS(signal.ts);
            this._enqueue(tsS, () => this._feedback.ingest(tsS, signal.action, signal.viewId));
        }));
    }

    // ── tick ───────────────────────────────────────────────────────────

    private _drainUpTo(tS: number): void {
        // Stable order by ts: debounced emissions enqueue out of arrival order.
        this._queue.sort((a, b) => a.tsS - b.tsS);
        let consumed = 0;
        while (consumed < this._queue.length && this._queue[consumed].tsS <= tS) {
            this._queue[consumed].apply();
            consumed++;
        }
        this._queue.splice(0, consumed);
    }

    private _runTick(tS: number): void {
        this._drainUpTo(tS);

        const wf = this._features.computeAt(tS);
        const w0 = tS - wf.effectiveWindowS;
        const fFb: 0 | 1 = this._feedback.openOverlapping(w0, tS) ? 1 : 0;
        const fA8: 0 | 1 = this._a8.activeAt(tS) ? 1 : 0;
        const fN2: 0 | 1 = this._n2.activeAt(tS) ? 1 : 0;
        const { sBase, s } = severityFrom(wf, { fFb, fA8, fN2 });
        const fast = this._fastDecay.activeAt(tS);
        const v = this._v.update(tS, s, fast);
        const boundaries = this._boundaries.flagsAt(tS, wf.tsState, wf.n4State);
        const graceActive = this._lastFmBadS !== null
            && this._lastFmBadS <= tS
            && tS - this._lastFmBadS <= SPEC.GRACE_S;

        const machineAlert = this._machine.tick({
            t: tS, v, boundaries, typingRate: wf.typingRate, graceActive,
        });

        const tsMs = (this._session?.sessionStartMs ?? 0) + tS * 1000;
        const alert: AlertRecord | null = machineAlert === null ? null : { ...machineAlert, ts: tsMs };
        const record: TickRecord = {
            t: tS,
            ts: tsMs,
            features: { t: tS, ...wf, fFb, fA8, fN2 },
            sBase,
            s,
            v,
            fastDecay: fast,
            boundariesPreGate: boundaries,
            alert,
        };
        this._onDidTick.fire(record);
        if (alert !== null) {
            this._onDidAlert.fire(alert);
        }
    }

    private _resetState(): void {
        this._queue = [];
        this._nextTickS = SPEC.TICK_S;
        this._lastFmBadS = null;
        this._features = new FeatureWindowTracker();
        this._feedback = new FeedbackViewTracker();
        this._shadow = new DocumentShadowTracker();
        this._a8 = new A8Tracker();
        this._n2 = new N2Tracker();
        this._buildDelta = new BuildDeltaTracker();
        this._fastDecay = new FastDecayTracker();
        this._v = new VTracker();
        this._boundaries = new BoundaryTracker();
        this._machine = new AlertStateMachine();
    }
}
```

IMPLEMENTATION NOTES:
- `TickRecord.features` needs the full `FeatureVector` shape — reconcile `types.ts` (`FeatureVector` has `t`, the tracker output does not); the spread shown above does that. Adjust types if tsc complains, NOT the semantics.
- Diagnostic codes are normalized EXCLUSIVELY through `normalizeDiagnosticCode` (errorDistance.ts) — missing codes become Python-parity "None"; PR 3 replay must use the same helper (live/replay/golden identity equality).
- `boundariesPreGate` carries the tracker flags BEFORE the machine's gate filtering (the machine reports `typesPreGate` for alerts; the tick record keeps the raw flags for the struggleScore event in PR 2c).
- The shell-execution channel never fires on Theia (hub capability gating) — E4 simply stays silent there (spec §0: boundaries without data basis are disabled). No engine-side handling needed.

Run: `rm -rf out && npm run compile-tests && npm run test:unit 2>&1 | tail -6`. Expected: all engine tests pass; total = previous unit count + 13.

- [ ] **Step 11.3: Gates + commit**

```bash
npm run check-types && npm run lint
git add src/extension/services/struggle/struggleEngine.ts test/unit/services/struggle/struggleEngine.test.ts
git commit -m "feat(struggle): engine orchestrator with deterministic tick contract"
```

---

### Task 12: scenario runner v2 + initial scenario set

**Files:**
- Create: `extension/test/unit/services/struggle/scenarios/scenarioRunner.ts`
- Create: `extension/test/unit/services/struggle/scenarios/scenarios.ts`
- Test: `extension/test/unit/services/struggle/scenarios/scenarios.test.ts`

The runner drives the FULL engine through a `TestSensorHub` under sinon fake timers (faking `Date`, `setInterval`, `setTimeout`), so the engine's own default clock and the intake debouncers run exactly as in production. The old v1 harness (`test/unit/struggle-detection/`) stays untouched until PR 2c.

- [ ] **Step 12.1: Create the runner:**

```ts
// extension/test/unit/services/struggle/scenarios/scenarioRunner.ts
/**
 * Scenario harness v2: drives the StruggleEngine end-to-end with synthetic
 * sensor events on a sinon-faked clock. Scenarios are typed TS data; every
 * event is anchored at a session-relative time in seconds.
 */
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import type { ResultDTO } from '@extension/domain/submissions';
import { StruggleEngine } from '@extension/services/struggle/struggleEngine';
import type { AlertRecord, TickRecord } from '@extension/services/struggle/types';
import { TestSensorHub } from '@test/__shared__/testSensorHub';

export type ScenarioEvent =
    | { at: number; type: 'typing'; durationS: number; charsPerSecond: number; uri?: string }
    | { at: number; type: 'build'; failed: string[]; buildFailed?: boolean }
    | { at: number; type: 'terminalRun' }
    | { at: number; type: 'paste'; chars: number; lines: number; uri?: string }
    | { at: number; type: 'feedbackView'; action: 'opened' | 'closed'; viewId: string }
    | { at: number; type: 'scroll'; count: number; overS: number; uri?: string }
    | { at: number; type: 'diagnostics'; errors: Array<{ line: number; code: string; message: string }>; uri?: string }
    | { at: number; type: 'selection'; line: number; uri?: string };

export interface Scenario {
    id: string;
    category: 'obvious' | 'subtle' | 'no-struggle' | 'edge';
    description: string;
    durationS: number;
    events: ScenarioEvent[];
    expected: {
        /** Exact alert tick times (session-relative seconds). */
        alertTimes?: number[];
        noAlerts?: boolean;
        /** Optional invariant on the final tick's V. */
        finalVBelow?: number;
        finalVAtLeast?: number;
    };
}

const DEFAULT_URI = 'file:///ws/exercise/Main.java';
const START = 1_750_000_000_000;

/** Manual clock: the runner drives engine.advanceTo itself so that events at
 *  exactly a grid time are enqueued BEFORE that tick runs (drain rule: tick T
 *  includes ts <= T). The sinon clock still drives the intake debouncers. */
const NOOP_ENGINE_CLOCK = {
    now: () => Date.now(),
    setInterval: () => 0 as unknown,
    clearInterval: () => { /* runner-driven */ },
};

export interface ScenarioResult {
    alerts: AlertRecord[];
    ticks: TickRecord[];
}

export function runScenario(scenario: Scenario): ScenarioResult {
    const clock = sinon.useFakeTimers({
        now: START,
        toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
    });
    const hub = new TestSensorHub();
    const engine = new StruggleEngine(hub, NOOP_ENGINE_CLOCK);
    const alerts: AlertRecord[] = [];
    const ticks: TickRecord[] = [];
    engine.onDidAlert(a => alerts.push(a));
    engine.onDidTick(t => ticks.push(t));
    try {
        engine.start({ sessionStartMs: START });

        // Expand events into atomic timestamped firings.
        const atomic: Array<{ at: number; fire: () => void }> = [];
        for (const ev of scenario.events) {
            const uri = vscode.Uri.parse(('uri' in ev && ev.uri) || DEFAULT_URI);
            switch (ev.type) {
                case 'typing': {
                    const n = Math.floor(ev.durationS * ev.charsPerSecond);
                    for (let i = 0; i < n; i++) {
                        const at = ev.at + i / ev.charsPerSecond;
                        atomic.push({ at, fire: () => hub.emit.textChange.fire({
                            ts: START + at * 1000,
                            event: {
                                document: { uri, getText: () => 'class A {}' },
                                contentChanges: [{ text: 'a', rangeLength: 0, range: { start: { line: 0 }, isEmpty: true, isSingleLine: true } }],
                            },
                        } as never) });
                    }
                    break;
                }
                case 'build':
                    atomic.push({ at: ev.at, fire: () => hub.emit.buildResult.fire({
                        ts: START + ev.at * 1000,
                        result: {
                            id: 1,
                            submission: { id: 1, buildFailed: ev.buildFailed ?? false },
                            feedbacks: ev.failed.map(d => ({ positive: false, detailText: d, text: 't' })),
                        } as unknown as ResultDTO,
                    }) });
                    break;
                case 'terminalRun':
                    atomic.push({ at: ev.at, fire: () => hub.emit.shellEnd.fire({ ts: START + ev.at * 1000, event: {} as never }) });
                    break;
                case 'paste':
                    atomic.push({ at: ev.at, fire: () => hub.emit.pasteDetected.fire({
                        ts: START + ev.at * 1000, uri, chars: ev.chars, lines: ev.lines,
                    }) });
                    break;
                case 'feedbackView':
                    atomic.push({ at: ev.at, fire: () => hub.emit.taskFeedbackView.fire({
                        ts: START + ev.at * 1000, action: ev.action, viewId: ev.viewId,
                    }) });
                    break;
                case 'scroll':
                    for (let i = 0; i < ev.count; i++) {
                        const at = ev.at + (i * ev.overS) / Math.max(1, ev.count - 1);
                        atomic.push({ at, fire: () => hub.emit.visibleRanges.fire({
                            ts: START + at * 1000,
                            event: { textEditor: { document: { uri } } },
                        } as never) });
                    }
                    break;
                case 'diagnostics': {
                    atomic.push({ at: ev.at, fire: () => {
                        hub.stub.diagnosticsByUri.set(uri.toString(), ev.errors.map(e => ({
                            severity: vscode.DiagnosticSeverity.Error,
                            range: new vscode.Range(e.line, 0, e.line, 1),
                            message: e.message,
                            code: e.code,
                        } as vscode.Diagnostic)));
                        hub.emit.diagnostics.fire({ ts: START + ev.at * 1000, uris: [uri] });
                    } });
                    break;
                }
                case 'selection':
                    atomic.push({ at: ev.at, fire: () => hub.emit.selection.fire({
                        ts: START + ev.at * 1000,
                        event: {
                            textEditor: { document: { uri } },
                            selections: [{ end: { line: ev.line } }],
                        },
                    } as never) });
                    break;
            }
        }
        atomic.sort((a, b) => a.at - b.at);

        // Ordering per atomic event (tick contract): (1) advance the sinon
        // clock to the event time — intake debouncers flush and ENQUEUE, the
        // engine does NOT tick (noop interval); (2) fire the event so an
        // event at exactly a grid time is enqueued before its tick runs;
        // (3) advanceTo(event time) processes every due grid tick.
        let currentS = 0;
        for (const a of atomic) {
            if (a.at > currentS) {
                clock.tick((a.at - currentS) * 1000);
                currentS = a.at;
            }
            a.fire();
            engine.advanceTo(START + currentS * 1000);
        }
        if (scenario.durationS > currentS) {
            clock.tick((scenario.durationS - currentS) * 1000);
            engine.advanceTo(START + scenario.durationS * 1000);
        }
        return { alerts, ticks };
    } finally {
        engine.dispose();
        clock.restore();
    }
}
```

(NOTE: `readDiagnostics` in TestSensorHub must serve `stub.diagnosticsByUri` — verify; that was its PR 1 design.)

- [ ] **Step 12.2: Create the scenarios** (each `expected` value is DERIVED — the derivation is in the comment; the implementer re-verifies by running and investigates ANY mismatch instead of editing expectations to match):

```ts
// extension/test/unit/services/struggle/scenarios/scenarios.ts
import type { Scenario } from './scenarioRunner';

export const SCENARIOS: Scenario[] = [
    {
        id: 'idle-reading-after-warmup',
        category: 'obvious',
        description: 'No typing at all: severity rises to 0.7; STATE boundary fires at the first warmup-free tick.',
        durationS: 740,
        events: [],
        // Derivation: idle S = (1 + 1 + 0.1)/3 = 0.7 >= theta from t=40 on; warmup
        // blocks STATE until 480; first free tick 490 (armed), then E6 every 120 s.
        expected: { alertTimes: [490, 610, 730] },
    },
    {
        id: 'stuck-then-failing-build',
        category: 'obvious',
        description: 'Typing until 300 s, then stuck; bad build at 400 s breaks through warmup.',
        durationS: 540,
        events: [
            { at: 0, type: 'typing', durationS: 300, charsPerSecond: 2 },
            { at: 400, type: 'build', failed: [], buildFailed: true },
        ],
        // Derivation: V >= theta from 360 (idle since 300); build at EXACTLY 400
        // belongs to tick 400 (first tick >= ts). FM at tick 400 alerts (warmup
        // breakthrough, armed; grace 400-400=0 keeps FM itself). Cooldown 120 ->
        // next eligible 520; e6 (in_state_since=360, 520-360 >= 120) -> alert 520.
        expected: { alertTimes: [400, 520] },
    },
    {
        id: 'fluent-development',
        category: 'no-struggle',
        description: 'Continuous fluent typing, one improving build: no alerts, V stays low.',
        durationS: 600,
        events: [
            { at: 0, type: 'typing', durationS: 600, charsPerSecond: 2 },
            { at: 200, type: 'build', failed: [] },
        ],
        // typing 120/min: fTyping 0; gap 0.5/40 ~ 0.0125; fN4 ~ 0 -> S ~ 0.004.
        expected: { noAlerts: true, finalVBelow: 0.2 },
    },
    {
        id: 'warmup-quiet-session',
        category: 'no-struggle',
        description: 'Idle but the session ends inside warmup: STATE never becomes alert-eligible.',
        durationS: 470,
        events: [],
        expected: { noAlerts: true },
    },
    {
        id: 'first-build-is-not-improved',
        category: 'subtle',
        description: 'The FIRST build (delta=first) never starts fast decay; a terminal run inside cooldown stays silent.',
        durationS: 560,
        events: [
            { at: 490, type: 'build', failed: [] },        // improved (first build, 0 failures -> delta=first, NOT improved!)
            { at: 530, type: 'terminalRun' },
        ],
        // CAREFUL derivation: the FIRST build has delta='first' (improved=false).
        // To get an improved build, a worse baseline must exist: see next scenario.
        // Here delta='first' with 0 failures: no FM, non-improved -> hl stays 120.
        // Idle: alert already at 490 (armed, STATE). Terminal run at 530: tick 540,
        // cooldown (540-490=50 < 120) blocks. Expected: only the 490 alert by 560.
        expected: { alertTimes: [490] },
    },
    {
        id: 'improved-build-under-idle-support',
        category: 'subtle',
        description: 'Fast decay alone cannot drop V while S stays high (idle); the E4 after an e6 re-alert is cooldown-blocked.',
        durationS: 700,
        events: [
            { at: 485, type: 'build', failed: ['a', 'b'] },   // first (failed): FM boundary
            { at: 560, type: 'build', failed: [] },           // improved (2 -> 0)
            { at: 620, type: 'terminalRun' },
        ],
        // Derivation: idle -> alert 490 (FM+STATE present, armed; FM is primary).
        // Improved at 560: fast decay (hl 30). V(560)~0.7 idle; ticks 570..620:
        // S stays 0.7 (still idle!) -> V = max(S, decayed) = 0.7. Fast decay does
        // NOT drop V below theta while the user stays idle (S support). E4 at 620:
        // tick 620, cooldown since 490 ok (130 >= 120), V 0.7 >= theta, not armed,
        // in_state_since=30/40 -> e6 fires at 610 already (STATE, 610-490=120).
        // EXPECTATION needs the full trace: alerts 490 (armed), 610 (e6), and the
        // E4 at 620 is cooldown-blocked (620-610=10). By 700: next e6 at 730 > end.
        expected: { alertTimes: [490, 610] },
    },
    {
        id: 'paste-respects-grace',
        category: 'edge',
        description: 'A paste right after a bad build is grace-suppressed; FM itself already alerted.',
        durationS: 560,
        events: [
            { at: 485, type: 'build', failed: ['x'] },     // first+failed: FM (bad build)
            { at: 500, type: 'paste', chars: 40, lines: 3 },
        ],
        // Derivation: alert 490 (FM primary, armed). Paste at 500 -> tick 510 within
        // grace (500-485=15 <= 32.94) -> N1 filtered; STATE also filtered; nothing
        // survives. Re-alerts continue via e6: 610 (STATE; 610-490=120).
        expected: { alertTimes: [490, 610] },
    },
    {
        id: 'feedback-view-pushes-severity',
        category: 'edge',
        description: 'The +0.25 feedback-view bonus must NOT lift moderate-activity severity over theta (no fabricated alerts).',
        durationS: 600,
        events: [
            // 10 chars/min: rate 10 -> fTyping 0.5; gaps ~6 s -> fGap 0.15; fN4 ~ (0.5/10.5)/10 ~ 0.005
            { at: 0, type: 'typing', durationS: 600, charsPerSecond: 1 / 6 },
            { at: 480, type: 'feedbackView', action: 'opened', viewId: 'v1' },
        ],
        // Derivation sketch: base S ~ (0.5 + 0.15 + 0.005)/3 ~ 0.218 < theta-0.1;
        // with +0.25 from 490 on: S ~ 0.468 — still < 0.6! This scenario asserts
        // NO alert and a bounded V: the bonus alone must not fabricate alerts.
        expected: { noAlerts: true, finalVBelow: 0.6 },
    },
];
```

- [ ] **Step 12.3: The suite:**

```ts
// extension/test/unit/services/struggle/scenarios/scenarios.test.ts
import * as assert from 'assert';

import { runScenario } from './scenarioRunner';
import { SCENARIOS } from './scenarios';

suite('struggle engine v2 scenarios', () => {
    for (const scenario of SCENARIOS) {
        test(`[${scenario.category}] ${scenario.id}`, () => {
            const { alerts, ticks } = runScenario(scenario);
            const times = alerts.map(a => a.t);
            if (scenario.expected.noAlerts) {
                assert.deepStrictEqual(times, [], `expected no alerts, got ${times.join(', ')}`);
            }
            if (scenario.expected.alertTimes) {
                assert.deepStrictEqual(times, scenario.expected.alertTimes);
            }
            const finalV = ticks[ticks.length - 1]?.v ?? 0;
            if (scenario.expected.finalVBelow !== undefined) {
                assert.ok(finalV < scenario.expected.finalVBelow, `final V ${finalV} not < ${scenario.expected.finalVBelow}`);
            }
            if (scenario.expected.finalVAtLeast !== undefined) {
                assert.ok(finalV >= scenario.expected.finalVAtLeast, `final V ${finalV} not >= ${scenario.expected.finalVAtLeast}`);
            }
        });
    }
});
```

- [ ] **Step 12.4: Run and reconcile.** `rm -rf out && npm run compile-tests && npm run test:unit 2>&1 | tail -8`. EVERY mismatch between a derived expectation and the engine MUST be investigated against the spec semantics (re-derive by hand); report derivation corrections in the implementation record rather than silently editing numbers. Then gates + commit:

```bash
npm run check-types && npm run lint
git add test/unit/services/struggle/scenarios/scenarioRunner.ts test/unit/services/struggle/scenarios/scenarios.ts test/unit/services/struggle/scenarios/scenarios.test.ts
git commit -m "test(struggle): v2 scenario runner with initial scenario set"
```

---

### Task 13: knip, changelog, final gates

- [ ] **Step 13.1:** `npx knip 2>&1 | tail -20` — must be clean. Likely flags: engine exports only used by tests are fine (test files are knip entries), but REMOVE any export nothing imports at all. Fix at the root, never suppress.
- [ ] **Step 13.2:** CHANGELOG entry under Internal (match existing format):

```markdown
- **Struggle Engine v2 (additive)**: data-derived detection engine in `services/struggle/`
  (10 s tick contract, severity/decay/boundaries/gates/alert state machine, ports of the
  26 reference state-machine tests), sensor hub internal sources for build results and
  task-feedback views, derived paste channel. Not yet wired to UI or recorder (switchover
  follows in PR 2c); the v1 decision path is unchanged.
```

- [ ] **Step 13.3: Full final matrix:**

```bash
npm run compile && npm run package
rm -rf out && npm run compile-tests
npm run test:unit 2>&1 | tee /tmp/pr2b-final-unit.txt | tail -8
npm run test:struggle 2>&1 | tee /tmp/pr2b-final-struggle.txt | tail -8
npm run test:react 2>&1 | tee /tmp/pr2b-final-react.txt | tail -8
npm run test:recorder-e2e 2>&1 | tee /tmp/pr2b-final-rec.txt | tail -8
node esbuild.js --production --variant=openvsx && node scripts/verify-clean-bundle.js
npx knip
rm /tmp/pr2b-final-*.txt
```

Expected: struggle 135 / react 865 + new logic suites / recorder-e2e 9 unchanged; unit = 1344 + all new mocha tests; clean bundle OK (struggle/ + sensing/ may ship; recording still excluded); knip clean. CLEAN-BUNDLE SANITY: `services/struggle/` is NOT in FORBIDDEN — it ships in the openvsx build by design; verify `grep -rn "services/recording" src/extension/services/struggle src/extension/services/sensing` is EMPTY (struggle/sensing never import recording).

- [ ] **Step 13.4: Commit changelog:**

```bash
git add ../CHANGELOG.md
git commit -m "docs(changelog): note the additive struggle engine"
```

---

## Out of Scope (PR 2c)

v1 removal, AlertSink delivery implementation, recording schema v3 (struggleScore/alert events), coordinator/wiring (`emitBuildResult`/`emitTaskFeedbackView` producers), old harness retirement, debug UI rework, `SessionResettable` relocation.

## PR Description Skeleton (no AI attribution anywhere)

```
## PR 2b: Struggle Engine v2 (additive)

Engine v2 ported from the frozen reference (spec Rev 3.1) into services/struggle/:
severity features (typing/gap/N4 window, feedback view, A8 region persistence,
N2 error distance), V(t) decay with fast-decay regime, boundary detection
(FM/FM+/E4/N1/state), gate sequence (B2/warmup/grace) and the alert state machine
— driven by a deterministic 10 s tick contract (one code path for live and replay).
Sensor hub gains internal sources (buildResult, taskFeedbackView) and a derived
paste channel.

Additive: the v1 decision path is untouched; the engine is not wired to UI or
recorder yet (PR 2c).

### Verification
- 26 reference state-machine tests ported 1:1 (vitest), feature/tracker suites,
  engine tick-contract tests, scenario harness v2 (8 scenarios)
- declared causal deviations from the offline reference documented in the plan
  (A8 canonicalization, N2 activity, N1 paste rule) for the PR 3 golden replay
- all pre-existing suites green unchanged; clean openvsx bundle verified
```

## Plan Self-Review Record

Checked per writing-plans: (1) spec coverage — sections 0-5 of the engine spec map to Tasks 2-11; PR-2b spec bullet (hub sources, struggle/ complete, 26-test port, scenario runner) covered by Tasks 1-12. (2) placeholder scan — Task 9 contains two deliberately flagged test cases with the corrected exact versions inline; no TBDs. (3) type consistency — `FeatureVector` vs tracker output reconciliation flagged in Task 11 notes; `MachineParams` partial-defaults used consistently in tests.

