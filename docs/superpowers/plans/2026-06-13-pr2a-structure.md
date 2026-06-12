# PR 2a: Telemetry Dissolution (Structure Refactor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mechanically dissolve `services/telemetry/` into the target layer structure (`services/recording/`, `services/eq/`, `services/sensing/`) with ZERO behavior change, so that PR 2b (engine) and PR 2c (switchover) build on final locations.

**Architecture:** Pure file moves plus import-specifier rewrites. The v1 decision path stays alive and untouched in `services/telemetry/` (it dies in PR 2c). After this PR, `services/telemetry/` contains ONLY v1 decision components plus `telemetryManager.ts`; the recorder, the passive EQ pipeline, and the shared acquisition filters live in their final homes.

**Tech Stack:** TypeScript strict, eslint (simple-import-sort, no upward-relative imports — use `@extension/*`/`@test/*` aliases), vscode-test labels, vitest (react/logic), knip, esbuild clean-bundle seam.

---

## Context

- **Spec:** `docs/superpowers/specs/2026-06-12-struggle-engine-v2-port.md` sections 3, 4, 8. Liam approved splitting spec-PR 2 into three PRs on 2026-06-13:
  - **PR 2a `refactor(structure)`** (this plan): mechanical moves, zero behavior change.
  - **PR 2b `feat(struggle)`**: Engine v2 additive (sensing internal sources, engine, 26-test port, new harness). v1 keeps running.
  - **PR 2c `feat(struggle)`**: switchover (v1 removal, AlertSink intervention, recording schema v3, coordinator rework).
- **Branch:** `refactor/telemetry-structure` off `feat/struggle-engine-v2`. PR merges back into `feat/struggle-engine-v2` (squash). `dev` stays untouched.
- **Equivalence proof:** all existing suites green UNCHANGED (assertions untouched; only module specifiers and file locations change): unit 1344, struggle 135, recorder-e2e 9, react 865, plus `check-types`, `lint`, `npx knip`, clean-bundle verification.
- **Forbidden:** behavior changes, new features, new tests (except moved files), AI attribution anywhere, `git add -A`/`git add .` (stage explicit paths).

## Decision Log

1. **replay/ lives under recording/** (`services/recording/replay/`): replay is recording-side tooling (parses recordings, reconstructs EQ offline). The recording side may import shipped code (`services/eq/`), never the reverse. Clean-bundle exclusion patterns keep matching one subtree.
2. **lintDenylist → services/eq/**: it defines which diagnostic sources count as compiler errors for EQ purposes (EQ policy, consumed by the EQ emitter and the replay reconstructor). `uriFilter` → `services/sensing/` (acquisition policy, already consumed by the sensing layer's `diagnosticsSettle`).
3. **isLikelyManualPaste → services/sensing/collectors/paste.ts** (spec section 3: paste heuristic is a sensing collector). It gets a local `DEFAULT_MIN_LINES = 2` constant instead of referencing v1's `DEFAULT_TRIGGER_CONFIG` (same value; the v1 `boundaryTriggerEmitter` keeps passing its configured value explicitly, so v1 behavior is unchanged). `FORMATTER_CHAR_THRESHOLD` moves along. The module must stay loadable in vitest logic tests: vscode imports type-only, no module-load side effects.
4. **EQ types split:** `ErrorSnapshot`, `EQState`, `EQConfidence`, `EQConfig`, `DEFAULT_EQ_CONFIG`, `BuildResultClassification`, `CompileEquivalentEvent` move verbatim from `telemetry/types.ts` to `services/eq/types.ts`. `telemetry/types.ts` keeps the v1 types and imports `EQConfidence` from eq (telemetry→eq dependency direction is correct: dying layer depends on final layer).
5. **SessionResettable / SessionStartContext stay in `telemetry/types.ts` for now.** eq files import them from `@extension/services/telemetry/types` as a declared interim dependency; PR 2c relocates them to their final home when `services/telemetry/` dies. Rationale: avoids inventing a shared module before the struggle layer (the main future consumer) exists.
6. **No eq/ barrel in 2a.** Current repo style imports these modules by direct path; a barrel with re-exports would either duplicate paths or trip knip. PR 2c introduces an eq service facade if needed.
7. **Test files move to mirror src** (recording tests, uriFilter test). Tests under `test/unit/struggle-detection/` stay put (the `struggle` vscode-test label globs that directory; the harness is replaced in PR 2b/2c anyway) — only their import paths change.
8. **No new functionality.** SensorHub internal sources (buildResult, taskFeedbackView), the paste *channel*, and `readTextDocuments()` are deferred to PR 2b where their first consumer (the engine) lands. 2a only relocates existing code.

## File Map (old → new)

| Old | New |
|---|---|
| `src/extension/services/telemetry/uriFilter.ts` | `src/extension/services/sensing/uriFilter.ts` |
| `src/extension/services/telemetry/eventPipeline/lintDenylist.ts` | `src/extension/services/eq/lintDenylist.ts` |
| `src/extension/services/telemetry/metrics/errorQuotientEngine.ts` | `src/extension/services/eq/errorQuotientEngine.ts` |
| `src/extension/services/telemetry/metrics/snapshotDedup.ts` | `src/extension/services/eq/snapshotDedup.ts` |
| `src/extension/services/telemetry/metrics/buildErrorFamily.ts` | `src/extension/services/eq/buildErrorFamily.ts` |
| `src/extension/services/telemetry/eventPipeline/compileEquivalentEmitter.ts` | `src/extension/services/eq/compileEquivalentEmitter.ts` (minus paste heuristic) |
| (carved out of compileEquivalentEmitter) | `src/extension/services/sensing/collectors/paste.ts` |
| (carved out of telemetry/types.ts) | `src/extension/services/eq/types.ts` |
| `src/extension/services/telemetry/recording/**` | `src/extension/services/recording/**` |
| `src/extension/services/telemetry/replay/**` | `src/extension/services/recording/replay/**` |
| `test/unit/services/telemetry/recording/uriFilter.test.ts` | `test/unit/services/sensing/uriFilter.test.ts` |
| `test/unit/services/telemetry/recording/*.test.ts` (13 files) | `test/unit/services/recording/*.test.ts` |

Stays in `services/telemetry/` until PR 2c: `telemetryManager.ts`, `types.ts` (v1 remainder), `index.ts`, `buildResultGuard.ts`, `buildResultTracker.ts`, `debugDashboard.ts`, `diagnosticPersistenceService.ts`, `inactivityService.ts`, `interventionFilter.ts`, `interventionService.ts`, `decision/`, `intervention/`, `eventPipeline/boundaryTriggerEmitter.ts`.

All paths below are relative to `extension/` unless prefixed with `docs/` or `recording-viewer/`.

---

### Task 0: Branch + spec amendment

**Files:**
- Modify: `docs/superpowers/specs/2026-06-12-struggle-engine-v2-port.md` (section 8, item 2)

- [ ] **Step 0.1: Create the branch**

```bash
cd /Users/liamberger/Documents/private/MA/artemis-extension
git switch feat/struggle-engine-v2
git pull
git switch -c refactor/telemetry-structure
```

- [ ] **Step 0.2: Amend the spec's PR cut**

In `docs/superpowers/specs/2026-06-12-struggle-engine-v2-port.md`, replace the single item `2. **PR 2 \`feat(struggle)\`:** ...` (keep its text as the basis) with three items and renumber nothing else (items 3-5 keep their numbers by labeling the new ones 2a/2b/2c inside item 2). Concretely, replace the whole item 2 block with:

```markdown
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
```

- [ ] **Step 0.3: Commit**

```bash
git add docs/superpowers/specs/2026-06-12-struggle-engine-v2-port.md
git commit -m "docs(spec): split PR 2 into structure, engine, and switchover PRs"
```

---

### Task 1: Move uriFilter into the sensing layer

**Files:**
- Move: `src/extension/services/telemetry/uriFilter.ts` → `src/extension/services/sensing/uriFilter.ts`
- Move: `test/unit/services/telemetry/recording/uriFilter.test.ts` → `test/unit/services/sensing/uriFilter.test.ts`
- Modify (import specifier `@extension/services/telemetry/uriFilter` → `@extension/services/sensing/uriFilter`):
  1. `src/extension/services/sensing/collectors/diagnosticsSettle.ts`
  2. `src/extension/services/telemetry/eventPipeline/compileEquivalentEmitter.ts`
  3. `src/extension/services/telemetry/recording/eventCollectors.ts`
  4. `src/extension/services/telemetry/recording/observation/observationRegistry.ts`
  5. `src/extension/services/telemetry/recording/snapshots/snapshotManager.ts`
  6. `src/extension/services/telemetry/recording/startup/startupCapture.ts`
  7. `src/extension/services/telemetry/replay/snapshotReconstructor.ts`
  8. `src/extension/services/telemetry/recording/README.md` (path mention, prose only)

- [ ] **Step 1.1: Move the files**

```bash
git mv src/extension/services/telemetry/uriFilter.ts src/extension/services/sensing/uriFilter.ts
mkdir -p test/unit/services/sensing
git mv test/unit/services/telemetry/recording/uriFilter.test.ts test/unit/services/sensing/uriFilter.test.ts
```

- [ ] **Step 1.2: Rewrite the import specifiers**

In each of the 8 source files listed above plus the moved test file, change

```ts
import { shouldRecordUri } from '@extension/services/telemetry/uriFilter';
```

to

```ts
import { shouldRecordUri } from '@extension/services/sensing/uriFilter';
```

(some files import `shouldRecordUriString` too — keep the imported names exactly as they are, change only the specifier). Do NOT use a relative `../uriFilter` inside `collectors/diagnosticsSettle.ts` — upward relatives are banned by eslint; use the `@extension/...` alias. Let `simple-import-sort` dictate the final import-block order (run `npx eslint --fix` on the touched files if ordering errors appear).

- [ ] **Step 1.3: Re-verify there are no leftover references**

```bash
grep -rn "telemetry/uriFilter" src test scripts ../recording-viewer 2>/dev/null
```

Expected: no output.

- [ ] **Step 1.4: Gates**

IMPORTANT (applies to EVERY vscode-test gate in this plan): `compile-tests` does NOT clean `out/`, so moved test files leave stale compiled duplicates behind that the label globs would still pick up. Always wipe first:

```bash
rm -rf out && npm run compile-tests
npm run check-types
npm run lint
npm run test:unit 2>&1 | tee /tmp/pr2a-t1-unit.txt | tail -15
rm /tmp/pr2a-t1-unit.txt
```

Expected: tsc clean, eslint clean, unit suite passing with the SAME total as baseline (1344 passing; count unchanged because the uriFilter test only moved within the `unit` label glob).

- [ ] **Step 1.5: Commit**

```bash
git add src/extension/services/sensing/uriFilter.ts test/unit/services/sensing/uriFilter.test.ts src/extension/services/sensing/collectors/diagnosticsSettle.ts src/extension/services/telemetry/eventPipeline/compileEquivalentEmitter.ts src/extension/services/telemetry/recording/eventCollectors.ts src/extension/services/telemetry/recording/observation/observationRegistry.ts src/extension/services/telemetry/recording/snapshots/snapshotManager.ts src/extension/services/telemetry/recording/startup/startupCapture.ts src/extension/services/telemetry/replay/snapshotReconstructor.ts src/extension/services/telemetry/recording/README.md
git status --short   # verify the two deletions (old paths) are staged via git mv and nothing else is dirty
git commit -m "refactor(sensing): move uriFilter into the sensing layer"
```

---

### Task 2: Carve the manual-paste heuristic into a sensing collector

**Files:**
- Create: `src/extension/services/sensing/collectors/paste.ts`
- Modify: `src/extension/services/telemetry/eventPipeline/compileEquivalentEmitter.ts` (remove `isLikelyManualPaste` + `FORMATTER_CHAR_THRESHOLD`, drop now-unused imports)
- Modify: `src/extension/services/telemetry/eventPipeline/boundaryTriggerEmitter.ts` (import path)
- Modify: `test/logic/telemetry/manualPaste.test.ts` (import path)
- Modify: `test/unit/struggle-detection/boundaryTriggerAndCadence.test.ts` (import path — it ALSO imports `isLikelyManualPaste` from the emitter)

- [ ] **Step 2.1: Create the collector module**

`src/extension/services/sensing/collectors/paste.ts` — the function body is moved VERBATIM from `compileEquivalentEmitter.ts` (current lines around 230-267); only the default-parameter source and the doc header change:

```ts
// src/extension/services/sensing/collectors/paste.ts
/**
 * Manual-paste heuristic (sensing collector).
 *
 * Distinguishes a user-initiated multi-line paste from formatter/refactoring
 * rewrites and Copilot/snippet insertions. Moved verbatim from the v1
 * compileEquivalentEmitter (PR 2a); consumers pass their own minimum line
 * count where configured.
 *
 * Must stay free of module-load side effects: vitest logic tests import this
 * file with a partial vscode mock (type-only vscode usage is fine).
 */
import type * as vscode from 'vscode';

/** Replacements larger than this are treated as formatter/refactoring output. */
const FORMATTER_CHAR_THRESHOLD = 1000;

/** Minimum inserted lines for a change to count as a multi-line paste. */
export const DEFAULT_MIN_LINES = 2;

export function isLikelyManualPaste(
    change: vscode.TextDocumentContentChangeEvent,
    minLines: number = DEFAULT_MIN_LINES,
): boolean {
    const insertedLines = change.text.split('\n').length;
    if (insertedLines < minLines) {
        return false;
    }

    // Formatter/refactoring: replaces large text range (>1000 chars)
    if (change.rangeLength > FORMATTER_CHAR_THRESHOLD) {
        return false;
    }

    // Copilot/snippet: replaces text on a single line with multi-line output
    if (!change.range.isEmpty && change.range.isSingleLine) {
        return false;
    }

    // Pure insert (range.isEmpty) → likely paste (Ctrl+V)
    // Multi-line replacement (range spans multiple lines, ≤1000 chars) → likely paste-over-selection
    return true;
}
```

IMPORTANT: copy the body from the CURRENT file content, not from this plan, if they differ — the move must be verbatim. Keep any additional doc comments that sit on the original function.

- [ ] **Step 2.2: Remove the heuristic from the emitter**

In `compileEquivalentEmitter.ts`:
- Delete the `isLikelyManualPaste` function and the `FORMATTER_CHAR_THRESHOLD` constant (and their doc comments).
- Remove `DEFAULT_TRIGGER_CONFIG` from the `@extension/services/telemetry/types` import (it was only used as the default min-lines source). Keep all other imported names.

- [ ] **Step 2.3: Update the three consumers**

`boundaryTriggerEmitter.ts`:
```ts
// old
import { isLikelyManualPaste } from './compileEquivalentEmitter';
// new
import { isLikelyManualPaste } from '@extension/services/sensing/collectors/paste';
```

`test/logic/telemetry/manualPaste.test.ts`:
```ts
// old
import { isLikelyManualPaste } from '@extension/services/telemetry/eventPipeline/compileEquivalentEmitter';
// new
import { isLikelyManualPaste } from '@extension/services/sensing/collectors/paste';
```

`test/unit/struggle-detection/boundaryTriggerAndCadence.test.ts`: same specifier change — it imports `isLikelyManualPaste` from the emitter too (keep any OTHER names it imports from the emitter on the old specifier; only `isLikelyManualPaste` moves to the paste import).

- [ ] **Step 2.4: Verify and gate**

```bash
grep -rn "isLikelyManualPaste" src test | grep -v "sensing/collectors/paste"
```
Expected: only the three consumer imports/usages (boundaryTriggerEmitter.ts import+call, manualPaste.test.ts import+usages, boundaryTriggerAndCadence.test.ts import+usages).

```bash
npm run check-types
npm run lint
npm run test:react 2>&1 | tee /tmp/pr2a-t2-react.txt | tail -10
rm -rf out && npm run compile-tests
npm run test:struggle 2>&1 | tee /tmp/pr2a-t2-struggle.txt | tail -10
rm /tmp/pr2a-t2-react.txt /tmp/pr2a-t2-struggle.txt
```

Expected: react suite 865 passing (manualPaste.test among them), struggle suite 135 passing (boundaryTriggerAndCadence among them). If the react suite fails at module load with a vscode-mock error, the paste module has a non-type vscode usage — fix the import to `import type`.

- [ ] **Step 2.5: Commit**

```bash
git add src/extension/services/sensing/collectors/paste.ts src/extension/services/telemetry/eventPipeline/compileEquivalentEmitter.ts src/extension/services/telemetry/eventPipeline/boundaryTriggerEmitter.ts test/logic/telemetry/manualPaste.test.ts test/unit/struggle-detection/boundaryTriggerAndCadence.test.ts
git commit -m "refactor(sensing): move the manual-paste heuristic into a sensing collector"
```

---

### Task 3: Extract the passive EQ pipeline into services/eq

**Files:**
- Create: `src/extension/services/eq/types.ts`
- Move: `metrics/errorQuotientEngine.ts`, `metrics/snapshotDedup.ts`, `metrics/buildErrorFamily.ts`, `eventPipeline/lintDenylist.ts`, `eventPipeline/compileEquivalentEmitter.ts` → `src/extension/services/eq/`
- Modify: `src/extension/services/telemetry/types.ts` (remove moved declarations, import `EQConfidence` from eq)
- Modify importers (exact list in steps below)

- [ ] **Step 3.1: Move the five modules**

```bash
mkdir -p src/extension/services/eq
git mv src/extension/services/telemetry/metrics/errorQuotientEngine.ts src/extension/services/eq/errorQuotientEngine.ts
git mv src/extension/services/telemetry/metrics/snapshotDedup.ts src/extension/services/eq/snapshotDedup.ts
git mv src/extension/services/telemetry/metrics/buildErrorFamily.ts src/extension/services/eq/buildErrorFamily.ts
git mv src/extension/services/telemetry/eventPipeline/lintDenylist.ts src/extension/services/eq/lintDenylist.ts
git mv src/extension/services/telemetry/eventPipeline/compileEquivalentEmitter.ts src/extension/services/eq/compileEquivalentEmitter.ts
rmdir src/extension/services/telemetry/metrics 2>/dev/null || true
```

(`eventPipeline/` still contains `boundaryTriggerEmitter.ts` — do NOT remove the directory.)

- [ ] **Step 3.2: Create `src/extension/services/eq/types.ts`**

Cut the following declarations VERBATIM (including their doc comments) out of `src/extension/services/telemetry/types.ts` and paste them into the new file, in this order: `ErrorSnapshot`, `EQState`, `EQConfidence`, `EQConfig`, `DEFAULT_EQ_CONFIG`, `BuildResultClassification`, `CompileEquivalentEvent`. Add this header:

```ts
// src/extension/services/eq/types.ts
/**
 * Types of the passive EQ pipeline (Jadud 2006 pair scoring).
 *
 * Extracted verbatim from services/telemetry/types.ts in PR 2a. EQ keeps no
 * decision role in Engine v2; these types describe the telemetry-only logger.
 */
```

Note: `CompileEquivalentEvent.snapshot` references `ErrorSnapshot` — both are in this file, no imports needed. The file must not import vscode.

- [ ] **Step 3.3: Fix `src/extension/services/telemetry/types.ts`**

- Remove the moved declarations (the whole "EQ-based Struggle Detection Types" block members listed above — KEEP `TRIGGER_TYPES`, `TriggerType`, `TriggerConfig`, `DEFAULT_TRIGGER_CONFIG`, `AdaptiveState`, and everything else).
- The remaining v1 types reference `EQConfidence` (at least `StruggleContext.eqConfidence` and `InterventionDecision.confidence`). Add at the top:

```ts
import type { EQConfidence } from '@extension/services/eq/types';
```

- Re-export NOTHING from eq (no shim; importers are updated explicitly below). If `tsc` reports further leftover references inside `types.ts` (e.g. `EQState` in a doc-comment-adjacent type), update them to import types from `@extension/services/eq/types` the same way.

- [ ] **Step 3.4: Fix imports INSIDE the moved eq modules**

`errorQuotientEngine.ts`:
- `./snapshotDedup` stays.
- EQ types (`ErrorSnapshot`, `EQState`, `EQConfidence`, `EQConfig`, `DEFAULT_EQ_CONFIG`): import from `./types`.
- `SessionResettable`, `SessionStartContext`: import from `@extension/services/telemetry/types` (declared interim, see Decision 5).

`snapshotDedup.ts`: EQ types from `./types`.

`buildErrorFamily.ts`: check its imports — if it imports nothing from telemetry, leave as is.

`lintDenylist.ts`: standalone constant, leave as is.

`compileEquivalentEmitter.ts`:
```ts
// old specifiers                                              // new specifiers
'@extension/services/telemetry/metrics/buildErrorFamily'   →  './buildErrorFamily'
'@extension/services/telemetry/metrics/snapshotDedup'      →  './snapshotDedup'
'./lintDenylist'                                            →  './lintDenylist' (unchanged)
'@extension/services/telemetry/types' (EQ-only names)       →  './types'
'@extension/services/telemetry/types' (SessionResettable,
  SessionStartContext)                                      →  '@extension/services/telemetry/types' (keep, split the import)
'@extension/services/sensing/uriFilter'                     →  unchanged
'@extension/services/sensing' (DiagnosticsSettledSignal,
  nextSensorSeq)                                            →  unchanged
```

- [ ] **Step 3.5: Update all external importers**

TWO kinds of importers must be updated — files importing the moved MODULES, and files importing the moved TYPE NAMES from `@extension/services/telemetry/types`. Enumerate both before editing:

```bash
grep -rln "metrics/errorQuotientEngine\|metrics/snapshotDedup\|metrics/buildErrorFamily\|eventPipeline/compileEquivalentEmitter\|eventPipeline/lintDenylist" src test scripts
grep -rln "ErrorSnapshot\|EQState\|EQConfidence\|EQConfig\|DEFAULT_EQ_CONFIG\|BuildResultClassification\|CompileEquivalentEvent" src test | xargs grep -ln "telemetry/types"
```

Known affected files (re-verify with the greps above; `npm run check-types` is the final safety net):

| File | Change |
|---|---|
| `src/extension/services/telemetry/telemetryManager.ts` | `./metrics/errorQuotientEngine` → `@extension/services/eq/errorQuotientEngine`; `./eventPipeline/compileEquivalentEmitter` → `@extension/services/eq/compileEquivalentEmitter`; EQ type names (`EQConfidence`, `EQState`) move from `./types` import to a new `@extension/services/eq/types` import (keep the remaining v1 names on `./types`) |
| `src/extension/services/telemetry/debugDashboard.ts` | same pattern: engine import → `@extension/services/eq/errorQuotientEngine`; EQ type names → `@extension/services/eq/types` |
| `src/extension/services/telemetry/recording/eventCollectors.ts` | `@extension/services/telemetry/metrics/buildErrorFamily` → `@extension/services/eq/buildErrorFamily` |
| `src/extension/services/telemetry/replay/replayEngine.ts` | `@extension/services/telemetry/metrics/errorQuotientEngine` → `@extension/services/eq/errorQuotientEngine`; EQ type/`classifyBuildResult` imports → `@extension/services/eq/...` |
| `src/extension/services/telemetry/replay/snapshotReconstructor.ts` | `@extension/services/telemetry/eventPipeline/lintDenylist` → `@extension/services/eq/lintDenylist`; its `ErrorSnapshot` import from `@extension/services/telemetry/types` → `@extension/services/eq/types` |
| `test/react/services/replay/replayEngine.test.ts` | `DEFAULT_EQ_CONFIG` (and any other moved names) from `@extension/services/telemetry/types` → `@extension/services/eq/types` |
| `src/extension/services/telemetry/interventionService.ts`, `interventionFilter.ts`, `decision/interventionDecisionEngine.ts`, `eventPipeline/boundaryTriggerEmitter.ts`, `inactivityService.ts`, `intervention/adaptiveCadence.ts`, `buildResultTracker.ts` | ONLY if `tsc` flags them: where they import `EQConfidence`/other moved names from `./types` or `../types`, split those names into an `@extension/services/eq/types` import |
| `test/logic/telemetry/buildErrorFamily.test.ts` | → `@extension/services/eq/buildErrorFamily` |
| `test/logic/telemetry/buildFamilyConsistency.test.ts` | → `@extension/services/eq/buildErrorFamily` (and recording path stays until Task 4) |
| `test/logic/telemetry/eqConfidenceConfig.test.ts` | → `@extension/services/eq/...` (engine and/or types) |
| `test/logic/telemetry/liveVsReplayEq.test.ts` | → `@extension/services/eq/...` for engine/emitter/types names |
| `test/unit/struggle-detection/errorQuotientEngine.test.ts` | engine import → `@extension/services/eq/errorQuotientEngine`; SPLIT its types import: moved names (`ErrorSnapshot`, ...) → `@extension/services/eq/types`, v1 names stay on `@extension/services/telemetry/types` |
| `test/unit/struggle-detection/classifyBuildResult.test.ts` | → `@extension/services/eq/compileEquivalentEmitter` |
| `test/unit/struggle-detection/boundaryTriggerAndCadence.test.ts` | → `@extension/services/eq/...` where it imports emitter/EQ names |
| `test/unit/struggle-detection/StruggleTestRunner.ts` | → `@extension/services/eq/...` for engine/types names |
| `test/unit/services/telemetry/eqSettlePath.test.ts` | → `@extension/services/eq/...` if it imports emitter/types directly (verify with grep) |

Procedure: run `npm run check-types` after the mechanical pass; tsc is the safety net that finds every missed site. Fix until clean. Then `npx eslint --fix src test` for import ordering, then `npm run lint`.

- [ ] **Step 3.6: Verify no stale paths remain**

```bash
grep -rn "telemetry/metrics\|eventPipeline/compileEquivalentEmitter\|eventPipeline/lintDenylist" src test scripts ../recording-viewer 2>/dev/null | grep -v "test/logic/scripts/verifyCleanBundle.test.ts"
```
Expected: no output. (`verifyCleanBundle.test.ts` contains an old-path FIXTURE string — it gets updated together with the `FORBIDDEN` array in Task 4, not here.)

- [ ] **Step 3.7: Gates**

```bash
npm run check-types && npm run lint
rm -rf out && npm run compile-tests
npm run test:unit 2>&1 | tee /tmp/pr2a-t3-unit.txt | tail -10
npm run test:struggle 2>&1 | tee /tmp/pr2a-t3-struggle.txt | tail -10
npm run test:react 2>&1 | tee /tmp/pr2a-t3-react.txt | tail -10
rm /tmp/pr2a-t3-*.txt
```

Expected: all green with unchanged counts (unit 1344, struggle 135, react 865).

- [ ] **Step 3.8: Commit**

```bash
git add src/extension/services/eq src/extension/services/telemetry/types.ts src/extension/services/telemetry/telemetryManager.ts src/extension/services/telemetry/debugDashboard.ts src/extension/services/telemetry/recording/eventCollectors.ts src/extension/services/telemetry/replay/replayEngine.ts src/extension/services/telemetry/replay/snapshotReconstructor.ts
# plus every additional file actually touched in steps 3.3-3.5 — list them explicitly from `git status --short`, do NOT use `git add -A`
git commit -m "refactor(eq): extract the passive EQ pipeline into services/eq"
```

---

### Task 4: Move recorder and replay out of services/telemetry

**Files:**
- Move: `src/extension/services/telemetry/recording/` → `src/extension/services/recording/`
- Move: `src/extension/services/telemetry/replay/` → `src/extension/services/recording/replay/`
- Move: `test/unit/services/telemetry/recording/` → `test/unit/services/recording/` (13 test files)
- Modify: every importer (list below), 3 scripts, recording-viewer type sync, dataCollection seam

- [ ] **Step 4.1: Move the trees**

```bash
git mv src/extension/services/telemetry/recording src/extension/services/recording
git mv src/extension/services/telemetry/replay src/extension/services/recording/replay
git mv test/unit/services/telemetry/recording test/unit/services/recording
```

- [ ] **Step 4.2: Global specifier rewrite**

Mapping (apply across `src/`, `test/`, `scripts/`, `../recording-viewer/scripts/`):

```
@extension/services/telemetry/recording   →  @extension/services/recording
@extension/services/telemetry/replay      →  @extension/services/recording/replay
```

Run the rewrite, then verify (the recording-viewer generated file is regenerated in Step 4.3, so exclude it here):

```bash
grep -rln "telemetry/recording\|telemetry/replay" src test scripts ../recording-viewer 2>/dev/null | grep -v "recording-viewer/src/generated"
```

Expected: no output. Known affected files (re-grep before editing; tsc is the safety net):

- `src/extension/activation/sessionRecorderWiring.ts`
- `src/extension/controller/commands/repositorySubmitCommands.ts`
- `src/extension/dataCollection/index.ts` (and check `src/extension/dataCollection/types.ts`, `noop.ts` for path references)
- `src/extension/provider/artemisWebviewProvider.ts`
- `src/extension/types/IArtemisWebviewProvider.ts`
- Intra-tree absolute self-imports in the moved files: `lifecycleController.ts`, `observation/observationRegistry.ts`, `observation/terminalCollector.ts`, `snapshots/snapshotManager.ts`, `startup/startupCapture.ts`, `replay/replayCommand.ts`, `replay/replayEngine.ts`, `replay/snapshotReconstructor.ts`
- `scripts/event-coverage.ts`, `scripts/validate-recording.ts` (both are covered by `npm run check-types` — tsconfig has no `include`, so scripts/ is type-checked)
- `scripts/verify-clean-bundle.js` — its `FORBIDDEN` array contains `'src/extension/services/telemetry/recording/'` and `'src/extension/services/telemetry/replay/'`. Replace BOTH with the single entry `'src/extension/services/recording/'` (the replay subtree now lives inside it, substring match covers it). Keep `consentService.ts` and `sessionRecorderWiring.ts` entries unchanged.
- `test/e2e/recording.e2e.test.ts`
- `test/logic/dataCollection/fullSeam.test.ts`
- `test/logic/scripts/verifyCleanBundle.test.ts` — update ALL old-path fixture strings: `services/telemetry/recording/...` → `services/recording/...`, `services/telemetry/replay/...` → `services/recording/replay/...`, and the `services/telemetry/metrics/...` fixture (left over from Task 3) → `services/eq/...`. Keep the assertions structurally identical, including the negative case (forbidden input detected)
- `test/logic/telemetry/buildFamilyConsistency.test.ts`, `test/logic/telemetry/liveVsReplayEq.test.ts`
- `test/react/services/replay/replayEngine.test.ts`, `test/react/services/replay/snapshotReconstructor.test.ts`
- `test/unit/activation/sessionRecorderWiring.test.ts`
- all 13 moved files in `test/unit/services/recording/`
- `../recording-viewer/scripts/sync-types.mjs` (source path of the generated types)
- `src/extension/services/recording/README.md` (prose path mentions)

- [ ] **Step 4.3: Regenerate the recording-viewer types**

```bash
cd ../recording-viewer && node scripts/sync-types.mjs && cd ../extension
git diff --stat ../recording-viewer/src/generated/recordingTypes.ts
```

Expected: diff is empty or touches only the generated-from path comment. Any content diff = STOP, something else changed — investigate.

- [ ] **Step 4.4: Check esbuild and config for hardcoded paths**

```bash
grep -rn "telemetry/recording\|telemetry/replay" esbuild.js knip.json .vscode-test.mjs package.json tsconfig.json 2>/dev/null
```
Expected: no output (if a hit appears, update the path literal the same way).

- [ ] **Step 4.5: Gates (full matrix — this move touches recorder + replay + seam)**

```bash
npm run check-types && npm run lint
rm -rf out && npm run compile-tests   # moved test tree: stale compiled duplicates under out/ MUST be wiped
npm run test:unit 2>&1 | tee /tmp/pr2a-t4-unit.txt | tail -10
npm run test:struggle 2>&1 | tee /tmp/pr2a-t4-struggle.txt | tail -10
npm run test:react 2>&1 | tee /tmp/pr2a-t4-react.txt | tail -10
npm run test:recorder-e2e 2>&1 | tee /tmp/pr2a-t4-rec.txt | tail -10
node esbuild.js --production --variant=openvsx && node scripts/verify-clean-bundle.js
rm /tmp/pr2a-t4-*.txt
```

Then the now-clean residual grep (after Step 4.3 regenerated the viewer types):

```bash
grep -rn "telemetry/recording\|telemetry/replay" src test scripts ../recording-viewer 2>/dev/null
```
Expected: no output.

Expected: unit 1344, struggle 135, react 865, recorder-e2e 9, clean-bundle verification prints `OK: clean bundle contains no recorder/consent/replay inputs`.

- [ ] **Step 4.6: Prove verify-clean-bundle still bites**

A renamed path can silently turn the clean-bundle check into a no-op (pattern matches nothing ever again). The script exports `forbiddenInputs`/`FORBIDDEN` precisely so `test/logic/scripts/verifyCleanBundle.test.ts` can prove detection with fixtures. Read that test and update its fixtures/expected paths from `services/telemetry/recording|replay` to `services/recording`, keeping its assertions structurally identical — including the NEGATIVE case (a metafile containing a forbidden input must be detected). The updated logic test passing inside `npm run test:react` is the proof. Additionally assert by hand that the new pattern matches a real input path:

```bash
node -e "const {forbiddenInputs}=require('./scripts/verify-clean-bundle.js'); const meta='/tmp/pr2a-meta.json'; require('fs').writeFileSync(meta, JSON.stringify({inputs:{'src/extension/services/recording/sessionRecorder.ts':{}}})); const hits=forbiddenInputs(meta); console.log(hits.length===1?'DETECTS-OK':'DETECTION-DEAD'); require('fs').unlinkSync(meta);"
```

Expected output: `DETECTS-OK`.

- [ ] **Step 4.7: Commit**

```bash
# stage explicitly: the moved trees plus every modified importer/script from git status --short
git add src/extension/services/recording test/unit/services/recording ../recording-viewer/scripts/sync-types.mjs ../recording-viewer/src/generated/recordingTypes.ts scripts/event-coverage.ts scripts/validate-recording.ts scripts/verify-clean-bundle.js
git add src/extension/activation/sessionRecorderWiring.ts src/extension/controller/commands/repositorySubmitCommands.ts src/extension/dataCollection/index.ts src/extension/provider/artemisWebviewProvider.ts src/extension/types/IArtemisWebviewProvider.ts
git add test/e2e/recording.e2e.test.ts test/logic/dataCollection/fullSeam.test.ts test/logic/scripts/verifyCleanBundle.test.ts test/logic/telemetry/buildFamilyConsistency.test.ts test/logic/telemetry/liveVsReplayEq.test.ts test/react/services/replay test/unit/activation/sessionRecorderWiring.test.ts
# add any further files git status shows as modified by step 4.2 (e.g. dataCollection/types.ts, noop.ts)
git commit -m "refactor(recording): move recorder and replay out of services/telemetry"
```

---

### Task 5: Knip, changelog, final gates

**Files:**
- Modify: `CHANGELOG.md` (Internal section)

- [ ] **Step 5.1: knip**

```bash
npx knip 2>&1 | tail -20
```

Expected: clean (same as baseline). Typical failure mode: a moved module exports something whose only importer was missed, or `DEFAULT_MIN_LINES` in `paste.ts` is unused — if so, inline it as a plain default value (`minLines: number = 2`) and delete the export rather than suppressing knip.

- [ ] **Step 5.2: CHANGELOG entry**

Add under the Internal/unreleased section (match the existing format used by the "Sensing Layer" entry):

```markdown
- **Services restructuring**: recorder and replay moved to `services/recording/`, the
  passive EQ pipeline to `services/eq/`, URI filter and paste heuristic into the
  sensing layer. Pure relocation, no behavior change.
```

- [ ] **Step 5.3: Full final gate matrix**

```bash
npm run compile          # full build: check-types + lint + default esbuild variant
npm run package          # production full build (check-types + lint:src + esbuild --production)
rm -rf out && npm run compile-tests
npm run test:unit 2>&1 | tee /tmp/pr2a-final-unit.txt | tail -8
npm run test:struggle 2>&1 | tee /tmp/pr2a-final-struggle.txt | tail -8
npm run test:react 2>&1 | tee /tmp/pr2a-final-react.txt | tail -8
npm run test:recorder-e2e 2>&1 | tee /tmp/pr2a-final-rec.txt | tail -8
node esbuild.js --production --variant=openvsx && node scripts/verify-clean-bundle.js
npx knip
rm /tmp/pr2a-final-*.txt
```

Expected: unit 1344 / struggle 135 / react 865 / recorder-e2e 9, zero failures everywhere. NEVER skip a failing test — fix the import/move that broke it.

- [ ] **Step 5.4: Residual-reference sweep**

```bash
grep -rn "telemetry/recording\|telemetry/replay\|telemetry/uriFilter\|telemetry/metrics\|eventPipeline/compileEquivalentEmitter\|eventPipeline/lintDenylist" src test scripts docs ../recording-viewer 2>/dev/null | grep -v "docs/superpowers"
```

Expected: no output (plan/spec documents under docs/superpowers may mention old paths historically).

- [ ] **Step 5.5: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note the services restructuring"
```

---

## Out of Scope (deferred)

- SensorHub internal sources (buildResult, taskFeedbackView), paste *channel*, `readTextDocuments()` → PR 2b.
- Any v1 component removal, AlertSink, schema v3, harness replacement, `SessionResettable` relocation, eq service facade → PR 2b/2c.
- `services/telemetry/` final deletion → PR 2c.

## PR Description Skeleton (no AI attribution anywhere)

```
## PR 2a: services restructuring (telemetry dissolution, part 1)

Mechanical moves toward the Engine-v2 layer structure (spec section 3):
- recorder + replay → services/recording/
- passive EQ pipeline (engine, emitter, dedup, families, lint denylist) → services/eq/
- uriFilter + manual-paste heuristic → services/sensing/

Zero behavior change: only file locations and import specifiers changed; all
assertions untouched.

### Verification
- unit 1344 / struggle 135 / react 865 / recorder-e2e 9 — all green, counts unchanged
- check-types, lint, knip green
- clean openvsx bundle verified (incl. negative check: verify-clean-bundle still
  fails on the non-clean variant after the path rename)
- recording-viewer generated types re-synced (no content drift)
```
