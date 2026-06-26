# Proactive Intervention — Slice 3: Inline surface (anchor + inlineHint end-to-end) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Iris attach a code location (`anchorFile`/`anchorLine`) and a short Socratic `inlineHint` to a proactive nudge, carry both Pyris→Artemis→client, and render an **inline in-editor cue** (gutter Iris logo + after-line hint + whole-line hover) when the anchored line is visible; otherwise fall back to the lamp.

**Scope of THIS slice.** The `anchor`/`inlineHint` data path (Pyris emit + parse, Artemis DTO + event, client parse), the client **surface-selection** (ambient + live anchor → inline, else lamp), and a new **inline decoration service**. The hover's action links and the lamp's reject are still later (Slice 4); this slice's hover shows the fuller `message` text only.

**Architecture:** The gate's JSON gains an optional `anchor: {file, line}` + `inlineHint`. Pyris `parse_gate_result` extracts them into `GateResult`; the status callback forwards them. Artemis carries them as **flat** fields (`anchorFile`, `anchorLine`, `inlineHint`) on the status-update DTO and the struggle event (house style is flat). The client parses them; for an `ambient` event with a live anchor (the file is open and the line is in a visible range) the orchestrator renders **inline** instead of the lamp. Pure helpers (cue text, hover markdown, "is the anchor live?") are unit-tested; the actual `setDecorations` call is integration/e2e (validated already by the throwaway prototype, spec §4.1).

**Tech Stack:** Pyris (Python, pytest). Artemis (Java/Spring, Mockito). Extension (TypeScript, Vitest `test/logic`; VS Code decoration API).

This is **Slice 3 of the proactive-intervention spec** (`docs/superpowers/specs/2026-06-26-proactive-intervention-surfaces-design.md`, §4, §4.1, §8). Depends on Slice 1 (event has `messageId`) and Slice 2 (bubble restyle).

## Global Constraints

- **Branch:** `feat/struggle-v3-integration`. Not `dev`/`main`.
- **Commit messages:** Conventional Commits. **No AI attribution** (no `Co-Authored-By`, no `🤖`, no "Generated with"). Overrides any default trailer. Commit each repo from its own root (Pyris `/Users/liamberger/Documents/private/edutelligence`, Artemis `/Users/liamberger/Documents/private/Artemis`, extension `/Users/liamberger/Documents/private/MA/artemis-extension`).
- **Staging:** only the exact files each task changed. Never `git add -A`/`.`.
- **Verification:** Pyris `pytest <file>`; Artemis test class green + `./gradlew spotlessApply`; extension targeted Vitest green + `npm run check-types`.
- **Flat anchor fields** on all DTOs/events (`anchorFile`/`anchorLine`/`inlineHint`) to match the existing flat house style; only the gate's model-emitted JSON uses the nested `anchor: {file, line}` shape.
- **Invariants:** Desktop = Cookie auth, Theia = Bearer (untouched). No `^`/`~` added to any `package.json`. CSS-module lookups stay static camelCase.

## Deferred to later slices

- Hover **action links** (`Open chat` / `Dismiss`) and the lamp reject — Slice 4 (reject/backoff). This slice's hover shows the fuller `message` only.
- `active` **inline pointer** (breadcrumb at the line while the bubble is the primary surface) — kept minimal here; `active` still surfaces as the chat bubble (Slice 2) + badge/toast. Inline is wired for `ambient` in this slice.

---

## File structure

- **Pyris** (`/Users/liamberger/Documents/private/edutelligence`)
  - Modify: `iris/src/iris/pipeline/struggle_intervention_pipeline.py` — `GateResult` + `parse_gate_result` gain `anchor`/`inline_hint`; `post_agent_hook` forwards them to the callback.
  - Modify: `iris/src/iris/domain/status/struggle_intervention_status_update_dto.py` — add `anchor_file`/`anchor_line`/`inline_hint`.
  - Modify: `iris/src/iris/pipeline/prompts/templates/struggle_intervention_system_prompt.j2` — document the optional `anchor`/`inlineHint` JSON fields.
  - Modify (test): `iris/tests/test_struggle_intervention_pipeline.py`.
- **Artemis** (`/Users/liamberger/Documents/private/Artemis`)
  - Modify: `src/main/java/de/tum/cit/aet/artemis/iris/service/pyris/dto/struggle/PyrisStruggleInterventionStatusUpdateDTO.java` — add `anchorFile`/`anchorLine`/`inlineHint`.
  - Modify: `src/main/java/de/tum/cit/aet/artemis/iris/dto/StruggleInterventionEventDTO.java` — add the three fields.
  - Modify: `src/main/java/de/tum/cit/aet/artemis/iris/service/session/IrisStruggleInterventionService.java` — forward them in both `active` and `ambient` events.
  - Modify (test): `src/test/java/de/tum/cit/aet/artemis/iris/struggle/IrisStruggleInterventionDecisionTest.java`.
- **Extension** (`/Users/liamberger/Documents/private/MA/artemis-extension`)
  - Modify: `extension/src/extension/services/struggleIntervention/struggleContract.ts` — add `anchorFile?`/`anchorLine?`/`inlineHint?`.
  - Modify: `extension/src/extension/services/struggleIntervention/struggleEventSubscription.ts` — parse them.
  - Create: `extension/src/extension/services/intervention/inlineHint.ts` — pure helpers (cue text, hover markdown, anchor-live check).
  - Create: `extension/src/extension/services/intervention/inlineHintDecoration.ts` — the VS Code decoration service.
  - Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` + `extension/src/extension/telemetry/index.ts` — surface selection (ambient + live anchor → inline).
  - Test: `extension/test/logic/struggleIntervention/struggleEventSubscription.test.ts`, `extension/test/logic/intervention/inlineHint.test.ts`.

---

### Task 1: Pyris — gate emits + parses `anchor` + `inlineHint`

**Files:**
- Modify: `iris/src/iris/pipeline/struggle_intervention_pipeline.py`
- Modify: `iris/src/iris/domain/status/struggle_intervention_status_update_dto.py`
- Modify: `iris/src/iris/pipeline/prompts/templates/struggle_intervention_system_prompt.j2`
- Test: `iris/tests/test_struggle_intervention_pipeline.py`

**Interfaces:**
- Produces: `GateResult` gains `anchor: Optional[dict]` (`{"file": str, "line": int}`) and `inline_hint: Optional[str]`. `parse_gate_result` reads the model's optional `anchor`/`inlineHint`; both default `None` and any malformed shape → `None` (fail safe). The status DTO gains `anchor_file: Optional[str]`, `anchor_line: Optional[int]`, `inline_hint: Optional[str]`.

- [ ] **Step 1: Write failing parse tests**

Add to `test_struggle_intervention_pipeline.py` (mirrors the existing `parse_gate_result` test style):
```python
def test_parse_gate_result_extracts_anchor_and_inline_hint():
    raw = ('{"action":"ambient","message":"Look at the loop bound.","confidence":0.7,'
           '"anchor":{"file":"Sort.java","line":42},"inlineHint":"off-by-one at the last index?"}')
    g = parse_gate_result(raw)
    assert g.anchor == {"file": "Sort.java", "line": 42}
    assert g.inline_hint == "off-by-one at the last index?"


def test_parse_gate_result_anchor_absent_is_none():
    g = parse_gate_result('{"action":"ambient","message":"x","confidence":0.6}')
    assert g.anchor is None
    assert g.inline_hint is None


def test_parse_gate_result_malformed_anchor_is_none():
    g = parse_gate_result('{"action":"ambient","message":"x","confidence":0.6,"anchor":{"file":"a.java"},"inlineHint":7}')
    assert g.anchor is None       # missing line -> dropped
    assert g.inline_hint is None  # non-string -> dropped
```

- [ ] **Step 2: Run to verify failure**

Run (cwd `/Users/liamberger/Documents/private/edutelligence`):
```bash
python -m pytest iris/tests/test_struggle_intervention_pipeline.py -q 2>&1 | tail -20
```
Expected: FAIL — `GateResult` has no `anchor`/`inline_hint`.

- [ ] **Step 3: Extend `GateResult` + `parse_gate_result`**

In `struggle_intervention_pipeline.py`, add fields to the dataclass and parse them at the end of `parse_gate_result` (before the `return`):
```python
@dataclass
class GateResult:
    action: StruggleAction
    message: Optional[str]
    confidence: float
    rationale: Optional[str]
    anchor: Optional[dict] = None
    inline_hint: Optional[str] = None
```
In `parse_gate_result`, after `rationale` is computed, add:
```python
    anchor = None
    raw_anchor = obj.get("anchor")
    if isinstance(raw_anchor, dict) and isinstance(raw_anchor.get("file"), str) and isinstance(raw_anchor.get("line"), int):
        anchor = {"file": raw_anchor["file"], "line": raw_anchor["line"]}
    inline_hint = obj.get("inlineHint")
    if not isinstance(inline_hint, str) or not inline_hint.strip():
        inline_hint = None
    return GateResult(action, message, confidence, rationale, anchor, inline_hint)
```
(Replace the existing final `return GateResult(action, message, confidence, rationale)`.)

- [ ] **Step 4: Carry them on the status DTO + callback**

In `struggle_intervention_status_update_dto.py`, add:
```python
    anchor_file: Optional[str] = Field(default=None)
    anchor_line: Optional[int] = Field(default=None)
    inline_hint: Optional[str] = Field(default=None)
```
In `post_agent_hook` (struggle pipeline), after setting `status.action`/`status.rationale`, add:
```python
        status.anchor_file = gate.anchor["file"] if gate.anchor else None
        status.anchor_line = gate.anchor["line"] if gate.anchor else None
        status.inline_hint = gate.inline_hint
```

- [ ] **Step 5: Document the fields in the prompt**

In `struggle_intervention_system_prompt.j2`, extend the JSON contract block to include the optional fields and a one-line rule:
```
{"action": "silent" | "ambient" | "active",
 "message": "<one short hint, or null for silent>",
 "confidence": <0.0-1.0>,
 "anchor": {"file": "<repo-relative path>", "line": <1-based line>} | null,
 "inlineHint": "<<=60-char non-spoiler cue for that line, or null>",
 "rationale": "<one sentence, why; for logging>"}
```
Add: "Set `anchor`+`inlineHint` only when a single concrete line is the locus (e.g. a build/compile failure); `inlineHint` is a terse cue, NOT a truncation of `message`, and must not spoil. Omit (null) for diffuse struggle."

- [ ] **Step 6: Run tests green + commit**

```bash
python -m pytest iris/tests/test_struggle_intervention_pipeline.py iris/tests/test_struggle_status_update_dto.py -q 2>&1 | tail -20
git add iris/src/iris/pipeline/struggle_intervention_pipeline.py iris/src/iris/domain/status/struggle_intervention_status_update_dto.py iris/src/iris/pipeline/prompts/templates/struggle_intervention_system_prompt.j2 iris/tests/test_struggle_intervention_pipeline.py
git commit -m "feat(struggle): gate emits optional anchor + inlineHint for the inline surface"
```

---

### Task 2: Artemis — carry `anchorFile`/`anchorLine`/`inlineHint` to the struggle event

**Files:**
- Modify: `src/main/java/de/tum/cit/aet/artemis/iris/service/pyris/dto/struggle/PyrisStruggleInterventionStatusUpdateDTO.java`
- Modify: `src/main/java/de/tum/cit/aet/artemis/iris/dto/StruggleInterventionEventDTO.java`
- Modify: `src/main/java/de/tum/cit/aet/artemis/iris/service/session/IrisStruggleInterventionService.java`
- Test: `src/test/java/de/tum/cit/aet/artemis/iris/struggle/IrisStruggleInterventionDecisionTest.java`

**Interfaces:**
- Consumes: the Slice 1 event DTO + `persistProactiveMessage` helper.
- Produces: `StruggleInterventionEventDTO(exerciseId, action, message, sessionId, messageId, anchorFile, anchorLine, inlineHint, confidence)` and `PyrisStruggleInterventionStatusUpdateDTO(... , @Nullable String anchorFile, @Nullable Integer anchorLine, @Nullable String inlineHint)`.

- [ ] **Step 1: Failing test — ambient event carries the anchor fields**

Extend the Slice-1 ambient test (`ambient_aboveThreshold_persistsAndEmitsSessionAndMessageId`) to pass an anchor in the status update and assert the event forwards it. Change its `update` to:
```java
var update = new PyrisStruggleInterventionStatusUpdateDTO("Re-check the logic.", "ambient", 0.7, null, List.of(), List.of(), "Sort.java", 42, "off-by-one?");
```
and extend the event matcher with:
```java
&& "Sort.java".equals(e.anchorFile()) && Objects.equals(e.anchorLine(), 42) && "off-by-one?".equals(e.inlineHint())
```
NOTE: both records change arity, and **the whole `test` source set must compile before `--tests …DecisionTest` can run**, so update every existing call site in the same task (otherwise the build fails before the targeted test):
- `PyrisStruggleInterventionStatusUpdateDTO(...)` constructors: `IrisStruggleInterventionRoundTripTest.java`, `PyrisStatusUpdateStruggleTest.java`, `PyrisStruggleInterventionStatusUpdateDTOTest.java`, and any others in `src/test/.../iris/struggle/` — append `, null, null, null` (or real values where the test asserts them).
- `StruggleInterventionEventDTO(...)` constructors: `IrisChatWebsocketServiceStruggleTest.java`, `StruggleInterventionEventDTOTest.java` — insert `, null, null, null` before the trailing `confidence` arg.
Also add a round-trip assertion that the snake_case wire shape deserializes: in `PyrisStruggleInterventionStatusUpdateDTOTest` (or the wire-contract test), assert a JSON body with `"anchor_file"`/`"anchor_line"`/`"inline_hint"` maps onto the camelCase accessors (guards the `@JsonProperty` mapping from Step 3).

- [ ] **Step 2: Run to verify failure (compile)**

Run (cwd `/Users/liamberger/Documents/private/Artemis`):
```bash
./gradlew test --tests "de.tum.cit.aet.artemis.iris.struggle.IrisStruggleInterventionDecisionTest" 2>&1 | tee /tmp/slice3_t2.txt | tail -25
```
Expected: FAIL — `anchorFile()` etc. not on the records / constructor arity mismatch.

- [ ] **Step 3: Add the fields to both DTOs**

In `PyrisStruggleInterventionStatusUpdateDTO.java`, append three nullable fields. **Pyris emits snake_case** (`status.model_dump(by_alias=True)` over snake-named fields `anchor_file`/`anchor_line`/`inline_hint`), so each new field needs an explicit `@JsonProperty` snake_case mapping — exactly the pattern Artemis already uses elsewhere (`PyrisLectureIngestionStatusUpdateDTO` → `@JsonProperty("error_code")`). Without it Jackson silently drops them to `null` and the inline surface never activates. Add `import com.fasterxml.jackson.annotation.JsonProperty;` and keep the compact-constructor defaulting:
```java
public record PyrisStruggleInterventionStatusUpdateDTO(@Nullable String result, @Nullable String action, @Nullable Double confidence, @Nullable String rationale,
        @NonNull List<PyrisStageDTO> stages, @NonNull List<LLMRequest> tokens,
        @JsonProperty("anchor_file") @Nullable String anchorFile, @JsonProperty("anchor_line") @Nullable Integer anchorLine,
        @JsonProperty("inline_hint") @Nullable String inlineHint) {
    public PyrisStruggleInterventionStatusUpdateDTO {
        stages = stages != null ? stages : List.of();
        tokens = tokens != null ? tokens : List.of();
    }
}
```
(The existing fields `result`/`action`/`confidence`/`rationale` are single words, so they need no `@JsonProperty`; only the two-word names do.)
In `StruggleInterventionEventDTO.java`, insert the three fields before `confidence`:
```java
public record StruggleInterventionEventDTO(long exerciseId, String action, @Nullable String message, @Nullable Long sessionId, @Nullable Long messageId,
        @Nullable String anchorFile, @Nullable Integer anchorLine, @Nullable String inlineHint, @Nullable Double confidence) {
}
```

- [ ] **Step 4: Forward them in `handleDecision`**

In both the `active` and `ambient` cases, pass the status-update anchor fields into the event:
```java
// active:
new StruggleInterventionEventDTO(job.exerciseId(), "active", null, p.session().getId(), p.saved().getId(),
    statusUpdate.anchorFile(), statusUpdate.anchorLine(), statusUpdate.inlineHint(), confidence)
// ambient:
new StruggleInterventionEventDTO(job.exerciseId(), "ambient", statusUpdate.result(), p.session().getId(), p.saved().getId(),
    statusUpdate.anchorFile(), statusUpdate.anchorLine(), statusUpdate.inlineHint(), confidence)
```

- [ ] **Step 5: Run green + format + commit**

```bash
./gradlew test --tests "de.tum.cit.aet.artemis.iris.struggle.IrisStruggleInterventionDecisionTest" 2>&1 | tee /tmp/slice3_t2.txt | tail -20
./gradlew spotlessApply 2>&1 | tail -3
git add src/main/java/de/tum/cit/aet/artemis/iris/service/pyris/dto/struggle/PyrisStruggleInterventionStatusUpdateDTO.java \
        src/main/java/de/tum/cit/aet/artemis/iris/dto/StruggleInterventionEventDTO.java \
        src/main/java/de/tum/cit/aet/artemis/iris/service/session/IrisStruggleInterventionService.java \
        src/test/java/de/tum/cit/aet/artemis/iris/struggle/IrisStruggleInterventionDecisionTest.java \
        src/test/java/de/tum/cit/aet/artemis/iris/struggle/IrisStruggleInterventionRoundTripTest.java \
        src/test/java/de/tum/cit/aet/artemis/iris/struggle/PyrisStatusUpdateStruggleTest.java \
        src/test/java/de/tum/cit/aet/artemis/iris/struggle/PyrisStruggleInterventionStatusUpdateDTOTest.java \
        src/test/java/de/tum/cit/aet/artemis/iris/struggle/IrisChatWebsocketServiceStruggleTest.java \
        src/test/java/de/tum/cit/aet/artemis/iris/struggle/StruggleInterventionEventDTOTest.java
git commit -m "feat(iris): carry anchor + inlineHint on the struggle event"
```

---

### Task 3: Client — parse anchor/inlineHint + pure inline helpers

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/struggleContract.ts`
- Modify: `extension/src/extension/services/struggleIntervention/struggleEventSubscription.ts`
- Create: `extension/src/extension/services/intervention/inlineHint.ts`
- Test: `extension/test/logic/struggleIntervention/struggleEventSubscription.test.ts`, `extension/test/logic/intervention/inlineHint.test.ts`

**Interfaces:**
- Produces: `StruggleInterventionEvent` gains `anchorFile?: string; anchorLine?: number; inlineHint?: string;`. New pure module `inlineHint.ts`: `buildCueText(inlineHint: string): string` (returns ` 💡 ${inlineHint}`), `isAnchorLive(anchorFile, anchorLine, visibleEditors, exerciseRoot): boolean` (file is a visible editor, matched **repo-relative to the exercise root**, AND the line is within a visible range), `resolveAnchorEditor(...)`, and `buildHoverMarkdown(message: string): vscode.MarkdownString`.

- [ ] **Step 1: Failing tests**

Add to `struggleEventSubscription.test.ts`:
```ts
it('parses anchor + inlineHint', () => {
    const e = classifyStruggleEvent({ exerciseId: 1, action: 'ambient', sessionId: 9, messageId: 5, anchorFile: 'Sort.java', anchorLine: 42, inlineHint: 'off-by-one?' });
    expect(e?.anchorFile).toBe('Sort.java');
    expect(e?.anchorLine).toBe(42);
    expect(e?.inlineHint).toBe('off-by-one?');
});
```
Create `extension/test/logic/intervention/inlineHint.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildCueText } from '@extension/services/intervention/inlineHint';

describe('inlineHint helpers', () => {
    it('prefixes the cue with the bulb', () => {
        expect(buildCueText('off-by-one?')).toContain('off-by-one?');
        expect(buildCueText('off-by-one?')).toContain('💡');
    });
});
```
Also unit-test `isAnchorLive`/`resolveAnchorEditor` (they are the live-decision and are pure over editor + Uri shapes): build fake `TextEditor`s via the `test/logic` vscode mock (it provides `Uri`/`Range`/`Position`) — assert a hit for `src/A.java` against an editor at `<root>/src/A.java` with the line inside a `visibleRanges` entry, a miss when the line is scrolled out, a miss for a different file, and a miss when `exerciseRoot` is undefined. (`buildHoverMarkdown` and the `setDecorations` rendering are covered in the `test/unit` mocha harness via `test/unit/mocks/vscodeMocks.ts`, or e2e in the Extension Development Host if `MarkdownString` is absent from the mock — note which you used.)

- [ ] **Step 2: Run to verify failure**

Run (cwd `extension`):
```bash
npx vitest run test/logic/struggleIntervention/struggleEventSubscription.test.ts test/logic/intervention/inlineHint.test.ts 2>&1 | tail -25
```
Expected: FAIL — fields/module missing.

- [ ] **Step 3: Add the contract fields + parser**

In `struggleContract.ts`, add to `StruggleInterventionEvent`:
```ts
    /** Inline anchor + cue (spec §4/§8). All optional; present only when the gate localized the nudge. */
    anchorFile?: string;
    anchorLine?: number;
    inlineHint?: string;
```
In `struggleEventSubscription.ts`, extend the `f` shape with `anchorFile?/anchorLine?/inlineHint?: unknown`, parse:
```ts
    const anchorFile = typeof f.anchorFile === 'string' ? f.anchorFile : undefined;
    const anchorLine = typeof f.anchorLine === 'number' ? f.anchorLine : undefined;
    const inlineHint = typeof f.inlineHint === 'string' ? f.inlineHint : undefined;
```
and add the three to the returned object.

- [ ] **Step 4: Create the pure helpers**

Create `inlineHint.ts` (portable, repo-relative matching against the exercise root — `endsWith` on `fsPath` is wrong on Windows and ambiguous for duplicate basenames):
```ts
import * as path from 'path';
import * as vscode from 'vscode';

/** The after-line cue text: bulb + the Socratic hint (spec §4.1). */
export function buildCueText(inlineHint: string): string {
    return ` 💡 ${inlineHint}`;
}

/** Repo-relative, forward-slash path of a document relative to the exercise root (portable across OSes). */
function relPath(root: vscode.Uri, uri: vscode.Uri): string {
    return path.relative(root.fsPath, uri.fsPath).split(path.sep).join('/');
}

/** The visible editor whose document is exactly `anchorFile` (repo-relative to the exercise root), or undefined. */
export function resolveAnchorEditor(editors: readonly vscode.TextEditor[], anchorFile: string, exerciseRoot: vscode.Uri): vscode.TextEditor | undefined {
    return editors.find(e => relPath(exerciseRoot, e.document.uri) === anchorFile);
}

/** Live = the anchored file is a visible editor AND the (1-based) line sits in a visible range. */
export function isAnchorLive(anchorFile: string, anchorLine: number, editors: readonly vscode.TextEditor[], exerciseRoot: vscode.Uri | undefined): boolean {
    if (!exerciseRoot) {
        return false;
    }
    const ed = resolveAnchorEditor(editors, anchorFile, exerciseRoot);
    if (!ed) {
        return false;
    }
    const line = anchorLine - 1;
    return ed.visibleRanges.some(r => line >= r.start.line && line <= r.end.line);
}

/** Whole-line hover content: the fuller message (action links are added in Slice 4). */
export function buildHoverMarkdown(message: string): vscode.MarkdownString {
    return new vscode.MarkdownString(message);
}
```

- [ ] **Step 5: Run tests green + type-check + commit**

```bash
npx vitest run test/logic/struggleIntervention/struggleEventSubscription.test.ts test/logic/intervention/inlineHint.test.ts 2>&1 | tail -20
npm run check-types 2>&1 | tail -15
git add extension/src/extension/services/struggleIntervention/struggleContract.ts \
        extension/src/extension/services/struggleIntervention/struggleEventSubscription.ts \
        extension/src/extension/services/intervention/inlineHint.ts \
        extension/test/logic/struggleIntervention/struggleEventSubscription.test.ts \
        extension/test/logic/intervention/inlineHint.test.ts
git commit -m "feat(struggle): parse anchor/inlineHint + inline cue helpers"
```

---

### Task 4: Client — inline decoration service + surface selection (ambient + live anchor → inline)

**Files:**
- Create: `extension/src/extension/services/intervention/inlineHintDecoration.ts`
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts`
- Modify: `extension/src/extension/telemetry/index.ts`

**Interfaces:**
- Consumes: `buildCueText`, `isAnchorLive`, `buildHoverMarkdown` (Task 3); the event's `anchorFile`/`anchorLine`/`inlineHint`; `media/iris-logo-big-left.png`.
- Produces: `InlineHintDecoration` with `show(anchorFile, anchorLine, inlineHint, message): void` and `clear(): void`; the orchestrator's `onServerAmbient` now decides inline vs lamp.

- [ ] **Step 1: Implement the decoration service (rendering e2e-verified; live-decision unit-tested in Task 3)**

Create `inlineHintDecoration.ts`. NOTE: decoration rendering touches `vscode.window` and is verified in the Extension Development Host (spec §4.1 prototype), not unit-tested; the testable decision lives in `isAnchorLive` (Task 3).
```ts
import * as vscode from 'vscode';
import { buildCueText, buildHoverMarkdown, isAnchorLive, resolveAnchorEditor } from './inlineHint';

/** One in-editor inline cue at a time: gutter Iris logo + after-line hint + whole-line hover (spec §4.1). */
export class InlineHintDecoration implements vscode.Disposable {
    private readonly type: vscode.TextEditorDecorationType;
    private readonly disposables: vscode.Disposable[] = [];
    private current?: { file: string; line: number; hint: string; message: string };

    constructor(extensionUri: vscode.Uri, private readonly getExerciseRoot: () => vscode.Uri | undefined) {
        this.type = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            gutterIconPath: vscode.Uri.joinPath(extensionUri, 'media', 'iris-logo-big-left.png'),
            gutterIconSize: 'contain',
        });
        this.disposables.push(
            // The student edited the ANCHORED document -> they are acting; retire the cue entirely.
            vscode.workspace.onDidChangeTextDocument(e => {
                const root = this.getExerciseRoot();
                if (this.current && root && resolveAnchorEditor(vscode.window.visibleTextEditors, this.current.file, root)?.document === e.document) {
                    this.clear();
                }
            }),
            // The set of visible editors changed (tab switch / split).
            vscode.window.onDidChangeVisibleTextEditors(() => this.reapply()),
            // The viewport scrolled (anchor moved in/out of view). NOT covered by onDidChangeVisibleTextEditors.
            vscode.window.onDidChangeTextEditorVisibleRanges(() => this.reapply()),
        );
    }

    show(anchorFile: string, anchorLine: number, inlineHint: string, message: string): void {
        this.current = { file: anchorFile, line: anchorLine, hint: inlineHint, message };
        this.reapply();
    }

    /** Public clear: forget the cue and remove its decorations. */
    clear(): void {
        this.current = undefined;
        this.removeDecorations();
    }

    private removeDecorations(): void {
        for (const ed of vscode.window.visibleTextEditors) {
            ed.setDecorations(this.type, []);
        }
    }

    /** Redraw iff the anchor is live; otherwise remove the rendering but KEEP `current` so a scroll-back redraws. */
    private reapply(): void {
        this.removeDecorations();
        const c = this.current;
        const root = this.getExerciseRoot();
        if (!c || !root || !isAnchorLive(c.file, c.line, vscode.window.visibleTextEditors, root)) {
            return;
        }
        const ed = resolveAnchorEditor(vscode.window.visibleTextEditors, c.file, root);
        if (!ed) {
            return;
        }
        const range = ed.document.lineAt(c.line - 1).range;
        ed.setDecorations(this.type, [{
            range,
            renderOptions: { after: { contentText: buildCueText(c.hint), color: '#007fcf', fontWeight: 'bold' } },
            hoverMessage: buildHoverMarkdown(c.message),
        }]);
    }

    dispose(): void {
        this.clear();
        this.type.dispose();
        while (this.disposables.length) { this.disposables.pop()?.dispose(); }
    }
}
```

- [ ] **Step 2: Wire surface selection in the orchestrator**

Add an `inline` dep to `StruggleInterventionService` (`{ show(...), clear() }`) and change `onServerAmbient` to choose inline when the anchor is live, else the lamp. Replace `onServerAmbient(hint, confidence)` with:
```ts
onServerAmbient(hint: string, anchorFile: string | undefined, anchorLine: number | undefined, inlineHint: string | undefined, confidence?: number): void {
    this._serverAvailable = true;
    this._setInFlight(false);
    if (anchorFile && anchorLine !== undefined && inlineHint && this._deps.isAnchorLive(anchorFile, anchorLine)) {
        this._deps.showInline(anchorFile, anchorLine, inlineHint, hint);
        this._surface({ action: 'ambient', finalAction: 'ambient', surface: 'inline', source: 'server', confidence }, this._pendingSignal);
        return;
    }
    this._deps.showAmbient(hint, true);
    this._surface({ action: 'ambient', finalAction: 'ambient', surface: 'lamp', source: 'server', confidence }, this._pendingSignal);
}
```
(Add `showInline`, `clearInline`, `isAnchorLive` to the orchestrator's deps type. `reset()` must also call `clearInline()` — session-start clearing flows through the coordinator's `resetSession → reset()` path; the orchestrator has no separate `onSessionStart` method.)

- [ ] **Step 3: Construct + inject the service in `telemetry/index.ts`**

Instantiate `const inline = new InlineHintDecoration(deps.context.extensionUri, () => coordinator.activeExerciseRoot)` (push to `deps.context.subscriptions`); wire `showInline: (f, l, h, m) => inline.show(f, l, h, m)`, `clearInline: () => inline.clear()`, and `isAnchorLive: (f, l) => isAnchorLive(f, l, vscode.window.visibleTextEditors, coordinator.activeExerciseRoot)` (import `isAnchorLive` from the new module). `coordinator` is the forward-declared ref the orchestrator deps already close over (e.g. the existing `getExerciseRoot: () => coordinator.activeExerciseRoot`). Update the `onServerAmbient` bridge (line ~111) to forward the new event fields:
```ts
onServerAmbient: (exerciseId, hint, anchorFile, anchorLine, inlineHint, c) => {
    ...
    if (active) { orchestrator.onServerAmbient(hint, anchorFile, anchorLine, inlineHint, c); }
},
```
and update the `StruggleEventHandlers.onServerAmbient` signature + dispatch in `struggleEventSubscription.ts` to pass `e.anchorFile, e.anchorLine, e.inlineHint`.

- [ ] **Step 4: Type-check + targeted tests + commit**

```bash
npm run check-types 2>&1 | tail -15
npx vitest run test/logic/struggleIntervention 2>&1 | tail -20
git add extension/src/extension/services/intervention/inlineHintDecoration.ts \
        extension/src/extension/services/struggleIntervention/struggleInterventionService.ts \
        extension/src/extension/services/struggleIntervention/struggleEventSubscription.ts \
        extension/src/extension/telemetry/index.ts
git commit -m "feat(struggle): inline decoration surface (ambient + live anchor)"
```

NOTE: also update the existing `struggleInterventionService` unit tests for the new `onServerAmbient` signature + deps (add no-op `showInline`/`clearInline`/`isAnchorLive` to the test's deps double); run `npx vitest run test/logic/struggleIntervention/struggleInterventionService.test.ts` and fix fallout in this step before committing.

---

## Self-review checklist

- **Spec coverage:** §8 anchor/inlineHint fields (Tasks 1-3); §4 surface selection ambient+anchor→inline else lamp (Task 4); §4.1 gutter logo + after-line `#007fcf`/💡 + whole-line hover (Task 4). Hover action links + active inline pointer are explicitly deferred.
- **Record-arity TDD:** the event DTO + status DTO arity changes break the whole Java test source set at once; Task 2 updates the DTOs and **every** call site together (`DecisionTest`, `RoundTripTest`, `PyrisStatusUpdateStruggleTest`, `PyrisStruggleInterventionStatusUpdateDTOTest`, `IrisChatWebsocketServiceStruggleTest`, `StruggleInterventionEventDTOTest`) — otherwise the targeted `--tests` run won't compile.
- **Snake_case wire mapping:** Pyris emits `anchor_file`/`anchor_line`/`inline_hint` (`model_dump(by_alias=True)`); the Artemis record uses `@JsonProperty("…")` (the `PyrisLectureIngestionStatusUpdateDTO` pattern), with a round-trip test guarding it. Without this the fields silently arrive null.
- **Flat fields** on DTOs/events; nested `anchor` only in the model JSON (Task 1 parse). Consistent across Pyris/Artemis/client.
- **Portable file matching:** `isAnchorLive`/`resolveAnchorEditor` match **repo-relative to the exercise root** (forward-slash normalized), not `fsPath.endsWith` (which breaks on Windows separators + duplicate basenames).
- **Testability:** parse (Pyris), event forwarding (Artemis), event parsing + `buildCueText` + **`isAnchorLive`/`resolveAnchorEditor`** (client) are unit-tested; only the `setDecorations` rendering is e2e/manual (spec §4.1 prototype).
- **Lifecycle (correct events + clearing):** `reapply()` always removes decorations first, then redraws only if live, so a non-live state truly clears; it listens to BOTH `onDidChangeVisibleTextEditors` (tab/split) AND `onDidChangeTextEditorVisibleRanges` (scroll); an edit calls full `clear()` (forgets `current`), while scroll keeps `current` so a scroll-back redraws; `reset()`/`onSessionStart` also clear.
- **Type consistency:** `anchorFile: string`, `anchorLine: number` (1-based), `inlineHint: string` everywhere; `isAnchorLive` converts to 0-based once.
- **Placeholder scan:** every code/test step shows the actual code; the only non-shown items are the existing host-test fixtures referenced by name.
