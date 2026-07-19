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

- Delete the two configuration properties `artemis.struggleDetection.enabled` and `artemis.struggleDetection.showInterventions` (single shared package.json).
- The Open VSX manifest generator DOES reference these keys: `scripts/generate-clean-manifest.js` (`STRUGGLE_SETTINGS` ~line 16, `dropStruggleGroup` deletion loop ~line 45). Remove `STRUGGLE_SETTINGS` and its deletion loop; KEEP the generator's removal of `artemis.showStruggleScore`. Update `test/logic/scripts/generateCleanManifest.test.ts` so neither profile assumes the legacy settings exist.
- Delete the `STRUGGLE_DETECTION` block from `VSCODE_CONFIG` (`extension/src/extension/utils/constants.ts:39-43`).
- Users with a `false` value keep an orphaned entry in their settings.json; no migration. **Accepted compatibility break, deliberately:** both settings shipped on main (marketplace), so an explicit `false` opt-out exists in the wild and its effect disappears. This is mitigated by the consent gate itself: when this branch ships, every existing user starts at consent `ask` — the engine does not run until they explicitly grant the NEW consent prompt, which supersedes the old toggle as a fresher, better-informed choice. Declining keeps them off. The old `showInterventions=false` promise ("data collection continues unchanged") described the study recorder, which is being retired (#336).

### 2. StruggleCoordinator (`extension/src/extension/services/struggle/struggleCoordinator.ts`)

- Remove `_isEnabled`, `_showInterventions`, `_loadConfiguration()`, the `artemis.struggleDetection` config listener, and the `isEnabled()` accessor.
- Alert delivery (`onDidAlert` handler, ~line 105): deliver unconditionally. Delivery is already governed by consent (#349: no engine without it), the per-exercise level, and the throttle — no behavioral hole.
- `onNewResult` (~line 120): drop the `if (!this._isEnabled)` early return; the #349 guard `if (!this._engineRunning)` directly below covers the no-detection case.
- Add `isConsentGranted(): boolean` returning `this._detectionConsent.isGranted()` (for the debug view, section 3).
- `telemetry/contract.ts` (~line 22): the `IStruggleCoordinator` `Pick` replaces `'isEnabled'` with `'isConsentGranted'` (compile-blocking otherwise); typed mocks follow.
- `noopStruggleCoordinator.ts`: mirror the accessor change (drop `isEnabled`, add `isConsentGranted(): boolean` returning `false` — correct regardless of stored consent, since that build has no engine).

### 3. Struggle debug view

- `viewInitDataService.ts` (~line 256): `isEnabled: coordinator?.isEnabled() ?? false` becomes `isEnabled: coordinator?.isConsentGranted() ?? false`. The message-contract field name `isEnabled` stays (no wire change).
- `StruggleDetectionView.tsx` (~line 78): the disabled-state copy changes from a settings hint to a consent hint (the view renders when `isEnabled` is false; the text must say that the code-reading consent is missing, not that a setting is off).
- Importing `proactiveEgressConsent` into `services/ui` directly would violate the bundle boundary (the clean-bundle verifier forbids the whole `services/struggleIntervention/` subtree) — hence the coordinator accessor.
- **Freshness is sample-at-refresh, by design:** the debug view refreshes on init, ticks, and engine start/end. During an active exercise a consent flip triggers engine start/end and therefore a refresh; with NO active exercise a persistent fullscreen struggle panel can show a stale consent state until its next refresh. Accepted for a dev-only tool; consent-change refresh wiring for the debug view is explicitly out of scope.

### 4. Session recorder (desktop-only; full retirement is #336)

- `sessionRecorderWiring.ts`: the config snapshot keeps its shape but records constants `struggleDetectionEnabled: true, showInterventions: true`. Remove the recorder's ENTIRE dedicated configuration listener plus its reader/cache helpers (not an inert listener); the wiring test asserts no configuration listener is registered.
- Recording contract (`recording/types.ts`, `parseRecordedData.ts`) unchanged: old recordings and goldens keep parsing; the low-level recorder/parser tests for old values stay as legacy-schema coverage. Comments on the snapshot fields are updated: they are legacy compatibility fields pinned to `true`, no longer treatment-state measurements.

### 5. Comment and docs sweep

Living text that becomes wrong with the removal is updated in the same change:
- `services/struggle/config.ts` ~line 94 (claims the settings as the user-facing source).
- `struggleInterventionService.ts` ~lines 248, 535 (coordinator-gating comments) and ~1819 (the "settings-toggle" reset description — reword `reset()` as the shared surface-clearing helper invoked by the consent/session teardown paths; it has no standalone production caller anymore, and level-Off does NOT route through it).
- `sessionRecorderWiring.ts` ~line 177 and `recording/types.ts` ~line 130 (control/treatment classification claims).
- ADR `docs/adr/002-theia-openvsx-setting-defaults.md` (~line 28) and `003-theia-openvsx-telemetry-seam.md` (~line 29): mark the affected decisions superseded by #352. Historical docs/superpowers plans stay untouched.
- `recording/types.ts` ~line 145: mark `ConfigurationChangeEvent` as legacy-only (no longer produced).
- `recording/README.md` ~line 104: reword the startup-contributor description.
- `recording-viewer/src/components/recordingInfoData.ts` ~line 94: update the control/treatment and live-setting descriptions (fields are pinned legacy values now).
- `recording-viewer/src/utils/eventDisplay.tsx` ~lines 251, 401: the timeline/tooltip renderer presents the pinned fields as live state (`struggleDetection:on | interventions:on`) — label them as legacy compatibility fields there too.

Intentionally RETAINED references (compatibility, do not remove): `recording/sessionRecorder.ts` ~452 (`recordConfigurationSnapshot`), `test/e2e/recording.e2e.test.ts` ~680, `test/unit/services/recording/sessionRecorder.test.ts` ~924, `recording-viewer/src/generated/recordingTypes.ts` ~131, and the parser acceptance of snapshot + configuration-change events (`parseRecordedData.ts` ~278/~290). `recording/types.ts` ~145 additionally marks `ConfigurationChangeEvent` as legacy-only (no longer produced).

## Out of scope

- #341 (single remembered level), #336 (recorder retirement).
- Any change to the consent prompt, the card states, or the level control.

## Acceptance criteria

1. Neither setting appears in the settings UI (search "struggle" shows no legacy toggle); `package.json` has no `artemis.struggleDetection.*` contribution.
2. No reference to the removed keys or `VSCODE_CONFIG.STRUGGLE_DETECTION` anywhere in `src/`, `package.json`, `scripts/`, or `test/` (recording legacy-schema tests and historical docs excepted).
3. For consented users who never touched the legacy toggles, alert delivery behavior is unchanged (level + throttle still gate); a build result is still ignored while the engine is not running. A pre-existing legacy `false` no longer has any effect (accepted break, see section 1).
4. The struggle debug view shows its inactive hint when the consent is missing at sampling time (init/tick/start/end refreshes), with consent-oriented copy.
5. New recordings carry `struggleDetectionEnabled: true, showInterventions: true`; existing recordings and goldens parse unchanged; the recorder registers no configuration listener.
6. Lint, `check-types`, vitest, mocha green; `npm run package:openvsx` + clean-bundle verifier pass.

## Tests

- Coordinator tests: remove/invert the gate-pinning tests (enabled=false suppressed delivery; showInterventions=false suppressed delivery; config-change reload). Add: delivery happens with no `artemis.struggleDetection` config present; `isConsentGranted()` reflects the consent dep. (The engine-not-running build-result drop is already pinned by an existing test — no duplicate.)
- `viewInitDataService` test: `isEnabled` sourced from `isConsentGranted()`.
- `generateCleanManifest.test.ts`: neither profile assumes the legacy settings; `artemis.showStruggleScore` removal still asserted.
- Recorder wiring test (local-only unit): snapshot records the constants; asserts NO configuration listener registration.
- Debug-view react test: inactive copy mentions consent.
