import * as assert from 'assert';
import * as sinon from 'sinon';

import type { ExtensionToWebviewMessage } from '@shared/messageContracts';

import type { ArtemisApiService } from '@extension/api';
import { AppStateManager } from '@extension/controller/appStateManager';
import { CourseCatalog } from '@extension/services/courseCatalog';
import { ViewInitDataService } from '@extension/services/ui/viewInitDataService';
import * as workspaceDetection from '@extension/services/workspace/workspaceDetectionService';
import type { ExerciseDetailsResponse } from '@extension/types';

type Posted = ExtensionToWebviewMessage | undefined;

function buildService(coursesData: { courses: Array<{ course: { id?: number; title?: string; exercises?: unknown[] } }> }, coordinator?: unknown, coursesUnavailable = false) {
    let posted: Posted = undefined;
    const appState = {
        coursesData,
        coursesUnavailable,
        archiveCheckComplete: true,
        archivedCoursesData: undefined,
        currentCourseData: undefined,
        currentState: 'dashboard',
    } as never;
    const messageHandler = { clearRepositoryContext: () => undefined } as never;
    const courseAccessStorage = { getLastAccessedCourses: () => [] } as never;
    const service = new ViewInitDataService(
        appState,
        coordinator as never,
        messageHandler,
        (msg: ExtensionToWebviewMessage) => { posted = msg; },
        courseAccessStorage,
    );
    return { service, getPosted: () => posted };
}

suite('ViewInitDataService.sendDashboardInit', () => {
    // Courses without a numeric id are filtered upstream by selectRecentCourses,
    // so the coverage for the mapper's null return lives in the
    // toCourseDetailData suite. This test pins the end-to-end behavior: no id=0
    // sentinel reaches the emitted payload.
    test('emits no id=0 entries (id-less courses dropped upstream + mapper)', () => {
        const { service, getPosted } = buildService({
            courses: [
                { course: { title: 'no-id' } },
                { course: { id: 5, title: 'with-id' } },
            ],
        });
        service.sendDashboardInit();
        const posted = getPosted();
        assert.ok(posted, 'dashboard init must post a message');
        assert.strictEqual(posted.type, 'dashboardInit');
        const ids = (posted as { courses: Array<{ courseData: { course: { id: number } } }> })
            .courses.map(n => n.courseData.course.id);
        assert.deepStrictEqual(ids, [5], 'invalid courses must be dropped, not emitted with id=0');
    });

    test('emits RecentCourseNode[] whose courseData uses CourseDetailData', () => {
        const { service, getPosted } = buildService({
            courses: [{ course: { id: 7, title: 'X' } }],
        });
        service.sendDashboardInit();
        const posted = getPosted();
        assert.ok(posted);
        const first = (posted as { courses: Array<{ courseData: { course: { id: number; title: string } } }> }).courses[0];
        assert.strictEqual(first.courseData.course.id, 7);
        assert.strictEqual(first.courseData.course.title, 'X');
    });

    test('carries hideDeveloperTools (true since developer mode is off in the test host)', () => {
        const { service, getPosted } = buildService({
            courses: [{ course: { id: 7, title: 'X' } }],
        });
        service.sendDashboardInit();
        const posted = getPosted();
        assert.ok(posted);
        assert.strictEqual(posted.type, 'dashboardInit');
        assert.strictEqual((posted as { hideDeveloperTools: boolean }).hideDeveloperTools, true);
    });

    test('carries whether the course list is a real answer', () => {
        const { service, getPosted } = buildService({ courses: [] }, undefined, true);
        service.sendDashboardInit();
        assert.strictEqual((getPosted() as { coursesUnavailable: boolean }).coursesUnavailable, true);
    });
});

// "Not enrolled" may only follow a successful dashboard response with zero
// courses; every other empty list is "no answer".
suite('AppStateManager.coursesUnavailable', () => {
    function managerWith(catalog: CourseCatalog): AppStateManager {
        const manager = new AppStateManager();
        manager.setCourseCatalog(catalog);
        return manager;
    }

    test('no dashboard answer yet is unavailable', () => {
        assert.strictEqual(managerWith(new CourseCatalog({} as ArtemisApiService)).coursesUnavailable, true);
    });

    test('a catalog holding only a partial supplemental record is unavailable', () => {
        const catalog = new CourseCatalog({} as ArtemisApiService);
        catalog.upsertSupplemental({ kind: 'partial-course', id: 1, title: 'Opened alone' }, 0);
        assert.strictEqual(managerWith(catalog).coursesUnavailable, true);
    });

    test('a loaded empty list is a real answer', async () => {
        const catalog = new CourseCatalog({ getCoursesForDashboard: async () => ({ courses: [] }) } as unknown as ArtemisApiService);
        await catalog.fetch();
        assert.strictEqual(managerWith(catalog).coursesUnavailable, false);
    });

    test('a failed request is unavailable', async () => {
        const catalog = new CourseCatalog({ getCoursesForDashboard: async () => { throw new Error('offline'); } } as unknown as ArtemisApiService);
        await catalog.fetch();
        assert.strictEqual(managerWith(catalog).coursesUnavailable, true);
    });
});

suite('ViewInitDataService.buildStruggleDetectionInit', () => {
    test('returns safe defaults without a coordinator (debug omitted, not embedded)', () => {
        const { service } = buildService({ courses: [] });
        const msg = service.buildStruggleDetectionInit() as Record<string, unknown>;
        assert.strictEqual(msg.type, 'struggleDetectionInit');
        assert.strictEqual(msg.isEnabled, false);
        assert.strictEqual(msg.developerMode, false, 'developer mode is off in the test host');
        assert.strictEqual(msg.debug, undefined, 'debug snapshot is omitted outside developer mode');
        assert.strictEqual(msg.embedded, false);
    });

    test('marks the embedded editor-tab copy', () => {
        const { service } = buildService({ courses: [] });
        const msg = service.buildStruggleDetectionInit({ embedded: true }) as Record<string, unknown>;
        assert.strictEqual(msg.embedded, true);
    });

    test('isEnabled is sourced from the coordinator consent state (#352)', () => {
        const coordinator = {
            isConsentGranted: () => true,
            getSnapshot: () => ({}),
            getDebugSnapshot: () => undefined,
        };
        const { service } = buildService({ courses: [] }, coordinator);
        const msg = service.buildStruggleDetectionInit() as Record<string, unknown>;
        assert.strictEqual(msg.isEnabled, true, 'granted consent surfaces as isEnabled');
    });
});

suite('ViewInitDataService.sendCourseListInit', () => {
    test('drops courses without numeric id', () => {
        const { service, getPosted } = buildService({
            courses: [
                { course: { title: 'no-id' } },
                { course: { id: 1, title: 'A' } },
                { course: { title: 'no-id-2' } },
            ],
        });
        service.sendCourseListInit();
        const posted = getPosted();
        assert.ok(posted);
        assert.strictEqual(posted.type, 'courseListInit');
        const ids = (posted as { courses: Array<{ course: { id: number } }> })
            .courses.map(c => c.course.id);
        assert.deepStrictEqual(ids, [1], 'invalid courses must be dropped');
    });

    for (const coursesUnavailable of [true, false]) {
        test(`carries coursesUnavailable=${coursesUnavailable}, so an empty list can say why`, () => {
            const { service, getPosted } = buildService({ courses: [] }, undefined, coursesUnavailable);
            service.sendCourseListInit();
            assert.strictEqual((getPosted() as { coursesUnavailable: boolean }).coursesUnavailable, coursesUnavailable);
        });
    }
});


suite('ViewInitDataService.sendExerciseDetailInit', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => { sandbox = sinon.createSandbox(); });
    teardown(() => sandbox.restore());

    /** A service whose app state really holds the exercise, because the arbitration compares it. */
    function buildExerciseService(localClones?: { hasCloneOfDisplayedParticipation: sinon.SinonStub }) {
        const posted: ExtensionToWebviewMessage[] = [];
        const appState = new AppStateManager();
        appState.showCourseDetail({ course: { id: 1, title: 'Course' } });
        appState.showExerciseDetail({
            exercise: {
                id: 42,
                title: 'Exercise',
                studentParticipations: [{ id: 7, repositoryUri: 'https://a/repo.git' }],
            },
        } as unknown as ExerciseDetailsResponse);

        const setRepositoryContext = sandbox.stub();
        const clearRepositoryContext = sandbox.stub();
        const service = new ViewInitDataService(
            appState as never,
            undefined,
            { setRepositoryContext, clearRepositoryContext, localClones } as never,
            (msg: ExtensionToWebviewMessage) => { posted.push(msg); },
            { getLastAccessedCourses: () => [] } as never,
        );
        return { service, appState, posted, setRepositoryContext, clearRepositoryContext };
    }

    function exerciseInits(posted: ExtensionToWebviewMessage[]) {
        return posted.filter(m => m.type === 'exerciseDetailInit') as Array<{ repoStatus?: unknown }>;
    }

    test('records what the detection found even when its own init has been superseded', async () => {
        // The record must not sit behind the generation check. A superseded init would otherwise
        // throw away a detection nothing is going to repeat, and the mode would stay unknown.
        const { service, appState, posted } = buildExerciseService();
        let resolveFirst!: (v: unknown) => void;
        const detect = sandbox.stub(workspaceDetection, 'detectWorkspaceForRepoUris');
        detect.onFirstCall().returns(new Promise(r => { resolveFirst = r; }) as never);
        // The newer init's own detection fails, so it records nothing. Only the older one can, and
        // it can only do so from in front of the generation check.
        detect.onSecondCall().rejects(new Error('git unavailable'));

        service.sendExerciseDetailInit();
        service.sendInitData();
        await new Promise(r => setImmediate(r));
        resolveFirst({ isConnected: true, hasChanges: false, hasUnpushedCommits: false, isPracticeRepo: true, matchedUri: 'https://a/repo.git' });
        await new Promise(r => setImmediate(r));

        assert.strictEqual(appState.workspaceIsPractice, true);
        // And the webview is told, through the other channel, since this init's payload is stale.
        assert.ok(posted.some(m => m.type === 'updateRepoStatus'),
            'a mode the host accepted has to reach the webview or the two will select differently');
    });

    test('a superseded detection still posts the exercise snapshot, without a status', async () => {
        // ExerciseDetailInit is the only message carrying exercise data, and a recreated view whose
        // queue was reset would sit on a skeleton forever without it.
        const { service, appState, posted, setRepositoryContext } = buildExerciseService();
        let resolveDetection!: (v: unknown) => void;
        sandbox.stub(workspaceDetection, 'detectWorkspaceForRepoUris')
            .returns(new Promise(r => { resolveDetection = r; }) as never);

        service.sendExerciseDetailInit();
        // A probe started after this init reports while its detection is still running, so the
        // init's own answer is stale by the time it lands.
        appState.recordWorkspaceMode(appState.beginWorkspaceModeProbe(), 42, false);
        resolveDetection({ isConnected: true, hasChanges: false, hasUnpushedCommits: false, isPracticeRepo: true, matchedUri: 'https://a/repo.git' });
        await new Promise(r => setImmediate(r));

        const inits = exerciseInits(posted);
        assert.strictEqual(inits.length, 1);
        assert.strictEqual(inits[0].repoStatus, undefined,
            'saying nothing is not the same as saying graded; the webview keeps what it has');
        sinon.assert.notCalled(setRepositoryContext);
        assert.strictEqual(appState.workspaceIsPractice, false);
    });

    test('a disconnected init says whether the displayed participation has a local clone', async () => {
        const hasCloneOfDisplayedParticipation = sandbox.stub().resolves(true);
        const { service, posted } = buildExerciseService({ hasCloneOfDisplayedParticipation });
        sandbox.stub(workspaceDetection, 'detectWorkspaceForRepoUris')
            .resolves({ isConnected: false, hasChanges: false, hasUnpushedCommits: false, isPracticeRepo: false });

        service.sendExerciseDetailInit();
        await new Promise(r => setImmediate(r));

        assert.deepStrictEqual(hasCloneOfDisplayedParticipation.firstCall.args[0], [{ id: 7, repositoryUri: 'https://a/repo.git' }]);
        assert.deepStrictEqual(exerciseInits(posted)[0].repoStatus,
            { isConnected: false, hasChanges: false, hasUnpushedCommits: false, isPracticeRepo: false, hasLocalClone: true });
    });

    test('a connected init does not look for a local clone', async () => {
        const hasCloneOfDisplayedParticipation = sandbox.stub().resolves(true);
        const { service, posted } = buildExerciseService({ hasCloneOfDisplayedParticipation });
        sandbox.stub(workspaceDetection, 'detectWorkspaceForRepoUris')
            .resolves({ isConnected: true, hasChanges: false, hasUnpushedCommits: false, isPracticeRepo: false, matchedUri: 'https://a/repo.git' });

        service.sendExerciseDetailInit();
        await new Promise(r => setImmediate(r));

        sinon.assert.notCalled(hasCloneOfDisplayedParticipation);
        assert.deepStrictEqual(exerciseInits(posted)[0].repoStatus,
            { isConnected: true, hasChanges: false, hasUnpushedCommits: false, isPracticeRepo: false, hasLocalClone: false });
    });

    test('carries commits a failed push left behind in the init', async () => {
        const { service, posted } = buildExerciseService();
        sandbox.stub(workspaceDetection, 'detectWorkspaceForRepoUris')
            .resolves({ isConnected: true, hasChanges: false, hasUnpushedCommits: true, isPracticeRepo: false, matchedUri: 'https://a/repo.git' });

        service.sendExerciseDetailInit();
        await new Promise(r => setImmediate(r));

        assert.deepStrictEqual(exerciseInits(posted)[0].repoStatus,
            { isConnected: true, hasChanges: false, hasUnpushedCommits: true, isPracticeRepo: false, hasLocalClone: false });
    });

    test('carries them in the status post of a superseded init too', async () => {
        const { service, posted } = buildExerciseService();
        let resolveDetection!: (v: unknown) => void;
        sandbox.stub(workspaceDetection, 'detectWorkspaceForRepoUris')
            .returns(new Promise(r => { resolveDetection = r; }) as never);

        service.sendExerciseDetailInit();
        service.sendInitData();
        await new Promise(r => setImmediate(r));
        resolveDetection({ isConnected: true, hasChanges: false, hasUnpushedCommits: true, isPracticeRepo: false, matchedUri: 'https://a/repo.git' });
        await new Promise(r => setImmediate(r));

        const update = posted.find(m => m.type === 'updateRepoStatus') as { hasUnpushedCommits?: boolean } | undefined;
        assert.strictEqual(update?.hasUnpushedCommits, true);
    });

    test('a detection that threw erases nothing', async () => {
        const { service, posted, clearRepositoryContext } = buildExerciseService();
        sandbox.stub(workspaceDetection, 'detectWorkspaceForRepoUris').rejects(new Error('git unavailable'));

        service.sendExerciseDetailInit();
        await new Promise(r => setImmediate(r));

        assert.strictEqual(exerciseInits(posted).length, 1, 'the base snapshot still goes out');
        sinon.assert.notCalled(clearRepositoryContext);
    });
});
