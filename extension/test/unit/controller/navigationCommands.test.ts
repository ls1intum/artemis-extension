import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { WebCmd } from '@shared/messageContracts';

import { NavigationCommandModule } from '@extension/controller/commands/navigationCommands';
import type { CommandContext } from '@extension/controller/commands/types';
import * as exerciseDataLoader from '@extension/controller/exerciseDataLoader';

suite('handleViewCourseDetails resolver', () => {
    let sandbox: sinon.SinonSandbox;
    let showErrorMessage: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as never);
    });

    teardown(() => {
        sandbox.restore();
    });

    function buildContext(overrides: {
        coursesData?: { courses: Array<{ course: { id: number; title?: string } }> };
        getCourseForDashboard?: sinon.SinonStub;
        showCourseDetail?: sinon.SinonStub;
        courseCatalog?: { upsertSupplemental: sinon.SinonStub };
        courseAccessStorage?: { onCourseAccessed: sinon.SinonStub };
        sessionEpoch?: () => number;
    }): CommandContext {
        return {
            appStateManager: {
                coursesData: overrides.coursesData,
                showCourseDetail: overrides.showCourseDetail ?? sandbox.stub(),
            },
            artemisApi: {
                getCourseForDashboard: overrides.getCourseForDashboard
                    ?? sandbox.stub().resolves({ course: undefined }),
            },
            actionHandler: { render: sandbox.stub() },
            courseAccessStorage: overrides.courseAccessStorage ?? { onCourseAccessed: sandbox.stub() },
            providerRegistry: { getChatWebviewProvider: () => undefined },
            courseCatalog: overrides.courseCatalog ?? { upsertSupplemental: sandbox.stub() },
            sessionEpoch: overrides.sessionEpoch ?? (() => 0),
        } as unknown as CommandContext;
    }

    test('uses cache when course is present', async () => {
        const showCourseDetail = sandbox.stub();
        const getCourseForDashboard = sandbox.stub().resolves({ course: { id: 7, title: 'fetched' } });
        const ctx = buildContext({
            coursesData: { courses: [{ course: { id: 7, title: 'cached' } }] },
            getCourseForDashboard,
            showCourseDetail,
        });
        const mod = new NavigationCommandModule(ctx);

        await mod.getHandlers().viewCourseDetails({
            type: 'command',
            command: 'viewCourseDetails',
            payload: { courseId: 7 },
        } satisfies WebCmd<'viewCourseDetails'>);

        assert.strictEqual(getCourseForDashboard.callCount, 0, 'API must not be called on cache hit');
        assert.strictEqual(showCourseDetail.callCount, 1, 'showCourseDetail must be called on cache hit');
    });

    test('records the viewed course in the catalog, stamped with the session epoch', async () => {
        const upsertSupplemental = sandbox.stub();
        const ctx = buildContext({
            coursesData: { courses: [{ course: { id: 7, title: 'cached' } }] },
            courseCatalog: { upsertSupplemental },
            sessionEpoch: () => 9,
        });
        const mod = new NavigationCommandModule(ctx);

        await mod.getHandlers().viewCourseDetails({
            type: 'command',
            command: 'viewCourseDetails',
            payload: { courseId: 7 },
        } satisfies WebCmd<'viewCourseDetails'>);

        assert.strictEqual(upsertSupplemental.callCount, 1);
        const [record, epoch] = upsertSupplemental.firstCall.args as [{ kind: string; entry: { course: { id: number } } }, number];
        assert.strictEqual(record.kind, 'course');
        assert.strictEqual(record.entry.course.id, 7);
        assert.strictEqual(epoch, 9, 'the epoch must come from context.sessionEpoch(), not a hardcoded value');
    });

    // `CommandContext.sessionEpoch`'s contract: captured BEFORE any await the
    // caller issues. Read after the fetch instead, and a logout, a 401 or a
    // server-URL change landing while the detail request is open would stamp
    // server A's course with the NEW session's generation, so the catalog's
    // guard waves it through and it renders in the Iris picker.
    test('stamps the viewed course with the epoch from before the fetch', async () => {
        const upsertSupplemental = sandbox.stub();
        let epoch = 4;
        const getCourseForDashboard = sandbox.stub().callsFake(async () => {
            // The identity changes while the request is open.
            epoch = 5;
            return { course: { id: 99, title: 'fetched' } };
        });
        const ctx = buildContext({
            coursesData: { courses: [] },
            getCourseForDashboard,
            courseCatalog: { upsertSupplemental },
            sessionEpoch: () => epoch,
        });
        const mod = new NavigationCommandModule(ctx);

        await mod.getHandlers().viewCourseDetails({
            type: 'command',
            command: 'viewCourseDetails',
            payload: { courseId: 99 },
        } satisfies WebCmd<'viewCourseDetails'>);

        assert.strictEqual(upsertSupplemental.callCount, 1);
        assert.strictEqual(
            upsertSupplemental.firstCall.args[1], 4,
            'the write belongs to the session that asked for it, not the one that answered',
        );
    });

    // The recency store is persisted per account and resolves its scope at
    // write time, so it needs the same pre-fetch epoch the catalog write uses.
    // Otherwise the previous server's course lands in the new student's history
    // and stays there across restarts.
    test('stamps the recency write with the epoch from before the fetch', async () => {
        const onCourseAccessed = sandbox.stub();
        let epoch = 4;
        const getCourseForDashboard = sandbox.stub().callsFake(async () => {
            epoch = 5;
            return { course: { id: 99, title: 'fetched' } };
        });
        const ctx = buildContext({
            coursesData: { courses: [] },
            getCourseForDashboard,
            courseAccessStorage: { onCourseAccessed },
            sessionEpoch: () => epoch,
        });
        const mod = new NavigationCommandModule(ctx);

        await mod.getHandlers().viewCourseDetails({
            type: 'command',
            command: 'viewCourseDetails',
            payload: { courseId: 99 },
        } satisfies WebCmd<'viewCourseDetails'>);

        sinon.assert.calledOnceWithExactly(onCourseAccessed, 99, 4);
    });

    test('falls back to getCourseForDashboard on cache miss', async () => {
        const showCourseDetail = sandbox.stub();
        const getCourseForDashboard = sandbox.stub().resolves({ course: { id: 99, title: 'fetched' } });
        const ctx = buildContext({
            coursesData: { courses: [] },
            getCourseForDashboard,
            showCourseDetail,
        });
        const mod = new NavigationCommandModule(ctx);

        await mod.getHandlers().viewCourseDetails({
            type: 'command',
            command: 'viewCourseDetails',
            payload: { courseId: 99 },
        } satisfies WebCmd<'viewCourseDetails'>);

        assert.strictEqual(getCourseForDashboard.callCount, 1, 'API must be called once on cache miss');
        sinon.assert.calledWith(getCourseForDashboard, 99);
        assert.strictEqual(showCourseDetail.callCount, 1, 'showCourseDetail must be called after API fetch');
    });

    test('shows error and aborts when mapper returns null', async () => {
        const showCourseDetail = sandbox.stub();
        const getCourseForDashboard = sandbox.stub().resolves({ course: { title: 'no-id' } });
        const ctx = buildContext({
            coursesData: { courses: [] },
            getCourseForDashboard,
            showCourseDetail,
        });
        const mod = new NavigationCommandModule(ctx);

        await mod.getHandlers().viewCourseDetails({
            type: 'command',
            command: 'viewCourseDetails',
            payload: { courseId: 5 },
        } satisfies WebCmd<'viewCourseDetails'>);

        assert.strictEqual(showCourseDetail.callCount, 0, 'showCourseDetail must not be called');
        assert.strictEqual(showErrorMessage.callCount, 1, 'error toast must be shown');
        sinon.assert.calledWith(showErrorMessage, 'Course data is incomplete');
    });

    test('shows error toast when API throws on cache miss', async () => {
        const showCourseDetail = sandbox.stub();
        const apiError = new Error('boom');
        const getCourseForDashboard = sandbox.stub().rejects(apiError);
        const ctx = buildContext({
            coursesData: { courses: [] },
            getCourseForDashboard,
            showCourseDetail,
        });
        const mod = new NavigationCommandModule(ctx);

        await mod.getHandlers().viewCourseDetails({
            type: 'command',
            command: 'viewCourseDetails',
            payload: { courseId: 12 },
        } satisfies WebCmd<'viewCourseDetails'>);

        assert.strictEqual(showCourseDetail.callCount, 0, 'showCourseDetail must not be called');
        assert.strictEqual(showErrorMessage.callCount, 1, 'error toast must be shown');
        sinon.assert.calledWith(showErrorMessage, 'Error viewing course details');
    });
});

suite('handleViewArchivedCourse', () => {
    let sandbox: sinon.SinonSandbox;
    let fetchArchived: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined as never);
        sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as never);
        fetchArchived = sandbox.stub(exerciseDataLoader, 'fetchArchivedCourseDetail');
    });

    teardown(() => {
        sandbox.restore();
    });

    // The archived-course detail is awaited before the recency write, so the
    // write has to carry the epoch captured before it. Otherwise the course id
    // is recorded under whichever account the session has become, and the
    // recency store is persisted, so the wrong entry outlives the window.
    test('stamps the recency write with the epoch from before the fetch', async () => {
        const onCourseAccessed = sandbox.stub();
        let epoch = 2;
        fetchArchived.callsFake(async () => {
            // The identity changes while the archived detail request is open.
            epoch = 3;
            return { course: { id: 55, title: 'Archived' } };
        });
        const ctx = {
            appStateManager: { showCourseDetail: sandbox.stub() },
            artemisApi: {},
            actionHandler: { render: sandbox.stub() },
            courseAccessStorage: { onCourseAccessed },
            courseCatalog: { upsertSupplemental: sandbox.stub() },
            sessionEpoch: () => epoch,
        } as unknown as CommandContext;
        const mod = new NavigationCommandModule(ctx);

        await mod.getHandlers().viewArchivedCourse({
            type: 'command',
            command: 'viewArchivedCourse',
            payload: { courseId: 55 },
        } satisfies WebCmd<'viewArchivedCourse'>);

        sinon.assert.calledOnceWithExactly(onCourseAccessed, 55, 2);
    });
});

/**
 * `openExercise` has to name the exercise's course before it can show it. The
 * lookup has two ways to get there and several ways to come up empty, and none
 * of them were covered.
 */
suite('handleOpenExercise parent-course lookup', () => {
    let sandbox: sinon.SinonSandbox;
    let showErrorMessage: sinon.SinonStub;
    let showCourseDetail: sinon.SinonStub;
    let openExerciseDetails: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as never);
        showCourseDetail = sandbox.stub();
        openExerciseDetails = sandbox.stub().resolves();
    });

    teardown(() => sandbox.restore());

    function dispatch(
        courses: unknown,
        payload: { exerciseId: number; courseId?: unknown },
    ): Promise<void> {
        const ctx = {
            appStateManager: {
                coursesData: courses === undefined ? undefined : { courses },
                showCourseDetail,
            },
            actionHandler: { openExerciseDetails },
        } as unknown as CommandContext;

        return new NavigationCommandModule(ctx).getHandlers().openExercise({
            type: 'command',
            command: 'openExercise',
            payload,
        } as WebCmd<'openExercise'>);
    }

    /** The title of the course handed to `showCourseDetail`, if any. */
    function shownTitle(): string | undefined {
        return showCourseDetail.firstCall?.args[0]?.course?.title;
    }

    test('resolves through courseId without scanning the exercise lists', async () => {
        await dispatch([
            { course: { id: 1, title: 'Wrong', exercises: [{ id: 42 }] } },
            { course: { id: 2, title: 'Right', exercises: [] } },
        ], { exerciseId: 42, courseId: 2 });

        assert.strictEqual(shownTitle(), 'Right', 'the explicit courseId wins over the exercise scan');
        assert.strictEqual(openExerciseDetails.callCount, 1);
    });

    test('finds the course by scanning when no courseId is given', async () => {
        await dispatch([
            { course: { id: 1, title: 'Empty', exercises: [] } },
            { course: { id: 2, title: 'Holder', exercises: [{ id: 42 }] } },
        ], { exerciseId: 42 });

        assert.strictEqual(shownTitle(), 'Holder');
    });

    test('keeps scanning past an entry that holds the exercise but cannot be mapped', async () => {
        // A course without an id maps to null. Reporting "course not found"
        // there would strand a deep link whose exercise is right behind it.
        await dispatch([
            { course: { title: 'Unmappable', exercises: [{ id: 42 }] } },
            { course: { id: 2, title: 'Holder', exercises: [{ id: 42 }] } },
        ], { exerciseId: 42 });

        assert.strictEqual(shownTitle(), 'Holder');
    });

    test('falls back to the scan when the course the payload named cannot be mapped', async () => {
        // `getPayload` validates no fields, so a malformed `courseId` reaches
        // here as-is. A string id matches the cached entry but fails the
        // mapper's numeric check, and reporting "course not found" there would
        // strand a link whose exercise the scan can still place.
        await dispatch([
            { course: { id: '1', title: 'Stringly typed', exercises: [] } },
            { course: { id: 2, title: 'Holder', exercises: [{ id: 42 }] } },
        ], { exerciseId: 42, courseId: '1' });

        assert.strictEqual(shownTitle(), 'Holder');
    });

    test('treats a non-array exercises field as an entry that cannot answer', async () => {
        // The course list is raw server JSON with no runtime conversion, so
        // `exercises` is not guaranteed to be an array. Reaching for `.some` on
        // whatever arrived would turn the lookup into a thrown error.
        for (const malformed of [false, {}, 'nope']) {
            showCourseDetail.resetHistory();
            showErrorMessage.resetHistory();

            await dispatch([
                { course: { id: 1, title: 'Malformed', exercises: malformed } },
                { course: { id: 2, title: 'Holder', exercises: [{ id: 42 }] } },
            ], { exerciseId: 42 });

            assert.strictEqual(shownTitle(), 'Holder', `exercises: ${JSON.stringify(malformed)}`);
            assert.strictEqual(showErrorMessage.callCount, 0);
        }
    });

    test('reports a missing course when no entry holds the exercise', async () => {
        await dispatch([{ course: { id: 1, title: 'Empty', exercises: [] } }], { exerciseId: 42 });

        assert.strictEqual(showCourseDetail.callCount, 0);
        assert.strictEqual(openExerciseDetails.callCount, 0);
        assert.ok(showErrorMessage.calledOnceWithExactly('Could not locate the course for this exercise.'));
    });

    test('reports a missing course when no course list has been loaded', async () => {
        await dispatch(undefined, { exerciseId: 42 });

        assert.strictEqual(openExerciseDetails.callCount, 0);
        assert.ok(showErrorMessage.calledOnce);
    });

    test('skips entries with no course and entries with no exercises', async () => {
        await dispatch([
            {},
            { course: { id: 1, title: 'No exercises' } },
            { course: { id: 2, title: 'Holder', exercises: [{ id: 42 }] } },
        ], { exerciseId: 42 });

        assert.strictEqual(shownTitle(), 'Holder');
    });
});
