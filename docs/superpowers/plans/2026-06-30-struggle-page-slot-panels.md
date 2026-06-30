# Struggle-Detection Page: Slot / Intervention-Continuity Panels - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the orchestrator's slot/intervention-continuity state on the dev-only Struggle-Detection page via a live slot panel + a session episode-history list, and make every page section collapsible.

**Architecture:** Event-push (Approach B): the orchestrator fires a coalesced, best-effort `notifySlotDebugChanged()` at composite mutation points; the wiring reads `getSlotDebugSnapshot()` + the in-memory episode-history ring buffer and posts a new `StruggleSlotUpdate` message through the ref-counted `LiveEngineFeed`. Two React panels render it; client-side 1s interpolation drives the abandon/stale countdowns. No `SlotManager` change (golden parity untouched).

**Tech Stack:** TypeScript, VS Code extension API, React webview, vitest (`test/logic/**` + `test/react/**`), CSS Modules, esbuild.

## Global Constraints

- No AI/Claude attribution anywhere (code, comments, commit messages).
- No em dashes (U+2014) in added lines. Scan: `git diff <file> | grep '^+' | LANG=en_US.UTF-8 perl -CSD -ne 'print if /[\x{2014}]/'` must be empty.
- CSS Modules are camelCaseOnly in the production esbuild bundle: only static camelCase `styles.x` lookups, never dynamic kebab-case `styles['a-b']`.
- Two test runners: vitest for `test/logic/**` + `test/react/**` (NOT `test/unit/**` for new logic tests).
- Dev-only surface: the whole feature stays behind the existing `developerMode` gate; new live sections are also hidden when `embedded === true`.
- No `SlotManager` change. No Pyris/Artemis change. In-memory history only (no disk).
- Verify with `npm run check-types` (tsc --noEmit), not just lint, before each commit.

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `extension/src/extension/services/struggleIntervention/slot/staleWatchdog.ts` | add `isArmed()` + `staleDeadlineMs()` read accessors | Modify |
| `extension/src/shared/messageContracts/extensionMessages.ts` | `SlotDebugSnapshot`, `EpisodeHistoryEntry`, `ExtensionMsg.StruggleSlotUpdate` + payload map | Modify |
| `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` | `getSlotDebugSnapshot()`, episode-history ring buffer + `recordTerminalEpisode()`, `notifySlotDebugChanged()`, `onSlotChange?` dep, `getEpisodeHistory()` | Modify |
| `extension/src/extension/services/struggle/live/liveEngineFeed.ts` | ref-count subscription + `pushSlotUpdate()` + `setSlotProvider()` | Modify |
| `extension/src/extension/telemetry/index.ts` | inject `onSlotChange`; expose `getSlotDebugSnapshot`/`getEpisodeHistory`/`setSlotChangeSink` on the handle | Modify |
| `extension/src/extension/telemetry/contract.ts` | extend `StruggleEngineHandle` + `ILiveEngineFeed` | Modify |
| `extension/src/extension.ts` | wire feed slot-provider + handle slot-change sink | Modify |
| `extension/src/webview/components/Container/Container.tsx` (+ `.module.css`) | `collapsible` + `defaultCollapsed` | Modify |
| `extension/src/webview/views/StruggleDetection/SlotPanel.tsx` (+ `.module.css`) | live slot panel + `useSlotCountdowns` | Create |
| `extension/src/webview/views/StruggleDetection/EpisodeHistoryPanel.tsx` (+ `.module.css`) | session episode list | Create |
| `extension/src/webview/views/StruggleDetection/StruggleDetectionView.tsx` | mount panels, collapsible defaults, embedded gating | Modify |
| `extension/src/extension/telemetry/noop.ts` | clean-build handle stub: confirm optional new members type-check | Modify |
| `extension/src/extension/provider/artemisWebviewProvider.ts` | mandatory shim: `wireSlotDebug()` + `pushSlotUpdate()` over the private feed | Modify |
| `extension/src/webview/views/StruggleDetection/{DecisionFlowPipeline,TimersPanel,LiveEngineSection}.tsx` | accept + forward `collapsible`/`defaultCollapsed` to their own `Container` | Modify |

---

## Task 1: StaleWatchdog read accessors

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/slot/staleWatchdog.ts`
- Test: `extension/test/logic/struggleIntervention/slot/staleWatchdog.test.ts` (existing file; add cases)

**Interfaces:**
- Produces: `StaleWatchdog.isArmed(): boolean`; `StaleWatchdog.staleDeadlineMs(): number | null` (absolute ms of the next fire = `_lastResetMs + _cfg.staleAfterMs` while armed, else null).

- [ ] **Step 1: Write failing tests** in `staleWatchdog.test.ts`

```ts
it('isArmed reflects arm/disarm', () => {
    const wd = new StaleWatchdog({ staleAfterMs: 1000, staleWindowMax: 4, staleAskCap: 2 });
    expect(wd.isArmed()).toBe(false);
    wd.arm(0, false);
    expect(wd.isArmed()).toBe(true);
    wd.disarm();
    expect(wd.isArmed()).toBe(false);
});

it('staleDeadlineMs is lastReset + staleAfterMs while armed, null otherwise', () => {
    const wd = new StaleWatchdog({ staleAfterMs: 1000, staleWindowMax: 4, staleAskCap: 2 });
    expect(wd.staleDeadlineMs()).toBeNull();
    wd.arm(500, false);
    expect(wd.staleDeadlineMs()).toBe(1500);
    wd.resetProgress(2000);
    expect(wd.staleDeadlineMs()).toBe(3000);
    wd.disarm();
    expect(wd.staleDeadlineMs()).toBeNull();
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run test/logic/struggleIntervention/slot/staleWatchdog.test.ts`
Expected: FAIL (`isArmed`/`staleDeadlineMs` not a function).

- [ ] **Step 3: Implement** - add after `windowCount()` in `staleWatchdog.ts`:

```ts
    /** True while the watchdog is armed (diagnostic read; does not affect counters). */
    isArmed(): boolean {
        return this._armed;
    }

    /** Absolute ms of the next due fire while armed, else null (diagnostic read). */
    staleDeadlineMs(): number | null {
        return this._armed ? this._lastResetMs + this._cfg.staleAfterMs : null;
    }
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run test/logic/struggleIntervention/slot/staleWatchdog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/extension/services/struggleIntervention/slot/staleWatchdog.ts extension/test/logic/struggleIntervention/slot/staleWatchdog.test.ts
git commit -m "feat(struggle): add StaleWatchdog isArmed/staleDeadlineMs read accessors"
```

---

## Task 2: Shared message-contract types

**Files:**
- Modify: `extension/src/shared/messageContracts/extensionMessages.ts`
- Test: `extension/test/logic/messageContracts/slotUpdate.test.ts` (Create)

**Interfaces:**
- Produces (importable from `@shared/messageContracts`):

```ts
export interface SlotInFlightDebug {
    intent: 'decide' | 'confirm_close' | 'stale_check';
    localToken: number;
    episodeId: string;
    generation: number;
    requestToken: string;
}
export interface SlotDebugSnapshot {
    nowMs: number;
    state: 'free' | 'parked' | 'delivered';
    level: 'ambient' | 'active' | null;
    episodeId: string | null;
    generation: number;
    episodeAgeMs: number | null;
    hintCount: number;
    isNew: boolean;
    inSession: boolean;
    watchdog: { armed: boolean; staleDeadlineMs: number | null };
    abandon: { armed: boolean; deadlineMs: number | null };
    inFlight: SlotInFlightDebug | null;
    owed: { confirmClose: boolean; staleCheck: boolean };
    pendingOutcomes: number;
}
export type EpisodeOutcomeLabel = 'DISMISSED' | 'RECOVERED' | 'ABANDONED' | 'DISCARDED' | 'INTERRUPTED';
export interface EpisodeHistoryEntry {
    episodeId: string;
    peakLevel: 'ambient' | 'active';
    outcome: EpisodeOutcomeLabel;
    hintCount: number;
    durationMs: number;
    startedAtMs: number;
}
```
- `ExtensionMsg.StruggleSlotUpdate = 'struggleSlotUpdate'`; payload `{ snapshot: SlotDebugSnapshot; episodes: EpisodeHistoryEntry[] }`.

- [ ] **Step 1: Write failing test** `test/logic/messageContracts/slotUpdate.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { ExtensionMsg } from '@shared/messageContracts';
import type { SlotDebugSnapshot, EpisodeHistoryEntry } from '@shared/messageContracts';

describe('StruggleSlotUpdate contract', () => {
    it('exposes the enum value', () => {
        expect(ExtensionMsg.StruggleSlotUpdate).toBe('struggleSlotUpdate');
    });
    it('types compose into a well-formed payload', () => {
        const snapshot: SlotDebugSnapshot = {
            nowMs: 1000, state: 'delivered', level: 'active', episodeId: 'ep-1', generation: 3,
            episodeAgeMs: 500, hintCount: 2, isNew: false, inSession: true,
            watchdog: { armed: true, staleDeadlineMs: 2000 },
            abandon: { armed: false, deadlineMs: null },
            inFlight: { intent: 'confirm_close', localToken: 7, episodeId: 'ep-1', generation: 3, requestToken: 'rt-abc' },
            owed: { confirmClose: false, staleCheck: false }, pendingOutcomes: 0,
        };
        const episodes: EpisodeHistoryEntry[] = [
            { episodeId: 'ep-0', peakLevel: 'ambient', outcome: 'DISCARDED', hintCount: 1, durationMs: 20_000, startedAtMs: 0 },
        ];
        const msg = { type: ExtensionMsg.StruggleSlotUpdate, snapshot, episodes };
        expect(msg.snapshot.state).toBe('delivered');
        expect(msg.episodes[0].outcome).toBe('DISCARDED');
    });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run test/logic/messageContracts/slotUpdate.test.ts`
Expected: FAIL (`StruggleSlotUpdate` undefined / types not exported).

- [ ] **Step 3: Implement** - in `extensionMessages.ts`:
  1. Add the `SlotInFlightDebug` / `SlotDebugSnapshot` / `EpisodeOutcomeLabel` / `EpisodeHistoryEntry` interfaces immediately after the `StruggleDebugSnapshot` interface (after line ~140).
  2. Add to the `ExtensionMsg` const object, right after `StruggleLiveSessionState: 'struggleLiveSessionState',`:

```ts
    StruggleSlotUpdate: 'struggleSlotUpdate',
```
  3. Add the payload-map entry next to the other `struggleLive*` entries (the interface that maps message type -> payload, near the existing `struggleLiveTick: { tick: LiveTick };`):

```ts
    struggleSlotUpdate: { snapshot: SlotDebugSnapshot; episodes: EpisodeHistoryEntry[] };
```
  (No `typeGuards.ts` change: `isExtensionMessage()` is driven from `Object.values(ExtensionMsg)`, so the enum value alone registers the type.)

- [ ] **Step 4: Run, verify pass** + types

Run: `npx vitest run test/logic/messageContracts/slotUpdate.test.ts && npm run check-types`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add extension/src/shared/messageContracts/extensionMessages.ts extension/test/logic/messageContracts/slotUpdate.test.ts
git commit -m "feat(struggle): add StruggleSlotUpdate message + slot debug/history contract types"
```

---

## Task 3: Orchestrator snapshot, episode history, and notify

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts`
- Test: `extension/test/logic/struggleIntervention/slotDebugSnapshot.test.ts` (Create)

**Interfaces:**
- Consumes: `SlotDebugSnapshot`, `EpisodeHistoryEntry`, `EpisodeOutcomeLabel` from `@shared/messageContracts`; `StaleWatchdog.isArmed()`/`staleDeadlineMs()` (Task 1).
- Produces:
  - dep `onSlotChange?(): void` on `StruggleInterventionDeps`.
  - `getSlotDebugSnapshot(): SlotDebugSnapshot` (pure read, never throws).
  - `getEpisodeHistory(): readonly EpisodeHistoryEntry[]`.
  - private `recordTerminalEpisode(episode: Episode, outcome: EpisodeOutcomeLabel): void`.
  - private `notifySlotDebugChanged(): void` (coalesced, best-effort).

- [ ] **Step 1: Write failing tests** `test/logic/struggleIntervention/slotDebugSnapshot.test.ts`

Define a local `makeService(overrides?) => ({ svc: new StruggleInterventionService(fakeDeps(overrides)) })` built on the existing `fakeDeps()` factory in `struggleInterventionService.test.ts` (there is NO `makeService()` today; `fakeDeps` + direct `new StruggleInterventionService(...)` is the real pattern). Key cases:

```ts
it('snapshot reflects FREE slot', () => {
    const { svc } = makeService();
    const s = svc.getSlotDebugSnapshot();
    expect(s.state).toBe('free');
    expect(s.episodeId).toBeNull();
    expect(s.level).toBeNull();
    expect(s.inFlight).toBeNull();
});

it('snapshot reflects a DELIVERED active episode with in-flight confirm_close', () => {
    const { svc } = makeService();
    simulateDelivered(svc, 'active'); // helper: drives onServerActive -> take-delivered
    armConfirmCloseInFlight(svc);     // helper: sets _inFlightMarker intent confirm_close
    const s = svc.getSlotDebugSnapshot();
    expect(s.state).toBe('delivered');
    expect(s.level).toBe('active');
    expect(s.hintCount).toBeGreaterThan(0);
    expect(s.inFlight?.intent).toBe('confirm_close');
    expect(s.inFlight?.requestToken).toBeTypeOf('string');
});

it('abandon.armed derives from the live ask binding, not the latch', () => {
    const { svc } = makeService();
    simulateDelivered(svc, 'active');
    expect(svc.getSlotDebugSnapshot().abandon.armed).toBe(false);
    simulateStaleAsk(svc); // helper: onServerStale ask=true -> binds _liveAskBinding + arms latch
    const s = svc.getSlotDebugSnapshot();
    expect(s.abandon.armed).toBe(true);
    expect(s.abandon.deadlineMs).toBeTypeOf('number');
});

it('recordTerminalEpisode caps at 20 and derives peakLevel/duration', async () => {
    const { svc } = makeService();
    for (let i = 0; i < 25; i++) { /* drive deliver + dismiss with a fresh episode */ driveDismiss(svc); }
    const hist = svc.getEpisodeHistory();
    expect(hist.length).toBe(20);
    expect(hist[hist.length - 1].outcome).toBe('DISMISSED');
    expect(['ambient', 'active']).toContain(hist[0].peakLevel);
});

it('resetSession records INTERRUPTED for DELIVERED, DISCARDED for PARKED', () => {
    const { svc } = makeService();
    simulateDelivered(svc, 'active');
    svc.resetSession();
    expect(svc.getEpisodeHistory().at(-1)?.outcome).toBe('INTERRUPTED');
    simulateParked(svc);
    svc.resetSession();
    expect(svc.getEpisodeHistory().at(-1)?.outcome).toBe('DISCARDED');
});

it('notifySlotDebugChanged fires once per branch (coalesced) and is a no-op without onSlotChange', async () => {
    const onSlotChange = vi.fn();
    const { svc } = makeService({ onSlotChange });
    svc.setInSession(true);
    svc.setInSession(false);          // two sync mutations
    await Promise.resolve();           // flush the microtask
    expect(onSlotChange).toHaveBeenCalledTimes(1);

    const { svc: svc2 } = makeService(); // no onSlotChange
    expect(() => svc2.setInSession(true)).not.toThrow();
});
```

```ts
it('notify covers in-flight + pending-outcome mutations (not just public exits)', async () => {
    const onSlotChange = vi.fn();
    const { svc } = makeService({ onSlotChange });
    await driveAcceptedPost(svc);   // helper: deliver() -> accepted POST sets _inFlightMarker via _setInFlightMarker
    await Promise.resolve();
    expect(onSlotChange).toHaveBeenCalled();
    expect(svc.getSlotDebugSnapshot().inFlight).not.toBeNull();
    onSlotChange.mockClear();
    drivePendingBackfill(svc);      // helper: force setEpisodeOutcome applied=false -> _setPendingOutcome
    await Promise.resolve();
    expect(onSlotChange).toHaveBeenCalled();
});
```

(Add the small helpers `simulateDelivered`, `simulateParked`, `simulateStaleAsk`, `armConfirmCloseInFlight`, `driveDismiss`, `driveAcceptedPost`, `drivePendingBackfill` near the top of the test file, reusing the patterns already in `struggleInterventionService.test.ts` / `C5-replyRoutingHook.test.ts` / `C8-dismissEpisode.test.ts`.)

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run test/logic/struggleIntervention/slotDebugSnapshot.test.ts`
Expected: FAIL (methods undefined).

- [ ] **Step 3a: Add the dep** - in `StruggleInterventionDeps` (after `devLog?`):

```ts
    /** Debug-only slot-state change sink (gated upstream); no-op when omitted. Best-effort, must not throw into a slot path. */
    onSlotChange?(): void;
```

- [ ] **Step 3b: Add the ring buffer + helpers** - add fields near `_pendingOutcomes` and methods in the class body:

```ts
    private _episodeHistory: EpisodeHistoryEntry[] = [];
    private static readonly HISTORY_CAP = 20;
    private _slotChangeScheduled = false;

    /** Snapshot of the slot/intervention runtime for the dev dashboard (spec §panel). Pure read, never throws. */
    getSlotDebugSnapshot(): SlotDebugSnapshot {
        const snap = this._slot.snapshot();
        const st = snap.state;
        const episode = st.kind === 'free' ? undefined : st.episode;
        const now = Date.now();
        const m = this._inFlightMarker;
        return {
            nowMs: now,
            state: st.kind,
            level: st.kind === 'parked' ? 'ambient' : st.kind === 'delivered' ? st.level : null,
            episodeId: episode?.episodeId ?? null,
            generation: snap.generation,
            episodeAgeMs: episode ? now - episode.createdAtMs : null,
            hintCount: episode?.hints.length ?? 0,
            isNew: episode?.isNew ?? false,
            inSession: snap.inSession,
            watchdog: {
                armed: this._watchdog?.isArmed() ?? false,
                staleDeadlineMs: this._watchdog?.staleDeadlineMs() ?? null,
            },
            abandon: {
                armed: this._liveAskBinding !== undefined,
                deadlineMs: this._liveAskBinding !== undefined ? this._deadlineLatch.current() : null,
            },
            inFlight: m
                ? { intent: m.intent, localToken: m.localToken, episodeId: m.episodeId, generation: m.generation, requestToken: m.requestToken }
                : null,
            owed: { confirmClose: this._owedConfirmClose !== undefined, staleCheck: this._owedStaleCheck },
            pendingOutcomes: this._pendingOutcomes.size,
        };
    }

    /** The in-memory, session-only episode history (newest last). */
    getEpisodeHistory(): readonly EpisodeHistoryEntry[] {
        return this._episodeHistory;
    }

    /** Append a terminal episode to the ring buffer; derives peakLevel + duration from the episode itself. */
    private recordTerminalEpisode(episode: Episode, outcome: EpisodeOutcomeLabel): void {
        const peakLevel: 'ambient' | 'active' = episode.hints.some(h => h.level === 'active') ? 'active' : 'ambient';
        this._episodeHistory.push({
            episodeId: episode.episodeId,
            peakLevel,
            outcome,
            hintCount: episode.hints.length,
            durationMs: Date.now() - episode.createdAtMs,
            startedAtMs: episode.createdAtMs,
        });
        if (this._episodeHistory.length > StruggleInterventionService.HISTORY_CAP) {
            this._episodeHistory.shift();
        }
    }

    /** Coalesced, best-effort debug notification (one push per sync mutation branch). */
    private notifySlotDebugChanged(): void {
        if (!this._deps.onSlotChange || this._slotChangeScheduled) { return; }
        this._slotChangeScheduled = true;
        queueMicrotask(() => {
            this._slotChangeScheduled = false;
            try { this._deps.onSlotChange?.(); } catch { /* best-effort: debug push must never break the feature */ }
        });
    }
```

Add the imports at the top: `import type { SlotDebugSnapshot, EpisodeHistoryEntry, EpisodeOutcomeLabel } from '@shared/messageContracts';`

- [ ] **Step 3c: Wire `recordTerminalEpisode` into the terminal sites.** At each site, capture the live `episode` object BEFORE `this._slot.free()`/`discardParkedToFree()`, then call `recordTerminalEpisode(episode, <outcome>)`. Sites + outcomes:
  - `onServerSilent` discard-free branch (PARKED): `DISCARDED`.
  - `onServerClose` resolved DELIVERED (the `wasDelivered` branch, uses `snapState.episode`): `RECOVERED`.
  - `onServerClose` resolved PARKED (`wasParked`): `DISCARDED`.
  - `dismissEpisode` DELIVERED-resolution branch (`snapState.episode`): `DISMISSED`.
  - watchdog `force-free` (`snap.state.episode`): `ABANDONED`.
  - watchdog `free-silent` (PARKED): `DISCARDED`.
  - `_scheduleAbandon` fire (`snap.state.episode` when delivered): `ABANDONED`.
  - `onStaleAskButton` `free-silent` ("something-else", `snap.state.episode`): `ABANDONED`.
  - `resetSession`: if `!this._slot.isFree()`, read `this._slot.snapshot().state`; DELIVERED -> `INTERRUPTED`, PARKED -> `DISCARDED` (before `this._slot.free()`).

Example (dismissEpisode DELIVERED branch):

```ts
        if (shouldFreeSlot) {
            const deliveredEpisode = (snapState as Extract<typeof snapState, { kind: 'delivered' }>).episode;
            this.recordTerminalEpisode(deliveredEpisode, 'DISMISSED');
            this._slot.free();
            ...
```

Example (resetSession):

```ts
        if (!this._slot.isFree()) {
            const st = this._slot.snapshot().state;
            if (st.kind === 'delivered') { this.recordTerminalEpisode(st.episode, 'INTERRUPTED'); }
            else if (st.kind === 'parked') { this.recordTerminalEpisode(st.episode, 'DISCARDED'); }
            this._dbg('  -> RESET (new exercise): slot -> FREE');
            this._slot.free();
        }
```

- [ ] **Step 3d: Route EVERY debug-visible mutation through a notifying path (complete coverage, not just public exits).** Two mechanisms together:

  **(i) Notifying setters** for the fields that mutate inside private helpers (so coverage is complete-by-construction, no enumerated-site drift). Add these private setters and replace ALL direct assignments to the wrapped fields across the whole file:

```ts
    private _setInFlightMarker(v: InFlightMarker | undefined): void { this._inFlightMarker = v; this.notifySlotDebugChanged(); }
    private _setOwedConfirmClose(v: OwedConfirmClose | undefined): void { this._owedConfirmClose = v; this.notifySlotDebugChanged(); }
    private _setOwedStaleCheck(v: boolean): void { this._owedStaleCheck = v; this.notifySlotDebugChanged(); }
    private _setLiveAskBinding(v: LiveAskBinding | undefined): void { this._liveAskBinding = v; this.notifySlotDebugChanged(); }
    private _setPendingOutcome(episodeId: string, outcome: { outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED' }): void { this._pendingOutcomes.set(episodeId, outcome); this.notifySlotDebugChanged(); }
    private _deletePendingOutcome(episodeId: string): void { this._pendingOutcomes.delete(episodeId); this.notifySlotDebugChanged(); }
    private _clearPendingOutcomes(): void { this._pendingOutcomes.clear(); this.notifySlotDebugChanged(); }
```
  Replace every `this._inFlightMarker = ...`, `this._owedConfirmClose = ...`, `this._owedStaleCheck = ...`, `this._liveAskBinding = ...`, and `this._pendingOutcomes.set/delete/clear(...)` (including the backfill-flush `.delete(...)` at ~:1545) with the matching setter. This covers ALL the helper sites: `_handleAlert` (POST sets the marker), `_drainOwed` (POST sets the marker + owed changes), `_cancelStaleCheckInFlight` (clears the marker), `revealParkedHint` (clears the marker), and the async backfill `.then` handlers that touch `_pendingOutcomes`.

  **(ii) Public-exit notify** for the SlotManager / watchdog / deadline-latch / inSession side the setters do not cover. Call `this.notifySlotDebugChanged()` at:
  - the end of `_applyDecideAction` (after the switch - slot transition + watchdog arm);
  - in `onTick`, ONLY where a debug-visible field actually changes - NOT unconditionally at method exit (this must not become a 10s periodic push, per the spec's "NOT a per-tick refresh"): notify right after the conditional `_watchdog.resetProgress(tick.ts)` (inside the `if (tick.sBase < reArmSBase)` block at ~:281). The watchdog `StaleEvent` branches in the same tick already notify through their existing paths (`fire-stale-check` -> `_setOwedStaleCheck`; `force-free`/`free-silent` -> `_clearEpisodeRuntime`), so no separate onTick-exit notify is needed;
  - the end of `onNewBuildResult` (after its `_watchdog.resetProgress`);
  - `onFreeTextReply` (after `_deadlineLatch.advance`/`restore`, which change `abandon.deadlineMs`);
  - `revealParkedHint` (after its slot transition + watchdog re-arm - these fire even with no in-flight marker, so no setter notify covers them);
  - `setInSession`, `_clearEpisodeRuntime`, and `resetSession`.

  The coalescer (queueMicrotask + `_slotChangeScheduled` flag) dedups the many calls a single sync branch produces into one push.

- [ ] **Step 4: Run, verify pass** + full slot suite + types

Run: `npx vitest run test/logic/struggleIntervention && npm run check-types`
Expected: PASS (incl. existing struggleIntervention suites - the additions are read-only/append-only, no decision-path change), tsc clean.

- [ ] **Step 5: Em-dash scan + Commit**

```bash
git diff extension/src/extension/services/struggleIntervention/struggleInterventionService.ts | grep '^+' | LANG=en_US.UTF-8 perl -CSD -ne 'print if /[\x{2014}]/'
# (must be empty)
git add extension/src/extension/services/struggleIntervention/struggleInterventionService.ts extension/test/logic/struggleIntervention/slotDebugSnapshot.test.ts
git commit -m "feat(struggle): slot debug snapshot, session episode-history buffer, coalesced notify"
```

---

## Task 4: Ref-counted feed + handle wiring

**Files:**
- Modify: `extension/src/extension/services/struggle/live/liveEngineFeed.ts`
- Modify: `extension/src/extension/telemetry/contract.ts` (`ILiveEngineFeed`, `StruggleEngineHandle`)
- Modify: `extension/src/extension/telemetry/index.ts` (`createStruggleEngine`, `createLiveEngineFeed`)
- Modify: `extension/src/extension.ts` (wire sink + provider)
- Test: `extension/test/logic/struggle/liveEngineFeedSlot.test.ts` (Create)

**Interfaces:**
- Consumes: `SlotDebugSnapshot`, `EpisodeHistoryEntry`, `getSlotDebugSnapshot()`, `getEpisodeHistory()`, `onSlotChange` dep.
- Produces: `LiveEngineFeed.setSlotProvider(p: () => { snapshot: SlotDebugSnapshot; episodes: EpisodeHistoryEntry[] } | null): void`; `LiveEngineFeed.pushSlotUpdate(): void`; ref-counted `subscribe()`/`unsubscribe()`. Handle gains `getSlotDebugSnapshot()`, `getEpisodeHistory()`, `setSlotChangeSink(fn: () => void)`.

- [ ] **Step 1: Write failing test** `test/logic/struggle/liveEngineFeedSlot.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';
import { LiveEngineFeed } from '@extension/services/struggle/live/liveEngineFeed';
import { ExtensionMsg } from '@shared/messageContracts';

function makeFeed() {
    const posts: any[] = [];
    const source = { onDidTick: () => ({ dispose() {} }) };
    const feed = new LiveEngineFeed(source as any, (m) => posts.push(m), () => true);
    return { feed, posts };
}
const SNAP = () => ({ snapshot: { state: 'free' } as any, episodes: [] });

describe('LiveEngineFeed slot + ref-count', () => {
    it('replays reset/backfill + slot snapshot on every subscribe (preserves existing feed behavior)', () => {
        const { feed, posts } = makeFeed();
        feed.setSlotProvider(SNAP);
        feed.subscribe();
        feed.subscribe();
        const resets = posts.filter(p => p.type === ExtensionMsg.StruggleLiveReset);
        const slots = posts.filter(p => p.type === ExtensionMsg.StruggleSlotUpdate);
        expect(resets.length).toBe(2);   // replay on EVERY subscribe (not 0->1 only)
        expect(slots.length).toBe(2);
    });
    it('stays active until the last unsubscribe', () => {
        const { feed, posts } = makeFeed();
        feed.setSlotProvider(SNAP);
        feed.subscribe(); feed.subscribe();
        feed.unsubscribe(); // 2 -> 1, still active
        posts.length = 0;
        feed.pushSlotUpdate();
        expect(posts.filter(p => p.type === ExtensionMsg.StruggleSlotUpdate).length).toBe(1);
        feed.unsubscribe(); // 1 -> 0, inactive
        posts.length = 0;
        feed.pushSlotUpdate();
        expect(posts.length).toBe(0);
    });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run test/logic/struggle/liveEngineFeedSlot.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** in `liveEngineFeed.ts`:
  - Replace `private _subscribed = false;` with `private _subscriberCount = 0;`.
  - Add `private _slotProvider: (() => { snapshot: SlotDebugSnapshot; episodes: EpisodeHistoryEntry[] } | null) | null = null;` and import the two types from `@shared/messageContracts`.
  - Replace `_onTick`'s `if (this._subscribed && ...)` guard with `if (this._subscriberCount > 0 && ...)`.
  - Rewrite `subscribe`/`unsubscribe`:

```ts
    subscribe(): void {
        if (!this._isDeveloperMode()) { return; }
        this._subscriberCount++;
        // Replay on EVERY subscribe (preserves the current behavior the existing liveEngineFeed
        // tests expect + paints a late-mounting panel). The ref-count governs only DEACTIVATION:
        // the live tick stream stops posting once the count returns to 0.
        this._post({ type: ExtensionMsg.StruggleLiveReset });
        this._post({ type: ExtensionMsg.StruggleLiveBackfill, ticks: [...this._buffer] });
        this._post({ type: ExtensionMsg.StruggleLiveSessionState, active: this._sessionActive });
        this.pushSlotUpdate();
    }

    unsubscribe(): void {
        if (this._subscriberCount > 0) { this._subscriberCount--; }
    }

    setSlotProvider(provider: () => { snapshot: SlotDebugSnapshot; episodes: EpisodeHistoryEntry[] } | null): void {
        this._slotProvider = provider;
    }

    pushSlotUpdate(): void {
        if (this._subscriberCount === 0 || !this._isDeveloperMode() || !this._slotProvider) { return; }
        const payload = this._slotProvider();
        if (!payload) { return; }
        this._post({ type: ExtensionMsg.StruggleSlotUpdate, snapshot: payload.snapshot, episodes: payload.episodes });
    }
```
  - In `setSessionActive`, replace `this._subscribed` reads with `this._subscriberCount > 0`.
  - Update `ILiveEngineFeed` in `contract.ts` to add `setSlotProvider(...)` and `pushSlotUpdate()`.

- [ ] **Step 4: Wire the handle.** In `contract.ts` `StruggleEngineHandle`, add (optional, clean-build pattern):

```ts
    getSlotDebugSnapshot?(): SlotDebugSnapshot;
    getEpisodeHistory?(): readonly EpisodeHistoryEntry[];
    setSlotChangeSink?(fn: () => void): void;
```
  In `createStruggleEngine` (`telemetry/index.ts`): add a forward-ref sink, pass `onSlotChange`, and expose the three handle members:

```ts
    let slotChangeSink: () => void = () => {};
    // ... in the orchestrator deps object:
    onSlotChange: () => slotChangeSink(),
    // ... in the returned handle object:
    getSlotDebugSnapshot: () => orchestrator.getSlotDebugSnapshot(),
    getEpisodeHistory: () => orchestrator.getEpisodeHistory(),
    setSlotChangeSink: (fn: () => void) => { slotChangeSink = fn; },
```

**Clean build (`telemetry/noop.ts` + any `ILiveEngineFeed` stub):** the three new `StruggleEngineHandle` members are OPTIONAL (`?:`), so `noop.ts`'s `createStruggleEngine` needs no change (optional members may be omitted); just confirm it still type-checks. The two new `ILiveEngineFeed` methods (`setSlotProvider`, `pushSlotUpdate`) are NON-optional on the interface, so any clean-build stub that implements `ILiveEngineFeed` must add them as no-ops.

- [ ] **Step 5: Connect feed and handle in `extension.ts`.** The provider shim is MANDATORY: the feed is a PRIVATE field of `artemisWebviewProvider`, so `extension.ts` can only reach it through provider methods. After the provider (which owns the feed) and the engine handle both exist, wire them. Destructure the new handle members at the `createStruggleEngine(...)` call (src/extension.ts:82) and, where the provider's `LiveEngineFeed` is reachable (the provider exposes the feed via a getter or a `wireSlotDebug(provider, sink)` method added on the provider that forwards to `feed.setSlotProvider` + returns nothing; then call `setSlotChangeSink(() => feed.pushSlotUpdate())`):

```ts
    // after provider + handle exist:
    provider.wireSlotDebug(
        () => getSlotDebugSnapshot && getEpisodeHistory
            ? { snapshot: getSlotDebugSnapshot(), episodes: [...getEpisodeHistory()] }
            : null,
    );
    setSlotChangeSink?.(() => provider.pushSlotUpdate());
```
  Add to `artemisWebviewProvider.ts`: `wireSlotDebug(p) { this._liveEngineFeed.setSlotProvider(p); }` and `pushSlotUpdate() { this._liveEngineFeed.pushSlotUpdate(); }`. (NOTE for the implementer: confirm `provider` and the handle are both in scope at the post-construction wiring block in `extension.ts`; the provider already receives `struggleCoordinator` from the same handle, so they are co-located. If not, thread the handle into the provider constructor.)

- [ ] **Step 6: Run** the new feed test + types + the existing live-feed tests.

Run: `npx vitest run test/logic/struggle && npm run check-types`
Expected: PASS, tsc clean.

- [ ] **Step 7: Em-dash scan + Commit**

```bash
git add extension/src/extension/services/struggle/live/liveEngineFeed.ts extension/src/extension/telemetry/contract.ts extension/src/extension/telemetry/index.ts extension/src/extension.ts extension/src/extension/provider/artemisWebviewProvider.ts extension/test/logic/struggle/liveEngineFeedSlot.test.ts
git commit -m "feat(struggle): ref-count the live feed + route slot debug pushes to the webview"
```

---

## Task 5: Collapsible Container

**Files:**
- Modify: `extension/src/webview/components/Container/Container.tsx` (+ `Container.module.css`)
- Test: `extension/test/react/components/Container.collapsible.test.tsx` (Create)

**Interfaces:**
- Produces: `Container` accepts `collapsible?: boolean` + `defaultCollapsed?: boolean`. When `collapsible`, the header is a button toggling a chevron; the body stays MOUNTED and is hidden via the `containerBodyCollapsed` class (CSS `display: none`).

- [ ] **Step 1: Write failing test** `test/react/components/Container.collapsible.test.tsx`

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Container } from '@webview/components';

describe('Container collapsible', () => {
    it('defaultCollapsed hides the body but keeps it mounted', () => {
        render(<Container collapsible defaultCollapsed header="H"><div>BODY</div></Container>);
        const body = screen.getByText('BODY');
        expect(body).toBeInTheDocument();                 // mounted
        expect(body.closest('[data-collapsed="true"]')).not.toBeNull(); // hidden
    });
    it('clicking the header toggles collapse', () => {
        render(<Container collapsible header="H"><div>BODY</div></Container>);
        const btn = screen.getByRole('button', { name: /H/ });
        expect(screen.getByText('BODY').closest('[data-collapsed="true"]')).toBeNull();
        fireEvent.click(btn);
        expect(screen.getByText('BODY').closest('[data-collapsed="true"]')).not.toBeNull();
    });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run test/react/components/Container.collapsible.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** - add `collapsible`/`defaultCollapsed` to `ContainerProps`, a `useState` for collapsed, render the header as a `<button>` with a chevron when collapsible, and add `data-collapsed` + the collapsed class to the body wrapper:

```tsx
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);
  // ...
  const headerNode = collapsible
    ? <button type="button" className={styles.containerHeaderButton} onClick={() => setCollapsed(c => !c)} aria-expanded={!collapsed}>
        <span className={styles.containerChevron} aria-hidden>{collapsed ? '▸' : '▾'}</span>{header}
      </button>
    : header;
  // ...
  {header && <div className={styles.containerHeader}>{headerNode}</div>}
  <div className={clsx(styles.containerBody, collapsible && collapsed && styles.containerBodyCollapsed)} data-collapsed={collapsible ? collapsed : undefined}>{children}</div>
```
  CSS (`Container.module.css`): `.containerBodyCollapsed { display: none; }`; `.containerHeaderButton { all: unset; cursor: pointer; display: flex; align-items: center; gap: 6px; width: 100%; }`; `.containerChevron { font-size: 11px; opacity: 0.8; }`. (Static camelCase keys only.)

- [ ] **Step 4: Run, verify pass** + types

Run: `npx vitest run test/react/components/Container.collapsible.test.tsx && npm run check-types`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add extension/src/webview/components/Container/Container.tsx extension/src/webview/components/Container/Container.module.css extension/test/react/components/Container.collapsible.test.tsx
git commit -m "feat(ui): add collapsible variant to Container (body stays mounted)"
```

---

## Task 6: SlotPanel + useSlotCountdowns

**Files:**
- Create: `extension/src/webview/views/StruggleDetection/SlotPanel.tsx` (+ `SlotPanel.module.css`)
- Create: `extension/src/webview/views/StruggleDetection/useSlotCountdowns.ts`
- Test: `extension/test/react/views/StruggleDetection/SlotPanel.test.tsx` (Create)

**Interfaces:**
- Consumes: `SlotDebugSnapshot`, `EpisodeHistoryEntry`, `ExtensionMsg.StruggleSlotUpdate`; `StruggleLiveSubscribe` command; `mmss` from `useEngineCountdowns`.
- Produces: `<SlotPanel vscodeApi={...} />` (subscribes on mount, consumes `struggleSlotUpdate`, renders state + countdowns).

- [ ] **Step 1: Write failing test** `test/react/views/StruggleDetection/SlotPanel.test.tsx`

```tsx
// render SlotPanel, dispatch a window 'message' with type=struggleSlotUpdate + a DELIVERED snapshot,
// assert: state badge "DELIVERED", episode id shown, in-flight intent "confirm_close",
// and the abandon countdown renders when abandon.armed. Use the same message-dispatch helper
// the existing StruggleDetection react tests use (window.dispatchEvent(new MessageEvent('message', { data })) ).
```
  Concrete assertions: `expect(screen.getByText(/DELIVERED/)).toBeInTheDocument();`, `expect(screen.getByText('ep-1')).toBeInTheDocument();`, `expect(screen.getByText(/confirm_close/)).toBeInTheDocument();`, and an empty-state test when `state === 'free'` asserting a "slot free" message.

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run test/react/views/StruggleDetection/SlotPanel.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `useSlotCountdowns.ts`** - a 1s interpolation hook anchored on `snapshot.nowMs` (mirror `useEngineNow` from `useEngineCountdowns.ts`), returning `{ staleLeft: number | null; abandonLeft: number | null }` derived from `watchdog.staleDeadlineMs` / `abandon.deadlineMs` against the interpolated now. Reuse the exported `mmss`.

- [ ] **Step 4: Implement `SlotPanel.tsx`** - on mount `postCommand(vscodeApi, 'struggleLiveSubscribe')` and on unmount `'struggleLiveUnsubscribe'` (mirror `LiveEngineSection`); `useExtensionMessage` for `ExtensionMsg.StruggleSlotUpdate` -> `setSnapshot`. Render inside a `Container header="Slot (live)"`: state badge (colour by state), episode id/gen/age, hint count, watchdog + abandon countdowns (via `useSlotCountdowns` + `mmss`), in-flight intent + the three tokens (`localToken`, `episodeId:generation`, `requestToken` first 8 chars), owed/pending. Empty state when `state === 'free'`. Static camelCase CSS only.

- [ ] **Step 5: Run, verify pass** + types

Run: `npx vitest run test/react/views/StruggleDetection/SlotPanel.test.tsx && npm run check-types`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/src/webview/views/StruggleDetection/SlotPanel.tsx extension/src/webview/views/StruggleDetection/SlotPanel.module.css extension/src/webview/views/StruggleDetection/useSlotCountdowns.ts extension/test/react/views/StruggleDetection/SlotPanel.test.tsx
git commit -m "feat(struggle): live SlotPanel + slot countdown interpolation"
```

---

## Task 7: EpisodeHistoryPanel

**Files:**
- Create: `extension/src/webview/views/StruggleDetection/EpisodeHistoryPanel.tsx` (+ `.module.css`)
- Test: `extension/test/react/views/StruggleDetection/EpisodeHistoryPanel.test.tsx` (Create)

**Interfaces:**
- Consumes: `EpisodeHistoryEntry[]` (from the same `struggleSlotUpdate` message the SlotPanel consumes; this panel reads `msg.episodes`).
- Produces: `<EpisodeHistoryPanel episodes={EpisodeHistoryEntry[]} />` - a pure presentational list (the subscription is owned by SlotPanel; the parent passes `episodes` down, OR this panel subscribes too - both safe under the ref-counted feed). Default: it takes `episodes` as a prop to keep one subscription owner.

- [ ] **Step 1: Write failing test** - render with 2 entries, assert each row shows id + outcome chip + `mmss` duration; render with `[]` asserts the empty state.

- [ ] **Step 2: Run, verify fail.** Run: `npx vitest run test/react/views/StruggleDetection/EpisodeHistoryPanel.test.tsx` -> FAIL.

- [ ] **Step 3: Implement** - a `Container header="Episodes (this session)"` wrapping a scrollable list (`max-height` + `overflow-y: auto` in CSS), newest first (`[...episodes].reverse()`), one row per entry: id, peak level, outcome chip (colour by outcome), hint count, `mmss(durationMs/1000, 'floor')`, start time (`new Date(startedAtMs).toLocaleTimeString()`). Empty state when `episodes.length === 0`.

- [ ] **Step 4: Run, verify pass** + types -> PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/webview/views/StruggleDetection/EpisodeHistoryPanel.tsx extension/src/webview/views/StruggleDetection/EpisodeHistoryPanel.module.css extension/test/react/views/StruggleDetection/EpisodeHistoryPanel.test.tsx
git commit -m "feat(struggle): session EpisodeHistoryPanel"
```

---

## Task 8: Wire panels into the page + collapsible all sections

**Files:**
- Modify: `extension/src/webview/views/StruggleDetection/StruggleDetectionView.tsx`
- Modify: `extension/src/webview/views/StruggleDetection/DecisionFlowPipeline.tsx` (add + forward `collapsible`/`defaultCollapsed` to its `Container`)
- Modify: `extension/src/webview/views/StruggleDetection/TimersPanel.tsx` (same)
- Modify: `extension/src/webview/views/StruggleDetection/LiveEngineSection.tsx` (same; keeps its own `struggleLiveSubscribe` ownership)
- Modify: `extension/src/webview/views/StruggleDetection/SlotPanel.tsx` + `EpisodeHistoryPanel.tsx` (add + forward `collapsible`/`defaultCollapsed`)
- Test: `extension/test/react/views/StruggleDetection/StruggleDetectionView.slot.test.tsx` (Create)

**Interfaces:**
- Consumes: `SlotPanel`, `EpisodeHistoryPanel`, the `struggleSlotUpdate` message.

- [ ] **Step 1: Write failing test** - mount `StruggleDetectionView` with `developerMode: true`, `embedded: false`; dispatch a `struggleSlotUpdate`; assert the Slot panel ("Slot (live)") AND Episodes panel render. Second case: `embedded: true` -> assert neither renders. Third case: `developerMode: false` -> assert neither renders. Fourth: assert each section's `Container` uses the collapsible header (a `button`). (The subscribe/replay/ref-count ordering is exercised by Task 4's `liveEngineFeedSlot.test.ts` integration test, not re-tested here; this test covers the render/gating/collapsible wiring.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** - in `StruggleDetectionView.tsx`:
  - **Subscription model:** `LiveEngineSection` (unchanged) and `SlotPanel` each own their own `struggleLiveSubscribe`/`Unsubscribe`. This is SAFE now because the feed is ref-counted (deactivates only at count 0) and replays reset/backfill on EVERY subscribe (Task 4), so neither owner starves the other regardless of mount order. The view does NOT post a third subscribe: add `const [episodes, setEpisodes] = useState<EpisodeHistoryEntry[]>([]);` and a `useExtensionMessage` that only READS `msg.episodes` from the broadcast `struggleSlotUpdate` and fans it to `EpisodeHistoryPanel`.
  - **Collapsible:** thread `collapsible` + `defaultCollapsed` into every section's `Container`. Urgency and Developer Tools render their `Container` inline in the View (pass props directly). `DecisionFlowPipeline`, `TimersPanel`, `LiveEngineSection`, `SlotPanel`, `EpisodeHistoryPanel` each own their `Container`, so add `collapsible?`/`defaultCollapsed?` props to each and forward them. Decision-4 defaults: Urgency + Slot expanded (`defaultCollapsed={false}`); Decision flow, Engine timers, LiveEngineSection, Episodes, Developer Tools `defaultCollapsed`.
  - Render `{data.developerMode && !data.embedded && <SlotPanel vscodeApi={vscodeApi} />}` and `{data.developerMode && !data.embedded && <EpisodeHistoryPanel episodes={episodes} />}` after the Engine timers section.

- [ ] **Step 4: Run, verify pass** + the whole StruggleDetection react suite + types

Run: `npx vitest run test/react/views/StruggleDetection && npm run check-types`
Expected: PASS.

- [ ] **Step 5: Full verification + Commit**

```bash
npx vitest run    # full suite green
npm run check-types
git add extension/src/webview/views/StruggleDetection/StruggleDetectionView.tsx extension/test/react/views/StruggleDetection/StruggleDetectionView.slot.test.tsx
git commit -m "feat(struggle): mount slot + episode panels, collapsible sections, embedded-gated"
```

---

## Self-Review

**Spec coverage:** Decisions 1-6 all map to tasks - content (T6/T7), in-memory history (T3), event-push notify (T3/T4), collapsible all-sections + mounted bodies (T5/T8), placement + dev/embedded gating (T8), embedded hide (T8). Units 1-4 of the spec map to T3 (orchestrator), T2/T4 (wire), T6/T7 (panels), T5 (Container). Read accessors (T1). `INTERRUPTED`/`DISCARDED` reset semantics (T3). The three-token `inFlight` tuple (T2/T3/T6).

**Placeholder scan:** no "TBD/handle edge cases/similar to Task N". The one flagged confirm-at-execution item (T4 Step 5 handle/feed co-location) is a concrete instruction with a fallback, not a vague placeholder.

**Type consistency:** `SlotDebugSnapshot`/`EpisodeHistoryEntry`/`EpisodeOutcomeLabel` defined once (T2), consumed unchanged in T3/T4/T6/T7. `getSlotDebugSnapshot`/`getEpisodeHistory`/`setSlotChangeSink`/`setSlotProvider`/`pushSlotUpdate` names consistent across T3/T4. `staleDeadlineMs`/`isArmed` consistent T1->T3.
