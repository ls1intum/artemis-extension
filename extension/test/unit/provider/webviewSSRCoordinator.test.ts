/**
 * Tests for WebviewSSRCoordinator.
 *
 * Black-box behavior tests: each case constructs the coordinator with a
 * partial deps stub filled only for the fields the SUT touches, then
 * exercises the public surface (scheduleRender, dispose) and the
 * registered theme-change callback.
 */

import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ExtensionMsg } from '@shared/messageContracts';

import type { WebviewSSRCoordinatorDeps } from '@extension/provider/webviewSSRCoordinator';
import { WebviewSSRCoordinator } from '@extension/provider/webviewSSRCoordinator';
import type { ExerciseDetailsResponse } from '@extension/types';

suite('WebviewSSRCoordinator', () => {
    let sandbox: sinon.SinonSandbox;
    let onDidChangeActiveColorThemeStub: sinon.SinonStub;
    let themeDisposable: { dispose: sinon.SinonStub };
    let themeCallback: ((e: vscode.ColorTheme) => unknown) | undefined;

    interface DepStubs {
        appStateManager: {
            currentState: string;
            currentExerciseData: ExerciseDetailsResponse | undefined;
            serverRenderedProblemStatement: { html: string; participationId?: number } | null;
            showExerciseDetail: sinon.SinonStub;
            /** Optional so the cases that predate the practice/graded split need not restate it. */
            workspaceIsPractice?: boolean;
        };
        renderService: {
            render: sinon.SinonStub;
            invalidateAll: sinon.SinonStub;
        };
        postMessage: sinon.SinonStub;
        fetchExerciseDetails: sinon.SinonStub;
    }

    function buildDeps(overrides: Partial<DepStubs> = {}): {
        deps: WebviewSSRCoordinatorDeps;
        stubs: DepStubs;
    } {
        const stubs: DepStubs = {
            appStateManager: overrides.appStateManager ?? {
                currentState: 'login',
                currentExerciseData: undefined,
                serverRenderedProblemStatement: null,
                showExerciseDetail: sandbox.stub(),
                workspaceIsPractice: false,
            },
            renderService: overrides.renderService ?? {
                render: sandbox.stub().resolves(undefined),
                invalidateAll: sandbox.stub(),
            },
            postMessage: overrides.postMessage ?? sandbox.stub(),
            fetchExerciseDetails: overrides.fetchExerciseDetails ?? sandbox.stub().resolves(undefined),
        };

        const deps = {
            appStateManager: stubs.appStateManager,
            renderService: stubs.renderService,
            postMessage: stubs.postMessage,
            fetchExerciseDetails: stubs.fetchExerciseDetails,
        } as unknown as WebviewSSRCoordinatorDeps;

        return { deps, stubs };
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        themeCallback = undefined;
        themeDisposable = { dispose: sandbox.stub() };
        onDidChangeActiveColorThemeStub = sandbox
            .stub(vscode.window, 'onDidChangeActiveColorTheme')
            .callsFake(((cb: (e: vscode.ColorTheme) => unknown) => {
                themeCallback = cb;
                return themeDisposable as unknown as vscode.Disposable;
            }) as unknown as typeof vscode.window.onDidChangeActiveColorTheme);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('constructor registers a theme-change listener exactly once', () => {
        const { deps } = buildDeps();
        new WebviewSSRCoordinator(deps);

        sinon.assert.calledOnce(onDidChangeActiveColorThemeStub);
    });

    test('theme change invalidates the render-service cache', () => {
        const { deps, stubs } = buildDeps();
        new WebviewSSRCoordinator(deps);

        if (!themeCallback) { throw new Error('theme callback not captured'); }
        themeCallback({} as vscode.ColorTheme);

        sinon.assert.calledOnce(stubs.renderService.invalidateAll);
    });

    test('theme change resets appStateManager.serverRenderedProblemStatement to null', () => {
        const { deps, stubs } = buildDeps({
            appStateManager: {
                currentState: 'login',
                currentExerciseData: undefined,
                serverRenderedProblemStatement: { html: '<p>cached</p>' },
                showExerciseDetail: sandbox.stub(),
            },
        });
        new WebviewSSRCoordinator(deps);

        if (!themeCallback) { throw new Error('theme callback not captured'); }
        themeCallback({} as vscode.ColorTheme);

        sinon.assert.match(stubs.appStateManager.serverRenderedProblemStatement, null);
    });

    test('theme change triggers a fresh scheduleRender', () => {
        const { deps } = buildDeps();
        const coordinator = new WebviewSSRCoordinator(deps);
        const scheduleSpy = sandbox.stub(coordinator, 'scheduleRender').resolves();

        if (!themeCallback) { throw new Error('theme callback not captured'); }
        themeCallback({} as vscode.ColorTheme);

        sinon.assert.calledOnce(scheduleSpy);
    });

    test('scheduleRender is a no-op when currentState is not exercise-detail', async () => {
        const { deps, stubs } = buildDeps({
            appStateManager: {
                currentState: 'dashboard',
                currentExerciseData: undefined,
                serverRenderedProblemStatement: null,
                showExerciseDetail: sandbox.stub(),
                workspaceIsPractice: false,
            },
        });
        const coordinator = new WebviewSSRCoordinator(deps);

        await coordinator.scheduleRender();

        sinon.assert.notCalled(stubs.renderService.render);
        sinon.assert.notCalled(stubs.postMessage);
    });

    test('scheduleRender is a no-op when currentExerciseData is undefined', async () => {
        const { deps, stubs } = buildDeps({
            appStateManager: {
                currentState: 'exercise-detail',
                currentExerciseData: undefined,
                serverRenderedProblemStatement: null,
                showExerciseDetail: sandbox.stub(),
                workspaceIsPractice: false,
            },
        });
        const coordinator = new WebviewSSRCoordinator(deps);

        await coordinator.scheduleRender();

        sinon.assert.notCalled(stubs.renderService.render);
        sinon.assert.notCalled(stubs.postMessage);
    });

    test('scheduleRender happy path: renders, caches state, posts ProblemStatementRendered', async () => {
        const exercise = {
            id: 42,
            problemStatement: '# Hello',
            studentParticipations: [{ id: 7 }],
        };
        const exerciseData = { exercise } as unknown as ExerciseDetailsResponse;
        const renderResult = { html: '<p>Hello</p>', contentHash: 'abcdef1234567890' };

        const renderStub = sandbox.stub().resolves(renderResult);
        const appStateManager = {
            currentState: 'exercise-detail',
            currentExerciseData: exerciseData,
            serverRenderedProblemStatement: null as { html: string; participationId?: number } | null,
            showExerciseDetail: sandbox.stub(),
            workspaceIsPractice: false,
        };
        const { deps, stubs } = buildDeps({
            appStateManager,
            renderService: {
                render: renderStub,
                invalidateAll: sandbox.stub(),
            },
        });
        const coordinator = new WebviewSSRCoordinator(deps);

        await coordinator.scheduleRender();

        sinon.assert.calledOnce(renderStub);
        sinon.assert.calledWith(renderStub, exercise, {
            participation: exercise.studentParticipations[0],
            buildPending: false,
        });
        sinon.assert.match(stubs.appStateManager.serverRenderedProblemStatement, { html: '<p>Hello</p>', participationId: 7 });
        sinon.assert.calledWith(stubs.postMessage, sinon.match({
            type: ExtensionMsg.ProblemStatementRendered,
            html: '<p>Hello</p>',
            exerciseId: 42,
            participationId: 7,
        }));
    });

    test('scheduleRender skips when the current exercise has no id (cannot target the broadcast)', async () => {
        const exercise = { problemStatement: '# Hello', studentParticipations: [{ id: 7 }] };
        const exerciseData = { exercise } as unknown as ExerciseDetailsResponse;
        const renderStub = sandbox.stub().resolves({ html: '<p>Hello</p>', contentHash: 'abcdef1234567890' });
        const { deps, stubs } = buildDeps({
            appStateManager: {
                currentState: 'exercise-detail',
                currentExerciseData: exerciseData,
                serverRenderedProblemStatement: null as { html: string; participationId?: number } | null,
                showExerciseDetail: sandbox.stub(),
                workspaceIsPractice: false,
            },
            renderService: { render: renderStub, invalidateAll: sandbox.stub() },
        });

        await new WebviewSSRCoordinator(deps).scheduleRender();

        sinon.assert.notCalled(renderStub);
        sinon.assert.notCalled(stubs.postMessage);
    });

    /** An exercise with both participations, which is the only case any of this is visible in. */
    function bothParticipations(pending?: number): {
        exerciseData: ExerciseDetailsResponse;
        exercise: { id: number; problemStatement: string; studentParticipations: { id: number; testRun: boolean }[] };
    } {
        const exercise = {
            id: 42,
            problemStatement: '# Hello',
            studentParticipations: [{ id: 7, testRun: false }, { id: 8, testRun: true }],
        };
        const exerciseData = {
            exercise,
            pendingSubmissionsByParticipationId: pending === undefined ? {} : { [pending]: { participationId: pending } },
        } as unknown as ExerciseDetailsResponse;
        return { exerciseData, exercise };
    }

    test('renders for the practice participation when that is the repository the student has open', async () => {
        // The whole point of the change: the graded one used to be picked by array position, which
        // Artemis does not even guarantee.
        const { exerciseData, exercise } = bothParticipations();
        const renderStub = sandbox.stub().resolves({ html: '<p>P</p>', contentHash: 'aaaaaaaaaaaaaaaa' });
        const { deps, stubs } = buildDeps({
            appStateManager: {
                currentState: 'exercise-detail',
                currentExerciseData: exerciseData,
                serverRenderedProblemStatement: null,
                showExerciseDetail: sandbox.stub(),
                workspaceIsPractice: true,
            },
            renderService: { render: renderStub, invalidateAll: sandbox.stub() },
        });

        await new WebviewSSRCoordinator(deps).scheduleRender();

        sinon.assert.calledWith(renderStub, exercise, {
            participation: exercise.studentParticipations[1],
            buildPending: false,
        });
        sinon.assert.calledWith(stubs.postMessage, sinon.match({ participationId: 8 }));
    });

    test('reports a build pending on the participation it selected, not on the other one', async () => {
        // The map can carry concurrent builds for both participations; taking the wrong entry would
        // either blank the markers or keep a stale result while nothing is actually building.
        const { exerciseData, exercise } = bothParticipations(8);
        const renderStub = sandbox.stub().resolves({ html: '<p>P</p>', contentHash: 'aaaaaaaaaaaaaaaa' });
        const { deps } = buildDeps({
            appStateManager: {
                currentState: 'exercise-detail',
                currentExerciseData: exerciseData,
                serverRenderedProblemStatement: null,
                showExerciseDetail: sandbox.stub(),
                workspaceIsPractice: true,
            },
            renderService: { render: renderStub, invalidateAll: sandbox.stub() },
        });

        await new WebviewSSRCoordinator(deps).scheduleRender();

        sinon.assert.calledWith(renderStub, exercise, {
            participation: exercise.studentParticipations[1],
            buildPending: true,
        });
    });

    test('drops a render whose participation stopped being the selected one mid-flight', async () => {
        // The exercise id guard does not cover this: both participations belong to the same exercise,
        // so only comparing the selection catches a workspace mode that resolved during the await.
        const { exerciseData } = bothParticipations();
        const appStateManager = {
            currentState: 'exercise-detail',
            currentExerciseData: exerciseData,
            serverRenderedProblemStatement: null as { html: string; participationId?: number } | null,
            showExerciseDetail: sandbox.stub(),
            workspaceIsPractice: false,
        };
        const renderStub = sandbox.stub().callsFake(async () => {
            appStateManager.workspaceIsPractice = true;
            return { html: '<p>stale</p>', contentHash: 'aaaaaaaaaaaaaaaa' };
        });
        const { deps, stubs } = buildDeps({
            appStateManager,
            renderService: { render: renderStub, invalidateAll: sandbox.stub() },
        });

        await new WebviewSSRCoordinator(deps).scheduleRender();

        sinon.assert.notCalled(stubs.postMessage);
        assert.strictEqual(stubs.appStateManager.serverRenderedProblemStatement, null);
    });

    test('dispose disposes the theme listener', () => {
        const { deps } = buildDeps();
        const coordinator = new WebviewSSRCoordinator(deps);

        coordinator.dispose();

        sinon.assert.calledOnce(themeDisposable.dispose);
    });

    function makeDeferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
        let resolveFn!: (v: T) => void;
        let rejectFn!: (e: unknown) => void;
        const promise = new Promise<T>((res, rej) => { resolveFn = res; rejectFn = rej; });
        return { promise, resolve: resolveFn, reject: rejectFn };
    }

    function flushMicrotasks(): Promise<void> {
        return new Promise(resolve => setImmediate(resolve));
    }

    function makeExerciseData(id: number): ExerciseDetailsResponse {
        return {
            exercise: {
                id,
                problemStatement: '# stmt',
                studentParticipations: [{ id: id * 10 }],
            },
        } as unknown as ExerciseDetailsResponse;
    }

    test('refreshFromServer is a no-op when not on exercise-detail', async () => {
        const { deps, stubs } = buildDeps({
            appStateManager: {
                currentState: 'dashboard',
                currentExerciseData: makeExerciseData(42),
                serverRenderedProblemStatement: null,
                showExerciseDetail: sandbox.stub(),
                workspaceIsPractice: false,
            },
        });
        const coordinator = new WebviewSSRCoordinator(deps);

        coordinator.refreshFromServer({ exerciseId: 42 });
        await flushMicrotasks();

        sinon.assert.notCalled(stubs.fetchExerciseDetails);
        sinon.assert.notCalled(stubs.appStateManager.showExerciseDetail);
    });

    test('refreshFromServer is a no-op when exerciseId no longer matches current', async () => {
        const { deps, stubs } = buildDeps({
            appStateManager: {
                currentState: 'exercise-detail',
                currentExerciseData: makeExerciseData(99),
                serverRenderedProblemStatement: null,
                showExerciseDetail: sandbox.stub(),
            },
        });
        const coordinator = new WebviewSSRCoordinator(deps);

        coordinator.refreshFromServer({ exerciseId: 42 });
        await flushMicrotasks();

        sinon.assert.notCalled(stubs.fetchExerciseDetails);
        sinon.assert.notCalled(stubs.appStateManager.showExerciseDetail);
    });

    test('refreshFromServer happy path: fetches, updates app state, schedules render', async () => {
        const exerciseData = makeExerciseData(42);
        const freshData = makeExerciseData(42);
        const fetchStub = sandbox.stub().resolves(freshData);
        const showExerciseStub = sandbox.stub();
        const { deps, stubs } = buildDeps({
            appStateManager: {
                currentState: 'exercise-detail',
                currentExerciseData: exerciseData,
                serverRenderedProblemStatement: null,
                showExerciseDetail: showExerciseStub,
            },
            fetchExerciseDetails: fetchStub,
        });
        const coordinator = new WebviewSSRCoordinator(deps);
        const scheduleSpy = sandbox.stub(coordinator, 'scheduleRender').resolves();

        coordinator.refreshFromServer({ exerciseId: 42 });
        await flushMicrotasks();
        await flushMicrotasks();

        sinon.assert.calledOnceWithExactly(stubs.fetchExerciseDetails, 42);
        sinon.assert.calledOnceWithExactly(showExerciseStub, freshData);
        sinon.assert.calledOnce(scheduleSpy);
    });

    test('refreshFromServer coalesces two rapid calls into sequential (not parallel) fetches', async () => {
        const exerciseData = makeExerciseData(42);
        const fetch1 = makeDeferred<ExerciseDetailsResponse>();
        const fetch2 = makeDeferred<ExerciseDetailsResponse>();
        const fetchStub = sandbox.stub();
        fetchStub.onCall(0).returns(fetch1.promise);
        fetchStub.onCall(1).returns(fetch2.promise);

        const appState = {
            currentState: 'exercise-detail',
            currentExerciseData: exerciseData,
            serverRenderedProblemStatement: null,
            showExerciseDetail: sandbox.stub(),
            workspaceIsPractice: false,
        };
        const { deps } = buildDeps({
            appStateManager: appState,
            fetchExerciseDetails: fetchStub,
        });
        const coordinator = new WebviewSSRCoordinator(deps);
        sandbox.stub(coordinator, 'scheduleRender').resolves();

        coordinator.refreshFromServer({ exerciseId: 42 });
        coordinator.refreshFromServer({ exerciseId: 42 });
        await flushMicrotasks();

        // Only the first fetch should have started; the second is pending.
        sinon.assert.calledOnce(fetchStub);

        // Resolve the first; the second must start only now.
        fetch1.resolve(makeExerciseData(42));
        await flushMicrotasks();
        await flushMicrotasks();
        sinon.assert.calledTwice(fetchStub);

        // Resolve the second so the test finishes cleanly.
        fetch2.resolve(makeExerciseData(42));
        await flushMicrotasks();
    });

    test('refreshFromServer coalesces three rapid calls into two total fetches (last-wins, pending slot of 1)', async () => {
        const exerciseData = makeExerciseData(42);
        const fetch1 = makeDeferred<ExerciseDetailsResponse>();
        const fetch2 = makeDeferred<ExerciseDetailsResponse>();
        const fetchStub = sandbox.stub();
        fetchStub.onCall(0).returns(fetch1.promise);
        fetchStub.onCall(1).returns(fetch2.promise);

        const { deps } = buildDeps({
            appStateManager: {
                currentState: 'exercise-detail',
                currentExerciseData: exerciseData,
                serverRenderedProblemStatement: null,
                showExerciseDetail: sandbox.stub(),
                workspaceIsPractice: false,
            },
            fetchExerciseDetails: fetchStub,
        });
        const coordinator = new WebviewSSRCoordinator(deps);
        sandbox.stub(coordinator, 'scheduleRender').resolves();

        coordinator.refreshFromServer({ exerciseId: 42 });
        coordinator.refreshFromServer({ exerciseId: 42 });
        coordinator.refreshFromServer({ exerciseId: 42 });
        await flushMicrotasks();
        sinon.assert.calledOnce(fetchStub);

        fetch1.resolve(makeExerciseData(42));
        await flushMicrotasks();
        await flushMicrotasks();
        sinon.assert.calledTwice(fetchStub);

        fetch2.resolve(makeExerciseData(42));
        await flushMicrotasks();
        sinon.assert.calledTwice(fetchStub);
    });

    test('refreshFromServer skips post-fetch mutation when state changed during await', async () => {
        const exerciseData = makeExerciseData(42);
        const fetch1 = makeDeferred<ExerciseDetailsResponse>();
        const fetchStub = sandbox.stub().returns(fetch1.promise);

        const appState = {
            currentState: 'exercise-detail',
            currentExerciseData: exerciseData,
            serverRenderedProblemStatement: null,
            showExerciseDetail: sandbox.stub(),
            workspaceIsPractice: false,
        };
        const { deps } = buildDeps({
            appStateManager: appState,
            fetchExerciseDetails: fetchStub,
        });
        const coordinator = new WebviewSSRCoordinator(deps);
        const scheduleSpy = sandbox.stub(coordinator, 'scheduleRender').resolves();

        coordinator.refreshFromServer({ exerciseId: 42 });
        await flushMicrotasks();
        sinon.assert.calledOnce(fetchStub);

        // Navigate away mid-fetch.
        appState.currentState = 'course-detail';

        fetch1.resolve(makeExerciseData(42));
        await flushMicrotasks();
        await flushMicrotasks();

        sinon.assert.notCalled(appState.showExerciseDetail);
        sinon.assert.notCalled(scheduleSpy);
    });

    test('refreshFromServer skips post-fetch mutation when exerciseId changed during await', async () => {
        const exerciseData = makeExerciseData(42);
        const fetch1 = makeDeferred<ExerciseDetailsResponse>();
        const fetchStub = sandbox.stub().returns(fetch1.promise);

        const appState = {
            currentState: 'exercise-detail',
            currentExerciseData: exerciseData,
            serverRenderedProblemStatement: null,
            showExerciseDetail: sandbox.stub(),
            workspaceIsPractice: false,
        };
        const { deps } = buildDeps({
            appStateManager: appState,
            fetchExerciseDetails: fetchStub,
        });
        const coordinator = new WebviewSSRCoordinator(deps);
        const scheduleSpy = sandbox.stub(coordinator, 'scheduleRender').resolves();

        coordinator.refreshFromServer({ exerciseId: 42 });
        await flushMicrotasks();

        // Switch to a different exercise while fetch is in flight.
        appState.currentExerciseData = makeExerciseData(99);

        fetch1.resolve(makeExerciseData(42));
        await flushMicrotasks();
        await flushMicrotasks();

        sinon.assert.notCalled(appState.showExerciseDetail);
        sinon.assert.notCalled(scheduleSpy);
    });

    test('refreshFromServer skips post-fetch mutation when disposed during await', async () => {
        const exerciseData = makeExerciseData(42);
        const fetch1 = makeDeferred<ExerciseDetailsResponse>();
        const fetchStub = sandbox.stub().returns(fetch1.promise);

        const appState = {
            currentState: 'exercise-detail',
            currentExerciseData: exerciseData,
            serverRenderedProblemStatement: null,
            showExerciseDetail: sandbox.stub(),
            workspaceIsPractice: false,
        };
        const { deps } = buildDeps({
            appStateManager: appState,
            fetchExerciseDetails: fetchStub,
        });
        const coordinator = new WebviewSSRCoordinator(deps);
        const scheduleSpy = sandbox.stub(coordinator, 'scheduleRender').resolves();

        coordinator.refreshFromServer({ exerciseId: 42 });
        await flushMicrotasks();

        coordinator.dispose();

        fetch1.resolve(makeExerciseData(42));
        await flushMicrotasks();

        sinon.assert.notCalled(appState.showExerciseDetail);
        sinon.assert.notCalled(scheduleSpy);
    });

    test('scheduleRender skips mutation/post when disposed during the render await', async () => {
        const exercise = {
            id: 42,
            problemStatement: '# Hello',
            studentParticipations: [{ id: 7 }],
        };
        const exerciseData = { exercise } as unknown as ExerciseDetailsResponse;
        const renderDeferred = makeDeferred<{ html: string; contentHash: string }>();

        const renderStub = sandbox.stub().returns(renderDeferred.promise);
        const appStateManager = {
            currentState: 'exercise-detail',
            currentExerciseData: exerciseData,
            serverRenderedProblemStatement: null as { html: string; participationId?: number } | null,
            showExerciseDetail: sandbox.stub(),
            workspaceIsPractice: false,
        };
        const { deps, stubs } = buildDeps({
            appStateManager,
            renderService: {
                render: renderStub,
                invalidateAll: sandbox.stub(),
            },
        });
        const coordinator = new WebviewSSRCoordinator(deps);

        const renderPromise = coordinator.scheduleRender();
        await flushMicrotasks();
        sinon.assert.calledOnce(renderStub);

        // Dispose mid-render.
        coordinator.dispose();

        // Render returns after dispose; coordinator must not mutate state or post.
        renderDeferred.resolve({ html: '<p>Hello</p>', contentHash: 'abcdef1234567890' });
        await renderPromise;

        sinon.assert.match(stubs.appStateManager.serverRenderedProblemStatement, null);
        sinon.assert.notCalled(stubs.postMessage);
    });

    test('refreshFromServer after dispose() is an immediate no-op', async () => {
        const { deps, stubs } = buildDeps({
            appStateManager: {
                currentState: 'exercise-detail',
                currentExerciseData: makeExerciseData(42),
                serverRenderedProblemStatement: null,
                showExerciseDetail: sandbox.stub(),
                workspaceIsPractice: false,
            },
        });
        const coordinator = new WebviewSSRCoordinator(deps);
        coordinator.dispose();

        coordinator.refreshFromServer({ exerciseId: 42 });
        await flushMicrotasks();

        sinon.assert.notCalled(stubs.fetchExerciseDetails);
    });

    test('refreshFromServer swallows fetch errors and stays usable for subsequent refreshes', async () => {
        const exerciseData = makeExerciseData(42);
        const fetchStub = sandbox.stub();
        fetchStub.onCall(0).rejects(new Error('network down'));
        fetchStub.onCall(1).resolves(makeExerciseData(42));

        const appState = {
            currentState: 'exercise-detail',
            currentExerciseData: exerciseData,
            serverRenderedProblemStatement: null,
            showExerciseDetail: sandbox.stub(),
            workspaceIsPractice: false,
        };
        const { deps } = buildDeps({
            appStateManager: appState,
            fetchExerciseDetails: fetchStub,
        });
        const coordinator = new WebviewSSRCoordinator(deps);
        const scheduleSpy = sandbox.stub(coordinator, 'scheduleRender').resolves();

        // The first refresh fails. It must not throw out of refreshFromServer,
        // and the internal loop must not leave _refreshing inconsistent.
        coordinator.refreshFromServer({ exerciseId: 42 });
        await flushMicrotasks();
        await flushMicrotasks();

        sinon.assert.notCalled(appState.showExerciseDetail);

        // Second refresh after the failure must succeed.
        coordinator.refreshFromServer({ exerciseId: 42 });
        await flushMicrotasks();
        await flushMicrotasks();

        sinon.assert.calledTwice(fetchStub);
        sinon.assert.calledOnce(appState.showExerciseDetail);
        sinon.assert.calledOnce(scheduleSpy);
    });
});
