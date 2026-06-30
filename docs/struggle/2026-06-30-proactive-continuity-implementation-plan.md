# Proactive Intervention Continuity ("Slot" model) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/struggle/2026-06-29-proactive-continuity-design.md` (the authoritative design; section refs below as "§N" point at it).

**Goal:** Make every proactive Iris intervention pass through a single-occupant client-side **slot** that protects what the student has already been shown, replaces only never-delivered ambient pointers, and resolves deterministically (progress / dismiss / stale) — replacing today's stateless "blindly overwrite the last surface" behaviour.

**Architecture:** Three layers, built bottom-up so each contract exists before its consumer. (A) **Wire & backend** — two new Pyris pipeline modes (`confirmClose`, `staleCheck`), the new request/response DTO fields threaded across both hops (extension→Artemis→Pyris), one nullable `proactive_episode_id` column + two `IrisProactiveOutcome` enum values, and the change that **ambient no longer auto-persists** (hidden until click). (B) **Extension slot core** — a pure-logic `SlotManager` state machine (FREE / PARKED / DELIVERED + IN-SESSION), the async/generation guard, single-flight per intent, and the stale watchdog with its termination counters. (C) **Extension surfaces & webview** — rewire ambient=pull / active=push, hold-frozen-then-reveal hidden ambient, the deterministic stale-ask quick-reply buttons, and episode folding by `proactiveEpisodeId`.

**Tech Stack:** Pyris (Python 3.12, Pydantic v2, pytest). Artemis (Java 21, Spring Boot, JPA/Hibernate, Liquibase, JUnit 5 + Mockito). Extension (TypeScript, VS Code API, React webview; vitest for `test/logic`+`test/react`, mocha/`@vscode/test-cli` for `test/unit`).

---

## Global Constraints

Every task implicitly inherits this section.

- **Wire casing (VERIFIED against live code — corrects spec §17 for the request side).**
  - **Request path is camelCase** on BOTH hops. Extension→Artemis `IrisStruggleInterventionRequestDTO(struggleSignal, uncommittedFiles)` has **no `@JsonProperty` aliases** (plain camelCase). Artemis→Pyris `PyrisStruggleInterventionPipelineExecutionDTO` is camelCase and its Pyris Pydantic mirror uses **camelCase aliases** (`populate_by_name=True`). So new request fields are **camelCase**: `intent`, `episode { episodeId, isNew, hints[{ level, text, atSessionS }] }`. Spec §17's `episode_id` / `is_new` / `at_session_s` snake forms are **superseded** — they would create a mixed-casing request payload. (Flag at review.)
  - **Response path is snake_case.** Pyris `StruggleInterventionStatusUpdateDTO` has no aliases and is dumped `by_alias=True`, so Python field names go on the wire verbatim; Artemis `PyrisStruggleInterventionStatusUpdateDTO` mirrors with `@JsonProperty("snake_case")` (existing `anchor_file`, `anchor_line`, `inline_hint`). New response fields are **snake_case**: `resolved`, `closing_sentence`, `episode_label`, `ask`, `question`. (Matches spec §17.)
  - **Enum string VALUES are snake_case on the wire (per spec §17 — the camelCase concept names in prose are just readable labels).** `intent ∈ {"decide","confirm_close","stale_check"}`; the event `kind` discriminator mirrors it `∈ {"decide","confirm_close","stale_check"}`; `action ∈ {"silent","ambient","active"}` (unchanged); `confirmReason ∈ {"progress","stale_solved","parked_progress"}` (`parked_progress` = the silent never-delivered close, §4/§8; ratified in spec §17 as the extension→Artemis close-mode discriminator). (Only request KEYS are camelCase — `episodeId`/`isNew`/`atSessionS`/`confirmReason` — values are snake.) DB/Java `IrisProactiveOutcome ∈ {DISMISSED, RECOVERED, ABANDONED}` (UPPER, not on the Pyris wire). To avoid any mapping, the client-internal TS `Intent` type uses these same snake strings.
  - A casing mismatch silently drops the field to null — every new field gets a serialization round-trip test.
- **Branching:** all work on `feat/struggle-v3-integration` (per the active branch). Extension PRs follow the repo rule (off `dev`), but this integration work stays on the v3 branch until a separate manual merge decision.
- **Dependencies:** no carets/tildes in any `package.json`; pin exact versions (Renovate handles bumps). No new runtime deps are required by this plan.
- **Attribution:** no "Claude"/"AI"/"🤖"/"Generated with"/"Co-Authored-By" strings in any commit message, code comment, or doc. Commits stage only the files the task changed (never `git add -A`).
- **No em dashes** in any committed artifact.
- **Pyris is stateless about the slot** (§11): slot mechanics (PARKED/DELIVERED, IN-SESSION, watchdog, ask latch) live ONLY in the extension client. The request DTO deliberately omits them.
- **Template/solution repos are never exposed to Iris** (§11): `get_tools` keeps wiring only `submission.repository`; do not add `create_tool_get_example_solution`.
- **Verify command before "done":** extension tasks run `npm run check-types` (tsc --noEmit) AND the relevant test runner; Pyris runs `pytest`; Artemis runs the targeted JUnit class. Never mark a task done on a red test.

---

## Architecture orientation (read before Phase A)

Three facts that shape every task; all verified in the current code:

1. **The decision is async-over-websocket, not the POST return.** The client POSTs a `decide` (fire-and-forget, Artemis returns 202), the LLM runs, and the result arrives later on the per-user STOMP topic `/user/topic/iris/struggle-intervention` (`extension/src/extension/services/struggleIntervention/struggleEventSubscription.ts:54`), dispatched to `onServerAmbient` / `onServerActive` in the orchestrator (`struggleInterventionService.ts:214` / `:240`). **The slot reconciliation (§6) and the async/generation guard run in these inbound handlers**, not at POST time. The websocket event today carries no `episodeId`/`generation`, so correlation is by **single-flight**: the one outstanding request remembers the `(episodeId, generation)` it was issued under, and an inbound event is applied only if those still match the live slot (Phase B3). The two new modes reuse this same seam (Artemis emits `confirmClose`/`staleCheck` results as websocket events too — Phase A11, consumed in Phase C4).

2. **Two request DTOs, not one** (spec §17 conflated them). `intent` + `episode` must be added to BOTH: the inbound `IrisStruggleInterventionRequestDTO` (extension→Artemis) and the outbound `PyrisStruggleInterventionPipelineExecutionDTO` (Artemis→Pyris) plus its Pyris Pydantic mirror. `uncommittedFiles` is NOT a Pyris field — Artemis already folds it into `submission.repository` via `toPyrisSubmissionDTO(s, uncommittedFiles)`; no change there.

3. **Today ambient over-delivers** vs the spec's pull model. Current `handleDecision` ambient branch **persists a chat message** and the client **shows an inline cue**. The spec (§5) says an ambient hint is hidden, NOT stored, shows only pointers (badge + gutter icon + status-bar lamp), and is persisted only when the student clicks. So: Artemis ambient stops persisting (event-only, Phase A9); the client holds the text frozen and promotes+persists it on click via a new reveal endpoint (Phase A10 + C2); the ambient surface drops the inline cue and keeps the gutter icon only (Phase C1).

---

## File Structure

### Pyris (`/Users/liamberger/Documents/private/edutelligence/iris`)
- **Modify** `src/iris/domain/struggle/struggle_intervention_pipeline_execution_dto.py` — add `intent`, `episode` (camelCase-aliased).
- **Create** `src/iris/domain/struggle/episode_dto.py` — `EpisodeDTO`, `EpisodeHintDTO`.
- **Modify** `src/iris/domain/status/struggle_intervention_status_update_dto.py` — add `resolved`, `closing_sentence`, `episode_label`, `ask`, `question`.
- **Modify** `src/iris/pipeline/struggle_intervention_pipeline.py` — branch `build_system_message` / `get_tools` / `post_agent_hook` on `intent`; add `parse_confirm_close_result`, `parse_stale_check_result`.
- **Create** `src/iris/pipeline/prompts/templates/struggle_confirm_close_system_prompt.j2`, `struggle_stale_check_system_prompt.j2`.
- **Modify** tests under `tests/` (new parse tests; DTO round-trip tests).

### Artemis (`/Users/liamberger/Documents/private/Artemis`)
- **Modify** `.../iris/dto/IrisStruggleInterventionRequestDTO.java` — add `intent`, `episode`.
- **Create** `.../iris/dto/StruggleEpisodeDTO.java`, `.../iris/dto/StruggleEpisodeHintDTO.java`.
- **Modify** `.../iris/service/pyris/dto/struggle/PyrisStruggleInterventionPipelineExecutionDTO.java` — add `intent`, `episode`.
- **Modify** `.../iris/service/pyris/dto/struggle/PyrisStruggleInterventionStatusUpdateDTO.java` — add `resolved`, `closing_sentence`, `episode_label`, `ask`, `question`.
- **Modify** `.../iris/domain/message/IrisProactiveOutcome.java` — add `RECOVERED`, `ABANDONED`.
- **Modify** `.../iris/domain/message/IrisMessage.java` — add `proactiveEpisodeId` (nullable String; client-allocated uuid).
- **Modify** `.../iris/dto/IrisMessageResponseDTO.java` — expose `proactiveEpisodeId`.
- **Modify** `.../iris/service/session/IrisStruggleInterventionService.java` — episodeId plumbing; ambient stops persisting; `confirmClose`/`staleCheck` handling; reveal-ambient persist; outcome write.
- **Modify** `.../iris/dto/StruggleInterventionEventDTO.java` — carry the new response fields + episodeId.
- **Modify** `.../iris/service/pyris/PyrisPipelineService.java` (the `executeStruggleInterventionPipeline(...)` builder) — pass intent+episode through.
- **Create** Liquibase changelog `src/main/resources/config/liquibase/changelog/20260630120000_changelog.xml`; register in `master.xml`.
- **Modify** REST resource for the new reveal-ambient + extended proactive-outcome endpoints (the resource currently hosting `POST .../struggle-intervention` and the `proactive-outcome` PUT).
- **Modify/extend** tests under `src/test/.../iris/struggle/`.

### Extension (`/Users/liamberger/Documents/private/MA/artemis-extension`)
- **Create** `extension/src/extension/services/struggleIntervention/slot/slotManager.ts` — the slot state machine (pure).
- **Create** `.../slot/episode.ts` — `Episode`, `EpisodeHint`, id/generation types + factory.
- **Create** `.../slot/staleWatchdog.ts` — watchdog + counters (pure, injectable clock).
- **Create** `.../slot/reconcile.ts` — apply a decision against the slot (suppress/deepen/escalate decision; pure).
- **Create** `.../slot/replyRouting.ts` — free-text vs button routing decision (pure).
- **Modify** `.../struggleInterventionService.ts` — host the slot; route inbound websocket events through it; replace ad-hoc `_inFlight`/`_activeCount`/`_pendingSignal` with slot state.
- **Modify** `.../struggleEventSubscription.ts` + `.../struggleContract.ts` — carry new response fields; add `onServerClose`/`onServerStale` dispatch.
- **Modify** `.../activeNotification.ts`, `extension/src/extension/services/intervention/inlineHintDecoration.ts`, `.../interventionService.ts`, `chatWebviewProvider.ts` — pull/push surface split; gutter-only ambient; badge both levels.
- **Modify** `extension/src/extension/services/iris/chat/chatMessageService.ts` — reply-routing hook before the Artemis POST.
- **Modify** webview: `extension/src/webview/views/IrisChat/components/groupProactiveMessages.ts` (group by episodeId), `MessageBubble.tsx` + a new `StaleAskButtons.tsx` (quick-reply buttons), `ChatMessageList.tsx` (closing/fold), `types.ts` + `extension/src/shared/messageContracts/extensionMessages.ts` + `extension/src/shared/types/apiResponses.ts` (carry `proactiveEpisodeId`, new outcomes, stale-ask payload).
- **Modify** `extension/src/extension/services/struggle/config.ts` — slot TUNING knobs (`STALE_AFTER`, `STALE_WINDOW_MAX`, `staleAskCap`, ABANDON windows, re-arm threshold).
- **Create/modify** tests under `test/logic/struggleIntervention/slot/`, `test/unit/...`, `test/react/views/IrisChat/`.

---

## Phase A — Wire & backend contract (Pyris + Artemis)

Bottom-up: define the DTO contract on both ends, then the pipeline modes, then the Artemis decision/persistence changes. Each task is independently testable with pytest or a JUnit class.

### Task A1: Pyris request DTO — `intent` + `episode`

**Files:**
- Create: `/Users/liamberger/Documents/private/edutelligence/iris/src/iris/domain/struggle/episode_dto.py`
- Modify: `/Users/liamberger/Documents/private/edutelligence/iris/src/iris/domain/struggle/struggle_intervention_pipeline_execution_dto.py`
- Test: `/Users/liamberger/Documents/private/edutelligence/iris/tests/test_struggle_execution_dto.py`

**Interfaces:**
- Produces: `EpisodeDTO(episode_id: str, is_new: bool, hints: list[EpisodeHintDTO])`, `EpisodeHintDTO(level: Literal["ambient","active"], text: str, at_session_s: float)`, both camelCase-aliased; `StruggleInterventionPipelineExecutionDTO.intent: Literal["decide","confirm_close","stale_check"] = "decide"` (snake wire values, §17) and `.episode: Optional[EpisodeDTO] = None`.

- [ ] **Step 1: Write the failing test** (append to `test_struggle_execution_dto.py`)

```python
def test_execution_dto_parses_intent_and_episode_camelcase():
    payload = {
        "struggleSignal": _minimal_signal(),  # reuse the helper already in this file
        "intent": "stale_check",
        "episode": {
            "episodeId": "ep-1",
            "isNew": False,
            "hints": [{"level": "ambient", "text": "check the loop bound", "atSessionS": 42.0}],
        },
    }
    dto = StruggleInterventionPipelineExecutionDTO.model_validate(payload)
    assert dto.intent == "stale_check"
    assert dto.episode.episode_id == "ep-1"
    assert dto.episode.is_new is False
    assert dto.episode.hints[0].level == "ambient"
    assert dto.episode.hints[0].at_session_s == 42.0


def test_execution_dto_intent_defaults_to_decide_when_absent():
    dto = StruggleInterventionPipelineExecutionDTO.model_validate(
        {"struggleSignal": _minimal_signal()}
    )
    assert dto.intent == "decide"
    assert dto.episode is None
```

- [ ] **Step 2: Run it, expect failure** — `pytest tests/test_struggle_execution_dto.py -k intent -v` → FAIL (`intent`/`episode` unknown).

- [ ] **Step 3: Create `episode_dto.py`**

```python
from typing import List, Literal
from pydantic import BaseModel, ConfigDict, Field


class EpisodeHintDTO(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    level: Literal["ambient", "active"]
    text: str
    at_session_s: float = Field(alias="atSessionS")


class EpisodeDTO(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    episode_id: str = Field(alias="episodeId")
    is_new: bool = Field(alias="isNew")
    hints: List[EpisodeHintDTO] = Field(default_factory=list)
```

- [ ] **Step 4: Add the two fields** to `StruggleInterventionPipelineExecutionDTO` (after `user`):

```python
    intent: Literal["decide", "confirm_close", "stale_check"] = "decide"
    episode: Optional[EpisodeDTO] = None
```

Import `EpisodeDTO` and `Literal`/`Optional` at the top. `intent` needs no alias (the field name `intent` is already snake-safe and its values are snake_case `decide`/`confirm_close`/`stale_check`); the default keeps existing `decide`-only callers valid.

- [ ] **Step 5: Run tests** — `pytest tests/test_struggle_execution_dto.py -v` → PASS.

- [ ] **Step 6: Commit** — `git add src/iris/domain/struggle/episode_dto.py src/iris/domain/struggle/struggle_intervention_pipeline_execution_dto.py tests/test_struggle_execution_dto.py && git commit -m "feat(struggle): add intent + episode to Pyris execution DTO"`

### Task A2: Pyris response DTO — `resolved` / `closing_sentence` / `episode_label` / `ask` / `question`

**Files:**
- Modify: `/Users/liamberger/Documents/private/edutelligence/iris/src/iris/domain/status/struggle_intervention_status_update_dto.py`
- Test: `/Users/liamberger/Documents/private/edutelligence/iris/tests/test_struggle_status_update_dto.py`

**Interfaces:**
- Produces: five new `Optional[...] = None` fields, all serialized snake_case (no aliases), on `StruggleInterventionStatusUpdateDTO`.

- [ ] **Step 1: Failing test** (append)

```python
def test_status_update_serializes_new_mode_fields_snake_case():
    dto = StruggleInterventionStatusUpdateDTO(
        stages=[],
        resolved=True,
        closing_sentence="Nice, that was the wrong index.",
        episode_label="Wrong index",
        ask=False,
        question=None,
    )
    dumped = dto.model_dump(by_alias=True)
    assert dumped["resolved"] is True
    assert dumped["closing_sentence"] == "Nice, that was the wrong index."
    assert dumped["episode_label"] == "Wrong index"
    assert dumped["ask"] is False
    assert "question" in dumped
```

- [ ] **Step 2: Run, expect failure** — `pytest tests/test_struggle_status_update_dto.py -k new_mode -v` → FAIL.

- [ ] **Step 3: Add the fields** (after `inline_hint`):

```python
    # confirm_close mode
    resolved: Optional[bool] = None
    closing_sentence: Optional[str] = None
    episode_label: Optional[str] = None
    # stale_check mode
    ask: Optional[bool] = None
    question: Optional[str] = None
```

(`Optional` already imported in this module; if not, add it.)

- [ ] **Step 4: Run** — `pytest tests/test_struggle_status_update_dto.py -v` → PASS.

- [ ] **Step 5: Commit** — `git add src/iris/domain/status/struggle_intervention_status_update_dto.py tests/test_struggle_status_update_dto.py && git commit -m "feat(struggle): add confirmClose/staleCheck fields to Pyris status DTO"`

### Task A3: Pyris pipeline — `intent` dispatch + `confirmClose` parse/template

**Files:**
- Modify: `/Users/liamberger/Documents/private/edutelligence/iris/src/iris/pipeline/struggle_intervention_pipeline.py`
- Create: `/Users/liamberger/Documents/private/edutelligence/iris/src/iris/pipeline/prompts/templates/struggle_confirm_close_system_prompt.j2`
- Test: `/Users/liamberger/Documents/private/edutelligence/iris/tests/test_struggle_intervention_pipeline.py`

**Interfaces:**
- Consumes: `dto.intent`, `dto.episode` (Task A1); status fields (Task A2).
- Produces: `parse_confirm_close_result(raw: str) -> ConfirmCloseResult` where `ConfirmCloseResult(resolved: bool, closing_sentence: Optional[str], episode_label: Optional[str], rationale: Optional[str])`; `build_system_message` selects the template by `state.dto.intent`; `post_agent_hook` maps the confirmClose result onto the status DTO.

- [ ] **Step 1: Failing test** (append) — the JSON contract for confirmClose is `{ "resolved": bool, "closingSentence": str?, "episodeLabel": str?, "rationale": str? }`.

```python
from iris.pipeline.struggle_intervention_pipeline import parse_confirm_close_result

def test_parse_confirm_close_resolved_true():
    r = parse_confirm_close_result(
        '{"resolved": true, "closingSentence": "Nice 👍", "episodeLabel": "Wrong index"}'
    )
    assert r.resolved is True
    assert r.closing_sentence == "Nice 👍"
    assert r.episode_label == "Wrong index"

def test_parse_confirm_close_resolved_false_carries_offer_in_rationale():
    r = parse_confirm_close_result('{"resolved": false, "rationale": "empty-list case still trips"}')
    assert r.resolved is False
    assert r.closing_sentence is None
    assert r.episode_label is None
    assert r.rationale == "empty-list case still trips"

def test_parse_confirm_close_malformed_fails_closed_to_not_resolved():
    r = parse_confirm_close_result("not json")
    assert r.resolved is False
```

- [ ] **Step 2: Run, expect failure** — `pytest tests/test_struggle_intervention_pipeline.py -k confirm_close -v` → FAIL (import error).

- [ ] **Step 3: Add `ConfirmCloseResult` + `parse_confirm_close_result`** to the pipeline module (mirror the existing `GateResult`/`parse_gate_result` JSON-substring + fail-closed style):

```python
@dataclass
class ConfirmCloseResult:
    resolved: bool
    closing_sentence: Optional[str]
    episode_label: Optional[str]
    rationale: Optional[str]


def parse_confirm_close_result(raw: str) -> ConfirmCloseResult:
    obj = _extract_json_object(raw)  # reuse the helper parse_gate_result already uses
    if obj is None:
        return ConfirmCloseResult(False, None, None, None)
    resolved = obj.get("resolved")
    if not isinstance(resolved, bool):
        return ConfirmCloseResult(False, None, None, _as_opt_str(obj.get("rationale")))
    if resolved:
        return ConfirmCloseResult(
            True, _as_opt_str(obj.get("closingSentence")), _as_opt_str(obj.get("episodeLabel")),
            _as_opt_str(obj.get("rationale")),
        )
    return ConfirmCloseResult(False, None, None, _as_opt_str(obj.get("rationale")))
```

If `parse_gate_result` inlines its JSON extraction, factor out `_extract_json_object(raw)` and `_as_opt_str(v)` helpers first (small refactor; keep `parse_gate_result` behaviour identical and its tests green).

- [ ] **Step 4: Create the template** `struggle_confirm_close_system_prompt.j2` — instruct Iris to RE-READ the code (it has `get_problem_statement`, `get_feedbacks`, repository tools) and decide if the struggle is genuinely resolved; return ONLY `{ "resolved": <bool>, "closingSentence": "<warm praise + problem name, only if resolved>", "episodeLabel": "<short fold name, only if resolved>", "rationale": "<one gentle offer line, only if NOT resolved>" }`. Pass `signal_summary` + the episode's hints (so Iris knows what it already said). No solution repo.

- [ ] **Step 5: Branch the pipeline.** In `build_system_message`, select the template:

```python
def build_system_message(self, state):
    intent = getattr(state.dto, "intent", "decide")
    tmpl = {
        "decide": self.system_prompt_template,
        "confirm_close": self.confirm_close_template,
        "stale_check": self.stale_check_template,   # added in A4
    }[intent]
    return tmpl.render(course_name=..., signal_summary=summarize_signal(state.dto.struggle_signal),
                       episode=state.dto.episode)
```

Load `self.confirm_close_template` in `__init__`. In `post_agent_hook`, branch on `intent`: for `confirm_close`, set `status.resolved/closing_sentence/episode_label`, and put the offer line into `status.rationale` when `resolved=False`; call `cb.done(...)` without a `result` hint.

- [ ] **Step 6: Run** — `pytest tests/test_struggle_intervention_pipeline.py -v` → PASS (existing `parse_gate_result` tests stay green).

- [ ] **Step 7: Commit** — stage the pipeline file, the new template, the test → `git commit -m "feat(struggle): add confirmClose mode to struggle pipeline"`

### Task A4: Pyris pipeline — `staleCheck` parse/template

**Files:**
- Modify: `struggle_intervention_pipeline.py`
- Create: `.../templates/struggle_stale_check_system_prompt.j2`
- Test: `test_struggle_intervention_pipeline.py`

**Interfaces:**
- Produces: `parse_stale_check_result(raw) -> StaleCheckResult(ask: bool, question: Optional[str])`; `post_agent_hook` maps it to `status.ask/question`.

- [ ] **Step 1: Failing test** — contract `{ "ask": bool, "question": str? }`.

```python
from iris.pipeline.struggle_intervention_pipeline import parse_stale_check_result

def test_parse_stale_check_ask_true_with_question():
    r = parse_stale_check_result('{"ask": true, "question": "Did you get past the empty-list case?"}')
    assert r.ask is True
    assert r.question == "Did you get past the empty-list case?"

def test_parse_stale_check_ask_false_is_noop():
    r = parse_stale_check_result('{"ask": false}')
    assert r.ask is False
    assert r.question is None

def test_parse_stale_check_ask_true_without_question_fails_closed_to_noop():
    # ask=true but no usable question -> treat as noop so the client never posts an empty ask
    r = parse_stale_check_result('{"ask": true}')
    assert r.ask is False
```

- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Add `StaleCheckResult` + `parse_stale_check_result`** (fail-closed: malformed or ask-without-question → `ask=False`).
- [ ] **Step 4: Create `struggle_stale_check_system_prompt.j2`** — Iris judges task-relevance ("is problem A still the active task, or did the student move on — even within the same file?") using `get_problem_statement` + `get_feedbacks` + current code; returns `{ "ask": <bool>, "question": "<one quiet 'did you get past X?' line, only if ask>" }`. Language-agnostic, no file-switch heuristic.
- [ ] **Step 5: Branch `post_agent_hook`** for `staleCheck` → set `status.ask/question`.
- [ ] **Step 6: Run** — `pytest tests/test_struggle_intervention_pipeline.py -v` → PASS.
- [ ] **Step 7: Commit** — `git commit -m "feat(struggle): add staleCheck mode to struggle pipeline"`

### Task A5: Pyris route smoke test (no code change expected)

**Files:** Test only: `/Users/liamberger/Documents/private/edutelligence/iris/tests/test_struggle_route.py`

The route/worker/callback (`pipelines.py:378`, `run_struggle_intervention_pipeline_worker`, `StruggleInterventionCallback`) are intent-agnostic — they pass the DTO through. Add a regression test asserting a `confirmClose` payload validates and routes without 422.

- [ ] **Step 1:** Add a test posting a minimal `{"struggleSignal":..., "intent":"confirm_close", "episode":{...}}` body through the existing route-test harness; assert 202 and that the worker is invoked with `dto.intent == "confirm_close"`.
- [ ] **Step 2: Run** — `pytest tests/test_struggle_route.py -v` → PASS (if it fails, the DTO default/validation from A1 is wrong — fix there, not here).
- [ ] **Step 3: Commit** — `git commit -m "test(struggle): cover intent routing through the struggle pipeline route"`

### Task A6: Artemis request DTOs — thread `intent` + `episode` through both hops

**Files:**
- Create: `.../iris/dto/StruggleEpisodeDTO.java`, `.../iris/dto/StruggleEpisodeHintDTO.java`
- Modify: `.../iris/dto/IrisStruggleInterventionRequestDTO.java` (inbound: extension→Artemis)
- Modify: `.../iris/service/pyris/dto/struggle/PyrisStruggleInterventionPipelineExecutionDTO.java` (outbound: Artemis→Pyris)
- Modify: `.../iris/service/pyris/PyrisPipelineService.java` (`executeStruggleInterventionPipeline(...)` — pass the new args)
- Modify: `.../iris/service/session/IrisStruggleInterventionService.java` (`requestStruggleIntervention`/`prepareTrigger`/`sendToPyris` — forward intent+episode; capture episodeId on the job)
- Modify: `.../iris/service/pyris/job/StruggleInterventionJob.java` (add `episodeId` so the async callback can correlate, Critical fix)
- Modify: `.../iris/service/pyris/PyrisJobService.java` (or wherever `addStruggleInterventionJobIfNonePending` lives) — accept + store the episodeId
- Test: `.../iris/struggle/IrisStruggleInterventionRequestDTOTest.java`, `PyrisStruggleInterventionExecutionDTOTest.java`, `StruggleInterventionJobTest.java`

**Interfaces:**
- Produces: `StruggleEpisodeDTO(String episodeId, boolean isNew, List<StruggleEpisodeHintDTO> hints)`, `StruggleEpisodeHintDTO(String level, String text, double atSessionS)` (camelCase, no `@JsonProperty`). `IrisStruggleInterventionRequestDTO` gains `String intent` (default `"decide"`, wire values `decide`/`confirm_close`/`stale_check`), `@Nullable StruggleEpisodeDTO episode`, and `@Nullable String confirmReason` (∈ {`"progress"`,`"stale_solved"`,`"parked_progress"`}, only set on a `confirm_close` POST — disambiguates §7.1-delivered (`progress`, quiet on false) vs §7.3 (`stale_solved`, offer on false) vs §4-PARKED (`parked_progress`, silent: no message/outcome on true, stays PARKED on false), A11). `IrisStruggleInterventionRequestDTO` ALSO gains `String requestToken` (a client-minted uuid stamped on **every** struggle request — the scoped-cancel identity, A10). The outbound exec DTO gains `intent` + `episode` (NOT `requestToken` — that is Artemis-internal). `StruggleInterventionJob` gains `@Nullable String intent`, `@Nullable String episodeId`, `@Nullable String confirmReason`, `@Nullable String requestToken` (so A11 routes by the **authoritative `job.intent()`** and the cancel matches `job.requestToken()`).

> **Why the job needs `episodeId` (Critical, from review).** The Pyris decision arrives async over the websocket and does NOT echo the episodeId; the existing job carries only `jobId/courseId/exerciseId/userId`. So the **client-allocated episodeId from the inbound request must be stamped onto the job** when it is created (`prepareTrigger` → `addStruggleInterventionJobIfNonePending`), so `handleDecision`/`handleConfirmClose`/`handleStaleCheck` (A9/A11) and the canonical outcome write (A10 primitive) can recover it. This is the server-side correlation store.

- [ ] **Step 1: Failing serialization test** for the inbound DTO — assert a JSON body `{"struggleSignal":..., "intent":"stale_check", "confirmReason":"stale_solved", "requestToken":"rt-1", "episode":{"episodeId":"ep-1","isNew":false,"hints":[{"level":"ambient","text":"x","atSessionS":42.0}]}}` deserializes with `intent()=="stale_check"`, `confirmReason()=="stale_solved"`, `requestToken()=="rt-1"`, and `episode().hints().get(0).level()=="ambient"`. **Assert each `confirmReason` snake value round-trips: `"progress"`, `"stale_solved"`, `"parked_progress"` (this pins the load-bearing close-mode discriminator against a silent casing/typo mismatch — Medium fix).** Use the project's `ObjectMapper` test util.
- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Create the two episode records** (plain Java records, camelCase fields). **Do NOT put `@JsonInclude(NON_EMPTY)` on `StruggleEpisodeDTO` (nor on the `hints` field):** the contract requires the first FREE-slot `decide` to serialize `episode: { episodeId, isNew: true, hints: [] }` (spec §11/§17), and `NON_EMPTY` would **drop the empty `hints: []`** — a real cross-repo break on the most important boundary case. Use default inclusion (`ALWAYS`) so `episode` and `hints` (even empty) always serialize. (`StruggleEpisodeHintDTO` may use `NON_EMPTY` freely — it is only emitted inside a non-empty `hints` list.) Add a serialization test asserting `{"episode":{"episodeId":"ep-1","isNew":true,"hints":[]}}` round-trips with `hints` PRESENT and empty.
- [ ] **Step 4: Add `intent` + `episode`** to `IrisStruggleInterventionRequestDTO`; default `intent` to `"decide"` and `episode` to `null` in the compact constructor (preserves existing `decide`-only callers).
- [ ] **Step 5: Add the same to `PyrisStruggleInterventionPipelineExecutionDTO`** (outbound) and thread them through `PyrisPipelineService.executeStruggleInterventionPipeline(...)` and `IrisStruggleInterventionService.sendToPyris(...)`. The `decide` path passes `intent="decide", episode=<the live episode block built from the client request>`.
- [ ] **Step 6: Stamp `intent` + `episodeId` + `confirmReason` + `requestToken` on the job.** Add `@Nullable String intent` + `@Nullable String episodeId` + `@Nullable String confirmReason` + `@Nullable String requestToken` to `StruggleInterventionJob`; pass `request.intent()`, `request.episode().episodeId()` (null-guarded), `request.confirmReason()`, and `request.requestToken()` into `addStruggleInterventionJobIfNonePending(...)` from `prepareTrigger`/`requestStruggleIntervention` so the async callback (A9/A11) can recover all four and the cancel (A10) can match `requestToken`. **A11 routes by `job.intent()` (authoritative), not by nullable response-field presence.** The client always sends a non-null `episode` (C3 preallocation), but null-guard defensively. Add a `StruggleInterventionJobTest` assertion that all four round-trip on the job.
- [ ] **Step 7: Run** the DTO + job test classes → PASS.
- [ ] **Step 8: Commit** — stage the new records, both DTOs, the pipeline service, the session service, the job, the tests → `git commit -m "feat(struggle): thread intent + episode + job episodeId through Artemis request path"`

### Task A7: Artemis response DTO — new mode fields

**Files:**
- Modify: `.../iris/service/pyris/dto/struggle/PyrisStruggleInterventionStatusUpdateDTO.java`
- Test: `.../iris/struggle/PyrisStruggleInterventionStatusUpdateDTOTest.java`

**Interfaces:**
- Produces: five new nullable components: `@Nullable Boolean resolved`, `@JsonProperty("closing_sentence") @Nullable String closingSentence`, `@JsonProperty("episode_label") @Nullable String episodeLabel`, `@Nullable Boolean ask`, `@Nullable String question`.

- [ ] **Step 1: Failing test** — deserialize a snake_case body `{"resolved":true,"closing_sentence":"Nice","episode_label":"Wrong index"}` and assert `resolved()==true && closingSentence().equals("Nice") && episodeLabel().equals("Wrong index")`; a `{"ask":false}` body → `ask()==false`.
- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Add the five components** with the `@JsonProperty` snake aliases shown above; update the compact constructor only if it enforces non-null on existing fields (the new ones are nullable).
- [ ] **Step 4: Run** the DTO test → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(struggle): add confirmClose/staleCheck fields to Artemis status DTO"`

### Task A8: Artemis — `IrisProactiveOutcome` enum values + Liquibase ENUM widening

**Files:**
- Modify: `.../iris/domain/message/IrisProactiveOutcome.java`
- Create: `.../config/liquibase/changelog/20260630120000_changelog.xml`
- Modify: `.../config/liquibase/master.xml`
- Test: a small JUnit asserting `IrisProactiveOutcome.valueOf("RECOVERED")` / `"ABANDONED"` resolve.

**Interfaces:**
- Produces: `enum IrisProactiveOutcome { DISMISSED, RECOVERED, ABANDONED }`.

- [ ] **Step 1: Failing test** — `assertThat(IrisProactiveOutcome.values()).contains(RECOVERED, ABANDONED)`.
- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Add `RECOVERED, ABANDONED`** to the enum.
- [ ] **Step 4: Create the changelog** mirroring `20260627120000_changelog.xml`'s split-by-DB pattern. The MySQL/H2 column is `ENUM('DISMISSED')` and MUST be widened (postgres `text` needs nothing):

```xml
<?xml version="1.1" encoding="UTF-8" standalone="no"?>
<databaseChangeLog xmlns="http://www.liquibase.org/xml/ns/dbchangelog"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog
        http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-latest.xsd">

    <changeSet id="20260630120000-1-widen-proactive-outcome-enum-mysql" author="liam-berger" dbms="mysql,h2">
        <modifyDataType tableName="iris_message" columnName="proactive_outcome"
                        newDataType="ENUM('DISMISSED','RECOVERED','ABANDONED')"/>
    </changeSet>

    <changeSet id="20260630120000-2-add-proactive-episode-id-mysql" author="liam-berger" dbms="mysql,h2">
        <preConditions onFail="MARK_RAN">
            <not><columnExists tableName="iris_message" columnName="proactive_episode_id"/></not>
        </preConditions>
        <addColumn tableName="iris_message">
            <column name="proactive_episode_id" type="varchar(64)"/>
        </addColumn>
    </changeSet>

    <changeSet id="20260630120000-2-add-proactive-episode-id-postgres" author="liam-berger" dbms="postgresql">
        <preConditions onFail="MARK_RAN">
            <not><columnExists tableName="iris_message" columnName="proactive_episode_id"/></not>
        </preConditions>
        <addColumn tableName="iris_message">
            <column name="proactive_episode_id" type="varchar(64)"/>
        </addColumn>
    </changeSet>

    <changeSet id="20260630120000-3-add-proactive-client-message-id" author="liam-berger">
        <preConditions onFail="MARK_RAN">
            <not><columnExists tableName="iris_message" columnName="proactive_client_message_id"/></not>
        </preConditions>
        <addColumn tableName="iris_message">
            <column name="proactive_client_message_id" type="varchar(64)"/>
        </addColumn>
        <createIndex tableName="iris_message" indexName="ux_iris_message_proactive_client_message_id" unique="true">
            <column name="proactive_client_message_id"/>
        </createIndex>
    </changeSet>
</databaseChangeLog>
```

(This single changelog covers the enum widening AND both new columns from Task A9 — they share one timestamped file. Postgres stores the enum as `text`, so no widening changeset is needed there. `proactive_client_message_id` is nullable with a **unique** index so the reveal upsert (A10) is atomic and collision-proof; the index allows many NULLs.)

> **`episodeId` is a CLIENT-allocated string (uuid), not a DB-generated id.** The client preallocates `episodeId` on the first `decide` of a FREE slot (spec §17/§11, Task B1 `idgen: () => string`). So `proactive_episode_id` is `varchar(64)` (NOT `bigint`), the entity field is `String`, every DTO/event/finder uses `String episodeId`, and the extension `proactiveEpisodeId` is `string`. There is no numeric episode id anywhere.

- [ ] **Step 5: Register** in `master.xml` — append `<include file="classpath:config/liquibase/changelog/20260630120000_changelog.xml" relativeToChangelogFile="false"/>` after the last existing include.
- [ ] **Step 6: Run** the enum test + `./gradlew liquibaseValidate` (or the project's changelog-validation task) → PASS.
- [ ] **Step 7: Commit** — `git commit -m "feat(struggle): add RECOVERED/ABANDONED outcomes + proactive_episode_id/proactive_client_message_id columns"`

### Task A9: Artemis — `proactiveEpisodeId` on entity + response DTO; ambient stops persisting

**Files:**
- Modify: `.../iris/domain/message/IrisMessage.java` (field + getter/setter)
- Modify: `.../iris/dto/IrisMessageResponseDTO.java` (component + `of(...)` mapping)
- Modify: `.../iris/dto/StruggleInterventionEventDTO.java` (add the correlation fields `String episodeId` + `String kind` HERE so this task is buildable in isolation — High fix; A11 adds the mode payload fields later)
- Modify: `.../iris/service/session/IrisStruggleInterventionService.java` (`persistProactiveMessage` takes episodeId; `handleDecision` ambient branch becomes event-only; `silent` emits a completion event)
- Modify: `.../iris/api/...` repository — the canonical-row finder `findFirstByProactiveEpisodeIdOrderBySentAtAsc` (the deterministic write TARGET) + a `readEpisodeOutcome(episodeId)` helper that returns the episode's terminal outcome **episode-wide** — the single non-null `proactive_outcome` across **all** rows tagged with that `proactiveEpisodeId` (at most one exists, by first-terminal-wins A10), NOT just the outcome on the earliest row. Reading episode-wide is what makes the outcome **stable under out-of-order persistence**: if the delivery (earliest-`sentAt`) row's persist is still pending while a later row already persisted, the "earliest persisted row" identity shifts over time, but the episode's outcome does not. (A10 adds the write side and reuses the finder, so there is no forward dependency.)
- Test: `.../iris/struggle/IrisStruggleInterventionDecisionTest.java`

**Interfaces:**
- Consumes: column from A8.
- Produces: `IrisMessage.getProactiveEpisodeId()/setProactiveEpisodeId(String)`; `IrisMessageResponseDTO` exposes `@Nullable String proactiveEpisodeId`; `StruggleInterventionEventDTO` gains `String episodeId` + `String kind` (∈ {`decide`,`confirm_close`,`stale_check`}); `persistProactiveMessage(User, long exerciseId, String result, String proactiveEpisodeId)`; `findFirstByProactiveEpisodeIdOrderBySentAtAsc` (write target) + `readEpisodeOutcome(String episodeId): IrisProactiveOutcome|null` (**episode-wide**: the single non-null outcome across all rows with that episodeId; consumed by the terminal-gate in this task and reused by A10/A11).

- [ ] **Step 1: Failing test (entity/DTO)** — `IrisMessageResponseDTO.of(msg)` carries `proactiveEpisodeId` when set.
- [ ] **Step 2: Failing test (decision)** — extend `IrisStruggleInterventionDecisionTest`: for `action="ambient"`, assert `persistProactiveMessage` is **NOT** called (no chat row) and only the websocket event is emitted; for `action="active"`, assert it IS called with the episodeId; **for `action="silent"` (or a null/empty result), assert a `kind="decide", action="silent"` noop completion event IS emitted (no persist)** — without it the client cannot know an async silent `decide` finished, so the preallocated candidate + the single-flight outstanding would never clear (Critical fix). This encodes the §5 pull-model change.
- [ ] **Step 3: Run, expect failure** (current code persists on ambient).
- [ ] **Step 4: Add the field(s)** to `IrisMessage` (`@Nullable @Column(name="proactive_episode_id") private String proactiveEpisodeId;` AND `@Nullable @Column(name="proactive_client_message_id") private String proactiveClientMessageId;` next to `proactiveOutcome`) + getters/setters (`proactiveClientMessageId` is set ONLY by `revealAmbient`, A10 — the reveal idempotency key); add the `@Nullable String proactiveEpisodeId` component to `IrisMessageResponseDTO` + map it in `of(...)` (the client message id is NOT exposed on the DTO — server-internal); add `String episodeId` + `String kind` to `StruggleInterventionEventDTO`.
- [ ] **Step 5: Change `handleDecision`** — the `"ambient"` branch no longer calls `persistProactiveMessage`; it only emits the `StruggleInterventionEventDTO` (`kind="decide"`, carrying the hint text + episodeId **+ the resolved `sessionId`** so the client can hold it frozen AND knows which session to reveal into, C2). Since it no longer persists a message, **resolve the proactive session id directly** (the get-or-create proactive session for the exercise/user that `persistProactiveMessage` used internally) and put it on the event — the event must still carry a valid `sessionId` even though no row is saved.
  > **`"active"` first-delivery failure/retry path (High fix — §5 "bubble appears automatically" + §12 "first persist retried on failure").** The `active` branch: (a) **skip + emit a `kind="decide", action="silent"` completion event** if `readEpisodeOutcome(episodeId)` is already terminal (a late escalation after dismiss); else (b) **persist WITH the episodeId, retried on transient failure** (bounded retry around the save — this is §12's "retried on failure"); (c) on success → `sendMessage` (chat-ws, the canonical bubble row) AND emit the `active` control event carrying **the hint text + the persisted `messageId` + sessionId**; (d) on **permanent** persist failure → STILL emit the `active` control event carrying **the hint text + `messageId=null`** so the client (1) always gets a completion frame (clears its in-flight `decide` — never stuck), (2) applies the DELIVERED transition (protection is immediate, §12), and (3) shows a **runtime fallback bubble** from the event text (§5's bubble is never lost; runtime-only, gone on reload → "episode absent from analysis", §12). **The control event ALWAYS carries the hint text** so the client can render the bubble whether or not the persist succeeded; when the persist DID succeed the client tags its optimistic bubble with the event `messageId` so the chat-ws row (same id) is **deduped** (C4) — one bubble. So §5's automatic bubble is immediate and never lost to a single persist failure, and §12's canonical row is retried.
  The `"silent"` branch (and the current null/empty-result early return) **emits a `kind="decide", action="silent"` noop completion event** (episodeId, no persist) so the client always receives a completion frame for its outstanding `decide`. `persistProactiveMessage` gains the `String proactiveEpisodeId` param and `message.setProactiveEpisodeId(...)`.
- [ ] **Step 6: Run** both test classes → PASS.
- [ ] **Step 7: Commit** — `git commit -m "feat(struggle): persist proactive_episode_id; ambient no longer auto-persists (pull model)"`

### Task A10: Artemis — reveal-ambient persist + canonical outcome primitives

> **Ordering (fixes the big-bang finding): this task introduces the reveal + outcome primitives that A11 (handlers) and C2/C3/C5/C8 (client) consume — implement it BEFORE A11.**

**Files:**
- Modify: the REST resource hosting the struggle endpoints (the one with `POST .../struggle-intervention` and the `proactive-outcome` PUT) — add `POST .../episodes/{episodeId}/reveal`, `DELETE .../messages/{messageId}/proactive`, `POST .../struggle-intervention/cancel`, and extend the outcome endpoint.
- Modify: `.../iris/service/session/IrisStruggleInterventionService.java` (`revealAmbient(...)`, `writeEpisodeOutcome(...)`, `deleteSupersededProactiveMessage(...)`, `cancelOutstandingStruggleJob(...)`) — reuses the `findFirstByProactiveEpisodeIdOrderBySentAtAsc` finder added in A9.
- Test: `.../iris/struggle/...` (a focused service test) + the endpoint integration test.

**Interfaces:**
- Produces: `revealAmbient(User, long exerciseId, String episodeId, String hintText, String level, String clientMessageId) -> IrisMessageResponseDTO` → persists the previously-hidden ambient hint as a PROACTIVE_STRUGGLE message tagged with `proactiveEpisodeId`, with a **server-assigned `sentAt`** (Artemis clock — authoritative, so ALL rows order on one clock), and **returns the persisted message DTO** (`id`=messageId + `proactiveEpisodeId`) so the client can reconcile its optimistic bubble (C2). **Idempotency via a client-generated key (deterministic, collision-proof — fixes the reveal-retry ambiguity):** the reveal is an **upsert keyed on `proactive_client_message_id = clientMessageId`** (the optimistic bubble's `localId`, a client uuid, A8 unique index) — `INSERT … ON CONFLICT(proactive_client_message_id) DO NOTHING` then `SELECT` the row (or `findByProactiveClientMessageId` then create). A lost-response retry reuses the **same `clientMessageId`** and returns the **same row** — never a duplicate, and (unlike a content/timestamp key) **cannot collide** with a same-text escalation or any other row, because the uuid is unique to this reveal. **The reveal row does NOT need to be the earliest-`sentAt` "canonical" row:** outcome existence/read/write are **episode-wide** (below), so canonical correctness no longer depends on reveal ordering — this is why server-authoritative `sentAt` is safe here even if a reveal retry lands after a stale-ask. `writeEpisodeOutcome(String episodeId, IrisProactiveOutcome outcome)` → **episode-wide first-terminal-wins** (see below): writes to the **earliest-`sentAt` persisted** proactive-origin row for that episode (the deterministic write TARGET, all on the server clock) only if NO row of the episode already carries a terminal outcome.

> **Episode-wide first-terminal-wins (the conflict rule — fixes the race between the server-side `RECOVERED` write A11 and the client-side `ABANDONED`/`DISMISSED` writes C5/C8, AND the canonical-row instability under out-of-order persistence §12).** The existence check is **episode-wide, not row-scoped**: `writeEpisodeOutcome` writes the outcome ONLY if **no row** of that `proactiveEpisodeId` currently has a non-null `proactive_outcome`; the write lands on the earliest-`sentAt` persisted row. If ANY row of the episode already holds a terminal value: a re-write of the SAME value is a no-op; a DIFFERENT value is **ignored** (the first terminal outcome stands, no overwrite). **Why episode-wide and not "the canonical row":** the canonical row is "the earliest-`sentAt` **persisted** row" (§12), and that identity is **unstable** while the delivery row's persist is still pending — a later stale-ask/offer/close row can momentarily BE the earliest persisted row. A row-scoped check would then (1) write the outcome onto that later row, and (2) when the delivery row's retry finally persists (earlier `sentAt`, null outcome), a row-scoped re-check would see the new canonical as null and **double-write**. Episode-wide existence prevents both: the FIRST terminal write anywhere on the episode stands, and `readEpisodeOutcome` (A9) reads episode-wide, so the outcome is found regardless of which row physically holds it. Implement atomically: a conditional update guarded by `WHERE proactive_episode_id = :ep AND id = (earliest persisted) AND NOT EXISTS (SELECT 1 FROM iris_message WHERE proactive_episode_id = :ep AND proactive_outcome IS NOT NULL)` (single statement, so the existence check and the write are one atomic step).

> **No canonical row yet → DEFERRED (signalled), not a silent noop — so an EXPLICIT terminal outcome is never lost (Critical fix).** A delivered episode whose first proactive persist is still pending/failed has **no canonical row** (§12 "delivered but first persist still pending"). `writeEpisodeOutcome` / the `proactive-outcome` endpoint on such an episodeId does **not** error (never 404/500) **and does not silently drop the write**: it returns a **body-bearing `200 { "applied": false }`** when no row exists (vs `200 { "applied": true }` when it landed). **(Always `200` + a JSON body — NOT `204`: a `204 No Content` response must not carry a body, so it could not deterministically convey `applied`.)** **Why distinct:** a SILENT noop loses an *explicit* `DISMISSED`/`ABANDONED` the student already performed if the reveal row later persists (it would then show null-outcome — wrong). The distinction lets the client **back-fill**: on `applied=false` the client records a **pending terminal outcome** for `(sessionId, episodeId)` and re-applies it once the canonical row exists (C2 reveal-retry flush / a bounded pending-outcome retry, C5/C8). So `null`-outcome attrition is reserved for the genuinely-lost cases (reload before any persist, permanent persist failure); an explicit terminal action is **always eventually written** once a row exists. (`writeEpisodeOutcome`'s episode-wide first-terminal-wins, above, makes the back-filled write idempotent.)

> **Cancel-outstanding-job primitive, SCOPED to a specific request (so a freed slot RE-OPENS the wire immediately — spec §2/§6/§7.2 — without a cancel(A) ever removing a since-started B).** `cancelOutstandingStruggleJob(User, long exerciseId, String requestToken)` → `POST .../struggle-intervention/cancel` → **removes the pending struggle job ONLY IF its stamped `requestToken` matches** (the same `removeJob` the completion wrapper uses, A11, guarded by the token), releasing Artemis's single-outstanding reservation. Idempotent: no matching pending job → **204 noop**. **`requestToken` is a client-minted uuid stamped on EVERY struggle request** (A6: on the request DTO + the `StruggleInterventionJob`); it uniquely identifies the one outstanding request. **Why scoped (Critical fix):** an UNscoped "remove whatever is pending" races — `cancel(A)` could arrive after A already completed server-side AND a new request B was accepted, and then remove **B** (the wrong intervention). Matching the token means `cancel(A)` removes A or nothing — never B (B carries a different token). **Why it is needed at all:** the client mirrors single-outstanding (no second POST while one is outstanding), but the spec says **freeing the slot immediately re-opens the gate**. So whenever the orchestrator frees a slot **while a struggle request is still in flight** (C3), it calls this with **that request's token**, releasing the wire so the next `decide` POSTs at once. The cancelled job's late Pyris result then finds **no job** (dropped server-side; the client also drops it by generation). (A `replace` does NOT cancel — there the in-flight `decide` IS the one completing into the replacement.)

> **Supersede-delete primitive (makes the stale-row suppression DURABLE, not just live — completes the C4 Critical fix).** `deleteSupersededProactiveMessage(User, long messageId)` → `DELETE .../messages/{messageId}/proactive`. It removes the row **only if** it is `PROACTIVE_STRUGGLE` origin, belongs to one of the user's sessions, AND has a **null `proactive_outcome`** (never delete a row that carries a terminal outcome — that is a canonical row). Idempotent: a missing/already-deleted row returns **204**. This is the durable half of stale-row suppression: when the client drops a stale control frame carrying a `messageId` (C4), it both posts `removeMessage` to the webview (live) AND calls this endpoint (durable), so the superseded row does not survive to the next history reload. The terminal-gate (A9/A11) already prevents persisting a stale row for any supersession that wrote an outcome (dismiss/free/abandon); this primitive covers the one remaining case — a **reveal** (PARKED→DELIVERED) that bumps the generation without writing an outcome, so a late `active` from the superseded `decide` still persisted. The null-outcome guard guarantees it can never delete a canonical outcome row.

- [ ] **Step 1: Failing test** — `revealAmbient` creates exactly one row (server-assigned `sentAt`) and **returns its DTO**; **it does NOT call `irisChatWebsocketService.sendMessage` (no chat-ws broadcast)** — the reveal is the ONE client-originated insert (optimistic bubble + reconcile, C2); broadcasting would duplicate the optimistic bubble before reconciliation; **a retry with the SAME `clientMessageId` returns the SAME row, no duplicate (upsert on the unique `proactive_client_message_id`)**; **even when another same-episode proactive row has identical text (a §6 escalation), the retry binds to the reveal row by its uuid key, never the other row**; `writeEpisodeOutcome` sets the outcome on the earliest-`sentAt` row when the episode has none and **returns `applied=true`**; re-writing the same value is a no-op (`applied=true`); **writing a DIFFERENT value when one is already set is ignored (first-terminal-wins, `applied=true`)**; **with NO row yet for the episode it returns `applied=false` (deferred), never an error** (so the client back-fills, C2); **episode-wide stability: with a later-`sentAt` row persisted but the earliest-`sentAt` delivery row NOT yet persisted, a write lands on that later row; when the delivery row is THEN inserted (earlier `sentAt`, null outcome), a second `writeEpisodeOutcome` is a NOOP (the episode already has an outcome) — exactly one row across the episode ever carries it, and `readEpisodeOutcome` returns it both before and after the delivery row appears**; **`deleteSupersededProactiveMessage` removes a proactive row with null outcome, is a 204 noop on a missing row, and REFUSES (does not delete) a row that carries a terminal outcome or is not proactive-origin**; **`cancelOutstandingStruggleJob(token)` removes the pending job ONLY when `job.requestToken()==token` (so a subsequent `addStruggleInterventionJobIfNonePending` succeeds); a token that does NOT match the pending job is a 204 NOOP and leaves the job intact (the scoped-cancel guarantee — `cancel(A)` never removes a since-started B)**.
- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Implement** `revealAmbient` (upsert on the unique `proactive_client_message_id=clientMessageId`, set `proactiveEpisodeId`+`level`+server `sentAt`, returns the persisted `IrisMessageResponseDTO`, and **deliberately does NOT call `sendMessage`** — no chat-ws broadcast, the client owns the single insert), `writeEpisodeOutcome` (the first-terminal-wins conditional update), `deleteSupersededProactiveMessage` (guarded delete: proactive origin + user's session + null outcome, else 204 noop), `cancelOutstandingStruggleJob` (remove the pending struggle job **only if `job.requestToken()` matches the passed token** via the existing `removeJob`; 204 noop if none matches), and the four endpoints. The `POST .../episodes/{episodeId}/reveal` body carries `{ hintText, level, clientMessageId }`. The extended `proactive-outcome` PUT accepts `RECOVERED`/`ABANDONED` (not only `DISMISSED`) and, when given an `episodeId`, targets the canonical row.
- [ ] **Step 4: Run** the service + endpoint tests → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(struggle): reveal-ambient persistence + canonical episode outcome primitives"`

### Task A11: Artemis — `confirmClose`/`staleCheck` handling + websocket event extension

**Files:**
- Modify: `.../iris/service/pyris/PyrisStatusUpdateService.java` (`handleStatusUpdate` — route by the authoritative `job.intent()`, NOT by nullable mode-field presence; see Step 3)
- Modify: `.../iris/service/session/IrisStruggleInterventionService.java` (add `handleConfirmClose(job, status)`, `handleStaleCheck(job, status)`)
- Modify: `.../iris/dto/StruggleInterventionEventDTO.java` (carry `episodeId` (String), the new mode payloads `resolved/closingSentence/episodeLabel/offer` and `ask/question`; the `kind` discriminator ∈ {`decide`,`confirm_close`,`stale_check`} was added in A9)
- Test: `.../iris/struggle/IrisStruggleInterventionDecisionTest.java` (or a new `...ConfirmCloseTest`)

**Interfaces:**
- Consumes: status fields (A7); the `writeEpisodeOutcome` + canonical-row primitive (A10); the job's `intent` + `episodeId` + `confirmReason` (A6); the `episodeId`+`kind` already on the event DTO from A9 (this task adds the mode payload fields).
- Produces: client-bound websocket events for the three modes. `confirm_close` `resolved=true` event carries `closingSentence`+`episodeLabel`+`messageId` **for `progress`/`stale_solved`**, but is a bare silent completion (no `messageId`, no closing fields) **for `parked_progress`**; `confirm_close` `resolved=false` carries the offer+`messageId` **only for `confirmReason="stale_solved"`** (see split below); `stale_check` `ask=true` event carries `question`+`messageId`; `ask=false` is a noop event. All carry `episodeId`. The client POSTs `confirm_close` for a **delivered** episode (`progress`/`stale_solved`) **and** for a never-delivered **PARKED** episode (`parked_progress`, B8/C3): for the two delivered reasons `resolved=true` persists the closing message + writes `RECOVERED`; for `parked_progress` the server persists **nothing** and writes **no outcome** on either result (the silent never-delivered close, §4/§8/§12).

> **Persistence is gated on the episode not being terminal yet (Critical — bounds stale rows under the async race). Strict ordering matters (Medium fix — do not suppress your own close).** The gate reads the **outcome that existed BEFORE this handler ran** (`readEpisodeOutcome(episodeId)`, A9): if it is already a **terminal `proactive_outcome`** (e.g. the student `DISMISSED` it while this response was in flight), the handler **skips the persist and emits a noop event**. If it is null, the handler proceeds in this order: **(1) persist the proactive-origin message (closing / offer / stale-ask / active), (1b) BROADCAST that row live over the per-session chat websocket via `irisChatWebsocketService.sendMessage(...)` — exactly like `handleDecision`'s `active` path (verified `IrisStruggleInterventionService.java:227`) so the row reaches the webview through the single chat-ws transport (C4), tagged with its `proactiveEpisodeId`; the struggle event carries only the `messageId`/control — THEN (2) write the outcome last** (`writeEpisodeOutcome`, for `resolved=true`→`RECOVERED`). So a `resolved=true` close persists its closing row FIRST and only then writes `RECOVERED` — it never gates away its own close row (the gate saw the pre-run null, not the `RECOVERED` it is about to write). This keeps Pyris/Artemis **stateless about the slot** (§11) — it consults only the persisted outcome, not client slot state. **The residual TOCTOU micro-race is CLEANED UP, not accepted (§6/§12 — addressing the "stale rows must be dropped against the live slot" requirement):** if a late response's gate-check reads null but the client's `DISMISSED`/`ABANDONED` lands between the check and the persist, a stray row commits. That stray's **control event is then dropped by the client generation guard** (the freeing transition bumped the generation), which triggers the **stale-row suppression** (C4): `removeMessage` (live) + `deleteSupersededProactiveMessage` (durable, A10). The stray row is **non-canonical** (a closing/offer/ask always has a LATER `sentAt` than the episode's delivery row, so it is never the earliest-`sentAt` row) and therefore carries a **null `proactive_outcome`** (the outcome is episode-wide on the canonical/earliest row, A10) — so the durable delete's null-outcome guard **permits** it. So the obsolete row does NOT survive to history; it is removed both live and durably. (The only case the guard refuses a delete is when the row legitimately IS the canonical outcome row — which happens only if the delivery row's own persist failed, i.e. the §12 "delivery persist failed → episode incomplete/absent" path, not a stray-row situation.) first-terminal-wins (A10) keeps the OUTCOME correct throughout.

> **`confirm_close` behaviour is split by the job's `confirmReason` (A6) — fixes the conflation. Three reasons:**
> - `confirmReason="progress"` (delivered progress-edge close, §7.1): `resolved=true` → persist closing message + write `RECOVERED`. `resolved=false` is **quiet** — slot stays TAKEN, **NO offer persisted/posted**; emit only a quiet `resolved=false` event so the client calls `latch.onConfirmResult(false)`.
> - `confirmReason="stale_solved"` (delivered, the stale-ask "Yes, solved it" button, §7.3): `resolved=true` → persist closing message + write `RECOVERED` (same as `progress`). `resolved=false` → persist ONE gentle offer message (from `rationale`, episodeId-tagged) and emit it.
> - `confirmReason="parked_progress"` (never-delivered PARKED progress close, §4/§8): the server is **silent on both results** — **persist NOTHING, write NO outcome, run NO scoring** (never-delivered = unscored, §12). Emit only a bare completion event (`episodeId` + `kind="confirm_close"` + `resolved`, **no `messageId`**) so the client can free the slot silently (`resolved=true`) or keep it PARKED (`resolved=false`), C4. The terminal-gate / closing-message / `RECOVERED` paths below apply **only** to the two delivered reasons.

> **Fail-closed on incomplete LLM output AND on a null/unknown `confirmReason` (Medium fix — deterministic visible behaviour).** Iris output may be missing fields. `handleConfirmClose` applies defaults (single source, server-side) so the spec's visible guarantees always hold: `resolved=true` with missing `closingSentence` → a default praise ("Nice work — that's resolved."); missing `episodeLabel` → `"Resolved"`. `confirmReason="stale_solved"` `resolved=false` with missing/empty `rationale` → a default offer ("Want to look at it together?") so §7.3's "one gentle offer, never a silent no-op" holds. (`resolved` itself missing → treat as `false`, the safe default, per the Pyris fail-closed parse A3.) **A null or unknown `confirmReason` on a `confirm_close` job** (a casing/typo mismatch silently nulling the field, per Global Constraints) → **fail-closed to `parked_progress` semantics: persist NOTHING, write NO outcome, emit a bare completion event + `log.warn`.** This is the SAFEST default because it can never write a spurious persisted row or outcome (the worst outcome would be mis-treating a never-delivered PARKED close as a delivered `progress` and persisting a bogus closing row + `RECOVERED`, violating §8/§12). The A6 serialization test pins the three valid values so this backstop is never hit in practice; a Step-1 test asserts a `null`/garbage `confirmReason` persists nothing and writes no outcome.

> **`messageId` nullability on the event.** Carried **iff a row was persisted** (and not skipped by the terminal gate): `active`, `confirm_close resolved=true` **for `progress`/`stale_solved`** (closing), `confirm_close resolved=false` `stale_solved` (offer), `stale_check ask=true` (question). Null for: `ambient` (event-only), `confirm_close resolved=false` `progress` (quiet), **`confirm_close` `parked_progress` on either result** (silent, nothing persisted), `stale_check ask=false`, and any persist skipped by the terminal gate. The client never invents an id.

- [ ] **Step 1: Failing test** — `resolved=true` + `confirmReason ∈ {progress, stale_solved}`: `handleConfirmClose` writes `RECOVERED` via `writeEpisodeOutcome` (A10), persists the closing message (origin PROACTIVE_STRUGGLE + episodeId), emits `kind="confirm_close"` with `closingSentence`/`episodeLabel`+`messageId`; **missing `closingSentence`/`episodeLabel` fall back to the defaults**. `resolved=false` + `confirmReason="progress"` → NO message, quiet `resolved=false` event (no `messageId`), no outcome write. `resolved=false` + `confirmReason="stale_solved"` → persist ONE offer (default if `rationale` empty), emit it + `messageId`. **`confirmReason="parked_progress"` (either result) → persist NOTHING, write NO outcome, run NO scoring; emit a bare `kind="confirm_close"` completion (`episodeId`+`resolved`, no `messageId`) — and the terminal gate is NOT consulted (nothing is persisted).** `stale_check ask=true` → **persist the question** (reloadable per §7.3/§9/§12), emit `kind="stale_check"` with `question`+`messageId`. `ask=false` → **always emit a noop event**, persist nothing. **An episode already terminal (canonical outcome non-null) → persist is skipped, noop event emitted** (delivered reasons only — `parked_progress` persists nothing regardless).
- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Route AND fix the completion gate in `PyrisStatusUpdateService.handleStatusUpdate`** by the **authoritative `job.intent()`** (A6): `"confirm_close"` → `handleConfirmClose`; `"stale_check"` → `handleStaleCheck`; `"decide"` (or null, legacy) → the existing `handleDecision` (NOT by nullable response-field presence — Medium fix). `handleConfirmClose` reads `job.confirmReason()` for the `resolved=false` split.
  > **Critical — the exactly-once `removeJob`/in-flight release wrapper must ALSO change.** Verified: today the wrapper only consumes/releases the struggle job when `statusUpdate.action() != null` (or terminal stages are present) (`PyrisStatusUpdateService.java:91`). But `confirm_close`/`stale_check` responses carry **`action = null`** + mode-specific fields, so under the existing gate they would **never clear the in-flight marker** → after the first progress-close or stale-check the single-flight slot **deadlocks** (§6). Change the completion condition so a job is removed + the in-flight marker released whenever **`job.intent() != "decide"`** (a `confirm_close`/`stale_check` response is always a one-shot terminal completion, regardless of `action`), **OR** (for `decide`) the existing `action != null` / silent-completion / terminal-stages condition holds. Add a test that a `confirm_close` AND a `stale_check` callback each remove the job + release the in-flight marker even with `action == null`.
- [ ] **Step 4: Implement `handleConfirmClose` / `handleStaleCheck`** per Step 1 (with the terminal gate + fail-closed defaults). Extend `StruggleInterventionEventDTO` with the mode payload fields `String offer` (from `rationale`), `Boolean resolved`, `String closingSentence`, `String episodeLabel`, `Boolean ask`, `String question` (the `episodeId`+`kind` fields were added in A9).
- [ ] **Step 5: Run** the test(s) → PASS.
- [ ] **Step 6: Commit** — `git commit -m "feat(struggle): handle confirmClose/staleCheck results + extend the client event"`

---

## Phase B — Extension slot core (pure logic)

All of Phase B is host-free TypeScript under `extension/src/extension/services/struggleIntervention/slot/`, unit-tested with **vitest under `test/logic/struggleIntervention/slot/`** (no `vscode` import in these modules; inject a clock and effect callbacks). Phase C wires these into the orchestrator and the host surfaces. Run `npm run check-types` + `npm run test:react` (vitest) at the end of each task.

### Task B1: Episode model + id/generation types

**Files:**
- Create: `extension/src/extension/services/struggleIntervention/slot/episode.ts`
- Test: `test/logic/struggleIntervention/slot/episode.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SlotGeneration = number;            // monotonic, bumped on SEMANTIC transitions only
  export type Level = 'ambient' | 'active';
  export interface EpisodeHint { level: Level; text: string; atSessionS: number; }
  export interface Episode {
    episodeId: string;                            // client-allocated uuid
    isNew: boolean;                               // episode-boundary marker for the request STREAM; true until the FIRST accepted outbound request of ANY intent for this episode (C3)
    hints: EpisodeHint[];                         // initial hint + escalations ONLY (§11)
    createdAtMs: number;
  }
  export function newEpisode(now: number, idgen: () => string): Episode;  // isNew=true, hints=[]
  export function addHint(ep: Episode, hint: EpisodeHint): Episode;        // immutable push
  export function markContinuation(ep: Episode): Episode;                  // immutable; isNew -> false (after the first ACCEPTED outbound request of ANY intent, C3)
  export function toRequestEpisode(ep: Episode): { episodeId: string; isNew: boolean; hints: EpisodeHint[] };
  ```

- [ ] **Step 1: Failing test** — `newEpisode(1000, () => 'ep-1')` returns `{episodeId:'ep-1', isNew:true, hints:[], createdAtMs:1000}`; `addHint` appends without mutating the input; `markContinuation` returns a copy with `isNew:false` (input unchanged); `toRequestEpisode` drops `createdAtMs`.
- [ ] **Step 2: Run** `npx vitest run test/logic/struggleIntervention/slot/episode.test.ts` → FAIL.
- [ ] **Step 3: Implement `episode.ts`** exactly per the interface (immutable helpers; `idgen` injected so tests are deterministic — production passes `crypto.randomUUID`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git add extension/src/extension/services/struggleIntervention/slot/episode.ts test/logic/struggleIntervention/slot/episode.test.ts && git commit -m "feat(slot): episode model + request projection"`

### Task B2: SlotManager state machine

**Files:**
- Create: `extension/src/extension/services/struggleIntervention/slot/slotManager.ts`
- Test: `test/logic/struggleIntervention/slot/slotManager.test.ts`

**Interfaces:**
- Consumes: B1 types.
- Produces:
  ```ts
  export type SlotState =
    | { kind: 'free' }
    | { kind: 'parked';    episode: Episode; level: 'ambient'; frozenText: string; generation: SlotGeneration }
    | { kind: 'delivered'; episode: Episode; level: Level;     generation: SlotGeneration };
  export interface SlotSnapshot { state: SlotState; inSession: boolean; generation: SlotGeneration; }

  export class SlotManager {
    constructor();                                  // no idgen — the orchestrator mints episodes (B1 newEpisode) and passes them in
    snapshot(): SlotSnapshot;
    generation(): SlotGeneration;
    isFree(): boolean;

    // SEMANTIC transitions — each bumps generation and returns the new snapshot.
    // The orchestrator PRE-ALLOCATES the Episode (so the same episodeId it sent on the decide POST
    // becomes the live episode); take*/replace* store the given Episode + add the hint to its hints[]
    // (PARKED carries the hidden ambient hint for continuity, §11/§17). The candidate episode for a
    // FREE-slot decide is discarded by the orchestrator if the response is `silent`.
    takeParked(now: number, episode: Episode, hint: EpisodeHint): SlotSnapshot;      // FREE -> PARKED (the preallocated candidate becomes live)
    takeDelivered(now: number, episode: Episode, hint: EpisodeHint): SlotSnapshot;   // FREE -> DELIVERED (candidate becomes live)
    replaceParked(now: number, episode: Episode, hint: EpisodeHint): SlotSnapshot;   // PARKED -> PARKED' (NEW episode; old hint evaporates)
    replaceWithDelivered(now: number, episode: Episode, hint: EpisodeHint): SlotSnapshot; // PARKED -> DELIVERED' (NEW episode; active first delivery, §6)
    revealParked(hint: EpisodeHint): SlotSnapshot;                 // PARKED -> DELIVERED (click); SAME episode (hint already in hints[])
    escalate(hint: EpisodeHint): SlotSnapshot;                     // DELIVERED ambient -> DELIVERED active; same episode; addHint
    free(): SlotSnapshot;                                          // -> FREE
    discardParkedToFree(): SlotSnapshot;                           // PARKED -> FREE (silent, no row)

    // NON-semantic (does NOT bump generation):
    setInSession(open: boolean): SlotSnapshot;
  }
  ```

The generation bump set (§6): `take*`, `replace*`, `reveal` (PARKED→DELIVERED), `escalate`, `free`/`discard`. NOT bumped: `setInSession`, stale-ask visibility (Phase C). The orchestrator passes the **preallocated candidate** `Episode` (NEW episodeId, sent in the replacing `decide`'s request — C3, NOT minted on the response) to `replace*`; the old parked hint is dropped — it does NOT carry into the new episode's `hints[]` (slot↔episode stays 1:1, §3/§4; a replacement that returns `active` is a **fresh first delivery**, not an escalation, §6). `revealParked` keeps the SAME episode (the parked ambient hint is already in `hints[]`; click is not a new episode).

- [ ] **Step 1: Failing tests** (pass pre-built `Episode`s in, per the API) — cover each transition + its generation effect:
  - `takeParked(now, candidateEp, hint)` from free → state `parked`, `episode.episodeId === candidateEp.episodeId`, `episode.hints` = `[the ambient hint]`, generation increments by 1.
  - `revealParked` → `delivered`, **same `episodeId`** as the parked one, hints unchanged, generation increments.
  - `replaceParked(now, newEp, hint)` → `parked` with `episodeId === newEp.episodeId` (**different** from the old), new hint in `hints` (old NOT carried), generation increments.
  - `replaceWithDelivered(now, newEp, hint)` (PARKED + active result) → `delivered` active with the new `episodeId`, `hints=[the active hint]` (old parked hint NOT carried), generation increments.
  - `escalate` only legal from `delivered` ambient → `delivered` active, same episode, hint appended, generation increments.
  - `setInSession(true)` flips `inSession` but **generation unchanged**.
  - `free` / `discardParkedToFree` → `free`, generation increments.
  - illegal transitions (e.g. `escalate` while free, `replaceWithDelivered` while delivered) throw.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement `SlotManager`** per the interface; keep it a pure in-memory machine (no timers, no I/O). Guard illegal transitions with thrown errors so Phase C bugs surface in tests.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(slot): SlotManager state machine with semantic-only generation bumps"`

### Task B3: Async/generation guard + single-flight per intent

**Files:**
- Create: `extension/src/extension/services/struggleIntervention/slot/guard.ts`
- Test: `test/logic/struggleIntervention/slot/guard.test.ts`

**Interfaces:**
- Consumes: `SlotGeneration`.
- Produces:
  ```ts
  export type Intent = 'decide' | 'confirm_close' | 'stale_check';   // snake wire values (§17), used as-is on the wire
  // hardEvent is captured at issue time from the triggering alert's boundaryTypes (FM/FM_PLUS/E4/N1)
  // because the async websocket reply does not carry boundary info (§6); reconcile reads it back.
  export interface PendingStamp { episodeId: string; generation: SlotGeneration; hardEvent: boolean; requestToken: string; }  // requestToken = the scoped-cancel id (A6/A10); minted per POST (C3), lives on the stamp so the in-flight identity is single-source
  // Single-flight registry: track the LATEST outstanding request per intent; an inbound
  // response is applied only if it is the latest AND its stamp still matches the live slot.
  export class InFlightGuard {
    issue(intent: Intent, stamp: PendingStamp): number;            // returns a token; supersedes any older same-intent request
    // expectedEpisodeId = the episodeId the response must still belong to: the LIVE episode when TAKEN,
    // or the PENDING CANDIDATE episodeId when the slot is still FREE awaiting a first-decide response.
    accept(intent: Intent, token: number, expectedEpisodeId: string, expectedGeneration: SlotGeneration): PendingStamp | null;  // the stamp (carries hardEvent + requestToken) if accepted, else null
    cancel(intent: Intent): void;                                  // e.g. on slot free
  }
  // Monotonic deadline for the stale-ask ABANDON timer (§6): a timer callback fires its
  // effect only if its captured deadline is still current.
  // Per-ask ABANDON deadline (§7.3): bounded by an absolute per-ask ceiling that free-text
  // resets can NEVER exceed, so termination is guaranteed.
  export class DeadlineLatch {
    arm(nowMs: number, initialMs: number, ceilingMs: number): number;  // stores askStart=now, ceiling=now+ceilingMs; deadline=now+initialMs; returns the deadline
    advance(nowMs: number, resetMs: number): number;                   // free-text reset: deadline = min(now+resetMs, ceiling); never past the ceiling; returns the new deadline
    current(): number;                                                 // the active deadline (snapshot, for the rollback in C5)
    restore(deadlineMs: number): void;                                 // set the deadline back (revoke a provisional free-text advance on hard send failure)
    isCurrent(deadlineMs: number): boolean;                            // a scheduled expiry fires its effect only if its captured deadline is still current
  }
  ```

The latch is pure (no timers, §B). **The host schedules the expiry** (C5): on every `arm`/`advance`, (re)schedule a `setTimeout` to `current()`; when it fires, if `isCurrent(thatDeadline)` AND the ask is still open → free the slot (`ABANDONED`). The monotonic deadline means a superseded (pre-advance) timeout is a no-op. Rollback: capture `current()` before a free-text `advance`, and on a hard send failure call `restore(prev)` + reschedule.

`accept` returns the pending `stamp` (carrying `hardEvent`) only when `token` equals the latest issued token for that intent AND `stamp.episodeId === expectedEpisodeId && stamp.generation === expectedGeneration`; otherwise `null`.

> **Candidate acceptance for new-episode decides (FREE or PARKED — resolves the "decide whose result is a new episode has no matching live id" gap).** A `decide` whose result could create a NEW episode — issued from a **FREE** slot OR a **PARKED** slot (C3 preallocation) — is stamped with the **preallocated candidate**'s `episodeId` and the current generation. The slot's generation does NOT bump until this response applies (single-outstanding means nothing else mutates it meanwhile), so the orchestrator supplies `expectedEpisodeId = the pending candidate's episodeId` (and the unchanged generation) to `accept`. A matching response applies: from FREE → `ambient`→`takeParked(candidate)`, `active`→`takeDelivered(candidate)`, `silent`/`suppress`→discard the candidate (stay FREE); from PARKED → `ambient`→`replaceParked(candidate)`, `active`→`replaceWithDelivered(candidate)`, `silent`→`discard-free` (discard candidate + free the old PARKED). If the slot moved on (e.g. the student revealed the PARKED hint → generation bumped) the response is dropped. In short: the "expected identity" for matching is the **pending candidate** for a FREE/PARKED-issued decide, else the **live episode** for a DELIVERED-issued decide (and for `confirmClose`/`staleCheck`, which only run on DELIVERED).

> **Why no echoed wire-token is needed (the correlation contract).** Artemis reserves the struggle job with `addStruggleInterventionJobIfNonePending` (verified): a new `decide`/`confirmClose`/`staleCheck` POST is **rejected while any struggle job is pending**, so there is **at most one outstanding struggle request at a time** (per user/exercise) — same-intent (and cross-intent) overlap on the wire is **structurally impossible**. The client mirrors this: it does NOT issue a second struggle POST while one is outstanding (a rejected egress result → drop, retry next tick, C3). So a websocket response is correlated to that single outstanding request by its `kind` + the `(episodeId, generation)` stamp; the local `token` (a `number` from `issue`) only disambiguates **client-local** supersession (e.g. a timer callback vs a button both targeting the same ask), never two wire responses. **Distinct from both is `requestToken` (a `string` uuid on `PendingStamp`)** — it is NOT a correlation key (correlation stays tokenless via single-outstanding); it exists ONLY so the server-side **scoped cancel** (A10) can target the exact in-flight job. Three separate things, do not conflate: the local `number` `token` (client supersession), `(episodeId, generation)` (reply correlation + stale-drop), and the `requestToken` uuid (scoped cancel). `DeadlineLatch`'s `ceilingMs` enforces §7.3's absolute per-ask ABANDON ceiling that free-text cannot push past.

- [ ] **Step 1: Failing tests** — an older `decide` token is rejected after a newer `issue`; a response whose generation no longer matches the expected identity returns `null`; `accept` returns the stamp (with `hardEvent`) on a match; `DeadlineLatch.advance` never returns a deadline past the ceiling; `current()` returns the active deadline and `restore(prev)` sets it back (so `isCurrent(prev)` becomes true again); `isCurrent` is false for a superseded deadline.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `guard.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(slot): in-flight single-flight guard + deadline latch"`

### Task B4: Stale watchdog + termination counters

**Files:**
- Create: `extension/src/extension/services/struggleIntervention/slot/staleWatchdog.ts`
- Test: `test/logic/struggleIntervention/slot/staleWatchdog.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface StaleConfig { staleAfterMs: number; staleWindowMax: number; staleAskCap: number; }
  export type StaleEvent =
    | { kind: 'fire-stale-check' }      // DELIVERED: window already incremented; orchestrator owes a best-effort staleCheck (if canPostAsk + no ask open)
    | { kind: 'force-free' }            // staleWindowCount reached STALE_WINDOW_MAX -> ABANDONED
    | { kind: 'free-silent' };          // PARKED: free with no row
  export class StaleWatchdog {
    constructor(cfg: StaleConfig);
    arm(now: number, parked: boolean): void;     // on slot TAKEN
    resetProgress(now: number): void;            // meaningful progress/activity toward A
    // On a fire (staleAfterMs since last reset): for DELIVERED, INCREMENT staleWindowCount (on EVERY fire, wire-independent — §7.3/§13 bound),
    // then return 'force-free' if it reached staleWindowMax, else 'fire-stale-check'; for PARKED return 'free-silent'. RE-ARMS the clock.
    tick(now: number): StaleEvent | null;
    onAskPosted(): void;                          // increments staleAskCount (ask=true only)
    canPostAsk(): boolean;                        // staleAskCount < staleAskCap
    disarm(): void;                               // on slot free/terminal
    windowCount(): number;                        // staleWindowCount
  }
  ```

Rules (§7.3/§13 — the window increments on EVERY fire, wire-independent; the staleCheck POST is best-effort and decoupled). This is the spec's authored model and the basis of §13's delay bound: **"`staleWindowCount` increments on every watchdog fire ... the hard termination bound, so even endless noops cannot keep a slot TAKEN forever."** So `tick` itself increments `staleWindowCount` on every DELIVERED fire and emits `force-free` the moment it reaches `staleWindowMax` — **independent of the wire, the ask cap, or whether a `staleCheck` actually ran**. The orchestrator then handles the POST separately (C3):
- **Ask-eligible fire** (`canPostAsk()` true, no ask open): the orchestrator **owes** a `staleCheck` (a **best-effort** POST, retried until the wire is free, B3/C3) so the ask runs as soon as possible. **This owe does NOT gate the window** — the window already incremented on the fire, so a busy wire can delay/skip the *ask* but can **never** postpone `force-free` (the §13 bound holds). The response posting a question calls `onAskPosted()` (increments `staleAskCount`, capped at `staleAskCap`=2).
- **Past the ask cap** (`canPostAsk()` false): no POST (nothing left to ask); the fire still incremented the window via `tick` (matching §7.3 "later windows only tick `staleWindowCount`").

For a PARKED slot, a `tick` fire emits `free-silent` (no window, no POST). Counters never reset within an episode.

> **Why this is decoupled (resolving the prior over-correction).** An earlier draft consumed the window only on POST acceptance — that let a busy wire postpone force-free and **broke §13's bound** (a perpetually busy wire could keep a slot TAKEN past `staleWindowMax`). The fix is the spec's own split: the **window** counts every fire (for the bound); the **ask** is best-effort (owed/retried so it usually runs, but never blocks the bound). A busy wire may cost an ask, never the termination guarantee.

> **Concrete callers (the wiring the watchdog needs, fixes the "no caller" gap).** `arm` ← C3 on every slot TAKE (`take*`/`replace*`). `disarm` ← C3 on every slot FREE/terminal. `resetProgress` ← C3 on **HARD progress signals only** (a new green test from `onNewResult`; a sustained `sBase` drop) AND ← C5 on the **"Still on it"** button (explicit keepalive). **NOT on "an edit in the anchored region" (Medium fix):** §7.3/§11/§13 deliberately push task-relevance judgment to Iris (`get_problem_statement` / `get_feedbacks` / code) and note that a student working a *different task in the same file* still counts as moved-on. A client-side anchor-local-edit heuristic would keep episode A alive on unrelated same-file edits, postponing the stale-ask / force-free past the intended semantics. So the watchdog resets only on hard progress + explicit keepalive; everything subtler is judged by Iris on the `staleCheck`. `tick` ← C3 from a host `setInterval`; it increments `staleWindowCount` on every DELIVERED fire and emits `force-free` at the ceiling (wire-independent — the §13 bound). `onAskPosted` ← C4 when a `staleCheck ask=true` is rendered. On a `fire-stale-check`, C3 owes a **best-effort** `staleCheck` POST when `canPostAsk()` and no ask is open; it POSTs once the wire is free (none in flight, `stale_check_id`, §7.3) and is otherwise **owed and retried** (C3 `_owedStaleCheck`) — but the window already advanced regardless. **Cancelling an in-flight `staleCheck`** (clear `stale_check_id` + `InFlightGuard.cancel('stale_check')`) happens ← C5 on ANY ask button (incl. "Still on it") and ← C3 on any slot free — so a late/duplicate `staleCheck` response can never post a second question.

- [ ] **Step 1: Failing tests** —
  - DELIVERED: after `staleAfterMs` with no progress, `tick` → `fire-stale-check` and `windowCount` increments; `resetProgress` defers the next fire.
  - **`windowCount` increments on EVERY `tick` fire — wire-independent (no POST involved)**; after `staleWindowMax` fires, `tick` → `force-free` regardless of whether any `staleCheck` ran (the §13 bound).
  - `canPostAsk` false after `staleAskCap` posted asks (via `onAskPosted`); later fires still increment `windowCount` (no ask).
  - PARKED arm: `tick` fire → `free-silent`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `staleWatchdog.ts` (pure; the host drives `tick` from a `setInterval` in Phase C, but the logic here is clock-injected).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(slot): stale watchdog with windowCount/askCap termination bounds"`

### Task B5: Reconciliation filter (apply a decision against the slot)

**Files:**
- Create: `extension/src/extension/services/struggleIntervention/slot/reconcile.ts`
- Test: `test/logic/struggleIntervention/slot/reconcile.test.ts`

**Interfaces:**
- Consumes: `SlotState`, `Level`.
- Produces:
  ```ts
  export interface Decision { action: 'silent' | 'ambient' | 'active'; text: string | null; hardEvent: boolean; }
  export type ReconcileAction =
    | { kind: 'take-parked'; text: string }          // FREE + ambient
    | { kind: 'take-delivered'; text: string }       // FREE + active
    | { kind: 'replace-parked'; text: string }       // PARKED + ambient  (new episode, stays PARKED)
    | { kind: 'replace-delivered'; text: string }    // PARKED + active   (new episode, fresh first DELIVERY, §6)
    | { kind: 'discard-free' }                        // PARKED + silent
    | { kind: 'escalate' }                            // DELIVERED ambient (opened) + active + hardEvent
    | { kind: 'suppress' };                           // everything else (downgrade, deepen, soft-drift louder)
  export function reconcile(slot: SlotState, decision: Decision): ReconcileAction;   // NO separate `ambientWasRevealed` arg — derived from slot state (below)
  ```

Encodes §6 exactly. **`ambientWasRevealed` is DERIVED from `SlotState`, not passed (Medium fix — one source of truth):** a delivered slot has `level==='ambient'` **iff** it was a revealed ambient (the only path PARKED-ambient→DELIVERED is `revealParked`, which keeps `level='ambient'`; `takeDelivered`/`replaceWithDelivered` are `level='active'`, and `escalate` flips a delivered-ambient to `level='active'`). So the escalation precondition is simply `slot.kind==='delivered' && slot.level==='ambient'`. On DELIVERED, softer→suppress, same/more-detail→suppress (no auto-deepen), louder→escalate ONLY when `decision.action==='active' && decision.hardEvent && slot.kind==='delivered' && slot.level==='ambient'`; soft drift never escalates. A caller can no longer accidentally suppress the one allowed escalation by passing the wrong flag — there is no flag. On PARKED, `ambient`→`replace-parked` (new episode, still a hidden pointer), `active`→`replace-delivered` (new episode, a fresh first delivery shown immediately — NOT another hidden pointer, §6), `silent`→`discard-free`. On FREE, `ambient`→`take-parked`, `active`→`take-delivered`, `silent`→`suppress`. The orchestrator (C3) maps `replace-parked`→`SlotManager.replaceParked`, `replace-delivered`→`replaceWithDelivered` (then drives the active surfaces), `take-delivered`→`takeDelivered`.

- [ ] **Step 1: Failing tests** — one per row of the §6 matrix, including the negative cases (delivered + louder but NOT a hard event → suppress; **parked + active → `replace-delivered` (a fresh delivery), NOT escalate and NOT another parked pointer**; parked + ambient → `replace-parked`). **Escalation precondition is derived from slot state, NOT a flag: a `delivered` + `level==='ambient'` slot + active + hardEvent → `escalate`; the SAME inputs on a `delivered` + `level==='active'` slot → `suppress` (already escalated/active, no second escalation). `reconcile` takes only `(slot, decision)` — no `ambientWasRevealed` arg.**
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `reconcile.ts` as a pure function.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(slot): reconciliation filter for the overwrite-bug fix"`

### Task B6: Reply-routing decision

**Files:**
- Create: `extension/src/extension/services/struggleIntervention/slot/replyRouting.ts`
- Test: `test/logic/struggleIntervention/slot/replyRouting.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ReplyKind =
    | { kind: 'button'; button: 'solved' | 'still-on-it' | 'something-else'; askId: string }
    | { kind: 'free-text'; text: string };
  export type ReplyEffect =
    | { kind: 'confirm-close' }                  // 'solved'
    | { kind: 'stay' }                            // 'still-on-it'
    | { kind: 'free-silent' }                     // 'something-else' -> ABANDONED
    | { kind: 'reset-abandon-timer' }             // free-text while an ask is open
    | { kind: 'none' };                           // free-text with no open ask
  export function routeReply(reply: ReplyKind, askOpen: boolean, liveAskId: string | null): ReplyEffect;
  ```

§7.3/§16: free-text NEVER resolves the slot — it returns `reset-abandon-timer` (when an ask is open) or `none`; it always also flows to the normal chat (the caller does that unconditionally, this function only decides the slot side-effect). A button effect applies only if `reply.askId === liveAskId` (a late click on a superseded ask → `none`).

- [ ] **Step 1: Failing tests** — `solved`→`confirm-close`; `something-else`→`free-silent`; `still-on-it`→`stay`; free-text + ask open → `reset-abandon-timer`; free-text + no ask → `none`; button with stale `askId` → `none`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(slot): deterministic reply routing (buttons resolve, free-text never does)"`

### Task B7: Slot TUNING knobs

**Files:**
- Modify: `extension/src/extension/services/struggle/config.ts` (add a `SLOT` block under `TUNING`)
- Test: `test/logic/struggle/` (extend the existing config test if one asserts TUNING shape; otherwise a tiny new test)

**Interfaces:**
- Produces: `TUNING.slot = { staleAfterMs, staleWindowMax, staleAskCap, abandonInitialMs, abandonFreeTextMs, abandonCeilingMs, reArmSBase, reArmHoldMs }` with the spec's provisional values: `staleAfterMs≈` the "sustained while", `staleWindowMax=4`, `staleAskCap=2`, `abandonInitialMs=60_000`, `abandonFreeTextMs=30_000`, `abandonCeilingMs=300_000`, `reArmSBase=0.6`, `reArmHoldMs=30_000`. Mark each `[ENG]`/`[D]` per the config.ts provenance convention.

- [ ] **Step 1:** Add the `SLOT` block; if a config-shape test exists, extend it, else add `slotTuning.test.ts` asserting the keys + that windows are ordered (`abandonFreeTextMs < abandonInitialMs < abandonCeilingMs`).
- [ ] **Step 2: Run** → PASS. **Step 3: Commit** — `git commit -m "feat(slot): add slot TUNING knobs to config"`

### Task B8: Progress-edge detector + `confirmClose` edge-trigger latch (§7.1)

**Files:**
- Create: `extension/src/extension/services/struggleIntervention/slot/progressClose.ts`
- Test: `test/logic/struggleIntervention/slot/progressClose.test.ts`

**Interfaces:**
- Consumes: TUNING `reArmSBase`, `reArmHoldMs` (B7); engine signals (a strict new high in passed tests; the `sBase` trajectory the orchestrator already buffers).
- Produces:
  ```ts
  export type CloseState = 'open' | 'pending-post' | 'candidate-close';
  export interface ProgressCloseCfg { reArmSBase: number; reArmHoldMs: number; }
  export class ProgressCloseLatch {
    constructor(cfg: ProgressCloseCfg);
    state(): CloseState;
    // Fed once per engine tick. newGreenTest = a build result with a strict new high in passed tests.
    observe(now: number, sBase: number, newGreenTest: boolean): void;  // a fresh edge in state 'open' -> 'pending-post'
    shouldPost(): boolean;                       // true while a confirmClose is owed but not yet POSTed (state 'pending-post')
    onPosted(): void;                            // a confirmClose POST was ACCEPTED. TOTAL function (defined from EVERY state): 'pending-post' -> 'candidate-close' (consume the owed progress edge); 'open' or 'candidate-close' -> NO-OP. So C3 can call it "regardless of confirmReason": a stale_solved close with no owed progress edge ('open') is a safe no-op; a stale_solved close that SUPERSEDED an owed progress edge ('pending-post') consumes it so the progress latch cannot fire a second close.
    onConfirmResult(resolved: boolean): void;    // true: terminal (slot freed elsewhere); false: back to 'open', a fresh edge required
    reset(): void;                               // on ANY slot take / free / replace / discard / terminal
  }
  ```

The §7.1 machine, deterministic (NO fuzzy code-delta predicate): a **progress edge** = a new green test, OR `sBase` continuously below `reArmSBase` for `reArmHoldMs` (first satisfaction only). On a fresh edge in state `open` → `pending-post` (the close is **owed**). The orchestrator polls `shouldPost()`; the edge is **consumed only when the POST is ACCEPTED** (`onPosted()` → `candidate-close`), so if the wire is busy (a `decide` in flight, the single-outstanding rule, B3/C3) the owed close **survives** and POSTs as soon as the wire frees — it is never lost. While `candidate-close`/`pending-post`: a new edge does not stack (still one owed close). `onConfirmResult(true)`: terminal. `onConfirmResult(false)`: back to `open`, and the SAME conditions cannot immediately re-fire — a fresh edge is required (a NEW green test, or `sBase` rising back above `reArmSBase` then dropping under it for `reArmHoldMs` again). This both prevents Pyris spam AND the lost-edge stuck-slot bug.

> **The latch only owes the edge; the orchestrator decides the `confirmReason` based on slot state (§4 PARKED vs DELIVERED).** When `shouldPost()` and the wire is free → POST `confirmClose` then `onPosted()`, for **both** slot states — the slot state only picks the `confirmReason`: **DELIVERED** → `confirmReason="progress"` (loud close, §7.1/§8); **PARKED** → `confirmReason="parked_progress"` (silent close, see below). The `reset()` + silent free for PARKED happen **only after Iris `resolved=true`** lands (C4), never on the engine signal alone. **`reset()` is called on EVERY non-confirm terminal transition** (slot free / dismiss / stale-free / parked discard / replace / free-before-response) so a stale owed-close never suppresses a future episode's close (Medium fix). The async guard already drops a confirmClose response that lands on a since-changed slot, and DELIVERED never reverts to PARKED (§12) — no parked-confirmClose race.
>
> **Why PARKED progress DOES round-trip Iris, but silently (the only reading that satisfies §4 + §7.1 + §8 simultaneously).** §4 line 71 reads "progress **confirmed (§7.1)** → FREE, **silent (nothing was shown to close)**", and §7.1 states progress is **"Always two-stage"** with **"Iris confirmation is mandatory"** and **no PARKED carve-out**. So the engine signal alone may **not** free a PARKED slot — Iris must confirm (the participle "confirmed" + the explicit "(§7.1)" cross-reference are load-bearing). The catch is §8 ("never-delivered ambient = nothing to close ... no closing message and no fold-line") and §12 (outcome analysis is **delivered-only**): a naive `confirmClose` would make the **stateless** server (which cannot see PARKED vs DELIVERED, §17) persist a closing row + write `RECOVERED`, contradicting §8/§12. The reconciliation is a server-visible `confirmReason="parked_progress"`: Iris **does** re-read the code and confirm, but the server **persists no closing message, writes no outcome, runs no scoring** (A11); `resolved=true` → the **client** frees the slot **silently** (`discardParkedToFree`, no row, no fold); `resolved=false` → the slot **stays PARKED**, no re-fire until a fresh edge. This costs one extra LLM round-trip per parked-progress edge (rare: a never-clicked pointer whose problem the engine then sees resolving) and is exactly §4's "FREE, silent" — with §7.1's mandatory confirmation honoured. `confirmReason` is the extension→Artemis close-mode discriminator, ratified in spec §17.

- [ ] **Step 1: Failing tests** —
  - a `newGreenTest` tick → `shouldPost()` true; `onPosted()` → `candidate-close`, `shouldPost()` false.
  - a second `newGreenTest` while `pending-post`/`candidate-close` → still one owed close (no stack).
  - `shouldPost()` stays true across ticks until `onPosted()` (the wire-busy case: the owed close is not lost).
  - after `onConfirmResult(false)`, a fresh `newGreenTest` → `shouldPost()` true again; a stale (no new edge) tick does not.
  - `sBase` below `reArmSBase` for `< reArmHoldMs` → no owed close; sustained `>= reArmHoldMs` → one owed close.
  - `sBase` dropping, firing, then `onConfirmResult(false)`: must rise above `reArmSBase` and re-cross to owe again.
  - `reset()` clears a `pending-post`/`candidate-close` back to `open` (no stuck owed-close after a free).
  - **`onPosted()` is total: from `open` it is a NO-OP (state stays `open`, `shouldPost()` stays false — the stale_solved-with-no-progress-edge case); from `pending-post` it goes `candidate-close` (the superseded-progress-edge case); from `candidate-close` it is a no-op.**
- [ ] **Step 2: Run** `npx vitest run test/logic/struggleIntervention/slot/progressClose.test.ts` → FAIL.
- [ ] **Step 3: Implement** `progressClose.ts` (clock-injected; track the below-threshold-since timestamp and an `armed` flag).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(slot): progress-edge detector + confirmClose edge-trigger latch"`

---

## Phase C — Extension surfaces, orchestrator wiring & webview

Phase C connects the Phase B core to the real host. Host-touching surface tasks are tested under **`test/unit` (mocha/vscode-host)**; webview tasks under **`test/react` (vitest)**; the orchestrator integration under **`test/logic`** with injected effects. Run `npm run check-types` after every task, plus the relevant runner.

### Task C1: Pull/push surface split

**Files:**
- Modify: `extension/src/extension/services/intervention/inlineHintDecoration.ts` (split gutter-only vs gutter+inline)
- Modify: `extension/src/extension/services/intervention/interventionService.ts` (the **status-bar lamp** — `showLamp()` / `hideLamp()`; it is the ambient no-anchor pointer, §5; lifecycle below)
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` (`onServerAmbient` drops the inline cue; `onServerActive` keeps the inline cue + toast + badge **AND posts the optimistic active bubble** from the event's hint text — tagged with the event `messageId` so the chat-ws persisted row dedups against it, or a runtime-only fallback bubble if `messageId=null` (server persist failed, A9); drives the lamp per the PARKED invariant below)
- Modify: `extension/src/extension/provider/chatWebviewProvider.ts` (`setProactiveBadge` for BOTH levels)
- Test: `test/unit/services/intervention/interventionService.test.ts`; `test/logic/struggleIntervention/struggleEventSubscription.test.ts`

**Interfaces:**
- Consumes: the inbound event handlers; `slot.snapshot()` (`.inSession`, `.kind`).
- Produces: `InlineHintDecoration.showGutterOnly(anchorFile, anchorLine)` (gutter icon, NO after-line text) and the existing `show(...)` (gutter + inline cue) used only by active. An `applyEscalation(inSession)` helper that picks the loudness. `InterventionService.showLamp()/hideLamp()` for the status-bar pointer.

§5: ambient = pointers only (badge + gutter icon if anchor + status-bar lamp); NO inline text, NO toast, NO bubble. active = bubble + toast + badge + gutter + inline cue.

> **Status-bar lamp lifecycle (fixes the "underspecified ambient-only surface", §5).** The lamp ("Iris has a hint", the clickable bottom-bar ambient pointer, mainly the no-anchor fallback) follows ONE invariant: **the lamp is visible iff the slot is `PARKED`** (a hidden ambient pointer is pending). Concretely, driven from the slot transitions the orchestrator already applies (C3): **show** on `take-parked` / `replace-parked` (slot enters/stays PARKED); **hide** on `revealParked` (PARKED→DELIVERED click), on `replace-delivered` (PARKED→DELIVERED active — the louder surfaces take over), on `discard-free` (silent discard → FREE), on `free-silent` (PARKED stale-free → FREE), and on the `parked_progress` silent free (C4). The lamp is **never** shown for an `active`/DELIVERED episode (active relies on toast + bubble + inline). So a delivered or gone episode can never leave a stale lamp behind — every PARKED-exit hides it.

§4/§5/§6 IN-SESSION (presentation-only, fixes the "declared but unwired" gap): the slot's `inSession` flag = the chat view being open/focused (set in C3 from the provider's visibility event; it does NOT bump generation). It changes only **escalation loudness**, computed from the **current UI state at apply time** (§6): when an `escalate` action applies (C3/C4), if `inSession` → drop the escalation **quietly into the open chat** (a bubble, no toast, no inline push); else → the full active push (toast + inline). New content while IN-SESSION flows quietly; no new interruption. The **badge already clears when the chat view becomes visible** (`chatWebviewProvider.ts:342`) — keep that; it is the "badge clears on chat-open" behaviour (§5).

- [ ] **Step 1: Failing tests** — `onServerAmbient` calls `showGutterOnly` (never `show` with `inline_hint`) and sets the badge; `onServerActive` calls `show` (with inline cue) + toast + badge **AND posts an optimistic active bubble from the event text (tagged with the event `messageId`); a subsequent chat-ws row with that `id` is deduped (one bubble); with `messageId=null` (persist failed) a runtime-only fallback bubble is posted and the slot still goes DELIVERED**. The existing decoration currently always renders `after.contentText`; assert gutter-only path renders NO `after`. An `escalate` applied with `inSession=true` posts a quiet chat bubble and fires NO toast/inline; with `inSession=false` it fires the toast + inline push. **Lamp lifecycle: `take-parked`/`replace-parked` → `showLamp`; `revealParked`, `replace-delivered`, `discard-free`, `free-silent`, and a `parked_progress` free → `hideLamp`; an `active`/`take-delivered` decision never calls `showLamp`** (the invariant: lamp visible iff slot is PARKED).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — add a second `TextEditorDecorationType` (gutter icon only, no `after`) and `showGutterOnly`; route ambient to it. Make `setProactiveBadge(on)` fire for ambient too (currently active-only at `struggleInterventionService.ts:258`). Add `applyEscalation(inSession)` that branches the loudness as above.
- [ ] **Step 4: Run** both runners for these files → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(struggle): pull/push surface split + IN-SESSION escalation loudness"`

### Task C2: Hidden-ambient hold-frozen + reveal-on-click

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` (hold frozen text; on pointer click, call reveal + promote to chat)
- Modify: `extension/src/extension/api/artemisApi.ts` (add `revealAmbient(exerciseId, episodeId, hintText, level, clientMessageId) -> IrisChatMessage` → `POST .../episodes/{episodeId}/reveal` with body `{ hintText, level, clientMessageId }`, Task A10; `setEpisodeOutcome(sessionId, episodeId, outcome)` → the A10-extended `proactive-outcome` endpoint; `deleteSupersededProactiveMessage(messageId)` → `DELETE .../messages/{messageId}/proactive` (A10) for C4's durable stale-row suppression; AND `cancelOutstandingStruggleJob(exerciseId, requestToken)` → `POST .../struggle-intervention/cancel` (A10, scoped by `requestToken`) for C3's free-re-opens-the-wire — all introduced HERE so C3/C4/C5/C8 can consume them)
- Modify: `extension/src/extension/services/intervention/interventionService.ts` (lamp click) + gutter/badge click paths
- Test: `test/logic/struggleIntervention/struggleInterventionService.test.ts`

**Interfaces:**
- Consumes: `SlotManager.revealParked` (B2), `artemisApiService.revealAmbient` (A10, returns the persisted message DTO).
- Produces: on any ambient pointer click, the client `openSession(sessionId)` (the proactive session, **whose id the client already holds** — see the frozen-hint state below), calls `revealParked(hint)`, posts an **optimistic local bubble** (a `localId` uuid, a local display `timestamp`, status `sending`) into THAT session's message list with the frozen text, and calls `revealAmbient(episodeId, hintText, level, clientMessageId=localId)`; on the returned DTO it **reconciles** the optimistic bubble (sets the real `id`=messageId + `proactiveEpisodeId` + the server `sentAt`, status `sent`) — exactly the existing `sendChatMessage` optimistic-reconcile pattern, so **no duplicate row, no orphan bubble**. A failure keeps the bubble runtime-only and schedules a best-effort retry **passing the SAME `localId` as `clientMessageId`** (so the server upsert is idempotent — the retry returns the same row, A10). The slot does NOT revert to PARKED. Also produces `artemisApiService.setEpisodeOutcome(sessionId, episodeId, outcome: 'DISMISSED'|'RECOVERED'|'ABANDONED') -> { applied: boolean }`.

> **Pending-terminal-outcome back-fill (Critical fix — an explicit `DISMISSED`/`ABANDONED` is never lost to a late reveal persist).** A per-**session** `_pendingOutcomes: Map<episodeId, { sessionId, outcome }>` (lives at the session/orchestrator level, so it **survives slot teardown** — a dismiss frees the slot but the back-fill must outlast it). Whenever any `setEpisodeOutcome(...)` returns **`applied=false`** (no canonical row yet, A10), the client records the outcome here. The **reveal retry** (and a small bounded periodic flush) — which continues even after the slot is freed, because the canonical row must still land — on the persist that **creates the canonical row**, immediately **flushes** any `_pendingOutcomes` entry for that `episodeId` by re-calling `setEpisodeOutcome` (now `applied=true`, idempotent via A10 first-terminal-wins) and clears the entry. So: reveal-persist-fails → student `Dismiss` → outcome deferred (recorded) → reveal retry succeeds → the `DISMISSED` is written to the now-existing row. The genuinely-unrecoverable case (the reveal **never** persists, even across reload) is the only one left as `null`-outcome attrition (§12). This back-fill loop is owned HERE (C2) since it owns the reveal persist+retry; C5/C8 just call `setEpisodeOutcome` and rely on the `applied=false` → record path.

§5/§12: the ambient hint text is held frozen client-side (one per slot), never persisted until a click. **The frozen-hint state stores `{ episodeId, sessionId, hintText, level }` — the `sessionId` comes from the inbound ambient struggle event** (`StruggleInterventionEventDTO` already carries `p.session().getId()`, verified; A9's event-only ambient still resolves and carries the proactive session id even though it persists no row). This is how the client knows **which session to open and append the revealed bubble to** — without it, reveal could not target a session (the reveal response DTO has no session id). Clicking any pointer reveals the hint as a chat message in that session (persist then, best-effort retried). Reveal is immediate (protection starts at show, never reverts to PARKED). The reveal is idempotent (a retry with the same `clientMessageId` returns the same row, A10) so a retry never duplicates.

- [ ] **Step 1: Failing tests** — holding a parked ambient then clicking: slot moves PARKED→DELIVERED (generation bumps), an optimistic bubble is posted with the frozen text and a `localId`, `revealAmbient(episodeId, hintText, level, clientMessageId=localId)` is called once and its returned DTO reconciles the bubble's `id`/`proactiveEpisodeId`/server `sentAt` (no duplicate); a persist failure keeps the bubble runtime-only, does NOT revert to PARKED, and **schedules a retry passing the SAME `localId` (server upsert returns the same row)**; a `setEpisodeOutcome` call hits the episode-scoped endpoint. **Pending-outcome back-fill: `setEpisodeOutcome` returning `applied=false` (no row yet) records `_pendingOutcomes[episodeId]`; when the reveal retry then persists the canonical row, the pending `DISMISSED`/`ABANDONED` is flushed (re-applied, now `applied=true`) and the entry cleared — an explicit terminal outcome is never lost even though the dismiss/abandon happened before the reveal row existed; the map survives the slot free.**
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(struggle): hold ambient frozen, reveal+reconcile on click + episode-outcome API"`

### Task C3: Wire the slot core into the orchestrator

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/struggleContract.ts` (the **OUTBOUND request** type — today only `struggleSignal` + `uncommittedFiles`; add the new request fields `intent: 'decide'|'confirm_close'|'stale_check'`, `episode: { episodeId: string; isNew: boolean; hints: { level: string; text: string; atSessionS: number }[] }`, `confirmReason?: 'progress'|'stale_solved'|'parked_progress'`, **`requestToken: string`** (the per-POST scoped-cancel uuid, A6/A10) — camelCase keys, snake enum values per Global Constraints. **Without this the orchestrator cannot compile the POST**, so it lands HERE, not in C4. C4 separately extends the same file's INBOUND event type.)
- Modify: `extension/src/extension/api/artemisApi.ts` (the struggle-intervention POST method gains `intent`/`episode`/`confirmReason`/**`requestToken`** params and sends them in the body; AND `cancelOutstandingStruggleJob(exerciseId, requestToken)` from C2 is consumed here; returns the existing accepted/rejected egress result used by single-outstanding, C3)
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts`
- Modify: `extension/src/extension/telemetry/index.ts` (construct + inject `new SlotManager()` (no idgen), `StaleWatchdog`, `InFlightGuard`, `ProgressCloseLatch`; the orchestrator mints episodes via `newEpisode(now, crypto.randomUUID)`)
- Test: `test/logic/struggleIntervention/struggleInterventionService.test.ts` (extend), `test/unit/services/struggle/struggleCoordinator.test.ts`

**Interfaces:**
- Consumes: all of Phase B (incl. `ProgressCloseLatch` B8). The orchestrator owns episode minting (`newEpisode`, B1) and passes pre-built `Episode`s into `SlotManager.take*/replace*`.
- Produces: the orchestrator routes every inbound decision through `reconcile(...)`, applies the resulting `ReconcileAction` to the `SlotManager`, and gates new pops on `slot.isFree()`. The legacy ad-hoc gates (`_inFlight`/`_inFlightGen`, `_activeCount`, `_pendingSignal`, `_lastSurface`) are replaced by the slot + guard; the existing reject/backoff latches (`_annoyance`, `_dismissStrikes`, `_softSkipBudget`, course-off/404 latches) are kept (orthogonal frequency control; §13 "frequency back-off across episodes" is out of scope, the existing per-session latches stay).
- Produces (request-side plumbing, fixes from review):
  - **`_lastSignal` cache** — the orchestrator already receives every alert's `StruggleSignal` and buffers the tick trajectory; cache the most recent signal. **`confirmClose` and `staleCheck` POSTs fire outside the alert path**, so they reuse `_lastSignal` + a fresh `collectFiles()` + the live `episode` block (the request DTO always needs `struggleSignal` + `uncommittedFiles`, and the prompts render `signal_summary`). There is always a recent signal when the slot is TAKEN (an alert is what took it).
  - **`hardEvent` derivation** — when issuing a `decide`, compute `hardEvent` from the **triggering alert's** `boundaryTypes` (true iff it contains a hard boundary: FM / FM_PLUS / E4 / N1) and store it on the `InFlightGuard` pending stamp (B3). When the websocket reply lands, `reconcile(...)` reads it back (the wire reply does not carry boundary types, §6). This is the source for the one escalation case.
  - **Episode preallocation — a candidate id is sent whenever the `decide` result could create a NEW episode (FREE or PARKED), so Artemis stamps/persists the row under the SAME id the runtime slot will run under (Critical fix — no split episode).** The request `episode` is NEVER null (§11/§17). Branch by slot state at send time:
    - **FREE-slot `decide`** → preallocate a **candidate** `Episode` (`newEpisode(now, crypto.randomUUID)`, `isNew=true`, `hints=[]`), POST `toRequestEpisode(candidate)`. Response: `take-parked`→`slot.takeParked(now, candidate, hint)`; `take-delivered`→`slot.takeDelivered(now, candidate, hint)`; `silent`/`suppress`→**discard the candidate** (stays FREE).
    - **PARKED-slot `decide`** → ALSO preallocate a **candidate** (`isNew=true`, `hints=[]`) and POST it. Per the §6 matrix a PARKED-slot decide is ALWAYS a replacement-or-discard — never a continuation of the PARKED episode (§4: a PARKED replacement **ends** the old hidden episode and **starts a new `episodeId`**, with NO continuity — the old hidden hint evaporates, §5). Response: `ambient`→`slot.replaceParked(now, candidate, hint)` (the candidate becomes the new live PARKED episode); `active`→`slot.replaceWithDelivered(now, candidate, hint)` (the candidate becomes the new live DELIVERED episode — **and Artemis already persisted its `active` row under the candidate id from the request, matching the runtime slot**); `silent`→`discard-free` (discard the candidate AND free the old PARKED). So the replacement is **NOT** minted on the response (that was the bug — it left Artemis's persisted row under the old id); it is the **preallocated candidate carried in the request**.
    - **DELIVERED-slot `decide`** → send the **live** episode (`isNew=false`) — this is the only continuation case; the result is `escalate`/`suppress` on the SAME episode (DELIVERED never replaces, §6), so the live id is correct and any escalation row persists under it.
    So `request.episode().episodeId()` (A6 job stamp) is always the id the slot ends up running under: the candidate for FREE/PARKED, the live id for DELIVERED. `slot.replaceParked`/`replaceWithDelivered` (B2) now TAKE the preallocated candidate `Episode` rather than minting one.
  - **`isNew` flip — after the first ACCEPTED outbound request of ANY intent for the episode (High fix).** `isNew` is the episode-boundary marker for the request STREAM (§11/§17), and `episode` rides on **all** intents (`decide`/`confirmClose`/`staleCheck`), so the flip must key on the first accepted POST of **any** intent, NOT only `decide`. Call `markContinuation(ep)` (B1) once an outbound request carrying this episode is **accepted** by Artemis (egress `accepted`, the job was reserved) — for whichever intent comes first. A POST rejected because a job is already pending is retried next tick and MUST still carry `isNew=true` (Pyris has not yet seen the new-episode boundary), so `isNew` stays `true` across rejected/retried attempts and flips to `false` exactly once Pyris has received the first request of the episode. This prevents a non-`decide` first request (or repeated `confirmClose`/`staleCheck`) from re-sending `isNew=true` and making Pyris treat them as repeated fresh-episode starts. A replacement episode (a fresh candidate) starts `isNew=true` again.
  - **Single-outstanding discipline** — the orchestrator issues at most one struggle POST (`decide`/`confirmClose`/`staleCheck`) at a time; while one is outstanding it does NOT issue another, and a POST that returns a non-accepted egress (Artemis rejected it because a job is already pending) is **dropped and retried next tick** (B3 correlation rationale). This is what lets the websocket reply correlate by `kind` + stamp without a wire token. **An owed `confirmClose` (`latch.shouldPost()`) is retried every tick until the wire is free and `onPosted()` consumes it** (B8) — a progress edge is never lost to a busy wire.
  - **Per-request `requestToken` (the scoped-cancel identity, A6/A10).** The orchestrator **mints a fresh `requestToken` (uuid) on every struggle POST** (`decide`/`confirmClose`/`staleCheck`) and remembers it as part of the in-flight marker `{ requestToken, episodeId, generation, intent }`. It is sent on the request and stamped on the job, so a cancel can target THIS request specifically.
  - **Free re-opens the wire — SCOPED cancel (Critical fix — `cancelOutstandingStruggleJob(exerciseId, requestToken)`, A10).** Because of single-outstanding, a slot freed while a struggle request is still in flight would otherwise leave the wire blocked until the stale reply lands — so FREE would not actually re-open the gate (§2/§6/§7.2). Therefore: on **every slot free / terminal where a struggle request is still in flight** (dismiss, ABANDON-timer, force-free, stale-free; NOT `replace`, where the in-flight `decide` IS completing into the replacement), the orchestrator calls the cancel **with the in-flight request's `requestToken`** and clears its local in-flight marker, so the **next `decide` POSTs immediately**. Scoping by `requestToken` is what prevents a `cancel(A)` from removing a since-accepted B (A already completed server-side): Artemis only removes the job whose token matches. The cancelled job's late reply is dropped (server: no job; client: generation guard). This is part of `clearEpisodeRuntime()`'s terminal handling when an in-flight request exists.
  - **`revealParked` cancels the stale in-flight request AND re-evaluates under DELIVERED — it does NOT silently drop the work (Critical fix).** A reveal (PARKED→DELIVERED) is non-terminal but **bumps the generation**, so any in-flight `parked_progress` `confirmClose` / `decide` for the PARKED episode becomes stale. The reveal cancels it (scoped: `cancelOutstandingStruggleJob(exerciseId, <in-flight requestToken>)` + clear the in-flight marker, so the wire re-opens — the scoped token can't hit a fresh follow-up B). **But cancelling alone would lose real engine work, so the reveal then RE-OWES it under the now-DELIVERED state:**
    - If the cancelled/owed work was a **progress close** (a `parked_progress` confirmClose that was in flight or owed, OR the latch was in `pending-post`/`candidate-close`): the progress edge is still valid (a green test / sBase drop happened) and the episode is now DELIVERED, so **re-owe `_owedConfirmClose = {progress}`** (a DELIVERED progress close) rather than discarding it. So the mandatory §7.1 two-stage confirmation is **converted** to the delivered-close path, not lost. (The latch is left able to drive `onConfirmResult` for the re-owed close; do not `reset()` away the owed edge — transition it.)
    - If the cancelled work was a **`decide`**: **re-post a fresh `decide` with `_lastSignal` under the DELIVERED slot** (next-tick, via the normal owed-decide path) so the latest signal is re-evaluated under DELIVERED reconciliation — the one allowed escalation case (`active` + hardEvent on a delivered-ambient slot, §6) is therefore considered, not skipped until some new event. The fresh decide's result is still gated by `reconcile` (escalates only if warranted), so this is safe.
    So no owed close or pending evaluation is lost to the reveal; the wire re-opens AND the work continues under the correct (DELIVERED) semantics.
  - **`inSession` source** — subscribe the chat view's visibility/focus event (the provider already tracks visibility, `chatWebviewProvider.ts:342`) and call `slot.setInSession(open)` (NON-semantic, no generation bump). Escalation loudness is read from `slot.snapshot().inSession` at apply time (C1).
  - **`watchdog.resetProgress` / `arm` / `disarm` / `tick` callers** — `arm` on every slot TAKE, `disarm` on every FREE, `resetProgress(now)` on **HARD progress only** (a new green test, a sustained `sBase` drop) and on the "Still on it" button (C5) — **NOT on anchor-local edits** (task-relevance is Iris's job, §7.3/§11/§13; Medium fix). `tick` from the host `setInterval` increments the window on every DELIVERED fire and emits `force-free` at the ceiling (wire-independent, the §13 bound). On a `fire-stale-check`, owe a best-effort `staleCheck` (`_owedStaleCheck`) only if `canPostAsk()` — the window already advanced regardless. Cancel an in-flight `staleCheck` on any ask button and on slot free (B4).

This is the integration seam. **C3 DEFINES the orchestrator's inbound handlers — `onServerAmbient` / `onServerActive` / `onServerSilent` / `onServerClose` / `onServerStale` (the slot-reaction LOGIC) — and unit-tests them with synthetic replies; C4 only parses the wire frame and DISPATCHES to these handlers** (so the seam is testable on both sides without big-bang, Medium fix). Build it as a thin adapter. The `decideOutcome` pre-gate stays; after it: **mint a fresh `requestToken` (uuid)**, POST `decide` with the `episode` block (**preallocated candidate on FREE or PARKED**, the live episode only on DELIVERED — per the preallocation rule above) + the `requestToken`, cache `_lastSignal`, stamp the `InFlightGuard` with `(episodeId, generation, hardEvent, requestToken)`, and flip `isNew` **only once the POST is accepted** (`markContinuation`, per the `isNew`-flip rule above — never on a rejected/retried attempt). When `onServerAmbient/Active` lands → `accept(...)` the guard with the expected identity (the live episode on DELIVERED, or the pending candidate when FREE/PARKED; drop if `null`), `reconcile(slot, decision)`, apply the action (take/replace-parked/replace-delivered/reveal/escalate/discard/suppress; the candidate becomes live on take/replace, is discarded on silent/suppress), drive surfaces (C1/C2).

**One `_owedConfirmClose` entry (loss-proof under a busy DECIDE wire; at most one CLOSE per episode).** The orchestrator holds **at most one** owed confirmClose `{ confirmReason }`, set by (a) the **progress latch** when `latch.shouldPost()` and **no `confirmClose` is in flight**, with the reason picked by slot state → DELIVERED yields `{reason:'progress'}`, PARKED yields `{reason:'parked_progress'}` (the silent never-delivered close, B8/§4); or (b) the **stale-ask "solved" button** (C5, DELIVERED-only — PARKED has no stale-ask, §7.3) → `{reason:'stale_solved'}` (this one may be queued **even while a `confirmClose` is in flight**, per the guarded rule below). A PARKED episode can only ever owe `parked_progress` (no `solved` button exists for it), so the coalescing below is a DELIVERED-only concern.
- **Coalescing / precedence (deterministic — both triggers BEFORE posting).** `stale_solved` (explicit) **supersedes** `progress` (inferred): a `solved` click while a `progress` close is owed overwrites the owed reason to `stale_solved`; a progress edge while `stale_solved` is owed leaves it `stale_solved`. At most one reason is ever owed.
- **Queue-while-in-flight, guarded so at most one CLOSE ever applies (reconciles §6 with §7.3).** §6 "cannot apply twice" means a confirmClose cannot **close** the episode twice. A confirmClose that returns `resolved=false` did **not** close (it is a no-op close). So: a `solved` click while a `progress` confirmClose is in flight is **queued** as `_owedConfirmClose{stale_solved}`; when the in-flight one returns:
>   - `resolved=true` → the slot is FREE; **slot-free clears the owed entry** (the queued one never fires; the async guard would drop it anyway). Exactly one close applied. ✓ §6.
>   - `resolved=false` → the slot stays TAKEN; the owed `stale_solved` then POSTs and yields the spec-required gentle offer (or a close if Iris now agrees). ✓ §7.3 ("never a silent no-op" for the solved path).
>   A `progress` edge arriving while a confirmClose is in flight does NOT queue (the latch re-arms on `onConfirmResult(false)` via a fresh edge instead). So the only queued in-flight trigger is the explicit `solved` button, and it can never produce a second CLOSE.
- **Single fire on drain.** When the owed confirmClose is POSTed (accepted), clear `_owedConfirmClose` **and call `latch.onPosted()` regardless of reason** — safe because `onPosted()` is a **total function** (B8): from `open` (a `stale_solved` close with no progress edge ever armed) it is a **no-op**; from `pending-post` (a progress edge that `stale_solved` superseded) it consumes the edge so the progress latch cannot fire a second close. The single `onServerClose` response drives `latch.onConfirmResult(resolved)` uniformly.

Each tick / whenever the wire becomes free (no struggle POST outstanding): if an owed confirmClose exists (either slot state) → POST `confirmClose` (payload = `_lastSignal` + fresh files + episode + the owed `confirmReason`), then clear + `latch.onPosted()` on acceptance. So an owed close set while a **`decide`** was in flight is **not lost** (it drains when the decide completes). The owed reason already encodes the slot state (`parked_progress` for PARKED, B8); the **silent free** of a PARKED slot happens only when its `confirmClose` returns `resolved=true` (C4), never on the engine signal — so a false-positive edge cannot discard an un-confirmed PARKED pointer. A slot free clears `_owedConfirmClose`.

> **One `confirmClose` IN FLIGHT at a time (§6 single-flight), at most one that CLOSES the episode (§6 "cannot apply twice"), and the `solved` button is NEVER silently dropped (§7.3).** These three reconcile as follows. (a) **Single-flight:** the orchestrator never has two `confirmClose` POSTs outstanding — a new owed entry POSTs only when the wire is free. (b) **Pre-post collision** (both triggers owed before either posts): coalescing (above) merges progress-edge + `solved` into ONE owed call, `stale_solved` winning. (c) **`solved` click while a `confirmClose` is already in flight:** it is **QUEUED** as `_owedConfirmClose{stale_solved}`, **not dropped**. It drains **only after** the in-flight close returns, and **only if** that close returned `resolved=false` (it did NOT close — a no-op close, so §6's "cannot apply twice" is not violated): the queued `stale_solved` then POSTs and yields the §7.3 gentle offer (or a real close if Iris now agrees). If the in-flight close returned `resolved=true`, the slot is already FREE and slot-free clears the queued entry (one CLOSE total). So **exactly one `confirmClose` ever CLOSES** an episode, yet a `solved` click is **always eventually honoured** — never a silent no-op (§7.3). A bare `progress` edge arriving mid-flight does NOT queue (the latch re-arms on `onConfirmResult(false)` via a fresh edge instead), so the only mid-flight trigger that queues is the explicit `solved` button.

Feed `ProgressCloseLatch.observe` each tick (green test from `onNewResult`; `sBase` from `onTick`). Tick the `StaleWatchdog` from a host `setInterval`; handle its events:
- **`fire-stale-check`** (DELIVERED): the window already incremented inside `tick` (B4). If `watchdog.canPostAsk()` AND no ask is open → set **`_owedStaleCheck = true`** (a best-effort POST). Past the cap → do nothing (the window still advanced). The owe does NOT affect the window, so the §13 force-free bound is wire-independent.
- **drain `_owedStaleCheck`** each tick / when the wire frees: if owed AND the wire is free AND no ask is open AND no `staleCheck` is in flight → POST `staleCheck` (stamp a fresh `stale_check_id`, arm `InFlightGuard`), then clear `_owedStaleCheck`. So an owed check set while a `decide`/`confirmClose` was in flight is **retried** so the ask runs as soon as the wire frees — but it never gates the window/force-free.
- **`force-free`** (emitted by `tick` at `staleWindowMax`): free + `setEpisodeOutcome(ABANDONED)` + `clearEpisodeRuntime()` + post `foldEpisode { episodeId }`.
- **`free-silent`** (PARKED): free + `clearEpisodeRuntime()`.

`_owedStaleCheck` is cleared by `clearEpisodeRuntime()` (every terminal) and by any ask button (C5) — so a stale owed check never posts a question into a freed or already-asked episode.

> **One `clearEpisodeRuntime()` helper, called on EVERY terminal transition — the single place that tears down ALL per-episode runtime state.** Every slot free / terminal (progress close, dismiss, stale-free, parked discard, force-free, replace) calls it, and it does ALL of: `latch.reset()`, `watchdog.disarm()`, clear `_owedConfirmClose`, clear `_owedStaleCheck`, cancel any in-flight `staleCheck` (`stale_check_id` + `InFlightGuard.cancel('stale_check')`), and **clear the live stale-ask binding `{askId, messageId, episodeId}` (C4)**. Clearing the binding is what **neutralises the still-scheduled host ABANDON `setTimeout`**: that timer's callback fires its effect only `if deadlineLatch.isCurrent(thatDeadline) AND the ask is still open` (C5) — with the binding cleared, "the ask is still open" is **false**, so the callback is a **no-op** and never writes `ABANDONED`. (`DeadlineLatch` is a pure value holder, B3 — there is no timer to cancel and no `disarm` on it; the binding check is the gate. The host need not clear the `setTimeout` handle.) This is **load-bearing on non-button terminals**: if a progress-close or a `force-free` frees the slot while a stale-ask is open, the cleared binding stops later free-text/buttons from being routed to the dead ask AND stops the pending ABANDON timer from firing. **Backstop (defense in depth):** even if a stray `setEpisodeOutcome(ABANDONED)` did fire, the episode already carries `RECOVERED`/`DISMISSED`, so **episode-wide first-terminal-wins (A10)** rejects it server-side. **`revealParked` (PARKED→DELIVERED click) is the one NON-terminal exception that still partially clears:** it calls `latch.reset()` + clears `_owedConfirmClose` + **scoped-cancels any in-flight request (`cancelOutstandingStruggleJob(exerciseId, <in-flight requestToken>)`) and clears the in-flight marker so the wire re-opens for the now-DELIVERED episode (High fix)** — the generation bump on reveal (B2) already drops the in-flight `parked_progress` reply via the async guard, but the latch would otherwise stay stuck in `candidate-close` AND the wire would stay blocked — yet it does **NOT** disarm the watchdog or clear an ask binding (the same episode continues, now delivered).

> **Fold signaling on terminals — every DELIVERED episode collapses (§8/§9), via ONE `foldEpisode` message.** A terminal of a **DELIVERED** episode posts a host→webview `foldEpisode { episodeId, praise? }` (C7 renders the collapse): a **progress close** posts it **with** `praise: { episodeLabel, closeMessageId }` (C4 `onServerClose`, the order-safe praise fold §8); **every other DELIVERED terminal** — dismiss (C8), stale-free / ABANDON-timer / force-free / "Doing something else" (C3/C5) — posts it **without** `praise` (an immediate non-praise fold with a client-derived label §8). So dismiss/timeout/abandon are no longer "free the slot but never told the webview to fold": the fold is a deterministic signal, not an inference. (The webview dismiss path MAY still collapse optimistically, but the host `foldEpisode` is the authoritative instruction and is idempotent with it.) **PARKED terminals post NO `foldEpisode`** — a never-delivered ambient has no visible artifact to collapse (§8). So: emit `foldEpisode` iff the freed slot was DELIVERED.

- [ ] **Step 1: Failing tests** —
  - the canonical §1 bug: an `active` delivered, then a later `ambient` decision arrives → `reconcile` returns `suppress`, the ambient does NOT replace the delivered surface (today it does).
  - a PARKED ambient + a different-problem `ambient` → `replace-parked` using the **preallocated candidate** id (the new PARKED episodeId == the candidate sent in THIS decide's request, NOT minted on the response), still PARKED.
  - a PARKED ambient + an `active` decision → `replace-delivered` using the **preallocated candidate** id; **the request carried the candidate, so Artemis persisted the `active` row under the candidate id == the runtime slot's new episodeId** (no split, Critical fix); active shown immediately, NOT another hidden pointer (§6).
  - **a PARKED-slot `decide`'s request carries a preallocated candidate (`isNew=true`, `hints=[]`), NOT the live PARKED id** — so the replacement episode's first persisted row and the runtime slot share ONE id; a `silent` response discards the candidate AND frees the old PARKED.
  - a decision arriving at a stale generation is dropped by the guard (`accept` returns `null`).
  - escalation: a delivered-then-revealed ambient + an inbound `active` whose triggering alert had a hard boundary → `escalate`; the same with a non-hard boundary → `suppress`.
  - a `newGreenTest` while the slot is DELIVERED → a `confirmClose` POST is issued exactly once (via the latch) with `confirmReason="progress"`; a second green test before the reply does not double-fire.
  - a `newGreenTest` while the slot is **PARKED** → a `confirmClose` POST is issued exactly once with `confirmReason="parked_progress"` (NOT an engine-only free). On the reply: `resolved=true` → the slot frees silently (`discardParkedToFree`) + `latch.reset()`, no message, no row, no outcome (§4/§8/§12); `resolved=false` → the slot stays PARKED and a fresh edge is required to re-arm (§7.1). A false-positive edge therefore cannot discard an un-confirmed PARKED pointer.
  - **a `parked_progress` `confirmClose` in flight, then the student CLICKS the pointer (PARKED→DELIVERED, same episodeId)** → the late reply is dropped by the generation guard (`accept` returns `null`); reveal ALSO **scoped-cancels the in-flight request by its `requestToken`** (so the wire re-opens) and `latch.reset()`s, so a subsequent `newGreenTest`/`decide`/`staleCheck` on the now-DELIVERED episode is **not blocked**; a follow-up request B (fresh `requestToken`) is never hit by the cancel.
  - **scoped cancel: `cancel(tokenA)` while the pending job carries `tokenB` (A finished, B accepted) is a NOOP — B survives (Critical fix); `cancel(tokenA)` while A is pending removes A.**
  - **first `decide` from a FREE slot carries a non-null preallocated `episode` (episodeId set, isNew=true, hints=[]); a `silent` response discards the candidate and the slot stays FREE; an `ambient` response makes that same candidate episodeId the live PARKED episode.**
  - **`isNew` flips after the first ACCEPTED request of ANY intent: e.g. a rejected `decide` (job pending) retries with `isNew=true`; once accepted, `isNew` flips to `false`; a subsequent `confirmClose`/`staleCheck` for that episode carries `isNew=false` and never re-sends `isNew=true`.**
  - **an owed `confirmClose` set while a `decide` is in flight is NOT lost: it POSTs once the wire frees** (both the progress edge and the `solved` button).
  - **a `solved` click while a `confirmClose` is in flight is queued (`stale_solved`): if the in-flight returns `resolved=true` the slot frees and the queued one is cleared (one CLOSE, §6); if `resolved=false` the queued `stale_solved` POSTs and yields the gentle offer (§7.3).** Exactly one confirmClose ever CLOSES the episode.
  - a first FREE-slot `decide` response is accepted against the **pending candidate** episodeId (not a live episode); `silent` discards the candidate (slot stays FREE), `ambient` promotes it to the live PARKED episode.
  - **TAKEN-slot `silent` via the same reconcile path:** `PARKED + silent` → `discard-free` (the parked episode frees, no row); `DELIVERED + silent` → `suppress` (no surface change). Both clear the outstanding `decide`.
  - **coalescing:** a `solved` click while a `progress` confirmClose is owed (not yet posted) overwrites the reason to `stale_solved` and only ONE `confirmClose` is POSTed; draining it calls `latch.onPosted()` so the progress latch cannot fire a second close.
  - a `confirmClose`/`staleCheck` POST carries `_lastSignal` + freshly collected files (no null signal).
  - **window-on-every-fire (§13 bound, wire-independent): each `tick` fire increments `windowCount` even when the wire is busy and the `staleCheck` cannot POST; after `staleWindowMax` fires `tick` emits `force-free` regardless of how many staleChecks actually ran → free + `ABANDONED` + `foldEpisode`. A busy wire can never postpone force-free.**
  - **best-effort owed `staleCheck`: a `fire-stale-check` while `canPostAsk()` AND the wire is BUSY sets `_owedStaleCheck`; when the wire frees it POSTs the ask — but the window already advanced on the fire, so the ask is delayed, never the bound.**
  - a slot free (any reason) calls `clearEpisodeRuntime()` (latch reset, watchdog disarmed, owed-close AND owed-staleCheck cleared, in-flight staleCheck cancelled, live-ask binding cleared); **a free while a stale-ask is open neutralises the pending ABANDON timer (it fires as a no-op because the ask binding is gone).**
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the adapter; delete the superseded ad-hoc fields; keep the backoff latches.
- [ ] **Step 4: Run** `test/logic` + the coordinator `test/unit` → PASS; `npm run check-types`.
- [ ] **Step 5: Commit** — `git commit -m "feat(struggle): route interventions through the slot (fixes blind-overwrite)"`

### Task C4: Websocket subscription — carry new fields + close/stale dispatch

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/struggleContract.ts` (extend `StruggleInterventionEvent` with `kind`, `episodeId`, `resolved`, `closingSentence`, `episodeLabel`, `offer`, `ask`, `question`; `action="silent"` is already representable)
- Modify: `extension/src/extension/services/struggleIntervention/struggleEventSubscription.ts` (`classifyStruggleEvent` **parses** the wire frame into a typed reply; `subscribeStruggleEvents` **dispatches** it to the orchestrator's `onServerSilent` / `onServerClose` / `onServerStale` handlers). **This task owns only PARSING + SUBSCRIPTION + DISPATCH**; the handler LOGIC (the slot reactions for those replies) is defined and unit-tested in **C3** (which already owns `struggleInterventionService.ts` and the orchestrator's slot reactions). So C4's tests assert "this wire frame parses to this reply and calls this handler with these args"; C3's tests assert "this handler applies this slot transition / `foldEpisode` / outcome" with synthetic replies — no big-bang at the seam (Medium fix). C4 does NOT re-implement the reaction logic.
- Modify: `extension/src/extension/services/iris/chat/irisWebSocketMessageHandler.ts:70-81` (the `AddMessage` builder now forwards `proactiveEpisodeId` and the FULL `proactiveOutcome` enum from the MESSAGE frame — today it only maps `origin` + `proactiveOutcome==='DISMISSED'`)
- Modify: `extension/src/webview/stores/useChatStore.ts:182` (`addMessage` **dedups by `id`** — skip the append if a message with that `id` already exists OR if its `id` is in the new `suppressedIds` set; ADD a `removeMessage(id)` action that removes the row if present AND records `id` in `suppressedIds` (so a later-arriving stale row is also skipped) — drives the stale-row suppression below. Fixes the existing latent double-insert and makes the live proactive insert idempotent. The `foldEpisode` state (the runtime fold-label map + pending-fold tracking) on this same store is added by C7.)
- Modify: `extension/src/shared/messageContracts/extensionMessages.ts:339-364` (widen the `addMessage.message` AND `loadMessages.messages` shapes with `proactiveEpisodeId?: string` and `proactiveOutcome?: 'DISMISSED'|'RECOVERED'|'ABANDONED'`; ADD a host→webview `foldEpisode { episodeId: string; praise?: { episodeLabel: string; closeMessageId: number } }` message — the single fold instruction for EVERY terminal: `praise` present = progress close (carries the non-persisted `episodeLabel` §12 AND the `closeMessageId` so the ~5s timer binds to the actual close row, order-safe); `praise` absent = a non-praise fold (dismiss / stale-free / ABANDON / force-free) with a client-derived label; ADD a host→webview `removeMessage { id: number }` message for stale-row suppression, see below)
- Modify: `extension/src/webview/views/IrisChat/types.ts` (the store `ChatMessage` gains `proactiveEpisodeId?: string` + the widened `proactiveOutcome` enum — consumed by C6 grouping and C8 dismiss; C6 adds the `staleAsk?` marker on top)
- Modify: `extension/src/extension/services/iris/chat/chatSessionService.ts:357-368` (the history-load mapper forwards `proactiveEpisodeId` + the widened outcome from `IrisChatMessage`, so reloaded rows group by episode too)
- Modify: `extension/src/shared/types/apiResponses.ts` (`IrisChatMessage.proactiveEpisodeId?: string` + widened outcome — the reload DTO)
- Test: `test/logic/struggleIntervention/struggleEventSubscription.test.ts`; `test/react/stores/useChatStore.test.ts` (the dedup)

> **Every inbound frame is validated by its ECHOED `episodeId` (Medium fix — uses the field the wire pays to carry).** Before applying any `onServer*` frame, the orchestrator drops it unless `event.episodeId === expectedEpisodeId` (the live episode for a DELIVERED-issued decide / confirmClose / staleCheck, or the pending candidate for a FREE/PARKED-issued decide) — in addition to the `InFlightGuard.accept` token/generation check. A mismatched/misrouted echo is dropped, not applied.
>
> **Stale persisted-row suppression (Critical — the server-stateless complement to the client generation guard).** Artemis is **stateless about the slot** (§11), so a `decide`/`confirmClose`/`staleCheck` response that became **stale** while in flight (the slot changed generation via reveal / replace / free / dismiss, §6) is **still persisted + broadcast** server-side before the client can reject it — leaving a stray chat row (e.g. a late `active` from a superseded `decide`, or a closing row for an episode the student already dismissed). The control event carries that row's **`messageId`**, so whenever the orchestrator **drops** an `onServer*` frame as stale (the `accept` token/generation check returns `null` **or** the `episodeId` echo mismatches) AND the frame carries a `messageId`, it does TWO things: (live) posts a host→webview **`removeMessage { id: messageId }`** — the store **removes** that row if already inserted AND records the id in a **`suppressedIds` set** that `addMessage` consults, so a chat-ws row arriving **after** the drop (the two ride different topics, either order) is **never inserted**; (durable) calls **`artemisApiService.deleteSupersededProactiveMessage(messageId)`** (A10) so the row does not survive to the next history reload. The durable delete is guarded server-side (null-outcome + proactive-origin only), so it can never remove a canonical outcome row. This is the row-level twin of the generation guard: the guard rejects stale **control**, `removeMessage`/`suppressedIds` reject the matching stale **row**. (The server still never sees slot state; correctness is entirely client-side, keyed by the `messageId` the event already carries.) Backstop: a stale row that briefly appeared before removal carries the episode's `proactiveEpisodeId`, so it folds into that episode's group rather than floating loose, and a terminal outcome on the episode is unaffected (episode-wide first-terminal-wins, A10).
>
> **The three `decide` frames (`ambient`/`active`/`silent`) all route through ONE handler → `reconcile(slot, {action})` → apply, and ALWAYS clear the outstanding `decide` (single-flight complete).** `silent` is not special-cased to the FREE candidate; it reconciles against the CURRENT slot state per §4/§6:
> - **FREE + silent** → `reconcile`→`suppress` → discard the pending candidate, stay FREE.
> - **PARKED + silent** → `reconcile`→`discard-free` → `slot.discardParkedToFree()` (the parked ambient frees, no row, §4) — this is exactly why an unfired `silent` must reach the client: otherwise a PARKED episode could get stuck.
> - **DELIVERED + silent** → `reconcile`→`suppress` → no surface change; the slot stays as is.
> In every case the outstanding `decide` is cleared so the next tick can POST.

> **Live proactive-message transport — ONE source of truth (fixes the double-insert / missing-metadata gap).** A persisted proactive **row** (the `active` hint, the closing message, the `stale_solved` offer, the stale-ask question) reaches the webview chat list LIVE via the **existing per-session Iris chat websocket only** — Artemis `irisChatWebsocketService.sendMessage(...)` → `MESSAGE` frame → `irisWebSocketMessageHandler.ts:70` → `AddMessage` → `useChatStore.addMessage`. That frame now carries `proactiveEpisodeId` (it is on `IrisMessageResponseDTO`, A9) + the full `proactiveOutcome` enum, so **live rows already carry their episodeId and group/fold immediately** (no wait-for-reload). The **struggle-intervention event is CONTROL-ONLY for the row it persists** (it drives the slot state machine, the `askId` binding, the badge/toast, and the fold trigger), **with ONE optimistic-UI exception: the `active` first-delivery / escalation event carries the hint TEXT + its `messageId`, and the client shows an OPTIMISTIC bubble from it** (the same optimistic pattern as reveal) so the §5 "bubble appears automatically" is **immediate** and **survives a server persist failure** (§12, A9 active-failure path). That optimistic bubble is tagged with the event `messageId`, so the chat-ws persisted row (`id === messageId`) is **deduped** — one bubble. If the persist permanently failed (`messageId=null`), the optimistic bubble is a **runtime-only fallback** (gone on reload, episode absent §12). The closing / offer / stale-ask events stay strictly control-only (their rows appear via chat-ws when the server posts; no optimistic bubble). Two guarantees make this single-source:
> - **`useChatStore.addMessage` dedups by `id`** — a second arrival of a row whose `id` is already present is dropped. This kills the existing latent `active` double-insert (live append + `openSession` full-history reload) and any reload/append overlap.
> - **A11 broadcasts every new proactive row via `sendMessage`** (exactly like `handleDecision`'s `active` path) so closing/offer/stale-ask rows arrive live; the matching struggle event carries that row's `messageId` so the client can bind buttons / trigger the fold against the row whose `id === messageId` (order-independent: the webview attaches when both the row and the control are present).
> So `onServerClose`/`onServerStale` below **do not themselves post chat rows** — they consume the control event; the row is delivered by the chat-ws path and deduped. (The reveal-on-click row in C2 is the one client-originated insert; `revealAmbient` therefore does **NOT** `sendMessage`-broadcast — the optimistic bubble + the returned-DTO reconcile are the single insert, and the `id` dedup covers any retry.)

**Interfaces:**
- Consumes: A11's extended event (the existing `messageId` field is now populated for every persisted proactive mode — `active`, `confirmClose` close/offer, `staleCheck ask=true`); the live row itself arrives via the chat-ws `AddMessage` path (above), carrying `proactiveEpisodeId`.
- Produces: `onServerClose(episodeId, resolved, messageId?, closingSentence?, episodeLabel?, offer?)`, `onServerStale(episodeId, ask, messageId?, question?)` dispatch.

§7.1/§7.3: `onServerClose` routes by the **client's own current slot state** for that `episodeId` (which is authoritative for PARKED vs DELIVERED — the engine signal no longer frees PARKED preemptively, and DELIVERED never reverts to PARKED, §12 — so the state at reply time is reliable):
- **DELIVERED**, `resolved=true` → `progressCloseLatch.onConfirmResult(true)`, free the slot immediately; the closing message **row arrives via the chat-ws path** (its `closingSentence` text is the persisted row, A11 `sendMessage`, deduped by `id`) — the client does NOT insert it. The handler posts a host→webview **`foldEpisode { episodeId, praise: { episodeLabel, closeMessageId: <the close row's messageId from the event> } }`** (§12: `episodeLabel` is **NOT persisted**, so the live fold label can ONLY come via this control message; the `closeMessageId` makes the fold **order-safe** — C7 starts the ~5s timer only once the close row with that id is present, never folding before the praise renders). The webview then renders the praise row, runs the ~5s timer, and folds episode `episodeId` to `✓ <episodeLabel>` (C7). On reload there is no `foldEpisode` (runtime-only), so the fold label falls back to a client-derived gist (§8). **`RECOVERED` was written server-side (A11); the client ALSO calls `setEpisodeOutcome(RECOVERED)` (idempotent via first-terminal-wins) so that if the server's write deferred (`applied=false`, the canonical row not yet persisted), the client's pending-outcome back-fill (C2) writes it once the row exists — RECOVERED is not lost to a late delivery persist either.**
- **DELIVERED**, `resolved=false` → `progressCloseLatch.onConfirmResult(false)` (re-opens for a fresh edge, B8); the slot stays TAKEN. The offer **row arrives via the chat-ws path only when the event signals an offer was persisted** (`messageId` present — the `confirmReason="stale_solved"` path, A11); a progress-triggered `resolved=false` carries no `messageId` (quiet) so no row exists. The handler does not insert the offer; it only notes the slot stays TAKEN.
- **PARKED** (the `confirmReason="parked_progress"` round-trip, §4/§8), `resolved=true` → `progressCloseLatch.onConfirmResult(true)` then `slot.discardParkedToFree()`: free **silently** — no closing message (the server persisted none, A11), no fold-line, no `RECOVERED` outcome (never-delivered = unscored, §12). `resolved=false` → `progressCloseLatch.onConfirmResult(false)`; the slot **stays PARKED**, no re-fire until a fresh edge.

**Stale-ask `askId` minting + binding (resolves the live-delivery contract).** `onServerStale` with `ask=true` (and `stale_check_id` current + no ask open): the persisted stale-ask row already exists server-side and its `messageId` rides on the event. **The CLIENT mints a runtime `askId` (uuid) here in C4** and binds it to that `messageId` (records the live ask = `{ askId, messageId, episodeId }` in the orchestrator), then calls `onAskPosted()` and posts the host→webview `addStaleAsk { episodeId, askId, messageId, question }` (C5). The webview attaches the live buttons to the message row whose id === `messageId` (NOT a synthetic duplicate). On reload the same row loads as a normal proactive message; the runtime `askId` is gone (never persisted), so it renders as plain text with no active buttons (§12/§16, C6). `ask=false` → noop (do not consume `staleAskCount`; the watchdog may re-check). Both close branches also reach the latch when the close was triggered by the stale-ask "solved" button (C5) rather than a progress edge.

- [ ] **Step 1: Failing tests** — `classifyStruggleEvent` round-trips the new fields incl. `messageId`; a `kind="decide" action="silent"` frame whose `episodeId` matches the pending candidate → `onServerSilent` discards the candidate + clears the outstanding decide (slot stays FREE); a `kind="confirm_close"` frame on a **DELIVERED** episode with `resolved=true` → frees the slot + **triggers the fold** (does NOT insert a chat row — the closing row is delivered by the chat-ws path); a `kind="confirm_close"` frame on a **PARKED** episode (`parked_progress`) with `resolved=true` → `discardParkedToFree`, **no message, no fold, no outcome**; the same on a PARKED episode with `resolved=false` → the slot **stays PARKED**; a `kind="stale_check" ask=true` frame mints an `askId`, binds it to the event's `messageId`, and posts `addStaleAsk` with both; a `kind="stale_check" ask=false` frame is a noop (no ask posted, no askId minted); **a frame whose echoed `episodeId` does NOT match the expected episode is dropped (not applied)**; **`useChatStore.addMessage` ignores a second row with an `id` it already holds (dedup), so a live `AddMessage` + an `openSession` reload of the same proactive row yields ONE bubble**; **stale-row suppression (Critical): a control frame dropped by the generation/episodeId guard that carries a `messageId` posts `removeMessage{id}`; the store removes that row if present AND a subsequently-arriving chat-ws row with that `id` is NOT inserted (`suppressedIds`) — both arrival orders yield zero stray bubbles**; **a `foldEpisode{episodeId, praise:{episodeLabel, closeMessageId}}` frame stores the runtime fold label + the pending close-row binding; a `foldEpisode{episodeId}` (no praise) marks an immediate non-praise fold.**
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(struggle): subscribe decide(silent)/confirmClose/staleCheck events through the slot"`

### Task C5: Reply-routing hook + stale-ask buttons (host side)

**Files:**
- Modify: `extension/src/extension/services/iris/chat/chatMessageService.ts` (before the Artemis POST in `_sendToIris`, consult the slot: a free-text reply resets the ABANDON timer if an ask is open — it NEVER blocks or alters the POST)
- Modify: `chatWebviewProvider.ts` (handle a new `WebviewCmd.StaleAskButton` → `routeReply` → drive the slot)
- Modify: `extension/src/shared/messageContracts/extensionMessages.ts` (add the stale-ask render payload + the button command)
- Test: `test/logic/struggleIntervention/...` + `test/unit` for the provider command

**Interfaces:**
- Consumes: `routeReply` (B6), `DeadlineLatch` (B3), `setEpisodeOutcome` (C2).
- Produces: a webview→host command `staleAskButton { askId, button }` (the `askId` proves liveness, C4); a host→webview message `addStaleAsk { episodeId, askId, messageId, question }` (the `messageId` is the persisted stale-ask row the buttons attach to, C4/C6).

§16: free-text is byte-for-byte unchanged on its way to the exercise-chat pipeline; the only coupling is the provisional local timer grace. Buttons drive the slot deterministically client-side; a button's `askId` must match the live ask (else ignored). Buttons disable after first click (no double-fire). The button handler cancels the in-flight `staleCheck` (clear `stale_check_id` + `InFlightGuard.cancel('stale_check')`, B4) so no second question can post. Per-button effect (B6 `routeReply`):
  - **solved** → set `_owedConfirmClose = {reason:'stale_solved'}` (the orchestrator drains it when the wire is free, C3). If a `confirmClose` is already in flight it is **queued and drains only if that one returns `resolved=false`** (slot still TAKEN) — if it returned `resolved=true` the slot freed and this queued entry is cleared (one CLOSE, §6); on `resolved=false` it yields the gentle offer (§7.3). Close the ask UI immediately (buttons disabled). It does NOT POST directly.
  - **still-on-it** → `stay`: cancel the in-flight `staleCheck`, close the ask, and `watchdog.resetProgress(now)` so a FRESH stale window starts (the `ask#1 → "Still on it" → drift → ask#2` flow, §7.3).
  - **something-else** → free the slot silently + `setEpisodeOutcome(ABANDONED)`.
- **Free-text timer grace + the ABANDON expiry (end-to-end, §7.3/§16).** When the ask is posted (C4), `DeadlineLatch.arm(now, abandonInitialMs, abandonCeilingMs)` and the host **schedules a `setTimeout` to `deadlineLatch.current()`**; on fire, if `isCurrent(thatDeadline)` AND the ask is still open → **free the slot (`ABANDONED`) + `setEpisodeOutcome(ABANDONED)`** (C2). A free-text reply calls `advance(now, abandonFreeTextMs)` **immediately on submit** (so a slow send/ack never ABANDONs mid-engagement), bounded by the ceiling, and **reschedules** the timeout to the new deadline. The reset is **provisional**: capture `current()` before `advance`; on a **hard send failure** (the chat POST rejects) the orchestrator **revokes** via `restore(prev)` + reschedule. A successful send keeps the advance. The hook lives in `_sendToIris` and the revoke on its catch path; it never blocks or alters the POST itself. (`abandonInitialMs≈60s`, `abandonFreeTextMs≈30s`, `abandonCeilingMs≈5min`, B7.)

- [ ] **Step 1: Failing tests** (inject the clock + a fake timer) — a free-text reply while an ask is open calls `routeReply`→`reset-abandon-timer`, calls `DeadlineLatch.advance` (never past the ceiling), reschedules the timeout, and still POSTs unchanged; **the ABANDON timeout firing while the ask is open frees the slot + calls `setEpisodeOutcome(ABANDONED)`; a free-text advance defers it; once the ceiling is hit it fires regardless of further chatter**; **a hard send failure restores the pre-submit deadline (grace revoked) and reschedules**; a `solved` button sets `_owedConfirmClose{stale_solved}` (drained by C3 when the wire is free); if a `confirmClose` is in flight the queued one drains only on its `resolved=false` (and is cleared if it `resolved=true`, since slot-free clears owed) — so the solved path always yields a close or a gentle offer, never two closes; either way it cancels the in-flight staleCheck and closes the ask UI; a `still-on-it` button cancels the staleCheck, closes the ask, and calls `watchdog.resetProgress`; a `something-else` button frees the slot silently + `setEpisodeOutcome(ABANDONED)`; a button with a stale `askId` is a no-op.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the hook + the command handler. **Step 4: Run** → PASS; `npm run check-types`.
- [ ] **Step 5: Commit** — `git commit -m "feat(struggle): reply-routing hook + stale-ask button commands"`

### Task C6: Webview — episode folding by `proactiveEpisodeId` + stale-ask UI + closing/fold

**Files:** (the `proactiveEpisodeId` field + widened `proactiveOutcome` enum on the store `ChatMessage`/`IrisChatMessage`/contracts and the live+reload plumbing are added in **C4** — this task CONSUMES them for grouping/folding and adds only the stale-ask UI marker.)
- Modify: `extension/src/webview/views/IrisChat/types.ts` (add only the `staleAsk?` marker; `proactiveEpisodeId?` + the widened `proactiveOutcome` are already present from C4)
- Modify: `extension/src/webview/views/IrisChat/components/groupProactiveMessages.ts` (group by `proactiveEpisodeId`, NOT by consecutive run)
- Create: `extension/src/webview/views/IrisChat/components/StaleAskButtons.tsx` (the three quick-reply buttons; disable after click; carry `askId`)
- Modify: `extension/src/webview/views/IrisChat/components/MessageBubble.tsx` + `ChatMessageList.tsx` (render the stale-ask buttons on the persisted message row identified by the `addStaleAsk.messageId`, ONLY while a live `askId` is bound to it; closing message; fold-to-one-liner; fold-all on reload — note C8 separately widens these two files' `onDismiss` signature; the changes are disjoint and C6 lands first. **This task ALSO does the button GATING (below)** so that the moment stale-ask rows exist they are correctly scoped — the dismiss BEHAVIOR rewire stays in C8.)
- Test: `test/react/views/IrisChat/` (grouping, buttons, fold, button scoping)

> **Button scoping lands HERE in C6 (slice-safety fix — stale-ask rows must be correctly scoped the moment they exist, not one task later).** This task introduces stale-ask / closing / folded proactive rows, so it must ALSO gate the existing generic affordances in the SAME slice (otherwise, until C8, the old proactive `Dismiss`/`Retry` could render on a stale-ask row and drive a wrong message-scoped write — spec §7.2/§7.3/§16). The per-row rule: **delivered hint card → a single `Dismiss`** (the C8 rewire makes it episode-scoped; C6 only controls WHERE it renders); **stale-ask row → ONLY its three quick-reply buttons** (no `Dismiss`/`Retry`); **closing / folded rows → no buttons**. **`Retry` is REMOVED from ALL proactive-origin rows** — the slot model (§5/§7) has no "retry the hint" affordance (more help = ask in normal chat, §5 no-deepen), so `Retry` has no defined meaning on a proactive row; it stays only on `!isProactive` messages. Concretely in `MessageBubble.tsx`: gate the generic `Dismiss` to render ONLY on a live delivered hint card (proactive row that is NOT stale-ask / closing / folded); gate `Retry` to `!isProactive`.

**Interfaces:**
- Consumes: A9's `proactiveEpisodeId` on `IrisMessageResponseDTO`; C5's `addStaleAsk` payload.
- Produces: `groupByEpisode(messages): ChatRenderItem[]` keyed on `proactiveEpisodeId`; `StaleAskButtons` component.

§9/§12/§16: one episode = one foldable group of its proactive-origin messages grouped by `proactiveEpisodeId` (replies/answers stay inline). On reload, fold ALL proactive episodes (runtime slot is gone). The stale-ask is a **persisted proactive row** (A10); its live buttons render only while the runtime `addStaleAsk` binding (`messageId` → live `askId`) is present — a reloaded stale-ask row has no live `askId`, so it renders as **plain text, no active buttons**. Progress close → closing message then fold to "✓ <episodeLabel>" after the ~5s timer; dismiss/stale-free fold without a praise close (client-derived label).

- [ ] **Step 1: Failing tests** — `groupByEpisode` folds two messages sharing an `episodeId` into one group even if a normal chat turn sits between them (the old consecutive-run grouping cannot); given an `addStaleAsk { messageId, askId }`, `StaleAskButtons` render on the row with id === `messageId` and disable all three after one click, emitting the `askId`; the same stale-ask row WITHOUT a live `askId` binding (reload) renders as plain text. **Button scoping: `Dismiss` renders on a live delivered hint card but NOT on a stale-ask / closing / folded row; `Retry` does NOT render on ANY proactive-origin row (only on `!isProactive` messages).**
- [ ] **Step 2: Run** `npx vitest run test/react/views/IrisChat` → FAIL.
- [ ] **Step 3: Implement** the grouping change, the buttons component, the render wiring, and the DTO/mapping additions.
- [ ] **Step 4: Run** → PASS; `npm run check-types`.
- [ ] **Step 5: Commit** — `git commit -m "feat(struggle): episode folding by episodeId + stale-ask quick-reply buttons"`

### Task C7: Closing UX + proactive labeling polish

**Files:**
- Modify: `extension/src/webview/stores/useChatStore.ts` (handle the `foldEpisode { episodeId, praise? }` host→webview message: keep a **runtime-only** `Map<episodeId, FoldState>` where `FoldState = { folded: boolean; episodeLabel?: string; closeMessageId?: number }`; NOT persisted, gone on reload. **Order-safe progress close:** on `foldEpisode` WITH `praise`, record `{episodeLabel, closeMessageId}` but **start the ~5s fold timer only once the row with `id === closeMessageId` is present in the store** (if the praise row already arrived via chat-ws → start now; if it arrives later → start on its insert). This binds the timer to the actual close row, so the episode never folds before the praise renders, and the timer is never missed. On `foldEpisode` WITHOUT `praise` → **fold immediately** (neutral, client-derived label).)
- Modify: `extension/src/webview/views/IrisChat/IrisChatView.tsx` (route the `foldEpisode` message into the store)
- Modify: `MessageBubble.tsx` / `ChatMessageList.tsx` (the ~5s closing-message → fold transition driven by the store `FoldState`; the "Iris reached out, you didn't ask" label; praise vs neutral fold-line; the fold-line reads the live `episodeLabel` from the store, else the client-derived gist)
- Test: `test/react/views/IrisChat/`

**Interfaces:**
- Consumes: C6 grouping; the `foldEpisode { episodeId, praise? }` host→webview message (C4/C3/C5/C8) — the fold instruction for every DELIVERED terminal and the **only** source of the live `episodeLabel` (never persisted, §12).

§8: praise lives in the (expandable) closing message, the problem name in the fold-line. Progress close uses Iris's `closingSentence` (from the persisted closing row, chat-ws) + `episodeLabel` (from the `foldEpisode.praise` message — runtime-only); dismiss/stale-free fold without praise, label client-derived (first hint's gist or "Proactive hint"). On reload, the live `episodeLabel` is gone, so even a recovered episode folds with the client-derived gist. Never-delivered ambient: no `foldEpisode`, nothing to close (no artifact).

- [ ] **Step 1: Failing test** — **order A** (praise row already present): `foldEpisode{episodeId, praise:{episodeLabel, closeMessageId}}` → the ~5s timer starts, renders `closingSentence`, then folds to `✓ <episodeLabel>`; **order B** (control first, row later): the timer does NOT start until the row `id===closeMessageId` is inserted, then folds — **never folds before the praise row renders**; a `foldEpisode{episodeId}` (no praise) folds IMMEDIATELY with a client-derived label (the dismiss/stale-free path); the SAME progress episode on reload (no `foldEpisode`) folds with the client-derived gist (no live label).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (inject the timer so the test is deterministic). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(struggle): closing UX (praise message + problem-name fold-line)"`

### Task C8: Dismiss → slot-free + episode-based outcome write (§7.2)

**Files (the dismiss button currently sends `{ sessionId, messageId, outcome:'DISMISSED' }` and writes message-scoped; this task makes it source the `proactiveEpisodeId` off the dismissed message — the field is already on the store `ChatMessage` from C4 — and write episode-scoped):**
- Modify: `extension/src/webview/views/IrisChat/IrisChatView.tsx:283` (`handleDismissProactive` sources `proactiveEpisodeId` from the dismissed message and adds it to the `postCommand('messageProactiveOutcome', …)` payload; wiring at `:607`)
- Modify: `extension/src/webview/views/IrisChat/components/MessageBubble.tsx:146-153` (the Dismiss button passes the message's `proactiveEpisodeId` through `onDismiss`; prop type at `:27`) and `extension/src/webview/views/IrisChat/components/ChatMessageList.tsx:73,100` (forward the widened `onDismiss` signature)
- Modify: `extension/src/shared/messageContracts/webviewCommands.ts:198` (the `messageProactiveOutcome` payload gains `proactiveEpisodeId?: string`; the enum `:93` + allow-list `:297` already cover the command)
- Modify: `extension/src/extension/provider/chatWebviewProvider.ts:609-611,933-945` (`_handleProactiveOutcome` accepts `proactiveEpisodeId` and routes the dismiss to the orchestrator's episode-scoped path instead of the message-scoped `setProactiveOutcome` PUT; it still fires `_onDidDismissProactive` for the delivery backoff)
- Modify: `extension/src/extension/services/intervention/activeNotification.ts` (the **active-toast Dismiss** action — today it hits the old message-scoped path; rewire it to the SAME episode-scoped dismiss as the card: free the slot + `setEpisodeOutcome(sessionId, episodeId, 'DISMISSED')` + `clearEpisodeRuntime()`. The toast knows its episode from the `active` decision that raised it. Without this, the toast Dismiss would leave a wrong message-scoped write while the card writes episode-scoped — a split contract.)
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` (dismiss frees the slot via `SlotManager.free()`, calls `setEpisodeOutcome(sessionId, episodeId, 'DISMISSED')` (C2 API, episode-scoped), runs `clearEpisodeRuntime()` (C3) — which resets the latch, disarms the watchdog, clears any owed close, and clears the live stale-ask binding; clearing that binding is what makes any pending ABANDON timer a no-op when it fires (its "ask still open" guard is now false, C3) — AND posts `foldEpisode { episodeId }` (no praise) so the episode collapses (C3/C7))
- Test: `test/logic/struggleIntervention/...` + `test/unit` for the provider command + the toast dismiss + `test/react/views/IrisChat/` for the button payload

> **Button scoping is established in C6** (the slice that introduces stale-ask / closing / folded rows gates `Dismiss` to the live delivered hint card and removes `Retry` from proactive rows, so it is safe the moment those rows exist). This task (C8) does NOT re-gate; it only rewires the **behavior** of the (already-correctly-placed) card + toast `Dismiss` to the episode-scoped path.

**Interfaces:**
- Consumes: `SlotManager.free` (B2); `artemisApiService.setEpisodeOutcome` (defined in C2); the A10 episode-scoped outcome endpoint.
- Produces: a Dismiss on the delivered hint card (or the `active` toast) frees the slot (`DISMISSED`) for the **whole episode** and writes the canonical outcome by `episodeId`; the `RECOVERED`/`ABANDONED` writes (from confirmClose / stale-free) go through the same `setEpisodeOutcome` path. This task only rewires the existing Dismiss button to it (the API itself was added in C2).

§7.2/§12: dismiss resolves the whole episode (slot → FREE → `DISMISSED`, then folds, C6/C7). The legacy message-scoped `DISMISSED` write is replaced by the episode-scoped write so the canonical row (earliest proactive message) is targeted; the existing webview Dismiss button is rewired to it. A PARKED ambient has no dismiss (nothing shown) — only the delivered card/toast carries it.

- [ ] **Step 1: Failing tests** — **the webview Dismiss sources `proactiveEpisodeId` off the dismissed message and `postCommand('messageProactiveOutcome', …)` includes it** (`test/react`); **`_handleProactiveOutcome` with a `proactiveEpisodeId` routes to the episode-scoped path, NOT the message-scoped `setProactiveOutcome` PUT** (`test/unit`); clicking Dismiss frees the slot (generation bumps), calls `setEpisodeOutcome(sessionId, episodeId, 'DISMISSED')`, and runs `clearEpisodeRuntime()` (latch reset, watchdog disarmed, owed-close cleared, live-ask binding cleared); **a Dismiss while a stale-ask is open: the still-scheduled host ABANDON timer fires afterward and is a NO-OP because its "ask still open" guard is false (the binding was cleared) — no `ABANDONED` write lands over the `DISMISSED`** (and even if one did, episode-wide first-terminal-wins A10 would reject it); a stale-free path calls `setEpisodeOutcome('ABANDONED')`; a progress close server-side already wrote `RECOVERED` (no duplicate client write, idempotent if it does); **the active-toast Dismiss routes to the SAME episode-scoped path (not the old message-scoped write)**; **a dismiss posts `foldEpisode{episodeId}` (no praise)** (button scoping itself is tested in C6).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the rewire (free the slot + episode-scoped outcome via the C2 API). **Step 4: Run** → PASS; `npm run check-types`.
- [ ] **Step 5: Commit** — `git commit -m "feat(struggle): dismiss frees the slot + episode-scoped outcome write"`

---

## Self-Review (filled in by the planner)

**Spec coverage map** (spec § → task):
- §4 slot rules / PARKED lifecycle → B2, B5, C2, C3
- §5 surfaces (pull/push, three lifetimes) → C1, C2, C7
- §6 reconciliation + async/generation guard + single-flight (+ hardEvent source) → B3, B5, C3, C4
- §7.1 progress/confirmClose (edge-trigger, free immediately; **two-stage Iris confirmation mandatory for PARKED too** — the silent `parked_progress` round-trip) → A3, A11 (handler + the three-reason split), **B8** (the progress-edge latch), C3 (wiring + reason-by-slot-state), C4 (PARKED silent-free routing)
- §7.2 dismiss → **C8** (slot-free + episode-scoped outcome write); server-side canonical write A10 (primitive) + A11 (handler)
- §7.3 stale-ask + watchdog + counters + staleCheck dedup → A4, B3, B4, C4, C5
- §8 closing UX → A3, A11, C6, C7
- §9 chat presentation (group by episodeId) → C6
- §10 sessions/episodes (new episode on restart; fold-all on reload) → B1, C6
- §11 what Iris receives (episode block; isNew boundary; tools; stateless slot) → A1, A3, A4, A6, B1 (isNew flip), C3
- §12 storage/DB (two nullable varchar columns `proactive_episode_id` + `proactive_client_message_id` + two enum values; episode-wide outcome; reveal upsert idempotency; ambient not stored; null-outcome reporting) → A8, A9, A10, A11
- §13 out of scope (no preemption; bounded delay) → enforced by B4 (windowMax) + B5 (no preempt path)
- §16 chat-pipeline integration (free-text uncoupled; buttons resolve) → C5, C6
- §17 DTOs → A1, A2, A6, A7 (casing corrected per Global Constraints; episodeId is a String everywhere)

**Known deviations from the spec (flag to Liam + codex):**
1. **Request casing is camelCase, not snake_case** (§17): verified the live request DTOs are camelCase on both hops; forcing snake on new request fields would create a mixed-casing payload. Response stays snake. (Global Constraints.)
2. **Two request DTOs**, not one (§17 conflated extension→Artemis and Artemis→Pyris): `intent`+`episode` are added to both (A6).
3. **Ambient currently auto-persists + shows inline text**: changed to event-only + gutter-only pull (A9, C1, C2) to match §5.
4. **`confirmReason` — now RATIFIED in spec §17** (was a plan-level addition; the spec's §17 DTO section now defines the extension→Artemis `confirm_reason ∈ {progress, stale_solved, parked_progress}` discriminator). On the extension→Artemis request only (NOT forwarded to Pyris — Artemis stamps it on the job and acts on it, keeping Pyris stateless). It is the **minimal** discriminator the stateless server needs to honour three distinct spec behaviours a bare `resolved` boolean cannot express: §7.1 quiet-on-false (`progress`), §7.3 offer-on-false (`stale_solved`), and §4/§8 silent-on-both for the never-delivered PARKED close (`parked_progress`). For `parked_progress`, Pyris still runs its normal confirmClose (re-reads code, returns `resolved` + closing prose); Artemis **discards** the prose and persists nothing — a small wasted generation accepted to avoid giving Pyris slot knowledge. (No longer a deviation; listed here for traceability.)

**Open implementation choices deferred to execution (not spec gaps):** exact `staleAfterMs` value (provisional in B7), the precise REST path for reveal/outcome (A10), whether the stale watchdog `tick` cadence reuses the engine's 10s grid or a dedicated timer (C3).

---

## Execution Handoff

Two execution options once the plan is approved:
1. **Subagent-Driven (recommended)** — a fresh subagent per task with two-stage review between tasks.
2. **Inline Execution** — batch execution in-session with checkpoints.

Per-repo verification gates: Pyris `pytest`; Artemis the targeted JUnit class + `liquibaseValidate`; extension `npm run check-types` + the task's runner (`test/logic`+`test/react` via vitest, `test/unit` via mocha). Phase A is independently **mergeable + testable** (it compiles and its unit tests pass on their own); Phase B is pure-logic and testable without the host; Phase C integrates and is where the end-to-end behaviour appears.

> **Rollout is LOCKSTEP — a HARD, STATED deployment precondition (High/Medium fix). Phase A is mergeable but NOT independently SHIPPABLE.** A9 changes `ambient` to **event-only** (the server stops persisting/inline-showing the hint until a client reveal), and the reveal consumer lives in **C2** (extension). So if Artemis ships A9 to production **before** the extension ships Phase C, an **old** extension (which still expects ambient to persist + render inline) would get hidden, non-persisted ambient content with **no reveal path** — a broken §5 click-to-reveal. **This is a HARD PRECONDITION for this thesis, not a soft recommendation:** the entire feature (Pyris + Artemis + extension) is deployed **lockstep** — the Artemis A-phase changes are NOT deployed to any production Artemis serving older extensions. (This thesis controls all three deployments, so lockstep is enforceable as a deploy-order rule.) **If independent server rollout is ever required** (it is out of scope here), the enforceable alternative is a capability gate: the extension advertises a `struggleSlotV2` capability on the request, and Artemis keeps the **legacy ambient-persist + inline path** for clients that do not advertise it — that gate would then be its own task. As scoped, lockstep is the stated precondition; there is no partial-deploy path. (Mergeable into the integration branch ≠ safe to deploy alone — different claims.)
