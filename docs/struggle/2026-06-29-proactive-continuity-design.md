# Spec: Proactive Intervention Continuity (the "Slot" model)

- **Date:** 2026-06-29
- **Status:** Spec for review (brainstorm converging). NOT yet a build plan.
- **Branch:** `feat/struggle-v3-integration`

## 1. Problem

Today each intervention is decided **statelessly** and the visible surface is **blindly
overwritten** by whatever Iris last said. Observed live: a loud `active` was ignored, its toast
auto-vanished, then a quieter `ambient` **replaced** it, with no student action in between. Two
defects: (1) **random downgrade / no continuity**; (2) **the loud surface self-destructs** (the
toast auto-dismisses, so `active` is easy to miss). Deeper bug: "did the student click?" is the
wrong signal. **No click != ignored** (the student may be reading/thinking and still stuck).

## 2. Core principle

> **Iris re-evaluates every tick. The slot is the gate to the user. A NEW user-facing *pop* only
> happens when the slot is FREE. A *delivered* hint is never downgraded and never auto-elaborated;
> the one allowed change is ESCALATION (opened `ambient` + a hard event → `active`, §6). A still-
> *parked* hidden ambient may be quietly replaced. More detail comes when the student asks.**

The engine + Iris decision pipeline stay unchanged. This spec is the layer that decides what
reaches the **user** afterwards.

## 3. Slot, Session, Episode (terms)

- **Chat-Session** = the **durable** Iris conversation for an exercise (server-saved, has a
  `sessionId`, survives days). Holds **all** messages.
- **Episode** = **one** struggle = a group of related proactive messages (the foldable thread).
- **Slot** = the **runtime** pointer to the currently-live episode (**FREE** or **TAKEN**). At any
  moment it points at **exactly one** episode. (A still-**PARKED** hidden ambient may be re-pointed to
  a new episode without going FREE first — §4; nothing was delivered, so the old one is discarded with
  no trace.)

So: a **Session contains many Episodes** over time; the **Slot** points at the live one.

## 4. The slot (rules)

- One slot, **FREE** or **TAKEN**.
- FREE → a new nudge takes the slot and shows.
- TAKEN has **two strengths** (Model Y — *the slot protects only what the student has been shown*):
  - **PARKED** = a hidden `ambient` holds the slot, but its content was never delivered (only a
    pointer is up, §5). **No protection:** the **next decision replaces it** unconditionally (quieter,
    louder, or a different problem). Nothing was shown, so replacing it is not the overwrite bug; a
    replacement that comes back `active` is a fresh *first delivery*, not an escalation of the ignored
    hint. (Decisions are produced only on an **event/boundary**, so between events the frozen text just
    persists — not a protection, simply no new decision to replace it, §5.) **Replacing a PARKED
    ambient ends that (undelivered, no-trace) episode and starts a NEW `episodeId`** — its frozen text
    evaporates and does **not** carry into the new episode's `hints[]`. So slot↔episode stays 1:1 (§3)
    and history never mixes unrelated hints.
  - **DELIVERED** = content reached the student (an `active` push, or an `ambient` the student
    clicked open). Hard-protected: no new interruption, no quieter downgrade, no auto-elaboration.
    The only allowed change is an **escalation** (opened `ambient` + a hard event → `active`, §6).
- **IN-SESSION** = a soft indicator that **the chat view is currently open/focused** (a UI state the
  client reads directly — **not** inferred from a sent reply, so no send-ordering dependency, and it
  does **not** bump the slot generation, §6). It affects **only escalation loudness** (an escalation
  goes quietly into the open chat rather than a toast, §6) — it is **not** a slot-resolution state and
  **never** frees / closes / keeps the slot. (**Free-text never resolves the slot**; resolution is via
  progress, dismiss, a stale-ask button, the stale timer, or the hard-cap force-free, §7.) New content
  still flows **quietly into the open chat**; no new interruption.
- Frees **only** on **progress**, **dismiss**, or the **stale-episode cleanup** (all §7). **Opening
  / reading / working with the hint does NOT free it** (you are using it).

**PARKED lifecycle (authoritative).** A PARKED hidden ambient (ambient decided, not clicked) exits in
exactly these ways, nothing else:
- **click** → becomes **DELIVERED** (text **revealed immediately**; persistence attempted then
  retried, §12);
- **next decision** (fires only on an event/boundary): `ambient` / `active` → **replace** (new
  `episodeId`, §6); `silent` → **discard → FREE** (no row);
- **progress** confirmed (§7.1) → **FREE**, silent (nothing was shown to close);
- **stale** → **FREE**, silent (no row). PARKED has **no stale-ask and no per-ask ABANDON
  timer/buttons** (those are DELIVERED-only), but it **is** governed by the episode-level **stale
  watchdog** (§7.3) — that watchdog is exactly what frees it on stale.

A PARKED ambient carries **no buttons and no per-ask timer of its own** (only the shared stale
watchdog, §7.3) and **never leaks**: the watchdog frees it even if no other event fires.

## 5. Surfaces: ambient = pull, active = push

**The only real difference: `ambient` = pull (the student must click to get the content), `active`
= push (the content appears automatically).** Same kinds of signals; only whether content
auto-shows differs.

**Loudness is one axis: `silent` < `ambient` < `active`.** Clicking an `ambient` open does **not**
raise its loudness (it stays `ambient`, the content just becomes visible). There is **no "deepen"**:
Iris never auto-elaborates a delivered hint at the same level — if the student wants more, they
**ask** in the normal chat (already built). See §6.

**"There is something" pointers (subtle, content-free):**
- **Badge** on the sidebar Iris icon (**both levels**; the small dot on the Iris view's activity-bar
  icon).
- **Gutter Iris icon** at the anchored line (**both levels**, if an anchor exists) — points at
  *where*, **no inline text**.
- **Status-bar item** ("Iris has a hint") — **ambient only**, the clickable bottom-bar pointer, mainly
  the no-anchor fallback (active relies on its louder surfaces).

**ambient (pull):** ONLY the pointers above. **No toast, no inline text, no auto chat bubble.** The
hint text is **hidden and NOT stored**; clicking any pointer **reveals** it as a chat message
(persisted then, best-effort retried on failure, §12). If the student never clicks, nothing is persisted. The hidden text is
held **frozen** (one held text per slot): while it stays hidden it is simply not refreshed — the engine
produces a new decision only on an **event/boundary**, so during pure soft drift there is no decision
to replace it. When one does fire, the **next decision replaces it unconditionally** (no protection,
§4/§6 — just nothing firing in between). A hidden `ambient` has **no explicit dismiss** (nothing to
wave away but a content-free pointer); its **full exit set is the authoritative PARKED lifecycle
(§4)** — click (→ reveal), a next decision (replace / `silent`-discard), progress, or stale-free — all
silent if never clicked.

**active (push):** the content appears automatically — **chat bubble** + **toast (once)** + the same
pointers (badge, gutter icon) **plus the after-line inline cue text** at the anchored line
(`inline_hint`). No click needed.

**Permanence — three lifetimes:**

| Element | ambient | active | Lifetime |
|---|---|---|---|
| **Chat message** (hint text, in the episode thread) | only **after a click** reveals it | yes, automatically | **permanent** (server-saved) |
| **Badge** on sidebar Iris icon | yes (subtle) | yes | slot-durable (clears when chat opened / on resolve) |
| **Gutter Iris icon** at the line | when anchor exists | when anchor exists | slot-durable |
| **Inline cue text** (after-line, `inline_hint`) | – (no inline text, pull) | when anchor exists | slot-durable |
| **Status-bar item** | yes (esp. no-anchor) | – (already louder) | slot-durable |
| **Toast / popup** | – | yes, **once** | transient (seconds → bell) |

- **permanent** = **once persisted**, lives forever in chat history (survives reload/days), never
  auto-deleted (the first persist is best-effort, §12; until it succeeds, visibility is runtime-only).
- **slot-durable** = stays while the slot is TAKEN (no timer); clears when the slot **frees**
  (progress, dismiss, or stale-free, §7). The **badge** additionally clears as soon as the chat is
  opened (the student has seen there is something).
- **transient** = a few seconds, then the notification bell.

ambient and active stay **distinct** (pull vs push); they are not merged. **ambient drops the
after-line inline text** (gutter icon only, it just *points*); **active keeps it** (`inline_hint`
shown after the anchored line, on top of the bubble).

## 6. Reconciliation while TAKEN (the client filter)

Pyris is **stateless**: it does not know the slot. Each tick/event it makes a **fresh** decision
(`silent` / `ambient` / `active` + text) from the signal + episode context (§11). The **client**
then applies that decision against the slot — this filter is the actual fix for the overwrite bug.

On a **DELIVERED** hint the client allows only:

- **Softer than what was delivered → suppress.** Never replace a delivered hint with a quieter one
  (the original downgrade bug).
- **Same level / "more detail" → do nothing.** There is **no auto-deepen**: the one delivered hint
  stands. Want more? The student **asks** in the normal chat (already built, §16) — Iris does not
  spontaneously elaborate (matches §15: no over-help).
- **Louder → escalate, in exactly ONE case: an opened `ambient` + a new HARD event → `active`** (a
  new failing build FM/FM_PLUS, a new error, a terminal run E4, a multi-line paste N1). A hard event
  is genuine new information. **Soft severity drift alone never escalates** — a rising `sBase`
  (slower typing / longer pauses) is indistinguishable from "the student is reading the hint", so it
  is no basis to get louder (also §15: no escalate-on-ignore). Whether that one escalation **pushes**
  (toast/inline) or just drops a **quiet** message into the open chat depends on IN-SESSION (§16).
  There is **no separate `escalate` intent** — it is a normal `decide` call whose louder result the
  client applies in place.

On a **PARKED** hidden ambient there is **no protection**: the next decision **replaces** the frozen
held text unconditionally (§4). It is not refreshed during pure soft drift only because no decision
fires then — not a rule. A replacement that comes back `active` is a fresh *first delivery*, not an
escalation of the ignored hint; one that comes back **`silent`** (Iris now judges nothing is needed)
**discards** the PARKED ambient → **slot FREE** (no row, no trace).

A genuinely **new, separate** interruption (a *different* problem): if the slot is **DELIVERED** it
**waits** until the slot frees — a delivered episode is **never preempted** (one focus at a time,
§13). If the slot is only **PARKED** (nothing delivered), the different problem simply **replaces** it
as a new episode (§4). The "much-worse B" case is handled by the §7.3 stale-ask freeing A, **not** by
interrupting a delivered episode.

- **Within-episode messages are not "new pops".** An escalation, the closing message (§8) and the
  stale-ask (§7.3) are about the *current* episode (not a new *issue*); §2's "never pop something new"
  forbids a new *interruption for a new issue*, not these. Even when an escalation uses an active push
  (not IN-SESSION, §6 above), it deepens the **live** episode rather than popping a new one.
- The gutter icon stays put (it must **not** retire on the first keystroke anymore — too eager
  today).

**Async / generation guard.** Every slot decision is async (a `decide` / `confirmClose` / `staleCheck`
response, the `~60 s` stale timer, the `~5 s` close timer, a button click), so a late one can arrive
after the slot already moved on. The client keeps a monotonic **`slot_generation`** — **local,
off-wire client metadata** — **bumped only on a SEMANTIC slot transition**: take, replace / supersede
(new `episodeId`), free, `PARKED→DELIVERED`, and an escalation. It is **NOT** bumped for
**presentation-only** changes — `IN-SESSION` (chat open/focused) and stale-ask visibility — so a valid
in-flight `decide` / `confirmClose` is **never** dropped just because the chat was opened meanwhile;
**quiet-vs-push loudness is computed from the *current* UI state at apply time**, not baked into the
request. The client also keeps the current **`episodeId`** and, while a stale-ask is open, an **`ask_id`**
(client-local; rides on the rendered stale-ask message + its buttons, §16, **not** persisted). A
client-local **`stale_check_id`** likewise dedups in-flight `staleCheck` requests (§7.3). Each
pending request/timer remembers the `episodeId` + `generation` (and `ask_id` / `stale_check_id`) it was
issued under; on arrival it is **applied only if those still match the live slot** — otherwise
**dropped as stale**. So no late `decide` / `confirmClose` / timer / button mutates the wrong or
already-freed episode, nor under rules that have since changed (used by §7 and §16). The stale-ask's
ABANDON timer additionally carries a monotonic **`deadline`**, advanced on every free-text reset
(§7.3); an expiry fires the ABANDON **only if it is still the current `deadline`**, so a superseded
(pre-reset) timer callback is a no-op.

**Single-flight per intent.** Generation/id match is not enough when two requests of the same intent
overlap, so `decide` and `confirmClose` are **single-flight per episode**: the client tracks the
**latest** outstanding request per intent and **applies only the newest** response, dropping any older
same-generation one (an old `decide` cannot overwrite a newer PARKED replacement, and `confirmClose`
cannot apply twice — e.g. from a progress edge plus a button, or a double-click). Stale-ask **buttons
disable after the first click** (no double-fire); `staleCheck` is already single-flight via
`stale_check_id` (§7.3).

## 7. Resolution (freeing the slot)

The slot frees **only** when:

1. **Progress** — the student is getting unstuck. **Always two-stage:** the **engine** flags likely
   progress (cheap, hard signal: a new green test, or `sBase` sustained below the re-arm threshold
   ~0.6 for ~30s), and **Iris must then confirm it** (re-reads the code). **Iris confirmation is
   mandatory** — if Iris judges it is not actually resolved, it stays quiet and the slot stays TAKEN.
   **Edge-triggered, exactly one `confirmClose` per progress edge:** `OPEN` → engine flags progress →
   `CANDIDATE_CLOSE` (fire **one** `confirmClose`) → Iris `resolved=true` → **slot FREED immediately**
   (persist the close, mark `RECOVERED`); the ~5 s closing timer is **UI-only** folding of the
   already-freed episode (§8), so a new issue may take the slot during it.
   `resolved=false` → back to `OPEN`, **no immediate re-fire** — only a **fresh** progress edge (a new
   green test, or `sBase` rising then dropping under ~0.6 again) re-arms the next `confirmClose`. **No
   fuzzy "code-delta" predicate** — kept fully deterministic. A *quiet* recovery that produces no such
   edge is still caught by the **stale-ask (§7.3) backstop** (the student clicks "Yes, solved it" →
   `confirmClose`), so a delivered slot cannot leak. This prevents a per-tick race and Pyris spam.
2. **Dismiss** — the student explicitly waves it away. Concrete affordance: a **"Dismiss" action on
   the delivered hint card** (and on the `active` toast). It dismisses the **whole episode** (frees
   the slot → `DISMISSED`, then folds, §8). A **PARKED** hidden ambient has **no** dismiss (only
   click / progress / stale-free, §5) — there is nothing shown to wave away.
3. **Iris asks (stale-episode cleanup)** — fires only when the slot is **DELIVERED** on problem A but
   there is **no progress on A for a sustained while** (a file-switch or a quiet idle are *sufficient*
   signs, **not required** — a student working a *different task in the same file* counts too). A
   **PARKED** (never-delivered) ambient gets **no** stale-ask — it just frees **silently** on stale
   (§5): no question, no row, nothing was ever shown to ask about. Iris judges
   task-relevance with the tools it already has (`get_problem_statement` for the Artemis task
   structure + `get_feedbacks` for which task's tests are moving + the current code, §11) — no
   file-switch heuristic, language-agnostic. It then drops **one quiet question** into the chat ("Did
   you get past X?") with **explicit quick-reply buttons** and **no toast**. The buttons make the
   answer **deterministic — no LLM classification, so a real typed question can never be swallowed**
   (§16):
   - **"Yes, solved it"** → run `confirmClose` (Iris re-reads the code; a bare "yes" never frees a
     still-broken slot). If `resolved=true` → close (§8). If `resolved=false` (code still broken — the
     student misjudged) → the slot **stays TAKEN** and Iris posts **one** gentle offer
     (its `rationale` line, e.g. *"Looks like the empty-list case still trips — want to look
     together?"*), never a silent no-op.
   - **"Still on it"** → slot stays TAKEN.
   - **"Doing something else"** → free the slot **silently** (`ABANDONED`; no code-check needed).
   - **Free-text instead of a button** is **never** intercepted — it goes straight to the normal chat
     (§16) and **never resolves the slot** (resolution is only via progress / dismiss / a button / the
     timer / the hard-cap, §7); the ask and its buttons stay. It only **resets the ask's ABANDON timer
     to ~30 s** — the student is active, so don't ABANDON yet, but free-text is a weaker "I'm on A"
     signal than a button, hence a shorter window than the initial ~60 s. The reset is **provisional on
     submit** (applied immediately, so a slow send/ack never ABANDONs mid-engagement) and **revoked
     only on a hard send failure**; it advances the ask's `deadline` so a superseded timer is a no-op
     (§6).
   - **No activity until the timer expires** → **free the slot** (`ABANDONED`). The timer **starts at
     ~60 s**; a **button** resolves the slot immediately; a **free-text** resets it to **~30 s** — **but
     bounded by an absolute per-ask ceiling (~5 min from the ask, tunable): free-text resets can never
     push the `deadline` past it, so the slot ABANDONs regardless of chatter once the ceiling is hit.**
     This **restores guaranteed termination** (so the "max 2 asks" cap and §13's delay bound actually
     hold). (The student can always click "Still on it" to keep A explicitly.) All windows are
     **tunable**.

   **Stale watchdog + counters (the termination guarantee).** A client-side **stale watchdog** drives
   this (the engine is event-driven, so we do **not** rely on a new event firing): it is **armed** when
   the slot becomes TAKEN, **reset** on meaningful progress/activity toward A, and **fires** after
   `STALE_AFTER` of no progress (the "sustained while", tunable). On fire it runs a `staleCheck`
   (DELIVERED) or frees silently (PARKED, §4). Two per-episode counters bound it:
   - **`staleWindowCount`** increments on **every** watchdog fire (every `staleCheck`), regardless of
     `ask=true` / `ask=false`. At an episode **ceiling** (`STALE_WINDOW_MAX`, ~4, tunable) the slot is
     **force-freed** (`ABANDONED`) — the **hard termination bound**, so even endless `ask=false` noops
     cannot keep a slot TAKEN forever (this is what makes §13's delay bound real).
   - **`staleAskCount`** increments only when a question is actually **posted** (`ask=true`); capped at
     **2** (the nagging bound) — past 2, later windows do **not** post a question even if `ask=true`,
     they only tick `staleWindowCount` toward the ceiling.
   Neither counter resets within an episode; the episode ends on a terminal outcome (recovered /
   abandoned / dismissed). Example: ask#1 → "Still on it" → drift → ask#2 → "Still on it" → drift →
   further windows are silent until `STALE_WINDOW_MAX` force-frees.

   **One staleCheck at a time (no duplicate asks).** The client fires **at most one `staleCheck` in
   flight** per episode, stamped with a client-local **`stale_check_id`**. A `staleCheck` response
   posts the ask **only if** it is the current in-flight `stale_check_id`, the `slot_generation` still
   matches, **and no ask is already open** — otherwise it is **dropped** (a late / duplicate response
   can never post a second question). Any **button** on the open ask (including "Still on it") and any
   **slot free** also **cancel** an in-flight `staleCheck`. This is how "the student continues
   elsewhere" is handled, so **no deterministic topic-change detection is built** (§13).

On confirmed progress, do **not** silently remove the marker. Iris closes it (§8). The hint text
**stays** in the chat (permanent **once persisted**, §12). (The stale-cleanup ask in #3 is the gentle counterpart for
episodes that fade out rather than getting solved.)

## 8. Closing UX

This describes the **progress** close (§7.1). **The slot is FREE the instant progress is confirmed**
(outcome marked `RECOVERED`, §7.1); the ~5 s below is **UI-only** (folding the already-closed episode),
and a **new episode may take the slot during it**. On confirmed progress, **both**, but split:
- Iris posts a **closing message** with **praise + a problem name**, e.g. *"Nice 👍 — that was the
  wrong index."* It stays visible for a short **~5-second timer**.
- **Then** the episode **folds** to a one-liner carrying the **problem name** (scannable history):
  *"✓ Wrong index"*.
- So **praise lives in the (expandable) closing message, the problem name in the fold-line.** Iris
  returns two small fields in its close: `closingSentence` (praise) + `episodeLabel` (the fold name).

**Non-progress resolutions (dismiss §7.2, stale-free §7.3) also fold — but WITHOUT a praise close**
(they faded rather than getting solved). They just collapse the thread; the fold-line label is
client-derived (the first hint's gist, or a neutral "Proactive hint"), so **no extra Iris call** and
no `closingSentence`. Only **progress** earns the praise + Iris `episodeLabel`.

**Never-delivered ambient = nothing to close.** If the episode was a hidden `ambient` the student
**never** saw (never clicked, never escalated to `active`), there is no visible artifact: the slot
just frees **silently**, the frozen held text evaporates, **no closing message and no fold-line**.
Closing/folding applies only to episodes that were actually delivered.

## 9. Chat presentation

One **episode = one foldable group of its *proactive-origin* messages** (the student's replies and the
tutor's answers stay **inline** as normal chat, **not** in the fold, §12). Normally just **one**
proactive hint in the group (no deepen pile); a few proactive-origin messages may join — an
**escalation** (§6), the **stale-ask** (§7.3), a **confirmClose-`false` offer** (§7.3), and the
**close** (§8) — all grouped by `proactiveEpisodeId`, latest open, earlier collapsed. On reload the
group folds; the interaction it sparked stays as normal chat.

```
Iris-Chat
─────────────────────────────────────────────
💡 Iris reached out  (you didn't ask)
┌─────────────────────────────────────────────┐
│ Look at the loop's exit condition: what      │  ← the hint, expanded
│ happens when the list is empty?              │
│                                              │
│ ▸ earlier hint (1)                           │  ← only if an escalation added one
└──────────────────────────────────────────────┘
```

After progress (the ~5-second timer elapses), the whole episode folds, but stays retrievable:

```
✓ Wrong index                               ▸     ← problem name, expandable, stays in history
  Iris: "Nice, that was it 👍"
```

- Proactive hints are visually marked as proactive ("Iris reached out, you didn't ask").
- **Same card for both levels;** `active` arrives pushed (bubble + toast + badge), `ambient` only
  appears here **after the student clicks** a pointer.

## 10. Sessions / episodes (two layers)

- **Slot / episode = short-lived, runtime, per-exercise.** A **new episode** starts on a **new
  exercise** or an **editor restart / resume later** (runtime severity restarts anyway). **No
  idle-gap rule** (deliberately dropped — too complex, low value). Continuous same session → same
  episode while the slot is TAKEN.
- **Chat history = durable, server-saved, cross-session.** Survives restart and days, so **Iris
  keeps the long-term memory** and does not repeat.

So: short = slot (runtime), long = chat history (server).

## 11. What Iris receives (continuity context)

- **Chat history** (existing) = the full conversation, so Iris does not repeat itself.
- **Structured slot/episode history** (new, in the POST) = **the live episode's** **hints** — the
  initial hint **+ any escalation** only (incl. hidden ambient ones that are not persisted); the
  stale-ask, confirmClose-`false` offer, and close are **not** in this block (Iris sees them via chat
  history, §17) — plus an **episode boundary marker** (`isNew`: new episode vs continuation). It is scoped to the **current** episode — the boundary is **not derivable
  from the chat stream alone**, so we tell Iris explicitly. **No** outcome/`status` field rides on the
  request (the live episode is always open; terminal outcomes are a DB concept, §12). **Prior**
  episodes are not re-sent structurally; their content is already visible to Iris via the **chat
  history** (close lines, folded labels) when a past episode is relevant.
- This replaces today's naive `(proactive hint, ignored)` signal: the outcome is now **progress-based**
  and **persisted** (`proactiveOutcome`, §12), not a wire tag.
- **Exercise artifacts (existing Pyris tools, not new wire fields):** `get_problem_statement` (the
  Artemis task structure) + `get_feedbacks` (which task's tests are passing/failing) + the current
  code. These let Iris judge **task-relevance** ("is A still the active task, or did the student move
  to a different task — even in the same file?", §7.3) **language-agnostically**, with no live cursor
  / method field on the wire. Template and solution repos are **deliberately not** exposed (offloading
  risk).
- **Pyris stays stateless about the slot.** Iris receives episode *history* (the hints + the boundary
  marker above) for continuity, but **never the slot mechanics** — PARKED vs DELIVERED,
  IN-SESSION, the stale-ask latch, whether a hidden ambient was revealed. Those live **only** in the
  client (§16). Iris re-decides freely each call; the client enforces the slot. So their absence from
  the request DTO (§17) is **deliberate, not an omission**.

## 12. Storage / DB (minimal)

Checked the Artemis `IrisMessage` schema — most of it exists already:
- `origin` (enum, incl. `PROACTIVE_STRUGGLE`) → "is proactive" already there.
- `proactiveOutcome` (enum, column `proactive_outcome`, currently only `DISMISSED`) → an outcome
  column already exists, **extensible** (string enum → adding values needs no migration).
- JSON columns already used (`accessed_memories` etc.) → JSON pattern established.

**Folding is reload-safe for free — no terminal status needed for it.** The slot/episode is
**runtime-only** and resets on reload (§10), so after a reload **nothing is "live"**: every proactive
episode in history is historical → the client **folds all** of them on load, grouped by
`proactiveEpisodeId`. The "is this episode still open after reload?" question cannot arise — openness
is a runtime state that does not survive reload. Within a live session the client tracks the live
episode in runtime (knows which one is expanded); no DB needed for that either. **Scope cut
(deliberate):** only *display* folding survives reload; all runtime continuity — the live slot, the
`slot_generation`, an outstanding stale-ask, its timer, IN-SESSION — is **lost on reload by design**
(§10). Reload = a clean runtime slate; only the chat history (and the persisted episode rows) carry
over. We do **not** persist live-state to survive reload.

**Minimal additions:**
- **One** nullable column **`proactiveEpisodeId`** on `IrisMessage`, so the client can group an
  episode's messages into one foldable thread (across reload). It tags **only proactive-origin
  messages** (the hint, an escalation, the stale-ask, a confirmClose-`false` offer, the close) —
  **not** the student's replies or the tutor's answers, which stay normal inline chat. This keeps the column semantically clean and the chat
  pipeline fully uncoupled (it never sees an episodeId). Tighter visual grouping, if ever wanted, can
  be done client-side later without touching the pipeline.
- Extend the `proactiveOutcome` enum with **`RECOVERED`** (progress) and **`ABANDONED`** (faded /
  stale-free: moved_on, timeout, hard-cap), alongside the existing `DISMISSED`. Persisted **for the
  thesis outcome analysis**, NOT for folding (string enum → **no migration**). (`ABANDONED` is a
  placeholder name — `STALE` / `FADED` would do.)
- **Canonical outcome row + scope.** The terminal `proactiveOutcome` is written to **one** canonical
  row per episode — the **earliest persisted proactive-origin message** for that `proactiveEpisodeId`
  — so analysis reads the episode outcome from a single well-defined row, not scattered across the
  thread; **outcome writes are idempotent** (re-writing the same terminal value is a no-op). Outcome
  analysis is **scoped to delivered episodes** (active, or a clicked-open ambient): a never-delivered /
  replaced PARKED ambient leaves **no row** by design (next bullet) and is therefore simply **not** in
  the outcome dataset — it was never shown, so there is nothing to score.
- **Delivery commit point.** An episode becomes **DELIVERED the moment content is shown** (an `active`
  push, or an `ambient` clicked open) — **protection is immediate** and it can **never** fall back to
  PARKED once the student has seen content. Persisting its first proactive message happens then and is
  **retried on failure** (a pending/failed persist does **not** revert protection); until it succeeds
  the episode is **incomplete** for outcome analysis (canonical row pending). So "seen" and "protected"
  coincide; the canonical row is written **best-effort** (idempotent retry). A first-row persist that
  keeps failing **and** is lost to a reload before it succeeds simply leaves that episode **absent from
  outcome analysis** (like a never-delivered one) — we do **not** build a durable cross-reload retry
  queue for this rare edge.
- **Null-outcome rows are excluded from outcome *rates*, but reported.** A delivered episode left with
  `proactive_outcome = null` (e.g. a reload mid-episode, or never resolved) is **not imputed**. It is
  excluded from the recovered/abandoned/dismissed **rate denominators**, but **counted and reported
  separately** as an attrition/censoring line — never silently dropped — so outcome-rate analysis is
  not biased. We do not persist live-state on teardown to "complete" it.
- **Hidden ambient hints are NOT stored** (runtime + the structured slot-history in the POST; saved
  only when a click reveals them, then a normal message). A never-delivered ambient leaves **no row**,
  so there is simply nothing to fold (§8) — consistent.
- **`episodeLabel` (the fold-line name) is NOT persisted:** live folds use Iris's `episodeLabel`,
  reloaded folds fall back to a client-derived gist (§8). Keeps the DB at one column.

So the DB footprint is **one column** `proactive_episode_id` (one Liquibase changelog) **+ two enum
values** (no migration). Nothing else.

## 13. Out of scope (deferred)

**Deterministic** topic-change detection (the "student moved elsewhere" case is instead handled by
the §7.3 stale-episode ask); **preemption of a *delivered* slot** by a new / different / much-worse
struggle B — B simply **waits** until A frees via §7.3 (one focus at a time, no preempt rule; a merely
*parked* ambient is instead replaced as a new episode, §4). **This is a stated thesis limitation, not
a free lunch:** a delivered slot is **mechanically bounded** — the stale watchdog fires every
`STALE_AFTER` and `STALE_WINDOW_MAX` windows force-free it (§7.3), so the **upper bound** on delaying a
worse B is about `STALE_AFTER × STALE_WINDOW_MAX` (each ask window further capped by the ~5 min ABANDON
ceiling) — all **tunable** and **guaranteed finite**; we accept the bound rather than build preemption. Also deferred: a **live cursor /
method location field on the wire** (Iris infers task-relevance from `problem_statement` + `feedbacks`
instead, §11) and any **deterministic task / phase detection** (that is the roadmap's V2.0
"Phase-aware Proactivity"); tutor escalation after long stuck; the "break it down?" offer; frequency
back-off across episodes; a full escalation/loudness ladder (rejected by the literature). Clean
add-ons later.

## 14. Resolved decisions

1. **Ambient surface:** gutter Iris icon + status-bar lamp, **no inline text**; the hint becomes
   visible **on click** and **persisted then** (best-effort, retried, §12; until then runtime-only). ✓
2. **DB:** the `proactiveEpisodeId` column only **groups** an episode's messages; the core slot needs
   **zero** DB, and **folding is reload-safe for free** (slot is runtime → fold-all on reload, §12).
   Total footprint: **one** nullable column `proactive_episode_id` on `iris_message` (one Liquibase
   changelog) **+** `RECOVERED` and `ABANDONED` values on the existing `IrisProactiveOutcome` enum
   (string → no migration), persisted for outcome analysis, not folding. Nothing else. ✓
3. **Closing:** the slot is **FREED immediately** on confirmed progress; the **~5 s** is **UI-only**
   folding of the already-closed episode (§7.1/§8). ✓
4. **"Student continues elsewhere" + "Iris asks about progress"** are the same issue from two sides,
   resolved together as the **stale-episode ask (§7.3)**: when the slot is **DELIVERED** on A with no
   progress and the student has moved on, Iris asks **quietly** (chat message, no toast) with
   **deterministic quick-reply buttons** ("Yes, solved it" → `confirmClose`; "Still on it" → stay;
   "Doing something else" → free), **capped at 2** posted asks (nagging); a client **stale watchdog**
   fires every `STALE_AFTER`, and after `STALE_WINDOW_MAX` windows the slot **force-frees** regardless
   (§7.3). **No LLM reply
   classification** (no `interpretReply`); free-text always goes to the normal chat and only **resets the
   ABANDON timer** (~30 s; never resolves the slot). The timer is only the backstop for an unanswered
   ask. **No deterministic topic-change detection is built.** ✓

## 15. Literature grounding & honesty (for the thesis)

- **Escalate-when-ignored: NOT supported** (Pu 2025 backs off; Chen 2025 anti-frequency).
- **Acknowledge, don't auto-dump explanation: supported** (Ma et al. 2025; Assistance Dilemma;
  over-help harms the weakest — Prather 2024 / Kapoor 2026). The closing message is a warm
  acknowledgement, not more help.
- **The slot's "never downgrade in the moment" is an `[ENG]` coherence choice, not paper-backed.**
- **Cognitive-offloading / over-reliance** rests on **Shen & Tamkin 2026, "How AI Impacts Skill
  Formation"** (Anthropic, arXiv preprint; RCT n=52; AI help cut skill formation ~17%, Cohen's
  d=0.738; six interaction patterns, three low-scoring: AI Delegation, Progressive AI Reliance,
  Iterative AI Debugging). **VERIFIED 2026-06-29** against the paper's title page (authors Judy
  Hanwen Shen & Alex Tamkin) and `papers/paper-bewertung.md` — the CLAUDE.md citation is **correct**.
  Ma et al. 2025 ("Scaffolding Metacognition") is a **separate** paper.

## 16. Chat-pipeline integration & client chat UI

**Verified — we do NOT break the chat pipeline.** Proactive struggle messages already live in the
**shared exercise-chat session** (`IrisStruggleInterventionService.java:259`:
`getCurrentSessionOrCreateIfNotExists(PROGRAMMING_EXERCISE_CHAT, …)`, saved origin-tagged
`PROACTIVE_STRUGGLE`). Student replies already flow through the normal exercise-chat pipeline.
Everything below rides on that existing seam.

**Who frees / closes the slot — NOT the chat pipeline.** The normal chat pipeline only *converses*;
it cannot touch slot state. Slot/episode state is owned by the **client (runtime)**:
- The client observes the student's chat **reply**: if a stale-ask is open it **resets that ask's
  ABANDON timer** (provisional on submit, §7.3). It does **not** resolve the slot — resolution is via
  progress / dismiss / a stale-ask button / the stale timer / the hard-cap. **Free-text never resolves
  the slot.** (**IN-SESSION** tracks the chat view being open/focused, §4 — independent of any reply or
  send.)
- Positive **closing** content (praise + `episodeLabel`) is produced by the **struggle pipeline's
  `confirmClose` mode**, triggered by the slot logic **when progress is confirmed** — never by the
  chat pipeline. The **stale-ask** question likewise comes from the struggle pipeline's `staleCheck`
  mode.

**Reply routing — free-text always reaches the chat; a reply can only resolve the slot via buttons.**
Every reply passes through the client first (`ChatMessageService.sendMessage`,
`chatMessageService.ts:44`) **before** it is POSTed to Artemis (`:112`), and the client owns the slot
state. **Free-text replies are NEVER intercepted** — they go straight to the exercise (chat) pipeline,
byte-for-byte as today, so a real typed question **cannot** be swallowed. **Free-text never resolves
the slot;** among replies, only the **explicit quick-reply buttons** on a stale-ask do (§7.3), handled
**deterministically client-side, no LLM**:
- **"Yes, solved it"** → `confirmClose` (code-confirmed, §7.1/§8). The chat pipeline is not involved.
- **"Doing something else"** → free the slot silently (`ABANDONED`).
- **"Still on it"** → slot stays TAKEN; nothing sent.
- A free-text reply while a stale-ask is open → **chat as normal**; it does **not** change slot state
  or cancel the ask (free-text never resolves the slot), it only **resets the ask's ABANDON timer**
  (~30 s, provisional on submit, bounded by the per-ask ~5 min ceiling, §7.3) so the slot is not
  auto-`ABANDONED` while the student is active. The buttons stay available.

So there is **no `interpretReply` and no reply classification** — the only struggle-pipeline call a
reply can trigger is `confirmClose` (and only via the "solved" button). The chat **conversation** is
uncoupled (the client decides *whether* to also free/close the slot, never *whether* the chat answers);
the **only** coupling is a **provisional, local timer grace** the client applies on submit and revokes
on a hard send failure (§7.3) — it never gates or alters the chat answer.

**Stale-ask timer = backstop only.** A **button** resolves the slot immediately; a **free-text** reply
resets the timer to ~30 s (bounded by the per-ask ~5 min ceiling); with **no activity** until expiry
the slot frees (`ABANDONED`), per §7.3. The ~60 s initial / ~30 s free-text / ~5 min ceiling windows
are tunable.

**Client chat UI (rendering only, not the protocol).** The webview already renders
`PROACTIVE_STRUGGLE` messages; we extend it:
- **Label** proactive messages ("Iris reached out — you didn't ask"), distinct from answers.
- **Group by `proactiveEpisodeId`**: newest hint expanded, earlier folded ("▸ earlier hints"); a
  resolved episode folds to a one-liner ("✓ Wrong index").
- **Closing**: show the closing message, then fold after the ~5 s timer (§8).
- **Stale-ask buttons**: render the three quick-reply buttons ("Yes, solved it" / "Still on it" /
  "Doing something else") on the stale-ask message; a click drives the slot deterministically (§7.3)
  and carries the **client-generated `ask_id`** (not persisted) so a late click on a superseded ask is
  ignored (the async guard, §6). Buttons render **only for the live runtime ask**; a **reloaded /
  historical** stale-ask row (its `ask_id` and slot are gone, §12) renders as **plain text with no
  active buttons**.
- **Hidden ambient**: not a message until the student clicks a pointer; on click the runtime hint is
  **promoted** to a normal chat message (and only then saved).
- **On reload, fold everything**: the runtime slot is gone, so no proactive episode is "live" — the
  client folds all of them (grouped by `proactiveEpisodeId`), no persisted terminal status needed
  (§12); the fold-line label falls back to a client-derived gist.

**Fold, don't hide.** We do **not** hide the proactive content wholesale — the student must see and
engage with it. We **fold** it (compact but accessible). The **only** thing hidden-until-click is the
**ambient hint text** (by design, pull). Older/resolved episodes are folded one-liners, always
expandable.

**Additive — conversation path unchanged, slot logic layered alongside.** The **conversation path** is
unchanged (the normal exercise-chat pipeline, the shared session, the reply routing). The slot logic is
**layered alongside** with **minimal DTO/UI additions**: the chat **message DTO** gains episode metadata —
`proactiveEpisodeId` and the new `proactiveOutcome` values — so the client can group/fold; these do
**not** flow on the wire today (`extensionMessages.ts:339`, `apiResponses.ts:177`), so "transport
fully unchanged" would be wrong. Added: struggle-pipeline `confirmClose` / `staleCheck` modes (Pyris);
the `proactiveEpisodeId` column + "stale-ask buttons → free/close the slot" (Artemis/client); the
webview rendering above.

## 17. DTOs — what goes to Iris and what comes back

Grounded on the **existing** wire contract (verified against the Artemis DTOs); **+NEW** marks fields
this design adds. Java records on the Artemis side, mirrored as Pydantic on the Pyris side.

### Request (Artemis → Pyris) — `IrisStruggleInterventionRequestDTO`

```
{
  struggleSignal: PyrisStruggleSignalDTO,            // existing
  uncommittedFiles: Map<String, String>,             // existing — current code

  intent: "decide" | "confirmClose" | "staleCheck",  // +NEW — concept names shown; WIRE values are
                                                     // snake_case: decide / confirm_close / stale_check
  episode: {                                          // +NEW — ALWAYS sent (never null/omitted); on the
                                                      // first `decide` of a FREE slot the client preallocates
                                                      // a fresh episodeId, isNew=true, hints=[] (§11)
    episodeId: String,
    isNew: boolean,                                   // new episode vs continuation (the live episode
                                                      // is always open; terminal outcome is a DB concept, §12 — not sent)
    hints: [                                          // the substantive HINTS only — the initial hint +
      { level: "ambient" | "active",                  // any escalation; NOT the stale-ask / confirmClose-false
        text: String,                                 // offer / close (those live in chat history, §11).
        atSessionS: double }                          // Includes hidden ambient hints (never persisted).
    ]
  }
}

// existing, unchanged:
PyrisStruggleSignalDTO {
  alert: { tSessionS, primaryBoundary, boundaryTypes: String[], severity /* = V */, path,
           inWarmup, inGrace },
  trajectory: [ { t, s, v } ],
  dominantComponents: [ { name, value } ],  // name ∈ typing|gap|feedbackViewing|regionPersistence|errorDistance|n4
  sessionSeconds: double
}
```

*(The `intent` / enum literals below are written as concept names for readability; on the wire they
are the snake_case forms from the casing rule — `decide` / `confirm_close` / `stale_check`.)*

- `intent = decide` → the normal struggle decision (today's flow).
- `intent = confirmClose` → engine flagged progress; Iris re-reads the code, confirms + closes.
- `intent = staleCheck` → episode is stale; Iris decides whether to ask. Returns **`ask=true`** → post
  the question with **deterministic quick-reply buttons** (§7.3/§16; "solved" later triggers
  `confirmClose`, the others resolve client-side) — or **`ask=false`** → **noop**: Iris judges A is
  still the active task, so the slot stays TAKEN, `staleAskCount` is **not** consumed, and the client
  may staleCheck again at the next sustained-no-progress window. There is **no reply-classification
  intent**.
- **Escalation needs no intent of its own:** the one escalation case (opened `ambient` + hard event
  → `active`, §6) is just another `intent = decide` call with the `episode` block as context. Pyris
  stays **stateless** — it re-decides freely; the client enforces the slot (suppress downgrade, no
  auto-deepen, apply louder only in that one case).

### Response (Pyris → Artemis) — `PyrisStruggleInterventionStatusUpdateDTO`

```
{
  // --- decide mode (existing) ---
  result: String | null,          // the hint text (active: shown; ambient: revealed on click)
  action: "silent" | "ambient" | "active" | null,
  confidence: Double | null,      // LLM output confidence (Artemis thresholds at 0.6) — NOT severity
  rationale: String | null,
  anchor_file: String | null,     // existing — positions the gutter icon (snake_case on the wire)
  anchor_line: Integer | null,    // existing
  inline_hint: String | null,     // active only — after-line inline cue at the anchor; null for ambient (pull)
  stages: PyrisStageDTO[],        // existing — thinking/progress stages
  tokens: LLMRequest[],           // existing

  // --- confirmClose mode (+NEW) ---
  resolved: Boolean | null,       // did Iris confirm progress? true → close; false → slot stays TAKEN
  closingSentence: String | null, // praise, shown ~5 s (§8) — set only when resolved=true
  episodeLabel: String | null,    // fold-line problem name (§8) — set only when resolved=true
  // on resolved=false the existing `rationale` carries one gentle offer line (§7.3); the client posts
  //   it as a proactive-origin message in the episode (grouped by proactiveEpisodeId, folds with it,
  //   §9/§12); slot stays TAKEN

  // --- staleCheck mode (+NEW) ---
  ask: Boolean | null,            // true → post question+buttons; false → noop (stay TAKEN, don't
                                  //   consume staleAskCount, may re-check later) — §7.3
  question: String | null         // the stale-check question (rendered with deterministic buttons, §7.3)
}
```

- New fields are nullable; only the ones for the requested `intent` are set.
- **Normative casing (one rule):** the **wire is snake_case** for both keys and enum string values
  (matching the existing `anchor_*` fields and Pyris's `model_dump(by_alias)`). The camelCase shown in
  this section is the Java/TS field name; each maps to its snake_case wire alias via `@JsonProperty`
  (Java) / Pydantic alias (Pyris). New keys → wire: `episodeId`→`episode_id`, `isNew`→`is_new`,
  `atSessionS`→`at_session_s`, `closingSentence`→`closing_sentence`, `episodeLabel`→`episode_label`.
  Enum strings are snake_case too: the `intent` literals `confirmClose`→`confirm_close` and
  `staleCheck`→`stale_check` (`decide` already snake-safe), and `action ∈ {silent, ambient, active}`.
  (The DB `proactiveOutcome` — RECOVERED/ABANDONED/DISMISSED, §12 — is a separate persistence enum,
  **not** on this wire.) A casing mismatch on either side silently drops the field to null. The alias list above is **complete for the `+NEW` fields**; **existing** fields
  (the `PyrisStruggleSignalDTO` signal, `anchor_*`, `result`, `action`, …) keep their **current** wire
  contract, unchanged by this design — confirm an existing field's actual wire casing against the live
  DTO before placing a new field beside it (the camelCase in the examples is the field name, not
  necessarily the wire key).
- The hidden-ambient text rides in `episode.hints[]` on the **request** (not stored in the DB), so
  Iris has it for continuity even though it never became a chat message.

