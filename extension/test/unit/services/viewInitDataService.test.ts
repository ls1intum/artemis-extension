import * as assert from 'assert';

import type { ExtensionToWebviewMessage } from '@shared/messageContracts';

import { ViewInitDataService } from '@extension/services/ui/viewInitDataService';

type Posted = ExtensionToWebviewMessage | undefined;

function buildService(coursesData: { courses: Array<{ course: { id?: number; title?: string; exercises?: unknown[] } }> }, coordinator?: unknown) {
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
});
