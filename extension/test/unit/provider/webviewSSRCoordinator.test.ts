/**
 * Tests for WebviewSSRCoordinator.
 *
 * Black-box behavior tests: each case constructs the coordinator with a
 * partial deps stub filled only for the fields the SUT touches, then
 * exercises the public surface (scheduleRender, dispose) and the
 * registered theme-change callback.
 */

import * as vscode from 'vscode';
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
            serverRenderedProblemStatement: { html: string } | null;
        };
        renderService: {
            render: sinon.SinonStub;
            invalidateAll: sinon.SinonStub;
        };
        postMessage: sinon.SinonStub;
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
            },
            renderService: overrides.renderService ?? {
                render: sandbox.stub().resolves(undefined),
                invalidateAll: sandbox.stub(),
            },
            postMessage: overrides.postMessage ?? sandbox.stub(),
        };

        const deps = {
            appStateManager: stubs.appStateManager,
            renderService: stubs.renderService,
            postMessage: stubs.postMessage,
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
            serverRenderedProblemStatement: null as { html: string } | null,
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
        sinon.assert.calledWith(renderStub, exercise, { participation: exercise.studentParticipations[0] });
        sinon.assert.match(stubs.appStateManager.serverRenderedProblemStatement, { html: '<p>Hello</p>' });
        sinon.assert.calledWith(stubs.postMessage, sinon.match({
            type: ExtensionMsg.ProblemStatementRendered,
            html: '<p>Hello</p>',
        }));
    });

    test('dispose disposes the theme listener', () => {
        const { deps } = buildDeps();
        const coordinator = new WebviewSSRCoordinator(deps);

        coordinator.dispose();

        sinon.assert.calledOnce(themeDisposable.dispose);
    });
});
