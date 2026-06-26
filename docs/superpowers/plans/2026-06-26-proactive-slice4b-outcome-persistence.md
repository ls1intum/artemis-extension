# Proactive Intervention — Slice 4b: Outcome persistence + chat-bubble Dismiss + gate outcome-tags — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a per-proactive-message **dismissed** outcome server-side, add the **chat-bubble Dismiss** (collapse, not delete) that records it and feeds the Slice-4a backoff, and feed the gate an **outcome tag** per past proactive hint (`engaged`/`ignored`/`dismissed`) in `chat_history` so Iris can adapt instead of repeating itself.

**Sequencing.** Builds on slices 1-4a (event `messageId`; `origin = PROACTIVE_STRUGGLE` persisted on the ambient/active message; the orchestrator's `recordOutcome`/backoff counters). A read-only review of un-applied `HEAD` will see those prerequisites partially absent — the slices execute in order.

**Scope of THIS slice.** Artemis: a `proactive_outcome` column + `IrisProactiveOutcome` enum + the field on `IrisMessageResponseDTO` (so it reaches the client), a `PUT …/proactive-outcome` endpoint (mirroring `/helpful` `rateMessage`), and an Artemis-side **text annotation** of proactive messages in the struggle `chat_history`. Webview: the proactive bubble's **Dismiss** button + collapsed rendering + the message protocol, bridged to the orchestrator's backoff across the `@telemetry` seam. **No Pyris change** — the outcome is conveyed as a text annotation the gate already reads (`[ENG]`).

**Why this slice also completes the `origin` threading.** In current `HEAD` the proactive `origin` is dropped at the webview boundary: the host→webview contract (`extensionMessages.ts`) does not carry `origin`, and `IrisChatView` rebuilds each `ChatMessage` with only `id/role/content/timestamp/helpful` (lines ~97 and ~126). So the Slice-2 bubble restyle is inert at runtime until the field threading lands. Because the **collapsed-on-reload** behaviour (§6.3) needs both `origin` (to know the bubble is proactive) and `proactiveOutcome` (to know it is dismissed) to survive a history reload, this slice threads **`origin` + `proactiveOutcome` together** end-to-end. That retroactively makes the Slice-2 restyle live.

**Architecture:** A nullable `IrisProactiveOutcome { DISMISSED }` on `IrisMessage`, surfaced to the client by adding it to `IrisMessageResponseDTO` + its `of(...)` factory (both the REST history path and the websocket push go through that factory). The webview Dismiss → `messageProactiveOutcome` command → `chatWebviewProvider` → `PUT …/proactive-outcome` AND a fired `onDidDismissProactive` event → (in `extension.ts`, across the seam) `recordProactiveDismiss()` → `orchestrator.recordChatDismiss()` (reload-safe Slice-4a backoff). The bubble collapses optimistically via a store patch; on reload it reads `proactiveOutcome === 'DISMISSED'` and renders collapsed (never deleted, §6.3). For the gate, the struggle `sendToPyris` builds `chat_history` via a struggle-specific conversion that prepends `(proactive hint, <outcome>)` to each proactive message, where `<outcome>` is derived from `proactiveOutcome` + `helpful` + an immediate USER reply + supersession — built as fresh `PyrisMessageDTO`s that never mutate the stored entities.

**Tech Stack:** Artemis (Java 21/Spring, Liquibase, JUnit/Mockito + Spring integration test). Extension webview (TypeScript + React, Vitest `test/react`/`test/logic`).

Spec refs: §6.2, §6.3, §7.4, §7.5. Depends on the design spec `docs/superpowers/specs/2026-06-26-proactive-intervention-surfaces-design.md`.

## Global Constraints

- **Branch:** `feat/struggle-v3-integration`. Not `dev`/`main`.
- **Commit messages:** Conventional Commits. **No AI attribution** (no `Co-Authored-By`, no `🤖`, no "Generated with"). Overrides any default trailer.
- **Staging:** exact files only. `git` from each repo's root (Artemis `/Users/liamberger/Documents/private/Artemis`; extension `/Users/liamberger/Documents/private/MA/artemis-extension`). Never `git add -A`/`.`.
- **Verification:** Artemis test class green + `./gradlew spotlessApply`; extension targeted Vitest green + `npm run check-types` (eslint misses TS6133 unused-locals; `check-types` is the real gate).
- **Invariants:** Desktop = Cookie auth, Theia = Bearer (untouched). No `^`/`~` added to any `package.json`. CSS-module lookups static camelCase.
- **The bubble is never deleted (§6.3):** Dismiss collapses + records; it never removes the persisted message.
- **Clean-build seam (`@telemetry`):** every new struggle/intervention reference from `extension.ts` must go through the `StruggleEngineHandle` contract; the no-op factory (`telemetry/noop.ts`) must implement the same surface so the Open VSX bundle still excludes the engine (`scripts/verify-clean-bundle.js`).

---

## File structure

- **Artemis** (`/Users/liamberger/Documents/private/Artemis`)
  - Create: `src/main/java/de/tum/cit/aet/artemis/iris/domain/message/IrisProactiveOutcome.java` — `enum { DISMISSED }`.
  - Create: `src/main/resources/config/liquibase/changelog/20260627120000_changelog.xml` — `proactive_outcome` column (mirror the `origin` changeset).
  - Modify: `src/main/resources/config/liquibase/master.xml` — include the new changelog after `20260614120000`.
  - Modify: `src/main/java/de/tum/cit/aet/artemis/iris/domain/message/IrisMessage.java` — `proactiveOutcome` field + accessors.
  - Modify: `src/main/java/de/tum/cit/aet/artemis/iris/dto/IrisMessageResponseDTO.java` — add `proactiveOutcome` to the record + `of(...)`.
  - Modify: `src/main/java/de/tum/cit/aet/artemis/iris/web/IrisMessageResource.java` — `PUT …/proactive-outcome`.
  - Modify: `src/main/java/de/tum/cit/aet/artemis/iris/service/pyris/PyrisDTOService.java` — `toPyrisMessageDTOListForStruggle(...)`.
  - Modify: `src/main/java/de/tum/cit/aet/artemis/iris/service/session/IrisStruggleInterventionService.java` — `sendToPyris` uses the struggle conversion.
  - Test: `src/test/java/de/tum/cit/aet/artemis/iris/IrisChatMessageIntegrationTest.java` (endpoint); `src/test/java/de/tum/cit/aet/artemis/iris/PyrisDTOServiceStruggleChatHistoryTest.java` (annotation unit test, new).
- **Extension** (`/Users/liamberger/Documents/private/MA/artemis-extension`)
  - Modify: `extension/src/webview/views/IrisChat/types.ts` — `proactiveOutcome?` on `ChatMessage`.
  - Modify: `extension/src/webview/stores/useChatStore.ts` — `setProactiveOutcome` patch action.
  - Modify: `extension/src/webview/views/IrisChat/components/MessageBubble.tsx` — Dismiss button + collapsed rendering + memo comparator.
  - Modify: `extension/src/webview/views/IrisChat/components/MessageBubble.module.css` — `.proactiveDismissed` + `.dismissButton` styles.
  - Modify: `extension/src/webview/views/IrisChat/components/ChatMessageList.tsx` — thread `onDismiss`.
  - Test: `extension/test/react/MessageBubble.proactive.test.tsx` (extend), `extension/test/react/useChatStore.proactiveOutcome.test.ts` (new, store patch).
  - Modify: `extension/src/shared/messageContracts/webviewCommands.ts` — `messageProactiveOutcome` command (3 places).
  - Modify: `extension/src/shared/messageContracts/extensionMessages.ts` — `origin`/`proactiveOutcome` on `addMessage` + `loadMessages`.
  - Modify: `extension/src/shared/types/apiResponses.ts` — `origin`/`proactiveOutcome` on `IrisChatMessage`.
  - Modify: `extension/src/webview/views/IrisChat/IrisChatView.tsx` — retain `origin`+`proactiveOutcome`; `handleDismissProactive`.
  - Modify: `extension/src/extension/services/iris/chat/chatSessionService.ts` — map `proactiveOutcome` next to `origin` (~line 414).
  - Modify: `extension/src/extension/api/artemisApi.ts` — `setProactiveOutcome(...)` client method.
  - Modify: `extension/src/extension/provider/chatWebviewProvider.ts` — command handler + `onDidDismissProactive` event.
  - Modify: `extension/src/extension/telemetry/contract.ts` — `recordProactiveDismiss` on `StruggleEngineHandle`.
  - Modify: `extension/src/extension/telemetry/index.ts` — return `recordProactiveDismiss`.
  - Modify: `extension/src/extension/telemetry/noop.ts` — no-op `recordProactiveDismiss`.
  - Modify: `extension/src/extension.ts` — destructure + subscribe the bridge.

---

### Task 1: Artemis — `proactive_outcome` column + entity field + response DTO field

**Files:**
- Create: `IrisProactiveOutcome.java`, `20260627120000_changelog.xml`
- Modify: `master.xml`, `IrisMessage.java`, `IrisMessageResponseDTO.java`

**Interfaces:**
- Produces: `enum IrisProactiveOutcome { DISMISSED }`; `IrisMessage.getProactiveOutcome()/setProactiveOutcome(...)` (nullable, `@Enumerated(STRING)`, column `proactive_outcome`); `IrisMessageResponseDTO` carries `@Nullable IrisProactiveOutcome proactiveOutcome` and `of(...)` maps it (so REST history `getList` and the websocket push both serialize it; `@JsonInclude(NON_EMPTY)` omits it when null).

- [ ] **Step 1: Create the enum**

`IrisProactiveOutcome.java`:
```java
package de.tum.cit.aet.artemis.iris.domain.message;

/**
 * Durable per-message record of how the student reacted to a proactive struggle hint (spec §7.4/§7.5).
 * Only an explicit dismiss is persisted; "engaged" is derived (helpful rating or a follow-up reply),
 * so there is no OPENED value to write client-side.
 */
public enum IrisProactiveOutcome {
    DISMISSED
}
```

- [ ] **Step 2: Add the Liquibase changeset (mirror the `origin` one)**

`20260627120000_changelog.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<databaseChangeLog xmlns="http://www.liquibase.org/xml/ns/dbchangelog" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-latest.xsd">
    <changeSet id="20260627120000-1-add-proactive-outcome-mysql" author="liam-berger" dbms="mysql,h2">
        <preConditions onFail="MARK_RAN"><not><columnExists tableName="iris_message" columnName="proactive_outcome"/></not></preConditions>
        <addColumn tableName="iris_message"><column name="proactive_outcome" type="ENUM('DISMISSED')"/></addColumn>
    </changeSet>
    <changeSet id="20260627120000-1-add-proactive-outcome-postgres" author="liam-berger" dbms="postgresql">
        <preConditions onFail="MARK_RAN"><not><columnExists tableName="iris_message" columnName="proactive_outcome"/></not></preConditions>
        <addColumn tableName="iris_message"><column name="proactive_outcome" type="text"/></addColumn>
    </changeSet>
</databaseChangeLog>
```
Add to `master.xml`, immediately after the `20260614120000_changelog.xml` include (the `origin` column):
```xml
    <include file="classpath:config/liquibase/changelog/20260627120000_changelog.xml" relativeToChangelogFile="false"/>
```

- [ ] **Step 3: Add the entity field (mirror `origin`)**

In `IrisMessage.java`, next to the `origin` field:
```java
    @Nullable
    @Enumerated(EnumType.STRING)
    @Column(name = "proactive_outcome")
    private IrisProactiveOutcome proactiveOutcome;
```
plus accessors (mirror the `origin` getter/setter):
```java
    @Nullable
    public IrisProactiveOutcome getProactiveOutcome() {
        return proactiveOutcome;
    }

    public void setProactiveOutcome(@Nullable IrisProactiveOutcome proactiveOutcome) {
        this.proactiveOutcome = proactiveOutcome;
    }
```
(`@Nullable`, `@Enumerated`, `EnumType`, `@Column` are already imported for the `origin` field; `IrisProactiveOutcome` is same-package, no import.)

- [ ] **Step 4: Add the field to the response DTO + its factory**

In `IrisMessageResponseDTO.java`, add `@Nullable IrisProactiveOutcome proactiveOutcome` to the record components (right after `origin`) and map it in `of(...)`:
```java
public record IrisMessageResponseDTO(@Nullable Long id, @Nullable ZonedDateTime sentAt, @Nullable Boolean helpful, IrisMessageSender sender, @Nullable IrisMessageOrigin origin,
        @Nullable IrisProactiveOutcome proactiveOutcome, List<IrisMessageContentResponseDTO> content, @Nullable List<MemirisMemoryDTO> accessedMemories,
        @Nullable List<MemirisMemoryDTO> createdMemories, @Nullable Integer messageDifferentiator) {

    public static IrisMessageResponseDTO of(IrisMessage message) {
        var content = message.getContent();
        List<IrisMessageContentResponseDTO> contentDTOs = content == null ? List.of() : content.stream().map(IrisMessageContentResponseDTO::of).toList();
        var accessedMemories = message.getAccessedMemories();
        var createdMemories = message.getCreatedMemories();
        return new IrisMessageResponseDTO(message.getId(), message.getSentAt(), message.getHelpful(), message.getSender(), message.getOrigin(), message.getProactiveOutcome(), contentDTOs,
                accessedMemories == null || accessedMemories.isEmpty() ? null : accessedMemories, createdMemories == null || createdMemories.isEmpty() ? null : createdMemories,
                message.getMessageDifferentiator());
    }
}
```
Add the import `import de.tum.cit.aet.artemis.iris.domain.message.IrisProactiveOutcome;` (the package already imports `IrisMessageOrigin`/`IrisMessageSender` from the same package).

- [ ] **Step 5: Compile + format + commit**

```bash
( cd /Users/liamberger/Documents/private/Artemis && ./gradlew compileJava spotlessApply ) 2>&1 | tail -8
git -C /Users/liamberger/Documents/private/Artemis add \
    src/main/java/de/tum/cit/aet/artemis/iris/domain/message/IrisProactiveOutcome.java \
    src/main/java/de/tum/cit/aet/artemis/iris/domain/message/IrisMessage.java \
    src/main/java/de/tum/cit/aet/artemis/iris/dto/IrisMessageResponseDTO.java \
    src/main/resources/config/liquibase/changelog/20260627120000_changelog.xml \
    src/main/resources/config/liquibase/master.xml
git -C /Users/liamberger/Documents/private/Artemis commit -m "feat(iris): add proactive_outcome to IrisMessage + response DTO"
```

---

### Task 2: Artemis — `PUT …/proactive-outcome` endpoint (mirror `rateMessage`)

**Files:**
- Modify: `src/main/java/de/tum/cit/aet/artemis/iris/web/IrisMessageResource.java`
- Test: `src/test/java/de/tum/cit/aet/artemis/iris/IrisChatMessageIntegrationTest.java`

**Interfaces:**
- Produces: `PUT api/iris/sessions/{sessionId}/messages/{messageId}/proactive-outcome`, body `IrisProactiveOutcome` (JSON string e.g. `"DISMISSED"`) → sets it on the message **only when it is a proactive LLM message** (`sender == LLM && origin == PROACTIVE_STRUGGLE`), returns `IrisMessageResponseDTO`. 400 otherwise; 409 on session mismatch (mirrors `rateMessage`).

- [ ] **Step 1: Failing endpoint tests (mirror `assertHelpfulRatingPersisted`)**

In `IrisChatMessageIntegrationTest.java`, add two tests + a URL helper. The persistence happy path persists a proactive LLM message and asserts the column; the guard test rejects a non-proactive LLM message. (`saveMessage` sets only sender/sentAt/session/content back-refs — it does **not** touch `origin` — so a pre-set `origin` survives; verified in `IrisMessageService.saveMessage`.)
```java
@Test
@WithMockUser(username = TEST_PREFIX + "student1", roles = "USER")
void setProactiveOutcome_persistsDismissed() throws Exception {
    IrisChatSession session = createSessionForUser(IrisChatMode.PROGRAMMING_EXERCISE_CHAT, "student1");
    IrisMessage proactive = IrisMessageFactory.createIrisMessageForSessionWithContent(session);
    proactive.setOrigin(IrisMessageOrigin.PROACTIVE_STRUGGLE);
    proactive = irisMessageService.saveMessage(proactive, session, IrisMessageSender.LLM);

    request.putWithResponseBody(proactiveOutcomeUrl(session, proactive), IrisProactiveOutcome.DISMISSED, IrisMessageResponseDTO.class, HttpStatus.OK);

    var reloaded = irisMessageRepository.findById(proactive.getId()).orElseThrow();
    assertThat(reloaded.getProactiveOutcome()).isEqualTo(IrisProactiveOutcome.DISMISSED);
}

@Test
@WithMockUser(username = TEST_PREFIX + "student1", roles = "USER")
void setProactiveOutcome_returns400WhenMessageNotProactive() throws Exception {
    IrisChatSession session = createSessionForUser(IrisChatMode.PROGRAMMING_EXERCISE_CHAT, "student1");
    IrisMessage plainLlm = irisMessageService.saveMessage(IrisMessageFactory.createIrisMessageForSessionWithContent(session), session, IrisMessageSender.LLM);

    request.putWithResponseBody(proactiveOutcomeUrl(session, plainLlm), IrisProactiveOutcome.DISMISSED, IrisMessageResponseDTO.class, HttpStatus.BAD_REQUEST);
}
```
Add the URL helper next to the existing `helpfulUrl` (~line 1052):
```java
    private static String proactiveOutcomeUrl(IrisChatSession session, IrisMessage message) {
        return "/api/iris/sessions/" + session.getId() + "/messages/" + message.getId() + "/proactive-outcome";
    }
```
Add imports if absent: `IrisMessageOrigin`, `IrisProactiveOutcome` (the class already imports `IrisMessage`, `IrisMessageSender`, `IrisChatMode`, `IrisMessageFactory`, `IrisMessageResponseDTO`, `irisMessageService`, `irisMessageRepository`).

- [ ] **Step 2: Run to verify failure**

```bash
( cd /Users/liamberger/Documents/private/Artemis && ./gradlew test --tests "de.tum.cit.aet.artemis.iris.IrisChatMessageIntegrationTest.setProactiveOutcome*" ) 2>&1 | tee /tmp/slice4b_t2.txt | tail -25
```
Expected: FAIL — endpoint missing (404 / method not found).

- [ ] **Step 3: Add the endpoint (mirror `rateMessage`)**

In `IrisMessageResource.java`, add below `rateMessage`:
```java
    /**
     * PUT sessions/{sessionId}/messages/{messageId}/proactive-outcome : record how the student reacted to a
     * proactive struggle hint (spec §7.5). Mirrors {@link #rateMessage}, but only proactive Iris messages
     * (LLM sender AND origin PROACTIVE_STRUGGLE) accept an outcome.
     *
     * @param sessionId of the session
     * @param messageId of the message
     * @param outcome   Request body: the durable outcome (currently only DISMISSED).
     * @return the {@link ResponseEntity} with status {@code 200 (Ok)} and the updated message.
     */
    @PutMapping(value = "sessions/{sessionId}/messages/{messageId}/proactive-outcome")
    @EnforceAtLeastStudent
    @AllowedTools(ToolTokenType.SCORPIO)
    public ResponseEntity<IrisMessageResponseDTO> setProactiveOutcome(@PathVariable Long sessionId, @PathVariable Long messageId, @RequestBody IrisProactiveOutcome outcome) {
        var message = irisMessageRepository.findByIdElseThrow(messageId);
        var session = message.getSession();
        if (!Objects.equals(session.getId(), sessionId)) {
            throw new ConflictException("The message does not belong to the session", "IrisMessage", "irisMessageSessionConflict");
        }
        irisSessionService.checkIsIrisActivated(session);
        irisSessionService.checkHasAccessToIrisSession(session, null);
        if (message.getSender() != IrisMessageSender.LLM || message.getOrigin() != IrisMessageOrigin.PROACTIVE_STRUGGLE) {
            throw new BadRequestException("You can only set a proactive outcome on a proactive Iris message");
        }
        message.setProactiveOutcome(outcome);
        return ResponseEntity.ok(IrisMessageResponseDTO.of(irisMessageRepository.save(message)));
    }
```
Add imports: `IrisProactiveOutcome`, `IrisMessageOrigin` (the class already imports `IrisMessageSender`, `ConflictException`, `BadRequestException`, `Objects`, `@PutMapping`, `@EnforceAtLeastStudent`, `@AllowedTools`, `ToolTokenType` — all used by `rateMessage`).

- [ ] **Step 4: Run green + format + commit**

```bash
( cd /Users/liamberger/Documents/private/Artemis && ./gradlew test --tests "de.tum.cit.aet.artemis.iris.IrisChatMessageIntegrationTest.setProactiveOutcome*" && ./gradlew spotlessApply ) 2>&1 | tail -10
git -C /Users/liamberger/Documents/private/Artemis add \
    src/main/java/de/tum/cit/aet/artemis/iris/web/IrisMessageResource.java \
    src/test/java/de/tum/cit/aet/artemis/iris/IrisChatMessageIntegrationTest.java
git -C /Users/liamberger/Documents/private/Artemis commit -m "feat(iris): endpoint to record a proactive message outcome (dismissed)"
```

---

### Task 3: Artemis — annotate proactive messages with their outcome in the struggle `chat_history`

**Files:**
- Modify: `src/main/java/de/tum/cit/aet/artemis/iris/service/pyris/PyrisDTOService.java`
- Modify: `src/main/java/de/tum/cit/aet/artemis/iris/service/session/IrisStruggleInterventionService.java`
- Test: `src/test/java/de/tum/cit/aet/artemis/iris/PyrisDTOServiceStruggleChatHistoryTest.java` (new)

**Interfaces:**
- Produces: `PyrisDTOService.toPyrisMessageDTOListForStruggle(List<IrisMessage>)` — like `toPyrisMessageDTOList`, but each proactive (`origin == PROACTIVE_STRUGGLE`) message's first text content is prefixed `(proactive hint, <outcome>) ` (or `(proactive hint) ` while still pending). Built as **fresh `PyrisMessageDTO`s** that preserve `id`/`sentAt`/`sender` and never touch the stored entities. Outcome precedence: `dismissed` (`proactiveOutcome == DISMISSED`) > `engaged` (`helpful != null` OR the next message is a USER message) > `ignored` (a later proactive message exists) > pending.

- [ ] **Step 1: Failing unit test for the annotation**

`PyrisDTOServiceStruggleChatHistoryTest.java` (plain JUnit; the method is pure, so `new PyrisDTOService(null)` is fine — `repositoryService` is unused by this path):
```java
package de.tum.cit.aet.artemis.iris;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.ZonedDateTime;
import java.util.List;

import org.junit.jupiter.api.Test;

import de.tum.cit.aet.artemis.iris.domain.message.IrisMessage;
import de.tum.cit.aet.artemis.iris.domain.message.IrisMessageOrigin;
import de.tum.cit.aet.artemis.iris.domain.message.IrisMessageSender;
import de.tum.cit.aet.artemis.iris.domain.message.IrisProactiveOutcome;
import de.tum.cit.aet.artemis.iris.domain.message.IrisTextMessageContent;
import de.tum.cit.aet.artemis.iris.service.pyris.PyrisDTOService;
import de.tum.cit.aet.artemis.iris.service.pyris.dto.data.PyrisTextMessageContentDTO;

class PyrisDTOServiceStruggleChatHistoryTest {

    private static IrisMessage msg(IrisMessageSender sender, IrisMessageOrigin origin, IrisProactiveOutcome outcome, Boolean helpful, String text) {
        return msg(sender, origin, outcome, helpful, text, ZonedDateTime.now());
    }

    private static IrisMessage msg(IrisMessageSender sender, IrisMessageOrigin origin, IrisProactiveOutcome outcome, Boolean helpful, String text, ZonedDateTime sentAt) {
        var m = new IrisMessage();
        m.setSender(sender);
        m.setOrigin(origin);
        m.setProactiveOutcome(outcome);
        m.setHelpful(helpful);
        m.setSentAt(sentAt);
        m.addContent(new IrisTextMessageContent(text));
        return m;
    }

    private static String firstText(de.tum.cit.aet.artemis.iris.service.pyris.dto.data.PyrisMessageDTO dto) {
        return ((PyrisTextMessageContentDTO) dto.contents().get(0)).textContent();
    }

    @Test
    void annotatesProactiveMessagesByOutcome() {
        var dismissed = msg(IrisMessageSender.LLM, IrisMessageOrigin.PROACTIVE_STRUGGLE, IrisProactiveOutcome.DISMISSED, null, "try edge cases");
        var engaged = msg(IrisMessageSender.LLM, IrisMessageOrigin.PROACTIVE_STRUGGLE, null, null, "check the loop bound");
        var reply = msg(IrisMessageSender.USER, null, null, null, "thanks!");
        var pending = msg(IrisMessageSender.LLM, IrisMessageOrigin.PROACTIVE_STRUGGLE, null, null, "consider null input");
        var normal = msg(IrisMessageSender.LLM, null, null, null, "here is the answer");

        var out = new PyrisDTOService(null).toPyrisMessageDTOListForStruggle(List.of(dismissed, engaged, reply, pending, normal));

        assertThat(firstText(out.get(0))).isEqualTo("(proactive hint, dismissed) try edge cases");
        assertThat(firstText(out.get(1))).isEqualTo("(proactive hint, engaged) check the loop bound");
        assertThat(firstText(out.get(2))).isEqualTo("thanks!");
        assertThat(firstText(out.get(3))).isEqualTo("(proactive hint) consider null input");
        assertThat(firstText(out.get(4))).isEqualTo("here is the answer");
    }

    @Test
    void supersededPendingHintIsMarkedIgnored() {
        var older = msg(IrisMessageSender.LLM, IrisMessageOrigin.PROACTIVE_STRUGGLE, null, null, "first hint");
        var newer = msg(IrisMessageSender.LLM, IrisMessageOrigin.PROACTIVE_STRUGGLE, null, null, "second hint");

        var out = new PyrisDTOService(null).toPyrisMessageDTOListForStruggle(List.of(older, newer));

        assertThat(firstText(out.get(0))).isEqualTo("(proactive hint, ignored) first hint");
        assertThat(firstText(out.get(1))).isEqualTo("(proactive hint) second hint");
    }

    @Test
    void replyOutsideEngagedWindowIsNotEngaged() {
        var base = ZonedDateTime.now();
        var hint = msg(IrisMessageSender.LLM, IrisMessageOrigin.PROACTIVE_STRUGGLE, null, null, "early hint", base);
        var lateReply = msg(IrisMessageSender.USER, null, null, null, "much later", base.plusMinutes(30));

        var out = new PyrisDTOService(null).toPyrisMessageDTOListForStruggle(List.of(hint, lateReply));

        // A reply 30 min later is too late to count as engagement with this hint -> pending, not engaged.
        assertThat(firstText(out.get(0))).isEqualTo("(proactive hint) early hint");
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
( cd /Users/liamberger/Documents/private/Artemis && ./gradlew test --tests "*StruggleChatHistory*" ) 2>&1 | tee /tmp/slice4b_t3.txt | tail -25
```
Expected: FAIL — `toPyrisMessageDTOListForStruggle` does not exist.

- [ ] **Step 3: Implement the struggle conversion (fresh DTOs, never mutate entities)**

In `PyrisDTOService.java`, add below `toPyrisMessageDTOList`:
```java
    /**
     * Like {@link #toPyrisMessageDTOList}, but tags each proactive (origin PROACTIVE_STRUGGLE) message with how
     * the student reacted, so the struggle gate can avoid repeating a dismissed/ignored hint (spec §7.4). Builds
     * fresh DTOs — it never mutates the stored IrisMessage entities — and preserves id/sentAt/sender.
     *
     * @param messages the chat-history messages, in chronological order
     * @return the converted DTOs with proactive messages outcome-tagged
     */
    public List<PyrisMessageDTO> toPyrisMessageDTOListForStruggle(List<IrisMessage> messages) {
        var out = new ArrayList<PyrisMessageDTO>(messages.size());
        for (int i = 0; i < messages.size(); i++) {
            var m = messages.get(i);
            if (m.getOrigin() != IrisMessageOrigin.PROACTIVE_STRUGGLE) {
                out.add(PyrisMessageDTO.of(m));
            }
            else {
                out.add(annotatedProactiveDTO(m, proactiveOutcomeTag(m, messages, i)));
            }
        }
        return out;
    }

    /** A USER reply counts as engagement only if it lands within this window of the hint (spec §7.4; ENG). */
    private static final Duration ENGAGED_REPLY_WINDOW = Duration.ofMinutes(10);

    /** The wire tag for a proactive message based on its persisted outcome and surrounding messages. */
    private static String proactiveOutcomeTag(IrisMessage m, List<IrisMessage> all, int i) {
        if (m.getProactiveOutcome() == IrisProactiveOutcome.DISMISSED) {
            return "(proactive hint, dismissed) ";
        }
        boolean replied = i + 1 < all.size() && all.get(i + 1).getSender() == IrisMessageSender.USER
                && isWithinEngagedWindow(m.getSentAt(), all.get(i + 1).getSentAt());
        if (m.getHelpful() != null || replied) {
            return "(proactive hint, engaged) ";
        }
        boolean superseded = all.subList(i + 1, all.size()).stream().anyMatch(x -> x.getOrigin() == IrisMessageOrigin.PROACTIVE_STRUGGLE);
        return superseded ? "(proactive hint, ignored) " : "(proactive hint) ";
    }

    /** True when the reply follows the hint within {@link #ENGAGED_REPLY_WINDOW} (so a much-later manual
     *  message is not misread as engagement with this hint). */
    private static boolean isWithinEngagedWindow(ZonedDateTime hintAt, ZonedDateTime replyAt) {
        if (hintAt == null || replyAt == null) {
            return false;
        }
        return Duration.between(hintAt, replyAt).abs().compareTo(ENGAGED_REPLY_WINDOW) <= 0;
    }

    /**
     * Build the wire DTO for a proactive message WITHOUT touching the stored entity: same id/sentAt/sender, the
     * first text content prefixed with {@code tag}, every other content mapped verbatim (mirrors PyrisMessageDTO.of).
     */
    private static PyrisMessageDTO annotatedProactiveDTO(IrisMessage m, String tag) {
        boolean[] prefixed = { false };
        var contents = m.getContent().stream().<PyrisMessageContentBaseDTO>map(c -> {
            if (c instanceof IrisTextMessageContent text) {
                String body = (!prefixed[0] ? tag : "") + text.getContentAsString();
                prefixed[0] = true;
                return new PyrisTextMessageContentDTO(body);
            }
            if (c instanceof IrisJsonMessageContent json) {
                return new PyrisJsonMessageContentDTO(json.getContentAsString());
            }
            return null;
        }).filter(Objects::nonNull).toList();
        return new PyrisMessageDTO(m.getId(), toInstant(m.getSentAt()), m.getSender(), contents);
    }
```
Add imports: `java.util.ArrayList`, `java.time.Duration`, `java.time.ZonedDateTime`; `IrisMessageOrigin`, `IrisMessageSender`, `IrisProactiveOutcome`, `IrisTextMessageContent`, `IrisJsonMessageContent` (from `…iris.domain.message`); `PyrisMessageContentBaseDTO`, `PyrisTextMessageContentDTO`, `PyrisJsonMessageContentDTO` (from `…pyris.dto.data`). `IrisMessage`, `PyrisMessageDTO`, `List`, `Objects`, `toInstant` are already imported.

- [ ] **Step 4: Use the struggle conversion in `sendToPyris`**

In `IrisStruggleInterventionService.java` `sendToPyris`, change the `chatHistory` mapping (currently `.map(s -> pyrisDTOService.toPyrisMessageDTOList(s.getMessages()))`):
```java
                .map(s -> pyrisDTOService.toPyrisMessageDTOListForStruggle(s.getMessages())).orElse(List.of());
```

- [ ] **Step 5: Run green + format + commit**

```bash
( cd /Users/liamberger/Documents/private/Artemis && ./gradlew test --tests "*StruggleChatHistory*" && ./gradlew spotlessApply ) 2>&1 | tail -10
git -C /Users/liamberger/Documents/private/Artemis add \
    src/main/java/de/tum/cit/aet/artemis/iris/service/pyris/PyrisDTOService.java \
    src/main/java/de/tum/cit/aet/artemis/iris/service/session/IrisStruggleInterventionService.java \
    src/test/java/de/tum/cit/aet/artemis/iris/PyrisDTOServiceStruggleChatHistoryTest.java
git -C /Users/liamberger/Documents/private/Artemis commit -m "feat(iris): tag proactive messages with their outcome in the gate chat history"
```

---

### Task 4: Webview — proactive bubble Dismiss button + collapsed rendering + store patch

**Files:**
- Modify: `extension/src/webview/views/IrisChat/types.ts`
- Modify: `extension/src/webview/stores/useChatStore.ts`
- Modify: `extension/src/webview/views/IrisChat/components/MessageBubble.tsx`, `MessageBubble.module.css`
- Modify: `extension/src/webview/views/IrisChat/components/ChatMessageList.tsx`
- Test: `extension/test/react/MessageBubble.proactive.test.tsx` (extend), `extension/test/react/useChatStore.proactiveOutcome.test.ts` (new)

**Interfaces:**
- Consumes: existing `isProactive` (`message.origin === 'proactive'`), `styles.proactiveBubble`/`styles.proactiveCaption`, the existing `onFeedback` prop threading through `ChatMessageList`.
- Produces: `ChatMessage.proactiveOutcome?: 'DISMISSED'`; `useChatStore.setProactiveOutcome(messageId, outcome)`; `MessageBubble`'s `onDismiss?: (messageId: number) => void` prop; a `Dismiss` control on un-dismissed proactive bubbles; a dismissed proactive bubble renders **collapsed** (caption + an expand toggle, full body hidden), never unmounted. `ChatMessageList` gains an `onDismiss?` pass-through.

- [ ] **Step 1: Failing tests (render + store)**

In `MessageBubble.proactive.test.tsx`, add cases (mirror the file's existing render/`container` style; the component is rendered directly with a message prop):
```tsx
it('shows a Dismiss control on an un-dismissed proactive bubble', () => {
    const onDismiss = vi.fn();
    render(<MessageBubble message={makeProactive({ id: 7 })} onFeedback={() => {}} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledWith(7);
});

it('renders a dismissed proactive bubble collapsed but keeps the caption (never deleted)', () => {
    const { container } = render(
        <MessageBubble message={makeProactive({ id: 7, proactiveOutcome: 'DISMISSED', content: 'secret body' })} onFeedback={() => {}} />,
    );
    expect(container.textContent).toContain('Iris thought this might help');
    expect(container.textContent).not.toContain('secret body');
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
});
```
(Use the file's existing render helper/imports; add `fireEvent`, `screen`, `vi` to the existing `@testing-library/react`/`vitest` imports if not present, and a small `makeProactive(overrides)` builder that returns a `ChatMessage` with `role: 'assistant'`, `origin: 'proactive'`, `localId`, `timestamp`, merged `overrides`. If the file already builds proactive messages inline, reuse that.)

New `useChatStore.proactiveOutcome.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@webview/stores/useChatStore';

describe('useChatStore.setProactiveOutcome', () => {
    beforeEach(() => {
        useChatStore.setState({ messages: [] });
    });

    it('patches proactiveOutcome on the matching message by id', () => {
        useChatStore.setState({
            messages: [
                { id: 1, localId: 'a', role: 'assistant', content: 'x', timestamp: 0, origin: 'proactive' },
                { id: 2, localId: 'b', role: 'assistant', content: 'y', timestamp: 0, origin: 'proactive' },
            ],
        });
        useChatStore.getState().setProactiveOutcome(2, 'DISMISSED');
        const msgs = useChatStore.getState().messages;
        expect(msgs.find((m) => m.id === 1)?.proactiveOutcome).toBeUndefined();
        expect(msgs.find((m) => m.id === 2)?.proactiveOutcome).toBe('DISMISSED');
    });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/react/MessageBubble.proactive.test.tsx test/react/useChatStore.proactiveOutcome.test.ts ) 2>&1 | tail -25
```
Expected: FAIL (no `onDismiss`, no `setProactiveOutcome`, no collapse).

- [ ] **Step 3: Add the type + store action**

In `types.ts`, add to `ChatMessage` (after `origin`):
```ts
    /**
     * Durable reaction to a proactive message. `'DISMISSED'` means the student
     * collapsed the bubble; the bubble is kept (never deleted, spec §6.3) and
     * re-renders collapsed after a history reload (the server round-trips it on
     * `IrisMessageResponseDTO`).
     */
    proactiveOutcome?: 'DISMISSED';
```
In `useChatStore.ts`, add to the `ChatState` interface (near `addMessage`):
```ts
    /** Patch the proactive outcome on the message with this Artemis id (optimistic collapse). */
    setProactiveOutcome: (messageId: number, outcome: NonNullable<ChatMessage['proactiveOutcome']>) => void;
```
and the implementation (next to `addMessage`):
```ts
            setProactiveOutcome: (messageId, outcome) => {
                set((state) => ({
                    messages: state.messages.map((m) =>
                        m.id === messageId ? { ...m, proactiveOutcome: outcome } : m,
                    ),
                }), false, 'setProactiveOutcome');
            },
```

- [ ] **Step 4: Render the Dismiss button + collapsed form**

In `MessageBubble.tsx`:
- Add `onDismiss?: (messageId: number) => void;` to `MessageBubbleProps`.
- Add a local expand state and derived flags below the existing `isProactive`:
```tsx
    const [expanded, setExpanded] = useState(false);
    const isDismissed = isProactive && message.proactiveOutcome === 'DISMISSED';
```
- Replace the content/feedback region so a dismissed proactive bubble collapses (caption stays; body hidden behind an expand toggle; no Dismiss/feedback while collapsed). Keep the existing `proactiveCaption` div, then:
```tsx
                    {isDismissed && !expanded ? (
                        <button
                            type="button"
                            className={styles.dismissedToggle}
                            onClick={() => setExpanded(true)}
                        >
                            Dismissed — show
                        </button>
                    ) : (
                        <>
                            <div className={styles.content}>
                                <Streamdown mode="static" components={streamdownComponents}>
                                    {message.content}
                                </Streamdown>
                            </div>
                            {isDismissed && expanded && (
                                <button type="button" className={styles.dismissedToggle} onClick={() => setExpanded(false)}>
                                    Hide
                                </button>
                            )}
                        </>
                    )}
                    {isProactive && !isDismissed && message.id !== undefined && onDismiss && (
                        <button
                            type="button"
                            className={styles.dismissButton}
                            onClick={() => onDismiss(message.id as number)}
                            aria-label="Dismiss this suggestion"
                        >
                            Dismiss
                        </button>
                    )}
```
  Keep the existing assistant feedback block, but guard it so a collapsed dismissed bubble shows no thumbs: change its condition from `isAssistant && !isFailed` to `isAssistant && !isFailed && !(isDismissed && !expanded)`.
- Apply the dimmed class on the wrapper bubble when dismissed: add `[styles.proactiveDismissed]: isDismissed` to the `clsx` on the `styles.bubble` div.
- Extend the memo comparator `areEqual` with:
```tsx
        prev.message.proactiveOutcome === next.message.proactiveOutcome &&
        prev.onDismiss === next.onDismiss &&
```

In `MessageBubble.module.css`, add (static camelCase keys):
```css
/* A dismissed proactive card stays visible but recedes (spec §6.3: collapse, never delete). */
.proactiveDismissed {
    opacity: 0.6;
}

.dismissButton,
.dismissedToggle {
    align-self: flex-start;
    margin-top: 6px;
    padding: 2px 8px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    background: transparent;
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 4px;
    cursor: pointer;
}

.dismissButton:hover,
.dismissedToggle:hover {
    color: var(--vscode-foreground);
}
```

In `ChatMessageList.tsx`, add `onDismiss?: (messageId: number) => void;` to `ChatMessageListProps`, accept it in the destructure, and pass `onDismiss={onDismiss}` to `<MessageBubble>`.

- [ ] **Step 5: Run green + type-check + commit**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/react/MessageBubble.proactive.test.tsx test/react/useChatStore.proactiveOutcome.test.ts && npm run check-types ) 2>&1 | tail -20
git -C /Users/liamberger/Documents/private/MA/artemis-extension add \
    extension/src/webview/views/IrisChat/types.ts \
    extension/src/webview/stores/useChatStore.ts \
    extension/src/webview/views/IrisChat/components/MessageBubble.tsx \
    extension/src/webview/views/IrisChat/components/MessageBubble.module.css \
    extension/src/webview/views/IrisChat/components/ChatMessageList.tsx \
    extension/test/react/MessageBubble.proactive.test.tsx \
    extension/test/react/useChatStore.proactiveOutcome.test.ts
git -C /Users/liamberger/Documents/private/MA/artemis-extension commit -m "feat(iris-chat): dismissable proactive bubble (collapse, never delete)"
```

---

### Task 5: Webview — thread origin+outcome end-to-end + command + backoff bridge

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` — `recordChatDismiss()` (reload-safe backoff).
- Modify: `extension/src/shared/messageContracts/webviewCommands.ts`
- Modify: `extension/src/shared/messageContracts/extensionMessages.ts`
- Modify: `extension/src/shared/types/apiResponses.ts`
- Modify: `extension/src/extension/services/iris/chat/irisWebSocketMessageHandler.ts` — forward `proactiveOutcome` on the live `AddMessage` path.
- Modify: `extension/src/webview/views/IrisChat/IrisChatView.tsx`
- Modify: `extension/src/extension/services/iris/chat/chatSessionService.ts`
- Modify: `extension/src/extension/api/artemisApi.ts`
- Modify: `extension/src/extension/provider/chatWebviewProvider.ts`
- Modify: `extension/src/extension/telemetry/contract.ts`, `telemetry/index.ts`, `telemetry/noop.ts`
- Modify: `extension/src/extension.ts`
- Test: `extension/test/logic/struggleIntervention/struggleInterventionService.test.ts` (extend — `recordChatDismiss` backoff)

**Interfaces:**
- Produces: `StruggleInterventionService.recordChatDismiss()` (feeds the Slice-4a backoff **unconditionally**, no `_lastSurface` guard); a `messageProactiveOutcome` webview→extension command `{ sessionId: number; messageId: number; outcome: 'DISMISSED' }`; `origin`/`proactiveOutcome` carried on `addMessage`/`loadMessages` (live + history) and retained into the store; `ArtemisApiService.setProactiveOutcome(...)`; `ChatWebviewProvider.onDidDismissProactive` event; `StruggleEngineHandle.recordProactiveDismiss()` → `orchestrator.recordChatDismiss()`.
- Consumes: `useChatStore.setProactiveOutcome` (Task 4); the Slice-4a backoff counters (`_dismissStrikes`/`_annoyance`/`_softSkipBudget`, `softThreshold`).

The webview-wiring portion is gated by `npm run check-types` plus re-running the Task-4 Vitest suite (the data path is exercised end-to-end by the dev `artemis.forceStruggleIntervention` command); the `recordChatDismiss` portion has its own `test/logic` unit test.

**Why a dedicated `recordChatDismiss` (not `recordOutcome('dismissed')`).** The Slice-4a `recordOutcome` is **guarded on `_lastSurface`**, which is null after a reload/`reset()`. A chat bubble can be dismissed long after its surface was cleared (the dismiss survives reload, §6.3), so routing the chat dismiss through `recordOutcome` would silently no-op the backoff in exactly that case. A chat-bubble dismiss is an explicit, durable action on an identified persisted message (not the stray/lazy callback Slice 4a guarded against), so it bumps the backoff counters directly. The eval-log entry stays best-effort (only when a surface is known).

- [ ] **Step 1: Failing logic test for `recordChatDismiss` (reload-safe backoff)**

In `struggleInterventionService.test.ts` (the Slice-4a deps double already supplies `softThreshold: 3, pauseStrikes: 5`), add:
```ts
it('recordChatDismiss feeds the backoff even with no current surface (reloaded bubble)', () => {
    for (let i = 0; i < 5; i++) { svc.recordChatDismiss(); }   // no surface shown beforehand
    expect(svc.isPaused()).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/logic/struggleIntervention/struggleInterventionService.test.ts ) 2>&1 | tail -25
```
Expected: FAIL — `recordChatDismiss` does not exist.

- [ ] **Step 3: Implement `recordChatDismiss` (mirrors the 4a dismiss bump, no surface guard)**

In `struggleInterventionService.ts`, add next to `recordOutcome`:
```ts
    /**
     * An explicit chat-bubble dismiss (spec §6.3). Unlike {@link recordOutcome}, this is NOT gated on a live
     * surface: a persisted bubble can be dismissed after a reload when `_lastSurface` is already cleared, and the
     * delivery backoff must still register it. Bumps the Slice-4a counters directly; eval-logs best-effort.
     */
    recordChatDismiss(): void {
        this._dismissStrikes += 1;
        this._annoyance += 2;
        if (this._annoyance >= this._deps.softThreshold) {
            this._softSkipBudget += 1;
        }
        if (this._lastSurface) {
            void this._deps.log.record({ ...this._lastSurface, signal: this._lastSurfaceSignal, studentOutcome: 'dismissed' });
        }
    }
```
(`_dismissStrikes`, `_annoyance`, `_softSkipBudget`, `_deps.softThreshold` are the Slice-4a backoff members; `resetSession()` already clears them.)

- [ ] **Step 4: Register the command (3 places in `webviewCommands.ts`)**

Add to `WebviewCmd` (under `// Iris Chat`):
```ts
    MessageProactiveOutcome: 'messageProactiveOutcome',
```
Add to `WebviewCmdPayloads` (under `// Iris Chat`):
```ts
    messageProactiveOutcome: { sessionId: number; messageId: number; outcome: 'DISMISSED' };
```
Add to `COMMANDS_REQUIRING_PAYLOAD`:
```ts
    WebviewCmd.MessageProactiveOutcome,
```

- [ ] **Step 5: Carry the fields on the host→webview contract + the server type + the live mapper**

In `extensionMessages.ts`, add `origin` + `proactiveOutcome` to BOTH the `addMessage.message` and each `loadMessages.messages[]` shape:
```ts
            origin?: 'proactive';
            proactiveOutcome?: 'DISMISSED';
```
(add both lines inside the `addMessage.message` object and inside the `loadMessages.messages` array element type, alongside the existing `helpful?`.)

In `apiResponses.ts`, add to `IrisChatMessage` (it already has an index signature, but declare them for type safety):
```ts
    origin?: string;
    proactiveOutcome?: string;
```

In `irisWebSocketMessageHandler.ts`, the live `AddMessage` mapper already forwards `origin` conditionally (the `...(isProactive ? { origin: 'proactive' as const } : {})` spread, ~line 78). Add `proactiveOutcome` next to it so a websocket-pushed proactive message also carries it (mirror the existing `helpful` bracket-access on `msg`):
```ts
                        ...(isProactive ? { origin: 'proactive' as const } : {}),
                        ...(msg['proactiveOutcome'] === 'DISMISSED' ? { proactiveOutcome: 'DISMISSED' as const } : {})
```
(A freshly pushed proactive message has no outcome yet, so this is usually absent; it keeps the live path consistent with the contract + the history path.)

- [ ] **Step 6: Map the server field + retain it through the webview**

In `chatSessionService.ts` (~line 414, where `origin` is mapped), add to the `formattedMessages` object:
```ts
                    proactiveOutcome: (msg.proactiveOutcome === 'DISMISSED' ? 'DISMISSED' : undefined) as 'DISMISSED' | undefined,
```

In `IrisChatView.tsx`, retain the fields in BOTH handlers. In the `AddMessage` case object (currently ends at `helpful: m.helpful ?? null`):
```ts
                    origin: m.origin,
                    proactiveOutcome: m.proactiveOutcome,
```
and in the `LoadMessages` `messages.map((m) => ({ … }))` object:
```ts
                        origin: m.origin,
                        proactiveOutcome: m.proactiveOutcome,
```
Add a dismiss handler next to `handleFeedback` (~line 269), mirroring its `artemisSessionId` lookup, with an optimistic store patch:
```ts
    const handleDismissProactive = (messageId: number) => {
        const activeSession = store.sessions.find(s => s.id === store.activeSessionId);
        if (typeof activeSession?.artemisSessionId !== 'number') { return; }
        store.setProactiveOutcome(messageId, 'DISMISSED');
        postCommand(vscodeApi, 'messageProactiveOutcome', {
            sessionId: activeSession.artemisSessionId,
            messageId,
            outcome: 'DISMISSED',
        });
    };
```
Pass it to the list: in the `<ChatMessageList … />` props (~line 587) add `onDismiss={handleDismissProactive}`.

- [ ] **Step 7: Add the API client method + provider handler + event**

In `artemisApi.ts`, below `markMessageHelpful`:
```ts
    // Record how the student reacted to a proactive Iris message (spec §7.5).
    async setProactiveOutcome(sessionId: number, messageId: number, outcome: 'DISMISSED'): Promise<void> {
        await this.makeRequest(
            `/api/iris/sessions/${sessionId}/messages/${messageId}/proactive-outcome`,
            {
                method: 'PUT',
                body: JSON.stringify(outcome)
            }
        );
    }
```
In `chatWebviewProvider.ts`:
- Add the event emitter near the other emitters (after `_onDidProvideIrisChatFeedback`):
```ts
    private readonly _onDidDismissProactive = new vscode.EventEmitter<void>();
    /** Fires when the student dismisses a proactive bubble (drives the Slice-4a delivery backoff in extension.ts). */
    public readonly onDidDismissProactive = this._onDidDismissProactive.event;
```
  and push it in the constructor with the other emitters: `this._disposables.push(this._onDidDismissProactive);`
- Add a command case (next to `WebviewCmd.MessageFeedback`):
```ts
                case WebviewCmd.MessageProactiveOutcome: {
                    const { sessionId, messageId } = getPayload<WebCmd<'messageProactiveOutcome'>>(message);
                    void this._handleProactiveOutcome(sessionId, messageId);
                    break;
                }
```
- Add the handler (next to `_handleMessageFeedback`); fire the backoff event before the network call so backoff reflects the student's intent even if the PUT fails:
```ts
    private async _handleProactiveOutcome(sessionId: number, messageId: number): Promise<void> {
        // Signal the dismiss to the delivery backoff first (fire-and-forget), then persist.
        this._onDidDismissProactive.fire();
        if (!this._artemisApiService) {
            logger.warn('Artemis API service not available for proactive outcome', LogCategory.IRIS_CHAT);
            return;
        }
        try {
            await this._artemisApiService.setProactiveOutcome(sessionId, messageId, 'DISMISSED');
        } catch (error) {
            logger.error('Failed to persist proactive outcome', LogCategory.IRIS_CHAT, error);
        }
    }
```
(`getPayload`, `WebCmd`, `WebviewCmd` are already imported for `messageFeedback`.)

- [ ] **Step 8: Bridge across the `@telemetry` seam**

In `telemetry/contract.ts`, add to `StruggleEngineHandle`:
```ts
    /** Record a chat-bubble dismiss into the delivery backoff (Slice 4a). No-op in the clean build. */
    recordProactiveDismiss(): void;
```
In `telemetry/index.ts`, change the full factory's return (currently `return { coordinator, promptConsentIfAsk: () => consent.promptIfAsk() };`) to call the reload-safe `recordChatDismiss` (Step 3), NOT the surface-guarded `recordOutcome`:
```ts
    return {
        coordinator,
        promptConsentIfAsk: () => consent.promptIfAsk(),
        recordProactiveDismiss: () => orchestrator.recordChatDismiss(),
    };
```
In `telemetry/noop.ts`, add to the returned object in `createStruggleEngine`:
```ts
        recordProactiveDismiss: () => { /* no backoff in the clean build */ },
```
In `extension.ts`, destructure the new handle member (the existing line ~79):
```ts
	const { coordinator: struggleCoordinator, promptConsentIfAsk, recordProactiveDismiss } = createStruggleEngine({
```
and, after `chatWebviewProvider` is constructed (~line 193, next to the existing `onDidChangeExerciseContext` wiring), subscribe the bridge:
```ts
	context.subscriptions.push(chatWebviewProvider.onDidDismissProactive(() => recordProactiveDismiss()));
```

- [ ] **Step 9: Type-check + run the logic + webview suites + commit**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npm run check-types \
    && npx vitest run test/logic/struggleIntervention/struggleInterventionService.test.ts test/react/MessageBubble.proactive.test.tsx test/react/useChatStore.proactiveOutcome.test.ts ) 2>&1 | tail -25
git -C /Users/liamberger/Documents/private/MA/artemis-extension add \
    extension/src/extension/services/struggleIntervention/struggleInterventionService.ts \
    extension/test/logic/struggleIntervention/struggleInterventionService.test.ts \
    extension/src/shared/messageContracts/webviewCommands.ts \
    extension/src/shared/messageContracts/extensionMessages.ts \
    extension/src/shared/types/apiResponses.ts \
    extension/src/extension/services/iris/chat/irisWebSocketMessageHandler.ts \
    extension/src/webview/views/IrisChat/IrisChatView.tsx \
    extension/src/extension/services/iris/chat/chatSessionService.ts \
    extension/src/extension/api/artemisApi.ts \
    extension/src/extension/provider/chatWebviewProvider.ts \
    extension/src/extension/telemetry/contract.ts \
    extension/src/extension/telemetry/index.ts \
    extension/src/extension/telemetry/noop.ts \
    extension/src/extension.ts
git -C /Users/liamberger/Documents/private/MA/artemis-extension commit -m "feat(iris-chat): persist proactive dismiss + feed it to the delivery backoff"
```

---

## Self-review checklist

- **Spec coverage:** §7.5 persist dismissed (Tasks 1-2, endpoint mirrors `/helpful`, proactive-only guard); §7.4 per-message outcome tags in `chat_history` (Task 3, precedence dismissed > engaged > ignored > pending); §6.2/§6.3 bubble Dismiss collapses (not deletes) + persists + feeds backoff (Tasks 4-5).
- **CRITICAL-1 fixed (no OPENED):** the enum is `{ DISMISSED }` only; `engaged` is derived from `helpful != null` OR a following USER reply (Task 3). No client OPENED write path is invented.
- **CRITICAL-2 fixed (reaches the client, both paths):** `proactiveOutcome` is added to `IrisMessageResponseDTO` + `of(...)` (REST + websocket both use it), and threaded through the host→webview contract (`extensionMessages.ts`), the server type (`apiResponses.ts`), the history mapping (`chatSessionService.ts`), the **live websocket mapper** (`irisWebSocketMessageHandler.ts`, next to its existing `origin` spread), and both `IrisChatView` handlers into the store. This **also repairs the `origin` threading** that `HEAD` drops at the webview boundary (so the Slice-2 restyle becomes live).
- **codex r2 — live-path gap fixed:** the websocket `AddMessage` mapper forwards `proactiveOutcome` (it already forwarded `origin`), so the contract claim holds on both the live and history paths.
- **codex r2 — reload-safe backoff:** the chat dismiss bridges to a dedicated `recordChatDismiss()` that bumps the Slice-4a counters **without** the `_lastSurface` guard, so a dismiss of a bubble reloaded after `reset()`/reopen still feeds the backoff (the surface-guarded `recordOutcome` would have no-op'd that case). Covered by a `test/logic` unit test.
- **codex r2 — engaged time-bound:** a following USER message counts as `engaged` only within `ENGAGED_REPLY_WINDOW` (10 min, ENG) of the hint's `sentAt`, so a much-later manual message is not misread as engagement (Task 3, with a window unit test).
- **CRITICAL-3 fixed (no entity mutation):** the chat-history annotation builds fresh `PyrisMessageDTO`s (preserving `id`/`sentAt`/`sender`, prefixing the first text content), never calling `addContent`/`setId` on stored entities.
- **IMPORTANT — endpoint guard:** rejects any message that is not `sender == LLM && origin == PROACTIVE_STRUGGLE` (Task 2, negative test included).
- **IMPORTANT — test target:** the endpoint test lives in `IrisChatMessageIntegrationTest` (with `createSessionForUser`/`helpfulUrl`/`saveMessage`), not `IrisMessageIntegrationTest`.
- **IMPORTANT — command path complete:** `messageProactiveOutcome` is added to all three `webviewCommands.ts` spots (enum, payload, `COMMANDS_REQUIRING_PAYLOAD`).
- **IMPORTANT — immediate collapse:** `useChatStore.setProactiveOutcome` patches optimistically on dismiss; the `MessageBubble` memo comparator includes `proactiveOutcome` + `onDismiss`, so the collapse re-renders without a reload.
- **IMPORTANT — seam-safe bridge:** the dismiss crosses `@telemetry` via `StruggleEngineHandle.recordProactiveDismiss` (full factory → `orchestrator.recordChatDismiss()`; no-op in the clean build), wired in `extension.ts` (correct path `extension/src/extension.ts`) through the provider's `onDidDismissProactive` event — `extension.ts` never imports `struggleIntervention/`.
- **Backoff consistency (Slice 4a):** the toast/inline Dismiss feed `recordOutcome('dismissed')` (live-surface only); the chat-bubble Dismiss feeds `recordChatDismiss()` (reload-safe). Both increment the same `_dismissStrikes`/`_annoyance`/`_softSkipBudget` and clear together on `recordOutcome('clicked')` / `resetSession()`, so all three reject surfaces drive one per-exercise backoff.
- **No delete (§6.3):** Dismiss collapses + records; the persisted message is never removed; it re-renders collapsed on reload from `proactiveOutcome === 'DISMISSED'`.
- **No Pyris change (ENG):** outcomes are a text annotation Artemis prepends; the gate already reads `chat_history` text.
- **Mirrors existing patterns:** endpoint = `rateMessage`; changelog = the `origin` changeset (mysql/h2 ENUM + postgres text, preConditions, author `liam-berger`); webview command = `messageFeedback`; client method = `markMessageHelpful`; provider event = `onDidProvideIrisChatFeedback`.
- **Placeholder scan:** every step shows the actual code or mirrors a named existing method; test fixtures/helpers referenced by verified name.
