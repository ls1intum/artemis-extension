# Proactivity Less/More (Pull vs Push) — Design Spec

**Date:** 2026-07-07
**Status:** Design, awaiting Liam's final review (author drafted the open decisions autonomously; see §14)
**Scope:** Client (artemis-extension) + Server (Artemis + Pyris). One coherent feature.

## 1. Goal

Turn the shipped Off / Less / More slider (currently UI-only, mapped onto a binary on/off) into a
real three-state proactivity control, and remove the hidden dismiss backoff. Less and More express
**how present Iris is**, on one monotone axis, without touching the paper-validated detector.

## 2. Background: current state

- **Detector (v3 engine).** Fires a struggle-intervention request on a boundary with `urgency = sBase >= theta`.
  `theta = 0.7`, `COOLDOWN_S = REALERT_S = 120`, warmup 480s, gates B2/B4/D1 all live in frozen `SPEC`,
  provenance `[D]` (study-derived) / `[L]`. These are golden and MUST NOT change per level.
- **Server "Iris" (Artemis + Pyris).** Pyris' StruggleInterventionPipeline returns
  `action ∈ {silent, ambient, active}` + `confidence` + hint/anchor. Artemis gates on
  `artemis.iris.proactive.struggle.confidence-threshold` (default 0.6; below => fail-closed to silent)
  and emits `StruggleInterventionEventDTO`.
- **Client surface mapping.** ambient => status-bar lamp (+ optional gutter cue, PULL: click reveals);
  active => banner + chat bubble + badge + notification (PUSH).
- **Preference.** `ProactivePreferenceService`: per-exercise boolean, default on, VS Code globalState,
  scoped by server+principal. Only gates whether proactivity runs at all.
- **Hidden dismiss backoff (spec §5.2, to be removed).** In `StruggleInterventionService`:
  `_annoyance`, `_dismissStrikes`, `_softSkipBudget`. A dismiss does `strikes+1`, `annoyance+2`;
  `annoyance >= softThreshold(3)` owes escalating soft-skips; `dismissStrikes >= pauseStrikes(5)`
  hard-pauses proactivity for the exercise (the "Paused after dismissing recent hints" + Resume UI).
  A click/engagement resets all three.
- **Delivery throttle (`TUNING`, ENG, keep).** `maxAlertsPerMinute 2`, `maxAlertsPerSession 6`,
  `minDeliveryGapS 30`. Delivery-only; `minDeliveryGapS` is deliberately independent of the SPEC cooldown.

## 3. The construct: Off / Less (Pull) / More (Push)

One monotone "Iris presence" axis. The detector fires identically in every level; the level only
changes **whether Iris may push and how often it may surface**.

- **Off** — proactivity disabled for this exercise. Durable per-exercise kill switch (kept).
- **Less = Pull** — Iris may only surface quietly: status-bar lamp (+ gutter cue). No banner, no
  interruption. Rarer (stricter throttle). The student pulls help when they want it.
- **More = Push** — Iris may reach out actively: banner + chat bubble + notification. More often
  (the throttle of record). This is today's behaviour.

This bundles two correlated manipulations (delivery mode + rate) into **one construct** ("reticent
pull" vs "eager push"). For evaluation this is a single presence factor, not two isolated knobs; we
do not claim to separate the frequency effect from the delivery effect.

## 4. Where the level acts (three layers, defence in depth)

| Layer | What it does | Level's effect | Where |
|---|---|---|---|
| 1. Detector | decides WHEN to request | **unchanged** (theta 0.7 fixed) | client engine (untouched) |
| 2. Iris (server) | picks action + confidence, writes hint | **hard rule**: in Pull, `active` is forced to `ambient`, deterministically, in Artemis (not left to the LLM). Level also passed to Pyris as prompt context for tone. | Artemis `handleDecision` + Pyris pipeline |
| 3. Client surface + throttle | maps action to surface; rate-limits delivery | **surface cap** (Pull caps a stray `active` to ambient, defence in depth) + **per-level throttle** | client |

Rationale: the validated detector stays fixed (thesis-clean); the level varies only Iris' intervention
willingness (server) and how often/loud it is shown (client). The hard Pull guarantee is enforced
deterministically in Artemis because LLMs do not reliably honour prompt constraints; the Pyris prompt
only shapes tone.

## 5. Parameters per level

**Delivery mode (server-enforced, client-capped):**

| Level | Allowed action |
|---|---|
| Off | none (proactivity disabled) |
| Less (Pull) | silent, ambient |
| More (Push) | silent, ambient, active |

**Client throttle (`TUNING`, ENG, per level):**

| Parameter | Less | More | today |
|---|---|---|---|
| max alerts / exercise (`maxAlertsPerSession`) | 3 | 6 | 6 |
| min gap between deliveries (`minDeliveryGapS`) | 300s | 150s | 30s |
| max alerts / minute (`maxAlertsPerMinute`) | removed | removed | 2 |

Notes:
- Both gaps are **above** the SPEC `COOLDOWN_S = 120`, so they actually bite. Anything ≤ 120s is
  dominated by the cooldown and does nothing (that is why today's 30s is inert).
- `maxAlertsPerMinute` is **removed**: at a 150s+ gap it is never reachable, so it is a dead knob.
  The gap plus the per-exercise cap fully govern rate.
- `confidence-threshold` stays **global** (0.6), not per level — it is a fail-closed `silent` gate,
  not an active-vs-ambient selector, so it is the wrong lever for the level.
- All throttle values are ENG (no study). More = today's tested behaviour; Less = a deliberate,
  documented tightening on top.

## 6. Default level and Off (decisions — see §14)

- **Default = More.** It equals today's behaviour (on = active allowed), so existing installs
  (~940) see no silent regression, and evaluation participants experience full proactivity. Anyone
  who finds it too much drops to Less or Off. Ethical guard remains the consent gate
  (`proactiveStruggleEnabled` default false per course) + the manual control. One-line constant,
  trivially reversible to Less if Liam prefers the gentler default.
- **Off stays** as the durable per-exercise opt-out.
- **Level is stored per exercise** (server+principal scoped), reusing the existing preference model.

## 7. Hidden dismiss backoff removal

Remove the cumulative dismiss memory:
- Orchestrator (`StruggleInterventionService`): drop `_annoyance`, `_dismissStrikes`,
  `_softSkipBudget`, the `recordOutcome` escalation, `isPaused()`/`isProactivePaused()`, and the
  soft-skip owe.
- `BackoffGate`: **keep the gate**, but keep only its **pre-throttle `shouldSuppress`** job (course-off /
  student-opt-out / evidence-gate / delivered-slot). Drop the `isPaused` and `tryConsumeSoftSkip`
  branches. Suppression must stay ABOVE the throttle so guaranteed-suppressed alerts do not burn the
  rate budget.
- Config: drop `TUNING.softThreshold`, `TUNING.pauseStrikes`.
- UI: remove the "Paused after dismissing recent hints" + Resume affordance, `autoPaused` from the
  card VM and `UpdateProactiveControl`, the `resumeProactive` command, and `ResumeProactive` handler.
- Debug snapshot: drop the `suppression.{dismissStrikes,pauseStrikes,hardPaused,annoyance,softThreshold,softSkipBudget}` fields.
- Keep the base rate throttle — it is burst protection, not dismiss memory.

## 8. Dismiss semantics after removal

A single dismiss now means only: **close/fold this episode and persist its outcome as `DISMISSED`**.
It does NOT alter future alert rate or the level, and it never auto-pauses. Click/dismiss may still be
logged for telemetry, but not remembered behaviourally. This is the user's explicit "no hidden dismiss".

## 9. Data model & contracts

- **Level type:** `ProactiveLevel = 'off' | 'less' | 'more'` (already exists in the webview UI).
- **Preference storage:** `ProactivePreferenceService` moves from `Record<number, false>` to a
  per-exercise level (default `more`; store only deviations to keep the map small). Same scope key.
- **Webview → extension:** replace `setProactiveEnabled { enabled: boolean }` with
  `setProactiveLevel { exerciseId, level, courseId }`. Remove `resumeProactive`.
- **Extension → webview:** `UpdateProactiveControl` carries `level: ProactiveLevel` instead of
  `preference: 'on'|'off'`; `autoPaused` removed. `cardState`/`cardReason` unchanged.
- **Card VM:** already level-based (`AskIris`), minus `autoPaused`/resume.

## 10. Server changes (Artemis + Pyris)

- **Request:** `IrisStruggleInterventionRequestDTO` gains a `proactivityMode: 'pull' | 'push'` field
  (Off never reaches the server — the client does not POST when Off). Client derives mode from the level.
- **Artemis `handleDecision`:** if `mode = pull` and `action = active`, force `action = ambient`
  (deterministic hard guarantee), alongside the existing confidence-threshold check. Emit the event
  as usual.
- **Pyris StruggleInterventionPipeline:** receive the mode; add it to the prompt as tone context
  (pull = reticent, quiet nudge; push = may reach out directly). The pipeline may bias toward ambient
  in pull, but correctness does not depend on it — Artemis enforces the hard rule.
- Wire format stays snake_case on the Pyris boundary (existing convention).

Cost/egress note: LLM call + code egress are the **same** in Less and More (the request still fires and
Iris still generates). True per-level cost savings would need lazy generation (out of scope, §13).

## 11. Client cap (defence in depth)

Independent of the server, when level = Less the client surface mapping caps a received `active` down to
`ambient` (lamp), so a banner can never appear in Pull even if the server rule regresses. Layer-3 backstop.

## 12. Consent / egress

Unchanged. The level only takes effect when the course (`proactiveStruggleEnabled`) and the user's LLM
opt-in are already open; otherwise nothing runs. `.noai` egress protection is engine-side and untouched.
Less and More have identical consent/egress footprints.

## 13. Non-goals / out of scope

- Touching the detector (theta, cooldown, warmup, gates) — thesis-forbidden dilution. **No Option C.**
- Per-level `confidence-threshold` — wrong lever (§5).
- Lazy hint generation (content-free lamp, generate on click) to cut LLM cost in Less — separate future item.
- Adaptive auto-downgrade on dismiss (More→Less→Off) — explicitly dropped with the hidden backoff.
- Any change to the Test-Stagnation add-on path beyond it sharing the same (kept) throttle.

## 14. Decisions made autonomously (for Liam's review)

Liam was away; these were drafted with defaults, all trivially reversible:
1. **Default level = More** (§6). Alternative: Less (gentler). Flip = one constant.
2. **Off retained** as the third slider state / kill switch (§6).
3. **Tone via Pyris prompt, hard guarantee deterministic in Artemis** (§4, §10) — not left to the LLM.
4. **Throttle: Less 300s/3, More 150s/6, drop max/min** (§5), per Liam's "both yes".
5. **Level persisted per exercise** (§6), reusing the existing preference scope.

## 15. Testing strategy

- **Client logic (vitest):** preference service level round-trip + default; throttle honours per-level
  gap/cap; surface cap forces active→ambient in Pull; contract mapping `level` in/out; removal of
  backoff (no pause state, no soft-skip); dismiss persists `DISMISSED` without touching rate/level.
- **Card (vitest):** slider drives `setProactiveLevel`; no Resume/paused affordance remains.
- **Server:** Artemis `handleDecision` pull-downgrade unit test; request DTO carries the mode; Pyris
  pipeline accepts the mode (smoke). Server work verified in its own repos.
- Full `npm run test:react` green; `check-types` + lint clean.

## 16. Open risks

- Server changes span two external repos (Artemis, Pyris); exact file/line targets verified at
  implementation time in those repos.
- Migrating persisted `Record<number, false>` preferences to the level map needs a read-time upgrade
  (existing `false` => `off`; absent => `more`).
- Removing `autoPaused`/resume touches the card, contracts, telemetry seam, debug snapshot, and the
  chat-provider dismiss hook — a wider surface than the orchestrator alone.
