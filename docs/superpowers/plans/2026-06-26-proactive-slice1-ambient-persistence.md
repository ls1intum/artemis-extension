# Proactive Intervention — Slice 1: Ambient Persistence + `messageId` (No-Repeat memory repair) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist `ambient` proactive messages into the shared `PROGRAMMING_EXERCISE_CHAT` session and carry a per-message `messageId` on the struggle event, so the Pyris gate sees its own past ambient hint **text** in `chat_history` (No-Repeat repaired) and later slices can target a specific persisted message.

**Scope of THIS slice = backend memory repair only.** It deliberately does **not** surface the persisted ambient message to the student (the lamp behaves exactly as today). Reliable surfacing is a later slice because it depends on things this slice does not touch (see "Deferred to the surfacing slice" below). The honest deliverable is: "ambient is now persisted for the gate's memory, and the event carries `messageId`."

**Architecture:** Server-side behaviour change plus a tiny client contract change. In Artemis `handleDecision`, the shared resolve-session + persist-message logic is extracted into one private helper (DRY). `active` keeps doing what it does today (persist + live `sendMessage` push + active event). `ambient` is upgraded to **persist via the same helper** (so the message enters `chat_history`) but does **not** call `sendMessage` (no unreliable live push this slice); it emits the same `ambient` event as today plus the new `sessionId`/`messageId`. Both events gain `messageId`. The Pyris gate already loads `chat_history` from that same session, so persistence alone repairs No-Repeat — **no Pyris change and no DB migration in this slice**. The client only learns to parse the new `messageId`.

**Tech Stack:** Artemis backend (Java 21, Spring Boot, JUnit 5 + Mockito, Gradle, Spotless/Checkstyle). Extension client (TypeScript, Vitest for `test/logic/**`).

This is **Slice 1 of the proactive-intervention spec** (`docs/superpowers/specs/2026-06-26-proactive-intervention-surfaces-design.md`, §7.1/§7.2/§8).

## Global Constraints

- **Branch:** work on `feat/struggle-v3-integration`. Do not branch to `dev`/`main`.
- **Commit messages:** Conventional Commits. **No AI attribution** — no `Co-Authored-By`, no `🤖`, no "Generated with". Overrides any default trailer.
- **Staging:** stage only the exact files each task changed. Never `git add -A`/`.`.
- **Artemis verification:** run the test class green AND `./gradlew spotlessApply` before claiming a Java task done. Pipe long output through `tee` and read it on failure.
- **Extension verification:** run the targeted Vitest file green AND `npm run check-types` (eslint misses unused-locals TS6133).
- **Invariants (unchanged here):** Desktop = Cookie auth, Theia = Bearer (do not touch `AuthManager`). No `^`/`~` added to any `package.json`. `PROGRAMMING_EXERCISE_CHAT` is the single shared thread (spec §7.1); never introduce a separate proactive session.

## Deferred to the surfacing slice (NOT in scope here — documented so the narrow goal is honest)

These are why this slice is backend-only; codex confirmed each against the code:
- The client subscribes to **one** active chat-session topic at a time (`irisWebSocketSessionClient.ts:144`), so a server `sendMessage(...)` does not reliably reach the webview unless that exact session is already active. Hence ambient does **not** `sendMessage` here.
- Proactive-only sessions are **omitted from the sidebar overview** because the overview query requires `m.sender = USER` (`IrisChatSessionRepository.java:61`). Surfacing a persisted ambient message in the sidebar needs that query relaxed — later slice.
- The lamp click currently just focuses the chat (`interventionService.ts:77`); opening the *specific* persisted session/message by `sessionId`/`messageId` is later-slice work.
- The proactive bubble keeps its current style; the §6.2 restyle is a later slice.
- `PyrisMessageDTO` carries no `origin` (`PyrisMessageDTO.java:19`), so Pyris sees the ambient **text** (enough for No-Repeat) but not an explicit "proactive ambient hint" marker; explicit origin/outcome tagging is the §7.4 outcome-tags slice.

---

## File structure (what changes in this slice)

- **Artemis**
  - Modify: `src/main/java/de/tum/cit/aet/artemis/iris/dto/StruggleInterventionEventDTO.java` — add `messageId`; fix Javadoc.
  - Modify: `src/main/java/de/tum/cit/aet/artemis/iris/service/session/IrisStruggleInterventionService.java` — extract persist helper; rewire `active`; rewire `ambient` to persist.
  - Modify: `src/main/java/de/tum/cit/aet/artemis/iris/service/websocket/IrisChatWebsocketService.java` — fix the `sendStruggleEvent` Javadoc that claims ambient is session-less.
  - Modify (test): `src/test/java/de/tum/cit/aet/artemis/iris/struggle/IrisStruggleInterventionDecisionTest.java` — assert `messageId` on `active`; rewrite the ambient test to the new persist contract; fix the class Javadoc.
- **Extension**
  - Modify: `extension/src/extension/services/struggleIntervention/struggleContract.ts` — add `messageId?` to `StruggleInterventionEvent`.
  - Modify: `extension/src/extension/services/struggleIntervention/struggleEventSubscription.ts` — parse `messageId`.
  - Modify (test): `extension/test/logic/struggleIntervention/struggleEventSubscription.test.ts` — assert `messageId` parsing.

Real APIs confirmed (use exactly these): `StruggleInterventionJob(String jobId, long courseId, long exerciseId, long userId)`; the test's `job` field is `new StruggleInterventionJob("t", 7L, 42L, 3L)`; sessions are built by the test helper `exerciseSession(long entityId)` → `new IrisChatSession(exercise, user, IrisChatMode.PROGRAMMING_EXERCISE_CHAT); session.setId(99L)`; `DomainObject.setId(...)` exists (no `ReflectionTestUtils` needed for ids); `getCurrentSessionOrCreateIfNotExists(...)` returns `IrisChatSession`; `IrisMessage.getOrigin()`/`setOrigin(...)` and `IrisMessage.setId(...)` exist.

---

### Task 1: Add `messageId` to the event DTO, extract the persist helper, emit `messageId` from `active`

**Files:**
- Modify: `src/main/java/de/tum/cit/aet/artemis/iris/dto/StruggleInterventionEventDTO.java`
- Modify: `src/main/java/de/tum/cit/aet/artemis/iris/service/session/IrisStruggleInterventionService.java`
- Test: `src/test/java/de/tum/cit/aet/artemis/iris/struggle/IrisStruggleInterventionDecisionTest.java`

**Interfaces:**
- Produces: `StruggleInterventionEventDTO(long exerciseId, String action, @Nullable String message, @Nullable Long sessionId, @Nullable Long messageId, @Nullable Double confidence)` (new `messageId` before `confidence`).
- Produces: `private record PersistedProactive(IrisChatSession session, IrisMessage saved)` and `private @Nullable PersistedProactive persistProactiveMessage(User user, long exerciseId, String result)` (resolve shared session, defensive exercise-bound guard, save origin-tagged message, return; **no** `sendMessage`).

- [ ] **Step 1: Confirm a green baseline**

Run (cwd `/Users/liamberger/Documents/private/Artemis`):
```bash
./gradlew test --tests "de.tum.cit.aet.artemis.iris.struggle.IrisStruggleInterventionDecisionTest" 2>&1 | tee /tmp/slice1_t1.txt | tail -20
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 2: Modify the existing `active` test to expect `messageId`**

In `IrisStruggleInterventionDecisionTest.java`: add `import de.tum.cit.aet.artemis.iris.domain.message.IrisMessage;` to the imports. In `active_aboveThreshold_materializesPersistsAndPushes`, replace the `saveMessage` stub so the saved message gets an id, and add the `messageId` assertion:
```java
when(irisMessageService.saveMessage(any(), eq(session), eq(IrisMessageSender.LLM)))
        .thenAnswer(inv -> { IrisMessage m = inv.getArgument(0); m.setId(555L); return m; });
```
and extend the final event assertion's lambda to:
```java
argThat(e -> "active".equals(e.action()) && Objects.equals(e.sessionId(), 99L) && Objects.equals(e.messageId(), 555L) && Objects.equals(e.confidence(), 0.8))
```

- [ ] **Step 3: Run the test to verify it fails (compile)**

Run:
```bash
./gradlew test --tests "de.tum.cit.aet.artemis.iris.struggle.IrisStruggleInterventionDecisionTest" 2>&1 | tee /tmp/slice1_t1.txt | tail -25
```
Expected: FAIL — compile error, `messageId()` is not a member of `StruggleInterventionEventDTO`.

- [ ] **Step 4: Add `messageId` to the DTO (and fix its Javadoc)**

In `StruggleInterventionEventDTO.java`, change the record signature and correct the Javadoc lines that say ambient is session-less / never persisted:
```java
public record StruggleInterventionEventDTO(long exerciseId, String action, @Nullable String message, @Nullable Long sessionId, @Nullable Long messageId,
        @Nullable Double confidence) {
}
```
Update the Javadoc to: both `ambient` and `active` now carry `sessionId` + `messageId` (the saved proactive message); `message` is the lamp text for `ambient`; `confidence` is forwarded for the eval log.

- [ ] **Step 5: Extract the persist helper and rewire `active`; keep `ambient` compiling**

In `IrisStruggleInterventionService.java`, add imports `import de.tum.cit.aet.artemis.iris.domain.session.IrisChatSession;` and `import org.jspecify.annotations.Nullable;`. Add the helper just below `handleDecision`:
```java
private record PersistedProactive(IrisChatSession session, IrisMessage saved) {
}

/** Resolve the shared exercise-chat session and persist an origin-tagged proactive message. Returns null when the
 *  resolved session is not exercise-bound (defensive drop). Shared by active and ambient (spec §7.2). Does NOT push
 *  the message over the socket — callers decide that. */
private @Nullable PersistedProactive persistProactiveMessage(User user, long exerciseId, String result) {
    var session = irisChatSessionService.getCurrentSessionOrCreateIfNotExists(IrisChatMode.PROGRAMMING_EXERCISE_CHAT, exerciseId, user);
    if (session.getMode() != IrisChatMode.PROGRAMMING_EXERCISE_CHAT || !Objects.equals(session.getEntityId(), exerciseId)) {
        log.info("Dropping stale struggle intervention: resolved session for exercise {} is not exercise-bound", exerciseId);
        return null;
    }
    var message = new IrisMessage();
    message.addContent(new IrisTextMessageContent(result));
    message.setOrigin(IrisMessageOrigin.PROACTIVE_STRUGGLE);
    var saved = irisMessageService.saveMessage(message, session, IrisMessageSender.LLM);
    return new PersistedProactive(session, saved);
}
```
Replace the `active` case with (active still pushes live):
```java
case "active" -> {
    var p = persistProactiveMessage(user, job.exerciseId(), statusUpdate.result());
    if (p == null) {
        return;
    }
    irisChatWebsocketService.sendMessage(p.session(), p.saved(), statusUpdate.stages());
    irisChatWebsocketService.sendStruggleEvent(user,
        new StruggleInterventionEventDTO(job.exerciseId(), "active", null, p.session().getId(), p.saved().getId(), confidence));
}
```
Keep `ambient` behaviour identical to today but make it compile against the 6-arg record (Task 2 rewires it):
```java
case "ambient" ->
    irisChatWebsocketService.sendStruggleEvent(user,
        new StruggleInterventionEventDTO(job.exerciseId(), "ambient", statusUpdate.result(), null, null, confidence));
```

- [ ] **Step 6: Run the test to verify it passes + format**

Run:
```bash
./gradlew test --tests "de.tum.cit.aet.artemis.iris.struggle.IrisStruggleInterventionDecisionTest" 2>&1 | tee /tmp/slice1_t1.txt | tail -20
./gradlew spotlessApply 2>&1 | tail -3
```
Expected: BUILD SUCCESSFUL (active test now asserts `messageId`; the still-old ambient test passes unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/main/java/de/tum/cit/aet/artemis/iris/dto/StruggleInterventionEventDTO.java \
        src/main/java/de/tum/cit/aet/artemis/iris/service/session/IrisStruggleInterventionService.java \
        src/test/java/de/tum/cit/aet/artemis/iris/struggle/IrisStruggleInterventionDecisionTest.java
git commit -m "feat(iris): carry messageId on the struggle event + extract proactive persist helper"
```

---

### Task 2: Persist `ambient` (unify-persistence) and emit `sessionId` + `messageId`

**Files:**
- Modify: `src/main/java/de/tum/cit/aet/artemis/iris/service/session/IrisStruggleInterventionService.java`
- Modify: `src/main/java/de/tum/cit/aet/artemis/iris/service/websocket/IrisChatWebsocketService.java`
- Test: `src/test/java/de/tum/cit/aet/artemis/iris/struggle/IrisStruggleInterventionDecisionTest.java`

**Interfaces:**
- Consumes: `persistProactiveMessage(...)` from Task 1.
- Produces: `ambient` now persists (message enters `chat_history` → gate No-Repeat) and emits `StruggleInterventionEventDTO(exerciseId, "ambient", result, sessionId, messageId, confidence)`. It does **not** `sendMessage` (no live push this slice).

- [ ] **Step 1: Rewrite the ambient test to the new persist contract**

Replace `ambient_aboveThreshold_pushesSessionlessEventOnly` with:
```java
@Test
void ambient_aboveThreshold_persistsAndEmitsSessionAndMessageId() {
    var session = exerciseSession(42L);
    when(irisChatSessionService.getCurrentSessionOrCreateIfNotExists(eq(IrisChatMode.PROGRAMMING_EXERCISE_CHAT), eq(42L), any())).thenReturn(session);
    when(irisMessageService.saveMessage(any(), eq(session), eq(IrisMessageSender.LLM)))
            .thenAnswer(inv -> { IrisMessage m = inv.getArgument(0); m.setId(556L); return m; });
    var update = new PyrisStruggleInterventionStatusUpdateDTO("Re-check the logic.", "ambient", 0.7, null, List.of(), List.of());

    service.handleDecision(job, update);

    // unify-persistence: ambient now saves an origin-tagged LLM message into the shared exercise-chat session
    verify(irisMessageService).saveMessage(argThat(m -> m.getOrigin() == IrisMessageOrigin.PROACTIVE_STRUGGLE), eq(session), eq(IrisMessageSender.LLM));
    // but it does NOT push the bubble live in this slice (surfacing is deferred)
    verify(irisChatWebsocketService, never()).sendMessage(any(), any(), any());
    verify(irisChatWebsocketService).sendStruggleEvent(any(),
            argThat(e -> "ambient".equals(e.action()) && Objects.equals(e.message(), "Re-check the logic.") && Objects.equals(e.sessionId(), 99L)
                    && Objects.equals(e.messageId(), 556L) && Objects.equals(e.confidence(), 0.7)));
}
```
Also update the class Javadoc line that says "ambient pushes a session-less event only" to describe persistence.

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
./gradlew test --tests "de.tum.cit.aet.artemis.iris.struggle.IrisStruggleInterventionDecisionTest" 2>&1 | tee /tmp/slice1_t2.txt | tail -25
```
Expected: FAIL — `saveMessage` never called (current ambient saves nothing); event `sessionId`/`messageId` null.

- [ ] **Step 3: Rewire the `ambient` branch to persist**

Replace the `ambient` case in `handleDecision` with:
```java
case "ambient" -> {
    var p = persistProactiveMessage(user, job.exerciseId(), statusUpdate.result());
    if (p == null) {
        return;
    }
    irisChatWebsocketService.sendStruggleEvent(user,
        new StruggleInterventionEventDTO(job.exerciseId(), "ambient", statusUpdate.result(), p.session().getId(), p.saved().getId(), confidence));
}
```
In `IrisChatWebsocketService.java`, fix the `sendStruggleEvent` Javadoc (~line 77) that claims ambient is session-less / never persisted. Also fix the **`IrisStruggleInterventionService` class-header Javadoc** (~line 43) that says "The session is materialized only on `active`" — ambient now persists into the shared session too.

- [ ] **Step 4: Run the test + format**

Run:
```bash
./gradlew test --tests "de.tum.cit.aet.artemis.iris.struggle.IrisStruggleInterventionDecisionTest" 2>&1 | tee /tmp/slice1_t2.txt | tail -20
./gradlew spotlessApply 2>&1 | tail -3
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add src/main/java/de/tum/cit/aet/artemis/iris/service/session/IrisStruggleInterventionService.java \
        src/main/java/de/tum/cit/aet/artemis/iris/service/websocket/IrisChatWebsocketService.java \
        src/test/java/de/tum/cit/aet/artemis/iris/struggle/IrisStruggleInterventionDecisionTest.java
git commit -m "feat(iris): persist ambient proactive messages for gate memory (No-Repeat)"
```

---

### Task 3: Client — parse `messageId` on the struggle event

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/struggleContract.ts`
- Modify: `extension/src/extension/services/struggleIntervention/struggleEventSubscription.ts`
- Test: `extension/test/logic/struggleIntervention/struggleEventSubscription.test.ts`

**Interfaces:**
- Produces: `StruggleInterventionEvent` gains `messageId?: number`; `classifyStruggleEvent` populates it from a numeric `messageId` field (else `undefined`). No handler-signature change this slice.

- [ ] **Step 1: Write the failing test**

Add to `struggleEventSubscription.test.ts` (match the file's existing import + `describe`/`it` style):
```ts
it('parses messageId when present (ambient + active)', () => {
    expect(classifyStruggleEvent({ exerciseId: 1, action: 'ambient', message: 'hi', sessionId: 9, messageId: 556, confidence: 0.8 })?.messageId).toBe(556);
    expect(classifyStruggleEvent({ exerciseId: 1, action: 'active', sessionId: 9, messageId: 555 })?.messageId).toBe(555);
});

it('leaves messageId undefined when absent or non-numeric', () => {
    expect(classifyStruggleEvent({ exerciseId: 1, action: 'active', sessionId: 9 })?.messageId).toBeUndefined();
    expect(classifyStruggleEvent({ exerciseId: 1, action: 'active', sessionId: 9, messageId: 'x' })?.messageId).toBeUndefined();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (cwd `/Users/liamberger/Documents/private/MA/artemis-extension/extension`):
```bash
npx vitest run test/logic/struggleIntervention/struggleEventSubscription.test.ts 2>&1 | tail -25
```
Expected: FAIL — either a TS compile error (`messageId` not on `StruggleInterventionEvent`) or the assertion sees `undefined`.

- [ ] **Step 3: Add `messageId` to the contract**

In `struggleContract.ts`, add to `StruggleInterventionEvent` (after `sessionId?`):
```ts
    /** Saved IrisMessage id for the persisted proactive message (spec §7.2/§8). Set for ambient and active after
     *  unify-persistence; lets a later slice target the exact message (open/reveal/dismiss). */
    messageId?: number;
```

- [ ] **Step 4: Parse it in `classifyStruggleEvent`**

In `struggleEventSubscription.ts`: add `messageId?: unknown` to the destructured `f` shape; before the return add
```ts
    const messageId = typeof f.messageId === 'number' ? f.messageId : undefined;
```
and add `messageId,` to the returned object literal.

- [ ] **Step 5: Run the test + type-check**

Run (cwd `extension`):
```bash
npx vitest run test/logic/struggleIntervention/struggleEventSubscription.test.ts 2>&1 | tail -20
npm run check-types 2>&1 | tail -15
```
Expected: PASS; `check-types` clean.

- [ ] **Step 6: Commit**

```bash
git add extension/src/extension/services/struggleIntervention/struggleContract.ts \
        extension/src/extension/services/struggleIntervention/struggleEventSubscription.ts \
        extension/test/logic/struggleIntervention/struggleEventSubscription.test.ts
git commit -m "feat(struggle): parse messageId on the struggle intervention event"
```

---

## Self-review checklist

- **Spec coverage:** §7.1 (shared thread — reused), §7.2 (ambient persists + `messageId`, Tasks 1-2), §8 event `messageId` (Tasks 1-3). Outcome tags / surfacing / restyle / backoff / settings are explicitly later slices.
- **Real APIs:** `StruggleInterventionJob("t",7L,42L,3L)`, `exerciseSession(...)` helper, `setId(...)` (no ReflectionTestUtils), `IrisChatSession(exercise,user,mode)` — all verified against the actual test/code.
- **Record-arity TDD:** the DTO arity change breaks all call sites at once; Task 1 fixes the DTO + both call sites together (ambient temporarily passes `null,null`), Task 2 then rewires ambient — each task compiles + is testable.
- **No false surfacing claim:** ambient persists for memory only; it does NOT `sendMessage` (single-session subscription + sidebar `sender=USER` overview make a live push unreliable — deferred). The ambient test asserts `never sendMessage`.
- **No DB migration / no Pyris change:** confirmed; gate gets ambient TEXT via `chat_history` (enough for No-Repeat); `origin`/outcome marker is a later slice.
- **Javadocs fixed:** `StruggleInterventionEventDTO`, `IrisChatWebsocketService.sendStruggleEvent`, the `IrisStruggleInterventionService` class header ("materialized only on active"), and the decision-test class doc no longer claim ambient is ephemeral.
- **Imports added:** service (`IrisChatSession`, `@Nullable`), test (`IrisMessage`).
- **Placeholder scan:** none.
