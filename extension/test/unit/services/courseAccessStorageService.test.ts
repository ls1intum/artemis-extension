import * as assert from 'assert';

import {
    COURSE_ACCESS_DISPLAY_LIMIT,
    COURSE_ACCESS_STORAGE_LIMIT,
    type CourseAccessMap,
    type CourseAccessScope,
    CourseAccessStorageService,
} from '@extension/services/courseAccessStorageService';
import { MockMemento } from '@test/unit/mocks/vscodeMocks';

function waitFor(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

suite('CourseAccessStorageService', () => {
    let memento: MockMemento;
    let scope: CourseAccessScope;
    let service: CourseAccessStorageService;

    setup(() => {
        memento = new MockMemento();
        scope = { serverKey: 'https://artemis.example.com', principal: 'id:42' };
        service = new CourseAccessStorageService(memento, () => scope);
    });

    test('empty store returns empty array', () => {
        assert.deepStrictEqual(service.getLastAccessedCourses(), []);
    });

    test('single write returns single id', () => {
        service.onCourseAccessed(101);
        assert.deepStrictEqual(service.getLastAccessedCourses(), [101]);
    });

    test('three accesses return most recent first', async () => {
        service.onCourseAccessed(1);
        await waitFor(5);
        service.onCourseAccessed(2);
        await waitFor(5);
        service.onCourseAccessed(3);
        assert.deepStrictEqual(service.getLastAccessedCourses(), [3, 2, 1]);
    });

    test('re-access bumps course to front without eviction', async () => {
        service.onCourseAccessed(1);
        await waitFor(5);
        service.onCourseAccessed(2);
        await waitFor(5);
        service.onCourseAccessed(3);
        await waitFor(5);
        service.onCourseAccessed(1);
        assert.deepStrictEqual(service.getLastAccessedCourses(), [1, 3, 2]);
    });

    test(`storage evicts oldest once size exceeds ${COURSE_ACCESS_STORAGE_LIMIT}`, async () => {
        const ids = Array.from({ length: COURSE_ACCESS_STORAGE_LIMIT + 1 }, (_, i) => i + 1);
        for (const id of ids) {
            service.onCourseAccessed(id);
            await waitFor(2);
        }
        await waitFor(10);
        const keys = memento.keys();
        assert.strictEqual(keys.length, 1);
        const remaining = memento.get<CourseAccessMap>(keys[0]!, {});
        assert.strictEqual(Object.keys(remaining).length, COURSE_ACCESS_STORAGE_LIMIT);
        assert.ok(!(1 in remaining), 'oldest id should be evicted');
        assert.ok(String(ids.at(-1)) in remaining, 'newest id should be present');
    });

    test(`display limit caps to ${COURSE_ACCESS_DISPLAY_LIMIT}`, async () => {
        for (let i = 1; i <= 5; i++) {
            service.onCourseAccessed(i);
            await waitFor(2);
        }
        const recent = service.getLastAccessedCourses();
        assert.strictEqual(recent.length, COURSE_ACCESS_DISPLAY_LIMIT);
        assert.deepStrictEqual(recent, [5, 4, 3]);
    });

    test('scope isolation: different serverKey uses different bucket', async () => {
        let activeScope: CourseAccessScope = { serverKey: 'https://a.example.com', principal: 'id:1' };
        const svc = new CourseAccessStorageService(memento, () => activeScope);
        svc.onCourseAccessed(10);
        await waitFor(5);
        activeScope = { serverKey: 'https://b.example.com', principal: 'id:1' };
        assert.deepStrictEqual(svc.getLastAccessedCourses(), []);
        svc.onCourseAccessed(20);
        await waitFor(5);
        assert.deepStrictEqual(svc.getLastAccessedCourses(), [20]);
        activeScope = { serverKey: 'https://a.example.com', principal: 'id:1' };
        assert.deepStrictEqual(svc.getLastAccessedCourses(), [10]);
    });

    test('scope isolation: different principal uses different bucket', async () => {
        let active: CourseAccessScope = { serverKey: 'https://artemis.example.com', principal: 'id:1' };
        const svc = new CourseAccessStorageService(memento, () => active);
        svc.onCourseAccessed(100);
        await waitFor(5);
        active = { serverKey: 'https://artemis.example.com', principal: 'id:2' };
        assert.deepStrictEqual(svc.getLastAccessedCourses(), []);
    });

    test('no scope available: write is no-op, read is empty', async () => {
        const svc = new CourseAccessStorageService(memento, () => null);
        svc.onCourseAccessed(999);
        await waitFor(5);
        assert.strictEqual(memento.keys().length, 0);
        assert.deepStrictEqual(svc.getLastAccessedCourses(), []);
    });

    test('invalid input is ignored', async () => {
        service.onCourseAccessed(0);
        service.onCourseAccessed(-1);
        service.onCourseAccessed(NaN);
        await waitFor(5);
        assert.strictEqual(memento.keys().length, 0);
        assert.deepStrictEqual(service.getLastAccessedCourses(), []);
    });

    test('fresh read is immediate (shadow is synchronous)', () => {
        service.onCourseAccessed(555);
        // Do NOT await: the shadow should already contain the value
        assert.deepStrictEqual(service.getLastAccessedCourses(), [555]);
    });

    test('persistence failure does not break subsequent writes', async () => {
        let shouldFail = true;
        const failingMemento = {
            get: memento.get.bind(memento),
            update: async (key: string, value: unknown) => {
                if (shouldFail) { shouldFail = false; throw new Error('disk full'); }
                await memento.update(key, value);
            },
        } as unknown as import('vscode').Memento;
        const svc = new CourseAccessStorageService(failingMemento, () => scope);
        svc.onCourseAccessed(1);
        await waitFor(10);
        svc.onCourseAccessed(2);
        await waitFor(10);
        assert.deepStrictEqual(svc.getLastAccessedCourses(), [2, 1]);
    });

    test('getAccessTimestamp returns the recorded time for a stored course', async () => {
        const before = Date.now();
        service.onCourseAccessed(42);
        await waitFor(5);
        const ts = service.getAccessTimestamp(42);
        assert.ok(ts !== undefined && ts >= before, 'timestamp should be recorded and recent');
    });

    test('getAccessTimestamp returns undefined for a course outside the stored window', () => {
        assert.strictEqual(service.getAccessTimestamp(9999), undefined);
    });

    test('getAccessTimestamp returns undefined when no scope is available', () => {
        const svc = new CourseAccessStorageService(memento, () => null);
        assert.strictEqual(svc.getAccessTimestamp(1), undefined);
    });
});
