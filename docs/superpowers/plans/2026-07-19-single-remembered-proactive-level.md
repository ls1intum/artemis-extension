# Single Remembered Proactive-Help Level — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the proactive-help level (Off/Less/More) a single remembered setting per user (`server::principal` scope) instead of per exercise, and strip the now-meaningless `exerciseId` from the level read path.

**Architecture:** `ProactivePreferenceService` collapses its per-exercise map to one scoped scalar. The `exerciseId` argument is removed from `getLevel`/`setLevel`/`isProactiveOn`/`getProactiveLevel`/`isStudentProactiveOn` across the storage service, the telemetry contract, the telemetry wiring, `extension.ts`, the intervention service, and the command. `setStudentProactive(exerciseId, on)` keeps its id but its Off branch is restructured to clear the active exercise's surfaces regardless of which view triggered the (now global) Off.

**Tech Stack:** TypeScript (strict: `noUnusedLocals`/`noUnusedParameters`), VS Code extension host, Vitest (`test/logic`), Mocha via `@vscode/test-electron` (`test/unit`), esbuild clean-bundle boundary.

## Global Constraints

- **This is ONE atomic change / ONE commit.** Dropping `exerciseId` from the interface forces every caller to change in the same commit or `check-types` fails. Do NOT try to commit intermediate states that leave `check-types` red.
- **Scope key stays `server::principal`.** Drop only the exercise dimension. Default level is `more`.
- **No migration.** Never read or write the legacy `proactive.preference::<scope>` map key. The new key is `proactive.level::<scope>` holding one scalar.
- **`getLevel` validates** the persisted value is exactly `off`/`less`/`more`; anything else → `more`.
- **Shadow always holds the current level string, including `more`.** Only *persistence* deletes the key on `more`.
- **`setStudentProactive(exerciseId, on)` keeps its `exerciseId`.** Only the level read path loses the param.
- **The service imports nothing** from `services/struggle` or `services/intervention` (clean-bundle boundary).
- **`noUnusedLocals`/`noUnusedParameters` are on:** after stripping the arg from a `this._deps.getProactiveLevel(exId)` / `isStudentProactiveOn(exId)` call, any `const exId = this._deps.getExerciseId();` that becomes unused MUST be deleted (TS6133). `check-types` is the deterministic oracle for which locals are orphaned.
- AI/attribution must NOT appear in commit messages.

---

### Task 1: Single remembered level + global-Off surface clear + param strip

**Files:**
- Modify: `extension/src/extension/services/proactivePreferenceService.ts` (full rewrite of the class body)
- Modify: `extension/src/extension/telemetry/contract.ts:122,128` (two signatures + doc)
- Modify: `extension/src/extension/telemetry/index.ts:129-130,193-194` (wiring + `getActiveProactiveLevel`)
- Modify: `extension/src/extension.ts:88-91,104-105` (deps)
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` (`_deps` signatures :133,:139; call sites; `setStudentProactive` :1806-1818; comments)
- Modify: `extension/src/extension/controller/commands/proactiveControlCommands.ts:36,53`
- Modify (comment-only): `extension/src/shared/messageContracts/proactiveLevel.ts`, `extension/src/shared/messageContracts/extensionMessages.ts:178`, `extension/src/extension/provider/artemisWebviewProvider.ts:344`, `extension/src/extension/controller/commands/types.ts:51`, `extension/src/extension/services/struggle/struggleCoordinator.ts:96`
- Test: `extension/test/logic/proactivePreferenceService.test.ts` (rewrite)
- Test: `extension/test/logic/telemetry/createStruggleEngine.proactiveLevel.test.ts` (rewrite)
- Test: `extension/test/logic/struggleIntervention/struggleInterventionService.test.ts` (invert one test)
- Test: `extension/test/logic/struggleIntervention/evidenceGate.test.ts` (add one test)
- Test: `extension/test/logic/proactiveControlCommands.test.ts` (drop id from 2 assertions)
- Verify-only: `extension/test/logic/struggleIntervention/helpers.ts` (already no-arg — confirm no change needed)

**Interfaces (final signatures after this task):**
- `ProactivePreferenceService.getLevel(): ProactiveLevel`
- `ProactivePreferenceService.setLevel(level: ProactiveLevel): void`
- `ProactivePreferenceService.isProactiveOn(): boolean`
- `StruggleEngineDeps.getProactiveLevel(): ProactiveLevel`, `StruggleEngineDeps.isStudentProactiveOn(): boolean` (telemetry/contract.ts)
- `StruggleInterventionDeps.getProactiveLevel(): ProactiveLevel`, `StruggleInterventionDeps.isStudentProactiveOn(): boolean`
- `setStudentProactive(exerciseId: number, on: boolean): void` (unchanged signature; body restructured)

---

- [ ] **Step 1: Rewrite the storage service**

Replace the entire body of `extension/src/extension/services/proactivePreferenceService.ts` with:

```ts
import type * as vscode from 'vscode';

import type { ProactiveLevel } from '@shared/messageContracts';

import { type CourseAccessScope, normalizeScopeSegment } from '@extension/services/courseAccessStorageService';
import { LogCategory, logger } from '@extension/services/loggingService';

const STORAGE_KEY_PREFIX = 'proactive.level';

const LEVELS: readonly ProactiveLevel[] = ['off', 'less', 'more'];

/**
 * Durable single proactive-help level (spec §12.2, Off/Less/More), stored in VS Code globalState
 * keyed by server + principal. The level is remembered ONCE per user (issue #341), not per exercise:
 * every exercise reads the same value. Default is `more`, so proactive help exists without any setup.
 * Plain client service — imports NOTHING from services/struggle|intervention, so it stays in the
 * clean bundle. The legacy per-exercise map key (`proactive.preference::…`) is deliberately never
 * read or written (the feature was unreleased when this landed, so there is nothing to migrate).
 */
export class ProactivePreferenceService {
    private readonly _shadow = new Map<string, ProactiveLevel>();
    private _writeChain: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly _globalState: vscode.Memento,
        private readonly _getScope: () => CourseAccessScope | null,
    ) {}

    getLevel(): ProactiveLevel {
        const key = this._scopeKey();
        if (!key) { return 'more'; }
        const cached = this._shadow.get(key);
        if (cached) { return cached; }
        const level = this._validate(this._globalState.get<unknown>(key));
        this._shadow.set(key, level);
        return level;
    }

    setLevel(level: ProactiveLevel): void {
        const key = this._scopeKey();
        if (!key) { return; }
        // The shadow always holds the current level (incl. `more`) so a read right after this write is
        // correct even while the async persistence below is still queued.
        this._shadow.set(key, level);
        // Persist `off`/`less`; delete the key on `more` (keeps the "absent = default" convention).
        const persisted = level === 'more' ? undefined : level;
        this._writeChain = this._writeChain.catch(() => undefined)
            .then(() => this._globalState.update(key, persisted))
            .catch((err: unknown) => logger.warn('Failed to persist proactive level', LogCategory.VIEW, err));
    }

    isProactiveOn(): boolean {
        return this.getLevel() !== 'off';
    }

    /** globalState is runtime-untyped: accept only a valid level scalar, default everything else to `more`. */
    private _validate(v: unknown): ProactiveLevel {
        return typeof v === 'string' && (LEVELS as readonly string[]).includes(v) ? (v as ProactiveLevel) : 'more';
    }

    private _scopeKey(): string | null {
        const scope = this._getScope();
        if (!scope) { return null; }
        const segment = normalizeScopeSegment(scope);
        return segment ? `${STORAGE_KEY_PREFIX}::${segment}` : null;
    }
}
```

- [ ] **Step 2: Rewrite the storage service test**

Replace the entire body of `extension/test/logic/proactivePreferenceService.test.ts` with:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it } from 'vitest';

import { normalizeScopeSegment } from '@extension/services/courseAccessStorageService';
import { ProactivePreferenceService } from '@extension/services/proactivePreferenceService';

function fakeMemento(): import('vscode').Memento {
    const store = new Map<string, unknown>();
    return {
        get: <T>(k: string, d?: T) => (store.has(k) ? (store.get(k) as T) : d),
        update: async (k: string, v: unknown) => { if (v === undefined) { store.delete(k); } else { store.set(k, v); } },
        keys: () => [...store.keys()],
    } as unknown as import('vscode').Memento;
}

/** Let the private serialized write chain settle before inspecting raw globalState / a fresh instance. */
const settle = () => new Promise<void>(r => setTimeout(r, 0));

describe('ProactivePreferenceService', () => {
    const scope = { serverUrl: 'https://artemis.example.com', principal: { id: 7, login: 'student1' } };
    const levelKey = `proactive.level::${normalizeScopeSegment(scope)}`;
    let svc: ProactivePreferenceService;
    beforeEach(() => { svc = new ProactivePreferenceService(fakeMemento(), () => scope); });

    it('defaults to level "more" (and On) when nothing is stored', () => {
        expect(svc.getLevel()).toBe('more');
        expect(svc.isProactiveOn()).toBe(true);
    });

    it.each(['off', 'less', 'more'] as const)('round-trips level %s (same-instance shadow)', level => {
        svc.setLevel(level);
        expect(svc.getLevel()).toBe(level);
    });

    it('is a SINGLE remembered level: a value set once is read back everywhere (no per-exercise keying)', () => {
        svc.setLevel('less');
        // There is no exercise dimension anymore — every read returns the one stored level.
        expect(svc.getLevel()).toBe('less');
        expect(svc.isProactiveOn()).toBe(true);
    });

    it('isProactiveOn derives from getLevel (off = false, less/more = true)', () => {
        svc.setLevel('off');
        expect(svc.isProactiveOn()).toBe(false);
        svc.setLevel('less');
        expect(svc.isProactiveOn()).toBe(true);
    });

    it('setLevel("more") reads back "more" synchronously (shadow) and deletes the persisted key', async () => {
        const memento = fakeMemento();
        const s = new ProactivePreferenceService(memento, () => scope);
        s.setLevel('off');
        await settle();
        expect(memento.get(levelKey)).toBe('off');      // 'off' actually reached persistence first

        s.setLevel('more');
        expect(s.getLevel()).toBe('more');              // shadow is authoritative, synchronously,
        //                                                 even though the async delete has not run yet
        await settle();
        expect(memento.keys()).not.toContain(levelKey); // persisted key deleted on `more`
    });

    it('persists across a fresh service instance over the same globalState', async () => {
        const memento = fakeMemento();
        new ProactivePreferenceService(memento, () => scope).setLevel('off');
        await settle();
        const reloaded = new ProactivePreferenceService(memento, () => scope);
        expect(reloaded.getLevel()).toBe('off');
    });

    it('validates a corrupt persisted scalar back to "more"', () => {
        for (const bogus of ['nonsense', false, 7, { level: 'off' }]) {
            const memento = fakeMemento();
            void memento.update(levelKey, bogus);
            expect(new ProactivePreferenceService(memento, () => scope).getLevel()).toBe('more');
        }
    });

    it('ignores the legacy per-exercise map key entirely (no migration)', () => {
        const memento = fakeMemento();
        void memento.update(`proactive.preference::${normalizeScopeSegment(scope)}`, { 42: 'off' });
        expect(new ProactivePreferenceService(memento, () => scope).getLevel()).toBe('more');
    });

    it('isolates levels by server::principal scope', async () => {
        const memento = fakeMemento();
        const scopeB = { serverUrl: 'https://artemis.example.com', principal: { id: 9, login: 'student2' } };
        new ProactivePreferenceService(memento, () => scope).setLevel('off');
        await settle();
        expect(new ProactivePreferenceService(memento, () => scopeB).getLevel()).toBe('more');
    });

    it('unresolved scope → getLevel "more" and setLevel is a no-op', () => {
        const s = new ProactivePreferenceService(fakeMemento(), () => null);
        s.setLevel('off');
        expect(s.getLevel()).toBe('more');
    });

    it('imports nothing from services/struggle or services/intervention (clean-bundle boundary)', () => {
        const src = readFileSync(
            join(__dirname, '../../src/extension/services/proactivePreferenceService.ts'),
            'utf8',
        );
        const importLines = src.split('\n').filter(l => /^\s*import\b/.test(l));
        expect(importLines.some(l => /services\/struggle|services\/intervention/.test(l))).toBe(false);
    });
});
```

- [ ] **Step 3: Run the storage test in isolation (green)**

Run: `cd extension && npx vitest run test/logic/proactivePreferenceService.test.ts`
Expected: PASS (all cases). Vitest transpiles per-file without a project type-check, so this passes even though the callers below have not been updated yet.

- [ ] **Step 4: Restructure `setStudentProactive` (Component 2b) — global Off clears the active exercise**

In `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts`, replace the `setStudentProactive` method (currently at ~1806-1818):

```ts
    setStudentProactive(exerciseId: number, on: boolean): void {
        if (this._deps.getExerciseId() !== exerciseId) { return; }
        if (on) {
            // Flipping the toggle back on is a deliberate user action (student is present).
            this._setAwaitingEvidence(false, 'proactive re-enabled');
        } else {
            this._deps.clearLamp();
            this._deps.clearInline();
            this._deps.setBadge(false);
            this._deps.hideActiveBanner();
            this._clearOutstandingOffer();
        }
    }
```

with:

```ts
    setStudentProactive(exerciseId: number, on: boolean): void {
        if (on) {
            // On = "the student is present in THIS exercise": only reset the active exercise's evidence
            // gate when the toggle came from the active exercise (keep the id guard).
            if (this._deps.getExerciseId() !== exerciseId) { return; }
            this._setAwaitingEvidence(false, 'proactive re-enabled');
        } else {
            // Off is now a GLOBAL level (#341): clear the active exercise's surfaces regardless of which
            // exercise view triggered it. The orchestrator already targets the active exercise, so this
            // is always the right instance to clear.
            this._deps.clearLamp();
            this._deps.clearInline();
            this._deps.setBadge(false);
            this._deps.hideActiveBanner();
            this._clearOutstandingOffer();
        }
    }
```

- [ ] **Step 5: Invert the cross-exercise-Off surface test**

In `extension/test/logic/struggleIntervention/struggleInterventionService.test.ts`, replace the test currently reading *"setStudentProactive on a NON-active exercise does not touch live surfaces (no cross-exercise clobber)"*:

```ts
    it('setStudentProactive on a NON-active exercise does not touch live surfaces (no cross-exercise clobber)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc.setStudentProactive(999, false);   // active is 42, not 999
        expect(deps.clearInline).not.toHaveBeenCalled();
        expect(deps.clearLamp).not.toHaveBeenCalled();
        expect(deps.setBadge).not.toHaveBeenCalled();
        expect(deps.hideActiveBanner).not.toHaveBeenCalled();
    });
```

with (behavior inverted — global Off clears the active exercise regardless of the triggering view):

```ts
    it('setStudentProactive(false) from a NON-active exercise STILL clears the active exercise surfaces (#341 global Off)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc.setStudentProactive(999, false);   // active is 42; a global Off clears regardless of source
        expect(deps.clearInline).toHaveBeenCalled();
        expect(deps.clearLamp).toHaveBeenCalled();
        expect(deps.setBadge).toHaveBeenCalledWith(false);
        expect(deps.hideActiveBanner).toHaveBeenCalled();
    });
```

(The sibling test *"setStudentProactive(active exercise, false) clears …"* stays unchanged.)

- [ ] **Step 6: Add the On-half guard test (evidence gate is NOT reset from a non-active exercise)**

In `extension/test/logic/struggleIntervention/evidenceGate.test.ts`, add this test inside the existing `describe('StruggleInterventionService - evidence gate after idle-abandon', …)` block (it reuses the file's `makeService`, `simulateDelivered`, `driveIdleAbandon` helpers):

```ts
    it('setStudentProactive(true) from a NON-active exercise does NOT clear the active exercise evidence gate (#341)', () => {
        const { svc } = makeService();
        simulateDelivered(svc);
        driveIdleAbandon(svc);
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(true);

        svc.setStudentProactive(999, true);   // non-active On: the id guard keeps the gate
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(true);

        svc.setStudentProactive(42, true);    // active On: resets the gate ("student present")
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(false);
    });
```

- [ ] **Step 7: Run the two intervention test files in isolation (green)**

Run: `cd extension && npx vitest run test/logic/struggleIntervention/struggleInterventionService.test.ts test/logic/struggleIntervention/evidenceGate.test.ts`
Expected: PASS (Steps 4-6 cover the 2b behavior; the rest of these files is unaffected).

- [ ] **Step 8: Strip the param from the telemetry contract**

In `extension/src/extension/telemetry/contract.ts`, change the two declarations (currently :122 and :128) and their docs:

```ts
    /** Durable single student opt-out (spec §12.2, issue #341): false → the orchestrator suppresses proactive. */
    isStudentProactiveOn(): boolean;
    /**
     * The single proactive-help level (Off/Less/More, spec §12.2, issue #341) — the level-aware form of
     * `isStudentProactiveOn` above. Resolves the {@link StruggleEngineHandle.getActiveProactiveLevel} accessor.
     */
    getProactiveLevel(): ProactiveLevel;
```

Also replace two now-stale docs elsewhere in `contract.ts` (they describe the old per-exercise behavior, and the `getActiveProactiveLevel` one also still claims "nothing calls it yet", which is false — the throttle calls it).

Replace the whole `getActiveProactiveLevel` doc block (~:211-217) with:

```ts
    /**
     * The single remembered proactive-help level (Off/Less/More, spec §12.2, issue #341).
     * The full build reads `getProactiveLevel()` live; the clean/no-op build returns the
     * default `more`. Used by consumers such as the delivery throttle and Pull re-route.
     */
    getActiveProactiveLevel(): ProactiveLevel;
```

Replace the whole `setStudentProactive` doc block (~:218-224, the comment lines above the declaration) with:

```ts
    /**
     * Apply the transient effects of a level change: On marks the student present only
     * when `exerciseId` is active; global Off clears the active exercise's live surfaces
     * regardless of which exercise triggered it.
     */
    setStudentProactive?(exerciseId: number, on: boolean): void;
```

- [ ] **Step 9: Strip the param in the telemetry wiring and simplify `getActiveProactiveLevel`**

In `extension/src/extension/telemetry/index.ts`, change lines 129-130:

```ts
        isStudentProactiveOn: () => deps.isStudentProactiveOn(),
        getProactiveLevel: () => deps.getProactiveLevel(),
```

and replace the `getActiveProactiveLevel` definition (currently 193-194) — the active-exercise keying is gone, the level is global:

```ts
    // Single source of truth for the proactive-help level (spec §12.2, issue #341). The level is one
    // remembered setting now, so there is no active-exercise keying; getProactiveLevel() already
    // defaults to 'more' when unset. Read live so a mid-session Off/Less/More flip takes effect at once.
    const getActiveProactiveLevel = (): ProactiveLevel => deps.getProactiveLevel();
```

- [ ] **Step 10: Strip the param in `extension.ts`**

In `extension/src/extension.ts`, update the level reader and the deps (currently 88-91 and 104-105):

```ts
	// Level-aware read of the single remembered preference (spec §12.2, issue #341, Off/Less/More);
	// `isStudentProactiveOn` derives from this rather than duplicating the lookup. Default-on until wired.
	const getProactiveLevel = (): ProactiveLevel => proactivePreferenceRef?.getLevel() ?? 'more';
```

```ts
		isStudentProactiveOn: () => getProactiveLevel() !== 'off',
		getProactiveLevel,
```

Also fix the stale "per-exercise preference" wording in the comment at ~85-86 (change "per-exercise preference" → "single remembered preference").

- [ ] **Step 11: Strip the param in the intervention service `_deps` and every call site**

In `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts`:

11a. `_deps` signatures (currently :133, :139):

```ts
    /** Durable single student opt-out (spec §12.2, issue #341): false -> the orchestrator suppresses proactive. */
    isStudentProactiveOn(): boolean;
    /**
     * The single proactive-help level (Off/Less/More, spec §12.2, issue #341). Used by the client-side Pull
     * re-route: an inbound `active` event while the level is `less` is downgraded to the ambient/PARKED path.
     */
    getProactiveLevel(): ProactiveLevel;
```

11b. Apply this transformation table (use the code snippets, not raw line numbers — lines shift as you edit). After each, delete the now-orphaned `const exId = this._deps.getExerciseId();` where it was ONLY feeding this read (marked ✂ below); `check-types` in Step 15 confirms every orphan (TS6133).

- `getDebugSnapshot` IIFE — replace:
  ```ts
                studentProactiveOn: (() => {
                    const exId = this._deps.getExerciseId();
                    return exId === undefined ? true : this._deps.isStudentProactiveOn(exId);
                })(),
  ```
  with:
  ```ts
                studentProactiveOn: this._deps.isStudentProactiveOn(),
  ```
- `_suppressReason` — replace (✂ removes the `exId` line):
  ```ts
        const exId = this._deps.getExerciseId();
        if (exId !== undefined && !this._deps.isStudentProactiveOn(exId)) {
            return '  -> SKIP (student turned proactive off for this exercise)';
        }
  ```
  with:
  ```ts
        if (!this._deps.isStudentProactiveOn()) {
            return '  -> SKIP (student turned proactive off)';
        }
  ```
- decide POST (`proactivityMode`): `this._deps.getProactiveLevel(exerciseId) === 'less'` → `this._deps.getProactiveLevel() === 'less'` (keep the `exerciseId` local — obtained from `getExerciseId()` at ~:634 and used by the `postIntervention` body at ~:698).
- reconcile/accept path (the block that does `_clearInFlight()` + `_dropStaleRow` + `return`) — replace (✂):
  ```ts
        const exId = this._deps.getExerciseId();
        if (exId !== undefined && !this._deps.isStudentProactiveOn(exId)) {
            this._clearInFlight();
            if (messageId !== undefined && messageId !== null) { this._dropStaleRow(messageId); }
            return;
        }
  ```
  with:
  ```ts
        if (!this._deps.isStudentProactiveOn()) {
            this._clearInFlight();
            if (messageId !== undefined && messageId !== null) { this._dropStaleRow(messageId); }
            return;
        }
  ```
- `onServerActive` — this method's single `const exId = this._deps.getExerciseId();` feeds BOTH the opt-out guard and the Pull-reroute `level`. Replace the guard as above, and replace the level read:
  ```ts
        const level = exId !== undefined ? this._deps.getProactiveLevel(exId) : 'more';
  ```
  with:
  ```ts
        const level = this._deps.getProactiveLevel();
  ```
  then delete the now-orphaned `const exId = this._deps.getExerciseId();` at the top of `onServerActive`.
- follow-up bubble gate: `|| !this._deps.isStudentProactiveOn(exerciseId)` → `|| !this._deps.isStudentProactiveOn()` (keep the `exerciseId` local — used elsewhere in the method).
- help_request POST and confirm_close POST `proactivityMode`: `this._deps.getProactiveLevel(exerciseId) === 'less'` → `this._deps.getProactiveLevel() === 'less'` (keep the `exerciseId` local — obtained from `getExerciseId()` at ~:1415 / ~:1504 and used by the `postIntervention` bodies at ~:1446 / ~:1533).
- `_canOfferStuck`, `_raiseStuckOffer`, `_raiseAbandonOffer` — each has:
  ```ts
        const exId = this._deps.getExerciseId();
        const level = exId !== undefined ? this._deps.getProactiveLevel(exId) : 'more';
  ```
  replace both lines with:
  ```ts
        const level = this._deps.getProactiveLevel();
  ```

11c. Fix any residual "per-exercise (level/opt-out)" wording in this file's comments while editing (e.g. the `isStudentProactiveOn` skip message already handled above); the level is now a single setting.

- [ ] **Step 12: Strip the param in the command**

In `extension/src/extension/controller/commands/proactiveControlCommands.ts`:
- line ~36: `this.context.proactivePreference?.setLevel(exerciseId, level);` → `this.context.proactivePreference?.setLevel(level);`
- line ~53: `const stored = this.context.proactivePreference?.getLevel(exerciseId) ?? 'more';` → `const stored = this.context.proactivePreference?.getLevel() ?? 'more';`

(The command still receives `exerciseId` from the webview for the card push, `setStudentProactive(exerciseId, …)`, and `collapseProactiveEpisodes()` — leave those uses intact.)

- [ ] **Step 13: Update the command test assertions**

In `extension/test/logic/proactiveControlCommands.test.ts`, drop the id from the two `setLevel` expectations:
- `expect(h.pref.setLevel).toHaveBeenCalledWith(42, 'off');` → `expect(h.pref.setLevel).toHaveBeenCalledWith('off');`
- `expect(h.pref.setLevel).toHaveBeenCalledWith(42, 'less');` → `expect(h.pref.setLevel).toHaveBeenCalledWith('less');`

(The harness's `getLevel: vi.fn(() => over.level ?? 'more')` already ignores args — no change. `setStudentProactive` stays called with `(42, …)`.)

- [ ] **Step 14: Rewrite the per-exercise telemetry test**

Replace the entire body of `extension/test/logic/telemetry/createStruggleEngine.proactiveLevel.test.ts` from the `fakeDeps` helper onward. Keep the `vi.mock('vscode', …)` block and imports (lines 1-61) exactly as-is; replace lines 63-128 with:

```ts
/** A fully-formed `StruggleEngineDeps` fake; `getProactiveLevel` (now exercise-independent) is under test. */
function fakeDeps(getProactiveLevel: () => ProactiveLevel): StruggleEngineDeps {
    return {
        hub: new TestSensorHub(),
        exerciseRegistry: new ExerciseRegistry(),
        isIrisEnabled: () => true,
        context: {
            subscriptions: [],
            globalStorageUri: { fsPath: '/tmp/artemis-test-struggle' },
            extensionUri: { path: '/ext', fsPath: '/ext' },
        } as unknown as StruggleEngineDeps['context'],
        postIntervention: vi.fn(async () => 'accepted' as const),
        isStudentProactiveOn: () => true,
        getProactiveLevel,
        openProactiveSession: vi.fn(async () => undefined),
        setProactiveBadge: vi.fn(),
        postOptimisticBubble: vi.fn(),
        postLiveEpisode: vi.fn(),
        revealAmbient: vi.fn(async () => ({}) as never),
        setEpisodeOutcome: vi.fn(async () => ({ applied: true })),
        postRevealBubble: vi.fn(),
        reconcileOptimisticBubble: vi.fn(),
        subscribeStruggleTopic: () => ({ dispose: () => {} }),
        cancelOutstandingStruggleJob: vi.fn(async () => undefined),
        foldEpisode: vi.fn(),
        postRemoveMessage: vi.fn(),
        deleteSupersededProactiveMessage: vi.fn(async () => undefined),
        showNudgeBanner: vi.fn(),
        hideNudgeBanner: vi.fn(),
        postOfferBubble: vi.fn(),
        resolveOfferBubble: vi.fn(),
        showOfferBanner: vi.fn(),
    };
}

describe('full struggle-engine seam: getActiveProactiveLevel', () => {
    it('reflects the single global level, independent of the active exercise (#341)', () => {
        const getProactiveLevel = vi.fn((): ProactiveLevel => 'less');
        const handle = createStruggleEngine(fakeDeps(getProactiveLevel));

        // No active exercise: the global level already applies (no per-exercise keying / 'more' gate).
        expect(handle.getActiveProactiveLevel()).toBe('less');

        // Starting/switching/ending a session does NOT re-key the level; it stays the global value.
        handle.coordinator.startExerciseSession(42);
        expect(handle.getActiveProactiveLevel()).toBe('less');
        handle.coordinator.startExerciseSession(7);
        expect(handle.getActiveProactiveLevel()).toBe('less');
        handle.coordinator.endExerciseSession();
        expect(handle.getActiveProactiveLevel()).toBe('less');

        // Every read passes NO exercise id (the strip removed the argument).
        for (const call of getProactiveLevel.mock.calls) { expect(call).toEqual([]); }
    });

    it('reads the level live on each call (mid-session flips take effect)', () => {
        let level: ProactiveLevel = 'more';
        const handle = createStruggleEngine(fakeDeps(() => level));
        handle.coordinator.startExerciseSession(42);
        expect(handle.getActiveProactiveLevel()).toBe('more');
        level = 'off';
        expect(handle.getActiveProactiveLevel()).toBe('off');
    });

    it('no-op build: always returns \'more\' (no engine, no active-exercise concept)', () => {
        const handle = createNoopStruggleEngine(fakeDeps(() => 'off'));
        expect(handle.getActiveProactiveLevel()).toBe('more');
    });
});
```

- [ ] **Step 15: Comment-only cleanup in the remaining files**

Update stale "per-exercise (level/preference)" wording to "single remembered level (issue #341)" — no behavior change — in:
- `extension/src/shared/messageContracts/proactiveLevel.ts` (header)
- `extension/src/shared/messageContracts/extensionMessages.ts:178`
- `extension/src/extension/provider/artemisWebviewProvider.ts:344` (the `proactivePreference` getter doc)
- `extension/src/extension/controller/commands/types.ts:51`
- `extension/src/extension/services/struggle/struggleCoordinator.ts:96`

(The exercise-tagged webview state and the `setProactiveLevel` message's `exerciseId` field stay — only the wording changes.)

- [ ] **Step 16: Confirm `helpers.ts` needs no change**

Open `extension/test/logic/struggleIntervention/helpers.ts` and confirm its `fakeDeps` already stubs `isStudentProactiveOn: () => true` and `getProactiveLevel: () => 'more'` with NO parameters (it does). No edit needed — the new no-arg signatures accept these as-is.

- [ ] **Step 17: Type-check the whole project (the atomic gate)**

Run: `cd extension && npm run check-types`
Expected: PASS with no errors. If it reports `TS6133` on a `const exId = this._deps.getExerciseId();`, that local is orphaned — delete it. If it reports an orphan on a `getProactiveLevel`/`isStudentProactiveOn` call still passing an argument, remove that argument. Do NOT delete an `exId`/`exerciseId` that `check-types` does NOT flag (it is used elsewhere).

- [ ] **Step 18: Run the full Vitest logic + react suite**

Run: `cd extension && npm run test:react`
Expected: PASS. If a struggleIntervention test that consumes `helpers.ts` fails because it passed an id to `getProactiveLevel`/`isStudentProactiveOn`, drop the id there.

- [ ] **Step 19: Compile and run the Mocha unit suite**

Run: `cd extension && npm run compile-tests && npm run test:unit`
Expected: PASS. Read `extension/reports/mocha-results.xml` if the console is truncated.

- [ ] **Step 20: Verify the clean-bundle boundary still holds**

Run: `cd extension && npm run package:openvsx`
Expected: the clean-bundle verification passes (the storage service still imports nothing from `services/struggle|intervention`).

- [ ] **Step 21: Commit**

```bash
cd /Users/liamberger/Documents/private/MA/artemis-extension
git add extension/src/extension/services/proactivePreferenceService.ts \
        extension/src/extension/telemetry/contract.ts \
        extension/src/extension/telemetry/index.ts \
        extension/src/extension.ts \
        extension/src/extension/services/struggleIntervention/struggleInterventionService.ts \
        extension/src/extension/controller/commands/proactiveControlCommands.ts \
        extension/src/shared/messageContracts/proactiveLevel.ts \
        extension/src/shared/messageContracts/extensionMessages.ts \
        extension/src/extension/provider/artemisWebviewProvider.ts \
        extension/src/extension/controller/commands/types.ts \
        extension/src/extension/services/struggle/struggleCoordinator.ts \
        extension/test/logic/proactivePreferenceService.test.ts \
        extension/test/logic/telemetry/createStruggleEngine.proactiveLevel.test.ts \
        extension/test/logic/struggleIntervention/struggleInterventionService.test.ts \
        extension/test/logic/struggleIntervention/evidenceGate.test.ts \
        extension/test/logic/proactiveControlCommands.test.ts
git commit -m "feat(struggle): single remembered proactive level, not per-exercise (#341)"
```

## Self-Review

**1. Spec coverage:**
- Component 1 (storage collapse, scalar+validation+shadow-more, no migration) → Steps 1-3, 15. ✅
- Component 2 (param strip across service/contract/telemetry/extension/command) → Steps 8-12, 17. ✅
- Component 2b (global-Off surface clear) → Steps 4-7. ✅
- Semantic note (undefined-exercise guards collapse) → Step 11b (the four guards). ✅
- Component 3 (no webview change) → confirmed: no webview source file in the list. ✅
- Testing (preference rewrite, per-exercise telemetry rewrite, 2b tests, command id-drop, helpers unchanged, gates) → Steps 2, 5-6, 13-14, 16, 17-20. ✅
- Comment cleanup (5 files) → Steps 10, 11c, 15. ✅

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to". Every code step shows complete code. The one compiler-guided step (17) names the exact error code (TS6133) and the deterministic rule.

**3. Type consistency:** Final signatures are `getLevel()`, `setLevel(level)`, `isProactiveOn()`, `getProactiveLevel()`, `isStudentProactiveOn()`, `setStudentProactive(exerciseId, on)` — used identically in the service, both `_deps` interfaces, the wiring, and the tests. `getActiveProactiveLevel()` unchanged in signature.
