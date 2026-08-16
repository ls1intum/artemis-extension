import * as assert from 'assert';

import type { ExtensionToWebviewMessage } from '@shared/messageContracts';

import { ViewInitDataService } from '@extension/services/ui/viewInitDataService';

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
