# Proactive Intervention — Slice 2: Chat surface (B-card restyle + sidebar reachability) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the proactive chat message that Slice 1 persists (a) **look right** (the §6.2 tinted B-card with the humble caption, no left "AI line", no logo) and (b) **be listed** in the chat sidebar even when the session has no USER message yet, so a student who never typed manually can still find and open Iris's persisted nudge.

**Scope of THIS slice.** Pure rendering + listing of the already-persisted message: a webview CSS/copy change and one Artemis sidebar-overview query relaxation. It does **not** add the lamp→exact-session navigation, the friendly sidebar *label* for proactive-only sessions, the Dismiss button, the two-button toast, or inline (all later — see "Deferred").

**Architecture:** Two independent, independently-testable changes. Client: restyle the existing `proactiveBubble` (remove the `border-left` line, add a faint tinted card) and change the caption copy. Artemis: relax the `findByCourseIdAndUserId` sidebar query so a session whose only messages are `PROACTIVE_STRUGGLE` LLM messages is still listed (today it requires a `USER`-sender message).

**Tech Stack:** Extension client (TypeScript + React, Vitest `test/react/**`, CSS Modules). Artemis backend (Java 21, Spring Boot, JPQL, integration test via the REST overview endpoint).

This is **Slice 2 of the proactive-intervention spec** (`docs/superpowers/specs/2026-06-26-proactive-intervention-surfaces-design.md`, §6.2, §7.3). Depends on Slice 1 (ambient persisted with origin `PROACTIVE_STRUGGLE`).

## Global Constraints

- **Branch:** `feat/struggle-v3-integration`. Not `dev`/`main`.
- **Commit messages:** Conventional Commits. **No AI attribution** (no `Co-Authored-By`, no `🤖`, no "Generated with"). Overrides any default trailer.
- **Staging:** only the exact files each task changed. Never `git add -A`/`.`.
- **Client verification:** targeted Vitest green AND `npm run check-types`.
- **Artemis verification:** the integration test class green AND `./gradlew spotlessApply`.
- **CSS Modules are camelCase-only in the prod esbuild bundle:** use static `styles.proactiveBubble`/`styles.proactiveCaption` lookups (already the case); never dynamic kebab lookups.
- **Invariants:** Desktop = Cookie auth, Theia = Bearer (untouched). No `^`/`~` added to any `package.json`.

## Deferred to later slices (documented so the slice goal is honest)

- **Friendly sidebar label for proactive-only sessions.** The overview import derives preview text from the first `USER` message; a proactive-only session therefore shows the generic `"New conversation"` (`sessionSyncUtils.ts:104`). After this slice the session is **listed and openable** (with the restyled bubble inside), but its sidebar label is generic. A title/preview rule (use the proactive hint as the preview) is folded into the lamp-navigation slice (Slice 4), since both touch the proactive-session presentation path.
- **Lamp → exact session navigation.** Today the lamp click focuses the chat (`interventionService.ts:77`); opening *this* `sessionId` + scrolling to `messageId` needs `sessionId`/`messageId` threaded `struggleEventSubscription` → `telemetry/index.ts:110` → `onServerAmbient` → lamp, which overlaps with Slice 4 click-outcome plumbing.
- **Dismiss button, two-button toast, ✕** — Slice 4. **Inline (anchor/inlineHint)** — Slice 3.

---

## File structure

- **Extension**
  - Modify: `extension/src/webview/views/IrisChat/components/MessageBubble.module.css` — restyle `.proactiveBubble` (card, not line).
  - Modify: `extension/src/webview/views/IrisChat/components/MessageBubble.tsx` — caption copy (~line 73).
  - Modify (test): `extension/test/react/MessageBubble.proactive.test.tsx` — add a caption assertion.
- **Artemis**
  - Modify: `src/main/java/de/tum/cit/aet/artemis/iris/repository/IrisChatSessionRepository.java` — relax the overview `WHERE` clause (~line 62).
  - Modify (test): `src/test/java/de/tum/cit/aet/artemis/iris/IrisChatSessionResourceTest.java` — proactive-only session appears in the overview.
- **Extension (stale comments)**
  - Modify: `extension/src/extension/provider/chatWebviewProvider.ts:454` and `extension/src/extension/services/iris/chat/chatSessionService.ts:556` — drop/adjust comments claiming proactive sessions are omitted from `sessions/overview`.

---

### Task 1: Restyle the proactive bubble (B-card) + change the caption copy

**Files:**
- Modify: `extension/src/webview/views/IrisChat/components/MessageBubble.module.css`
- Modify: `extension/src/webview/views/IrisChat/components/MessageBubble.tsx`
- Test: `extension/test/react/MessageBubble.proactive.test.tsx`

**Interfaces:**
- Consumes: the existing `isProactive` flag, `styles.proactiveBubble`/`styles.proactiveCaption` (names unchanged), `data-origin="proactive"` on the bubble (`MessageBubble.tsx:69`).
- Produces: a tinted-card proactive bubble (no left border) with caption text exactly `Iris thought this might help`.

- [ ] **Step 1: Add a caption assertion to the proactive React test**

The current test (`MessageBubble.proactive.test.tsx`) only checks the `data-origin` marker and destructures `container` from `render`. **Add** a caption assertion to the existing `it(...)` (no new import needed — assert on `container.textContent`):
```tsx
expect(container.textContent).toContain('Iris thought this might help');
```

- [ ] **Step 2: Run the test to verify it fails**

Run (cwd `/Users/liamberger/Documents/private/MA/artemis-extension/extension`):
```bash
npx vitest run test/react/MessageBubble.proactive.test.tsx 2>&1 | tail -25
```
Expected: FAIL — the rendered caption is still "Iris noticed you might be stuck".

- [ ] **Step 3: Change the caption copy**

In `MessageBubble.tsx`, replace the caption text (the `styles.proactiveCaption` div, ~line 73):
```tsx
                        <div className={styles.proactiveCaption}>
                            Iris thought this might help
                        </div>
```

- [ ] **Step 4: Restyle the card (remove the line, add a tint)**

In `MessageBubble.module.css`, replace the `.proactiveBubble` rule (currently `border-left` + `padding-left`) with a tinted card; keep `.proactiveCaption` as-is:
```css
/* Proactive (struggle-intervention) assistant messages read as a distinct, unprompted
   card — a faint tint + rounded corners set them apart from the transparent normal
   replies, without the old left "AI line" or a logo (spec §6.2). */
.proactiveBubble {
    background-color: color-mix(in srgb, var(--vscode-charts-blue) 9%, transparent);
    border-radius: 10px;
    padding: 10px 12px;
}
```
NOTE: `color-mix` is supported in the VS Code (Chromium) webview at the declared engine floor (`engines.vscode` `^1.97.0`). If you prefer no `color-mix`, the fallback `background-color: rgba(31, 156, 240, 0.09);` (charts-blue ≈ `#1f9cf0`) is equivalent. Keep lookups static (`styles.proactiveBubble`).

- [ ] **Step 5: Run the test + type-check**

Run (cwd `extension`):
```bash
npx vitest run test/react/MessageBubble.proactive.test.tsx 2>&1 | tail -20
npm run check-types 2>&1 | tail -15
```
Expected: PASS; `check-types` clean.

- [ ] **Step 6: Commit**

```bash
git add extension/src/webview/views/IrisChat/components/MessageBubble.module.css \
        extension/src/webview/views/IrisChat/components/MessageBubble.tsx \
        extension/test/react/MessageBubble.proactive.test.tsx
git commit -m "feat(iris-chat): restyle proactive bubble as a tinted card with the 'thought this might help' caption"
```

---

### Task 2: List proactive-only sessions in the chat sidebar overview

**Files:**
- Modify: `src/main/java/de/tum/cit/aet/artemis/iris/repository/IrisChatSessionRepository.java`
- Test: `src/test/java/de/tum/cit/aet/artemis/iris/IrisChatSessionResourceTest.java`
- Modify: `extension/src/extension/provider/chatWebviewProvider.ts`, `extension/src/extension/services/iris/chat/chatSessionService.ts` (stale comments)

**Interfaces:**
- Consumes: the existing overview JPQL `findByCourseIdAndUserId(courseId, userId)` → `List<IrisChatSessionDAO>`, exposed via the REST overview endpoint as `List<IrisChatSessionDTO>` (the test class already calls `request.getList(overviewUrl(), HttpStatus.OK, IrisChatSessionDTO.class)`).
- Produces: the overview now also lists sessions whose only messages are `PROACTIVE_STRUGGLE` LLM messages.

- [ ] **Step 1: Add the failing integration test**

In `IrisChatSessionResourceTest.java`, add (and add imports for `IrisMessage`, `IrisTextMessageContent`, `IrisMessageOrigin`, `IrisMessageSender` if absent). Build a programming-exercise session with **only** a proactive LLM message via the existing factory + `saveChatSessionWithMessages` helper:
```java
@Test
@WithMockUser(username = TEST_PREFIX + "student1", roles = "USER")
void overview_listsProactiveOnlySession() throws Exception {
    User user = userUtilService.getUserByLogin(TEST_PREFIX + "student1");
    var session = IrisChatSessionFactory.createProgrammingExerciseChatSessionForUser(programmingExercise, user); // no messages
    var msg = new IrisMessage();
    msg.addContent(new IrisTextMessageContent("Have you considered the empty input?"));
    msg.setOrigin(IrisMessageOrigin.PROACTIVE_STRUGGLE);
    msg.setSender(IrisMessageSender.LLM);
    msg.setSession(session);
    session.getMessages().add(msg);
    saveChatSessionWithMessages(session);

    List<IrisChatSessionDTO> result = request.getList(overviewUrl(), HttpStatus.OK, IrisChatSessionDTO.class);

    assertThat(findByEntityId(result, programmingExercise.getId()).id()).isEqualTo(session.getId());
}
```
NOTE: `createProgrammingExerciseChatSessionForUser(...)` (the no-messages variant) and `saveChatSessionWithMessages(session)` (= `irisSessionRepository.save` + `irisMessageRepository.saveAll(session.getMessages())`) already exist in this class/its factory; `findByEntityId(result, id)` is the existing private finder; the returned `IrisChatSessionDTO` exposes the session id as `.id()`. `IrisMessage.setSender/setOrigin/addContent/setSession` all exist.

- [ ] **Step 2: Run the test to verify it fails**

Run (cwd `/Users/liamberger/Documents/private/Artemis`):
```bash
./gradlew test --tests "de.tum.cit.aet.artemis.iris.IrisChatSessionResourceTest.overview_listsProactiveOnlySession" 2>&1 | tee /tmp/slice2_t2.txt | tail -25
```
Expected: FAIL — the proactive-only session is filtered out by `m.sender = USER`.

- [ ] **Step 3: Relax the overview `WHERE` clause**

In `IrisChatSessionRepository.java` `findByCourseIdAndUserId` JPQL, change the message-sender filter to also accept proactive LLM messages:
```jpql
                WHERE s.userId = :userId
                    AND s.courseId = :courseId
                    AND (m.sender = de.tum.cit.aet.artemis.iris.domain.message.IrisMessageSender.USER
                         OR m.origin = de.tum.cit.aet.artemis.iris.domain.message.IrisMessageOrigin.PROACTIVE_STRUGGLE)
                GROUP BY s, s.entityId, s.chatMode, e.shortName, l.title
                HAVING COUNT(m) > 0
```
Leave `GROUP BY s ... HAVING COUNT(m) > 0 ORDER BY MAX(m.sentAt) DESC` intact (one row per session; `m.origin` is a real JPQL field already queried elsewhere in the codebase).

- [ ] **Step 4: Update the now-stale client comments**

In `chatWebviewProvider.ts` (~line 454) and `chatSessionService.ts` (~line 556), the comments state proactive sessions are omitted from `sessions/overview`. After this change they are listed; adjust those comments to say the overview now includes proactive-only sessions (the local `openProactiveSession` injection is still used for the immediate active open, but is no longer the *only* way the session becomes known).

- [ ] **Step 5: Run the new test + the whole overview test class + format**

Run (cwd Artemis):
```bash
./gradlew test --tests "de.tum.cit.aet.artemis.iris.IrisChatSessionResourceTest" 2>&1 | tee /tmp/slice2_t2.txt | tail -25
./gradlew spotlessApply 2>&1 | tail -3
```
Expected: BUILD SUCCESSFUL — new test passes; the existing `overview_returnsEmptyWhenNoSessionsWithMessages` and `overview_returnsAllSessionsWithMessagesAndExposesTitleAndEntityName` still pass (a normal USER session is listed once; `GROUP BY s` + `HAVING COUNT(m) > 0` keep one row).

- [ ] **Step 6: Commit**

The two changes live in **two different git repos**, so commit each from its own repo root.

Artemis repo (cwd `/Users/liamberger/Documents/private/Artemis`):
```bash
git add src/main/java/de/tum/cit/aet/artemis/iris/repository/IrisChatSessionRepository.java \
        src/test/java/de/tum/cit/aet/artemis/iris/IrisChatSessionResourceTest.java
git commit -m "feat(iris): list proactive-only sessions in the chat sidebar overview"
```
Extension repo (cwd `/Users/liamberger/Documents/private/MA/artemis-extension`):
```bash
git add extension/src/extension/provider/chatWebviewProvider.ts \
        extension/src/extension/services/iris/chat/chatSessionService.ts
git commit -m "docs(iris-chat): proactive sessions now appear in the overview (comment fix)"
```

---

## Self-review checklist

- **Spec coverage:** §6.2 bubble restyle (Task 1: tinted card, no line/logo, "thought this might help"); §7.3 visibility-A listing (Task 2: proactive-only sessions appear in the sidebar).
- **Independent + testable:** Task 1 = webview render (Vitest react, asserts caption text); Task 2 = JPQL change verified via the REST overview endpoint with the class's real fixtures (`userUtilService.getUserByLogin`, `IrisChatSessionFactory`, `saveChatSessionWithMessages`, `request.getList(overviewUrl(), ...)`, `findByEntityId`).
- **No regression in the shared query:** the relaxation is additive (`OR origin = PROACTIVE_STRUGGLE`); `GROUP BY s` + `HAVING COUNT(m) > 0` keep one row per session, so normal USER sessions and other chat modes are unaffected (re-run the two existing overview tests to confirm).
- **Ordering claim kept honest:** the JPQL orders by `MAX(m.sentAt)`, but the client re-sorts imported sessions by `creationDate` (`sessionSyncUtils.ts:89`) — so this slice does not claim end-to-end "latest-activity" ordering; it only claims the proactive session is *listed*.
- **Discoverability scope is honest:** the session is listed + openable with the restyled bubble; the friendly sidebar *label* (vs generic "New conversation") is explicitly deferred (Slice 4), not silently assumed.
- **Stale comments fixed:** the two client comments claiming overview omits proactive sessions are updated (Task 2 Step 4).
- **CSS prod-safety:** static camelCase `styles.*`; `color-mix` with a documented `rgba` fallback.
- **Placeholder scan:** test bodies use the host classes' real fixtures/helpers by name (verified to exist); every code change shows exact code.
