# Intervention UI Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a VS Code setting `artemis.struggleDetection.showInterventions` (default `true`) that suppresses all intervention UI surfaces while preserving the trigger / EQ / decision pipeline. Suppressed events are recorded as a new `'suppressed'` action, and toggle state changes are persisted as new recording events for evaluation provenance.

**Architecture:** A new `onDidSuppressIntervention` event on `TelemetryManager` fires (un-rate-limited, `decision.shouldIntervene === true` preserved) when the toggle is off and an eligible decision is produced. `InterventionService.show*EQ` methods are not called and decision-engine UI-delivery state (cooldown, session counters) does not advance. The recording layer gains a `'suppressed'` intervention action plus two new event types (`configurationSnapshot`, `configurationChange`) for session classification. `hideHint()` is extended to fully reset status-bar item fields so live toggling clears any visible UI cleanly.

**Tech Stack:** TypeScript, VS Code Extension API, Mocha (vscode-test) + sinon for unit tests, esbuild bundler, npm.

**Spec:** `docs/superpowers/specs/2026-04-28-intervention-ui-toggle-design.md`

**Worktree:** `/Users/liamberger/claudeworktrees/MA-intervention-ui-toggle/` — branch `feat/intervention-ui-toggle` off `origin/dev`.

---

## File Inventory

| Path (relative to worktree root) | Action | Responsibility |
|---|---|---|
| `extension/package.json` | Modify | Register `artemis.struggleDetection.showInterventions` configuration property |
| `extension/src/extension/utils/constants.ts` | Modify | Add `SHOW_INTERVENTIONS_KEY` to `VSCODE_CONFIG.STRUGGLE_DETECTION` |
| `extension/src/extension/services/telemetry/types.ts` | Modify | Add `InterventionSuppressionReason` and `SuppressedInterventionPayload` |
| `extension/src/extension/services/telemetry/recording/types.ts` | Modify | Add `'suppressed'` to `InterventionEvent.action`, add `suppressionReason`, add `ConfigurationSnapshotEvent` and `ConfigurationChangeEvent`, update `RecordedEvent` union |
| `extension/src/extension/services/telemetry/interventionService.ts` | Modify | Extend `hideHint()` to reset `text` / `tooltip` / `backgroundColor` |
| `extension/src/extension/services/telemetry/telemetryManager.ts` | Modify | Add `_showInterventions` field + `onDidSuppressIntervention` emitter; gate `_evaluateAndIntervene`; load + live-handle setting in `_loadConfiguration`; export `getShowInterventions()` for tests |
| `extension/src/extension/services/telemetry/recording/sessionRecorder.ts` | Modify | Add `'suppressed'` action to `recordIntervention`; add `recordConfigurationSnapshot` and `recordConfigurationChange` methods |
| `extension/src/extension/activation/sessionRecorderWiring.ts` | Modify | Subscribe to `onDidSuppressIntervention` → `recordIntervention('suppressed', …)`; add startup contributor for `configurationSnapshot`; subscribe to `vscode.workspace.onDidChangeConfiguration` for the two struggle keys → `recordConfigurationChange` |
| `extension/test/unit/services/telemetry/interventionService.test.ts` | Modify | Add tests for the extended `hideHint()` field-reset behaviour |
| `extension/test/unit/services/telemetry/telemetryManagerInterventionToggle.test.ts` | **Create** | Toggle on/off paths, event emission, no UI calls, no state advancement, type-guard fallback, live-toggle behaviour |
| `extension/test/unit/services/telemetry/recording/sessionRecorder.test.ts` | Modify | Add tests for `recordIntervention('suppressed', …)`, `recordConfigurationSnapshot`, `recordConfigurationChange` |

---

## Conventions & Reminders

- **Branch:** Already created at `feat/intervention-ui-toggle` off `origin/dev` in worktree `~/claudeworktrees/MA-intervention-ui-toggle`.
- **Run all commands from the worktree root:** `/Users/liamberger/claudeworktrees/MA-intervention-ui-toggle`. Tests live under `extension/`, so most npm commands run from `extension/`.
- **Test runner:** vscode-test (Mocha) for unit tests under `extension/test/unit/`. Use `suite`/`test`/`setup`/`teardown` (Mocha BDD-not-installed). Assertions: node `assert`. Stubs/spies: `sinon`.
- **Test file naming:** match the existing convention — see `interventionService.test.ts`, `sessionRecorder.test.ts`.
- **Commit style:** match recent log on `dev` (Conventional Commits — `feat:`, `test:`, `docs:`, etc.). No Co-Authored-By line. No em dashes in commit messages.
- **Commit cadence:** every task ends with a commit. Stage only the files actually changed; never `git add -A`.
- **Lint/typecheck:** after edits, run `npm run check-types` and `npm run lint:src` from `extension/`. Final-final step before merging is `npm run compile`.
- **First-time worktree setup:** before Task 1, run `npm install` inside `extension/` (the worktree has no `node_modules` yet). Verified-clean baseline: run `npm run check-types` and report success before starting.

---

## Task 0: Setup & baseline

**Files:** none (env preparation)

- [ ] **Step 1: Install dependencies**

```bash
cd /Users/liamberger/claudeworktrees/MA-intervention-ui-toggle/extension
npm install 2>&1 | tee /tmp/intervention-toggle-install.log | tail -20
```

Expected: install succeeds. If `npm install` fails, abort and report.

- [ ] **Step 2: Verify clean type baseline**

```bash
npm run check-types 2>&1 | tee /tmp/intervention-toggle-baseline-types.txt | tail -10
```

Expected: exit 0, no errors. (Worktree starts from `origin/dev`, which should be green.)

- [ ] **Step 3: Verify clean unit-test baseline (intervention area only)**

```bash
npx vscode-test --label unit --grep "InterventionService" 2>&1 | tee /tmp/intervention-toggle-baseline-tests.txt | tail -30
```

Expected: existing intervention tests pass. If any fail, report and stop — do not proceed with new work on a red baseline.

- [ ] **Step 4: Commit nothing**

This task makes no source changes; just confirms environment is ready. Skip commit.

---

## Task 1: Add the setting to package.json

**Files:**
- Modify: `extension/package.json` (within `contributes.configuration.properties`, alongside the existing `artemis.struggleDetection.enabled`)

- [ ] **Step 1: Insert the new configuration property**

Open `extension/package.json`. Find this block (around line 205):

```jsonc
"artemis.struggleDetection.enabled": {
    "type": "boolean",
    "default": true,
    "description": "Enable struggle detection to receive helpful hints when you might be stuck on a problem"
},
```

Add the following property **immediately after** that block (before the next property `artemis.startPage`):

```jsonc
"artemis.struggleDetection.showInterventions": {
    "type": "boolean",
    "default": true,
    "markdownDescription": "Show help suggestions when struggle is detected (status bar hint and notification popups). When **disabled**, no UI prompts will appear during struggle, but data collection continues unchanged. Use this if you prefer to work without interruptions while still contributing to research data."
},
```

Make sure the trailing comma on the previous block stays in place and that the new block ends with a comma before the next property.

- [ ] **Step 2: Verify package.json is valid JSON**

```bash
cd /Users/liamberger/claudeworktrees/MA-intervention-ui-toggle/extension
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Verify type-check still passes**

```bash
npm run check-types 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add extension/package.json
git commit -m "feat(settings): add artemis.struggleDetection.showInterventions toggle

Default true. Disabling suppresses intervention UI but keeps the
telemetry pipeline observing and recording. Description explicitly
states that data collection continues."
```

---

## Task 2: Add the constant key

**Files:**
- Modify: `extension/src/extension/utils/constants.ts:33-37`

- [ ] **Step 1: Add `SHOW_INTERVENTIONS_KEY` to the constants block**

Open `extension/src/extension/utils/constants.ts`. Find:

```ts
STRUGGLE_DETECTION: {
    SECTION: 'artemis.struggleDetection',
    ENABLED_KEY: 'enabled',
},
```

Replace with:

```ts
STRUGGLE_DETECTION: {
    SECTION: 'artemis.struggleDetection',
    ENABLED_KEY: 'enabled',
    SHOW_INTERVENTIONS_KEY: 'showInterventions',
},
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/liamberger/claudeworktrees/MA-intervention-ui-toggle/extension
npm run check-types 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add extension/src/extension/utils/constants.ts
git commit -m "feat(constants): add SHOW_INTERVENTIONS_KEY for new struggle setting"
```

---

## Task 3: Telemetry types — suppression payload

**Files:**
- Modify: `extension/src/extension/services/telemetry/types.ts` (after the `InterventionDecision` interface, near line 320 — locate by searching for the existing `InterventionBlockedReason` type)

- [ ] **Step 1: Add the suppression-reason and payload types**

Open `extension/src/extension/services/telemetry/types.ts`. After the `InterventionDismissReason` definition (around line 277), add:

```ts
/**
 * Reason a wanted intervention was suppressed without being delivered to the user.
 * Currently only one reason exists; left as a union so future suppression sources
 * (e.g. per-condition study mode) can extend it cleanly.
 *
 * Note: this is a SEPARATE concept from `InterventionBlockedReason`. Blocks come
 * from engine-internal gates (cooldown, warmup, session-limit, low-confidence)
 * and are rate-limited. Suppression comes from explicit user/config choice and
 * is NOT rate-limited so the per-opportunity signal stays intact.
 */
export type InterventionSuppressionReason = 'user-disabled';

/**
 * Payload of `TelemetryManager.onDidSuppressIntervention`.
 *
 * `decision` is the original eligible decision with `shouldIntervene === true`.
 * It must NOT be mutated to `false` — the recording must retain the per-opportunity
 * eligibility signal for later analysis.
 */
export interface SuppressedInterventionPayload {
    decision: InterventionDecision;
    reason: InterventionSuppressionReason;
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/liamberger/claudeworktrees/MA-intervention-ui-toggle/extension
npm run check-types 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add extension/src/extension/services/telemetry/types.ts
git commit -m "feat(telemetry): add InterventionSuppressionReason and payload type

Adds a new event payload distinct from InterventionBlockedReason, so
user-driven UI suppression and engine-internal blocks stay semantically
separate."
```

---

## Task 4: Recording schema — `'suppressed'` action + new config events

**Files:**
- Modify: `extension/src/extension/services/telemetry/recording/types.ts:190-208` (`InterventionEvent`)
- Modify: `extension/src/extension/services/telemetry/recording/types.ts:307-336` (`RecordedEvent` union)
- Modify: `extension/src/extension/services/telemetry/recording/types.ts` near line 125 (after `StartupPhaseCompleteEvent`)

- [ ] **Step 1: Extend `InterventionEvent`**

Replace the existing `InterventionEvent` interface (currently lines 190-208) with:

```ts
export interface InterventionEvent {
    type: 'intervention';
    timestamp: number;
    action: 'shown' | 'accepted' | 'dismissed' | 'blocked' | 'suppressed';
    level: 'subtle' | 'notification' | 'proactive';
    /** True for shown/accepted/dismissed/suppressed; false for blocked. */
    shouldIntervene: boolean;
    eq: number;
    confidence: 'sufficient' | 'insufficient';
    triggerType?: 'execution-error' | 'multiline-paste' | 'idle' | 'selection-maintained';
    /** Populated when action='blocked'. Identifies why the intervention was blocked. */
    blockedReason?: 'cooldown' | 'warmup' | 'session-limit' | 'low-confidence';
    /** Populated when action='suppressed'. Identifies the suppression source. */
    suppressionReason?: 'user-disabled';
    /** Populated when action='dismissed'. Identifies how the intervention was dismissed. */
    dismissReason?: 'user-action' | 'hidden' | 'replaced' | 'session-end';
    /**
     * Whether the EQ was above the severity threshold, regardless of confidence/guardrails.
     * Populated when action='blocked' to explain the signal that was suppressed.
     */
    rawWanted?: boolean;
}
```

- [ ] **Step 2: Add `ConfigurationSnapshotEvent` and `ConfigurationChangeEvent`**

After the `StartupPhaseCompleteEvent` interface (around line 125), add:

```ts
/**
 * Provenance event emitted once during the startup-contributor phase before
 * `startupPhaseComplete`. Captures the values of struggle-detection settings
 * at session start so analysis can classify control vs treatment sessions.
 */
export interface ConfigurationSnapshotEvent {
    type: 'configurationSnapshot';
    timestamp: number;
    struggleDetectionEnabled: boolean;
    showInterventions: boolean;
}

/**
 * Provenance event emitted whenever one of the recorded struggle-detection
 * settings changes mid-session. Each property is only present when its value
 * changed in the triggering configuration event.
 */
export interface ConfigurationChangeEvent {
    type: 'configurationChange';
    timestamp: number;
    changes: {
        struggleDetectionEnabled?: boolean;
        showInterventions?: boolean;
    };
}
```

- [ ] **Step 3: Add the new event types to the `RecordedEvent` union**

Find the `RecordedEvent` union (around line 307). Insert `ConfigurationSnapshotEvent` and `ConfigurationChangeEvent` next to `ConsentChangeEvent` so all configuration-related events sit together. After change:

```ts
export type RecordedEvent =
    | TextChangeEvent
    | SaveEvent
    | FileSwitchEvent
    | DiagnosticsEvent
    | BuildResultEvent
    | WindowFocusEvent
    | FileSnapshotEvent
    | SessionStartEvent
    | SessionEndEvent
    | ConsentChangeEvent
    | ConfigurationSnapshotEvent
    | ConfigurationChangeEvent
    | StartupPhaseCompleteEvent
    | IrisChatMessageEvent
    | IrisChatSendAttemptEvent
    | IrisChatFeedbackEvent
    | EqSnapshotEvent
    | EqEngineStateEvent
    | InterventionEvent
    | ViewNavigationEvent
    | PanelVisibilityEvent
    | SelectionChangeEvent
    | VisibleRangeChangeEvent
    | TerminalCommandEvent
    | TerminalOpenCloseEvent
    | FileSnapshotErrorEvent
    | FileCreateEvent
    | FileDeleteEvent
    | FileRenameEvent
    | TextDocumentOpenEvent
    | TextDocumentCloseEvent;
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/liamberger/claudeworktrees/MA-intervention-ui-toggle/extension
npm run check-types 2>&1 | tee /tmp/intervention-toggle-typecheck-task4.txt | tail -30
```

Expected: errors in `sessionRecorderWiring.ts` and `sessionRecorder.ts` will surface only after Tasks 5–8 — at this stage only the type definitions changed, so type-check should still pass.

- [ ] **Step 5: Commit**

```bash
git add extension/src/extension/services/telemetry/recording/types.ts
git commit -m "feat(recording): add 'suppressed' intervention action and config events

Schema-level changes only:
- InterventionEvent.action gains 'suppressed' with optional suppressionReason
- New ConfigurationSnapshotEvent and ConfigurationChangeEvent for
  control/treatment session classification provenance
- RecordedEvent union widened accordingly"
```

---

## Task 5: Test — `hideHint()` resets text/tooltip/backgroundColor (TDD)

**Files:**
- Test: `extension/test/unit/services/telemetry/interventionService.test.ts` (add new `suite` block at the bottom of the file)

- [ ] **Step 1: Locate where the existing tests construct an `InterventionService`**

```bash
cd /Users/liamberger/claudeworktrees/MA-intervention-ui-toggle/extension
grep -n "new InterventionService\|createStatusBarItem" test/unit/services/telemetry/interventionService.test.ts | head -10
```

Note the helper used to instantiate the service and to access the underlying status bar item (the file already stubs `vscode.window.createStatusBarItem`).

- [ ] **Step 2: Add the new test suite at the end of `interventionService.test.ts`**

Append the following block after the existing suite, **without modifying** the existing tests:

```ts
suite('InterventionService.hideHint() — full status-bar reset', () => {
    let svc: InterventionService;
    let statusBarItem: vscode.StatusBarItem;
    let createStub: sinon.SinonStub;

    setup(() => {
        statusBarItem = {
            text: '',
            tooltip: undefined,
            backgroundColor: undefined,
            command: undefined,
            show: sinon.stub(),
            hide: sinon.stub(),
            dispose: sinon.stub(),
            alignment: vscode.StatusBarAlignment.Right,
            priority: 100,
            color: undefined,
            name: undefined,
            id: 'mock',
            accessibilityInformation: undefined,
        } as unknown as vscode.StatusBarItem;
        createStub = sinon.stub(vscode.window, 'createStatusBarItem').returns(statusBarItem);
        svc = new InterventionService();
    });

    teardown(() => {
        svc.dispose();
        createStub.restore();
    });

    test('hideHint clears text, tooltip, and backgroundColor', () => {
        // Simulate state left behind by a notification/proactive flow.
        statusBarItem.text = '$(warning) Help available!';
        statusBarItem.tooltip = 'EQ: 80% — Iris detected struggle';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');

        svc.hideHint();

        assert.strictEqual(statusBarItem.text, '');
        assert.strictEqual(statusBarItem.tooltip, undefined);
        assert.strictEqual(statusBarItem.backgroundColor, undefined);
    });
});
```

If the existing test file already has a `setup` that stubs `createStatusBarItem`, reuse that pattern (do not double-stub). If the existing pattern is incompatible, mirror it exactly here so that all tests in the file use the same approach.

- [ ] **Step 3: Run the new test — expect failure**

```bash
cd /Users/liamberger/claudeworktrees/MA-intervention-ui-toggle/extension
npx vscode-test --label unit --grep "hideHint() — full status-bar reset" 2>&1 | tee /tmp/intervention-toggle-task5-fail.txt | tail -20
```

Expected: test fails because `hideHint()` does not currently reset `text` / `tooltip` / `backgroundColor`.

- [ ] **Step 4: Commit (red test)**

```bash
git add extension/test/unit/services/telemetry/interventionService.test.ts
git commit -m "test(intervention): add failing test for hideHint full reset"
```

---

## Task 6: Implement `hideHint()` reset

**Files:**
- Modify: `extension/src/extension/services/telemetry/interventionService.ts:254-261`

- [ ] **Step 1: Update `hideHint()`**

Open `interventionService.ts`. Replace the existing `hideHint` implementation:

```ts
public hideHint(): void {
    if (this._currentSubtleDecision !== undefined) {
        this._emitDismiss(this._currentSubtleDecision, 'hidden');
        this._currentSubtleDecision = undefined;
    }
    this._statusBarItem.command = 'iris.chatView.focus';
    this._statusBarItem.hide();
}
```

with:

```ts
public hideHint(): void {
    if (this._currentSubtleDecision !== undefined) {
        this._emitDismiss(this._currentSubtleDecision, 'hidden');
        this._currentSubtleDecision = undefined;
    }
    this._statusBarItem.command = 'iris.chatView.focus';
    this._statusBarItem.text = '';
    this._statusBarItem.tooltip = undefined;
    this._statusBarItem.backgroundColor = undefined;
    this._statusBarItem.hide();
}
```

- [ ] **Step 2: Run the new test — expect pass**

```bash
cd /Users/liamberger/claudeworktrees/MA-intervention-ui-toggle/extension
npx vscode-test --label unit --grep "hideHint() — full status-bar reset" 2>&1 | tail -15
```

Expected: pass.

- [ ] **Step 3: Run the full `InterventionService` suite — expect pass**

```bash
npx vscode-test --label unit --grep "InterventionService" 2>&1 | tail -20
```

Expected: all existing intervention-service tests still pass (no regressions).

- [ ] **Step 4: Commit**

```bash
git add extension/src/extension/services/telemetry/interventionService.ts
git commit -m "feat(intervention): clear text/tooltip/backgroundColor in hideHint

Prevents stale labels and warning-coloured backgrounds from bleeding
through if the status bar item is later shown for an unrelated reason.
Required precondition for the live UI-toggle off→hide path."
```

---

## Task 7: TelemetryManager — toggle field, emitter, getter (foundational, no behaviour change yet)

**Files:**
- Modify: `extension/src/extension/services/telemetry/telemetryManager.ts` (around lines 1-25 for imports, 55-90 for fields/getters, 442-465 for `_loadConfiguration`)

- [ ] **Step 1: Add the type import**

Open `telemetryManager.ts`. The existing type import (line 2) already pulls from `./types`. Append `SuppressedInterventionPayload` to the imported names:

```ts
import {
    StruggleContext,
    TriggerType,
    EQConfidence,
    EQState,
    RecommendedAction,
    SuppressedInterventionPayload,
} from './types';
```

- [ ] **Step 2: Add the new field, emitter, and event accessor**

Find the existing field block ending with `_debugMode: boolean = false;` (around line 63). Just below the existing intervention-event accessors (i.e. after `onDidBlockIntervention` getter at line 90), add:

```ts
private readonly _onDidSuppressIntervention = new vscode.EventEmitter<SuppressedInterventionPayload>();
public readonly onDidSuppressIntervention = this._onDidSuppressIntervention.event;
```

Add a new private field next to `_isEnabled` (around line 57):

```ts
private _showInterventions: boolean = true;
```

In `dispose()` (around line 162), append `this._onDidSuppressIntervention.dispose();` to the disposal list (model after the existing `_onDidCalculateEQ.dispose()` if present, or add it next to other disposable emitters).

- [ ] **Step 3: Add a public read-accessor for tests**

Below `public isEnabled(): boolean { return this._isEnabled; }` (around line 436), add:

```ts
public getShowInterventions(): boolean {
    return this._showInterventions;
}
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/liamberger/claudeworktrees/MA-intervention-ui-toggle/extension
npm run check-types 2>&1 | tail -10
```

Expected: pass. (The new emitter is wired but not yet fired — behaviour unchanged.)

- [ ] **Step 5: Commit**

```bash
git add extension/src/extension/services/telemetry/telemetryManager.ts
git commit -m "feat(telemetry): add showInterventions field and onDidSuppressIntervention emitter

Foundational scaffolding for the new UI-toggle gate. Emitter not yet
fired; setting not yet read. Behaviour unchanged."
```

---

## Task 8: Test — toggle off → suppression event fires, no UI calls (TDD, red)

**Files:**
- Create: `extension/test/unit/services/telemetry/telemetryManagerInterventionToggle.test.ts`

- [ ] **Step 1: Create the new test file**

Create `extension/test/unit/services/telemetry/telemetryManagerInterventionToggle.test.ts` with the following content:

```ts
/**
 * Unit tests for the artemis.struggleDetection.showInterventions toggle.
 *
 * Covers:
 *  T1. Toggle off → onDidSuppressIntervention fires once with original decision (shouldIntervene=true preserved).
 *  T2. Toggle off → no calls to vscode.window.showInformationMessage / showWarningMessage / statusBarItem.show().
 *  T3. Toggle off → no UI-delivery state advancement (lastInterventionTime=0, sessionInterventionCount=0).
 *  T4. Toggle off → suppression events are NOT rate-limited.
 *  T5. Toggle on (default) → existing show path still fires; no suppression event.
 *  T6. Live-toggle on→off with subtle hint visible → hideHint called; dismiss event with reason 'hidden' fires.
 *  T7. Live-toggle off→on → no spurious events.
 *  T8. Setting type guard: non-boolean value falls back to true.
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { TelemetryManager } from '../../../../src/extension/services/telemetry/telemetryManager';
import type {
    InterventionDecision,
    SuppressedInterventionPayload,
} from '../../../../src/extension/services/telemetry/types';

interface ConfigStubValues {
    enabled?: boolean;
    showInterventions?: unknown;
    developerMode?: boolean;
}

function stubGetConfiguration(values: ConfigStubValues): sinon.SinonStub {
    const original = vscode.workspace.getConfiguration;
    return sinon.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
        const cfg = original.call(vscode.workspace, section);
        return {
            ...cfg,
            get: <T>(key: string, defaultValue?: T): T => {
                if (section === 'artemis.struggleDetection' && key === 'enabled') {
                    return (values.enabled ?? true) as unknown as T;
                }
                if (section === 'artemis.struggleDetection' && key === 'showInterventions') {
                    return (values.showInterventions ?? true) as unknown as T;
                }
                if (section === 'artemis' && key === 'developerMode') {
                    return (values.developerMode ?? false) as unknown as T;
                }
                return defaultValue as T;
            },
            inspect: cfg.inspect.bind(cfg),
            update: cfg.update.bind(cfg),
            has: cfg.has.bind(cfg),
        } as unknown as vscode.WorkspaceConfiguration;
    });
}

/**
 * Drive a synthetic eligible decision through TelemetryManager._evaluateAndIntervene.
 * Uses a controlled private accessor since _evaluateAndIntervene is private and
 * trigger-emitter wiring would couple this test to unrelated subsystems.
 */
function driveEligibleDecision(
    tm: TelemetryManager,
    overrides: Partial<InterventionDecision> = {},
): void {
    // Cast to expose the private method specifically for whitebox testing.
    type Internal = {
        _evaluateAndIntervene(triggerType: 'execution-error' | 'multiline-paste' | 'idle' | 'selection-maintained'): void;
        _decisionEngine: { evaluate: (...args: unknown[]) => InterventionDecision };
    };
    const internal = tm as unknown as Internal;
    const stub = sinon.stub(internal._decisionEngine, 'evaluate').returns({
        rawWanted: true,
        shouldIntervene: true,
        level: 'subtle',
        triggerType: 'execution-error',
        eq: 0.5,
        confidence: 'sufficient',
        ...overrides,
    });
    try {
        internal._evaluateAndIntervene('execution-error');
    } finally {
        stub.restore();
    }
}

suite('TelemetryManager — intervention UI toggle', () => {
    let getConfigStub: sinon.SinonStub;
    let showInfoStub: sinon.SinonStub;
    let showWarnStub: sinon.SinonStub;
    let createStatusBarStub: sinon.SinonStub;
    let statusBarItem: { show: sinon.SinonStub; hide: sinon.SinonStub; dispose: sinon.SinonStub; text: string; tooltip: string | undefined; backgroundColor: vscode.ThemeColor | undefined; command: string | undefined };

    setup(() => {
        statusBarItem = {
            show: sinon.stub(),
            hide: sinon.stub(),
            dispose: sinon.stub(),
            text: '',
            tooltip: undefined,
            backgroundColor: undefined,
            command: undefined,
        };
        createStatusBarStub = sinon.stub(vscode.window, 'createStatusBarItem').returns(statusBarItem as unknown as vscode.StatusBarItem);
        showInfoStub = sinon.stub(vscode.window, 'showInformationMessage');
        showWarnStub = sinon.stub(vscode.window, 'showWarningMessage');
    });

    teardown(() => {
        getConfigStub?.restore();
        showInfoStub.restore();
        showWarnStub.restore();
        createStatusBarStub.restore();
    });

    test('T1: toggle off → suppression event fires with shouldIntervene=true preserved', () => {
        getConfigStub = stubGetConfiguration({ showInterventions: false });
        const tm = new TelemetryManager();
        const captured: SuppressedInterventionPayload[] = [];
        tm.onDidSuppressIntervention(payload => captured.push(payload));

        driveEligibleDecision(tm, { level: 'subtle' });

        assert.strictEqual(captured.length, 1);
        assert.strictEqual(captured[0].reason, 'user-disabled');
        assert.strictEqual(captured[0].decision.shouldIntervene, true);
        assert.strictEqual(captured[0].decision.level, 'subtle');
        tm.dispose();
    });

    test('T2: toggle off → no UI surface calls', () => {
        getConfigStub = stubGetConfiguration({ showInterventions: false });
        const tm = new TelemetryManager();

        driveEligibleDecision(tm, { level: 'subtle' });
        driveEligibleDecision(tm, { level: 'notification' });
        driveEligibleDecision(tm, { level: 'proactive' });

        assert.strictEqual(showInfoStub.callCount, 0, 'showInformationMessage was called');
        assert.strictEqual(showWarnStub.callCount, 0, 'showWarningMessage was called');
        assert.strictEqual(statusBarItem.show.callCount, 0, 'statusBarItem.show was called');
        tm.dispose();
    });

    test('T3: toggle off → UI-delivery state does not advance', () => {
        getConfigStub = stubGetConfiguration({ showInterventions: false });
        const tm = new TelemetryManager();

        for (let i = 0; i < 5; i++) {
            driveEligibleDecision(tm, { level: 'notification' });
        }

        // Whitebox: read intervention service state via the public getter chain.
        const internal = tm as unknown as { _interventionService: { getState(): { lastInterventionTime: number; sessionInterventionCount: number; lastDismissed: boolean; lastAccepted: boolean } } };
        const state = internal._interventionService.getState();
        assert.strictEqual(state.lastInterventionTime, 0, 'lastInterventionTime advanced');
        assert.strictEqual(state.sessionInterventionCount, 0, 'sessionInterventionCount advanced');
        assert.strictEqual(state.lastDismissed, false);
        assert.strictEqual(state.lastAccepted, false);
        tm.dispose();
    });

    test('T4: toggle off → suppression events are not rate-limited', () => {
        getConfigStub = stubGetConfiguration({ showInterventions: false });
        const tm = new TelemetryManager();
        const captured: SuppressedInterventionPayload[] = [];
        tm.onDidSuppressIntervention(payload => captured.push(payload));

        for (let i = 0; i < 5; i++) {
            driveEligibleDecision(tm, { level: 'notification' });
        }

        assert.strictEqual(captured.length, 5);
        tm.dispose();
    });

    test('T5: toggle on (default) → no suppression event; show path runs', () => {
        getConfigStub = stubGetConfiguration({ showInterventions: true });
        const tm = new TelemetryManager();
        const captured: SuppressedInterventionPayload[] = [];
        tm.onDidSuppressIntervention(payload => captured.push(payload));

        driveEligibleDecision(tm, { level: 'subtle' });

        assert.strictEqual(captured.length, 0);
        assert.strictEqual(statusBarItem.show.callCount >= 1, true, 'statusBarItem.show should fire for subtle path');
        tm.dispose();
    });

    test('T6: live-toggle on→off with subtle visible → hideHint called; dismiss reason hidden', () => {
        getConfigStub = stubGetConfiguration({ showInterventions: true });
        const tm = new TelemetryManager();

        driveEligibleDecision(tm, { level: 'subtle' });
        const dismissals: Array<{ dismissReason: string }> = [];
        tm.onDidDismissIntervention(payload => dismissals.push(payload));

        // Flip the stubbed config, then re-trigger config loading directly.
        // We invoke _loadConfiguration() instead of firing a fake
        // onDidChangeConfiguration event because TelemetryManager re-runs
        // _loadConfiguration unconditionally on any matching event — calling
        // it directly is equivalent and avoids brittle event mocking.
        getConfigStub.restore();
        getConfigStub = stubGetConfiguration({ showInterventions: false });
        (tm as unknown as { _loadConfiguration(): void })._loadConfiguration();

        assert.strictEqual(statusBarItem.hide.callCount >= 1, true, 'statusBarItem.hide expected on transition');
        assert.strictEqual(dismissals.length, 1, 'expected exactly one dismiss event');
        assert.strictEqual(dismissals[0].dismissReason, 'hidden');
        tm.dispose();
    });

    test('T7: live-toggle off→on → no spurious events', () => {
        getConfigStub = stubGetConfiguration({ showInterventions: false });
        const tm = new TelemetryManager();
        const suppressed: SuppressedInterventionPayload[] = [];
        const dismissals: unknown[] = [];
        tm.onDidSuppressIntervention(p => suppressed.push(p));
        tm.onDidDismissIntervention(p => dismissals.push(p));

        getConfigStub.restore();
        getConfigStub = stubGetConfiguration({ showInterventions: true });
        (tm as unknown as { _loadConfiguration(): void })._loadConfiguration();

        assert.strictEqual(suppressed.length, 0);
        assert.strictEqual(dismissals.length, 0);
        tm.dispose();
    });

    test('T8: type guard — non-boolean setting falls back to true', () => {
        getConfigStub = stubGetConfiguration({ showInterventions: 'not-a-boolean' });
        const tm = new TelemetryManager();

        assert.strictEqual(tm.getShowInterventions(), true);
        tm.dispose();
    });
});
```

- [ ] **Step 2: Run the new tests — expect failure**

```bash
cd /Users/liamberger/claudeworktrees/MA-intervention-ui-toggle/extension
npx vscode-test --label unit --grep "intervention UI toggle" 2>&1 | tee /tmp/intervention-toggle-task8-fail.txt | tail -60
```

Expected: every test fails (gate not implemented yet). T5 may pass; that is fine.

- [ ] **Step 3: Commit (red tests)**

```bash
git add extension/test/unit/services/telemetry/telemetryManagerInterventionToggle.test.ts
git commit -m "test(telemetry): add failing tests for intervention UI toggle

Covers suppression event semantics, no UI calls, no state advancement,
non-rate-limited emission, live-toggle transitions, and type guard."
```

---

## Task 9: TelemetryManager — implement the gate + setting load

**Files:**
- Modify: `extension/src/extension/services/telemetry/telemetryManager.ts:377-412` (`_evaluateAndIntervene`)
- Modify: `extension/src/extension/services/telemetry/telemetryManager.ts:442-465` (`_loadConfiguration`)

- [ ] **Step 1: Replace the entire `_loadConfiguration` method**

Open `telemetryManager.ts`. Replace the full body of `_loadConfiguration` (lines 442-466) with this exact code (note the `previousShowInterventions` capture and the new live-transition block; the rest mirrors the existing logic verbatim including the developer-mode log lines):

```ts
private _loadConfiguration(): void {
    const struggleConfig = vscode.workspace.getConfiguration(VSCODE_CONFIG.STRUGGLE_DETECTION.SECTION);
    this._isEnabled = struggleConfig.get<boolean>(VSCODE_CONFIG.STRUGGLE_DETECTION.ENABLED_KEY, true);

    const previousShowInterventions = this._showInterventions;
    const rawShow = struggleConfig.get<unknown>(
        VSCODE_CONFIG.STRUGGLE_DETECTION.SHOW_INTERVENTIONS_KEY,
        true,
    );
    this._showInterventions = typeof rawShow === 'boolean' ? rawShow : true;

    const wasDebugMode = this._debugMode;
    const artemisConfig = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
    const developerMode = artemisConfig.get<boolean>(VSCODE_CONFIG.DEVELOPER_MODE_KEY, false);
    this._debugMode = this._isEnabled && developerMode;

    if (!this._isEnabled) {
        this._interventionService.hideHint();
        this._debugDashboard.stop();
        this._log('Struggle detection disabled');
    } else {
        this._log('Struggle detection enabled');
    }

    // Live transition on→off for the UI toggle: clear any visible hint so a
    // status-bar lightbulb / coloured remnant disappears immediately. We do
    // NOT log on every load (only on transitions) to avoid noise.
    if (previousShowInterventions && !this._showInterventions) {
        this._interventionService.hideHint();
        this._log('Intervention UI suppressed by user setting');
    } else if (!previousShowInterventions && this._showInterventions) {
        this._log('Intervention UI restored by user setting');
    }

    if (this._debugMode && !wasDebugMode) {
        this._debugDashboard.start();
        this._log('Developer mode ENABLED — showing live EQ in status bar');
    } else if (!this._debugMode && wasDebugMode) {
        this._debugDashboard.stop();
        this._log('Developer mode DISABLED');
    }
}
```

- [ ] **Step 2: Update `_evaluateAndIntervene`**

Replace the dispatch block in `_evaluateAndIntervene` (lines 389-411). Current code:

```ts
if (decision.shouldIntervene) {
    switch (decision.level) {
        case 'subtle':
            this._interventionService.showSubtleHintEQ(decision);
            break;
        case 'notification':
            void this._interventionService.showNotificationEQ(decision).catch((err: unknown) => {
                logger.error('Failed to show notification intervention', LogCategory.TELEMETRY, err);
            });
            break;
        case 'proactive':
            void this._interventionService.showProactiveHelpEQ(decision).catch((err: unknown) => {
                logger.error('Failed to show proactive intervention', LogCategory.TELEMETRY, err);
            });
            break;
    }
} else if (decision.rawWanted) {
    this._interventionService.recordBlockedDecision(decision);
}
```

Replace with:

```ts
if (decision.shouldIntervene) {
    if (!this._showInterventions) {
        // UI suppressed by user setting. Decision-engine UI-delivery state is
        // intentionally NOT advanced (no _recordIntervention) because no UI was
        // shown. The recording layer subscribes to onDidSuppressIntervention so
        // every eligible opportunity is captured for evaluation.
        this._onDidSuppressIntervention.fire({
            decision,
            reason: 'user-disabled',
        });
        return;
    }
    switch (decision.level) {
        case 'subtle':
            this._interventionService.showSubtleHintEQ(decision);
            break;
        case 'notification':
            void this._interventionService.showNotificationEQ(decision).catch((err: unknown) => {
                logger.error('Failed to show notification intervention', LogCategory.TELEMETRY, err);
            });
            break;
        case 'proactive':
            void this._interventionService.showProactiveHelpEQ(decision).catch((err: unknown) => {
                logger.error('Failed to show proactive intervention', LogCategory.TELEMETRY, err);
            });
            break;
    }
} else if (decision.rawWanted) {
    this._interventionService.recordBlockedDecision(decision);
}
```

- [ ] **Step 3: Run the toggle tests — expect pass**

```bash
cd /Users/liamberger/claudeworktrees/MA-intervention-ui-toggle/extension
npx vscode-test --label unit --grep "intervention UI toggle" 2>&1 | tee /tmp/intervention-toggle-task9-pass.txt | tail -40
```

Expected: all 8 tests pass. If any fail, inspect output and adjust the implementation (do **not** change the test assertions).

- [ ] **Step 4: Run the broader telemetry suite — expect pass**

```bash
npx vscode-test --label unit --grep "TelemetryManager|InterventionService" 2>&1 | tail -30
```

Expected: no regressions in existing tests.

- [ ] **Step 5: Commit**

```bash
git add extension/src/extension/services/telemetry/telemetryManager.ts
git commit -m "feat(telemetry): suppress intervention UI when showInterventions is false

Fires onDidSuppressIntervention with the original eligible decision
(shouldIntervene preserved as true). Does not advance UI-delivery state
because no intervention was shown. Live-toggle on->off triggers
hideHint() so any visible status-bar hint disappears immediately."
```

---

## Task 10: Recording — `recordIntervention('suppressed', …)` support

**Files:**
- Modify: `extension/src/extension/services/telemetry/recording/sessionRecorder.ts:300-329`

- [ ] **Step 1: Widen the `action` parameter and accept `suppressionReason`**

Replace the existing `recordIntervention` method:

```ts
recordIntervention(
    action: 'shown' | 'accepted' | 'dismissed' | 'blocked',
    level: 'subtle' | 'notification' | 'proactive',
    shouldIntervene: boolean,
    eq: number,
    confidence: 'sufficient' | 'insufficient',
    triggerType?: 'execution-error' | 'multiline-paste' | 'idle' | 'selection-maintained',
    opts?: {
        blockedReason?: 'cooldown' | 'warmup' | 'session-limit' | 'low-confidence';
        dismissReason?: 'user-action' | 'hidden' | 'replaced' | 'session-end';
        rawWanted?: boolean;
    },
): void {
    if (this._phase !== 'recording') {
        return;
    }
    this._lifecycle.recordInternal({
        type: 'intervention',
        timestamp: Date.now(),
        action,
        level,
        shouldIntervene,
        eq,
        confidence,
        triggerType,
        blockedReason: opts?.blockedReason,
        dismissReason: opts?.dismissReason,
        rawWanted: opts?.rawWanted,
    }, {}, this._currentGeneration);
}
```

with:

```ts
recordIntervention(
    action: 'shown' | 'accepted' | 'dismissed' | 'blocked' | 'suppressed',
    level: 'subtle' | 'notification' | 'proactive',
    shouldIntervene: boolean,
    eq: number,
    confidence: 'sufficient' | 'insufficient',
    triggerType?: 'execution-error' | 'multiline-paste' | 'idle' | 'selection-maintained',
    opts?: {
        blockedReason?: 'cooldown' | 'warmup' | 'session-limit' | 'low-confidence';
        suppressionReason?: 'user-disabled';
        dismissReason?: 'user-action' | 'hidden' | 'replaced' | 'session-end';
        rawWanted?: boolean;
    },
): void {
    if (this._phase !== 'recording') {
        return;
    }
    this._lifecycle.recordInternal({
        type: 'intervention',
        timestamp: Date.now(),
        action,
        level,
        shouldIntervene,
        eq,
        confidence,
        triggerType,
        blockedReason: opts?.blockedReason,
        suppressionReason: opts?.suppressionReason,
        dismissReason: opts?.dismissReason,
        rawWanted: opts?.rawWanted,
    }, {}, this._currentGeneration);
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/liamberger/claudeworktrees/MA-intervention-ui-toggle/extension
npm run check-types 2>&1 | tail -10
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add extension/src/extension/services/telemetry/recording/sessionRecorder.ts
git commit -m "feat(recording): support 'suppressed' intervention action and reason"
```

---

## Task 11: Recording — `recordConfigurationSnapshot` and `recordConfigurationChange`

**Files:**
- Modify: `extension/src/extension/services/telemetry/recording/sessionRecorder.ts` (add new methods near other `record*` methods, around line 350)

- [ ] **Step 1: Add the two new methods**

Insert after `recordPanelVisibility` (around line 350):

```ts
recordConfigurationSnapshot(struggleDetectionEnabled: boolean, showInterventions: boolean): void {
    if (this._phase !== 'recording') {
        return;
    }
    this._lifecycle.recordInternal({
        type: 'configurationSnapshot',
        timestamp: Date.now(),
        struggleDetectionEnabled,
        showInterventions,
    }, {}, this._currentGeneration);
}

recordConfigurationChange(changes: {
    struggleDetectionEnabled?: boolean;
    showInterventions?: boolean;
}): void {
    if (this._phase !== 'recording') {
        return;
    }
    this._lifecycle.recordInternal({
        type: 'configurationChange',
        timestamp: Date.now(),
        changes,
    }, {}, this._currentGeneration);
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/liamberger/claudeworktrees/MA-intervention-ui-toggle/extension
npm run check-types 2>&1 | tail -10
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add extension/src/extension/services/telemetry/recording/sessionRecorder.ts
git commit -m "feat(recording): add configuration snapshot and change recorders"
```

---

## Task 12: Recording wiring — subscribe to suppression and config-change

**Files:**
- Modify: `extension/src/extension/activation/sessionRecorderWiring.ts`

- [ ] **Step 1: Add the suppression subscription**

Open `sessionRecorderWiring.ts`. After the existing `onDidBlockIntervention` subscription block (lines 98-104), add:

```ts
disposables.push(telemetryManager.onDidSuppressIntervention(({ decision, reason }) => {
    sessionRecorder.recordIntervention(
        'suppressed', decision.level as 'subtle' | 'notification' | 'proactive',
        decision.shouldIntervene, decision.eq, decision.confidence, decision.triggerType,
        { suppressionReason: reason, rawWanted: decision.rawWanted },
    );
}));
```

- [ ] **Step 2: Add the configuration-snapshot startup contributor**

After the existing panel-visibility startup contributor (around line 145-160), add a new startup contributor near the end of the contributor block:

```ts
// Configuration snapshot — captures struggle-detection setting values at
// session start so analysis can classify control vs treatment sessions.
disposables.push(sessionRecorder.registerStartupContributor((ctx): RecordedEvent[] => {
    const struggleConfig = vscode.workspace.getConfiguration('artemis.struggleDetection');
    const enabled = struggleConfig.get<boolean>('enabled', true);
    const rawShow = struggleConfig.get<unknown>('showInterventions', true);
    const showInterventions = typeof rawShow === 'boolean' ? rawShow : true;
    return [{
        type: 'configurationSnapshot',
        timestamp: ctx.timestamp,
        struggleDetectionEnabled: enabled,
        showInterventions,
    }];
}));
```

- [ ] **Step 3: Add the runtime configuration-change listener**

Inside `wireSessionRecorder`, before the `// Recording status bar button` comment (around line 162), add a stateful listener that detects which struggle keys actually changed:

```ts
// Runtime configuration changes for struggle-detection settings — recorded
// so mid-session flips can be reconciled with intervention events by timestamp.
let lastStruggleEnabled = (() => {
    const cfg = vscode.workspace.getConfiguration('artemis.struggleDetection');
    return cfg.get<boolean>('enabled', true);
})();
let lastShowInterventions = (() => {
    const cfg = vscode.workspace.getConfiguration('artemis.struggleDetection');
    const raw = cfg.get<unknown>('showInterventions', true);
    return typeof raw === 'boolean' ? raw : true;
})();

disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (!event.affectsConfiguration('artemis.struggleDetection')) {
        return;
    }
    const cfg = vscode.workspace.getConfiguration('artemis.struggleDetection');
    const newEnabled = cfg.get<boolean>('enabled', true);
    const rawShow = cfg.get<unknown>('showInterventions', true);
    const newShow = typeof rawShow === 'boolean' ? rawShow : true;

    const changes: { struggleDetectionEnabled?: boolean; showInterventions?: boolean } = {};
    if (newEnabled !== lastStruggleEnabled) {
        changes.struggleDetectionEnabled = newEnabled;
        lastStruggleEnabled = newEnabled;
    }
    if (newShow !== lastShowInterventions) {
        changes.showInterventions = newShow;
        lastShowInterventions = newShow;
    }
    if (Object.keys(changes).length > 0) {
        sessionRecorder.recordConfigurationChange(changes);
    }
}));
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/liamberger/claudeworktrees/MA-intervention-ui-toggle/extension
npm run check-types 2>&1 | tail -10
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add extension/src/extension/activation/sessionRecorderWiring.ts
git commit -m "feat(recording): wire suppressed interventions and config provenance

- Subscribe to TelemetryManager.onDidSuppressIntervention and persist
  events with action='suppressed' and rawWanted preserved.
- Add a startup contributor that emits configurationSnapshot before
  startupPhaseComplete so every session is classifiable.
- Listen to onDidChangeConfiguration for the struggle keys and emit
  configurationChange events with only the diffed values."
```

---

## Task 13: Recording-layer tests

**Files:**
- Modify: `extension/test/unit/services/telemetry/recording/sessionRecorder.test.ts` (append new `suite` block at end)

- [ ] **Step 1: Append the new test suite using the existing harness helpers**

The file already exposes a `makeRecorder()` factory and a `collectWrittenEvents(fakeFs)` helper that returns parsed `RecordedEvent[]` from the `FakeFs`. Append the following suite at the very bottom of `sessionRecorder.test.ts` (after the last existing `suite(...)` closes):

```ts
suite('SessionRecorder — intervention suppression and configuration provenance', () => {
    test('recordIntervention with suppressed action persists suppressionReason', async () => {
        const { recorder, fs } = makeRecorder();
        recorder.enable();
        await recorder.startSession(42);
        recorder.recordIntervention(
            'suppressed', 'notification', true, 0.55, 'sufficient', 'execution-error',
            { suppressionReason: 'user-disabled', rawWanted: true },
        );
        await recorder.endSession();
        const events = collectWrittenEvents(fs);
        const intervention = events.find(e => e.type === 'intervention');
        assert.ok(intervention, 'intervention event missing');
        if (intervention.type !== 'intervention') {
            throw new Error('unreachable');
        }
        assert.strictEqual(intervention.action, 'suppressed');
        assert.strictEqual(intervention.shouldIntervene, true);
        assert.strictEqual(intervention.suppressionReason, 'user-disabled');
        assert.strictEqual(intervention.rawWanted, true);
        assert.strictEqual(intervention.level, 'notification');
        assert.strictEqual(intervention.triggerType, 'execution-error');
        try { await recorder.dispose(); } catch { /* ignore */ }
    });

    test('recordConfigurationSnapshot persists both keys', async () => {
        const { recorder, fs } = makeRecorder();
        recorder.enable();
        await recorder.startSession(42);
        recorder.recordConfigurationSnapshot(true, false);
        await recorder.endSession();
        const events = collectWrittenEvents(fs);
        const snap = events.find(e => e.type === 'configurationSnapshot');
        assert.ok(snap, 'configurationSnapshot missing');
        if (snap.type !== 'configurationSnapshot') {
            throw new Error('unreachable');
        }
        assert.strictEqual(snap.struggleDetectionEnabled, true);
        assert.strictEqual(snap.showInterventions, false);
        try { await recorder.dispose(); } catch { /* ignore */ }
    });

    test('recordConfigurationChange persists only the changed key', async () => {
        const { recorder, fs } = makeRecorder();
        recorder.enable();
        await recorder.startSession(42);
        recorder.recordConfigurationChange({ showInterventions: false });
        await recorder.endSession();
        const events = collectWrittenEvents(fs);
        const change = events.find(e => e.type === 'configurationChange');
        assert.ok(change, 'configurationChange missing');
        if (change.type !== 'configurationChange') {
            throw new Error('unreachable');
        }
        assert.deepStrictEqual(change.changes, { showInterventions: false });
        try { await recorder.dispose(); } catch { /* ignore */ }
    });
});
```

The `if (X.type !== 'Y') throw …` discriminator narrows the union type after `events.find` so the subsequent property access type-checks. (This pattern matches existing tests in the file — verify by skimming the surrounding code if the pattern looks unfamiliar.)

- [ ] **Step 2: Run the new tests — expect pass**

```bash
cd /Users/liamberger/claudeworktrees/MA-intervention-ui-toggle/extension
npx vscode-test --label unit --grep "SessionRecorder — intervention suppression" 2>&1 | tee /tmp/intervention-toggle-task13.txt | tail -40
```

Expected: all three tests pass.

- [ ] **Step 3: Run the full recording suite — expect no regressions**

```bash
npx vscode-test --label unit --grep "SessionRecorder" 2>&1 | tail -30
```

Expected: no regressions.

- [ ] **Step 4: Commit**

```bash
git add extension/test/unit/services/telemetry/recording/sessionRecorder.test.ts
git commit -m "test(recording): cover suppressed action and configuration events"
```

---

## Task 14: Final integration sweep — types, lint, full unit run

- [ ] **Step 1: Type-check**

```bash
cd /Users/liamberger/claudeworktrees/MA-intervention-ui-toggle/extension
npm run check-types 2>&1 | tail -10
```

Expected: exit 0.

- [ ] **Step 2: Lint**

```bash
npm run lint:src 2>&1 | tee /tmp/intervention-toggle-final-lint.txt | tail -30
```

Expected: exit 0. If lint warnings appear in any file you modified, fix them in-place and amend the relevant commit (use `git commit --amend` only if the amend stays inside the same task scope; otherwise create a new fixup commit).

- [ ] **Step 3: Full unit-test run**

```bash
npx vscode-test --label unit 2>&1 | tee /tmp/intervention-toggle-final-tests.txt | tail -50
```

Expected: all tests pass.

- [ ] **Step 4: Production build — sanity check**

```bash
npm run package 2>&1 | tail -10
```

Expected: exit 0.

- [ ] **Step 5: Commit (only if any fixups landed in Steps 2-4)**

If lint or build flagged something requiring code changes that you fixed:

```bash
git add <only the files you changed>
git commit -m "chore(intervention-toggle): post-implementation lint/build fixes"
```

If everything was already green, skip the commit.

---

## Task 15: Manual smoke test in Extension Development Host (UAT)

**Files:** none (manual)

This task confirms the toggle behaves correctly end-to-end in a live VS Code session. It is **not** automatable in the unit-test harness because it exercises the real `vscode.window` modal popups and Extension Settings UI.

- [ ] **Step 1: Launch the Extension Development Host**

Open the worktree in VS Code and press F5 to launch the Extension Development Host (the existing `.vscode/launch.json` should already be set up).

- [ ] **Step 2: Verify the new setting is visible**

In the EDH window, open Settings (Cmd+,) and search for `artemis.struggleDetection.showInterventions`. Verify:
- It appears with the expected description.
- It is checked by default (default `true`).

- [ ] **Step 3: Verify "on" path still works**

Authenticate to a test Artemis instance, open a programming exercise, and trigger struggle (e.g. cause repeated build errors). Verify status-bar lightbulb / notification appears as before.

- [ ] **Step 4: Verify "off" path suppresses UI**

Toggle the setting off. Trigger struggle the same way. Verify:
- No status-bar lightbulb appears.
- No info / warning popups appear.
- The Iris Chat icon is unaffected.

- [ ] **Step 5: Verify recording captures suppressed events**

With the setting still off, finish the session and locate the recording JSONL under `globalStorageUri/recordings/<sessionId>/`. Open the JSONL and grep for `"action":"suppressed"` and `"type":"configurationSnapshot"`. Confirm both appear with sensible values.

- [ ] **Step 6: Verify live-toggle works**

Re-enable the setting mid-session: trigger struggle to confirm UI returns; toggle off again to confirm UI disappears.

- [ ] **Step 7: Note any deviations**

If any step fails, file a follow-up — do not silently fix during this task. The unit tests are the binding contract; the smoke test only checks integration.

- [ ] **Step 8: Commit nothing**

This task does not modify code.

---

## Done

After Task 15:
- All 14+ tasks committed on `feat/intervention-ui-toggle`
- Unit tests green
- Type-check + lint clean
- Production build succeeds
- Manual smoke test signed off

Next steps (handled outside this plan):
- Open a PR against `dev` (per `.claude/CLAUDE.md`).
- Codex review of the diff before merge (per global CLAUDE.md).
- After merge, push the same branch into the standalone `~/Documents/private/artemis-extension/` copy if needed for F5 work outside the MA project.
