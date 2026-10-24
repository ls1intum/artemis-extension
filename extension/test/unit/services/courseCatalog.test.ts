import * as assert from 'assert';
import * as sinon from 'sinon';

import type { ArtemisApiService } from '@extension/api';
import { CourseCatalog, toRegistryEntries } from '@extension/services/courseCatalog';
import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { SettledOutcome } from '@extension/services/session/sessionIdentityCoordinator';
import { SessionIdentityCoordinator } from '@extension/services/session/sessionIdentityCoordinator';
import { findExerciseByRepositoryUrl } from '@extension/services/workspace/workspaceDetectionService';
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

    test('a failed fetch is remembered, so an empty list can say why it is empty', async () => {
        const { api, reject } = fakeApi();
        const catalog = new CourseCatalog(api);
        assert.strictEqual(catalog.coursesUnavailable, false, 'nothing has failed yet');
        const run = catalog.fetch();
        reject(0, new Error('fetch failed'));
        await run;
        assert.strictEqual(catalog.coursesUnavailable, true);
    });

    test('a later success clears the remembered failure', async () => {
        const { api, resolve, reject } = fakeApi();
        const catalog = new CourseCatalog(api);
        const failed = catalog.fetch();
        reject(0, new Error('fetch failed'));
        await failed;
        const retried = catalog.fetch({ force: true });
        resolve(1, { courses: [entry(1, 'Back')] });
        await retried;
        assert.strictEqual(catalog.coursesUnavailable, false);
    });

    test('a superseded failure does not mark a newer answer unavailable', async () => {
        const { api, resolve, reject } = fakeApi();
        const catalog = new CourseCatalog(api);
        const slow = catalog.fetch({ force: true });   // request 0
        const fast = catalog.fetch({ force: true });   // request 1
        resolve(1, { courses: [entry(1, 'Newest')] }); // the newest request answers first
        await fast;
        reject(0, new Error('fetch failed'));          // the superseded one fails late
        await slow;
        // The failure belongs to a request nobody is waiting on any more. Its
        // courses are on screen; telling the student they are unavailable
        // would contradict the list right next to the message.
        assert.strictEqual(catalog.coursesUnavailable, false);
    });

    test('a reset orphans an in-flight request, even when the epoch is unchanged', async () => {
        const { api, resolve, reject } = fakeApi();
        const catalog = new CourseCatalog(api);
        const open = catalog.fetch();
        // `clear()` is `resetTo(this._epoch)`: the epoch guard cannot help here,
        // so the request generation has to do the orphaning that resetTo's
        // contract promises.
        catalog.clear();
        resolve(0, { courses: [entry(1, 'From before the reset')] });
        await open;
        assert.deepStrictEqual(catalog.projection().courses, [], 'a pre-reset answer must not install');

        const second = catalog.fetch({ force: true });
        catalog.clear();
        reject(1, new Error('fetch failed'));
        await second;
        assert.strictEqual(catalog.coursesUnavailable, false, 'nor may its failure be reported');
    });

    test('an identity reset forgets the previous session failure', async () => {
        const { api, reject } = fakeApi();
        const catalog = new CourseCatalog(api);
        const run = catalog.fetch();
        reject(0, new Error('fetch failed'));
        await run;
        catalog.resetTo(1);
        assert.strictEqual(catalog.coursesUnavailable, false);
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

    test('a partial course keeps naming its course after the dashboard drops it', async () => {
        const api = { getCoursesForDashboard: sandbox.stub() } as unknown as ArtemisApiService;
        (api.getCoursesForDashboard as sinon.SinonStub)
            .onFirstCall().resolves({ courses: [entry(1, 'Real name')] })
            .onSecondCall().resolves({ courses: [] });
        const catalog = new CourseCatalog(api);
        await catalog.fetch();
        catalog.upsertSupplemental({ kind: 'partial-course', id: 1, title: 'Real name' }, 0);
        await catalog.fetch({ force: true });
        assert.deepStrictEqual(catalog.projection().courses, [], 'still not pickable');
        assert.strictEqual(catalog.courseTitle(1), 'Real name');
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

    /**
     * The server lists the practice participation first, so the graded
     * repository the student actually cloned is the SECOND one. Projecting the
     * first participation put the practice URI into the registry, where the
     * graded remote matched nothing: the exact pass misses and the
     * practice-to-graded degradation has nothing to degrade.
     *
     * Asserted through a real registry, because that is the collapse the bug
     * happened in: `ExerciseRegistryEntry` holds ONE repository uri per
     * exercise, so which participation the projection picks decides the match.
     */
    test('an exercise whose graded repository is its second participation is findable by both remotes', () => {
        const graded = 'https://git.example.org/git/EX/ex-student.git';
        const practice = 'https://git.example.org/git/EX/ex-practice-student.git';
        const catalog = new CourseCatalog({} as ArtemisApiService);
        catalog.upsertSupplemental({
            kind: 'course',
            entry: entry(1, 'Archived', [{
                id: 10, title: 'E',
                studentParticipations: [
                    { id: 55, testRun: true, repositoryUri: practice },
                    { id: 77, testRun: false, repositoryUri: graded },
                ],
            }]),
        }, 0);

        const registry = new ExerciseRegistry();
        registry.replaceAll(toRegistryEntries(catalog.projection()));

        assert.strictEqual(catalog.projection().exercises.length, 1, 'one exercise, not one per participation');
        assert.strictEqual(findExerciseByRepositoryUrl(graded, registry.getAllExercises())?.id, 10);
        assert.strictEqual(findExerciseByRepositoryUrl(practice, registry.getAllExercises())?.id, 10);
        // The reverse lookup has to name the participation the uri came from.
        assert.strictEqual(registry.getExerciseIdByParticipation(77), 10);
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
        catalog.injectEntry(entry(9, 'Archived'), catalog.currentEpoch);
        catalog.injectEntry(entry(9, 'Archived'), catalog.currentEpoch);
        assert.strictEqual(fireCount, 1);
    });

    test('a course already in the dashboard layer is not injected', async () => {
        const api = { getCoursesForDashboard: sandbox.stub().resolves({ courses: [entry(1, 'C')] }) } as unknown as ArtemisApiService;
        const catalog = new CourseCatalog(api);
        await catalog.fetch();
        let fireCount = 0;
        catalog.onCoursesLoaded(() => { fireCount++; });
        catalog.injectEntry(entry(1, 'C'), catalog.currentEpoch);
        assert.strictEqual(fireCount, 0);
    });

    // The whole point of the parameter. An `injectEntry` that read
    // `this._epoch` would compare the epoch to itself, so the archived course
    // the previous account's search found would land in the new session and
    // fire the event that rebuilds the registry and feeds the Iris picker.
    test('injectEntry with an epoch from a previous session is rejected', () => {
        const catalog = new CourseCatalog({} as ArtemisApiService);
        const stale = catalog.currentEpoch;
        catalog.resetTo(stale + 1);
        let fireCount = 0;
        catalog.onCoursesLoaded(() => { fireCount++; });

        catalog.injectEntry(entry(9, 'Archived'), stale);

        assert.strictEqual(fireCount, 0, 'a rejected write must not announce anything');
        assert.deepStrictEqual(catalog.projection().courses, []);
        assert.strictEqual(catalog.get(), undefined);
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

    suite('replaceCourseExercises', () => {
        test('refreshes a course the dashboard already holds', async () => {
            // `get()` and `projection()` both let a dashboard entry win over the supplemental
            // layer, so writing a reload through `upsertSupplemental` changes nothing for an
            // active course. It has to land in the authoritative layer.
            const { api, resolve } = fakeApi();
            const catalog = new CourseCatalog(api);
            const pending = catalog.fetch();
            resolve(0, { courses: [entry(7, 'C', [exercise(10, 'Old', 'https://git/old', 1)])] });
            await pending;

            catalog.replaceCourseExercises(7, [exercise(11, 'New', 'https://git/new', 2)], catalog.currentEpoch);

            const projected = catalog.projection().exercises;
            assert.deepStrictEqual(projected.map(e => e.id), [11]);
            assert.strictEqual(projected[0].repositoryUri, 'https://git/new');
            assert.deepStrictEqual(
                catalog.get()?.courses?.flatMap(c => (c.course?.exercises ?? []).map(e => e.id)),
                [11],
            );
        });

        test('an emptied course really empties', async () => {
            // The reload answering with no exercises is the case a stale dashboard entry hides.
            const { api, resolve } = fakeApi();
            const catalog = new CourseCatalog(api);
            const pending = catalog.fetch();
            resolve(0, { courses: [entry(7, 'C', [exercise(10, 'Old', 'https://git/old', 1)])] });
            await pending;

            catalog.replaceCourseExercises(7, [], catalog.currentEpoch);

            assert.deepStrictEqual(catalog.projection().exercises, []);
        });

        test('keeps the course record of a supplemental-only course', () => {
            // Archived courses live in the supplemental layer. Replacing the record wholesale
            // would drop the title the archive row supplied.
            const { api } = fakeApi();
            const catalog = new CourseCatalog(api);
            catalog.upsertSupplemental(
                { kind: 'course', entry: entry(9, 'Archived C', [exercise(20, 'A')]) },
                catalog.currentEpoch,
            );

            catalog.replaceCourseExercises(9, [exercise(21, 'B')], catalog.currentEpoch);

            assert.strictEqual(catalog.projection().courses.find(c => c.id === 9)?.title, 'Archived C');
            assert.deepStrictEqual(catalog.projection().exercises.map(e => e.id), [21]);
        });

        test('rejects a write from another session', async () => {
            const { api, resolve } = fakeApi();
            const catalog = new CourseCatalog(api);
            const pending = catalog.fetch();
            resolve(0, { courses: [entry(7, 'C', [exercise(10, 'Old', 'https://git/old', 1)])] });
            await pending;

            catalog.replaceCourseExercises(7, [exercise(11, 'New')], catalog.currentEpoch + 1);

            assert.deepStrictEqual(catalog.projection().exercises.map(e => e.id), [10]);
        });
    });

    // A request sent while the identity is resolving is discarded by the
    // transition that answers it (the transition resets the catalog), and
    // nothing asks again: an enrolled student saw an empty Recent Courses after
    // every sign-in. The fetch therefore waits for the identity first.
    suite('dashboardExercises', () => {
        test('reads the nested list, and the flat list when the nested one is empty', async () => {
            const api = { getCoursesForDashboard: sandbox.stub().resolves({ courses: [
                entry(1, 'Nested', [exercise(10, 'A')]),
                { course: { id: 2, title: 'Flat', exercises: [] }, exercises: [exercise(20, 'B')] },
            ] }) } as unknown as ArtemisApiService;
            const catalog = new CourseCatalog(api);
            await catalog.fetch();
            assert.deepStrictEqual(catalog.dashboardExercises(1)?.map(e => e.id), [10]);
            assert.deepStrictEqual(catalog.dashboardExercises(2)?.map(e => e.id), [20]);
        });

        test('ignores a course the newest response does not contain, even when it is recorded supplementally', async () => {
            const api = { getCoursesForDashboard: sandbox.stub().resolves({ courses: [entry(1, 'Active')] }) } as unknown as ArtemisApiService;
            const catalog = new CourseCatalog(api);
            await catalog.fetch();
            catalog.injectEntry(entry(5, 'Archived', [exercise(50, 'Old')]), catalog.currentEpoch);
            assert.strictEqual(catalog.dashboardExercises(5), undefined);
        });
    });

    suite('revalidate', () => {
        const flush = () => new Promise<void>(resolve => setImmediate(resolve));
        const MINUTE = 60_000;
        let clock: sinon.SinonFakeTimers;
        setup(() => { clock = sandbox.useFakeTimers({ now: 1_000_000, toFake: ['Date'] }); });

        async function loaded(courses: CourseDashboardEntry[]) {
            const fake = fakeApi();
            const catalog = new CourseCatalog(fake.api);
            const first = catalog.fetch();
            fake.resolve(0, { courses });
            await first;
            return { ...fake, catalog };
        }

        test('asks nothing before a list is installed', async () => {
            const { api, callCount } = fakeApi();
            const catalog = new CourseCatalog(api);
            assert.strictEqual(await catalog.fetch({ revalidate: true }), undefined);
            assert.strictEqual(callCount(), 0);
        });

        test('asks nothing within a minute of the last request', async () => {
            const { catalog, callCount } = await loaded([entry(1, 'Cached')]);
            clock.tick(MINUTE - 1);
            await catalog.fetch({ revalidate: true });
            assert.strictEqual(callCount(), 1);
        });

        test('after a minute, a course enrolled since the first request appears', async () => {
            const { catalog, callCount, resolve } = await loaded([entry(1, 'Cached')]);
            clock.tick(MINUTE);
            const refreshed = catalog.fetch({ revalidate: true });
            await flush();
            assert.strictEqual(callCount(), 2);
            resolve(1, { courses: [entry(1, 'Cached'), entry(2, 'Enrolled later')] });
            await refreshed;
            assert.deepStrictEqual(catalog.projection().courses.map(c => c.id), [1, 2]);
        });

        test('joins an initial load that is still open', async () => {
            const { api, resolve, callCount } = fakeApi();
            const catalog = new CourseCatalog(api);
            const initial = catalog.fetch();
            const revalidated = catalog.fetch({ revalidate: true });
            await flush();
            resolve(0, { courses: [entry(1, 'Enrolled')] });
            assert.strictEqual(callCount(), 1);
            assert.deepStrictEqual((await revalidated)?.courses?.map(c => c.course?.id), [1]);
            await initial;
        });

        test('joins a refresh that is still open', async () => {
            const { catalog, callCount, resolve } = await loaded([entry(1, 'Cached')]);
            const forced = catalog.fetch({ force: true });
            await flush();
            clock.tick(MINUTE);
            const revalidated = catalog.fetch({ revalidate: true });
            await flush();
            resolve(1, { courses: [entry(2, 'Fresh')] });
            assert.strictEqual(callCount(), 2);
            assert.deepStrictEqual((await revalidated)?.courses?.map(c => c.course?.id), [2]);
            await forced;
        });

        test('a failed refresh keeps the shown list, reports it, and is not retried within a minute', async () => {
            const { catalog, callCount, reject } = await loaded([entry(1, 'Cached')]);
            clock.tick(MINUTE);
            const failed = catalog.fetch({ revalidate: true });
            await flush();
            reject(1, new Error('boom'));
            await failed;
            assert.deepStrictEqual(catalog.projection().courses.map(c => c.id), [1]);
            assert.strictEqual(catalog.coursesUnavailable, true);

            await catalog.fetch({ revalidate: true });
            assert.strictEqual(callCount(), 2);
        });

        test('a reset during the refresh installs nothing', async () => {
            const { catalog, resolve } = await loaded([entry(1, 'Cached')]);
            clock.tick(MINUTE);
            const refreshed = catalog.fetch({ revalidate: true });
            await flush();
            catalog.resetTo(catalog.currentEpoch + 1);
            resolve(1, { courses: [entry(2, 'Previous session')] });
            await refreshed;
            assert.strictEqual(catalog.dashboardLoaded, false);
        });

        test('asks nothing when the identity turns anonymous while it waits', async () => {
            const { api, resolve, callCount } = fakeApi();
            let settle: (o: SettledOutcome) => void = () => undefined;
            let pending = false;
            const catalog = new CourseCatalog(api, {
                whenSettled: () => pending ? new Promise(r => { settle = r; }) : Promise.resolve('stalled'),
            });
            const first = catalog.fetch();
            await flush();
            resolve(0, { courses: [entry(1, 'Cached')] });
            await first;
            clock.tick(MINUTE);

            pending = true;
            const revalidated = catalog.fetch({ revalidate: true });
            await flush();
            assert.strictEqual(callCount(), 1, 'nothing is asked while the identity is resolving');
            settle('anonymous');
            await revalidated;
            assert.strictEqual(callCount(), 1);
        });
    });

    suite('identity gate', () => {
        const flush = () => new Promise<void>(resolve => setImmediate(resolve));

        /** The production wiring: the transition resets the catalog to its epoch. */
        function wired(api: ArtemisApiService): { coordinator: SessionIdentityCoordinator; catalog: CourseCatalog } {
            const coordinator = new SessionIdentityCoordinator({
                serverKey: () => 'https://a.example',
                hasAuthToken: async () => true,
                getCurrentUser: async () => ({ id: 1 }),
            });
            const catalog = new CourseCatalog(api, coordinator);
            coordinator.attach({
                resetConversation: () => undefined,
                endTelemetrySession: () => undefined,
                clearWorkspaceTracker: () => undefined,
                clearCatalog: () => catalog.resetTo(coordinator.epoch),
                resetRegistry: () => undefined,
                publishEmptyChatSnapshot: () => undefined,
                rearmStartup: () => undefined,
            });
            return { coordinator, catalog };
        }

        test('a fetch during sign-in asks only after the identity is known, and its courses stay', async () => {
            const { api, resolve, callCount } = fakeApi();
            const { coordinator, catalog } = wired(api);
            const fetched = catalog.fetch();
            await flush();
            assert.strictEqual(callCount(), 0, 'nothing is asked while the identity is resolving');

            coordinator.setAuthenticated('https://a.example', 'id:1');
            await flush();
            assert.strictEqual(callCount(), 1);
            resolve(0, { courses: [entry(1, 'Enrolled')] });

            assert.deepStrictEqual((await fetched)?.courses?.map(c => c.course?.id), [1]);
            assert.strictEqual(catalog.dashboardLoaded, true);
            coordinator.dispose();
        });

        test('two callers waiting across the transition share one request', async () => {
            const { api, resolve, callCount } = fakeApi();
            const { coordinator, catalog } = wired(api);
            const first = catalog.fetch();
            const second = catalog.fetch();
            coordinator.setAuthenticated('https://a.example', 'id:1');
            await flush();
            assert.strictEqual(callCount(), 1);
            resolve(0, { courses: [entry(1, 'Enrolled')] });
            await Promise.all([first, second]);
            assert.deepStrictEqual(catalog.projection().courses.map(c => c.id), [1]);
            coordinator.dispose();
        });

        test('an anonymous session asks nothing', async () => {
            const { api, callCount } = fakeApi();
            const { coordinator, catalog } = wired(api);
            coordinator.setAnonymous('https://a.example');
            assert.strictEqual(await catalog.fetch(), undefined);
            assert.strictEqual(callCount(), 0);
            coordinator.dispose();
        });

        test('a stalled identity still fetches, as before', async () => {
            const { api, resolve, callCount } = fakeApi();
            const catalog = new CourseCatalog(api, { whenSettled: async () => 'stalled' });
            const fetched = catalog.fetch();
            await flush();
            assert.strictEqual(callCount(), 1);
            resolve(0, { courses: [entry(1, 'Enrolled')] });
            assert.strictEqual((await fetched)?.courses?.length, 1);
        });

        test('the cache is not handed out while a new identity question is open', async () => {
            const { api, resolve } = fakeApi();
            let settle: (o: SettledOutcome) => void = () => undefined;
            let pending = false;
            const catalog = new CourseCatalog(api, {
                whenSettled: () => pending ? new Promise(r => { settle = r; }) : Promise.resolve('stalled'),
            });
            const first = catalog.fetch();
            await flush();
            resolve(0, { courses: [entry(1, 'Cached')] });
            await first;

            pending = true;
            let answered = false;
            const second = catalog.fetch().then(r => { answered = true; return r; });
            await flush();
            assert.strictEqual(answered, false, 'the cached list waits for the identity');
            settle('authenticated');
            assert.strictEqual((await second)?.courses?.length, 1);
        });

        test('a catalog holding only a partial supplemental record has no dashboard answer', () => {
            const catalog = new CourseCatalog({} as ArtemisApiService);
            catalog.upsertSupplemental({ kind: 'partial-course', id: 1, title: 'Opened alone' }, 0);
            assert.deepStrictEqual(catalog.get()?.courses, []);
            assert.strictEqual(catalog.dashboardLoaded, false);
        });
    });
});
