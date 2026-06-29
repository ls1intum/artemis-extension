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
    pointer is up, §5). **No downgrade protection:** a fresh evaluation may freely **replace** it
    (quieter, louder, or a different problem). Nothing was shown, so replacing it is not the
    overwrite bug; a replacement that comes back `active` is a fresh *first delivery*, not an
    escalation of the ignored hint. **Replacing a PARKED ambient ends that (undelivered, no-trace)
    episode and starts a NEW `episodeId`** — its frozen text evaporates and does **not** carry into the
    new episode's `hints[]`. So slot↔episode stays 1:1 (§3) and history never mixes unrelated hints.
  - **DELIVERED** = content reached the student (an `active` push, or an `ambient` the student
    clicked open). Hard-protected: no new interruption, no quieter downgrade, no auto-elaboration.
    The only allowed change is an **escalation** (opened `ambient` + a hard event → `active`, §6).
- **IN-SESSION** = a sub-state of DELIVERED: the student has the chat open / is replying, actively
  engaging the current episode there. New content flows **quietly into the open chat** (§16); still
  no new interruption.
- Frees **only** on **progress**, **dismiss**, or the **stale-episode cleanup** (all §7). **Opening
  / reading / working with the hint does NOT free it** (you are using it).

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
hint text is **hidden and NOT stored**; clicking any pointer **reveals** it as a chat message (and
only **then** is it saved). If the student never clicks, nothing is persisted. The hidden text is
held **frozen** (one held text per slot): while it stays hidden, soft re-evaluations do **not**
refresh it (re-cooking text nobody reads adds nothing); only a hard event (§6) replaces it. A hidden
`ambient` has **no explicit dismiss** (nothing to wave away but a content-free pointer); it exits
only via **click** (→ reveal), **progress**, or **stale-free** (§7), all silent if never clicked.

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

- **permanent** = lives forever in chat history (survives reload/days), never auto-deleted.
- **slot-durable** = stays while the slot is TAKEN (no timer), clears on progress/dismiss.
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

On a **PARKED** hidden ambient there is no protection: a fresh decision freely **replaces** the
frozen held text (§4). A replacement that comes back `active` is a fresh *first delivery*, not an
escalation of the ignored hint.

A genuinely **new, separate** interruption (a *different* problem): if the slot is **DELIVERED** it
**waits** until the slot frees — a delivered episode is **never preempted** (one focus at a time,
§13). If the slot is only **PARKED** (nothing delivered), the different problem simply **replaces** it
as a new episode (§4). The "much-worse B" case is handled by the §7.3 stale-ask freeing A, **not** by
interrupting a delivered episode.

- **Within-episode messages are not "new pops".** An escalation, the closing message (§8) and the
  stale-ask (§7.3) are quiet and about the *current* episode; §2's "never pop something new" forbids
  a new *interruption for a new issue*, not these.
- The gutter icon stays put (it must **not** retire on the first keystroke anymore — too eager
  today).

## 7. Resolution (freeing the slot)

The slot frees **only** when:

1. **Progress** — the student is getting unstuck. **Always two-stage:** the **engine** flags likely
   progress (cheap, hard signal: a new green test, or `sBase` sustained below the re-arm threshold
   ~0.6 for ~30s), and **Iris must then confirm it** (re-reads the code). **Iris confirmation is
   mandatory** — if Iris judges it is not actually resolved, it stays quiet and the slot stays TAKEN.
   **Edge-triggered, exactly one `confirmClose` per progress edge:** `OPEN` → engine flags progress →
   `CANDIDATE_CLOSE` (fire **one** `confirmClose`) → Iris `resolved=true` → `CLOSED` (close + fold);
   `resolved=false` → back to `OPEN`, **no immediate re-fire** — only a **fresh** progress edge (a new
   green test, or `sBase` rising and then dropping under ~0.6 again) re-arms the next `confirmClose`.
   This prevents a per-tick race and Pyris spam.
2. **Dismiss** — the student explicitly waves it away.
3. **Iris asks (stale-episode cleanup)** — fires when the slot is TAKEN on problem A but there is
   **no progress on A for a sustained while** (a file-switch or a quiet idle are *sufficient* signs,
   **not required** — a student working a *different task in the same file* counts too). Iris judges
   task-relevance with the tools it already has (`get_problem_statement` for the Artemis task
   structure + `get_feedbacks` for which task's tests are moving + the current code, §11) — no
   file-switch heuristic, language-agnostic. It then drops **one quiet question** into the chat ("Did
   you get past X?"), **no toast**. The reply is **interpreted** by the struggle pipeline
   (`interpretReply`, §16/§17) — not guessed from a click:
   - **`resolved`** → Iris **re-reads the code to confirm** (the §7.1 two-stage gate; a bare "yes"
     never frees a still-broken slot) → close (§8).
   - **`moved_on`** → free the slot **silently** (a soft dismiss; no code-check needed).
   - **`still_stuck`** → slot stays, IN-SESSION; the reply **falls through to the normal chat**, which
     answers substantively.
   - **No reply within ~60 s of the ask** → **free the slot** (`ABANDONED`). The timer is the backstop
     for the *unanswered* case only: it **starts** when the stale-ask is posted, **any reply cancels**
     it (the reply routes to `interpretReply`), on expiry the slot frees. ~60 s is tunable.

   **Re-arm per stale period, not per episode:** a re-engage resets the ask latch, so a *later* drift
   can ask again — this closes the slot leak (re-engage → drift → new ask → no reply → free). **Hard
   cap:** after the **2nd** stale with no progress/dismiss the slot **force-frees silently** (no 3rd
   ask), guaranteeing termination and bounding nagging. This is how "the student continues elsewhere"
   is handled, so **no deterministic topic-change detection is built** (§13).

On confirmed progress, do **not** silently remove the marker. Iris closes it (§8). The hint text
**stays** in the chat (permanent). (The stale-cleanup ask in #3 is the gentle counterpart for
episodes that fade out rather than getting solved.)

## 8. Closing UX

This describes the **progress** close (§7.1). On confirmed progress, **both**, but split:
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

One **episode = one thread**, but normally just **one** proactive hint in it (no deepen pile). At
most an **escalation** (§6) adds a second message; the latest is open, the earlier one collapses.

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
- **Structured slot/episode history** (new, in the POST) = the episode's **hints** (history, incl.
  hidden ambient ones that are not persisted) + its **episode-level `status`** (§17) + an **episode
  boundary marker** ("new episode" vs "continuation of episode N"). Needed because episode boundaries
  and the progress-based status are **not derivable from the chat stream alone**. We tell Iris
  explicitly.
- Replaces today's naive `(proactive hint, ignored)` tag with a **progress-based** outcome.
- **Exercise artifacts (existing Pyris tools, not new wire fields):** `get_problem_statement` (the
  Artemis task structure) + `get_feedbacks` (which task's tests are passing/failing) + the current
  code. These let Iris judge **task-relevance** ("is A still the active task, or did the student move
  to a different task — even in the same file?", §7.3) **language-agnostically**, with no live cursor
  / method field on the wire. Template and solution repos are **deliberately not** exposed (offloading
  risk).
- **Pyris stays stateless about the slot.** Iris receives episode *history* (the hints + the episode
  `status` + the boundary marker above) for continuity, but **never the slot mechanics** — PARKED vs DELIVERED,
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
episode in runtime (knows which one is expanded); no DB needed for that either.

**Minimal additions:**
- **One** nullable column **`proactiveEpisodeId`** on `IrisMessage`, so the client can group an
  episode's messages into one foldable thread (across reload). It tags **only proactive-origin
  messages** (the hint, the stale-ask, the close) — **not** the student's replies or the tutor's
  answers, which stay normal inline chat. This keeps the column semantically clean and the chat
  pipeline fully uncoupled (it never sees an episodeId). Tighter visual grouping, if ever wanted, can
  be done client-side later without touching the pipeline.
- Extend the `proactiveOutcome` enum with **`RECOVERED`** (progress) and **`ABANDONED`** (faded /
  stale-free: moved_on, timeout, hard-cap), alongside the existing `DISMISSED`. Persisted **for the
  thesis outcome analysis**, NOT for folding (string enum → **no migration**). (`ABANDONED` is a
  placeholder name — `STALE` / `FADED` would do.)
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
*parked* ambient is instead replaced as a new episode, §4); a **live cursor /
method location field on the wire** (Iris infers task-relevance from `problem_statement` + `feedbacks`
instead, §11) and any **deterministic task / phase detection** (that is the roadmap's V2.0
"Phase-aware Proactivity"); tutor escalation after long stuck; the "break it down?" offer; frequency
back-off across episodes; a full escalation/loudness ladder (rejected by the literature). Clean
add-ons later.

## 14. Resolved decisions

1. **Ambient surface:** gutter Iris icon + status-bar lamp, **no inline text**; the hint becomes
   visible **and** saved **only on click** (until then runtime-only, not persisted). ✓
2. **DB:** the `proactiveEpisodeId` column only **groups** an episode's messages; the core slot needs
   **zero** DB, and **folding is reload-safe for free** (slot is runtime → fold-all on reload, §12).
   Total footprint: **one** nullable column `proactive_episode_id` on `iris_message` (one Liquibase
   changelog) **+** `RECOVERED` and `ABANDONED` values on the existing `IrisProactiveOutcome` enum
   (string → no migration), persisted for outcome analysis, not folding. Nothing else. ✓
3. **Closing timer:** **~5 s** visible, then fold (or on the next chat interaction, whichever first). ✓
4. **"Student continues elsewhere" + "Iris asks about progress"** are the same issue from two sides,
   resolved together as the **stale-episode ask (§7.3)**: when the slot is TAKEN on A with no progress
   and the student has moved on, Iris asks **quietly** (chat message, no toast) — **once per stale
   period** (re-arms on re-engage), **hard-capped at 2** asks then silent force-free. The reply is
   **interpreted** (`interpretReply`: `resolved` / `moved_on` / `still_stuck`); the ~60 s timer is only
   the backstop for an unanswered ask. **No deterministic topic-change detection is built.** ✓

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
- The client observes the student's chat **reply** → counts as **re-engagement** with episode A →
  the slot stays TAKEN and goes **IN-SESSION**. Normal resolution (progress / dismiss) continues from
  there.
- Positive **closing** content (praise + `episodeLabel`) is produced by the **struggle pipeline's
  `confirmClose` mode**, triggered by the slot logic **when progress is confirmed** — never by the
  chat pipeline. The **stale-ask** question likewise comes from the struggle pipeline's `staleCheck`
  mode.

**Reply routing — the only place a reply goes to struggle instead of chat.** Every reply passes
through the client first (`ChatMessageService.sendMessage`, `chatMessageService.ts:44`) **before** it
is POSTed to Artemis (`:112`), and the client owns the slot state — so the routing is a
**deterministic client-side branch**, not backend guesswork:
- **No outstanding stale-ask → straight to the exercise (chat) pipeline, byte-for-byte as today.**
  This is ~every reply.
- **A stale-ask is outstanding →** the client sends the reply to the struggle pipeline
  `interpretReply` (§17) **first**:
  - `resolved` → close (code-confirmed, §7.1/§8); **the chat pipeline is NOT called.**
  - `moved_on` → free the slot silently; **no chat turn.**
  - `still_stuck` → fall through to the normal `sendChatMessage` → the tutor answers.
- **Fail-open:** if `interpretReply` errors or times out → default `still_stuck` → normal chat. A reply
  never starves because the struggle pipeline is down.

The optimistic echo of the student's own message can render immediately; only the *tutor's* answer
waits one classify hop, and only in the `still_stuck` case.

**Stale-ask timer = backstop only.** The interpreted reply is the primary exit; **no reply within
~60 s of the ask** frees the slot (`ABANDONED`), per the precise rule in §7.3. ~60 s is tunable.

**Client chat UI (rendering only, not the protocol).** The webview already renders
`PROACTIVE_STRUGGLE` messages; we extend it:
- **Label** proactive messages ("Iris reached out — you didn't ask"), distinct from answers.
- **Group by `proactiveEpisodeId`**: newest hint expanded, earlier folded ("▸ earlier hints"); a
  resolved episode folds to a one-liner ("✓ Wrong index").
- **Closing**: show the closing message, then fold after the ~5 s timer (§8).
- **Hidden ambient**: not a message until the student clicks a pointer; on click the runtime hint is
  **promoted** to a normal chat message (and only then saved).
- **On reload, fold everything**: the runtime slot is gone, so no proactive episode is "live" — the
  client folds all of them (grouped by `proactiveEpisodeId`), no persisted terminal status needed
  (§12); the fold-line label falls back to a client-derived gist.

**Fold, don't hide.** We do **not** hide the proactive content wholesale — the student must see and
engage with it. We **fold** it (compact but accessible). The **only** thing hidden-until-click is the
**ambient hint text** (by design, pull). Older/resolved episodes are folded one-liners, always
expandable.

**Additive vs (almost) unchanged.** Unchanged: the normal exercise-chat pipeline, the shared session,
the reply path. **Changed (small):** the chat **message DTO** gains episode metadata —
`proactiveEpisodeId` and the new `proactiveOutcome` values — so the client can group/fold; these do
**not** flow on the wire today (`extensionMessages.ts:339`, `apiResponses.ts:177`), so "transport
fully unchanged" would be wrong. Added: struggle-pipeline `confirmClose` / `staleCheck` /
`interpretReply` modes (Pyris); the `proactiveEpisodeId` column + "observe reply → route + update
slot" (Artemis/client); the webview rendering above.

## 17. DTOs — what goes to Iris and what comes back

Grounded on the **existing** wire contract (verified against the Artemis DTOs); **+NEW** marks fields
this design adds. Java records on the Artemis side, mirrored as Pydantic on the Pyris side.

### Request (Artemis → Pyris) — `IrisStruggleInterventionRequestDTO`

```
{
  struggleSignal: PyrisStruggleSignalDTO,            // existing
  uncommittedFiles: Map<String, String>,             // existing — current code

  intent: "decide" | "confirmClose" | "staleCheck" | "interpretReply",  // +NEW — what we want Iris to do
  replyText: String | null,                           // +NEW — interpretReply only: the student's stale-ask reply
  episode: {                                          // +NEW — slot/episode continuity (§11)
    episodeId: String,
    isNew: boolean,                                   // new episode vs continuation
    status: "active" | "resolved" | "abandoned" | "dismissed",  // episode-level outcome (NOT per-hint)
    hints: [                                          // pure history: every hint THIS episode, incl. hidden ambient
      { level: "ambient" | "active",
        text: String,
        atSessionS: double }
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

- `intent = decide` → the normal struggle decision (today's flow).
- `intent = confirmClose` → engine flagged progress; Iris re-reads the code, confirms + closes.
- `intent = staleCheck` → episode is stale; Iris decides whether/what to ask.
- `intent = interpretReply` → the student answered an outstanding stale-ask (`replyText`); Iris
  classifies it as `resolved` / `moved_on` / `still_stuck` (§7.3). On `resolved` it also re-reads the
  code and may return the close fields in the same call (folding in `confirmClose`).
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
  resolved: Boolean | null,       // did Iris confirm progress?
  closingSentence: String | null, // praise, shown ~5 s (§8)
  episodeLabel: String | null,    // fold-line problem name (§8)

  // --- staleCheck mode (+NEW) ---
  ask: Boolean | null,            // surface a question at all?
  question: String | null,        // the stale-check question

  // --- interpretReply mode (+NEW) ---
  replyOutcome: "resolved" | "moved_on" | "still_stuck" | null  // client routes the slot on this
                                  // (resolved may also fill resolved/closingSentence/episodeLabel above)
}
```

- New fields are nullable; only the ones for the requested `intent` are set.
- **Normative casing (one rule):** the **wire is snake_case** for both keys and enum string values
  (matching the existing `anchor_*` fields and Pyris's `model_dump(by_alias)`). The camelCase shown in
  this section is the Java/TS field name; each maps to its snake_case wire alias via `@JsonProperty`
  (Java) / Pydantic alias (Pyris). New keys → wire: `episodeId`→`episode_id`, `isNew`→`is_new`,
  `replyText`→`reply_text`, `replyOutcome`→`reply_outcome`, `closingSentence`→`closing_sentence`,
  `episodeLabel`→`episode_label`, `status` (already snake-safe). Enum strings are snake_case too:
  `action ∈ {silent, ambient, active}`, `status ∈ {active, resolved, abandoned, dismissed}`,
  `reply_outcome ∈ {resolved, moved_on, still_stuck}`. A casing mismatch on either side silently drops
  the field to null.
- The hidden-ambient text rides in `episode.hints[]` on the **request** (not stored in the DB), so
  Iris has it for continuity even though it never became a chat message.

