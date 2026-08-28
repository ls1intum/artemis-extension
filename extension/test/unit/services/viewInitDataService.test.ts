import * as assert from 'assert';
import * as sinon from 'sinon';

import type { ExtensionToWebviewMessage } from '@shared/messageContracts';

import { AppStateManager } from '@extension/controller/appStateManager';
import { ViewInitDataService } from '@extension/services/ui/viewInitDataService';
import * as workspaceDetection from '@extension/services/workspace/workspaceDetectionService';
import type { ExerciseDetailsResponse } from '@extension/types';

type Posted = ExtensionToWebviewMessage | undefined;

function buildService(coursesData: { courses: Array<{ course: { id?: number; title?: string; exercises?: unknown[] } }> }) {
    let posted: Posted = undefined;
    const appState = {
        coursesData,
        archiveCheckComplete: true,
        archivedCoursesData: undefined,
        currentCourseData: undefined,
        currentState: 'dashboard',
    } as never;
    const messageHandler = { clearRepositoryContext: () => undefined } as never;
    const courseAccessStorage = { getLastAccessedCourses: () => [] } as never;
    const service = new ViewInitDataService(
        appState,
        undefined,
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
});


suite('ViewInitDataService.sendExerciseDetailInit', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => { sandbox = sinon.createSandbox(); });
    teardown(() => sandbox.restore());

    /** A service whose app state really holds the exercise, because the arbitration compares it. */
    function buildExerciseService() {
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
            { setRepositoryContext, clearRepositoryContext } as never,
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
        let resolveDetection!: (v: unknown) => void;
        sandbox.stub(workspaceDetection, 'detectWorkspaceForRepoUris')
            .returns(new Promise(r => { resolveDetection = r; }) as never);

        service.sendExerciseDetailInit();
        // A second init advances the generation while the first detection is still in flight.
        service.sendInitData();
        resolveDetection({ isConnected: true, hasChanges: false, isPracticeRepo: true, matchedUri: 'https://a/repo.git' });
        await new Promise(r => setImmediate(r));

        assert.strictEqual(appState.workspaceIsPractice, true);
        assert.strictEqual(exerciseInits(posted).length, 1,
            'the superseded init must not post its captured payload a second time');
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
        resolveDetection({ isConnected: true, hasChanges: false, isPracticeRepo: true, matchedUri: 'https://a/repo.git' });
        await new Promise(r => setImmediate(r));

        const inits = exerciseInits(posted);
        assert.strictEqual(inits.length, 1);
        assert.strictEqual(inits[0].repoStatus, undefined,
            'saying nothing is not the same as saying graded; the webview keeps what it has');
        sinon.assert.notCalled(setRepositoryContext);
        assert.strictEqual(appState.workspaceIsPractice, false);
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
