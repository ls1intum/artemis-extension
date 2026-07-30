import * as assert from 'assert';

import { ApiError } from '@extension/domain';
import { IrisConversationService } from '@extension/services/iris/conversation/conversationService';

const detail = (sessionId: number, context: unknown, messages: unknown[] = []) =>
    ({ sessionId, courseId: 42, context, messages });

const EX5 = { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 };
const EX7 = { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 7 };
const COURSE42 = { mode: 'COURSE_CHAT', entityId: 42 };

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
    service.state.upsertMessage({ id: 11, sender: 'USER' } as never);
    return service;
}

suite('IrisConversationService', () => {
    test('start acquires the workspace exercise session in one call', async () => {
        const { api, deferred } = makeApi();
        const service = new IrisConversationService(api as never, deps().deps);
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
        const service = new IrisConversationService(api as never, deps().deps);
        const started = service.start({ exerciseId: 5, courseId: 42 });
        deferred[0].resolve(detail(1, COURSE42));
        await started;
        assert.deepStrictEqual(service.state.snapshot().pendingContext?.ctx, EX5);
    });

    test('cold start issues no Iris session acquisition request', async () => {
        // The dashboard course-list request is allowed and is not made here;
        // what must not happen is any /api/iris/chat call.
        const { api, deferred } = makeApi();
        const service = new IrisConversationService(api as never, deps().deps);
        await service.start(undefined);
        assert.strictEqual(deferred.length, 0);
        assert.strictEqual(service.state.snapshot().currentSessionId, undefined);
    });

    test('a topic pick on an empty conversation stages without a request', async () => {
        const service = await started();
        // `started()` itself already issued and settled two calls (the initial
        // acquisition and the overview refresh it triggers), so "no request" is
        // verified against that baseline, not against an absolute zero.
        const before = service.api.deferred.length;
        await service.resolveTopicChange(EX7);
        assert.strictEqual(service.api.deferred.length, before);
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
        // The freshly acquired session (20) legitimately re-enters the invisible
        // cache (installDetail's "enter when not in the overview" rule), so the
        // cache is not simply empty; what "clears" means here is that course 42's
        // entry (session 9) is gone.
        assert.strictEqual(service.state.snapshot().knownInvisible.some((s) => s.sessionId === 9), false);
    });

    test('a slow course-A overview does not replace course-B sessions', async () => {
        const service = await started();
        const staleOverview = service.refreshOverview();
        const switched = service.switchCourse(43);
        service.api.deferred.find((d) => d.call === 'current:COURSE_CHAT:43:43')!.resolve(
            { sessionId: 20, courseId: 43, context: { mode: 'COURSE_CHAT', entityId: 43 }, messages: [] });
        await switched;
        // `started()` already settled one 'overview:42' call, so a raw `.find`
        // here would grab that already-resolved entry (a no-op resolve) and
        // leave `staleOverview`'s real, still-outstanding request hanging
        // forever. `resolveCall` picks the newest OUTSTANDING one instead.
        service.api.resolveCall('overview:42', [
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
        service.state.upsertMessage({ id: 77, sender: 'LLM' } as never);
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
        // Session 1 (the workspace exercise session `started()` opened) is
        // already in the invisible cache too, since the fake overview came back
        // empty; the new session (12) just needs to be present, not first.
        assert.ok(service.state.snapshot().knownInvisible.some((s) => s.sessionId === 12));
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

    test('reconcileCurrent subscribes before the detail GET resolves', async () => {
        // Subscribe-before-adopt: a CTXSWAP landing between the GET completing
        // and the subscription going live must have something live to repair it,
        // so the subscribe call has to happen before the GET is even awaited,
        // not after the response comes back.
        const service = await started();
        // `started()` already subscribed once during its own setup; the
        // reconcile must add a SECOND subscribe for the same session, and it
        // must be visible before the GET below is even resolved.
        const reconciling = service.reconcileCurrent();
        assert.deepStrictEqual(service.subscribed, [1, 1]);
        assert.strictEqual(service.api.deferred.at(-1)?.call, 'detail:42:1');
        service.api.deferred.at(-1)!.resolve(detail(1, EX5, [{ id: 1, sender: 'USER' }]));
        await reconciling;
        assert.ok(service.state.snapshot().detail!.messages.some((m) => m.id === 1));
    });

    test('onSubscriptionActive ignores a signal for a session that is no longer current', async () => {
        // The signal names a session id; if it does not match what is currently
        // open, reconciling it would read the WRONG conversation into the one
        // the student is looking at.
        const service = await started();
        service.onSubscriptionActive(999);
        await tick();
        assert.strictEqual(service.api.deferred.filter((d) => d.call.startsWith('detail:')).length, 0);
    });
});
