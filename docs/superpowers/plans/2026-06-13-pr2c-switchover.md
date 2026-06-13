# PR 2c: v1 → Engine v2 Switchover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Engine v2 the live decision path. Remove the entire v1 EQ decision pipeline, route the engine's alerts through a single-level `AlertSink`, record the v2 score/alert stream (schema v3), rebuild the debug UI on v2, and delete `services/telemetry/`.

**Architecture:** A thin `StruggleCoordinator` (in `services/struggle/`) owns the engine and the passive EQ logger, acts as the websocket build-result producer (guard → `hub.emitBuildResult`), and exposes `onDidAlert`/`onDidTick`/`onDidCalculateEQ` for the recorder. A new `services/intervention/` implements `AlertSink` as a single status-bar hint (click → Iris chat). The recorder gains `struggleScore` + `alert` events (schema v3). The v1 decision components and `TelemetryManager` are deleted.

**Tech Stack:** TypeScript strict; mocha/vscode-test for the coordinator + intervention (TestSensorHub, sinon); vitest for any pure logic; the existing recording/replay/viewer toolchain for schema v3; clean-bundle seam unchanged.

---

## Context

- **Spec:** `docs/superpowers/specs/2026-06-12-struggle-engine-v2-port.md` — sections 3 (architecture), 4 (removals/splits), 6 (recording schema v3), 8 (PR 2c bullet), plus R3 (EQ becomes a passive logger), R4 (single-level delivery, escalation is future work).
- **Prereqs merged:** PR 2a (`68a78ea8`, structure) and PR 2b (`09151dc1`, additive engine). `services/struggle/` (engine + trackers), `services/sensing/` (hub with internal sources `onBuildResult`/`onTaskFeedbackView`/`onPasteDetected` + `emitBuildResult`/`emitTaskFeedbackView`), `services/eq/` (passive EQ pipeline), `services/recording/` all exist.
- **Branch:** `feat/struggle-switchover` off `feat/struggle-engine-v2`. PR merges into `feat/struggle-engine-v2`. `dev` untouched.
- **Liam's decisions (2026-06-13):**
  - Iris pipeline → **separate effort after P2** (Ch7). 2c rips out the dead `struggleContext`→chat plumbing (it is logged-only today, never sent to the Artemis API). The engine drives only the `AlertSink` + the v2 debug UI.
  - Intervention → **single-level** (spec R4), but **tier-ready**: the `AlertSink` receives the full `AlertRecord` (V, `path: 'armed'|'e6'`, boundary types) so escalation-over-persistence can be added later (Ch7) with no rearchitecture. Delivery surface = **status-bar hint, click opens Iris chat** (least intrusive; v2's cooldown/gates already make alerts sparse).
  - Debug UI → **rebuilt on v2** (V/S/boundary/last-alert; `artemis.showStruggleScore` dialog on engine state).
  - Coordinator → **new `StruggleCoordinator`**; `TelemetryManager` deleted.
- **The 15x/hour alert spam is fixed BY this PR**: deleting the v1 boundaryTrigger/cadence path and replacing it with the v2 state machine (cooldown 120 s, E6 re-alert 120 s, gates B2/warmup/grace, hysteresis) is the fix — not a later tunable. Cooldown/re-alert are frozen constants (re-tuning would invalidate the eval); intrusiveness is controlled by the delivery surface (status-bar) and future Ch7 tiering.
- **Gates:** every surviving suite green; clean openvsx bundle (`struggle/`, `sensing/`, `intervention/`, `eq/` ship; `recording/` excluded); knip clean; `npm run compile` + `npm run package`.
- **Forbidden:** AI attribution anywhere; `git add -A`/`git add .`; skipping failing tests; re-tuning any frozen v2 constant; touching `dev`.
- **Working directory:** all `npm`/`npx`/`node` and `git add` paths run FROM `extension/` (git accepts subdir-relative; `../CHANGELOG.md` reaches the repo-root changelog). Only Task 0's branch commands run from the repo root, as marked.

## Decision Log

1. **Clean-bundle layering for the recorder feed.** `services/struggle/` must NOT import `services/recording/` (recording is excluded from the openvsx bundle; struggle ships). So the `StruggleCoordinator` does NOT call the recorder. Instead it EXPOSES `onDidAlert`/`onDidTick` (delegated from the engine) and `onDidCalculateEQ` (from the passive EQ logger); the recorder-side wiring in `activation/sessionRecorderWiring.ts` (already recording-side, bundle-excluded) subscribes those and calls `recorder.recordAlert`/`recordStruggleScore`/`recordEqSnapshot`. Same inversion the v1 wiring used.
2. **AlertSink by dependency injection.** `services/struggle/` depends only on the `AlertSink` INTERFACE (`alerting/alertSink.ts`, already exists). `services/intervention/interventionService.ts` IMPLEMENTS it and imports `AlertRecord` from struggle. `extension.ts` constructs the `InterventionService` and injects it into the coordinator as its `AlertSink`. struggle never imports intervention.
3. **Passive EQ logger stays live.** Per R3, `eqSnapshot` events keep being recorded (study continuity + the v1-baseline comparison in the eval). The coordinator keeps feeding `compileEquivalentEmitter` (save-settle + build) → `errorQuotientEngine` → `onDidCalculateEQ`. EQ has NO decision role — it is pure telemetry. The debug UI shows v2 (V/S), not EQ.
4. **buildResultGuard moves to `services/sensing/`.** Both the coordinator (build-result producer) and the recorder use `shouldAcceptBuildResult`. sensing is imported by both and ships in the clean bundle (the guard is acquisition policy, pure of recorder deps). Removes the last non-type coordinator dependency on telemetry.
5. **SessionResettable/SessionStartContext → `services/sessionLifecycle.ts`** (new neutral top-level service module, zero deps). After v1 dies, the only implementers are the EQ logger (`errorQuotientEngine`, `compileEquivalentEmitter`); the coordinator drives them. A neutral module avoids eq↔struggle coupling for a lifecycle contract.
6. **Surviving recorded-event vocab → `services/recording/types.ts`.** The recorder keeps the `eqSnapshot` and (legacy-parse-only) `intervention` event interfaces, which reference `InterventionLevel`/`TriggerType`/the reason unions and EQ `confidence`. These vocab types move from `telemetry/types.ts` INTO `recording/types.ts` (self-contained) so telemetry can die. The viewer's `sync-types.mjs` `VOCAB_SOURCE` re-points from `telemetry/types.ts` to `recording/types.ts` (resolves the hazard flagged in PR 2a).
7. **Legacy `intervention` recorded event stays in the union, parse-only.** No v1 intervention events are produced live anymore, but v2 recordings (and the study corpus) contain them — `parseRecordedData` must still parse them. The new `alert` event is the v2 equivalent. `recordIntervention` becomes unused by production wiring but the method + type stay for backward compatibility and tests.
8. **`struggleScore` recorded every tick (10 s).** Per spec §6: `{ t, s, v, fTyping, fGap, fN4, fFb, fA8, fN2, typingRate, longestGapS, n4Ratio }`. `alert` recorded per emitted alert: `{ t, v, types, primary, path, inWarmup, inGrace, theta }`. `configurationSnapshot` gains `engineVersion: 'v2'`. `schemaVersion` 2 → 3.
9. **StruggleContext becomes v2 `StruggleSnapshot`**, used ONLY by the debug UI (chat plumbing removed). Shape: `{ isStruggling, v, s, primaryBoundary, lastAlert, sessionSeconds }`. Derived from the coordinator's last `TickRecord` + last `AlertRecord`.
10. **Old EQ scenario harness retired; EQ-unit tests kept.** `test/unit/struggle-detection/` v1 harness (ScenarioLoader, StruggleTestRunner, scenarios/, struggleDetection.test.ts, EvaluationEngine, ReportGenerator) + the v1-component tests are DELETED with their components. The surviving-EQ-logger tests (`errorQuotientEngine.test.ts`, `classifyBuildResult.test.ts`) move to `test/unit/services/eq/`. The v2 scenario harness (`test/unit/services/struggle/scenarios/`, from PR 2b) is the replacement. The `struggle` vscode-test label is repointed (see Task 7).
11. **Tree stays green at every commit.** Build additively first (sessionLifecycle, buildResultGuard move, vocab move, schema v3, AlertSink impl, coordinator — all behind no live wiring), THEN flip extension.ts/recorder wiring (the switchover commit), THEN delete v1. No commit leaves a broken build.

## Target architecture after 2c

```
services/
├─ sessionLifecycle.ts        SessionResettable, SessionStartContext (neutral)
├─ sensing/                   + buildResultGuard.ts (moved from telemetry/)
├─ eq/                        passive logger (unchanged behavior; SessionResettable from sessionLifecycle)
├─ struggle/                  engine (2b) + struggleCoordinator.ts (NEW) + alerting/alertSink.ts (2b)
├─ intervention/              interventionService.ts implements AlertSink (single-level) (NEW dir)
│  └─ debug/                  v2 debug surface (showStruggleScore dialog on engine state)
├─ recording/                 schema v3 (+ struggleScore, alert; + moved vocab) 
└─ telemetry/                 DELETED
```

## File Map (key moves/creates/deletes)

| Action | Path |
|---|---|
| CREATE | `services/sessionLifecycle.ts` |
| MOVE | `telemetry/buildResultGuard.ts` → `sensing/buildResultGuard.ts` |
| CREATE | `services/struggle/struggleCoordinator.ts` |
| CREATE | `services/intervention/interventionService.ts` (+ index.ts) |
| CREATE | `services/intervention/debug/struggleDebug.ts` |
| MODIFY | `services/struggle/types.ts` (+ StruggleSnapshot) |
| MODIFY | `recording/types.ts` (+ StruggleScoreEvent, AlertEvent, engineVersion; + moved vocab) |
| MODIFY | `recording/parseRecordedData.ts` (+ 2 parsers) |
| MODIFY | `recording/sessionRecorder.ts` (+ recordStruggleScore, recordAlert) |
| MODIFY | `recording/replay/replayEngine.ts` (tolerate new events) |
| MODIFY | `recording/storageWriter.ts`, `recording/lifecycleController.ts` (schemaVersion 3) |
| MODIFY | `../recording-viewer/scripts/sync-types.mjs` (+ generated types; VOCAB_SOURCE) |
| MODIFY | `extension.ts` (TelemetryManager → StruggleCoordinator + InterventionService) |
| MODIFY | `activation/sessionRecorderWiring.ts` (record alert/struggleScore; drop v1 intervention wiring) |
| MODIFY | `activation/extensionCommands.ts` (showStruggleScore → coordinator/debug) |
| MODIFY | `services/ui/viewInitDataService.ts` (sendStruggleDetectionInit → v2) |
| MODIFY | `provider/chatWebviewProvider.ts` (remove struggleContext plumbing) |
| MODIFY | `services/iris/chat/chatMessageService.ts` (remove struggleContext param) |
| MODIFY | `src/shared/messageContracts/extensionMessages.ts` (struggleDetectionInit v2 shape) |
| MODIFY | `src/webview/views/StruggleDetection/{StruggleDetectionView.tsx,types.ts}` (v2 fields) |
| DELETE | `telemetry/decision/interventionDecisionEngine.ts`, `telemetry/interventionFilter.ts`, `telemetry/intervention/adaptiveCadence.ts`, `telemetry/eventPipeline/boundaryTriggerEmitter.ts`, `telemetry/inactivityService.ts`, `telemetry/buildResultTracker.ts`, `telemetry/diagnosticPersistenceService.ts`, `telemetry/debugDashboard.ts`, `telemetry/interventionService.ts`, `telemetry/telemetryManager.ts`, `telemetry/index.ts`, `telemetry/types.ts` |
| DELETE | v1 tests + `test/unit/struggle-detection/` harness (see Task 6) |
| MOVE | `errorQuotientEngine.test.ts`, `classifyBuildResult.test.ts` → `test/unit/services/eq/` |

---

### Task 0: Branch + plan doc

- [ ] **Step 0.1:** Confirm PR 2b merged: `git log --oneline origin/feat/struggle-engine-v2 | head -3` shows `09151dc1`. If not, STOP/BLOCKED.
- [ ] **Step 0.2:**

```bash
cd /Users/liamberger/Documents/private/MA/artemis-extension   # repo root (this task only)
git switch feat/struggle-engine-v2 && git pull
git switch -c feat/struggle-switchover
git add docs/superpowers/plans/2026-06-13-pr2c-switchover.md
git commit -m "docs(struggle): add PR 2c switchover plan"
cd extension                                                  # all later tasks run from here
```

---

### Task 1: Relocate SessionResettable + move buildResultGuard (additive, green)

**Files:**
- Create: `extension/src/extension/services/sessionLifecycle.ts`
- Modify: `telemetry/types.ts` (re-export from the new home, interim), `eq/errorQuotientEngine.ts`, `eq/compileEquivalentEmitter.ts` (import from new home)
- Move: `telemetry/buildResultGuard.ts` → `sensing/buildResultGuard.ts`; update importers (`telemetryManager.ts`, `recording/sessionRecorder.ts`, `test/.../buildResultGuard.test.ts`)

- [ ] **Step 1.1:** Create `services/sessionLifecycle.ts` with the two declarations moved VERBATIM from `telemetry/types.ts` (read them first; they are `SessionStartContext` and `SessionResettable`):

```ts
// extension/src/extension/services/sessionLifecycle.ts
/**
 * Session-lifecycle contracts shared across services (EQ logger, struggle
 * coordinator). Neutral home so no service depends on another just for these
 * types. Moved out of services/telemetry/ in PR 2c as that layer is deleted.
 */
import type * as vscode from 'vscode';

export interface SessionStartContext {
    exerciseId: number;
    exerciseRoot?: vscode.Uri;
}

export interface SessionResettable {
    onSessionStart(context: SessionStartContext): void;
    onSessionEnd?(): void;
}
```

- [ ] **Step 1.2:** In `telemetry/types.ts`, REMOVE the two declarations and add `export type { SessionResettable, SessionStartContext } from '@extension/services/sessionLifecycle';` (interim re-export so the not-yet-deleted v1 files keep compiling). In `eq/errorQuotientEngine.ts` and `eq/compileEquivalentEmitter.ts`, change the import of those two names from `@extension/services/telemetry/types` to `@extension/services/sessionLifecycle`.

- [ ] **Step 1.3:** Move buildResultGuard:

```bash
git mv src/extension/services/telemetry/buildResultGuard.ts src/extension/services/sensing/buildResultGuard.ts
```

Update its importers' specifier `@extension/services/telemetry/buildResultGuard` → `@extension/services/sensing/buildResultGuard`: `telemetryManager.ts`, `recording/sessionRecorder.ts`, and the test (`git mv` the test too: `test/unit/services/telemetry/buildResultGuard.test.ts` → `test/unit/services/sensing/buildResultGuard.test.ts`, update its import). Verify the guard imports nothing from telemetry (it takes `ExerciseRegistry`/`ResultDTO` as params/type-imports — confirm and adjust specifiers if any point at telemetry).

- [ ] **Step 1.4:** Verify + gate:

```bash
grep -rn "telemetry/buildResultGuard" src test scripts ../recording-viewer 2>/dev/null   # expect empty
npm run check-types && npm run lint
rm -rf out && npm run compile-tests && npm run test:unit 2>&1 | tail -3   # reports/mocha-results.xml: failures=0, count unchanged
```

- [ ] **Step 1.5:** Commit:

```bash
git add src/extension/services/sessionLifecycle.ts src/extension/services/telemetry/types.ts src/extension/services/eq/errorQuotientEngine.ts src/extension/services/eq/compileEquivalentEmitter.ts src/extension/services/sensing/buildResultGuard.ts src/extension/services/telemetry/telemetryManager.ts src/extension/services/recording/sessionRecorder.ts test/unit/services/sensing/buildResultGuard.test.ts
git commit -m "refactor(struggle): neutral session-lifecycle module, buildResultGuard into sensing"
```

---

### Task 2: Recording schema v3 — struggleScore + alert events (additive, green)

**Files:**
- Modify: `recording/types.ts` (new event interfaces + union + `engineVersion` on configurationSnapshot + bump schemaVersion default note)
- Modify: `recording/parseRecordedData.ts` (2 parsers + EVENT_PARSERS entries)
- Modify: `recording/sessionRecorder.ts` (recordStruggleScore, recordAlert)
- Modify: `recording/storageWriter.ts`, `recording/lifecycleController.ts` (`schemaVersion: 3`)
- Modify: `recording/replay/replayEngine.ts` (ignore the new events explicitly, no throw)
- Modify: `../recording-viewer/scripts/sync-types.mjs` run → regenerate `recordingTypes.ts`
- Test: `test/unit/services/recording/struggleScoreAlertEvents.test.ts` (new)

- [ ] **Step 2.1: Write the failing parser/recorder test** `test/unit/services/recording/struggleScoreAlertEvents.test.ts` (mocha; mirror `parseRecordedData.test.ts` style):

```ts
import * as assert from 'assert';

import { parseRecordedEvent } from '@extension/services/recording/parseRecordedData';

suite('schema v3: struggleScore + alert events', () => {
    test('parseRecordedEvent accepts a well-formed struggleScore', () => {
        const ev = parseRecordedEvent({
            type: 'struggleScore', timestamp: 1000, t: 10, s: 0.7, v: 0.7,
            fTyping: 1, fGap: 1, fN4: 0.1, fFb: 0, fA8: 0, fN2: 0,
            typingRate: 0, longestGapS: 60, n4Ratio: 1,
        });
        assert.ok(ev);
        assert.strictEqual(ev!.type, 'struggleScore');
    });
    test('parseRecordedEvent accepts a well-formed alert', () => {
        const ev = parseRecordedEvent({
            type: 'alert', timestamp: 2000, t: 490, v: 0.7,
            types: ['STATE'], primary: 'STATE', path: 'armed',
            inWarmup: false, inGrace: false, theta: 0.6,
        });
        assert.ok(ev);
        assert.strictEqual(ev!.type, 'alert');
    });
    test('rejects struggleScore with a non-finite score', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'struggleScore', timestamp: 1, t: 10, s: NaN, v: 0 }), null);
    });
    test('rejects alert with an invalid path', () => {
        assert.strictEqual(parseRecordedEvent({
            type: 'alert', timestamp: 1, t: 10, v: 0.7, types: ['STATE'],
            primary: 'STATE', path: 'bogus', inWarmup: false, inGrace: false, theta: 0.6,
        }), null);
    });
});
```

Run: `rm -rf out && npm run compile-tests && npx vscode-test --label unit ... ` — simpler: `npm run test:unit` after compile; expect the new test FAILS (parsers missing → events parse to null).

- [ ] **Step 2.2: Add event interfaces to `recording/types.ts`.** Place near the eqSnapshot block; add to the `RecordedEvent` union. The `BoundaryType` is `'FM' | 'FM_PLUS' | 'E4' | 'N1' | 'STATE'` — to keep recording self-contained (no struggle import in the type file is fine since struggle ships too, but recording types should stay dependency-light) DEFINE a local string-literal union here mirroring it:

```ts
// ── Block L: Engine v2 score + alert events (schemaVersion 3) ────────
/** Boundary types as recorded (mirror of services/struggle BoundaryType). */
export type RecordedBoundaryType = 'FM' | 'FM_PLUS' | 'E4' | 'N1' | 'STATE';

/** Engine v2 per-tick score sample (every 10 s). */
export interface StruggleScoreEvent {
    type: 'struggleScore';
    timestamp: number;
    /** Session-relative tick time (s). */
    t: number;
    s: number;
    v: number;
    fTyping: number;
    fGap: number;
    fN4: number;
    fFb: number;
    fA8: number;
    fN2: number;
    typingRate: number;
    longestGapS: number;
    n4Ratio: number;
}

/** Engine v2 emitted alert. */
export interface AlertEvent {
    type: 'alert';
    timestamp: number;
    t: number;
    v: number;
    types: RecordedBoundaryType[];
    primary: RecordedBoundaryType;
    path: 'armed' | 'e6';
    inWarmup: boolean;
    inGrace: boolean;
    theta: number;
}
```

Add `| StruggleScoreEvent | AlertEvent` to the `RecordedEvent` union. Add `engineVersion?: 'v2'` to `ConfigurationSnapshotEvent`.

- [ ] **Step 2.3: Add parsers to `parseRecordedData.ts`** (mirror `parseEqSnapshot` style; use the existing `isFiniteNumber`/`isOneOf`/`isBoolean` helpers):

```ts
function parseStruggleScore(d: Record<string, unknown>, timestamp: number): StruggleScoreEvent | null {
    const nums = ['t', 's', 'v', 'fTyping', 'fGap', 'fN4', 'fFb', 'fA8', 'fN2', 'typingRate', 'longestGapS', 'n4Ratio'] as const;
    for (const k of nums) { if (!isFiniteNumber(d[k])) { return null; } }
    return {
        type: 'struggleScore', timestamp,
        t: d.t as number, s: d.s as number, v: d.v as number,
        fTyping: d.fTyping as number, fGap: d.fGap as number, fN4: d.fN4 as number,
        fFb: d.fFb as number, fA8: d.fA8 as number, fN2: d.fN2 as number,
        typingRate: d.typingRate as number, longestGapS: d.longestGapS as number, n4Ratio: d.n4Ratio as number,
    };
}

const RECORDED_BOUNDARY_TYPES = ['FM', 'FM_PLUS', 'E4', 'N1', 'STATE'] as const;

function parseAlert(d: Record<string, unknown>, timestamp: number): AlertEvent | null {
    if (!isFiniteNumber(d.t) || !isFiniteNumber(d.v) || !isFiniteNumber(d.theta)) { return null; }
    if (!Array.isArray(d.types) || !d.types.every(x => isOneOf(x, RECORDED_BOUNDARY_TYPES))) { return null; }
    if (!isOneOf(d.primary, RECORDED_BOUNDARY_TYPES)) { return null; }
    if (!isOneOf(d.path, ['armed', 'e6'] as const)) { return null; }
    if (!isBoolean(d.inWarmup) || !isBoolean(d.inGrace)) { return null; }
    return {
        type: 'alert', timestamp,
        t: d.t as number, v: d.v as number,
        types: d.types as RecordedBoundaryType[],
        primary: d.primary as RecordedBoundaryType,
        path: d.path as 'armed' | 'e6',
        inWarmup: d.inWarmup as boolean, inGrace: d.inGrace as boolean, theta: d.theta as number,
    };
}
```

Register both in `EVENT_PARSERS` (`struggleScore: parseStruggleScore, alert: parseAlert,`). The `satisfies Record<RecordedEvent['type'], EventParser>` line enforces exhaustiveness — tsc fails if a union member lacks a parser, so adding the union members in 2.2 forces these entries. Also add `engineVersion` parsing to `parseConfigurationSnapshot` (optional: accept `isOneOf(d.engineVersion, ['v2'])` or undefined).

- [ ] **Step 2.4: Add recorder methods to `sessionRecorder.ts`** (mirror `recordEqSnapshot`):

```ts
recordStruggleScore(sample: Omit<StruggleScoreEvent, 'type' | 'timestamp'>): void {
    this._record({ type: 'struggleScore', ...sample });
}

recordAlert(alert: Omit<AlertEvent, 'type' | 'timestamp'>): void {
    this._record({ type: 'alert', ...alert });
}
```

(Import the two types. The `_record` helper stamps `timestamp` — confirm against the existing `recordEqSnapshot`.)

- [ ] **Step 2.5: Bump schemaVersion to 3** in `storageWriter.ts` (the `schemaVersion: 2` metadata literal) and `lifecycleController.ts` (the `schemaVersion: 2` sessionStart literal). The `engineVersion: 'v2'` is set by the configurationSnapshot startup contributor in Task 5.

- [ ] **Step 2.5b: Update tests asserting `schemaVersion: 2`.** The bump breaks hardcoded assertions. Update each to `3`: `test/unit/services/recording/sessionRecorder.test.ts` (~line 205), `test/unit/services/recording/storageWriter.test.ts` (~line 491), `test/unit/services/recording/parseRecordedData.test.ts` (~lines 144 and 600), and the recorder e2e `test/e2e/recording.e2e.test.ts` (~lines 200 and 329). Re-grep `grep -rn "schemaVersion.*2\b\|schemaVersion: 2" test` to catch any others; change only the EXPECTED value, not the assertion structure.

- [ ] **Step 2.6: replayEngine tolerance.** The replay main loop switches on event type; `struggleScore`/`alert` are not EQ inputs — confirm the loop's `default`/unhandled path SKIPS unknown types (it should, post-2a). Add an explicit no-op case or comment so a reader knows these are intentionally ignored by EQ replay. No behavior change to EQ replay.

- [ ] **Step 2.7: Regenerate viewer types:**

```bash
cd ../recording-viewer && node scripts/sync-types.mjs && cd ../extension
git diff --stat ../recording-viewer/src/generated/recordingTypes.ts   # should now CONTAIN StruggleScoreEvent/AlertEvent
```

The viewer's event-type registries are EXHAUSTIVE — adding the two events is mandatory or the viewer's TS build fails before any fallback. Update `recording-viewer/src/constants.ts`: add `struggleScore` and `alert` to `ALL_EVENT_TYPES` and give each a `MARKER_COLORS` entry. The display helpers in `recording-viewer/src/utils/eventDisplay.tsx` may stay minimal (a generic row is fine), but the constants are required. Read both files first and follow their existing shape.

- [ ] **Step 2.8: Gate + commit:**

```bash
npm run check-types && npm run lint
rm -rf out && npm run compile-tests && npm run test:unit 2>&1 | tail -3   # new test passes; count +4
npm run test:react 2>&1 | tail -3   # viewer + replay react tests green
npm run test:recorder-e2e 2>&1 | tail -3   # schemaVersion assertions now expect 3
git add src/extension/services/recording/types.ts src/extension/services/recording/parseRecordedData.ts src/extension/services/recording/sessionRecorder.ts src/extension/services/recording/storageWriter.ts src/extension/services/recording/lifecycleController.ts src/extension/services/recording/replay/replayEngine.ts test/unit/services/recording/struggleScoreAlertEvents.test.ts test/unit/services/recording/sessionRecorder.test.ts test/unit/services/recording/storageWriter.test.ts test/unit/services/recording/parseRecordedData.test.ts test/e2e/recording.e2e.test.ts ../recording-viewer/scripts/sync-types.mjs ../recording-viewer/src/generated/recordingTypes.ts ../recording-viewer/src/constants.ts
# + any viewer eventDisplay file touched in 2.7
git commit -m "feat(recording): schema v3 struggleScore and alert events"
```

---

### Task 3: AlertSink implementation — services/intervention/ (additive, green)

**Files:**
- Modify: `extension/src/extension/services/struggle/alerting/alertSink.ts` (add optional `reset?()`)
- Create: `extension/src/extension/services/intervention/interventionService.ts`
- Create: `extension/src/extension/services/intervention/index.ts`
- Test: `extension/test/unit/services/intervention/interventionService.test.ts`

- [ ] **Step 3.0: Extend `AlertSink`** (in `services/struggle/alerting/alertSink.ts`) with an optional clear hook so the coordinator can hide a visible intervention on a session change or when the user disables interventions. This stays interface-only; the engine does not depend on it:

```ts
export interface AlertSink {
    deliver(alert: AlertRecord): void;
    /** Clear any visible intervention (session change, or interventions disabled). */
    reset?(): void;
}
```

- [ ] **Step 3.1: Write the failing test** (mocha; the service registers a command and shows a status-bar hint on `deliver`):

```ts
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { InterventionService } from '@extension/services/intervention';
import type { AlertRecord } from '@extension/services/struggle/types';

function alert(overrides: Partial<AlertRecord> = {}): AlertRecord {
    return {
        t: 490, ts: 1000, v: 0.7, typesPreGate: ['STATE'], types: ['STATE'],
        primary: 'STATE', path: 'armed', inWarmup: false, inGrace: false, ...overrides,
    };
}

suite('InterventionService (AlertSink, single-level)', () => {
    let svc: InterventionService;
    teardown(() => { svc?.dispose(); });

    test('deliver shows the status-bar hint', () => {
        svc = new InterventionService();
        svc.deliver(alert());
        // The hint is visible; exposed for testing via a getter.
        assert.strictEqual(svc.isHintVisible, true);
    });

    test('clicking the hint opens the Iris chat view', async () => {
        const exec = sinon.stub(vscode.commands, 'executeCommand').resolves(undefined);
        try {
            svc = new InterventionService();
            svc.deliver(alert());
            await svc.handleClick();
            assert.ok(exec.calledWith('iris.chatView.focus'));
        } finally {
            exec.restore();
        }
    });

    test('onSessionStart clears any visible hint', () => {
        svc = new InterventionService();
        svc.deliver(alert());
        svc.onSessionStart({ exerciseId: 1 });
        assert.strictEqual(svc.isHintVisible, false);
    });

    test('deliver fires onDidDeliver with the alert (for the recorder/debug)', () => {
        svc = new InterventionService();
        const seen: AlertRecord[] = [];
        svc.onDidDeliver(a => seen.push(a));
        const a = alert({ v: 0.85 });
        svc.deliver(a);
        assert.strictEqual(seen.length, 1);
        assert.strictEqual(seen[0].v, 0.85);
    });
});
```

(The `iris.intervention.acceptSubtle` command name from v1 is reused as the status-bar command; if the test for command registration collides with another suite's registration, copy the sinon `registerCommand` stub pattern from the existing `telemetryManagerCadenceFilter.test.ts` — verify whether it still exists; if deleted in Task 6, inline the stub. NOTE: that v1 test is deleted in Task 6 but Task 3 lands BEFORE it, so it still exists when this test is written — still prefer inlining a self-contained registerCommand stub so this suite does not depend on a soon-deleted file.)

- [ ] **Step 3.2: Implement `intervention/interventionService.ts`:**

```ts
// extension/src/extension/services/intervention/interventionService.ts
import * as vscode from 'vscode';

import type { SessionResettable, SessionStartContext } from '@extension/services/sessionLifecycle';
import type { AlertSink } from '@extension/services/struggle/alerting/alertSink';
import type { AlertRecord } from '@extension/services/struggle/types';

/**
 * Single-level struggle intervention (spec R4): one status-bar hint shown on a
 * v2 alert; clicking it opens the Iris chat. The engine's alert state machine
 * (cooldown 120 s, gates, hysteresis, E6 re-alert) governs frequency, so no
 * extra suppression/cadence logic lives here — that is exactly what makes the
 * v1 spam (idle/selection triggers + adaptive cadence) go away.
 *
 * Tier-ready: deliver() receives the full AlertRecord (V, path armed|e6,
 * boundary types). Escalation-over-persistence (path === 'e6') and richer UX
 * are future Ch7 work; this class deliberately stays single-level.
 *
 * Implements AlertSink (injected into StruggleCoordinator) and SessionResettable
 * (the coordinator resets it on a new exercise session).
 */
const HINT_COMMAND = 'iris.intervention.acceptSubtle';

export class InterventionService implements vscode.Disposable, AlertSink, SessionResettable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _statusBarItem: vscode.StatusBarItem;
    private _current: AlertRecord | undefined;

    private readonly _onDidDeliver = new vscode.EventEmitter<AlertRecord>();
    /** Fires on every delivered alert (recorder + debug UI subscribe). */
    readonly onDidDeliver = this._onDidDeliver.event;

    constructor() {
        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this._statusBarItem.command = HINT_COMMAND;
        this._disposables.push(this._statusBarItem);
        this._disposables.push(
            vscode.commands.registerCommand(HINT_COMMAND, () => this.handleClick()),
        );
    }

    get isHintVisible(): boolean { return this._current !== undefined; }

    /** AlertSink: deliver one alert as the single-level hint. */
    deliver(alert: AlertRecord): void {
        this._current = alert;
        this._statusBarItem.text = '$(lightbulb) Need help?';
        this._statusBarItem.tooltip = 'Iris noticed you might be stuck — click to open the chat.';
        this._statusBarItem.show();
        this._onDidDeliver.fire(alert);
    }

    async handleClick(): Promise<void> {
        this._hide();
        await vscode.commands.executeCommand('iris.chatView.focus');
    }

    onSessionStart(_context: SessionStartContext): void { this._hide(); }

    /** AlertSink.reset: clear the visible hint (session change / interventions disabled). */
    reset(): void { this._hide(); }

    private _hide(): void {
        this._current = undefined;
        this._statusBarItem.hide();
    }

    dispose(): void {
        this._hide();
        while (this._disposables.length > 0) { this._disposables.pop()?.dispose(); }
        this._onDidDeliver.dispose();
    }
}
```

`intervention/index.ts`: `export { InterventionService } from './interventionService';`

- [ ] **Step 3.3: Gate + commit:**

```bash
npm run check-types && npm run lint
rm -rf out && npm run compile-tests && npm run test:unit 2>&1 | tail -3
git add src/extension/services/struggle/alerting/alertSink.ts src/extension/services/intervention/interventionService.ts src/extension/services/intervention/index.ts test/unit/services/intervention/interventionService.test.ts
git commit -m "feat(intervention): single-level alert sink (status-bar hint to Iris)"
```

---

### Task 4: StruggleCoordinator (additive, not yet wired — green)

**Files:**
- Modify: `services/struggle/types.ts` (+ `StruggleSnapshot`)
- Create: `extension/src/extension/services/struggle/struggleCoordinator.ts`
- Test: `extension/test/unit/services/struggle/struggleCoordinator.test.ts`

- [ ] **Step 4.1: Add `StruggleSnapshot` to `struggle/types.ts`:**

```ts
/** Live engine state for the debug UI (replaces the v1 EQ StruggleContext). */
export interface StruggleSnapshot {
    isStruggling: boolean;
    v: number;
    s: number;
    primaryBoundary: BoundaryType | null;
    lastAlert: { t: number; types: readonly BoundaryType[]; path: 'armed' | 'e6' } | null;
    sessionSeconds: number;
}
```

- [ ] **Step 4.2: Write the failing test** (mocha; TestSensorHub; a stub AlertSink):

```ts
import * as assert from 'assert';
import * as vscode from 'vscode';

import type { ResultDTO } from '@extension/domain/submissions';
import type { AlertRecord } from '@extension/services/struggle/types';
import { StruggleCoordinator } from '@extension/services/struggle/struggleCoordinator';
import { TestSensorHub } from '@test/__shared__/testSensorHub';

function failingBuild(buildFailed = true): ResultDTO {
    return { id: 1, submission: { id: 1, buildFailed }, feedbacks: [] } as unknown as ResultDTO;
}

suite('StruggleCoordinator', () => {
    let hub: TestSensorHub;
    let delivered: AlertRecord[];
    let coord: StruggleCoordinator;

    setup(() => {
        hub = new TestSensorHub();
        delivered = [];
        coord = new StruggleCoordinator({
            hub,
            alertSink: { deliver: a => delivered.push(a) },
            exerciseRegistry: undefined,
        });
    });
    teardown(() => coord.dispose());

    test('onNewResult emits a guarded build result into the hub (engine sees it)', () => {
        const seen: unknown[] = [];
        const sub = hub.onBuildResult(s => seen.push(s));
        coord.startExerciseSession(1);
        coord.onNewResult(failingBuild());
        assert.strictEqual(seen.length, 1);
        sub.dispose();
    });

    test('an idle session drives the engine to an alert and the sink receives it', () => {
        coord.startExerciseSession(1, vscode.Uri.parse('file:///ws'));
        coord.advanceTo(coord.sessionStartMs + 520_000);   // test-only passthrough to engine.advanceTo
        assert.ok(delivered.length >= 1);
        assert.strictEqual(delivered[0].primary, 'STATE');
    });

    test('getSnapshot reflects the last tick', () => {
        coord.startExerciseSession(1);
        coord.advanceTo(coord.sessionStartMs + 20_000);
        const snap = coord.getSnapshot();
        assert.strictEqual(typeof snap.v, 'number');
        assert.strictEqual(snap.sessionSeconds, 20);
    });

    test('onDidTick fires for the recorder', () => {
        coord.startExerciseSession(1);
        const ticks: number[] = [];
        const sub = coord.onDidTick(t => ticks.push(t.t));
        coord.advanceTo(coord.sessionStartMs + 30_000);
        assert.deepStrictEqual(ticks, [10, 20, 30]);
        sub.dispose();
    });

    test('endExerciseSession stops the engine; restart resets', () => {
        coord.startExerciseSession(1);
        coord.advanceTo(coord.sessionStartMs + 30_000);
        coord.endExerciseSession();
        coord.startExerciseSession(2);
        const snap = coord.getSnapshot();
        assert.strictEqual(snap.sessionSeconds, 0);
    });
});
```

NOTE: the coordinator needs a test-friendly clock. Inject the same `EngineClock` the engine takes (default real clock); expose `advanceTo` + `sessionStartMs` for tests, OR construct the engine with an injectable clock the test pins. Simplest: the coordinator takes an optional `clock?: EngineClock` and forwards it to the engine; `advanceTo`/`sessionStartMs` are thin passthroughs used only by tests/replay. Re-derive the idle-alert expectation against the engine (same as PR 2b's t=490 STATE alert).

- [ ] **Step 4.3: Implement `struggleCoordinator.ts`:**

```ts
// extension/src/extension/services/struggle/struggleCoordinator.ts
import * as vscode from 'vscode';

import type { ResultDTO, WebSocketMessageHandler } from '@extension/types';   // confirm the real export site for both (mirror TelemetryManager's imports)
import type { ArtemisWebsocketService } from '@extension/services/websocket/artemisWebsocketService';
import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import { CompileEquivalentEmitter } from '@extension/services/eq/compileEquivalentEmitter';
import { ErrorQuotientEngine } from '@extension/services/eq/errorQuotientEngine';
import type { EQConfidence, EQState } from '@extension/services/eq/types';
import { shouldAcceptBuildResult } from '@extension/services/sensing/buildResultGuard';
import type { SensorHub } from '@extension/services/sensing';
import type { AlertSink } from '@extension/services/struggle/alerting/alertSink';
import { SPEC } from '@extension/services/struggle/constants';
import { StruggleEngine } from '@extension/services/struggle/struggleEngine';
import type { AlertRecord, EngineClock, StruggleSnapshot, TickRecord } from '@extension/services/struggle/types';

// Real clock used in production when none is injected; mirror the engine's DEFAULT_CLOCK.
const DEFAULT_CLOCK: EngineClock = {
    now: () => Date.now(),
    setInterval: (cb, ms) => setInterval(cb, ms),
    clearInterval: handle => clearInterval(handle as Parameters<typeof clearInterval>[0]),
};

export interface StruggleCoordinatorDeps {
    hub: SensorHub;
    alertSink: AlertSink;
    exerciseRegistry?: ExerciseRegistry;
    clock?: EngineClock;
}

/**
 * Owns Engine v2 (the live decision path) plus the passive EQ logger
 * (telemetry only, no decision role — spec R3). Replaces the v1 TelemetryManager.
 *
 * Responsibilities:
 *  - WebSocket build-result producer: guard → hub.emitBuildResult (engine) AND
 *    feed the EQ logger (eqSnapshot continuity).
 *  - Engine alert → AlertSink (single-level delivery).
 *  - Expose onDidAlert / onDidTick / onDidCalculateEQ for the recorder
 *    (subscribed by activation/sessionRecorderWiring; clean-bundle inversion,
 *    Decision 1).
 *  - getSnapshot() for the v2 debug UI.
 *  - Exercise session lifecycle.
 */
export class StruggleCoordinator implements vscode.Disposable, WebSocketMessageHandler {
    private readonly _hub: SensorHub;
    private readonly _alertSink: AlertSink;
    private readonly _exerciseRegistry: ExerciseRegistry | undefined;
    private readonly _engine: StruggleEngine;
    private readonly _clock: EngineClock;
    private readonly _eqEngine = new ErrorQuotientEngine();
    private readonly _compileEmitter = new CompileEquivalentEmitter();
    private readonly _disposables: vscode.Disposable[] = [];
    private _activeExerciseId: number | undefined;
    private _sessionStartMs = 0;
    private _lastTick: TickRecord | undefined;
    private _lastAlert: AlertRecord | undefined;
    private _isEnabled = true;
    private _showInterventions = true;

    private readonly _onDidCalculateEQ = new vscode.EventEmitter<{ eq: number; confidence: EQConfidence; source: 'save' | 'build' }>();
    readonly onDidCalculateEQ = this._onDidCalculateEQ.event;

    constructor(deps: StruggleCoordinatorDeps) {
        this._hub = deps.hub;
        this._alertSink = deps.alertSink;
        this._exerciseRegistry = deps.exerciseRegistry;
        this._clock = deps.clock ?? DEFAULT_CLOCK;
        this._engine = new StruggleEngine(this._hub, this._clock);

        // Engine alert → sink (UI gated by showInterventions) + snapshot bookkeeping.
        // The alert is ALWAYS recorded via the engine's onDidAlert (the recorder
        // wiring subscribes the engine directly); only UI delivery is gated.
        this._disposables.push(this._engine.onDidAlert(alert => {
            this._lastAlert = alert;
            if (this._showInterventions) {
                this._alertSink.deliver(alert);
            }
        }));
        this._disposables.push(this._engine.onDidTick(tick => { this._lastTick = tick; }));

        // Passive EQ logger (no decision role): settle + build → snapshot → eqSnapshot.
        this._disposables.push(this._hub.onDiagnosticsSettled(signal => {
            if (this._isEnabled) { this._compileEmitter.handleDiagnosticsSettled(signal); }
        }));
        this._disposables.push(this._compileEmitter.onDidEmitCompileEquivalent(event => {
            if (this._eqEngine.addSnapshot(event.snapshot)) {
                const { eq, confidence } = this._eqEngine.getCurrentEQ();
                this._onDidCalculateEQ.fire({ eq, confidence, source: event.source });
            }
        }));

        this._loadConfiguration();
        this._disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('artemis.struggleDetection')) { this._loadConfiguration(); }
        }));
    }

    // ── WebSocket handler (build-result producer) ──────────────────────
    onNewResult(result: ResultDTO): void {
        if (!this._isEnabled) { return; }
        if (!shouldAcceptBuildResult(result, this._activeExerciseId, this._exerciseRegistry)) { return; }
        this._hub.emitBuildResult(result);          // engine (FM/FM+/improved + fast decay)
        this._compileEmitter.handleBuildResult(result);   // passive EQ
    }

    private _websocketService: ArtemisWebsocketService | undefined;

    setWebsocketService(ws: ArtemisWebsocketService): void {
        this._websocketService = ws;
        ws.registerMessageHandler(this);     // coordinator implements WebSocketMessageHandler (onNewResult)
    }

    // ── Recorder feed (subscribed by sessionRecorderWiring) ────────────
    get onDidAlert() { return this._engine.onDidAlert; }
    get onDidTick() { return this._engine.onDidTick; }

    // ── Session lifecycle ──────────────────────────────────────────────
    startExerciseSession(exerciseId: number, exerciseRoot?: vscode.Uri): void {
        if (this._activeExerciseId === exerciseId) { return; }
        if (this._activeExerciseId !== undefined) { this.endExerciseSession(); }
        this._activeExerciseId = exerciseId;
        this._sessionStartMs = this._clock.now();
        const ctx = { exerciseId, exerciseRoot };
        this._eqEngine.onSessionStart(ctx);
        this._compileEmitter.onSessionStart(ctx);
        this._alertSink.reset?.();                 // clear any stale intervention from the prior session
        this._engine.start({ sessionStartMs: this._sessionStartMs, exerciseRoot });
        this._lastTick = undefined;
        this._lastAlert = undefined;
    }

    /** ms epoch of the active session start (test/replay helper). */
    get sessionStartMs(): number { return this._sessionStartMs; }

    /** Drive the engine's grid ticks deterministically (tests/replay; production
     *  uses the engine's own interval timer). */
    advanceTo(nowMs: number): void { this._engine.advanceTo(nowMs); }

    /** Passive EQ logger state for the recorder's eqEngineState startup contributor. */
    getEqEngineState(): EQState { return this._eqEngine.getState(); }

    endExerciseSession(): void {
        if (this._activeExerciseId === undefined) { return; }
        this._engine.stop();
        this._eqEngine.onSessionEnd?.();
        this._compileEmitter.onSessionEnd?.();
        this._activeExerciseId = undefined;
    }

    endCurrentSession(): void { this.endExerciseSession(); }

    // ── Debug snapshot ─────────────────────────────────────────────────
    getSnapshot(): StruggleSnapshot {
        const tick = this._lastTick;
        return {
            isStruggling: tick ? tick.v >= SPEC.THETA_FULL : false,
            v: tick?.v ?? 0,
            s: tick?.s ?? 0,
            primaryBoundary: tick && tick.boundariesPreGate.length > 0 ? tick.boundariesPreGate[0] : null,
            lastAlert: this._lastAlert
                ? { t: this._lastAlert.t, types: this._lastAlert.types, path: this._lastAlert.path }
                : null,
            sessionSeconds: tick?.t ?? 0,
        };
    }

    isEnabled(): boolean { return this._isEnabled; }

    private _loadConfiguration(): void {
        const cfg = vscode.workspace.getConfiguration('artemis.struggleDetection');
        this._isEnabled = cfg.get<boolean>('enabled', true);
        const prevShow = this._showInterventions;
        this._showInterventions = cfg.get<boolean>('showInterventions', true);
        // On transition to off, clear any visible intervention immediately (the
        // engine keeps computing/recording — only UI delivery is suppressed).
        if (prevShow && !this._showInterventions) { this._alertSink.reset?.(); }
    }

    dispose(): void {
        this._websocketService?.unregisterMessageHandler(this);   // parity with v1 TelemetryManager.dispose
        this.endExerciseSession();
        while (this._disposables.length > 0) { this._disposables.pop()?.dispose(); }
        this._engine.dispose();
        this._eqEngine.dispose?.();
        this._compileEmitter.dispose();
        this._onDidCalculateEQ.dispose();
    }
}
```

IMPLEMENTATION NOTES (binding):
- The coordinator owns its `_clock` (injected or `DEFAULT_CLOCK`); the engine is constructed with the same clock so tests pin both. `sessionStartMs` and `advanceTo` are thin passthroughs for tests/replay; production ticking is driven by the engine's own interval timer (no `advanceTo` call needed live).
- `showInterventions` is fully specified above: read in `_loadConfiguration`, gate `deliver`, and `reset?()` the sink on a true→false transition. The alert is still recorded (recorder subscribes the engine's `onDidAlert` directly via wiring, independent of UI visibility).
- `ErrorQuotientEngine` / `CompileEquivalentEmitter`: confirm `getState()`, `onSessionStart`, `onSessionEnd`, `dispose` exist on the CURRENT classes (read them). Call `onSessionEnd?.()` / `dispose?.()` with optional chaining where a method is not guaranteed. `getCurrentEQ()` and `addSnapshot()` signatures must match the v1 usage the coordinator copies.

- [ ] **Step 4.4: Gate + commit:**

```bash
npm run check-types && npm run lint
rm -rf out && npm run compile-tests && npm run test:unit 2>&1 | tail -3
git add src/extension/services/struggle/types.ts src/extension/services/struggle/struggleCoordinator.ts test/unit/services/struggle/struggleCoordinator.test.ts
git commit -m "feat(struggle): coordinator owning engine and passive EQ logger"
```

---

### Task 5: Atomic switchover — wire Engine v2 live, repoint ALL v1 consumers (one green commit)

The switchover is ATOMIC: `extension.ts` cannot stop constructing `TelemetryManager` without simultaneously repointing every consumer that took it. v1 `TelemetryManager` and its components STILL EXIST after this commit (deleted in Task 6) but are no longer constructed; the tree stays fully green (check-types + all tests, since the v1 files + their tests still compile and the v1 unit tests still pass in isolation — they construct their own instances).

**Files (follow tsc for the complete set; these are the known consumers):**
- `extension.ts` (construct `InterventionService` + `StruggleCoordinator`; rename `activeTelemetryManager`→`activeStruggleCoordinator`; deactivate; `onDidChangeExerciseContext`→`startExerciseSession`; taskFeedbackView producer)
- `activation/sessionRecorderWiring.ts` (recorder feed: eqSnapshot/struggleScore/alert; `getEqEngineState` contributor; configurationSnapshot `engineVersion: 'v2'`; deps type)
- `activation/extensionCommands.ts` (`artemis.showStruggleScore` → debug dialog from `coordinator.getSnapshot()`)
- `provider/artemisWebviewProvider.ts` + `provider/artemisWebviewProviderDeps.ts` (took `telemetryManager`; repoint to coordinator)
- `services/ui/exerciseOpeningService.ts` (calls `telemetryManager.startExerciseSession` — FUNCTIONAL path, repoint to coordinator)
- `services/ui/viewInitDataService.ts` (`sendStruggleDetectionInit` → v2 snapshot)
- `provider/chatWebviewProvider.ts` + `services/iris/chat/chatMessageService.ts` (remove dead `struggleContext` plumbing)
- `dataCollection/types.ts` + `dataCollection/index.ts` (the seam typed `telemetryManager`; repoint or drop if only passed through)
- `src/shared/messageContracts/extensionMessages.ts` + `src/webview/views/StruggleDetection/{types.ts,StruggleDetectionView.tsx}` (v2 debug contract + view)
- Create: `services/intervention/debug/struggleDebug.ts`
- Tests that construct/inject these (e.g. `test/unit/activation/sessionRecorderWiring.test.ts` asserts the eqEngineState contributor — update to the coordinator)

- [ ] **Step 5.1: extension.ts construction.** Replace the `TelemetryManager` block:

```ts
// old:
// const telemetryManager = new TelemetryManager(exerciseRegistry, sensorHub);
// activeTelemetryManager = telemetryManager;
// telemetryManager.setWebsocketService(artemisWebsocketService);
// new:
const interventionService = new InterventionService();
context.subscriptions.push(interventionService);
const struggleCoordinator = new StruggleCoordinator({
    hub: sensorHub,
    alertSink: interventionService,
    exerciseRegistry,
});
activeStruggleCoordinator = struggleCoordinator;
struggleCoordinator.setWebsocketService(artemisWebsocketService);
context.subscriptions.push(struggleCoordinator);
```

Rename the module-level `let activeTelemetryManager: TelemetryManager | undefined` → `activeStruggleCoordinator: StruggleCoordinator | undefined`; update `deactivate()` to dispose it (same try/catch shape). Pass `struggleCoordinator` (and `interventionService` where needed) to every consumer below.

- [ ] **Step 5.2: taskFeedbackView producer (consent-independent, error-isolated).** In `extension.ts`, where `artemisWebviewProvider` and `sensorHub` are both in scope, wire the view lifecycle into the hub EXACTLY ONCE, wrapped in try/catch (internal hub emitters do NOT isolate listener errors — see sensorHub.ts comment):

```ts
context.subscriptions.push(artemisWebviewProvider.onDidOpenTaskFeedback(p => {
    try { sensorHub.emitTaskFeedbackView('opened', p.viewId); } catch (err) {
        logger.error('emitTaskFeedbackView(opened) failed', LogCategory.TELEMETRY, err);
    }
}));
context.subscriptions.push(artemisWebviewProvider.onDidCloseTaskFeedback(p => {
    try { sensorHub.emitTaskFeedbackView('closed', p.viewId); } catch (err) {
        logger.error('emitTaskFeedbackView(closed) failed', LogCategory.TELEMETRY, err);
    }
}));
```

This is SEPARATE from the recorder's own `onDidOpenTaskFeedback`→`recordTaskFeedbackOpened` subscriptions in `sessionRecorderWiring.ts` (those stay; they only run when recording is enabled). The engine must see feedback views even when recording is off, hence the dedicated consent-independent wiring here. Do NOT add the emit inside `sessionRecorderWiring.ts`.

- [ ] **Step 5.3: sessionRecorderWiring.ts recorder feed.** Change `RecorderWiringDeps` to take `struggleCoordinator: StruggleCoordinator` instead of `telemetryManager: TelemetryManager`. Replace the whole "Telemetry EQ events" block (the 6 `onDidCalculateEQ`/`onDidShow/Accept/Dismiss/Block/Suppress` subscriptions) with:

```ts
disposables.push(struggleCoordinator.onDidCalculateEQ(({ eq, confidence, source }) => {
    sessionRecorder.recordEqSnapshot(eq, confidence, source);
}));
disposables.push(struggleCoordinator.onDidTick(tick => {
    sessionRecorder.recordStruggleScore({
        t: tick.t, s: tick.s, v: tick.v,
        fTyping: tick.features.fTyping, fGap: tick.features.fGap, fN4: tick.features.fN4,
        fFb: tick.features.fFb, fA8: tick.features.fA8, fN2: tick.features.fN2,
        typingRate: tick.features.typingRate, longestGapS: tick.features.longestGapS, n4Ratio: tick.features.n4Ratio,
    });
}));
disposables.push(struggleCoordinator.onDidAlert(alert => {
    sessionRecorder.recordAlert({
        t: alert.t, v: alert.v, types: [...alert.types], primary: alert.primary,
        path: alert.path, inWarmup: alert.inWarmup, inGrace: alert.inGrace, theta: SPEC.THETA_FULL,
    });
}));
```

The `eqEngineState` startup contributor keeps using `struggleCoordinator.getEqEngineState()` (the coordinator exposes it). The `configurationSnapshot` startup contributor adds `engineVersion: 'v2'` to its emitted event. Import `SPEC` from `@extension/services/struggle/constants`.

- [ ] **Step 5.4: debug helper + command + view contract.** Create `services/intervention/debug/struggleDebug.ts`:

```ts
// extension/src/extension/services/intervention/debug/struggleDebug.ts
import * as vscode from 'vscode';

import type { StruggleSnapshot } from '@extension/services/struggle/types';

export async function showStruggleScoreDialog(snapshot: StruggleSnapshot): Promise<void> {
    const lastAlert = snapshot.lastAlert;
    const lines = [
        `Struggling: ${snapshot.isStruggling ? 'yes' : 'no'}`,
        `V (decayed severity): ${snapshot.v.toFixed(3)}`,
        `S (instantaneous): ${snapshot.s.toFixed(3)}`,
        `Boundary at last tick: ${snapshot.primaryBoundary ?? '—'}`,
        `Last alert: ${lastAlert ? `t=${lastAlert.t}s (${lastAlert.types.join('+')}, ${lastAlert.path})` : '—'}`,
        `Session: ${snapshot.sessionSeconds}s`,
    ];
    await vscode.window.showInformationMessage('Engine v2 — struggle state', { modal: true, detail: lines.join('\n') }, 'OK');
}
```

`extensionCommands.ts`: `registerStruggleScoreCommand(struggleCoordinator)` → handler `await showStruggleScoreDialog(struggleCoordinator.getSnapshot())`.

Message contract (`extensionMessages.ts`) `struggleDetectionInit` → v2 shape:

```ts
struggleDetectionInit: {
    isStruggling: boolean;
    v: number;
    s: number;
    primaryBoundary: 'FM' | 'FM_PLUS' | 'E4' | 'N1' | 'STATE' | null;
    lastAlertT: number | null;
    isEnabled: boolean;
    developerMode: boolean;
};
```

`viewInitDataService.sendStruggleDetectionInit` builds it from `coordinator.getSnapshot()` + `coordinator.isEnabled()` + `_isDeveloperMode()`. Replace the `_telemetryManager` field of that service with `_struggleCoordinator`.

`src/webview/views/StruggleDetection/types.ts` → v2 `StruggleData` (isStruggling, v, s, primaryBoundary, lastAlertT, isEnabled, developerMode). `StruggleDetectionView.tsx` → remove `getEqLevel`/`getActionVariant` and EQ markers; render V as the primary number with a θ=0.6 marker (60% on the bar), an S read-out, an "is struggling" badge, the `primaryBoundary`, and `lastAlertT` ("Last alert at {n}s" / "—"). Color the V meter `data.v >= 0.6 ? '#f44336' : data.v >= 0.5 ? '#ff9800' : '#4caf50'`. Keep the dev-tools section (`__IRIS_RECORDING__ && developerMode`) and the disabled state. Update any react test for this view to the v2 fields.

- [ ] **Step 5.5: remove the dead struggleContext→Iris plumbing.** `chatWebviewProvider`: remove `getStruggleContext()` and the `struggleContext:` field in the chat-send payload (logged-only, never sent). `chatMessageService._sendToIris`: drop the `struggleContext?` param + the logging block + the `StruggleContext` import; drop it from `sendMessage`'s input type. The real Iris pipeline is a separate Ch7 effort.

- [ ] **Step 5.6: providers + seam + exercise-open.** `artemisWebviewProvider` + `artemisWebviewProviderDeps`: the `telemetryManager` dep becomes `struggleCoordinator` (used by `exerciseOpeningService.startExerciseSession`). `exerciseOpeningService.ts`: `telemetryManager.startExerciseSession(...)` → `struggleCoordinator.startExerciseSession(...)` (FUNCTIONAL — exercise-open starts the session). `dataCollection/types.ts` + `dataCollection/index.ts`: repoint the `telemetryManager` field to `struggleCoordinator`, or drop it if it was only passed through (check usage; the seam must not import recording-side code — coordinator is fine). Follow tsc for any remaining site.

- [ ] **Step 5.7: Gate + commit (full matrix — v1 still present but unused, must stay green):**

```bash
npm run check-types && npm run lint
rm -rf out && npm run compile-tests
npm run test:unit 2>&1 | tail -3
npm run test:react 2>&1 | tail -3
npm run test:recorder-e2e 2>&1 | tail -3   # now records v3 events
git add src/extension.ts src/extension/activation/sessionRecorderWiring.ts src/extension/activation/extensionCommands.ts src/extension/provider/artemisWebviewProvider.ts src/extension/provider/artemisWebviewProviderDeps.ts src/extension/services/ui/exerciseOpeningService.ts src/extension/services/ui/viewInitDataService.ts src/extension/provider/chatWebviewProvider.ts src/extension/services/iris/chat/chatMessageService.ts src/extension/dataCollection/types.ts src/extension/dataCollection/index.ts src/shared/messageContracts/extensionMessages.ts src/webview/views/StruggleDetection/types.ts src/webview/views/StruggleDetection/StruggleDetectionView.tsx src/extension/services/intervention/debug/struggleDebug.ts
# + every additional file tsc forced you to touch + updated tests (list from git status)
git commit -m "feat(struggle): wire Engine v2 live, single-level intervention, v2 debug view"
```

NOTE: this is the largest blast radius in the PR. Work tsc-error-driven: change extension.ts first, then fix each compile error outward. Do NOT delete v1 yet (Task 6). After this commit, `TelemetryManager`/v1 components are dead code that still compiles.

---

### Task 6: Delete the v1 decision path + its tests (one green commit)

v1 removal and its TEST removal MUST be the SAME commit: `check-types` compiles the test tree (tsconfig has no include/exclude), and `telemetry/index.ts` re-exports `telemetryManager`, so deleting production v1 without deleting the v1 tests/index in the same commit leaves `check-types` red.

**DELETE (production):** `telemetry/decision/interventionDecisionEngine.ts`, `telemetry/interventionFilter.ts`, `telemetry/intervention/adaptiveCadence.ts`, `telemetry/eventPipeline/boundaryTriggerEmitter.ts`, `telemetry/inactivityService.ts`, `telemetry/buildResultTracker.ts`, `telemetry/diagnosticPersistenceService.ts`, `telemetry/debugDashboard.ts`, `telemetry/interventionService.ts`, `telemetry/telemetryManager.ts`, `telemetry/index.ts` (re-exports the deleted manager).

**DELETE (tests of deleted v1 code):** the v1 scenario harness `test/unit/struggle-detection/` (ScenarioLoader.ts, StruggleTestRunner.ts, EvaluationEngine.ts, ReportGenerator.ts, types.ts, struggleDetection.test.ts, scenarios/, boundaryTriggerAndCadence.test.ts, telemetryManagerCrossExercise.test.ts) and the v1-component tests `test/unit/services/telemetry/{interventionService.test.ts,telemetryManagerCadenceFilter.test.ts,telemetryManagerInterventionToggle.test.ts,eqSettlePath.test.ts}`, `test/logic/telemetry/blockedReason.test.ts`. (VERIFY each by grep before deleting — see Step 6.1.)

**MOVE (surviving passive-EQ-logger tests):** `test/unit/struggle-detection/errorQuotientEngine.test.ts`, `classifyBuildResult.test.ts` → `test/unit/services/eq/` (fix imports to `@extension/services/eq/...`).

- [ ] **Step 6.1: Classify every test that references deleted code:**

```bash
grep -rln "interventionDecisionEngine\|interventionFilter\|intervention/adaptiveCadence\|boundaryTriggerEmitter\|inactivityService\|buildResultTracker\|diagnosticPersistenceService\|debugDashboard\|telemetry/telemetryManager\|telemetry/interventionService\|telemetry/index\|services/telemetry'" test
```

For each hit: (a) tests a DELETED v1 class → `git rm` the test; (b) tests a SURVIVING class via a stale path → it should already have been repointed in earlier PRs/tasks; if not, fix the import. Classify all in your report. `eqSettlePath.test.ts` — inspect: if it tests the v1 settle→EQ→intervention path it dies; if it tests only the surviving compileEmitter→eqEngine path, repoint it to eq/ instead of deleting (decide from its contents).

- [ ] **Step 6.2:** Execute the deletions and the moves:

```bash
git rm src/extension/services/telemetry/decision/interventionDecisionEngine.ts \
       src/extension/services/telemetry/interventionFilter.ts \
       src/extension/services/telemetry/intervention/adaptiveCadence.ts \
       src/extension/services/telemetry/eventPipeline/boundaryTriggerEmitter.ts \
       src/extension/services/telemetry/inactivityService.ts \
       src/extension/services/telemetry/buildResultTracker.ts \
       src/extension/services/telemetry/diagnosticPersistenceService.ts \
       src/extension/services/telemetry/debugDashboard.ts \
       src/extension/services/telemetry/interventionService.ts \
       src/extension/services/telemetry/telemetryManager.ts \
       src/extension/services/telemetry/index.ts
git rm -r test/unit/struggle-detection/scenarios
git rm test/unit/struggle-detection/{ScenarioLoader.ts,StruggleTestRunner.ts,EvaluationEngine.ts,ReportGenerator.ts,types.ts,struggleDetection.test.ts,boundaryTriggerAndCadence.test.ts,telemetryManagerCrossExercise.test.ts}
git rm test/unit/services/telemetry/{interventionService.test.ts,telemetryManagerCadenceFilter.test.ts,telemetryManagerInterventionToggle.test.ts}
git rm test/logic/telemetry/blockedReason.test.ts
mkdir -p test/unit/services/eq
git mv test/unit/struggle-detection/errorQuotientEngine.test.ts test/unit/services/eq/errorQuotientEngine.test.ts
git mv test/unit/struggle-detection/classifyBuildResult.test.ts test/unit/services/eq/classifyBuildResult.test.ts
# eqSettlePath.test.ts: git rm OR git mv per the Step 6.1 verdict
```

(The exact file list under `test/unit/struggle-detection/` must be confirmed with `ls` first — delete what is v1, move the two EQ tests. Empty dirs cleaned by git.)

- [ ] **Step 6.3:** Fix the moved tests' imports (`@extension/services/eq/...`), then gate (now both types AND tests must be green — v1 and its tests are gone together):

```bash
npm run check-types && npm run lint
rm -rf out && npm run compile-tests && npm run test:unit 2>&1 | tail -3
grep -rn "services/telemetry/\(decision\|intervention\|eventPipeline\|inactivityService\|buildResultTracker\|diagnosticPersistenceService\|debugDashboard\|telemetryManager\|index\)" src test 2>/dev/null   # expect empty
```

- [ ] **Step 6.4: Commit.** The `git rm`/`git mv` in Step 6.2 + the import fixes in Step 6.3 already stage their changes. Stage the import-fixed moved tests explicitly and verify nothing unexpected:

```bash
git add test/unit/services/eq/errorQuotientEngine.test.ts test/unit/services/eq/classifyBuildResult.test.ts
git status --short   # confirm ONLY telemetry-component deletions + v1-test deletions + the 2 EQ-test moves
git commit -m "refactor(struggle): delete the v1 EQ decision path and its tests"
```

---

### Task 7: Delete telemetry/types.ts (vocab migration), repoint labels, final cleanup

After Task 6, `services/telemetry/` contains only `types.ts` (the v1 vocab, re-exporting SessionResettable from sessionLifecycle as the Task-1 interim). The recorded-event interfaces in `recording/types.ts` still import some of that vocab.

**Files:** `recording/types.ts` (absorb surviving vocab, fully self-contained — NO `@extension/...` imports, see Step 7.1), the importers, `../recording-viewer/scripts/sync-types.mjs` (VOCAB_SOURCE), `.vscode-test.mjs` + `package.json` (struggle label), `knip.json` if needed, `../CHANGELOG.md`.

- [ ] **Step 7.1: Find remaining telemetry/types consumers:**

```bash
grep -rln "services/telemetry/types\|services/telemetry'" src test ../recording-viewer
```

These should be recording-side only: the `InterventionEvent`/`eqSnapshot` recorded-event interfaces reference `InterventionLevel`/`INTERVENTION_LEVELS`/`TriggerType`/the reason unions, and the EQ confidence union. Move those vocab declarations VERBATIM from `telemetry/types.ts` into `recording/types.ts` and make them **fully self-contained** — define every union INLINE in `recording/types.ts`, do NOT `import` from `@extension/services/eq/types` or any `@extension/...` alias. RATIONALE: the viewer's `sync-types.mjs` inlines `recording/types.ts` and CANNOT resolve `@extension/...` aliases (it only knows the old telemetry import block); an alias import would leave an unresolved import in the generated viewer types. The EQ confidence type is just `'insufficient' | 'sufficient'` — `eqSnapshot` already inlines exactly that literal union, so reuse the inline form (define a local `type RecordedEqConfidence = 'insufficient' | 'sufficient'` if a name is wanted). The `SessionResettable`/`SessionStartContext` re-export in telemetry/types.ts is dead once telemetry/types.ts is deleted — consumers already import them from `@extension/services/sessionLifecycle` (Task 1). Update every importer found above.

- [ ] **Step 7.2: Re-point the viewer VOCAB_SOURCE.** In `../recording-viewer/scripts/sync-types.mjs`, change `VOCAB_SOURCE` from `.../services/telemetry/types.ts` to `.../services/recording/types.ts` (where the vocab now lives). Regenerate:

```bash
cd ../recording-viewer && node scripts/sync-types.mjs && cd ../extension
git diff --stat ../recording-viewer/src/generated/recordingTypes.ts   # clean diff (vocab now sourced from recording/types.ts)
```

If the inlining regex no longer matches (the vocab moved files), adjust per the script's `EXTENSION_IMPORT_RE` logic so the consts still inline. Confirm the generated file still contains the vocab consts.

- [ ] **Step 7.3: Delete telemetry/:**

```bash
git rm src/extension/services/telemetry/types.ts
rmdir src/extension/services/telemetry 2>/dev/null || true
grep -rn "services/telemetry" src test scripts ../recording-viewer 2>/dev/null   # expect EMPTY
```

The `services/telemetry/` directory must be GONE. Resolve any remaining reference (move the type or fix the import).

- [ ] **Step 7.4: Repoint the `struggle` vscode-test label.** `.vscode-test.mjs` globs the deleted `out/test/unit/struggle-detection/**` for the `struggle` label. No `.github` workflow references `test:struggle` (verified). Choose: retire the `struggle` label — delete its entry in `.vscode-test.mjs` and the `test:struggle` script in `package.json`; the moved EQ tests + the v2 struggle tests (`test/unit/services/{eq,struggle}/`) already run under the `unit` label. Update any doc/script mention. (If you prefer to keep the label, repoint its glob to `out/test/unit/services/struggle/**` and exclude that from `unit` — but retiring is simpler; document the choice.)

- [ ] **Step 7.5: clean-bundle invariant.** `services/intervention/` ships in the openvsx bundle (UI delivery). `scripts/verify-clean-bundle.js` FORBIDDEN (forbids `recording/`, `consentService.ts`, `sessionRecorderWiring.ts`) needs NO change — 2c relocates nothing into a shipped path that should be excluded. Verify the shipped layers never import recording:

```bash
grep -rn "services/recording" src/extension/services/struggle src/extension/services/intervention src/extension/services/sensing src/extension/services/eq   # expect empty
```

- [ ] **Step 7.6: CHANGELOG** (Internal section, match format):

```markdown
- **Struggle Engine v2 live (switchover)**: the v1 EQ decision path (boundary triggers,
  adaptive cadence, intervention filter/decision engine, inactivity/build-result/diagnostic
  trackers, debug dashboard, TelemetryManager) is removed; Engine v2 now drives a single-level
  status-bar intervention via an AlertSink. Recording schema v3 adds per-tick `struggleScore`
  and `alert` events; the debug view shows V/S/boundary state. EQ survives as a passive logger
  only. `services/telemetry/` is deleted.
```

- [ ] **Step 7.7: Full final gate matrix:**

```bash
npm run compile && npm run package
rm -rf out && npm run compile-tests
npm run test:unit 2>&1 | tee /tmp/pr2c-unit.txt | tail -6
npm run test:react 2>&1 | tee /tmp/pr2c-react.txt | tail -6
npm run test:recorder-e2e 2>&1 | tee /tmp/pr2c-rec.txt | tail -6
node esbuild.js --production --variant=openvsx && node scripts/verify-clean-bundle.js
npx knip
rm /tmp/pr2c-*.txt
```

Expected: all green; recorder-e2e records v3 events; clean-bundle OK; knip clean (v1 deletions REMOVE exports; `recordIntervention` + the legacy `intervention` event stay parse-only — ensure a test still imports `recordIntervention`/the type, or annotate, so knip does not flag them). NEVER skip a failing test.

- [ ] **Step 7.8: Commit:**

```bash
# the git rm in Step 7.3 already staged the telemetry/types.ts deletion
git add src/extension/services/recording/types.ts ../recording-viewer/scripts/sync-types.mjs ../recording-viewer/src/generated/recordingTypes.ts .vscode-test.mjs package.json ../CHANGELOG.md
git add knip.json 2>/dev/null || true
# + every importer updated in 7.1 (list them explicitly from git status)
git status --short   # confirm the telemetry/types.ts deletion + the intended modifications only
git commit -m "refactor(struggle): delete services/telemetry, finalize schema-v3 vocab and labels"
```

## Out of Scope (later)

- **Iris struggle pipeline** (extension-side payload + Artemis backend) → separate Ch7 spec after P2.
- **Intervention escalation/tiering** (V-based or persistence-based via `path`) → Ch7. The AlertSink already receives the full AlertRecord, so this is additive.
- **PR 3** golden replay vs Python; **PR 4** next-wave telemetry; **PR 5** docs (incl. MA/CLAUDE.md v1→v2, services/README.md). The `recordIntervention` method + legacy `intervention` event stay parse-only for backward compatibility.

## Plan Self-Review Record

- **Spec coverage:** §3 architecture (intervention/ + coordinator + telemetry death) = Tasks 3-7; §4 removals (all 8 v1 components + cadence/max-3 dropped without replacement) = Task 6; §6 schema v3 = Task 2; R3 EQ passive logger = Decision 3/coordinator; R4 single-level = Task 3. PR 2c bullet (v1 removed, intervention→AlertSink, schema v3 incl. parser/replay/viewer, old harness retired) all mapped.
- **Green-at-every-commit:** Tasks 1-4 additive (new code dormant); Task 5 is the atomic flip (v1 orphaned but still compiling, all consumers repointed together); Task 6 deletes v1 production + its tests in ONE commit (check-types compiles the test tree, so they must go together); Task 7 deletes telemetry/types.ts after vocab migration. No commit breaks check-types OR compile-tests.
- **Clean-bundle:** struggle/intervention/sensing/eq ship and never import recording (Decision 1, recorder fed by inversion via sessionRecorderWiring). Verified in Step 7.5.
- **Type consistency:** `StruggleSnapshot`/`AlertRecord`/`TickRecord` flow coordinator→debug/recorder; `RecordedBoundaryType` mirrors `BoundaryType` (recording stays dependency-light); `EngineClock` injected into coordinator for tests.
- **Placeholders:** the `_sessionStartMs`/`_clock` placeholder in Task 4 is explicitly flagged with the binding fix in the IMPLEMENTATION NOTES. No TBDs elsewhere.
- **Risks:** Task 5 has the most cross-file blast radius (every `telemetryManager` consumer) — tsc is the safety net; the implementer follows compile errors. The `taskFeedbackView` producer site (consent-independent) is called out as a decision point in Step 5.2.

## PR Description Skeleton (no AI attribution)

```
## PR 2c: v1 → Engine v2 switchover

Engine v2 (PR 2b) becomes the live decision path. The v1 EQ decision pipeline
(boundary triggers, adaptive cadence, intervention filter + decision engine,
inactivity/build-result/diagnostic trackers, debug dashboard, TelemetryManager)
is deleted. A thin StruggleCoordinator owns the engine and the passive EQ logger
(EQ keeps telemetry-only, no decision role) and produces guarded build results
into the sensor hub. Alerts go through a single-level AlertSink (status-bar hint
→ Iris chat); the engine's cooldown/gates/hysteresis replace the v1 alert spam.
Recording schema v3 adds per-tick struggleScore and alert events. The debug view
is rebuilt on V/S/boundary state. services/telemetry/ is removed.

Single-level per spec R4; the AlertSink receives the full AlertRecord so
persistence-based escalation (Ch7) is additive. The Iris struggle pipeline is a
separate Ch7 effort (the old struggle-context chat plumbing was logged-only and
is removed).

### Verification
- new coordinator/intervention/schema-v3 suites; all surviving suites green;
  recorder-e2e records v3 events; clean openvsx bundle; knip; compile + package.
```
