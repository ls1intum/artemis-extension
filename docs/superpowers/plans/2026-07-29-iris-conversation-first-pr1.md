# Iris Conversation-First Chat Model - Implementation Plan (PR 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the extension's context-first Iris chat model (a context owns conversations) with Artemis's conversation-first model (a conversation has a mutable context), so the extension works against production Artemis again (#373).

**Architecture:** One open conversation at a time, identified by an Artemis session id. Its topic (`mode` + `entityId`) is server truth, staged locally as `pendingContext` and committed only by a server response or a `CTXSWAP` websocket frame. A conversation that has content is never rehomed: topic changes on a non-empty conversation navigate to another conversation instead of moving this one. All local session storage is deleted; the server's overview plus a `knownInvisible` cache of sessions the overview does not list is the only index, and every index hit is revalidated against the detail `GET`.

**Tech Stack:** TypeScript, VS Code extension host + React webview, esbuild, STOMP over SockJS, mocha via `@vscode/test-cli` (`test/unit`), vitest (`test/logic`, `test/react`).

**Spec:** `docs/superpowers/specs/2026-07-28-iris-conversation-first-design.md` (v5). Section references below (§n) point into it. Read §3, §4 and §7 before starting Task 3.

**Branch:** `feat/iris-conversation-first`, off `dev` (`5ec22370`). Worktree: `MA/claudeworktrees/artemis-extension-convfirst`. All paths below are relative to `extension/`.

---

## Accepted simplifications (normative)

Added 2026-07-30 after a scope review, codex-signed. **This section outranks any code example further down that still shows a removed mechanism.** If a task body and this list disagree, this list wins and the task body is stale.

The rewrite itself is proportionate: the create endpoint the extension calls no longer exists, so 940 installations are broken against production (#373). What was disproportionate was PR 1's polish and its concurrency defence. Seven mechanisms are cut.

| # | Cut | What replaces it | What we give up |
|---|---|---|---|
| 1 | Per-entry effect labels in the picker, and any webview use of `resolveTopic` | One **static** hint in the picker while `contentState === 'content'`: "Die Auswahl oeffnet gegebenenfalls eine andere Unterhaltung." | The picker no longer predicts per entry whether a click stages, opens or creates. |
| 2 | Undo, `savedPending`, the cross-course notice payload and its restoration rules | A minimal **actionless** notice after a navigation the student did not expect: "Zu einer anderen Unterhaltung gewechselt." (and "Neue Unterhaltung gestartet." when one was created, if that costs no extra plumbing) | No way back with one click. The permanent CTXSWAP row and the chip still show server truth. Undo returns in PR 2, where unsolicited proactive navigation makes recovery matter. |
| 3 | `MAX_KNOWN_INVISIBLE`, the eviction algorithm, its ordering and its tie-break | A plain unbounded `Map`, still per course, still cleared on course change | A long-lived process can hold more summaries than it needs. Nothing is lost; the map dies on restart anyway. |
| 4 | The revalidation **loop** and `alreadyTried` | Revalidate the **newest** hit **once**. On a mismatch, record what the `GET` actually returned and create a fresh conversation. | A second, older, still-valid conversation for that topic is not found, so we may create a duplicate. We can still never open the wrong topic and never rehome content. |
| 5 | The dashed transcript preview line | Nothing. The chip shows `pending ?? committed`. | Staged and committed are less distinguishable, which is exactly Artemis's own limitation. |
| 6 | `_arrivalStamps` and the deletion-aware causal merge | **Monotonic union by server message id**: a same-session install unions the response with what is already known and never removes. | A message deleted on the server survives locally until a restart. That error is conservative: it can make an empty conversation look non-empty (we then create a duplicate instead of staging), never the reverse. PR 2 owns deletion semantics. |
| 7 | `_locallyUpdated` and the request-scoped overview overlay | The current conversation's row is derived from the **loaded detail**, for the canonical summary collection that both the history and `findSessionFor` read, not merely for rendering. `refreshOverview` keeps its per-course single-flight and its latest-request-wins check. | A late overview can briefly show a stale topic or title for a **non-current** conversation. It cannot contradict the open one. |

**Explicitly NOT cut, after challenge.** An earlier proposal replaced `sendSeq` and `loadTicket` with a set of exclusion rules. It was rejected: that moves the problem instead of removing it, trading two explicit counters in one class for six unwritten invariants distributed across `ConversationState`, `IrisConversationService`, `SendCoordinator`, reload and reconnect, whose failure mode is silent. `loadTicket`, `sendSeq`, `contextRevision` and the navigation generation stay **exactly as written**. Revisit only once the real implementation exposes the actual concurrency graph.

Two ordering regressions must therefore keep their tests:

- a lower-ticket same-session load cannot overwrite a later installed load;
- a load begun before a completed send cannot install afterwards, because `sendSeq` moved.

And from cut 6, keep one test proving that a websocket message arriving **during** a detail `GET` survives the monotonic union.

Also fixed in the same pass: `topicResolution.ts` stays **host-only** (cut 1 removes its only webview consumer, so it needs no `@shared` relocation); `refreshOverview` catches internally; `SendCoordinator.send` takes the full `SendInput`; Task 8's `serviceWith` harness is written out.

## Contract ledger (protected)

These are facts about Artemis `main` (`553aab7595`), not design choices. **Nothing in this plan may be simplified in a way that contradicts them**, and they must survive any future pruning verbatim.

1. `POST /api/iris/chat/sessions/current?mode&entityId` returns a **full session detail**. An exercise acquisition returns the latest session whose *current* entity matches, else it falls back to an empty course session.
2. `POST /api/iris/chat/sessions?courseId` creates, or reuses today's course session **only while that session is empty**.
3. A detail response carries **no `courseId`**. The requesting operation supplies it.
4. `@JsonInclude(NON_EMPTY)` means `messages` is **absent**, not `[]`, on an empty session.
5. `hasContent` counts **every** persisted sender: `USER`, `LLM`, `ARTIFACT` and `CTXSWAP`, plus an optimistic bubble. `unknown` is never `empty`.
6. `applyContextChange` persists the CTXSWAP marker **before** the user message, pushes it over the websocket **while our POST is still open**, and does **not** re-check emptiness. A marker-only conversation is reachable.
7. Artemis repoints sessions **by itself** on build failure (`onBuildFailure`) and stalled progress (`onNewResult`). CTXSWAP is not only a reaction to this client.
8. CTXSWAP attributes live **inside a `json` content item**, arrive as an **object** (not a string), use **lower-case** transitions, may omit `name` on any transition, and omit all entity fields for `removed`.
9. The overview lists only sessions with a **USER** message. Fresh and proactive-only conversations are invisible, and `lastActivityDate` is USER-derived.
10. `IrisChatWebsocketDTO` carries **no session id**. The subscribed id must be threaded through, and an old-session frame must be dropped **before** it can touch run state or conversation state.
11. `messageDifferentiator` is `@Transient`. There is no durable correlation and no safe automatic resend after an ambiguous POST failure.
12. Reconnect **subscribes before** reconciling, and reconciles through the **full detail**, not just messages.
13. A conversation that has content is **never rehomed**.

---

## Global Constraints

- **No carets or tildes in `package.json`.** Dependencies are pinned exactly. Only `engines.vscode` keeps `^`.
- **No AI attribution** in commit messages, code comments, PR bodies or any user-visible string.
- **Mocha under `test/unit/`, vitest under `test/logic/` and `test/react/`.** Do not mix. `test/unit` runs in a real VS Code host and may import `vscode`; `test/logic` and `test/react` must not.
- **`knip` treats `test/**` as an entry point.** Every deletion of a source file must delete its tests in the same commit, or `npm run knip` reports the orphan.
- **Server facts come from Artemis `main` (`553aab7595`) only.** Never from a locally checked-out Artemis feature branch.
- **`ServerContext.mode` is the full `IrisChatMode` union** (`PROGRAMMING_EXERCISE_CHAT | TEXT_EXERCISE_CHAT | COURSE_CHAT | LECTURE_CHAT`) plus unknown strings preserved verbatim. The picker restricts what may be *selected*; the transport must represent everything the server may *say*. An unrecognised mode never throws.
- **Ordering key everywhere:** `lastActivityDate ?? creationDate`. The overview omits `lastActivityDate` when a session has no USER message.
- **Every commit must pass** `npm run check-types && npm run lint && npm run test:unit && npm run test:react`.
- **German user-facing strings.** The existing Iris webview strings are German; keep that. Log messages stay English.
- **No em dashes in any string, comment or doc this plan produces.**

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/shared/types/serverContext.ts` | `ServerContext`, `SessionSummary`, `SessionDetail`, `ContextSwapTransition`. The shared vocabulary of the new model. |
| `src/extension/services/iris/context/contextMarkers.ts` | Decode a `CTXSWAP` message into `{transition, mode, entityId, name}`; render its label. |
| `src/extension/services/iris/conversation/conversationState.ts` | Pure state container: current session, detail, committed/pending context, per-session epochs, `knownInvisible`. No I/O. |
| `src/extension/services/iris/conversation/topicResolution.ts` | Pure decision function for §4's resolution table. Returns a `TopicDecision`, performs no requests. **Host-only**: the webview must not import it (`eslint.config.mjs` bans `@extension/*` from `src/webview/**`), which is why cut 1 removed its only webview consumer. |
| `src/extension/services/iris/conversation/conversationService.ts` | Executes decisions: acquisition, navigation, single revalidation, overview refresh, guard matrix. The only place that calls the chat API. |
| `src/extension/services/iris/conversation/sendCoordinator.ts` | One in-flight send, the send/navigation mutex, `pendingContext` on the wire, ambiguous-failure reconciliation. |
| `src/webview/views/IrisChat/components/ContextChip.tsx` + `.module.css` | The composer topic chip (§5.2). |
| `src/webview/views/IrisChat/components/ContextSwapRow.tsx` + `.module.css` | The transcript `CTXSWAP` line (§5.6). The dashed preview line is **cut 5**. |
| `src/webview/views/IrisChat/components/ChatNotice.tsx` + `.module.css` | The 10 s muted notice above the composer (§5.6), **actionless** per cut 2. |
| `src/webview/views/IrisChat/components/CoursePicker.tsx` + `.module.css` | The course list behind header line 1 (§5.5). |

### Deleted files

| Path | Lines | Why |
|---|---|---|
| `src/extension/services/iris/context/sessionManager.ts` | 334 | The per-context session index, rehoming, empty-session cleanup. |
| `src/extension/services/iris/context/sessionSyncUtils.ts` | 146 | Imports server sessions by filtering on their mutable context. `IrisServiceDeps` moves to `conversation/deps.ts` (Task 5). |
| `src/extension/services/iris/context/contextSnapshot.ts` | - | Builds the per-context bucket and the local active session. |
| `test/unit/services/iris/context/sessionManager.test.ts` | - | Tests a deleted file. |
| `test/unit/services/iris/context/sessionSyncUtils.test.ts` | - | Tests a deleted file. |

### Substantially rewritten

`api/artemisApi.ts` (chat section), `services/iris/chat/chatSessionService.ts`, `services/iris/chat/chatMessageService.ts`, `services/iris/chat/chatContextManager.ts`, `services/iris/chat/irisWebSocketMessageHandler.ts`, `services/iris/transport/irisWebSocketSessionClient.ts`, `services/iris/context/contextStore.ts`, `services/iris/context/contextPersistence.ts`, `services/iris/context/contextStateTypes.ts`, `services/iris/context/courseHistory.ts`, `provider/chatWebviewProvider.ts`, `provider/chatViewStatePresenter.ts`, `provider/chatReloadDecision.ts`, `provider/baseWebviewProvider.ts`, `shared/messageContracts/*`, `shared/types/context.ts`, `webview/stores/useChatStore.ts`, all `webview/views/IrisChat/components/*`.

---

## Why this plan stops being reviewed and starts being built

This plan was reviewed by codex six times. The findings per round were 8, 6, 6, 6, 6 and 3 architectural, and a large share of rounds 3 to 5 were defects introduced **while fixing the previous round**: a guard dropped from an install, an epoch comparison off by one, a method called with a signature changed three paragraphs earlier. Every finding was legitimate, and two of them would have silently lost a student's conversation in production. The reviewer was not the problem.

The problem is the medium. Past a certain density this document contains real code with real invariants, written with no compiler and no test runner. That produces exactly the class of defect a compiler settles in seconds and a reviewer needs twenty minutes to find by reading. Round 6 made the split explicit: three defects that prose review had to settle because they fix API shape and state ownership, and ten that a `check-types` run would have caught first.

So the rule from here: **the design is settled, the mechanics are not, and the mechanics get settled by building.** Implement Task 1, run the full gate, and let the compiler answer what it is better at answering than any reader. Bring codex back for a design question, or for a review of the finished diff. Do not bring it another draft of this file.

---

## Commit boundaries: additive first, delete last

Every task ends in a commit that type-checks and passes the full suite. That is only achievable if **nothing is deleted while a consumer of it still exists**. A rewrite of this size fails that rule by default, so the order is explicit:

1. **Tasks 1 to 8 are additive on the host side.** They add new types, a new service, a new coordinator and new websocket plumbing. The old `ActiveContext`, the old session store, `sessionManager`, `sessionSyncUtils` and the old contracts all remain and keep compiling. The only exception is Task 1's signature change on `getCurrentChat`, which is why Task 1 also migrates its two source callers and the six existing test call sites in the same commit.
2. **Tasks 9 to 12 add the new state surface, the new wire contracts, the new store fields and the new components alongside the old ones.** `updateIrisState` gains the new payload as additional fields rather than replacing them; `contextStore` gains `getWorkspaceExercise` / `getCurrentCourseId` while `getActiveContext` still exists. Nothing that has a consumer is removed.
3. **Task 14 is the cut-over.** The provider stops routing through the old path, the commands move to `resolveTopicChange`, and the struggle emitter is decoupled. After this commit the old surface has no consumers.
4. **Task 15 deletes.** `ActiveContext`, `StoredSession`, the old contract fields, `sessionManager`, `sessionSyncUtils`, `contextSnapshot`, the reduced `chatSessionService`, and the persistence bump to v3 (which is only safe once nothing reads `activeContext` any more). `knip` proves nothing was left behind.

Two consequences the implementer must respect:

- **A field is only deleted in Task 15.** If a step in Tasks 9 to 12 tempts you to remove `localSessionId` or `context` from a contract, add the new field next to it instead and delete in 15. A "cleaner" intermediate commit that does not compile is worth less than a boring one that does.
- **Every task runs the full gate before its commit**, not only the suite it touched. Individual steps name a focused `--grep` or a single test file for the fast red-green loop; the commit step then runs `npm run check-types && npm run lint && npm run test:unit && npm run test:react`. A targeted run proves the new behaviour; only the full gate proves the commit is green, and this rewrite breaks distant suites constantly.
- **The two models coexist for four commits.** That is deliberate. It is the price of every commit being independently reviewable and revertable, and it is far cheaper than a six-commit stretch where only the last one builds.

---

## Task 1: API layer speaks the new endpoints

**Files:**
- Create: `src/shared/types/serverContext.ts`
- Modify: `src/shared/types/apiResponses.ts` (widen `IrisChatMessage.sender`)
- Modify: `src/extension/api/artemisApi.ts:489-591`
- Test: `test/unit/api/artemisApi.test.ts` (extend, and **migrate its six existing call sites**: `:763`, `:777`, `:792`, `:820`, `:827`, `:832` still call the old signatures and would not compile)

**Interfaces:**
- Consumes: nothing.
- Produces: `ServerContext`, `SessionSummary`, `SessionDetail`, `IrisMessageSender`; `ArtemisApiService.getCurrentChat`, `.createCourseSession`, `.getChatSessionById`, `.listChatSessionsForCourse`, `.sendChatMessage` with the signatures below.

- [ ] **Step 1: Write the shared vocabulary**

Create `src/shared/types/serverContext.ts`:

```typescript
import type { IrisChatMessage, IrisChatMode } from './apiResponses';

/**
 * A session's topic as the SERVER reports it. `mode` is deliberately the full
 * IrisChatMode union plus unknown strings: the overview returns lecture and
 * text-exercise sessions, another client can repoint a session into one, and
 * reconnect can load one. The picker restricts what may be SELECTED; the
 * transport must represent everything the server may SAY.
 */
export interface ServerContext {
    mode: IrisChatMode | (string & {});
    /** The course id for COURSE_CHAT, the exercise/lecture id otherwise. */
    entityId: number;
    /** Display name when the server supplied one (overview `entityName`). */
    name?: string;
}

/** One row of `/api/iris/chat/{courseId}/sessions/overview`, plus the course it came from. */
export interface SessionSummary {
    sessionId: number;
    courseId: number;
    context: ServerContext;
    title?: string;
    /** epoch ms of `lastActivityDate ?? creationDate`; 0 when neither parses. */
    lastActivity: number;
}

/** A fully loaded conversation: what `sessions/current` and the detail GET return. */
export interface SessionDetail {
    sessionId: number;
    courseId: number;
    context: ServerContext;
    title?: string;
    /**
     * epoch ms of `lastActivityDate ?? creationDate`; 0 when neither parses.
     * Carried so a detail can be cached as a summary with the SAME ordering key
     * the overview uses. Without it, a conversation entered into the invisible
     * cache from a detail load would sort as if it had no activity at all.
     */
    lastActivity: number;
    /** Every persisted sender, including CTXSWAP. Never filtered here. */
    messages: IrisChatMessage[];
}

export type ContextSwapTransition = 'added' | 'removed' | 'changed';

/** True when two topics are the same. `name` is display-only and ignored. */
export function sameContext(a: ServerContext | undefined, b: ServerContext | undefined): boolean {
    if (!a || !b) { return a === b; }
    return a.mode === b.mode && a.entityId === b.entityId;
}

/** Caches a loaded conversation as an overview-shaped summary. */
export function summaryOfDetail(detail: SessionDetail): SessionSummary {
    return {
        sessionId: detail.sessionId,
        courseId: detail.courseId,
        context: detail.context,
        title: detail.title,
        lastActivity: detail.lastActivity,
    };
}
```

Widen the sender in `src/shared/types/apiResponses.ts`. `IrisChatMessage.sender` is `string | undefined` today, which is already permissive; add the named union next to it so consumers can switch exhaustively:

```typescript
/** Senders Artemis persists. `CTXSWAP` rows are context-change markers, not chat. */
export type IrisMessageSender = 'USER' | 'LLM' | 'ARTIFACT' | 'CTXSWAP';
```

- [ ] **Step 2: Write the failing API tests**

Extend the existing `test/unit/api/artemisApi.test.ts`. Do **not** create a new file: the tests at `:763`, `:777`, `:792`, `:820`, `:827` and `:832` call `getCurrentChat(mode, entityId)`, `createChatSession(mode, entityId)` and the old summary shape, so they must be migrated in this same commit or the suite does not compile. That suite already builds a `TestableArtemisApiService` over a stubbed `global.fetch`; reuse it, and add this local capture helper inside the suite:

```typescript
    interface Captured { url: string; options: { method?: string; body?: string } }

    /** Serves one canned response per call and records what was sent. */
    function captureFetch(responses: Array<{ status?: number; json?: unknown }>): Captured[] {
        const calls: Captured[] = [];
        let i = 0;
        global.fetch = (async (url: any, options: any) => {
            calls.push({ url: String(url), options: options ?? {} });
            const r = responses[Math.min(i++, responses.length - 1)];
            const status = r.status ?? 200;
            return {
                ok: status < 400,
                status,
                text: async () => JSON.stringify(r.json ?? {}),
                json: async () => r.json ?? {},
            } as any;
        }) as typeof global.fetch;
        return calls;
    }
```

```typescript
    test('createCourseSession posts courseId only', async () => {
        const calls = captureFetch([{ json: { id: 7, mode: 'COURSE_CHAT', entityId: 42, creationDate: '2026-07-01T10:00:00Z' } }]);
        const session = await apiService.createCourseSession(42);
        assert.strictEqual(session.sessionId, 7);
        assert.strictEqual(session.courseId, 42);
        assert.strictEqual(calls[0].url, 'https://artemis.example.com/api/iris/chat/sessions?courseId=42');
        assert.strictEqual(calls[0].options.method, 'POST');
    });

    test('getCurrentChat parses mode, entityId, title, activity and messages', async () => {
        captureFetch([{
            json: {
                id: 9, mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, title: 'BFS',
                creationDate: '2026-07-01T10:00:00Z', lastActivityDate: '2026-07-02T10:00:00Z',
                messages: [{ id: 1, sender: 'USER', content: [{ textContent: 'hi', type: 'text' }] }],
            },
        }]);
        const detail = await apiService.getCurrentChat('PROGRAMMING_EXERCISE_CHAT', 5, 42);
        assert.deepStrictEqual(detail.context, { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 });
        assert.strictEqual(detail.courseId, 42);
        assert.strictEqual(detail.lastActivity, Date.parse('2026-07-02T10:00:00Z'));
        assert.strictEqual(detail.messages.length, 1);
    });

    test('absent messages parse as an empty array', async () => {
        // @JsonInclude(NON_EMPTY) omits `messages` entirely when the session is empty.
        captureFetch([{ json: { id: 9, mode: 'COURSE_CHAT', entityId: 42, creationDate: '2026-07-01T10:00:00Z' } }]);
        const detail = await apiService.getCurrentChat('COURSE_CHAT', 42, 42);
        assert.deepStrictEqual(detail.messages, []);
    });

    test('an unknown mode is preserved verbatim and does not throw', async () => {
        captureFetch([{ json: { id: 9, mode: 'FUTURE_CHAT', entityId: 3, creationDate: '2026-07-01T10:00:00Z' } }]);
        const detail = await apiService.getChatSessionById(42, 9);
        assert.strictEqual(detail.context.mode, 'FUTURE_CHAT');
    });

    test('a session without mode or entityId is REJECTED, not defaulted', async () => {
        // Defaulting would infer a committed context, which invariant 3 forbids:
        // the extension would believe this is a course chat, stage another topic
        // onto it, and rehome it on the next send.
        captureFetch([{ json: { id: 9, creationDate: '2026-07-01T10:00:00Z' } }]);
        await assert.rejects(() => apiService.getChatSessionById(42, 9), MalformedResponseError);
    });

    test('sendChatMessage puts pendingContext in the body', async () => {
        const calls = captureFetch([{ json: { id: 11 } }]);
        await apiService.sendChatMessage(9, 'hallo', undefined, { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 });
        const body = JSON.parse(String(calls[0].options.body));
        assert.deepStrictEqual(body.pendingContext, { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 });
        assert.strictEqual(body.messageDifferentiator, undefined);
    });

    test('the uncommitted-files 400 retry keeps pendingContext', async () => {
        const calls = captureFetch([{ status: 400 }, { json: { id: 11 } }]);
        await apiService.sendChatMessage(9, 'hallo', new Map([['A.java', 'class A {}']]), { mode: 'COURSE_CHAT', entityId: 42 });
        const retryBody = JSON.parse(String(calls[1].options.body));
        assert.strictEqual(retryBody.uncommittedFiles, undefined);
        assert.deepStrictEqual(retryBody.pendingContext, { mode: 'COURSE_CHAT', entityId: 42 });
    });

    test('a 400 without uncommitted files is not retried', async () => {
        // Otherwise a pendingContext 400 is re-sent identically, twice.
        const calls = captureFetch([{ status: 400 }]);
        await assert.rejects(() => apiService.sendChatMessage(9, 'hallo', undefined, { mode: 'COURSE_CHAT', entityId: 42 }));
        assert.strictEqual(calls.length, 1);
    });

    test('listChatSessionsForCourse parses title, entityName and lastActivityDate', async () => {
        captureFetch([{
            json: [{
                id: 3, entityId: 5, entityName: 'BFS', title: 'Endlosschleife',
                creationDate: '2026-07-01T10:00:00Z', lastActivityDate: '2026-07-02T10:00:00Z',
                mode: 'PROGRAMMING_EXERCISE_CHAT',
            }],
        }]);
        const [summary] = await apiService.listChatSessionsForCourse(42);
        assert.strictEqual(summary.title, 'Endlosschleife');
        assert.strictEqual(summary.context.name, 'BFS');
        assert.strictEqual(summary.lastActivity, Date.parse('2026-07-02T10:00:00Z'));
    });

    test('a summary without lastActivityDate falls back to creationDate', async () => {
        captureFetch([{ json: [{ id: 3, entityId: 5, creationDate: '2026-07-01T10:00:00Z', mode: 'COURSE_CHAT' }] }]);
        const [summary] = await apiService.listChatSessionsForCourse(42);
        assert.strictEqual(summary.lastActivity, Date.parse('2026-07-01T10:00:00Z'));
    });
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `cd extension && npm run compile-tests && npx vscode-test --label unit --grep "Artemis API"`
Expected: FAIL, `apiService.createCourseSession is not a function`.

- [ ] **Step 4: Rewrite the chat section of `artemisApi.ts`**

Replace `getCurrentChat`, `createChatSession` and `listChatSessionsForCourse` (`:560-591`) and rework `sendChatMessage` (`:489-543`).

```typescript
/** Shared mapper: the detail DTO carries no courseId, so the caller supplies it. */
private _toSessionDetail(raw: unknown, courseId: number): SessionDetail {
    const session = parseApiObject<IrisChatSession>('IrisChatSession', raw, [{ key: 'id', type: 'number' }]);
    // `mode` and `entityId` are guaranteed on a chat session. Defaulting them
    // would INFER a committed context, which invariant 3 forbids: the extension
    // would then believe the conversation is about the course, stage another
    // topic onto it, and rehome it. A malformed response is a bug, not a course
    // chat, so it is rejected here where it is still cheap.
    if (typeof session.mode !== 'string' || typeof session.entityId !== 'number') {
        throw new MalformedResponseError(`Iris chat session ${session.id} has no mode/entityId`);
    }
    const parsed = Date.parse(String(session.lastActivityDate ?? session.creationDate ?? ''));
    return {
        sessionId: session.id,
        courseId,
        context: { mode: session.mode, entityId: session.entityId },
        title: typeof session.title === 'string' ? session.title : undefined,
        lastActivity: Number.isNaN(parsed) ? 0 : parsed,
        // @JsonInclude(NON_EMPTY): `messages` is absent, not [], on an empty session.
        messages: Array.isArray(session.messages) ? session.messages : [],
    };
}

async getCurrentChat(mode: IrisChatMode, entityId: number, courseId: number): Promise<SessionDetail> {
    const params = new URLSearchParams({ mode, entityId: String(entityId) });
    const response = await this.makeRequest(`/api/iris/chat/sessions/current?${params.toString()}`, { method: 'POST' });
    return this._toSessionDetail(await response.json(), courseId);
}

/**
 * Creates (or reuses) an EMPTY course session. Artemis PR #12696 removed the
 * mode/entityId parameters: every session is born COURSE_CHAT and is repointed
 * later by a message's pendingContext.
 */
async createCourseSession(courseId: number): Promise<SessionDetail> {
    const params = new URLSearchParams({ courseId: String(courseId) });
    const response = await this.makeRequest(`/api/iris/chat/sessions?${params.toString()}`, { method: 'POST' });
    return this._toSessionDetail(await response.json(), courseId);
}

async getChatSessionById(courseId: number, sessionId: number): Promise<SessionDetail> {
    const response = await this.makeRequest(`/api/iris/chat/courses/${courseId}/sessions/${sessionId}`);
    return this._toSessionDetail(await response.json(), courseId);
}

async listChatSessionsForCourse(courseId: number): Promise<SessionSummary[]> {
    const response = await this.makeRequest(`/api/iris/chat/${courseId}/sessions/overview`);
    return expectArray<SessionSummary>('SessionSummary list', await response.json(), (item, i) => {
        const dto = parseApiObject<IrisChatSessionSummary>(`IrisChatSessionSummary[${i}]`, item, [
            { key: 'id', type: 'number' },
            { key: 'entityId', type: 'number' },
            { key: 'creationDate', type: 'string' },
            { key: 'mode', type: 'string' },
        ]);
        const parsed = Date.parse(dto.lastActivityDate ?? dto.creationDate);
        return {
            sessionId: dto.id,
            courseId,
            context: { mode: dto.mode, entityId: dto.entityId, name: dto.entityName },
            title: dto.title,
            lastActivity: Number.isNaN(parsed) ? 0 : parsed,
        };
    });
}
```

For `sendChatMessage`, build the payload once. The duplicated literal in the try and the catch is what would silently drop `pendingContext` on the retry:

```typescript
async sendChatMessage(
    sessionId: number,
    content: string,
    uncommittedFiles?: Map<string, string>,
    pendingContext?: ServerContext,
): Promise<IrisChatMessage> {
    const buildPayload = (withFiles: boolean): Record<string, unknown> => {
        const payload: Record<string, unknown> = {
            sentAt: new Date().toISOString(),
            content: [{ textContent: content, type: 'text' }],
        };
        if (pendingContext) {
            // Only mode and entityId travel; `name` is a local display value.
            payload.pendingContext = { mode: pendingContext.mode, entityId: pendingContext.entityId };
        }
        if (withFiles && uncommittedFiles && uncommittedFiles.size > 0) {
            payload.uncommittedFiles = Object.fromEntries(uncommittedFiles);
        }
        return payload;
    };

    const post = async (withFiles: boolean): Promise<IrisChatMessage> => {
        const response = await this.makeRequest(`/api/iris/sessions/${sessionId}/messages`, {
            method: 'POST',
            body: JSON.stringify(buildPayload(withFiles)),
        });
        return parseApiObject<IrisChatMessage>('IrisChatMessage', await response.json());
    };

    try {
        return await post(true);
    } catch (error: unknown) {
        // The retry exists ONLY for servers that reject `uncommittedFiles`. It must
        // never fire when there were no files (a pendingContext 400 would then be
        // retried identically), and it must keep pendingContext (dropping it would
        // silently send the message into the wrong topic).
        const hasFiles = !!uncommittedFiles && uncommittedFiles.size > 0;
        if (hasFiles && error instanceof ApiError && error.status === 400) {
            logger.warn('Retrying send without uncommitted files (server may not support them)', LogCategory.API);
            return await post(false);
        }
        throw error;
    }
}
```

- [ ] **Step 5: Migrate every retained consumer of the changed shapes**

`listChatSessionsForCourse` now returns `SessionSummary[]` instead of `IrisChatSessionSummary[]`. Three consumers survive until Task 15 and must be migrated here, or this commit does not compile:

- `context/sessionSyncUtils.ts:45` reads `summary.mode` / `summary.entityId` to filter sessions by context. Read `summary.context.mode` / `summary.context.entityId`.
- `provider/chatWebviewProvider.ts:657` and `:750` feed `buildCourseHistory(summaries, courseId)`. Either adapt at the call site or change `buildCourseHistory` to accept `SessionSummary[]`; the latter is less code and Task 14 simplifies that function anyway.

Update `test/unit/services/iris/context/sessionSyncUtils.test.ts` and `courseHistory.test.ts` with the same shape change.

- [ ] **Step 6: Fix the remaining callers so the project type-checks**

`getCurrentChat` gained a required `courseId`, `createChatSession` is gone, and both now return a `SessionDetail` instead of a raw `IrisChatSession`. The source call sites are exactly two, both in `transport/irisWebSocketSessionClient.ts`:

- `:96` `initializeSession` calls `getCurrentChat(mode, context.id)` and reads `session.id`. It needs a **definite** course id, and `ActiveContext.courseId` is optional. The client's constructor takes only `(_artemisApiService, _websocketService)`, so it cannot look one up: **widen the signature** to `initializeSession(context, courseId, storedSessionId?)` and make the caller supply it. The only caller is `chatSessionService.initializeIrisSessionAndLoadMessages`, which already resolves one through `resolveCourseIdFromContext`; pass that value and skip the call when it is `undefined`, exactly as the surrounding code already does for other course-dependent work. Do not reach into `ContextStore` from the transport layer, and do not guess: guessing opens the wrong course's conversation.
- `:110` `createNewSession` calls `createChatSession(mode, context.id)`. Widen it the same way, to `createNewSession(context, courseId)`, and call `createCourseSession(courseId)`. The session is now always course-scoped; that is a behaviour change this commit deliberately makes, and Task 5 replaces the whole method. Its caller is `chatSessionService.createNewSession`, which resolves the course through the same `resolveCourseIdFromContext` and skips when it is `undefined`.

Both widenings break `test/logic/iris/irisWebSocketSessionClient.resubscribe.test.ts` and the provider's websocket unit tests; update their call sites in this commit.

Do not attempt to fix the semantics of either here. Both methods are deleted in Task 15, once Task 14 has removed their last caller.

Run: `npm run check-types`
Expected: PASS. If anything else fails, it is a caller this step missed; fix it here rather than deferring, or the commit is not green.

- [ ] **Step 7: Run the full gate**

Run: `npm run check-types && npm run lint && npm run test:unit && npm run test:react`
Expected: PASS. The focused run for the red-green loop is `npx vscode-test --label unit --grep "Artemis API"`, but the commit is judged on the full gate.

- [ ] **Step 8: Commit**

```bash
git add src/shared/types/serverContext.ts src/shared/types/apiResponses.ts src/extension/api/artemisApi.ts \
        src/extension/services/iris/transport/irisWebSocketSessionClient.ts \
        src/extension/services/iris/context/sessionSyncUtils.ts src/extension/services/iris/context/courseHistory.ts \
        src/extension/services/iris/chat/chatSessionService.ts src/extension/provider/chatWebviewProvider.ts \
        test/unit/api/artemisApi.test.ts test/unit/services/iris/context/ \
        test/unit/services/websocket.test.ts test/logic/iris/
git commit -m "feat(iris): speak the late-bound chat session endpoints"
```

---

## Task 2: Decode context-swap markers

**Files:**
- Create: `src/extension/services/iris/context/contextMarkers.ts`
- Modify: `src/shared/types/apiResponses.ts` (`IrisChatMessageContent` gains `attributes`)
- Modify: `src/extension/services/iris/chat/messageUtils.ts:22`
- Test: `test/logic/iris/contextMarkers.test.ts` (create), `test/unit/services/iris/chat/messageUtils.test.ts` (extend)

**The wire shape, verified against Artemis `main`.** Get this right first; a decoder written to the wrong shape rejects every real marker and the extension silently loses every context change.

```json
{
  "id": 123,
  "sender": "CTXSWAP",
  "sentAt": "2026-07-29T10:00:00Z",
  "content": [
    { "id": 456, "type": "json",
      "attributes": { "transition": "added", "entityMode": "PROGRAMMING_EXERCISE_CHAT", "entityId": 5, "name": "BFS" } }
  ]
}
```

Sources: `IrisMessageContentResponseDTO` is `(id, type, textContent, attributes)` and maps an `IrisJsonMessageContent` to `type: "json"` with `attributes = json.getAttributes()`. `getAttributes` carries `@JsonRawValue`, so the payload is serialised as an **inline object**, not as an embedded JSON string. `IrisContextSwitchTransition` carries `@JsonProperty("added"|"removed"|"changed")`, so the transition is **lower-case**. `IrisContextSwitchMarker` carries `@JsonInclude(NON_EMPTY)`, so `entityMode`, `entityId` and `name` are absent for `removed`, and `name` alone is absent on any transition whose title could not be resolved (it is `""` in that case).

Three consequences the implementer must not simplify away:

1. `attributes` is **not** a field of the message. It is a field of a content item. Walk `content[]` and take the first item with `type === 'json'`.
2. It arrives as an **object**. Accept a string too (defensive, for a server that ever drops `@JsonRawValue`), but the object path is the real one.
3. `name` is optional on **every** transition, not only `removed`.

Add the field to the shared type:

```typescript
export interface IrisChatMessageContent {
    type?: string;
    textContent?: string;
    /** Present on a `json` content item; the CTXSWAP marker payload lives here. */
    attributes?: unknown;
    [key: string]: unknown;
}
```

**Interfaces:**
- Consumes: `ServerContext`, `ContextSwapTransition` (Task 1).
- Produces: `parseContextSwap(message): ContextSwap | undefined`, `describeContextSwap(swap, courseContext): string`, `isContextSwap(message): boolean`.

- [ ] **Step 1: Write the failing marker tests**

Create `test/logic/iris/contextMarkers.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { describeContextSwap, isContextSwap, parseContextSwap } from '@extension/services/iris/context/contextMarkers';

/** The real wire shape: attributes live INSIDE a json content item, as an object. */
const marker = (attributes: unknown) => ({
    id: 3, sender: 'CTXSWAP', sentAt: '2026-07-29T10:00:00Z',
    content: [{ id: 456, type: 'json', attributes }],
});

describe('parseContextSwap', () => {
    it('reads an added transition from the json content item', () => {
        const swap = parseContextSwap(marker({
            transition: 'added', entityMode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS',
        }));
        expect(swap).toEqual({
            transition: 'added',
            context: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' },
        });
    });

    it('reads a changed transition', () => {
        const swap = parseContextSwap(marker({
            transition: 'changed', entityMode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 7, name: 'DFS',
        }));
        expect(swap?.transition).toBe('changed');
        expect(swap?.context?.entityId).toBe(7);
    });

    it('accepts attributes serialised as a string', () => {
        // Defensive only: @JsonRawValue makes the object form the real one.
        const swap = parseContextSwap(marker('{"transition":"added","entityMode":"COURSE_CHAT","entityId":42}'));
        expect(swap?.context?.entityId).toBe(42);
    });

    it('returns a removed transition with no context', () => {
        // NON_EMPTY drops entityMode, entityId and name for removed; the course
        // context is derived by the caller from the conversation's courseId.
        expect(parseContextSwap(marker({ transition: 'removed' }))).toEqual({ transition: 'removed', context: undefined });
    });

    it('accepts an added marker whose name could not be resolved', () => {
        // NON_EMPTY drops name when it is "", which happens on any transition.
        const swap = parseContextSwap(marker({ transition: 'added', entityMode: 'LECTURE_CHAT', entityId: 8 }));
        expect(swap?.context).toEqual({ mode: 'LECTURE_CHAT', entityId: 8, name: undefined });
    });

    it('ignores a text content item and finds the json one', () => {
        const swap = parseContextSwap({
            id: 3, sender: 'CTXSWAP',
            content: [{ type: 'text', textContent: 'ignored' }, { type: 'json', attributes: { transition: 'removed' } }],
        });
        expect(swap?.transition).toBe('removed');
    });

    it('is undefined for a non-marker message', () => {
        expect(parseContextSwap({ id: 1, sender: 'USER', content: [{ type: 'text', textContent: 'hi' }] })).toBeUndefined();
    });

    it('is undefined for a marker with no json content item', () => {
        expect(parseContextSwap({ id: 1, sender: 'CTXSWAP', content: [] })).toBeUndefined();
    });

    it('is undefined for a marker with an unknown transition', () => {
        expect(parseContextSwap(marker({ transition: 'teleported' }))).toBeUndefined();
    });

    it('preserves an unknown entityMode', () => {
        const swap = parseContextSwap(marker({ transition: 'added', entityMode: 'FUTURE_CHAT', entityId: 1 }));
        expect(swap?.context?.mode).toBe('FUTURE_CHAT');
    });
});

describe('isContextSwap', () => {
    it('is true for a CTXSWAP sender even when the payload is undecodable', () => {
        // hasContent must count a marker row whether or not we can decode it.
        expect(isContextSwap({ id: 1, sender: 'CTXSWAP', content: [] })).toBe(true);
    });
});

describe('describeContextSwap', () => {
    it('labels the three transitions', () => {
        const ctx = { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' };
        expect(describeContextSwap({ transition: 'added', context: ctx })).toBe('Thema gesetzt auf BFS');
        expect(describeContextSwap({ transition: 'changed', context: ctx })).toBe('Thema gewechselt zu BFS');
        expect(describeContextSwap({ transition: 'removed', context: undefined })).toBe('Thema entfernt');
    });

    it('falls back to a neutral label when the name is missing', () => {
        expect(describeContextSwap({ transition: 'added', context: { mode: 'LECTURE_CHAT', entityId: 8 } }))
            .toBe('Thema gesetzt auf Vorlesung 8');
    });

    it('falls back to the id for an unknown mode', () => {
        expect(describeContextSwap({ transition: 'added', context: { mode: 'FUTURE_CHAT', entityId: 8 } }))
            .toBe('Thema gesetzt auf Kontext 8');
    });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd extension && npx vitest run test/logic/iris/contextMarkers.test.ts`
Expected: FAIL, cannot resolve `contextMarkers`.

- [ ] **Step 3: Implement the decoder**

Create `src/extension/services/iris/context/contextMarkers.ts`:

```typescript
import type { IrisChatMessage } from '@shared/types/apiResponses';
import type { ContextSwapTransition, ServerContext } from '@shared/types/serverContext';

export interface ContextSwap {
    transition: ContextSwapTransition;
    /** Absent for `removed`, which carries no entity fields. */
    context?: ServerContext;
}

const TRANSITIONS: ReadonlySet<string> = new Set(['added', 'removed', 'changed']);

/**
 * True for any CTXSWAP row, decodable or not. `hasContent` (spec 3.3) counts
 * marker rows as content, so this predicate must not depend on the attributes
 * parsing successfully.
 */
export function isContextSwap(message: IrisChatMessage): boolean {
    return message.sender === 'CTXSWAP';
}

/** `undefined` when this is not a marker or its payload cannot be read. */
export function parseContextSwap(message: IrisChatMessage): ContextSwap | undefined {
    if (!isContextSwap(message)) { return undefined; }

    // The payload lives in a `json` CONTENT ITEM, not at the top level of the
    // message: IrisMessageContentResponseDTO maps IrisJsonMessageContent to
    // { type: "json", attributes: <raw> }. Reading message.attributes finds
    // nothing and silently drops every real marker.
    const item = (message.content ?? []).find((part) => part?.type === 'json' && part.attributes !== undefined);
    if (!item) { return undefined; }

    // @JsonRawValue serialises it as an inline object. The string branch is
    // defensive only, for a server that ever drops that annotation.
    const raw = item.attributes;
    let attrs: Record<string, unknown> | undefined;
    if (typeof raw === 'string') {
        try {
            const parsed: unknown = JSON.parse(raw);
            attrs = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
        } catch {
            attrs = undefined;
        }
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        attrs = raw as Record<string, unknown>;
    }
    if (!attrs) { return undefined; }

    const transition = attrs['transition'];
    if (typeof transition !== 'string' || !TRANSITIONS.has(transition)) { return undefined; }
    if (transition === 'removed') { return { transition, context: undefined }; }

    const mode = attrs['entityMode'];
    const entityId = attrs['entityId'];
    if (typeof mode !== 'string' || typeof entityId !== 'number') { return undefined; }
    const name = attrs['name'];
    return {
        transition: transition as ContextSwapTransition,
        context: { mode, entityId, name: typeof name === 'string' ? name : undefined },
    };
}

function labelFor(context: ServerContext | undefined): string {
    if (!context) { return 'den Kurs'; }
    if (context.name) { return context.name; }
    switch (context.mode) {
        case 'COURSE_CHAT': return 'den Kurs';
        case 'LECTURE_CHAT': return `Vorlesung ${context.entityId}`;
        case 'PROGRAMMING_EXERCISE_CHAT':
        case 'TEXT_EXERCISE_CHAT': return `Aufgabe ${context.entityId}`;
        default: return `Kontext ${context.entityId}`;
    }
}

/** Mirrors Artemis `iris-context-switch-divider.component.html`. */
export function describeContextSwap(swap: ContextSwap): string {
    switch (swap.transition) {
        case 'added': return `Thema gesetzt auf ${labelFor(swap.context)}`;
        case 'changed': return `Thema gewechselt zu ${labelFor(swap.context)}`;
        case 'removed': return 'Thema entfernt';
    }
}
```

- [ ] **Step 4: Fix `extractIrisMessageContent`**

`messageUtils.ts:22` falls through to `item.toString?.()` for an object content part, which produces the literal string `"[object Object]"` in the transcript. Marker content must never reach it, but the fallback is wrong regardless.

```typescript
        return content.map((item: IrisChatMessageContent) => {
            if (item.textContent) {
                return item.textContent;
            }
            // Never `item.toString()`: for a plain object that yields the literal
            // "[object Object]" in the transcript. An unrecognised part has no
            // renderable text, so it contributes nothing.
            return '';
        }).filter((part) => part.length > 0).join('\n');
```

Add to `test/unit/services/iris/chat/messageUtils.test.ts`:

```typescript
    test('an object content part without textContent yields no text', () => {
        assert.strictEqual(extractIrisMessageContent([{ type: 'unknown', payload: { a: 1 } }]), '');
    });

    test('a recognised part is unaffected by an unrecognised sibling', () => {
        assert.strictEqual(
            extractIrisMessageContent([{ type: 'unknown' }, { textContent: 'hallo', type: 'text' }]),
            'hallo',
        );
    });
```

- [ ] **Step 5: Run both suites**

Run: `npx vitest run test/logic/iris/contextMarkers.test.ts && npm run compile-tests && npx vscode-test --label unit --grep "messageUtils"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/extension/services/iris/context/contextMarkers.ts src/shared/types/apiResponses.ts src/extension/services/iris/chat/messageUtils.ts test/logic/iris/contextMarkers.test.ts test/unit/services/iris/chat/messageUtils.test.ts
git commit -m "feat(iris): decode context-swap markers"
```

---

## Task 3: The conversation state container

**Files:**
- Create: `src/extension/services/iris/conversation/conversationState.ts`
- Test: `test/logic/iris/conversationState.test.ts` (create)

**Interfaces:**
- Consumes: `ServerContext`, `SessionDetail`, `SessionSummary`, `sameContext` (Task 1); `isContextSwap` (Task 2).
- Produces: `ConversationState` with `snapshot()`, `guard()`, `beginLoad()`, `beginNavigation()`, `installAcquired()`, `installDetail()`, `upsertMessage()`, `setTitle()`, `stagePending()`, `clearPending()`, `applyContextSwap()`, `beginSend()/endSend()`, `setCourse()`, `setOverview(summaries)`, `nextOverviewSeq()`, `overviewSeq`, `updateSummary()`, `rememberInvisible()`, `forgetSession()`, `resetCachesForReload()`, `contentState()`, `displayMessageCount()`, `effectiveContext()`, `findSessionFor()`; types `GuardTuple`, `ContentState`, `SwapOutcome`.

This task carries part of local finding **1** (the guard tuple's shape). Local finding 5 (`knownInvisible` eviction) is **cut 3** and no longer applies.

- [ ] **Step 1: Write the failing state tests**

Create `test/logic/iris/conversationState.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';

import { ConversationState } from '@extension/services/iris/conversation/conversationState';
import type { SessionDetail } from '@shared/types/serverContext';

const EX5 = { mode: 'PROGRAMMING_EXERCISE_CHAT' as const, entityId: 5 };
const EX7 = { mode: 'PROGRAMMING_EXERCISE_CHAT' as const, entityId: 7 };
const COURSE42 = { mode: 'COURSE_CHAT' as const, entityId: 42 };

const detail = (over: Partial<SessionDetail> = {}): SessionDetail => ({
    sessionId: 1, courseId: 42, context: COURSE42, lastActivity: 1000, messages: [], ...over,
});

/** The real CTXSWAP wire shape (attributes inside a json content item). */
const swapMessage = (id: number, attributes: unknown) =>
    ({ id, sender: 'CTXSWAP', content: [{ type: 'json', attributes }] });

/**
 * Installs through the SAME entry point the service uses. An earlier draft did
 * beginNavigation + installDetail here, which is exactly the sequence
 * installAcquired exists to replace, so the helper proved nothing about the
 * production path.
 */
const install = (state: ConversationState, d: SessionDetail) =>
    state.installAcquired(d, state.beginLoad());

describe('ConversationState content', () => {
    let state: ConversationState;
    beforeEach(() => { state = new ConversationState(); state.setCourse(42); });

    it('reports unknown before a detail is installed', () => {
        state.beginNavigation(1);
        expect(state.contentState()).toBe('unknown');
    });

    it('counts a CTXSWAP-only conversation as content', () => {
        install(state, detail({ messages: [swapMessage(1, { transition: 'added' })] }));
        expect(state.contentState()).toBe('content');
    });

    it('counts a proactive-only conversation as content', () => {
        install(state, detail({ messages: [{ id: 1, sender: 'LLM' }] }));
        expect(state.contentState()).toBe('content');
    });

    it('counts an optimistic bubble as content', () => {
        install(state, detail());
        expect(state.contentState()).toBe('empty');
        state.setOptimisticBubble(true);
        expect(state.contentState()).toBe('content');
    });

    it('excludes CTXSWAP rows from the DISPLAY count', () => {
        install(state, detail({
            messages: [swapMessage(1, { transition: 'added' }), { id: 2, sender: 'USER' }, { id: 3, sender: 'LLM' }],
        }));
        expect(state.displayMessageCount()).toBe(2);
        expect(state.contentState()).toBe('content');
    });
});

describe('ConversationState learns about messages received after the load', () => {
    let state: ConversationState;
    beforeEach(() => { state = new ConversationState(); state.setCourse(42); install(state, detail()); });

    it('an empty conversation that receives a user message is no longer empty', () => {
        // Without this the picker stages onto a conversation the student has
        // already written in, and the next send rehomes it. That is the
        // ownership rule defeated by an omission.
        expect(state.contentState()).toBe('empty');
        state.upsertMessage({ id: 11, sender: 'USER' });
        expect(state.contentState()).toBe('content');
    });

    it('an assistant frame makes it non-empty', () => {
        state.upsertMessage({ id: 12, sender: 'LLM' });
        expect(state.contentState()).toBe('content');
    });

    it('deduplicates by server id across the POST response and the websocket frame', () => {
        state.upsertMessage({ id: 11, sender: 'USER' });
        state.upsertMessage({ id: 11, sender: 'USER', sentAt: '2026-07-29T10:00:00Z' });
        expect(state.displayMessageCount()).toBe(1);
        expect(state.snapshot().detail?.messages[0].sentAt).toBe('2026-07-29T10:00:00Z');
    });

    it('a context swap appends its marker and makes the conversation non-empty', () => {
        state.applyContextSwap({ transition: 'added', context: EX5 }, swapMessage(20, { transition: 'added' }));
        expect(state.contentState()).toBe('content');
        expect(state.displayMessageCount()).toBe(0);
    });

    it('an optimistic bubble that is later confirmed does not double-count', () => {
        state.setOptimisticBubble(true);
        state.upsertMessage({ id: 11, sender: 'USER' });
        state.setOptimisticBubble(false);
        expect(state.contentState()).toBe('content');
        expect(state.displayMessageCount()).toBe(1);
    });
});

describe('ConversationState epochs', () => {
    let state: ConversationState;
    beforeEach(() => { state = new ConversationState(); state.setCourse(42); install(state, detail()); });

    it('accepts a load that started after the last install', () => {
        expect(state.accepts(state.beginLoad())).toBe(true);
    });

    it('rejects a load after a context swap', () => {
        const g = state.beginLoad();
        state.applyContextSwap({ transition: 'added', context: EX5 }, swapMessage(20, { transition: 'added' }));
        expect(state.accepts(g)).toBe(false);
    });

    it('rejects a load after a send completes', () => {
        const g = state.beginLoad();
        state.beginSend();
        state.endSend();
        expect(state.accepts(g)).toBe(false);
    });

    it('rejects a load after a navigation', () => {
        const g = state.beginLoad();
        state.beginNavigation(2);
        expect(state.accepts(g)).toBe(false);
    });

    it('lets a newer-started load replace an older one that arrived first', () => {
        // The inverse order of the test below. L1 answers first and installs;
        // L2, which STARTED later, must still win when it arrives, so the final
        // truth is the one whose request began last.
        const g1 = state.beginLoad();
        const g2 = state.beginLoad();
        expect(state.installDetail(detail({ context: COURSE42 }), g1)).toBe(true);
        expect(state.installDetail(detail({ context: EX7 }), g2)).toBe(true);
        expect(state.snapshot().committedContext).toEqual(EX7);
    });

    it('rejects an older load once a newer one was installed', () => {
        // Two concurrent loads move nothing else, so only the ticket separates
        // them. It is issued at REQUEST START, so L1 < L2 regardless of which
        // response arrives first, and a delayed L1 cannot overwrite L2's truth.
        const g1 = state.beginLoad();
        const g2 = state.beginLoad();
        expect(state.installDetail(detail({ context: EX7 }), g2)).toBe(true);
        expect(state.installDetail(detail({ context: COURSE42 }), g1)).toBe(false);
        expect(state.snapshot().committedContext).toEqual(EX7);
    });

    it('rejects a cold-start acquisition that a later navigation superseded', () => {
        // captured.sessionId is undefined on both sides here, so an unconditional
        // accepts() check is the only thing that stops the install.
        const fresh = new ConversationState();
        fresh.setCourse(42);
        const g = fresh.beginLoad();
        fresh.beginNavigation(undefined);
        expect(fresh.installDetail(detail({ sessionId: 9 }), g)).toBe(false);
    });

    it('keeps counters per session, not global', () => {
        state.applyContextSwap({ transition: 'added', context: EX5 }, swapMessage(20, { transition: 'added' }));
        const revisionInOne = state.guard().contextRevision;
        install(state, detail({ sessionId: 2 }));
        expect(state.guard().contextRevision).toBe(0);
        expect(revisionInOne).toBe(1);
    });
});

describe('ConversationState pending', () => {
    let state: ConversationState;
    beforeEach(() => { state = new ConversationState(); state.setCourse(42); install(state, detail()); });

    it('stages a pending that differs from committed', () => {
        state.stagePending(EX5);
        expect(state.effectiveContext()).toEqual(EX5);
    });

    it('refuses to stage the committed context and clears instead', () => {
        // Invariant 1: pending is set IFF it differs from committed.
        state.stagePending(EX5);
        state.stagePending(COURSE42);
        expect(state.snapshot().pendingContext).toBeUndefined();
    });

    it('drops a pending belonging to another conversation', () => {
        state.stagePending(EX5);
        install(state, detail({ sessionId: 2 }));
        expect(state.snapshot().pendingContext).toBeUndefined();
    });

    it('clears the pending when the swap grants exactly what was staged', () => {
        state.stagePending(EX5);
        const outcome = state.applyContextSwap({ transition: 'added', context: EX5 }, swapMessage(20, { transition: 'added' }));
        expect(outcome).toBe('pending-satisfied');
        expect(state.snapshot().pendingContext).toBeUndefined();
    });

    it('always drops a divergent pending on a swap', () => {
        // The marker is itself a persisted message, so the conversation has
        // content the moment it lands. A surviving staging would let the next
        // send rehome it (invariant 4). There is deliberately no "still empty"
        // branch and no undo for this case.
        state.stagePending(EX5);
        const outcome = state.applyContextSwap({ transition: 'added', context: EX7 }, swapMessage(20, { transition: 'added' }));
        expect(outcome).toBe('pending-dropped');
        expect(state.snapshot().pendingContext).toBeUndefined();
        expect(state.contentState()).toBe('content');
    });

    it('derives the course context from a removed marker', () => {
        install(state, detail({ context: EX5 }));
        state.applyContextSwap({ transition: 'removed', context: undefined }, swapMessage(20, { transition: 'removed' }));
        expect(state.snapshot().committedContext).toEqual({ mode: 'COURSE_CHAT', entityId: 42 });
    });
});

describe('ConversationState knownInvisible', () => {
    let state: ConversationState;
    beforeEach(() => { state = new ConversationState(); state.setCourse(42); });

    it('finds a target that exists only in knownInvisible', () => {
        state.rememberInvisible({ sessionId: 9, courseId: 42, context: EX5, lastActivity: 100 });
        expect(state.findSessionFor(EX5)).toBe(9);
    });

    it('prefers the newest match across both sources', () => {
        state.setOverview([{ sessionId: 1, courseId: 42, context: EX5, lastActivity: 100 }]);
        state.rememberInvisible({ sessionId: 9, courseId: 42, context: EX5, lastActivity: 200 });
        expect(state.findSessionFor(EX5)).toBe(9);
    });

    it('drops an entry once the overview lists it', () => {
        state.rememberInvisible({ sessionId: 9, courseId: 42, context: EX5, lastActivity: 100 });
        state.setOverview([{ sessionId: 9, courseId: 42, context: EX5, lastActivity: 300 }]);
        expect(state.snapshot().knownInvisible).toHaveLength(0);
    });

    it('updates a remembered entry when a newer detail contradicts it', () => {
        state.rememberInvisible({ sessionId: 9, courseId: 42, context: EX5, lastActivity: 100 });
        install(state, detail({ sessionId: 9, context: EX7 }));
        expect(state.findSessionFor(EX5)).toBeUndefined();
        expect(state.findSessionFor(EX7)).toBe(9);
    });

    it('ENTERS a session the overview does not list, on any acquisition path', () => {
        // The loss this prevents: start acquires a conversation holding only a
        // proactive Iris message, the USER-only overview hides it, and without
        // an entry here nothing can ever reopen it again.
        install(state, detail({ sessionId: 9, context: EX5, messages: [{ id: 1, sender: 'LLM' }] }));
        expect(state.snapshot().knownInvisible.map((e) => e.sessionId)).toEqual([9]);
        expect(state.findSessionFor(EX5)).toBe(9);
    });

    it('does not enter a session the overview already lists', () => {
        state.setOverview([{ sessionId: 9, courseId: 42, context: EX5, lastActivity: 300 }]);
        install(state, detail({ sessionId: 9, context: EX5 }));
        expect(state.snapshot().knownInvisible).toHaveLength(0);
    });

    it('carries the detail ordering key into the cached summary', () => {
        install(state, detail({ sessionId: 9, context: EX5, lastActivity: 777 }));
        expect(state.snapshot().knownInvisible[0].lastActivity).toBe(777);
    });

    it('is cleared on a course change but survives a reconnect', () => {
        state.rememberInvisible({ sessionId: 9, courseId: 42, context: EX5, lastActivity: 100 });
        state.noteReconnect();
        expect(state.snapshot().knownInvisible).toHaveLength(1);
        state.setCourse(43);
        expect(state.snapshot().knownInvisible).toHaveLength(0);
    });

    it('keeps a message that arrived DURING a load (monotonic union)', () => {
        // Cut 6: the union never removes. Message 12 arrived while the GET was
        // in flight and must survive it, which is the loss the merge exists to
        // prevent. Message 10 predates the load and is absent from the response;
        // under the union it survives too. That is the accepted conservative
        // error: a server-deleted message can make an empty conversation look
        // non-empty, so we create a duplicate rather than rehome. Never the
        // reverse. PR 2 owns deletion semantics.
        install(state, detail({ sessionId: 1, messages: [{ id: 10, sender: 'LLM' }] }));
        const g = state.beginLoad();
        state.upsertMessage({ id: 12, sender: 'LLM' });
        state.installDetail(detail({ sessionId: 1, messages: [{ id: 11, sender: 'USER' }] }), g);
        const ids = state.snapshot().detail!.messages.map((m) => m.id).sort((a, b) => a - b);
        expect(ids).toEqual([10, 11, 12]);
    });

    it('carries nothing across a session switch', () => {
        install(state, detail({ sessionId: 1 }));
        state.upsertMessage({ id: 12, sender: 'LLM' });
        install(state, detail({ sessionId: 2, messages: [{ id: 30, sender: 'USER' }] }));
        expect(state.snapshot().detail!.messages.map((m) => m.id)).toEqual([30]);
    });

    it('does not duplicate a carried message once the server reports it', () => {
        install(state, detail({ sessionId: 1 }));
        const g = state.beginLoad();
        state.upsertMessage({ id: 12, sender: 'LLM' });
        state.installDetail(detail({ sessionId: 1, messages: [] }), g);
        const g2 = state.beginLoad();
        state.installDetail(detail({ sessionId: 1, messages: [{ id: 12, sender: 'LLM' }] }), g2);
        expect(state.snapshot().detail!.messages.filter((m) => m.id === 12)).toHaveLength(1);
    });

    it('rejects a same-session acquisition whose context guard moved', () => {
        // A reload's GET returns the pre-swap topic while a CTXSWAP already moved
        // the session. Guarding by the ticket alone would install the stale topic
        // next to a marker announcing the new one.
        install(state, detail({ sessionId: 1, context: EX5 }));
        const captured = state.beginLoad();
        state.applyContextSwap({ transition: 'changed', context: EX7 }, swapMessage(20, { transition: 'changed' }));
        expect(state.installAcquired(detail({ sessionId: 1, context: EX5 }), captured)).toBe(false);
        expect(state.snapshot().committedContext).toEqual(EX7);
    });

    it('a cross-session acquisition clears the previous course index', () => {
        state.setOverview([{ sessionId: 9, courseId: 42, context: EX5, lastActivity: 100 }]);
        state.rememberInvisible({ sessionId: 8, courseId: 42, context: EX7, lastActivity: 50 });
        install(state, { sessionId: 20, courseId: 43, context: { mode: 'COURSE_CHAT', entityId: 43 }, lastActivity: 1, messages: [] });
        expect(state.snapshot().courseSessions).toHaveLength(0);
        expect(state.snapshot().knownInvisible).toHaveLength(1);   // only session 20
        expect(state.findSessionFor(EX5)).toBeUndefined();
    });

    it('keeps the transcript when the SAME session is re-acquired', () => {
        // beginNavigation must not wipe the detail here, or the merge above has
        // nothing to carry and every reload silently deletes in-flight arrivals.
        install(state, detail({ sessionId: 1, messages: [{ id: 10, sender: 'USER' }] }));
        state.beginNavigation(1);
        expect(state.contentState()).toBe('content');
    });

    it('an overview response cannot contradict the OPEN conversation', () => {
        // Cut 7 replaces the general request-scoped overlay with one narrow
        // rule: the current conversation's row is derived from the loaded
        // detail, in the canonical collection that BOTH the history and
        // findSessionFor read. A late overview may still be stale about other
        // conversations; it may never be stale about the one on screen.
        install(state, detail({ sessionId: 9, context: EX7 }));
        state.setOverview([{ sessionId: 9, courseId: 42, context: EX5, lastActivity: 100 }]);
        expect(state.findSessionFor(EX7)).toBe(9);
        expect(state.findSessionFor(EX5)).toBeUndefined();
    });

    it('lets the overview correct a conversation that is NOT open', () => {
        // The counterpart. Without this the cache would never learn that another
        // client repointed a conversation we are not looking at.
        install(state, detail({ sessionId: 1 }));
        state.rememberInvisible({ sessionId: 9, courseId: 42, context: EX7, lastActivity: 200 });
        state.setOverview([{ sessionId: 9, courseId: 42, context: EX5, lastActivity: 300 }]);
        expect(state.findSessionFor(EX5)).toBe(9);
        expect(state.findSessionFor(EX7)).toBeUndefined();
    });
});
```

There is no eviction (cut 3). `knownInvisible` is a plain `Map`, bounded in practice by how many conversations a course has, cleared on a course change and gone on restart.

- [ ] **Step 2: Run and watch it fail**

Run: `cd extension && npx vitest run test/logic/iris/conversationState.test.ts`
Expected: FAIL, cannot resolve `conversationState`.

- [ ] **Step 3: Implement `ConversationState`**

Create `src/extension/services/iris/conversation/conversationState.ts`:

```typescript
import type { IrisChatMessage } from '@shared/types/apiResponses';
import type { ServerContext, SessionDetail, SessionSummary } from '@shared/types/serverContext';
import { sameContext, summaryOfDetail } from '@shared/types/serverContext';

import type { ContextSwap } from '../context/contextMarkers';
import { isContextSwap } from '../context/contextMarkers';

/**
 * `unknown` is NOT `empty`. It holds while no detail for the current session is
 * installed. Controls that could rehome a conversation (the picker, the chip's
 * remove icon, the Ask-Iris commands) stay disabled while it holds.
 */
export type ContentState = 'unknown' | 'empty' | 'content';

/**
 * Captured at the start of every asynchronous chat operation and compared on
 * its result. Two context-free counters are not enough: a revision earned in
 * conversation B would otherwise look causally newer than intent formed in A.
 */
export interface GuardTuple {
    sessionId: number | undefined;
    navigationGeneration: number;
    contextRevision: number;
    sendSeq: number;
    /**
     * Issued by `beginLoad()` at REQUEST START, not read from state. Two loads
     * that start while nothing else moves get different tickets, and only a
     * strictly newer ticket may install. Reading a counter off the state at
     * capture time cannot do this: both loads would read the same value, and
     * whichever answered first would win by accident.
     */
    loadTicket: number;
}

export interface PendingContext {
    ctx: ServerContext;
    sessionId: number;
    baseRevision: number;
}

export interface ConversationSnapshot {
    courseId: number | undefined;
    currentSessionId: number | undefined;
    detail: SessionDetail | undefined;
    committedContext: ServerContext | undefined;
    pendingContext: PendingContext | undefined;
    courseSessions: SessionSummary[];
    knownInvisible: SessionSummary[];
}

export type SwapOutcome = 'pending-satisfied' | 'pending-dropped' | 'no-pending';

export class ConversationState {
    private _courseId: number | undefined;
    private _currentSessionId: number | undefined;
    private _detail: SessionDetail | undefined;
    private _committed: ServerContext | undefined;
    private _pending: PendingContext | undefined;
    private _courseSessions: SessionSummary[] = [];
    private readonly _knownInvisible = new Map<number, SessionSummary>();

    private _navigationGeneration = 0;
    private _contextRevision = 0;
    private _sendSeq = 0;
    private _nextLoadTicket = 1;
    private _lastInstalledTicket = 0;
    private _overviewSeq = 0;
    /**
     * Bumped by the service before each overview request, and compared by the
     * service when the response lands, so an older request cannot install over
     * a newer one for the same course. It no longer stamps per-summary
     * overlays; cut 7 removed those.
     */
    public nextOverviewSeq(): number { return ++this._overviewSeq; }
    public get overviewSeq(): number { return this._overviewSeq; }
    private _sendInFlight = false;
    private _optimisticBubble = false;

    // ---- guards -------------------------------------------------------

    /**
     * Captures the guard for a NON-load operation (a send, a subscription). Its
     * `loadTicket` is `0`, which no install can use.
     */
    public guard(): GuardTuple {
        return {
            sessionId: this._currentSessionId,
            navigationGeneration: this._navigationGeneration,
            contextRevision: this._contextRevision,
            sendSeq: this._sendSeq,
            loadTicket: 0,
        };
    }

    /** Call this immediately BEFORE issuing a detail request, never after it. */
    public beginLoad(): GuardTuple {
        return { ...this.guard(), loadTicket: this._nextLoadTicket++ };
    }

    /**
     * A load is an OBSERVATION: an observation that started before a mutation is
     * not newer than it. So a result is installed only if nothing moved since it
     * began, AND its ticket is strictly newer than the last installed one, so a
     * delayed earlier load cannot overwrite a later one.
     */
    public accepts(captured: GuardTuple): boolean {
        return captured.sessionId === this._currentSessionId
            && captured.navigationGeneration === this._navigationGeneration
            && captured.contextRevision === this._contextRevision
            && captured.sendSeq === this._sendSeq
            && captured.loadTicket > this._lastInstalledTicket;
    }

    // ---- navigation ---------------------------------------------------

    /**
     * Announces that we are moving to `sessionId`. Resets the per-session
     * counters, drops the detail (content becomes `unknown`) and invalidates
     * every guard captured for the previous conversation.
     */
    public beginNavigation(sessionId: number | undefined): number {
        this._navigationGeneration++;
        // Only a change of conversation discards the transcript. Re-acquiring the
        // SAME session (reload, revalidation, a repeat open) must keep it, or the
        // merge below has nothing to carry and every same-session install silently
        // deletes any message that arrived while the request was in flight.
        const sameSession = sessionId !== undefined && sessionId === this._currentSessionId;
        this._currentSessionId = sessionId;
        if (!sameSession) {
            this._detail = undefined;
        }
        this._committed = undefined;
        this._contextRevision = 0;
        this._sendSeq = 0;
        // Per session: the next conversation's first load must be installable.
        // Loads still in flight for the PREVIOUS session are already rejected by
        // the navigation generation, so lowering this cannot let one through.
        this._lastInstalledTicket = 0;
        this._optimisticBubble = false;
        // Intent formed in another conversation has no standing here.
        if (this._pending && this._pending.sessionId !== sessionId) {
            this._pending = undefined;
        }
        return this._navigationGeneration;
    }

    public get navigationGeneration(): number { return this._navigationGeneration; }

    public setCourse(courseId: number | undefined): void {
        if (this._courseId === courseId) { return; }
        this._courseId = courseId;
        this._courseSessions = [];
        // Which sessions exist is course-scoped; carrying the cache across
        // courses would let a stale id answer a lookup in the wrong course.
        this._knownInvisible.clear();
    }

    /** A reconnect changes nothing about which sessions exist. */
    public noteReconnect(): void { /* deliberately empty; documents the decision */ }

    // ---- installs -----------------------------------------------------

    /**
     * Returns false when the guard failed and nothing was written. The guard is
     * checked unconditionally, including when `captured.sessionId` is
     * `undefined`: an acquisition that started before a `beginNavigation` must
     * not install afterwards just because it had no session id to name.
     * `undefined === undefined` already lets a legitimate cold start through.
     */
    public installDetail(detail: SessionDetail, captured: GuardTuple): boolean {
        if (!this.accepts(captured)) { return false; }
        if (this._currentSessionId !== undefined && detail.sessionId !== this._currentSessionId) { return false; }

        this._currentSessionId = detail.sessionId;
        // THROUGH setCourse, not a direct assignment. Assigning `_courseId`
        // changes the course while `_courseSessions` and `_knownInvisible`
        // still hold the previous course's sessions, so
        // `findSessionFor` can hand back a session id from the course we just
        // left: a 404, or worse, a duplicate conversation.
        this.setCourse(detail.courseId);
        // MONOTONIC UNION by server message id (cut 6). A load reads a snapshot
        // taken at request time, so a message that arrived AFTER the request
        // began is newer than that snapshot even though it moved no guard
        // counter; a replacing install would silently delete it. The union never
        // removes, so that loss is impossible by construction and no per-message
        // arrival bookkeeping is needed.
        //
        // The cost, accepted: a message the server deleted survives locally
        // until a reload or a restart. That error only ever makes a conversation
        // look MORE full than it is, so the ownership predicate errs towards
        // creating a duplicate rather than rehoming. PR 2, which deletes
        // superseded proactive messages, owns the sharper semantics.
        //
        // Spread, not replace: a locally known frame may be partial (a resend
        // that only attaches activities), and the response may carry fields it
        // lacks, so the two are merged field-wise with the local copy winning.
        const known = new Map<number, IrisChatMessage>();
        if (this._detail?.sessionId === detail.sessionId) {
            for (const m of this._detail.messages) {
                if (typeof m.id === 'number') { known.set(m.id, m); }
            }
        }
        const merged = detail.messages.map((m) =>
            (typeof m.id === 'number' && known.has(m.id)) ? { ...m, ...known.get(m.id)! } : m);
        for (const [id, m] of known) {
            if (!detail.messages.some((sm) => sm.id === id)) { merged.push(m); }
        }
        this._detail = { ...detail, messages: merged };
        this._committed = detail.context;
        this._lastInstalledTicket = captured.loadTicket;
        this._optimisticBubble = false;

        if (this._pending && (this._pending.sessionId !== detail.sessionId || sameContext(this._pending.ctx, detail.context))) {
            this._pending = undefined;
        }
        this._rememberFromDetail(detail);
        return true;
    }

    /**
     * Atomic acquisition: switch to `detail.sessionId` and install it in one
     * step, guarded only by the ticket reserved before the request.
     *
     * Splitting this into `beginNavigation` then `installDetail` cannot work:
     * the navigation invalidates any guard captured before it, and any guard
     * captured after it is tautological.
     */
    public installAcquired(detail: SessionDetail, captured: GuardTuple): boolean {
        if (detail.sessionId === this._currentSessionId) {
            // Same conversation: this is an ORDINARY LOAD and the FULL guard
            // applies. Guarding it by the ticket alone reintroduces exactly the
            // race the context guard exists for: a CTXSWAP moves the session to
            // E7 while the GET is in flight, the response carries the older E5,
            // and a ticket-only check installs E5 over it. The transcript would
            // then show a marker announcing E7 next to a committed topic of E5.
            return this.installDetail(detail, captured);
        }
        // Different conversation. The per-session counters are not comparable
        // across sessions, so the caller's navigation token is what authorises
        // this; `_install` checks it immediately before calling, synchronously.
        this.beginNavigation(detail.sessionId);
        return this.installDetail(detail, { ...this.guard(), loadTicket: captured.loadTicket });
    }

    /**
     * Records a message that arrived AFTER the detail load: the persisted user
     * message from a send response, an assistant or ARTIFACT frame, and the
     * CTXSWAP marker. Without this, `contentState()` reports `empty` for a
     * conversation the student has already written in, the picker stages onto
     * it, and the next send rehomes it. That is the ownership rule defeated by
     * an omission rather than by a decision.
     *
     * Deduplicated by server id, because the same message reaches us twice: once
     * in the POST response and once as a websocket frame.
     */
    public upsertMessage(message: IrisChatMessage): void {
        if (!this._detail) { return; }
        // Keep the detail canonical for activity too, or `setOverview`'s
        // re-derivation of the current row would hand back a value older than
        // what we already know and the history would sort backwards.
        const at = message.sentAt ? Date.parse(message.sentAt) : NaN;
        if (!Number.isNaN(at) && at > this._detail.lastActivity) {
            this._detail = { ...this._detail, lastActivity: at };
        }
        if (typeof message.id === 'number') {
            const existing = this._detail.messages.findIndex((m) => m.id === message.id);
            if (existing >= 0) {
                this._detail.messages[existing] = { ...this._detail.messages[existing], ...message };
                return;
            }
        }
        this._detail.messages.push(message);
    }

    /**
     * Installs an overview response. Latest-request-wins for the course as a
     * whole is the SERVICE's job (`_overviewSeq`); the only per-row rule left
     * here is that the response may not contradict the OPEN conversation.
     *
     * Cut 7 removed the general per-summary overlay. A CTXSWAP can still land
     * while an overview is in flight, and the response then describes the old
     * topic, but for the current conversation the loaded detail is
     * authoritative and simply re-derives its row. Other conversations are
     * allowed to be briefly stale; that is how the cache learns about repoints
     * it never saw.
     */
    public setOverview(summaries: SessionSummary[]): void {
        this._courseSessions = summaries;
        for (const summary of summaries) {
            this._knownInvisible.delete(summary.sessionId);
        }
        // The open conversation's row comes from the detail, in the SAME
        // collection that both the history and `findSessionFor` read. Applying
        // this only at render time would let `findSessionFor` hand back a
        // session under a topic it no longer holds.
        if (this._detail && this._detail.sessionId === this._currentSessionId) {
            const fromOverview = summaries.find((s) => s.sessionId === this._detail!.sessionId);
            this.updateSummary({
                ...summaryOfDetail(this._detail),
                // MAX, not the detail's value. The detail is canonical for the
                // topic and the title, but activity only ever moves forward and
                // the two sources learn about it independently: the server may
                // have counted a message we have not seen, and we may have seen
                // one it had not counted when the request was answered. Taking
                // the detail's value alone would let an overview response walk
                // the history sort order backwards.
                lastActivity: Math.max(this._detail.lastActivity, fromOverview?.lastActivity ?? 0),
            });
        }
    }

    public rememberInvisible(summary: SessionSummary): void {
        this._knownInvisible.set(summary.sessionId, summary);
    }

    /**
     * ENTERS the session when it is not in the overview, and UPDATES it when it
     * already is, so a cached summary can never contradict authoritative state.
     * Entering (not merely updating) is what makes every acquisition path -
     * start, history open, new conversation, course switch, revalidation -
     * remember a proactive-only conversation the USER-only overview hides. Only
     * updating an existing entry loses exactly those conversations.
     */
    private _rememberFromDetail(detail: SessionDetail): void {
        this.updateSummary(summaryOfDetail(detail));
    }

    /**
     * The single place a summary is written. It updates the entry WHEREVER the
     * session currently lives and enters it into the invisible cache only when
     * the overview does not list it. Two separate paths (one that updated the
     * overview row, one that added an invisible entry) could leave the same
     * session recorded twice with contradictory topics, so history and lookup
     * would disagree about the same conversation.
     */
    public updateSummary(summary: SessionSummary): void {
        const index = this._courseSessions.findIndex((s) => s.sessionId === summary.sessionId);
        if (index >= 0) {
            this._courseSessions = [
                ...this._courseSessions.slice(0, index),
                { ...this._courseSessions[index], ...summary },
                ...this._courseSessions.slice(index + 1),
            ];
            this._knownInvisible.delete(summary.sessionId);
            return;
        }
        this.rememberInvisible({ ...this._knownInvisible.get(summary.sessionId), ...summary });
    }

    // ---- context ------------------------------------------------------

    public effectiveContext(): ServerContext | undefined {
        return this._pending?.ctx ?? this._committed;
    }

    public stagePending(ctx: ServerContext): void {
        if (this._currentSessionId === undefined) { return; }
        if (sameContext(ctx, this._committed)) {
            this._pending = undefined;
            return;
        }
        this._pending = { ctx, sessionId: this._currentSessionId, baseRevision: this._contextRevision };
    }

    public clearPending(): void { this._pending = undefined; }

    /**
     * Applies an accepted CTXSWAP frame. Bumps `contextRevision`, so every load
     * in flight is invalidated: a frame is pushed at mutation time and is
     * therefore always newer than anything already on the wire.
     *
     * `markerMessage` is the persisted CTXSWAP row and MUST be appended. It is
     * what makes the conversation non-empty, which is the whole reason a
     * divergent pending has to die here and can never be restored.
     */
    public applyContextSwap(swap: ContextSwap, markerMessage: IrisChatMessage): SwapOutcome {
        const next: ServerContext = swap.context
            // `removed` carries no entity fields, so derive the course context.
            ?? { mode: 'COURSE_CHAT', entityId: this._courseId ?? 0 };
        this._committed = next;
        this._contextRevision++;
        // The detail and the cached summary must move with it, or the history
        // row and the positive lookup keep claiming the old topic while the chip
        // shows the new one, and `findSessionFor` answers with a session that no
        // longer holds what was asked for.
        if (this._detail) { this._detail = { ...this._detail, context: next }; }
        // The marker's own timestamp, not the stale detail's: this IS the most
        // recent activity on the conversation, and the history sorts on it.
        const markerAt = markerMessage.sentAt ? Date.parse(markerMessage.sentAt) : NaN;
        this.updateSummary({
            sessionId: this._currentSessionId!,
            courseId: this._courseId!,
            context: next,
            title: this._detail?.title,
            lastActivity: Number.isNaN(markerAt) ? (this._detail?.lastActivity ?? 0) : markerAt,
        });
        this.upsertMessage(markerMessage);

        if (!this._pending) { return 'no-pending'; }
        if (sameContext(this._pending.ctx, next)) {
            this._pending = undefined;
            return 'pending-satisfied';
        }
        // Always dropped. The marker is itself a persisted message, so the
        // conversation has content now; a surviving staging would rehome it.
        this._pending = undefined;
        return 'pending-dropped';
    }

    // ---- sends --------------------------------------------------------

    public get sendInFlight(): boolean { return this._sendInFlight; }
    public beginSend(): void { this._sendInFlight = true; }
    /** Call once the send's result is FULLY processed, reconciliation included. */
    public endSend(): void { this._sendInFlight = false; this._sendSeq++; }
    public setOptimisticBubble(present: boolean): void { this._optimisticBubble = present; }

    // ---- content ------------------------------------------------------

    public contentState(): ContentState {
        if (this._optimisticBubble) { return 'content'; }
        if (!this._detail || this._detail.sessionId !== this._currentSessionId) { return 'unknown'; }
        return this._detail.messages.length > 0 ? 'content' : 'empty';
    }

    /** Display value only. NEVER the ownership predicate: it hides markers. */
    public displayMessageCount(): number {
        return (this._detail?.messages ?? []).filter((m: IrisChatMessage) => !isContextSwap(m)).length;
    }

    // ---- lookup -------------------------------------------------------

    /**
     * Positive-only index over the overview plus the invisible cache. A hit is a
     * HYPOTHESIS: the caller revalidates it ONCE against the detail GET, because
     * both sources go stale when another client repoints a session. There is no
     * exclusion set: cut 4 replaced the retry loop with "revalidate the newest
     * hit, and on a mismatch create a fresh conversation".
     */
    public findSessionFor(target: ServerContext): number | undefined {
        const candidates = [...this._courseSessions, ...this._knownInvisible.values()]
            .filter((s) => s.courseId === this._courseId && sameContext(s.context, target))
            .sort((a, b) => b.lastActivity - a.lastActivity || b.sessionId - a.sessionId);
        return candidates[0]?.sessionId;
    }

    public snapshot(): ConversationSnapshot {
        return {
            courseId: this._courseId,
            currentSessionId: this._currentSessionId,
            detail: this._detail,
            committedContext: this._committed,
            pendingContext: this._pending,
            courseSessions: this._courseSessions,
            knownInvisible: [...this._knownInvisible.values()],
        };
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/logic/iris/conversationState.test.ts`
Expected: PASS, every suite in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/extension/services/iris/conversation/conversationState.ts test/logic/iris/conversationState.test.ts
git commit -m "feat(iris): conversation state with per-session epochs"
```

---

## Task 4: Topic resolution as a pure decision

**Files:**
- Create: `src/extension/services/iris/conversation/topicResolution.ts`
- Test: `test/logic/iris/topicResolution.test.ts` (create)

**Interfaces:**
- Consumes: `ConversationState` (Task 3) via a narrow read-only view.
- Produces: `resolveTopic(input): TopicDecision`; type `TopicDecision`.

Separating the decision from its execution is what makes §4's table testable without any HTTP mocking. It no longer serves the picker: cut 1 removed the per-entry labels, and this module is host-only.

- [ ] **Step 1: Write the failing resolution tests**

Create `test/logic/iris/topicResolution.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { resolveTopic } from '@extension/services/iris/conversation/topicResolution';

const EX5 = { mode: 'PROGRAMMING_EXERCISE_CHAT' as const, entityId: 5 };
const EX7 = { mode: 'PROGRAMMING_EXERCISE_CHAT' as const, entityId: 7 };
const COURSE42 = { mode: 'COURSE_CHAT' as const, entityId: 42 };

const input = (over = {}) => ({
    target: EX5,
    courseId: 42,
    currentSessionId: 1 as number | undefined,
    committedContext: COURSE42,
    pendingContext: undefined as { ctx: typeof EX5 } | undefined,
    contentState: 'empty' as 'unknown' | 'empty' | 'content',
    findSessionFor: () => undefined as number | undefined,
    ...over,
});

// Cut 4: there is no `alreadyTried` set. `resolveTopic` takes one argument and
// the caller revalidates the single hit it returns.

describe('resolveTopic', () => {
    it('is a no-op when the target is already the effective topic', () => {
        expect(resolveTopic(input({ target: COURSE42 }))).toEqual({ kind: 'noop' });
    });

    it('is a no-op when the target equals the pending topic', () => {
        expect(resolveTopic(input({ pendingContext: { ctx: EX5 } }))).toEqual({ kind: 'noop' });
    });

    it('clears a divergent pending when the target is the committed topic', () => {
        // Selecting the committed context must UNSTAGE, not stage it.
        const decision = resolveTopic(input({ target: COURSE42, pendingContext: { ctx: EX5 } }));
        expect(decision).toEqual({ kind: 'clear-pending' });
    });

    it('acquires when no conversation is open', () => {
        // The cold-start row. Without it "Ask Iris about this exercise" from the
        // dashboard would refuse, because contentState is unknown with no session.
        const decision = resolveTopic(input({ currentSessionId: undefined, contentState: 'unknown', committedContext: undefined }));
        expect(decision).toEqual({ kind: 'acquire', target: EX5 });
    });

    it('refuses while content is unknown and a conversation IS open', () => {
        expect(resolveTopic(input({ contentState: 'unknown' }))).toEqual({ kind: 'refuse', reason: 'loading' });
    });

    it('stages onto an empty conversation', () => {
        expect(resolveTopic(input())).toEqual({ kind: 'stage', target: EX5 });
    });

    it('opens the target conversation when one is known and this one has content', () => {
        const decision = resolveTopic(input({ contentState: 'content', findSessionFor: () => 9 }));
        expect(decision).toEqual({ kind: 'open', sessionId: 9, target: EX5 });
    });

    it('creates a new conversation when the target is unknown and this one has content', () => {
        const decision = resolveTopic(input({ contentState: 'content' }));
        expect(decision).toEqual({ kind: 'create-and-stage', target: EX5 });
    });

    it('never rehomes a conversation with content, even for the course topic', () => {
        const decision = resolveTopic(input({ target: COURSE42, committedContext: EX5, contentState: 'content', findSessionFor: () => 3 }));
        expect(decision).toEqual({ kind: 'open', sessionId: 3, target: COURSE42 });
    });

    it('refuses a cross-course target', () => {
        const decision = resolveTopic(input({ target: { mode: 'COURSE_CHAT' as const, entityId: 99 } }));
        expect(decision).toEqual({ kind: 'refuse', reason: 'cross-course' });
    });
});
```

The cross-course case: a `COURSE_CHAT` target whose `entityId` is not the current `courseId` cannot be staged (`applyContextChange` throws `ConflictException`), so the resolver rejects it before any request. Exercise targets are filtered by the picker, which only offers the current course's exercises; the resolver cannot verify an exercise's course itself and does not try.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run test/logic/iris/topicResolution.test.ts`
Expected: FAIL, cannot resolve `topicResolution`.

- [ ] **Step 3: Implement the resolver**

Create `src/extension/services/iris/conversation/topicResolution.ts`:

```typescript
import type { ServerContext } from '@shared/types/serverContext';
import { sameContext } from '@shared/types/serverContext';

import type { ContentState } from './conversationState';

export type TopicDecision =
    /** Already there. */
    | { kind: 'noop' }
    /** Drop the staging; no request. */
    | { kind: 'clear-pending' }
    /** Stage onto the open, empty conversation; no request. */
    | { kind: 'stage'; target: ServerContext }
    /** No conversation open: POST sessions/current, then stage if a course session came back. */
    | { kind: 'acquire'; target: ServerContext }
    /** GET this conversation, revalidate, switch on a match. */
    | { kind: 'open'; sessionId: number; target: ServerContext }
    /** POST sessions?courseId and stage the topic in the fresh conversation. */
    | { kind: 'create-and-stage'; target: ServerContext }
    | { kind: 'refuse'; reason: 'loading' | 'cross-course' };

export interface TopicResolutionInput {
    target: ServerContext;
    courseId: number | undefined;
    currentSessionId: number | undefined;
    committedContext: ServerContext | undefined;
    pendingContext: { ctx: ServerContext } | undefined;
    contentState: ContentState;
    findSessionFor(target: ServerContext): number | undefined;
}

/**
 * Decides which conversation should carry `target`. Pure: performs no requests.
 *
 * HOST-ONLY. The webview must not import this (`eslint.config.mjs` bans
 * `@extension/*` from `src/webview/**`), which is why cut 1 replaced the
 * per-entry effect labels with one static picker hint.
 *
 * There is no retry set. Cut 4: the service revalidates the single hit this
 * returns, and on a mismatch it records what the GET actually said and creates
 * a fresh conversation rather than walking to the next candidate.
 */
export function resolveTopic(input: TopicResolutionInput): TopicDecision {
    const { target, courseId, currentSessionId, committedContext, pendingContext, contentState } = input;

    // A cross-course COURSE_CHAT staging is rejected by applyContextChange, so a
    // pick could never be a staging. Refuse before spending a request.
    if (target.mode === 'COURSE_CHAT' && courseId !== undefined && target.entityId !== courseId) {
        return { kind: 'refuse', reason: 'cross-course' };
    }

    const effective = pendingContext?.ctx ?? committedContext;
    if (sameContext(target, effective)) { return { kind: 'noop' }; }

    // Selecting the committed topic while something else is staged UNSTAGES.
    if (pendingContext && sameContext(target, committedContext)) { return { kind: 'clear-pending' }; }

    if (currentSessionId === undefined) { return { kind: 'acquire', target }; }
    if (contentState === 'unknown') { return { kind: 'refuse', reason: 'loading' }; }
    if (contentState === 'empty') { return { kind: 'stage', target }; }

    const existing = input.findSessionFor(target);
    if (existing !== undefined) { return { kind: 'open', sessionId: existing, target }; }
    return { kind: 'create-and-stage', target };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/logic/iris/topicResolution.test.ts`
Expected: PASS, every test in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/extension/services/iris/conversation/topicResolution.ts test/logic/iris/topicResolution.test.ts
git commit -m "feat(iris): pure topic resolution"
```

---

## Task 5: The conversation service executes decisions

**Files:**
- Create: `src/extension/services/iris/conversation/conversationService.ts`
- Create: `src/extension/services/iris/conversation/deps.ts` (the `IrisServiceDeps` interface, moved out of the deleted `sessionSyncUtils.ts`)
- Test: `test/unit/services/iris/conversation/conversationService.test.ts` (create)

**Interfaces:**
- Consumes: `ArtemisApiService` (Task 1), `ConversationState` (Task 3), `resolveTopic` (Task 4).
- Produces: `IrisConversationService` with `start()`, `resolveTopicChange(target)`, `navigateTo(params)`, `newConversation()`, `switchCourse(courseId)`, `refreshOverview()`, `reconcileCurrent()`, `reload()`, `state` (read-only), `onDidChange` event.

This task carries local findings **1** (guard matrix), **2** (concurrent detail loads), **3** (`navigateTo` at course switch) and **8** (cold-start wording). Finding **4** (revalidation termination) is dissolved by cut 4: one attempt cannot loop.

- [ ] **Step 1: Write the guard matrix into the file header**

Before any code, write this comment block at the top of `conversationService.ts`. It is the answer to "every async result carries the full tuple", which cannot literally hold for operations that have no session id yet.

```typescript
/**
 * Guard matrix. Every asynchronous chat operation states what invalidates it.
 *
 * | Operation                | Guard                                                        |
 * |--------------------------|--------------------------------------------------------------|
 * | start acquisition        | navigationGeneration only (no session id exists yet)          |
 * | course switch acquisition| navigationGeneration + requested courseId                     |
 * | new-conversation POST    | navigationGeneration + requested courseId                     |
 * | history / picker open    | navigationGeneration + requested sessionId                    |
 * | index revalidation GET   | navigationGeneration + requested sessionId (ONE attempt)      |
 * | overview refresh         | requested courseId + overviewSeq (single-flight, latest wins) |
 * | reconnect detail         | full GuardTuple (it is a load like any other)                 |
 * | send response            | { sessionId, contextRevision } captured before the POST       |
 * | ambiguous reconciliation | full GuardTuple; installs, never merges                       |
 *
 * Session-scoped operations reject on any tuple movement. Course-scoped ones
 * carry the requested courseId, because a slow course-A overview must not
 * replace course-B's list.
 */
```

- [ ] **Step 2: Write the failing service tests**

Create `test/unit/services/iris/conversation/conversationService.test.ts`. Build the service against a hand-written fake API so each test controls resolution timing:

```typescript
import * as assert from 'assert';

import { IrisConversationService } from '@extension/services/iris/conversation/conversationService';

/** Fake API whose every method resolves through a deferred the test controls. */
function makeApi() {
    const deferred: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void; call: string }> = [];
    const next = (call: string) => new Promise((resolve, reject) => { deferred.push({ resolve, reject, call }); });
    return {
        deferred,
        api: {
            getCurrentChat: (mode: string, entityId: number, courseId: number) => next(`current:${mode}:${entityId}:${courseId}`),
            createCourseSession: (courseId: number) => next(`create:${courseId}`),
            getChatSessionById: (courseId: number, sessionId: number) => next(`detail:${courseId}:${sessionId}`),
            listChatSessionsForCourse: (courseId: number) => next(`overview:${courseId}`),
        },
    };
}

const detail = (sessionId: number, context: unknown, messages: unknown[] = []) =>
    ({ sessionId, courseId: 42, context, messages });

const EX5 = { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 };
const EX7 = { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 7 };
const COURSE42 = { mode: 'COURSE_CHAT', entityId: 42 };

suite('IrisConversationService', () => {
    test('start acquires the workspace exercise session in one call', async () => {
        const { api, deferred } = makeApi();
        const service = new IrisConversationService(api as never, deps());
        const started = service.start({ exerciseId: 5, courseId: 42 });
        assert.strictEqual(deferred[0].call, 'current:PROGRAMMING_EXERCISE_CHAT:5:42');
        deferred[0].resolve(detail(1, EX5));
        await started;
        assert.strictEqual(service.state.snapshot().currentSessionId, 1);
        assert.deepStrictEqual(service.state.effectiveContext(), EX5);
    });

    test('start stages the exercise when a course session comes back', async () => {
        // getCurrentSessionOrCreateIfNotExists falls back to an EMPTY course
        // session, so staging is safe under invariant 4.
        const { api, deferred } = makeApi();
        const service = new IrisConversationService(api as never, deps());
        const started = service.start({ exerciseId: 5, courseId: 42 });
        deferred[0].resolve(detail(1, COURSE42));
        await started;
        assert.deepStrictEqual(service.state.snapshot().pendingContext?.ctx, EX5);
    });

    test('cold start issues no Iris session acquisition request', async () => {
        // The dashboard course-list request is allowed and is not made here;
        // what must not happen is any /api/iris/chat call.
        const { api, deferred } = makeApi();
        const service = new IrisConversationService(api as never, deps());
        await service.start(undefined);
        assert.strictEqual(deferred.length, 0);
        assert.strictEqual(service.state.snapshot().currentSessionId, undefined);
    });

    test('a topic pick on an empty conversation stages without a request', async () => {
        const service = await started();
        await service.resolveTopicChange(EX7);
        assert.strictEqual(service.api.deferred.length, 0);
        assert.deepStrictEqual(service.state.effectiveContext(), EX7);
    });

    test('a hit whose GET returns a different context creates a fresh conversation', async () => {
        // The user picked E7; session 9 was repointed to E5 by another client.
        // Adopting E5 would hand them a conversation they did not ask for, so we
        // record what session 9 actually holds and start a new one. Cut 4: we do
        // NOT walk to the next candidate.
        const service = await startedWithContent();
        service.state.setOverview([{ sessionId: 9, courseId: 42, context: EX7, lastActivity: 100 }]);
        const change = service.resolveTopicChange(EX7);
        assert.strictEqual(service.api.deferred.at(-1)?.call, 'detail:42:9');
        service.api.deferred.at(-1)!.resolve(detail(9, EX5, [{ id: 1, sender: 'USER' }]));
        await tick();
        assert.strictEqual(service.api.deferred.at(-1)?.call, 'create:42');
        service.api.deferred.at(-1)!.resolve(detail(12, COURSE42));
        await change;
        assert.strictEqual(service.state.snapshot().currentSessionId, 12);
        assert.deepStrictEqual(service.state.snapshot().pendingContext?.ctx, EX7);
        // The index learned the truth, so the next resolution does not re-probe 9.
        assert.strictEqual(service.state.findSessionFor(EX7), undefined);
        assert.strictEqual(service.state.findSessionFor(EX5), 9);
    });

    test('the visible conversation is untouched while a revalidation probe is open', async () => {
        // The probe must not mutate anything: a mismatch, a 403 or a dropped
        // connection has to leave the student looking at what they were reading.
        const service = await startedWithContent();
        service.state.setOverview([{ sessionId: 9, courseId: 42, context: EX7, lastActivity: 100 }]);
        void service.resolveTopicChange(EX7);
        assert.strictEqual(service.state.snapshot().currentSessionId, 1);
        assert.strictEqual(service.state.contentState(), 'content');
    });

    test('a delayed earlier detail load never overwrites a newer one', async () => {
        const service = await started();
        const first = service.navigateTo({ courseId: 42, sessionId: 3 });
        const second = service.navigateTo({ courseId: 42, sessionId: 4 });
        // Resolve them out of order: the stale first must be discarded.
        service.api.deferred[service.api.deferred.length - 1].resolve(detail(4, EX7));
        service.api.deferred[service.api.deferred.length - 2].resolve(detail(3, EX5));
        await Promise.all([first, second]);
        assert.strictEqual(service.state.snapshot().currentSessionId, 4);
        assert.deepStrictEqual(service.state.snapshot().committedContext, EX7);
    });

    test('a course switch acquires an empty course conversation and clears the invisible cache', async () => {
        const service = await started();
        service.state.rememberInvisible({ sessionId: 9, courseId: 42, context: EX5, lastActivity: 1 });
        const switched = service.switchCourse(43);
        assert.strictEqual(service.api.deferred.at(-1)?.call, 'current:COURSE_CHAT:43:43');
        service.api.deferred.at(-1)!.resolve({ sessionId: 20, courseId: 43, context: { mode: 'COURSE_CHAT', entityId: 43 }, messages: [] });
        await switched;
        assert.strictEqual(service.state.snapshot().currentSessionId, 20);
        assert.strictEqual(service.state.snapshot().knownInvisible.length, 0);
    });

    test('a slow course-A overview does not replace course-B sessions', async () => {
        const service = await started();
        const staleOverview = service.refreshOverview();
        const switched = service.switchCourse(43);
        service.api.deferred.find((d) => d.call === 'current:COURSE_CHAT:43:43')!.resolve(
            { sessionId: 20, courseId: 43, context: { mode: 'COURSE_CHAT', entityId: 43 }, messages: [] });
        await switched;
        service.api.deferred.find((d) => d.call === 'overview:42')!.resolve([
            { sessionId: 1, courseId: 42, context: EX5, lastActivity: 5 },
        ]);
        await staleOverview;
        assert.strictEqual(service.state.snapshot().courseSessions.length, 0);
    });

    test('a websocket message arriving during a same-session reload survives it', async () => {
        // The service-level path, not just ConversationState: _install calls
        // beginNavigation, and an earlier draft cleared the detail there, so the
        // merge had nothing to carry and this message was lost.
        const service = await startedWithContent();
        const reloading = service.reload();
        service.state.upsertMessage({ id: 77, sender: 'LLM' });
        service.api.resolveCall('detail:42:1', detail(1, EX5, [{ id: 11, sender: 'USER' }]));
        await reloading;
        assert.ok(service.state.snapshot().detail!.messages.some((m) => m.id === 77));
    });

    test('a course switch during an in-flight overview still fetches the new course', async () => {
        // A global single-flight would JOIN the course-42 request, whose response
        // is then discarded by the course check, and course 43 would never get an
        // overview at all.
        const service = await started();
        const stale = service.refreshOverview();
        const switched = service.switchCourse(43);
        service.api.resolveCall('current:COURSE_CHAT:43:43', { sessionId: 20, courseId: 43, context: { mode: 'COURSE_CHAT', entityId: 43 }, lastActivity: 1, messages: [] });
        await switched;
        service.api.resolveCall('overview:42', []);
        await stale;
        await tick();
        assert.ok(service.api.deferred.some((d) => d.call === 'overview:43'));
        service.api.resolveCall('overview:43', [{ sessionId: 30, courseId: 43, context: { mode: 'COURSE_CHAT', entityId: 43 }, lastActivity: 5 }]);
        await tick();
        assert.strictEqual(service.state.snapshot().courseSessions.length, 1);
    });

    test('an older overview response does not install over a newer one for the same course', async () => {
        // A1 starts, the student switches to B and back to A, A2 starts, and A1
        // only THEN answers. The requests genuinely overlap; an earlier version
        // of this test resolved A1 before starting A2, so the sequence guard it
        // claims to be about was never exercised.
        const service = await started();
        const a1 = service.refreshOverview();                       // A1, seq n
        const switched = service.switchCourse(43);
        service.api.resolveCall('current:COURSE_CHAT:43:43', { sessionId: 20, courseId: 43, context: { mode: 'COURSE_CHAT', entityId: 43 }, lastActivity: 1, messages: [] });
        await switched;
        const back = service.switchCourse(42);
        service.api.resolveCall('current:COURSE_CHAT:42:42', { sessionId: 21, courseId: 42, context: COURSE42, lastActivity: 1, messages: [] });
        await back;                                                  // A2 starts here, seq n+2
        await tick();
        // BOTH are open now. `resolveCall` takes the newest outstanding one, so
        // this is A2; `resolveOldestCall` below is A1. Using resolveCall twice
        // would answer A2 twice and then hang on `await a1`.
        assert.strictEqual(service.api.outstanding('overview:42').length, 2);
        service.api.resolveCall('overview:42', [{ sessionId: 5, courseId: 42, context: EX7, lastActivity: 9 }]);
        await tick();
        const installed = service.state.snapshot().courseSessions.length;
        service.api.resolveOldestCall('overview:42', []);            // A1 answers last, empty
        await a1;
        await tick();
        // A1's empty answer must not wipe what A2 installed.
        assert.strictEqual(service.state.snapshot().courseSessions.length, installed);
    });

    test('a settling older overview does not clear the newer flight', async () => {
        // The cleanup identifies the REQUEST, not the course. With a
        // course-equality check, A1 settling would clear A2's tracking and the
        // next refresh would duplicate a request that is still open.
        const service = await started();
        void service.refreshOverview();
        const switched = service.switchCourse(43);
        service.api.resolveCall('current:COURSE_CHAT:43:43', { sessionId: 20, courseId: 43, context: { mode: 'COURSE_CHAT', entityId: 43 }, lastActivity: 1, messages: [] });
        await switched;
        const back = service.switchCourse(42);
        service.api.resolveCall('current:COURSE_CHAT:42:42', { sessionId: 21, courseId: 42, context: COURSE42, lastActivity: 1, messages: [] });
        await back;
        await tick();
        const before = service.api.deferred.filter((d) => d.call === 'overview:42').length;
        service.api.resolveOldestCall('overview:42', []);   // A1 settles, A2 stays open
        await tick();
        void service.refreshOverview();                     // must JOIN A2, not issue a third
        assert.strictEqual(service.api.deferred.filter((d) => d.call === 'overview:42').length, before);
        assert.strictEqual(service.api.outstanding('overview:42').length, 1);
    });

    test('a 404 on an indexed hit forgets the row and creates, without a second probe', async () => {
        // The `gone` branch of the revalidation. It routes through the same
        // `revalidated` flag as a context mismatch, so there is exactly one
        // detail GET and then a create.
        const service = await startedWithContent();
        service.state.setOverview([{ sessionId: 9, courseId: 42, context: EX7, lastActivity: 100 }]);
        const change = service.resolveTopicChange(EX7);
        service.api.rejectCall('detail:42:9', new ApiError('gone', 404));
        await tick();
        assert.strictEqual(service.api.deferred.filter((d) => d.call.startsWith('detail:')).length, 1);
        assert.strictEqual(service.api.deferred.at(-1)?.call, 'create:42');
        service.api.deferred.at(-1)!.resolve(detail(12, COURSE42));
        await change;
        assert.strictEqual(service.state.snapshot().currentSessionId, 12);
        assert.deepStrictEqual(service.state.snapshot().pendingContext?.ctx, EX7);
        // Session 9 was forgotten, so it can no longer answer a lookup.
        assert.strictEqual(service.state.findSessionFor(EX7), undefined);
    });

    test('a navigateTo racing a resolveTopicChange leaves exactly one winner', async () => {
        const service = await startedWithContent();
        const nav = service.navigateTo({ courseId: 42, sessionId: 3 });
        const topic = service.resolveTopicChange(EX7);
        // The topic change requested last, so it wins whichever answers first.
        service.api.resolveCall('detail:42:3', detail(3, COURSE42, [{ id: 1, sender: 'USER' }]));
        service.api.resolveCall('create:42', detail(12, COURSE42));
        await Promise.all([nav, topic]);
        assert.strictEqual(service.state.snapshot().currentSessionId, 12);
    });

    test('a deferred reload runs once the send settles, and coalesces', async () => {
        const service = await started();
        service.state.beginSend();
        void service.reload();
        void service.reload();
        assert.strictEqual(service.api.deferred.filter((d) => d.call.startsWith('detail:')).length, 0);
        service.state.endSend();
        service.runDeferredReload();
        await tick();
        assert.strictEqual(service.api.deferred.filter((d) => d.call === 'detail:42:1').length, 1);
    });

    test('a 404 on history open removes the row; a 500 keeps it', async () => {
        const service = await started();
        service.state.setOverview([{ sessionId: 9, courseId: 42, context: EX7, lastActivity: 1 }]);
        const gone = service.navigateTo({ courseId: 42, sessionId: 9 });
        service.api.deferred.at(-1)!.reject(new ApiError('not found', 404));
        await gone.catch(() => undefined);
        assert.strictEqual(service.state.snapshot().courseSessions.length, 0);

        service.state.setOverview([{ sessionId: 8, courseId: 42, context: EX7, lastActivity: 1 }]);
        const kept = service.navigateTo({ courseId: 42, sessionId: 8 });
        service.api.deferred.at(-1)!.reject(new ApiError('boom', 500));
        await kept.catch(() => undefined);
        assert.strictEqual(service.state.snapshot().courseSessions.length, 1);
    });

    test('a new conversation enters knownInvisible and carries an exercise topic over', async () => {
        const service = await startedWithContent();  // committed EX5, has content
        const created = service.newConversation();
        service.api.deferred.at(-1)!.resolve(detail(12, COURSE42));
        await created;
        assert.deepStrictEqual(service.state.snapshot().pendingContext?.ctx, EX5);
        assert.strictEqual(service.state.snapshot().knownInvisible[0]?.sessionId, 12);
    });

    test('opening from history stages nothing even when the workspace differs', async () => {
        const service = await started();  // workspace exercise is 5
        const opened = service.navigateTo({ courseId: 42, sessionId: 9 });
        service.api.deferred.at(-1)!.resolve(detail(9, EX7, [{ id: 1, sender: 'USER' }]));
        await opened;
        assert.strictEqual(service.state.snapshot().pendingContext, undefined);
    });

    test('navigateTo stages nothing at all', async () => {
        // Cut 2 removed savedPending with undo. navigateTo is now purely
        // "open this conversation and adopt what the server says".
        const service = await started();
        service.state.stagePending(EX7);
        const opened = service.navigateTo({ courseId: 42, sessionId: 9 });
        service.api.deferred.at(-1)!.resolve(detail(9, COURSE42));
        await opened;
        assert.strictEqual(service.state.snapshot().pendingContext, undefined);
    });
});
```

The harness, written out in full at the top of the file. It is load-bearing: several tests depend on resolving requests **out of order**, which needs a fake that hands back a controllable deferred per call rather than a canned value.

```typescript
// `settled` is load-bearing, not bookkeeping. Two requests can be open under
// the SAME call name at once (A1 and A2 in the overview race), so a helper that
// merely scans by name would answer the same one twice: the first "resolve A1"
// would hit A2 and the test would then hang awaiting A1 forever. Every helper
// below therefore picks an OUTSTANDING deferred and marks it settled.
type Deferred = {
    call: string;
    settled: boolean;
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
};

function makeApi() {
    const deferred: Deferred[] = [];
    const next = (call: string) => new Promise((resolve, reject) => {
        deferred.push({ call, settled: false, resolve, reject });
    });
    const outstanding = (call: string) => deferred.filter((d) => d.call === call && !d.settled);
    const take = (call: string, which: 'newest' | 'oldest'): Deferred => {
        const open = outstanding(call);
        if (open.length === 0) {
            throw new Error(`no outstanding ${call}; saw ${deferred.map((x) => `${x.call}${x.settled ? '(settled)' : ''}`).join(', ')}`);
        }
        const d = which === 'newest' ? open[open.length - 1] : open[0];
        d.settled = true;
        return d;
    };
    return {
        deferred,
        outstanding,
        /** Resolves the newest outstanding request, whichever it is. */
        resolveLast: (v: unknown) => {
            const open = deferred.filter((d) => !d.settled);
            const d = open[open.length - 1];
            d.settled = true;
            d.resolve(v);
        },
        /** Resolves the NEWEST outstanding request matching `call`. */
        resolveCall: (call: string, v: unknown) => { take(call, 'newest').resolve(v); },
        /**
         * Resolves the OLDEST outstanding request matching `call`. This is what
         * makes an A1/B/A2 race testable: the point of those tests is that the
         * FIRST request answers last.
         */
        resolveOldestCall: (call: string, v: unknown) => { take(call, 'oldest').resolve(v); },
        /** Rejects the newest outstanding request matching `call`. */
        rejectCall: (call: string, error: unknown) => { take(call, 'newest').reject(error); },
        api: {
            getCurrentChat: (mode: string, entityId: number, courseId: number) => next(`current:${mode}:${entityId}:${courseId}`),
            createCourseSession: (courseId: number) => next(`create:${courseId}`),
            getChatSessionById: (courseId: number, sessionId: number) => next(`detail:${courseId}:${sessionId}`),
            listChatSessionsForCourse: (courseId: number) => next(`overview:${courseId}`),
        },
    };
}

/** Lets a pending promise chain advance without resolving anything new. */
const tick = () => new Promise((r) => setImmediate(r));

function deps() {
    const subscribed: number[] = [];
    return {
        subscribed,
        deps: {
            subscribeToSession: async (sessionId: number) => { subscribed.push(sessionId); },
            getWorkspaceExercise: () => ({ exerciseId: 5, courseId: 42 }),
        },
    };
}

/** A service with an open, EMPTY exercise conversation (session 1, topic E5). */
async function started() {
    const { api, deferred, outstanding, resolveLast, resolveCall, resolveOldestCall, rejectCall } = makeApi();
    const { deps: d, subscribed } = deps();
    const service = new IrisConversationService(api as never, d);
    const run = service.start({ exerciseId: 5, courseId: 42 });
    resolveLast(detail(1, EX5));
    await run;
    // start fires refreshOverview; answer it so it cannot bleed into a later assertion.
    resolveCall('overview:42', []);
    await tick();
    return Object.assign(service, {
        api: { deferred, outstanding, resolveLast, resolveCall, resolveOldestCall, rejectCall },
        subscribed,
    });
}

/** The same, but the conversation already has a user message. */
async function startedWithContent() {
    const service = await started();
    service.state.upsertMessage({ id: 11, sender: 'USER' });
    return service;
}
```

Two of the tests above assert on `service.api.deferred.at(-1)?.call`. That is only meaningful because the fake records every call in issue order; when a test needs to answer a specific request rather than the newest one, it uses `resolveCall`.

- [ ] **Step 3: Run and watch it fail**

Run: `npm run compile-tests && npx vscode-test --label unit --grep "IrisConversationService"`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement the service**

Create `src/extension/services/iris/conversation/conversationService.ts` with the guard-matrix header from Step 1.

**Navigation is transactional.** This is the single most important rule in this file. Nothing visible changes until the detail is in hand:

- `beginNavigation()` is the **commit point**, not the request start. Calling it before the `GET` destroys the open conversation's detail and committed context; if the `GET` then mismatches, 403s or times out, the student is left staring at a conversation the extension can no longer describe, `contentState()` is `unknown`, and the resolution loop dead-ends at `refuse/loading` instead of trying the next candidate.
- Request-start ordering is carried by `_navRequestSeq`, a service-level counter that mutates nothing. A navigation installs only if it is still the newest requested one.

```typescript
export interface IrisConversationDeps {
    /**
     * Declares the desired subscription. SYNCHRONOUS by contract: it records the
     * intent immediately and converges in the background, so two rapid
     * navigations cannot leave the transport on the older conversation.
     */
    subscribeToSession(sessionId: number): void;
    /** Resolves the workspace exercise, or undefined when none is detected. */
    getWorkspaceExercise(): { exerciseId: number; courseId: number } | undefined;
}

export type TopicChangeOutcome =
    | { kind: 'noop' }
    | { kind: 'staged' }
    | { kind: 'unstaged' }
    | { kind: 'opened'; sessionId: number }
    /** A newer navigation superseded this one; nothing was changed. */
    | { kind: 'stale' }
    | { kind: 'rejected'; reason: 'loading' | 'cross-course' | 'send-in-flight' | 'no-course' | 'failed' };

export class IrisConversationService {
    public readonly state = new ConversationState();
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    public readonly onDidChange = this._onDidChange.event;

    private _overviewInFlight: { courseId: number; seq: number; promise: Promise<void> } | undefined;
    private _navRequestSeq = 0;
    private _navInFlight = 0;
    private _reloadWhenSendSettles = false;

    constructor(
        private readonly _api: ArtemisApiService,
        private readonly _deps: IrisConversationDeps,
    ) {}

    public get navigationInFlight(): boolean { return this._navInFlight > 0; }

    private _emit(): void { this._onDidChange.fire(); }

    /** Public form of `_emit`, for the send coordinator. */
    public notifyChanged(): void { this._emit(); }

    /**
     * The ONE commit point. Every acquisition path funnels through it, which is
     * how the websocket subscription, the course, the invisible cache and the
     * emitted snapshot stay in step. Subscribing here (and only here) is why a
     * newly opened conversation actually receives its assistant frames; the old
     * model did this inside the deleted `initializeSession`.
     *
     * It takes the ENCLOSING navigation's token and re-checks it twice: before
     * committing, and again after the subscription resolves. Two navigations
     * whose subscribe calls settle in reverse order would otherwise both commit,
     * leaving the visible conversation and the live subscription disagreeing.
     */
    private _install(detail: SessionDetail, captured: GuardTuple, isCurrent: () => boolean): boolean {
        if (!isCurrent()) { return false; }
        // ONE atomic state call. An earlier draft did `beginLoad()` here, then
        // `beginNavigation()`, then `installDetail(detail, captured)`: the
        // navigation bumps the generation, so the captured guard was already
        // invalid and installDetail returned false on EVERY install. The return
        // value was ignored, so the service reported success while leaving
        // `detail` and `committedContext` undefined for a session it had just
        // named as current.
        //
        // `captured` is reserved BEFORE the request that produced `detail`,
        // never here, for two independent reasons:
        //
        // - it carries the MUTATION guards as they stood at request start, so a
        //   stale same-session response cannot overwrite a CTXSWAP that landed
        //   while it was in flight. Capturing after the response would read the
        //   post-swap values and accept unconditionally;
        // - its load ticket records request-start ORDER, so a delayed earlier
        //   load cannot install over a later one. A ticket taken here would
        //   reflect arrival order instead, which is exactly the wrong order.
        if (!this.state.installAcquired(detail, captured)) { return false; }
        // SYNCHRONOUS declaration of intent; the transport converges in the
        // background and owns latest-wins (Task 6). It does NOT mean the STOMP
        // subscription is live, which is why the reconciliation below exists.
        this._deps.subscribeToSession(detail.sessionId);
        this._emit();
        return true;
    }

    /**
     * Called when a subscription actually becomes active, via the client's
     * `onDidResubscribe`. This is the production wiring for spec §7.7's rule
     * that a CTXSWAP can land between adopting a snapshot and the subscription
     * going live, and it covers BOTH cases with one path:
     *
     * - a reconnect, where the socket dropped and came back;
     * - a first subscribe that was delayed or retried after a throw, during
     *   which the server can repoint the session and we would simply not hear it.
     *
     * Installing the detail and then never checking again is what leaves the
     * chip showing a topic the server abandoned.
     */
    public onSubscriptionActive(sessionId: number): void {
        if (sessionId !== this.state.snapshot().currentSessionId) { return; }
        void this.reconcileCurrent();
    }

    /**
     * Wraps a whole navigation so only the newest requested one may install, and
     * so `navigationInFlight` stays true for its ENTIRE duration.
     *
     * Two rules, both load-bearing:
     *
     * 1. **One token per user-visible operation, spanning probe AND install.**
     *    An earlier draft gave `_probe` its own token. It expired when the probe
     *    returned, so `navigationInFlight` dropped to false in the window before
     *    `_install` ran. A send admitted in that window POSTs to the OLD session
     *    while the install switches the view to the new one, and the send's
     *    `upsertMessage` then writes the old conversation's message into the new
     *    conversation's transcript.
     * 2. **`_navigate` never nests.** Helpers take `isCurrent` as a parameter
     *    rather than opening their own token. A nested call would bump
     *    `_navRequestSeq` and make the outer `isCurrent()` permanently false,
     *    silently turning every outer install into a no-op.
     */
    private async _navigate<T>(run: (isCurrent: () => boolean) => Promise<T>): Promise<T> {
        const seq = ++this._navRequestSeq;
        this._navInFlight++;
        this._emit();
        try {
            return await run(() => seq === this._navRequestSeq);
        } finally {
            this._navInFlight--;
            this._emit();
        }
    }

    /**
     * Start. One call gives id, mode, entityId, title and messages. Without a
     * detected workspace exercise this makes NO Iris session acquisition
     * request; the webview shows the cold-start course chooser (spec 5.7). The
     * dashboard course-list request is a different request and is unaffected.
     */
    public async start(workspace: { exerciseId: number; courseId: number } | undefined): Promise<void> {
        if (!workspace) { return; }
        const target: ServerContext = { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: workspace.exerciseId };
        await this._navigate(async (isCurrent) => {
            const captured = this.state.beginLoad();
            const detail = await this._api.getCurrentChat('PROGRAMMING_EXERCISE_CHAT', workspace.exerciseId, workspace.courseId);
            if (!this._install(detail, captured, isCurrent)) { return; }
            // A course session came back: it is empty by construction
            // (findOrCreateEmptyCourseSession), so staging cannot rehome content.
            if (!sameContext(detail.context, target) && this.state.contentState() === 'empty') {
                this.state.stagePending(target);
            }
            void this.refreshOverview();
            this._emit();
        });
    }

    /** Header `+`. The displayed topic carries over as pending when it is an exercise. */
    public async newConversation(): Promise<TopicChangeOutcome> {
        if (this.state.sendInFlight) { return { kind: 'rejected', reason: 'send-in-flight' }; }
        const courseId = this.state.snapshot().courseId;
        if (courseId === undefined) { return { kind: 'rejected', reason: 'no-course' }; }
        const carried = this.state.effectiveContext();
        return await this._navigate(async (isCurrent) => {
            const captured = this.state.beginLoad();
            const fresh = await this._api.createCourseSession(courseId);
            if (!this._install(fresh, captured, isCurrent)) { return { kind: 'stale' } as const; }
            if (carried && !sameContext(carried, fresh.context)) { this.state.stagePending(carried); }
            this._emit();
            return { kind: 'opened', sessionId: fresh.sessionId } as const;
        });
    }

    /**
     * The "Reload Iris chat" escape hatch. Drops every local cache and re-reads
     * from the server: the open conversation when there is one, the start path
     * when there is not.
     */
    public async reload(): Promise<void> {
        // Must refuse while a send is unresolved. The malformed-marker branch of
        // the websocket handler calls this, and that marker arrives WHILE our own
        // POST is open, so an ungated reload would navigate mid-send and bypass
        // the dispatcher gating of spec 7.3 entirely.
        if (this.state.sendInFlight) { this._reloadWhenSendSettles = true; return; }
        const { currentSessionId, courseId } = this.state.snapshot();
        // The escape hatch drops EVERYTHING local, which is the whole point of
        // the command. `setOverview([])` alone leaves knownInvisible in place,
        // so a wedged client stays wedged.
        this.state.resetCachesForReload();
        if (currentSessionId === undefined || courseId === undefined) {
            await this.start(this._deps.getWorkspaceExercise());
            return;
        }
        await this._navigate(async (isCurrent) => {
            const captured = this.state.beginLoad();
            const detail = await this._api.getChatSessionById(courseId, currentSessionId);
            if (!this._install(detail, captured, isCurrent)) { return; }
            void this.refreshOverview();
        });
    }

    /** Called by SendCoordinator's finally, so a deferred reload is not lost. */
    public runDeferredReload(): void {
        if (!this._reloadWhenSendSettles) { return; }
        this._reloadWhenSendSettles = false;
        this.reload().catch((error: unknown) => {
            logger.warn('Deferred Iris reload failed', LogCategory.IRIS_CHAT, error);
        });
    }

    /**
     * Topic-based. Used by the picker, the chip's remove icon and the Ask-Iris
     * commands. Never by history or the course switch: those address a
     * conversation by id and go through navigateTo.
     */
    public async resolveTopicChange(target: ServerContext, courseHint?: number): Promise<TopicChangeOutcome> {
        if (this.state.sendInFlight) { return { kind: 'rejected', reason: 'send-in-flight' }; }
        // ONE token for the whole resolution, probes and installs included. A
        // token that expired between the probe and the install would leave a
        // window in which a send is admitted against the OLD conversation while
        // the view moves to the new one, and the send's upsertMessage would then
        // write the old conversation's message into the new transcript.
        return await this._navigate((isCurrent) => this._resolveWithin(target, courseHint, isCurrent));
    }

    private async _resolveWithin(
        target: ServerContext,
        courseHint: number | undefined,
        isCurrent: () => boolean,
    ): Promise<TopicChangeOutcome> {
        // Cut 4: at most TWO passes, and the second one cannot probe again.
        // `revalidated` is set once a probe has come back with a different
        // context; the index has been corrected by then, so the re-resolution
        // can only produce `create-and-stage` (or a no-op if the correction
        // happened to satisfy the target). There is no candidate walk.
        let revalidated = false;
        for (;;) {
            const decision = resolveTopic(this._resolutionInput(target));
            switch (decision.kind) {
                case 'noop': return { kind: 'noop' };
                case 'refuse': return { kind: 'rejected', reason: decision.reason };
                case 'clear-pending': this.state.clearPending(); this._emit(); return { kind: 'unstaged' };
                case 'stage': this.state.stagePending(decision.target); this._emit(); return { kind: 'staged' };
                case 'acquire': return await this._acquireForTarget(decision.target, courseHint, isCurrent);
                case 'create-and-stage':
                    return await this._createAndStage(decision.target, courseHint, isCurrent);
                case 'open': {
                    // A second `open` can only mean the index still points at
                    // something after we already probed once. Refuse to probe
                    // again and create instead; this is what bounds the loop now
                    // that there is no exclusion set.
                    if (revalidated) { return await this._createAndStage(target, courseHint, isCurrent); }
                    const courseId = this.state.snapshot().courseId;
                    if (courseId === undefined) { return { kind: 'rejected', reason: 'no-course' }; }
                    const probe = await this._probeIn(courseId, decision.sessionId, isCurrent);
                    if (probe.kind === 'stale') { return { kind: 'stale' }; }
                    // 403/5xx/network: the conversation may still exist, so the row
                    // stays and we report rather than silently creating a duplicate.
                    // Without this branch the union is not exhausted and the file
                    // does not type-check.
                    if (probe.kind === 'failed') { return { kind: 'rejected', reason: 'failed' }; }
                    // 400/404: `_probeIn` already forgot the row, so a fresh
                    // conversation is the only remaining outcome.
                    if (probe.kind === 'gone') { revalidated = true; continue; }
                    if (!sameContext(probe.detail.context, decision.target)) {
                        // The index was a hypothesis and it was wrong: another
                        // client repointed this session. Do NOT adopt what came
                        // back; that would hand the student a conversation about
                        // a different exercise. Record the truth we just learned
                        // and start a fresh conversation instead of hunting for
                        // an older candidate (cut 4). Visible state is untouched,
                        // so contentState is still `content`.
                        this.state.updateSummary(summaryOfDetail(probe.detail));
                        revalidated = true;
                        continue;
                    }
                    if (!this._install(probe.detail, probe.guard, isCurrent)) { return { kind: 'stale' }; }
                    return { kind: 'opened', sessionId: decision.sessionId };
                }
            }
        }
    }

    /**
     * Reads a conversation WITHOUT touching visible state. This is what makes
     * revalidation safe: a mismatch, a 404 or a network failure leaves the open
     * conversation exactly as it was.
     */
    /** Takes the ENCLOSING navigation's token; it never opens one of its own. */
    private async _probeIn(courseId: number, sessionId: number, isCurrent: () => boolean): Promise<ProbeResult> {
        // Reserved before the request so the caller installs with a guard that
        // predates anything arriving while it is in flight.
        const guard = this.state.beginLoad();
        try {
            const detail = await this._api.getChatSessionById(courseId, sessionId);
            if (!isCurrent()) { return { kind: 'stale' }; }
            return { kind: 'ok', detail, guard };
        } catch (error) {
            if (!isCurrent()) { return { kind: 'stale' }; }
            // 400 (wrong course / not a chat session) and 404 (absent) mean the
            // row is wrong. 403, 5xx and network failures may be transient and
            // the conversation may still exist, so the row stays and the caller
            // reports rather than forgets.
            if (error instanceof ApiError && (error.status === 400 || error.status === 404)) {
                this._forgetSession(sessionId);
                return { kind: 'gone', error };
            }
            return { kind: 'failed', error };
        }
    }

    /**
     * Cold start: no conversation is open, so there is nothing to stage onto.
     * Acquire through `sessions/current` for the target, then stage the target
     * if a course session came back (empty by construction).
     */
    private async _acquireForTarget(
        target: ServerContext,
        courseHint: number | undefined,
        isCurrent: () => boolean,
    ): Promise<TopicChangeOutcome> {
        // The course must come from the CALLER on a cold start. Deriving it from
        // state alone yields undefined when no conversation is open, which is
        // exactly the situation this row exists for: the dashboard's "Ask Iris
        // about this exercise" knows the course, and discarding it turns the
        // command into a permanent `no-course` rejection.
        const courseId = target.mode === 'COURSE_CHAT'
            ? target.entityId
            : (courseHint ?? this.state.snapshot().courseId);
        if (courseId === undefined) { return { kind: 'rejected', reason: 'no-course' }; }
        const captured = this.state.beginLoad();
        const detail = await this._api.getCurrentChat(target.mode as IrisChatMode, target.entityId, courseId);
        if (!this._install(detail, captured, isCurrent)) { return { kind: 'stale' }; }
        if (!sameContext(detail.context, target) && this.state.contentState() === 'empty') {
            this.state.stagePending(target);
        }
        void this.refreshOverview();
        this._emit();
        return { kind: 'opened', sessionId: detail.sessionId };
    }

    /**
     * Fresh conversation for `target`. Extracted because cut 4 gave it a second
     * caller: a revalidation that came back with a different context creates
     * instead of walking to the next candidate.
     */
    private async _createAndStage(
        target: ServerContext,
        courseHint: number | undefined,
        isCurrent: () => boolean,
    ): Promise<TopicChangeOutcome> {
        const courseId = this.state.snapshot().courseId ?? courseHint;
        if (courseId === undefined) { return { kind: 'rejected', reason: 'no-course' }; }
        const captured = this.state.beginLoad();
        const fresh = await this._api.createCourseSession(courseId);
        if (!this._install(fresh, captured, isCurrent)) { return { kind: 'stale' }; }
        if (!sameContext(target, fresh.context)) { this.state.stagePending(target); }
        this._emit();
        return { kind: 'opened', sessionId: fresh.sessionId };
    }

    private _resolutionInput(target: ServerContext): TopicResolutionInput {
        const snapshot = this.state.snapshot();
        return {
            target,
            courseId: snapshot.courseId,
            currentSessionId: snapshot.currentSessionId,
            committedContext: snapshot.committedContext,
            pendingContext: snapshot.pendingContext,
            contentState: this.state.contentState(),
            findSessionFor: (t) => this.state.findSessionFor(t),
        };
    }

    /**
     * Id-based. The history opens a conversation through this. The course
     * switch cannot: it has no session id yet, so it acquires first (see
     * `switchCourse`). Never consults the topic index.
     * It stages NOTHING: an explicit "open this conversation" outranks passive
     * detection, and cut 2 removed the saved-pending restoration that undo
     * needed.
     */
    public async navigateTo(params: { courseId: number; sessionId: number }): Promise<void> {
        if (this.state.sendInFlight) { return; }
        await this._navigate(async (isCurrent) => {
            // Reading across courses is legitimate here (a history row can name
            // course A while course B is open), so the probe's course is the
            // REQUESTED one, not the currently installed one.
            const probe = await this._probeIn(params.courseId, params.sessionId, isCurrent);
            if (probe.kind === 'stale') { return; }
            if (probe.kind === 'gone' || probe.kind === 'failed') { this._emit(); throw probe.error; }

            if (!this._install(probe.detail, probe.guard, isCurrent)) { return; }
            this._emit();
        });
    }

    /**
     * A course switch has no session id when it begins, so it cannot be a
     * navigateTo. It acquires first and installs the result, which lands on an
     * EMPTY course conversation by construction.
     */
    public async switchCourse(courseId: number): Promise<void> {
        if (this.state.sendInFlight) { return; }
        await this._navigate(async (isCurrent) => {
            const captured = this.state.beginLoad();
            const detail = await this._api.getCurrentChat('COURSE_CHAT', courseId, courseId);
            // setCourse clears knownInvisible; it runs inside installAcquired,
            // AFTER the request, so a failed switch does not throw away the
            // current course's cache and with it the only route to its hidden
            // conversations.
            if (!this._install(detail, captured, isCurrent)) { return; }
            void this.refreshOverview();
            this._emit();
        });
    }

    /**
     * Genuinely single-flight: a second caller joins the outstanding request
     * instead of issuing another. Both `start` and the reload command ask for a
     * refresh, and latest-wins alone would still spend two round trips on the
     * same answer. `_overviewSeq` then guards the install, because a course
     * switch can land between the request and its response.
     */
    public refreshOverview(): Promise<void> {
        const courseId = this.state.snapshot().courseId;
        if (courseId === undefined) { return Promise.resolve(); }
        // Keyed by course. A global single-flight would let a switch to course 43
        // JOIN the outstanding course-42 request, whose response is then correctly
        // discarded by the course check below, so course 43 never gets an
        // overview at all: its history stays empty and the positive lookup misses
        // conversations that exist, creating duplicates.
        if (this._overviewInFlight?.courseId === courseId) { return this._overviewInFlight.promise; }
        const seq = this.state.nextOverviewSeq();
        // `_overviewInFlight` is ONE slot, so a switch to another course
        // overwrites this entry rather than queueing beside it. The cleanup
        // below must therefore identify the request, not merely its course:
        // A1 starts, B replaces it, A2 replaces B, A1 settles, and a
        // course-equality check would clear A2's tracking. The next A refresh
        // would then issue a duplicate request while A2 is still open.
        // `seq` is unique per request, so it is the identity to compare.
        // The overview is a best-effort CACHE, and every caller fires it as
        // `void refreshOverview()`. So it catches internally and always settles
        // successfully: relying on each present and future caller to append
        // `.catch(...)` is how a 500 becomes an unhandled rejection.
        //
        // Also note the shape: the request lives in its own async method and the
        // cleanup is attached with `.finally`, so nothing reads `promise` from
        // inside its own initializer. The previous form did, and would have hit
        // the temporal dead zone if the API ever threw synchronously.
        const promise = this._runOverviewRequest(courseId, seq)
            .catch((error: unknown) => {
                logger.warn('Iris overview refresh failed', LogCategory.IRIS_CHAT, error);
            })
            .finally(() => {
                if (this._overviewInFlight?.seq === seq) { this._overviewInFlight = undefined; }
                // The course may have changed while this was in flight; the new
                // one then still needs its own request.
                const current = this.state.snapshot().courseId;
                if (current !== undefined && current !== courseId) {
                    void this.refreshOverview();
                }
            });
        this._overviewInFlight = { courseId, seq, promise };
        return promise;
    }

    private async _runOverviewRequest(courseId: number, seq: number): Promise<void> {
        const summaries = await this._api.listChatSessionsForCourse(courseId);
        if (this.state.snapshot().courseId !== courseId) { return; }
        // Course equality is not enough on its own: A starts, the student
        // switches to B and back to A, a second A request starts, and the FIRST
        // A response then arrives under a matching course and installs over the
        // newer one. Latest-request-wins as well.
        if (seq !== this.state.overviewSeq) { return; }
        this.state.setOverview(summaries);
        this._emit();
    }

    /** Removes a session the server says is not openable. */
    private _forgetSession(sessionId: number): void {
        this.state.forgetSession(sessionId);
        this._emit();
    }
}
```

Add to `ConversationState`:

```typescript
    /** Drops every local cache. The "Reload Iris chat" escape hatch. */
    public resetCachesForReload(): void {
        this._courseSessions = [];
        this._knownInvisible.clear();
        // `_detail` deliberately SURVIVES until the fresh detail installs over
        // it. Clearing it here opens a hole with no guard behind it:
        // `upsertMessage` returns immediately when `_detail` is undefined, so a
        // USER or LLM frame arriving during the reload GET is simply dropped,
        // and the conversation would report `empty` while the student is
        // looking at their own message. A failed reload would also leave
        // `contentState` stuck at `unknown` forever. This "retain detail until a
        // replacement installs" rule is what keeps the monotonic union of cut 6
        // from ever producing a FALSE EMPTY, so it and its tests stay.
    }

    /** Drops a session from both index sources after a 400/404 open. */
    public forgetSession(sessionId: number): void {
        this._courseSessions = this._courseSessions.filter((s) => s.sessionId !== sessionId);
        this._knownInvisible.delete(sessionId);
    }
```

And the probe result type, declared next to `TopicChangeOutcome`:

```typescript
type ProbeResult =
    | { kind: 'ok'; detail: SessionDetail; guard: GuardTuple }
    /** 400/404: the row is wrong and has been forgotten. */
    | { kind: 'gone'; error: unknown }
    /** 403/5xx/network: the conversation may still exist, so the row stays. */
    | { kind: 'failed'; error: unknown }
    | { kind: 'stale' };
```

Points the implementer must not paraphrase away:

- **`beginNavigation` is a commit point.** It runs only inside `_install`, after a successful `GET`. Calling it before a request is the exact defect this task exists to avoid: it wipes the detail, `contentState()` drops to `unknown`, and `resolveTopic` then answers `refuse/loading` forever instead of creating a conversation. Revalidation would silently stop working.
- **`_probe` never mutates visible state.** A mismatch, a 403, a 5xx or a dropped connection leaves the open transcript exactly as it was. This is also what makes the 403/5xx rule of spec §12 real: keeping the row is pointless if the conversation the student was reading has already been thrown away.
- **Every acquisition path goes through `_install`,** which is the only place that subscribes to the websocket. The old model did this inside `initializeSession`, which Task 7 deletes; skipping it means a conversation can POST but never receives an answer.
- `refreshOverview` guards on both `_overviewSeq` and the requested `courseId`. The sequence alone would let a slow course-A response win whenever no newer refresh had started.
- `navigateTo` rethrows so the provider can surface `openSessionError`. `resolveTopicChange` never throws and reports through `TopicChangeOutcome` instead, because the dispatcher needs an outcome to act on (it decides whether to raise the navigation notice), not an exception.

- [ ] **Step 5: Construct the service in the provider, routed to nothing**

Tasks 6, 8 and 10 all need `IrisConversationService` to exist on the provider. Constructing it only at the Task 14 cut-over is what makes those three commits impossible to keep green, so it is constructed here and simply not routed to yet. Baseline field names, verified at `5ec22370`: the API service is `_artemisApiService` (optional), the session client is `_irisSessionManager` (optional, created in `resolveWebviewView`), the run machine is `_runs`, the handler is `_websocketMessageHandler`, the store is `_contextStore`.

```typescript
    private _conversation: IrisConversationService | undefined;

    /** Called where `_irisSessionManager` is created, so both exist together. */
    private _createConversationService(client: IrisWebSocketSessionClient): IrisConversationService | undefined {
        if (!this._artemisApiService) { return undefined; }
        return new IrisConversationService(this._artemisApiService, {
            subscribeToSession: (sessionId) => client.subscribeToSession(sessionId),
            getWorkspaceExercise: () => {
                const exercise = this._contextStore.getWorkspaceExercise();
                return exercise?.courseId === undefined
                    ? undefined
                    : { exerciseId: exercise.id, courseId: exercise.courseId };
            },
        });
    }
```

Both dependencies are optional at baseline, so the service is too. Every later consumer therefore guards on it rather than assuming it, and the old path keeps running untouched when Iris is unavailable.

Give the service a `dispose()` that disposes `_onDidChange` and clears `_overviewInFlight`; the provider pushes it onto `_disposables` **before** the session client, so no install can subscribe to a disposed client.

**Wire the subscription-active signal here, not in Task 8.** `subscribeToSession` only records intent, so an install can complete while the STOMP subscription is still pending or being retried after a throw, and a CTXSWAP in that gap is simply never heard. The client already fires `onDidResubscribe(sessionId)` when a subscription genuinely becomes active, which is the one moment that is true for both a first subscribe and a reconnect:

```typescript
        this._disposables.push(
            client.onDidResubscribe((sessionId) => conversation.onSubscriptionActive(sessionId)),
        );
```

This is the production caller for `reconcileCurrent`. Without it that method exists only in its own tests, and spec §7.7's rule ("subscribe before adopting the snapshot, or reconcile a second time after subscribing") is satisfied on paper only.

Nothing calls `start`, `resolveTopicChange` or `navigateTo` yet. That happens in Task 14.

- [ ] **Step 6: Run the tests**

Run: `npm run compile-tests && npx vscode-test --label unit --grep "IrisConversationService"`
Expected: PASS.

- [ ] **Step 7: Commit**

Run the full gate first: `npm run check-types && npm run lint && npm run test:unit && npm run test:react`.

```bash
git add src/extension/services/iris/conversation/ src/extension/provider/chatWebviewProvider.ts test/unit/services/iris/conversation/
git commit -m "feat(iris): conversation service with revalidated navigation"
```

---

## Task 6: Websocket frames carry their source session

**Files:**
- Modify: `src/extension/services/websocket/subscriptionRegistry.ts`
- Modify: `src/extension/services/websocket/artemisWebsocketService.ts:56`
- Modify: `src/extension/services/iris/transport/irisWebSocketSessionClient.ts`
- Modify: `src/extension/services/iris/chat/irisWebSocketMessageHandler.ts:64-115`
- Modify: `src/extension/provider/chatWebviewProvider.ts` (the handler's constructor call and the `onDidReceiveMessage` listener)

The handler gains a **getter** `getConversation: () => IrisConversationService | undefined`, its `handleIrisWebSocketMessage` gains a second parameter, and the client's `onDidReceiveMessage` payload becomes `{ frame, sourceSessionId }`. All three are breaking, so the provider's construction and its listener change **in this commit**, not in Task 14.

A getter, not a value, and this is not a style preference. The handler is built in the provider's **constructor** (`chatWebviewProvider.ts:251`), while `_conversation` is built in `resolveWebviewView` alongside `_irisSessionManager`. Passing by value would capture `undefined` forever. The baseline already does exactly this for the session client (`() => this._irisSessionManager`), so the getter is the house pattern.

**The new path stays dormant until Task 14 cuts over.** Between here and there, acquisition still runs through the old model, so `ConversationState.currentSessionId` is `undefined` and a source check against it would drop every single frame. Gate on the service being *active*:

```typescript
private get _activeConversation(): IrisConversationService | undefined {
    const conversation = this._getConversation();
    // Not merely "does the service exist": until Task 14 nothing calls start(),
    // so it exists with no session, and treating that as authoritative would
    // drop every frame the old path is still relying on.
    return conversation?.state.snapshot().currentSessionId !== undefined ? conversation : undefined;
}
```

The source check, the CTXSWAP branch and the host-state ingestion all run only when `_activeConversation` is defined. Otherwise the handler behaves exactly as at baseline. From Task 14 the old path is gone and the guard is always satisfied.
- Test: `test/logic/iris/irisWebSocketMessageHandler.test.ts` (extend), `test/logic/iris/irisWebSocketSessionClient.resubscribe.test.ts` (extend)

**Interfaces:**
- Consumes: `parseContextSwap` (Task 2), `ConversationState` (Task 3).
- Produces: `IrisWebSocketMessageHandler.handleIrisWebSocketMessage(data, sourceSessionId)`; `IrisWebSocketSessionClient.subscribeToSession(sessionId)` without any `ActiveContext`.

- [ ] **Step 1: Write the failing frame tests**

Add to `test/logic/iris/irisWebSocketMessageHandler.test.ts`:

```typescript
describe('session-scoped frames', () => {
    it('drops every frame whose source is not the current session', () => {
        const { handler, posted } = makeHandler({ currentSessionId: 7 });
        handler.handleIrisWebSocketMessage({ type: 'MESSAGE', runId: 'r1', message: { id: 1, sender: 'LLM', content: [{ textContent: 'x' }] } }, 3);
        expect(posted).toHaveLength(0);
    });

    it('drops a stale CTXSWAP frame too, not only assistant frames', () => {
        const { handler, state } = makeHandler({ currentSessionId: 7 });
        handler.handleIrisWebSocketMessage(ctxswapFrame(EX5), 3);
        expect(state.snapshot().committedContext).toBeUndefined();
    });

    it('drops a stale frame BEFORE the run machine can admit its run', () => {
        // Otherwise an unknown run from the conversation just left binds as
        // current (irisRunStateMachine.ts:32-48) and the composer hangs.
        const { handler, runs } = makeHandler({ currentSessionId: 7 });
        handler.handleIrisWebSocketMessage({ type: 'STATUS', runId: 'ghost' }, 3);
        expect(runs.currentRunId).toBeUndefined();
    });
});

describe('CTXSWAP frames', () => {
    it('updates the committed context and bumps the revision', () => {
        const { handler, state } = makeHandler({ currentSessionId: 7 });
        const before = state.guard().contextRevision;
        handler.handleIrisWebSocketMessage(ctxswapFrame(EX5), 7);
        expect(state.snapshot().committedContext).toEqual(EX5);
        expect(state.guard().contextRevision).toBe(before + 1);
    });

    it('never finalizes the run', () => {
        // The server pushes the marker WHILE our own POST is open, so today a
        // successful first message terminates its own run.
        const { handler, runs } = makeHandler({ currentSessionId: 7 });
        runs.beginGeneration();
        handler.handleIrisWebSocketMessage(ctxswapFrame(EX5), 7);
        expect(runs.waiting).toBe(true);
    });

    it('appends a marker row to the transcript', () => {
        const { handler, posted } = makeHandler({ currentSessionId: 7 });
        handler.handleIrisWebSocketMessage(ctxswapFrame(EX5), 7);
        expect(posted.at(-1)).toMatchObject({ type: 'addMessage', message: { role: 'contextSwap' } });
    });

    it('derives the course context from a removed marker', () => {
        const { handler, state } = makeHandler({ currentSessionId: 7, courseId: 42 });
        handler.handleIrisWebSocketMessage(ctxswapFrame(undefined, 'removed'), 7);
        expect(state.snapshot().committedContext).toEqual({ mode: 'COURSE_CHAT', entityId: 42 });
    });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run test/logic/iris/irisWebSocketMessageHandler.test.ts`
Expected: FAIL, `handleIrisWebSocketMessage` takes one argument.

- [ ] **Step 3: Thread the source session id through the transport**

`subscriptionRegistry.ts` already knows the id it subscribed with and discards it before invoking the handler. Change `subscribeToIrisSession(id, onMessage)` so the callback receives it:

```typescript
public subscribeToIrisSession(id: number, onMessage: (m: unknown, sourceSessionId: number) => void): () => void {
    return this._subscribe(`/user/topic/iris/${id}`, (payload) => onMessage(payload, id));
}
```

Mirror the signature on `ArtemisWebsocketService.subscribeToIrisSession` and in `IrisWebSocketSessionClient._subscribeIfConnected`, whose emitter becomes:

```typescript
private readonly _onDidReceiveMessage = new vscode.EventEmitter<{ frame: IrisWebSocketMessage; sourceSessionId: number }>();
```

`initializeSession(context, storedSessionId)` and `createNewSession(context)` stay for now. Acquisition has moved to `IrisConversationService` (Task 5), but `chatSessionService.ts` and `chatMessageService.ts` still call them until Task 14, so deleting them here makes this commit red. They are removed in Task 15, together with the `ActiveContext` and `contextToIrisMode` imports.

- [ ] **Step 4: Give the session client latest-wins subscription semantics**

`_subscribeIfConnected` (`irisWebSocketSessionClient.ts:124`) rate-limits to one attempt per 3 s and, when it hits the limit or finds the socket disconnected, simply **returns**. Nothing retries, and the caller's promise resolves as if it had worked. Two consequences the new model cannot live with:

- A second navigation within 3 s silently leaves the transport on the previous conversation, and `_install` commits a conversation with no subscription at all. Every assistant frame for it is then dropped by the source-session check, so the answer never appears.
- Two attempts can settle in reverse order, leaving the older one's subscription installed.

Replace "attempt or drop" with "record the desired session, converge towards it":

```typescript
    /** The conversation we WANT. Set synchronously, converged towards after. */
    private _desiredSessionId?: number;
    /** The conversation the CURRENT STOMP connection is actually subscribed to. */
    private _subscribedSessionId?: number;
    private _convergeTimer?: ReturnType<typeof setTimeout>;

    public subscribeToSession(sessionId: number): void {
        // Synchronous, so a caller can rely on the intent being recorded even
        // when the STOMP subscribe is deferred.
        this._desiredSessionId = sessionId;
        this._currentArtemisSessionId = sessionId;
        // A deliberate navigation is NOT rate-limited. The 3 s window exists to
        // damp reconnect storms, not to throttle a student switching
        // conversations; delaying it leaves the newly opened conversation
        // subscription-less for up to three seconds, during which its answer is
        // dropped by the source check and simply never appears.
        this._converge({ immediate: true });
    }

    /**
     * Every (re)connect creates a FRESH STOMP session, so every prior protocol
     * subscription is gone whether or not we were told about the disconnect.
     * The baseline resubscribes unconditionally on `connected: true` for exactly
     * this reason: the disconnect notification is debounced by 5 s and a fast
     * reconnect may arrive first, so keying the invalidation on `connected:
     * false` misses it, `_converge` sees subscribed === desired, returns, and
     * the client is permanently deaf on the new connection with no error.
     */
    private _onConnectionStateChanged(connected: boolean): void {
        this._subscribedSessionId = undefined;
        this._irisUnsubscribe = undefined;
        if (connected) { this._converge({ immediate: true }); }
    }

    private _converge(options: { immediate?: boolean } = {}): void {
        const desired = this._desiredSessionId;
        if (desired === undefined) { return; }
        if (this._subscribedSessionId === desired) { return; }
        if (!this._websocketService.isConnected()) { return; }   // the monitor re-converges

        const waited = Date.now() - this._lastResubscribeAttempt;
        if (!options.immediate && waited < MIN_RESUBSCRIBE_INTERVAL_MS) {
            // SCHEDULE, never drop. Dropping is what left a conversation
            // permanently unsubscribed after a fast second switch.
            if (!this._convergeTimer) {
                this._convergeTimer = setTimeout(() => {
                    this._convergeTimer = undefined;
                    this._converge();
                }, MIN_RESUBSCRIBE_INTERVAL_MS - waited);
            }
            return;
        }

        this.unsubscribe();
        this._subscribedSessionId = undefined;
        this._lastResubscribeAttempt = Date.now();
        try {
            this._irisUnsubscribe = this._websocketService.subscribeToIrisSession(
                desired,
                (data, sourceSessionId) => this._handleWebSocketMessage(data, sourceSessionId),
            );
        } catch (error) {
            // We already tore the old subscription down, so a throw here leaves
            // ZERO subscriptions. Retry rather than leaving the conversation
            // silently deaf.
            logger.sessionError('Subscribe failed, retrying', error);
            this._scheduleConverge();
            return;
        }
        this._subscribedSessionId = desired;
        // The desire may have moved while we were subscribing.
        if (this._desiredSessionId !== desired) { this._converge({ immediate: true }); }
        else { this._onDidResubscribe.fire(desired); }
    }

    private _scheduleConverge(): void {
        if (this._convergeTimer) { return; }
        this._convergeTimer = setTimeout(() => {
            this._convergeTimer = undefined;
            this._converge();
        }, MIN_RESUBSCRIBE_INTERVAL_MS);
    }
```

`resetSession()` clears `_desiredSessionId`, `_subscribedSessionId`, `_currentArtemisSessionId` and the timer (assigning `_convergeTimer = undefined` after `clearTimeout`), otherwise a later reconnect resurrects a session that was deliberately reset. Public `unsubscribe()` also clears `_subscribedSessionId`: leaving it set means a later `subscribeToSession` for the same id sees subscribed === desired and returns without resubscribing. `dispose()` clears the timer. `_startWebSocketMonitoring` calls `_onConnectionStateChanged(connected)` for **both** values, replacing the old `_subscribeIfConnected(id, true)`.

**The retained old acquisition must establish the desire.** `initializeSession` and `createNewSession` survive until Task 15 and today call `_subscribeIfConnected` directly. Point both at `subscribeToSession(sessionId)` instead, or between Tasks 6 and 13 the old model never sets `_desiredSessionId` and a reconnect converges toward nothing.

Tests:

```typescript
    it('never leaves a conversation unsubscribed after a fast switch', async () => {
        const client = makeClient({ connected: true });
        client.subscribeToSession(3);
        client.subscribeToSession(4);
        await advanceTimersBy(MIN_RESUBSCRIBE_INTERVAL_MS);
        expect(ws.activeSubscriptionCount).toBe(1);
    });

    it('resubscribes on the new connection after a reconnect', () => {
        const client = makeClient({ connected: true });
        client.subscribeToSession(7);
        ws.dropConnection();
        ws.restoreConnection();
        expect(ws.activeSubscriptionCount).toBe(1);
        expect(ws.subscribedIds.at(-1)).toBe(7);
    });

    it('resubscribes on a connected:true that was never preceded by connected:false', () => {
        // The disconnect notification is debounced by 5 s, so a fast reconnect
        // reports `true` first. Keying invalidation on `false` leaves the client
        // permanently deaf on the new connection, silently.
        const client = makeClient({ connected: true });
        client.subscribeToSession(7);
        ws.emitConnectionState(true);          // no preceding false
        expect(ws.subscribedIds.filter((id) => id === 7)).toHaveLength(2);
    });

    it('retries when the subscribe call throws, instead of leaving zero subscriptions', async () => {
        const client = makeClient({ connected: true, subscribeThrowsOnce: true });
        client.subscribeToSession(7);
        expect(ws.activeSubscriptionCount).toBe(0);
        await advanceTimersBy(MIN_RESUBSCRIBE_INTERVAL_MS);
        expect(ws.activeSubscriptionCount).toBe(1);
    });

    it('a deliberate navigation is not delayed by the rate limit', () => {
        // The window damps reconnect storms; throttling a student's switch would
        // leave the new conversation deaf for up to three seconds.
        const client = makeClient({ connected: true });
        client.subscribeToSession(3);
        client.subscribeToSession(4);
        expect(ws.subscribedIds.at(-1)).toBe(4);
    });

    it('resetSession stops a later reconnect from resurrecting the session', () => {
        const client = makeClient({ connected: true });
        client.subscribeToSession(7);
        client.resetSession();
        ws.dropConnection();
        ws.restoreConnection();
        expect(ws.activeSubscriptionCount).toBe(0);
    });
```

- [ ] **Step 5: Classify at the transport boundary**

In `irisWebSocketMessageHandler.ts`, the order is part of the fix. Rewrite the entry point:

```typescript
public handleIrisWebSocketMessage(data: unknown, sourceSessionId: number): void {
    if (!isIrisWebSocketMessage(data) || typeof data.type !== 'string') {
        logger.info(`Unknown message format: ${JSON.stringify(data)}`, LogCategory.WEBSOCKET);
        return;
    }

    // 1. Source check FIRST: before admission, before run state, before the
    //    title handler. A frame from the conversation we just left must not be
    //    able to bind an unknown run as current or rename the live session.
    //    Everything in this block happens ONLY while the new model is driving. Before the
    //    Task 14 cut-over the old path still owns acquisition, so
    //    ConversationState has no session and a source check against it would
    //    drop every frame. Skipping this block means "behave as the baseline".
    const conversation = this._activeConversation;
    if (conversation !== undefined) {
        const current = conversation.state.snapshot().currentSessionId;
        if (sourceSessionId !== current) {
            logger.info(`Dropped frame from session ${sourceSessionId} (current ${String(current)})`, LogCategory.WEBSOCKET);
            return;
        }
        // 2. A context-swap marker is not chat and never touches run state.
        if (data.type === 'MESSAGE' && data.message && isContextSwap(data.message)) {
            this._handleContextSwap(conversation, data.message);
            return;
        }
        // 3. Anything else carrying a body is CONTENT, whatever we draw. Placed
        //    here so the USER-echo, bodiless-answer and ARTIFACT early returns
        //    further down cannot skip it.
        if (data.type === 'MESSAGE' && data.message) {
            conversation.state.upsertMessage(data.message);
        }
    }

    // From here on the baseline body is UNCHANGED and is not restated: keep
    // irisWebSocketMessageHandler.ts:70-97 exactly as it is (the admission
    // check, `_handleSessionTitle`, the run-state mirror, and the PARTIAL /
    // STATUS / MESSAGE switch). The block above is inserted in front of it and
    // is the entire change to this method. Do not move or reorder anything
    // below; the admission-before-title ordering there carries its own comment
    // explaining why a stale run must not rename the live session.
}

private _handleContextSwap(conversation: IrisConversationService, message: IrisChatMessage): void {
    const swap = parseContextSwap(message);
    if (!swap) {
        // Undecodable marker: it is still content on the server, so reload the
        // detail rather than guess. Never fall through to the chat path.
        //
        // `reload` refuses while a send is unresolved and defers itself, which
        // matters here: the server writes this marker WHILE our own POST is
        // open, so an ungated reload would navigate mid-send and walk straight
        // past the dispatcher gating of spec 7.3.
        void conversation.reload();
        return;
    }
    const outcome = conversation.state.applyContextSwap(swap, message);
    this._postMessage({
        type: ExtensionMsg.AddMessage,
        sessionId: conversation.state.snapshot().currentSessionId!,
        message: {
            id: message.id,
            role: 'contextSwap',
            content: describeContextSwap(swap),
            timestamp: message.sentAt ? new Date(message.sentAt).getTime() : Date.now(),
        },
    });
    if (outcome === 'pending-dropped') {
        // Informative only, no undo: the marker itself makes the conversation
        // non-empty, so the staging could never be restored.
        this._postMessage({
            type: ExtensionMsg.ShowChatNotice,
            text: 'Das Thema wurde anderweitig geaendert. Deine Vormerkung wurde verworfen.',
        });
    }
    conversation.notifyChanged();
}
```

The `pending-dropped` notice has **no action**. An undo could never work: the marker itself makes the conversation non-empty, so the staging could not be restored. The navigation notice (Task 12) is a different, also actionless, notice.

- [ ] **Step 6: Route the title update through `updateSummary`**

`_handleSessionTitle` currently calls `_onSessionTitleUpdate`, which wrote into the deleted local session store. Point it at the conversation state instead, so the history row and the header agree:

```typescript
        const conversation = this._activeConversation;
        if (!conversation) {
            // Coexistence until Task 14: the old model still owns the title, and
            // returning here would silently disable renaming for eight commits.
            this._onSessionTitleUpdate?.(artemisSessionId, sessionTitle);
            return;
        }
        conversation.state.setTitle(sessionTitle);
```

Define it on `ConversationState`:

```typescript
    /** Title changes are a summary lifecycle event, like context changes. */
    public setTitle(title: string): void {
        if (!this._detail) { return; }
        this._detail = { ...this._detail, title };
        this.updateSummary({ ...summaryOfDetail(this._detail) });
    }
```

It writes `_detail.title` and calls `updateSummary` with it, which is the lifecycle requirement of spec §3.1 ("updated on every accepted detail, CTXSWAP **or title change**"). Without it a renamed conversation keeps its old label in the history until the next overview refresh.

- [ ] **Step 7: Record every accepted frame in host state, not only in the webview**

`_handleMessage` posts an `addMessage` to the webview and stops there. Host `ConversationState` therefore never learns about the assistant's answer, so a conversation whose only content is Iris's reply reports `empty`, the picker stages onto it, and the next send rehomes it. Add the upsert on the accepted path, next to the existing post:

```typescript
        // Already shown in the entry point above, at step 3. The call is
        // `conversation.state.upsertMessage(data.message)`; it is NOT repeated
        // inside _handleMessage, whose early returns are what it must precede.
```

**Placement is the whole point, and it is not where the rendering happens.** Put it immediately after the source-session check and the CTXSWAP branch, before any sender or content branching. The baseline `_handleMessage` returns early in three places that would each skip it:

- `msg.sender === 'USER'` returns before finalization. That branch exists so an echoed prompt does not terminate its own run, and it is correct for RENDERING. But a user message typed in the Artemis web client arrives on this path, and skipping it means an empty conversation gains content elsewhere while the extension keeps reporting `empty`, so the next pick or send rehomes it.
- `if (!content)` returns for a bodiless persisted answer, which is still a persisted message and still content.
- `ARTIFACT` messages render as assistant text but count as content in their own right (spec §3.3).

So: ingest every accepted `MESSAGE` frame that carries a message body, then let the existing branches decide what to draw. Rendering may still suppress the USER echo; host ownership state must not.

Add the test:

```typescript
    it('an assistant frame makes the host conversation non-empty', () => {
        const { handler, state } = makeHandler({ currentSessionId: 7 });
        handler.handleIrisWebSocketMessage(
            { type: 'MESSAGE', runId: 'r1', message: { id: 12, sender: 'LLM', content: [{ textContent: 'x', type: 'text' }] } },
            7,
        );
        expect(state.contentState()).toBe('content');
    });

    it('a USER frame from another client makes the host conversation non-empty', () => {
        // It is not rendered (the echo would duplicate the local bubble), but it
        // IS content, and contentState is the ownership predicate.
        const { handler, state, posted } = makeHandler({ currentSessionId: 7 });
        handler.handleIrisWebSocketMessage(
            { type: 'MESSAGE', message: { id: 13, sender: 'USER', content: [{ textContent: 'hi', type: 'text' }] } },
            7,
        );
        expect(state.contentState()).toBe('content');
        expect(posted.filter((p) => p.type === 'addMessage')).toHaveLength(0);
    });

    it('a bodiless persisted answer still counts as content', () => {
        const { handler, state } = makeHandler({ currentSessionId: 7 });
        handler.handleIrisWebSocketMessage({ type: 'MESSAGE', runId: 'r1', message: { id: 14, sender: 'LLM' } }, 7);
        expect(state.contentState()).toBe('content');
    });

    it('a dropped stale frame does not touch host state', () => {
        const { handler, state } = makeHandler({ currentSessionId: 7 });
        handler.handleIrisWebSocketMessage(
            { type: 'MESSAGE', runId: 'r1', message: { id: 12, sender: 'LLM', content: [{ textContent: 'x', type: 'text' }] } },
            3,
        );
        expect(state.contentState()).toBe('empty');
    });
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run test/logic/iris/`
Expected: PASS.

- [ ] **Step 9: Commit**

The old `initializeSession` and `createNewSession` on the websocket client are **kept** here, still calling the API, because `chatSessionService.ts` and `chatMessageService.ts` still invoke them until Task 14. Only the subscription signature and the handler change in this commit. Deleting them now is what would make this commit red.

```bash
git add src/extension/services/websocket/ src/extension/services/iris/transport/ \
        src/extension/services/iris/chat/irisWebSocketMessageHandler.ts \
        src/extension/provider/chatWebviewProvider.ts test/logic/iris/ test/unit/services/websocket.test.ts
git commit -m "fix(iris): scope websocket frames to their session and classify context swaps"
```

---

## Task 7: Send carries the staged topic, and nothing else runs beside it

**Files:**
- Create: `src/extension/services/iris/conversation/sendCoordinator.ts`
- Modify: `src/extension/services/iris/chat/chatMessageService.ts`
- Test: `test/unit/services/iris/conversation/sendCoordinator.test.ts` (create)

**Interfaces:**
- Consumes: `ArtemisApiService.sendChatMessage` (Task 1), `ConversationState` (Task 3), `IrisConversationService` (Task 5).
- Produces: `SendCoordinator.send(input)`, plus these exported types:

```typescript
export type SendRejection =
    | 'send-in-flight'
    | 'navigation-in-flight'
    | 'no-conversation'
    /** The open conversation changed between composing and handling. */
    | 'conversation-changed'
    | 'rate-limit'
    /** Local setup failed; nothing was sent, so nothing is ambiguous. */
    | 'preparation-failed';

export type SendOutcome =
    | { kind: 'sent'; messageId: number | undefined }
    | { kind: 'rejected'; reason: SendRejection }
    /** The POST started and its result is genuinely unknowable. */
    | { kind: 'unknown' };

export interface SendDeps {
    runLifecycle: RunLifecycle;
    resetRunUiAndPublish(): void;
    collectUncommittedFiles(): Promise<Map<string, string> | undefined>;
    /** All three address the ORIGIN session, never "whatever is open now". */
    confirmBubble(sessionId: number, localId: string, messageId: number | undefined): void;
    failBubble(sessionId: number, localId: string, reason: SendRejection | 'unknown'): void;
    reportError(message: string): void;
    getWorkspaceExerciseId(): number | undefined;
}

/** `sessionId` is the conversation the optimistic bubble was drawn in. */
export interface SendInput { text: string; localId: string; sessionId: number }
```

The wire command carries it too: `sendMessage` in `webviewCommands.ts` gains `sessionId?: number`, filled by the webview from its open conversation. Optional, because Task 10 is additive; Task 15 makes it required with the rest.

And the predicate as a method, not prose:

```typescript
    /** Uncommitted files travel only when the topic IS the open workspace. */
    private _isWorkspaceContext(ctx: ServerContext | undefined): boolean {
        return ctx?.mode === 'PROGRAMMING_EXERCISE_CHAT'
            && ctx.entityId === this._deps.getWorkspaceExerciseId();
    }
```

The webview contract must accept the new reasons: widen `sendRejected.reason` in Task 10 to `'no-ai' | 'no-context' | 'iris-disabled' | 'iris-unavailable' | 'rate-limit' | 'preparation-failed' | 'unknown'`, and widen `ChatMessage.errorReason` in `views/IrisChat/types.ts` to match. Leaving them narrow means the coordinator cannot report what it just decided.

This task carries local findings **6** (send lock vs newer pending) and **9** (reconciliation-failure cleanup).

- [ ] **Step 1: Write the failing send tests**

Create `test/unit/services/iris/conversation/sendCoordinator.test.ts`:

```typescript
suite('SendCoordinator', () => {
    test('sends the staged context and commits exactly it', async () => {
        const c = await coordinatorWith({ committed: COURSE42, pending: EX5 });
        const sent = c.send({ text: 'hallo', localId: 'l1', sessionId: 1 });
        assert.deepStrictEqual(c.api.lastSend?.pendingContext, EX5);
        c.api.resolveSend({ id: 11 });
        await sent;
        assert.deepStrictEqual(c.state.snapshot().committedContext, EX5);
        assert.strictEqual(c.state.snapshot().pendingContext, undefined);
    });

    test('a self CTXSWAP arriving before the response leaves the context alone', async () => {
        const c = await coordinatorWith({ committed: COURSE42, pending: EX5 });
        const sent = c.send({ text: 'hallo', localId: 'l1', sessionId: 1 });
        c.state.applyContextSwap({ transition: 'added', context: EX5 }, swapMessage(20, { transition: 'added' }));
        c.api.resolveSend({ id: 11 });
        await sent;
        assert.deepStrictEqual(c.state.snapshot().committedContext, EX5);
    });

    test('a response arriving after a DIFFERENT CTXSWAP does not overwrite it', async () => {
        const c = await coordinatorWith({ committed: COURSE42, pending: EX5 });
        const sent = c.send({ text: 'hallo', localId: 'l1', sessionId: 1 });
        c.state.applyContextSwap({ transition: 'added', context: EX7 }, swapMessage(20, { transition: 'added' }));
        c.api.resolveSend({ id: 11 });
        await sent;
        assert.deepStrictEqual(c.state.snapshot().committedContext, EX7);
    });

    test('a session switch mid-request discards the write-back', async () => {
        const c = await coordinatorWith({ committed: COURSE42, pending: EX5 });
        const sent = c.send({ text: 'hallo', localId: 'l1', sessionId: 1 });
        c.state.beginNavigation(99);
        c.api.resolveSend({ id: 11 });
        await sent;
        assert.strictEqual(c.state.snapshot().committedContext, undefined);
    });

    test('a detail load started before a completed send does not suppress its write-back', async () => {
        const c = await coordinatorWith({ committed: COURSE42, pending: EX5 });
        // beginLoad, not guard: guard() carries ticket 0 and would be rejected
        // for that reason alone, so the test would pass without ever exercising
        // the sendSeq guard it claims to be about.
        const staleGuard = c.state.beginLoad();
        const sent = c.send({ text: 'hallo', localId: 'l1', sessionId: 1 });
        await tick();
        c.api.resolveSend({ id: 11 });
        await sent;
        const installed = c.state.installDetail(
            { sessionId: 1, courseId: 42, context: COURSE42, lastActivity: 1000, messages: [] },
            staleGuard,
        );
        assert.strictEqual(installed, false);
        assert.deepStrictEqual(c.state.snapshot().committedContext, EX5);
    });

    test('a second send is rejected even while the FIRST is still collecting files', async () => {
        // The lock must be taken before the first await of any kind. With
        // collection first, both sends observe sendInFlight === false, both wait,
        // and both POST.
        // pending EX5 IS the workspace exercise, so _isWorkspaceContext holds and
        // collection actually runs. With committed COURSE42 and no pending it
        // does not, and these tests would silently be about the open POST instead.
        const c = await coordinatorWith({ committed: COURSE42, pending: EX5, workspaceExerciseId: 5, slowFileCollection: true });
        const first = c.send({ text: 'a', localId: 'l1', sessionId: 1 });
        const second = await c.send({ text: 'b', localId: 'l2', sessionId: 1 });
        assert.deepStrictEqual(second, { kind: 'rejected', reason: 'send-in-flight' });
        c.releaseFileCollection();
        await tick();
        c.api.resolveSend({ id: 11 });
        await first;
        assert.strictEqual(c.api.sendCount, 1);
    });

    test('a navigation is rejected while the first send is still collecting files', async () => {
        // pending EX5 IS the workspace exercise, so _isWorkspaceContext holds and
        // collection actually runs. With committed COURSE42 and no pending it
        // does not, and these tests would silently be about the open POST instead.
        const c = await coordinatorWith({ committed: COURSE42, pending: EX5, workspaceExerciseId: 5, slowFileCollection: true });
        const first = c.send({ text: 'a', localId: 'l1', sessionId: 1 });
        assert.deepStrictEqual(await c.conversation.resolveTopicChange(EX7), { kind: 'rejected', reason: 'send-in-flight' });
        c.releaseFileCollection();
        await tick();
        c.api.resolveSend({ id: 11 });
        await first;
    });

    test('a throw inside file collection aborts the generation and is not an ambiguous send', async () => {
        const c = await coordinatorWith({ committed: COURSE42, pending: EX5, workspaceExerciseId: 5, fileCollectionThrows: true });
        const outcome = await c.send({ text: 'a', localId: 'l1', sessionId: 1 });
        assert.deepStrictEqual(outcome, { kind: 'rejected', reason: 'preparation-failed' });
        assert.strictEqual(c.runLifecycle.aborted.length, 1);
        assert.strictEqual(c.state.sendInFlight, false);
        // Nothing was sent, so nothing is ambiguous and no GET is spent.
        assert.strictEqual(c.api.deferred.filter((d) => d.call.startsWith('detail:')).length, 0);
    });

    test('a send never writes into a conversation that was navigated away from', async () => {
        // The POST lands in session 1 while the view moved to session 9. Writing
        // the persisted message into state unconditionally would put session 1's
        // message into session 9's transcript.
        const c = await coordinatorWith({ committed: COURSE42 });
        const sent = c.send({ text: 'a', localId: 'l1', sessionId: 1 });
        await tick();
        c.state.beginNavigation(9);
        c.api.resolveSend({ id: 11 });
        await sent;
        assert.strictEqual(c.state.snapshot().detail, undefined);
    });

    test('a second send is rejected while one is in flight', async () => {
        const c = await coordinatorWith({ committed: COURSE42 });
        const first = c.send({ text: 'a', localId: 'l1', sessionId: 1 });
        const second = await c.send({ text: 'b', localId: 'l2', sessionId: 1 });
        assert.deepStrictEqual(second, { kind: 'rejected', reason: 'send-in-flight' });
        c.api.resolveSend({ id: 11 });
        await first;
    });

    test('every topic change is rejected while a send is unresolved', async () => {
        // Local finding 6: the alternative ("a newer pending staged mid-request
        // survives") conflicts with invariant 4, because a successful send gives
        // the conversation content. One rule, applied to every consumer.
        const c = await coordinatorWith({ committed: COURSE42 });
        const sending = c.send({ text: 'a', localId: 'l1', sessionId: 1 });
        const rejected = await c.conversation.resolveTopicChange(EX7);
        assert.deepStrictEqual(rejected, { kind: 'rejected', reason: 'send-in-flight' });
        c.api.resolveSend({ id: 11 });
        await sending;
    });

    test('a send is refused while a navigation load is in flight', async () => {
        const c = await coordinatorWith({ committed: COURSE42 });
        void c.conversation.navigateTo({ courseId: 42, sessionId: 9 });
        const outcome = await c.send({ text: 'a', localId: 'l1', sessionId: 1 });
        assert.deepStrictEqual(outcome, { kind: 'rejected', reason: 'navigation-in-flight' });
    });

    test('an ambiguous failure adopts the detail, reports unknown and keeps the text', async () => {
        const c = await coordinatorWith({ committed: COURSE42, pending: EX5 });
        const sent = c.send({ text: 'hallo', localId: 'l1', sessionId: 1 });
        await tick();                       // let file collection and the POST start
        c.api.rejectSend(new Error('socket hang up'));
        await tick();                       // let the catch path issue the detail GET
        c.api.resolveCall('detail:42:1', { sessionId: 1, courseId: 42, context: EX5, lastActivity: 1000, messages: [{ id: 11, sender: 'USER' }] });
        const outcome = await sent;
        assert.deepStrictEqual(outcome, { kind: 'unknown' });
        assert.strictEqual(c.composerTextCleared, false);
        assert.strictEqual(c.state.snapshot().pendingContext, undefined);
        assert.strictEqual(c.resentCount, 0);
    });

    test('a divergent pending dies once ANY content exists, whoever wrote it', async () => {
        const c = await coordinatorWith({ committed: COURSE42, pending: EX5 });
        const sent = c.send({ text: 'hallo', localId: 'l1', sessionId: 1 });
        await tick();
        c.api.rejectSend(new Error('socket hang up'));
        await tick();
        // Another client wrote a message; ours never arrived. A retry would
        // rehome THEIR content, so the staging cannot survive.
        c.api.resolveCall('detail:42:1', { sessionId: 1, courseId: 42, context: COURSE42, lastActivity: 1000, messages: [{ id: 99, sender: 'USER' }] });
        await sent;
        assert.strictEqual(c.state.snapshot().pendingContext, undefined);
    });

    test('a failed reconciliation releases the lock, clears the bubble and bumps sendSeq', async () => {
        // Local finding 9: "change nothing" would leave the send lock latched
        // and the optimistic bubble stuck in `sending` forever.
        const c = await coordinatorWith({ committed: COURSE42 });
        const before = c.state.guard().sendSeq;
        const sent = c.send({ text: 'hallo', localId: 'l1', sessionId: 1 });
        await tick();
        c.api.rejectSend(new Error('socket hang up'));
        await tick();
        c.api.rejectCall('detail:42:1', new Error('still down'));
        const outcome = await sent;
        assert.deepStrictEqual(outcome, { kind: 'unknown' });
        assert.strictEqual(c.state.sendInFlight, false);
        assert.strictEqual(c.state.guard().sendSeq, before + 1);
        assert.strictEqual(c.lastBubbleStatus, 'error');
        assert.strictEqual(c.composerTextCleared, false);
    });

    test('uncommitted files are omitted when the effective context is not the workspace exercise', async () => {
        const c = await coordinatorWith({ committed: COURSE42, pending: EX7, workspaceExerciseId: 5 });
        const sent = c.send({ text: 'hallo', localId: 'l1', sessionId: 1 });
        await tick();   // file collection is awaited BEFORE the POST
        assert.strictEqual(c.api.lastSend?.uncommittedFiles, undefined);
        c.api.resolveSend({ id: 11 });
        await sent;
    });

    test('uncommitted files are attached when the effective context IS the workspace exercise', async () => {
        const c = await coordinatorWith({ committed: COURSE42, pending: EX5, workspaceExerciseId: 5, files: new Map([['A.java', 'x']]) });
        const sent = c.send({ text: 'hallo', localId: 'l1', sessionId: 1 });
        await tick();   // without this, lastSend is undefined and the test passes for the wrong reason
        assert.strictEqual(c.api.lastSend?.uncommittedFiles?.size, 1);
        c.api.resolveSend({ id: 11 });
        await sent;
    });
});
```

**Harness.** Reuse `makeApi` from Task 5, extend it with `sendChatMessage` (recording `lastSend` and `sendCount`, exposing `resolveSend`/`rejectSend`), and add `resolveCall(call, value)` / `rejectCall(call, error)` so a test names the request it answers instead of hoping the newest one is the right one. `coordinatorWith` builds the state, a fake `runLifecycle` recording `aborted`, and a `collectUncommittedFiles` that resolves immediately, hangs until `releaseFileCollection()` (`slowFileCollection`), or throws (`fileCollectionThrows`). `swapMessage` is the same helper as Task 3.

Three rules the tests above follow, and which are meaningless if dropped:

- **`resolveDetail` may only be called once the catch path has actually issued the GET.** After `rejectSend(...)`, `await tick()` before resolving the detail; otherwise there is no outstanding deferred and the call throws. The fake's `resolveCall('detail:42:1', ...)` makes this explicit and fails loudly instead of silently resolving the wrong request.
- **`lastSend` is only populated after file collection.** `_collectUncommittedFiles` is awaited before the POST, so the uncommitted-files tests must `await tick()` before inspecting it. Asserting immediately reads `undefined` and passes for the wrong reason on both the positive and the negative test.
- **The coordinator's deps are fakes with recorders,** not spies on the real provider: `confirmBubble`, `failBubble` and `reportError` push into arrays that the tests read as `lastBubbleStatus`, `composerTextCleared` and `resentCount`. Define them in the same harness block.

- [ ] **Step 2: Run and watch it fail**

Run: `npm run compile-tests && npx vscode-test --label unit --grep "SendCoordinator"`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the coordinator**

```typescript
export class SendCoordinator {
    constructor(
        private readonly _api: ArtemisApiService,
        private readonly _conversation: IrisConversationService,
        private readonly _deps: SendDeps,
    ) {}

    // Takes the FULL SendInput. An earlier draft declared the parameter as
    // `{ text, localId }` while the body read `input.sessionId`, which does not
    // compile and, worse, would have silently dropped the origin-session check
    // that this field exists for.
    public async send(input: SendInput): Promise<SendOutcome> {
        const state = this._conversation.state;
        // Host-enforced, not a disabled button: the webview's streaming state
        // resets on disconnect, so UI gating is not an invariant.
        // Every early return fails the bubble, and against the ORIGIN session,
        // not the current one. The webview drew its optimistic message while
        // `input.sessionId` was open; addressing the current session instead
        // targets a bubble that may live in another conversation, and when there
        // is no current session it addresses nothing, so the bubble stays stuck
        // in `sending` forever.
        const origin = input.sessionId;
        const reject = (reason: SendRejection): SendOutcome => {
            this._deps.failBubble(origin, input.localId, reason);
            return { kind: 'rejected', reason };
        };
        if (state.sendInFlight) { return reject('send-in-flight'); }
        if (this._conversation.navigationInFlight) { return reject('navigation-in-flight'); }

        const snapshot = state.snapshot();
        const sessionId = snapshot.currentSessionId;
        if (sessionId === undefined) { return reject('no-conversation'); }
        // The command was composed against `origin`. A navigation can COMPLETE
        // between the webview posting it and the host handling it, at which
        // point `navigationInFlight` is false again and nothing above catches
        // it. Sending the prompt into whatever conversation happens to be open
        // now is the worst available outcome: the student's own text, in the
        // wrong place, with nothing on screen to say so.
        if (sessionId !== origin) { return reject('conversation-changed'); }

        const pending = snapshot.pendingContext?.ctx;
        const effective = state.effectiveContext();
        const captured = { sessionId, contextRevision: state.guard().contextRevision, ctx: pending };

        // The lock and the run generation are taken BEFORE the first await of
        // any kind, file collection included. An earlier draft collected files
        // first: two sends could both observe sendInFlight === false, both wait
        // for collection, and both POST. A navigation could start in the same
        // window, and a throw inside collection left no generation to abort even
        // though the webview had already entered its streaming state.
        state.beginSend();
        state.setOptimisticBubble(true);

        // The try opens IMMEDIATELY after the lock. beginGeneration and
        // resetRunUiAndPublish can throw synchronously, and outside the try that
        // skips the finally entirely: the lock stays latched, the optimistic
        // bubble stays, and a generation that was created is never aborted.
        let generation: number | undefined;
        let postStarted = false;
        try {
            generation = this._deps.runLifecycle.beginGeneration();
            this._deps.resetRunUiAndPublish();
            // Under staging the effective context can be an exercise the
            // workspace does not belong to. Sending exercise Y's diff under X's
            // context is worse than sending none.
            const files = this._isWorkspaceContext(effective)
                ? await this._deps.collectUncommittedFiles()
                : undefined;
            postStarted = true;
            const persisted = await this._api.sendChatMessage(sessionId, input.text, files, pending);
            this._commitWriteBack(captured);
            const messageId = typeof persisted?.id === 'number' ? persisted.id : undefined;
            // Record the persisted message in STATE, not only in the webview.
            // Without this the conversation still reports `empty` once the
            // optimistic flag clears, the picker stages onto it, and the next
            // send rehomes a conversation the student has written in.
            // Only into the conversation we actually sent to. Without this check
            // a navigation that committed while the POST was open would have the
            // OLD conversation's message written into the NEW one's transcript.
            if (messageId !== undefined && state.snapshot().currentSessionId === captured.sessionId) {
                state.upsertMessage({ ...persisted, id: messageId, sender: 'USER' });
            }
            this._deps.confirmBubble(origin, input.localId, messageId);
            void this._conversation.refreshOverview();
            return { kind: 'sent', messageId };
        } catch (error) {
            // The generation must be aborted on every failing path, or the
            // thinking indicator never clears. It may not exist yet if
            // beginGeneration itself threw.
            if (generation !== undefined) { this._deps.runLifecycle.abortGeneration(generation); }
            if (!postStarted) {
                // Local preparation failed and nothing was ever sent. This is NOT
                // an ambiguous send: issuing a reconciliation GET here would spend
                // a request to confirm the obvious and report `unknown` for an
                // outcome that is perfectly known.
                this._deps.failBubble(origin, input.localId, 'preparation-failed');
                return { kind: 'rejected', reason: 'preparation-failed' };
            }
            if (error instanceof ApiError && error.status === 429) {
                this._deps.failBubble(origin, input.localId, 'rate-limit');
                return { kind: 'rejected', reason: 'rate-limit' };
            }
            return await this._reconcileUnknown(input, captured);
        } finally {
            // Released ONLY here, after the result is fully processed,
            // reconciliation included. sendSeq moves with it, so a load that
            // started earlier can never install a pre-send snapshot. There is no
            // await between _commitWriteBack and endSend on the success path, so
            // nothing can interleave between the write-back and the bump.
            state.setOptimisticBubble(false);
            state.endSend();
            this._conversation.notifyChanged();
            // A reload deferred because it arrived mid-send (an undecodable
            // CTXSWAP marker) runs now, not never. It cannot recurse: the flag is
            // cleared before the call and endSend already ran, so `reload` sees
            // sendInFlight === false. Its rejection is swallowed and logged, not
            // left as an unhandled promise.
            this._conversation.runDeferredReload();
        }
    }

    private _commitWriteBack(captured: { sessionId: number; contextRevision: number; ctx?: ServerContext }): void {
        const state = this._conversation.state;
        const now = state.snapshot();
        if (now.currentSessionId !== captured.sessionId) { return; }        // discarded
        if (!captured.ctx) { return; }                                       // nothing was staged
        const guard = state.guard();
        if (guard.contextRevision === captured.contextRevision) {
            state.commitContext(captured.ctx);                               // exactly what was sent
            return;
        }
        // The revision moved. Either the ordinary self-CTXSWAP already installed
        // it (leave it), or the server has newer truth (leave it too: the
        // response body does not contain the session context at all).
    }

    /**
     * There is NO way to correlate a sent message after the fact:
     * messageDifferentiator is @Transient on the server, so a reconciliation GET
     * cannot see it. We therefore do not try to determine whether the message
     * landed. The job is to leave nothing corrupted.
     */
    private async _reconcileUnknown(input: SendInput, captured: { sessionId: number }): Promise<SendOutcome> {
        const state = this._conversation.state;
        try {
            const courseId = state.snapshot().courseId!;
            // The guard is captured BEFORE the request. Constructing it after the
            // response is tautological: it would always accept, and a CTXSWAP
            // that arrived while this GET was in flight would be overwritten by
            // the older snapshot the GET returns. That is precisely the race the
            // context-revision guard exists to stop, reintroduced inside the
            // recovery path.
            const guard = state.beginLoad();
            const detail = await this._api.getChatSessionById(courseId, captured.sessionId);
            if (state.installDetail(detail, guard)) {
                // A divergent staging cannot survive content, regardless of whose
                // content it is: a retry would rehome it.
                if (state.contentState() === 'content') { state.clearPending(); }
            }
        } catch {
            // Reconciliation itself failed. Surface it, do not retry. But the
            // lock, the bubble and the composer must still end in a defined
            // state, which the finally block and this call guarantee.
            this._deps.reportError('Iris konnte nicht erreicht werden. Der Verlauf ist möglicherweise nicht aktuell.');
        }
        this._deps.failBubble(captured.sessionId, input.localId, 'unknown');   // bubble leaves `sending`
        // The composer text is deliberately NOT cleared and nothing is resent.
        return { kind: 'unknown' };
    }
}
```

Add `commitContext(ctx)` to `ConversationState` (sets `_committed` and clears a matching pending) and a `navigationInFlight` getter to `IrisConversationService`.

- [ ] **Step 4: Leave `chatMessageService.ts` alone, and extract only what the coordinator needs**

`ChatMessageService` keeps its current shape and its current constructor. The provider still constructs and calls it, and rewriting it here would break that construction four commits early.

Extract `_collectUncommittedFiles` into `conversation/collectUncommittedFiles.ts` as a free function and have **both** call it, so there is one implementation rather than a copy that drifts. Everything else in `ChatMessageService` (the availability check, `_ensureIrisSession`, `incrementActiveSessionMessageCount`) stays until Task 14 replaces the routing and Task 15 deletes the remains.

- [ ] **Step 5: Run the tests**

Run: `npm run compile-tests && npx vscode-test --label unit --grep "SendCoordinator"`
Expected: PASS, 13 tests.

- [ ] **Step 6: Commit**

```bash
git add src/extension/services/iris/conversation/sendCoordinator.ts src/extension/services/iris/conversation/collectUncommittedFiles.ts src/extension/services/iris/chat/chatMessageService.ts test/unit/services/iris/conversation/sendCoordinator.test.ts
git commit -m "feat(iris): send the staged topic under a global send lock"
```

---

## Task 8: Reconcile the full detail whenever a subscription becomes active

**Files:**
- Modify: `src/extension/services/iris/conversation/conversationService.ts` (add `reconcileCurrent`; its trigger, `onSubscriptionActive`, was wired in Task 5)
- Modify: `src/extension/provider/chatReloadDecision.ts`
- Modify: `src/extension/services/iris/chat/irisWebSocketMessageHandler.ts:handleReconnectWebSocket`
- Test: `test/unit/provider/chatWebviewProviderReconnect.test.ts` (rewrite)

- [ ] **Step 1: Write the failing reconnect tests**

```typescript
suite('subscription reconciliation', () => {
    test('a delayed first subscription still triggers a reconciliation', async () => {
        // Not only reconnects: a first subscribe that was retried after a throw
        // leaves the same gap, and the same trigger closes it.
        const c = await serviceWith({ sessionId: 1, context: COURSE42 });
        c.service.onSubscriptionActive(1);
        c.api.resolveCall('detail:42:1', { sessionId: 1, courseId: 42, context: EX5, lastActivity: 1000, messages: [] });
        await tick();
        assert.deepStrictEqual(c.service.state.snapshot().committedContext, EX5);
    });

    test('a signal for a session we already left is ignored', async () => {
        const c = await serviceWith({ sessionId: 1, context: COURSE42 });
        c.service.onSubscriptionActive(99);
        assert.strictEqual(c.api.deferred.filter((d) => d.call.startsWith('detail:')).length, 0);
    });

    test('re-adopts the server mode and entityId, not merely the messages', async () => {
        const c = await serviceWith({ sessionId: 1, context: COURSE42 });
        const done = c.service.reconcileCurrent();
        c.api.resolveCall('detail:42:1', { sessionId: 1, courseId: 42, context: EX5, lastActivity: 1000, messages: [] });
        await done;
        assert.deepStrictEqual(c.service.state.snapshot().committedContext, EX5);
    });

    test('subscribes before adopting the snapshot', async () => {
        // A CTXSWAP can occur between the GET completing and the subscription
        // becoming active; subscribing first closes that window.
        const c = await serviceWith({ sessionId: 1, context: COURSE42 });
        const done = c.service.reconcileCurrent();
        assert.deepStrictEqual(c.subscribeCalls, [1]);
        c.api.resolveCall('detail:42:1', { sessionId: 1, courseId: 42, context: EX5, lastActivity: 1000, messages: [] });
        await done;
    });

    test('is discarded when a CTXSWAP arrived while it was in flight', async () => {
        const c = await serviceWith({ sessionId: 1, context: COURSE42 });
        const done = c.service.reconcileCurrent();
        c.service.state.applyContextSwap({ transition: 'added', context: EX7 }, swapMessage(20, { transition: 'added' }));
        c.api.resolveCall('detail:42:1', { sessionId: 1, courseId: 42, context: COURSE42, lastActivity: 1000, messages: [] });
        await done;
        assert.deepStrictEqual(c.service.state.snapshot().committedContext, EX7);
    });

    test('never installs a snapshot that predates an unresolved send', async () => {
        // A disconnect does not cancel a POST, so this fires DURING a send.
        //
        // `pending: EX5` is load-bearing and must be EXPLICIT. With no pending,
        // `_commitWriteBack` returns early, the committed context never leaves
        // COURSE42, and the assertion below is unreachable. An earlier draft
        // omitted it. Do NOT make `serviceWith` stage EX5 implicitly: other
        // tests would then depend on hidden setup.
        const c = await serviceWith({ sessionId: 1, context: COURSE42, pending: EX5 });
        const sending = c.coordinator.send({ text: 'a', localId: 'l1', sessionId: 1 });
        const done = c.service.reconcileCurrent();
        c.api.resolveSend({ id: 11 });
        await sending;                  // sendSeq moves here
        c.api.resolveCall('detail:42:1', { sessionId: 1, courseId: 42, context: COURSE42, lastActivity: 1000, messages: [] });
        await done;
        // The reconnect GET started before the send completed, so it is
        // discarded and the send's write-back survives.
        assert.deepStrictEqual(c.service.state.snapshot().committedContext, EX5);
    });

    test('leaves knownInvisible untouched', async () => {
        const c = await serviceWith({ sessionId: 1, context: COURSE42 });
        c.service.state.rememberInvisible({ sessionId: 9, courseId: 42, context: EX5, lastActivity: 1 });
        const done = c.service.reconcileCurrent();
        c.api.resolveCall('detail:42:1', { sessionId: 1, courseId: 42, context: COURSE42, lastActivity: 1000, messages: [] });
        await done;
        assert.strictEqual(c.service.state.snapshot().knownInvisible.length, 1);
    });
});
```

**The `serviceWith` harness, written out.** It is the only harness the plan previously left implicit, which is how the `pending` omission above survived. Build it on Task 5's `makeApi`/`tick`:

```typescript
/**
 * A service plus a coordinator with one open conversation. Every field of the
 * starting state is an explicit option; nothing is staged behind the caller's
 * back.
 */
async function serviceWith(options: {
    sessionId: number;
    context: unknown;
    courseId?: number;
    pending?: unknown;
    messages?: unknown[];
}) {
    const { api, deferred, outstanding, resolveCall, resolveOldestCall, resolveSend, rejectSend, rejectCall } = makeApi();
    const courseId = options.courseId ?? 42;
    const { deps: d, subscribed } = deps();
    const service = new IrisConversationService(api as never, d);
    const run = service.start({ exerciseId: 5, courseId });
    resolveCall(`current:PROGRAMMING_EXERCISE_CHAT:5:${courseId}`, {
        sessionId: options.sessionId, courseId, context: options.context,
        lastActivity: 1000, messages: options.messages ?? [],
    });
    await run;
    resolveCall(`overview:${courseId}`, []);
    await tick();
    // start() may have staged the workspace exercise when a course session came
    // back. Reset to exactly what the test asked for.
    service.state.clearPending();
    if (options.pending) { service.state.stagePending(options.pending as never); }
    const coordinator = new SendCoordinator(api as never, service, sendDeps());
    return { service, coordinator, subscribed,
             api: { deferred, outstanding, resolveCall, resolveOldestCall, resolveSend, rejectSend, rejectCall } };
}
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm run compile-tests && npx vscode-test --label unit --grep "reconnect reconciliation"`
Expected: FAIL.

- [ ] **Step 3: Implement it**

```typescript
/**
 * A reconnect is a LOAD and obeys the full guard tuple. It reconciles through
 * the detail endpoint, not just messages: server context, transcript including
 * markers, title and run completion.
 */
public async reconcileCurrent(): Promise<void> {
    const snapshot = this.state.snapshot();
    if (snapshot.currentSessionId === undefined || snapshot.courseId === undefined) { return; }
    // Subscribe FIRST: a CTXSWAP between the GET completing and the
    // subscription becoming active would otherwise be lost entirely.
    await this._deps.subscribeToSession(snapshot.currentSessionId);
    this.state.noteReconnect();

    // beginLoad, NOT guard: guard() carries loadTicket 0 and `accepts` requires
    // a ticket strictly greater than the last installed one, so a guard()-based
    // reconnect would be rejected every single time and reconciliation would
    // silently never happen.
    const captured = this.state.beginLoad();
    const detail = await this._api.getChatSessionById(snapshot.courseId, snapshot.currentSessionId);
    if (!this.state.installDetail(detail, captured)) {
        // Something moved while we were fetching. Discard, do not merge.
        return;
    }
    this._emit();
}
```

The webview receives `mergeSessionMessages` as today, extended with the marker rows. Host state is repaired by `installDetail`, which now **merges** rather than replaces (Task 3), so a websocket message that arrived while the reconnect GET was in flight survives the reconciliation instead of being deleted from `ConversationState`. Do not add a second, webview-only merge path: `mergeSessionMessages` is a rendering instruction, and letting it be the only thing that learns about reconnect content is what left host state and the transcript disagreeing in the first place.

- [ ] **Step 4: Run the tests, then commit**

Run: `npm run compile-tests && npx vscode-test --label unit --grep "reconnect"`
Expected: PASS.

```bash
git add src/extension/services/iris/conversation/conversationService.ts src/extension/provider/chatReloadDecision.ts src/extension/services/iris/chat/irisWebSocketMessageHandler.ts test/unit/provider/chatWebviewProviderReconnect.test.ts
git commit -m "feat(iris): reconcile the full session detail after a reconnect"
```

---

## Task 9: Add the new state surface, and prepare the persistence bump

**Additive.** `ActiveContext`, `StoredSession` and every existing store accessor stay until Task 15; this task only adds what replaces them and writes the migration test that Task 15 will make pass. Retiring the type here would break `courseIdResolver.ts`, `trackedItemRepository.ts`, `chatContextManager.ts`, `chatSessionService.ts`, the provider and roughly a dozen test files in one commit, none of which this task is about.

**Files:**
- Modify: `src/extension/services/iris/context/contextStore.ts` (add the new accessors and the new event)
- Modify: `src/extension/services/iris/context/contextStateTypes.ts` (add the v3 shape next to the v2 one)
- Modify: `src/extension/services/iris/context/contextPersistence.ts` (add the v3 `migrate` branch; **do not** raise `STORE_VERSION` yet)
- Test: `test/unit/services/iris/context/parseStoredState.test.ts` (extend)

Raising `STORE_VERSION` here would migrate away `activeContext` while the old path still reads it, so every existing installation would lose its topic on the next launch and gain nothing, since nothing consumes the new state until Task 14. The constant is raised in Task 15, in the same commit that removes the last reader.

- [ ] **Step 1: Write the failing migration test**

```typescript
    test('the ACTUAL v2 state migrates: tracked items survive, activeContext does not', () => {
        // The baseline is already at STORE_VERSION 2 (contextPersistence.ts:9),
        // so this migration is v2 to v3 and its input is the real v2 shape.
        // Writing it as "v1 to v2" would leave every existing installation on a
        // version the new code believes is current, and the stale activeContext
        // would survive into cold start.
        const migrated = migrateStoredStateToV3({
            version: 2,
            activeContext: { type: 'exercise', id: 5, title: 'BFS', source: 'user-selected', locked: true, selectedAt: 1 },
            activeSessionId: 'local-1',
            sessions: { 'exercise:5': [{ id: 'local-1', contextKey: 'exercise:5', preview: 'x', messageCount: 2, createdAt: 1, lastActivity: 2 }] },
            exercises: [{ id: 5, title: 'BFS', courseId: 42 }],
            courses: [{ id: 42, title: 'EIST' }],
        });
        assert.strictEqual(migrated.version, 3);
        assert.strictEqual(migrated.exercises.length, 1);
        assert.strictEqual(migrated.courses.length, 1);
        assert.ok(!('activeContext' in migrated));
        assert.ok(!('sessions' in migrated));
        assert.ok(!('activeSessionId' in migrated));
    });

    test('a pre-v2 state unions all* with recent*, losing nothing', () => {
        // Reading only `allExercises` and `courses` drops the recent-only
        // exercise and EVERY legacy course. The baseline migration unions both
        // pairs, so this migration must too.
        const migrated = migrateStoredStateToV3({
            version: 1,
            allExercises: [{ id: 5, title: 'BFS', courseId: 42, priority: 3 }],
            recentExercises: [{ id: 6, title: 'DFS', courseId: 42, lastViewed: 99 }],
            allCourses: [{ id: 42, title: 'EIST' }],
            recentCourses: [{ id: 43, title: 'PSE' }],
        });
        assert.strictEqual(migrated.version, 3);
        assert.deepStrictEqual(migrated.exercises.map((e) => e.id).sort(), [5, 6]);
        assert.deepStrictEqual(migrated.courses.map((c) => c.id).sort(), [42, 43]);
        assert.ok(!('priority' in migrated.exercises[0]));
    });

    // The two below assert on the LIVE parser, which only becomes v3 in Task 15.
    // Written now, skipped now, un-skipped there, so the deletion commit has a
    // test waiting for it instead of one written after the fact.
    test.skip('a v3 state round-trips unchanged (un-skip in Task 15)', () => {
        const state = { version: 3, exercises: [], courses: [] };
        assert.deepStrictEqual(parseStoredState(state), state);
    });

    test.skip('parseStoredState rejects a v3 shape that still carries sessions (un-skip in Task 15)', () => {
        assert.strictEqual(parseStoredState({ version: 3, exercises: [], courses: [], sessions: {} }), null);
    });
```

The point of the version bump: `contextPersistence.ts:49-76` strips `sessions` and `activeSessionId` on save today but **preserves `activeContext`**, so without a bump the extension would cold-start from a stale persisted topic the new model has no way to honour. And the bump must be to **3**, because the baseline already declares `STORE_VERSION = 2` at `contextPersistence.ts:9`. Setting it to 2 again means `raw.version !== STORE_VERSION` is false for every existing installation, `migrate` never runs, and `parseStoredState` then rejects the old shape and silently discards the student's tracked exercises and courses.

- [ ] **Step 2: Run, watch it fail, implement**

Add the v3 shape and an **exported pure helper** next to the existing ones. `STORE_VERSION` stays at `2`, `StoredState` is untouched, and `parseStoredState`, `load` and `save` keep working exactly as they do today. Baseline `migrate` is a private method (`contextPersistence.ts:79`), so the tests cannot call it; the helper is what they call, and what Task 15 wires into the class.

```typescript
/** The shape after the conversation-first rewrite. No sessions, no active context. */
export interface StoredStateV3 {
    version: 3;
    exercises: TrackedExercise[];
    courses: TrackedCourse[];
}

/**
 * Pure migration into v3, from the real v2 shape or from anything older.
 * Exported so it is testable without an ExtensionContext, and so Task 15 can
 * drop it into the class without changing its behaviour.
 */
export function migrateStoredStateToV3(previous: Record<string, unknown>): StoredStateV3 {
    // v2 stores the arrays under their final names. Anything older stores them
    // as `allExercises` + `recentExercises` and `allCourses` + `recentCourses`,
    // and the baseline `migrate` UNIONS each pair through `_unionAndStrip`
    // (contextPersistence.ts:79-100). Reading only `allExercises` and `courses`
    // would drop every recent-only exercise and every legacy course for a user
    // upgrading straight from v1, silently and permanently.
    const exercises = Array.isArray(previous['exercises'])
        ? previous['exercises'] as TrackedExercise[]
        : unionAndStrip(
            (previous['allExercises'] as LegacyItem[]) ?? [],
            (previous['recentExercises'] as LegacyItem[]) ?? [],
        ) as unknown as TrackedExercise[];
    const courses = Array.isArray(previous['courses'])
        ? previous['courses'] as TrackedCourse[]
        : unionAndStrip(
            (previous['allCourses'] as LegacyItem[]) ?? [],
            (previous['recentCourses'] as LegacyItem[]) ?? [],
        ) as unknown as TrackedCourse[];
    // Everything else (activeContext, activeSessionId, sessions) is dropped.
    return { version: 3, exercises, courses };
}
```

`unionAndStrip` is the existing private `_unionAndStrip` and `_stripDeprecated`, lifted to module scope as pure exported-for-test functions in the same commit. Lifting them rather than reimplementing keeps the `lastViewed` max-merge and the `priority`/`lastUpdated` stripping identical, which is the part a reimplementation gets wrong.

```typescript
```

`parseStoredState` is **not** changed here. Raising `STORE_VERSION`, switching `StoredState`, tightening the parser and simplifying `save` all happen atomically in Task 15, in the same commit that removes the last reader of `activeContext`. Doing any of it now would migrate the topic away four commits before anything consumes the replacement.

`getWorkspaceExercise()` and `getWorkspaceExerciseId()` **already exist** at `contextStore.ts:91` and `:95`; do not add them again. What is missing is:

- `getCurrentCourseId(): number | undefined` and `setCurrentCourseId(...)` (navigation state, distinct from the workspace exercise's course),
- `onDidChangeWorkspaceExercise`, the event the struggle detector follows after Task 14. The existing `_onDidChangeExerciseContext` on the provider stays until then.

The workspace exercise itself needs no new accessor: `workspaceDetectionService` already derives it from the folder's git remote, never from the active editor, which is exactly the semantics the new model wants.

`ActiveContext`, `ContextSource`, `StoredSession`, the old `ContextSnapshot`, `incrementActiveSessionMessageCount`, `getActiveSession` and the session accessors are **not** touched here. They are deleted in Task 15, after Task 14 removes their last consumer. `contextSnapshot.ts` likewise survives this task.

- [ ] **Step 3: Run the suites and commit**

Run: `npm run check-types && npm run lint && npm run test:unit && npm run test:react`
Expected: PASS. The two live-parser tests are `test.skip` with a comment naming Task 15; the two helper tests run and pass now.

```bash
git add src/extension/services/iris/context/ test/unit/services/iris/context/
git commit -m "feat(iris): add the workspace/course state surface alongside ActiveContext"
```

---

## Task 10: Add the conversation-shaped wire contracts

**Additive.** Every new field and message is added **next to** the existing ones; nothing is removed. `updateIrisState.state` keeps `context`, `activeSessionId` and `sessions` and gains the fields below. `addMessage` keeps `localSessionId` and gains `sessionId`. The old variants are deleted in Task 15, after Task 14 removes their producers and consumers. Replacing them here would break the provider, the presenter, the store and every component in one commit, and none of those are rewritten until Tasks 11 to 14.

**Files:**
- Modify: `src/shared/messageContracts/extensionMessages.ts`
- Modify: `src/shared/messageContracts/webviewCommands.ts`
- Modify: `src/extension/provider/chatViewStatePresenter.ts`
- Modify: `src/extension/provider/baseWebviewProvider.ts` (event dedup classification)
- Test: `test/react/flows/messageContracts.test.ts` (extend; the baseline suite is under `flows/`, not `services/`)
- Modify: `src/extension/provider/chatWebviewProvider.ts` (pass `_conversation` into the presenter)

The presenter has no conversation dependency at baseline, so this task adds one: `ChatViewStatePresenter` takes `() => IrisConversationService | undefined` (the same getter pattern as everything else, because the service is created in `resolveWebviewView` and the presenter in the constructor), and the provider supplies it here.

**Interfaces:**
- Produces: `updateIrisState` payload below; `ExtensionMsg.ShowChatNotice`; `WebviewCmd.SelectTopic`, `.OpenConversation`, `.SwitchCourse`, `.NewConversation`.

- [ ] **Step 1: Replace the Iris state payload**

```typescript
    updateIrisState: {
        // EVERY new field is OPTIONAL until Task 15. They are added to a payload
        // that dozens of typed React fixtures already construct; making them
        // required here would force all of those to be rewritten in a commit
        // that is supposed to be additive, and Task 15 tightens them anyway once
        // the old fields are gone.
        state: {
            courseId?: number | undefined;
            courseTitle?: string | undefined;
            currentSessionId?: number | undefined;
            conversationTitle?: string | undefined;
            /** Excludes CTXSWAP rows. Display only; never the ownership predicate. */
            displayMessageCount?: number;
            committedContext?: { mode: string; entityId: number; name?: string } | undefined;
            pendingContext?: { mode: string; entityId: number; name?: string } | undefined;
            /** 'unknown' disables the picker, the chip remove icon and Ask-Iris. */
            contentState?: 'unknown' | 'empty' | 'content';
            sendInFlight?: boolean;
            navigationInFlight?: boolean;
            conversations?: Array<{
                sessionId: number;
                courseId: number;
                mode: string;
                entityId: number;
                entityName?: string;
                title?: string;
                lastActivity: number;
            }>;
            exercises: Array<{ id: number; title: string; shortName?: string; courseId?: number; dueDate?: string; isWorkspace?: boolean }>;
            courses: Array<{ id: number; title: string; shortName?: string; lastViewed?: number }>;
            workspaceExerciseId?: number | undefined;
        };
        showDiagnostics?: boolean;
    };
```

`addMessage`, `loadMessages`, `mergeSessionMessages`, `confirmSentMessage` and `sendRejected` each gain an optional `sessionId?: number` beside the existing `localSessionId: string`, and their `role` widens to `'user' | 'assistant' | 'contextSwap'`. `IrisRunUiProjection` gains an optional `sessionId` beside `localSessionId`. `sendRejected.reason` widens to `'no-ai' | 'no-context' | 'iris-disabled' | 'iris-unavailable' | 'send-in-flight' | 'navigation-in-flight' | 'no-conversation' | 'conversation-changed' | 'rate-limit' | 'preparation-failed' | 'unknown'`, and `sendMessage` gains an optional `sessionId?: number` filled by the webview with the conversation its bubble was drawn in, and `ChatMessage.errorReason` in `views/IrisChat/types.ts` widens to match; the coordinator cannot report a reason the wire refuses to carry. In Task 15 the optional fields become required and the `localSessionId` ones are deleted; until then both are populated, which is also what lets Task 11's store migrate one message type at a time.

Add the notice:

```typescript
    /**
     * One muted line above the composer for 10 s. ACTIONLESS (cut 2): there is
     * no undo payload in PR 1. A dropped staging could never be undone anyway
     * (the CTXSWAP marker makes the conversation non-empty), and restoring a
     * saved staging into another conversation needs the cross-course
     * bookkeeping that cut 2 removed. Undo returns with PR 2, where unsolicited
     * proactive navigation makes recovery matter.
     */
    showChatNotice: {
        text: string;
    };
```

Commands, all **added** alongside the existing ones: `SelectTopic { mode: string; entityId: number; name?: string }`, `OpenConversation { courseId: number; sessionId: number }`, `SwitchCourse { courseId: number }`, `NewConversation`. There is **no** `UndoNavigation` (cut 2). Add each to `COMMANDS_REQUIRING_PAYLOAD` except `NewConversation`. `SelectChatContext`, `SwitchSession`, `OpenArtemisSession`, `CreateNewSession` and `SwitchToWorkspaceContext` stay until Task 15; `SwitchToWorkspaceContext` then goes entirely, because the workspace fallback collapsed into the Start rule and is no longer a user action.

- [ ] **Step 2: Classify the new events in `baseWebviewProvider.ts`**

Its dedup list knows only `websocketUpdate` and `addMessage`. `showChatNotice` must **never** be deduplicated (two notices in a row are two distinct facts about two distinct events), and `updateIrisState` must be last-wins.

- [ ] **Step 3: Populate the new fields in `chatViewStatePresenter.ts`**

The presenter fills both shapes: the old `context`/`activeSessionId`/`sessions` from the existing model, and the new conversation fields from `IrisConversationService.state.snapshot()`. The service exists on the provider from Task 5, so this compiles; it is optional, so the new fields are `undefined` when Iris is unavailable and the webview keeps rendering off the old ones. Both are correct at this point because both models are live. Task 15 removes the old fields; the presenter keeps filling them until then, including through Task 14.

- [ ] **Step 4: Run and commit**

Run: `npm run check-types && npm run lint && npm run test:unit && npm run test:react`
Expected: PASS. Purely additive changes to these unions cannot break an existing consumer, so a failure here means a field was replaced rather than added; go back and add it instead.

```bash
git add src/shared/messageContracts/ src/extension/provider/chatViewStatePresenter.ts src/extension/provider/baseWebviewProvider.ts src/extension/provider/chatWebviewProvider.ts src/webview/views/IrisChat/types.ts test/react/flows/messageContracts.test.ts
git commit -m "feat(iris): add the conversation-shaped wire contracts"
```

---

## Task 11: The webview store mirrors one conversation

**Files:**
- Modify: `src/webview/stores/useChatStore.ts`
- Modify: `src/webview/views/IrisChat/types.ts`
- Test: `test/react/stores/useChatStore.test.ts` (rewrite)

- [ ] **Step 1: Write the failing store tests**

```typescript
describe('useChatStore', () => {
    it('drops an addMessage for a session that is not open', () => {
        store.applyState({ currentSessionId: 7 });
        store.addMessage({ sessionId: 3, message: userMessage() });
        expect(store.messages).toHaveLength(0);
    });

    it('renders a contextSwap row without an avatar or feedback controls', () => {
        store.applyState({ currentSessionId: 7 });
        store.addMessage({ sessionId: 7, message: { role: 'contextSwap', content: 'Thema gesetzt auf BFS', timestamp: 1 } });
        expect(store.messages[0].role).toBe('contextSwap');
    });

    it('clears the notice on any navigation', () => {
        store.showNotice({ text: 'Zu einer anderen Unterhaltung gewechselt.' });
        store.applyState({ currentSessionId: 9 });
        expect(store.notice).toBeUndefined();
    });

    it('keeps the composer text when a send reports an unknown outcome', () => {
        store.setComposerText('hallo');
        store.failMessage({ localId: 'l1', reason: 'unknown' });
        expect(store.composerText).toBe('hallo');
    });

    it('disables the picker while contentState is unknown', () => {
        store.applyState({ contentState: 'unknown' });
        expect(store.canChangeTopic).toBe(false);
    });

    it('disables the picker while a send is in flight', () => {
        store.applyState({ contentState: 'empty', sendInFlight: true });
        expect(store.canChangeTopic).toBe(false);
    });
});
```

- [ ] **Step 2: Implement, additively**

Add `currentSessionId`, `committedContext`, `pendingContext`, `contentState`, `conversations`, `notice`, `composerText` and `canChangeTopic`, and add `sessionId`-keyed stale guards **beside** the existing `localSessionId`-keyed ones. Widen `ChatMessage.role` to `'user' | 'assistant' | 'contextSwap'` in `views/IrisChat/types.ts`.

`sessions`, `activeSessionId`, `context`, `ChatSession` and `ChatContext` all **stay** until Task 15: `ChatHeader`, `ContextPicker` and `ConversationHistory` still read them until Task 12 rewrites them, and the provider still fills them until Task 14. Removing them here is exactly the boundary violation the "additive first, delete last" rule exists to prevent.

- [ ] **Step 3: Run, then commit**

Run: `npx vitest run test/react/stores/useChatStore.test.ts`

```bash
git add src/webview/stores/useChatStore.ts src/webview/views/IrisChat/types.ts test/react/stores/useChatStore.test.ts
git commit -m "refactor(iris): webview store mirrors one conversation"
```

---

## Task 12: The interface

**Files:**
- Modify: `src/webview/views/IrisChat/components/ChatHeader.tsx` + `.module.css`
- Modify: `src/webview/views/IrisChat/components/ContextPicker.tsx` + `.module.css`
- Modify: `src/webview/views/IrisChat/components/ConversationHistory.tsx` + `.module.css`
- Modify: `src/webview/views/IrisChat/components/ChatInput.tsx`, `ChatMessageList.tsx`, `MessageBubble.tsx`
- Modify: `src/webview/views/IrisChat/IrisChatView.tsx` (it constructs every component below, owns their props, and posts the chat commands; a component contract change that skips it does not compile)
- Create: `ContextChip.tsx`, `ContextSwapRow.tsx`, `ChatNotice.tsx`, `CoursePicker.tsx` (+ `.module.css` each)
- Test: `test/react/components/irisChat*.test.tsx`

The prototype `.superpowers/brainstorm/12957-*/content/prototype-v25.html` is the visual reference. Copy its measurements; it was clicked through and several rules below were found wrong that way.

- [ ] **Step 1: Header, two lines in one row (§5.1)**

```
[book-open] Einfuehrung in die Informatik  v        [plus] [history]
            BFS Endlosschleife - 8 Nachrichten
```

Line 1 is the course and is **the only clickable part**, opening `CoursePicker`. A click must never land on a target the label did not name. Line 2 is the conversation title plus `displayMessageCount`. The topic is deliberately absent: it lives on the chip, so each fact appears once.

- [ ] **Step 2: `ContextChip` (§5.2)**

Artemis's values from `context-selection.component.scss`: fill `color-mix(in srgb, var(--vscode-charts-blue) 12%, transparent)`, border at 25%, **normal body text colour** (`--vscode-foreground`), pill radius, remove icon at 40% opacity going to 100% on hover.

**One visual state.** The chip shows `pending ?? committed` and does not distinguish staged from committed, exactly as Artemis's own chip does not (cut 5 removed the preview line that would have). No chip when the topic is the course. Clicking the chip opens the picker.

**The remove icon appears only while `contentState === 'empty'`.** There it does what its shape promises: it drops the topic in place, no request, no visible change beyond the chip. On a conversation with content, removing the topic necessarily means leaving for another conversation, and a small remove icon must not silently replace the whole transcript. There the icon is hidden and the picker's "Kurs-Chat" entry carries the action, under the same static hint as every other entry.

- [ ] **Step 3: `ContextPicker` (§5.3)**

Popover opening upward. Search scoped to the current course. "Kurs-Chat" is a fixed first entry, then the course's exercises with the workspace one pinned and badged. One checkmark on `pending ?? committed`.

**One static hint, not per-entry labels** (cut 1). While `contentState === 'content'`, the popover shows a single muted line at the top:

> "Die Auswahl oeffnet gegebenenfalls eine andere Unterhaltung."

That states the rule before the click, which is what the per-entry labels were for. It does not need `resolveTopic`, and that matters: `resolveTopic` lives in `src/extension/` and `eslint.config.mjs` forbids `src/webview/**` from importing `@extension/*`. Duplicating the resolver into the webview is worse than dropping the labels, because a second implementation can drift and then the UI predicts an outcome the host does not produce.

All entries are disabled while `contentState === 'unknown'` or `sendInFlight`.

No cross-course entries. `applyContextChange` rejects cross-course, so such a pick could never be a staging, and mixing a navigation into this menu would make one click mean two different things.

- [ ] **Step 4: `ConversationHistory` (§5.4)**

Search field, then the flat list of `conversations` for the current course, bucketed by Task 13. Row: `message-square` icon, title, current context label, relative time. Checkmark on the open one.

**Lecture, text-exercise and unknown-mode conversations are listed**, labelled by `entityName` with a neutral icon, and can be opened and continued. They simply cannot be selected as a topic in the picker. Hiding a conversation the student can reach from the web client is worse than showing one whose topic we cannot set.

- [ ] **Step 5: `CoursePicker` (§5.5)**

The student's courses, most-recently-viewed then alphabetical. On a fresh installation with nothing tracked, fetch the dashboard course list first and show a loading state; an empty result is an explicit "Keine Kurse gefunden" state, not a silent empty popover. No per-course conversation counts: the overview is per course, so counts would cost one request per course on every open.

- [ ] **Step 6: `ContextSwapRow` (§5.6)**

The **marker row** is full width and mirrors `iris-context-switch-divider.component.html`: "Thema gesetzt auf X" / "Thema gewechselt zu X" / "Thema entfernt". Not clickable: we have no exercise page to route to. It renders in transcript order, so it appears before the message that triggered it, matching the server's write order.

**No preview line** (cut 5). The chip shows `pending ?? committed` and does not distinguish staged from committed, which is exactly Artemis's own limitation. Note the related fact that made the preview line less valuable than it looked: not every exercise-scoped conversation carries a marker at all, because sessions created before the upstream change were born exercise-scoped, and we do not synthesise markers for them.

- [ ] **Step 7: `ChatNotice` (§5.6)**

One muted line above the composer, 10 s then fade. Cleared by **any** navigation or course change, not only by its own timeout.

**Actionless** (cut 2). It carries text and nothing else. Three cases in PR 1:

- "Zu einer anderen Unterhaltung gewechselt." when a topic change opened an existing conversation,
- "Neue Unterhaltung gestartet." when it created one, if distinguishing the two costs no extra plumbing; one generic string is acceptable otherwise,
- and the existing dropped-staging text from Task 6, which never had an action anyway.

The undo button, `savedPending` and the cross-course restoration rules are PR 2.

- [ ] **Step 8: Cold start (§5.7)**

No workspace exercise detected: no header, and the empty transcript offers the course list directly with "Kein Artemis-Arbeitsbereich erkannt. Waehle einen Kurs, um zu starten." Choosing one runs the course-switch path.

- [ ] **Step 9: Fix the flexbox scroll bug**

The prototype's `.body` had `overflow-y: auto` without `min-height: 0`, so scrolling became impossible once the transcript grew past the container. Check `IrisChatView.module.css` and `ChatMessageList.module.css` for the same pattern and add `min-height: 0` to every flex child that scrolls.

- [ ] **Step 10: Write the component tests**

```tsx
const EX5 = { mode: 'PROGRAMMING_EXERCISE_CHAT' as const, entityId: 5, name: 'Recursion' };
const EX7 = { mode: 'PROGRAMMING_EXERCISE_CHAT' as const, entityId: 7, name: 'Sorting' };
const COURSE42 = { mode: 'COURSE_CHAT' as const, entityId: 42 };

const pickerProps = (over = {}) => ({
    courseId: 42,
    committedContext: COURSE42,
    pendingContext: undefined,
    contentState: 'content' as const,
    sendInFlight: false,
    exercises: [
        { id: 5, title: 'Recursion', courseId: 42 },
        { id: 7, title: 'Sorting', courseId: 42 },
    ],
    conversations: [{ sessionId: 9, courseId: 42, mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 7, lastActivity: 100 }],
    onSelect: vi.fn(),
    ...over,
});

it('shows the chip remove icon while the conversation is empty', () => {
    render(<ContextChip context={EX5} contentState="empty" onRemove={vi.fn()} onOpenPicker={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Thema entfernen' })).toBeInTheDocument();
});

it('hides the chip remove icon once the conversation has content', () => {
    // With content, removing the topic necessarily means leaving for another
    // conversation, and a small remove icon must not silently replace the whole
    // transcript. The picker's Kurs-Chat entry carries that action instead.
    render(<ContextChip context={EX5} contentState="content" onRemove={vi.fn()} onOpenPicker={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Thema entfernen' })).toBeNull();
});

it('renders no chip when the topic is the course', () => {
    const { container } = render(<ContextChip context={COURSE42} contentState="empty" onRemove={vi.fn()} onOpenPicker={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
});

it('warns once that the selection may open another conversation', () => {
    render(<ContextPicker {...pickerProps()} />);
    expect(screen.getByText(/oeffnet gegebenenfalls eine andere Unterhaltung/)).toBeInTheDocument();
});

it('shows no such warning while the conversation is empty', () => {
    // Empty means the pick stages in place, so there is nothing to warn about.
    render(<ContextPicker {...pickerProps({ contentState: 'empty' })} />);
    expect(screen.queryByText(/oeffnet gegebenenfalls eine andere Unterhaltung/)).toBeNull();
});

it('disables every picker entry while the content state is unknown', () => {
    render(<ContextPicker {...pickerProps({ contentState: 'unknown' })} />);
    for (const id of [5, 7]) {
        expect(screen.getByTestId(`picker-entry-${id}`)).toBeDisabled();
    }
});

it('disables every picker entry while a send is in flight', () => {
    render(<ContextPicker {...pickerProps({ sendInFlight: true })} />);
    expect(screen.getByTestId('picker-entry-5')).toBeDisabled();
});

it('lists a lecture conversation in the history but not in the picker', () => {
    const lecture = { sessionId: 12, courseId: 42, mode: 'LECTURE_CHAT', entityId: 3, entityName: 'Woche 3', lastActivity: 200 };
    render(<ConversationHistory conversations={[lecture]} currentSessionId={9} onOpen={vi.fn()} nowMs={300} />);
    expect(screen.getByText('Woche 3')).toBeInTheDocument();

    render(<ContextPicker {...pickerProps({ conversations: [lecture] })} />);
    expect(screen.queryByText('Woche 3')).toBeNull();
});

it('renders no preview line, staged or not', () => {
    // Cut 5. The chip alone carries `pending ?? committed`.
    render(<ChatMessageList
        messages={[{ localId: 'a', role: 'user', content: 'hallo', timestamp: 1 }]}
        pendingContext={EX7}
        committedContext={COURSE42}
    />);
    expect(screen.queryByTestId('context-preview')).toBeNull();
});

it('renders a stored marker row in transcript order, before the message it triggered', () => {
    render(<ChatMessageList
        messages={[
            { localId: 'm', role: 'contextSwap', content: 'Thema gesetzt auf Sorting', timestamp: 1 },
            { localId: 'u', role: 'user', content: 'hallo', timestamp: 2 },
        ]}
        pendingContext={undefined}
        committedContext={EX7}
    />);
    const rows = screen.getAllByTestId('message-row');
    expect(rows[0]).toHaveTextContent('Thema gesetzt auf Sorting');
    expect(rows[1]).toHaveTextContent('hallo');
});

it('clears the notice when the open conversation changes', () => {
    const { rerender } = render(<ChatNotice notice={{ text: 'Zu einer anderen Unterhaltung gewechselt.' }} currentSessionId={1} onExpire={vi.fn()} />);
    expect(screen.getByText('Zu einer anderen Unterhaltung gewechselt.')).toBeInTheDocument();
    rerender(<ChatNotice notice={undefined} currentSessionId={9} onExpire={vi.fn()} />);
    expect(screen.queryByText('Zu einer anderen Unterhaltung gewechselt.')).toBeNull();
});

it('never renders an action, on any notice', () => {
    // Cut 2: the notice is actionless in PR 1. Undo returns with PR 2.
    render(<ChatNotice notice={{ text: 'Deine Vormerkung wurde verworfen.' }} currentSessionId={1} onExpire={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
});

it('offers the course list on cold start instead of an empty transcript', () => {
    render(<IrisChatView state={{ currentSessionId: undefined, courseId: undefined, courses: [] }} />);
    expect(screen.getByText(/Kein Artemis-Arbeitsbereich erkannt/)).toBeInTheDocument();
});
```

- [ ] **Step 11: Run and commit**

Run: `npx vitest run test/react/`

Keep it additive: the components accept the new props **and** keep accepting the old ones, and `IrisChatView.tsx` passes both while posting the new commands alongside the old. Task 14 stops the host from answering the old ones; Task 15 removes them.

```bash
git add src/webview/views/IrisChat/ test/react/
git commit -m "feat(iris): conversation-first chat interface"
```

---

## Task 13: Sorting

**Files:**
- Modify: `src/webview/views/IrisChat/pickerSort.ts:15-30`
- Modify: `src/webview/views/IrisChat/historyBuckets.ts:23-55`
- Test: `test/logic/iris/pickerSort.test.ts`, `test/logic/iris/historyBuckets.test.ts`

- [ ] **Step 1: Write the failing sorting tests**

```typescript
const ex = (over: Partial<ContextItem> = {}): ContextItem =>
    ({ id: 1, title: 'A', ...over }) as ContextItem;

const soon = ex({ id: 1, title: 'Soon', dueDate: '2026-08-01T10:00:00Z' });
const late = ex({ id: 2, title: 'Late', dueDate: '2026-09-01T10:00:00Z' });
const none = ex({ id: 3, title: 'None' });

describe('compareExercisesForPicker', () => {
    it('sorts by due date ascending, soonest first', () => {
        expect([late, soon, none].sort(compareExercisesForPicker).map((e) => e.id)).toEqual([1, 2, 3]);
    });

    it('keeps the workspace exercise pinned regardless of due date', () => {
        const workspace = ex({ id: 4, title: 'Workspace', dueDate: '2027-01-01T10:00:00Z', isWorkspace: true });
        expect([late, soon, workspace].sort(compareExercisesForPicker).map((e) => e.id)).toEqual([4, 1, 2]);
    });

    it('treats an invalid due date as absent and sorts it last', () => {
        const broken = ex({ id: 5, title: 'Broken', dueDate: 'not-a-date' });
        expect([broken, soon].sort(compareExercisesForPicker).map((e) => e.id)).toEqual([1, 5]);
    });

    it('breaks a due-date tie alphabetically, case-insensitively', () => {
        const b = ex({ id: 6, title: 'beta', dueDate: '2026-08-01T10:00:00Z' });
        const a = ex({ id: 7, title: 'Alpha', dueDate: '2026-08-01T10:00:00Z' });
        expect([b, a].sort(compareExercisesForPicker).map((e) => e.id)).toEqual([7, 6]);
    });
});

describe('bucketHistoryByTime', () => {
    const entry = (lastActivity: number, id = 1): CourseHistoryEntryVM =>
        ({ artemisSessionId: id, courseId: 42, mode: 'COURSE_CHAT', entityId: 42, lastActivity });
    const bucketOf = (lastActivity: number, nowMs: number) =>
        bucketHistoryByTime([entry(lastActivity)], nowMs)[0]?.bucket;

    it('has five buckets, in order', () => {
        const now = Date.parse('2026-07-29T12:00:00+02:00');
        const DAY = 24 * 60 * 60 * 1000;
        const entries = [
            entry(now - 3600_000, 1),      // today
            entry(now - 26 * 3600_000, 2), // yesterday
            entry(now - 3 * DAY, 3),       // last7
            entry(now - 10 * DAY, 4),      // last30
            entry(now - 60 * DAY, 5),      // older
        ];
        expect(bucketHistoryByTime(entries, now).map((g) => g.bucket))
            .toEqual(['today', 'yesterday', 'last7', 'last30', 'older']);
    });

    it('puts a conversation continued yesterday under Gestern even if it was created last month', () => {
        // Keyed on lastActivity, not creationDate: a continued conversation must
        // stay findable where the student last touched it. The host already
        // resolves lastActivityDate ?? creationDate into this single number.
        const now = Date.parse('2026-07-29T12:00:00+02:00');
        expect(bucketOf(Date.parse('2026-07-28T13:00:00+02:00'), now)).toBe('yesterday');
    });

    it('is correct across a spring-forward DST boundary', () => {
        // 2026-03-29 is a 23-hour day in Europe/Berlin. Subtracting a fixed
        // 24 * 60 * 60 * 1000 from local midnight lands an hour INSIDE the day
        // before, so a timestamp early on the 28th fell into "last7".
        const now = Date.parse('2026-03-30T12:00:00+02:00');
        expect(bucketOf(Date.parse('2026-03-29T00:30:00+01:00'), now)).toBe('yesterday');
    });

    it('is correct across a fall-back DST boundary', () => {
        // 2026-10-25 is a 25-hour day; the same fixed span lands an hour SHORT,
        // so a timestamp late on the 24th was misfiled as "yesterday".
        const now = Date.parse('2026-10-26T12:00:00+01:00');
        expect(bucketOf(Date.parse('2026-10-24T23:30:00+02:00'), now)).toBe('last7');
    });

    it('files an unparseable timestamp in Older, after every valid Older entry', () => {
        const now = Date.parse('2026-07-29T12:00:00+02:00');
        const groups = bucketHistoryByTime([entry(0, 1), entry(Date.parse('2026-01-01T00:00:00Z'), 2)], now);
        expect(groups.at(-1)?.entries.map((e) => e.artemisSessionId)).toEqual([2, 1]);
    });

    it('omits empty buckets', () => {
        const now = Date.parse('2026-07-29T12:00:00+02:00');
        expect(bucketHistoryByTime([entry(now - 3600_000)], now).map((g) => g.bucket)).toEqual(['today']);
    });
});
```

The DST tests need a fixed zone. `extension/vitest.config.mts` has **no** `env` block today, so add one and stage the file with this task; leaving it out makes these four tests pass on a Berlin laptop and fail in CI:

```typescript
	test: {
		environment: 'happy-dom',
		env: { TZ: 'Europe/Berlin' },
```

Verify it took effect before trusting the assertions: `TZ=UTC npx vitest run test/logic/iris/historyBuckets.test.ts` must still pass, because the config wins over the ambient value.

- [ ] **Step 2: Implement**

`pickerSort.ts`: flip the due-date comparison to `aDue - bDue`. Update the doc comment: the 2026-07-21 spec justified descending as consistency with Artemis, but Artemis's *chat* picker does not sort at all. `sortExercises` belongs to the course-overview sidebar, a different screen.

`historyBuckets.ts`: add a `last30` bucket, and compute every boundary by calendar arithmetic rather than by subtracting `DAY_MS`:

```typescript
function startOfDayOffset(now: Date, daysBack: number): number {
    // Calendar arithmetic, not fixed 24-hour spans: on a DST transition day the
    // old code placed the boundary an hour into the wrong day.
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack).getTime();
}
```

Boundaries: today = `offset(0)`, yesterday = `offset(1)`, last7 = `offset(7)`, last30 = `offset(30)`.

- [ ] **Step 3: Run and commit**

Run: `npx vitest run test/logic/iris/pickerSort.test.ts test/logic/iris/historyBuckets.test.ts`

```bash
git add vitest.config.mts src/webview/views/IrisChat/pickerSort.ts src/webview/views/IrisChat/historyBuckets.ts test/logic/iris/
git commit -m "fix(iris): ascending due dates and DST-safe history buckets"
```

---

## Task 14: Commands, the provider, and the struggle decoupling

**Files:**
- Modify: `src/extension/provider/chatWebviewProvider.ts` (the dispatcher and the gating)
- Modify: `src/extension/controller/commands/irisCommands.ts:47,80`
- Modify: `src/extension/activation/extensionCommands.ts:43-68,83`
- Modify: `package.json:59-60`
- Modify: `src/extension/services/iris/chat/chatContextManager.ts`, `chatDiagnosticsService.ts`, `historyResolution.ts`, `context/courseHistory.ts`
- Test: `test/unit/provider/chatWebviewProviderOpenSession.test.ts`, `test/unit/activation/extensionCommands.test.ts`

This task carries local findings **7** (the `package.json` title) and the "Reload with no conversation open" case.

- [ ] **Step 1: Write the failing command tests**

```typescript
suite('Ask Iris commands', () => {
    test('with no conversation open, Ask-Iris acquires one instead of refusing', async () => {
        // The cold-start row of the resolution table. Without it the dashboard's
        // "Ask Iris about this exercise" is dead on a fresh window. Assert the
        // real outcome, not a recorder string: a recorded call name would still
        // pass if the service answered `rejected: no-course`.
        const { commands, service } = harness({ currentSessionId: undefined, courseId: undefined });
        const outcome = await commands.askIrisAboutExercise({ exerciseId: 5, exerciseTitle: 'BFS', courseId: 42 });
        assert.deepStrictEqual(outcome, { kind: 'opened', sessionId: 1 });
        assert.strictEqual(service.lastAcquire?.courseId, 42);
        assert.strictEqual(service.state.snapshot().currentSessionId, 1);
    });

    test('Ask-Iris resolves the course when the payload omits it', async () => {
        const { commands, service } = harness({ currentSessionId: undefined, courseId: undefined, trackedCourseFor: { 5: 42 } });
        await commands.askIrisAboutExercise({ exerciseId: 5, exerciseTitle: 'BFS' });
        assert.strictEqual(service.lastAcquire?.courseId, 42);
    });

    test('Ask-Iris on a conversation with content says it opened another one', async () => {
        const { commands, messages } = harness({ contentState: 'content', outcome: { kind: 'opened', sessionId: 12 } });
        await commands.askIrisAboutExercise({ exerciseId: 5, exerciseTitle: 'BFS', courseId: 42 });
        assert.match(messages.at(-1)!, /andere Unterhaltung|neue Unterhaltung/);
    });

    test('Ask-Iris is rejected while a send is in flight', async () => {
        const { commands, messages, service } = harness({ sendInFlight: true });
        await commands.askIrisAboutExercise({ exerciseId: 5, exerciseTitle: 'BFS', courseId: 42 });
        assert.strictEqual(service.calls.length, 0);
        assert.match(messages.at(-1)!, /Iris antwortet gerade/);
    });
});

suite('Reload Iris chat', () => {
    test('re-acquires the conversation and refreshes the overview', async () => {
        const { commands, service } = harness({ currentSessionId: 7 });
        await commands.reloadIrisChat();
        assert.deepStrictEqual(service.calls, ['reload', 'refreshOverview']);
    });

    test('with no conversation open it re-runs start instead of failing', async () => {
        const { commands, service } = harness({ currentSessionId: undefined });
        await commands.reloadIrisChat();
        assert.deepStrictEqual(service.calls, ['start']);
    });
});

suite('struggle decoupling', () => {
    test('changing the chat topic does not retarget struggle detection', () => {
        // chatWebviewProvider.ts:178 fires _onDidChangeExerciseContext whenever
        // the chat context becomes an exercise, pointing the detector at an
        // exercise whose code is not open.
        const { provider, exerciseEvents } = harness();
        provider.applyTopic({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 7 });
        assert.strictEqual(exerciseEvents.length, 0);
    });

    test('a workspace detection change does retarget it', () => {
        const { provider, exerciseEvents } = harness();
        provider.registerWorkspaceExercise({ id: 5, title: 'BFS', courseId: 42 });
        assert.deepStrictEqual(exerciseEvents, [5]);
    });
});
```

- [ ] **Step 2: Rename the reset command**

`extensionCommands.ts:43-68` registers "Reset Iris Chat Sessions" and calls `clearAllSessions()`, promising to clear a store this design deletes. **Repurpose it, keeping the command id** `artemis.resetIrisChat` so no user's keybinding breaks:

```typescript
function registerReloadIrisChatCommand(chatWebviewProvider: ChatWebviewProvider): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.resetIrisChat', async () => {
        // Kept as an escape hatch for a wedged client: drop everything local and
        // re-read from the server. It no longer pretends to own conversations,
        // which live on Artemis.
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Iris-Chat wird neu geladen...',
            cancellable: false,
        }, async () => {
            await chatWebviewProvider.reloadIrisChat();
        });
    });
}
```

`reloadIrisChat()` drops `courseSessions`, `knownInvisible` and the loaded detail, then re-acquires: `reload()` when a conversation is open, `start()` when none is. The modal confirmation goes: there is nothing destructive left to confirm.

Update `package.json:59-60`:

```json
{ "command": "artemis.resetIrisChat", "title": "Artemis: Reload Iris Chat", "icon": "$(refresh)" }
```

- [ ] **Step 3: Route Ask-Iris through `resolveTopicChange`, carrying the course**

`irisCommands.ts:47` calls `setExerciseContext(...)` and `:80` calls `setCourseContext(...)`. Both become `resolveTopicChange`, and the **course id must travel with the target**:

```typescript
const courseId = payload.courseId
    ?? await resolveCourseIdForExercise(exerciseId, contextStore, api);
await conversation.resolveTopicChange(
    { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: exerciseId, name: title },
    courseId,
);
```

On a cold start `state.courseId` is `undefined`, so a `resolveTopicChange` that carries only the `ServerContext` resolves to `rejected: no-course` and the command is dead on a fresh window. The `askIrisAboutExercise` payload already carries `courseId`, and it must not be discarded on the way through.

`resolveCourseIdForExercise` is the retained `context/courseIdResolver.ts`, **retargeted off `ActiveContext`** as spec §10 requires. Change its signature from `(context: ActiveContext, store, api)` to `(exerciseId: number, store: ContextStore, api: ArtemisApiService | undefined)`, keeping the same three-step chain: the tracked exercise's `courseId`, then `getExerciseDetails(exerciseId).exercise.course.id`, registering the result back into the store on success. Update `test/unit/services/iris/context/courseIdResolver.test.ts` accordingly. This is the only file that knows how to find a course for an exercise the store has never seen, which is exactly the fresh-window case.

Because the result may be a different conversation, the progress message must say so:

| outcome | message |
|---|---|
| `staged` | "Iris schaut jetzt auf BFS." |
| `opened` | "Iris schaut jetzt auf BFS, in einer anderen Unterhaltung." |
| `rejected: loading` | "Iris laedt noch. Versuch es gleich nochmal." |
| `rejected: send-in-flight` | "Iris antwortet gerade. Warte kurz." |

Delete `setExerciseContext`, `setCourseContext` and `getSelectedContext` from `types/IChatWebviewProvider.ts` and the provider.

- [ ] **Step 4: Decouple struggle detection**

`chatWebviewProvider.ts:178` fires `_onDidChangeExerciseContext` whenever the active chat context becomes an exercise. Remove that firing. The detector follows the **workspace** (`workspaceDetectionService` derives it from the folder's git remote, not the active editor); the chat context follows the **conversation**. The event now fires only from `registerWorkspaceExercise` / `clearWorkspaceExercise`.

`extensionCommands.ts:83` derives the course from the active context; it reads `contextStore.getCurrentCourseId()` instead.

- [ ] **Step 5: Construct and wire the new services (the actual cut-over)**

This is where the two models stop coexisting, so it needs concrete wiring, not prose. In `chatWebviewProvider.ts`'s constructor, next to the existing services:

`_conversation` already exists from Task 5. What this task adds is the coordinator and the routing. Baseline field names at `5ec22370`: `_artemisApiService`, `_irisSessionManager`, `_websocketMessageHandler`, `_runs`, `_contextStore`, `_viewStatePresenter`. Do not invent others.

```typescript
    private _sendCoordinator: SendCoordinator | undefined;

    /** Built next to _conversation, in resolveWebviewView, when both deps exist. */
    private _createSendCoordinator(conversation: IrisConversationService): SendCoordinator | undefined {
        if (!this._artemisApiService) { return undefined; }
        return new SendCoordinator(this._artemisApiService, conversation, {
            runLifecycle: this._runs,
            resetRunUiAndPublish: () => this._websocketMessageHandler.resetRunUiAndPublish(),
            collectUncommittedFiles: () => collectUncommittedFiles(),
            // The baseline has no _post* helpers; it posts inline through
            // _postMessageSafe (see chatWebviewProvider.ts:1044 and :1206).
            // `sessionId` is read at CALL time, not captured: this factory runs
            // once and the open conversation changes underneath it.
            // Both take the ORIGIN session as their first argument, so a bubble
            // is always addressed in the conversation it was drawn in.
            confirmBubble: (sessionId, localId, id) => {
                if (id === undefined) { return; }
                this._postMessageSafe({ type: ExtensionMsg.ConfirmSentMessage, sessionId, localId, id });
            },
            failBubble: (sessionId, localId, reason) => this._postMessageSafe({
                type: ExtensionMsg.SendRejected, localId, sessionId, reason,
                errorMessage: SEND_REJECTION_MESSAGES[reason],
            }),
            reportError: (message) => this._postMessageSafe({ type: ExtensionMsg.OpenSessionError, message }),
            getWorkspaceExerciseId: () => this._contextStore.getWorkspaceExerciseId(),
        });
    }
```

Then the routing, all in this commit:

- `_handleChatMessage` delegates to `_sendCoordinator.send` instead of `_chatMessageService.sendMessage`, keeping the existing availability check in front of it, and **inspects the outcome**:

```typescript
        // The baseline names the validated value `content`, not `text`
        // (chatWebviewProvider.ts:1182 onward). `sessionId` comes from the
        // command so a navigation between composing and handling is caught.
        const sessionId = message.sessionId ?? this._conversation?.state.snapshot().currentSessionId;
        if (sessionId === undefined) { return; }
        await this._sendCoordinator.send({ text: content, localId, sessionId });
        // Neither outcome needs anything here. `rejected` already failed the
        // bubble with its reason; `unknown` already surfaced its message through
        // `reportError` inside the coordinator, and posting a second
        // OpenSessionError would show the student the same failure twice.
```

Define the user-facing strings next to the coordinator so a reason and its text cannot drift apart:

```typescript
export const SEND_REJECTION_MESSAGES: Record<SendRejection | 'unknown', string> = {
    'send-in-flight': 'Iris antwortet gerade. Warte kurz.',
    'navigation-in-flight': 'Die Unterhaltung wird gerade geladen.',
    'no-conversation': 'Keine Unterhaltung offen.',
    'conversation-changed': 'Die Unterhaltung hat gewechselt. Schick die Nachricht noch einmal.',
    'rate-limit': 'Du hast dein Nachrichtenlimit erreicht.',
    'preparation-failed': 'Die Nachricht konnte nicht vorbereitet werden.',
    'unknown': 'Unbekannter Ausgang. Pruefe den Verlauf.',
};
```
- The dispatcher answers `SelectTopic`, `OpenConversation`, `SwitchCourse` and `NewConversation`, and stops answering `SelectChatContext`, `SwitchSession`, `OpenArtemisSession`, `CreateNewSession` and `SwitchToWorkspaceContext`. The old handler methods stay on the class with no caller, which is what `knip` confirms in Task 15.
- **The dispatcher posts the navigation notice.** Cut 2 kept the notice precisely so a topic pick that replaces the whole transcript is explained afterwards, and the component is useless if nothing raises it. `SelectTopic` whose `TopicChangeOutcome` is `opened` posts `ShowChatNotice` with "Zu einer anderen Unterhaltung gewechselt."; `NewConversation` posts "Neue Unterhaltung gestartet." `OpenConversation` from the history posts **nothing**: that navigation is what the student explicitly asked for, so there is nothing to explain. Outcomes `staged`, `unstaged` and `noop` post nothing either, because the transcript did not move. The Ask-Iris progress message (Step 3) is a separate surface and does not cover the webview picker.

```typescript
        const outcome = await conversation.resolveTopicChange(target);
        if (outcome.kind === 'opened') {
            this._postMessageSafe({
                type: ExtensionMsg.ShowChatNotice,
                text: 'Zu einer anderen Unterhaltung gewechselt.',
            });
        }
```

Add a provider test: a `SelectTopic` that resolves to `opened` posts exactly one `showChatNotice`, and one that resolves to `staged` posts none.
- `resolveWebviewView` calls `void this._conversation?.start(workspaceExercise)` in place of the old `initializeIrisSessionAndLoadMessages` path.
- `SwitchCourse` calls `this._contextStore.setCurrentCourseId(courseId)` before `switchCourse`, so the course list's "most recently viewed" order and the cold-start path both see it. Task 9 added that accessor and nothing has called it until now.
- `this._disposables.push(this._conversation.onDidChange(() => this._viewStatePresenter.postSnapshot()))`. The baseline presenter method is `postSnapshot`; there is no `postIrisState`.

The **presenter keeps filling the old `updateIrisState` fields**. They are still required by the contract until Task 15, and the webview components still read them until then; stopping here would be a contract violation dressed as a cleanup.

Disposal order: `_conversation` is disposed before `_irisSessionManager`, so no in-flight install can subscribe to a disposed client.

- [ ] **Step 6: Add the host gating (§7.3)**

In the provider's dispatcher, reject `OpenConversation`, `SwitchCourse`, `NewConversation` and `SelectTopic` while `state.sendInFlight`, and reject `SendMessage` while `navigationInFlight`. Host-enforced, not a disabled button: the webview's streaming state resets on disconnect, so UI gating is not an invariant.

- [ ] **Step 7: Simplify `courseHistory.ts`**

Delete `INCLUDED_MODES` and the filter (§5.4 lists every mode). The mapping now happens in `artemisApi.listChatSessionsForCourse` (Task 1), so this file either shrinks to a sort helper or disappears; if it disappears, delete `test/unit/services/iris/context/courseHistory.test.ts` with it.

- [ ] **Step 8: Run everything and commit**

Run: `npm run check-types && npm run lint && npm run test:unit && npm run test:react`

```bash
git add src/extension/provider/ src/extension/controller/commands/irisCommands.ts src/extension/activation/extensionCommands.ts package.json src/extension/services/iris/ test/unit/
git commit -m "feat(iris): commands follow conversations and struggle follows the workspace"
```

---

## Task 15: Delete the old model and prove the build

**Files:**
- Delete: `src/extension/services/iris/context/sessionManager.ts`, `context/sessionSyncUtils.ts` and their tests
- Modify: `src/extension/services/iris/chat/chatSessionService.ts` (what remains of it)
- Modify: `src/extension/services/iris/index.ts`

This is the only task that deletes. Task 14 removed the last consumer of the old model, so everything below now has zero references and `check-types` proves it.

- [ ] **Step 1: Delete the old session model and its tests**

```bash
git rm src/extension/services/iris/context/sessionManager.ts \
       src/extension/services/iris/context/sessionSyncUtils.ts \
       src/extension/services/iris/context/contextSnapshot.ts \
       test/unit/services/iris/context/sessionManager.test.ts \
       test/unit/services/iris/context/sessionSyncUtils.test.ts
```

`IrisServiceDeps` lived in `sessionSyncUtils.ts`; it moved to `conversation/deps.ts` in Task 5. Re-point the remaining importers.

- [ ] **Step 2: Retire `ActiveContext` and raise the store to v3**

`chatMessageService.ts` imports and uses `ActiveContext` throughout, so it is **deleted in this same step**: Task 14 routed every send through `SendCoordinator`, so it has no caller left. Its availability check moved to `irisAvailabilityService.ts` in Step 5 and its file collection to `conversation/collectUncommittedFiles.ts` in Task 7, so nothing of it is lost. Delete `test/unit/services/iris/chat/chatMessageService.test.ts` with it.

Then delete `ActiveContext`, `ContextSource`, `StoredSession` and the old `ContextSnapshot` from `src/shared/types/context.ts`. Keep `ChatContextType` only if a consumer still needs it; otherwise delete it too. Remove `getActiveContext` / `setActiveContext` / `onDidChangeActiveContext`, `incrementActiveSessionMessageCount`, `getActiveSession` and every session accessor from `contextStore.ts`.

Then raise `STORE_VERSION` to `3` in `contextPersistence.ts` and un-skip the migration test written in Task 9. Doing it here, and not earlier, is what makes it safe: nothing reads `activeContext` any more, so dropping it costs the student nothing, and the v3 branch of `migrate` keeps their tracked exercises and courses.

- [ ] **Step 3: Delete the superseded wire fields**

In `shared/messageContracts/`, remove `context`, `activeSessionId` and `sessions` from `updateIrisState.state` and make every field Task 10 added there **required** (`courseId`, `courseTitle`, `currentSessionId`, `conversationTitle`, `displayMessageCount`, `committedContext`, `pendingContext`, `contentState`, `sendInFlight`, `navigationInFlight`, `conversations`, `workspaceExerciseId`), together with `sendMessage.sessionId`; make `sessionId` required and delete `localSessionId` on `addMessage`, `loadMessages`, `mergeSessionMessages`, `confirmSentMessage`, `sendRejected` and `IrisRunUiProjection` (Task 10 added the optional `sessionId` to all six, including `confirmSentMessage` and `sendRejected`, and Task 14 made their producers fill it, which is what makes tightening them possible here); delete the `SelectChatContext`, `SwitchSession`, `OpenArtemisSession`, `CreateNewSession` and `SwitchToWorkspaceContext` commands and their `COMMANDS_REQUIRING_PAYLOAD` entries. Then delete the matching stale-guard branches in `useChatStore.ts`.

Run: `npm run check-types`
Expected: PASS with no changes needed elsewhere. Any error here names a consumer Task 14 missed; fix it rather than restoring the field.

- [ ] **Step 4: Strip the old acquisition out of the websocket session client**

Delete `initializeSession` and `createNewSession` from `irisWebSocketSessionClient.ts`, together with its `ActiveContext` and `contextToIrisMode` imports and the now-unused `_subscribeIfConnected`. What remains is `subscribeToSession` / `_converge`, `unsubscribe`, `resetSession`, `dispose` and the reconnect monitor. This has to happen in the same commit as the `ActiveContext` deletion in Step 2: leaving the methods behind would break that deletion, and deleting the type first would break these methods.

Also delete `contextChatMode.ts` and its test if `contextToIrisMode` has no remaining caller, and rewrite `test/logic/iris/irisWebSocketSessionClient.resubscribe.test.ts` against `_converge`.

- [ ] **Step 5: Reduce `chatSessionService.ts`**

Of its 843 lines, keep only the availability machinery: `checkAndLoadIrisSettings`, `postAvailability`, `resetAvailability`, `lastAvailability` and their helpers. Delete `loadAllSessionsForContext`, `initializeIrisSessionAndLoadMessages`, `createNewSession`, `switchToSession`, `reloadActiveSessionMessages`, `resetAndReloadSessions`, `_fetchImportAndActivate`, `_loadIrisMessages`, `_storeArtemisSessionId`, `_clearAllSessions`, `_createInFlight`, `_reloadActiveInFlight` and the context-load token (the navigation generation replaced it). Rename the file to `irisAvailabilityService.ts` and move `formatIrisMessages` to `conversation/messageFormatting.ts`, extended to classify `CTXSWAP` separately instead of mapping every non-USER sender to `assistant`.

- [ ] **Step 6: Run `knip`**

Run: `npm run knip`
Expected: no unused files, no unused exports. Fix anything it reports.

- [ ] **Step 7: Run the full suite**

Run: `npm run check-types && npm run lint && npm run test:unit && npm run test:react`
Expected: all PASS. Any failure is fixed here, never skipped.

- [ ] **Step 8: Build both production bundles**

Run: `npm run package && node scripts/package-openvsx.js`
Expected: both succeed. `esbuild.js:9-25` builds `main` (desktop) and `browser` (OpenVSX/EduIDE) from different entry points; a module that imports `vscode` from a shared path breaks only the browser build, and only at package time.

- [ ] **Step 9: Manual smoke test against a real Artemis**

Not automatable and not optional. Walk the six paths in order and record the result in the PR body:

1. Open a workspace for an exercise with no existing conversation. It must acquire one and show the exercise as the topic. This is #373.
2. Send a message. The marker line appears before your message, and the chip keeps showing the same topic, now committed rather than staged.
3. Pick a different exercise in the picker while the conversation has content. It must open or create another conversation, never move this one.
4. Trigger a build failure on another exercise so Artemis's `onBuildFailure` repoints a session. The extension must render the marker and update the chip, not sit on a stale context.
5. Kill the network mid-send. The composer text survives, nothing is resent, and the outcome is reported as unknown.
6. Switch course from the header. The history lists the new course and the invisible cache is empty.

- [ ] **Step 10: Commit**

`git add -u` stages modifications and deletions but **not** new files, and this task creates `conversation/messageFormatting.ts`. Name the additions explicitly:

```bash
git add -u
git add src/extension/services/iris/conversation/messageFormatting.ts src/extension/services/iris/chat/irisAvailabilityService.ts
git status --short   # nothing untracked should remain
git commit -m "refactor(iris): remove the context-first session model"
```

---

## Open dependency, tracked separately

**An Artemis PR** widening `IrisChatSessionRepository`'s overview query from `m.sender = USER` to `m.sender IN (USER, LLM)`. One line plus one test. It stands on its own as an Artemis bug: Iris writes to a student after a failed build and the student cannot find that conversation.

- **Optional for this PR.** Without it, `onBuildFailure` / `onNewResult` conversations are invisible in the overview, so the index misses them and we occasionally create a duplicate. `knownInvisible` covers the session while the process lives.
- **A dependency for PR 2.** There the whole point is that a student can find and continue the conversation holding their hint, and an unreachable hint is a failed intervention.

Start it early: it needs Artemis review and a release, neither of which we control.

---

## Self-review

**Spec coverage.**

| Spec | Task |
|---|---|
| §2 upstream endpoints | 1 |
| §3.1 state, `knownInvisible` lifecycle and bound | 3 |
| §3.2 invariants 1 to 4 | 3 (1, 4), 5 (2), 3 (3) |
| §3.2 invariant 5 (one send, no navigation beside it) | 7, 14 |
| §3.3 `hasContent`, positive-only index, revalidation | 3, 5 |
| §4 resolution table, `navigateTo`, start, new, history, course switch, workspace fallback | 4, 5 |
| §5.1 to §5.7 interface | 12 |
| §6 sorting | 13 |
| §7.1 epochs and load gating | 3, 5 |
| §7.2 pending base revision, always-drop rule | 3, 6 |
| §7.3 send lock | 7, 14 |
| §7.4 ambiguous failure | 7 |
| §7.5 frames carry their session | 6 |
| §7.6 CTXSWAP never finalizes the run | 6 |
| §7.7 navigation generation, reconnect | 5, 8 |
| §9 API changes | 1 |
| §10 removals, persistence migration, `ActiveContext` retirement, reset command, decoupling | 9, 14, 15 |
| §12 error handling | 5 (history open), 7 (send, rate limit), 4 (cross-course) |
| §14 testing | every task |

§8 (proactive hints) and §15 (the ambient `sessionId` bug) are PR 2 and are deliberately absent.

**Review history removed.** Six rounds of codex findings and their resolutions used to be tabulated here. They documented the ancestry of this document, not any requirement of the implementation, and every accepted resolution is already encoded in the tasks above. The seventh round, which produced the scope cuts, is recorded in "Accepted simplifications" at the top, because that one is normative.

**Local findings from the spec review, carried as tasks.**

| # | Finding | Where |
|---|---|---|
| 1 | Guard matrix per async operation | Task 5, Step 1 |
| 2 | Ordering between two concurrent detail loads | Task 3 (`beginLoad` ticket), Task 5 (`_navRequestSeq`) |
| 3 | `navigateTo` at a course switch has no session id | Task 5 (`switchCourse` acquires first) |
| 4 | Revalidation loop termination | Dissolved by cut 4: one probe, then create |
| 5 | `knownInvisible` eviction semantics | Cut 3: no eviction |
| 6 | Send lock vs "a newer pending survives" | Task 7 (one rule: reject every topic change during a send) |
| 7 | `package.json:59-60` command title | Task 14 |
| 8 | Cold start says "no Iris session acquisition request" | Task 5 |
| 9 | Reconciliation-failure cleanup | Task 7 |
| 10 | Reload with no conversation open | Task 14 |

**Type consistency.** `ServerContext`, `SessionSummary`, `SessionDetail` (Task 1) are used unchanged in Tasks 3 to 8. `GuardTuple` and `ContentState` (Task 3) are consumed by Tasks 4, 5, 7, 8. `TopicDecision` (Task 4) is consumed by Task 5 only; it is host-only and cut 1 removed its would-be webview consumer. `sessionId: number` replaces `localSessionId: string` consistently across Tasks 10 and 11.
