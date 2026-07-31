import * as assert from 'assert';

import type { ServerContext } from '@shared/types/serverContext';

import { ApiError } from '@extension/domain';
import { IrisConversationService } from '@extension/services/iris/conversation/conversationService';
import type { SendDeps, SendInput, SendOutcome, SendRejection } from '@extension/services/iris/conversation/sendCoordinator';
import { SendCoordinator } from '@extension/services/iris/conversation/sendCoordinator';
import type { RunLifecycle } from '@extension/services/iris/irisRunStateMachine';

const EX5: ServerContext = { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 };
const EX7: ServerContext = { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 7 };
const COURSE42: ServerContext = { mode: 'COURSE_CHAT', entityId: 42 };

/** Same helper as Task 3's ConversationState tests. */
const swapMessage = (id: number, attributes: unknown) =>
    ({ id, sender: 'CTXSWAP', content: [{ type: 'json', attributes }] });

/** Lets a pending promise chain advance without resolving anything new. */
const tick = () => new Promise((r) => setImmediate(r));

// `settled` is load-bearing, not bookkeeping: a helper that merely scanned by
// call name could answer the same one twice if two requests under the same
// name were open at once. Every helper below therefore picks an OUTSTANDING
// deferred and marks it settled. Mirrors Task 5's makeApi (conversationService.test.ts),
// extended with sendChatMessage.
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

    let lastSend: { sessionId: number; content: string; uncommittedFiles?: Map<string, string>; pendingContext?: ServerContext } | undefined;
    let sendCount = 0;

    return {
        deferred,
        outstanding,
        /** Resolves the NEWEST outstanding request matching `call`. */
        resolveCall: (call: string, v: unknown) => { take(call, 'newest').resolve(v); },
        /** Rejects the NEWEST outstanding request matching `call`. */
        rejectCall: (call: string, error: unknown) => { take(call, 'newest').reject(error); },
        get lastSend() { return lastSend; },
        get sendCount() { return sendCount; },
        /** Resolves the (single, lock-guaranteed) outstanding send. */
        resolveSend: (v: unknown) => { take('send', 'newest').resolve(v); },
        rejectSend: (error: unknown) => { take('send', 'newest').reject(error); },
        api: {
            getCurrentChat: (mode: string, entityId: number, courseId: number) => next(`current:${mode}:${entityId}:${courseId}`),
            createCourseSession: (courseId: number) => next(`create:${courseId}`),
            getChatSessionById: (courseId: number, sessionId: number) => next(`detail:${courseId}:${sessionId}`),
            listChatSessionsForCourse: (courseId: number) => next(`overview:${courseId}`),
            sendChatMessage: (
                sessionId: number,
                content: string,
                uncommittedFiles?: Map<string, string>,
                pendingContext?: ServerContext,
            ) => {
                lastSend = { sessionId, content, uncommittedFiles, pendingContext };
                sendCount++;
                return next('send');
            },
        },
    };
}

/**
 * Builds a SendCoordinator wired to a REAL IrisConversationService (so
 * `resolveTopicChange`/`navigateTo` in the tests exercise real guards).
 * When `committed` is given, the conversation starts already open (session 1,
 * course 42) with that committed/pending context, installed directly through
 * ConversationState's own entry points rather than by driving fake HTTP
 * round trips through `start()`, since the shape under test does not depend
 * on how the conversation was acquired. Omitting `committed` leaves no
 * conversation open at all, for the `no-conversation` rejection path.
 */
function coordinatorWith(opts: {
    committed?: ServerContext;
    pending?: ServerContext;
    workspaceExerciseId?: number;
    slowFileCollection?: boolean;
    fileCollectionThrows?: boolean;
    beginGenerationThrows?: boolean;
    files?: Map<string, string>;
}) {
    const apiHarness = makeApi();
    const conversation = new IrisConversationService(apiHarness.api as never, {
        subscribeToSession: () => { /* not exercised by these tests */ },
        deliverTranscript: () => { /* the transcript is the provider's business */ },
        getWorkspaceExercise: () => (opts.workspaceExerciseId !== undefined
            ? { exerciseId: opts.workspaceExerciseId, courseId: 42 }
            : undefined),
    });

    if (opts.committed) {
        const guard = conversation.state.beginLoad();
        conversation.state.installDetail(
            { sessionId: 1, courseId: 42, context: opts.committed, lastActivity: 1000, messages: [] },
            guard,
        );
        if (opts.pending) { conversation.state.stagePending(opts.pending); }
    }

    const aborted: number[] = [];
    let nextGeneration = 1;
    const runLifecycle: RunLifecycle = {
        beginGeneration: () => {
            if (opts.beginGenerationThrows) { throw new Error('beginGeneration failed'); }
            return nextGeneration++;
        },
        abortGeneration: (generation: number) => { aborted.push(generation); },
    };

    let releaseFileCollection = (): void => { /* replaced below when slowFileCollection is set */ };
    const collectUncommittedFiles = (): Promise<Map<string, string> | undefined> => {
        if (opts.fileCollectionThrows) { return Promise.reject(new Error('collection failed')); }
        if (opts.slowFileCollection) {
            return new Promise((resolve) => { releaseFileCollection = () => resolve(opts.files); });
        }
        return Promise.resolve(opts.files);
    };

    let lastBubbleStatus: 'sent' | 'error' | undefined;
    const confirmCalls: { sessionId: number; localId: string; messageId: number | undefined }[] = [];
    const failCalls: { sessionId: number; localId: string; reason: SendRejection | 'unknown' }[] = [];
    const reportedErrors: string[] = [];

    const deps: SendDeps = {
        runLifecycle,
        resetRunUiAndPublish: () => { /* no-op */ },
        collectUncommittedFiles,
        confirmBubble: (sessionId, localId, messageId) => {
            lastBubbleStatus = 'sent';
            confirmCalls.push({ sessionId, localId, messageId });
        },
        failBubble: (sessionId, localId, reason) => {
            lastBubbleStatus = 'error';
            failCalls.push({ sessionId, localId, reason });
        },
        reportError: (message) => { reportedErrors.push(message); },
        getWorkspaceExerciseId: () => opts.workspaceExerciseId,
    };

    const coordinator = new SendCoordinator(apiHarness.api as never, conversation, deps);

    return {
        conversation,
        state: conversation.state,
        api: apiHarness,
        runLifecycle: { aborted },
        send: (input: SendInput): Promise<SendOutcome> => coordinator.send(input),
        releaseFileCollection: () => releaseFileCollection(),
        get lastBubbleStatus() { return lastBubbleStatus; },
        confirmCalls,
        failCalls,
        reportedErrors,
    };
}

suite('SendCoordinator', () => {
    test('sends the staged context and commits exactly it', async () => {
        const c = coordinatorWith({ committed: COURSE42, pending: EX5 });
        const sent = c.send({ text: 'hallo', localId: 'l1', sessionId: 1 });
        assert.deepStrictEqual(c.api.lastSend?.pendingContext, EX5);
        c.api.resolveSend({ id: 11 });
        await sent;
        assert.deepStrictEqual(c.state.snapshot().committedContext, EX5);
        assert.strictEqual(c.state.snapshot().pendingContext, undefined);
        assert.deepStrictEqual(c.confirmCalls, [{ sessionId: 1, localId: 'l1', messageId: 11 }]);
    });

    test('a successful send moves the detail context and the cached summary with the commit', async () => {
        // commitContext must mirror applyContextSwap: the write-back exists
        // exactly for the window before the server's own CTXSWAP frame
        // arrives, which is precisely when the socket is down. Leaving the
        // detail and the cached summary on the old topic would show the chip
        // pointing at EX5 while history and the positive lookup still claim
        // COURSE42, and the next "Ask Iris about exercise 5" would then
        // create a duplicate conversation instead of finding this one.
        const c = coordinatorWith({ committed: COURSE42, pending: EX5 });
        const sent = c.send({ text: 'hallo', localId: 'l1', sessionId: 1 });
        c.api.resolveSend({ id: 11 });
        await sent;
        assert.deepStrictEqual(c.state.snapshot().detail?.context, EX5);
        assert.deepStrictEqual(c.state.snapshot().knownInvisible.find((s) => s.sessionId === 1)?.context, EX5);
        assert.strictEqual(c.state.findSessionFor(EX5), 1);
    });

    test('a self CTXSWAP arriving before the response leaves the context alone', async () => {
        const c = coordinatorWith({ committed: COURSE42, pending: EX5 });
        const sent = c.send({ text: 'hallo', localId: 'l1', sessionId: 1 });
        c.state.applyContextSwap({ transition: 'added', context: EX5 }, swapMessage(20, { transition: 'added' }));
        c.api.resolveSend({ id: 11 });
        await sent;
        assert.deepStrictEqual(c.state.snapshot().committedContext, EX5);
    });

    test('a response arriving after a DIFFERENT CTXSWAP does not overwrite it', async () => {
        const c = coordinatorWith({ committed: COURSE42, pending: EX5 });
        const sent = c.send({ text: 'hallo', localId: 'l1', sessionId: 1 });
        c.state.applyContextSwap({ transition: 'added', context: EX7 }, swapMessage(20, { transition: 'added' }));
        c.api.resolveSend({ id: 11 });
        await sent;
        assert.deepStrictEqual(c.state.snapshot().committedContext, EX7);
    });

    test('a session switch mid-request discards the write-back', async () => {
        const c = coordinatorWith({ committed: COURSE42, pending: EX5 });
        const sent = c.send({ text: 'hallo', localId: 'l1', sessionId: 1 });
        c.state.beginNavigation(99);
        c.api.resolveSend({ id: 11 });
        await sent;
        assert.strictEqual(c.state.snapshot().committedContext, undefined);
    });

    test('a detail load started before a completed send does not suppress its write-back', async () => {
        const c = coordinatorWith({ committed: COURSE42, pending: EX5 });
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
        const c = coordinatorWith({ committed: COURSE42, pending: EX5, workspaceExerciseId: 5, slowFileCollection: true });
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
        const c = coordinatorWith({ committed: COURSE42, pending: EX5, workspaceExerciseId: 5, slowFileCollection: true });
        const first = c.send({ text: 'a', localId: 'l1', sessionId: 1 });
        assert.deepStrictEqual(await c.conversation.resolveTopicChange(EX7), { kind: 'rejected', reason: 'send-in-flight' });
        c.releaseFileCollection();
        await tick();
        c.api.resolveSend({ id: 11 });
        await first;
    });

    test('a throw inside file collection aborts the generation and is not an ambiguous send', async () => {
        const c = coordinatorWith({ committed: COURSE42, pending: EX5, workspaceExerciseId: 5, fileCollectionThrows: true });
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
        // message into session 9's transcript. beginNavigation alone clears
        // `_detail` (upsertMessage then no-ops on it regardless of any guard),
        // so session 9 is given its OWN installed detail here: that is what
        // actually exercises the cross-session check rather than passing by
        // accident because there was nothing to write into.
        const c = coordinatorWith({ committed: COURSE42 });
        const sent = c.send({ text: 'a', localId: 'l1', sessionId: 1 });
        await tick();
        c.state.beginNavigation(9);
        const guard9 = c.state.beginLoad();
        c.state.installDetail({ sessionId: 9, courseId: 42, context: COURSE42, lastActivity: 1000, messages: [] }, guard9);
        c.api.resolveSend({ id: 11 });
        await sent;
        assert.strictEqual(c.state.snapshot().detail?.messages.some((m) => m.id === 11), false);
    });

    test('a send composed against a session that navigation already left is refused', async () => {
        // The command was composed while session 1 was open (origin: 1), but by
        // the time the host handles it, a navigation completed and session 9 is
        // now current. navigationInFlight is already false again, so nothing
        // upstream of this check catches it; only comparing the origin to the
        // CURRENT session does.
        const c = coordinatorWith({ committed: COURSE42 });
        c.state.beginNavigation(9);
        const guard9 = c.state.beginLoad();
        c.state.installDetail({ sessionId: 9, courseId: 42, context: COURSE42, lastActivity: 1000, messages: [] }, guard9);
        const outcome = await c.send({ text: 'a', localId: 'l1', sessionId: 1 });
        assert.deepStrictEqual(outcome, { kind: 'rejected', reason: 'conversation-changed' });
        assert.strictEqual(c.api.sendCount, 0);
        // Must fail the ORIGIN bubble (1), not the session that is open NOW
        // (9): the webview drew this bubble in session 1, and session 9 has a
        // transcript of its own that this bubble does not belong to.
        assert.deepStrictEqual(c.failCalls, [{ sessionId: 1, localId: 'l1', reason: 'conversation-changed' }]);
    });

    test('a send with no open conversation is rejected as no-conversation', async () => {
        const c = coordinatorWith({});
        const outcome = await c.send({ text: 'a', localId: 'l1', sessionId: 1 });
        assert.deepStrictEqual(outcome, { kind: 'rejected', reason: 'no-conversation' });
        assert.deepStrictEqual(c.failCalls, [{ sessionId: 1, localId: 'l1', reason: 'no-conversation' }]);
    });

    test('a second send is rejected while one is in flight', async () => {
        const c = coordinatorWith({ committed: COURSE42 });
        const first = c.send({ text: 'a', localId: 'l1', sessionId: 1 });
        const second = await c.send({ text: 'b', localId: 'l2', sessionId: 1 });
        assert.deepStrictEqual(second, { kind: 'rejected', reason: 'send-in-flight' });
        // The rejection must fail the SECOND bubble (l2), against ITS origin
        // session, with the reason just decided. The first send is still open
        // at this point (its own confirmBubble has not fired yet), so this is
        // the only entry.
        assert.deepStrictEqual(c.failCalls, [{ sessionId: 1, localId: 'l2', reason: 'send-in-flight' }]);
        c.api.resolveSend({ id: 11 });
        await first;
    });

    test('every topic change is rejected while a send is unresolved', async () => {
        // Local finding 6: the alternative ("a newer pending staged mid-request
        // survives") conflicts with invariant 4, because a successful send gives
        // the conversation content. One rule, applied to every consumer.
        const c = coordinatorWith({ committed: COURSE42 });
        const sending = c.send({ text: 'a', localId: 'l1', sessionId: 1 });
        const rejected = await c.conversation.resolveTopicChange(EX7);
        assert.deepStrictEqual(rejected, { kind: 'rejected', reason: 'send-in-flight' });
        c.api.resolveSend({ id: 11 });
        await sending;
    });

    test('a send is refused while a navigation load is in flight', async () => {
        const c = coordinatorWith({ committed: COURSE42 });
        void c.conversation.navigateTo({ courseId: 42, sessionId: 9 });
        const outcome = await c.send({ text: 'a', localId: 'l1', sessionId: 1 });
        assert.deepStrictEqual(outcome, { kind: 'rejected', reason: 'navigation-in-flight' });
        assert.deepStrictEqual(c.failCalls, [{ sessionId: 1, localId: 'l1', reason: 'navigation-in-flight' }]);
    });

    test('an ambiguous failure adopts the detail, reports unknown and keeps the text', async () => {
        const c = coordinatorWith({ committed: COURSE42, pending: EX5 });
        const sent = c.send({ text: 'hallo', localId: 'l1', sessionId: 1 });
        await tick();                       // let file collection and the POST start
        c.api.rejectSend(new Error('socket hang up'));
        await tick();                       // let the catch path issue the detail GET
        c.api.resolveCall('detail:42:1', { sessionId: 1, courseId: 42, context: EX5, lastActivity: 1000, messages: [{ id: 11, sender: 'USER' }] });
        const outcome = await sent;
        assert.deepStrictEqual(outcome, { kind: 'unknown' });
        assert.strictEqual(c.state.snapshot().pendingContext, undefined);
        // Nothing was resent: exactly the one POST from the original attempt,
        // never a second one triggered by the recovery path.
        assert.strictEqual(c.api.sendCount, 1);
    });

    test('a context swap arriving during reconciliation is not overwritten by its stale GET', async () => {
        // The reconciliation guard is captured BEFORE the GET fires, at the top
        // of `_reconcileUnknown`, not after the response lands. Capturing it
        // after would make the guard tautological (it would always match
        // whatever the state happens to be right then), and a CTXSWAP that
        // landed WHILE the GET was in flight would be clobbered by the older
        // snapshot the GET returns.
        const c = coordinatorWith({ committed: COURSE42, pending: EX5 });
        const sent = c.send({ text: 'hallo', localId: 'l1', sessionId: 1 });
        await tick();
        c.api.rejectSend(new Error('socket hang up'));
        await tick();   // the catch path issues the detail GET; the guard is captured here
        c.state.applyContextSwap({ transition: 'added', context: EX7 }, swapMessage(21, { transition: 'added' }));
        // The GET's response is the STALE, pre-swap state: it must not win.
        c.api.resolveCall('detail:42:1', { sessionId: 1, courseId: 42, context: COURSE42, lastActivity: 1000, messages: [{ id: 1, sender: 'USER' }] });
        await sent;
        assert.deepStrictEqual(c.state.snapshot().committedContext, EX7);
    });

    test('a divergent pending dies once ANY content exists, whoever wrote it', async () => {
        const c = coordinatorWith({ committed: COURSE42, pending: EX5 });
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
        const c = coordinatorWith({ committed: COURSE42 });
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
        assert.deepStrictEqual(c.reportedErrors, ['Iris could not be reached. The transcript may be out of date.']);
    });

    test('a second send is rejected while a reconciliation GET is outstanding', async () => {
        // That endSend() runs at all is one thing; that it runs only in the
        // `finally`, AFTER reconciliation, is another. If it ran earlier (e.g.
        // moved into the catch, ahead of `_reconcileUnknown`), the lock would
        // be open for the whole reconciliation GET, and a second send composed
        // in that window would be admitted instead of rejected.
        const c = coordinatorWith({ committed: COURSE42 });
        const sent = c.send({ text: 'a', localId: 'l1', sessionId: 1 });
        await tick();
        c.api.rejectSend(new Error('socket hang up'));
        await tick();   // the catch path has issued the detail GET; it is still outstanding
        assert.strictEqual(c.state.sendInFlight, true);
        const second = await c.send({ text: 'b', localId: 'l2', sessionId: 1 });
        assert.deepStrictEqual(second, { kind: 'rejected', reason: 'send-in-flight' });
        c.api.rejectCall('detail:42:1', new Error('still down'));
        await sent;
    });

    test('a 429 from the send is reported as a rate limit, not reconciled', async () => {
        const c = coordinatorWith({ committed: COURSE42 });
        const sent = c.send({ text: 'a', localId: 'l1', sessionId: 1 });
        await tick();
        c.api.rejectSend(new ApiError('Too Many Requests', 429));
        const outcome = await sent;
        assert.deepStrictEqual(outcome, { kind: 'rejected', reason: 'rate-limit' });
        assert.strictEqual(c.state.sendInFlight, false);
        // A 429 is a definite, known outcome; unlike the generic-failure path
        // it must not spend a reconciliation GET.
        assert.strictEqual(c.api.deferred.filter((d) => d.call.startsWith('detail:')).length, 0);
        assert.deepStrictEqual(c.failCalls, [{ sessionId: 1, localId: 'l1', reason: 'rate-limit' }]);
    });

    test('a beginGeneration throw still releases the lock', async () => {
        // beginGeneration/resetRunUiAndPublish must run INSIDE the try, or a
        // synchronous throw here skips the finally entirely and the lock,
        // taken just before, is never released.
        const c = coordinatorWith({ committed: COURSE42, beginGenerationThrows: true });
        const outcome = await c.send({ text: 'a', localId: 'l1', sessionId: 1 });
        assert.deepStrictEqual(outcome, { kind: 'rejected', reason: 'preparation-failed' });
        assert.strictEqual(c.state.sendInFlight, false);
        assert.strictEqual(c.runLifecycle.aborted.length, 0);   // no generation was ever created to abort
    });

    test('uncommitted files are omitted when the effective context is not the workspace exercise', async () => {
        // `files` is deliberately non-empty here: if the entity-id comparison in
        // `_isWorkspaceContext` were ever weakened to "a workspace exercise is
        // known" (dropping the entityId match), collection would still run and
        // exercise 7's chat would carry exercise 5's working diff. An omitted
        // `files` fixture would pass either way and never catch that.
        const c = coordinatorWith({ committed: COURSE42, pending: EX7, workspaceExerciseId: 5, files: new Map([['A.java', 'x']]) });
        const sent = c.send({ text: 'hallo', localId: 'l1', sessionId: 1 });
        await tick();   // file collection is awaited BEFORE the POST
        assert.strictEqual(c.api.lastSend?.uncommittedFiles, undefined);
        c.api.resolveSend({ id: 11 });
        await sent;
    });

    test('uncommitted files are attached when the effective context IS the workspace exercise', async () => {
        const c = coordinatorWith({ committed: COURSE42, pending: EX5, workspaceExerciseId: 5, files: new Map([['A.java', 'x']]) });
        const sent = c.send({ text: 'hallo', localId: 'l1', sessionId: 1 });
        await tick();   // without this, lastSend is undefined and the test passes for the wrong reason
        assert.strictEqual(c.api.lastSend?.uncommittedFiles?.size, 1);
        c.api.resolveSend({ id: 11 });
        await sent;
    });
});
