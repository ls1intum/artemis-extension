# Proactive Help Offers (B+) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unsolicited follow-up hint delivery with a consented "offer another hint" flow at two moments (still-stuck and about-to-abandon), where the follow-up hint is generated only when the student accepts.

**Architecture:** Cross-stack, three repos, deployed in strict order Pyris → Artemis → Client. A new intent value `help_request` (a consented follow-up) rides the existing `intent` field. Pyris relaxes its anti-repeat rule and forbids silence for that intent; Artemis generates+persists+pushes it as an `active` bubble bypassing the pull cap and confidence gate; the client raises a client-local offer where the delivered-slot alert is skipped today, POSTs `help_request` only on accept, and appends the returned hint to the open episode via a new slot transition.

**Tech Stack:** Pyris = Python 3.13 / Poetry / pytest / Jinja2. Artemis = Java / Spring / JUnit5 + Mockito / Gradle. Client = TypeScript / VS Code extension / React webview / Vitest.

**Task count:** 13 tasks — A1, A2 (Pyris), B1 (Artemis), C1–C10 (Client). Execute in order; the client phase ships last. Every task is independently `check-types`-green (no forward references).

## Global Constraints

- **Rollout order is load-bearing:** Pyris ships first, then Artemis, then Client. There is NO cross-version fallback — old Pyris/Artemis do not know `help_request`. Merge phases in this order.
- **`help_request` is both a wire intent AND a third local client `Intent`** (`'decide' | 'confirm_close' | 'help_request'`).
- **Caps (client, per episode, accepted offers only):** Off = 0, Less = 1, More = 3. The initial episode-opening hint is NOT counted.
- **Moment-3 "I need more help" delivers even if the cap is exhausted** (abandon-risk exception).
- **Both bypasses are required for delivery:** the Artemis pull `active → ambient` cap bypass AND the client `level === 'less'` reroute bypass in `onServerActive`. Either alone swallows the hint.
- **Pyris hard guardrails never relax:** never the full/near-full solution; never a bare reword/re-anchor; confirm a failure in the CURRENT code before anchoring. The `help_request` branch relaxes ONLY the same-diagnosis→silent rule and adds never-silent.
- **Offer timing reuses existing ENG values, no new knob:** detector `COOLDOWN_S=120`, delivery throttle `THROTTLE_BY_LEVEL` (More 150s / Less 300s). Held constant as an engineering control.
- **Copy is English.** Moment-1 bubble "Still stuck, or want another hint?" / buttons "Show me", "Not now". Moment-1 banner title "Still stuck here?", sub "Want another hint?". Moment-3 "Still on this?" / "I'll step back soon otherwise." / buttons "I'm still on it", "I need more help". Empty edge: "Nothing more I can add right now." Condensed lines: "Offered another hint · You: Show me", "Offered another hint · You: Not now", "Offered a hand · no response".
- **Moment-3 window:** 60s before the idle-abandon deadline (`warnLeadMs = 60_000`, `idleAbandonMs = 600_000`). Showing the offer pins the remaining time to 60s.
- **Only one offer is outstanding at a time, and only for the live delivered episode.** All four answer handlers guard on `_outstandingOffer.offerId === offerId` AND `episodeId === _deliveredEpisodeId()`, clear `_outstandingOffer`, and emit `resolveOfferBubble(offerId, answered)` so the webview collapses the bubble (the chat UI mutates ONLY on host messages, never on the button click itself). No offer is raised while a `help_request` is in flight or an offer is already outstanding.
- **No AI/Claude attribution in any commit message.** Plain conventional commits.
- **Client dep pinning:** no new npm dependencies; no caret/tilde edits to `package.json`.

---

# PHASE A — Pyris (edutelligence/iris) — SHIP FIRST

Repo: `/Users/liamberger/Documents/private/edutelligence/iris` (branch `feat/struggle-intervention-pipeline`). pytest from repo root.

### Task A1: Accept `help_request` on the execution DTO

**Files:**
- Modify: `src/iris/domain/struggle/struggle_intervention_pipeline_execution_dto.py:32`
- Test: `tests/test_struggle_execution_dto.py`

**Interfaces:**
- Produces: `StruggleInterventionPipelineExecutionDTO.intent` now accepts the literal `"help_request"` (default stays `"decide"`).

- [ ] **Step 1: Write the failing test** — append to `tests/test_struggle_execution_dto.py`:

```python
def test_execution_dto_accepts_help_request_intent():
    dto = StruggleInterventionPipelineExecutionDTO.model_validate(
        {
            "struggleSignal": _minimal_signal_dict(),
            "intent": "help_request",
        }
    )
    assert dto.intent == "help_request"
```

If `_minimal_signal_dict` does not exist, reuse the exact `struggleSignal` payload from `test_execution_dto_parses_intent_and_episode_camelcase` (lines 52-70), copied inline.

- [ ] **Step 2: Run to verify it fails**

Run: `poetry run pytest tests/test_struggle_execution_dto.py::test_execution_dto_accepts_help_request_intent -q`
Expected: FAIL — pydantic `ValidationError` (`Input should be 'decide' or 'confirm_close'`).

- [ ] **Step 3: Implement** — edit line 32:

```python
    intent: Literal["decide", "confirm_close", "help_request"] = "decide"
```

- [ ] **Step 4: Run to verify it passes**

Run: `poetry run pytest tests/test_struggle_execution_dto.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/iris/domain/struggle/struggle_intervention_pipeline_execution_dto.py tests/test_struggle_execution_dto.py
git commit -m "feat(struggle): accept help_request intent on the execution DTO"
```

---

### Task A2: The `help_request` system prompt + pipeline wiring

**Files:**
- Create: `src/iris/pipeline/prompts/templates/struggle_help_request_system_prompt.j2`
- Modify: `src/iris/pipeline/struggle_intervention_pipeline.py` (`__init__` ~178-183; `build_system_message` dict ~225-228)
- Test: `tests/test_struggle_intervention_pipeline.py`, `tests/test_struggle_route.py`

**Interfaces:**
- Consumes: A1's `help_request` literal.
- Produces: `StruggleInterventionPipeline().help_request_template`; `build_system_message` returns the help-request prompt when `state.dto.intent == "help_request"`.

Notes: the prompt relaxes the same-diagnosis→silent rule (license the next concrete step) and is NEVER silent, but keeps every hard guardrail. `parse_gate_result` (`struggle_intervention_pipeline.py:71-110`) is UNCHANGED and fail-safes noncompliant output to `silent`; that edge is handled downstream (Artemis silent frame + client Task C4). Do NOT edit `parse_gate_result`.

- [ ] **Step 1: Write the failing test** — append to `tests/test_struggle_intervention_pipeline.py`:

```python
def test_help_request_prompt_relaxes_repeat_but_keeps_hard_guardrails():
    pipeline = StruggleInterventionPipeline()
    episode = EpisodeDTO(
        episodeId="ep-1",
        isNew=False,
        hints=[EpisodeHintDTO(level="active", text="Look at the loop bound", atSessionS=490.0)],
    )
    rendered = pipeline.help_request_template.render(
        course_name="Algorithms",
        signal_summary="primary boundary: STATE; severity s=1.00.",
        episode=episode,
    )
    assert "asked" in rendered.lower()
    assert "never" in rendered.lower() and "silent" in rendered.lower()
    assert "next" in rendered.lower() and "step" in rendered.lower()
    assert "solution" in rendered.lower()
    assert "reword" in rendered.lower()
    assert "Look at the loop bound" in rendered


def test_build_system_message_selects_help_request_template():
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    pipeline = StruggleInterventionPipeline()
    state = SimpleNamespace(
        dto=SimpleNamespace(
            intent="help_request",
            course=SimpleNamespace(name="Algorithms"),
            struggle_signal=_minimal_signal(),
            episode=None,
            proactivity_mode="push",
        ),
        callback=MagicMock(),
    )
    msg = pipeline.build_system_message(state)
    assert "never" in msg.lower()
    assert msg != pipeline.system_prompt_template.render(
        course_name="Algorithms",
        signal_summary=summarize_signal(_minimal_signal()),
        episode=None,
        proactivity_mode="push",
    )
```

Use the file's existing `_minimal_signal()` helper (imports already pull `summarize_signal`).

- [ ] **Step 2: Run to verify it fails**

Run: `poetry run pytest tests/test_struggle_intervention_pipeline.py -k help_request -q`
Expected: FAIL — `AttributeError: ... 'help_request_template'`.

- [ ] **Step 3: Author the template** — create `src/iris/pipeline/prompts/templates/struggle_help_request_system_prompt.j2`:

```jinja
{# struggle_help_request_system_prompt.j2 — consented follow-up (intent=help_request) #}
You are Iris, a programming tutor for the course "{{ course_name }}". The student is stuck and
has EXPLICITLY asked for another hint (they clicked "Show me" / "I need more help"). This is a
consented, invited request — not an unsolicited check.

Detected signal:
{{ signal_summary }}

You have tools to read the student's current code, the build logs, the test feedback, and the
problem statement. The recent chat history is provided.
{% if episode and episode.hints %}

Hints ALREADY delivered to the student in this intervention episode (the latest is still visible):
{% for hint in episode.hints %}
- [{{ hint.level }}, t={{ hint.at_session_s | int }}s] {{ hint.text }}
{% endfor %}
{% endif %}

BECAUSE THE STUDENT ASKED, you must give them the NEXT concrete step. Unlike the unsolicited check,
the same-diagnosis rule is RELAXED here: it is fine — expected — to advance the SAME diagnosis one
step further than the hints above. Move them forward.

NEVER SILENT: the student invited this, so you MUST return a usable hint. Set "action" to "ambient"
or "active" and always provide a non-null "message". Do NOT return "silent". If you are unsure, give
the single smallest honest next thing to check, tentatively — but give something.

HARD GUARDRAILS (these NEVER relax, not even for a consented request):
- NEVER give the full or near-full solution, and NEVER write the code for them.
- NEVER a bare reword or mere re-anchoring of a prior hint that adds no new step — each offered hint
  must be one notch MORE concrete than the last, and stop short of the answer.
- Before you point at any build/compile error, OPEN that exact file and line in the CURRENT code
  (file_lookup) and confirm the problem is STILL there; if the current code no longer shows it, help
  with what the CURRENT code actually shows instead.

Respond with ONLY a JSON object, no prose around it:
{"action": "ambient" | "active",
 "message": "<one short Socratic next-step hint, never null>",
 "confidence": <0.0-1.0>,
 "anchor": {"file": "<repo-relative path>", "line": <1-based line>} | null,
 "inlineHint": "<<=60-char non-spoiler cue for that line, or null>",
 "rationale": "<one sentence, why; for logging>"}

Set `anchor`+`inlineHint` whenever a single concrete line is the locus (REQUIRED then, not optional).
The precise location (repo-relative file + 1-based line) MUST go in the structured `anchor`. NEVER let
a concrete file/line live only inside `message`. `inlineHint` is a terse <=60-char cue, NOT a
truncation of `message`, and must not spoil.

The `file_lookup` tool returns the file with 1-based line-number prefixes (`NN| <code>`); take
`anchor.line` from those prefixes, never by counting lines yourself.
```

- [ ] **Step 4: Wire the template** — in `struggle_intervention_pipeline.py` `__init__`, after the `confirm_close_template` load (~181-183):

```python
        self.help_request_template = self.jinja_env.get_template(
            "struggle_help_request_system_prompt.j2"
        )
```

In `build_system_message`, extend the dispatch dict (~225-228):

```python
        tmpl = {
            "decide": self.system_prompt_template,
            "confirm_close": self.confirm_close_template,
            "help_request": self.help_request_template,
        }[intent]
```

- [ ] **Step 5: Run to verify it passes**

Run: `poetry run pytest tests/test_struggle_intervention_pipeline.py -q`
Expected: PASS.

- [ ] **Step 6: Route smoke test** — append to `tests/test_struggle_route.py` a test mirroring `test_confirm_close_intent_routes_without_422` (55-103) with `"intent": "help_request"`, asserting accepted (not 422). Run `poetry run pytest tests/test_struggle_route.py -q`; Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/iris/pipeline/prompts/templates/struggle_help_request_system_prompt.j2 src/iris/pipeline/struggle_intervention_pipeline.py tests/test_struggle_intervention_pipeline.py tests/test_struggle_route.py
git commit -m "feat(struggle): add consented help_request prompt branch (relaxed repeat, never silent)"
```

---

# PHASE B — Artemis — SHIP SECOND

Repo: `/Users/liamberger/Documents/private/Artemis` (branch `feature/iris/struggle-intervention-pipeline`). Gradle from repo root.

### Task B1: Generate-and-deliver a `help_request` decision

**Files:**
- Modify: `src/main/java/de/tum/cit/aet/artemis/iris/service/session/IrisStruggleInterventionService.java` (`handleDecision`, gate lines 241-247)
- Test: `src/test/java/de/tum/cit/aet/artemis/iris/struggle/IrisStruggleInterventionDecisionTest.java`

**Interfaces:**
- Consumes: `StruggleInterventionJob.intent()` (carries `"help_request"` end to end — request DTO forwards `intent` unchecked; `PyrisJobService` stamps it; `PyrisStatusUpdateService.handleStatusUpdate` routes any non-`confirm_close` intent with a non-null action into `handleDecision`).
- Produces: for `intent="help_request"`, a persisted `active` message + `active` event, delivered regardless of confidence and regardless of `proactivityMode="pull"`. A `silent` action from Pyris still emits a silent completion frame.

- [ ] **Step 1: Write the failing tests** — append to `IrisStruggleInterventionDecisionTest.java`. Job fixture near lines 106-113:

```java
    // consented follow-up: must deliver an active bubble even below threshold and even in pull
    private final StruggleInterventionJob helpRequestPullJob = new StruggleInterventionJob("th", 7L, 42L, 3L, "help_request", "ep-hr", null, null, "pull");
```

```java
    @Test
    void helpRequest_belowThreshold_stillPersistsAndPushesActive() {
        var session = exerciseSession(42L);
        when(irisChatSessionService.getCurrentSessionOrCreateIfNotExists(eq(IrisChatMode.PROGRAMMING_EXERCISE_CHAT), eq(42L), any())).thenReturn(session);
        when(irisMessageService.saveMessage(any(), eq(session), eq(IrisMessageSender.LLM))).thenAnswer(inv -> {
            IrisMessage m = inv.getArgument(0);
            m.setId(556L);
            return m;
        });
        var update = new PyrisStruggleInterventionStatusUpdateDTO("Try the empty-list case.", "active", 0.3, "FM", List.of(), List.of(), null, null, null, null, null, null);
        service.handleDecision(helpRequestPullJob, update);
        verify(irisMessageService).saveMessage(argThat(m -> m.getOrigin() == IrisMessageOrigin.PROACTIVE_STRUGGLE), eq(session), eq(IrisMessageSender.LLM));
        verify(irisChatWebsocketService).sendMessage(eq(session), any(), any());
        verify(irisChatWebsocketService).sendStruggleEvent(any(), argThat(e -> "active".equals(e.action()) && Objects.equals(e.messageId(), 556L)));
    }

    @Test
    void helpRequest_ambientAction_isCoercedToActiveBubble() {
        var session = exerciseSession(42L);
        when(irisChatSessionService.getCurrentSessionOrCreateIfNotExists(eq(IrisChatMode.PROGRAMMING_EXERCISE_CHAT), eq(42L), any())).thenReturn(session);
        when(irisMessageService.saveMessage(any(), eq(session), eq(IrisMessageSender.LLM))).thenAnswer(inv -> {
            IrisMessage m = inv.getArgument(0);
            m.setId(557L);
            return m;
        });
        var update = new PyrisStruggleInterventionStatusUpdateDTO("One notch further.", "ambient", 0.9, "FM", List.of(), List.of(), null, null, null, null, null, null);
        service.handleDecision(helpRequestPullJob, update);
        verify(irisMessageService).saveMessage(any(), eq(session), eq(IrisMessageSender.LLM));
        verify(irisChatWebsocketService).sendStruggleEvent(any(), argThat(e -> "active".equals(e.action())));
    }

    @Test
    void helpRequest_silentFromPyris_staysSilent() {
        var update = new PyrisStruggleInterventionStatusUpdateDTO("", "silent", 0.9, "FM", List.of(), List.of(), null, null, null, null, null, null);
        service.handleDecision(helpRequestPullJob, update);
        verify(irisMessageService, never()).saveMessage(any(), any(), any());
        verify(irisChatWebsocketService).sendStruggleEvent(any(), argThat(e -> "silent".equals(e.action())));
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `./gradlew test --tests "de.tum.cit.aet.artemis.iris.struggle.IrisStruggleInterventionDecisionTest"`
Expected: the first two FAIL; the third PASSES already.

- [ ] **Step 3: Implement** — replace the gate block (lines 241-247):

```java
        boolean helpRequest = "help_request".equals(job.intent());
        boolean belowThreshold = confidence == null || confidence < confidenceThreshold;   // fail-closed on null
        // A consented help_request bypasses the confidence gate (an invited hint must reach the student);
        // an unsolicited decide still downgrades below threshold.
        boolean forceSilent = "silent".equals(action) || (belowThreshold && !helpRequest);
        String finalAction = forceSilent ? "silent" : action;
        // Pull (Less): unsolicited active is capped to ambient. A consented help_request is exempt.
        if ("pull".equals(job.proactivityMode()) && "active".equals(finalAction) && !helpRequest) {
            finalAction = "ambient";
        }
        // A consented, non-silent help_request is always delivered as a persisted bubble, even if Pyris
        // returned "ambient" (the student explicitly asked; no quiet-park semantics on this path).
        if (helpRequest && !"silent".equals(finalAction)) {
            finalAction = "active";
        }
        if (helpRequest && belowThreshold) {
            log.info("help_request delivering below-threshold hint exercise={} user={} confidence={}", job.exerciseId(), job.userId(), confidence);
        }
```

(Leave the rest of `handleDecision` unchanged.)

- [ ] **Step 4: Run to verify they pass**

Run: `./gradlew test --tests "de.tum.cit.aet.artemis.iris.struggle.IrisStruggleInterventionDecisionTest"`
Expected: PASS (all, including the pre-existing `decide` gate/cap tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/java/de/tum/cit/aet/artemis/iris/service/session/IrisStruggleInterventionService.java src/test/java/de/tum/cit/aet/artemis/iris/struggle/IrisStruggleInterventionDecisionTest.java
git commit -m "feat(iris): deliver consented help_request hints past the pull cap and confidence gate"
```

---

# PHASE C — Client (artemis-extension) — SHIP LAST

Repo: `/Users/liamberger/Documents/private/MA/artemis-extension`. Vitest from `extension/`. Logic (`test/logic/**`) and React (`test/react/**`) tests both run under vitest, no `compile-tests` needed. After each task: `npm run check-types`.

Verified locations: logic under `extension/test/logic/struggleIntervention/` (watchdog at `.../slot/staleWatchdog.test.ts`); store tests at `extension/test/react/stores/useChatStore.test.ts`; `NudgeBanner` test at `extension/test/react/components/NudgeBanner.test.tsx`; `MessageBubble`/`EpisodeTimeline` tests under `extension/test/react/views/IrisChat/components/`. Host→webview messages are applied by the manual switch in `extension/src/webview/views/IrisChat/IrisChatView.tsx` (the `AddMessage` map ~95, switch through ~203), NOT by a store reducer directly.

### Task C1: The third local `Intent` + `_acceptHelpRequest`

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/slot/guard.ts:8`
- Modify: `extension/src/extension/services/struggleIntervention/struggleContract.ts:34`
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` (`InFlightMarker.intent` ~39; add `_acceptHelpRequest` after `_acceptDecide` ~1121)
- Modify: `extension/src/shared/messageContracts/extensionMessages.ts:154` (`SlotInFlightDebug.intent`)
- Create: `extension/test/logic/struggleIntervention/helpers.ts` (shared `fakeDeps` + `simulateDelivered`)
- Modify: `extension/test/logic/struggleIntervention/C8-dismissEpisode.test.ts` (import helpers)
- Test: `extension/test/logic/struggleIntervention/helpRequest-accept.test.ts` (new)

**Interfaces:**
- Produces: `Intent` = `'decide' | 'confirm_close' | 'help_request'`; `_acceptHelpRequest(): PendingStamp | null` declared WITHOUT `private` (test-visible, like `_slot`/`_guard`/`_inFlightMarker`), mirrors `_acceptDecide`.
- Shared test helpers `fakeDeps(over?)` and `simulateDelivered(svc, episodeId)` (seeds `_lastSignal`).

- [ ] **Step 1: Extract shared helpers** — create `extension/test/logic/struggleIntervention/helpers.ts` with `fakeDeps` (copy verbatim from `C8-dismissEpisode.test.ts` lines 11-53) and `simulateDelivered` (lines 55-65), both exported. Add to `simulateDelivered`, after it drives delivery: `svc._lastSignal = {} as never;` (the signal is only forwarded to a mocked `postIntervention`). Update `C8-dismissEpisode.test.ts` to `import { fakeDeps, simulateDelivered } from './helpers';` and delete its local copies.

- [ ] **Step 2: Write the failing test** — create `extension/test/logic/struggleIntervention/helpRequest-accept.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import type { PendingStamp } from '@extension/services/struggleIntervention/slot/guard';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';
import { fakeDeps } from './helpers';

describe('help_request local intent', () => {
    it('_acceptHelpRequest returns the stamp and clears the marker on a matching reply', () => {
        const svc = new StruggleInterventionService(fakeDeps());
        const gen = svc._slot.generation();
        const stamp: PendingStamp = { episodeId: 'ep-1', generation: gen, hardEvent: false, requestToken: 'tok' };
        const localToken = svc._guard.issue('help_request', stamp);
        svc._inFlightMarker = { requestToken: 'tok', episodeId: 'ep-1', generation: gen, intent: 'help_request', localToken };

        expect(svc._acceptHelpRequest()).not.toBeNull();
        expect(svc._inFlightMarker).toBeUndefined();
    });

    it('_acceptHelpRequest returns null when the marker is a decide', () => {
        const svc = new StruggleInterventionService(fakeDeps());
        const gen = svc._slot.generation();
        const stamp: PendingStamp = { episodeId: 'ep-1', generation: gen, hardEvent: false, requestToken: 'tok' };
        const localToken = svc._guard.issue('decide', stamp);
        svc._inFlightMarker = { requestToken: 'tok', episodeId: 'ep-1', generation: gen, intent: 'decide', localToken };
        expect(svc._acceptHelpRequest()).toBeNull();
    });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/logic/struggleIntervention/helpRequest-accept.test.ts`
Expected: FAIL — `issue('help_request', ...)` is a type error; `_acceptHelpRequest` missing.

- [ ] **Step 4: Implement**

`guard.ts:8`, `struggleContract.ts:34`, `InFlightMarker.intent` (~39), `extensionMessages.ts:154`:
```typescript
'decide' | 'confirm_close' | 'help_request'
```

Add after `_acceptDecide` (~1121), WITHOUT `private`:
```typescript
    /**
     * Validate an inbound help_request reply against the current in-flight marker + slot generation.
     * Returns the PendingStamp on match, null on stale/no-marker; clears the marker.
     * Package-internal (no `private`) so logic tests can exercise it directly.
     */
    _acceptHelpRequest(): PendingStamp | null {
        if (!this._inFlightMarker || this._inFlightMarker.intent !== 'help_request') {
            return null;
        }
        const snap = this._slot.snapshot();
        const stamp = this._guard.accept('help_request', this._inFlightMarker.localToken, this._inFlightMarker.episodeId, snap.generation);
        this._setInFlightMarker(undefined);
        return stamp;
    }
```

- [ ] **Step 5: Run + type-check**

Run: `npx vitest run test/logic/struggleIntervention/helpRequest-accept.test.ts test/logic/struggleIntervention/C8-dismissEpisode.test.ts`
Then: `npm run check-types`
Expected: PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add extension/src/extension/services/struggleIntervention/slot/guard.ts extension/src/extension/services/struggleIntervention/struggleContract.ts extension/src/extension/services/struggleIntervention/struggleInterventionService.ts extension/src/shared/messageContracts/extensionMessages.ts extension/test/logic/struggleIntervention/helpers.ts extension/test/logic/struggleIntervention/C8-dismissEpisode.test.ts extension/test/logic/struggleIntervention/helpRequest-accept.test.ts
git commit -m "feat(intervention): add help_request as a third local correlation intent"
```

---

### Task C2: The `appendFollowup` slot transition

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/slot/slotManager.ts` (add `appendFollowup` after `escalate` ~124)
- Test: `extension/test/logic/struggleIntervention/appendFollowup.test.ts` (new)

**Interfaces:**
- Produces: `SlotManager.appendFollowup(hint: EpisodeHint): SlotSnapshot` — DELIVERED→DELIVERED, appends to the SAME episode, sets `level: 'active'`, bumps generation. Throws if not delivered.

- [ ] **Step 1: Write the failing test** — create `extension/test/logic/struggleIntervention/appendFollowup.test.ts` (confirm the real `takeDelivered`/`newEpisode` signatures first):

```typescript
import { describe, expect, it } from 'vitest';

import { SlotManager } from '@extension/services/struggleIntervention/slot/slotManager';
import { newEpisode } from '@extension/services/struggleIntervention/slot/episode';

function delivered(sm: SlotManager): void {
    const ep = newEpisode(0, () => 'ep-1');
    sm.takeDelivered(0, ep, { level: 'active', text: 'first', atSessionS: 1 });
}

describe('SlotManager.appendFollowup', () => {
    it('appends a follow-up hint to the same delivered episode and bumps generation', () => {
        const sm = new SlotManager();
        delivered(sm);
        const genBefore = sm.generation();
        const snap = sm.appendFollowup({ level: 'active', text: 'next step', atSessionS: 5 });
        expect(snap.state.kind).toBe('delivered');
        const st = snap.state as Extract<typeof snap.state, { kind: 'delivered' }>;
        expect(st.episode.hints.map(h => h.text)).toEqual(['first', 'next step']);
        expect(sm.generation()).toBeGreaterThan(genBefore);
    });

    it('throws when the slot is not delivered', () => {
        expect(() => new SlotManager().appendFollowup({ level: 'active', text: 'x', atSessionS: 1 })).toThrow();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/logic/struggleIntervention/appendFollowup.test.ts`
Expected: FAIL — `appendFollowup` does not exist.

- [ ] **Step 3: Implement** — in `slotManager.ts`, after `escalate` (line 124):

```typescript
    /**
     * DELIVERED -> DELIVERED (consented follow-up, spec B+). Appends the hint to the SAME episode.
     * Unlike escalate, NOT gated on the current level and driven by an explicit help_request reply.
     */
    appendFollowup(hint: EpisodeHint): SlotSnapshot {
        if (this._state.kind !== 'delivered') {
            throw new Error(`appendFollowup: illegal in state '${this._state.kind}' (requires delivered)`);
        }
        const ep = addHint(this._state.episode, hint);
        this._gen++;
        this._state = { kind: 'delivered', episode: ep, level: 'active', generation: this._gen };
        return this.snapshot();
    }
```

- [ ] **Step 4: Run + type-check**

Run: `npx vitest run test/logic/struggleIntervention/appendFollowup.test.ts`
Then: `npm run check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/extension/services/struggleIntervention/slot/slotManager.ts extension/test/logic/struggleIntervention/appendFollowup.test.ts
git commit -m "feat(intervention): add appendFollowup delivered->delivered slot transition"
```

---

### Task C3: The `help_request` POST + `onServerActive` bypass + delivery

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` (`onServerActive` ~730; add `_sendHelpRequest`; add `_offeredHintCounts` field ~277)
- Test: `extension/test/logic/struggleIntervention/helpRequest-delivery.test.ts` (new)

**Interfaces:**
- Consumes: C1 (`help_request` + `_acceptHelpRequest`), C2 (`appendFollowup`).
- Produces: `_sendHelpRequest(): Promise<void>` (single-flight; requires `_lastSignal`); `onServerActive` routes a reply correlated to an in-flight `help_request` marker into `appendFollowup` + anchor-rebase + `_applyActiveSurface`, bypassing the Less reroute and reconcile; increments `_offeredHintCounts`.

- [ ] **Step 1: Write the failing test** — create `extension/test/logic/struggleIntervention/helpRequest-delivery.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import type { PendingStamp } from '@extension/services/struggleIntervention/slot/guard';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';
import { fakeDeps, simulateDelivered } from './helpers';

describe('help_request delivery', () => {
    it('an active reply to an in-flight help_request appends to the open episode and posts a bubble, even in Less', () => {
        const deps = fakeDeps({ getProactiveLevel: () => 'less' });
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-hr');
        const gen = svc._slot.generation();
        const stamp: PendingStamp = { episodeId: 'ep-hr', generation: gen, hardEvent: false, requestToken: 'tok' };
        const localToken = svc._guard.issue('help_request', stamp);
        svc._inFlightMarker = { requestToken: 'tok', episodeId: 'ep-hr', generation: gen, intent: 'help_request', localToken };

        svc.onServerActive(1, undefined, undefined, undefined, 0.9, 'next concrete step', 200);

        expect(deps.postBubble).toHaveBeenCalledWith('next concrete step', 200, 'ep-hr');
        const st = svc._slot.snapshot().state as Extract<ReturnType<typeof svc._slot.snapshot>['state'], { kind: 'delivered' }>;
        expect(st.episode.hints.map(h => h.text)).toContain('next concrete step');
        expect(svc._offeredHintCounts.get('ep-hr')).toBe(1);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/logic/struggleIntervention/helpRequest-delivery.test.ts`
Expected: FAIL — Less re-routes to ambient, no bubble; `_offeredHintCounts` missing.

- [ ] **Step 3: Implement**

Add field near `_continuedEpisodeIds` (~277):
```typescript
    // Per-episode accepted-offer count (the cap: Less 1 / More 3). The opening hint is NOT counted.
    _offeredHintCounts = new Map<string, number>();
```

At the TOP of `onServerActive` (after the `isStudentProactiveOn` guard ~737, BEFORE the Less reroute ~745):
```typescript
        // Consented follow-up (help_request): an invited delivery. Bypass the Less reroute AND reconcile's
        // delivered-suppress; append to the open episode as a bubble. Disambiguated by the marker's intent.
        if (this._inFlightMarker?.intent === 'help_request') {
            const baseline = this._inFlightMarker.baseline;
            const accepted = this._acceptHelpRequest();
            if (accepted === null) {
                return;
            }
            const text = message ?? 'Iris has a suggestion for you.';
            let effectiveAnchorLine = anchorLine;
            if (anchorFile !== undefined && anchorLine !== undefined && isSafeAnchorPath(anchorFile)) {
                const base = baseline?.[anchorFile];
                const current = base !== undefined ? this._deps.readFileContent(anchorFile) : undefined;
                if (base !== undefined && current !== undefined) {
                    effectiveAnchorLine = rebaseAnchorLine(base, current, anchorLine);
                }
            }
            this._slot.appendFollowup({ level: 'active', text, atSessionS: Date.now() / 1000 });
            const episodeId = this._deliveredEpisodeId();
            if (episodeId) {
                this._offeredHintCounts.set(episodeId, (this._offeredHintCounts.get(episodeId) ?? 0) + 1);
            }
            this._watchdog?.resetProgress(Date.now());
            this._applyActiveSurface(text, messageId ?? null, anchorFile, effectiveAnchorLine, inlineHint, sessionId);
            return;
        }
```

Add `_sendHelpRequest` (near `_drainOwed`):
```typescript
    /**
     * POST a consented follow-up (help_request) for the live DELIVERED episode. Single-flight; the reply
     * lands in onServerActive (or onServerSilent for the silent edge). Requires a prior struggle signal.
     */
    async _sendHelpRequest(): Promise<void> {
        const snap = this._slot.snapshot();
        if (snap.state.kind !== 'delivered' || this._inFlightMarker !== undefined || !this._lastSignal) {
            return;
        }
        const exerciseId = this._deps.getExerciseId();
        if (exerciseId === undefined) {
            return;
        }
        const ep = snap.state.episode;
        const requestToken = crypto.randomUUID();
        const requestEpisode = { episodeId: ep.episodeId, isNew: !this._continuedEpisodeIds.has(ep.episodeId), hints: ep.hints };
        const stamp: PendingStamp = { episodeId: ep.episodeId, generation: snap.generation, hardEvent: false, requestToken };
        const localToken = this._guard.issue('help_request', stamp);
        this._setInFlightMarker({ requestToken, episodeId: ep.episodeId, generation: snap.generation, intent: 'help_request', localToken });
        try {
            const uncommittedFiles = await this._deps.collectFiles(this._deps.getExerciseRoot());
            if (this._inFlightMarker?.requestToken === requestToken) {
                this._inFlightMarker.baseline = uncommittedFiles;   // rebase baseline for an anchored follow-up
            }
            const result = await this._deps.postIntervention(exerciseId, {
                struggleSignal: this._lastSignal,
                uncommittedFiles,
                intent: 'help_request',
                episode: requestEpisode,
                requestToken,
                proactivityMode: this._deps.getProactiveLevel(exerciseId) === 'less' ? 'pull' : 'push',
            });
            if (result !== 'accepted') {
                this._setInFlightMarker(undefined);
            }
        } catch {
            this._setInFlightMarker(undefined);
        }
    }
```

`isSafeAnchorPath`/`rebaseAnchorLine` are already imported (used by `_applyDecideAction`).

- [ ] **Step 4: Run + type-check**

Run: `npx vitest run test/logic/struggleIntervention/helpRequest-delivery.test.ts`
Then: `npm run check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/extension/services/struggleIntervention/struggleInterventionService.ts extension/test/logic/struggleIntervention/helpRequest-delivery.test.ts
git commit -m "feat(intervention): deliver a consented help_request reply via appendFollowup, bypassing the Less reroute"
```

---

### Task C4: `help_request` silent/empty completion (no wire wedge)

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` (`onServerSilent` ~772)
- Test: `extension/test/logic/struggleIntervention/helpRequest-silent.test.ts` (new)

**Interfaces:**
- Consumes: C1 (`_acceptHelpRequest`), C3 (`_offeredHintCounts`).
- Produces: a `silent`/empty frame for an in-flight `help_request` clears the marker (unwedges the wire), posts "Nothing more I can add right now." via `postBubble`, consumes no cap. Without this, `onServerSilent` calls `_acceptDecide()` (returns null for a help_request marker WITHOUT clearing it) → wire wedged.

- [ ] **Step 1: Write the failing test** — create `extension/test/logic/struggleIntervention/helpRequest-silent.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import type { PendingStamp } from '@extension/services/struggleIntervention/slot/guard';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';
import { fakeDeps, simulateDelivered } from './helpers';

describe('help_request silent completion', () => {
    it('clears the in-flight help_request marker and posts an honest note (no cap consumed)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-hr');
        const gen = svc._slot.generation();
        const stamp: PendingStamp = { episodeId: 'ep-hr', generation: gen, hardEvent: false, requestToken: 'tok' };
        const localToken = svc._guard.issue('help_request', stamp);
        svc._inFlightMarker = { requestToken: 'tok', episodeId: 'ep-hr', generation: gen, intent: 'help_request', localToken };

        svc.onServerSilent('ep-hr', undefined);

        expect(svc._inFlightMarker).toBeUndefined();
        expect(deps.postBubble).toHaveBeenCalledWith('Nothing more I can add right now.', null, 'ep-hr');
        expect(svc._offeredHintCounts.get('ep-hr') ?? 0).toBe(0);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/logic/struggleIntervention/helpRequest-silent.test.ts`
Expected: FAIL — marker stays set, no bubble.

- [ ] **Step 3: Implement** — in `onServerSilent`, after the echo check (778-782) and BEFORE `_acceptDecide()` (784):

```typescript
        // Consented follow-up that resolved silent: clear the help_request marker so the wire is not wedged,
        // and give an honest note. No cap slot is consumed.
        if (this._inFlightMarker?.intent === 'help_request') {
            const accepted = this._acceptHelpRequest();
            if (accepted === null) {
                if (messageId !== undefined) { this._dropStaleRow(messageId); }
                return;
            }
            this._deps.postBubble('Nothing more I can add right now.', null, this._deliveredEpisodeId());
            return;
        }
```

- [ ] **Step 4: Run + type-check**

Run: `npx vitest run test/logic/struggleIntervention/helpRequest-silent.test.ts`
Then: `npm run check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/extension/services/struggleIntervention/struggleInterventionService.ts extension/test/logic/struggleIntervention/helpRequest-silent.test.ts
git commit -m "fix(intervention): clear a silent help_request reply instead of wedging the wire"
```

---

### Task C5: Offer transport (contracts + provider + IrisChatView + store)

This task owns ALL additive shared-contract changes for offers, so later tasks stay `check-types`-green. Everything here is additive (new optional fields, new message + command types, new provider methods) — no existing producer/consumer breaks.

**Files:**
- Modify: `extension/src/webview/views/IrisChat/types.ts` (`ChatMessage.offer` marker)
- Modify: `extension/src/shared/messageContracts/extensionMessages.ts` (`addMessage.message.offer?` ~425; new `resolveOffer` host→webview message near `removeMessage` ~541; add optional `moment?`/`offerId?` to `showNudgeBanner` ~544)
- Modify: `extension/src/webview/views/IrisChat/IrisChatView.tsx` (pass `message.offer` through the `AddMessage` map ~95; add `case ExtensionMsg.ResolveOffer` in the host-message switch ~203 → a new store action)
- Modify: `extension/src/webview/stores/useChatStore.ts` (accept `offer` on add; add `resolveOffer(offerId, answered)` action — mirror `removeMessageById`)
- Modify: `extension/src/extension/provider/chatWebviewProvider.ts` (add `postOfferBubble`, `resolveOfferBubble` mirroring `postOptimisticBubble` ~484)
- Modify: `extension/src/extension/provider/artemisWebviewProvider.ts` (add `showOfferBanner` on the existing `showNudgeBanner` path ~526)
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` (add the 3 deps to `StruggleInterventionDeps`)
- Modify: the deps wiring that constructs `StruggleInterventionDeps` (extension.ts / telemetry) to provide the 3 new methods
- Modify: `extension/test/logic/struggleIntervention/helpers.ts` (add the 3 deps as `vi.fn()`)
- Test: `extension/test/react/stores/useChatStore.test.ts` (mirror the `removeMessageById` test ~705)

**Interfaces:**
- `ChatMessage.offer?: { offerId: string; moment: 'stuck' | 'abandon'; answered?: 'accept' | 'decline' | 'timeout' }` (also added to `addMessage.message`).
- Host→webview `resolveOffer: { offerId: string; answered: 'accept' | 'decline' | 'timeout' }` — the webview finds the bubble by `offerId` and sets `offer.answered` (renders the condensed line in C10).
- `showNudgeBanner` gains optional `moment?: 'stuck' | 'abandon'` and `offerId?: string` (optional so the legacy nudge path is unaffected).
- Deps: `postOfferBubble(o: { offerId; episodeId; moment })`, `resolveOfferBubble(offerId, answered)`, `showOfferBanner(o: { offerId; episodeId; moment })`.

- [ ] **Step 1: Write the failing test** — add to `extension/test/react/stores/useChatStore.test.ts`, mirroring the `removeMessageById` test (~705): dispatch an add with an `offer` marker, then `resolveOffer(offerId, 'accept')`, assert the message's `offer.answered === 'accept'`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/react/stores/useChatStore.test.ts`
Expected: FAIL — `resolveOffer` action / `offer` field unknown.

- [ ] **Step 3: Implement**

`types.ts` `ChatMessage` (after `proactiveEpisodeId` ~41):
```typescript
    /**
     * Ephemeral client-local offer marker (spec B+). Never persisted / round-tripped from the server.
     * When set (and `answered` unset), the bubble renders answer buttons; once `answered`, the condensed line.
     */
    offer?: { offerId: string; moment: 'stuck' | 'abandon'; answered?: 'accept' | 'decline' | 'timeout' };
```

`extensionMessages.ts`: add the same `offer?` to `addMessage.message` (~425); add the `resolveOffer` `ExtensionMsg` key + payload near `removeMessage` (~541):
```typescript
    resolveOffer: { offerId: string; answered: 'accept' | 'decline' | 'timeout' };
```
Extend `showNudgeBanner` (~544) with optional fields:
```typescript
    showNudgeBanner: { title: string; sub: string; episodeId?: string; moment?: 'stuck' | 'abandon'; offerId?: string; timerMs: number };
```

`useChatStore.ts`: on add, carry `message.offer` onto the stored `ChatMessage`; add `resolveOffer(offerId, answered)` (find by `offerId`, set `offer.answered`) mirroring `removeMessageById`.

`IrisChatView.tsx`: in the `AddMessage` map (~95) pass `offer: msg.message.offer` onto the `ChatMessage`; add `case ExtensionMsg.ResolveOffer:` in the switch (~203) → `store.resolveOffer(msg.offerId, msg.answered)`.

`chatWebviewProvider.ts`: `postOfferBubble({offerId, episodeId, moment})` sends `addMessage` with `message` = `{ role:'assistant', content:'', timestamp: Date.now(), origin:'proactive', proactiveEpisodeId: episodeId, offer:{offerId, moment} }` (mirror `postOptimisticBubble`); `resolveOfferBubble(offerId, answered)` sends `resolveOffer`.

`artemisWebviewProvider.ts`: `showOfferBanner({offerId, episodeId, moment})` sends `showNudgeBanner` with `moment`, `offerId`, `episodeId`, `timerMs` (60000 for `abandon`, else the existing default) and the title/sub from the literal copy (C8 replaces these with `OFFER_TEXTS`).

`StruggleInterventionDeps` (near `showActiveBanner` ~142):
```typescript
    postOfferBubble(o: { offerId: string; episodeId: string; moment: 'stuck' | 'abandon' }): void;
    resolveOfferBubble(offerId: string, answered: 'accept' | 'decline' | 'timeout'): void;
    showOfferBanner(o: { offerId: string; episodeId: string; moment: 'stuck' | 'abandon' }): void;
```
Wire the three into the deps object where it is constructed, and add them as `vi.fn()` to `fakeDeps` in `helpers.ts`.

- [ ] **Step 4: Run + type-check**

Run: `npx vitest run test/react/stores/useChatStore.test.ts`
Then: `npm run check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/webview/views/IrisChat/types.ts extension/src/shared/messageContracts/extensionMessages.ts extension/src/webview/views/IrisChat/IrisChatView.tsx extension/src/webview/stores/useChatStore.ts extension/src/extension/provider/chatWebviewProvider.ts extension/src/extension/provider/artemisWebviewProvider.ts extension/src/extension/services/struggleIntervention/struggleInterventionService.ts extension/src/extension/telemetry/index.ts extension/test/logic/struggleIntervention/helpers.ts extension/test/react/stores/useChatStore.test.ts
git commit -m "feat(intervention): add offer-bubble transport (offer marker, resolveOffer, provider deps)"
```

---

### Task C6: Moment-1 offer trigger, outstanding-offer state, cap, answers

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` (`_suppressReason` ~541; `_handleAlert` ~556-592; new fields + helpers + `acceptOffer`/`declineOffer`; `resetSession` ~1414)
- Test: `extension/test/logic/struggleIntervention/moment1-offer.test.ts` (new)

**Interfaces:**
- Consumes: C3 (`_sendHelpRequest`, `_offeredHintCounts`), C5 (offer deps).
- Produces: fields `_offersDeclined: Set<string>`, `_outstandingOffer: { offerId; episodeId; moment } | undefined`; `_canOfferStuck(id)`; `_canRaiseStuckOfferNow(id)`; `acceptOffer(offerId, episodeId)`; `declineOffer(offerId, episodeId)`; `offerTimedOut(offerId, episodeId)` (a stuck banner that auto-closed → clear the outstanding offer, re-offer allowed). All handlers guard on `_outstandingOffer.offerId === offerId` AND `episodeId === _deliveredEpisodeId()`, clear `_outstandingOffer`, and call `resolveOfferBubble`.

- [ ] **Step 1: Write the failing test** — create `extension/test/logic/struggleIntervention/moment1-offer.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';
import { fakeDeps, simulateDelivered } from './helpers';

describe('Moment-1 offer', () => {
    it('_canOfferStuck respects the More cap (3) and a decline (Less cap 1)', () => {
        const more = new StruggleInterventionService(fakeDeps({ getProactiveLevel: () => 'more' }));
        more._offeredHintCounts.set('ep-1', 3);
        expect(more._canOfferStuck('ep-1')).toBe(false);
        more._offeredHintCounts.set('ep-1', 2);
        expect(more._canOfferStuck('ep-1')).toBe(true);
    });

    it('acceptOffer fires only for the outstanding offer on the live episode, and resolves the bubble', async () => {
        const deps = fakeDeps({ getProactiveLevel: () => 'more' });
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-1');
        svc._outstandingOffer = { offerId: 'off-1', episodeId: 'ep-1', moment: 'stuck' };

        svc.acceptOffer('WRONG', 'ep-1');
        expect(deps.postIntervention).not.toHaveBeenCalled();

        svc.acceptOffer('off-1', 'ep-1');
        await Promise.resolve();
        expect(deps.resolveOfferBubble).toHaveBeenCalledWith('off-1', 'accept');
        expect(deps.postIntervention).toHaveBeenCalledWith(42, expect.objectContaining({ intent: 'help_request' }));
        expect(svc._outstandingOffer).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/logic/struggleIntervention/moment1-offer.test.ts`
Expected: FAIL — the new fields/methods do not exist.

- [ ] **Step 3: Implement**

Fields near `_offeredHintCounts` (~277):
```typescript
    _offersDeclined = new Set<string>();
    _outstandingOffer: { offerId: string; episodeId: string; moment: 'stuck' | 'abandon' } | undefined;
```

Helpers + handlers (near `dismissEpisode` ~1316):
```typescript
    private _offerCapForLevel(level: ProactiveLevel): number {
        return level === 'more' ? 3 : level === 'less' ? 1 : 0;
    }

    _canOfferStuck(episodeId: string): boolean {
        if (this._offersDeclined.has(episodeId)) { return false; }
        const exId = this._deps.getExerciseId();
        const level = exId !== undefined ? this._deps.getProactiveLevel(exId) : 'more';
        return (this._offeredHintCounts.get(episodeId) ?? 0) < this._offerCapForLevel(level);
    }

    private _canRaiseStuckOfferNow(episodeId: string): boolean {
        return this._outstandingOffer === undefined && this._inFlightMarker === undefined && this._canOfferStuck(episodeId);
    }

    private _raiseStuckOffer(): void {
        const snap = this._slot.snapshot();
        if (snap.state.kind !== 'delivered') { return; }
        const episodeId = snap.state.episode.episodeId;
        const exId = this._deps.getExerciseId();
        const level = exId !== undefined ? this._deps.getProactiveLevel(exId) : 'more';
        const offerId = crypto.randomUUID();
        this._outstandingOffer = { offerId, episodeId, moment: 'stuck' };
        if (snap.inSession) {
            this._deps.postOfferBubble({ offerId, episodeId, moment: 'stuck' });
        } else if (level === 'more') {
            this._deps.showOfferBanner({ offerId, episodeId, moment: 'stuck' });
            this._deps.setBadge(true);
        } else {
            this._deps.setBadge(true);   // Less, chat closed: badge only; the offer waits in the chat
        }
    }

    /** Moment-1 "Show me": generate + deliver the next hint. Guarded to the outstanding offer + live episode. */
    acceptOffer(offerId: string, episodeId: string): void {
        if (this._outstandingOffer?.offerId !== offerId || episodeId !== this._deliveredEpisodeId()) { return; }
        this._outstandingOffer = undefined;
        this._deps.resolveOfferBubble(offerId, 'accept');
        void this._sendHelpRequest();
    }

    /** Moment-1 "Not now": quiet for this episode. */
    declineOffer(offerId: string, episodeId: string): void {
        if (this._outstandingOffer?.offerId !== offerId || episodeId !== this._deliveredEpisodeId()) { return; }
        this._outstandingOffer = undefined;
        this._offersDeclined.add(episodeId);
        this._deps.resolveOfferBubble(offerId, 'decline');
    }

    /**
     * A stuck offer's out-of-session banner auto-closed (ignored). Clear the outstanding offer so a later
     * alert may offer again (spec §4.3 "Ignored -> short cooldown, may offer again"); NOT added to declined.
     * (An in-session stuck bubble has no countdown, so this only fires for the banner path.)
     */
    offerTimedOut(offerId: string, episodeId: string): void {
        if (this._outstandingOffer?.offerId !== offerId || episodeId !== this._deliveredEpisodeId()) { return; }
        this._outstandingOffer = undefined;
        this._deps.resolveOfferBubble(offerId, 'timeout');
    }
```

In `_suppressReason`, change the delivered-slot branch (541):
```typescript
        const slot = this._slot.snapshot().state;
        if (slot.kind === 'delivered' && !(slot.level === 'ambient' && isHardAlert(alert))) {
            if (this._canRaiseStuckOfferNow(slot.episode.episodeId)) {
                return null;
            }
            return '  -> SKIP (delivered slot: reconcile would suppress any result, POST saved)';
        }
```

In `_handleAlert`, after the `_suppressReason` early-return (after 566, before `try`):
```typescript
        const preSlot = this._slot.snapshot().state;
        if (preSlot.kind === 'delivered'
            && !(preSlot.level === 'ambient' && isHardAlert(alert))
            && this._canRaiseStuckOfferNow(preSlot.episode.episodeId)) {
            this._raiseStuckOffer();
            return;
        }
```

In `resetSession` (after 1414):
```typescript
        this._offeredHintCounts.clear();
        this._offersDeclined.clear();
        this._outstandingOffer = undefined;
```

- [ ] **Step 4: Run + type-check**

Run: `npx vitest run test/logic/struggleIntervention/moment1-offer.test.ts`
Then: `npm run check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/extension/services/struggleIntervention/struggleInterventionService.ts extension/test/logic/struggleIntervention/moment1-offer.test.ts
git commit -m "feat(intervention): raise a guarded, capped Moment-1 offer on delivered-slot alerts"
```

---

### Task C7: Moment-3 presence check (watchdog pre-abandon warn) + answers

Moment-3 comes BEFORE the banner task so `stillOnIt`/`needMoreHelp` exist when the banner's `handleBannerAction` routes to them (no forward reference).

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/slot/staleWatchdog.ts` (`warnLeadMs`, `_warned`, `pre-abandon-warn`)
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` (`_handleWatchdogTick` ~1161; add `_raiseAbandonOffer`, `stillOnIt`, `needMoreHelp`; resolve an outstanding abandon offer on `force-free`; `DEFAULT_SLOT_CFG` `warnLeadMs` ~218)
- Test: `extension/test/logic/struggleIntervention/slot/staleWatchdog.test.ts` (extend) + `extension/test/logic/struggleIntervention/moment3-presence.test.ts` (new)

**Interfaces:**
- Consumes: C3 (`_sendHelpRequest`), C6 (`_outstandingOffer`, offer deps).
- Produces: `StaleWatchdog` emits `{ kind: 'pre-abandon-warn' }` once, `warnLeadMs` before the DELIVERED force-free, pinning the remaining window to 60s; `stillOnIt(offerId, episodeId)` resets the idle clock (no hint); `needMoreHelp(offerId, episodeId)` delivers via `_sendHelpRequest` (overriding an exhausted cap — no `_canOfferStuck` gate applies here) and resets idle. Both guard on the outstanding offer + live episode and call `resolveOfferBubble`. On `force-free` with an outstanding abandon offer, it resolves as `'timeout'` ("no response").

- [ ] **Step 1: Write the failing tests**

Extend `extension/test/logic/struggleIntervention/slot/staleWatchdog.test.ts` (update existing `new StaleWatchdog({ idleAbandonMs: ... })` constructors to also pass `warnLeadMs: 60_000`):
```typescript
    it('fires pre-abandon-warn once, 60s before force-free, and pins the window to 60s', () => {
        const wd = new StaleWatchdog({ idleAbandonMs: 600_000, warnLeadMs: 60_000 });
        wd.arm(0, false /* delivered */);
        expect(wd.tick(539_000)).toBeNull();
        expect(wd.tick(540_000)).toEqual({ kind: 'pre-abandon-warn' });
        expect(wd.tick(560_000)).toBeNull();
        expect(wd.tick(600_000)).toEqual({ kind: 'force-free' });
    });
```

Create `extension/test/logic/struggleIntervention/moment3-presence.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';
import { fakeDeps, simulateDelivered } from './helpers';

describe('Moment-3 answers', () => {
    it('needMoreHelp posts a help_request even when the cap is exhausted, and resolves the bubble', async () => {
        const deps = fakeDeps({ getProactiveLevel: () => 'less' });
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-1');
        svc._offeredHintCounts.set('ep-1', 1);   // Less cap reached
        svc._outstandingOffer = { offerId: 'off-1', episodeId: 'ep-1', moment: 'abandon' };
        svc.needMoreHelp('off-1', 'ep-1');
        await Promise.resolve();
        expect(deps.resolveOfferBubble).toHaveBeenCalledWith('off-1', 'accept');
        expect(deps.postIntervention).toHaveBeenCalledWith(42, expect.objectContaining({ intent: 'help_request' }));
        expect(svc._outstandingOffer).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/logic/struggleIntervention/moment3-presence.test.ts test/logic/struggleIntervention/slot/staleWatchdog.test.ts`
Expected: FAIL — `warnLeadMs`/`pre-abandon-warn`/`needMoreHelp` missing.

- [ ] **Step 3: Implement**

`staleWatchdog.ts`:
```typescript
export interface StaleConfig {
    idleAbandonMs: number;
    /** Lead time before the DELIVERED force-free at which the Moment-3 presence check fires. */
    warnLeadMs: number;
}

export type StaleEvent =
    | { kind: 'pre-abandon-warn' }
    | { kind: 'force-free' }
    | { kind: 'free-silent' };
```
Add `private _warned = false;`; set `false` in `arm` and `resetProgress`. In `tick`, before the abandon check:
```typescript
        const idle = now - this._lastResetMs;
        if (!this._parked && !this._warned && idle >= this._cfg.idleAbandonMs - this._cfg.warnLeadMs && idle < this._cfg.idleAbandonMs) {
            this._warned = true;
            this._lastResetMs = now - (this._cfg.idleAbandonMs - this._cfg.warnLeadMs);   // pin remaining window to warnLeadMs
            return { kind: 'pre-abandon-warn' };
        }
```
Keep the existing abandon block after it (reset `_warned = false` when it fires).

`struggleInterventionService.ts` `DEFAULT_SLOT_CFG` (218):
```typescript
const DEFAULT_SLOT_CFG: StaleConfig = {
    idleAbandonMs: 600_000,
    warnLeadMs: 60_000,
};
```
In `_handleWatchdogTick`, add a case before `force-free`:
```typescript
            case 'pre-abandon-warn': {
                this._dbg('  -> WATCHDOG pre-abandon-warn: Moment-3 offer');
                const ep = snap.state.kind === 'delivered' ? snap.state.episode : undefined;
                if (ep && this._outstandingOffer === undefined && this._inFlightMarker === undefined) {
                    this._raiseAbandonOffer(ep.episodeId);
                }
                break;
            }
```
Inside the existing `force-free` case, at the top, resolve an ignored abandon offer:
```typescript
                if (this._outstandingOffer?.moment === 'abandon') {
                    this._deps.resolveOfferBubble(this._outstandingOffer.offerId, 'timeout');
                    this._outstandingOffer = undefined;
                }
```
Add `_raiseAbandonOffer` + the two handlers (near the Moment-1 handlers):
```typescript
    private _raiseAbandonOffer(episodeId: string): void {
        const exId = this._deps.getExerciseId();
        const level = exId !== undefined ? this._deps.getProactiveLevel(exId) : 'more';
        const offerId = crypto.randomUUID();
        this._outstandingOffer = { offerId, episodeId, moment: 'abandon' };
        if (this._slot.snapshot().inSession) {
            this._deps.postOfferBubble({ offerId, episodeId, moment: 'abandon' });
        } else if (level === 'more') {
            this._deps.showOfferBanner({ offerId, episodeId, moment: 'abandon' });
            this._deps.setBadge(true);
        } else {
            this._deps.setBadge(true);
        }
    }

    /** Moment-3 "I'm still on it": keep watching, reset the idle clock, no hint, no POST. */
    stillOnIt(offerId: string, episodeId: string): void {
        if (this._outstandingOffer?.offerId !== offerId || episodeId !== this._deliveredEpisodeId()) { return; }
        this._outstandingOffer = undefined;
        this._deps.resolveOfferBubble(offerId, 'decline');
        this._watchdog?.resetProgress(Date.now());
    }

    /** Moment-3 "I need more help": deliver on demand, overriding an exhausted cap; reset idle. */
    needMoreHelp(offerId: string, episodeId: string): void {
        if (this._outstandingOffer?.offerId !== offerId || episodeId !== this._deliveredEpisodeId()) { return; }
        this._outstandingOffer = undefined;
        this._deps.resolveOfferBubble(offerId, 'accept');
        this._watchdog?.resetProgress(Date.now());
        void this._sendHelpRequest();
    }
```

- [ ] **Step 4: Run + type-check**

Run: `npx vitest run test/logic/struggleIntervention/moment3-presence.test.ts test/logic/struggleIntervention/slot/staleWatchdog.test.ts`
Then: `npm run check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/extension/services/struggleIntervention/slot/staleWatchdog.ts extension/src/extension/services/struggleIntervention/struggleInterventionService.ts extension/test/logic/struggleIntervention/moment3-presence.test.ts extension/test/logic/struggleIntervention/slot/staleWatchdog.test.ts
git commit -m "feat(intervention): add the Moment-3 presence check 60s before idle abandon"
```

---

### Task C8: Generalise the nudge-banner behaviour for offers

**Extends** the `nudgeBannerAction` command with an OFFER variant while **preserving the existing legacy active banner** (`showActiveBanner` still fires the legacy `showMe`/`dismiss`/`timeout` path for real active deliveries + escalations — `struggleInterventionService.ts:1035`, `:1089`). Owns the command change AND all its producers/consumers so it is standalone-green. All four orchestrator methods (`acceptOffer`/`declineOffer` from C6, `stillOnIt`/`needMoreHelp` from C7) already exist; C6 also provides `offerTimedOut`.

**Files:**
- Modify: `extension/src/shared/messageContracts/webviewCommands.ts:273` (`nudgeBannerAction` payload)
- Modify: `extension/src/webview/components/NudgeBanner/NudgeBanner.tsx` (moment-aware labels + accept/decline/timeout)
- Modify: `extension/src/extension/services/ui/nudgeBannerText.ts` (add `OFFER_TEXTS`; use them from `showOfferBanner`)
- Modify: `extension/src/extension/telemetry/contract.ts:252` (the `handleBannerAction` type)
- Modify: `extension/src/extension/telemetry/index.ts:334-343` (`handleBannerAction` impl, branch on `moment`, pass `offerId`)
- Modify: `extension/src/extension/provider/artemisWebviewProvider.ts` (the `nudgeBannerAction` dispatch/replay ~114 and ~526: pass `moment`, `action`, `episodeId`, `offerId`)
- Test: `extension/test/react/components/NudgeBanner.test.tsx`

**Interfaces:**
- Produces: `nudgeBannerAction` becomes a UNION — the legacy shape stays intact, an offer shape is added:
  ```typescript
  nudgeBannerAction:
      | { action: 'showMe' | 'dismiss' | 'timeout'; episodeId?: string }                                                    // legacy active banner (unchanged)
      | { moment: 'stuck' | 'abandon'; action: 'accept' | 'decline' | 'timeout'; episodeId?: string; offerId?: string };     // offer banner
  ```
- `handleBannerAction(payload)` takes the whole payload and branches on `'moment' in payload`. Offer branch: stuck/accept→`acceptOffer`, stuck/decline→`declineOffer`, stuck/timeout→`offerTimedOut`, abandon/accept→`needMoreHelp`, abandon/decline→`stillOnIt`, abandon/timeout→no-op (the watchdog force-free owns it). Legacy branch: the existing `showMe`→reveal-jump + open chat, `dismiss`→`dismissEpisode` behaviour, UNCHANGED.

- [ ] **Step 1: Write the failing test** — add to `NudgeBanner.test.tsx` (mirror the "Show me" test 46-60):

```tsx
    it('an abandon-moment banner shows the presence-check labels and posts accept', async () => {
        const vscodeApi = createMockVsCodeApi();
        render(<NudgeBanner vscodeApi={vscodeApi} />);
        dispatchExtensionMessage({
            type: ExtensionMsg.ShowNudgeBanner,
            title: 'Still on this?',
            sub: "I'll step back soon otherwise.",
            episodeId: 'ep-1',
            offerId: 'off-1',
            moment: 'abandon',
            timerMs: 60_000,
        });
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'I need more help' })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: 'I need more help' }));
        expect(vscodeApi.postMessage).toHaveBeenCalledWith({
            type: 'command',
            command: WebviewCmd.NudgeBannerAction,
            payload: { moment: 'abandon', action: 'accept', episodeId: 'ep-1', offerId: 'off-1' },
        });
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/react/components/NudgeBanner.test.tsx`
Expected: FAIL — old `{ action, episodeId }` shape / no moment labels.

- [ ] **Step 3: Implement**

`webviewCommands.ts:273` — the union above.

`NudgeBanner.tsx` — `BannerState` gains optional `moment?` + `offerId?`. Two modes, chosen by `banner.moment`:
- **Offer mode** (`banner.moment` set): `act` posts the offer shape `{ moment, action: 'accept' | 'decline' | 'timeout', episodeId, offerId }`; labels `acceptLabel = banner.moment === 'abandon' ? 'I need more help' : 'Show me'`, `declineLabel = banner.moment === 'abandon' ? "I'm still on it" : 'Not now'`; close + ghost → `accept`? no — ghost/close → `decline`, primary → `accept`, countdown → `timeout`.
- **Legacy mode** (`banner.moment` absent — the existing `showActiveBanner` path): UNCHANGED — buttons "Not now"→`{ action: 'dismiss', episodeId }`, "Show me"→`{ action: 'showMe', episodeId }`, countdown→`{ action: 'timeout', episodeId }`.

Keep both button label sets; select by `banner.moment`. Do NOT collapse the legacy path into offer semantics.

`nudgeBannerText.ts`:
```typescript
export const OFFER_TEXTS: Record<'stuck' | 'abandon', NudgeText> = {
    stuck: { title: 'Still stuck here?', sub: 'Want another hint?' },
    abandon: { title: 'Still on this?', sub: "I'll step back soon otherwise." },
};
```
Update `showOfferBanner` (in `artemisWebviewProvider.ts`, from C5) to source title/sub from `OFFER_TEXTS[moment]`.

`telemetry/contract.ts:252` — change the `handleBannerAction` type to take the whole payload. Use the real exported payload extractor from `webviewCommands.ts` (`WebCmd`, line ~378; `WebviewCmdPayloads` at ~125 is NOT exported): `(payload: WebCmd<typeof WebviewCmd.NudgeBannerAction>['payload']) => void`.

`telemetry/index.ts` (334-343) — keep the legacy branch byte-for-byte, add the offer branch:
```typescript
        handleBannerAction: (payload) => {
            if ('moment' in payload) {
                const { moment, action, episodeId, offerId } = payload;
                if (episodeId === MOCK_NUDGE_EPISODE_ID || !episodeId) { return; }
                if (moment === 'stuck') {
                    if (action === 'accept') { orchestrator.acceptOffer(offerId ?? '', episodeId); }
                    else if (action === 'decline') { orchestrator.declineOffer(offerId ?? '', episodeId); }
                    else if (action === 'timeout') { orchestrator.offerTimedOut(offerId ?? '', episodeId); }
                } else {
                    if (action === 'accept') { orchestrator.needMoreHelp(offerId ?? '', episodeId); }
                    else if (action === 'decline') { orchestrator.stillOnIt(offerId ?? '', episodeId); }
                    // abandon/timeout: no action here; the watchdog force-free owns it (C7).
                }
                return;
            }
            // LEGACY active banner (unchanged behaviour):
            const { action, episodeId } = payload;
            if (action === 'showMe') { lamp.revealJumpTarget(); }
            if (episodeId === MOCK_NUDGE_EPISODE_ID) { return; }
            if (action === 'dismiss') { orchestrator.dismissEpisode(episodeId); }
        },
```
`artemisWebviewProvider.ts` (~114 dispatch, ~526 replay) — pass the whole `msg.payload` into `handleBannerAction` (the dispatch currently destructures `action`/`episodeId`; forward the object instead). The dev "mock nudge" caller stays on the legacy path (no `moment`), so it is unaffected.

- [ ] **Step 4: Run + type-check**

Run: `npx vitest run test/react/components/NudgeBanner.test.tsx`
Then: `npm run check-types`
Expected: PASS (all four orchestrator methods exist from C6/C7).

- [ ] **Step 5: Commit**

```bash
git add extension/src/shared/messageContracts/webviewCommands.ts extension/src/webview/components/NudgeBanner/NudgeBanner.tsx extension/src/extension/services/ui/nudgeBannerText.ts extension/src/extension/telemetry/contract.ts extension/src/extension/telemetry/index.ts extension/src/extension/provider/artemisWebviewProvider.ts extension/test/react/components/NudgeBanner.test.tsx
git commit -m "feat(intervention): generalise the nudge banner to carry offer moment + accept/decline/timeout"
```

---

### Task C9: Offer bubble rendering + button wiring

**Files:**
- Modify: `extension/src/webview/views/IrisChat/components/MessageBubble.tsx`
- Modify: `extension/src/webview/views/IrisChat/components/EpisodeTimeline.tsx`
- Modify: `extension/src/webview/views/IrisChat/components/ChatMessageList.tsx` (~90/~170 — the real prop-threading point between the container and MessageBubble/EpisodeTimeline; thread `onOfferAnswer` exactly like `onDismiss`)
- Modify: `extension/src/webview/views/IrisChat/IrisChatView.tsx` (~617 — the container: pass `onOfferAnswer` → `postCommand(NudgeBannerAction, ...)`, alongside `onDismiss`)
- Test: `extension/test/react/views/IrisChat/components/MessageBubble.test.tsx`

**Interfaces:**
- Consumes: C5 (`ChatMessage.offer`), C8 (`nudgeBannerAction`).
- Produces: when `message.offer` is set (and `answered` unset), two buttons whose clicks call `onOfferAnswer(offerId, episodeId, moment, action)` (an OPTIONAL prop, so the components stay green before the container wires it); the container posts `WebviewCmd.NudgeBannerAction` `{ moment, action, episodeId, offerId }`.

- [ ] **Step 1: Write the failing test** — add to `extension/test/react/views/IrisChat/components/MessageBubble.test.tsx` (mirror the existing proactive-bubble render setup):

```tsx
    it('renders Show me / Not now on a stuck offer bubble and reports accept', () => {
        const onOfferAnswer = vi.fn();
        render(
            <MessageBubble
                message={{
                    localId: 'l1', role: 'assistant', content: '', timestamp: 0,
                    origin: 'proactive', proactiveEpisodeId: 'ep-1',
                    offer: { offerId: 'off-1', moment: 'stuck' },
                }}
                onOfferAnswer={onOfferAnswer}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
        expect(onOfferAnswer).toHaveBeenCalledWith('off-1', 'ep-1', 'stuck', 'accept');
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/react/views/IrisChat/components/MessageBubble.test.tsx`
Expected: FAIL — no offer buttons.

- [ ] **Step 3: Implement** — follow the EXISTING Dismiss ownership so a grouped row does not render the buttons twice (`MessageBubble` gates Dismiss on `!grouped`; the `EpisodeTimeline` footer owns the grouped Dismiss — mirror that exactly for offers):
  - `MessageBubble.tsx`: add `onOfferAnswer?: (offerId: string, episodeId: string | undefined, moment: 'stuck' | 'abandon', action: 'accept' | 'decline') => void`; render the two buttons ONLY when `message.offer && !message.offer.answered && !grouped` (mirror the `showDismiss` gate at line 69 + the Dismiss JSX 165-176). Labels: stuck → "Show me"/"Not now", abandon → "I need more help"/"I'm still on it".
  - `EpisodeTimeline.tsx`: render the buttons for the latest grouped row when `m.offer && !m.offer.answered` (mirror the footer Dismiss 55-64); thread `onOfferAnswer` through `EpisodeTimelineProps`.
  - `ChatMessageList.tsx`: thread `onOfferAnswer` from the container down to both `MessageBubble` and `EpisodeTimeline`, exactly where it threads `onDismiss` (~170).
  - `IrisChatView.tsx` container: `onOfferAnswer` → `postCommand(vscodeApi, WebviewCmd.NudgeBannerAction, { moment, action, episodeId, offerId })`.

- [ ] **Step 4: Run + type-check**

Run: `npx vitest run test/react/views/IrisChat/components/MessageBubble.test.tsx`
Then: `npm run check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/webview/views/IrisChat/components/MessageBubble.tsx extension/src/webview/views/IrisChat/components/EpisodeTimeline.tsx extension/src/webview/views/IrisChat/components/ChatMessageList.tsx extension/src/webview/views/IrisChat/IrisChatView.tsx extension/test/react/views/IrisChat/components/MessageBubble.test.tsx
git commit -m "feat(intervention): render consented offer buttons on proactive bubbles"
```

---

### Task C10: History — condensed decision line

**Files:**
- Modify: `extension/src/webview/views/IrisChat/components/EpisodeTimeline.tsx`
- Test: `extension/test/react/views/IrisChat/components/EpisodeTimeline.test.tsx`

**Interfaces:**
- Consumes: C5 (`ChatMessage.offer.answered`, set via `resolveOffer`).
- Produces: an answered offer renders the condensed grey line ("Offered another hint · You: Show me" / "· You: Not now" / "Offered a hand · no response") as a muted, hollow node; a closed episode uses the existing `episodeSummary.ts` fold (no change).

- [ ] **Step 1: Write the failing test** — add to `EpisodeTimeline.test.tsx` a message with `offer: { offerId, moment: 'stuck', answered: 'accept' }`; assert "Offered another hint · You: Show me" renders and no answer buttons.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/react/views/IrisChat/components/EpisodeTimeline.test.tsx`
Expected: FAIL — condensed line not rendered.

- [ ] **Step 3: Implement** — in `EpisodeTimeline.tsx`, when `m.offer?.answered` is set, render the condensed grey row instead of buttons. Map ALL `(moment, answered)` combinations (every resolution C6/C7 can emit):
  - `stuck` + `accept` → "Offered another hint · You: Show me"
  - `stuck` + `decline` → "Offered another hint · You: Not now"
  - `stuck` + `timeout` → "Offered another hint · no response"
  - `abandon` + `accept` → "Checked in · You: I need more help"
  - `abandon` + `decline` → "Checked in · You: I'm still on it"
  - `abandon` + `timeout` → "Offered a hand · no response"

Style muted/hollow (reuse the grey decision-row style if present, else add `styles.decisionRow`). Add a test per moment (at least one `stuck` and one `abandon` case) asserting the exact text and that no answer buttons render.

- [ ] **Step 4: Run + type-check**

Run: `npx vitest run test/react/views/IrisChat/components/EpisodeTimeline.test.tsx`
Then: `npm run check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/webview/views/IrisChat/components/EpisodeTimeline.tsx extension/test/react/views/IrisChat/components/EpisodeTimeline.test.tsx
git commit -m "feat(intervention): collapse an answered offer to a condensed decision line"
```

---

## Self-Review notes (author checklist)

- **Spec coverage:** §2/§5 generate-on-accept → C3/C6; §4.2 routing → C6/C7/C8; §4.3 answers → C6; §4.4 caps + Moment-3 override → C6/C7; §4.5 history → C10; §4.6 Moment 3 → C7; §6 client → C1/C2/C3/C5/C8/C9; §6.5 silent edge → C4; §7 → B1; §8 → A2; §9 wire → A1/B1/C1/C3; §11.3 → B1; §11.5 → C2/C3; §13 rollout → phase order + Global Constraints.
- **Prior-review blockers resolved:** silent wedge → C4; offer transport not implementable → C5 (contracts + IrisChatView + useChatStore + provider deps); loose handlers → C6/C7 (two-part guard + `resolveOfferBubble` emission on every answer + `force-free` timeout resolve); `_sendHelpRequest` `_lastSignal` guard + baseline rebase + seeded helper → C3/C1; C7→C9 forward reference → **Moment-3 (C7) now precedes the banner (C8)**, so `check-types` is green per task; banner type owners (`telemetry/contract.ts`, `artemisWebviewProvider.ts`) named in C8; test paths + `private` corrected.
- **Every task is standalone `check-types`-green:** C5 is purely additive (optional fields + new message/command types + new provider methods). C8 changes the `nudgeBannerAction` type together with its only producer/consumer (NudgeBanner + handleBannerAction + provider dispatch) in one task; the bubble producer (C9) comes after and consumes the finished type.
- **Deferred (non-blocking, note in the final review):** exact CSS for the condensed row + offer buttons; whether `showOfferBanner` reuses `showActiveBanner`'s provider internals or the raw `showNudgeBanner` send (C5 uses the latter).

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-07-08-proactive-help-offers.md`. Recommended: **codex review of this plan first**, then **subagent-driven-development** phase by phase in rollout order (Pyris → Artemis → Client), a fresh subagent per task with a task review after each.
