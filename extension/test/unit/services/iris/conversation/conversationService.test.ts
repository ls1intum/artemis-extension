import * as assert from 'assert';

import type { SessionDetail } from '@shared/types/serverContext';

import { ApiError } from '@extension/domain';
import { IrisConversationService } from '@extension/services/iris/conversation/conversationService';
import type { SendDeps } from '@extension/services/iris/conversation/sendCoordinator';
import { SendCoordinator } from '@extension/services/iris/conversation/sendCoordinator';

const detail = (sessionId: number, context: unknown, messages: unknown[] = [], courseId = 42) =>
    ({ sessionId, courseId, context, messages });

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
        /** Resolves the (single, lock-guaranteed) outstanding send. */
        resolveSend: (v: unknown) => { take('send', 'newest').resolve(v); },
        rejectSend: (error: unknown) => { take('send', 'newest').reject(error); },
        api: {
            getCurrentChat: (mode: string, entityId: number, courseId: number) => next(`current:${mode}:${entityId}:${courseId}`),
            createCourseSession: (courseId: number) => next(`create:${courseId}`),
            getChatSessionById: (courseId: number, sessionId: number) => next(`detail:${courseId}:${sessionId}`),
            listChatSessionsForCourse: (courseId: number) => next(`overview:${courseId}`),
            // Only exercised by the `serviceWith`/`SendCoordinator` reconnect tests
            // below; every other test in this file never calls send().
            sendChatMessage: () => next('send'),
        },
    };
}

/** Lets a pending promise chain advance without resolving anything new. */
const tick = () => new Promise((r) => setImmediate(r));

function deps() {
    const subscribed: number[] = [];
    let leftCount = 0;
    /** Every transcript the service handed out, in order: `load` replaces the
     *  visible one, `merge` folds into it. */
    const delivered: Array<{ sessionId: number; mode: 'load' | 'merge'; count: number }> = [];
    return {
        subscribed,
        delivered,
        getLeftCount: () => leftCount,
        deps: {
            subscribeToSession: async (sessionId: number) => { subscribed.push(sessionId); },
            leaveSession: () => { leftCount++; },
            getWorkspaceExercise: () => ({ exerciseId: 5, courseId: 42 }),
            deliverTranscript: (detail: SessionDetail, mode: 'load' | 'merge') => {
                delivered.push({ sessionId: detail.sessionId, mode, count: detail.messages.length });
            },
        },
    };
}

/** A service with an open, EMPTY exercise conversation (session 1, topic E5). */
async function started() {
    const { api, deferred, outstanding, resolveLast, resolveCall, resolveOldestCall, rejectCall } = makeApi();
    const { deps: d, subscribed, delivered, getLeftCount } = deps();
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
        delivered,
        getLeftCount,
    });
}

/** The same, but the conversation already has a user message. */
async function startedWithContent() {
    const service = await started();
    service.state.upsertMessage({ id: 11, sender: 'USER' } as never);
    return service;
}

/** Same helper as Task 3's ConversationState tests and Task 7's sendCoordinator tests. */
const swapMessage = (id: number, attributes: unknown) =>
    ({ id, sender: 'CTXSWAP', content: [{ type: 'json', attributes }] });

/**
 * Minimal SendDeps: no run-UI plumbing, no files, everything else a no-op.
 * Only used to drive `SendCoordinator.send` far enough to observe its guard
 * interaction with `reconcileCurrent`; nothing here is itself under test.
 */
function sendDeps(): SendDeps {
    return {
        runLifecycle: { beginGeneration: () => 1, abortGeneration: () => { /* noop */ } },
        resetRunUiAndPublish: () => { /* noop */ },
        collectUncommittedFiles: () => Promise.resolve(undefined),
        confirmBubble: () => { /* noop */ },
        failBubble: () => { /* noop */ },
        reportError: () => { /* noop */ },
        // No workspace exercise: keeps `send()` from taking the
        // `collectUncommittedFiles` await, so `sendChatMessage` fires
        // synchronously (before the caller's next microtask), matching what the
        // reconnect-ordering tests below assume when they call `send()` and
        // `reconcileCurrent()` back to back with no tick between them.
        getWorkspaceExerciseId: () => undefined,
    };
}

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
    const { deps: d, subscribed, delivered } = deps();
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
    return {
        service, coordinator, subscribed, delivered,
        api: { deferred, outstanding, resolveCall, resolveOldestCall, resolveSend, rejectSend, rejectCall },
    };
}

suite('IrisConversationService transcript delivery', () => {
    test('start delivers the acquired conversation transcript, replacing what was there', async () => {
        // The service is the only thing that knows a conversation was adopted,
        // so it is the only place that can guarantee the transcript follows.
        const { api, deferred } = makeApi();
        const { deps: d, delivered } = deps();
        const service = new IrisConversationService(api as never, d);

        const started = service.start({ exerciseId: 5, courseId: 42 });
        deferred[0].resolve({ ...detail(1, EX5), messages: [{ id: 3, sender: 'USER' }] });
        await started;

        assert.deepStrictEqual(delivered, [{ sessionId: 1, mode: 'load', count: 1 }]);
    });

    test('a topic pick delivers no transcript, because it never leaves the conversation', async () => {
        const service = await started();
        const before = service.delivered.length;

        await service.resolveTopicChange(COURSE42);

        assert.strictEqual(service.delivered.length, before, 'staging moves no transcript');
    });

    test('reconnect reconciliation MERGES instead of replacing', async () => {
        // A merge is what lets a recovered answer arrive without wiping an
        // optimistic bubble or a live draft that survived the drop.
        const service = await started();
        const before = service.delivered.length;

        const reconciled = service.reconcileCurrent();
        service.api.resolveCall('detail:42:1', { ...detail(1, EX5), messages: [{ id: 9, sender: 'LLM' }] });
        await reconciled;

        assert.deepStrictEqual(service.delivered.slice(before), [{ sessionId: 1, mode: 'merge', count: 1 }]);
    });
});

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

    test('a topic pick on a conversation WITH content stages too, and issues no request', async () => {
        // The rule the whole resolution now rests on, and the one Artemis' own
        // client follows: the conversation is never left. An existing session
        // for the target is deliberately NOT looked for, hence no detail GET
        // and no create, even though the overview offers a perfect candidate.
        const service = await startedWithContent();
        service.state.setOverview([{ sessionId: 9, courseId: 42, context: EX7, lastActivity: 100 }]);
        const before = service.api.deferred.length;

        await service.resolveTopicChange(EX7);

        assert.strictEqual(service.api.deferred.length, before, 'no request may be issued');
        assert.strictEqual(service.state.snapshot().currentSessionId, 1);
        assert.deepStrictEqual(service.state.snapshot().pendingContext?.ctx, EX7);
        assert.strictEqual(service.state.contentState(), 'content', 'the transcript stays');
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

    test('entering a course with Iris off stops following the old conversation', async () => {
        // `subscribeToSession` records an INTENT, so dropping the conversation
        // locally is not enough: the transport would resubscribe to it on the
        // next reconnect and keep feeding frames for a conversation that is no
        // longer on screen.
        const service = await startedWithContent();
        const before = service.getLeftCount();

        const change = service.switchCourse(43);
        service.api.rejectCall('current:COURSE_CHAT:43:43', new ApiError('nope', 403, 'error.iris.course_disabled', 'iris.course_disabled'));
        const outcome = await change;

        assert.deepStrictEqual(outcome, { kind: 'disabled' });
        assert.strictEqual(service.state.snapshot().courseId, 43);
        assert.strictEqual(service.state.snapshot().currentSessionId, undefined);
        assert.strictEqual(service.getLeftCount(), before + 1, 'the transport must be told, not just the state');
    });

    test('a slow refusal cannot outrank a switch the student made after it', async () => {
        // The ordering hazard the disabled branch would have created if the
        // provider caught the 403 and started a FRESH navigation: course A's
        // refusal arriving last would land on A although B was chosen later.
        const service = await startedWithContent();

        const toA = service.switchCourse(43);
        const toB = service.switchCourse(44);
        service.api.resolveCall('current:COURSE_CHAT:44:44', detail(20, { mode: 'COURSE_CHAT', entityId: 44 }, [], 44));
        service.api.rejectCall('current:COURSE_CHAT:43:43', new ApiError('nope', 403, 'error.iris.course_disabled', 'iris.course_disabled'));

        assert.deepStrictEqual(await toA, { kind: 'stale' });
        await toB;
        assert.strictEqual(service.state.snapshot().courseId, 44, 'the later choice wins');
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

    test('a navigateTo racing a resolveTopicChange leaves exactly one winner', async () => {
        // The topic change no longer issues a request, but it still takes a
        // navigation token, so it is still the LAST intent. The history open it
        // raced must not install on top of the staging.
        const service = await startedWithContent();
        const nav = service.navigateTo({ courseId: 42, sessionId: 3 });
        await service.resolveTopicChange(EX7);
        service.api.resolveCall('detail:42:3', detail(3, COURSE42, [{ id: 1, sender: 'USER' }]));
        await nav;
        assert.strictEqual(service.state.snapshot().currentSessionId, 1);
        assert.deepStrictEqual(service.state.snapshot().pendingContext?.ctx, EX7);
    });

    test('a failed reload keeps the history it already had', async () => {
        // The caches used to be dropped BEFORE the re-read, which is right for
        // the escape-hatch command (a wedged client must be able to start over)
        // and wrong for everything else: a transient outage then costs the
        // student the whole conversation list, and the reload that would refill
        // it is exactly the thing that just failed.
        const service = await startedWithContent();
        service.state.setOverview([{ sessionId: 9, courseId: 42, context: EX7, lastActivity: 100 }]);

        const reloading = service.reload();
        service.api.rejectCall('detail:42:1', new ApiError('down', 503));
        await reloading.catch(() => undefined);

        assert.strictEqual(service.state.snapshot().courseSessions.length, 1, 'the history survives');
    });

    test('a reload superseded by a navigation clears nothing', async () => {
        // The reset used to run as soon as the GET answered, before either guard
        // was checked, so a stale reload wiped the caches of the navigation that
        // had won. That is precisely what the navigation token exists to stop.
        const service = await startedWithContent();
        service.state.setOverview([{ sessionId: 9, courseId: 42, context: EX7, lastActivity: 100 }]);

        const reloading = service.reload();
        const nav = service.navigateTo({ courseId: 42, sessionId: 3 });
        service.api.resolveCall('detail:42:3', detail(3, EX5, [{ id: 1, sender: 'USER' }]));
        service.api.resolveCall('detail:42:1', detail(1, EX5, [{ id: 1, sender: 'USER' }]));
        await Promise.all([reloading, nav]);

        assert.strictEqual(service.state.snapshot().courseSessions.length, 1, 'the winner keeps its history');
    });

    test('a successful reload still drops every local cache', async () => {
        // The escape hatch's whole purpose. Dropping AFTER the read keeps it.
        const service = await startedWithContent();
        service.state.setOverview([{ sessionId: 9, courseId: 42, context: EX7, lastActivity: 100 }]);

        const reloading = service.reload();
        service.api.resolveCall('detail:42:1', detail(1, EX5, [{ id: 1, sender: 'USER' }]));
        await reloading;

        assert.strictEqual(
            service.state.snapshot().courseSessions.filter((s) => s.sessionId === 9).length,
            0,
            'the stale row is gone',
        );
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

    test('reconcileCurrent does not block a concurrent navigateTo from installing', async () => {
        // Regression for the bug fixed in 69f0fe12: reconcileCurrent used to be
        // wrapped in _navigate, which bumps the shared _navRequestSeq. A resubscribe
        // signal landing mid-navigation would then make the navigateTo's own
        // isCurrent() permanently false, and its install would be silently
        // skipped. reconcileCurrent must not take a navigation token.
        const service = await started();
        const nav = service.navigateTo({ courseId: 42, sessionId: 9 });
        void service.reconcileCurrent();
        service.api.resolveCall('detail:42:9', detail(9, EX7, [{ id: 1, sender: 'USER' }]));
        await nav;
        assert.strictEqual(service.state.snapshot().currentSessionId, 9);
    });

    test('resolveTopicChange reports failed rather than rejecting when the acquisition 500s', async () => {
        // The dispatcher acts on a TopicChangeOutcome, not an exception: Task 14
        // writes `const outcome = await resolveTopicChange(...)`, so a server 500
        // must resolve to a rejected outcome, not throw. With no conversation
        // open this is the only branch of the path that still issues a request.
        const { api, rejectCall } = makeApi();
        const service = new IrisConversationService(api as never, deps().deps);
        const change = service.resolveTopicChange(EX7, 42);
        await tick();
        rejectCall('current:PROGRAMMING_EXERCISE_CHAT:7:42', new ApiError('boom', 500));
        const outcome = await change;
        assert.deepStrictEqual(outcome, { kind: 'rejected', reason: 'failed' });
    });
});

/**
 * Task 8: `reconcileCurrent` and its trigger `onSubscriptionActive` were both
 * authored in Task 5 (the trigger cannot compile without the method), and two
 * of the brief's cases already exist above under their own names:
 *  - "subscribes before adopting the snapshot" === 'reconcileCurrent subscribes
 *    before the detail GET resolves'.
 *  - "a signal for a session we already left is ignored" === 'onSubscriptionActive
 *    ignores a signal for a session that is no longer current'.
 * This suite adds only the cases neither of those cover: onSubscriptionActive's
 * full accept path (not just the reject path), a genuine context CHANGE on
 * reconcile (the existing test above resolves with the SAME context), the
 * CTXSWAP-during-reconcile race, the send/reconnect ordering race, and the
 * knownInvisible non-interference case.
 */
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

    test('re-adopts the server mode and entityId, not merely the messages', async () => {
        const c = await serviceWith({ sessionId: 1, context: COURSE42 });
        const done = c.service.reconcileCurrent();
        c.api.resolveCall('detail:42:1', { sessionId: 1, courseId: 42, context: EX5, lastActivity: 1000, messages: [] });
        await done;
        assert.deepStrictEqual(c.service.state.snapshot().committedContext, EX5);
        // The adoption has to reach the stored summary as well, not only the
        // chip, or the history row keeps naming the abandoned topic. Without
        // this line the test is fully subsumed by the delayed first
        // subscription case above.
        assert.deepStrictEqual(c.service.state.snapshot().knownInvisible.find((s) => s.sessionId === 1)?.context, EX5);
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
        // COURSE42, and the assertion below is unreachable. Do NOT make
        // `serviceWith` stage EX5 implicitly: other tests would then depend on
        // hidden setup.
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
        // `serviceWith` itself already remembers session 1 as invisible (its
        // overview comes back empty), so the baseline going in is 1, not 0.
        // Asserting a bare `1` after adding session 9 would silently expect
        // reconcileCurrent to have WIPED that pre-existing entry; asserting `2`
        // and that session 9's own data survived is what actually pins "the
        // invisible cache is untouched by a reconcile".
        const c = await serviceWith({ sessionId: 1, context: COURSE42 });
        c.service.state.rememberInvisible({ sessionId: 9, courseId: 42, context: EX5, lastActivity: 1 });
        const done = c.service.reconcileCurrent();
        c.api.resolveCall('detail:42:1', { sessionId: 1, courseId: 42, context: COURSE42, lastActivity: 1000, messages: [] });
        await done;
        const invisible = c.service.state.snapshot().knownInvisible;
        assert.strictEqual(invisible.length, 2);
        assert.deepStrictEqual(invisible.find((s) => s.sessionId === 9)?.context, EX5);
    });
});
