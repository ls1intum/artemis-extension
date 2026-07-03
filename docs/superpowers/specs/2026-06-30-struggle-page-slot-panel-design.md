# Struggle-Detection Page: Slot / Intervention-Continuity Panels - Design

**Date:** 2026-06-30
**Status:** Design (codex-reviewed; pending final sign-off + user approval)
**Scope:** Extension only (`artemis-extension/extension`). No Pyris/Artemis changes.

## Goal

Extend the developer-only Struggle-Detection diagnostic page so it also surfaces
the **intervention-continuity (slot) side** of the system, which is currently
invisible on the page (it lives in the orchestrator, not the detection engine).
Add two new sections - a live slot-state panel and a session episode history -
and make every section on the page collapsible so the page stays manageable.

## Context (current state)

- **The page:** `extension/src/webview/views/StruggleDetection/` - a React webview
  view, dev-gated (`developerMode`) and feature-gated (`isEnabled`). Sections today:
  Urgency card, `DecisionFlowPipeline`, `TimersPanel`, `LiveEngineSection`, the
  conditional `Developer Tools` section.
- **Two data feeds today:**
  1. `ExtensionMsg.StruggleDetectionInit` (`struggleDetectionInit`) - a per-view
     init snapshot built by `extension/src/extension/services/ui/viewInitDataService.ts`,
     carrying `StruggleData` incl. `data.debug` (the detection-engine debug snapshot).
  2. A live stream: the webview posts the `StruggleLiveSubscribe` command, handled in
     `extension/src/extension/controller/commands/navigationCommands.ts`, which drives
     `extension/src/extension/services/struggle/live/liveEngineFeed.ts`. The feed
     streams `struggleLiveTick` / `struggleLiveBackfill` / `struggleLiveReset` /
     `struggleLiveSessionState` messages. `LiveEngineSection` is its sole owner today
     (mounts the subscribe, owns the chart state).
- **The gap:** all of the above describes the *detection* engine (severity,
  boundaries, gates, timers - "does an alert fire?"). The **slot** lives in the
  orchestrator `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts`
  and changes on async server events and user clicks (reveal/dismiss), decoupled
  from the 10s tick grid. None of it reaches the page.

## Decisions (locked during brainstorming + codex review)

1. **Content:** both a live slot-state panel **and** a session episode history.
2. **History lifetime:** in-memory, current session only (a ring buffer in the
   orchestrator; lost on window reload). NOT persisted. Does NOT touch the eval-JSONL
   schema (that remains a separate methodology decision, "Lücke 2").
3. **Data seam:** event-push (Approach B), driven by an explicit **orchestrator-level
   debug notification** (`notifySlotDebugChanged()`) fired at the composite mutation
   points (see Unit 1), coalesced via `queueMicrotask`. This is NOT a per-tick refresh
   and NOT a `SlotManager` transition observer: those would publish snapshots taken
   mid-branch, before the runtime fields the panel explains (watchdog, in-flight,
   abandon, owed/pending) have settled. The notify fires after each composite mutation
   completes, so every published snapshot is internally consistent.
4. **Collapsible:** every section becomes collapsible (Urgency, Decision flow, Engine
   timers, LiveEngineSection, Slot, Episode history, Developer Tools). Collapse toggles
   visibility via CSS only - the body **stays mounted** (never unmounted). This both
   avoids resubscribe churn on the live feed and keeps collapse state non-persisted
   without losing in-flight panel state. Collapse state is NOT persisted across
   reloads (YAGNI).
5. **Placement:** same page, new sections appended after "Engine timers". Stays
   dev-only AND non-embedded only (see Embedded below).
6. **Embedded/fullscreen:** the new live slot + history sections are hidden in the
   embedded editor-tab copy (`embedded === true`), exactly like `LiveEngineSection`
   is today. The async live feed binds to the sidebar webview, not the fullscreen
   sender; surfacing them in fullscreen would need a sender-aware feed redesign, out
   of scope here. Documented limitation.

## Architecture

Three units, each independently testable. No `SlotManager` change (the golden-pinned
pure state machine is untouched).

### Unit 1 - Slot debug snapshot, episode history, and notify (orchestrator side)

In `struggleInterventionService.ts`:

- **`getSlotDebugSnapshot(): SlotDebugSnapshot`** - a pure read (never throws) that
  bundles `slotManager.snapshot()` with the orchestrator runtime the panel needs:
  - `state`: `'free' | 'parked' | 'delivered'`; `level`: `'ambient' | 'active' | null`
  - `episodeId`, `generation`, `episodeAgeMs`, `hintCount`, `isNew`
  - `inSession: boolean`
  - `watchdog`: `{ armed: boolean; staleInMs: number | null }` - read via new public
    accessors `StaleWatchdog.isArmed()` and `StaleWatchdog.staleDeadlineMs()` (panel
    interpolates the countdown locally), never via private internals.
  - `abandon`: `{ armed: boolean; deadlineMs: number | null }` - `armed` is derived
    from `_liveAskBinding !== undefined` (NOT from the latch: `DeadlineLatch` has no
    disarm and its deadline goes stale after the binding clears); `deadlineMs` is
    `armed ? _deadlineLatch.current() : null`.
  - `inFlight`: the full in-flight correlation tuple `{ intent: 'decide' |
    'confirm_close' | 'stale_check'; localToken: number; episodeId: string;
    generation: number; requestToken: string } | null` (from `_inFlightMarker` + the
    `InFlightGuard` token). This carries the real three-token discipline the panel
    shows (local supersession number, `(episodeId, generation)`, `requestToken`), which
    the slot's top-level `episodeId`/`generation` cannot - those describe the current
    slot, not the in-flight request (they differ for a pre-take `decide`). Render short
    prefixes only.
  - `owed`: `{ confirmClose: boolean; staleCheck: boolean }`
  - `pendingOutcomes: number` (size of `_pendingOutcomes`)
- **`_episodeHistory: EpisodeHistoryEntry[]`** - a ring buffer (cap 20, oldest dropped).
  Filled by ONE private helper:
  - **`recordTerminalEpisode(episode: Episode, outcome): void`** - derives `peakLevel`
    (max level present in `episode.hints`) and `durationMs` (now - `createdAtMs`)
    itself; callers pass only the episode object + the outcome, so they cannot pass a
    wrong level/duration. Appends `{ episodeId, peakLevel, outcome, hintCount,
    durationMs, startedAtMs }`.
  - Called from ALL terminal sites: silent-discard, confirmClose-resolved DELIVERED,
    confirmClose-resolved PARKED, dismiss, watchdog force-free, watchdog free-silent,
    abandon-fire, stale-ask "something-else", and `resetSession`.
  - **Outcome enum (history-only):** `'DISMISSED' | 'RECOVERED' | 'ABANDONED' |
    'DISCARDED' | 'INTERRUPTED'`. `DISCARDED` = a PARKED episode dropped silently (no
    row/outcome). `INTERRUPTED` = a live episode wiped by a new-exercise `resetSession`.
  - **Reset semantics (explicit):** `resetSession()` on DELIVERED records `INTERRUPTED`;
    `resetSession()` on PARKED records `DISCARDED`; the lighter `reset()` records nothing.
- **`notifySlotDebugChanged(): void`** - calls an injected best-effort
  `onSlotChange?()` dependency, coalesced via `queueMicrotask` (at most one push per
  synchronous mutation branch). Wrapped so a webview-post failure never propagates
  into a slot path (same contract as the existing `devLog`). Called at the composite
  mutation points, each AFTER the branch's mutations complete:
  - after each decide-action branch in `_applyDecideAction`
  - after in-flight set/clear (`_inFlightMarker`)
  - after live-ask arm / free-text advance / revoke / clear (`_liveAskBinding`,
    `_deadlineLatch`)
  - after owed/pending change (`_owedConfirmClose`, `_owedStaleCheck`, `_pendingOutcomes`)
  - after `_clearEpisodeRuntime()`
  - after `setInSession()`
  - after `resetSession()`

### Unit 2 - Wire seam (ref-counted feed)

- **Ref-count the live subscription** in `liveEngineFeed.ts`: `StruggleLiveSubscribe`
  increments a counter, `StruggleLiveUnsubscribe` decrements; the feed is active while
  count > 0 and deactivates only at 0. This makes the one subscription multi-owner safe
  so `LiveEngineSection` (unchanged) and the two new panels can each own their own
  subscribe/unsubscribe.
- **Subscribe replay semantics (explicit):** the engine `struggleLiveReset` + backfill
  + sessionState AND the current slot snapshot (`struggleSlotUpdate`) are replayed on
  EVERY subscribe (preserving the current feed behavior the existing tests rely on, and
  painting a late-mounting panel; the chart reset is idempotent). The ref-count governs
  only DEACTIVATION: the live tick stream stops once the subscriber count returns to 0.
  This keeps `LiveEngineSection` (which owns its own subscribe) and the new panels
  multi-owner safe regardless of mount order. Because collapsible bodies stay mounted
  (Decision 4), re-subscribe only happens on view open/close anyway.
- **New message** `ExtensionMsg.StruggleSlotUpdate` (`'struggleSlotUpdate'`), payload
  `{ snapshot: SlotDebugSnapshot; episodes: EpisodeHistoryEntry[] }`. Add: the
  `ExtensionMsg` enum value + the payload-map entry in `extensionMessages.ts`. No
  per-message guard entry is needed - `isExtensionMessage()` (`typeGuards.ts`) is
  driven from `Object.values(ExtensionMsg)`, so the enum value alone suffices (there is
  no `NON_EMPTY` handling).
- **Routing:** the orchestrator's injected `onSlotChange` calls into `LiveEngineFeed`
  (or a small shared live-subscription service the feed and the callback both use),
  which posts `struggleSlotUpdate` only while active. The callback is wired into the
  orchestrator construction in `telemetry/index.ts`, mirroring how `devLog` is injected
  today; no-op while the feed is inactive (no webview cost when the page is closed).

### Unit 3 - Webview panels (React)

In `extension/src/webview/views/StruggleDetection/`:

- **`SlotPanel.tsx`** (+ `.module.css`): the live slot snapshot. State badge
  (FREE/PARKED/DELIVERED, colour-coded), episode id/gen/age, hint count, watchdog +
  abandon countdowns (interpolated via a small hook modelled on `useEngineCountdowns`),
  in-flight intent + the three tokens (local supersession #, `(episodeId, generation)`,
  `requestToken` prefix), owed/pending flags. Empty state when `state === 'free'`.
- **`EpisodeHistoryPanel.tsx`** (+ `.module.css`): a scrollable list, newest first,
  one row per `EpisodeHistoryEntry` (id, peak level, outcome chip, hint count,
  duration, start time). Empty state when no episodes yet.
- `SlotPanel` consumes `struggleSlotUpdate` and owns its subscribe/unsubscribe (safe
  under the ref-counted feed). `EpisodeHistoryPanel` is presentational: the view reads
  `msg.episodes` from the same broadcast and passes them down as a prop (no extra
  subscribe). Both rendered only in non-embedded dev mode.

### Unit 4 - Collapsible Container

- Extend `extension/src/webview/components/Container/` with optional
  `collapsible?: boolean` and `defaultCollapsed?: boolean`. When `collapsible`, the
  header becomes a button with a chevron; clicking toggles local React state and
  shows/hides the body via CSS (`display`), keeping it MOUNTED. Non-collapsible usage
  unchanged (default `false`).
- Apply to every StruggleDetection section. Defaults: Urgency and Slot expanded;
  Decision flow, Engine timers, LiveEngineSection, Episode history, Developer Tools
  collapsed.

## Data flow (Approach B)

```
composite slot mutation completes
        │  notifySlotDebugChanged()  (coalesced via queueMicrotask)
        ▼
injected onSlotChange()  ──►  LiveEngineFeed: if active (refcount>0),
                              post struggleSlotUpdate(getSlotDebugSnapshot(),
                                                      _episodeHistory)
        │                                 │
        ▼                                 ▼
(SlotPanel + EpisodeHistoryPanel) consume; client interpolates
   abandon/stale countdowns at 1s from the snapshot deadlines
```

Initial paint: each subscribe (re-)emits the current slot snapshot, so a panel paints
as soon as it mounts.

## Error handling / edge cases

- `getSlotDebugSnapshot()` is a pure read and never throws; missing runtime maps to
  `armed: false` / `null`, rendered as "clear"/empty.
- `notifySlotDebugChanged()` / the `onSlotChange` post is best-effort (wrapped); a
  failure never propagates into a slot teardown path.
- No active session: Urgency shows its existing empty state; Slot shows FREE/empty;
  history shows its own empty state.
- Reload clears the in-memory history (by Decision 2).
- Embedded copy: the new live sections are not rendered (Decision 6).

## Testing

- **Logic (vitest, `test/logic/struggleIntervention/`):** `getSlotDebugSnapshot`
  shape for free/parked/delivered + each runtime combination (incl. abandon `armed`
  derived from `_liveAskBinding`, watchdog accessors); `recordTerminalEpisode` derives
  `peakLevel`/`durationMs`, appends at each terminal site, caps at 20, and records the
  right outcome incl. `INTERRUPTED`/`DISCARDED` reset semantics; `notifySlotDebugChanged`
  fires once per composite mutation (coalesced) and is a no-op when `onSlotChange` is
  absent.
- **Feed (vitest):** the tick stream deactivates only when the subscriber count returns
  to 0 (not on the first of multiple unsubscribes); engine reset/backfill + slot snapshot
  are replayed on EVERY subscribe.
- **React (vitest, under `test/react/.../StruggleDetection`):** `SlotPanel` renders
  each state + interpolated countdowns from a snapshot; `EpisodeHistoryPanel` renders
  rows + empty state; `Container` collapsible toggles body visibility (mounted) and
  respects `defaultCollapsed`.
- **Gates:** `npm run check-types` clean; em-dash scan clean on added lines; existing
  StruggleDetection + struggleIntervention + slot suites stay green (no `SlotManager`
  change, so golden parity is structurally untouched).

## Global constraints (binding)

- No AI/Claude attribution anywhere (code, comments, commits).
- No em dashes (U+2014) in added lines.
- No carets/tildes in package.json (n/a - no new deps).
- CSS Modules are camelCaseOnly in the production esbuild bundle: static camelCase
  `styles.x` lookups only, never dynamic kebab-case `styles['a-b']`.
- Two test runners: vitest for `test/logic/**` + `test/react/**`; new logic tests go
  under `test/logic/**`, not `test/unit/**`.
- Dev-only surface: the whole feature stays behind the existing `developerMode` gate.

## Out of scope

- Persisting the episode history to disk / extending the eval-JSONL schema ("Lücke 2").
- A sender-aware live feed so fullscreen/embedded gets the live panels.
- Any Pyris or Artemis change.
- Student-facing surfacing of slot state (this is a developer diagnostic).
- Any `SlotManager` change.
