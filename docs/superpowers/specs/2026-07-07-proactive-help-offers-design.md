# Proactive Help Offers ("Ask, Don't Push") — Cross-Stack Design Spec

**Date:** 2026-07-07
**Status:** Design approved (UX + behaviour). Generation model **B+ (generate-on-accept + bounded offer-context relaxation)** after codex spec review falsified the A' "gate a free background hint" premise (see §2). Backend approach grounded in code. Ready for a second spec review.
**Branches:** client `feat/struggle-v3-integration` · Artemis `feature/iris/struggle-intervention-pipeline` · Pyris (edutelligence monorepo) `feat/struggle-intervention-pipeline`.

---

## 1. Goal

When a student is still stuck after Iris's first proactive hint, Iris should **offer** the next hint ("Still stuck, or want another hint?") instead of silently pushing more or going quiet. The student stays in control: **Show me** produces and reveals the next hint; **Not now** keeps Iris quiet for that episode. The same mechanism gives a gentle last check before an idle episode is abandoned.

One line: **replace unsolicited follow-up delivery with a consented offer, and generate the follow-up hint only when the student accepts, at two moments.**

## 2. How the system behaves today, and the chosen change (B+)

**Today Iris goes quiet after the first delivered hint.** The client detector keeps producing alerts, but once a slot is `DELIVERED`, two things happen (both verified in code):

1. **The client skips the `decide` POST entirely** while the slot is `DELIVERED`, except one narrow escalation case (`struggleInterventionService.ts:537-543`, the recent perf commit `aa71424f`). So there is **no background follow-up run** and **nothing pre-generated**.
2. Even if a follow-up decision did arrive, `reconcileDelivered` (`slot/reconcile.ts:79-92`) **suppresses** every result except `active + hardEvent` on a revealed-ambient hint (the "escalate once" case). So an `ambient` follow-up is dropped, not parked.

**Why not A' (gate a pre-generated hint).** An earlier draft chose "A'": intercept the auto-delivered follow-up, hold it via the existing ambient/park/reveal path, and reveal it instantly on **Show me**. The codex spec review + code inspection showed the premise is false: delivered slots neither run the follow-up decide nor park its result. There is no free background hint to gate. A' would have required *re-enabling* speculative background runs on delivered slots (new cost, reverses `aa71424f`) plus a new persisted held-hint state. Rejected.

**The chosen model — B+ : generate on accept, with a bounded offer-context relaxation.** Two parts:

- **B (generate on accept).** The **offer** is raised **client-locally** (no server call) at the exact point where today the delivered-slot alert is skipped. The offer copy is generic ("Still stuck, or want another hint?"). Only when the student clicks **Show me** (Moment 1) or **I need more help** (Moment 3) does the client POST a follow-up `decide` — a fresh agent run (~14s, shown with a spinner) — whose result is persisted and pushed as the next hint. **Not now / ignore never runs the agent.** This spends an LLM run only on explicit consent (consistent with `aa71424f`), needs no held-hint state, and dissolves the A' race entirely.

- **+ (bounded relaxation, consented-request only).** A consented follow-up is an **explicit request**, so the anti-nagging HARD RULE (`struggle_intervention_system_prompt.j2:22-31`, "same diagnosis → silent") must not leave the student who just clicked with nothing after a 14s spinner. For a consented follow-up the prompt is **relaxed** to license the *next concrete step on the same diagnosis* and made **never-silent** (always at least an honest next step), while keeping the hard guardrail: **never the full/near-full solution, never a bare reword**. The **first, unsolicited contact stays conservative and strict** (relaxation applies only to the consented follow-up), so first-contact nagging does not increase.

This deliberately does **not** pre-generate on struggle and does **not** push follow-ups. First contact is unchanged; everything new hangs off an explicit accept.

## 3. Scope

**In scope (two moments):**
- **Moment 1 — still stuck.** A client-local offer replaces the silently-skipped delivered-slot alert; **Show me** generates and reveals the next hint.
- **Moment 3 — about to abandon.** A gentle presence check 60s before the idle watchdog frees the slot; **I need more help** generates (or reveals a Less-mode parked hint).

**Out of scope / parked / future:**
- **Fall A ("did it help?" retrospective confirm on RECOVERED)** → future work.
- **Moment 4 — ambient-first first contact** → parked pending a literature check (contingent scaffolding / Assistance Dilemma grounding).
- **Moment 2 — repeated-error trigger** → not selected (needs error-family grouping).
- **Speculative background pre-generation (the A' idea)** → rejected (§2); possible later if evaluation shows the on-accept spinner hurts uptake.

## 4. UX design (the seven cases)

Mockups: `.superpowers/brainstorm/.../all-cases-v2.html`, `when-diagram.html`, `moment3-final.html`. Copy is **English** to match the shipped UI.

### 4.1 The offer, two surfaces (one signal, shared `episodeId` + per-offer id)
The offer is an **ephemeral, client-local** UI element (no server round-trip, not persisted). If the webview reloads it disappears and the detector simply re-raises it on the next still-stuck alert.
- **Chat open** → the offer is the next **bubble** in the episode timeline with two buttons (reuses `EpisodeTimeline` + `MessageBubble`, where Dismiss lives today).
- **Chat closed, More only** → the existing **NudgeBanner** in the Artemis view, which auto-opens (`extension.ts:147-163`), same two buttons + countdown + badge.

Each offer carries a **per-offer id** (plus the shared `episodeId`) so a dual-surface offer (bubble + banner) resolves **first-action-wins** across surfaces, exactly as Dismiss already correlates by `episodeId`.

### 4.2 Proactivity-level routing
| Level | Chat open | Chat closed |
|---|---|---|
| **Off** | nothing | nothing |
| **Less** (pull) | bubble in thread | **no banner** — badge only; the offer waits in the chat |
| **More** (push) | bubble in thread | **banner** (view auto-opens) + badge |

Banner appears **only** in "chat closed AND More". An accepted hint (see §4.3) is delivered as a persisted chat bubble at **every** level (a consented reveal is not an unsolicited push, so it is exempt from the pull cap on the server — §7 — **and from the client-side Less reroute** — §6). Both bypasses are required: today the client unconditionally re-parks every inbound `active` in Less, so the server bypass alone would still be swallowed client-side.

### 4.3 Answers — Moment 1 (still stuck)
- **Show me** → the client POSTs a consented follow-up `decide` (`intent="help_request"`, §9), shows a **spinner (~14s)**, and renders the returned hint as a persisted bubble. Episode stays open; the cycle can repeat until the cap. **Counts toward the cap.**
- **Not now** → **no POST**; Iris quiet **for this episode** (a per-episode flag suppresses further Moment-1 offers until the episode closes). Not a terminal outcome; the episode may still RECOVER/ABANDON later.
- **Ignored** → short cooldown, may offer again if still stuck and under cap. No POST.

**Offer spacing reuses the existing values (held constant as an engineering control, not newly justified timing).** The offer is gated by the detector cooldown (`COOLDOWN_S=120`, ENG) and the per-level delivery throttle (`THROTTLE_BY_LEVEL`: More 150s / Less 300s, ENG), so the first offer lands ≥150s after the first hint. **No dedicated "settle" knob** — a new value would be no more validated, just another tuning parameter. What B+ evaluates is **consent-gating + follow-up content policy**, with timing deliberately fixed.

### 4.4 Caps (per episode, client-enforced)
- Number of hints delivered **via an accepted offer** per episode — "Show me" at Moment 1, "I need more help" at Moment 3 — is capped: **Less = 1**, **More = 3**, **Off = 0**. The initial hint that opened the episode is counted **separately** (it is not an offer). After the cap, no more Moment-1 offers this episode.
- **Exception (abandon-risk):** at Moment 3, an explicit "I need more help" delivers **even if the cap is exhausted** — a student about to give up who explicitly asks overrides the cap.
- Caps are **runtime-scoped client state** (per `proactiveEpisodeId`). This is acceptable for the MVP; a webview reload resets the count (documented limitation §11). If evaluation integrity needs a hard cap, it can move server-side later (count `PROACTIVE_STRUGGLE` rows per episode).

### 4.5 History & fold
- Delivered hints are real proactive messages (full bubbles, persisted on generate).
- After an answer, the offer **collapses to a condensed grey line**: `Offered another hint · You: Show me` / `· You: Not now` (grey, hollow timeline node). Unanswered (Moment 3): `Offered a hand · no response`.
- A closed episode uses the **existing fold** (`episodeSummary.ts`): ABANDONED → `⧗ Timed out`. No extra "ended" narration.

### 4.6 Moment 3 (about to abandon) — a presence check, not a hint push
Fires **60s before** the stale watchdog would free the slot, with a **minimal grey countdown bar** (no digits) over 60s. It is a re-engagement check ("still there?"), not a promise of a hint. Copy: "Still on this? I'll step back soon otherwise." **Two buttons + ignore** (no explicit "dismiss" — ignoring is the decline, since idle abandons anyway):
- **I'm still on it** → reset the idle watchdog (+another `idleAbandonMs`, ~10min). **No hint, no POST**, instant. Iris keeps watching.
- **I need more help** → deliver a hint. If a **parked** hint exists (a Less-mode ambient hint the student never clicked), reveal it (instant, no POST). Otherwise POST a consented follow-up `decide` (`intent="help_request"`, never-silent per §8) with a spinner and render the result. Counts toward the cap, but delivers even if exhausted (§4.4 exception). Also resets idle.
- **Ignored** (bar empties) → slot frees, episode folds quietly (ABANDONED / `⧗ Timed out`).

Showing the offer **defers the abandon deadline** to the 60s window (never show-then-immediately-free).

## 5. Architecture across the stack (B+)

```
Client (extension)                     Artemis (server)                 Pyris (agent pipeline)
──────────────────────────            ────────────────────────         ─────────────────────────
detector alert on DELIVERED slot
  (today: skipped) ── raise a
  CLIENT-LOCAL offer (no POST),
  gated by throttle + cap
        │
   student clicks Show me / I need more help
        │
        └─ POST decide, intent="help_request",  ─► handleDecision:            agent runs (≤15 iters),
           episode.isNew=false, hints:[…]           for intent=help_request,   reads code/diff/logs via tools
                                                     GENERATE via Pyris,        + help_request prompt branch:
                                                     PERSIST + PUSH bubble,     relax anti-repeat (next concrete
                                                     bypass pull cap +          step OK for is_new=false) AND
        ◄──────── active event (persisted) ◄──────── confidence gate      ◄─── never-silent; hard guardrail kept
   append hint to the OPEN delivered                 (consent overrides         (never full solution / bare reword);
   episode (new delivered→delivered                  caution)                   first contact (is_new=true) unchanged.
   append transition), spinner→bubble
   Not now / ignore ── nothing (no POST, no run)
   per-episode cap + condensed decision record + fold reuse
```

The agent run happens **only on accept**, so no LLM run is wasted on a declined/ignored offer. **Show me is a short spinner, not instant** — the honest cost of generating on consent.

## 6. Client (extension) design

**Offer trigger (Moment 1).** Hook the delivered-slot suppression point (`struggleInterventionService.ts:537-543`, `_suppressReason`): today it returns `SKIP (delivered slot…)`. Instead of silently skipping, when the alert would be skipped **only** for the delivered-slot reason (not Iris-off / proactive-off / awaiting-evidence), the episode is still open and un-recovered, we are **under the offer cap**, past the **offer spacing** (§4.3), and the episode is not **Not-now-suppressed**, raise a **Moment-1 offer** (client-local, no POST). All the harder suppression reasons still short-circuit first.

**Offer trigger (Moment 3).** Hook the `StaleWatchdog` (`slot/staleWatchdog.ts`, `idleAbandonMs`): at `deadline − 60s`, if the episode is still open and un-recovered, post the presence-check offer with a 60s window and **extend the watchdog to that window** (defer the abandon deadline).

**Consented generation + delivery (the new correlation intent + state-machine transition).** On **Show me** / **I need more help**:
1. POST with `intent="help_request"`, `episode.isNew=false`, `episode.hints=[…prior hints]` (§9). Register it in the `InFlightGuard` under a **third local `Intent` value `help_request`** — extend the `Intent` union (`slot/guard.ts:8`, `struggleContract.ts:34`, `extensionMessages.ts`) from `'decide' | 'confirm_close'` to include `'help_request'`. This is what makes the returning `active` recognisable as a consented follow-up (below); single-flight per intent, so it neither re-offers nor double-POSTs during the ~14s run. (Per-intent tracking is a **correlation** device only — the wire stays **effectively single-outstanding per `(user, exercise)`** as today; `help_request` and first-contact `decide` are never in flight together because they live in disjoint slot states.) Render a spinner on the offer.
2. **Return routing (the Less-reroute bypass).** The server returns an `active` event for the **same** `episodeId`. `onServerActive` (`struggleInterventionService.ts:730`) must first check the guard for a **live `help_request` marker** matching this `episodeId`/generation. If present, this is a consented follow-up: route it to the append transition below, **bypassing the `level === 'less'` → `onServerAmbient` reroute at `:746-749`** (which otherwise re-parks every Less active). If no `help_request` marker is live, keep today's behaviour unchanged (first-contact `decide`, including the Less reroute). Because a `help_request` is only ever outstanding on a DELIVERED slot and a first-contact `decide` only on FREE/PARKED, at most one of the two is live at a time — correlation stays unambiguous.
3. **Append transition.** The slot **appends** the hint to the **open DELIVERED episode** — a new `delivered → delivered` transition (call it `appendFollowup(hint)`), **distinct from** the existing `hardEvent`-gated `escalate`. `reconcileDelivered` gains an explicit case for a consented follow-up delivery keyed on the live `help_request` marker, rather than the current blanket `suppress`. A real (small) state-machine change, **not** reuse of the parked path.
4. Increment the episode's delivered-offer count (cap).
5. **Empty/defensive edge.** If the server returns a silent/empty completion frame despite the never-silent contract (§8), clear the in-flight `help_request` marker, show a brief "nothing more I can add right now", and **do not** consume a cap slot.

**Offer rendering (reuse where it genuinely is reuse).**
- Per-message marker (e.g. `offer?: { moment: 'stuck' | 'abandon'; offerId: string }`) on the proactive `ChatMessage` (`webview/views/IrisChat/types.ts`), rendered by `MessageBubble` / `EpisodeTimeline` with two buttons — modelled on the hard-coded Dismiss button (`MessageBubble.tsx:167`, `EpisodeTimeline.tsx:55`). No generic action framework (YAGNI).
- **Banner contract change (required, not YAGNI).** The nudge contract today only carries `showMe | dismiss | timeout` (`NudgeBanner.tsx:21`, `webviewCommands.ts:273`, `telemetry/index.ts:338`). Generalise it to `{ moment: 'stuck' | 'abandon', action: 'accept' | 'decline' | 'timeout', episodeId, offerId }`; button **labels** are set per moment ("Show me"/"Not now" for `stuck`, "I need more help"/"I'm still on it" for `abandon`); Moment 3 sets banner `timerMs = 60000`. The client handler branches on `moment`:

| `moment` | `accept` | `decline` | `timeout` |
|---|---|---|---|
| `stuck` | generate + reveal (cap) | suppress Moment-1 offers this episode | short cooldown, re-offer allowed |
| `abandon` | reveal parked or generate (cap, overrides exhausted); reset idle | reset idle, no hint | watchdog frees → ABANDONED |

**Caps.** Client tracks delivered (accepted) hints per `proactiveEpisodeId`; stops offering Moment-1 at Less = 1 / More = 3; Moment-3 `accept` overrides an exhausted cap.

**History.** Accepted hints persist (generate path). The offer message collapses to the condensed grey decision line on resolution; closed episodes fold via `episodeSummary.ts`.

**Key client files:** `services/struggleIntervention/struggleInterventionService.ts` (offer trigger at the delivered-slot hook; `help_request` POST; `onServerActive` help_request branch + Less-reroute bypass), `slot/guard.ts` (extend the `Intent` union with `help_request`), `slot/reconcile.ts` + `slot/slotManager.ts` (the `appendFollowup` transition), `slot/staleWatchdog.ts` (Moment-3 trigger + deadline defer); `webview/views/IrisChat/types.ts`, `components/MessageBubble.tsx`, `components/EpisodeTimeline.tsx`; `components/NudgeBanner/NudgeBanner.tsx`, `shared/messageContracts/webviewCommands.ts`, `shared/messageContracts/extensionMessages.ts` (Intent literal), `services/ui/nudgeBannerText.ts`; `struggleIntervention/struggleContract.ts` (Intent literal); wiring in `telemetry/index.ts` + `extension.ts`.

## 7. Artemis (server) design

**Handle a consented follow-up as generate-and-deliver.** In `IrisStruggleInterventionService.handleDecision` (`:237-303`): when the run's `intent == "help_request"` (stamped into `StruggleInterventionJob`, which already carries `intent` at `:22/:30`), the decision is **generated, persisted, and pushed** as an `active` proactive bubble for the same `episodeId`, with two exemptions from the unsolicited-path caution:
- **Bypass the pull `active → ambient` cap** (`:245-247`): a consented request delivers as a bubble even in Less (the student explicitly asked; it is not an unsolicited banner). This **must be paired with the client-side Less-reroute bypass** (§6, `onServerActive:746-749`) — both the server cap and the client reroute re-park Less actives, so both need the `help_request` exemption or the hint is swallowed.
- **Bypass the confidence-threshold silent-gate** (`:241-242`): for `help_request` we always deliver Pyris's response, which is **never-silent by prompt contract** (§8). (Defensive edge: if Pyris nonetheless returns empty, emit the existing silent completion frame so the client's in-flight decide clears, and the client shows a brief "nothing more I can add right now" — §11.)

**First contact and the discard path are unchanged.** For `intent == "decide"` (the initial, unsolicited episode-opening run), the existing behaviour is untouched: confidence threshold `0.6` (`:241`), pull `active → ambient` cap (`:245`), `silent`/empty → completion frame. Because B+ never runs a background follow-up decide, there is **no server-side "hold" branch** and **no reliance on reading `episode.isNew`** in the callback (the earlier A' plan needed that; the job does not carry `isNew` — verified — and B+ does not need it). The follow-up/first-contact distinction rides the **existing `intent` field**, already stamped end-to-end into the job and the Pyris execution DTO.

**No new endpoint / no `revealAmbient` on this path.** B+ delivers by generating and persisting directly; it does not use the ambient hold + reveal endpoint for the offer path. `revealAmbient` remains for the pre-existing Less first-contact ambient flow (unchanged). Outcome endpoint (`PUT .../proactive-outcome`, DISMISSED/RECOVERED/ABANDONED) unchanged; "Not now" is client state, not a new outcome.

**Caps stay client-side** (§4.4). The struggle path keeps only its per-`(user,exercise)` single-flight marker; no server-side per-episode cap in v1.

**Key Artemis files:** `service/session/IrisStruggleInterventionService.java` (`handleDecision`: the `help_request` generate-and-deliver branch + the two bypasses), `service/pyris/job/StruggleInterventionJob.java` (already carries `intent`; ensure `help_request` flows through), `service/pyris/dto/struggle/PyrisStruggleInterventionPipelineExecutionDTO.java` (carries `intent` to Pyris), `web/IrisStruggleInterventionResource.java` (accept the new intent value).

## 8. Pyris (agent pipeline) design

**It is an agent, not a template.** `StruggleInterventionPipeline` (`iris/src/iris/pipeline/struggle_intervention_pipeline.py:156`) extends `AbstractAgentPipeline` — a LangChain tool-calling agent (`AgentExecutor`, `abstract_agent_pipeline.py:342`). It gathers context itself via tools (`get_problem_statement`, `get_build_logs_analysis`, `get_feedbacks`, `repository_files`, `file_lookup_with_line_numbers`, `local_vs_submitted_diff`). Iteration ceiling: LangChain default **`max_iterations = 15`** (not overridden; no time limit); typical run finishes in ~1 step. So "what the hint should be" is grounded in the real repo; the change here is to the agent's **decision policy in the system prompt**, keyed on the intent.

**The consented-follow-up branch** (`struggle_intervention_system_prompt.j2`): add a branch keyed on `intent == "help_request"` (an explicit, consented, capped request):
- **Relax:** the hint MAY be the *next concrete step on the same diagnosis* (not only an entirely different diagnosis). The strict "same-diagnosis → silent" rule is lifted for this branch.
- **Never-silent:** because the student explicitly asked and is waiting on a spinner, always return at least an honest next step (`action != "silent"`); if there is genuinely little to add without spoiling, give the smallest safe nudge or an honest "here's the one thing to check next", **never** an empty result.
- **Keep hard (never relaxed):** never the full/near-full solution; never a bare reword or mere re-anchoring of a prior hint that adds no new step; still confirm a failure in the CURRENT code before anchoring.
- **First contact unchanged:** for `intent == "decide"` (unsolicited first contact), the existing strict + silent-eligible behaviour and the `proactivity_mode` tone block (`:60-66`) apply as today.

**Hint content contract** (documented in the prompt; much already present):
1. One concrete step forward — never the whole solution.
2. Socratic: point at *where* to look / *what* to reconsider, not the fix.
3. Anchored to a `file:line` where applicable (existing `anchor`).
4. Progressive: each accepted hint one notch more concrete than the last, stopping short of the answer.
5. Bounded by the cap (Less 1 / More 3) so the chain cannot walk the student to the solution.

**Output unchanged** (`{action, message, confidence, anchor, inlineHint, rationale}` → snake_case status DTO → callback). Reads `intent` from `PyrisStruggleInterventionPipelineExecutionDTO` to pick the branch.

**Key Pyris files:** `iris/src/iris/pipeline/struggle_intervention_pipeline.py` (`build_system_message:217-234`), `iris/src/iris/pipeline/prompts/templates/struggle_intervention_system_prompt.j2`, the execution DTO where `intent` arrives.

## 9. The contract (wire)

The follow-up/first-contact distinction rides the **existing `intent` field** with **one new value** (`help_request`); no new field required. `help_request` is **both** a wire intent **and** a third **local** correlation `Intent` in the client `InFlightGuard` (§6) — the returning `active` is disambiguated from a first-contact `decide` by which intent's marker is live, which drives the Less-reroute bypass and the `appendFollowup` routing. `episode.isNew=false` and `episode.hints[]` still travel for Pyris context, but the server no longer needs to read `isNew` (the earlier A' blocker).

Client → Artemis (`POST api/iris/chat/exercises/{exerciseId}/struggle-intervention`) on **Show me / I need more help**:
```
struggleSignal, uncommittedFiles,
intent = "help_request",                                     // NEW value (was: decide | confirm_close)
episode = { episodeId, isNew=false, hints:[{level,text,atSessionS}, …] },
proactivityMode = "pull" | "push", requestToken
```
Artemis: `intent="help_request"` → generate via Pyris → **persist + push** `active` for `episodeId`, bypassing the pull cap and confidence gate (§7).
Artemis → Pyris (`PyrisStruggleInterventionPipelineExecutionDTO`): carries `intent`; Pyris picks the relaxed + never-silent branch (§8).
Client: append the returned `active` hint to the open delivered episode (`appendFollowup`, §6).
First contact and `intent="confirm_close"` are unchanged. **No new endpoint, no `revealAmbient` on the offer path.**

## 10. Data & outcome semantics
- **Offers:** ephemeral client-local UI (bubble/banner); no server round-trip, not persisted; re-raised by the detector after a webview reload.
- **Accepted hints:** generated on accept, persisted on the `active` push (`origin=PROACTIVE_STRUGGLE`, `proactiveEpisodeId`), rendered as bubbles, survive reload.
- **Nothing pre-generated / nothing held:** B+ has no un-revealed hint to lose — a declined/ignored offer never ran the agent.
- **Decision record:** the condensed grey line is client-rendered; no new server persistence for MVP (existing outcome tagging already trails prior proactive rows as `engaged/ignored/dismissed`).
- **Outcomes:** unchanged 3-value enum. "Not now" = client suppression. Moment-3 no-response → ABANDONED via the existing watchdog.
- **Caps:** client-side per episode (Less 1 / More 3 accepted hints), runtime-scoped (§4.4).

## 11. Open questions / risks
1. **Spinner acceptability (the core B+ UX bet).** Show me runs a ~14s agent; if that feels slow, uptake drops. Mitigation: spinner + honest copy; measure accept→delivery latency and abandon-during-spinner in the eval. If it hurts, re-open speculative pre-generation (the parked A' idea) as a later escalation.
2. **Never-silent vs spoiling.** The consented branch must always answer yet never spoil — "next concrete step on the same diagnosis" risks progressive spoon-feeding. Bounded by the cap + the hard "never the full solution / never a bare reword" rule. Needs manual eval of a few chains and a prompt iteration. This is the main content-policy thing to tune and to report in the thesis.
3. **Confidence-gate bypass safety.** `help_request` delivers even below the 0.6 confidence threshold (consent overrides caution). Risk: a low-confidence explicit-request hint is weaker. Accepted because the never-silent rule yields an honest best next step rather than silence; flag for review. Mitigations: **log** the confidence of accepted below-threshold hints (for the eval), and the prompt keeps a **tentative tone when uncertain**. Defensive edge: if Pyris returns empty despite the never-silent rule, the client shows a brief "nothing more I can add right now" and does not consume a cap slot (§6.5).
4. **Cross-surface consistency.** Banner vs chat answer must resolve the same offer (shared `episodeId` + per-offer `offerId`, first-action-wins). Verify the generalised `handleBannerAction` routes `accept` to the generate path, `decline`/`timeout` per the §6 table.
5. **The `appendFollowup` transition.** Delivering a consented follow-up into an already-DELIVERED episode is a new slot transition, not reuse of `escalate` (which is `hardEvent`-gated) or the parked path. Confirm it composes with the in-flight guard, the outcome tagging, and the fold.
6. **Runtime-scoped caps.** A webview reload resets the per-episode count, so a determined student could get more hints than the cap across reloads. Acceptable for the MVP; documented. Move server-side (count `PROACTIVE_STRUGGLE` rows per episode) only if evaluation integrity demands it.

## 12. Testing (per layer)
- **Client:** vitest for the offer marker rendering (bubble + banner) and the generalised nudge contract (`moment` × `action` table, §6); the level-routing table (§4.2); the cap counter (+ Moment-3 exhausted override); the condensed decision line; the Moment-3 60s window + deadline-defer + fold. Logic tests under `test/logic/struggleIntervention/**`: the delivered-slot offer trigger fires an offer (not a POST); **Show me** POSTs `intent="help_request"` and `appendFollowup` appends to the open episode; **Not now**/ignore POST nothing; the in-flight guard blocks a second offer/POST during the run.
- **Artemis:** unit test that `intent="help_request"` generates + persists + pushes `active` for the episode, bypassing the pull cap (delivers a bubble in `pull`) and the confidence gate (delivers below 0.6); that `intent="decide"` first-contact behaviour (threshold, pull cap, silent) is unchanged; that an empty Pyris result still emits a completion frame.
- **Pyris:** pipeline test that `intent="help_request"` on a same-diagnosis episode returns a non-silent *next-step* hint (vs strict silent) and never a full-solution string; that `intent="decide"` first-contact stays strict + silent-eligible.

## 13. Sequencing
1. **Pyris:** the `intent="help_request"` relaxed + never-silent prompt branch + content contract (own PR/plan, edutelligence repo).
2. **Artemis:** the `help_request` generate-and-deliver branch in `handleDecision` (+ pull-cap and confidence-gate bypass; accept the new intent value) (own PR/plan, Artemis repo).
3. **Client:** offer trigger (Moment 1 delivered-slot hook + Moment 3 watchdog), the generalised nudge contract, the `help_request` local `Intent` + POST + `onServerActive` bypass + `appendFollowup`, caps + history.

**Rollout order is load-bearing, not optional.** There is **no cross-version fallback**: old Pyris rejects an unknown `intent` at the execution-DTO layer (`struggle_intervention_pipeline_execution_dto.py:32`) and the template switch only knows `decide`/`confirm_close` (`struggle_intervention_pipeline.py:224`); the client `Intent` union is likewise closed. So the client must ship **last**. If a new client ever reaches an old backend, an accepted offer does **not** "behave as today" — the `help_request` POST fails/returns silent, the in-flight marker clears, and the offer shows the §6.5 "nothing more I can add right now" state (a dead-end for that click, not a silent no-op). A capability/version gate (client checks backend support before enabling offers) is the more robust long-term option but is **out of scope for v1**; the thesis controls all three deploys, so ordered rollout suffices.

Each repo gets its own implementation plan; this spec is the shared contract.
