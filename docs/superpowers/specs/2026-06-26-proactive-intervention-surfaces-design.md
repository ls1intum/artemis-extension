# Proactive Intervention Surfaces — Design Spec (ambient · inline · active · reject/ignore)

- **Date:** 2026-06-26
- **Status:** Draft for review (brainstorm-approved across this session). Inline rendering locked + prototype-validated (§4.1). Chat-bubble rendering locked + companion-validated (§6.2). Persistence + memory model resolved against the real Artemis code (§7): **one shared thread, ambient now persisted too (unify-persistence), gate sees per-message outcome tags, memiris off**. Backoff mechanics locked (§5.2). Course-level enablement for A/B locked (§13). Availability gates (`.noai` / Iris-off / consent) locked (§14). §12 decisions resolved: bubble = 👍/👎 (helpfulness) + Dismiss (reject); explicit per-exercise opt-out = On/Off switch + 3-state status in the AskIris card. **Scope: full design chosen (codex round-2 flagged it as large for a thesis; Liam kept the full scope).** Codex round-2 correctness fixes applied: per-message `messageId` in the struggle event (§7.2/§8), persist `opened`+`dismissed` (§7.5), 202 `accepted`-flag read (§13), `.noai`/404/unreachable disambiguated (§14), reply-attribution marked `[ENG]` (§7.4).
- **Target:** `artemis-extension` client (`feat/struggle-v3-integration`) + Artemis backend (`feature/iris/struggle-intervention-pipeline`) + Pyris (`feat/struggle-intervention-pipeline`)
- **Eventual home of the rationale:** thesis Ch7 `thesis/content/07_intervention_design.typ` (this file is the provenance-annotated source; bib keys are pinned when writing Ch7).
- **Provenance markers (as in `config.ts`):** `[D]` data-derived from the study · `[L]` literature · `[ENG]` engineering choice. Thesis cross-mark: ✅ paper-validated · ⚠️ paper-inspired adaptation · 🔧 engineering necessity.

## 1. Context & Goal

The struggle engine (v3, client-side) already gates *whether* a student is struggling enough to ask Iris. Downstream, a Pyris **second-gate pipeline** decides *whether a non-spoiler nudge is worthwhile and how loudly*, returning `silent | ambient | active` + `confidence` + `message`. Artemis applies that decision: `active` materializes a persisted chat message; `ambient` **also** materializes a persisted chat message (after unify-persistence, §7) but surfaces it quietly; `silent` does nothing.

**Goal of this design:** define the full *student-facing* surface model and interaction, specifically:
1. add **inline** (in-editor, anchored) as a surface, alongside the existing **ambient** (lamp) and **active** (chat);
2. give the student a consistent way to **ignore** (passive) and **reject** (explicit) every intervention;
3. give Iris a coherent **memory** (so it does not repeat help and can adapt to how the student reacts), without long-term cross-exercise memory (§7);
4. keep each decision grounded in literature where possible, and honestly mark the rest as engineering.

## 2. Core principle: two axes, not one

The single most important framing, and the one that keeps the design coherent:

> **Separate "how loud" (intensity) from "where" (surface).** Intensity is `silent / ambient / active` and is decided by Iris. Surface is `lamp / inline / chat` and is decided by the client. **Inline is not a peer of ambient/active** — it is a *rendering* of the ambient (and optionally active) intensity when a concrete code location exists.

Mixing the two (treating "inline" as a third intensity) is a category error and is explicitly rejected here.

**Persistence is orthogonal to both axes.** After unify-persistence (§7), every non-`silent` intervention is persisted as one chat message regardless of intensity or surface; intensity decides only *how loudly it is surfaced*, not *whether it is stored*.

## 3. Who decides what

| Decision | Owner | Why it lives there |
|---|---|---|
| Feature available for this course? | **Instructor/admin (Artemis)** | course-level `proactiveStruggleEnabled` setting; rollout + A/B condition (§13) |
| Timing — intervene *now* at all? | **Engine (client)** | boundaries, warmup, cooldown, θ; `[D]` study-derived |
| Intensity — `silent/ambient/active` | **Iris (Pyris gate)** | needs code + signal + chat history + outcomes + confidence |
| Localizability + anchor (file/line/symbol) | **Iris** | a content property only the model knows |
| Final surface — `lamp/inline/chat` | **Client** | needs live editor state (file open? line visible? typing?) |
| Deliver, or back off / pause? | **Client (delivery layer)** | hard, deterministic safety net independent of the LLM (§5.2) |

Iris cannot self-fire: it is strictly downstream of the engine's timing gate. The engine stays the single timing authority. `[ENG]` split, informed by `[D]`.

## 4. Surfaces and when each is used

| Intensity (Iris) | Condition (client) | Surface | Persisted? |
|---|---|---|---|
| `silent` | — | nothing (local eval log only) | no |
| `ambient` | anchor present **and** its file/line is open/visible | **inline** decoration at the line | **yes** |
| `ambient` | anchor present **but** file/line not currently visible | **lamp** (fallback) | **yes** |
| `ambient` | no anchor (e.g. typing-stall / STATE boundary) | **lamp** (status-bar, orange) | **yes** |
| `active` | — | **chat bubble** (real session) + badge + toast; inline anchor pointer if anchor live | **yes** |

**One primary surface per intervention.** The same nudge is never shown on lamp *and* inline *and* chat simultaneously. The surfaces are a repertoire, not a stack. (Rationale: §11 over-proactivity / disruption findings.) The persisted chat bubble (§7) is the durable record behind whichever surface was shown; it is not a second simultaneous surface.

**Inline needs an anchor.** Build/compile failures (FM boundary) yield a line; pure typing-stall (STATE) has no location, so it falls back to the lamp. An anchor that exists but whose line is off-screen / in a closed file also falls back to the lamp. This is a real design boundary, not a limitation to paper over.

### 4.1 Inline rendering (VS Code) — validated via throwaway prototype, 2026-06-26

Inline is a **combo of three pieces** on the anchored line (the prototype's "gutter + after-line" mode), confirmed by building it in a real Extension Development Host:

```
[Iris logo]  42   for (int i = 0; i < arr.length; i++) {   💡 edge case at the last index?
 └ gutter (left)         code                                └ after-line cue (right)
```

- **Gutter icon (left):** the colored Iris mascot (`media/iris-logo-big-left.png`), with transparent left padding so it sits inset, `gutterIconSize: 'contain'`. This is the **always-visible anchor**: the gutter is pinned left and does not scroll horizontally, so the logo survives long lines / narrow editors even when the after-line cue is pushed off-screen.
- **After-line cue (right):** the short Socratic `inlineHint` (see below) as an `after` text decoration, styled **bold + Iris brand blue `#007fcf`** (sampled from the logo PNG), **no italic**, with a **💡 lead-in emoji**.
- **Hover (whole line):** an invisible whole-line decoration carrying the full `message` + command links (`Open chat`, `Dismiss`). Whole-line so the full hint stays reachable by hovering any visible part of the line even when the after-line cue has scrolled off-screen. (An `after` text decoration is not itself clickable, so the actions live in the hover.)

**Off-screen handling (long lines / narrow editor):** the gutter logo (always visible) + the whole-line hover are the guarantee; the after-line cue text is progressive enhancement shown when there is horizontal room. Nothing is lost when it overflows.

**Cue content = a separate short field.** Iris returns a one-line non-spoiler Socratic `inlineHint`, distinct from the fuller `message` (the chat/hover text). Inline must NOT be a truncation of `message` (that would spoil). Progressive disclosure: inline cue → hover (fuller) → chat (conversation). Principle `[L]` (situated / next-step hints, scaffolding); the field itself is `[ENG]`.

**Rejected alternatives (each tried or analysed in the prototype):**
- **CodeLens (above the line):** the title is plain text in a fixed dim theme color — no custom color / weight / brand logo (only codicons + emoji) — and it shifts the code down + flickers on edit. Unsuitable for the branded, non-shifting cue.
- **`before` decoration (left of the code):** pushes the code right and sits in the indentation (mangles readability); "switch after/before by line length" is brittle because visibility depends on horizontal scroll, not just length. The gutter icon already fills the always-left-visible role without shifting code.
- **Monochrome gutter icon:** at gutter size a single-color silhouette of the mascot loses the eyes (its recognizable feature) and reads as a shapeless blob; the colored logo stays legible.
- **Ghost-text / auto-insert:** that is a code suggestion, not help. Never.

**Honest `[ENG]` caveats:** the 💡 is the colorful Unicode emoji (no plain-text lightbulb glyph exists), so it does not take the brand blue and renders slightly differently per OS — accepted for instant recognizability over a blue SVG icon (both were prototyped). `#007fcf` is a fixed brand color (not theme-adaptive): good contrast on dark, slightly weaker on a light theme (revisit with a darker light-theme blue if it matters). All concrete styling/values are `[ENG]`; the in-editor situated-feedback principle is `[L]` (§11).

## 5. Reject vs Ignore (consistent across all surfaces)

Two distinct student actions, same semantics everywhere:

| Action | How | Effect |
|---|---|---|
| **Ignore** (passive, 0-click) | keep working | surface auto-clears / just sits; counts only **lightly** toward a soft cadence bump and **never** triggers a pause (§5.2). **Must always be free** — never a modal, never focus-steal. |
| **Reject** (explicit) | inline `✕` (hover), toast `Not now`, bubble **Dismiss**; on the **lamp**: open → Dismiss (§5.2 — the lamp's reject is two-step, not 1-click) | clears/collapses the surface + `recordOutcome('dismissed')` + **backoff** + a persisted dismiss outcome (§7.5). Repeated rejects escalate up to a per-exercise pause (§5.2). |

**👍/👎 are not a reject.** Thumbs on a proactive bubble are the existing message-helpfulness control (§6.2); they record helpfulness, not rejection, and do **not** feed backoff. The reject is always **Dismiss / Not now / ✕**.

### 5.1 Backoff lives in the delivery layer, NOT the engine

**Critical consistency point with v3.** v3 deliberately removed "Adaptive Cadence (threshold-rises-on-dismiss)" from the *detection* engine. Reject-driven backoff must therefore live in the **delivery layer** (`throttledAlertSink` / `StruggleInterventionService`), which is explicitly downstream of the recorded alert and distinct from the SPEC cooldown. The engine keeps detecting neutrally; only *delivery* backs off. This does not resurrect the removed engine behaviour. `[ENG]`, direction `[L]` (§11).

The gate's *semantic* adaptation to outcomes (§7) is a separate, softer layer in Pyris; it never replaces this hard, deterministic client backoff. The two are complementary: **gate = smart/soft, client backoff = dumb/guaranteed** (§7).

### 5.2 Backoff mechanics (simple counter model)

Two small per-exercise counters in the delivery layer (`StruggleInterventionService`); the detection engine is never touched (§5.1). All weights/thresholds are `TUNING` knobs (`[ENG]`).

- **`annoyance`** (cadence counter): `ignore += 1`, `dismiss += 2`. At ≥ `TUNING.softThreshold` (start 3, `[ENG]`) → **cooldown bump that escalates per dismiss** (each further dismiss lengthens the gap), on top of the 120 s cooldown.
- **`dismissStrikes`** (hard-stop trigger): `dismiss += 1` only. At ≥ `TUNING.pauseStrikes` (start **5** — a lenient backstop `[ENG]`, since the deliberate off-switch is the explicit per-exercise toggle, §12.2) → **pause proactive surfacing for this exercise**: suppress locally, do not even POST (no egress, no Pyris cost). **Ignore is not in this trigger, so non-response can never pause** — only an explicit "no" can. The auto-pause surfaces as the "Auto-paused" status in the AskIris control (§12.2).
- **Engagement** (`recordOutcome('clicked')` / a reply) → both counters reset to 0. **New exercise** → reset (the orchestrator's existing `reset()` already fires per session/exercise).
- The pause lifts on **manual engagement** or a **new exercise**; chat + lamp stay manually reachable throughout (a pause stops only *proactive* surfacing).

**Ignore without a timer (keeps it simple, single model):** no timeout machinery, no "seen" detection, and **a toast/inline timing out is not itself an ignore event**. Ignore is inferred **lazily** in one place — when a new nudge is about to surface and the previous one was never engaged, count one ignore (`annoyance += 1`). Conservative proxy (a lone, never-replaced nudge never counts), which suits ignore being the weak signal. (This is the *only* ignore-detection path; §6.1's toast lifecycle defers to it.)

**Where it plugs in (delivery layer):** add the two ints to `StruggleInterventionService`; increment in `recordOutcome('dismissed')` and the lazy-ignore path; reset in `recordOutcome('clicked')` and `reset()`; check the pause/soft conditions in `_handleAlert` before the POST. Telemetry is free — both counters get appended to the existing `InterventionEventLog` line (eval data for Ch8).

**Dismiss gestures per surface:** inline ✕ (in the hover), toast "Not now", bubble **Dismiss** button. The status-bar **lamp** has a single click action (open chat); since ambient is now persisted (§7), a lamp click opens the chat showing the persisted hint, where the bubble's **Dismiss** is the reject. So a lamp nudge is rejected by opening it and dismissing, or simply ignored. The earlier "lamp has no dismiss" v1 gap is **closed by unify-persistence** — every surface now reaches an explicit reject (the bubble's Dismiss), so the §1/§9 "reject on every surface" claim holds honestly. A dedicated in-lamp quick-pick stays an optional nicety (§5.3).

**Provenance — Horvitz 1999 (verified against the PDF, principles list, paper pp. 1-2):**
- **Principle 7** ("Minimizing the cost of poor guesses about action and timing … including *appropriate timing out and natural gestures for rejecting attempts at service*") directly endorses **both** a reject gesture (dismiss) **and** a timeout (ignore-clear) — `[L]`. This is the precise anchor.
- **Principle 6** ("Allowing efficient direct invocation and termination") → 1-click dismiss + always-reachable manual chat/lamp — `[L]`.
- **Principle 3** ("Considering the status of a user's attention … deferring action to a time when action will be less distracting") → reduce intrusion — `[L]`.
- **Principle 8** ("Minimizing the cost of poor guesses") → keep low-confidence (`ambient`) nudges cheap/quiet — `[L]`.
- **`[ENG]` boundary (do not overclaim P7):** P7 supports a reject gesture + timing-out only at the *principle* level. The **weights, thresholds, the lazy-ignore proxy, the escalating cadence bump, and the per-surface reject mechanics** are all `[ENG]` — Horvitz gives principles, not numbers, and does **not** endorse *escalating* backoff on repeated ignores (see tension note).

**Deliberate tension — ignore (`[ENG]`, documented):** Horvitz P7 endorses timing a single unwanted nudge *out*, but no source supports *escalating* backoff on repeated ignores. The literature is split: the annoyance side ("Need Help") leans toward backing off; the help-avoidance side ("Unproductive Help-seeking in Programming") warns that backing off on non-response abandons exactly the avoidant students the system should reach. Our resolution: ignore counts only **lightly** toward the soft cadence bump and is **capped out of the pause** (only `dismissStrikes` pauses). Sustained ignoring gently slows the cadence (annoyance side); it never silences proactive help by itself (help-avoidance side). Revisit with deployment data.

### 5.3 Extended model (future work, `[ENG]`, not built now)

Deliberately deferred to avoid an uncalibratable mechanism that would muddy the Ch8 evaluation. Each item is `[ENG]`/speculative; the simple §5.2 core is instrumented richly (full event logging) so these can be added data-driven later:
- **Seen-detection:** count an ignore only with evidence the nudge was seen (anchored line visible + editor focused for T), to clean the "not seen ≠ ignored" noise.
- **Explicit lamp dismiss:** the quick-pick "Open chat / Not now" on lamp click (the simple build rejects a lamp nudge via the opened bubble's Dismiss instead, §5.2).
- **Per-tier down-shift:** rejecting an intrusive tier biases toward quieter tiers instead of a global pause (adaptive salience, "Assistance or Disruption").
- **Time-decay:** the `annoyance` counter decays over time, not only on engagement / new-exercise.
- **Richer event taxonomy + weights:** quick-dismiss vs considered-dismiss; implicit-positive (the flagged error disappears shortly after the nudge → the hint helped); graded weights.
- **Cross-session learned baseline:** a per-student proactivity level from aggregate accept/reject rates ("Assistance or Disruption" user-customizable proactivity; Estey behavioral trajectory). NOTE: distinct from memiris long-term memory, which stays off (§7).
- **Multi-level proactivity slider:** a user-facing Off/Low/Med/High proactivity level (instead of the v1 On/Off switch, §12.2), which requires a per-level intensity mapping. `[L]` principle ("Assistance or Disruption" customizable proactivity); deferred because it adds an evaluation confound + the per-level mechanism we otherwise avoid.

(The earlier "gate feedback to Pyris" future item is now **built** in v1 — the gate sees per-message outcome tags; see §7.)

## 6. Active interaction lifecycle (the expensive tier)

The heart of `active`: **Iris starts a real conversation the student can continue.** That is the entire advantage over ambient, and the interaction is built around "reply", plus lightweight accept/reject, without hijacking the editor.

**6.1 Arrival (no focus steal — already correct today, keep it):**
- message written to session (exists) + badge on Iris icon (exists) + toast.
- toast gets **two** actions instead of today's single "Open Iris": `[Open] [Not now]`.
  - Open → focus chat + (if anchor) reveal the line + `recordOutcome('clicked')`.
  - Not now → `recordOutcome('dismissed')` + backoff. **This is the explicit reject.**
  - toast closed / timed out → **no immediate record**; an ignore is inferred lazily (§5.2) only if the hint is later replaced unengaged. (One ignore model, §5.2.)
- if an anchor exists, also drop the inline breadcrumb at the line so ignoring the toast still leaves a contextual pointer.

**6.2 In the chat — bubble rendering (validated 2026-06-26, companion mockups):**
- **A subtly tinted card** (`background: rgba(--vscode-charts-blue, ~.09)`, rounded corners) so the unprompted message stands out from the **transparent** normal assistant replies. **No** left-border "AI line" (removed), **no** logo header. A small caption inside the card: **"Iris thought this might help"** (brand blue, ~11px, bold). `[ENG]`.
  - Rejected: the old left-border line (noisy / unbranded); a logo-header variant (too present); the caption "Iris noticed you might be stuck" (labels the student — pedagogically worse, replaced by the humble "thought this might help").
  - Un-engaged ambient bubbles use exactly this restrained styling (visibility model A, §7), so a small pile of unread hints never shouts.
- **reply box = the core.** Real session → follow-ups work as a normal conversation.
- **👍 / 👎** = the existing message-helpfulness control (Lucide thumbs, reveal **on hover**, identical to every assistant message; persisted via the existing `/helpful`). Helpfulness telemetry only — **not** a reject and **not** an annoyance signal.
- **Dismiss** = a separate, **always-visible** button (the reject must be discoverable, Horvitz P6/P7). It **collapses/mutes** the bubble + records a dismiss outcome (persisted server-side, §7) + a dismiss strike (§5.2). It does **not** delete the message (§6.3). The per-exercise on/off is NOT on the bubble — it lives in the AskIris control (§12.2).

**6.3 Two guardrails (deliberate constraints):**
1. **The bubble is not deletable.** It is a real persisted message; deleting it would desync client/server. **Dismiss collapses/mutes** the bubble and records the reject — it does not erase it from history. A collapsed/unread proactive message is harmless and stays in the gate's working memory so it is not re-offered (§7). `[ENG]`
2. **No auto-focus on arrival** (code already does this right). Active interrupts via toast + badge, never by yanking the editor mid-keystroke. `[ENG]`, principle `[L]` (§11).

**6.4 Honest limit of the toast:** VS Code toasts are bottom-right, auto-dismiss in seconds, easy to miss. For a "worth-interrupting" tier that is weak, so the **durable indicator is the badge** (persists until opened); the toast is only a momentary nudge. The lamp stays ambient-only so tiers do not blur (existing exception: `active` capped at 3/session degrades to the lamp).

## 7. Persistence & memory model (resolved against the real Artemis code)

This section was rewritten after reading `IrisStruggleInterventionService.java`. Key findings that shaped it:
- `chat_history` sent to the gate is loaded from the **latest `PROGRAMMING_EXERCISE_CHAT` session** for (exercise, user) — the **same session the manual exercise chat uses** (`sendToPyris`).
- `active` writes its `PROACTIVE_STRUGGLE` message into **that same session** via `getCurrentSessionOrCreateIfNotExists(PROGRAMMING_EXERCISE_CHAT, …)` (`handleDecision`). So active is already **one shared thread**.
- `ambient` today writes **nothing** (sends a struggle event with `sessionId=null`). So the gate never sees past ambient hints → it can re-offer the same ambient hint forever. **This is the gap we close.**
- The client's separate **"Iris suggestion"** session entry is only a *client artifact*: when `active` creates a brand-new exercise-chat session the client's overview did not yet list, the client injects a local entry for it. It is still a normal `PROGRAMMING_EXERCISE_CHAT` session, **not** a permanently separate proactive thread.

**7.1 One thread.** All proactive messages live in the single `PROGRAMMING_EXERCISE_CHAT` session, alongside the student's manual chat. This is the existing active behaviour, extended to ambient.

**7.2 Unify-persistence (the change).** `ambient` is **also persisted**: the `ambient` branch of `handleDecision` saves an `IrisMessage` (origin `PROACTIVE_STRUGGLE`) exactly like `active`, and sends the struggle event with the real `session.getId()` **and the saved message id** (not `null`). Consequences:
- the gate sees ambient in `chat_history` → **No-Repeat repaired** (Horvitz P11);
- ambient hints render as the §6.2 bubble in the chat; the lamp/inline just point at the already-persisted message;
- **per-message identity:** the struggle event carries a **`messageId`** (the saved `IrisMessage` id, §8). `sessionId` alone is insufficient now that one shared thread holds many proactive messages — every per-message action (open/reveal, Dismiss/collapse, outcome write) targets `messageId`;
- the previously-planned "escalate-on-engage accept endpoint" and any hint→message **materialization is eliminated** — the message already exists. A lamp/inline/toast click `openProactiveSession(sessionId)` to open the thread; **revealing/scrolling to the exact message uses `messageId`** (today `openProactiveSession` only selects the session, so message-targeting is a small client addition — `chatSessionService.ts:563`). This dissolves the old materialization problem but does **not** remove the need for `messageId`.

**7.3 Visibility model A (storage = visibility).** Every persisted proactive message is also *shown* in the chat; un-engaged ambient is not hidden, only **rendered muted** (the §6.2 card styling). Chosen over a hide-until-engaged model (B):
- A's only real downside (clutter) is already capped by backoff + throttle (§5.2: max 6/session, escalating slow-down, auto-pause), so the pile cannot grow;
- B would **re-introduce** the lamp→message correlation that A removes (it must know *which* persisted message to reveal);
- A keeps **gate memory == what the student can see** (no hidden "Iris knows things you can't" state — a trust/dark-pattern argument).
- Honest paper note: Horvitz **P8** (minimize cost of poor guesses) actually favours B (keep an un-engaged low-confidence guess out of sight). We chose A on the engineering + transparency grounds above, with the backoff neutralising P8's concern. `[ENG]`, tension documented.

**7.4 Working memory = the gate sees outcomes (built in v1).** Beyond the message text, each past proactive message (keyed by its `messageId`, §7.2) in `chat_history` carries an **explicit outcome tag**: `engaged | ignored | dismissed`, derived **server-side** in the DTO conversion. Signals, strongest first, with an explicit **precedence `dismissed` > `engaged` > `ignored`**:
- `dismissed` = the **persisted dismiss outcome** (§7.5) — exact, per-`messageId`. Wins even if a reply later appears.
- `engaged` = the **persisted opened outcome** (§7.5) **or** `message.helpful` is set (👍/👎 both mean the student reacted; the *quality* rides the existing `helpful` field) **or** an **immediate USER reply** (the very next message after it, before any other proactive message, within a short window). The reply rule is an `[ENG]` **approximation** — in a shared manual+proactive thread a reply cannot be attributed perfectly; `opened`/`helpful` are exact, the reply heuristic is the soft fallback.
- `ignored` = none of the above **and** superseded by a later proactive message.
- the latest still-open proactive message gets **no tag** (it is "pending" — the student may still react).

This lets the gate adapt **semantically** ("the student dismissed my last two hints → shift approach / prefer `silent`"), Horvitz **P12** principle `[L]`, mechanism `[ENG]`. It is additive to — never a replacement for — the hard client backoff (§5.1/§5.2).

**Two senses of "engaged" — intentional (do not conflate):** for the **gate's memory** here (§7.4), 👍/👎 *do* count as `engaged` (the student reacted). For the **local backoff** (§5.2), only `clicked`/reply reset the counters — **👍/👎 do not reset backoff**. Rationale: thumbs are a *quality* reaction that should inform the gate's adaptation, but rating a hint is not the same as engaging with the help, so it must not silently reset spam-protection. `[ENG]`

**7.5 New backend pieces: persist `opened` + `dismissed`, and return the state.** `message.helpful` and an immediate reply are already server-visible; **`opened` and `dismissed` are not** (opening the chat and dismissing are client-side actions — today `recordOutcome('clicked'/'dismissed')` is *local telemetry only*, not a server write). So the memory model needs:
- a small **per-`messageId` outcome write**: one endpoint that records `opened` or `dismissed` (the resource currently has only the trigger). `[ENG]`
- the **dismissed/collapsed state must be returned in the message DTO** on load, so a reload re-renders a dismissed hint collapsed instead of re-expanding it (§6.3). `[ENG]`

This corrects the earlier draft's claim that `engaged`/`ignored` were fully derivable from existing data — `opened` is not, hence the explicit write.

**7.6 No long-term memory (memiris off).** `is_memiris_memory_creation_enabled → False` stays. There is **no** cross-exercise learner model ("this student struggles with recursion"). Per-exercise working memory (`chat_history` + outcome tags) is enough for No-Repeat + adaptation. Cross-exercise learning is its own feature (privacy, consent, scope) and is out of scope (§16). (Consistent with the global "Iris Memory System: Disabled" flag in the admin Features page.)

## 8. Gate DTO changes (minimal but honestly two-directional)

**Outbound (gate → client), two NEW optional fields** carrying the anchor:

```jsonc
{ "action": "silent|ambient|active",
  "message": "...",                                        // full hint: chat bubble + inline hover
  "confidence": 0.0,
  "anchor": { "file": "Sort.java", "line": 42 } | null,   // NEW, optional: where to render inline
  "inlineHint": "edge case at the last index?" | null,    // NEW, optional: short non-spoiler Socratic cue (§4.1)
  "rationale": "..." }
```

Client mapping: `ambient + anchor live → inline` · `ambient + anchor present but off-screen / no anchor → lamp` · `active → chat (+ inline pointer if anchor live)`. The inline cue text is `inlineHint`; the hover/chat text is `message` (NOT a truncation of it, see §4.1).

**Inbound (Artemis → gate), enriched `chat_history`:** each proactive message gains its outcome tag (`engaged | ignored | dismissed`, §7.4). This is server-side enrichment of the existing `chat_history`, not a client change.

**Struggle event (Artemis → client), NEW `messageId`:** `StruggleInterventionEvent` (today `exerciseId, action, message?, sessionId?, confidence?` — `struggleContract.ts:45`) gains **`messageId`** (the saved `IrisMessage` id, §7.2). Without it, a per-message Dismiss/collapse/open cannot target the right message in the shared thread. Artemis already has `saved.getId()` after `saveMessage` in `handleDecision`, so this is a one-line addition each on the server DTO and the client interface.

**Honest scope note (corrects the earlier "one field"):** these are **two** outbound fields plus the inbound outcome enrichment, and the outbound fields must propagate through **Pyris DTO → Artemis DTO → struggle websocket event → client parser → rendering**. Calling this "one minimal field" undersold it; it is small but it is a five-layer change. `[ENG]` fields; localizability + progressive-disclosure principle `[L]` (§11); outcome enrichment `[ENG]`, P12 `[L]`.

## 9. What already exists vs what is new

**Exists:** Pyris 3-action gate + confidence; Artemis `handleDecision` (active persist + websocket + event / ambient event / silent); the gate reads `chat_history` from the manual exercise-chat session; client lamp (orange) with `showAmbient(hint, opensChat)`; active path `onServerActive` → `openProactiveSession` + badge + toast("Open Iris") + restored proactive bubble (blue left-border + caption today); throttle (2/min, 6/session, 30s gap); eval log with `recordOutcome('clicked'|'dismissed')`; per-course `IrisCourseSettings.enabled` gate + per-user LLM opt-in.

**New:**
- inline decoration surface + client surface-selection; `anchor` + `inlineHint` fields + Pyris prompt update (§8);
- explicit **reject** affordance reaching every surface; **backoff** reacting to reject (delivery layer, §5.2); two-button toast;
- bubble re-style (tinted card, no line/logo, new caption, §6.2); thumbs = helpfulness (reuse); **Dismiss** button (collapse, not delete);
- **unify-persistence**: ambient persists an `IrisMessage` + non-null `sessionId` **+ `messageId` in the struggle event** (§7.2/§8) — *replaces* the previously-planned accept endpoint; client must scroll/target by `messageId`;
- **gate outcome tags** in `chat_history` (§7.4) + **persist `opened`+`dismissed`** outcome endpoint + dismissed/collapsed state returned in the message DTO (§7.5);
- per-exercise opt-out control (AskIris card, §12.2);
- **course-level `proactiveStruggleEnabled`** setting (§13) + client reads the 202 `accepted` flag (currently ignored);
- availability gating (`.noai` / Iris-off / consent → no-AI fallback / off, §14).

## 10. Provenance map (Ch7-ready)

The "why" of each decision, grounded in the actual library under `papers/to-be-used/`. Bib keys TBD; titles are exact.

| Design decision | Paper basis | Marker |
|---|---|---|
| Proactive intervention at all + trade-off frame | "Assistance or Disruption — Trade-offs of Proactive AI Programming Support" (n=18); "Need Help — Designing Proactive AI Assistants for Programming" (n=65) | `[L]` ✅ |
| **Default silent, minimal escalation** | Horvitz 1999, *Principles of Mixed-Initiative User Interfaces* (cost-benefit of intervention, P8); Assistance Dilemma (Koedinger & Aleven, already in `config.ts`); "Assistance or Disruption" (over-proactivity lowers control/ownership/understanding) | `[L]` ✅ |
| Graded **salience** (silent/ambient/active) | "Assistance or Disruption" → explicit *adaptive salience*; Horvitz 1999 → scale automation by confidence | principle `[L]` ✅, the 3 tiers exactly `[ENG]` 🔧 |
| Ambient / peripheral (lamp) | *adaptive salience* lowest tier; Horvitz 1999 P8 (keep poorly-timed intervention cheap) | `[L]` ⚠️ / mechanism `[ENG]` |
| **Inline + anchor** | "Assistance or Disruption" → *visible in-editor presence*, *local threads bind context*; "One Step at a Time — LLMs + Static Analysis for Next-Step Hints"; "It's Weird That it Knows What I Want" (inline UX caution for novices) | principle `[L]` ⚠️, VS-Code decoration `[ENG]` 🔧 |
| Active = continuable conversation / turn-taking | "Assistance or Disruption" → *clear turn-taking*, *local threads/breakouts*; CodeHelp; CodeAid | `[L]` ✅ / persistence mechanic `[ENG]` |
| Non-spoiler hint content | CodeHelp; CodeAid; "Scaffolding Metacognition in Programming Education"; "The Widening Gap"; "How AI Impacts Skill Formation" | `[L]` ✅ |
| **Reject affordance + timeout** | Horvitz 1999 **Principle 7** ("appropriate timing out and natural gestures for rejecting attempts at service") + P6/P3; "Need Help" (too-persistent disliked) | `[L]` ✅ |
| **Escalating backoff on reject** (delivery layer, §5.2) | direction from "Need Help" (persistence disliked); Horvitz gives no escalation numbers | mechanics `[ENG]` 🔧 |
| Ignore = light weight, capped out of the pause (§5.2) | split: "Need Help" (back off) vs "Unproductive Help-seeking" (don't abandon avoiders) | `[ENG]` 🔧, tension documented |
| **Working memory / No-Repeat** (chat_history) | Horvitz 1999 **Principle 11** ("maintaining working memory of recent interactions") | principle `[L]` ⚠️ (inspiration, not a validated counter), mechanism `[ENG]` |
| **Gate sees outcomes / semantic adaptation** | Horvitz 1999 **Principle 12** ("continuing to learn by observing") | principle `[L]` ⚠️, mechanism `[ENG]` 🔧 |
| Per-exercise opt-out (student) | "Exploring Student Behaviors … Optional Guardrails"; "Assistance or Disruption" (customizable) | `[L]` ⚠️ |
| Course-level enablement (instructor) + A/B | rollout/experimental-control practice; no specific paper | `[ENG]` 🔧 |
| Timing owned by engine, not LLM | study `[D]` + "Need Help" (timing-critical) | `[D]` + `[ENG]` |
| No focus-steal / non-modal | Horvitz 1999 (minimize disruption, timing) | direction `[L]`, specifics `[ENG]` 🔧 |

Strongest single anchor for the whole interaction model (confidence-gating, minimal disruption, ignorable/terminable, working memory, learn-by-observing, no focus-steal): **Horvitz 1999 Mixed-Initiative** — the through-line here. Note honestly: Horvitz supplies *principles* (P7 reject/timeout, P8 cheap poor guesses, P11 working memory, P12 learn-by-observing); the *counters, thresholds, escalation curve, lazy-ignore proxy, and outcome-tag mechanism* are all `[ENG]`.

## 11. Honest caveats (do not overclaim)

1. **The two core proactive papers are code-suggestion / professional-dev contexts, not education.** "Need Help" is explicitly "not really for education", gives *direct code suggestions*, n=65 devs. Transferable: the interaction, timing, and control findings. **Not** transferable: the auto-insert paradigm — this project does non-spoiler hints, never code insertion. Mark as ⚠️ adaptation in Ch7.
2. **The exact silent/ambient/active taxonomy is in no paper.** It is this project's operationalization of *adaptive salience*. Honestly `[ENG]` 🔧, not `[L]`.
3. **All concrete numbers** (cooldowns, cap = 3/session, backoff curve, pause at 5, softThreshold 3) and the **anchor / outcome-tag mechanisms** are `[ENG]`, inspired by the principles but not directly citable.
4. **Visibility model A vs P8.** Horvitz P8 leans toward hiding un-engaged low-confidence nudges; we chose to show them (muted) for transparency + simplicity (§7.3). Documented, not papered over.
5. **`.noai` behaviour change.** Making `.noai` (and Iris-off) gate the *manual* chat too (§14), not only proactive egress, is a deliberate widening of `.noai`'s meaning. Call it out where `.noai` is documented.

## 12. Decisions (resolved 2026-06-26)

**§12.1 — Bubble affordances:** reply (exists) **+ 👍/👎 (helpfulness) + Dismiss (reject)**. 👍/👎 = the existing helpfulness control (on-hover, persisted via `/helpful`), telemetry only, **not** a reject and **not** an annoyance increment. **Dismiss** = a separate always-visible button that collapses/mutes the bubble (does not delete, §6.3) + records a dismiss outcome (§7.5) + a dismiss strike (§5.2). The per-exercise on/off is NOT on the bubble (see §12.2). (This resolves the earlier §5/§6/§12 contradiction: thumbs ≠ reject; Dismiss = reject ≠ delete.)

**§12.2 — Per-exercise opt-out: yes, an explicit control in the AskIris card** (`webview/components/AskIris`, rendered on the Exercise-Detail view). Design:
- an **On/Off switch** (2-position slider-style toggle; **not** a multi-level proactivity slider — that is §5.3 future work) that sets the **durable per-exercise** proactivity preference (default On `[ENG]`, gated by the existing AI opt-in; persisted per exercise id).
- a **3-state status badge** that tells the truth: **On** / **Auto-paused** (the transient §5.2 auto-pause, with a "Resume" action; resolves on engagement / new exercise) / **Off** (explicit). The switch only ever reflects the *explicit* On/Off; the auto-pause shows as "Auto-paused" so the switch never moves on its own.
- doubles as a **presence / awareness indicator** ("is Iris watching?") — `[L]` "Assistance or Disruption" (presence indicators raise AI-awareness) + Horvitz P6 (control).
- **Card states — one term per situation (consistent with §13/§14):**
  - **Available** (Iris on · course-proactive on · consent ok): the **On / Auto-paused / Off** switch+badge above. "Off" here = the *student's explicit* off; switch flippable.
  - **Off (disabled for this course)** (course `proactiveStruggleEnabled` off, §13/§14 row 1): the proactive control shows this with the **switch disabled** (the student cannot enable what the course turned off); **no proactive surfacing, no no-AI lamp**. The **Ask button still works** (manual chat unaffected).
  - **Unavailable** (`.noai` / Iris disabled / no LLM opt-in — §14 cases 2-3): proactive **and** the Ask button are **both** off, with the reason banner.
  - **Degraded** (endpoint 404 / no proactive-egress consent — §14 cases 4-5): proactive falls back to the no-AI lamp/template; the **Ask button works**; the control notes proactive is limited.
  Only cases 2-3 are "Unavailable"; course-off is its own "Off (course)" state and never maps to the no-AI lamp.
- **Division of labor:** AskIris switch = durable preference + status; bubble/toast **Dismiss** = in-the-moment reject; §5.2 auto-pause = automatic backstop. The three complement, no overlap.

## 13. Course-level enablement (instructor/admin, for A/B)

A per-course toggle so proactive struggle detection can be enabled independently of the chat — required for a cohort-based A/B evaluation (chat-only vs chat+proactive) and for safe rollout.

- **Where:** extend the existing `IrisCourseSettings` record with `boolean proactiveStruggleEnabled`, surfaced in the **"Administrator Settings"** section of the course Iris-settings page (`iris-settings-update.component`), next to Pipeline Variant / Rate Limit. **Admin-only** (not the instructor-visible "Enable Iris" block) so the experimental condition cannot be flipped by instructors and contaminate the A/B.
- **Granularity:** per-course (a course = an A/B condition). Per-exercise is rejected: this fork has no per-exercise Iris settings at all (everything is `getSettingsForCourse`), so it would mean a whole new settings layer — overkill.
- **Default: off** `[ENG]`. New, intrusive feature; treatment courses are switched on explicitly. (Trade-off: courses with Iris on don't get struggle until explicitly enabled — acceptable, the feature is new.)
- **Enforcement:** one extra clause in `IrisStruggleInterventionService.prepareTrigger` — `if (!settings.enabled() || !settings.proactiveStruggleEnabled()) return empty;` → the endpoint returns 202 `{accepted:false}`.
- **Client surfacing (correction):** the client currently **ignores** the 202 body — `postStruggleIntervention` returns `'accepted'` unconditionally and only maps a 404 to `'unavailable'` (`artemisApi.ts:547-561`). So `{accepted:false}` would today be mis-read as `'accepted'`, and the client would wait forever for a websocket decision that never comes. Fix: **read the `accepted` flag from the 202 body** and map `false` → **proactive-off for the session**: no proactive surfacing at all (no POST retries, **no no-AI lamp**) and detection paused. This is **distinct from a 404** (case 5), which *does* degrade to the no-AI lamp — course-off is a deliberate instructor choice to have *no* proactive help, so the client shows nothing proactive and the AskIris control shows "Off (disabled for this course)" (§12.2 / §14 row 1). A required (small) client change, not free.
- **No global FeatureToggle.** A global (instance-wide) toggle cannot do per-cohort A/B, and default-off-per-course already prevents accidental exposure, so the global Features-page kill-switch is deliberately **not** built. `[ENG]`
- **Touch list:** `IrisCourseSettings.java` (+ JSON creator + default) · `IrisSettingsService`/resource merge · `prepareTrigger` gate · `iris-course-settings.model.ts` · `iris-settings-update.component.{ts,html}` · `iris.json` (de/en) · Java + Angular tests.

## 14. Availability gates (`.noai` / Iris-off / consent)

The cases, with **proactive · manual chat · detection · local no-AI template · banner** spelled out so they cannot contradict each other:

| # | Condition | Proactive | Manual chat | Detection | Local no-AI template | Banner |
|---|---|---|---|---|---|---|
| 1 | Course `proactiveStruggleEnabled` off (§13) | off | **on** (if Iris enabled) | **paused** | no | AskIris shows "Off (course)"; no full banner |
| 2 | Iris disabled (`enabled=false`) **or** no LLM opt-in | off | off | paused | no | yes (Iris unavailable) |
| 3 | **`.noai`** marker present | off | **off** | paused | **no** | yes (`.noai` respected) |
| 4 | No proactive-egress consent (LLM opt-in yes, no `.noai`) | local template only | on | **runs** | **yes** (zero egress) | optional consent prompt |
| 5 | Endpoint **404** (old/feature-less server) | degrade to no-AI lamp | on | runs | yes | transient / none |
| 6 | Transient 5xx / network / 401 | silent this tick | on | runs | no | none |

**Resolving the `.noai` contradiction (codex):** `.noai` is **full off — no local template either** (the deliberate widening, §11.5: it disables the manual chat too), so detection is genuinely pointless and **paused**. The **local no-AI template only applies to cases 4-5**, where there is no egress but detection still runs and *something* (a template / no-AI lamp) can surface. So "detection paused" (cases 1-3) and "local template" (cases 4-5) are now disjoint.

**404 ≠ unreachable (codex):** a **404** means the endpoint/feature is missing → `postStruggleIntervention` returns `'unavailable'` → degrade to the no-AI lamp, **manual chat is unaffected** (case 5). A **transient** 5xx/network/401 returns `'failed'` → silent for that tick, retry later (case 6). These are different states and must not be merged into one "server down".

Where the whole feature incl. manual chat is off (**cases 2-3**), the **Exercise-Detail view explains why** with a short banner and the **AskIris card shows the Unavailable state** + a disabled Ask button (§12.2) — the student is never left guessing. `decideOutcome` already encodes the no-AI fallback for cases 4-5; cases 1-3 short-circuit earlier (and pause detection). `[ENG]`, banner/awareness rationale `[L]` (presence/awareness, §12.2).

## 15. Implementation building blocks (NOT yet a plan)

High-level only; the actual implementation plan goes through the codex plan-review loop before any code:
- inline decoration service (per §4.1: gutter colored-logo + after-line `inlineHint` bold/`#007fcf`/💡 + invisible whole-line hover carrying `message` + `Open chat`/`Dismiss`; auto-clear on edit / visibility loss);
- `anchor` + `inlineHint` through Pyris DTO → Artemis DTO → struggle event → client; Pyris prompt update to emit them;
- client surface-selection (intensity + anchor + live editor state);
- unified reject/ignore affordance + backoff counters in the delivery layer (§5.2);
- two-button active toast; re-styled proactive bubble (§6.2: tinted card, no line/logo, "Iris thought this might help"); thumbs reused as helpfulness; **Dismiss** button (collapse, not delete);
- **unify-persistence**: ambient branch of `handleDecision` saves an `IrisMessage` + sends non-null `sessionId` **+ `messageId`** in the struggle event (§7.2/§8); client targets the message by `messageId`;
- **gate outcome tags**: server-side enrichment of `chat_history` (§7.4) + **persist `opened`+`dismissed`** outcome endpoint + return dismissed/collapsed state in the message DTO (§7.5);
- **course-toggle plumbing**: `prepareTrigger` gate + client reads the 202 `accepted` flag to surface course-off as unavailable (§13);
- AskIris on/off switch + 3-state status badge + Unavailable state, persisted per exercise (§12.2);
- course-level `proactiveStruggleEnabled` setting end-to-end (§13);
- availability gating + exercise-view banner (§14).

## 16. Non-goals

- No change to the v3 detection engine, thresholds, or timing (display/delivery only).
- No engine-side adaptive cadence (deliberately removed in v3; see §5.1). The gate's semantic adaptation lives in Pyris, the hard backoff in the client delivery layer — never the engine.
- No code auto-insertion (non-spoiler hints only; see §11).
- No long-term / cross-exercise memory (memiris stays off, §7.6).
- No global (instance-wide) FeatureToggle for struggle detection (§13).
- No new **student-facing** setting beyond the per-exercise opt-out (the AskIris on/off switch, §12.2). The course-level setting (§13) is instructor/admin-facing, not student-facing.
