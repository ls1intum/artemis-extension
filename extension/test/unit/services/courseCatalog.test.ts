import * as assert from 'assert';
import * as sinon from 'sinon';

import type { ArtemisApiService } from '@extension/api';
import { CourseCatalog } from '@extension/services/courseCatalog';
import type { CourseDashboardEntry, CourseDashboardResponse } from '@extension/types';

function entry(courseId: number, title: string, exercises: Array<Record<string, unknown>> = []): CourseDashboardEntry {
    return { course: { id: courseId, title, exercises } } as CourseDashboardEntry;
}

function exercise(id: number, title: string, repositoryUri?: string, participationId?: number): Record<string, unknown> {
    return {
        id, title,
        studentParticipations: repositoryUri ? [{ id: participationId, repositoryUri }] : [],
    };
}

/**
 * Resolvers stay INDEXED. A shift-based helper would resolve the oldest
 * request, which is the opposite of what the out-of-order tests need to say.
 */
function fakeApi(): {
    api: ArtemisApiService;
    resolve: (index: number, r: CourseDashboardResponse) => void;
    reject: (index: number, error: Error) => void;
    callCount: () => number;
} {
    const pending: Array<{ resolve: (r: CourseDashboardResponse) => void; reject: (e: Error) => void }> = [];
    const api = {
        getCoursesForDashboard: () => new Promise<CourseDashboardResponse>((resolve, reject) => {
            pending.push({ resolve, reject });
        }),
    } as unknown as ArtemisApiService;
    return {
        api,
        resolve: (index, r) => pending[index]?.resolve(r),
        reject: (index, error) => pending[index]?.reject(error),
        callCount: () => pending.length,
    };
}

suite('CourseCatalog', () => {
    let sandbox: sinon.SinonSandbox;
    setup(() => { sandbox = sinon.createSandbox(); });
    teardown(() => { sandbox.restore(); });

    test('a course deleted on the server is gone after a forced refresh, with no removal call', async () => {
        const api = { getCoursesForDashboard: sandbox.stub() } as unknown as ArtemisApiService;
        (api.getCoursesForDashboard as sinon.SinonStub)
            .onFirstCall().resolves({ courses: [entry(1, 'Old'), entry(2, 'Kept')] })
            .onSecondCall().resolves({ courses: [entry(2, 'Kept')] });
        const catalog = new CourseCatalog(api);
        await catalog.fetch();
        await catalog.fetch({ force: true });
        assert.deepStrictEqual(catalog.projection().courses.map(c => c.id), [2]);
    });

    test('a slow forced fetch that resolves after a newer one does not overwrite it', async () => {
        const { api, resolve } = fakeApi();
        const catalog = new CourseCatalog(api);
        const slow = catalog.fetch({ force: true });   // request 0
        const fast = catalog.fetch({ force: true });   // request 1
        resolve(1, { courses: [entry(2, 'Newer')] });  // the SECOND request answers first
        await fast;
        resolve(0, { courses: [entry(1, 'Older')] });  // the first answers late
        await slow;
        assert.deepStrictEqual(catalog.projection().courses.map(c => c.id), [2]);
    });

    test('a plain init fetch that lands after a failed forced fetch does not install', async () => {
        const { api, resolve, reject } = fakeApi();
        const catalog = new CourseCatalog(api);
        const plain = catalog.fetch();                 // request 0
        const forced = catalog.fetch({ force: true }); // request 1, started while 0 is open
        reject(1, new Error('boom'));
        await forced;
        resolve(0, { courses: [entry(1, 'Stale')] });
        await plain;
        // Request 1 is the newest REQUEST. Its failure leaves the layer as it
        // was; request 0's late success may not reinstate a snapshot the
        // student already asked to replace.
        assert.deepStrictEqual(catalog.projection().courses, []);
    });

    test('a supplemental write carrying a stale epoch is rejected', () => {
        const catalog = new CourseCatalog({} as ArtemisApiService);
        catalog.resetTo(4);
        catalog.upsertSupplemental({ kind: 'course', entry: entry(9, 'Archived') }, 3);
        assert.deepStrictEqual(catalog.projection().courses, []);
        catalog.upsertSupplemental({ kind: 'course', entry: entry(9, 'Archived') }, 4);
        assert.deepStrictEqual(catalog.projection().courses.map(c => c.id), [9]);
    });

    test('an individually opened exercise survives a dashboard replacement whose course entry does not list it', async () => {
        const api = { getCoursesForDashboard: sandbox.stub().resolves({ courses: [entry(1, 'Course', [exercise(10, 'Listed', 'https://git/10', 1)])] }) } as unknown as ArtemisApiService;
        const catalog = new CourseCatalog(api);
        catalog.upsertSupplemental({
            kind: 'partial-exercise', id: 11, courseId: 1, title: 'Opened',
            repositoryUri: 'https://git/11', participationId: 2,
        }, 0);
        await catalog.fetch({ force: true });
        assert.deepStrictEqual(catalog.projection().exercises.map(e => e.id).sort(), [10, 11]);
    });

    test('the dashboard wins for an entity it contains', async () => {
        const api = { getCoursesForDashboard: sandbox.stub().resolves({ courses: [entry(1, 'Real title')] }) } as unknown as ArtemisApiService;
        const catalog = new CourseCatalog(api);
        catalog.upsertSupplemental({ kind: 'course', entry: entry(1, 'Stale title') }, 0);
        await catalog.fetch({ force: true });
        assert.strictEqual(catalog.projection().courses[0]?.title, 'Real title');
    });

    test('a partial course is not pickable but can still name a course', () => {
        const catalog = new CourseCatalog({} as ArtemisApiService);
        catalog.upsertSupplemental({ kind: 'partial-course', id: 5, title: 'Named' }, 0);
        assert.deepStrictEqual(catalog.projection().courses, []);
        assert.strictEqual(catalog.courseTitle(5), 'Named');
    });

    // The archived workspace course reaches the catalog as a FULL entry, and
    // entering it then records its name. Both use the same key.
    test('naming a course cannot erase the archived course it names', () => {
        const catalog = new CourseCatalog({} as ArtemisApiService);
        catalog.upsertSupplemental({
            kind: 'course',
            entry: entry(9, 'Archived', [exercise(10, 'E', 'https://git/10', 1)]),
        }, 0);
        catalog.upsertSupplemental({ kind: 'partial-course', id: 9, title: 'Archived' }, 0);
        assert.deepStrictEqual(catalog.projection().courses.map(c => c.id), [9]);
        assert.deepStrictEqual(catalog.projection().exercises.map(e => e.id), [10]);
    });

    // The history-row name write is the poorest source there is. It must not
    // cost an exercise its registry membership.
    test('naming an exercise keeps everything a richer write already knew', () => {
        const catalog = new CourseCatalog({} as ArtemisApiService);
        catalog.upsertSupplemental({
            kind: 'partial-exercise', id: 10, courseId: 1, title: 'Opened',
            shortName: 'OP', dueDate: '2030-01-01T00:00:00Z',
            repositoryUri: 'https://git/10', participationId: 77,
        }, 0);
        catalog.upsertSupplemental({ kind: 'partial-exercise', id: 10, courseId: 1, title: 'From history' }, 0);
        const projected = catalog.projection().exercises[0];
        assert.strictEqual(projected?.title, 'From history');
        assert.strictEqual(projected?.repositoryUri, 'https://git/10');
        assert.strictEqual(projected?.participationId, 77);
        assert.strictEqual(projected?.dueDate, '2030-01-01T00:00:00Z');
    });

    // Precedence must not depend on insertion order.
    test('a full supplemental course outranks a partial exercise written after it', () => {
        const catalog = new CourseCatalog({} as ArtemisApiService);
        catalog.upsertSupplemental({
            kind: 'course', entry: entry(1, 'Archived', [exercise(10, 'Real', 'https://git/10', 77)]),
        }, 0);
        catalog.upsertSupplemental({ kind: 'partial-exercise', id: 10, courseId: 1, title: 'From history' }, 0);
        const projected = catalog.projection().exercises[0];
        assert.strictEqual(projected?.title, 'Real');
        assert.strictEqual(projected?.repositoryUri, 'https://git/10');
    });

    test('a partial exercise without a title is not projected', () => {
        const catalog = new CourseCatalog({} as ArtemisApiService);
        catalog.upsertSupplemental({ kind: 'partial-exercise', id: 7, courseId: 1 }, 0);
        assert.deepStrictEqual(catalog.projection().exercises, []);
    });

    test('a projected exercise keeps its repository uri and participation id', async () => {
        const api = { getCoursesForDashboard: sandbox.stub().resolves({ courses: [entry(1, 'C', [exercise(10, 'E', 'https://git/10', 77)])] }) } as unknown as ArtemisApiService;
        const catalog = new CourseCatalog(api);
        await catalog.fetch();
        const projected = catalog.projection().exercises[0];
        assert.strictEqual(projected?.repositoryUri, 'https://git/10');
        assert.strictEqual(projected?.participationId, 77);
        assert.strictEqual(projected?.pickable, true);
    });

    test('an exercise with no participation is projected but not pickable', async () => {
        const api = { getCoursesForDashboard: sandbox.stub().resolves({ courses: [entry(1, 'C', [exercise(10, 'E')])] }) } as unknown as ArtemisApiService;
        const catalog = new CourseCatalog(api);
        await catalog.fetch();
        assert.strictEqual(catalog.projection().exercises[0]?.pickable, false);
    });

    test('resetTo empties both layers', async () => {
        const api = { getCoursesForDashboard: sandbox.stub().resolves({ courses: [entry(1, 'C')] }) } as unknown as ArtemisApiService;
        const catalog = new CourseCatalog(api);
        await catalog.fetch();
        catalog.upsertSupplemental({ kind: 'course', entry: entry(2, 'S') }, 0);
        catalog.resetTo(1);
        assert.deepStrictEqual(catalog.projection().courses, []);
        assert.strictEqual(catalog.get(), undefined);
    });

    test('a second injectEntry for the same course fires onCoursesLoaded only once', () => {
        const catalog = new CourseCatalog({} as ArtemisApiService);
        let fireCount = 0;
        catalog.onCoursesLoaded(() => { fireCount++; });
        catalog.injectEntry(entry(9, 'Archived'));
        catalog.injectEntry(entry(9, 'Archived'));
        assert.strictEqual(fireCount, 1);
    });

    test('a course already in the dashboard layer is not injected', async () => {
        const api = { getCoursesForDashboard: sandbox.stub().resolves({ courses: [entry(1, 'C')] }) } as unknown as ArtemisApiService;
        const catalog = new CourseCatalog(api);
        await catalog.fetch();
        let fireCount = 0;
        catalog.onCoursesLoaded(() => { fireCount++; });
        catalog.injectEntry(entry(1, 'C'));
        assert.strictEqual(fireCount, 0);
    });

    // With an unscoped `finally`, the older request's cleanup would erase the
    // newer request's still-pending handle, and this third caller would open a
    // redundant request instead of joining it.
    test('a caller arriving after an older request settles joins the still-pending newer request', async () => {
        const { api, resolve, callCount } = fakeApi();
        const catalog = new CourseCatalog(api);
        const plain = catalog.fetch();                  // request 0
        const forced = catalog.fetch({ force: true });  // request 1
        resolve(0, { courses: [] });                     // the OLDER one settles first
        await plain;
        void catalog.fetch();                            // must JOIN request 1
        resolve(1, { courses: [entry(1, 'C')] });
        await forced;
        assert.strictEqual(callCount(), 2);
    });
});
