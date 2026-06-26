# Proactive Intervention — Slice 4a: Reject affordances + delivery-layer backoff — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the student a 1-click **reject** on the extension-controlled surfaces (active toast `Not now`, inline hover `Dismiss`) and add the **delivery-layer backoff** (a soft escalating skip + a hard per-exercise pause) so repeated dismissing quiets proactive help, without touching the deterministic detection engine.

**Sequencing.** This is slice 4a; it **builds on slices 1-3** (which add `messageId`/`anchor`/`inlineHint`, the inline decoration service `inline`, and `buildHoverMarkdown`). A read-only review against un-applied HEAD will see those artifacts missing — that is expected; execute slices in order. Every cross-slice symbol this plan uses (`inline`, `buildHoverMarkdown`, the slice-3 `onServerAmbient` signature) is defined by the prior slice plans.

**Scope of THIS slice.** Client-only. The backoff machinery as a **decorator sink placed ABOVE the throttle** (so suppressed alerts do not consume the throttle's per-session/min-gap budget), with the counters owned by the orchestrator (the one place that sees `recordOutcome`); plus the toast `Not now` and the inline-hover action links that feed `recordOutcome('dismissed')`. The **chat-bubble Dismiss + collapse** and **lazy-ignore** are Slice 4b (both need per-message identity / server persistence to be sound). No server change here.

**Architecture:** `StruggleCoordinator → BackoffGate → ThrottledAlertSink → StruggleInterventionService`. The orchestrator owns two per-exercise counters: `annoyance` (dismiss +2) and `dismissStrikes` (dismiss +1), exposing `isPaused()` (`dismissStrikes >= pauseStrikes`) and `tryConsumeSoftSkip()` (true + decrement while a soft skip is owed). `BackoffGate.deliver` consults those **before** the throttle, so a paused/soft-skipped alert is dropped without burning throttle budget (fixes the layering bug). Counters reset on engagement (`recordOutcome('clicked')`) and on a new exercise (`reset()`). This is delivery-only; the engine and the SPEC 120 s cooldown are untouched (spec §5.1).

**Tech Stack:** Extension client (TypeScript; Vitest `test/logic` — the orchestrator + gate are vscode-free; VS Code `MarkdownString` command links for the hover).

Spec refs: §5, §5.1, §5.2, §6.1.

## Global Constraints

- **Branch:** `feat/struggle-v3-integration`. Not `dev`/`main`.
- **Commit messages:** Conventional Commits. **No AI attribution**. Overrides any default trailer.
- **Staging:** only the exact files each task changed. Run all `git` commands from the **repo root** `/Users/liamberger/Documents/private/MA/artemis-extension` (paths below are repo-root-relative); run `npx vitest`/`npm run` from `extension/`.
- **Backoff is delivery-only:** never the v3 engine (spec §5.1). The throttle's budgets + the SPEC cooldown are untouched.
- **Invariants:** Desktop = Cookie auth, Theia = Bearer (untouched). No `^`/`~` added to any `package.json`.

## Deferred to Slice 4b

- **Lazy-ignore** (cadence-slow on unengaged replacement): the single-slot `_lastSurface` model misattributes a dismiss of a stale surface; sound lazy-ignore needs per-surface identity, which 4b introduces. 4a backoff is **dismiss-driven only** (the hard pause is the key §12.2 anchor).
- **Chat-bubble Dismiss + collapse** + persisting `opened`/`dismissed` + gate outcome-tags + Pyris — Slice 4b.

---

## File structure

- Modify: `extension/src/extension/services/struggle/config.ts` — `TUNING.softThreshold`, `TUNING.pauseStrikes`.
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` — counters, `isPaused()`, `tryConsumeSoftSkip()`, `recordOutcome` branching, `reset`, deps.
- Create: `extension/src/extension/services/struggle/alerting/backoffGate.ts` — decorator sink above the throttle.
- Modify: `extension/src/extension/services/struggleIntervention/activeNotification.ts` — `Not now` action.
- Modify: `extension/src/extension/services/intervention/inlineHint.ts` — hover action links.
- Modify: `extension/src/extension/telemetry/index.ts` — pass thresholds; insert `BackoffGate`; toast `onDismiss`; register inline commands.
- Test: `extension/test/logic/struggleIntervention/struggleInterventionService.test.ts`, `extension/test/logic/struggle/backoffGate.test.ts`, `extension/test/logic/intervention/inlineHint.test.ts`.

---

### Task 1: Add the backoff thresholds to `TUNING`

**Files:** Modify `extension/src/extension/services/struggle/config.ts`

- [ ] **Step 1: Add the two knobs**

In `config.ts`, extend `TUNING`:
```ts
    /** Proactive reject backoff (delivery-layer, spec §5.2). annoyance >= softThreshold owes an escalating soft
     *  skip; dismissStrikes >= pauseStrikes hard-pauses proactive for the exercise. ENG. */
    softThreshold: 3,
    pauseStrikes: 5,
```

- [ ] **Step 2: Type-check + commit**

```bash
( cd extension && npm run check-types ) 2>&1 | tail -15
git add extension/src/extension/services/struggle/config.ts
git commit -m "feat(struggle): add softThreshold + pauseStrikes backoff knobs to TUNING"
```

---

### Task 2: Backoff counters in the orchestrator (`isPaused` / `tryConsumeSoftSkip`)

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts`
- Test: `extension/test/logic/struggleIntervention/struggleInterventionService.test.ts`

**Interfaces:**
- Consumes: `recordOutcome('clicked'|'dismissed')` (exists, guarded on `_lastSurface`); deps gain `softThreshold: number`, `pauseStrikes: number`.
- Produces: `isPaused(): boolean`, `tryConsumeSoftSkip(): boolean` (for `BackoffGate`, Task 3). Counters reset on `recordOutcome('clicked')` and `reset()`. **No `_handleAlert` backoff gate** (the gate is `BackoffGate`, above the throttle).

- [ ] **Step 1: Failing tests (synchronous — test the backoff methods directly, no async deliver)**

In `struggleInterventionService.test.ts`, extend the deps double with `softThreshold: 3, pauseStrikes: 5` (plus the slice-3 `showInline`/`clearInline`/`isAnchorLive` no-ops). Add a helper that surfaces once so `recordOutcome` is not a no-op, then assert:
```ts
const surface = () => svc.onServerAmbient('hint', undefined, undefined, undefined); // sets _lastSurface (lamp)

it('hard-pauses after pauseStrikes dismisses; clicked + resetSession clear it; reset() (UI-only) does NOT', () => {
    for (let i = 0; i < 5; i++) { surface(); svc.recordOutcome('dismissed'); }
    expect(svc.isPaused()).toBe(true);
    svc.reset();                                  // settings-toggle UI clear must NOT lift the per-exercise pause
    expect(svc.isPaused()).toBe(true);
    svc.resetSession();                           // a new exercise clears it
    expect(svc.isPaused()).toBe(false);
    for (let i = 0; i < 5; i++) { surface(); svc.recordOutcome('dismissed'); }
    surface(); svc.recordOutcome('clicked');      // engagement also clears
    expect(svc.isPaused()).toBe(false);
});

it('owes an escalating soft skip once annoyance crosses softThreshold (dismiss-driven)', () => {
    surface(); svc.recordOutcome('dismissed');   // annoyance 2 (< 3) -> no skip yet
    expect(svc.tryConsumeSoftSkip()).toBe(false);
    surface(); svc.recordOutcome('dismissed');   // annoyance 4 (>= 3) -> one skip owed
    expect(svc.tryConsumeSoftSkip()).toBe(true);  // consumed
    expect(svc.tryConsumeSoftSkip()).toBe(false); // none left
});

it('recordOutcome is a no-op when nothing was surfaced', () => {
    svc.recordOutcome('dismissed');
    expect(svc.isPaused()).toBe(false);   // no surface -> no backoff mutation
});
```

- [ ] **Step 2: Run to verify failure**

```bash
( cd extension && npx vitest run test/logic/struggleIntervention/struggleInterventionService.test.ts ) 2>&1 | tail -25
```
Expected: FAIL — `isPaused`/`tryConsumeSoftSkip` do not exist.

- [ ] **Step 3: Implement**

In `struggleInterventionService.ts`:
- Add to `StruggleInterventionDeps`: `softThreshold: number;` and `pauseStrikes: number;`.
- Add fields: `private _annoyance = 0; private _dismissStrikes = 0; private _softSkipBudget = 0;`.
- Keep `recordOutcome` **guarded on `_lastSurface` first** (no surface → no mutation), then branch:
```ts
    recordOutcome(outcome: 'clicked' | 'dismissed'): void {
        if (!this._lastSurface) {
            return;
        }
        if (outcome === 'clicked') {
            this._annoyance = 0;
            this._dismissStrikes = 0;
            this._softSkipBudget = 0;
        }
        else {
            this._dismissStrikes += 1;
            this._annoyance += 2;
            if (this._annoyance >= this._deps.softThreshold) {
                this._softSkipBudget += 1;   // escalating: one more owed per dismiss past the threshold
            }
        }
        void this._deps.log.record({ ...this._lastSurface, signal: this._lastSurfaceSignal, studentOutcome: outcome });
    }

    /** True while proactive is paused for this exercise (only an explicit dismiss can trigger this, spec §5.2). */
    isPaused(): boolean {
        return this._dismissStrikes >= this._deps.pauseStrikes;
    }

    /** Consume one owed soft skip; returns true if a skip was owed (caller drops the alert). */
    tryConsumeSoftSkip(): boolean {
        if (this._softSkipBudget > 0) {
            this._softSkipBudget -= 1;
            return true;
        }
        return false;
    }
```
- **Do NOT clear the backoff counters in `reset()`.** `reset()` is the "clear visible UI" path the coordinator also calls when interventions are toggled off mid-session (`struggleCoordinator.ts:124/189`); clearing the pause there would let a settings toggle silently un-pause a student who just rejected 5 times. Leave `reset()` as-is.
- Instead add a **`resetSession()`** (the coordinator's new-exercise path, `struggleCoordinator.ts:126`; `ThrottledAlertSink.resetSession()` already delegates to `inner.resetSession()`):
```ts
    /** New-exercise reset: clear the per-exercise backoff, then the UI/session state. */
    resetSession(): void {
        this._annoyance = 0;
        this._dismissStrikes = 0;
        this._softSkipBudget = 0;
        this.reset();
    }
```
- Do **not** add any backoff check to `_handleAlert` (the gate lives in `BackoffGate`).

- [ ] **Step 4: Run green + type-check + commit**

`telemetry/index.ts` builds the deps — add `softThreshold: TUNING.softThreshold, pauseStrikes: TUNING.pauseStrikes` there in this step so `check-types` passes.
```bash
( cd extension && npx vitest run test/logic/struggleIntervention/struggleInterventionService.test.ts && npm run check-types ) 2>&1 | tail -20
git add extension/src/extension/services/struggleIntervention/struggleInterventionService.ts \
        extension/src/extension/telemetry/index.ts \
        extension/test/logic/struggleIntervention/struggleInterventionService.test.ts
git commit -m "feat(struggle): backoff counters (isPaused + soft skip) on the orchestrator"
```

---

### Task 3: `BackoffGate` decorator above the throttle (so suppressed alerts skip the throttle budget)

**Files:**
- Create: `extension/src/extension/services/struggle/alerting/backoffGate.ts`
- Modify: `extension/src/extension/telemetry/index.ts`
- Test: `extension/test/logic/struggle/backoffGate.test.ts`

**Interfaces:**
- Produces: `class BackoffGate implements AlertSink` wrapping an inner `AlertSink`, consulting `{ isPaused(): boolean; tryConsumeSoftSkip(): boolean }` before delegating. Wiring: `Coordinator → BackoffGate(throttledSink, orchestrator) → throttledSink → orchestrator`.

- [ ] **Step 1: Failing test**

Create `backoffGate.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { BackoffGate } from '@extension/services/struggle/alerting/backoffGate';

const alert = { kind: 'edit' } as any;

describe('BackoffGate', () => {
    it('drops the alert (no inner.deliver) when paused', () => {
        const inner = { deliver: vi.fn() };
        const gate = new BackoffGate(inner as any, { isPaused: () => true, tryConsumeSoftSkip: () => false });
        gate.deliver(alert);
        expect(inner.deliver).not.toHaveBeenCalled();
    });
    it('consumes a soft skip instead of delivering', () => {
        const inner = { deliver: vi.fn() };
        const consume = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
        const gate = new BackoffGate(inner as any, { isPaused: () => false, tryConsumeSoftSkip: consume });
        gate.deliver(alert);                       // skip consumed
        expect(inner.deliver).not.toHaveBeenCalled();
        gate.deliver(alert);                       // none left -> delivers
        expect(inner.deliver).toHaveBeenCalledTimes(1);
    });
    it('delegates reset/resetSession to the inner sink', () => {
        const inner = { deliver: vi.fn(), reset: vi.fn(), resetSession: vi.fn() };
        const gate = new BackoffGate(inner as any, { isPaused: () => false, tryConsumeSoftSkip: () => false });
        gate.reset(); gate.resetSession();
        expect(inner.reset).toHaveBeenCalled();
        expect(inner.resetSession).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
( cd extension && npx vitest run test/logic/struggle/backoffGate.test.ts ) 2>&1 | tail -25
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `BackoffGate`**

Create `backoffGate.ts` (mirror `ThrottledAlertSink`'s optional reset delegation):
```ts
import type { AlertRecord } from '@extension/services/struggle/types';
import type { AlertSink } from './alertSink';

export interface BackoffSource {
    isPaused(): boolean;
    tryConsumeSoftSkip(): boolean;
}

/**
 * Delivery-layer reject backoff (spec §5.2), placed ABOVE the throttle so a paused/soft-skipped alert is dropped
 * WITHOUT consuming the throttle's per-session/min-gap budget. The counters live in the orchestrator (it sees
 * recordOutcome); this gate only reads them.
 */
export class BackoffGate implements AlertSink {
    constructor(private readonly inner: AlertSink, private readonly backoff: BackoffSource) {}

    deliver(alert: AlertRecord): void {
        if (this.backoff.isPaused()) {
            return;
        }
        if (this.backoff.tryConsumeSoftSkip()) {
            return;
        }
        this.inner.deliver(alert);
    }

    reset(): void {
        this.inner.reset?.();
    }

    resetSession(): void {
        if (this.inner.resetSession) {
            this.inner.resetSession();
        } else {
            this.inner.reset?.();
        }
    }
}
```

- [ ] **Step 4: Rewire the sink chain in `telemetry/index.ts`**

Where the chain is built today (`const throttledSink = new ThrottledAlertSink(orchestrator, TUNING);` then `coordinator = new StruggleCoordinator({ ..., alertSink: throttledSink })`), insert the gate so the coordinator delivers through it:
```ts
const throttledSink = new ThrottledAlertSink(orchestrator, TUNING);
const backoffGate = new BackoffGate(throttledSink, orchestrator);   // orchestrator implements BackoffSource
coordinator = new StruggleCoordinator({ /* …existing… */ alertSink: backoffGate });
```
(`StruggleInterventionService` already satisfies `BackoffSource` via Task 2's `isPaused`/`tryConsumeSoftSkip`.)

- [ ] **Step 5: Run green + type-check + commit**

```bash
( cd extension && npx vitest run test/logic/struggle/backoffGate.test.ts && npm run check-types ) 2>&1 | tail -20
git add extension/src/extension/services/struggle/alerting/backoffGate.ts \
        extension/src/extension/telemetry/index.ts \
        extension/test/logic/struggle/backoffGate.test.ts
git commit -m "feat(struggle): BackoffGate above the throttle (suppress without burning budget)"
```

---

### Task 4: Active toast — add the `Not now` reject

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/activeNotification.ts`
- Modify: `extension/src/extension/telemetry/index.ts`

**Interfaces:**
- Produces: `showActiveNotification(onOpen?, onDismiss?)` shows `[Open Iris] [Not now]`; `Not now` → `onDismiss` → `orchestrator.recordOutcome('dismissed')` (spec §6.1).

- [ ] **Step 1: Add the `Not now` action**

In `activeNotification.ts`:
```ts
const OPEN = 'Open Iris';
const DISMISS = 'Not now';

export function showActiveNotification(onOpen?: () => void, onDismiss?: () => void): void {
    void vscode.window.showInformationMessage(buildActiveNotificationText(), OPEN, DISMISS).then(choice => {
        if (choice === OPEN) {
            onOpen?.();
            void vscode.commands.executeCommand('iris.chatView.focus');
        }
        else if (choice === DISMISS) {
            onDismiss?.();
        }
    });
}
```

- [ ] **Step 2: Wire the dismiss callback**

In `telemetry/index.ts`, change the `showActiveNotification` dep:
```ts
showActiveNotification: () => showActiveNotification(
    () => orchestrator.recordOutcome('clicked'),
    () => orchestrator.recordOutcome('dismissed'),
),
```

- [ ] **Step 3: Type-check + commit**

(`buildActiveNotificationText()` keeps its pure test; the `showInformationMessage` choice path is e2e.)
```bash
( cd extension && npm run check-types ) 2>&1 | tail -15
git add extension/src/extension/services/struggleIntervention/activeNotification.ts \
        extension/src/extension/telemetry/index.ts
git commit -m "feat(struggle): active toast Not-now reject -> backoff"
```

---

### Task 5: Inline hover — `Open chat` / `Dismiss` action links

**Files:**
- Modify: `extension/src/extension/services/intervention/inlineHint.ts`
- Modify: `extension/src/extension/telemetry/index.ts`
- Test: `extension/test/logic/intervention/inlineHint.test.ts`

**Interfaces:**
- Produces: `buildHoverMarkdown(message)` appends trusted command links; registered `iris.intervention.inlineOpen` → focus chat + `recordOutcome('clicked')` + `inline.clear()`; `iris.intervention.inlineDismiss` → `recordOutcome('dismissed')` + `inline.clear()`.

- [ ] **Step 1: Failing test**

In `inlineHint.test.ts`:
```ts
import { buildHoverMarkdown } from '@extension/services/intervention/inlineHint';
it('hover carries trusted Open chat + Dismiss command links', () => {
    const md = buildHoverMarkdown('Look at the loop bound.');
    expect(md.isTrusted).toBe(true);
    expect(md.value).toContain('command:iris.intervention.inlineOpen');
    expect(md.value).toContain('command:iris.intervention.inlineDismiss');
});
```
(Uses the `test/logic` vscode mock's `MarkdownString`; if it lacks `isTrusted`/`value`, run in `test/unit` via `vscodeMocks.ts` — note which.)

- [ ] **Step 2: Run to verify failure**

```bash
( cd extension && npx vitest run test/logic/intervention/inlineHint.test.ts ) 2>&1 | tail -25
```
Expected: FAIL.

- [ ] **Step 3: Add the links**

In `inlineHint.ts`, replace `buildHoverMarkdown`:
```ts
/** Whole-line hover: the fuller message + trusted Open chat / Dismiss command links (spec §4.1, §5.2). */
export function buildHoverMarkdown(message: string): vscode.MarkdownString {
    const md = new vscode.MarkdownString(`${message}\n\n[Open chat](command:iris.intervention.inlineOpen) · [Dismiss](command:iris.intervention.inlineDismiss)`);
    md.isTrusted = true;
    return md;
}
```

- [ ] **Step 4: Register the commands + wire outcomes**

In `telemetry/index.ts`, near the inline-service construction (the `inline` var from Slice 3), register (push to `deps.context.subscriptions`):
```ts
deps.context.subscriptions.push(
    vscode.commands.registerCommand('iris.intervention.inlineOpen', () => {
        orchestrator.recordOutcome('clicked');
        inline.clear();
        void vscode.commands.executeCommand('iris.chatView.focus');
    }),
    vscode.commands.registerCommand('iris.intervention.inlineDismiss', () => {
        orchestrator.recordOutcome('dismissed');
        inline.clear();
    }),
);
```

- [ ] **Step 5: Run green + type-check + commit**

```bash
( cd extension && npx vitest run test/logic/intervention/inlineHint.test.ts && npm run check-types ) 2>&1 | tail -20
git add extension/src/extension/services/intervention/inlineHint.ts \
        extension/src/extension/telemetry/index.ts \
        extension/test/logic/intervention/inlineHint.test.ts
git commit -m "feat(struggle): inline hover Open-chat/Dismiss action links -> backoff"
```

---

## Self-review checklist

- **Layering fixed (codex):** the backoff is a `BackoffGate` ABOVE the throttle, so a paused/soft-skipped alert is dropped before the throttle counts it — suppressed alerts never burn the per-session/min-gap budget. Counters still live in the orchestrator (the only place that sees `recordOutcome`).
- **`recordOutcome` stays guarded:** it mutates backoff only when a surface was actually shown (`_lastSurface` set first), so stray/duplicate callbacks are no-ops.
- **Dismiss-driven only (sound):** lazy-ignore is deferred to 4b (single-slot `_lastSurface` can't attribute a stale-surface dismiss soundly); 4a's `annoyance`/`dismissStrikes` move on dismiss only — the hard pause (the §12.2 anchor) is fully present. Ignore can never pause (spec §5.2 tension).
- **Soft skip = clock-free escalation (ENG, honest):** `_softSkipBudget` grows one per dismiss past `softThreshold`; the gate consumes one per alert — sparser delivery the more the student dismisses, no clock, no throttle coupling.
- **Tests are synchronous + realistic:** the backoff is verified by calling `recordOutcome`/`isPaused`/`tryConsumeSoftSkip` directly (no `await deliver()`); `BackoffGate` is tested with a fake inner + fake `BackoffSource`; `recordOutcome` no-op-without-surface is covered.
- **Reset semantics (codex):** counters clear on `recordOutcome('clicked')` (engagement) and on `resetSession()` (new exercise) — **not** on `reset()`, which is the UI-only/settings-toggle clear, so toggling interventions off/on does not silently lift a per-exercise pause. `BackoffGate.resetSession()` → throttle → orchestrator `resetSession()`.
- **git cwd:** all `git` from the repo root with `extension/...` paths; `npx vitest`/`npm run` from `extension/`.
- **Deferred is explicit:** bubble Dismiss/collapse + lazy-ignore + server persistence are Slice 4b.
- **Placeholder scan:** every step shows the actual code; only existing test doubles/fixtures referenced by name.
