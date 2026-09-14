import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { WebCmd } from '@shared/messageContracts';

import type { ArtemisApiService } from '@extension/api';
import { NavigationCommandModule } from '@extension/controller/commands/navigationCommands';
import type { CommandContext } from '@extension/controller/commands/types';
import * as exerciseDataLoader from '@extension/controller/exerciseDataLoader';
import { CourseCatalog } from '@extension/services/courseCatalog';

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
        catalogFetch?: sinon.SinonStub;
        showCourseDetail?: sinon.SinonStub;
        upsertSupplemental?: sinon.SinonStub;
        courseAccessStorage?: { onCourseAccessed: sinon.SinonStub };
        sessionEpoch?: () => number;
    }): CommandContext {
        return {
            appStateManager: {
                coursesData: overrides.coursesData,
                showCourseDetail: overrides.showCourseDetail ?? sandbox.stub(),
            },
            // The per-course dashboard endpoint is gone; a cache miss goes
            // through the catalog's list fetch now, so this handler talks to no
            // API method of its own.
            artemisApi: {},
            actionHandler: { render: sandbox.stub(), sendInitData: sandbox.stub() },
            courseAccessStorage: overrides.courseAccessStorage ?? { onCourseAccessed: sandbox.stub() },
            providerRegistry: { getChatWebviewProvider: () => undefined },
            courseCatalog: {
                fetch: overrides.catalogFetch ?? sandbox.stub().resolves(undefined),
                upsertSupplemental: overrides.upsertSupplemental ?? sandbox.stub(),
            },
            sessionEpoch: overrides.sessionEpoch ?? (() => 0),
        } as unknown as CommandContext;
    }

    function viewCourse(mod: NavigationCommandModule, courseId: number): Promise<void> {
        return mod.getHandlers().viewCourseDetails({
            type: 'command',
            command: 'viewCourseDetails',
            payload: { courseId },
        } satisfies WebCmd<'viewCourseDetails'>);
    }

    test('uses cache when course is present', async () => {
        const showCourseDetail = sandbox.stub();
        const catalogFetch = sandbox.stub().resolves({ courses: [{ course: { id: 7, title: 'fetched' } }] });
        const ctx = buildContext({
            coursesData: { courses: [{ course: { id: 7, title: 'cached' } }] },
            catalogFetch,
            showCourseDetail,
        });

        await viewCourse(new NavigationCommandModule(ctx), 7);

        assert.strictEqual(catalogFetch.callCount, 0, 'network must not be touched on cache hit');
        assert.strictEqual(showCourseDetail.callCount, 1, 'showCourseDetail must be called on cache hit');
        assert.strictEqual(showCourseDetail.firstCall.args[0].course.title, 'cached');
    });

    test('records the viewed course in the catalog, stamped with the session epoch', async () => {
        const upsertSupplemental = sandbox.stub();
        const ctx = buildContext({
            coursesData: { courses: [{ course: { id: 7, title: 'cached' } }] },
            upsertSupplemental,
            sessionEpoch: () => 9,
        });

        await viewCourse(new NavigationCommandModule(ctx), 7);

        assert.strictEqual(upsertSupplemental.callCount, 1);
        const [record, epoch] = upsertSupplemental.firstCall.args as [{ kind: string; entry: { course: { id: number } } }, number];
        assert.strictEqual(record.kind, 'course');
        assert.strictEqual(record.entry.course.id, 7);
        assert.strictEqual(epoch, 9, 'the epoch must come from context.sessionEpoch(), not a hardcoded value');
    });

    // `CommandContext.sessionEpoch`'s contract: captured BEFORE any await the
    // caller issues. Read after the fetch instead, and a logout, a 401 or a
    // server-URL change landing while the list request is open would stamp
    // server A's course with the NEW session's generation, so the catalog's
    // guard waves it through and it renders in the Iris picker.
    test('stamps the viewed course with the epoch from before the fetch', async () => {
        const upsertSupplemental = sandbox.stub();
        let epoch = 4;
        const catalogFetch = sandbox.stub().callsFake(async () => {
            // The identity changes while the request is open.
            epoch = 5;
            return { courses: [{ course: { id: 99, title: 'fetched' } }] };
        });
        const ctx = buildContext({
            coursesData: { courses: [] },
            catalogFetch,
            upsertSupplemental,
            sessionEpoch: () => epoch,
        });

        await viewCourse(new NavigationCommandModule(ctx), 99);

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
        const catalogFetch = sandbox.stub().callsFake(async () => {
            epoch = 5;
            return { courses: [{ course: { id: 99, title: 'fetched' } }] };
        });
        const ctx = buildContext({
            coursesData: { courses: [] },
            catalogFetch,
            courseAccessStorage: { onCourseAccessed },
            sessionEpoch: () => epoch,
        });

        await viewCourse(new NavigationCommandModule(ctx), 99);

        sinon.assert.calledOnceWithExactly(onCourseAccessed, 99, 4);
    });

    test('refreshes the course list and resolves the course on a cache miss', async () => {
        const showCourseDetail = sandbox.stub();
        const catalogFetch = sandbox.stub().resolves({
            courses: [{ course: { id: 1, title: 'other' } }, { course: { id: 99, title: 'fetched' } }],
        });
        const ctx = buildContext({
            coursesData: { courses: [] },
            catalogFetch,
            showCourseDetail,
        });

        await viewCourse(new NavigationCommandModule(ctx), 99);

        assert.strictEqual(catalogFetch.callCount, 1, 'the list must be refreshed once on cache miss');
        sinon.assert.calledWith(catalogFetch, { force: true });
        assert.strictEqual(showCourseDetail.callCount, 1, 'showCourseDetail must be called after the refresh');
        assert.strictEqual(showCourseDetail.firstCall.args[0].course.title, 'fetched');
    });

    // `CourseCatalog.fetch` answers `undefined` when the request failed, and a
    // refreshed list that simply does not hold the course is the same dead end.
    test('shows error and aborts when the refreshed list cannot resolve the course', async () => {
        for (const refreshed of [undefined, { courses: [] }, { courses: [{ course: { title: 'no-id' } }] }]) {
            showErrorMessage.resetHistory();
            const showCourseDetail = sandbox.stub();
            const ctx = buildContext({
                coursesData: { courses: [] },
                catalogFetch: sandbox.stub().resolves(refreshed),
                showCourseDetail,
            });

            await viewCourse(new NavigationCommandModule(ctx), 5);

            assert.strictEqual(showCourseDetail.callCount, 0, 'showCourseDetail must not be called');
            sinon.assert.calledOnceWithExactly(showErrorMessage, 'Course data is incomplete');
        }
    });

    test('shows error toast when the refresh throws on cache miss', async () => {
        const showCourseDetail = sandbox.stub();
        const ctx = buildContext({
            coursesData: { courses: [] },
            catalogFetch: sandbox.stub().rejects(new Error('boom')),
            showCourseDetail,
        });

        await viewCourse(new NavigationCommandModule(ctx), 12);

        assert.strictEqual(showCourseDetail.callCount, 0, 'showCourseDetail must not be called');
        assert.strictEqual(showErrorMessage.callCount, 1, 'error toast must be shown');
        sinon.assert.calledWith(showErrorMessage, 'Error viewing course details');
    });
});

/**
 * A reload can no longer rebuild the course: the endpoint behind it returns
 * exercises only. What it may not do is lose the scalars it never sees.
 */
suite('handleReloadCourseDetail', () => {
    let sandbox: sinon.SinonSandbox;
    let showErrorMessage: sinon.SinonStub;
    let showCourseDetail: sinon.SinonStub;
    let sendInitData: sinon.SinonStub;
    let upsertSupplemental: sinon.SinonStub;
    let replaceCourseExercises: sinon.SinonStub;
    let onCourseAccessed: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as never);
        showCourseDetail = sandbox.stub();
        sendInitData = sandbox.stub();
        upsertSupplemental = sandbox.stub();
        replaceCourseExercises = sandbox.stub();
        onCourseAccessed = sandbox.stub();
    });

    teardown(() => sandbox.restore());

    const openCourse = {
        course: {
            id: 7,
            title: 'Intro',
            description: 'A course description the exercise endpoint never sends',
            semester: 'WS24/25',
            shortName: 'intro',
            numberOfStudents: 120,
            instructorGroupName: 'intro-instructors',
            exercises: [{ id: 1, title: 'Stale' }],
        },
    };

    function buildContext(overrides: {
        currentCourseData?: unknown;
        coursesData?: unknown;
        getCourseExercisesForOverview?: sinon.SinonStub;
        courseCatalog?: unknown;
        sessionEpoch?: () => number;
    }): CommandContext {
        return {
            appStateManager: {
                currentCourseData: overrides.currentCourseData,
                coursesData: overrides.coursesData,
                showCourseDetail,
            },
            artemisApi: {
                getCourseExercisesForOverview: overrides.getCourseExercisesForOverview ?? sandbox.stub().resolves([]),
            },
            actionHandler: { render: sandbox.stub(), sendInitData },
            courseAccessStorage: { onCourseAccessed },
            courseCatalog: overrides.courseCatalog
                ?? { upsertSupplemental, replaceCourseExercises, fetch: sandbox.stub().resolves(undefined) },
            sessionEpoch: overrides.sessionEpoch ?? (() => 0),
        } as unknown as CommandContext;
    }

    function reload(ctx: CommandContext, courseId?: number): Promise<void> {
        return new NavigationCommandModule(ctx).getHandlers().reloadCourseDetail({
            type: 'command',
            command: 'reloadCourseDetail',
            payload: courseId === undefined ? {} : { courseId },
        } as WebCmd<'reloadCourseDetail'>);
    }

    test('keeps the scalars the exercise endpoint does not carry', async () => {
        const ctx = buildContext({
            currentCourseData: openCourse,
            getCourseExercisesForOverview: sandbox.stub().resolves([{ id: 2, title: 'Fresh' }]),
        });

        await reload(ctx, 7);

        const shown = showCourseDetail.firstCall.args[0].course;
        assert.strictEqual(shown.description, openCourse.course.description);
        assert.strictEqual(shown.semester, 'WS24/25');
        assert.strictEqual(shown.shortName, 'intro');
        assert.strictEqual(shown.numberOfStudents, 120);
        assert.strictEqual(shown.instructorGroupName, 'intro-instructors');
    });

    test('replaces the exercise list with the freshly fetched one', async () => {
        const getCourseExercisesForOverview = sandbox.stub().resolves([
            { id: 2, title: 'Fresh', studentParticipations: [{ id: 5, repositoryUri: 'https://git/2' }] },
        ]);
        const ctx = buildContext({ currentCourseData: openCourse, getCourseExercisesForOverview });

        await reload(ctx, 7);

        sinon.assert.calledOnceWithExactly(getCourseExercisesForOverview, 7);
        const shown = showCourseDetail.firstCall.args[0].course;
        assert.deepStrictEqual(shown.exercises.map((e: { id: number }) => e.id), [2]);
        assert.strictEqual(sendInitData.callCount, 1, 'the webview is updated without a full re-render');
    });

    // The reload used to write app state only, which left the course list and
    // the exercise registry showing the participations it had just replaced.
    test('writes the refreshed course to the catalog, not only to app state', async () => {
        // Through a REAL catalog seeded from a dashboard response, not a stub. A stub would
        // happily record a write that the catalog then discards, which is exactly what a
        // supplemental write does for a course the dashboard already holds.
        const api = {
            getCoursesForDashboard: async () => ({
                courses: [{ course: { id: 7, title: 'Intro', exercises: [{ id: 1, title: 'Stale' }] } }],
            }),
        } as unknown as ArtemisApiService;
        const catalog = new CourseCatalog(api);
        await catalog.fetch();

        const ctx = buildContext({
            currentCourseData: openCourse,
            getCourseExercisesForOverview: sandbox.stub().resolves([{ id: 2, title: 'Fresh' }]),
            courseCatalog: catalog,
            sessionEpoch: () => catalog.currentEpoch,
        });

        await reload(ctx, 7);

        assert.deepStrictEqual(
            catalog.projection().exercises.map(e => e.id),
            [2],
            'the catalog projection, which the exercise registry is rebuilt from, must see the reload',
        );
    });

    // Recency orders the "recently accessed" list. A reload is not a visit to
    // a course the student navigated to, so it must not reorder that list.
    test('does not re-stamp course-access recency', async () => {
        const ctx = buildContext({
            currentCourseData: openCourse,
            getCourseExercisesForOverview: sandbox.stub().resolves([]),
        });

        await reload(ctx, 7);

        assert.strictEqual(onCourseAccessed.callCount, 0);
    });

    test('resolves the course from the cached list when the payload names another one', async () => {
        const ctx = buildContext({
            currentCourseData: openCourse,
            coursesData: { courses: [{ course: { id: 8, title: 'Other', semester: 'SS25' } }] },
            getCourseExercisesForOverview: sandbox.stub().resolves([{ id: 9, title: 'Fresh' }]),
        });

        await reload(ctx, 8);

        const shown = showCourseDetail.firstCall.args[0].course;
        assert.strictEqual(shown.id, 8);
        assert.strictEqual(shown.semester, 'SS25');
        assert.deepStrictEqual(shown.exercises.map((e: { id: number }) => e.id), [9]);
    });

    test('reports incomplete data when no course can be resolved', async () => {
        const ctx = buildContext({
            currentCourseData: undefined,
            coursesData: { courses: [] },
            getCourseExercisesForOverview: sandbox.stub().resolves([]),
        });

        await reload(ctx, 42);

        assert.strictEqual(showCourseDetail.callCount, 0);
        sinon.assert.calledOnceWithExactly(showErrorMessage, 'Course data is incomplete');
        assert.strictEqual(sendInitData.callCount, 1);
    });

    test('does nothing when neither the payload nor the open course names an id', async () => {
        const getCourseExercisesForOverview = sandbox.stub().resolves([]);
        const ctx = buildContext({ currentCourseData: undefined, getCourseExercisesForOverview });

        await reload(ctx);

        assert.strictEqual(getCourseExercisesForOverview.callCount, 0);
        assert.strictEqual(showErrorMessage.callCount, 0);
    });

    test('shows an error toast when the exercise fetch throws', async () => {
        const ctx = buildContext({
            currentCourseData: openCourse,
            getCourseExercisesForOverview: sandbox.stub().rejects(new Error('boom')),
        });

        await reload(ctx, 7);

        assert.strictEqual(showCourseDetail.callCount, 0);
        sinon.assert.calledOnceWithExactly(showErrorMessage, 'Error reloading course details');
        assert.strictEqual(sendInitData.callCount, 1);
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
