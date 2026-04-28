# Intervention UI Toggle — Design

**Date:** 2026-04-28
**Branch:** `feat/intervention-ui-toggle`
**Worktree:** `/Users/liamberger/claudeworktrees/MA-intervention-ui-toggle`

## Goal

Add a user-facing setting that suppresses **all** struggle-detection UI surfaces (status-bar lightbulb, info notifications, warning notifications) while keeping the full telemetry / recording pipeline running unchanged.

Use case: thesis evaluation needs a clean control condition — sessions where the system observes and records exactly as in the treatment condition, but the participant sees no AI-driven prompts.

## Non-Goals

- Changing the behaviour of the existing `artemis.struggleDetection.enabled` setting (which kills the entire pipeline). It stays as-is.
- Adding per-trigger or per-level granularity (e.g. "subtle yes, proactive no"). One toggle, all-or-nothing.
- Changing how recording stores intervention events — only the surface that produces them changes.
- Closing already-rendered VS Code modal popups when the toggle is flipped on→off mid-popup. VS Code's `showInformationMessage` / `showWarningMessage` API does not support programmatic dismissal; we accept this edge case.

## Decisions Reached During Brainstorming

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Suppress **all three** UI surfaces (status bar + info popup + warning popup). | Cleanest control condition for evaluation; "AI intervention off" should mean zero visible AI behaviour. |
| 2 | Telemetry semantics: fire `onDidBlockIntervention` with **new** `blockedReason: 'user-disabled'` instead of `onDidShow*`. | Plain "fire show as if shown" was rejected because the absence of corresponding accept/dismiss events would make `sessionInterventionCount` saturate and the session-limit guardrail would silence further events after 3 phantom shows, breaking recording integrity. The blocked-decision pattern already exists for cooldown / warmup / session-limit / low-confidence — `user-disabled` slots into the same union cleanly. |
| 3 | New setting `artemis.struggleDetection.showInterventions`, default `true`. | Sibling of existing `artemis.struggleDetection.enabled`. No breaking change. Description must explicitly state "Disabling does not stop data collection." so it cannot be confused with the existing kill-switch. |
| 4 | Live-toggle: when toggle goes on→off and a status-bar hint is currently visible, hide it via `hideHint()`. Already-rendered modal popups stay until user reacts (VS Code limitation). | Status-bar item is programmatically controllable; modal popups are not. |
| 5 | Gate at **TelemetryManager**, not InterventionService. | Keeps `InterventionService` UI-only with no config dependency. `TelemetryManager._evaluateAndIntervene` already orchestrates the show-vs-block decision; adding one more branch there is the natural spot. |

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

### Type extension

`extension/src/extension/services/telemetry/types.ts` — extend the union and update the JSDoc:

```ts
/**
 * Reason why an intervention was blocked (rawWanted=true but shouldIntervene=false).
 *
 * - 'cooldown'        — InterventionService internal cooldown (notification/proactive only)
 * - 'warmup'          — Exercise hasn't reached the 5-minute warmup yet
 * - 'session-limit'   — Max interventions per session exceeded
 * - 'low-confidence'  — EQ above threshold but confidence gate is 'insufficient'
 * - 'user-disabled'   — User has disabled UI interventions via settings; pipeline continues recording
 */
export type InterventionBlockedReason =
    | 'cooldown'
    | 'warmup'
    | 'session-limit'
    | 'low-confidence'
    | 'user-disabled';
```

### Gate logic

`extension/src/extension/services/telemetry/telemetryManager.ts`:

1. Add a new private field `_showInterventions: boolean = true`.
2. Extend `_loadConfiguration()` to read `STRUGGLE_DETECTION.SHOW_INTERVENTIONS_KEY` (default `true`) and store it on the field.
3. In `_loadConfiguration()`, after the value is updated, if the new value is `false` and the InterventionService currently shows a subtle hint, call `_interventionService.hideHint()`. Reuse the existing pattern from the `!_isEnabled` branch.
4. In `_evaluateAndIntervene`, change the dispatch branch:

```ts
if (decision.shouldIntervene) {
    if (!this._showInterventions) {
        // UI suppressed by user setting. Pipeline keeps observing & recording;
        // record the suppressed decision as a blocked event for later analysis.
        this._interventionService.recordBlockedDecision({
            ...decision,
            blockedReason: 'user-disabled',
            shouldIntervene: false,
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

### Existing config-change wiring

`TelemetryManager` already subscribes to `vscode.workspace.onDidChangeConfiguration` (`telemetryManager.ts:151`) with a filter on `event.affectsConfiguration('artemis.struggleDetection')` — i.e. the whole section, not just the `enabled` key. The new `artemis.struggleDetection.showInterventions` key is therefore picked up automatically. **No filter change required.**

## Data Flow With Toggle Off

```
trigger event ──► EQ engine (records) ──► onDidCalculateEQ fires (records)
                                       └─► decision engine evaluates
                                              │
                                              ├─ shouldIntervene=true:
                                              │      _showInterventions=false?
                                              │           ├─ yes ──► recordBlockedDecision('user-disabled')
                                              │           └─ no  ──► show*EQ() → onDidShow / onDidAccept / onDidDismiss
                                              │
                                              └─ rawWanted=true, shouldIntervene=false:
                                                     recordBlockedDecision(existing reason)
```

Key invariants:
- `onDidCalculateEQ` fires **identically** whether the toggle is on or off.
- The EQ engine, trigger emitters, and decision engine are not touched.
- `recordBlockedDecision` is rate-limited per `(triggerType, blockedReason)` at 60 s by `InterventionService.BLOCK_EVENT_RATE_LIMIT_MS` — meaning the recording sees at most one `user-disabled` block per minute per trigger type. **This is acceptable for evaluation** because the same per-(trigger,reason) rate limit applies to all other blocked reasons; the recording is not biased between toggle-on and toggle-off conditions.

## Error Handling

No new failure modes. The setting read uses `getConfiguration().get<boolean>(key, true)` which never throws. If VS Code returns an unexpected non-boolean (impossible per the schema, but defensive), the default `true` applies — i.e. fail-open in favour of showing UI, which matches the existing pattern for `enabled`.

## Test Plan

All new tests live in `extension/test/unit/services/telemetry/`. Existing files to extend:

- `telemetryManager.test.ts` — new `describe` block: "intervention UI toggle".
- `interventionService.test.ts` — no changes needed (the service is unchanged).

### Test cases (Vitest / Mocha — match the existing harness)

1. **Toggle off → blocked event with `user-disabled` reason.** Configure `showInterventions=false`, drive a trigger that produces `shouldIntervene=true`, assert `onDidBlockIntervention` fires once with `blockedReason='user-disabled'` and `decision.shouldIntervene === false`. Assert `onDidShowIntervention` does **not** fire.
2. **Toggle off → no UI calls.** Spy on `interventionService.showSubtleHintEQ`, `showNotificationEQ`, `showProactiveHelpEQ`. Drive interventions for each level. Assert all three spies have zero calls.
3. **Toggle off → EQ + decision events still fire.** Same setup as (1). Assert `onDidCalculateEQ` fires with the expected source, and the decision-engine output is unchanged from the toggle-on case.
4. **Toggle on (default) → existing behaviour preserved.** Sanity test that the new gate doesn't regress the default path. The simplest form is a mirror of test (1) with `showInterventions=true`, asserting `showSubtleHintEQ` is called.
5. **Live-toggle on→off while subtle hint visible.** Render a subtle hint with toggle on; flip toggle off and trigger config-change handler; assert `hideHint()` is called and a dismiss event with reason `'session-end'` or `'hidden'` fires (whichever path `hideHint` already takes — verify against current implementation, do not change it).
6. **Live-toggle off→on.** Flip from off to on; assert no spurious events fire. Subsequent triggers should follow the normal show path.
7. **Type test (compile-time).** Ensure that `InterventionBlockedReason` includes `'user-disabled'` — covered automatically by typescript when test (1) types the assertion against the union.
8. **Package manifest.** A schema/manifest unit test (if one exists in the repo — to be confirmed during implementation) asserts the new `artemis.struggleDetection.showInterventions` property exists with `type: boolean` and `default: true`. If no such test exists, skip — this is enforced at extension load time by VS Code.

## Out of Scope For This PR

- Adding a quick-toggle command palette entry (`Iris: Toggle AI Interventions`). Could be a follow-up if user testing shows people don't find the setting.
- Telemetry/analytics around how often the toggle is flipped. Not relevant for the evaluation use case.
- A research-mode preset that bundles this with other "control condition" defaults. Out of scope.

## Open Questions

None remaining for this scope. All design questions raised during brainstorming have been resolved (see decisions table).
