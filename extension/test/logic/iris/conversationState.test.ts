import { beforeEach, describe, expect, it } from 'vitest';

import type { SessionDetail } from '@shared/types/serverContext';

import { ConversationState } from '@extension/services/iris/conversation/conversationState';

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
        // Without this the state reports a conversation the student has already
        // written in as empty, and the message count, the in-flight union and
        // the marker handling all read a transcript missing its newest rows.
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

    it('drops a divergent pending on a swap that actually changes the topic', () => {
        // Somebody else just set the topic. Our staging was formed before that
        // and now contradicts it, so it dies and the student is told. There is
        // deliberately no undo. The exception is a marker that merely repeats
        // the committed context; that case is covered separately below.
        state.stagePending(EX5);
        const outcome = state.applyContextSwap({ transition: 'added', context: EX7 }, swapMessage(20, { transition: 'added' }));
        expect(outcome).toBe('pending-dropped');
        expect(state.snapshot().pendingContext).toBeUndefined();
        expect(state.contentState()).toBe('content');
    });

    it('keeps a staging when the marker only repeats the context we already committed', () => {
        // Our own send committed EX5 locally via the write-back; the server's
        // CTXSWAP for it arrives afterwards. By then the student has picked
        // again. That late marker announces nothing new, so it must not discard
        // the newer pick, and must not claim "the topic was changed elsewhere".
        install(state, detail({ sessionId: 1, context: COURSE42 }));
        state.commitContext(EX5);
        state.stagePending(EX7);

        const outcome = state.applyContextSwap({ transition: 'changed', context: EX5 }, swapMessage(20, { transition: 'changed' }));

        expect(outcome).toBe('pending-kept');
        expect(state.snapshot().pendingContext?.ctx).toEqual(EX7);
    });

    it('drops a staging when an installed detail reveals a context we never committed', () => {
        // A reconciliation after an unknown send outcome, with another client
        // having repointed the session meanwhile. The detail is authoritative:
        // the topic moved under us, so a staging formed before that is the same
        // conflicting intent `applyContextSwap` drops.
        install(state, detail({ sessionId: 1, context: COURSE42 }));
        state.stagePending(EX5);

        state.installDetail(detail({ sessionId: 1, context: EX7 }), state.beginLoad());

        expect(state.snapshot().pendingContext).toBeUndefined();
    });

    it('keeps a staging when the detail confirms the context we already had', () => {
        // The counterpart, and the ordinary case: the send never landed, the
        // topic did not move, and the student's pick has to survive for a retry.
        install(state, detail({ sessionId: 1, context: COURSE42 }));
        state.stagePending(EX5);

        state.installDetail(detail({ sessionId: 1, context: COURSE42, messages: [{ id: 99, sender: 'USER' }] }), state.beginLoad());

        expect(state.snapshot().pendingContext?.ctx).toEqual(EX5);
    });

    it('derives the course context from a removed marker', () => {
        install(state, detail({ context: EX5 }));
        state.applyContextSwap({ transition: 'removed', context: undefined }, swapMessage(20, { transition: 'removed' }));
        expect(state.snapshot().committedContext).toEqual({ mode: 'COURSE_CHAT', entityId: 42 });
    });
});

/**
 * The topic a stored row claims for a session, read the way production reads
 * it: the presenter merges both collections into the history. There is no
 * lookup by context any more, so the index is asserted where it is consumed.
 */
const storedContext = (state: ConversationState, sessionId: number) =>
    [...state.snapshot().courseSessions, ...state.snapshot().knownInvisible]
        .find((s) => s.sessionId === sessionId)?.context;

describe('ConversationState knownInvisible', () => {
    let state: ConversationState;
    beforeEach(() => { state = new ConversationState(); state.setCourse(42); });

    it('remembers a session the overview does not list', () => {
        state.rememberInvisible({ sessionId: 9, courseId: 42, context: EX5, lastActivity: 100 });
        expect(storedContext(state, 9)).toEqual(EX5);
    });

    it('drops an entry once the overview lists it', () => {
        state.rememberInvisible({ sessionId: 9, courseId: 42, context: EX5, lastActivity: 100 });
        state.setOverview([{ sessionId: 9, courseId: 42, context: EX5, lastActivity: 300 }]);
        expect(state.snapshot().knownInvisible).toHaveLength(0);
    });

    it('updates a remembered entry when a newer detail contradicts it', () => {
        state.rememberInvisible({ sessionId: 9, courseId: 42, context: EX5, lastActivity: 100 });
        install(state, detail({ sessionId: 9, context: EX7 }));
        expect(storedContext(state, 9)).toEqual(EX7);
    });

    it('ENTERS a session the overview does not list, on any acquisition path', () => {
        // The loss this prevents: start acquires a conversation holding only a
        // proactive Iris message, the USER-only overview hides it, and without
        // an entry here nothing can ever reopen it again.
        install(state, detail({ sessionId: 9, context: EX5, messages: [{ id: 1, sender: 'LLM' }] }));
        expect(state.snapshot().knownInvisible.map((e) => e.sessionId)).toEqual([9]);
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
        const ids = state.snapshot().detail!.messages.map((m) => m.id!).sort((a, b) => a - b);
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
        expect(storedContext(state, 9)).toBeUndefined();
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
        // detail, in the canonical collection the history reads. A late overview
        // may still be stale about other conversations; it may never be stale
        // about the one on screen.
        install(state, detail({ sessionId: 9, context: EX7 }));
        state.setOverview([{ sessionId: 9, courseId: 42, context: EX5, lastActivity: 100 }]);
        expect(storedContext(state, 9)).toEqual(EX7);
    });

    it('lets the overview correct a conversation that is NOT open', () => {
        // The counterpart. Without this the cache would never learn that another
        // client repointed a conversation we are not looking at.
        install(state, detail({ sessionId: 1 }));
        state.rememberInvisible({ sessionId: 9, courseId: 42, context: EX7, lastActivity: 200 });
        state.setOverview([{ sessionId: 9, courseId: 42, context: EX5, lastActivity: 300 }]);
        expect(storedContext(state, 9)).toEqual(EX5);
    });
});
