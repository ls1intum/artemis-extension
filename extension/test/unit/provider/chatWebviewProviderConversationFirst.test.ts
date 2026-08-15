import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { SessionDetail } from '@shared/types/serverContext';

import { ArtemisApiService } from '@extension/api';
import { ApiError } from '@extension/domain/errors';
import { ChatWebviewProvider } from '@extension/provider/chatWebviewProvider';
import type { StartOutcome, TopicChangeOutcome } from '@extension/services/iris/conversation/conversationService';
import type { DetectionOutcome } from '@extension/services/workspace/detectionOutcome';
import { WorkspaceExerciseTracker } from '@extension/services/workspace/workspaceExerciseTracker';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

interface Harness {
    provider: ChatWebviewProvider;
    workspaceTracker: WorkspaceExerciseTracker;
    api: sinon.SinonStubbedInstance<ArtemisApiService>;
    exerciseEvents: number[];
    sandbox: sinon.SinonSandbox;
    courseCatalog: FakeCatalog;
}

/**
 * The chat's picker source. Only the members the provider and its presenter
 * read exist, and `projection()` answers from mutable arrays a test can fill,
 * which is how a dashboard fetch is simulated without an HTTP layer.
 */
interface FakeCatalog {
    onCoursesLoaded: vscode.Event<unknown>;
    fetch: sinon.SinonStub;
    currentEpoch: number;
    courses: Array<{ id: number; title: string }>;
    exercises: Array<{ id: number; courseId: number; title: string; pickable: boolean }>;
    projection(): { courses: FakeCatalog['courses']; exercises: FakeCatalog['exercises'] };
    courseTitle: sinon.SinonStub;
    exerciseTitle: sinon.SinonStub;
    upsertSupplemental: sinon.SinonStub;
    /** Backed by `exercises`, the same array a test seeds through `projection()`. */
    authoritativeCourseIdFor(exerciseId: number): number | undefined;
}

/**
 * Builds a provider with BOTH the API service and a websocket service, which
 * is what makes `_conversation` and the send coordinator actually get
 * constructed. The websocket service is a bare event source: the
 * conversation-first paths never touch anything else on it.
 */
function buildHarness(): Harness {
    const sandbox = sinon.createSandbox();
    sandbox.stub(vscode.commands, 'registerCommand').returns({ dispose: () => undefined });
    sandbox.stub(vscode.window, 'showErrorMessage');
    sandbox.stub(vscode.window, 'showWarningMessage');

    const mockContext = new MockExtensionContext();
    const workspaceTracker = new WorkspaceExerciseTracker();
    const api = sinon.createStubInstance(ArtemisApiService);
    const websocket = {
        onDidChangeConnectionState: new vscode.EventEmitter<{ connected: boolean }>().event,
        isConnected: () => true,
        getDisplayStatus: () => 'connected',
    };
    const noAi = {
        isNoAiEnabled: false,
        onNoAiStatusChanged: new vscode.EventEmitter<boolean>().event,
    };
    const registry = { getAllExercises: () => [] };
    const courseCatalog: FakeCatalog = {
        onCoursesLoaded: new vscode.EventEmitter<unknown>().event,
        fetch: sandbox.stub().resolves(undefined),
        currentEpoch: 0,
        courses: [],
        exercises: [],
        projection() { return { courses: this.courses, exercises: this.exercises }; },
        courseTitle: sandbox.stub().returns(undefined),
        exerciseTitle: sandbox.stub().returns(undefined),
        upsertSupplemental: sandbox.stub(),
        authoritativeCourseIdFor(exerciseId: number) { return this.exercises.find(e => e.id === exerciseId)?.courseId; },
    };
    const sessionIdentity = { state: { kind: 'anonymous', serverKey: 'https://artemis.test' }, epoch: 0 };

    const provider = new ChatWebviewProvider(
        vscode.Uri.file('/tmp'),
        mockContext as unknown as vscode.ExtensionContext,
        api as unknown as ArtemisApiService,
        websocket as never,
        noAi as never,
        registry as never,
        courseCatalog as never,
        undefined,
        workspaceTracker,
        { getAccessTimestamp: () => undefined } as never,
        sessionIdentity as never,
    );

    const exerciseEvents: number[] = [];
    provider.onDidChangeExerciseContext(({ exerciseId }) => exerciseEvents.push(exerciseId));

    return { provider, workspaceTracker, api, exerciseEvents, sandbox, courseCatalog };
}

/** A minimal `vscode.WebviewView` double, just enough for `resolveWebviewView`
 *  to run without touching a real webview. */
function makeWebviewStub(): vscode.WebviewView {
    const webview = {
        options: {} as vscode.WebviewOptions,
        html: '',
        onDidReceiveMessage: () => ({ dispose: () => undefined }),
        // Needed once anything reaches the `ready` handshake: `_markReady`
        // flushes the pending queue straight through `webview.postMessage`.
        postMessage: () => Promise.resolve(true),
        asWebviewUri: (u: vscode.Uri) => u,
        cspSource: 'https://example',
    } as unknown as vscode.Webview;
    return {
        webview,
        onDidDispose: () => ({ dispose: () => undefined }),
        onDidChangeVisibility: () => ({ dispose: () => undefined }),
        visible: false,
        show: () => undefined,
        title: '',
        description: '',
        badge: undefined,
        viewType: 'irisChat',
    } as unknown as vscode.WebviewView;
}

/** Resolves the webview view, the trigger that reports `onViewResolved` to
 *  the startup coordinator and re-runs the availability check. */
async function resolveView(h: Harness): Promise<void> {
    h.provider.resolveWebviewView(makeWebviewStub(), {} as never, {} as never);
    await Promise.resolve();
}

/** Simulates the webview's own `ready` handshake message, white-box: the test
 *  webview stub never wires a real `onDidReceiveMessage` listener, so nothing
 *  drives `_onReady` (and therefore `_sendInitData`) on its own. This is the
 *  one signal that flushes the queued messages and runs init data, the path
 *  a rehydrated transcript actually travels on a re-resolve. */
function sendReady(provider: ChatWebviewProvider): void {
    (provider as unknown as { _handleMessage: (m: unknown) => void })._handleMessage({ type: 'ready' });
}

/** Spies on the coordinator's admission entry point, white-box: nothing on the
 *  public surface observes admission directly. `admitExplicitIntent` only
 *  cancels the startup latch (and clears a dead-Retry banner when one was
 *  showing), so a navigation that never reaches an unavailable outage screen
 *  leaves no externally visible trace of having admitted at all. */
function spyOnAdmission(h: Harness): sinon.SinonSpy {
    const coordinator = (h.provider as unknown as {
        _startupCoordinator: { admitExplicitIntent: (r: string) => void };
    })._startupCoordinator;
    return sinon.spy(coordinator, 'admitExplicitIntent');
}

function detail(over: Partial<SessionDetail> = {}): SessionDetail {
    return {
        sessionId: 1,
        courseId: 42,
        context: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 },
        lastActivity: 0,
        messages: [],
        ...over,
    };
}

suite('ChatWebviewProvider: struggle decoupling', () => {
    let h: Harness;

    setup(() => { h = buildHarness(); });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    test('a workspace detection change does retarget it', () => {
        h.provider.registerWorkspaceExercise({
            id: 5, title: 'BFS', courseId: 42,
        });

        assert.deepStrictEqual(h.exerciseEvents, [5]);
    });

    test('the second workspace exercise carries the first as previousExerciseId', () => {
        const previous: Array<number | undefined> = [];
        h.provider.onDidChangeExerciseContext(({ previousExerciseId }) => previous.push(previousExerciseId));

        h.provider.registerWorkspaceExercise({
            id: 5, title: 'BFS', courseId: 42,
        });
        h.workspaceTracker.clear();
        h.provider.registerWorkspaceExercise({
            id: 6, title: 'DFS', courseId: 42,
        });

        assert.deepStrictEqual(h.exerciseEvents, [5, 6]);
        assert.deepStrictEqual(previous, [undefined, 5]);
    });
});

suite('ChatWebviewProvider: Ask Iris', () => {
    let h: Harness;
    let postSpy: sinon.SinonSpy;

    setup(() => {
        h = buildHarness();
        postSpy = h.sandbox.spy(h.provider as unknown as { _postMessageSafe: (m: unknown) => void }, '_postMessageSafe');
    });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    const postedTypes = (): string[] => postSpy.getCalls()
        .map(c => (c.args[0] as { type?: string })?.type ?? '')
        .filter(Boolean);

    test('with no conversation open, Ask-Iris acquires one instead of refusing', async () => {
        // The cold-start row of the resolution table. Without the course hint
        // travelling with the target, the service can only answer
        // `rejected: no-course` and the dashboard button is dead on a fresh
        // window, so assert the real outcome, not a recorded call name.
        h.api.getCurrentChat.resolves(detail({ sessionId: 1 }));

        const outcome = await h.provider.askIrisAbout(
            { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' },
            42,
        );

        assert.deepStrictEqual(outcome, { kind: 'opened', sessionId: 1 });
        assert.deepStrictEqual(h.api.getCurrentChat.firstCall.args, ['PROGRAMMING_EXERCISE_CHAT', 5, 42]);
        const conversation = (h.provider as unknown as { _conversation: { state: { snapshot(): { currentSessionId?: number } } } })._conversation;
        assert.strictEqual(conversation.state.snapshot().currentSessionId, 1);
    });

    test('Ask-Iris resolves the course when the payload omits it', async () => {
        // The catalog is the ONLY source: a bare numeric exercise id carries no
        // server identity of its own.
        h.courseCatalog.exercises.push({ id: 5, courseId: 42, title: 'BFS', pickable: true });
        h.api.getCurrentChat.resolves(detail({ sessionId: 1 }));

        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' });

        assert.deepStrictEqual(h.api.getCurrentChat.firstCall.args, ['PROGRAMMING_EXERCISE_CHAT', 5, 42]);
    });

    test('Ask-Iris on another course SWITCHES to it instead of refusing', async () => {
        // Artemis' client cannot refuse this: clicking the exercise navigates to
        // its page and the chat's course follows. Here nothing navigates, so the
        // command has to make the same move itself, in the same order a student
        // would: course first, then the topic in it.
        h.api.getCurrentChat.resolves(detail({ sessionId: 1 }));
        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' }, 42);
        // The course move acquires course 43's own conversation.
        h.api.getCurrentChat.resolves(detail({ sessionId: 2, courseId: 43, context: { mode: 'COURSE_CHAT', entityId: 43 } }));

        const outcome = await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 9, name: 'DFS' }, 43);

        // The whole compound operation, not just its first half: the course
        // moved, the topic was staged in the conversation that came with it, and
        // the student was told, because they clicked an exercise and got a new
        // transcript.
        assert.deepStrictEqual(outcome, { kind: 'staged' });
        const conversation = (h.provider as unknown as {
            _conversation: { state: { snapshot(): { courseId?: number; currentSessionId?: number; pendingContext?: { ctx: unknown } } } };
        })._conversation;
        const snapshot = conversation.state.snapshot();
        assert.strictEqual(snapshot.courseId, 43, 'the chat must be in the target course');
        assert.strictEqual(snapshot.currentSessionId, 2, 'with that course\'s conversation');
        assert.deepStrictEqual(snapshot.pendingContext?.ctx, { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 9, name: 'DFS' });
        assert.ok(
            noticesFrom(postSpy).some(n => /Switched to/.test(n)),
            'a transcript the student did not ask to replace has to be announced',
        );
    });

    test('Ask-Iris into a course with Iris off lands there and says why, without staging', async () => {
        // The move still happens; only the conversation cannot. Staging a topic
        // into a course that has none would leave the chip naming a topic no
        // send could ever use.
        h.api.getCurrentChat.resolves(detail({ sessionId: 1 }));
        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' }, 42);
        h.api.getCurrentChat.rejects(new ApiError('Request failed', 403, 'error.iris.course_disabled', 'iris.course_disabled'));

        const outcome = await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 9, name: 'DFS' }, 43);

        // NOT a rejection. The move succeeded; only the conversation cannot
        // exist. Reporting `failed` would put a retry prompt on top of a banner
        // that no retry can clear.
        assert.deepStrictEqual(outcome, { kind: 'course-disabled' });
        assert.ok(postedTypes().includes('showDisabledState'), 'the banner is the answer');
        assert.deepStrictEqual(
            noticesFrom(postSpy).filter(n => /Switched to/.test(n)),
            [],
            'the banner is a standing state; a fading notice next to it says the same thing twice',
        );
        const conversation = (h.provider as unknown as {
            _conversation: { state: { snapshot(): { courseId?: number; currentSessionId?: number; pendingContext?: unknown } } };
        })._conversation;
        const snapshot = conversation.state.snapshot();
        assert.strictEqual(snapshot.courseId, 43, 'we are in the course the student asked about');
        assert.strictEqual(snapshot.currentSessionId, undefined, 'with no conversation');
        assert.strictEqual(snapshot.pendingContext, undefined, 'and nothing staged into thin air');
    });

    test('Ask-Iris from a COLD start into a disabled course still lands there', async () => {
        // No conversation is open, so there is no course to switch away from and
        // the acquisition itself meets the 403. It has to reach the same
        // destination as the switch does, or the behaviour would exist only for
        // students who happened to have another course open.
        h.api.getCurrentChat.rejects(new ApiError('Request failed', 403, 'error.iris.course_disabled', 'iris.course_disabled'));

        const outcome = await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 9, name: 'DFS' }, 43);

        assert.deepStrictEqual(outcome, { kind: 'course-disabled' });
        assert.ok(postedTypes().includes('showDisabledState'), 'landing without a banner leaves the panel unexplained');
        const conversation = (h.provider as unknown as { _conversation: { state: { snapshot(): { courseId?: number } } } })._conversation;
        assert.strictEqual(conversation.state.snapshot().courseId, 43);
    });

    test('Ask-Iris refuses an exercise whose course cannot be resolved', async () => {
        // With a conversation OPEN. Neither the payload nor the catalog nor the
        // API can say which course exercise 404 belongs to, so the cross-course
        // check has nothing to compare against and would wave it through. A
        // topic whose course is unknown may not be staged.
        h.api.getCurrentChat.resolves(detail({ sessionId: 1 }));
        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' }, 42);
        const callsBefore = h.api.getCurrentChat.callCount;

        const outcome = await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 404, name: 'Ghost' });

        assert.deepStrictEqual(outcome, { kind: 'rejected', reason: 'no-course' });
        assert.strictEqual(h.api.getCurrentChat.callCount, callsBefore);
    });

    test('Ask-Iris is rejected while a send is in flight', async () => {
        const conversation = (h.provider as unknown as { _conversation: { state: { beginSend(): void } } })._conversation;
        conversation.state.beginSend();

        const outcome = await h.provider.askIrisAbout(
            { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' },
            42,
        );

        assert.deepStrictEqual(outcome, { kind: 'rejected', reason: 'send-in-flight' });
        assert.strictEqual(h.api.getCurrentChat.callCount, 0);
    });
});

/**
 * Iris availability is a question about the COURSE the conversation is in, and
 * the student must not have to send a message to learn the answer.
 */
suite('ChatWebviewProvider: availability is checked without a send', () => {
    let h: Harness;
    let postSpy: sinon.SinonSpy;
    let check: sinon.SinonStub;

    const posted = (spy: sinon.SinonSpy, type: string): unknown[] => spy.getCalls()
        .map(c => c.args[0] as { type?: string })
        .filter(m => m?.type === type);

    setup(() => {
        h = buildHarness();
        postSpy = h.sandbox.spy(h.provider as unknown as { _postMessageSafe: (m: unknown) => void }, '_postMessageSafe');
        check = h.sandbox.stub(
            (h.provider as unknown as { _availability: { checkAndLoadIrisSettings: () => Promise<unknown> } })._availability,
            'checkAndLoadIrisSettings',
        ).resolves({ kind: 'disabled' } as never);
        // `start` fires an overview refresh, and an unstubbed sinon method
        // answers `undefined`, which the real endpoint cannot: it routes
        // through `expectArray` and throws on a non-array.
        h.api.listChatSessionsForCourse.resolves([]);
    });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    test('a conversation landing in a course with Iris disabled posts the banner before any send', async () => {
        h.api.getCurrentChat.resolves(detail({
            sessionId: 1, courseId: 42, context: { mode: 'COURSE_CHAT', entityId: 42 },
        }));

        await h.provider.askIrisAbout({ mode: 'COURSE_CHAT', entityId: 42 }, 42);
        await settle();

        assert.strictEqual(check.callCount, 1, 'the navigation itself must ask');
        assert.strictEqual(posted(postSpy, 'showDisabledState').length, 1);
        assert.strictEqual(h.api.sendChatMessage.callCount, 0, 'nothing was sent to find this out');
    });

    test('re-opening the view re-asks even though the conversation did not change', async () => {
        // `_onConversationChanged` guards on the session id, so a re-install of
        // the SAME conversation posts no banner through that path at all: the
        // re-check comes from `resolveWebviewView` itself
        // (`_refreshAvailability`, unconditional), independent of the
        // coordinator's one-shot `_acquireConversation`. Acquisition runs off a
        // detection outcome, not off a registered workspace exercise, so the
        // test drives it the way the real activation path does.
        const detection = new vscode.EventEmitter<DetectionOutcome>();
        h.provider.attachStartupDetection({ onDetectionSettled: detection.event, retry: () => undefined });
        h.api.getCurrentChat.resolves(detail({ sessionId: 1, courseId: 42 }));

        await resolveView(h);
        detection.fire({ kind: 'matched', exerciseId: 5, courseId: 42 });
        await settle();

        postSpy.resetHistory();
        check.resetHistory();
        await resolveView(h);
        await settle();

        assert.strictEqual(check.callCount, 1);
        assert.strictEqual(posted(postSpy, 'showDisabledState').length, 1);
        detection.dispose();
    });

    test('an answer that outlived its conversation is not published', async () => {
        // Course 42's settings call resolves only after the student has already
        // switched to 43. Publishing it would be exactly the stale banner
        // `resetAvailability` exists to prevent.
        let release42: (value: unknown) => void = () => undefined;
        check.onFirstCall().returns(new Promise(resolve => { release42 = resolve; }));
        check.onSecondCall().resolves({ kind: 'enabled' } as never);
        h.api.getCurrentChat
            .withArgs('COURSE_CHAT', 42, 42)
            .resolves(detail({ sessionId: 1, courseId: 42, context: { mode: 'COURSE_CHAT', entityId: 42 } }));
        h.api.getCurrentChat
            .withArgs('COURSE_CHAT', 43, 43)
            .resolves(detail({ sessionId: 2, courseId: 43, context: { mode: 'COURSE_CHAT', entityId: 43 } }));

        await h.provider.askIrisAbout({ mode: 'COURSE_CHAT', entityId: 42 }, 42);
        dispatch(h.provider, 'switchCourse', { courseId: 43 });
        await settle();

        postSpy.resetHistory();
        release42({ kind: 'disabled' });
        await settle();

        assert.strictEqual(posted(postSpy, 'showDisabledState').length, 0);
    });
});

/**
 * `resolveWebviewView` does not acquire a conversation by itself; the
 * coordinator does it once both the view and workspace detection have settled,
 * in either order.
 */
suite('ChatWebviewProvider: the startup coordinator owns the cold start', () => {
    let h: Harness;

    setup(() => { h = buildHarness(); });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    test('resolving the view does not acquire a conversation on its own', async () => {
        // Both lines are load-bearing. Without a registered workspace exercise
        // `_workspaceForStart()` answers undefined and `start(undefined)`
        // deliberately issues no request, so the assertion would hold even if
        // `resolveWebviewView` did acquire, and prove nothing.
        h.provider.registerWorkspaceExercise({
            id: 5, title: 'BFS', courseId: 42,
        });
        h.api.getCurrentChat.resolves(detail({ sessionId: 1, courseId: 42 }));

        await resolveView(h);
        await settle();

        assert.strictEqual(h.api.getCurrentChat.called, false,
            'the coordinator owns the cold start now, not resolveWebviewView');
    });

    test('an exercise detected after the view resolved acquires the conversation', async () => {
        const detection = new vscode.EventEmitter<DetectionOutcome>();
        h.provider.attachStartupDetection({ onDetectionSettled: detection.event, retry: () => undefined });
        h.api.getCurrentChat.resolves(detail({ sessionId: 1, courseId: 9 }));

        await resolveView(h);
        detection.fire({ kind: 'matched', exerciseId: 3, courseId: 9 });
        await Promise.resolve();
        await Promise.resolve();

        assert.strictEqual(h.api.getCurrentChat.calledOnce, true);
        detection.dispose();
    });

    test('a rejecting start still surfaces the unreachable banner, so the workspace-known Retry works', async () => {
        // The coordinator consumes the startup latch BEFORE calling `start()`,
        // and calls it as `void` with no rejection handling of its own. That
        // is only safe because
        // `_acquireConversation` catches the failure itself and shows the
        // "Iris could not be reached" banner, whose Retry reloads the
        // now-known conversation. Without this test that recovery path is
        // unverified: a broken `_acquireConversation` catch would silently
        // drop both the detected workspace exercise AND any banner.
        const detection = new vscode.EventEmitter<DetectionOutcome>();
        h.provider.attachStartupDetection({ onDetectionSettled: detection.event, retry: () => undefined });
        h.api.getCurrentChat.rejects(new Error('network down'));
        const postSpy = h.sandbox.spy(h.provider as unknown as { _postMessageSafe: (m: unknown) => void }, '_postMessageSafe');

        await resolveView(h);
        detection.fire({ kind: 'matched', exerciseId: 3, courseId: 9 });
        await settle();

        const unavailable = postSpy.getCalls()
            .map(c => c.args[0] as { type?: string; message?: string })
            .find(m => m?.type === 'showUnavailableState');
        assert.ok(unavailable, 'a rejecting start must still show the unavailable banner');
        assert.match(String(unavailable?.message), /retry/i);
        detection.dispose();
    });

    test('after a failed acquisition, re-resolving the view acquires again', async () => {
        // `resolveWebviewView` runs again whenever VS Code disposes and
        // recreates the webview (the panel has no `retainContextWhenHidden`),
        // which happens simply from collapsing and reopening the sidebar view.
        // Without the latch coming back after a failed attempt, the student who
        // hit one transient error is stuck on the cold-start chooser for good,
        // with no banner and no automatic retry: only `artemis.resetIrisChat`
        // recovers.
        const detection = new vscode.EventEmitter<DetectionOutcome>();
        h.provider.attachStartupDetection({ onDetectionSettled: detection.event, retry: () => undefined });
        h.api.getCurrentChat.onFirstCall().rejects(new Error('network down'));
        h.api.getCurrentChat.onSecondCall().resolves(detail({ sessionId: 1, courseId: 9 }));

        await resolveView(h);
        detection.fire({ kind: 'matched', exerciseId: 3, courseId: 9 });
        await settle();

        assert.strictEqual(h.api.getCurrentChat.callCount, 1, 'the first, failing attempt was made');

        // The panel is collapsed and reopened: a fresh `WebviewView`, a fresh
        // resolve, no new detection event (the workspace exercise did not
        // change).
        await resolveView(h);
        await settle();

        assert.strictEqual(h.api.getCurrentChat.callCount, 2,
            'a re-resolved view must get another shot at the exercise it already knows about');
        detection.dispose();
    });

    /**
     * A course whose instructor switched Iris off answers the cold-start
     * acquisition with the same 403 `iris.course_disabled` that `switchCourse`
     * already handles. Treated like any other failure it would give the student
     * the "could not be reached" banner and a Retry that can only ever repeat
     * the identical 403.
     */
    test('a disabled course at cold start shows the disabled banner, not the unreachable one', async () => {
        const detection = new vscode.EventEmitter<DetectionOutcome>();
        h.provider.attachStartupDetection({ onDetectionSettled: detection.event, retry: () => undefined });
        h.api.getCurrentChat.rejects(new ApiError('Request failed', 403, 'error.iris.course_disabled', 'iris.course_disabled'));
        const postSpy = h.sandbox.spy(h.provider as unknown as { _postMessageSafe: (m: unknown) => void }, '_postMessageSafe');

        await resolveView(h);
        detection.fire({ kind: 'matched', exerciseId: 3, courseId: 9 });
        await settle();

        const posted = postSpy.getCalls().map(c => c.args[0] as { type?: string });
        assert.ok(posted.some(m => m?.type === 'showDisabledState'),
            'a switched-off course must show the disabled banner');
        assert.ok(!posted.some(m => m?.type === 'showUnavailableState'),
            'a definitive answer is not a reachability problem, and must not offer a Retry that can never succeed');
        detection.dispose();
    });

    test('a disabled course at cold start still enters the course, so the header names it', async () => {
        const detection = new vscode.EventEmitter<DetectionOutcome>();
        h.provider.attachStartupDetection({ onDetectionSettled: detection.event, retry: () => undefined });
        h.api.getCurrentChat.rejects(new ApiError('Request failed', 403, 'error.iris.course_disabled', 'iris.course_disabled'));

        await resolveView(h);
        detection.fire({ kind: 'matched', exerciseId: 3, courseId: 9 });
        await settle();

        const conversation = (h.provider as unknown as {
            _conversation: { state: { snapshot(): { courseId?: number; currentSessionId?: number } } };
        })._conversation;
        const snapshot = conversation.state.snapshot();
        assert.strictEqual(snapshot.courseId, 9, 'the header must name the course, not fall back to "Choose a course"');
        assert.strictEqual(snapshot.currentSessionId, undefined, 'entered with no conversation, since Iris is off there');
        detection.dispose();
    });

    test('a disabled course at cold start does not re-arm the startup latch', async () => {
        const detection = new vscode.EventEmitter<DetectionOutcome>();
        h.provider.attachStartupDetection({ onDetectionSettled: detection.event, retry: () => undefined });
        h.api.getCurrentChat.rejects(new ApiError('Request failed', 403, 'error.iris.course_disabled', 'iris.course_disabled'));

        await resolveView(h);
        detection.fire({ kind: 'matched', exerciseId: 3, courseId: 9 });
        await settle();

        assert.strictEqual(h.api.getCurrentChat.callCount, 1, 'the disabled answer was received once');

        // A later settled `matched` outcome (a fresh detection cycle, exactly
        // what re-arming exists to serve for a TRANSIENT failure) must not
        // trigger a second acquisition attempt: the disabled answer is
        // definitive, and retrying it would only repeat the same 403 forever.
        detection.fire({ kind: 'matched', exerciseId: 3, courseId: 9 });
        await settle();

        assert.strictEqual(h.api.getCurrentChat.callCount, 1,
            'a disabled course must not re-arm the startup latch');
        detection.dispose();
    });

    test('a different cold-start failure (500) still shows the unreachable banner and still re-arms', async () => {
        // Only the exact 403 `iris.course_disabled` answer may skip the
        // unreachable banner and the re-arm; every other failure takes the
        // normal path.
        const detection = new vscode.EventEmitter<DetectionOutcome>();
        h.provider.attachStartupDetection({ onDetectionSettled: detection.event, retry: () => undefined });
        h.api.getCurrentChat.onFirstCall().rejects(new ApiError('Request failed', 500, 'Internal Server Error'));
        h.api.getCurrentChat.onSecondCall().resolves(detail({ sessionId: 1, courseId: 9 }));
        const postSpy = h.sandbox.spy(h.provider as unknown as { _postMessageSafe: (m: unknown) => void }, '_postMessageSafe');

        await resolveView(h);
        detection.fire({ kind: 'matched', exerciseId: 3, courseId: 9 });
        await settle();

        const posted = postSpy.getCalls().map(c => c.args[0] as { type?: string });
        assert.ok(posted.some(m => m?.type === 'showUnavailableState'),
            'a transient failure must still show the unavailable banner');
        assert.ok(!posted.some(m => m?.type === 'showDisabledState'),
            'a 500 is not a settings refusal and must not be reported as one');
        assert.strictEqual(h.api.getCurrentChat.callCount, 1, 'the first, failing attempt was made');

        // Re-resolving the view (the same recovery the panel-collapse test
        // above exercises) must get another shot, proving the latch re-armed.
        await resolveView(h);
        await settle();

        assert.strictEqual(h.api.getCurrentChat.callCount, 2,
            'a non-disabled failure must still re-arm the latch');
        detection.dispose();
    });

    test('re-resolving the view with an installed conversation republishes its transcript once ready', async () => {
        // `loadMessages` comes only from `_deliverTranscript`, which only an
        // acquisition or a reconnect reaches. A re-resolve of an already
        // installed conversation triggers neither, so without an explicit
        // republish the fresh webview gets `currentSessionId` but never a
        // transcript, and its loading spinner never clears.
        //
        // The republish lives in `_sendInitData`, reached only through the
        // webview's `ready` handshake (`_onReady`), never from
        // `resolveWebviewView` directly: `_postMessageSafe` queues everything
        // until `ready` arrives and flushes the WHOLE queue before `_onReady`
        // runs, so anything posted synchronously inside `resolveWebviewView`
        // would arrive before the `updateIrisState` that names the session and
        // the webview's session guard would drop it. Hence `sendReady` below,
        // not a second `resolveView` alone.
        const detection = new vscode.EventEmitter<DetectionOutcome>();
        h.provider.attachStartupDetection({ onDetectionSettled: detection.event, retry: () => undefined });
        h.api.getCurrentChat.resolves(detail({
            sessionId: 1,
            courseId: 9,
            messages: [{ id: 100, role: 'user', content: 'hi', sentAt: '2026-01-01T00:00:00Z' }] as never,
        }));
        // The acquisition fires an unawaited `refreshOverview()` of its own
        // (conversationService.ts); without this the stub's default answer
        // (undefined) reaches `setOverview` and `postSnapshot` throws on the
        // republish, unrelated to what this test is actually pinning down.
        h.api.listChatSessionsForCourse.resolves([]);

        await resolveView(h);
        detection.fire({ kind: 'matched', exerciseId: 3, courseId: 9 });
        await settle();

        assert.strictEqual(h.api.getCurrentChat.callCount, 1, 'the conversation is installed once');
        const postSpy = h.sandbox.spy(h.provider as unknown as { _postMessageSafe: (m: unknown) => void }, '_postMessageSafe');

        // The panel is collapsed and reopened: a fresh `WebviewView`, a fresh
        // resolve, and the fresh webview's own `ready` signal. No new
        // detection event and no new acquisition attempt (the latch is
        // already consumed), so this is the "already installed" case.
        await resolveView(h);
        sendReady(h.provider);
        await settle();

        assert.strictEqual(h.api.getCurrentChat.callCount, 1,
            'the one-shot latch must stay one-shot: this is a REPUBLISH, not a second acquisition');
        const posted = postSpy.getCalls().map(c => c.args[0] as { type?: string; sessionId?: number });
        const loads = posted.filter(m => m?.type === 'loadMessages');
        assert.strictEqual(loads.length, 1,
            'a re-resolved view with an already-installed conversation must get its transcript republished, or the fresh webview spins forever');
        assert.strictEqual(loads[0]?.sessionId, 1);
        // The ordering invariant `_install` itself relies on (see its own
        // "AFTER the emit, never before it" comment): the snapshot that names
        // the session must reach the webview before the transcript for it, or
        // the webview's session guard drops the transcript on the floor.
        const snapshotIndex = posted.findIndex(m => m?.type === 'updateIrisState');
        const loadIndex = posted.findIndex(m => m?.type === 'loadMessages');
        assert.ok(snapshotIndex >= 0 && snapshotIndex < loadIndex,
            'updateIrisState must be posted before loadMessages, or the webview\'s session guard drops the republish');
        detection.dispose();
    });
});

suite('ChatWebviewProvider: reload Iris chat', () => {
    let h: Harness;
    let calls: string[];

    setup(() => {
        h = buildHarness();
        calls = [];
        // A recording double: the point of these two tests is WHICH service
        // calls the command makes, and the real service's `reload` decides
        // internally between reload and start.
        (h.provider as unknown as { _conversation: unknown })._conversation = {
            state: {
                snapshot: () => ({ currentSessionId: 7, courseId: 42 }),
                // The reload re-checks availability, which reads the topic.
                effectiveContext: () => ({ mode: 'COURSE_CHAT', entityId: 42 }),
            },
            reload: async () => { calls.push('reload'); },
            refreshOverview: async () => { calls.push('refreshOverview'); },
        };
        h.sandbox.stub(
            (h.provider as unknown as { _availability: { checkAndLoadIrisSettings: () => Promise<unknown> } })._availability,
            'checkAndLoadIrisSettings',
        ).resolves({ kind: 'enabled' } as never);
    });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    test('re-acquires the conversation and refreshes the overview', async () => {
        await h.provider.reloadIrisChat();
        assert.deepStrictEqual(calls, ['reload', 'refreshOverview']);
    });

    test('with no conversation open it re-runs start instead of failing', async () => {
        // The real service's `reload` falls back to `start` when nothing is
        // open, so the command must simply not refuse: it drops the caches and
        // re-reads, and the overview refresh is a no-op without a course.
        const started: string[] = [];
        (h.provider as unknown as { _conversation: unknown })._conversation = {
            state: {
                snapshot: () => ({ currentSessionId: undefined, courseId: undefined }),
                effectiveContext: () => undefined,
            },
            reload: async () => { started.push('start'); },
            refreshOverview: async () => { started.push('refreshOverview'); },
        };

        await h.provider.reloadIrisChat();

        assert.strictEqual(started[0], 'start');
    });
});

/**
 * The startup-unavailable banner's own Retry. It must re-run workspace
 * DETECTION through the coordinator, never the conversation reload
 * (`reloadIrisChat`) that `ReloadChatSession` uses: on this path there may be
 * no workspace exercise at all, so a reload would start whatever happens to
 * be left over, or nothing.
 */
suite('ChatWebviewProvider: retryStartupDetection', () => {
    let h: Harness;

    setup(() => { h = buildHarness(); });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    test('retryStartupDetection re-runs detection and does not reload the conversation', async () => {
        const retry = sinon.spy();
        h.provider.attachStartupDetection({
            onDetectionSettled: new vscode.EventEmitter<DetectionOutcome>().event,
            retry,
        });
        // Assert on the reload ENTRY POINT, not on an API call it would make:
        // with no open session `reloadIrisChat()` returns early and touches
        // no stub, so a wrongly routed command would slip past an
        // API-level assertion.
        const reload = h.sandbox.spy(h.provider, 'reloadIrisChat');

        dispatch(h.provider, 'retryStartupDetection');
        await settle();

        assert.strictEqual(retry.calledOnce, true);
        assert.strictEqual(reload.called, false,
            'startup retry must not take the conversation-reload path');
    });
});

/**
 * A recording double stands in for the conversation service so each test can
 * assert WHICH navigation the host performed, and so
 * the host's own gating can be told apart from the service's internal one
 * (both exist; only the host's is under test here).
 */
interface FakeConversation {
    calls: Array<{ name: string; args?: unknown }>;
    sendInFlight: boolean;
    topicOutcome: TopicChangeOutcome;
    newOutcome: TopicChangeOutcome;
    navigateThrows: boolean;
    /** Rejections the host must classify, rather than the bare Error `navigateThrows` raises. */
    switchCourseError?: unknown;
    switchOutcome: { kind: string; sessionId?: number; reason?: string };
    navigateError?: unknown;
    /** `_acquireConversation`'s outcome from `conversation.start(workspace)`. */
    startOutcome: StartOutcome;
    /**
     * The course `state.snapshot()` reports as current. Settable independently
     * of `startOutcome` so a test can drive the two apart, which is what the
     * `landedHere` tests below need. Defaults to 42, the value every other
     * test in this file already relies on implicitly.
     */
    snapshotCourseId: number;
}

function injectFakeConversation(provider: ChatWebviewProvider): FakeConversation {
    const fake: FakeConversation = {
        calls: [],
        sendInFlight: false,
        topicOutcome: { kind: 'staged' },
        newOutcome: { kind: 'opened', sessionId: 9 },
        switchOutcome: { kind: 'opened', sessionId: 5 },
        navigateThrows: false,
        startOutcome: { kind: 'ok' },
        snapshotCourseId: 42,
    };
    (provider as unknown as { _conversation: unknown })._conversation = {
        // The full surface the presenter reads: the provider posts a snapshot
        // on every conversation change, so a partial double makes postSnapshot
        // throw rather than fail an assertion.
        state: {
            get sendInFlight() { return fake.sendInFlight; },
            snapshot: () => ({ currentSessionId: 1, courseId: fake.snapshotCourseId, courseSessions: [], knownInvisible: [] }),
            displayMessageCount: () => 0,
            contentState: () => 'content',
            effectiveContext: () => undefined,
        },
        navigationInFlight: false,
        start: async (workspace: unknown) => {
            fake.calls.push({ name: 'start', args: workspace });
            return fake.startOutcome;
        },
        resolveTopicChange: async (target: unknown) => {
            fake.calls.push({ name: 'resolveTopicChange', args: target });
            return fake.topicOutcome;
        },
        newConversation: async () => {
            fake.calls.push({ name: 'newConversation' });
            return fake.newOutcome;
        },
        navigateTo: async (params: unknown) => {
            fake.calls.push({ name: 'navigateTo', args: params });
            if (fake.navigateError) { throw fake.navigateError; }
            if (fake.navigateThrows) { throw new Error('gone'); }
        },
        switchCourse: async (courseId: unknown) => {
            fake.calls.push({ name: 'switchCourse', args: courseId });
            if (fake.switchCourseError) { throw fake.switchCourseError; }
            return fake.switchOutcome;
        },
    };
    return fake;
}

function dispatch(provider: ChatWebviewProvider, command: string, payload?: unknown): void {
    (provider as unknown as { _handleCommand: (m: unknown) => void })
        ._handleCommand({ type: 'command', command, payload });
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/** Informational notices only: a refusal wears `tone: 'error'`. */
function noticesFrom(postSpy: sinon.SinonSpy): string[] {
    return postSpy.getCalls()
        .map(c => c.args[0] as { type?: string; text?: string; tone?: string })
        .filter(m => m?.type === 'showChatNotice' && m.tone !== 'error')
        .map(m => String(m.text));
}

/** The refusal surface for the two navigations that have no popover left. */
function errorNoticesFrom(postSpy: sinon.SinonSpy): string[] {
    return postSpy.getCalls()
        .map(c => c.args[0] as { type?: string; text?: string; tone?: string })
        .filter(m => m?.type === 'showChatNotice' && m.tone === 'error')
        .map(m => String(m.text));
}

suite('ChatWebviewProvider: the conversation-first dispatcher', () => {
    let h: Harness;
    let fake: FakeConversation;
    let postSpy: sinon.SinonSpy;

    setup(() => {
        h = buildHarness();
        fake = injectFakeConversation(h.provider);
        postSpy = h.sandbox.spy(h.provider as unknown as { _postMessageSafe: (m: unknown) => void }, '_postMessageSafe');
    });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    test('selectTopic resolves the topic change', async () => {
        dispatch(h.provider, 'selectTopic', { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 7, name: 'BFS' });
        await settle();

        assert.deepStrictEqual(fake.calls, [{
            name: 'resolveTopicChange',
            args: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 7, name: 'BFS' },
        }]);
    });

    test('Ask-Iris abandons the topic when its own course switch was superseded', async () => {
        // The compound operation is switch-then-stage. If a newer navigation won
        // the switch, staging afterwards would take a fresh navigation token and
        // let this stale click cancel whatever the student chose instead.
        fake.switchOutcome = { kind: 'stale' };

        const outcome = await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 9, name: 'DFS' }, 43);

        assert.deepStrictEqual(outcome, { kind: 'stale' });
        assert.deepStrictEqual(fake.calls.filter(c => c.name === 'resolveTopicChange'), [], 'nothing may be staged');
    });

    test('a topic pick posts no notice even when it acquired a conversation', async () => {
        // `opened` survives here for one case only: the cold start, where the
        // pick acquires the first conversation. Nothing was on screen to be
        // replaced, so announcing a switch would describe an event the student
        // never saw. A topic change on an OPEN conversation cannot reach this
        // branch at all; it always stages.
        fake.topicOutcome = { kind: 'opened', sessionId: 12 };

        dispatch(h.provider, 'selectTopic', { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 7 });
        await settle();

        assert.deepStrictEqual(noticesFrom(postSpy), []);
    });

    test('a topic pick that only staged posts none: the transcript did not move', async () => {
        fake.topicOutcome = { kind: 'staged' };

        dispatch(h.provider, 'selectTopic', { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 7 });
        await settle();

        assert.deepStrictEqual(noticesFrom(postSpy), []);
    });

    test('openConversation navigates by id and explains nothing: the student asked for it', async () => {
        dispatch(h.provider, 'openConversation', { courseId: 42, sessionId: 5 });
        await settle();

        assert.deepStrictEqual(fake.calls, [{ name: 'navigateTo', args: { courseId: 42, sessionId: 5 } }]);
        assert.deepStrictEqual(noticesFrom(postSpy), []);
    });

    test('a failed openConversation surfaces an open error instead of rejecting', async () => {
        fake.navigateThrows = true;

        dispatch(h.provider, 'openConversation', { courseId: 42, sessionId: 5 });
        await settle();

        assert.ok(postSpy.getCalls().some(c => (c.args[0] as { type?: string })?.type === 'openSessionError'));
    });

    test('switchCourse asks the service to acquire that course', async () => {
        // Nothing mirrors the course: the conversation is the single source of
        // truth for it, and `ChatWebviewProvider.currentCourseId` reads it
        // from there.
        dispatch(h.provider, 'switchCourse', { courseId: 43 });
        await settle();

        assert.deepStrictEqual(fake.calls, [{ name: 'switchCourse', args: 43 }]);
    });

    test('newConversation announces the fresh conversation', async () => {
        dispatch(h.provider, 'newConversation');
        await settle();

        assert.deepStrictEqual(fake.calls, [{ name: 'newConversation' }]);
        assert.deepStrictEqual(noticesFrom(postSpy), ['Started a new conversation.']);
    });

    const openErrorsFrom = (spy: sinon.SinonSpy): string[] => spy.getCalls()
        .map(c => c.args[0] as { type?: string; message?: string })
        .filter(m => m?.type === 'openSessionError')
        .map(m => m.message as string);

    /** Artemis' answer for a course whose Iris is switched off, as the API layer surfaces it. */
    const irisDisabled = (): ApiError =>
        new ApiError('Request failed', 403, 'error.iris.course_disabled', 'iris.course_disabled');

    const messageTypesFrom = (spy: sinon.SinonSpy): string[] => spy.getCalls()
        .map(c => (c.args[0] as { type?: string })?.type ?? '')
        .filter(Boolean);

    test('a course entered without a conversation is labelled where the student now is', async () => {
        // The service reports `disabled` once it has LANDED there (it classifies
        // the 403 inside its own navigation). All this handler owes it is the
        // banner, and specifically not an inline error: nothing failed.
        fake.switchOutcome = { kind: 'disabled' };

        dispatch(h.provider, 'switchCourse', { courseId: 9027 });
        await settle();

        assert.ok(messageTypesFrom(postSpy).includes('showDisabledState'), 'the panel must say why it is empty');
        assert.deepStrictEqual(openErrorsFrom(postSpy), [], 'no inline error: the navigation succeeded');
    });

    test('a switch that was superseded says nothing at all', async () => {
        // `stale` means a newer navigation won. Labelling the course we did not
        // reach would brand whichever one the student is actually looking at.
        fake.switchOutcome = { kind: 'stale' };

        dispatch(h.provider, 'switchCourse', { courseId: 9027 });
        await settle();

        assert.ok(!messageTypesFrom(postSpy).includes('showDisabledState'));
        assert.deepStrictEqual(openErrorsFrom(postSpy), []);
    });

    test('disabled-looking prose without the key is NOT treated as disabled', async () => {
        // The other half of the pin: with the key gone, prose that reads exactly
        // like the disabled case must fall back to the generic wording. Together
        // with the test above this rules out a classifier matching either one.
        fake.switchCourseError = new ApiError('Request failed', 403, 'Iris is disabled for course 9027', undefined);

        dispatch(h.provider, 'switchCourse', { courseId: 9027 });
        await settle();

        assert.match(openErrorsFrom(postSpy)[0], /try again/i);
    });

    test('a 403 that is not the disabled key keeps the retryable wording', async () => {
        // Guards the classifier: "any 403" would be wrong, only THIS key is permanent.
        fake.switchCourseError = new ApiError('Request failed', 403, 'error.http.403', 'access.denied');

        dispatch(h.provider, 'switchCourse', { courseId: 43 });
        await settle();

        assert.match(openErrorsFrom(postSpy)[0], /try again/i);
    });

    test('opening a history row from a switched-off course reports the same reason', async () => {
        fake.navigateError = irisDisabled();

        dispatch(h.provider, 'openConversation', { courseId: 9027, sessionId: 5 });
        await settle();

        const errors = openErrorsFrom(postSpy);
        assert.strictEqual(errors.length, 1);
        assert.match(errors[0], /not enabled|disabled|turned off/i);
        assert.doesNotMatch(errors[0], /try again/i);
    });

    test('a transient course switch failure keeps its retryable wording', async () => {
        fake.switchCourseError = new ApiError('Request failed', 503, undefined);

        dispatch(h.provider, 'switchCourse', { courseId: 43 });
        await settle();

        const errors = openErrorsFrom(postSpy);
        assert.strictEqual(errors.length, 1);
        assert.match(errors[0], /try again/i, 'a 503 IS worth retrying');
    });

    test('every navigation is refused while a send is in flight', async () => {
        fake.sendInFlight = true;

        dispatch(h.provider, 'selectTopic', { mode: 'COURSE_CHAT', entityId: 42 });
        dispatch(h.provider, 'openConversation', { courseId: 42, sessionId: 5 });
        dispatch(h.provider, 'switchCourse', { courseId: 43 });
        dispatch(h.provider, 'newConversation');
        await settle();

        assert.deepStrictEqual(fake.calls, [], 'the host must not reach the service at all');
        assert.deepStrictEqual(noticesFrom(postSpy), []);
    });

    test('a refusal ANSWERS on a surface that renders, one per navigation', async () => {
        // Both popovers stay open until their navigation lands, so an inline
        // `openSessionError` reaches them. The topic picker closes on the
        // click and the header's `+` has no popover at all, so those two would
        // be posting into a surface nothing renders: they answer on the
        // composer's notice line instead.
        fake.sendInFlight = true;

        dispatch(h.provider, 'selectTopic', { mode: 'COURSE_CHAT', entityId: 42 });
        dispatch(h.provider, 'openConversation', { courseId: 42, sessionId: 5 });
        dispatch(h.provider, 'switchCourse', { courseId: 43 });
        dispatch(h.provider, 'newConversation');
        await settle();

        const errors = openErrorsFrom(postSpy);
        const notices = errorNoticesFrom(postSpy);
        assert.strictEqual(errors.length, 2, 'the two popover-backed navigations report inline');
        assert.strictEqual(notices.length, 2, 'the two popover-less ones report on the notice line');
        for (const message of [...errors, ...notices]) {
            assert.match(message, /finish answering/);
        }
    });

    test('a navigation with no conversation service at all also answers', async () => {
        (h.provider as unknown as { _conversation: undefined })._conversation = undefined;

        dispatch(h.provider, 'selectTopic', { mode: 'COURSE_CHAT', entityId: 42 });
        dispatch(h.provider, 'newConversation');
        await settle();

        const notices = errorNoticesFrom(postSpy);
        assert.strictEqual(notices.length, 2);
        for (const message of notices) {
            assert.match(message, /not available right now/);
        }
    });

    test('a REJECTED topic change answers instead of vanishing', async () => {
        // `resolveTopicChange` answers with an outcome, never a throw: a 500
        // from the create endpoint arrives here as `{ kind: 'rejected' }`, and
        // a dispatcher that only acts on `opened` drops it silently while the
        // chip stays on the old topic.
        fake.topicOutcome = { kind: 'rejected', reason: 'failed' };

        dispatch(h.provider, 'selectTopic', { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 7 });
        await settle();

        assert.deepStrictEqual(errorNoticesFrom(postSpy), ['Could not change the topic. Please try again.']);
        assert.deepStrictEqual(noticesFrom(postSpy), [], 'a failure is not an informational notice');
    });

    test('a REJECTED topic change states the reason it was given', async () => {
        fake.topicOutcome = { kind: 'rejected', reason: 'cross-course' };

        dispatch(h.provider, 'selectTopic', { mode: 'COURSE_CHAT', entityId: 99 });
        await settle();

        assert.deepStrictEqual(errorNoticesFrom(postSpy), ['That topic belongs to a different course. Switch course first.']);
    });

    test('a REJECTED new conversation answers too', async () => {
        // The header's `+` is clickable in the send-in-flight-but-not-streaming
        // window, so this is reachable and it has nowhere else to be seen.
        fake.newOutcome = { kind: 'rejected', reason: 'failed' };

        dispatch(h.provider, 'newConversation');
        await settle();

        assert.deepStrictEqual(errorNoticesFrom(postSpy), ['Could not start a new conversation. Please try again.']);
    });

    test('a stale outcome says nothing: nothing was changed and nothing failed', async () => {
        fake.topicOutcome = { kind: 'stale' };
        fake.newOutcome = { kind: 'stale' };

        dispatch(h.provider, 'selectTopic', { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 7 });
        dispatch(h.provider, 'newConversation');
        await settle();

        assert.deepStrictEqual(errorNoticesFrom(postSpy), []);
        assert.deepStrictEqual(openErrorsFrom(postSpy), []);
    });

    test('refreshCourses reads the dashboard into the catalog and re-posts the snapshot', async () => {
        const populate = h.sandbox.stub(
            h.provider as unknown as { _populateAvailableContexts: (o?: { force?: boolean }) => Promise<void> },
            '_populateAvailableContexts',
        ).callsFake(async () => { h.courseCatalog.courses = [{ id: 42, title: 'Algorithms' }]; });

        dispatch(h.provider, 'refreshCourses');
        await settle();

        assert.strictEqual(populate.callCount, 1);
        // Opening the picker is the gesture that means "what is there NOW", so
        // a cached dashboard is not an answer to it.
        assert.deepStrictEqual(populate.firstCall.args, [{ force: true }]);
        const states = postSpy.getCalls()
            .map(c => c.args[0] as { type?: string; state?: { courses: unknown[] } })
            .filter(m => m?.type === 'updateIrisState');
        assert.ok(states.length > 0, 'the refreshed course list must be posted back');
        assert.strictEqual(states.at(-1)?.state?.courses.length, 1);
    });

    test('a retired command name reaches no handler and changes nothing', async () => {
        // A stale webview build posting a retired command name must fall
        // through to the utility handler and be logged, never acted on.
        dispatch(h.provider, 'createNewSession' as never);
        dispatch(h.provider, 'switchSession' as never, { sessionId: 'local-1' });
        dispatch(h.provider, 'openArtemisSession' as never, { courseId: 42, artemisSessionId: 5 });
        dispatch(h.provider, 'selectChatContext' as never, { context: 'course', itemId: 42, itemName: 'Algorithms' });
        dispatch(h.provider, 'switchToWorkspaceContext' as never);
        await settle();

        assert.strictEqual(h.api.getCurrentChat.callCount, 0, 'no acquisition may be triggered');
    });
});

suite('ChatWebviewProvider: the conversation-first send path', () => {
    let h: Harness;
    let postSpy: sinon.SinonSpy;

    setup(() => {
        h = buildHarness();
        postSpy = h.sandbox.spy(h.provider as unknown as { _postMessageSafe: (m: unknown) => void }, '_postMessageSafe');
        // The availability gate stays in front of the coordinator; it is the
        // only thing that knows about instructor settings.
        h.sandbox.stub(
            (h.provider as unknown as { _availability: { checkAndLoadIrisSettings: () => Promise<unknown> } })._availability,
            'checkAndLoadIrisSettings',
        ).resolves({ kind: 'enabled' } as never);
    });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    const send = (over: Record<string, unknown> = {}) =>
        (h.provider as unknown as { _handleChatMessage: (m: unknown) => Promise<void> })
            ._handleChatMessage({ text: 'why does this loop?', localId: 'l1', sessionId: 1, ...over });

    test('a send goes through the coordinator and confirms the bubble in its origin session', async () => {
        h.api.getCurrentChat.resolves(detail({ sessionId: 1 }));
        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 }, 42);
        h.api.sendChatMessage.resolves({ id: 77, sender: 'USER' } as never);

        await send();

        const confirm = postSpy.getCalls()
            .map(c => c.args[0] as { type?: string; sessionId?: number; id?: number })
            .find(m => m?.type === 'confirmSentMessage');
        assert.ok(confirm, 'the optimistic bubble must be confirmed');
        assert.strictEqual(confirm.id, 77);
        assert.strictEqual(confirm.sessionId, 1, 'addressed to the conversation it was drawn in');
    });

    test('availability is checked against the CONVERSATION', async () => {
        // The conversation is the only thing that names a course, so the check
        // follows it rather than any stored selection.
        h.api.getCurrentChat.resolves(detail({ sessionId: 1, courseId: 42, context: { mode: 'COURSE_CHAT', entityId: 42 } }));
        await h.provider.askIrisAbout({ mode: 'COURSE_CHAT', entityId: 42 }, 42);
        const check = (h.provider as unknown as {
            _availability: { checkAndLoadIrisSettings: sinon.SinonStub };
        })._availability.checkAndLoadIrisSettings;
        check.resetHistory();
        h.api.sendChatMessage.resolves({ id: 77, sender: 'USER' } as never);

        await send();

        assert.strictEqual(check.firstCall.args[0].id, 42, 'the conversation names the course');
        assert.strictEqual(check.firstCall.args[0].type, 'course');
    });

    test('a bubble is addressed from the ORIGIN argument, never from whatever is open now', async () => {
        // White-box on purpose. Navigation is refused mid-send today, so a
        // divergence is not reachable through the public surface; the argument
        // is what keeps this correct when that changes (and it is the whole
        // reason SendDeps passes the origin session in the first place).
        h.api.getCurrentChat.resolves(detail({ sessionId: 1 }));
        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 }, 42);
        const deps = (h.provider as unknown as { _sendCoordinator: { _deps: {
            confirmBubble: (sessionId: number, localId: string, id: number) => void;
            failBubble: (sessionId: number, localId: string, reason: string) => void;
        } } })._sendCoordinator._deps;

        deps.confirmBubble(7, 'l1', 99);
        deps.failBubble(7, 'l2', 'rate-limit');

        const addressed = postSpy.getCalls()
            .map(c => c.args[0] as { type?: string; sessionId?: number })
            .filter(m => m?.type === 'confirmSentMessage' || m?.type === 'sendRejected');
        assert.strictEqual(addressed.length, 2);
        for (const message of addressed) {
            assert.strictEqual(message.sessionId, 7);
        }
    });

    test('with no conversation to send to, the bubble is failed rather than left hanging', async () => {
        // No conversation means no course either, so the availability gate is
        // the first to refuse; what matters is that SOMETHING fails the bubble
        // instead of leaving it stuck in `sending` with the indicator spinning.
        await send();

        const rejected = postSpy.getCalls()
            .map(c => c.args[0] as { type?: string; reason?: string; localId?: string })
            .find(m => m?.type === 'sendRejected');
        assert.ok(rejected, 'a send that cannot be carried must fail its bubble');
        assert.strictEqual(rejected.localId, 'l1');
        assert.strictEqual(rejected.reason, 'no-context');
    });
});

suite('ChatWebviewProvider: reload clears the banner that sent you to Retry', () => {
    let h: Harness;
    let postSpy: sinon.SinonSpy;

    setup(() => {
        h = buildHarness();
        postSpy = h.sandbox.spy(h.provider as unknown as { _postMessageSafe: (m: unknown) => void }, '_postMessageSafe');
    });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    test('a reload re-checks availability and hides both banners when Iris is back', async () => {
        // A reload re-installs the SAME conversation, so the navigation hook
        // (which keys on a session change) cannot clear anything. Without the
        // re-check, `iris-unavailable` shows the banner, disables the composer,
        // and Retry leaves both exactly as they were: the only escape is
        // navigating to a different conversation.
        h.api.listChatSessionsForCourse.resolves([]);
        h.api.getCurrentChat.resolves(detail({ sessionId: 1 }));
        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 }, 42);
        h.api.getChatSessionById.resolves(detail({ sessionId: 1 }));
        const check = h.sandbox.stub(
            (h.provider as unknown as { _availability: { checkAndLoadIrisSettings: () => Promise<unknown> } })._availability,
            'checkAndLoadIrisSettings',
        ).resolves({ kind: 'enabled' } as never);
        postSpy.resetHistory();

        await h.provider.reloadIrisChat();

        assert.strictEqual(check.callCount, 1, 'the reload must re-check availability');
        const types = postSpy.getCalls().map(c => (c.args[0] as { type?: string })?.type);
        assert.ok(types.includes('hideUnavailableState'), 'the unavailable banner must be cleared');
        assert.ok(types.includes('hideDisabledState'));
    });

    test('a reload that still finds Iris unavailable keeps the banner up', async () => {
        h.api.listChatSessionsForCourse.resolves([]);
        h.api.getCurrentChat.resolves(detail({ sessionId: 1 }));
        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 }, 42);
        h.api.getChatSessionById.resolves(detail({ sessionId: 1 }));
        h.sandbox.stub(
            (h.provider as unknown as { _availability: { checkAndLoadIrisSettings: () => Promise<unknown> } })._availability,
            'checkAndLoadIrisSettings',
        ).resolves({ kind: 'unavailable', reason: 'still down' } as never);
        postSpy.resetHistory();

        await h.provider.reloadIrisChat();

        const types = postSpy.getCalls().map(c => (c.args[0] as { type?: string })?.type);
        assert.ok(types.includes('showUnavailableState'), 'a still-broken Iris must keep saying so');
        assert.ok(!types.includes('hideUnavailableState'));
    });
});

suite('ChatWebviewProvider: the conversation owns the transcript', () => {
    let h: Harness;
    let postSpy: sinon.SinonSpy;

    setup(() => {
        h = buildHarness();
        postSpy = h.sandbox.spy(h.provider as unknown as { _postMessageSafe: (m: unknown) => void }, '_postMessageSafe');
    });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    const loads = () => postSpy.getCalls()
        .map(c => c.args[0] as { type?: string; sessionId?: number; messages?: Array<{ role: string; content: string }> })
        .filter(m => m?.type === 'loadMessages');

    test('an acquired conversation posts its transcript, keyed by the conversation id', async () => {
        h.api.getCurrentChat.resolves(detail({
            sessionId: 1,
            messages: [
                { id: 3, sender: 'USER', content: [{ type: 'text', textContent: 'why?' }], sentAt: '2025-01-01T00:00:00Z' },
                { id: 4, sender: 'LLM', content: [{ type: 'text', textContent: 'because' }], sentAt: '2025-01-01T00:01:00Z' },
            ] as never,
        }));

        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 }, 42);

        const posted = loads();
        assert.strictEqual(posted.length, 1, 'exactly one transcript per install');
        assert.strictEqual(posted[0].sessionId, 1);
        assert.deepStrictEqual(posted[0].messages?.map(m => m.role), ['user', 'assistant']);
    });

    test('the snapshot naming the conversation is posted BEFORE its transcript', async () => {
        // The webview keys an incoming transcript on the conversation the
        // snapshot names. A transcript that overtakes its own snapshot is
        // addressed to the conversation the student just left, and is dropped:
        // an empty chat under a correct header.
        h.api.getCurrentChat.resolves(detail({ sessionId: 1, messages: [{ id: 3, sender: 'USER' }] as never }));

        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 }, 42);

        const posted = postSpy.getCalls().map(c => c.args[0] as { type?: string; state?: { currentSessionId?: number } });
        const transcriptAt = posted.findIndex(m => m?.type === 'loadMessages');
        assert.ok(transcriptAt > 0, 'the transcript must be posted');
        // The snapshot in force when the transcript lands must already name the
        // conversation it belongs to; an earlier snapshot from the same
        // navigation still names the previous one.
        const inForce = posted.slice(0, transcriptAt).filter(m => m?.type === 'updateIrisState').at(-1);
        assert.strictEqual(inForce?.state?.currentSessionId, 1);
    });

    test('a persisted context-swap row is rendered as a divider, not as an assistant bubble', async () => {
        h.api.getCurrentChat.resolves(detail({
            sessionId: 1,
            messages: [{
                id: 3,
                sender: 'CTXSWAP',
                content: [{ type: 'json', attributes: { transition: 'added', entityMode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' } }],
            }] as never,
        }));

        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 }, 42);

        const row = loads()[0].messages?.[0];
        assert.strictEqual(row?.role, 'contextSwap');
        assert.strictEqual(row?.content, 'Topic set to BFS');
    });

    test('init acquires nothing on its own: one acquisition, one subscription', async () => {
        h.api.getCurrentChat.resolves(detail({ sessionId: 1 }));

        await (h.provider as unknown as { _sendInitData: () => Promise<void> })._sendInitData();

        assert.strictEqual(h.api.getCurrentChat.callCount, 0);
        assert.strictEqual(h.api.listChatSessionsForCourse.callCount, 0);
    });

    test('reading the dashboard does not open a conversation behind the cold start', async () => {
        h.courseCatalog.fetch.callsFake(async () => {
            h.courseCatalog.courses = [{ id: 42, title: 'Algorithms' }];
            return undefined;
        });

        await (h.provider as unknown as { _sendInitData: () => Promise<void> })._sendInitData();

        const states = postSpy.getCalls()
            .map(c => c.args[0] as { type?: string; state?: { courses: unknown[] } })
            .filter(m => m?.type === 'updateIrisState');
        assert.strictEqual(states.at(-1)?.state?.courses.length, 1, 'the picker still gets its list');
        assert.strictEqual(h.api.getCurrentChat.callCount, 0);
    });
});

/**
 * Admission. The startup coordinator sits behind the synchronous navigation
 * gate: every explicit navigation admits its intent (cancelling the startup
 * latch) before it does anything else, so an automatic cold start can never
 * fire underneath a student who has already moved. What these tests pin down
 * is WHEN admission happens relative to a navigation: at the gate, not on
 * success, and never for a command the gate refused outright.
 */
suite('ChatWebviewProvider: startup admission', () => {
    let h: Harness;

    // A `teardown` hook, not a call at the end of each test body: mocha runs
    // it even when the test's own assertions throw, so a sandbox stub (e.g.
    // on `vscode.commands.registerCommand`) never leaks into the next test.
    setup(() => { h = buildHarness(); });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    const NAVIGATIONS: Array<{ reason: string; run: (p: ChatWebviewProvider) => Promise<void> }> = [
        {
            reason: 'selectTopic',
            run: p => (p as never as { _handleSelectTopic: (t: unknown) => Promise<void> })
                ._handleSelectTopic({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 }),
        },
        {
            reason: 'openConversation',
            run: p => (p as never as {
                _handleOpenConversation: (params: { courseId: number; sessionId: number }) => Promise<void>;
            })._handleOpenConversation({ courseId: 42, sessionId: 7 }),
        },
        {
            reason: 'switchCourse',
            run: p => (p as never as { _handleSwitchCourse: (id: number) => Promise<void> })
                ._handleSwitchCourse(42),
        },
        {
            reason: 'newConversation',
            run: p => (p as never as { _handleNewConversation: () => Promise<void> })
                ._handleNewConversation(),
        },
    ];

    for (const nav of NAVIGATIONS) {
        test(`${nav.reason} admits its intent even when the navigation then fails`, async () => {
            // Every one of the four either ends in an API call or refuses for a
            // reason internal to the service (e.g. no course yet on a cold
            // start): failing the calls that DO happen, on every handler,
            // proves admission happened at admission and not on success.
            h.api.getCurrentChat.rejects(new ApiError('nope', 500));
            h.api.getChatSessionById.rejects(new ApiError('nope', 500));
            h.api.createCourseSession.rejects(new ApiError('nope', 500));
            const admit = spyOnAdmission(h);

            await nav.run(h.provider);

            assert.strictEqual(admit.calledOnce, true, `${nav.reason} did not admit`);
            assert.strictEqual(admit.firstCall.args[0], nav.reason);
        });
    }

    const NON_NAVIGATIONS = ['refreshCourses', 'reconnectWebSocket'] as const;

    for (const command of NON_NAVIGATIONS) {
        test(`${command} does NOT admit an intent`, async () => {
            const admit = spyOnAdmission(h);

            dispatch(h.provider, command);
            await settle();

            assert.strictEqual(admit.called, false,
                'it names no destination, so it is not a navigation the cold start must yield to');
        });
    }

    test('a navigation refused because a send is in flight does NOT admit', async () => {
        const fake = injectFakeConversation(h.provider);
        fake.sendInFlight = true;
        const admit = spyOnAdmission(h);

        await (h.provider as never as { _handleSwitchCourse: (id: number) => Promise<void> })
            ._handleSwitchCourse(42);

        assert.strictEqual(admit.called, false,
            'a refused command never reached the conversation, so it named no destination');
    });
});

/**
 * The chat records what it knows of the course/exercise it just entered into
 * the catalog's supplemental layer, so a header can keep
 * naming a course or exercise the dashboard later drops. This suite pins the
 * three call sites down directly, white-box, since the catalog write is a
 * side effect with no other externally observable trace.
 */
suite('ChatWebviewProvider: naming what the chat enters, in the catalog', () => {
    let h: Harness;

    setup(() => { h = buildHarness(); });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    test('switchCourse records the course name once it lands', async () => {
        const fake = injectFakeConversation(h.provider);
        fake.switchOutcome = { kind: 'opened', sessionId: 5 };
        h.courseCatalog.courseTitle.withArgs(43).returns('Algorithms');
        h.courseCatalog.currentEpoch = 6;

        dispatch(h.provider, 'switchCourse', { courseId: 43 });
        await settle();

        sinon.assert.calledOnceWithExactly(
            h.courseCatalog.upsertSupplemental,
            { kind: 'partial-course', id: 43, title: 'Algorithms' },
            6,
        );
    });

    test('switchCourse into a disabled course still records the name: the move happened', async () => {
        injectFakeConversation(h.provider).switchOutcome = { kind: 'disabled' };
        h.courseCatalog.courseTitle.withArgs(43).returns('Algorithms');

        dispatch(h.provider, 'switchCourse', { courseId: 43 });
        await settle();

        sinon.assert.calledOnce(h.courseCatalog.upsertSupplemental);
    });

    test('switchCourse records nothing when the course has no known title', async () => {
        injectFakeConversation(h.provider).switchOutcome = { kind: 'opened', sessionId: 5 };
        // courseTitle's default stub answer is undefined.

        dispatch(h.provider, 'switchCourse', { courseId: 43 });
        await settle();

        sinon.assert.notCalled(h.courseCatalog.upsertSupplemental);
    });

    test('a stale switch records nothing: a newer navigation may have moved elsewhere', async () => {
        injectFakeConversation(h.provider).switchOutcome = { kind: 'stale' };
        h.courseCatalog.courseTitle.withArgs(43).returns('Algorithms');

        dispatch(h.provider, 'switchCourse', { courseId: 43 });
        await settle();

        sinon.assert.notCalled(h.courseCatalog.upsertSupplemental);
    });

    test('a cold-start acquisition records the course name once it lands', async () => {
        const detection = new vscode.EventEmitter<DetectionOutcome>();
        h.provider.attachStartupDetection({ onDetectionSettled: detection.event, retry: () => undefined });
        h.api.getCurrentChat.resolves(detail({ sessionId: 1, courseId: 9 }));
        h.api.listChatSessionsForCourse.resolves([]);
        h.courseCatalog.courseTitle.withArgs(9).returns('Algorithms');
        h.courseCatalog.currentEpoch = 2;

        await resolveView(h);
        detection.fire({ kind: 'matched', exerciseId: 3, courseId: 9 });
        await settle();

        sinon.assert.calledOnceWithExactly(
            h.courseCatalog.upsertSupplemental,
            { kind: 'partial-course', id: 9, title: 'Algorithms' },
            2,
        );
        detection.dispose();
    });

    test('a cold start into a disabled course still records the name it landed in', async () => {
        const detection = new vscode.EventEmitter<DetectionOutcome>();
        h.provider.attachStartupDetection({ onDetectionSettled: detection.event, retry: () => undefined });
        h.api.getCurrentChat.rejects(new ApiError('Request failed', 403, 'error.iris.course_disabled', 'iris.course_disabled'));
        h.courseCatalog.courseTitle.withArgs(9).returns('Algorithms');

        await resolveView(h);
        detection.fire({ kind: 'matched', exerciseId: 3, courseId: 9 });
        await settle();

        sinon.assert.calledOnce(h.courseCatalog.upsertSupplemental);
        detection.dispose();
    });

    /**
     * The crux case `landedHere` exists for (conversationService.ts): one
     * `_install` path returns false (a superseding navigation won the race)
     * while `start()` still resolves `{ kind: 'ok' }` regardless, because
     * `ok` there means only "no error was thrown", never "we are now in the
     * requested course". `injectFakeConversation`'s `start` reports whatever
     * `startOutcome` says and `state.snapshot().courseId` is independently
     * settable, so this pins the guard down directly rather than through the
     * outcome kind alone. Paired with the sibling test below (identical
     * setup, matching course id) so a broken guard that always skips the
     * write cannot pass this test by accident.
     */
    test('a start reporting ok does not record the requested course when a superseding switch already moved elsewhere', async () => {
        const fake = injectFakeConversation(h.provider);
        fake.startOutcome = { kind: 'ok' };
        fake.snapshotCourseId = 99;
        h.courseCatalog.courseTitle.withArgs(9).returns('Algorithms');

        const detection = new vscode.EventEmitter<DetectionOutcome>();
        h.provider.attachStartupDetection({ onDetectionSettled: detection.event, retry: () => undefined });

        await resolveView(h);
        detection.fire({ kind: 'matched', exerciseId: 3, courseId: 9 });
        await settle();

        assert.strictEqual(fake.calls.some(c => c.name === 'start'), true, 'the acquisition must actually have run');
        sinon.assert.notCalled(h.courseCatalog.upsertSupplemental);
        detection.dispose();
    });

    test('a start reporting ok that actually landed in the requested course does record it', async () => {
        const fake = injectFakeConversation(h.provider);
        fake.startOutcome = { kind: 'ok' };
        fake.snapshotCourseId = 9;
        h.courseCatalog.courseTitle.withArgs(9).returns('Algorithms');
        h.courseCatalog.currentEpoch = 5;

        const detection = new vscode.EventEmitter<DetectionOutcome>();
        h.provider.attachStartupDetection({ onDetectionSettled: detection.event, retry: () => undefined });

        await resolveView(h);
        detection.fire({ kind: 'matched', exerciseId: 3, courseId: 9 });
        await settle();

        sinon.assert.calledOnceWithExactly(
            h.courseCatalog.upsertSupplemental,
            { kind: 'partial-course', id: 9, title: 'Algorithms' },
            5,
        );
        detection.dispose();
    });

    test('openConversation records the exercise a history row names, before navigating', async () => {
        const fake = injectFakeConversation(h.provider);
        const conversation = (h.provider as unknown as {
            _conversation: { state: { snapshot: () => unknown } };
        })._conversation;
        conversation.state.snapshot = () => ({
            currentSessionId: 1,
            courseId: 42,
            courseSessions: [{
                sessionId: 7, courseId: 42,
                context: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' },
            }],
            knownInvisible: [],
        });
        h.courseCatalog.currentEpoch = 4;

        dispatch(h.provider, 'openConversation', { courseId: 42, sessionId: 7 });
        await settle();

        sinon.assert.calledOnceWithExactly(
            h.courseCatalog.upsertSupplemental,
            { kind: 'partial-exercise', id: 5, courseId: 42, title: 'BFS' },
            4,
        );
        assert.deepStrictEqual(fake.calls, [{ name: 'navigateTo', args: { courseId: 42, sessionId: 7 } }],
            'the write must happen before navigateTo, synchronously, so it cannot cross an epoch');
    });

    test('openConversation does not name a lecture history row: entityId collides with an exercise id', async () => {
        injectFakeConversation(h.provider);
        const conversation = (h.provider as unknown as {
            _conversation: { state: { snapshot: () => unknown } };
        })._conversation;
        conversation.state.snapshot = () => ({
            currentSessionId: 1,
            courseId: 42,
            courseSessions: [{
                sessionId: 7, courseId: 42,
                context: { mode: 'LECTURE_CHAT', entityId: 5, name: 'Lecture 1' },
            }],
            knownInvisible: [],
        });

        dispatch(h.provider, 'openConversation', { courseId: 42, sessionId: 7 });
        await settle();

        sinon.assert.notCalled(h.courseCatalog.upsertSupplemental);
    });

    test('openConversation records nothing for a row with no name', async () => {
        injectFakeConversation(h.provider);
        const conversation = (h.provider as unknown as {
            _conversation: { state: { snapshot: () => unknown } };
        })._conversation;
        conversation.state.snapshot = () => ({
            currentSessionId: 1,
            courseId: 42,
            courseSessions: [],
            knownInvisible: [{
                sessionId: 7, courseId: 42,
                context: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 },
            }],
        });

        dispatch(h.provider, 'openConversation', { courseId: 42, sessionId: 7 });
        await settle();

        sinon.assert.notCalled(h.courseCatalog.upsertSupplemental);
    });
});
