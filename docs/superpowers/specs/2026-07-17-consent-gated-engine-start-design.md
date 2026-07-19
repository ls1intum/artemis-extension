# Consent-Gated Struggle Engine Start (Issue #349) — Design

**Branch:** `feat/struggle-v3-integration` · **Issue:** #349 · **Related:** #342 (effective level), #350 (INTERRUPTED outcome)

## 1. Problem

The struggle-detection engine starts unconditionally on exercise open, before any consent. The proactive-egress consent (`artemis.iris.proactiveCodeEgress`: `ask` | `enabled` | `disabled`) is enforced only at egress (`decideOutcome` → `silent` without opt-in). Data flow is safe, but the engine still observes editor events and computes severity locally before the student has opted in. Privacy by design demands: **nothing is observed until the consent is explicitly `enabled`.**

## 2. Product decisions (fixed)

| # | Decision |
|---|----------|
| Q1 | Mid-session **grant**: engine starts at that moment with `sessionStartMs = now` → fresh 8-min warmup (D1). Data-honest: nothing was observed before, so there is no history to resume from. |
| Q2 | Mid-session **revoke** (`enabled` → `disabled`/`ask`): engine stops immediately **without a final drain**, and visible surfaces (lamp, banner, inline cue) are cleared. |
| Q3 | The gate applies in **all three build variants**, including local-recording. No bypass; for recorder/dev work, set the setting to `enabled`. |
| — | "Granted" means exactly `level === 'enabled'`. `ask` (undecided) and `disabled` both mean: engine does not run. |
| — | The pre-existing egress TOCTOU bug (consent checked once, then `await`, then unconditional POST) is fixed in this same effort — it breaks the same consent promise. |

## 3. Architecture: gate inside the `StruggleCoordinator`

There are **three** production call sites of `startExerciseSession` (`exerciseOpeningService.ts:50`, `extension.ts:327`, `extension.ts:348`). Gating at call sites or in the wiring would fragment lifecycle ownership; the coordinator already owns the engine lifecycle, so the gate lives there. (codex-reviewed and approved as the design basis.)

### 3.1 New required dependency

```ts
// StruggleCoordinatorDeps gains a REQUIRED member (fail-closed: not optional):
detectionConsent: {
    isGranted(): boolean;            // true ⇔ proactiveCodeEgress === 'enabled'
    onDidChange: vscode.Event<void>; // fires on any change of the consent setting
};
```

Built in `telemetry/index.ts` (`createStruggleEngine`) from the existing `ProactiveEgressConsent` instance plus a `workspace.onDidChangeConfiguration` listener filtered on `artemis.iris.proactiveCodeEgress` (an `EventEmitter<void>` fired by the listener; both pushed to `context.subscriptions`). Consent semantics stay in `struggleIntervention/`; `services/struggle/` sees only an abstract gate.

Tests and other direct constructions use an explicit always-granted stub (`{ isGranted: () => true, onDidChange: <never-firing event> }`). The golden-replay harness constructs `StruggleEngine` directly and is unaffected. The no-op coordinator (clean build) does not construct the real coordinator; its contract is unchanged.

### 3.2 Split: exercise bookkeeping vs. engine running

New private field `_engineRunning: boolean`. The coordinator keeps **bookkeeping** (`_activeExerciseId`, `_activeExerciseRoot`, throttle session reset, build baselines) on every exercise open regardless of consent — the orchestrator reads `activeExerciseId`/`activeExerciseRoot` lazily for egress keying and server-frame filtering, and the per-exercise throttle budget belongs to the exercise session, not to the engine. The **engine** (and everything that signals "detection is live") runs only while consented.

**`startExerciseSession(exerciseId, root)`**
- Same exercise, engine running → early return (unchanged).
- Same exercise, engine NOT running (consent pending) → update `_activeExerciseRoot` to the newly supplied root, nothing else (a later call can carry a better root; the eventual engine start must use it).
- New exercise → `endExerciseSession()` (see below); set bookkeeping; reset `_maxPassedTestCount = -1`, `_refTestCaseCount = -1`; `alertSink.resetSession()` (unchanged). Then: if `detectionConsent.isGranted()` → start engine (`_sessionStartMs = now`, clear `_lastTick`/`_lastAlert`, `engine.start`, `_engineRunning = true`, fire `onDidStartSession`). Otherwise: stop here — **no engine, no start event.**

**Consent change handler** (subscribed in the constructor, disposed with the coordinator) — idempotent reconciliation:
- Granted, bookkeeping active, engine not running → start engine exactly as above (`_sessionStartMs = now` → fresh warmup, Q1).
- Not granted, engine running → `_engineRunning = false` **first**, then `engine.abort()` (no drain, Q2), then `alertSink.onConsentRevoked?.()` (fallback: `alertSink.reset?.()`), then fire `onDidEndSession`.
- All other combinations → no-op.

**`endExerciseSession()`**
- No bookkeeping → return (unchanged).
- Engine running → `engine.stop()` (normal drain semantics preserved for a real session end), `_engineRunning = false`, fire `onDidEndSession`.
- Engine never ran → clear bookkeeping **without** firing an end event (no unmatched engine-end).

**`onNewResult(result)`** additionally requires `_engineRunning` (top of the method, next to the existing `_isEnabled` check). Without it, build results from the non-consented period would still flow into the hub, mutate `_maxPassedTestCount`/`_refTestCaseCount`, and drive the progress-close latch — i.e. observation without consent (codex blocker 1).

**Snapshots** key on `_engineRunning` instead of `_activeExerciseId !== undefined`:
- `getSnapshot()` returns the inactive shape while the engine is not running.
- `getDebugSnapshot()`: `sessionActive = _engineRunning`; the `decisionTrace` and `testStagnation` guards use `_engineRunning`.
- `_sessionStartMs` is set at actual engine start, not at bookkeeping time.

### 3.3 Engine: public no-drain abort

`StruggleEngine.stop()` drains every due tick before teardown — correct for a normal session end, wrong for revocation (the drain could compute one final tick/alert from observations at the exact revoke moment, codex blocker 2). The private `_teardown()` already implements no-drain teardown; expose it as a public `abort(): void` (teardown without drain; also clears `_session`). `stop()` keeps its drain semantics.

### 3.4 Sink chain: consent-revocation reset

`AlertSink` gains an optional method:

```ts
/** Consent revoked mid-session: clear visible surfaces AND terminate local
 *  episode/slot/in-flight state (no egress). Preserves the per-session
 *  delivery budget — revoking/regranting must not refill the throttle. */
onConsentRevoked?(): void;
```

- `ThrottledAlertSink` and `BackoffGate` forward it to the inner sink (like `reset`).
- `StruggleInterventionService` implements it: clear the visible surfaces (as `reset()` does), additionally free the slot, terminate any live episode locally, and invalidate the in-flight request token. Neither `reset()` (leaves slot/episode — a pre-revocation DELIVERED slot would suppress fresh alerts after a re-grant) nor `resetSession()` (would refill the throttle budget) has the right semantics (codex should-fix 5). No egress happens during this termination; outcome persistence for interruption-like closes is #350's concern and out of scope here.

### 3.5 Egress TOCTOU fix (`StruggleInterventionService`)

Consent is currently checked once up front, then each pipeline `await`s the exercise-scoped file collection and POSTs unconditionally. A revoke during the collection still produces a POST (codex blocker 3). This applies to **all three POST paths** (`decide` in `_handleAlert`, `help_request` in `_sendHelpRequest`, `confirm_close` in `_drainOwed` — the last one additionally lacks any egress check at entry). Fix — invariant: **no POST after revocation.**
- On every POST path: re-validate `isEgressEnabled()` AND the in-flight request token after the awaits, immediately before the POST (nothing egresses between the intermediate awaits — the local log write is not egress — so one guard directly before the POST enforces the invariant). `_drainOwed` additionally gets an `isEgressEnabled` entry gate next to its existing `isIrisEnabled` gate.
- `onConsentRevoked()` invalidates the in-flight token, so a revoke that lands mid-collection aborts the continuation.
- **Inbound frames after revocation surface nothing:** a server reply to a pre-revoke POST (`onServerAmbient`/`onServerActive`) is dropped while `isEgressEnabled()` is false (mirroring the existing student-opt-out guard); `onServerSilent`/`onServerClose` stay ungated (they only finalize state, never open a surface).
- A POST already on the wire cannot be recalled; that residual window is accepted and documented in code.

### 3.6 Consumers of the session events

`onDidStartSession`/`onDidEndSession` now mean "engine started/stopped" (their documented meaning already says "engine started"). Consequences:
- **`StruggleAlertStatusBar`** and the **live engine feed** (`artemisWebviewProvider`) become correct automatically: no "Struggle: armed" status bar and no active live-feed session while nothing is observed.
- **`IrisEnabledCache`**: split the currently-identical handlers — `onSessionEnd` resets state without re-kicking a classify; `onSessionStart` resets and classifies. Its only consumer is the orchestrator's `isIrisEnabled()` (intervention-scoped), so staying `unknown` (fail-closed `false`) while consent is absent is correct. The constructor backstop (classify if an exercise is already active) stays.

### 3.7 Informed-consent copy

Enabling now starts local behavioral detection, not just code egress — both texts must say so (codex should-fix 8):
- **`package.json`** `artemis.iris.proactiveCodeEgress` description + enum descriptions: state that `enabled` turns on local struggle detection (typing/pause analysis during programming exercises) and permits sending code to Iris only when the detector triggers; `disabled` means no local detection at all. Remove the stale claim that a local hint is shown instead when disabled.
- **`promptIfAsk` message**, new wording: "Allow Iris to detect when you might be stuck and proactively offer help? This enables local typing/pause analysis during programming exercises; your code is only sent to Iris when the detector triggers." Buttons unchanged (`Enable` / `Not now` / `Settings`).

Binding requirement for both surfaces: name (a) local behavioral detection and (b) trigger-gated code egress.

## 4. Explicit non-goals

- No change to the proactive-help level (Off/Less/More) semantics — #342 builds on the same consent but gates the *effective level*, separately. This design deliberately keeps "detection consent" (this issue) and "effective level" (#342) independent: detection reads `ProactiveEgressConsent` directly, never derives from the level; #342 must not clear `activeExerciseId/root` or reset the throttle budget.
- No INTERRUPTED-outcome persistence on revoke (that is #350's mechanism; revocation termination here is local-only).
- No change to `artemis.struggleDetection.enabled` semantics (it keeps gating delivery/build-intake as today, now additionally subordinate to the consent gate).
- No consent-state UI beyond the existing prompt/setting.

## 5. Error handling

- The consent read is a synchronous config read; no async failure modes.
- `engine.abort()` during revoke must be exception-safe: `_engineRunning` is flipped **before** the abort so any late event delivery fails closed.
- The config-change listener and the consent EventEmitter are owned by `createStruggleEngine` and disposed via `context.subscriptions`; the coordinator's subscription to `onDidChange` is disposed in `coordinator.dispose()`.
- `alertSink.onConsentRevoked` is optional; the coordinator falls back to `reset?.()` so a minimal sink (tests) still clears surfaces.

## 6. Testing

Unit tests (vitest logic suite for pure parts, mocha unit where VS Code APIs are exercised — follow the existing split):

1. **Coordinator gating:** without consent, `startExerciseSession` attaches no engine subscriptions, produces no ticks, fires no start event; `getSnapshot()` stays inactive; `onNewResult` leaves `_maxPassedTestCount`/`_refTestCaseCount` untouched and does not call `onNewBuildResult`.
2. **Mid-session grant:** engine starts on the consent event with `sessionStartMs = now` (first tick at `t = 0`, warmup active), start event fires exactly once; a same-exercise `startExerciseSession` call during pending consent updates the root used by the eventual start.
3. **Mid-session revoke:** abort without a final drain (no tick/alert fires during revocation), end event fires, `onConsentRevoked` reaches the orchestrator through both decorators; visible surfaces cleared; throttle budget preserved (a revoke→regrant cycle does not refill it).
4. **Baseline asymmetry regression:** builds during a non-consented period never enter the baselines; after revoke→regrant within one exercise session, the consented-period `_maxPassedTestCount` is retained while the engine's own test-stagnation tracker restarts (intentional, per-session vs. per-engine scope).
5. **Session-end without engine:** ending an exercise whose engine never ran fires no end event.
6. **Engine abort:** `abort()` tears down without processing due ticks; `stop()` still drains.
7. **TOCTOU regression:** revoke while `collectFiles` is in flight → no POST, no optimistic bubble.
8. **`IrisEnabledCache`:** end-handler resets without re-kick; start-handler classifies.
9. **Existing suites:** coordinator/provider/status-bar tests get the always-granted stub; assert no other behavior change with consent granted (the default path must be bit-identical to today).

Golden replay is unaffected (drives `StruggleEngine` directly). Full gates before completion: `check-types`, `lint`, `knip`, vitest, mocha unit, and the three packagers with green verifiers.

## 7. Rollout note

For existing users the setting already exists; anyone currently on `ask`/`disabled` will notice that struggle detection (including the dev status bar and live view) no longer runs until they enable it — that is the intended behavior change of #349 and needs no migration.
