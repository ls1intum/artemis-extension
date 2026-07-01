# Sender-aware LiveEngineFeed (live slot/chart/episodes in the fullscreen copy) - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the developer Struggle-Detection live feed sender-aware so the Slot panel, Episode history, and Live Engine chart update in real time in the fullscreen editor-tab copy (not just the sidebar).

**Architecture:** Replace the feed's single sidebar-bound `_post` with a `Map<Sink, refcount>` that fans out to every registered webview. Each webview (sidebar + any open fullscreen panel) registers its own sink through the existing `struggleLiveSubscribe` command routing, which now threads the real current sender. Stabilize both senders (sidebar: one ctor-created wrapper reused across re-resolves; fullscreen: pass `postSafe` directly). Airtight teardown via per-sink ref-count + a `dropSink` dispose backstop + a queued-command liveness guard. Then un-gate the three live sections in embedded mode. codex-reviewed over 3 rounds, verdict "ready".

**Tech Stack:** TypeScript, VS Code extension API, React webview, vitest (test/logic + test/react), mocha (test/unit).

## Global Constraints

- No AI/Claude attribution anywhere (code, comments, commit messages).
- No em dashes (U+2014) in added lines. Scan: `git diff <file> | grep '^+' | LANG=en_US.UTF-8 perl -CSD -ne 'print if /[\x{2014}]/'` must be empty.
- No golden-behavior change: this is webview-delivery plumbing only. No SlotManager / orchestrator / decision-path / Pyris / Artemis change.
- Dev-only surface stays behind the existing `developerMode` gate.
- Two test runners: vitest for test/logic + test/react; mocha (vscode-test) for test/unit. Put new logic tests under test/logic.
- Verify with `npm run check-types` (tsc --noEmit), not just lint, before each commit.
- CSS Modules camelCaseOnly (no CSS expected in this plan, but if any: static camelCase only).

## Design invariants (codex-vetted, do not deviate)

- **`type Sink = (msg: unknown) => void`.** Feed holds `Map<Sink, number>` (sink -> refcount).
- **Ref-count per sink** because ONE webview mounts TWO live subscribers (SlotPanel + LiveEngineSection) sharing one sender: `subscribe` increments, `unsubscribe` decrements and deletes at 0, `dropSink` deletes outright (host-teardown backstop). `unsubscribe`/`dropSink` on an absent key are silent no-ops.
- **Replay on EVERY subscribe, to THAT sink only** (preserves the current contract + the two-subscriber invariant + all existing feed tests).
- **Sender identity must be a STABLE reference:** sidebar = one ctor-created wrapper reused across re-resolves; fullscreen = the per-panel `postSafe` passed directly (not a fresh per-command arrow).
- **Capture the sender SYNCHRONOUSLY** as the first statement of the command handler (handleMessageWithSender restores `_sendMessage` only after `await handleMessage`, so a sync capture is safe).
- **Queued-after-dispose liveness guard:** `handleMessageWithSender` takes an optional `isAlive` predicate and skips the queued task when the host is dead; fullscreen passes `() => !disposed`.

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `extension/src/extension/services/struggle/live/liveEngineFeed.ts` | Map<Sink,number> sink model; subscribe(sink)/unsubscribe(sink)/dropSink(sink); fan-out; drop ctor `_post` | Modify |
| `extension/src/extension/telemetry/contract.ts` | `ILiveEngineFeed` sink signatures + `dropSink` | Modify |
| `extension/src/extension/telemetry/noop.ts` | clean-build feed stub: sink no-ops | Modify |
| `extension/src/extension/controller/webViewMessageHandler.ts` | `getCurrentSender()`; `handleMessageWithSender(msg, sender, isAlive?)` liveness guard; feed sink calls | Modify |
| `extension/src/extension/controller/commands/types.ts` | `CommandContext.getCurrentSender()` | Modify |
| `extension/src/extension/controller/commands/navigationCommands.ts` | `handleStruggleLiveSubscribe/Unsubscribe` pass `getCurrentSender()` | Modify |
| `extension/src/extension/services/ui/fullscreenPanelManager.ts` | pass `postSafe` directly to `handleMessageWithSender` + `() => !disposed`; expose postSafe + dispose hook for sink drop | Modify |
| `extension/src/extension/provider/artemisWebviewProvider.ts` | stable `_sidebarSender`; drop feed ctor post arg; wire fullscreen `dropSink` on dispose; expose `getCurrentSender` into the command context | Modify |
| `extension/test/logic/struggle/live/liveEngineFeed.test.ts` + `liveEngineFeedSlot.test.ts` + `liveWiring.test.ts` | update to the sink signature; add multi-sink fan-out + ref-count + dropSink cases | Modify |
| `extension/src/webview/views/StruggleDetection/StruggleDetectionView.tsx` | un-gate SlotPanel/EpisodeHistoryPanel/LiveEngineSection from `!embedded` (keep `developerMode`) | Modify |
| `extension/test/react/views/StruggleDetection/StruggleDetectionView.slot.test.tsx` | embedded now renders the three live sections | Modify |

---

## Task 1: Sender-aware feed core + routing + wiring (compile-complete)

Everything except the view un-gate. Keeps the build green: the sidebar keeps working through the new sink model (its SlotPanel/LiveEngineSection still subscribe via command), the fullscreen panels stay gated so no new render yet. This is one cohesive refactor; it must land together to compile.

**Files:** all rows above EXCEPT the two `StruggleDetectionView*` rows.

**Interfaces produced:**
- `LiveEngineFeed`: `subscribe(sink: Sink)`, `unsubscribe(sink: Sink)`, `dropSink(sink: Sink)`, `setSlotProvider(...)`, `pushSlotUpdate()`, `setSessionActive(active)`. Constructor `(source, isDeveloperMode, cap?)` (no `_post`).
- `ILiveEngineFeed` mirrors those (subscribe/unsubscribe/dropSink take `Sink`).
- `WebViewMessageHandler.getCurrentSender(): Sink`; `handleMessageWithSender(message, sendResponse, isAlive?: () => boolean)`.
- `CommandContext.getCurrentSender(): Sink`.

- [ ] **Step 1: Feed test first (RED).** In `test/logic/struggle/live/liveEngineFeed.test.ts` (and/or a new `liveEngineFeedSinks.test.ts`) add cases against the new signature:
  - two distinct sinks: `subscribe(a); subscribe(b)`; a tick fans out to BOTH; `pushSlotUpdate` fans out to BOTH.
  - same sink twice (`subscribe(a); subscribe(a)`) = refcount 2; one `unsubscribe(a)` still delivers to `a`; second `unsubscribe(a)` stops delivery (feed inactive when map empty).
  - `subscribe(a)` replays Reset/Backfill/SessionState + a slot push to `a` only (not to a previously-subscribed `b`).
  - `dropSink(a)` removes `a` regardless of count; `unsubscribe`/`dropSink` on an absent sink are silent no-ops.
  Update the EXISTING `liveEngineFeed.test.ts` + `liveEngineFeedSlot.test.ts` construction/subscribe calls to pass an explicit sink (they currently rely on the ctor `_post` + parameterless subscribe). Update `liveWiring.test.ts` (it constructs `new LiveEngineFeed({onDidTick}, post, () => true, 600)` and routes through NavigationCommandModule) to the new ctor + a context that supplies `getCurrentSender`.
  Run the feed + wiring tests: expect FAIL.

- [ ] **Step 2: Implement the feed.** In `liveEngineFeed.ts`:
  - `type Sink = (msg: unknown) => void;` `private _sinks = new Map<Sink, number>();`
  - Drop the constructor `_post` param (keep `source`, `_isDeveloperMode`, `cap`).
  - `subscribe(sink)`: `this._sinks.set(sink, (this._sinks.get(sink) ?? 0) + 1);` then if dev mode replay `Reset` + `Backfill {ticks:[...buffer]}` + `SessionState {active:_sessionActive}` + `this._pushSlotUpdateTo(sink)` to THAT sink.
  - `unsubscribe(sink)`: `const n = this._sinks.get(sink); if (n === undefined) return; if (n <= 1) this._sinks.delete(sink); else this._sinks.set(sink, n - 1);`
  - `dropSink(sink)`: `this._sinks.delete(sink);`
  - `_onTick`/`setSessionActive`/`pushSlotUpdate`: guard `if (!this._isDeveloperMode() || this._sinks.size === 0) return;` then `for (const sink of this._sinks.keys()) { sink(msg); }`. Extract a private `_pushSlotUpdateTo(sink)` for the single-sink replay and have `pushSlotUpdate()` fan `_pushSlotUpdateTo` over all sinks (or inline the message build once and loop). Keep the `_slotProvider` null-guard.
  - Active = `_sinks.size > 0` (replaces `_subscriberCount > 0`).
  - `ILiveEngineFeed` (contract.ts): `subscribe(sink: Sink)`, `unsubscribe(sink: Sink)`, `dropSink(sink: Sink)`. Export `Sink` (or define inline). `noop.ts`: the three as no-ops taking the param.

- [ ] **Step 3: Message handler.** In `webViewMessageHandler.ts`:
  - Add `getCurrentSender(): (m: ExtensionToWebviewMessage) => void { return this._sendMessage; }` and expose it on the command context object (the same object that already has `sendMessage`/`struggleLiveFeed`).
  - `handleMessageWithSender(message, sendResponse, isAlive?: () => boolean)`: inside the queued task, `if (isAlive && !isAlive()) { return; }` BEFORE the sender swap.
  - `types.ts`: add `getCurrentSender(): (m: ExtensionToWebviewMessage) => void;` to `CommandContext`.

- [ ] **Step 4: Command routing.** In `navigationCommands.ts`:
  - `handleStruggleLiveSubscribe = async () => { const sink = this.context.getCurrentSender(); this.context.struggleLiveFeed?.subscribe(sink); }` (capture sync as first statement).
  - `handleStruggleLiveUnsubscribe = async () => { const sink = this.context.getCurrentSender(); this.context.struggleLiveFeed?.unsubscribe(sink); }`
  - Update the `struggleLiveFeed` context type to the new signatures.

- [ ] **Step 5: Provider + fullscreen wiring.** In `artemisWebviewProvider.ts`:
  - Ctor: `this._sidebarSender = (m: ExtensionToWebviewMessage) => this._postMessageSafe(m);` (ONE stable reference). In `resolveWebviewView`, `setMessageSender(this._sidebarSender)` (reuse it, do not create a new closure per resolve).
  - `createLiveEngineFeed(coordinator, () => this._isDeveloperMode())` (drop the post arg).
  - Ensure `getCurrentSender` flows into the command context (it lives on the message handler; the handler already builds the context - just add it there).
  - Fullscreen: in `_openStruggleFullscreen`, arrange for `panel.onDidDispose` to call `this._liveEngineFeed.dropSink(<that panel's postSafe>)`. Thread the panel `postSafe` out of `openStruggleFullscreen`/`openPanel` (onReady already exposes postSafe) so the provider can register the dispose-time `dropSink`.
  In `fullscreenPanelManager.ts`:
  - Line ~204-207: `this._getMessageHandler().handleMessageWithSender(message, postSafe, () => !disposed);` (pass `postSafe` DIRECTLY + the liveness predicate; drop the `(resp) => postSafe(resp)` wrapper).
  - Expose the panel `postSafe` + an onDispose hook to the caller so the provider can `dropSink(postSafe)` on close (e.g. extend `openStruggleFullscreen`'s callback surface, or return the postSafe via the existing onReady and register a dispose via the existing onDispose option).

- [ ] **Step 6: Green.** Run `npx vitest run test/logic/struggle && npx vitest run test/logic/controller 2>/dev/null; npx vitest run test/logic && npm run check-types`. The feed + wiring + existing struggle suites pass; tsc clean. Also run the mocha unit suite for the message handler if it exists (`test/unit/controller/webViewMessageHandler.test.ts`) via the project's mocha runner, or at least confirm check-types + the vitest logic suites. The sidebar behaves exactly as before (its SlotPanel/LiveEngineSection subscribe via command -> stable sidebar sink -> fan-out).

- [ ] **Step 7: Em-dash scan + commit** (list only the touched files explicitly).

---

## Task 2: Un-gate the live sections in embedded + verify fullscreen

**Files:** `StruggleDetectionView.tsx` + `StruggleDetectionView.slot.test.tsx`.

- [ ] **Step 1: Test (RED).** In `StruggleDetectionView.slot.test.tsx`, change the embedded case: with `embedded: true` + `developerMode: true`, the Slot panel ("Slot (live)"), Episodes panel ("Episodes (this session)"), AND the Live Engine View ("Live Engine View (developer)") now RENDER (previously asserted absent). Keep the non-dev case asserting all absent. Run: expect FAIL (the gates still hide them in embedded).

- [ ] **Step 2: Un-gate.** In `StruggleDetectionView.tsx`, change the three gates from `data.developerMode && !data.embedded` to `data.developerMode` for SlotPanel, EpisodeHistoryPanel, and LiveEngineSection. Update the stale "Hidden in the embedded editor-tab copy" comments to reflect that the feed is now sender-aware.

- [ ] **Step 3: Green.** Run `npx vitest run test/react/views/StruggleDetection && npm run check-types`. Then the full suite once: `npx vitest run && npm run check-types`.

- [ ] **Step 4: Em-dash scan + commit.**

---

## Self-Review

- Sink model preserves replay-on-every-subscribe (existing feed tests) + the two-subscriber-per-webview invariant (ref-count) - both codex-confirmed.
- Teardown airtight: unsubscribe decrements/deletes; dropSink-on-dispose backstop; isAlive guard blocks queued-after-dispose re-add; absent-key no-ops.
- Sender stability: stable sidebar wrapper (no re-resolve dupes); fullscreen postSafe passed directly.
- Golden parity: no orchestrator/decision change; the feed's dev gate is intact.
- Manual check after Task 2: open the fullscreen copy, confirm Slot/Episodes/chart go live and update off the tick grid (e.g. a slot transition appears immediately, not at the next 10s tick).
