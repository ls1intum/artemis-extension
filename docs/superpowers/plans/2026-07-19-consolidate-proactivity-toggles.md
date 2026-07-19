# Consolidate Proactivity Toggles (#352) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the two legacy settings `artemis.struggleDetection.enabled` and `artemis.struggleDetection.showInterventions` end-to-end so consent (`artemis.iris.proactiveCodeEgress`) plus the Off/Less/More level remain the only proactivity controls.

**Architecture:** Order is compile-driven: first the coordinator stops reading the settings and swaps its `isEnabled()` accessor for `isConsentGranted()` (contract `Pick`, noop, debug view follow atomically); then the recorder wiring stops reading the config (snapshot pinned to constants, listener deleted); only then can the settings contributions and the `VSCODE_CONFIG.STRUGGLE_DETECTION` constants block be deleted along with the clean-manifest generator references; finally a comment/docs sweep and full gates.

**Tech Stack:** TypeScript, VS Code extension host, vitest (`test/logic`, `test/react`), mocha via vscode-test (`test/unit`), esbuild dual bundle, separate `recording-viewer` React app (own vitest/eslint).

**Spec:** `docs/superpowers/specs/2026-07-19-consolidate-proactivity-toggles-design.md` (codex-approved twice; amendments folded in).

## Global Constraints

- Accepted compatibility break: a pre-existing legacy `false` loses its effect (rationale in the spec: consent `ask` gates everyone on ship). Do NOT add migration code.
- Recording contract stays parse-compatible: `ConfigurationSnapshotEvent` keeps both boolean fields (now pinned `true`), `ConfigurationChangeEvent` stays parseable (legacy-only, no longer produced). Old recordings and goldens must keep parsing.
- The debug view's `isEnabled` message-contract FIELD NAME stays (no wire change); only its source and the disabled-state copy change.
- Keep the clean-manifest generator's removal of the `artemis.showStruggleScore` command.
- After Task 3 there must be no reference to `artemis.struggleDetection` or `VSCODE_CONFIG.STRUGGLE_DETECTION` in `src/`, `package.json`, or `scripts/`; in `test/` only recording legacy-schema coverage may keep the literal event fields (not the setting keys).
- Commit messages: conventional style, NO AI/Claude attribution, no Co-Authored-By trailers.
- Stage only the files the task touched (never `git add -A`).
- All extension commands run from `extension/`; recording-viewer commands from `recording-viewer/`.
- `test/unit` (mocha) runs stale `out/`: always `npm run compile-tests` before `npm run test:unit`.

---

### Task 1: Coordinator seam — drop the gates, add `isConsentGranted`

**Files:**
- Modify: `extension/src/extension/services/struggle/struggleCoordinator.ts` (~78-79, ~103-116, ~119-124, ~347, ~359-370)
- Modify: `extension/src/extension/telemetry/contract.ts:28` (`Pick` member)
- Modify: `extension/src/extension/telemetry/noopStruggleCoordinator.ts:41`
- Modify: `extension/src/extension/services/ui/viewInitDataService.ts:256`
- Modify: `extension/src/webview/views/StruggleDetection/StruggleDetectionView.tsx` (~94-103, disabled copy)
- Test: `extension/test/unit/services/struggle/struggleCoordinator.test.ts`, `extension/test/unit/services/viewInitDataService.test.ts`, `extension/test/react/views/StruggleDetection/StruggleDetectionView.test.tsx`

**Interfaces:**
- Consumes: existing `this._detectionConsent.isGranted()` (dep since #349), `this._engineRunning`.
- Produces: `isConsentGranted(): boolean` on `StruggleCoordinator`, in the `IStruggleCoordinator` `Pick`, and on `NoopStruggleCoordinator` (returns `false`). Tasks 2-3 do not depend on this; Task 5 verifies.

- [ ] **Step 1: Update the coordinator unit tests (failing first)**

In `extension/test/unit/services/struggle/struggleCoordinator.test.ts`:

DELETE the whole test `'struggleDetection.enabled=false suppresses intervention delivery (engine still ticks)'` (~line 226, the sinon config-stub block) and DELETE the whole test `'turning showInterventions off mid-session clears the UI (reset) WITHOUT resetting the throttle budget (resetSession)'` (~line 387). After both deletions the file's `sinon` import (~line 3) is unused — REMOVE it (lint fails otherwise; verify with a grep for `sinon.` that no other use remains).

The existing test at ~line 185 already proves ungated delivery (granted coordinator, no config stub, `advanceTo(+520_000)`, STATE alert) — do NOT duplicate it; RENAME it to `'delivery is ungated by configuration: an idle STATE alert reaches the sink (#352)'` and keep its body.

ADD in the same suite:

```ts
    test('isConsentGranted reflects the consent dep', () => {
        const granted = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: { deliver: () => { /* noop */ } },
            exerciseRegistry: undefined,
            detectionConsent: grantedConsent(),
        });
        const denied = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: { deliver: () => { /* noop */ } },
            exerciseRegistry: undefined,
            detectionConsent: { isGranted: () => false, onDidChange: () => new vscode.Disposable(() => { /* noop */ }) },
        });
        try {
            assert.strictEqual(granted.isConsentGranted(), true);
            assert.strictEqual(denied.isConsentGranted(), false);
        } finally {
            granted.dispose();
            denied.dispose();
        }
    });
```

(Adapt the `detectionConsent` denied-stub shape to whatever `grantedConsent()` returns in this file — mirror its structure with `isGranted: () => false`.)

In `extension/test/unit/services/viewInitDataService.test.ts`: the `buildService` helper currently hardcodes the coordinator constructor argument to `undefined` (~line 22) and the suite only covers the no-coordinator default. Extend the helper with an optional coordinator parameter (`buildService(opts, coordinator?: unknown)` passing `coordinator as never` into the ctor slot that is `undefined` today) and ADD to the `ViewInitDataService.buildStruggleDetectionInit` suite:

```ts
    test('isEnabled is sourced from the coordinator consent state (#352)', () => {
        const coordinator = {
            isConsentGranted: () => true,
            getSnapshot: () => ({}),
            getDebugSnapshot: () => undefined,
        };
        const { service } = buildService({ courses: [] }, coordinator);
        const msg = service.buildStruggleDetectionInit() as Record<string, unknown>;
        assert.strictEqual(msg.isEnabled, true, 'granted consent surfaces as isEnabled');
    });
```

(Trim the stub to whatever members `buildStruggleDetectionInit` actually calls outside developer mode — the load-bearing assertion is that `isConsentGranted: () => true` yields `isEnabled: true` while the existing no-coordinator test keeps pinning `false`.)

ADD a react test in `extension/test/react/views/StruggleDetection/StruggleDetectionView.test.tsx` (fixtures currently only use `isEnabled: true`): render the view with `isEnabled: false` in the init data (mirror the file's existing render/dispatch helpers) and assert the new inactive copy:

```tsx
    expect(screen.getByText(/needs your consent/i)).toBeInTheDocument();
    expect(screen.getByText(/proactive code egress/i)).toBeInTheDocument();
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd extension && npm run compile-tests && npm run test:unit 2>&1 | tee /tmp/352-task1-red.txt | tail -8`
Expected: compile error (`isConsentGranted` does not exist) — a valid red state. On failure detail read the tee file.

- [ ] **Step 3: Implement the coordinator change**

`struggleCoordinator.ts`:

1. Delete the fields (~78-79):

```ts
    private _isEnabled = true;
    private _showInterventions = true;
```

2. The alert wiring (~98-108): delete the stale gating sentences from the comment and un-gate delivery. Replace:

```ts
        // Engine alert → sink (UI gated) + snapshot bookkeeping.
        // The alert is ALWAYS recorded via the engine's onDidAlert (the recorder
        // wiring subscribes the engine directly); only UI delivery is gated.
        // Delivery requires BOTH struggle detection enabled AND interventions
        // shown: disabling detection (enabled=false) must suppress interventions.
        this._disposables.push(this._engine.onDidAlert(alert => {
            this._lastAlert = alert;
            if (this._isEnabled && this._showInterventions) {
                this._alertSink.deliver(alert);
            }
        }));
```

with:

```ts
        // Engine alert → sink + snapshot bookkeeping. Delivery is ungated here (#352):
        // consent gates the engine itself (#349), and the per-exercise level plus the
        // throttle gate the surfaces downstream.
        this._disposables.push(this._engine.onDidAlert(alert => {
            this._lastAlert = alert;
            this._alertSink.deliver(alert);
        }));
```

3. Remove the config load + listener (~111-114): delete `this._loadConfiguration();` and the `onDidChangeConfiguration` block for `'artemis.struggleDetection'` (keep the `_detectionConsent.onDidChange` line that follows).

4. `onNewResult` (~119-120): delete the line `if (!this._isEnabled) { return; }` (the `#349` `_engineRunning` guard below it stays).

5. Replace the accessor (~347):

```ts
    isEnabled(): boolean { return this._isEnabled; }
```

with:

```ts
    /** Consent state for the debug view (#352): sampled at init/tick/start/end refreshes. */
    isConsentGranted(): boolean { return this._detectionConsent.isGranted(); }
```

6. Delete the whole `_loadConfiguration()` method (~359-370).

`telemetry/contract.ts` (~28): in the `IStruggleCoordinator` `Pick`, replace `| 'isEnabled'` with `| 'isConsentGranted'`.

`noopStruggleCoordinator.ts` (~41): replace `public isEnabled(): boolean { return false; }` with:

```ts
    // False regardless of stored consent: this build has no engine to grant anything to.
    public isConsentGranted(): boolean { return false; }
```

`viewInitDataService.ts` (~256): `isEnabled: coordinator?.isEnabled() ?? false,` becomes `isEnabled: coordinator?.isConsentGranted() ?? false,` (field name unchanged).

`StruggleDetectionView.tsx` (~94-103): replace the disabled-state copy. Title `Struggle Detection Disabled` becomes `Struggle Detection Inactive`, and the body paragraph

```
This feature is currently disabled in your settings. Enable it under
"Artemis: Struggle Detection" to start monitoring your development patterns.
```

becomes:

```
Struggle detection needs your consent to run. Grant it via the setting
"Artemis › Iris: Proactive Code Egress" to start local typing/pause analysis.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd extension && npm run compile-tests && npm run test:unit 2>&1 | tee /tmp/352-task1-green.txt | tail -8`
Expected: PASS (if the console summary is swallowed by the known socket-path quirk, verify via `reports/mocha-results.xml`). Also run `npx vitest run test/react/views/StruggleDetection` — the react tests use `isEnabled: true` fixtures and must stay green. Delete the tee files afterwards.

- [ ] **Step 5: Type-check and lint**

Run: `cd extension && npm run check-types && npm run lint`
Expected: clean (this proves no other `coordinator.isEnabled()` caller survived — the `Pick` derivation makes drift a compile error).

- [ ] **Step 6: Commit**

```bash
cd extension
git add src/extension/services/struggle/struggleCoordinator.ts src/extension/telemetry/contract.ts src/extension/telemetry/noopStruggleCoordinator.ts src/extension/services/ui/viewInitDataService.ts src/webview/views/StruggleDetection/StruggleDetectionView.tsx test/unit/services/struggle/struggleCoordinator.test.ts test/unit/services/viewInitDataService.test.ts test/react/views/StruggleDetection/StruggleDetectionView.test.tsx
git commit -m "refactor(struggle): drop the legacy settings gates from the coordinator, expose isConsentGranted (#352)"
```

---

### Task 2: Recorder wiring — pin the snapshot, delete the config listener

**Files:**
- Modify: `extension/src/extension/activation/sessionRecorderWiring.ts` (~177-234)
- Modify: `extension/src/extension/services/recording/types.ts` (~130-150 comments)
- Modify: `extension/src/extension/services/recording/README.md` (~104)
- Regenerate: `recording-viewer/src/generated/recordingTypes.ts` (via `npm run sync-types` in `recording-viewer/`)
- Test: `extension/test/unit/activation/sessionRecorderWiring.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: after this task, NO `src/` file reads `VSCODE_CONFIG.STRUGGLE_DETECTION` (precondition for Task 3's constant deletion).

- [ ] **Step 1: Update the wiring tests (failing first)**

In `extension/test/unit/activation/sessionRecorderWiring.test.ts`: the harness state fields `enabled` / `showInterventions` (~50-95) and every `makeWiringHarness(sandbox, { enabled: ..., showInterventions: ..., ... })` call lose those two options (the config stub branches for `'artemis.struggleDetection'` at ~89-93 are deleted). Replace the configuration-snapshot assertions (~371-381) with the pinned expectation, and replace any test that drives a struggle-config change event with a no-listener assertion:

```ts
    test('configuration snapshot records the pinned legacy values', async () => {
        const harness = await makeWiringHarness(sandbox, { developerMode: false });
        const snap = harness.startupEvents.find(e => e.type === 'configurationSnapshot') as ConfigurationSnapshotEvent | undefined;
        assert.ok(snap, 'snapshot recorded');
        assert.strictEqual(snap.struggleDetectionEnabled, true);
        assert.strictEqual(snap.showInterventions, true);
        assert.strictEqual(snap.engineVersion, 'v3');
    });

    test('registers no configuration listener (legacy settings removed, #352)', async () => {
        const before = onDidChangeConfigurationRegistrations();   // however the harness counts them
        await makeWiringHarness(sandbox, { developerMode: false });
        assert.strictEqual(onDidChangeConfigurationRegistrations() - before, 0, 'wiring must not watch configuration anymore');
    });
```

Adapt mechanically to the file's actual harness helpers: the load-bearing assertions are (a) snapshot pinned `true`/`true` with `engineVersion: 'v3'`, and (b) the wiring registers zero `vscode.workspace.onDidChangeConfiguration` listeners (count via a sinon stub/spy on `onDidChangeConfiguration` if no helper exists). Delete tests that asserted `recordConfigurationChange` reactions to setting flips.

- [ ] **Step 2: Run to verify failure**

Run: `cd extension && npm run compile-tests && npm run test:unit 2>&1 | tee /tmp/352-task2-red.txt | tail -8`
Expected: the new/changed wiring tests FAIL (snapshot still reads config; listener still registered).

- [ ] **Step 3: Implement**

`sessionRecorderWiring.ts`:

Replace the snapshot contributor (~177-191) with:

```ts
    // Configuration snapshot — legacy compatibility fields (#352): the settings were
    // removed, so both values are pinned true; kept only so old and new recordings
    // share one schema. engineVersion remains meaningful.
    disposables.push(sessionRecorder.registerStartupContributor((ctx): RecordedEvent[] => {
        return [{
            type: 'configurationSnapshot',
            timestamp: ctx.timestamp,
            struggleDetectionEnabled: true,
            showInterventions: true,
            engineVersion: 'v3',
        }];
    }));
```

Delete ENTIRELY (~202-234): the `readStruggleEnabled` / `readShowInterventions` helpers, the `lastStruggleEnabled` / `lastShowInterventions` state, and the `vscode.workspace.onDidChangeConfiguration(...)` block that calls `recordConfigurationChange`. If `VSCODE_CONFIG` is now unused in this file, remove it from the import.

`recording/types.ts`: reword the `ConfigurationSnapshotEvent` doc comment (~130-133) to state the fields are legacy compatibility fields pinned to `true` since #352 (no longer control/treatment measurements), and mark `ConfigurationChangeEvent` (~145) as legacy-only: parsed for old recordings, no longer produced.

`recording/README.md` (~104-107): the startup-contributor bullet no longer says "struggle-detection configuration"; reword to "the pinned legacy configuration snapshot".

The viewer's `recording-viewer/src/generated/recordingTypes.ts` is an auto-generated verbatim copy of `recording/types.ts` — after editing the source comments, regenerate it (from the repo root): `cd recording-viewer && npm run sync-types`, and include the regenerated file in the commit.

- [ ] **Step 4: Run to verify green**

Run: `cd extension && npm run compile-tests && npm run test:unit 2>&1 | tee /tmp/352-task2-green.txt | tail -8`
Expected: PASS (JUnit XML on console-swallow). Delete tee files.

- [ ] **Step 5: Type-check and lint**

Run: `cd extension && npm run check-types && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/liamberger/Documents/private/MA/artemis-extension
git add extension/src/extension/activation/sessionRecorderWiring.ts extension/src/extension/services/recording/types.ts extension/src/extension/services/recording/README.md extension/test/unit/activation/sessionRecorderWiring.test.ts recording-viewer/src/generated/recordingTypes.ts
git commit -m "refactor(recording): pin the legacy config snapshot, drop the settings listener (#352)"
```

---

### Task 3: Delete the settings — package.json, constants, manifest generator

**Files:**
- Modify: `extension/package.json` (~228-237, the two properties)
- Modify: `extension/src/extension/utils/constants.ts:39-43`
- Modify: `extension/scripts/generate-clean-manifest.js` (~16-23, ~45-51)
- Test: `extension/test/logic/scripts/generateCleanManifest.test.ts`

**Interfaces:**
- Consumes: Tasks 1-2 (no `src/` reader of the settings or constants remains).
- Produces: the settings cease to exist in every manifest variant.

This is a pure-removal task: there is no meaningful failing-first state (deleting already-absent keys is a no-op in the generator), so the sequence is implement → tests → grep gate.

- [ ] **Step 1: Update the generator tests**

In `extension/test/logic/scripts/generateCleanManifest.test.ts`:
- `baseManifest()`: delete the two `'artemis.struggleDetection.*'` property lines.
- Desktop test `'drops the recorder group but keeps struggle'`: rename to `'drops the recorder group, keeps the struggle-score command'` and delete the assertion on `properties['artemis.struggleDetection.enabled'].default` (the commands assertion incl. `artemis.showStruggleScore` stays).
- Openvsx test `'removes the struggle settings ENTIRELY (no absent feature advertised)'`: delete the whole test (the settings no longer exist anywhere).
- Openvsx test `'removes consent + recording + struggle-score commands'`: unchanged (still asserts `['artemis.login']`).
- REAL-manifest tests (~line 124): the desktop test keeps its command assertions; in the openvsx real-manifest test (~line 140) DELETE the now-vacuous line `expect(m.contributes.configuration.properties['artemis.struggleDetection.enabled']).toBeUndefined();` (the key no longer exists in the source manifest, so the assertion asserts nothing).

- [ ] **Step 2: Implement**

`extension/package.json`: delete the two property blocks `"artemis.struggleDetection.enabled": { ... }` and `"artemis.struggleDetection.showInterventions": { ... }` (~228-237).

`generate-clean-manifest.js`: delete the `STRUGGLE_SETTINGS` const (~16-23) and shrink `dropStruggleGroup` (~45-51) to:

```js
function dropStruggleGroup(m) {
    // The legacy struggle settings were removed from the source manifest (#352);
    // only the struggle-score command remains to drop for the clean build.
    dropCommandsAndMenuRefs(m, STRUGGLE_COMMANDS);
}
```

Also update the file-header comment (~3-4): the openvsx profile drops "recorder + struggle command groups" (no longer settings).

`constants.ts` (~39-43): delete the `STRUGGLE_DETECTION` block from `VSCODE_CONFIG`.

- [ ] **Step 3: Run the generator tests + grep gate**

Run: `cd extension && npx vitest run test/logic/scripts/generateCleanManifest.test.ts`
Expected: PASS.
Run: `rg -n 'artemis\.struggleDetection|VSCODE_CONFIG\.STRUGGLE_DETECTION' src scripts package.json test`
Expected: ZERO hits. (This exact pattern matches only the setting section/keys and the constants block — the recording schema FIELD names like `struggleDetectionEnabled` and the debug-view VIEW id `struggleDetection` do not match it and are intentionally retained.)

- [ ] **Step 4: Type-check, lint, clean bundle**

Run: `cd extension && npm run check-types && npm run lint`
Run: `cd extension && npm run package:openvsx 2>&1 | tee /tmp/352-task3-openvsx.txt | tail -6`
Expected: all clean; the generated clean manifest builds without the settings and the clean-bundle verifier passes. Delete the tee file.

- [ ] **Step 5: Commit**

```bash
cd extension
git add package.json src/extension/utils/constants.ts scripts/generate-clean-manifest.js test/logic/scripts/generateCleanManifest.test.ts
git commit -m "feat(struggle): remove the legacy struggleDetection settings (#352)"
```

---

### Task 4: Comment and docs sweep (extension + ADRs + recording-viewer)

**Files:**
- Modify: `extension/src/extension/services/struggle/config.ts` (~94)
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` (~248-251, ~535, ~1819-1822)
- Modify: `extension/src/extension/services/struggle/alerting/alertSink.ts` (~9-11), `extension/src/extension/services/struggle/alerting/throttledAlertSink.ts` (~15-19)
- Modify: `extension/test/logic/struggleIntervention/struggleInterventionService.test.ts` (~283, ~295: names/comments only)
- Modify: `extension/docs/adr/002-theia-openvsx-setting-defaults.md`, `extension/docs/adr/003-theia-openvsx-telemetry-seam.md`
- Modify: `recording-viewer/src/components/recordingInfoData.ts` (~94-95), `recording-viewer/src/utils/eventDisplay.tsx` (~251-256, ~401-402)

**Interfaces:** none (text only; no behavior change).

- [ ] **Step 1: Extension comments**

`config.ts` (~94): in the Tier-3 doc comment, replace the sentence `The user-facing on/off (\`enabled\`/\`showInterventions\`) lives in VS Code settings, not here.` with `The user-facing controls are the proactive-egress consent and the Off/Less/More level (#352), not knobs here.`

`struggleInterventionService.ts`:
- ~248-251 (class doc): replace `Implements {@link AlertSink}, so the coordinator's \`enabled\`/\`showInterventions\` gating AND its \`reset()\` on session change stay authoritative (we do NOT subscribe the raw, ungated engine event).` with `Implements {@link AlertSink}; alerts arrive via the coordinator's sink chain (BackoffGate -> ThrottledAlertSink -> this, see telemetry/index.ts) with no settings gate since #352 — consent gates the engine, level/gates/throttle gate the surfaces — and the \`reset()\`/\`resetSession()\` teardown calls stay authoritative.`
- ~535 (deliver doc): replace `/** AlertSink.deliver -- the coordinator calls this ONLY when \`enabled && showInterventions\`. */` with `/** AlertSink.deliver -- reached for every engine alert that passed the BackoffGate + throttle chain (#352: no settings gate). */`
- ~1821 (inside the reset doc, kept sentence): `a config-off->on toggle mid-session must not silently lift a latch` becomes `a mid-session surface clear must not silently lift a latch`.
- ~1819-1822 (reset doc): replace the first sentence `AlertSink.reset -- the coordinator's settings-toggle / context-clear path.` with `AlertSink.reset -- shared surface-clearing helper invoked by the consent/session teardown paths (no standalone production caller since #352; level-Off clears surfaces via its own path).` Keep the rest (latches/cap sentence).

`alerting/alertSink.ts` (~9-11): the `reset?()` doc `Clear any visible intervention (e.g. interventions disabled mid-session). Does NOT reset per-session delivery budgets — a config toggle must not refill the throttle.` becomes `Clear any visible intervention (consent/session teardown, #352). Does NOT reset per-session delivery budgets — clearing surfaces must not refill the throttle.`

`alerting/throttledAlertSink.ts` (~15-19 AND ~24-26): in the class doc, replace `this mirrors reset()'s existing "config-off must not refill the budget" guarantee` with `this mirrors reset()'s existing "clearing surfaces must not refill the budget" guarantee`, and in the paragraph below replace `reset() clears the inner UI but KEEPS the budget (a config-off toggle must not refill the per-session cap)` with `reset() clears the inner UI but KEEPS the budget (a surface clear must not refill the per-session cap)`.

`alerting/alertSink.ts` NOTE: the `reset?()` doc replacement in the earlier bullet already covers its `(e.g. interventions disabled mid-session)` phrase.

`test/logic/struggleIntervention/struggleInterventionService.test.ts` (~283, ~295, ~495): reword the test names/comments that describe `reset()` as a config-off/settings-toggle path to the teardown semantics (e.g. `'reset() clears surfaces but keeps the per-session latches (a surface clear must not lift a latch)'`; the ~495 inline comment `settings-toggle does NOT free the slot` becomes `reset() (surface clear) does NOT free the slot`) — assertions stay unchanged.

- [ ] **Step 2: ADRs**

`002-theia-openvsx-setting-defaults.md`: directly under the `### Override list` heading (or the table), add: `> Superseded in part by #352 (2026-07-19): the \`artemis.struggleDetection.*\` settings were removed entirely; the row below is historical.` Do not delete the historical row.
`003-theia-openvsx-telemetry-seam.md` (~29): after the sentence about runtime user preference, add: `(Superseded by #352: the \`artemis.struggleDetection.*\` settings were removed; the runtime preference is now the proactive-egress consent plus the Off/Less/More level.)` ALSO scan the rest of ADR 003 (consequences section ~line 40) for sentences that say the settings remain in the clean manifest or should be reconsidered — mark each with the same `(Superseded by #352: ...)` annotation rather than deleting the historical text.

- [ ] **Step 3: recording-viewer**

`recordingInfoData.ts` (~94-95): change the two descriptions to: ConfigurationSnapshot → `'Provenance: legacy settings snapshot; since #352 both flags are pinned true (settings removed), older recordings carry real values'`; ConfigurationChange → `'Provenance (legacy recordings only): a struggle-detection setting flipped mid-session; not produced since #352'`.
`eventDisplay.tsx` (~251-256 and ~401-402): change the rendered text in BOTH places from `struggleDetection:{...} | interventions:{...}` to `struggleDetection:{...} | interventions:{...} (legacy fields)` — i.e. append the literal ` (legacy fields)` suffix to the snapshot rendering (keep the `configurationChange` rendering unchanged: it only ever appears in legacy recordings).

- [ ] **Step 4: Verify**

All paths repo-root-relative (fresh agents start at the repository root `/Users/liamberger/Documents/private/MA/artemis-extension`):

Run: `cd extension && npm run check-types && npm run lint && npx vitest run test/logic/struggleIntervention/struggleInterventionService.test.ts 2>&1 | tail -3`
Run (from the repo root): `cd recording-viewer && npm run lint && npm run test 2>&1 | tail -3`
Expected: all clean/green (viewer tests do not pin the changed strings; if one does, update it to the new text).

- [ ] **Step 5: Commit**

```bash
cd /Users/liamberger/Documents/private/MA/artemis-extension
git add extension/src/extension/services/struggle/config.ts extension/src/extension/services/struggleIntervention/struggleInterventionService.ts extension/src/extension/services/struggle/alerting/alertSink.ts extension/src/extension/services/struggle/alerting/throttledAlertSink.ts extension/test/logic/struggleIntervention/struggleInterventionService.test.ts extension/docs/adr/002-theia-openvsx-setting-defaults.md extension/docs/adr/003-theia-openvsx-telemetry-seam.md recording-viewer/src/components/recordingInfoData.ts recording-viewer/src/utils/eventDisplay.tsx
git commit -m "docs(struggle): sweep stale settings references after the toggle removal (#352)"
```

---

### Task 5: Full verification gates

**Files:** none (verification only; fix regressions with `fix(struggle): ...` commits and re-run all gates).

- [ ] **Step 1: Full vitest**

Run: `cd extension && npm run test:react 2>&1 | tee /tmp/352-vitest.txt | tail -5`
Expected: all files pass. On failure read the tee file.

- [ ] **Step 2: Full mocha**

Run: `cd extension && npm run compile-tests && npm run test:unit 2>&1 | tee /tmp/352-mocha.txt | tail -5`
Expected: all pass (verify via `reports/mocha-results.xml` if the console summary is swallowed). A failure must be re-run in isolation before being called a machine-load flake; anything touching struggle/recording/settings is a real regression.

- [ ] **Step 3: Golden replay**

Run: `cd extension && npm run test:golden-replay 2>&1 | tee /tmp/352-golden.txt | tail -5`
Expected: PASS (proves recordings parse-compatibility end-to-end).

- [ ] **Step 4: Types + lint (extension), viewer suite**

Run: `cd extension && npm run check-types && npm run lint`
Run (from the repo root `/Users/liamberger/Documents/private/MA/artemis-extension`): `cd recording-viewer && npm run lint && npm run test 2>&1 | tail -3 && npm run build 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 5: Clean-bundle gate**

Run (from the repo root): `cd extension && npm run package:openvsx 2>&1 | tee /tmp/352-openvsx.txt | tail -5`
Expected: build + clean-bundle verifier green.

- [ ] **Step 6: Cleanup**

Run: `rm -f /tmp/352-vitest.txt /tmp/352-mocha.txt /tmp/352-golden.txt /tmp/352-openvsx.txt /tmp/352-task1-red.txt /tmp/352-task1-green.txt /tmp/352-task2-red.txt /tmp/352-task2-green.txt /tmp/352-task3-openvsx.txt`
