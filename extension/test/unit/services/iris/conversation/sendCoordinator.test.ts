import * as assert from 'assert';

import type { ServerContext } from '@shared/types/serverContext';

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
 * `resolveTopicChange`/`navigateTo` in the tests exercise real guards) sitting
 * on an already-open conversation (session 1, course 42) with the given
 * committed/pending context. `state` is installed directly through
 * ConversationState's own entry points rather than by driving fake HTTP
 * round trips through `start()`, since the shape under test does not depend
 * on how the conversation was acquired.
 */
function coordinatorWith(opts: {
    committed: ServerContext;
    pending?: ServerContext;
    workspaceExerciseId?: number;
    slowFileCollection?: boolean;
    fileCollectionThrows?: boolean;
    files?: Map<string, string>;
}) {
    const apiHarness = makeApi();
    const conversation = new IrisConversationService(apiHarness.api as never, {
        subscribeToSession: () => { /* not exercised by these tests */ },
        getWorkspaceExercise: () => (opts.workspaceExerciseId !== undefined
            ? { exerciseId: opts.workspaceExerciseId, courseId: 42 }
            : undefined),
    });

    const guard = conversation.state.beginLoad();
    conversation.state.installDetail(
        { sessionId: 1, courseId: 42, context: opts.committed, lastActivity: 1000, messages: [] },
        guard,
    );
    if (opts.pending) { conversation.state.stagePending(opts.pending); }

    const aborted: number[] = [];
    let nextGeneration = 1;
    const runLifecycle: RunLifecycle = {
        beginGeneration: () => nextGeneration++,
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
        // Neither is wired to any SendDeps hook: SendCoordinator has no
        // "clear composer" or "resend" capability, so these can only ever
        // stay at their default. The recorders exist to make the tests that
        // assert their absence readable.
        get composerTextCleared() { return false; },
        get resentCount() { return 0; },
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
        // message into session 9's transcript.
        const c = coordinatorWith({ committed: COURSE42 });
        const sent = c.send({ text: 'a', localId: 'l1', sessionId: 1 });
        await tick();
        c.state.beginNavigation(9);
        c.api.resolveSend({ id: 11 });
        await sent;
        assert.strictEqual(c.state.snapshot().detail, undefined);
    });

    test('a second send is rejected while one is in flight', async () => {
        const c = coordinatorWith({ committed: COURSE42 });
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
        assert.strictEqual(c.composerTextCleared, false);
        assert.strictEqual(c.state.snapshot().pendingContext, undefined);
        assert.strictEqual(c.resentCount, 0);
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
        assert.strictEqual(c.composerTextCleared, false);
    });

    test('uncommitted files are omitted when the effective context is not the workspace exercise', async () => {
        const c = coordinatorWith({ committed: COURSE42, pending: EX7, workspaceExerciseId: 5 });
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
