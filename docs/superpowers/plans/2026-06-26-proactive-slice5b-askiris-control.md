# Proactive Intervention — Slice 5b: AskIris per-exercise On/Off control + 3-state badge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the student an explicit **On / Off** switch for proactive struggle help on the Exercise-Detail view (the AskIris card), with a truthful **3-state badge** — **On**, **Auto-paused** (the §5.2 delivery backoff is currently paused), or **Off** (the student's explicit choice). The switch sets a **durable per-exercise preference** (client-side, default On) that the orchestrator consumes to suppress proactive surfacing; "Auto-paused" reflects the Slice-4a backoff and offers a **Resume** action.

**Sequencing.** Builds on slices 1-4b (the orchestrator + its Slice-4a backoff counters `_dismissStrikes`/`_annoyance`/`_softSkipBudget` + `isPaused()`) and 5a (the `@telemetry` seam contract). Slices execute in order; a review against un-applied `HEAD` will see those prerequisites absent — expected.

**Scope of THIS slice (§12.2 control only).** The On/Off switch + the 3-state badge + Resume, the client preference service, and the seam/orchestrator wiring that makes the preference suppress proactive and exposes the pause state. **Out of scope (Slice 5c):** the full card-state matrix (Available / Off-disabled-for-course / Unavailable / Degraded) and the §14 cases-2/3 exercise-view banner. 5b assumes the "Available" case (Iris on, course-proactive on, consent ok); 5c adds the other states + the banner + the AI-opt-in gating of the switch.

**Architecture.** A client-side `ProactivePreferenceService` (VS Code `globalState`, keyed by server+principal, value = a per-exercise-id on/off map; default On) mirrors `CourseAccessStorageService`. The orchestrator (behind the `@telemetry` seam) reads the preference via an injected `isStudentProactiveOn(exerciseId)` dep and **suppresses** the POST/surface when the student turned it off; it exposes `isProactivePaused(exerciseId)`, `setStudentProactive(on)`, and `resumeProactive()` on the `StruggleEngineHandle`. The webview AskIris card requests its state on every `ExerciseDetailInit` (`requestProactiveControl`) and after each action; the host (a new `ProactiveControlCommandModule`, wired through `CommandContext` exactly like the existing `struggleLiveFeed` seam capability) reads the preference + pause state and replies with an `UpdateProactiveControl` message. **No live auto-pause push in 5b** — the webview re-requests the control state on every `ExerciseDetailInit` (which the provider re-posts on each sidebar visibility refresh via `sendInitData()`) and after every control action, so the badge is correct on view open, on re-focus, and after each action; a backoff auto-pause that flips while the card is continuously visible shows on the next refresh. (A live event push is a small 5c add-on.)

**Tech Stack:** Extension (TypeScript + React, Vitest `test/logic` + `test/react`). No Artemis/Pyris change.

Spec refs: §12.2 (the On/Off switch + 3-state badge + Resume + the "Available" card state), §5.2 (the backoff the "Auto-paused" badge reflects), §16 (the per-exercise opt-out is the only student-facing setting; it is client-side).

## Global Constraints

- **Branch:** `feat/struggle-v3-integration`. Not `dev`/`main`.
- **Commit messages:** Conventional Commits. **No AI attribution** (no `Co-Authored-By`, no `🤖`, no "Generated with"). Overrides any default trailer.
- **Staging:** exact files only. `git` from the repo root `/Users/liamberger/Documents/private/MA/artemis-extension`; run `npx vitest`/`npm run` from `extension/`. Never `git add -A`/`.`.
- **Verification:** targeted Vitest green + `npm run check-types` (eslint misses TS6133; `check-types` is the real gate).
- **Clean-build seam (`@telemetry`):** the new orchestrator capabilities cross the seam via `StruggleEngineHandle` + `StruggleEngineDeps`; the no-op factory must implement the same surface so the Open VSX bundle still excludes the engine (`scripts/verify-clean-bundle.js`). The preference service is a plain client service (always bundled) — it must NOT import anything from `services/struggle|intervention`.
- **Invariants:** Desktop = Cookie auth, Theia = Bearer (untouched). No `^`/`~` added. CSS-module lookups static camelCase.
- **Default On (§12.2):** a never-set preference reads as On; only an explicit Off suppresses.

---

## File structure

- Create: `extension/src/extension/services/proactivePreferenceService.ts` — durable per-exercise on/off in `globalState`.
- Modify: `extension/src/extension/telemetry/contract.ts` — `StruggleEngineDeps.isStudentProactiveOn` + `StruggleEngineHandle` methods.
- Modify: `extension/src/extension/telemetry/noop.ts` — no-op implementations.
- Modify: `extension/src/extension/telemetry/index.ts` — thread the dep + return the handle methods.
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` — consume the preference + `isProactivePaused`/`setStudentProactive`/`resumeProactive`.
- Modify: `extension/src/shared/messageContracts/webviewCommands.ts` — 3 new commands.
- Modify: `extension/src/shared/messageContracts/extensionMessages.ts` — `UpdateProactiveControl`.
- Modify: `extension/src/extension/controller/commands/types.ts` — `CommandContext` fields.
- Create: `extension/src/extension/controller/commands/proactiveControlCommands.ts` — the command module.
- Modify: `extension/src/extension/controller/webViewMessageHandler.ts` — constructor params + context + module registration.
- Modify: `extension/src/extension/provider/artemisWebviewProvider.ts` — construct + expose `proactivePreference`; pass it + `proactiveControl` to the message handler.
- Modify: `extension/src/extension/provider/artemisWebviewProviderDeps.ts` — `proactiveControl` dep.
- Modify: `extension/src/extension.ts` — forward-declare the provider; build the `proactiveControl` capability from the engine handle; thread `isStudentProactiveOn` (lazy, reads the provider's preference); pass `proactiveControl` into the provider deps.
- Modify: `extension/src/webview/components/AskIris/AskIris.tsx` (+ `.module.css`) — the switch + 3-state badge + Resume.
- Modify: `extension/src/webview/views/ExerciseDetail/ExerciseDetailView.tsx`, `extension/src/webview/stores/useExerciseDetailStore.ts` — request (on each `ExerciseDetailInit`) + store the control state, pass to AskIris.
- Test: `extension/test/logic/proactivePreferenceService.test.ts`, `extension/test/logic/struggleIntervention/struggleInterventionService.test.ts` (extend), `extension/test/react/AskIris.proactiveControl.test.tsx`.

---

### Task 1: Client preference service (`globalState`)

**Files:**
- Create: `extension/src/extension/services/proactivePreferenceService.ts`
- Modify: `extension/src/extension/services/courseAccessStorageService.ts` (export `normalizeScopeSegment`)
- Test: `extension/test/logic/proactivePreferenceService.test.ts`

**Interfaces:**
- Produces: `class ProactivePreferenceService` constructed `(globalState: vscode.Memento, getScope: () => CourseAccessScope | null)` (reuses the existing `CourseAccessScope` from `courseAccessStorageService`, so the provider can pass its `() => this._currentCourseAccessScope()` verbatim); `isProactiveOn(exerciseId: number): boolean` (default true); `setProactiveOn(exerciseId: number, on: boolean): void` (persisted; only `false` is stored, an `on=true` clears the entry so the default-on map stays small).

- [ ] **Step 1: Failing test**

`proactivePreferenceService.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { ProactivePreferenceService } from '@extension/services/proactivePreferenceService';

function fakeMemento(): import('vscode').Memento {
    const store = new Map<string, unknown>();
    return {
        get: <T>(k: string, d?: T) => (store.has(k) ? (store.get(k) as T) : d),
        update: async (k: string, v: unknown) => { if (v === undefined) { store.delete(k); } else { store.set(k, v); } },
        keys: () => [...store.keys()],
    } as unknown as import('vscode').Memento;
}

describe('ProactivePreferenceService', () => {
    const scope = { serverUrl: 'https://artemis.example.com', principal: { id: 7, login: 'student1' } };
    let svc: ProactivePreferenceService;
    beforeEach(() => { svc = new ProactivePreferenceService(fakeMemento(), () => scope); });

    it('defaults to On for an unseen exercise', () => {
        expect(svc.isProactiveOn(42)).toBe(true);
    });

    it('persists an explicit Off and reads it back', () => {
        svc.setProactiveOn(42, false);
        expect(svc.isProactiveOn(42)).toBe(false);
        svc.setProactiveOn(42, true);
        expect(svc.isProactiveOn(42)).toBe(true);   // back to default-on
    });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/logic/proactivePreferenceService.test.ts ) 2>&1 | tail -20
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement (mirror `CourseAccessStorageService`)**

`proactivePreferenceService.ts` — a `globalState`-backed per-exercise on/off map with a synchronous shadow cache + chained writes (mirror `courseAccessStorageService.ts`'s shadow + `_writeChain` pattern; only persist OFF entries so default-on stays implicit):
First, in `courseAccessStorageService.ts`, extract + export the scope-segment normalizer so both services key identically (refactor the existing private `buildScopeKey` to use it):
```ts
/** Normalized `<server>::<principal>` segment shared by globalState-scoped services (null if unresolved). */
export function normalizeScopeSegment(scope: CourseAccessScope): string | null {
    const server = normalizeServerUrl(scope.serverUrl);
    if (!server) { return null; }
    const principal = normalizePrincipal(scope.principal);
    if (!principal) { return null; }
    return `${server}::${principal}`;
}
// buildScopeKey becomes: const seg = normalizeScopeSegment(scope); return seg ? `${STORAGE_KEY_PREFIX}::${seg}` : null;
```
Then the new service reuses it:
```ts
import type * as vscode from 'vscode';

import { type CourseAccessScope, normalizeScopeSegment } from '@extension/services/courseAccessStorageService';
import { LogCategory, logger } from '@extension/services/loggingService';

const STORAGE_KEY_PREFIX = 'proactive.preference';

/** Exercise id -> false (explicitly off). Default-on exercises are ABSENT (keeps the map small). */
type PreferenceMap = Record<number, false>;

/**
 * Durable per-exercise "proactive struggle help on/off" preference (spec §12.2), stored in VS Code globalState
 * keyed by server + principal. Default ON: a never-set exercise reads true. Plain client service — imports NOTHING
 * from services/struggle|intervention, so it stays in the clean bundle.
 */
export class ProactivePreferenceService {
    private readonly _shadow = new Map<string, PreferenceMap>();
    private _writeChain: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly _globalState: vscode.Memento,
        private readonly _getScope: () => CourseAccessScope | null,
    ) {}

    isProactiveOn(exerciseId: number): boolean {
        const key = this._scopeKey();
        if (!key || !Number.isFinite(exerciseId)) { return true; }
        return this._map(key)[exerciseId] !== false;
    }

    setProactiveOn(exerciseId: number, on: boolean): void {
        const key = this._scopeKey();
        if (!key || !Number.isFinite(exerciseId)) { return; }
        const next: PreferenceMap = { ...this._map(key) };
        if (on) { delete next[exerciseId]; } else { next[exerciseId] = false; }
        this._shadow.set(key, next);
        const snapshot = { ...next };
        this._writeChain = this._writeChain.catch(() => undefined)
            .then(() => this._globalState.update(key, snapshot))
            .catch((err: unknown) => logger.warn('Failed to persist proactive preference', LogCategory.VIEW, err));
    }

    private _map(key: string): PreferenceMap {
        const cached = this._shadow.get(key);
        if (cached) { return cached; }
        const persisted = this._globalState.get<PreferenceMap>(key, {});
        const copy: PreferenceMap = {};
        for (const [id, v] of Object.entries(persisted)) {
            if (v === false && Number.isFinite(Number(id))) { copy[Number(id)] = false; }
        }
        this._shadow.set(key, copy);
        return copy;
    }

    private _scopeKey(): string | null {
        const scope = this._getScope();
        if (!scope) { return null; }
        const segment = normalizeScopeSegment(scope);
        return segment ? `${STORAGE_KEY_PREFIX}::${segment}` : null;
    }
}
```

- [ ] **Step 4: Run green + type-check + commit**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/logic/proactivePreferenceService.test.ts && npm run check-types ) 2>&1 | tail -15
git -C /Users/liamberger/Documents/private/MA/artemis-extension add \
    extension/src/extension/services/proactivePreferenceService.ts \
    extension/src/extension/services/courseAccessStorageService.ts \
    extension/test/logic/proactivePreferenceService.test.ts
git -C /Users/liamberger/Documents/private/MA/artemis-extension commit -m "feat(struggle): durable per-exercise proactive on/off preference (client globalState)"
```

---

### Task 2: Seam + orchestrator — consume the preference, expose pause + resume

**Files:**
- Modify: `extension/src/extension/telemetry/contract.ts`, `telemetry/noop.ts`, `telemetry/index.ts`
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts`
- Test: `extension/test/logic/struggleIntervention/struggleInterventionService.test.ts`

**Interfaces:**
- Produces: `StruggleEngineDeps.isStudentProactiveOn(exerciseId: number): boolean` (consumed: suppress POST/surface when off); `StruggleEngineHandle.isProactivePaused(exerciseId: number): boolean`, `setStudentProactive(on: boolean): void`, `resumeProactive(): void`. The orchestrator gains a `isStudentProactiveOn` dep, an `isProactivePaused`, a `resumeProactive` (clears the Slice-4a counters), and a `setStudentProactive` (off → clear lamp/badge; on → resume).

- [ ] **Step 1: Failing logic tests**

In `struggleInterventionService.test.ts` (the `fakeDeps` builder gains `isStudentProactiveOn`):
```ts
it('student-off suppresses the proactive POST entirely', async () => {
    const post = vi.fn(async () => 'accepted' as const);
    const deps = fakeDeps({ postIntervention: post, isStudentProactiveOn: () => false });
    const svc = new StruggleInterventionService(deps);
    svc.onTick(tick(530));
    svc.deliver(alert());
    await new Promise(r => setTimeout(r, 0));
    expect(post).not.toHaveBeenCalled();
    expect(deps.showAmbient).not.toHaveBeenCalled();
});

it('resumeProactive clears an auto-pause', () => {
    const deps = fakeDeps();
    const svc = new StruggleInterventionService(deps);
    for (let i = 0; i < 5; i++) { svc.recordChatDismiss(); }   // Slice 4b: drives the backoff to paused
    expect(svc.isProactivePaused(42)).toBe(true);              // 42 is fakeDeps' active exercise
    svc.resumeProactive();
    expect(svc.isProactivePaused(42)).toBe(false);
});

it('inbound ambient/active are dropped when the student turned proactive off (mid-flight opt-out)', () => {
    const deps = fakeDeps({ isStudentProactiveOn: () => false });
    const svc = new StruggleInterventionService(deps);
    svc.onServerAmbient('hint', undefined, undefined, undefined);
    svc.onServerActive(99);
    expect(deps.showAmbient).not.toHaveBeenCalled();
    expect(deps.showInline).not.toHaveBeenCalled();
    expect(deps.showActiveNotification).not.toHaveBeenCalled();
});

it('setStudentProactive(false) clears a standing inline cue + lamp + badge', () => {
    const deps = fakeDeps();
    const svc = new StruggleInterventionService(deps);
    svc.setStudentProactive(false);
    expect(deps.clearInline).toHaveBeenCalled();
    expect(deps.clearLamp).toHaveBeenCalled();
    expect(deps.setBadge).toHaveBeenCalledWith(false);
});
```
(`isProactivePaused(42)` works because `fakeDeps().getExerciseId` returns 42; `recordChatDismiss` + `isPaused`/the counters are Slice-4a/4b members. The inbound-drop test guards the mid-flight opt-out path added in Step 3; the inline-clear test locks the codex-r2 fix that Off clears the inline cue too.)

- [ ] **Step 2: Run to verify failure**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/logic/struggleIntervention/struggleInterventionService.test.ts ) 2>&1 | tail -25
```
Expected: FAIL — `isStudentProactiveOn` dep / `isProactivePaused` / `resumeProactive` do not exist.

- [ ] **Step 3: Orchestrator — dep + gate + pause/resume**

In `struggleInterventionService.ts`:
- Add to `StruggleInterventionDeps`: `isStudentProactiveOn(exerciseId: number): boolean;`.
- In `_handleAlert`, after the Slice-5a `_courseProactiveOff` short-circuit, add the student-off gate (no POST, no surface):
```ts
        const studentExerciseId = this._deps.getExerciseId();
        if (studentExerciseId !== undefined && !this._deps.isStudentProactiveOn(studentExerciseId)) {
            this._dbg('  ↳ SKIP (student turned proactive off for this exercise)');
            return;
        }
```
- Guard the inbound server surfaces too (a POST may have been in flight when the student toggled off). At the top of `onServerAmbient` and `onServerActive`, after `this._serverAvailable = true; this._setInFlight(false);`:
```ts
        const exId = this._deps.getExerciseId();
        if (exId !== undefined && !this._deps.isStudentProactiveOn(exId)) {
            return;   // student opted out mid-flight: drop the surface
        }
```
- Add the pause query + resume + apply (the counters `_dismissStrikes`/`_annoyance`/`_softSkipBudget` and `isPaused()` come from Slice 4a):
```ts
    /** True iff the delivery backoff is currently paused for the active exercise (drives the AskIris "Auto-paused" badge, §12.2). */
    isProactivePaused(exerciseId: number): boolean {
        return this._deps.getExerciseId() === exerciseId && this.isPaused();
    }

    /** Clear the Slice-4a backoff (the "Resume" action / a student re-enable). */
    resumeProactive(): void {
        this._dismissStrikes = 0;
        this._annoyance = 0;
        this._softSkipBudget = 0;
    }

    /** Immediate effect of the AskIris On/Off switch: off → clear ALL visible proactive surfaces (lamp, inline cue,
     *  badge); on → clear any auto-pause. The inline cue is cleared too because a proactive ambient can be an inline
     *  decoration (onServerAmbient → showInline), and Off must take effect on every currently-visible surface (codex r2). */
    setStudentProactive(on: boolean): void {
        if (on) {
            this.resumeProactive();
        }
        else {
            this._deps.clearLamp();
            this._deps.clearInline();
            this._deps.setBadge(false);
        }
    }
```

- [ ] **Step 4: Seam — contract, noop, index**

In `telemetry/contract.ts`, add to `StruggleEngineDeps`:
```ts
    /** Durable per-exercise student opt-out (spec §12.2): false → the orchestrator suppresses proactive for it. */
    isStudentProactiveOn(exerciseId: number): boolean;
```
and to `StruggleEngineHandle`:
```ts
    /** True iff the delivery backoff is paused for this exercise (AskIris "Auto-paused" badge). */
    isProactivePaused(exerciseId: number): boolean;
    /** Apply the AskIris switch: off clears visible surfaces, on clears any auto-pause. */
    setStudentProactive(on: boolean): void;
    /** "Resume" action: clear the auto-pause backoff. */
    resumeProactive(): void;
```
In `telemetry/noop.ts`, add to the returned handle in `createStruggleEngine`:
```ts
        isProactivePaused: () => false,
        setStudentProactive: () => { /* no engine in the clean build */ },
        resumeProactive: () => { /* no engine in the clean build */ },
```
In `telemetry/index.ts`: thread the dep into the orchestrator's deps (in the `new StruggleInterventionService({...})` deps object):
```ts
        isStudentProactiveOn: exerciseId => deps.isStudentProactiveOn(exerciseId),
```
and return the three handle methods (add them to the existing `createStruggleEngine` return object — whose members are contributed by earlier slices):
```ts
        isProactivePaused: exerciseId => orchestrator.isProactivePaused(exerciseId),
        setStudentProactive: on => orchestrator.setStudentProactive(on),
        resumeProactive: () => orchestrator.resumeProactive(),
```

- [ ] **Step 5: Run green + type-check + commit**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/logic/struggleIntervention/struggleInterventionService.test.ts && npm run check-types ) 2>&1 | tail -20
git -C /Users/liamberger/Documents/private/MA/artemis-extension add \
    extension/src/extension/telemetry/contract.ts \
    extension/src/extension/telemetry/noop.ts \
    extension/src/extension/telemetry/index.ts \
    extension/src/extension/services/struggleIntervention/struggleInterventionService.ts \
    extension/test/logic/struggleIntervention/struggleInterventionService.test.ts
git -C /Users/liamberger/Documents/private/MA/artemis-extension commit -m "feat(struggle): orchestrator consumes the student proactive preference + exposes pause/resume"
```

---

### Task 3: Message contracts + host command routing

**Files:**
- Modify: `extension/src/shared/messageContracts/webviewCommands.ts`, `extension/src/shared/messageContracts/extensionMessages.ts`
- Modify: `extension/src/extension/controller/commands/types.ts`
- Create: `extension/src/extension/controller/commands/proactiveControlCommands.ts`
- Modify: `extension/src/extension/controller/webViewMessageHandler.ts`, `extension/src/extension.ts`
- Test: `extension/test/logic/proactiveControlCommands.test.ts` — the module's `_push` precedence + request/set/resume delegation (codex r2: Task 3 needs a runtime test, not just `check-types`).

**Interfaces:**
- Produces: webview→ext commands `requestProactiveControl`/`setProactiveEnabled`/`resumeProactive` (each `{ exerciseId: number }`, the second also `{ enabled: boolean }`); ext→webview `UpdateProactiveControl { exerciseId: number; preference: 'on' | 'off'; autoPaused: boolean }`; `CommandContext.proactivePreference?` + `CommandContext.proactiveControl?` (the seam capability, optional like `struggleLiveFeed`); a `ProactiveControlCommandModule`.

- [ ] **Step 1: Register the commands + the push message**

In `webviewCommands.ts` (3 spots), under `// Iris Chat` / a new `// Proactive control` group:
```ts
// in WebviewCmd:
    RequestProactiveControl: 'requestProactiveControl',
    SetProactiveEnabled: 'setProactiveEnabled',
    ResumeProactive: 'resumeProactive',
// in WebviewCmdPayloads:
    requestProactiveControl: { exerciseId: number };
    setProactiveEnabled: { exerciseId: number; enabled: boolean };
    resumeProactive: { exerciseId: number };
// in COMMANDS_REQUIRING_PAYLOAD (all three carry a payload — at minimum { exerciseId }):
    WebviewCmd.RequestProactiveControl,
    WebviewCmd.SetProactiveEnabled,
    WebviewCmd.ResumeProactive,
```
In `extensionMessages.ts`, add to `ExtensionMsg` + the payload map:
```ts
// in ExtensionMsg:
    UpdateProactiveControl: 'updateProactiveControl',
// in the payload definitions:
    updateProactiveControl: { exerciseId: number; preference: 'on' | 'off'; autoPaused: boolean };
```

- [ ] **Step 2: Extend `CommandContext` (optional seam capability)**

In `commands/types.ts`, add (both optional, mirroring `struggleLiveFeed`/`courseAccessStorage`):
```ts
import type { ProactivePreferenceService } from '@extension/services/proactivePreferenceService';
```
```ts
    /** Durable per-exercise proactive on/off preference (client-side, spec §12.2). Absent in tests that don't need it. */
    proactivePreference?: ProactivePreferenceService;
    /** Behind-the-`@telemetry`-seam proactive control surface; absent in the clean (no-engine) build. */
    proactiveControl?: {
        isProactivePaused(exerciseId: number): boolean;
        setStudentProactive(on: boolean): void;
        resumeProactive(): void;
    };
```

- [ ] **Step 3: The command module**

Create `proactiveControlCommands.ts`:
```ts
import type { ExtensionToWebviewMessage, WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, getPayload, WebviewCmd } from '@shared/messageContracts';

import type { CommandContext, CommandMap } from './types';

/** AskIris On/Off switch + 3-state badge + Resume (spec §12.2). Preference is client-side; pause comes from the engine seam. */
export class ProactiveControlCommandModule {
    constructor(private readonly context: CommandContext) {}

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.RequestProactiveControl]: this.handleRequest,
            [WebviewCmd.SetProactiveEnabled]: this.handleSetEnabled,
            [WebviewCmd.ResumeProactive]: this.handleResume,
        };
    }

    private handleRequest = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { exerciseId } = getPayload<WebCmd<'requestProactiveControl'>>(message);
        this._push(exerciseId);
    };

    private handleSetEnabled = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { exerciseId, enabled } = getPayload<WebCmd<'setProactiveEnabled'>>(message);
        this.context.proactivePreference?.setProactiveOn(exerciseId, enabled);
        this.context.proactiveControl?.setStudentProactive(enabled);
        this._push(exerciseId);
    };

    private handleResume = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { exerciseId } = getPayload<WebCmd<'resumeProactive'>>(message);
        this.context.proactiveControl?.resumeProactive();
        this._push(exerciseId);
    };

    private _push(exerciseId: number): void {
        const on = this.context.proactivePreference?.isProactiveOn(exerciseId) ?? true;
        const autoPaused = on && (this.context.proactiveControl?.isProactivePaused(exerciseId) ?? false);
        const msg: ExtensionToWebviewMessage = {
            type: ExtensionMsg.UpdateProactiveControl,
            exerciseId,
            preference: on ? 'on' : 'off',
            autoPaused,
        };
        this.context.sendMessage(msg);
    }
}
```

- [ ] **Step 3b: Failing test for the command module (`_push` precedence + delegation)**

`extension/test/logic/proactiveControlCommands.test.ts` — build a fake `CommandContext` with stub `proactivePreference`/`proactiveControl` + a capturing `sendMessage`, then drive each handler. Locks the codex-r2 precedence (Off > Auto-paused) and the request/set/resume delegation:
```ts
import { describe, expect, it, vi } from 'vitest';

import { ProactiveControlCommandModule } from '@extension/controller/commands/proactiveControlCommands';
import { ExtensionMsg, WebviewCmd } from '@shared/messageContracts';

function harness(over: { on?: boolean; paused?: boolean } = {}) {
    const pref = { isProactiveOn: vi.fn(() => over.on ?? true), setProactiveOn: vi.fn() };
    const control = { isProactivePaused: vi.fn(() => over.paused ?? false), setStudentProactive: vi.fn(), resumeProactive: vi.fn() };
    const sent: any[] = [];
    const ctx = { proactivePreference: pref, proactiveControl: control, sendMessage: (m: any) => sent.push(m) } as any;
    return { mod: new ProactiveControlCommandModule(ctx), pref, control, sent };
}
const cmd = (command: string, payload: any) => ({ command, payload } as any);

describe('ProactiveControlCommandModule', () => {
    it('request pushes the current preference + pause state', async () => {
        const h = harness({ on: true, paused: true });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42 }));
        expect(h.sent[0]).toMatchObject({ type: ExtensionMsg.UpdateProactiveControl, exerciseId: 42, preference: 'on', autoPaused: true });
    });

    it('Off wins over Auto-paused in the badge (precedence)', async () => {
        const h = harness({ on: false, paused: true });   // backoff paused, but student turned it off
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42 }));
        expect(h.sent[0]).toMatchObject({ preference: 'off', autoPaused: false });
    });

    it('setEnabled(false) persists + applies + re-pushes', async () => {
        const h = harness({ on: false });
        await h.mod.getHandlers()[WebviewCmd.SetProactiveEnabled](cmd('setProactiveEnabled', { exerciseId: 42, enabled: false }));
        expect(h.pref.setProactiveOn).toHaveBeenCalledWith(42, false);
        expect(h.control.setStudentProactive).toHaveBeenCalledWith(false);
        expect(h.sent[0]).toMatchObject({ preference: 'off' });
    });

    it('resume delegates to the engine + re-pushes', async () => {
        const h = harness();
        await h.mod.getHandlers()[WebviewCmd.ResumeProactive](cmd('resumeProactive', { exerciseId: 42 }));
        expect(h.control.resumeProactive).toHaveBeenCalled();
        expect(h.sent[0]).toMatchObject({ exerciseId: 42 });
    });
});
```
(Confirm `getPayload` reads `message.payload` against the real contract when wiring `cmd(...)`; mirror an existing `test/logic` command-module test's message shape if it differs.)

- [ ] **Step 4: Wire the preference service + the seam capability**

The scope (`_currentCourseAccessScope`) lives on the **provider** (`appStateManager.userInfo`), so the preference service is created there (like `_courseAccessStorage`); the `proactiveControl` seam capability is built in `extension.ts` (from the engine handle) and passed INTO the provider via its deps; the engine's `isStudentProactiveOn` dep reads the provider's preference lazily (a forward-ref, exactly like `chatWebviewProvider`).

In `artemisWebviewProvider.ts`:
- Construct the preference service next to `this._courseAccessStorage` (~line 136) and expose it:
```ts
this._proactivePreference = new ProactivePreferenceService(this._extensionContext.globalState, () => this._currentCourseAccessScope());
```
```ts
public get proactivePreference(): ProactivePreferenceService { return this._proactivePreference; }
```
- Append `this._proactivePreference` and `deps.proactiveControl` to the `new WebViewMessageHandler(...)` call (after `this._liveEngineFeed`, ~line 227).

In `artemisWebviewProviderDeps.ts`, add `proactiveControl?: CommandContext['proactiveControl'];` (or inline the same shape) to `ArtemisWebviewProviderDeps`.

In `webViewMessageHandler.ts`, add the two optional constructor params (after `struggleLiveFeed`), put them on the `context`, and register the module:
```ts
// new constructor params (after struggleLiveFeed):
        proactivePreference?: ProactivePreferenceService,
        proactiveControl?: CommandContext['proactiveControl'],
// in the context object literal:
            proactivePreference,
            proactiveControl,
// in the modules array:
            new ProactiveControlCommandModule(context),
```
(Add imports for `ProactiveControlCommandModule` + `ProactivePreferenceService`.)

In `extension.ts`:
- Change `const artemisWebviewProvider = …` (~line 155) to a forward-declared `let artemisWebviewProvider: ArtemisWebviewProvider | undefined;` BEFORE `createStruggleEngine` (mirror the existing `let chatWebviewProvider` at ~line 78), then assign `artemisWebviewProvider = new ArtemisWebviewProvider({...})` at the current site.
- Add the three new handle methods to the EXISTING `createStruggleEngine(...)` destructure (which already pulls `coordinator`/`promptConsentIfAsk` + whatever earlier slices added) and add the new dep, then build the capability (~line 79):
```ts
	const { coordinator: struggleCoordinator, promptConsentIfAsk, /* …existing… */ isProactivePaused, setStudentProactive, resumeProactive } = createStruggleEngine({
		// …existing deps…
		isStudentProactiveOn: exerciseId => artemisWebviewProvider?.proactivePreference.isProactiveOn(exerciseId) ?? true,
	});
	const proactiveControl = { isProactivePaused, setStudentProactive, resumeProactive };
```
- Pass `proactiveControl` into the `ArtemisWebviewProvider({...})` deps object (~line 155, alongside `struggleCoordinator`).

- [ ] **Step 5: Run green + type-check + commit**

(The command-module logic is now covered by the Step-3b runtime test; the provider/extension.ts WIRING itself stays gated by `check-types`.)
```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/logic/proactiveControlCommands.test.ts && npm run check-types ) 2>&1 | tail -20
git -C /Users/liamberger/Documents/private/MA/artemis-extension add \
    extension/src/shared/messageContracts/webviewCommands.ts \
    extension/src/shared/messageContracts/extensionMessages.ts \
    extension/src/extension/controller/commands/types.ts \
    extension/src/extension/controller/commands/proactiveControlCommands.ts \
    extension/src/extension/controller/webViewMessageHandler.ts \
    extension/src/extension/provider/artemisWebviewProvider.ts \
    extension/src/extension/provider/artemisWebviewProviderDeps.ts \
    extension/src/extension.ts \
    extension/test/logic/proactiveControlCommands.test.ts
git -C /Users/liamberger/Documents/private/MA/artemis-extension commit -m "feat(struggle): host routing for the AskIris proactive control (preference + pause + resume)"
```

---

### Task 4: AskIris webview — On/Off switch + 3-state badge + Resume

**Files:**
- Modify: `extension/src/webview/components/AskIris/AskIris.tsx`, `extension/src/webview/components/AskIris/AskIris.module.css`
- Modify: `extension/src/webview/views/ExerciseDetail/ExerciseDetailView.tsx`, `extension/src/webview/stores/useExerciseDetailStore.ts`
- Test: `extension/test/react/AskIris.proactiveControl.test.tsx`, `extension/test/react/useExerciseDetailStore.proactiveControl.test.ts` (store reset — codex r2 no-stale-leak)

**Interfaces:**
- Produces: an optional `proactiveControl?: { preference: 'on' | 'off'; autoPaused: boolean; onToggle: (enabled: boolean) => void; onResume: () => void }` prop on `AskIris`; when present it renders the switch + 3-state badge. The store gains `proactiveControl` (fed by `UpdateProactiveControl`); `ExerciseDetailView` requests it on each `ExerciseDetailInit` + wires the callbacks to the new commands.

- [ ] **Step 1: Failing React test**

`AskIris.proactiveControl.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AskIris } from '@webview/components/AskIris/AskIris';

describe('AskIris proactive control', () => {
    const base = { description: 'd', onClick: () => {} };

    it('renders an On/Off switch when control is provided and toggles it', () => {
        const onToggle = vi.fn();
        render(<AskIris {...base} proactiveControl={{ preference: 'on', autoPaused: false, onToggle, onResume: () => {} }} />);
        fireEvent.click(screen.getByRole('switch', { name: /proactive/i }));
        expect(onToggle).toHaveBeenCalledWith(false);   // on -> off
    });

    it('shows Auto-paused + a Resume action', () => {
        const onResume = vi.fn();
        render(<AskIris {...base} proactiveControl={{ preference: 'on', autoPaused: true, onToggle: () => {}, onResume }} />);
        expect(screen.getByText(/auto-paused/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /resume/i }));
        expect(onResume).toHaveBeenCalled();
    });

    it('renders no control when the prop is absent (unchanged AskIris)', () => {
        render(<AskIris {...base} />);
        expect(screen.queryByRole('switch')).toBeNull();
    });
});
```
And the store reset (codex r2 — a late `UpdateProactiveControl` for the prior exercise must not survive a switch) in `useExerciseDetailStore.proactiveControl.test.ts`:
```ts
import { describe, expect, it } from 'vitest';

import { useExerciseDetailStore } from '@webview/stores/useExerciseDetailStore';

describe('useExerciseDetailStore proactiveControl', () => {
    it('setExerciseData clears a previous exercise\'s proactiveControl (no stale badge)', () => {
        const store = useExerciseDetailStore.getState();
        store.setProactiveControl({ exerciseId: 7, preference: 'off', autoPaused: false });
        expect(useExerciseDetailStore.getState().proactiveControl?.exerciseId).toBe(7);
        // Loading a different exercise must reset it (the partial set() otherwise preserves it).
        store.setExerciseData({ exercise: { id: 8 } } as any, false);
        expect(useExerciseDetailStore.getState().proactiveControl).toBeNull();
    });
});
```
(Match `setExerciseData`'s real arity from the store — it is `(data, hideDeveloperTools, repoStatus?)`; pass a minimal `exerciseData` shape that the hydrator accepts, mirroring an existing store test if one exists.)

- [ ] **Step 2: Run to verify failure**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/react/AskIris.proactiveControl.test.tsx test/react/useExerciseDetailStore.proactiveControl.test.ts ) 2>&1 | tail -25
```
Expected: FAIL.

- [ ] **Step 3: Render the switch + badge**

In `AskIris.tsx`, add the optional prop and render the control below the existing description (keep the existing card untouched when the prop is absent):
```tsx
interface ProactiveControlVM {
    preference: 'on' | 'off';
    autoPaused: boolean;
    onToggle: (enabled: boolean) => void;
    onResume: () => void;
}

interface AskIrisProps {
    description: string;
    onClick: () => void;
    proactiveControl?: ProactiveControlVM;
}

export function AskIris({ description, onClick, proactiveControl }: AskIrisProps) {
    // …existing Container/layout…
    // after the description <p>, inside textCol:
    {proactiveControl && (
        <div className={styles.proactiveControl}>
            <button
                type="button"
                role="switch"
                aria-checked={proactiveControl.preference === 'on'}
                aria-label="Proactive struggle help"
                className={styles.proactiveSwitch}
                data-state={proactiveControl.preference}
                onClick={() => proactiveControl.onToggle(proactiveControl.preference !== 'on')}
            >
                {proactiveControl.preference === 'on' ? 'On' : 'Off'}
            </button>
            {proactiveControl.autoPaused && (
                <span className={styles.autoPaused}>
                    Auto-paused
                    <button type="button" className={styles.resume} onClick={proactiveControl.onResume}>Resume</button>
                </span>
            )}
        </div>
    )}
}
```
Add `.proactiveControl`, `.proactiveSwitch`, `.autoPaused`, `.resume` to `AskIris.module.css` (static camelCase keys; theme tokens like `var(--vscode-descriptionForeground)`).

- [ ] **Step 4: Store + view wiring**

In `extension/src/webview/stores/useExerciseDetailStore.ts` (the real store path — `ExerciseDetailView` imports it from `@webview/stores/...`, NOT from `views/ExerciseDetail/`), add a **`exerciseId`-tagged** `proactiveControl: { exerciseId: number; preference: 'on'|'off'; autoPaused: boolean } | null` state field (default null) + a `setProactiveControl(v)` action. **Codex r2 — no stale badge across exercise switches:** the store hydrator `setExerciseData(...)` uses a partial `set(...)` that PRESERVES unspecified fields, so it must explicitly reset `proactiveControl: null` (alongside the `clonedNotice: null`/`dirtyPagesStatus: null` it already resets). Tagging the value with `exerciseId` is the second guard: the view renders the control only when the tag matches the current exercise, so a late `UpdateProactiveControl` for a previous exercise can never paint the wrong badge.

In `ExerciseDetailView.tsx`:
- **Request the control state inside the `ExtensionMsg.ExerciseDetailInit` handler** (the existing `useExtensionMessage` case ~line 103), NOT in a one-time mount effect. The provider does not remount the view on sidebar re-focus — it re-posts `ExerciseDetailInit` via `sendInitData()` on each visibility refresh (`artemisWebviewProvider.ts:346/383`). Re-requesting on every `ExerciseDetailInit` therefore refreshes the badge (incl. a backoff "Auto-paused" that flipped while hidden):
```ts
    if (msg.exerciseData?.exercise?.id !== undefined) {
        postCommand(vscodeApi, 'requestProactiveControl', { exerciseId: msg.exerciseData.exercise.id });
    }
```
- Add a `useExtensionMessage` case for `ExtensionMsg.UpdateProactiveControl` → store it **unconditionally** as `setProactiveControl({ exerciseId: msg.exerciseId, preference: msg.preference, autoPaused: msg.autoPaused })`. **Codex r2 — do NOT guard the handler on `exerciseData?.exercise?.id`:** `useExtensionMessage` keeps the handler closure until its `deps` change, and the current deps are `[vscodeApi, setExerciseData, setError]` (no `exerciseData`), so an in-handler compare would read a stale/`null` `exerciseData` and drop valid updates. The authority is instead the render-time match below (which reads the live `exercise.id`). Add the stable zustand action `setProactiveControl` to the `useExtensionMessage` deps array for exhaustive-deps correctness (a stable ref, so no behavior change / no re-subscribe churn).
- Pass the control to `<AskIris …>` (~line 610) ONLY when it is set AND tagged for the current exercise — this render-time `exerciseId` match (reading the live `exercise.id`, not a closed-over value) is the single source of truth, so a stale update for a previous exercise never renders:
```tsx
proactiveControl={proactiveControl && proactiveControl.exerciseId === exercise.id ? {
    preference: proactiveControl.preference,
    autoPaused: proactiveControl.autoPaused,
    onToggle: (enabled) => postCommand(vscodeApi, 'setProactiveEnabled', { exerciseId: exercise.id!, enabled }),
    onResume: () => postCommand(vscodeApi, 'resumeProactive', { exerciseId: exercise.id! }),
} : undefined}
```

- [ ] **Step 5: Run green + type-check + commit**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/react/AskIris.proactiveControl.test.tsx test/react/useExerciseDetailStore.proactiveControl.test.ts && npm run check-types ) 2>&1 | tail -20
git -C /Users/liamberger/Documents/private/MA/artemis-extension add \
    extension/src/webview/components/AskIris/AskIris.tsx \
    extension/src/webview/components/AskIris/AskIris.module.css \
    extension/src/webview/views/ExerciseDetail/ExerciseDetailView.tsx \
    extension/src/webview/stores/useExerciseDetailStore.ts \
    extension/test/react/AskIris.proactiveControl.test.tsx \
    extension/test/react/useExerciseDetailStore.proactiveControl.test.ts
git -C /Users/liamberger/Documents/private/MA/artemis-extension commit -m "feat(iris-chat): AskIris proactive On/Off switch + Auto-paused badge + Resume"
```

---

## Self-review checklist

- **Spec coverage:** §12.2 On/Off switch (durable per-exercise) + 3-state badge (On/Auto-paused/Off) + Resume (Tasks 1-4); §5.2 backoff drives "Auto-paused" (Task 2 `isProactivePaused`). The full card-state matrix + §14 banner + AI-opt-in gating of the switch are **deferred to Slice 5c** (called out, not silently assumed).
- **Client-side preference (user decision):** `ProactivePreferenceService` in `globalState`, default On (only OFF persisted), keyed server+principal — no Artemis change. Consumed by the orchestrator via the injected `isStudentProactiveOn` dep, so the engine suppresses without knowing about VS Code.
- **Seam-safe:** the new orchestrator capabilities cross via `StruggleEngineDeps`/`StruggleEngineHandle`; the no-op implements them (`isProactivePaused → false`, others no-op); the preference service imports nothing from `services/struggle|intervention`, so the clean bundle is unaffected. The host capability is injected exactly like `struggleLiveFeed` (optional `CommandContext` field, absent in the clean build).
- **Suppression is complete:** student-off gates both the egress path (`_handleAlert`, no POST) and the inbound server surfaces (`onServerAmbient`/`onServerActive`, drop a mid-flight surface). Default-on means an unset exercise behaves exactly as today.
- **Off clears every visible surface (codex r2):** `setStudentProactive(false)` clears the lamp, the inline cue (`clearInline()` — a proactive ambient can be an inline decoration), and the badge; not just the lamp. Locked by a unit test.
- **No stale badge across exercise switches (codex r2):** the store value is `exerciseId`-tagged, `setExerciseData(...)` resets `proactiveControl` to `null` (the partial `set()` otherwise preserves it), and the view renders the control only when the tag matches the **live** `exercise.id` at render time. The `UpdateProactiveControl` handler stores UNCONDITIONALLY (no closed-over `exerciseData` guard — `useExtensionMessage` would keep a stale closure since `exerciseData` is not in its deps; an in-handler compare would drop valid updates). A store unit test proves the reset.
- **Host-side behavior is tested, not just type-checked (codex r2):** a `ProactiveControlCommandModule` unit test covers the `_push` Off>Auto-paused precedence + request/set/resume delegation; the orchestrator test covers inbound-surface suppression when student-off; the store test covers the no-stale-leak reset. (Only the extension.ts/provider WIRING itself stays `check-types`-gated.)
- **Accepted residual (codex r2, low):** the per-scope OFF preference map is unbounded in principle, but bounded in practice by the number of exercises a student explicitly turns off (small); not worth a GC pass this slice.
- **No live auto-pause push (documented limitation, codex r1):** the webview re-requests on every `ExerciseDetailInit` (the provider re-posts it on each visibility refresh via `sendInitData()`, since it does NOT remount the view) and after every action; so the badge is correct on open, re-focus, and after each action. A live event push is a small 5c follow-up — flagged, not hidden.
- **Preference key matches `CourseAccessStorageService` (codex r1):** the new service reuses an exported `normalizeScopeSegment` (extracted from `courseAccessStorageService`), so the server URL is normalized and the principal is `id:`/`login:`-prefixed identically — no split/collision across equivalent URLs.
- **Correct store path (codex r1):** the exercise-detail store is `webview/stores/useExerciseDetailStore.ts` (not `views/ExerciseDetail/...`).
- **Mirrors existing patterns:** preference service = `CourseAccessStorageService` (globalState + shadow + write-chain + the shared scope segment); command module = `IrisCommandModule` (getHandlers/CommandContext); seam capability injection = `struggleLiveFeed`; webview command plumbing = the existing `WebviewCmd`/`postCommand`/`UpdateNoAiStatus` patterns; AskIris stays backward-compatible (it is also used by CourseDetail — the control only renders when the optional prop is present).
- **Backoff field reuse (Slice 4a/4b):** `resumeProactive` clears the same `_dismissStrikes`/`_annoyance`/`_softSkipBudget` the backoff uses; `isProactivePaused` reads `isPaused()`. These are defined by Slice 4a (executed earlier).
- **Placeholder scan:** every step shows the actual code or mirrors a named existing method; tests reuse the file's real helpers (`fakeDeps`/`alert`/`tick`); the one construction site that must be located (the `WebViewMessageHandler` call that already passes `struggleLiveFeed`) is named explicitly.
