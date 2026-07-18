# Force the proactive-help level to Off while the code-reading consent is missing (#342)

**Issue:** [#342](https://github.com/ls1intum/artemis-extension/issues/342)
**Branch:** `feat/struggle-v3-integration`
**Date:** 2026-07-18

## Problem

The Off/Less/More proactive-help control in the exercise view is a delivery preference, not a consent. While the code-reading opt-in (`artemis.iris.proactiveCodeEgress`) is `ask` or `disabled`, no intervention can ever be delivered (since #349 the engine does not even start), so a control showing Less or More is misleading. Today the missing consent lands in the `degraded` card state, which hides the segments entirely and shows "Proactive help is unavailable right now." That message is wrong for the consent case: the student could fix it and is not told how.

## Decisions taken during brainstorming

1. **UX for missing consent:** segments stay visible but disabled, Off is the active segment, with a hint text and an "Enable in Settings" link below (no warn-notification flow; deviates deliberately from the issue text).
2. **Link action:** the link sends the existing `openSettings` webview command with the `artemis.iris.proactiveCodeEgress` setting id. No new message type; identical behavior for `ask` and `disabled`.
3. **Split the degraded causes:** missing consent (student-fixable) and 404-latched server (not fixable) get distinct reasons and distinct rendering. The 404 case keeps today's behavior.

## Behavior matrix

| State | Cause | Ask button | Proactive control |
|---|---|---|---|
| `available` | everything on | enabled | segments active |
| `off-course` | course disabled proactive | enabled | segments visible, disabled, course note (unchanged) |
| `degraded` / `consent-missing` **(new)** | egress consent not `enabled` | enabled | segments visible, disabled, Off active, hint + Settings link |
| `degraded` / `limited` | server 404-latched | enabled | segments hidden, "unavailable right now" (unchanged) |
| `unavailable` | `.noai` or Iris off | disabled | section hidden, exercise-view banner (unchanged) |

Precedence with multiple simultaneous causes (total shut-off wins): `unavailable` > `off-course` > `limited` > `consent-missing`. The 404 case deliberately beats the consent case: if the server lacks the feature, a consent hint would promise something that cannot be delivered.

## Design

### 1. Card-state derivation (`services/proactiveCardState.ts`, shared contract)

`ProactiveCardSignals` replaces the single `degraded: boolean` with two independent flags:

- `consentMissing: boolean` (egress consent not `enabled`)
- `serverUnavailable: boolean` (404-latched server)

Derivation order: `noAi` → `unavailable`/`noai`; `irisAvailability === 'disabled'` → `unavailable`/`iris-off`; `courseProactiveEnabled === false` → `off-course`/`course-off`; `serverUnavailable` → `degraded`/`limited`; `consentMissing` → `degraded`/`consent-missing`; else `available`.

`ProactiveCardReason` (shared message contract) gains the value `consent-missing`.

### 2. Host seam and effective level (`telemetry/contract.ts`, `controller/commands/types.ts`, `struggleInterventionService.ts`, `proactiveControlCommands.ts`, `extension.ts`)

- The `proactiveControl` capability replaces `isProactiveDegraded(): boolean` with `getProactiveGateState(): { consentMissing: boolean; serverUnavailable: boolean }`. `StruggleInterventionService` carries it (it already knows both flags separately: `!this._deps.isEgressEnabled()` and `!this._serverAvailable`); `telemetry/index.ts` and `extension.ts` re-wire the seam accordingly. `noop.ts` keeps omitting the capability.
- Bundle boundary: the command module must NOT import from `services/struggleIntervention/`; both flags travel exclusively through the seam. The clean (Open VSX) build is untouched: `_push` still early-returns when `proactiveControl` is absent.
- In `_push`: `effectiveLevel = consentMissing ? 'off' : storedLevel`. The card message carries the effective level. The stored preference (`ProactivePreferenceService`) is never written by the gate; granting consent again therefore restores the remembered value with zero extra code.
- `handleSetLevel` drops the request while `consentMissing` (no `setLevel`, no `setStudentProactive`, no collapse); it still re-pushes so the webview repaints the forced-Off state. This is defense in depth; the UI is disabled anyway.
- No additional delivery-side gate: without consent no engine runs (#349) and every egress path is already silent (#338).

### 3. Webview rendering (`webview/components/AskIris/AskIris.tsx`)

- `reason === 'consent-missing'`: render the segments like `off-course` (visible, disabled), with the host-sent `level: 'off'` active. Below the control, instead of the degraded note: hint text "Proactive help needs your consent to let Iris read your code." plus a link/button "Enable in Settings" that posts `openSettings` with setting id `artemis.iris.proactiveCodeEgress`.
- `reason === 'limited'`: unchanged (segments hidden, "Proactive help is unavailable right now.").
- `showSegments` therefore becomes: `available`, `off-course`, or (`degraded` and reason `consent-missing`).

### 4. Live refresh on consent change

The Settings link only makes sense if the card wakes up when the student returns with the consent granted, and the card must visibly park at Off on revocation. Mechanism mirrors the `.noai` pattern:

- Host: in `extension.ts`, where the `proactiveControl` capability is wired, register an `onDidChangeConfiguration` listener for the egress key (only when the capability is present); on change, send a new `ExtensionMsg.UpdateProactiveConsent` (no payload beyond the type) to the exercise webview via the provider registry.
- Webview: `ExerciseDetailView` handles it exactly like `UpdateNoAiStatus`: read the live exercise from the store and re-post `requestProactiveControl`.
- The clean build registers no listener (capability absent).

## Out of scope

- #341 (single remembered level instead of per-exercise): independent; this design keeps the per-exercise store untouched.
- The issue's original warn-notification flow on clicking Less/More: dropped by decision 1 (segments are disabled, no click arrives).
- Any change to engine start/stop, throttling, or egress paths (covered by #349/#338).

## Acceptance criteria

1. With `proactiveCodeEgress` = `ask` or `disabled` (and Iris otherwise available), the exercise view shows the proactive control with Off active, segments disabled, hint text, and an "Enable in Settings" link that opens the settings UI at the egress key.
2. The stored per-exercise preference is never overwritten by the forced Off: set More, revoke consent (card parks at Off), grant consent, card shows More again.
3. A 404-latched server still shows today's degraded rendering (no segments, "unavailable right now"), even when the consent is also missing.
4. Flipping the egress setting while the exercise view is open repaints the card without a reload (both directions).
5. `setProactiveLevel` messages arriving while consent is missing change nothing (store untouched, no engine call) and repaint the forced-Off card.
6. Lint, `check-types`, vitest, and mocha green.

## Tests

- `test/logic/proactiveCardState.test.ts`: reason matrix incl. precedence (consent vs. 404 vs. both → 404 wins; consent + course-off → course-off wins).
- `test/logic/proactiveControlCommands.test.ts`: effective level Off despite stored `more`; setLevel dropped while consent missing (store and `setStudentProactive` untouched, re-push happens); restore after grant.
- `test/logic/proactivePreferenceService.test.ts`: unchanged (asserts the store is not involved in gating).
- `test/react/AskIris.cardState.test.tsx` / `AskIris.proactiveControl.test.tsx`: disabled segments + hint + `openSettings` post on `consent-missing`; `limited` unchanged.
- Wiring test (logic layer): egress config flip → `UpdateProactiveConsent` message sent; `ExerciseDetailView` store test mirrors the `.noai` re-request path.
