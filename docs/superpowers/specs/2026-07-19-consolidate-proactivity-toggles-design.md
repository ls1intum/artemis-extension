# Consolidate the overlapping proactivity toggles (#352)

**Issue:** [#352](https://github.com/ls1intum/artemis-extension/issues/352)
**Branch:** `feat/struggle-v3-integration`
**Date:** 2026-07-19

## Problem

Three settings overlap on one concern. `artemis.struggleDetection.enabled` and `artemis.struggleDetection.showInterventions` are legacy gates from before the consent existed; their descriptions promise exactly what the consent (`artemis.iris.proactiveCodeEgress`, #349) and the Off/Less/More level (#342) govern today. During #342 manual testing the tester intuitively toggled the wrong one. The legacy pair adds no capability the new controls lack.

## Decisions taken during brainstorming

1. Both legacy settings are removed entirely (no deprecation period, no hidden dev knob). The supported "off" is the proactive-help level Off or consent `disabled`.
2. #341 (single remembered level) stays a separate cycle.

## Design

### 1. Settings contributions (`extension/package.json`, `constants.ts`)

- Delete the two configuration properties `artemis.struggleDetection.enabled` and `artemis.struggleDetection.showInterventions` (single shared package.json; the Open VSX packaging script does not transform settings).
- Delete the `STRUGGLE_DETECTION` block from `VSCODE_CONFIG` (`extension/src/extension/utils/constants.ts:39-43`).
- Users with a `false` value keep a harmless orphaned entry in their settings.json; no migration.

### 2. StruggleCoordinator (`extension/src/extension/services/struggle/struggleCoordinator.ts`)

- Remove `_isEnabled`, `_showInterventions`, `_loadConfiguration()`, the `artemis.struggleDetection` config listener, and the `isEnabled()` accessor.
- Alert delivery (`onDidAlert` handler, ~line 105): deliver unconditionally. Delivery is already governed by consent (#349: no engine without it), the per-exercise level, and the throttle — no behavioral hole.
- `onNewResult` (~line 120): drop the `if (!this._isEnabled)` early return; the #349 guard `if (!this._engineRunning)` directly below covers the no-detection case.
- Add `isConsentGranted(): boolean` returning `this._detectionConsent.isGranted()` (for the debug view, section 3).
- `noopStruggleCoordinator.ts`: mirror the accessor change (drop `isEnabled`, add `isConsentGranted(): boolean` returning `false`).

### 3. Struggle debug view

- `viewInitDataService.ts` (~line 256): `isEnabled: coordinator?.isEnabled() ?? false` becomes `isEnabled: coordinator?.isConsentGranted() ?? false`. The message-contract field name `isEnabled` stays (no wire change).
- `StruggleDetectionView.tsx` (~line 78): the disabled-state copy changes from a settings hint to a consent hint (the view renders when `isEnabled` is false; the text must say that the code-reading consent is missing, not that a setting is off).
- Importing `proactiveEgressConsent` into `services/ui` directly would violate the bundle boundary — hence the coordinator accessor.

### 4. Session recorder (desktop-only; full retirement is #336)

- `sessionRecorderWiring.ts`: the config snapshot keeps its shape but records constants `struggleDetectionEnabled: true, showInterventions: true`; the configuration-change listener parts for these two keys are removed.
- Recording contract (`recording/types.ts`, `parseRecordedData.ts`) unchanged: old recordings and goldens keep parsing.

## Out of scope

- #341 (single remembered level), #336 (recorder retirement).
- Any change to the consent prompt, the card states, or the level control.

## Acceptance criteria

1. Neither setting appears in the settings UI (search "struggle" shows no legacy toggle); `package.json` has no `artemis.struggleDetection.*` contribution.
2. No reference to the removed keys or `VSCODE_CONFIG.STRUGGLE_DETECTION` anywhere in `src/`.
3. Alert delivery behavior is unchanged for consented users (level + throttle still gate); a build result is still ignored while the engine is not running.
4. The struggle debug view shows its inactive hint exactly when the consent is missing, with consent-oriented copy.
5. New recordings carry `struggleDetectionEnabled: true, showInterventions: true`; existing recordings and goldens parse unchanged.
6. Lint, `check-types`, vitest, mocha green; `npm run package:openvsx` + clean-bundle verifier pass.

## Tests

- Coordinator tests: remove/invert the gate-pinning tests (enabled=false suppressed delivery; showInterventions=false suppressed delivery; config-change reload). Add: delivery happens with no `artemis.struggleDetection` config present; `onNewResult` still drops results while the engine is not running; `isConsentGranted()` reflects the consent dep.
- `viewInitDataService` test: `isEnabled` sourced from `isConsentGranted()`.
- Recorder wiring test (local-only unit): snapshot records the constants; no listener reaction on the removed keys.
- Debug-view react test: inactive copy mentions consent.
