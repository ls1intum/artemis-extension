# Iris Conversation-First Chat Model — Design Spec

- **Date:** 2026-07-28 (v5, final for planning)
- **Status:** Final for planning. Reviewed four times by codex; the remaining findings are local and are carried as named tasks in the implementation plan rather than through further prose review.
- **Issue:** #373 (Iris chat cannot start a conversation in an exercise that has none)
- **Branch:** `feat/iris-conversation-first`, off `dev` (`5ec22370`). Worktree at `MA/claudeworktrees/artemis-extension-convfirst`.
- **Supersedes:** `2026-07-27-iris-session-acquisition-design.md` and its plan, which patched the context-first model to survive the upstream change. Codex rejected that plan three times: the machinery it needed existed only to keep a local index honest against a server that legitimately repoints sessions. This spec removes the index.
- **Prototype:** `.superpowers/brainstorm/12957-*/content/prototype-v25.html`. Several interface rules below were found wrong by clicking it and are marked so.
- **Paths:** extension paths relative to `artemis-extension/extension/`, Artemis paths to the sibling `Artemis/` checkout. **All server facts verified against `main` (`553aab7595`)**, never against the locally checked-out feature branch — an earlier draft made exactly that mistake twice.

---

## 1. Motivation

Artemis changed its Iris session model upstream (PR #12696, `0f98d7a185`). **The change is live on `main`**, so the released extension 0.4.8 is broken against production for roughly 940 installs.

**Broken now.** The extension creates a session with `POST /api/iris/chat/sessions?mode=…&entityId=…` (`artemisApi.ts:571`). That endpoint now takes `courseId` and always creates a *course* session (`IrisChatSessionResource.java:126`). Spring rejects at parameter binding, before the controller and before `LoggingAspect`, so the 400 leaves no trace in Artemis logs.

**Also broken.** A message can carry a `pendingContext` that moves its session (`IrisMessageResource.java:129`). The extension never sends one, so a session born `COURSE_CHAT` can never become exercise-scoped from the IDE.

**The deeper mismatch.** Artemis says *a conversation has a mutable context*; the extension says *a context has conversations*, storing `Record<contextKey, StoredSession[]>` (`contextStateTypes.ts`) and filtering server sessions by their current mutable `mode`/`entityId` (`sessionSyncUtils.ts:46`). The existing rehoming pass is that mismatch made visible. No local protocol can fix it: three different writers repoint sessions without participating in any client-side lease (§2).

## 2. Upstream model, verified against `main`

| Endpoint | Parameters | Returns |
|---|---|---|
| `POST /api/iris/chat/sessions/current` | `mode`, `entityId` | full session **with messages** |
| `POST /api/iris/chat/sessions` | `courseId` only | new or reused **empty course** session, no messages |
| `GET /api/iris/chat/courses/{courseId}/sessions/{sessionId}` | — | full session **with messages** |
| `GET /api/iris/chat/{courseId}/sessions/overview` | — | `IrisChatSessionDTO[]`: `id`, `entityId`, `entityName`, `title`, `creationDate`, `lastActivityDate`, `mode` |

Server behaviour the design leans on (`IrisChatSessionService.java`):

- `getCurrentSessionOrCreateIfNotExists` with an exercise mode returns the latest session whose **current** `entityId` is that exercise, else `findOrCreateEmptyCourseSession` (`:517`).
- `findOrCreateEmptyCourseSession` (`:500`) reuses *today's* course session only while `session.getMessages().isEmpty()`; otherwise it creates a new one. `COURSE_CHAT` acquisition therefore always lands on an **empty** course conversation.
- `applyContextChange` (`:428`) no-ops when mode and entity already match, throws `ConflictException` cross-course, persists the `CTXSWAP` marker **before** the user message, and pushes it over the websocket in the same request. It does **not** re-check emptiness.
- **Three callers on `main`, not one:** `IrisMessageResource:129` (user send), `IrisChatSessionService:274` (`onBuildFailure`, BUILD_FAILED), `IrisChatSessionService:309` (`onNewResult`, PROGRESS_STALLED). The last two are `@EventListener`-driven: **production Artemis already repoints a student's open course conversation and writes a proactive message into it, with no thesis code involved.** An earlier draft claimed a single caller; that was a grep that excluded the very file containing the other two.
- The overview requires `m.sender = USER` (`IrisChatSessionRepository.java:42-66`). So a freshly created empty session **and** a conversation containing only proactive Iris messages are both invisible. `lastActivityDate` is `MAX(m.sentAt)` over USER messages only.
- `IrisChatSessionResponseDTO` has no `courseId`.
- `IrisChatWebsocketDTO` carries **no session id**; a frame is identified only by the topic it arrived on.
- `messageDifferentiator` is **`@Transient`** (`IrisMessage.java:83`, "is supposed to be only a part of the dto"). It is echoed in the POST response and the websocket frame, but never persisted, so a later detail `GET` cannot see it. There is no server-side send idempotency and **no way to correlate a sent message after the fact** (§7.4).

`IrisMessageSender.CTXSWAP` payload, verified against `IrisContextSwitchMarker`, `IrisContextSwitchTransition`, `IrisJsonMessageContent.getAttributes` and `IrisMessageContentResponseDTO` on `main`:

```json
{ "sender": "CTXSWAP",
  "content": [ { "type": "json",
                 "attributes": { "transition": "added", "entityMode": "PROGRAMMING_EXERCISE_CHAT", "entityId": 5, "name": "BFS" } } ] }
```

`attributes` sits **inside a content item**, not at the top level of the message, and `@JsonRawValue` emits it as an **object**, not as an embedded JSON string. `transition` is lower-case (`added` | `removed` | `changed`) because the enum carries `@JsonProperty`. `@JsonInclude(NON_EMPTY)` drops `entityMode`, `entityId` and `name` for `removed`, and drops `name` alone whenever the title could not be resolved, so `name` is optional on every transition. An earlier draft placed `attributes` at the top level and as a string; a decoder written to that shape rejects every real marker.

**Artemis's own client** models this with `committed` / `page` / `pending`, displayed as `pending ?? committed` (`iris-chat-context.service.ts`), holds the overview-invisible fresh session in `latestStartedSession`, buckets history by `creationDate` into five groups, and does **not** sort its context picker.

## 3. The new model

### 3.1 State

| Field | Meaning |
|---|---|
| `currentSessionId: number \| undefined` | the one open conversation |
| `detail: SessionDetail \| undefined` | the loaded session: messages of every sender, mode, entityId, title |
| `committedContext: ServerContext \| undefined` | `{ mode, entityId, name? }` as the server reports it |
| `pendingContext: { ctx: ServerContext, sessionId: number, baseRevision: number } \| undefined` | staged, tagged with the conversation and revision it was staged against |
| `contextRevision: number` | **per session**; bumped only by an accepted CTXSWAP frame (§7.1) |
| `sendSeq: number` | **per session**; bumped when a send completes (§7.1) |
| `courseSessions: SessionSummary[]` | the current course's overview |
| `knownInvisible: Map<number, SessionSummary>` | sessions this client created or loaded that the overview does not yet list |
| `courseId: number \| undefined` | the current course; immutable per conversation |

`ServerContext` is **server-native**: `mode` is the full `IrisChatMode` union, including `LECTURE_CHAT`, `TEXT_EXERCISE_CHAT` and any future value, even though the picker offers only course and programming exercise. The overview returns those modes, another client can repoint a session into one, and reconnect can load one. The UI filters what may be *selected*; the transport must represent what the server may *say*. An unrecognised mode string is preserved verbatim, displayed with `entityName` or a neutral label, and never crashes a parse.

`knownInvisible` replaces the single `latestStartedSession` scalar: several invisible sessions can coexist in one course (a fresh empty one plus any proactive-only ones we have seen). Its lifecycle is fully specified, because an unspecified cache is how sessions get lost:

- **entered** on every acquisition (start, new conversation, course switch, history open, proactive open) and whenever a session is seen that the overview does not list;
- **updated** on every accepted detail, CTXSWAP or title change, so a cached summary can never contradict authoritative state;
- **dropped** per entry once the overview returns that session;
- **kept** across a websocket reconnect — a reconnect changes nothing about which sessions exist;
- **cleared** on a course change, and gone on restart, since nothing is persisted;
- **bounded** at 50 entries per course, dropping the oldest by `lastActivityDate ?? creationDate`; a failed overview refresh must not let it grow without limit.

Ordering and tie-breaks everywhere use `lastActivityDate ?? creationDate`, because the overview omits `lastActivityDate` for a session whose only messages are not from the user.

Nothing here is persisted. The workspace exercise stays in `TrackedItemRepository`; it is IDE state, not chat state.

### 3.2 Invariants

1. `pendingContext` is set **iff** its `ctx` differs from `committedContext`.
2. A conversation's **course is immutable**.
3. `committedContext` is only written from a server response or an accepted CTXSWAP. Never inferred.
4. **A conversation that has content is never rehomed** (§3.3).
5. At most one send is in flight, globally, and no navigation runs while it is unresolved (§7.3).

### 3.3 The ownership rule

> **Content is never rehomed.** If the open conversation is empty, it takes the new topic. If it has content, it is left alone: switch to the target's known conversation, or start a new one.

This is the server's own boundary applied to the client. `findOrCreateEmptyCourseSession` repoints only empty course sessions, precisely so a proactive event cannot take over a thread the student is writing in.

**`hasContent` is authoritative and precisely defined:**

- It is `detail.messages.length > 0`, counting **every** persisted sender — `USER`, `LLM`, `ARTIFACT` and `CTXSWAP`. This mirrors `session.getMessages().isEmpty()` on the server.
- A conversation containing only a CTXSWAP marker **has content**. This state is reachable: the marker is persisted before the user message, so a failure in between leaves the marker alone.
- A conversation containing only proactive Iris messages **has content**, even though the overview hides it.
- An optimistic, not-yet-confirmed user bubble counts as content.
- It is **unknown** while `detail` for `currentSessionId` is absent or a load is in flight. Unknown is not "empty": the picker, the chip's `✕` and the Ask-Iris commands are disabled while it holds.
- The header's message count is a *display* value that excludes CTXSWAP rows. It must never be used as this predicate.

**"Does the target already have a conversation" is a positive-only index, and every hit is revalidated.** It is answered from `courseSessions ∪ knownInvisible`, matching on `mode`/`entityId` within `courseId`; on several matches, the newest `lastActivityDate ?? creationDate` wins.

- A **hit is a hypothesis, not a fact.** Both sources can be stale: another client may have repointed that session since. So after the `GET`, compare the returned context against the requested target. On a match, adopt it. **On a mismatch, do not silently adopt what came back** — that would hand the student a conversation about E2 when they asked for E1. Re-run resolution against the returned authoritative state instead, and refresh the index entry.
- A **miss is not proof of absence**, because the overview hides conversations without a USER message (§2). A miss starts a new conversation.

**What a miss actually costs.** Not merely a duplicate. A conversation containing only proactive Iris messages is invisible in the overview; once `knownInvisible` is gone — after a restart, or after switching courses and back — the student **cannot reach it at all**. The row survives in the database and is lost to the user. An earlier draft claimed "a duplicate, never a loss"; that was wrong.

**Consequence for the milestones.** Widening the overview query to `m.sender IN (USER, LLM)` is one line plus one test in Artemis, and it stands on its own as an Artemis bug ("Iris writes to you after a failed build and you cannot find that conversation"). It is therefore:

- **optional for PR 1**, where its absence costs occasional duplicates from `onBuildFailure` / `onNewResult` conversations;
- **a dependency for PR 2**, where the whole point is that a student can find and continue the conversation holding their hint. An unreachable hint is a failed intervention.

Even with the change, `CTXSWAP`-only and `ARTIFACT`-only sessions stay invisible. Those are transient states, and we accept them.

**The cost, accepted deliberately:** a conversation with content can no longer be moved to another topic. Upstream allows that. We give it up so a conversation stays where it is looked for. The picker labels this (§5.3) so it is not a surprise.

### 3.4 Terms

- **Course** — the container. Fixed at creation. Determines selectable exercises and which conversations the history lists.
- **Topic** (code: context) — what Iris looks at: the whole course, or one exercise. Mutable, staged then committed.

## 4. Lifecycle

**Two operations, not one.** They were conflated in v3 and that was wrong:

- **`resolveTopicChange(target)`** takes a *topic* and decides which conversation should carry it. Used by the picker, the chip's `✕`, and the Ask-Iris commands.
- **`navigateTo({ courseId, sessionId, savedPending? })`** takes a *conversation id*. Used by the history, the course switch, and the notice's undo. It never consults the topic index.

Undo is the second kind. It reopens a specific conversation, in a specific course, and restores `savedPending` only if that conversation is still empty. Routing it through the topic table would, after a course change, try to stage course A's topic into course B — an illegal cross-course staging.

`resolveTopicChange` resolves in this order; the first matching row wins:

| Condition | Outcome |
|---|---|
| `target` equals the effective topic (`pending ?? committed`) | no-op |
| `target` equals `committedContext` and a different pending exists on an empty conversation | clear the pending; no request |
| no current session (cold start) | acquire through `sessions/current` for the target, then stage the target if a course session came back |
| `hasContent` unknown | refuse; the control is disabled until the detail loads |
| `hasContent` false | stage it; no request |
| `hasContent` true, target found in the index | `GET` that conversation, **revalidate** (§3.3); on a match switch, on a mismatch re-resolve |
| `hasContent` true, target not found | `POST sessions?courseId`, stage the topic in the fresh conversation |

The cold-start row matters: without it the dashboard's "Ask Iris about this exercise" would refuse, because with no conversation open `hasContent` is unknown and the previous table's first row disabled the command.

**Start.** `POST sessions/current?mode=PROGRAMMING_EXERCISE_CHAT&entityId=<workspaceExerciseId>` yields id, mode, entityId, title and messages in one call. `courseId` is not in the response: it is the workspace exercise's course, known from `TrackedExercise`, with `courseIdResolver.ts`'s chain retained (retargeted off `ActiveContext`) for the case where the tracked item lacks it. If the server returns a *course* session it is empty by construction, so the workspace exercise is staged. Without a workspace exercise: no request, see §5.7.

**New conversation (header `＋`).** `POST sessions?courseId`. Enters `knownInvisible`. The displayed topic carries over as pending when it is an exercise.

**Open from history.** `GET courses/{courseId}/sessions/{sessionId}` → adopt its context, clear pending. Nothing is auto-staged even when the workspace exercise differs: an explicit "open this conversation" outranks passive detection.

**Switch course.** `POST sessions/current?mode=COURSE_CHAT&entityId=<courseId>`, which lands on an empty course conversation. `knownInvisible` is cleared; the history then lists that course.

**Send.** `pendingContext.ctx` travels with the message. No correlation id is sent: `messageDifferentiator` is `@Transient` and could not be read back (§7.4, decision 13a). Ordering rules in §7.

**Overview refresh.** After a send that gave the conversation its first USER message, refresh `courseSessions` (debounced, one in flight) so the conversation stops being invisible and leaves `knownInvisible`.

**Workspace changes mid-session.** Normally a reactivation, i.e. the Start path. When detection reruns inside a live session (`wireWorkspaceDetection.ts:79`), the new workspace exercise only changes which picker entry is pinned and badged. It never touches an open conversation; when detection clears it, only the badge disappears.

**Workspace fallback.** An **empty** conversation whose context differs from the workspace exercise gets the workspace exercise staged. This is Artemis's `adoptServerContext` narrowed by invariant 4 — and once narrowed it collapses into the Start rule, so it is not a separate setting. On a conversation with content, nothing happens.

## 5. Interface

### 5.1 Header — one row, two lines

```
[book-open] Einführung in die Informatik ⌄        [plus] [history]
            BFS Endlosschleife · 8 Nachrichten
```

Line 1 is the course; **only that line** is clickable and it opens the course list, so a click never lands on a target the label did not name. Line 2 is the conversation title and its display message count (excluding CTXSWAP rows; the overview carries no count, so this comes from the loaded detail). The topic is deliberately absent — it lives on the composer chip, so each fact appears exactly once.

### 5.2 Composer chip — the topic

Artemis's chip, values from `context-selection.component.scss`: fill `color-mix(primary 12%)`, border 25%, **normal body text colour**, pill radius, `✕` at 40% opacity going to full on hover.

**One visual state**, like Artemis: the chip shows `pending ?? committed` and does not distinguish staged from committed. No chip when the topic is the course. Clicking the chip opens the picker.

**The `✕` appears only while the conversation is empty**, where it genuinely does what its shape promises: it drops the topic in place, with no request and no visible change beyond the chip. On a conversation with content, removing the topic necessarily means leaving for another conversation, and a small remove-icon must not silently replace the whole transcript. There the `✕` is hidden and the picker's "Kurs-Chat" entry carries the action instead, labelled "wechselt zur Unterhaltung" or "neue Unterhaltung" like every other entry, so the consequence is stated before the click.

Two earlier drafts got this wrong in opposite directions: one had `✕` stage unconditionally, violating invariant 4; the next routed it through `resolveTopicChange` and made a remove-icon navigate.

The staged-vs-committed ambiguity this leaves is closed by the preview line (§5.6), not by a second chip style.

### 5.3 Topic picker (composer `＋`)

Popover opening upward. Search scoped to the current course, "Kurs-Chat" as a fixed first entry, then the course's exercises with the workspace exercise pinned and badged. One checkmark on `pending ?? committed`.

**Each entry announces its outcome** from the §4 table: "wird Thema", "wechselt zur Unterhaltung", "neue Unterhaltung". The labels are computed when the popover opens; if `courseSessions` refreshes while it is open, recompute rather than act on a stale label. While `hasContent` is unknown the entries are disabled.

**No cross-course entries**: `applyContextChange` rejects cross-course, so such a pick could never be a staging, and mixing a navigation into this menu would make one click mean two different things.

### 5.4 History (header `history`)

Search field, then a flat list of `courseSessions ∪ knownInvisible` for the current course. Row: `message-square`, title, current context, relative time. Checkmark on the open one.

**Lecture, text-exercise and unknown-mode conversations are listed**, labelled by `entityName` with a neutral icon, and can be opened and continued. They simply cannot be *selected as a topic* in the picker. This replaces `courseHistory.ts:18-29`, which filters them out today: hiding a conversation the student can reach from the web client is worse than showing one whose topic we cannot set.

### 5.5 Course list (header line 1)

The student's courses, most-recently-viewed then alphabetical, from the tracked-course repository. On a fresh installation with nothing tracked, fetch the dashboard course list first and show a loading state; an empty course list is an explicit "no courses found" state, not a silent empty popover. **No per-course conversation counts** — the overview is per course, so counts would cost one request per course on every open.

### 5.6 Transcript markers and the notice

| | When | Lifetime |
|---|---|---|
| **CTXSWAP line**, full width | the server actually changed the topic | permanent, it is a stored message |
| **Preview line**, dashed and italic, at the end of the transcript | something is staged | until sent or unstaged |
| **Notice**, one muted line above the composer | the system changed your situation | 10 s, then fades |

The **CTXSWAP line** mirrors `iris-context-switch-divider.component.html`: "Thema gesetzt auf X" / "Thema gewechselt zu X" / "Thema entfernt". Not clickable — we have no exercise page to route to. It appears **before** the message that triggered it, matching the server's write order.

The **preview line** sits exactly where the real line will land and uses the same three transitions. It is what tells the student the chip is staged rather than current, which is why §5.2 can stay single-state. Note the limit: it is *not* true that every exercise-scoped conversation carries a marker, because sessions created before the upstream change were born exercise-scoped. We do not synthesise markers for them; the preview line stands on its own.

The **notice** carries one action, and it is a `navigateTo` (§4), never a topic change. It captures `{ courseId, sessionId, savedPending }` at the moment it is raised, so it stays valid even if the course has changed since. It restores `savedPending` only if that conversation is still empty; otherwise it navigates and leaves the topic alone, because re-applying a staging into a conversation that has gained content is exactly the rehoming invariant 4 forbids.

**A notice is cleared by any navigation or course change**, not only by its own timeout. Undo is an offer to return to the state the system took away; once the student has moved on themselves, there is no such state to return to.

Two rendering changes are required: `formatIrisMessages` (`chatSessionService.ts:56`) maps every non-`USER` sender to `assistant` and must classify `CTXSWAP` separately; `extractIrisMessageContent` (`messageUtils.ts:22`) falls through to `item.toString?.()` for object content, yielding `"[object Object]"`, so marker content must be decoded from `attributes` and never routed through it. The webview transcript type permits only `user | assistant` today (`views/IrisChat/types.ts`).

### 5.7 Cold start

No workspace exercise detected. No header, **no request**. The empty transcript offers the course list directly: "Kein Artemis-Arbeitsbereich erkannt. Wähle einen Kurs, um zu starten." Choosing one runs the course-switch path.

## 6. Sorting

**Picker exercises** (`pickerSort.ts:15`): workspace pinned; then due date **ascending**, soonest first; no/invalid due date last; ties alphabetical. This **changes** the implemented descending order. The 2026-07-21 spec justified descending as consistency with Artemis, but Artemis's *chat* picker does not sort at all — `sortExercises` belongs to the course-overview sidebar, a different screen.

**Course list:** most-recently-viewed, then alphabetical (unchanged).

**History:** five buckets — Heute / Gestern / Letzte 7 Tage / Letzte 30 Tage / Älter — matching Artemis, but keyed on **`lastActivityDate`** so a conversation continued yesterday appears under "Gestern". Newest first within each bucket. `historyBuckets.ts:23-55` subtracts fixed 24-hour spans from local midnight and is wrong across DST; fix while touching it.

## 7. Ordering and concurrency

Three writers mutate a session's context: this client, another client, and Artemis's own proactive event listeners (§2). Two channels carry the news: the HTTP response to a send, and websocket frames. They are unordered relative to each other.

### 7.1 Session-scoped epochs, and no epoch for loads

Both counters are **per session**, not global, and every asynchronous result carries the full guard tuple `{ sessionId, navigationGeneration, contextRevision, sendSeq }` captured at request start. Two context-free numbers cannot survive a session switch: a revision earned in conversation B would otherwise look causally newer than intent formed in conversation A.

- **`contextRevision`** is bumped **only** when a CTXSWAP frame is accepted for that session. A frame is pushed at mutation time, so it is always newer than anything in flight.
- **`sendSeq`** is bumped when a send completes for that session.
- **A load bumps neither.** Loads are *observations*, and an observation that started before a mutation is not newer than it. A load result is installed only if, for the same `sessionId`, the navigation generation is still current **and** neither `contextRevision` nor `sendSeq` has moved since the load began.

Both guards are load-bearing and each catches a different sequence:

- without the `sendSeq` guard, a detail GET issued before a POST returns the pre-POST context, is accepted afterwards, and suppresses the successful write-back;
- without the `contextRevision` guard, a reconnect GET issued before another client's repoint overwrites the CTXSWAP that already installed the new context, and nothing later repairs it. Worse, the send's write-back then sees the revision "moved to something else" and refuses — so the branch meant to protect newer truth would be the one discarding it.

A load whose guard fails is discarded, not merged. The correct state is then re-fetched by the next reconciliation trigger.

A send captures `{ sessionId, ctx, contextRevision }` before the request. On the response:

- session changed meanwhile → discard the write-back;
- `contextRevision` unchanged → commit exactly the context that was sent;
- revision moved and the newer committed already equals the sent context → leave it (the ordinary self-CTXSWAP, arriving before the response);
- revision moved to something else → do nothing; the server has newer truth, and the response body does not contain the session context at all.

### 7.2 Pending has a causal base

`pendingContext` records the `sessionId` and the `contextRevision` it was staged against. A pending whose `sessionId` is not the current one is discarded outright — intent formed in another conversation has no standing here.

When a CTXSWAP arrives for the current session naming a **different** context, the pending is **always dropped**, and the notice for this case is informative only, with no action.

There is deliberately no "the conversation was still empty, so the staging survives" branch. The marker is itself a persisted message (§3.3), so the conversation has content the moment it is appended; a surviving staging would let the next send rehome it, violating invariant 4. And an undo could never restore that staging for the same reason, so offering one would be a lie. v3 had both the unreachable branch and the impossible undo.

When the arriving CTXSWAP names the context that was **already staged**, the pending is cleared as satisfied (invariant 1), with no notice at all — the student got what they asked for.

The notice's undo survives only where it can actually work: a navigation the student did not initiate (§5.6).

Without the base revision there is no way to tell a staging that is newer than the marker from one that is older, and the "keep a newer pending" rule is unimplementable. The concrete damage it prevents: another writer gives the conversation content, and a stale local staging then rehomes it.

**This handling is generic and lives in PR 1**, not in the proactive feature. Production Artemis repoints sessions on build failure and stalled progress (§2), so this sequence occurs without any thesis code.

### 7.3 One send, and no navigation while it is unresolved

Host-enforced, not merely a disabled button — the webview's streaming state resets on disconnect, so UI gating is not an invariant. Because there is one websocket subscription and one run state machine, the invariant is **one in-flight send globally**, and the host rejects history opens, course switches, new conversations, picker switches and undo while it is unresolved. Symmetrically, a send is refused while a navigation load is in flight.

### 7.4 Ambiguous send failures need a correlation field

There is no server-side idempotency, and **no way to correlate a sent message after the fact**: `messageDifferentiator` is `@Transient` (§2), so it is gone by the time a reconciliation `GET` runs. Persisting a client request id would need an Artemis column and migration, which we are not making a dependency of PR 1.

**So we do not try to determine whether our message landed.** The client's job on an ambiguous failure is not classification, it is leaving nothing corrupted:

1. `GET` the detail, adopt it, recompute `hasContent` from what actually came back;
2. drop a divergent `pendingContext` if the conversation now has content — regardless of whose content it is, because a retry would otherwise rehome it;
3. never auto-resend;
4. leave the text in the composer, so nothing the student typed is lost;
5. report the outcome as genuinely unknown.

The student then sees their own transcript, which answers the question better than any heuristic could: either the message is there or it is not. If reconciliation itself fails, change nothing, surface the error, and do not retry.

`sendSeq` is incremented once the send's result has been fully processed, including this reconciliation path, so a load that started earlier can never install a pre-send snapshot afterwards (§7.1).

The existing compatibility retry (`artemisApi.ts:521-543`) re-POSTs on any 400 when uncommitted files are present. It must never fire for a `pendingContext` 400, and never without the pending context it originally sent.

The existing compatibility retry (`artemisApi.ts:521-543`) re-POSTs on any 400 when uncommitted files are present. Once `pendingContext` exists, a pending-context 400 must not be retried without it.

### 7.5 Frames must carry their source session, installed in a defined order

`IrisChatWebsocketDTO` has no session id, and `subscriptionRegistry.ts` discards the id it subscribed with before invoking the handler. Thread it through and **drop every frame whose source is not `currentSessionId`** — all frames, not only CTXSWAP.

The order is part of the fix, not an implementation detail:

1. the subscription callback captures its source session id;
2. the handler reads `currentSessionId` at entry;
3. a mismatch is dropped **before** anything else;
4. only then may the frame admit a run or touch context or transcript.

`currentSessionId` must be installed before the new session is exposed to any UI command. Without this, an unknown run can bind as current (`irisRunStateMachine.ts:32-48`) from a frame belonging to the conversation just left.

### 7.6 A CTXSWAP frame must not finalize the run

`irisWebSocketMessageHandler.ts:115` reaches `finalizeRun` at `:134` before any rendering decision. The server pushes the marker *while our own POST is open*, so today a successful first message terminates its own run. Classify at the transport boundary: a CTXSWAP frame updates `committedContext`, bumps `contextRevision`, applies §7.2 to the pending, appends a line, and never touches run state. A `removed` marker has no entity fields, so derive the course context from the conversation's `courseId`.

### 7.7 Navigation generation and reconnect

Every acquisition captures a generation token and installs only if still current; this also stops a slow course-A overview from replacing course B's `courseSessions`. The current code already has such a token (`chatSessionService.ts:81-117`).

Reconnect resubscribes to `currentSessionId` and reconciles through the **full detail endpoint**, not just messages: server context, transcript including markers, title, pending normalisation (§7.2), run completion. A CTXSWAP can occur between the `GET` completing and the subscription becoming active, so subscribe before adopting the snapshot, or reconcile a second time after subscribing.

Reconnect reconciliation is a load and obeys §7.1 in full: it is discarded if `contextRevision` or `sendSeq` moved while it was in flight. In particular it may fire **during an unresolved send**, since a disconnect does not cancel a POST — so it must never install a snapshot that predates that send's completion. `knownInvisible` is untouched by a reconnect: which sessions exist has not changed.

## 8. Proactive hints

Generic server-repoint handling is PR 1 (§7.2). This section is the struggle-specific behaviour, PR 2.

**The server decides where a hint goes before the client knows anything.** `resolveProactiveSession` acquires the exercise session, applies the context change only if the resolved session is still `COURSE_CHAT`, verifies the result is exercise-bound, and drops the intervention otherwise. Under single-writer execution it therefore never takes over a conversation with content. **It is not a hard guarantee under concurrency**: `applyContextChange` does not re-check emptiness, the entity carries no optimistic version, and no transaction spans acquisition and application, so a message saved between the two can be rehomed. The client must not assume the invariant holds; §7.2 handles it either way.

| Situation | Behaviour |
|---|---|
| hint's session is the open one | append; if the server repointed it, adopt the context and render the line |
| hint's session is the open one and something else is staged | §7.2 drops the staging, notice with undo |
| hint's session is another conversation, level *More* | switch to it, notice with "Zurück" |
| hint's session is another conversation, level *Less* | do not navigate; quiet cue only |
| a run is in flight | never navigate, on any level |

The client **never stages for a hint**. Staging is user intent only.

**Uncommitted files** are attached to a send only when the effective send context **is** the detected workspace exercise. Under staging the effective context can be an exercise the workspace does not belong to, and sending exercise Y's diff under X's context is worse than sending none.

Implementation traps: when the resolved id equals the open session the switch must **not** early-return the way `switchToSession` does (`iris-chat.service.ts:923`), or the context stays stale; the optimistic bubble is posted before the session opens today, so key it by server session id or post it after selection; and proactive-only conversations are invisible in the overview (§2), so they must enter `knownInvisible` when seen.

## 9. API changes

`src/extension/api/artemisApi.ts`:

- `getCurrentChat` (`:560`) — parse `mode`, `entityId`, `title`, `messages`, not only `id`. `@JsonInclude(NON_EMPTY)` means `messages` is **absent** when empty; treat as `[]`.
- `createChatSession(mode, entityId)` (`:571`) → `createCourseSession(courseId)`.
- **new** `getChatSessionById(courseId, sessionId)`.
- `sendChatMessage` (`:489`) — gains optional `pendingContext: { mode, entityId }`. Build the payload once; the duplicated literal in the try and the 400-retry catch is a hazard (§7.4). No correlation id is sent: it would not survive persistence (§2).
- `listChatSessionsForCourse` (`:582`) — additionally parse `title`, `entityName`, `lastActivityDate`.

## 10. Removed, retired, and in scope

| Path | Lines | Why |
|---|---|---|
| `context/sessionManager.ts` | 334 | the per-context index, rehoming, empty-session cleanup |
| `context/sessionSyncUtils.ts` | 146 | imports server sessions by filtering on their mutable context |
| `sessions` / `activeSessionId` in `contextStateTypes.ts`, `contextPersistence.ts` | — | no local session store remains |
| large parts of `chat/chatSessionService.ts` | of 843 | creation guards, dual persistence writes (`:572`, `:792`), zero-session fallback |
| the binding / epoch / lease design | — | never built |

**`ActiveContext` is retired, not repurposed.** Its `source`, `locked`, `selectedAt` and auto-selection semantics belong to the context-first model; reusing the type under a new meaning would carry those assumptions through the type system. It splits into: workspace exercise (IDE state), current course (navigation), `ServerContext` for committed and pending, and a narrower UI union for what may be selected.

**Persistence migration.** `contextPersistence.ts:49-76` strips `sessions` and `activeSessionId` but **preserves `activeContext`**. Bump the store version and migrate: keep tracked exercises and courses, drop `activeContext`, sessions and active session, and never cold-start from a stale persisted topic.

**Files the rewrite must touch**, each currently encoding the old model:

- `chat/chatMessageService.ts` — reads `ActiveContext`, acquires the session through the websocket client, sends to that mutable id
- `transport/irisWebSocketSessionClient.ts` — `ActiveContext`-based acquisition, calls the deleted create endpoint, emits sessionless frames
- `chat/chatContextManager.ts` — register → set active context → reset session → load bucket
- `context/contextSnapshot.ts` — builds the per-context bucket and local active session
- `context/courseIdResolver.ts` — still needed (§4), retargeted off `ActiveContext`
- `context/courseHistory.ts` — the lecture/text filter is replaced per §5.4
- `chat/historyResolution.ts`, `chat/chatDiagnosticsService.ts`
- `context/contextStore.ts` — `onDidChangeActiveContext` has consumers beyond the struggle emitter
- `provider/chatWebviewProvider.ts` — the central dispatcher; owns the new navigation/send gating (§7.3)
- `provider/chatReloadDecision.ts` — keys reconnect retry to `ActiveContext`
- `provider/chatViewStatePresenter.ts` — defines the host→webview snapshot
- `provider/baseWebviewProvider.ts` — its event dedup list knows only `websocketUpdate` and `addMessage`; the notice, marker and state events need a delivery classification
- `webview/stores/useChatStore.ts` — `context`, local `activeSessionId`, local sessions, local-session-keyed stale guards
- the message contracts — `updateIrisState`, `addMessage`, `loadMessages`, `sendMessage`, `selectChatContext`, `switchSession`, `createNewSession` all encode the local-session model
- the components — `ChatHeader`, `ContextPicker`, `ConversationHistory`, `ChatInput`, `ChatMessageList`, `MessageBubble` carry the chip, effect labels, preview line, notice, marker rows and navigation locks
- `shared/types/context.ts` — `ActiveContext`, `StoredSession`, the old `ContextSnapshot`
- `types/IChatWebviewProvider.ts` — `getSelectedContext`, `setExerciseContext`, `setCourseContext`
- `activation/extensionCommands.ts:83` — derives the course from the active context
- `activation/extensionCommands.ts:43-68` — the **"Reset Iris Chat Sessions"** command calls `clearAllSessions()` and promises to clear a store this design deletes. It is **repurposed, keeping its command id**, as "Reload Iris chat": drop `courseSessions`, `knownInvisible` and the loaded detail, then re-acquire the current conversation and refresh the overview. That preserves the escape hatch it exists for (a wedged client) without pretending to own conversations that live on the server
- `controller/commands/irisCommands.ts:47,80` — "Ask Iris about this exercise/course" runs `resolveTopicChange` (§4) with the command's target, including the cold-start row when no conversation is open; it may therefore open another conversation, and the command's progress message must say so

**Decoupling.** `chatWebviewProvider.ts:178` fires `_onDidChangeExerciseContext` whenever the active chat context becomes an exercise, retargeting struggle detection at an exercise whose code is not open. Removed: the detector follows the **workspace**, the chat context follows the **conversation**.

## 11. Not copied from Artemis

- **Unconditional auto-staging in `adoptServerContext`** — would override an explicit "open this conversation" with a passive detection, and would rehome content. Narrowed by invariant 4 (§4).
- **Route-driven conversation selection** — applied to the workspace it would make the workspace a context-to-session selector again. We do it once, at start.
- **Rehoming a conversation with content** (§3.3) — the one capability we deliberately give up.
- **A silent chip** — Artemis cannot distinguish staged from committed anywhere; the preview line closes that (§5.6).
- **Ignoring inbound CTXSWAP** — `handleMessageWebsocketPayload` appends the message and never touches the context signals, so after an external repoint the Artemis chip shows a stale context while the line says otherwise. We update `committedContext` (§7.6).
- **Cross-course reach in the picker** — rejected by `applyContextChange`.
- **A course switcher** — Artemis has none; the course comes from the URL. We must invent one (§5.5).

## 12. Error handling

- **Start fails** — existing unavailable state; no local session invented; retry on next activation.
- **Send fails** — §7.4's matrix. Never blind-retry.
- **Rate limit** — send exposes `429` (`IrisRateLimitExceededException`); surface it as such.
- **History open** — `400` (wrong course / not a chat session) and `404` (absent) remove the row from `courseSessions` and `knownInvisible`. `403`, `5xx` and network failures **keep** it and only report; the conversation may still exist.
- **Cross-course staging** — prevented in the UI (§5.3). A `ConflictException` reaching the client is a bug and is logged as one.

## 13. Milestones

Split by base branch: the struggle code (~120 files, 438 files of divergence) exists only on `feat/struggle-v3-integration`, and a PR against `dev` cannot touch files that are not there.

**PR 1 — `dev`.** §3–§7, §9–§12. This now includes **generic server-repoint handling** (§7.2): production Artemis repoints on build failure and stalled progress, so deferring it would ship a known ownership violation. The notice component lands here too, because the picker navigates.

**Then `dev` → `feat/struggle-v3-integration`.** After the merge that branch will not compile: the proactive path calls APIs PR 1 deletes. Do the merge on a `merge/dev-into-struggle-v3` branch, restore green there, and open **that as a PR** rather than resolving inside an unreviewed merge commit — textually clean merges are exactly where intent is lost. Promptly: divergence only grows.

**PR 2 — `feat/struggle-v3-integration`.** §8 plus §15. Not a narrow follow-up: struggle-v3 modifies every surface PR 1 rewrites, and proactive open currently injects a local session into the active context bucket — the exact model PR 1 deletes.

**An Artemis PR** widening the overview query to `m.sender IN (USER, LLM)` (§3.3). One line plus one test. **Optional for PR 1** (it removes duplicate conversations from `onBuildFailure` / `onNewResult`), **a dependency for PR 2**: without it a student cannot reach the conversation holding their hint once `knownInvisible` is gone, and an unreachable hint is a failed intervention. Start it early — it needs Artemis review and a release, neither of which we control.

## 14. Testing

Mocha under `test/unit/`, vitest under `test/logic/` and `test/react/`. Do not mix. `knip` treats `test/**` as an entry point, so deletions must remove their tests too.

Beyond the happy paths:

- `hasContent`: CTXSWAP-only and proactive-only conversations count as content; unknown disables the picker; the `✕` is absent whenever content exists
- `resolveTopicChange` cold start: an Ask-Iris command with no conversation open acquires one instead of refusing
- a positive index hit whose `GET` returns a different context re-resolves instead of adopting it
- undo after a course switch reopens the recorded `{courseId, sessionId}` and never stages across courses; any navigation clears a pending notice
- the "Reload Iris chat" command re-acquires and refreshes instead of clearing a store that no longer exists
- the four `resolveTopicChange` outcomes, including that a conversation with content is never rehomed, driven through the picker, the `✕`, the Ask-Iris commands and undo
- a target that exists only in `knownInvisible` is found; a target absent from both yields a new conversation
- send: commits exactly the sent context; a newer pending staged mid-request survives; a session switch mid-request discards the write-back; an HTTP response arriving after a newer CTXSWAP does not overwrite it; **a detail load started before a completed send does not suppress its write-back**
- a second send is rejected while one is in flight; navigation is rejected while a send is unresolved, and vice versa
- §7.2: a CTXSWAP that gives an empty conversation content drops a divergent pending and offers undo; undo does not re-apply it into a now-nonempty conversation
- an old-session frame (CTXSWAP and assistant) is dropped after a switch, and an unknown run from such a frame never binds
- ambiguous failure: the detail is adopted, a divergent pending dies once the conversation has content, nothing is auto-resent, the composer text survives, and the outcome is reported as unknown
- reconnect re-adopts server `mode`/`entityId`, not merely merges messages; and the GET-to-subscribe gap
- `knownInvisible`: entry on every acquisition path, dedup once the overview returns it, cleared on course change
- lecture/text/unknown-mode sessions appear in history, open, and cannot be selected in the picker
- uncommitted files omitted when the effective context is not the workspace exercise
- cold start issues no request until a course is chosen, including the no-tracked-courses path
- v2 persistence migration: tracked items kept, `activeContext` dropped
- `403`/`5xx` on history open keep the row; only `400`/`404` remove it
- sorting: ascending due date with nulls last; bucket boundaries at today / yesterday / 2–6 / 7–29 / 30+; DST transitions
- both the normal and the OpenVSX/EduIDE production build (`esbuild.js:9-25`; `package.json` `main` and `browser`)

Existing suites needing migration, at minimum: `chatSessionService`, `chatMessageService`, `contextStore`, `contextPersistence`, `chatContextManager`, `courseHistory`, `courseIdResolver`, `historyResolution`, `sessionManager`, `sessionSyncUtils`, `websocket`, `subscriptionRegistry`, `irisWebSocketSessionClient.resubscribe`, `irisWebSocketMessageHandler`, `chatWebviewProviderReconnect`, `chatWebviewProviderOpenSession`, `chatWebviewProviderCourseHistory`, `chatWebviewProviderWorkspaceSink`, `useChatStore`, `messageContracts`, plus the React flow and Iris view suites.

Server contracts (empty-session reuse, marker write order, the course-switch landing on an empty conversation) are not provable from extension mocks; assert them as explicitly-stated mocked contracts citing `IrisChatSessionServiceTest.java:167-193`.

## 15. Independent bug, its own PR

Unrelated to this rewrite: **the `sessionId` of an ambient struggle frame is discarded.** The parser reads it (`struggleEventSubscription.ts:62`), but `StruggleEventHandlers.onServerAmbient` omits the parameter and `telemetry/index.ts:264` calls the orchestrator without it. The orchestrator is ready — `struggleInterventionService.ts:769` takes `sessionId` as its eighth argument and sets `_frozenSessionId`. So for a server-decided `ambient` decision `_frozenSessionId` stays undefined and `revealParkedHint` aborts at its step-2 guard (`:1954`): **revealing an ambient hint silently does nothing.** That is the Pull/Less path. Roughly three lines, on `feat/struggle-v3-integration`.

## 16. Out of scope

- Lectures as a selectable topic (the transport represents them, the history shows them, the picker does not offer them).
- Cross-course search in the picker.
- Persisting conversations across restarts.
- Renaming or deleting conversations.
- Synthetic CTXSWAP markers for pre-upgrade exercise sessions.
- Any change to struggle detection itself: detector, episode state machine, evaluation logic and intervention policy are untouched.

## 17. Decision log

| # | Decision | Rationale |
|---|---|---|
| 1 | Conversation-first rewrite, not the binding/epoch/lease patch | the patch defends an invariant the server rejects |
| 2 | Picking stages, no "new conversation about X" shortcut | header `＋` then picker reaches the same state |
| 3 | Opening from history stages nothing | an explicit open outranks passive detection |
| 4 | Start asks the server (`sessions/current`) | matches "carry on where I was", and #373 needs the endpoint anyway |
| 5 | Topic on the composer chip, not in the header | position disambiguates without extra chrome |
| 6 | One header row: course on top, conversation below | with the topic on the chip, a course-topic conversation showed the course name twice |
| 7 | Course switch only from the header | the picker only changes the open conversation; the header only navigates |
| 8 | Chip has one visual state, Artemis's | a permanent accent chip trains people to ignore it |
| 9 | Preview line for a staged topic | closes decision 8's gap where the change will land |
| 10 | **Content is never rehomed**, through one `resolveTopicChange` | prevents an exercise's conversation from vanishing under another label; mirrors the server's boundary; one function means `✕` and the commands cannot bypass it |
| 11 | The target lookup is positive-only, and every hit is revalidated after the `GET` | the overview hides proactive-only conversations, and a cached hit can be stale after an external repoint |
| 11a | The Artemis overview widening is a dependency for PR 2, not for PR 1 | an invisible proactive conversation is unreachable after a restart, which makes the hint itself worthless |
| 11b | Topic resolution and conversation navigation are two operations | undo, history and the course switch address a conversation by id; only the picker, `✕` and the commands address a topic. Conflating them made undo attempt a cross-course staging |
| 12 | Due date ascending | the consistency argument for descending referenced the wrong Artemis screen |
| 13 | Five history buckets on `lastActivityDate` | date chosen so a continued conversation stays findable |
| 13a | No ambiguous-send correlation, by choice | `messageDifferentiator` is `@Transient`; persisting one needs an Artemis migration, and the client only needs to leave state uncorrupted, not to classify the outcome |
| 14 | Two **per-session** epochs, and loads bump neither but are gated by both | an observation that started before a mutation is not newer than it, and global counters are not comparable across a session switch |
| 15 | Generic repoint handling in PR 1 | production Artemis repoints on build failure and stalled progress |
| 16 | PR 1 on `dev`, merge branch, then PR 2 | struggle code does not exist on `dev`, and only `dev` reaches a release |
