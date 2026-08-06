/**
 * Tests for WebviewNavigationFacade.
 *
 * These are black-box behavior tests: each case constructs the facade with a
 * partial deps stub filled only for the fields the SUT touches, then asserts
 * the expected side effects (state-manager calls, websocket interactions,
 * post-message routing, render/init callbacks).
 *
 * For openExerciseDetails we stub the standalone
 * `fetchAndEnrichExerciseDetails` via a sinon stub on the namespace import
 * from `@extension/controller/exerciseDataLoader`. If the property descriptor
 * is non-configurable in a future tsconfig change, we have a documented
 * fallback: inject a `fetchExerciseDetails` callback through the facade deps.
 */

import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ExtensionMsg } from '@shared/messageContracts';

import * as exerciseDataLoader from '@extension/controller/exerciseDataLoader';
import type {
    WebviewNavigationFacadeDeps,
} from '@extension/provider/webviewNavigationFacade';
import { WebviewNavigationFacade } from '@extension/provider/webviewNavigationFacade';
// The defining module, not the `@extension/services/workspace` barrel the
// facade imports from: a re-export is a non-configurable getter, and it
// forwards to this module's export at call time, so this is the seam sinon
// can actually replace.
import * as detectionModule from '@extension/services/workspace/workspaceDetectionService';
import type { ExerciseDetailsResponse } from '@extension/types';

/** Lets the background archive chain in `showDashboard` run to completion. */
function flushBackgroundWork(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

suite('WebviewNavigationFacade', () => {
    let sandbox: sinon.SinonSandbox;
    let showErrorMessage: sinon.SinonStub;
    let showInformationMessage: sinon.SinonStub;
    let openTextDocument: sinon.SinonStub;
    let showTextDocument: sinon.SinonStub;
    let getConfiguration: sinon.SinonStub;
    let fetchAndEnrichStub: sinon.SinonStub;

    // Builders for stub deps. Each test fills only what it needs.
    interface DepStubs {
        appStateManager: {
            showLogin: sinon.SinonStub;
            showDashboard: sinon.SinonStub;
            showCourseList: sinon.SinonStub;
            showCourseDetail: sinon.SinonStub;
            showExerciseDetail: sinon.SinonStub;
            showAiConfig: sinon.SinonStub;
            showServiceStatus: sinon.SinonStub;
            showStruggleDetection: sinon.SinonStub;
            showRecommendedExtensions: sinon.SinonStub;
            showGitCredentials: sinon.SinonStub;
            seedAuthenticatedSession: sinon.SinonStub;
            injectCourseEntry: sinon.SinonStub;
            currentState: string;
            currentExerciseData: ExerciseDetailsResponse | undefined;
            coursesData: { courses: unknown[] } | undefined;
            archivedCoursesData: unknown[] | undefined;
            userInfo: unknown;
            archiveCheckComplete: boolean;
        };
        artemisApi: { dummy: true };
        websocketService: {
            isConnected: sinon.SinonStub;
            connect: sinon.SinonStub;
        };
        courseAccessStorage: {
            onCourseAccessed: sinon.SinonStub;
        };
        fullscreenPanelManager: {
            openExerciseFullscreen: sinon.SinonStub;
            openCourseFullscreen: sinon.SinonStub;
            openCourseListFullscreen: sinon.SinonStub;
        };
        exerciseOpeningService: {
            handleExerciseOpened: sinon.SinonStub;
        };
        startPageResolver: {
            resolve: sinon.SinonStub;
        };
        courseCatalog: {
            fetch: sinon.SinonStub;
            upsertSupplemental: sinon.SinonStub;
            currentEpoch: number;
        };
        postMessage: sinon.SinonStub;
        render: sinon.SinonStub;
        sendInitData: sinon.SinonStub;
        backgroundRenderProblemStatement: sinon.SinonStub;
        getServerUrl: sinon.SinonStub;
    }

    function buildDeps(overrides: Partial<DepStubs> = {}): {
        deps: WebviewNavigationFacadeDeps;
        stubs: DepStubs;
    } {
        const stubs: DepStubs = {
            appStateManager: overrides.appStateManager ?? {
                showLogin: sandbox.stub(),
                showDashboard: sandbox.stub(),
                showCourseList: sandbox.stub(),
                showCourseDetail: sandbox.stub(),
                showExerciseDetail: sandbox.stub(),
                showAiConfig: sandbox.stub(),
                showServiceStatus: sandbox.stub(),
                showStruggleDetection: sandbox.stub(),
                showRecommendedExtensions: sandbox.stub(),
                showGitCredentials: sandbox.stub(),
                seedAuthenticatedSession: sandbox.stub(),
                injectCourseEntry: sandbox.stub(),
                currentState: 'login',
                currentExerciseData: undefined,
                coursesData: { courses: [] },
                archivedCoursesData: undefined,
                userInfo: undefined,
                archiveCheckComplete: true,
            },
            artemisApi: overrides.artemisApi ?? { dummy: true as const },
            websocketService: overrides.websocketService ?? {
                isConnected: sandbox.stub().returns(true),
                connect: sandbox.stub().resolves(),
            },
            courseAccessStorage: overrides.courseAccessStorage ?? {
                onCourseAccessed: sandbox.stub(),
            },
            fullscreenPanelManager: overrides.fullscreenPanelManager ?? {
                openExerciseFullscreen: sandbox.stub(),
                openCourseFullscreen: sandbox.stub(),
                openCourseListFullscreen: sandbox.stub(),
            },
            exerciseOpeningService: overrides.exerciseOpeningService ?? {
                handleExerciseOpened: sandbox.stub(),
            },
            startPageResolver: overrides.startPageResolver ?? {
                resolve: sandbox.stub().resolves({ type: 'dashboard' }),
            },
            courseCatalog: overrides.courseCatalog ?? {
                fetch: sandbox.stub().resolves(),
                upsertSupplemental: sandbox.stub(),
                currentEpoch: 0,
            },
            postMessage: overrides.postMessage ?? sandbox.stub(),
            render: overrides.render ?? sandbox.stub(),
            sendInitData: overrides.sendInitData ?? sandbox.stub(),
            backgroundRenderProblemStatement: overrides.backgroundRenderProblemStatement ?? sandbox.stub(),
            getServerUrl: overrides.getServerUrl ?? sandbox.stub().returns('https://artemis.example/'),
        };

        const deps = {
            appStateManager: stubs.appStateManager,
            artemisApi: stubs.artemisApi,
            websocketService: stubs.websocketService,
            courseAccessStorage: stubs.courseAccessStorage,
            fullscreenPanelManager: stubs.fullscreenPanelManager,
            exerciseOpeningService: stubs.exerciseOpeningService,
            startPageResolver: stubs.startPageResolver,
            courseCatalog: stubs.courseCatalog,
            postMessage: stubs.postMessage,
            render: stubs.render,
            sendInitData: stubs.sendInitData,
            backgroundRenderProblemStatement: stubs.backgroundRenderProblemStatement,
            getServerUrl: stubs.getServerUrl,
        } as unknown as WebviewNavigationFacadeDeps;

        return { deps, stubs };
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as never);
        showInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined as never);
        openTextDocument = sandbox.stub(vscode.workspace, 'openTextDocument').resolves({} as vscode.TextDocument);
        showTextDocument = sandbox.stub(vscode.window, 'showTextDocument').resolves({} as vscode.TextEditor);

        // Default: workspace.getConfiguration returns config with the suggestion
        // feature disabled so _suggestWorkspaceStartPage is a no-op unless a test
        // overrides it.
        getConfiguration = sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: <T>(_key: string, fallback?: T): T | undefined => fallback,
            update: sandbox.stub().resolves(undefined),
        } as unknown as vscode.WorkspaceConfiguration);

        fetchAndEnrichStub = sandbox.stub(exerciseDataLoader, 'fetchAndEnrichExerciseDetails');
        // void marker references so unused-vars rule does not complain
        void showErrorMessage; void showInformationMessage; void getConfiguration;
    });

    teardown(() => {
        sandbox.restore();
    });

    // ── showLogin ──────────────────────────────────────────────────

    test('showLogin: calls appStateManager.showLogin', () => {
        const { deps, stubs } = buildDeps();
        const facade = new WebviewNavigationFacade(deps);

        facade.showLogin();

        sinon.assert.calledOnce(stubs.appStateManager.showLogin);
    });

    test('showLogin: invokes render callback', () => {
        const { deps, stubs } = buildDeps();
        const facade = new WebviewNavigationFacade(deps);

        facade.showLogin();

        sinon.assert.calledOnce(stubs.render);
    });

    test('showLogin: posts SetServerUrl message with getServerUrl value', () => {
        const { deps, stubs } = buildDeps({
            getServerUrl: sandbox.stub().returns('https://artemis.test/'),
        });
        const facade = new WebviewNavigationFacade(deps);

        facade.showLogin();

        sinon.assert.calledWith(stubs.postMessage, sinon.match({
            type: ExtensionMsg.SetServerUrl,
            serverUrl: 'https://artemis.test/',
        }));
    });

    // ── showDashboard ──────────────────────────────────────────────

    test('showDashboard: calls appStateManager.showDashboard, render, sendInitData', async () => {
        const { deps, stubs } = buildDeps();
        const facade = new WebviewNavigationFacade(deps);
        const userInfo = { username: 'alice', serverUrl: 'https://x/' };

        await facade.showDashboard(userInfo);
        // wait for the background archive-check chain to settle
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        sinon.assert.calledWith(stubs.appStateManager.showDashboard, userInfo);
        sinon.assert.called(stubs.render);
        sinon.assert.called(stubs.sendInitData);
    });

    test('showDashboard: logs but does not crash when suggestion helper throws', async () => {
        // Force the suggestion path to throw by making getConfiguration throw.
        getConfiguration.throws(new Error('config blew up'));
        const { deps } = buildDeps();
        const facade = new WebviewNavigationFacade(deps);
        const userInfo = { username: 'alice', serverUrl: 'https://x/' };

        await facade.showDashboard(userInfo);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // No user-facing error message is shown for the suggestion path.
        sinon.assert.notCalled(showErrorMessage);
    });

    // ── navigateToStartPage ────────────────────────────────────────

    test('navigateToStartPage: dashboard branch routes to showDashboard', async () => {
        const { deps, stubs } = buildDeps({
            startPageResolver: { resolve: sandbox.stub().resolves({ type: 'dashboard' }) },
        });
        const facade = new WebviewNavigationFacade(deps);
        const userInfo = { username: 'bob', serverUrl: 'https://x/' };

        await facade.navigateToStartPage(userInfo);
        await Promise.resolve();
        await Promise.resolve();

        sinon.assert.calledWith(stubs.appStateManager.showDashboard, userInfo);
    });

    test('navigateToStartPage: course-list branch seeds session and shows course list', async () => {
        const coursesData = { courses: [{ course: { id: 1 } }] };
        const { deps, stubs } = buildDeps({
            startPageResolver: {
                resolve: sandbox.stub().resolves({ type: 'course-list', coursesData }),
            },
        });
        const facade = new WebviewNavigationFacade(deps);
        const userInfo = { username: 'cathy', serverUrl: 'https://x/' };

        await facade.navigateToStartPage(userInfo);

        sinon.assert.calledWith(stubs.appStateManager.seedAuthenticatedSession, userInfo);
        sinon.assert.called(stubs.appStateManager.showCourseList);
    });

    test('navigateToStartPage: workspace-exercise branch opens exercise details', async () => {
        const courseEntry = { course: { id: 5, title: 'C' } };
        const coursesData = { courses: [courseEntry] };
        const exerciseData: ExerciseDetailsResponse = {
            exercise: { id: 42, title: 'Ex' } as ExerciseDetailsResponse['exercise'],
        } as ExerciseDetailsResponse;
        fetchAndEnrichStub.resolves(exerciseData);

        const appStateOverride = {
            showLogin: sandbox.stub(),
            showDashboard: sandbox.stub(),
            showCourseList: sandbox.stub(),
            showCourseDetail: sandbox.stub(),
            showExerciseDetail: sandbox.stub(),
            showAiConfig: sandbox.stub(),
            showServiceStatus: sandbox.stub(),
            showStruggleDetection: sandbox.stub(),
            showRecommendedExtensions: sandbox.stub(),
            showGitCredentials: sandbox.stub(),
            seedAuthenticatedSession: sandbox.stub(),
            injectCourseEntry: sandbox.stub(),
            currentState: 'exercise-detail',
            currentExerciseData: exerciseData,
            coursesData,
            archivedCoursesData: undefined,
            userInfo: undefined,
            archiveCheckComplete: true,
        };
        const { deps, stubs } = buildDeps({
            appStateManager: appStateOverride,
            startPageResolver: {
                resolve: sandbox.stub().resolves({
                    type: 'workspace-exercise',
                    courseId: 5,
                    exerciseId: 42,
                    coursesData,
                    allCourses: [courseEntry],
                }),
            },
        });
        const facade = new WebviewNavigationFacade(deps);
        const userInfo = { username: 'dan', serverUrl: 'https://x/' };

        await facade.navigateToStartPage(userInfo);

        sinon.assert.called(fetchAndEnrichStub);
        sinon.assert.calledWith(fetchAndEnrichStub, deps.artemisApi, 42);
        sinon.assert.calledWith(stubs.appStateManager.showExerciseDetail, exerciseData);
    });

    // ── openExerciseDetails ────────────────────────────────────────

    test('openExerciseDetails: happy path calls fetch, render, websocket connect, exerciseOpeningService', async () => {
        const exerciseData: ExerciseDetailsResponse = {
            exercise: { id: 7, title: 'Ex' } as ExerciseDetailsResponse['exercise'],
        } as ExerciseDetailsResponse;
        fetchAndEnrichStub.resolves(exerciseData);

        const appStateOverride = {
            showLogin: sandbox.stub(),
            showDashboard: sandbox.stub(),
            showCourseList: sandbox.stub(),
            showCourseDetail: sandbox.stub(),
            showExerciseDetail: sandbox.stub(),
            showAiConfig: sandbox.stub(),
            showServiceStatus: sandbox.stub(),
            showStruggleDetection: sandbox.stub(),
            showRecommendedExtensions: sandbox.stub(),
            showGitCredentials: sandbox.stub(),
            seedAuthenticatedSession: sandbox.stub(),
            injectCourseEntry: sandbox.stub(),
            currentState: 'exercise-detail',
            currentExerciseData: exerciseData,
            coursesData: undefined,
            archivedCoursesData: undefined,
            userInfo: undefined,
            archiveCheckComplete: true,
        };

        const ws = {
            isConnected: sandbox.stub().returns(false),
            connect: sandbox.stub().resolves(),
        };

        const { deps, stubs } = buildDeps({
            appStateManager: appStateOverride,
            websocketService: ws,
        });
        const facade = new WebviewNavigationFacade(deps);

        await facade.openExerciseDetails(7);

        sinon.assert.calledWith(fetchAndEnrichStub, deps.artemisApi, 7);
        sinon.assert.calledWith(stubs.appStateManager.showExerciseDetail, exerciseData);
        sinon.assert.called(stubs.render);
        sinon.assert.called(stubs.backgroundRenderProblemStatement);
        sinon.assert.calledOnce(ws.connect);
        sinon.assert.calledWith(stubs.exerciseOpeningService.handleExerciseOpened, exerciseData, 7, 0);
    });

    // Same contract as `CommandContext.sessionEpoch`: captured before the
    // await, never after. Read after the fetch and an identity change during
    // it would hand the previous session's exercise the new session's
    // generation, which is the one write the catalog's guard cannot reject.
    test('openExerciseDetails: stamps the catalog write with the epoch from before the fetch', async () => {
        const exerciseData: ExerciseDetailsResponse = {
            exercise: { id: 7, title: 'Ex' } as ExerciseDetailsResponse['exercise'],
        } as ExerciseDetailsResponse;

        const catalog = {
            fetch: sandbox.stub().resolves(),
            upsertSupplemental: sandbox.stub(),
            currentEpoch: 3,
        };
        fetchAndEnrichStub.callsFake(async () => {
            // The identity changes while the exercise request is open.
            catalog.currentEpoch = 4;
            return exerciseData;
        });

        const { deps, stubs } = buildDeps({
            appStateManager: {
                showLogin: sandbox.stub(),
                showDashboard: sandbox.stub(),
                showCourseList: sandbox.stub(),
                showCourseDetail: sandbox.stub(),
                showExerciseDetail: sandbox.stub(),
                showAiConfig: sandbox.stub(),
                showServiceStatus: sandbox.stub(),
                showStruggleDetection: sandbox.stub(),
                showRecommendedExtensions: sandbox.stub(),
                showGitCredentials: sandbox.stub(),
                seedAuthenticatedSession: sandbox.stub(),
                injectCourseEntry: sandbox.stub(),
                currentState: 'exercise-detail',
                currentExerciseData: exerciseData,
                coursesData: undefined,
                archivedCoursesData: undefined,
                userInfo: undefined,
                archiveCheckComplete: true,
            },
            courseCatalog: catalog,
        });
        const facade = new WebviewNavigationFacade(deps);

        await facade.openExerciseDetails(7);

        sinon.assert.calledWith(stubs.exerciseOpeningService.handleExerciseOpened, exerciseData, 7, 3);
    });

    test('navigateToStartPage: stamps the workspace course with the epoch from before the resolve', async () => {
        const catalog = {
            fetch: sandbox.stub().resolves(),
            upsertSupplemental: sandbox.stub(),
            currentEpoch: 8,
        };
        const { deps, stubs } = buildDeps({
            courseCatalog: catalog,
            startPageResolver: {
                resolve: sandbox.stub().callsFake(async () => {
                    // The identity changes while the dashboard request is open.
                    catalog.currentEpoch = 9;
                    return {
                        type: 'workspace-course',
                        courseId: 3,
                        allCourses: [{ course: { id: 3, title: 'Algorithms' } }],
                    };
                }),
            },
        });
        const facade = new WebviewNavigationFacade(deps);

        await facade.navigateToStartPage({ username: 'dan', serverUrl: 'https://x/' });

        sinon.assert.calledOnce(stubs.courseCatalog.upsertSupplemental);
        assert.strictEqual(
            stubs.courseCatalog.upsertSupplemental.firstCall.args[1], 8,
            'the courses were fetched by the previous session, so they carry its generation',
        );
        // The persisted recency history is gated on the same value, so the two
        // writes cannot disagree about which account this navigation belongs to.
        sinon.assert.calledOnceWithExactly(stubs.courseAccessStorage.onCourseAccessed, 3, 8);
    });

    // The archive search issues one detail request per archived course, so it
    // is the producer most likely to still be open when the identity changes.
    // Reading the epoch in `injectEntry` itself would compare it to itself and
    // let the previous account's course into the new session.
    test('showDashboard: injects the archived course with the epoch from before the search', async () => {
        const catalog = {
            fetch: sandbox.stub().resolves(),
            upsertSupplemental: sandbox.stub(),
            currentEpoch: 2,
        };
        sandbox.stub(detectionModule, 'findWorkspaceCourseInArchive').callsFake(async () => {
            // The student logs out (or the server URL changes) while the
            // per-course archive probes are still running.
            catalog.currentEpoch = 3;
            return { course: { id: 77, title: 'Archived' } };
        });
        const { deps, stubs } = buildDeps({ courseCatalog: catalog });
        const facade = new WebviewNavigationFacade(deps);

        await facade.showDashboard({ username: 'dan', serverUrl: 'https://x/' });
        await flushBackgroundWork();

        sinon.assert.calledOnce(stubs.appStateManager.injectCourseEntry);
        assert.strictEqual(
            stubs.appStateManager.injectCourseEntry.firstCall.args[1], 2,
            'the archived course belongs to the session that searched for it',
        );
    });

    test('openExerciseDetails: surfaces error message when API throws', async () => {
        fetchAndEnrichStub.rejects(new Error('boom'));
        const { deps, stubs } = buildDeps();
        const facade = new WebviewNavigationFacade(deps);

        await facade.openExerciseDetails(7);

        sinon.assert.calledOnce(showErrorMessage);
        sinon.assert.notCalled(stubs.appStateManager.showExerciseDetail);
    });

    // ── showCourseList ─────────────────────────────────────────────

    test('showCourseList: with courseCatalog, fetches and renders', async () => {
        const { deps, stubs } = buildDeps();
        const facade = new WebviewNavigationFacade(deps);

        await facade.showCourseList();

        sinon.assert.calledOnce(stubs.courseCatalog.fetch);
        sinon.assert.calledOnce(stubs.appStateManager.showCourseList);
        sinon.assert.called(stubs.render);
    });

    test('showCourseList: tolerates missing courseCatalog', async () => {
        const { deps, stubs } = buildDeps();
        // Replicate the optional-dep scenario: remove courseCatalog after build.
        (deps as { courseCatalog?: unknown }).courseCatalog = undefined;
        const facade = new WebviewNavigationFacade(deps);

        await facade.showCourseList();

        sinon.assert.calledOnce(stubs.appStateManager.showCourseList);
    });

    // ── Simple delegating methods ──────────────────────────────────

    test('showAiConfig: delegates to appStateManager.showAiConfig and renders', () => {
        const { deps, stubs } = buildDeps();
        const facade = new WebviewNavigationFacade(deps);

        facade.showAiConfig();

        sinon.assert.calledOnce(stubs.appStateManager.showAiConfig);
        sinon.assert.called(stubs.render);
    });

    test('showServiceStatus: delegates to appStateManager.showServiceStatus and renders', () => {
        const { deps, stubs } = buildDeps();
        const facade = new WebviewNavigationFacade(deps);

        facade.showServiceStatus();

        sinon.assert.calledOnce(stubs.appStateManager.showServiceStatus);
        sinon.assert.called(stubs.render);
    });

    test('showStruggleDetection: delegates and renders', () => {
        const { deps, stubs } = buildDeps();
        const facade = new WebviewNavigationFacade(deps);

        facade.showStruggleDetection();

        sinon.assert.calledOnce(stubs.appStateManager.showStruggleDetection);
        sinon.assert.called(stubs.render);
    });

    test('showRecommendedExtensions: delegates and renders', () => {
        const { deps, stubs } = buildDeps();
        const facade = new WebviewNavigationFacade(deps);

        facade.showRecommendedExtensions();

        sinon.assert.calledOnce(stubs.appStateManager.showRecommendedExtensions);
        sinon.assert.called(stubs.render);
    });

    test('showGitCredentials: delegates and renders', () => {
        const { deps, stubs } = buildDeps();
        const facade = new WebviewNavigationFacade(deps);

        facade.showGitCredentials();

        sinon.assert.calledOnce(stubs.appStateManager.showGitCredentials);
        sinon.assert.called(stubs.render);
    });

    // ── showCourseDetail ───────────────────────────────────────────

    test('showCourseDetail: stores state, writes the catalog, renders', () => {
        const { deps, stubs } = buildDeps({
            // Deliberately different from the epoch passed in below: the
            // caller's captured value wins, and a live read here would not.
            courseCatalog: { fetch: sandbox.stub(), upsertSupplemental: sandbox.stub(), currentEpoch: 99 },
        });
        const facade = new WebviewNavigationFacade(deps);
        const courseData = { course: { id: 9, title: 'Algorithms' } } as Parameters<WebviewNavigationFacade['showCourseDetail']>[0];

        facade.showCourseDetail(courseData, 5);

        sinon.assert.calledWith(stubs.appStateManager.showCourseDetail, courseData);
        sinon.assert.calledWith(
            stubs.courseCatalog.upsertSupplemental,
            sinon.match({ kind: 'course', entry: { course: courseData.course } }),
            5,
        );
        sinon.assert.called(stubs.render);
    });

    test('showCourseDetail: tolerates a missing courseCatalog', () => {
        const { deps, stubs } = buildDeps();
        (deps as { courseCatalog?: unknown }).courseCatalog = undefined;
        const facade = new WebviewNavigationFacade(deps);
        const courseData = { course: { id: 9, title: 'Algorithms' } } as Parameters<WebviewNavigationFacade['showCourseDetail']>[0];

        assert.doesNotThrow(() => facade.showCourseDetail(courseData, 0));
        sinon.assert.called(stubs.render);
    });

    // ── Fullscreen delegations ─────────────────────────────────────

    test('openExerciseFullscreen: delegates to fullscreenPanelManager', async () => {
        const { deps, stubs } = buildDeps();
        const facade = new WebviewNavigationFacade(deps);
        const ex = { exercise: { id: 1 } } as ExerciseDetailsResponse;

        await facade.openExerciseFullscreen(ex);

        sinon.assert.calledWith(stubs.fullscreenPanelManager.openExerciseFullscreen, ex);
    });

    test('openCourseFullscreen: delegates to fullscreenPanelManager', async () => {
        const { deps, stubs } = buildDeps();
        const facade = new WebviewNavigationFacade(deps);
        const c = { course: { id: 1, title: 'C' } } as Parameters<WebviewNavigationFacade['openCourseFullscreen']>[0];

        await facade.openCourseFullscreen(c);

        sinon.assert.calledWith(stubs.fullscreenPanelManager.openCourseFullscreen, c);
    });

    test('openCourseListFullscreen: delegates to fullscreenPanelManager with mapped courses', async () => {
        const appStateOverride = {
            showLogin: sandbox.stub(),
            showDashboard: sandbox.stub(),
            showCourseList: sandbox.stub(),
            showCourseDetail: sandbox.stub(),
            showExerciseDetail: sandbox.stub(),
            showAiConfig: sandbox.stub(),
            showServiceStatus: sandbox.stub(),
            showStruggleDetection: sandbox.stub(),
            showRecommendedExtensions: sandbox.stub(),
            showGitCredentials: sandbox.stub(),
            seedAuthenticatedSession: sandbox.stub(),
            injectCourseEntry: sandbox.stub(),
            currentState: 'course-list',
            currentExerciseData: undefined,
            coursesData: { courses: [{ course: { id: 1, title: 'C' } }] },
            archivedCoursesData: undefined,
            userInfo: undefined,
            archiveCheckComplete: true,
        };

        const { deps, stubs } = buildDeps({ appStateManager: appStateOverride });
        const facade = new WebviewNavigationFacade(deps);

        await facade.openCourseListFullscreen();

        sinon.assert.calledOnce(stubs.fullscreenPanelManager.openCourseListFullscreen);
    });

    // ── openJsonInEditor ───────────────────────────────────────────

    test('openJsonInEditor: opens JSON document and shows it', async () => {
        const { deps } = buildDeps();
        const facade = new WebviewNavigationFacade(deps);

        await facade.openJsonInEditor({ foo: 'bar' });

        sinon.assert.calledOnce(openTextDocument);
        sinon.assert.calledOnce(showTextDocument);
    });

    // ── render / sendInitData wiring ───────────────────────────────

    test('render / sendInitData / backgroundRenderProblemStatement forward to deps callbacks', () => {
        const { deps, stubs } = buildDeps();
        const facade = new WebviewNavigationFacade(deps);

        facade.render();
        facade.sendInitData();
        facade.backgroundRenderProblemStatement();

        sinon.assert.calledOnce(stubs.render);
        sinon.assert.calledOnce(stubs.sendInitData);
        sinon.assert.calledOnce(stubs.backgroundRenderProblemStatement);
    });

    // ── hideLoadingAndSendServerUrl (used by AuthFlowHandler) ──────

    test('hideLoadingAndSendServerUrl: posts HideLoading then SetServerUrl', () => {
        const { deps, stubs } = buildDeps({
            getServerUrl: sandbox.stub().returns('https://srv/'),
        });
        const facade = new WebviewNavigationFacade(deps);

        facade.hideLoadingAndSendServerUrl();

        // Two messages: HideLoading first, then SetServerUrl.
        assert.strictEqual(stubs.postMessage.callCount, 2);
        sinon.assert.calledWith(stubs.postMessage.firstCall, sinon.match({ type: ExtensionMsg.HideLoading }));
        sinon.assert.calledWith(stubs.postMessage.secondCall, sinon.match({
            type: ExtensionMsg.SetServerUrl,
            serverUrl: 'https://srv/',
        }));
    });
});
