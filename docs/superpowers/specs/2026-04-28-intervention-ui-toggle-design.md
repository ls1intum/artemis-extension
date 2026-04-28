# Intervention UI Toggle — Design

**Date:** 2026-04-28
**Branch:** `feat/intervention-ui-toggle`
**Worktree:** `/Users/liamberger/claudeworktrees/MA-intervention-ui-toggle`

## Goal

Add a user-facing setting that suppresses **all** struggle-detection UI surfaces (status-bar lightbulb, info notifications, warning notifications) while keeping the full telemetry / recording pipeline running unchanged.

Use case: thesis evaluation needs a clean control condition. Sessions where the system observes and records the same trigger / EQ / decision signal as in the treatment condition, but the participant sees no AI-driven prompts.

## Non-Goals

- Changing the behaviour of the existing `artemis.struggleDetection.enabled` setting (which kills the entire pipeline). It stays as-is.
- Adding per-trigger or per-level granularity. One toggle, all-or-nothing.
- Closing already-rendered VS Code modal popups when the toggle is flipped on→off mid-popup. VS Code's `showInformationMessage` / `showWarningMessage` API does not support programmatic dismissal; we accept this edge case.
- Suppressing developer-mode UI (the EQ-score status bar item gated by `artemis.developerMode`). See **Participant Setup Note** below.

## Resolved Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Suppress **all three** intervention UI surfaces (status bar lightbulb + info popup + warning popup). | Cleanest control condition. Developer-mode UI stays separate (see Participant Setup Note). |
| 2 | Telemetry semantics: emit a **new** event `onDidSuppressIntervention` with the original `decision` (preserving `shouldIntervene === true`) and `reason: 'user-disabled'`. The recording layer persists this as `action: 'suppressed'` (a new action), not `'blocked'`. | The existing `recordBlockedDecision` rate-limits to one event per `(triggerType, blockedReason)` per 60 s, which would collapse repeated eligible opportunities into sparse events and bias the control condition relative to treatment. A separate, **un-rate-limited** event path preserves the per-opportunity signal. Reusing `'blocked'` would also conflate user-driven suppression with engine-internal gating (cooldown, warmup, etc.) — keeping them as distinct actions makes evaluation queries unambiguous. |
| 3 | The emitter lives on `TelemetryManager`, not `InterventionService`. | Suppression is a manager-level orchestration decision (caused by config). `InterventionService` should remain UI-only. |
| 4 | When toggle is off, **do not** call `_recordIntervention()`. State (cooldown, sessionInterventionCount, adaptive cadence) does not advance. | Advancing state would re-introduce the phantom-show / session-limit silencing that motivated rejecting the "fire onDidShow as if shown" alternative. The spec must therefore treat suppressed events as **eligible-suppressed opportunities**, not simulated treatment events. |
| 5 | New setting `artemis.struggleDetection.showInterventions`, default `true`. | Sibling of existing `enabled` setting. No breaking change. Description must explicitly state "Disabling does not stop data collection." |
| 6 | Live-toggle on→off with active status-bar item: call `hideHint()` and reset `text` / `tooltip` / `backgroundColor` to defaults. | `hideHint()` currently only hides + resets the command. Adding the field reset prevents stale state if future code re-shows the item. |
| 7 | Gate the toggle in `TelemetryManager._evaluateAndIntervene`. | Keeps `InterventionService` UI-only; matches existing show/block dispatch pattern. |
| 8 | Record toggle state at session start and on every change. | Required provenance for evaluation: without it, sessions with no suppressed events, warmup-only blocks, or mid-session flips cannot be reliably classified later. Implemented via two new recording event types: `configurationSnapshot` (emitted during the existing startup-contributor phase before `startupPhaseComplete`) and `configurationChange` (emitted on `vscode.workspace.onDidChangeConfiguration` for the relevant keys). |
| 9 | Mid-session flips are not blocked. They are recorded with timestamps so analysis can exclude or segment contaminated sessions. | Blocking would be unexpectedly intrusive for normal users. Note also: accept/dismiss events that arrive after a flip can belong to UI shown before the flip — analysis must reconcile by timestamp. |

## Architecture

### Setting

`extension/package.json` `contributes.configuration.properties`:

```jsonc
"artemis.struggleDetection.showInterventions": {
    "type": "boolean",
    "default": true,
    "markdownDescription": "Show help suggestions when struggle is detected (status bar hint and notification popups). When **disabled**, no UI prompts will appear during struggle, but data collection continues unchanged. Use this if you prefer to work without interruptions while still contributing to research data."
}
```

`extension/src/extension/utils/constants.ts` — extend `VSCODE_CONFIG.STRUGGLE_DETECTION`:

```ts
STRUGGLE_DETECTION: {
    SECTION: 'artemis.struggleDetection',
    ENABLED_KEY: 'enabled',
    SHOW_INTERVENTIONS_KEY: 'showInterventions',
}
```

### Type changes

#### `extension/src/extension/services/telemetry/types.ts`

`InterventionBlockedReason` is **not** widened. The `'user-disabled'` reason lives on a different event channel and uses its own type:

```ts
/**
 * Reason a wanted intervention was suppressed without being delivered to the user.
 * Currently only one reason exists; left as a union so future suppression sources
 * (e.g. per-condition study mode) can extend it cleanly.
 */
export type InterventionSuppressionReason = 'user-disabled';

/**
 * Payload of `onDidSuppressIntervention`.
 *
 * `decision` is the original eligible decision with `shouldIntervene === true`.
 * It is NOT mutated to `false` — the recording must retain the per-opportunity
 * eligibility signal for later analysis.
 */
export interface SuppressedInterventionPayload {
    decision: InterventionDecision;
    reason: InterventionSuppressionReason;
}
```

#### `extension/src/extension/services/telemetry/recording/types.ts`

`InterventionEvent` gains the `'suppressed'` action and a `suppressionReason` field:

```ts
export interface InterventionEvent {
    type: 'intervention';
    timestamp: number;
    action: 'shown' | 'accepted' | 'dismissed' | 'blocked' | 'suppressed';
    level: 'subtle' | 'notification' | 'proactive';
    shouldIntervene: boolean;          // true for shown/accepted/dismissed/suppressed; false for blocked
    eq: number;
    confidence: 'sufficient' | 'insufficient';
    triggerType?: 'execution-error' | 'multiline-paste' | 'idle' | 'selection-maintained';
    /** Populated when action='blocked'. */
    blockedReason?: 'cooldown' | 'warmup' | 'session-limit' | 'low-confidence';
    /** Populated when action='suppressed'. */
    suppressionReason?: 'user-disabled';
    /** Populated when action='dismissed'. */
    dismissReason?: 'user-action' | 'hidden' | 'replaced' | 'session-end';
    rawWanted?: boolean;
}
```

Two new recording event types for configuration provenance:

```ts
export interface ConfigurationSnapshotEvent {
    type: 'configurationSnapshot';
    timestamp: number;
    struggleDetectionEnabled: boolean;
    showInterventions: boolean;
}

export interface ConfigurationChangeEvent {
    type: 'configurationChange';
    timestamp: number;
    /** Each property is only present if it changed. */
    changes: {
        struggleDetectionEnabled?: boolean;
        showInterventions?: boolean;
    };
}
```

Both new event types must be added to whatever discriminated-union list / type guard structure the recorder currently uses. (Implementation will check `recording/types.ts` and `sessionRecorder.ts` and update accordingly.)

### Gate logic

`extension/src/extension/services/telemetry/telemetryManager.ts`:

1. New private field `_showInterventions: boolean = true`.
2. New event emitter `_onDidSuppressIntervention: vscode.EventEmitter<SuppressedInterventionPayload>` and public `onDidSuppressIntervention` accessor.
3. `_loadConfiguration()` reads the setting with a runtime type guard:

   ```ts
   const rawShow = struggleConfig.get<unknown>(
       VSCODE_CONFIG.STRUGGLE_DETECTION.SHOW_INTERVENTIONS_KEY,
       true,
   );
   const previous = this._showInterventions;
   this._showInterventions = typeof rawShow === 'boolean' ? rawShow : true;
   if (previous && !this._showInterventions) {
       // Live transition on → off: hide any visible intervention UI.
       this._interventionService.hideHint();
   }
   ```

4. In `_evaluateAndIntervene`, replace the dispatch branch:

   ```ts
   if (decision.shouldIntervene) {
       if (!this._showInterventions) {
           this._onDidSuppressIntervention.fire({
               decision, // unchanged: shouldIntervene === true preserved
               reason: 'user-disabled',
           });
           return;
       }
       switch (decision.level) {
           case 'subtle': /* unchanged */
           case 'notification': /* unchanged */
           case 'proactive': /* unchanged */
       }
   } else if (decision.rawWanted) {
       this._interventionService.recordBlockedDecision(decision);
   }
   ```

5. The existing `vscode.workspace.onDidChangeConfiguration` listener already filters on the whole `artemis.struggleDetection` section (`telemetryManager.ts:151`), so the new key is picked up automatically. **No filter change required.**

### `InterventionService.hideHint()` enhancement

`extension/src/extension/services/telemetry/interventionService.ts`:

`hideHint()` currently emits a dismiss event (when a subtle hint is active), resets the command to `iris.chatView.focus`, and calls `statusBarItem.hide()`. It does **not** reset the status bar item's `text`, `tooltip`, or `backgroundColor`. Extend it to fully reset these fields so a stale label/colour cannot bleed through if future code shows the item again. Existing dismiss-event behaviour is preserved (no behavioural change for callers).

### Recording layer

`extension/src/extension/services/telemetry/recording/sessionRecorder.ts`:
- Add a writer method for `ConfigurationSnapshotEvent` and `ConfigurationChangeEvent`.
- Extend the intervention writer to accept `action='suppressed'` with `suppressionReason` and to keep `shouldIntervene: true`.

`extension/src/extension/activation/sessionRecorderWiring.ts`:
- Subscribe to `telemetryManager.onDidSuppressIntervention` and write a recording event with `action: 'suppressed'`, `suppressionReason: 'user-disabled'`, `shouldIntervene: true`.
- Read the two struggle-detection settings during the startup-contributor phase and emit one `configurationSnapshot` event before `startupPhaseComplete`.
- Subscribe to `vscode.workspace.onDidChangeConfiguration` for the two keys and emit `configurationChange` events on every flip.

## Data Flow With Toggle Off

```
trigger event ──► EQ engine (records as eqSnapshot/eqEngineState)
                                       │
                                       ▼
                          decision engine evaluates
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │                              │                              │
   shouldIntervene=true            shouldIntervene=false          shouldIntervene=false
   showInterventions=false         rawWanted=true                 rawWanted=false
        │                          (engine block)                 (no signal)
        │                              │                              │
        ▼                              ▼                              ▼
 onDidSuppressIntervention      recordBlockedDecision            (no event)
 (un-rate-limited)              (rate-limited 60s per
        │                        triggerType×reason)
        ▼                              │
 recording: action='suppressed'        ▼
 shouldIntervene=true            recording: action='blocked'
 suppressionReason='user-disabled' shouldIntervene=false
                                  blockedReason=…
```

Key invariants:
- `eqSnapshot` and `eqEngineState` events fire **identically** whether the toggle is on or off.
- The EQ engine, trigger emitters, and decision engine are not touched.
- With UI disabled, suppressed events represent **eligible intervention opportunities after decision-engine and filter gates**, but **no UI-delivery state is advanced** because no intervention was actually shown. Cooldown timer, `sessionInterventionCount`, and adaptive cadence remain at their initial values for the session. Evaluation must treat these as `eligible-suppressed`, not `would-have-shown-and-respected-cooldown`.
- Mid-session flips: any accept/dismiss events arriving after a `configurationChange` to off can refer to UI shown before the flip. Analysis must reconcile by timestamp.

## Error Handling

The setting read uses a runtime type guard rather than relying on VS Code's typed `get<T>` fallback (which does not validate the underlying JSON value):

```ts
const raw = struggleConfig.get<unknown>(SHOW_INTERVENTIONS_KEY, true);
this._showInterventions = typeof raw === 'boolean' ? raw : true;
```

If a user has manually corrupted their `settings.json` to put a non-boolean here, we fail open in favour of showing UI. This matches the conservative default for the existing `enabled` flag.

## Test Plan

All new tests live under `extension/test/unit/services/telemetry/`. Approach to driving `TelemetryManager`: use the existing public trigger / `onNewResult` event surface where feasible; otherwise use a controlled private accessor (the existing `telemetryManagerCrossExercise.test.ts` should be inspected during implementation to pick the same pattern). The spec does not assume a pre-existing test pattern that exercises `_evaluateAndIntervene` directly.

### Functional tests

1. **Toggle off → suppression event with original decision preserved.** Drive a trigger that produces `shouldIntervene=true`. Assert `onDidSuppressIntervention` fires once with `reason='user-disabled'` and `decision.shouldIntervene === true` (original eligible decision, unchanged). Assert `onDidShowIntervention` does **not** fire and `onDidBlockIntervention` does **not** fire.
2. **Toggle off → no UI calls at the VS Code API level.** Spy on `vscode.window.showInformationMessage`, `vscode.window.showWarningMessage`, and on the StatusBarItem instance methods (`.show`, `.hide`, the `text` setter if practical). Drive interventions for each level (subtle / notification / proactive). Assert the show methods and `statusBarItem.show()` are never called.
3. **Toggle off → EQ + decision events still fire.** Same setup as (1). Assert `onDidCalculateEQ` fires with the expected source.
4. **Toggle off → no decision-engine state advancement.** After driving N interventions with the toggle off, assert `interventionService.getState()` returns `{ lastInterventionTime: 0, sessionInterventionCount: 0, lastDismissed: false, lastAccepted: false }`.
5. **Toggle off → suppression events are not rate-limited.** Drive multiple eligible interventions of the same trigger type within a 60-second window (using fake timers). Assert one `onDidSuppressIntervention` event fires per eligible decision, not collapsed.
6. **Toggle on (default) → existing behaviour preserved.** Mirror of (1) with `showInterventions=true`. Assert `showSubtleHintEQ` is called and `onDidShowIntervention` fires.
7. **Live-toggle on→off with subtle hint visible.** Render a subtle hint with toggle on; flip toggle off and trigger the config-change handler; assert `hideHint()` is called and emits `dismissReason='hidden'` (verified against the current `hideHint` implementation).
8. **Live-toggle on→off with notification/proactive status-bar set.** Drive a notification or proactive flow so `statusBarItem.text` is `"$(lightbulb) Stuck? Let me help!"` or `"$(warning) Help available!"`; flip toggle off; assert `statusBarItem.hide()` is called and `text`/`backgroundColor` are reset to default values.
9. **Live-toggle off→on.** Flip from off to on; assert no events fire as a side effect of the flip alone. Subsequent triggers follow the normal show path.
10. **Setting type guard.** Stub `getConfiguration().get<unknown>()` to return a non-boolean (e.g. `"true"` string, `null`); assert `_showInterventions` falls back to `true`.

### Recording-layer tests

11. **Suppressed intervention persisted.** Wire a real `sessionRecorder` to a `telemetryManager` with toggle off; drive an eligible intervention; assert the persisted recording entry has `type='intervention'`, `action='suppressed'`, `shouldIntervene=true`, `suppressionReason='user-disabled'`, and the correct `triggerType`/`level`/`eq`.
12. **Configuration snapshot at startup.** Assert the recording contains a `configurationSnapshot` event with both `struggleDetectionEnabled` and `showInterventions` populated, emitted before `startupPhaseComplete`.
13. **Configuration change recorded.** Flip the setting at runtime; assert a `configurationChange` event is appended with `changes.showInterventions: false` and a timestamp.

### Type / manifest tests

14. **Type test (compile-time).** `InterventionSuppressionReason` includes `'user-disabled'`; `InterventionEvent.action` includes `'suppressed'`. Both enforced by typescript when test (1) and (11) type their assertions against the unions.
15. **Package manifest property exists.** If a manifest sanity test exists in the repo (to verify during implementation), assert `artemis.struggleDetection.showInterventions` is registered with `type: 'boolean'`, `default: true`. If no such test exists, skip — VS Code enforces this at extension load time.

## Participant Setup Note

The toggle suppresses **intervention** UI only. The developer-mode EQ-score status bar item is gated independently by `artemis.developerMode` (see `telemetryManager.ts:446`). Participants in the control condition must have `artemis.developerMode = false` (the default), otherwise an EQ score remains visible in the status bar. The participant-setup checklist for the study should explicitly include this.

## Out of Scope For This PR

- Quick-toggle command palette entry (`Iris: Toggle AI Interventions`). Could be a follow-up if user-testing reveals discoverability issues.
- A research-mode preset that bundles this setting with other "control condition" defaults.
- Hiding `artemis.developerMode` UI when this toggle is off. The two settings are intentionally orthogonal.
