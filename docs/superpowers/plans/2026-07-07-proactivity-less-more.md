# Proactivity Less/More (Pull/Push) Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or executing-plans task-by-task. Steps use `- [ ]`.
> **Revision 2** — incorporates codex review round 1 (6 required fixes).

**Goal:** Make Off/Less/More a real three-state proactivity control (Less=Pull, More=Push) driven by a
server-enforced action policy + per-level client throttle, and remove the hidden dismiss backoff.

**Architecture:** Detector stays fixed (theta 0.7). Level acts on three layers: (2) Artemis deterministically
forces `active`→`ambient` in Pull + Pyris gets the mode as tone context; (3) client re-routes an inbound
`active` to the ambient/PARKED path in Pull (defence in depth) and throttles per level. Level is per-exercise,
default `more`.

**Tech Stack:** TypeScript (VS Code extension), vitest (test/react + test/logic) + mocha (test/unit),
esbuild. Server: Artemis (Java/Spring) + Pyris (Python) in separate repos.

**Spec:** `docs/superpowers/specs/2026-07-07-proactivity-less-more-design.md`.

## Global Constraints

- package.json deps pinned exact (no `^`/`~`), except `engines.vscode`.
- No AI attribution anywhere.
- `ProactivePreferenceService` and the shared `ProactiveLevel` type import NOTHING from `services/struggle|intervention` (Open VSX clean bundle).
- Two runners: vscode-mocking logic tests under `test/logic/**` (vitest); `test/unit/**` is mocha (run `npm run compile-tests` first). Some existing affected tests live under `test/unit/**` — keep them there.
- Verify every task: `npm run check-types` + eslint; `npm run test:react` (react+logic); affected mocha via `npm run test:unit` after compile.
- All new throttle/level numbers are ENG; mark in `config.ts`.

## Level → parameter table (single source of truth)

| | Off | Less (Pull) | More (Push) |
|---|---|---|---|
| proactivity runs | no | yes | yes |
| allowed server action | (no POST) | silent, ambient | silent, ambient, active |
| wire `proactivityMode` | (none) | `pull` | `push` |
| maxAlertsPerSession | - | 3 | 6 |
| minDeliveryGapS | - | 300 | 150 |
| maxAlertsPerMinute | - | (removed) | (removed) |

Default level = `more`. `confidence-threshold` stays global (0.6). Both gaps are > `COOLDOWN_S=120` so they bite.

---

## Phase A — Level model, contract, seam

### Task A1: Canonical `ProactiveLevel` in shared + preference service

**Files:**
- Create/Modify: `src/shared/messageContracts/proactiveLevel.ts` (new canonical type) — or add to `webviewCommands.ts` if that is the established home; must be runtime-import-free.
- Modify: `src/webview/components/AskIris/AskIris.tsx:12` (import `ProactiveLevel` from shared, stop DEFINING it), and its barrels.
- Modify: `src/extension/services/proactivePreferenceService.ts:8-53`
- Test: `test/logic/proactivePreferenceService.test.ts:14`

**Interfaces:**
- Produces: `ProactiveLevel = 'off' | 'less' | 'more'` (canonical, shared). `ProactivePreferenceService.getLevel(id): ProactiveLevel`, `setLevel(id, level): void`, `isProactiveOn(id) = getLevel(id) !== 'off'`.

**Steps:**
- [ ] Define `ProactiveLevel` ONCE in shared. Update `AskIris.tsx` and every current importer to import from shared (codex: do NOT re-export the canonical type from the webview component).
- [ ] Preference store: `Record<number, 'less' | 'off'>` (persist only deviations from the `more` default). Read-time normalization in `_map`/`getLevel` (proactivePreferenceService.ts:25): legacy `false`→`'off'`; string `'less'|'off'` kept; anything else/absent→`'more'`.
- [ ] `setLevel`: `more`→delete key; `less`/`off`→store the string, via the existing write chain.
- [ ] `isProactiveOn(id)` derived from `getLevel(id) !== 'off'`.
- [ ] Tests (proactivePreferenceService.test.ts): default `more`; each level round-trips; legacy `false`→`off`; invalid persisted value → `more`; unknown exercise → `more`; import-shape check (no struggle/intervention import).

### Task A2: Webview command + message contract

**Files:**
- Modify: `src/shared/messageContracts/webviewCommands.ts:95-97,203-205,304-306`
- Modify: `src/shared/messageContracts/extensionMessages.ts` (UpdateProactiveControl ~462; SlotDebugSnapshot handled in B4)
- Test: `test/logic/messageContracts/slotUpdate.test.ts:10` (dev-view contract), add level mapping assertion where natural.

**Steps:**
- [ ] Replace `SetProactiveEnabled` with `SetProactiveLevel: 'setProactiveLevel'`; payload `{ exerciseId; level: ProactiveLevel; courseId? }`.
- [ ] Remove `ResumeProactive` (def 96/97, payload 205, list entry 306).
- [ ] `UpdateProactiveControl`: `level: ProactiveLevel` replaces `preference`; remove `autoPaused`.

### Task A3: Command module + push

**Files:**
- Modify: `src/extension/controller/commands/proactiveControlCommands.ts`
- Modify: `src/extension/controller/commands/types.ts:54` (capability: replace pause/resume booleans with `getProactiveLevel` — see A5)
- Test: controller command tests if present.

**Steps:**
- [ ] Handlers: drop `ResumeProactive`; `SetProactiveEnabled`→`SetProactiveLevel`.
- [ ] `handleSetLevel`: `proactivePreference.setLevel(exerciseId, level)` + `proactiveControl.setStudentProactive(exerciseId, level !== 'off')`; `await _push`.
- [ ] Delete `handleResume`.
- [ ] `_push`: `level = proactivePreference.getLevel(exerciseId)`; send `level`; remove `on`/`autoPaused` (isProactivePaused is deleted in B1).

### Task A4: Card + store wiring

**Files:**
- Modify: `src/webview/stores/useExerciseDetailStore.ts:19` (proactiveControl state: `level` not `preference`, drop `autoPaused`)
- Modify: `src/webview/views/ExerciseDetail/ExerciseDetailView.tsx` (remove `proactiveLevelPref` shim; `onLevelChange` posts `setProactiveLevel`; remove resume/paused)
- Modify: `src/webview/components/AskIris/AskIris.tsx` (VM: drop `autoPaused`/resume affordance)
- Test: `test/react/AskIris.proactiveControl.test.tsx:6`, `test/react/AskIris.cardState.test.tsx`, `test/react/useExerciseDetailStore.proactiveControl.test.ts`

**Steps:**
- [ ] Store holds `level`; message handler maps `UpdateProactiveControl.level`.
- [ ] Card posts real `setProactiveLevel` for all three levels; no local shim.
- [ ] Remove Resume/paused from VM + render + tests; assert `onLevelChange('less')` posts `setProactiveLevel` with `less`.

### Task A5: Seam level accessor (prerequisite for C + D)

**Files:**
- Modify: `src/extension/telemetry/contract.ts:118` (full-build seam) — add `getProactiveLevel(exerciseId): ProactiveLevel` and/or `getActiveProactiveLevel(): ProactiveLevel`; derive `isStudentProactiveOn` from it.
- Modify: `src/extension/telemetry/contract.ts:21` area (activeExerciseId already exposed via `coordinator.activeExerciseId`, struggleCoordinator.ts:196) — reuse it for the active-level getter.
- Modify: `src/extension/telemetry/index.ts` (wire the getters to `proactivePreference.getLevel`).
- Modify: `src/extension/controller/commands/types.ts:54` capability accordingly.

**Steps:**
- [ ] Add `getActiveProactiveLevel()` = `getProactiveLevel(activeExerciseId)` fallback `'more'`. This is the single source C2/D1 read from.
- [ ] Keep `isStudentProactiveOn(id)` = `getProactiveLevel(id) !== 'off'` (existing gate callers unchanged).

---

## Phase B — Remove hidden dismiss backoff (keep suppression)

### Task B1: Delete the backoff API surface (do NOT repurpose recordOutcome)

**Files:**
- Modify: `src/extension/services/struggleIntervention/struggleInterventionService.ts` — fields 239-241; delete `recordOutcome` (1315), `recordChatDismiss` (1335), `recordProactiveDismiss` + `_onDidDismissProactive`, `isPaused` (1390), `isProactivePaused` (1397), `tryConsumeSoftSkip` (1436). KEEP `dismissEpisode` (1362) — it already persists `DISMISSED` and closes the episode; that is the whole dismiss path now.
- Test: `test/logic/struggleIntervention/decideOutcome.test.ts`, `test/unit/provider/C8-episodeDismiss.test.ts:64`

**Steps:**
- [ ] Delete `_annoyance`, `_dismissStrikes`, `_softSkipBudget` and all three deleted-method bodies.
- [ ] Remove `_deps.pauseStrikes` / `_deps.softThreshold` from `StruggleInterventionDeps` and constructions.
- [ ] Decouple the callers of the deleted methods (seam/chat-provider, see B5); the dismiss flow keeps going through `dismissEpisode` (unchanged).
- [ ] Tests: a dismiss still persists `DISMISSED` and closes the episode; NO rate/level state changes; no pause is ever entered; update C8-episodeDismiss to the new seam (no backoff calls).

### Task B2: BackoffGate — keep `shouldSuppress`, drop dismiss memory

**Files:**
- Modify: `src/extension/services/struggle/alerting/backoffGate.ts:7-39`
- Test: `test/logic/struggle/backoffGate.test.ts`

**Steps:**
- [ ] `BackoffSource`: keep `shouldSuppress`; remove `isPaused()` and `tryConsumeSoftSkip()`.
- [ ] `deliver`: keep the `shouldSuppress` pre-throttle drop (line 29-31); remove the `isPaused` (32-34) and `tryConsumeSoftSkip` (35-37) branches. Gate stays (suppression must remain ABOVE the throttle).
- [ ] Update the orchestrator's `BackoffSource` impl.
- [ ] Tests: suppressed alert dropped pre-throttle (does not burn throttle budget); no pause/soft-skip remains.

### Task B3: Config + deps cleanup

**Files:**
- Modify: `src/extension/services/struggle/config.ts` (drop `softThreshold: 3`, `pauseStrikes: 5` at 117-120 + doc comment)
- Modify: `StruggleInterventionDeps` construction (`telemetry/index.ts`)

**Steps:**
- [ ] Remove the two TUNING keys + their wiring; `check-types` finds every remaining reference.

### Task B4: Debug snapshot + dev panel

**Files:**
- Modify: `src/extension/services/struggleIntervention/struggleInterventionService.ts:352-358`
- Modify: `src/shared/messageContracts/extensionMessages.ts:175-189` (`suppression` type)
- Modify: `src/webview/views/StruggleDetection/SlotPanel.tsx:23` (dev panel consumer)
- Test: snapshot test + `test/logic/messageContracts/slotUpdate.test.ts:10`

**Steps:**
- [ ] Drop `dismissStrikes`, `pauseStrikes`, `hardPaused`, `annoyance`, `softThreshold`, `softSkipBudget` from `suppression` + its type; keep `serverAvailable`, `courseProactiveOff`, `studentProactiveOn`.
- [ ] Update `SlotPanel.tsx` to stop rendering the removed fields.

### Task B5: Seam + provider + activation cleanup

**Files:**
- Modify: `src/extension/telemetry/contract.ts:190` (seam method types), `src/extension/telemetry/noop.ts:13`
- Modify: `src/extension/provider/chatWebviewProvider.ts:109` (+ ~1025 `messageProactiveOutcome` handler)
- Modify: `src/extension.ts:92` and `src/extension.ts:164` (resume + `onDidDismissProactive` backoff subscription)
- Test: `test/unit/provider/C8-episodeDismiss.test.ts:100,119`

**Steps:**
- [ ] Remove ONLY the backoff wiring: the `_onDidDismissProactive` emitter + `onDidDismissProactive` subscription (the strike feeder), plus `resumeProactive`, `recordChatDismiss`/`recordProactiveDismiss` from the seam, noop, provider, and activation.
- [ ] **Keep BOTH `DISMISSED`-persist paths** in `messageProactiveOutcome` (codex: legacy compatibility): when `proactiveEpisodeId` is present → `onEpisodeDismiss(episodeId)` (→ `dismissEpisode`); when absent → the legacy `artemisApi.setProactiveOutcome(sessionId, messageId, 'DISMISSED')` fallback. This is NOT a breaking change — old persisted proactive rows still record dismissals.
- [ ] Tests: update C8 `:119` — the `_onDidDismissProactive` backoff event NO LONGER fires, but the legacy `setProactiveOutcome` persist still happens; C8 `:100` (episode-keyed `onEpisodeDismiss`) stays green.
- [ ] Grep gate (zero hits in src): `resumeProactive`, `autoPaused`, `isProactivePaused`, `isPaused`, `pauseStrikes`, `softThreshold`, `softSkipBudget`, `recordChatDismiss`, `recordProactiveDismiss`, `_onDidDismissProactive`, `setProactiveEnabled`. NOTE: `setProactiveOutcome` (legacy persist) is intentionally KEPT.

---

## Phase C — Per-level throttle

### Task C1: Drop maxAlertsPerMinute (+ all consumers)

**Files:**
- Modify: `src/extension/services/struggle/alerting/throttledAlertSink.ts:27-31,58-61`
- Modify: `src/extension/services/struggle/struggleCoordinator.ts:266-272` (caps struct)
- Modify: `src/extension/telemetry/formatTick.ts:25-30`, `src/extension/telemetry/noopStruggleCoordinator.ts:67-69`
- Modify: `src/shared/messageContracts/extensionMessages.ts:94` (caps type)
- Modify: `src/webview/views/StruggleDetection/useEngineCountdowns.ts:46`, `src/webview/views/StruggleDetection/TimersPanel.tsx:96`
- Test: `test/logic/struggle/throttledAlertSink.test.ts`, `test/unit/services/struggle/struggleCoordinator.test.ts:249`

**Steps:**
- [ ] Remove `maxAlertsPerMinute` from `ThrottleConfig` + the rolling per-minute check (deliver lines 58-61).
- [ ] Remove it from the caps struct, `formatTick`, noop coordinator, the shared caps type, and BOTH dev-panel consumers (useEngineCountdowns, TimersPanel).
- [ ] Tests: session cap + min gap enforced; no per-minute cap remains; update struggleCoordinator dev-view test.

### Task C2: Per-level throttle config, read dynamically

**Files:**
- Modify: `src/extension/services/struggle/config.ts` (add `THROTTLE_BY_LEVEL`)
- Modify: `src/extension/services/struggle/alerting/throttledAlertSink.ts` (constructor takes `getConfig: () => ThrottleConfig`; `deliver` reads it per call)
- Modify: `src/extension/telemetry/index.ts:182` (build with `() => THROTTLE_BY_LEVEL[getActiveProactiveLevel() === 'less' ? 'less' : 'more']`)
- Test: `test/logic/struggle/throttledAlertSink.test.ts:42`

**Interfaces:**
- Produces: `THROTTLE_BY_LEVEL = { less: { maxAlertsPerSession: 3, minDeliveryGapS: 300 }, more: { maxAlertsPerSession: 6, minDeliveryGapS: 150 } }` (ENG).

**Steps:**
- [ ] Add `THROTTLE_BY_LEVEL` (ENG-marked). `Off` never reaches the sink (gated upstream), so only `less`/`more`.
- [ ] `ThrottledAlertSink` reads `this._getConfig()` each `deliver()`; keep existing reset/resetSession budget semantics.
- [ ] Wire the getter from A5's `getActiveProactiveLevel()`.
- [ ] Tests (throttledAlertSink.test.ts): level=`less` enforces 3/300; `more` enforces 6/150; flipping the getter mid-session changes enforcement with budget/history preserved per reset semantics.

---

## Phase D — Client Pull re-route (defence in depth)

### Task D1: In Pull, route an inbound `active` to the ambient/PARKED path

**Files:**
- Modify: `src/extension/services/struggleIntervention/struggleInterventionService.ts:734` (`onServerActive`) — NOT the late `_applyActiveSurface` (~1010).
- Test: `test/logic/struggleIntervention/struggleInterventionService.test.ts:341`

**Steps:**
- [ ] At the top of `onServerActive` (after the existing gates, before building `decision`/`reconcile`), if `getActiveProactiveLevel() === 'less'`, delegate to the ambient handling (same as `onServerAmbient`: `decision.action = 'ambient'`, PARKED path), so Less never creates a DELIVERED episode, bubble, or notification. Must happen before `decision.action` reaches `reconcile`.
- [ ] Test (struggleInterventionService.test.ts): level=`less` + `onServerActive` → PARKED ambient (lamp), NOT DELIVERED/bubble; level=`more` + `onServerActive` → DELIVERED active (full push).

---

## Phase E — Server (Artemis + Pyris) — separate repos, verify targets in-repo

> Artemis (`/Users/liamberger/Documents/private/Artemis`) + Pyris (`/Users/liamberger/Documents/private/edutelligence/iris`),
> outside this working dir; exact file/line targets verified in-repo at implementation time. Phase D already
> enforces Pull client-side, so Phase E can follow A-D.

### Task E1: Client sends the mode (both POST variants)

**Files:**
- Modify: `src/extension/services/struggleIntervention/struggleContract.ts:29` (`StruggleInterventionRequest`)
- Modify: the two POST body sites: decide (~655) and confirm_close (`struggleInterventionService.ts:1239`)

**Steps:**
- [ ] Add `proactivityMode?: 'pull' | 'push'` — **optional** (confirm_close has no action decision; old servers ignore it).
- [ ] At each POST site derive `mode = getActiveProactiveLevel() === 'less' ? 'pull' : 'push'` (Off never POSTs) and include it.
- [ ] Test: decide + confirm_close bodies carry the mode matching the level.

### Task E2: Artemis enforces Pull

- [ ] `IrisStruggleInterventionRequestDTO`: add nullable `proactivityMode` (default `push`).
- [ ] Persist the mode with the job for the terminal callback.
- [ ] `handleDecision`: after the confidence-threshold check, if `mode == PULL` and `action == ACTIVE`, set `action = AMBIENT`; otherwise emit unchanged.
- [ ] Pass the mode into the Pyris pipeline DTO.
- [ ] Java test: pull+active → ambient event; push+active → active.

### Task E3: Pyris tone context

- [ ] `StruggleInterventionPipeline` accepts the mode; add to the prompt (pull = reticent quiet nudge; push = may reach out). Correctness does not depend on the LLM (Artemis enforces the hard rule).
- [ ] Smoke: pipeline runs with mode pull + push.

---

## Rollout order & verification

1. Phase A (A1→A5), then B, C, D. After A-D: `npm run check-types` + eslint clean; `npm run test:react` green; affected mocha via `npm run compile-tests` + `npm run test:unit` green; `node esbuild.js` builds. Client cap alone enforces Pull.
2. Phase E adds server enforcement + tone, verified in the Artemis/Pyris repos and end-to-end on the local stack (Pyris :8000, Artemis :8080) via the recorded round-trip recipe.
3. Grep gate (zero hits in src): see B5 list, plus `maxAlertsPerMinute`.

## Test coverage checklist (codex-required)

- `test/logic/proactivePreferenceService.test.ts:14` — migration (`false`→`off`), invalid persisted value → `more`, default `more`, round-trips.
- `test/logic/struggle/throttledAlertSink.test.ts:42` — dynamic mid-session level switch (3/300 vs 6/150).
- `test/logic/struggleIntervention/struggleInterventionService.test.ts:341` — Less → PARKED ambient, not DELIVERED active.
- `test/react/AskIris.proactiveControl.test.tsx:6` — pause/resume UI removed; slider posts `setProactiveLevel`.
- `test/logic/messageContracts/slotUpdate.test.ts:10` + `test/unit/services/struggle/struggleCoordinator.test.ts:249` — dev-view contract (no maxAlertsPerMinute, no backoff fields).
- `test/unit/provider/C8-episodeDismiss.test.ts:64` — dismiss seam no longer calls backoff, still persists `DISMISSED`.

## Non-goals (spec §13)

No detector/theta change; no per-level confidence-threshold; no lazy generation; no adaptive auto-downgrade on dismiss.
