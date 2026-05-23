import { MockMemento } from '@test/unit/mocks/vscodeMocks';
import * as assert from 'assert';

import {
    COURSE_ACCESS_DISPLAY_LIMIT,
    COURSE_ACCESS_STORAGE_LIMIT,
    type CourseAccessMap,
    type CourseAccessScope,
    CourseAccessStorageService,
} from '@extension/services/courseAccessStorageService';

function waitFor(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

suite('CourseAccessStorageService', () => {
    let memento: MockMemento;
    let scope: CourseAccessScope;
    let service: CourseAccessStorageService;

    setup(() => {
        memento = new MockMemento();
        scope = { serverUrl: 'https://artemis.example.com', principal: { id: 42 } };
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

    test('scope isolation: different serverUrl uses different bucket', async () => {
        let activeScope: CourseAccessScope = { serverUrl: 'https://a.example.com', principal: { id: 1 } };
        const svc = new CourseAccessStorageService(memento, () => activeScope);
        svc.onCourseAccessed(10);
        await waitFor(5);
        activeScope = { serverUrl: 'https://b.example.com', principal: { id: 1 } };
        assert.deepStrictEqual(svc.getLastAccessedCourses(), []);
        svc.onCourseAccessed(20);
        await waitFor(5);
        assert.deepStrictEqual(svc.getLastAccessedCourses(), [20]);
        activeScope = { serverUrl: 'https://a.example.com', principal: { id: 1 } };
        assert.deepStrictEqual(svc.getLastAccessedCourses(), [10]);
    });

    test('scope isolation: different userId uses different bucket', async () => {
        let active: CourseAccessScope = { serverUrl: 'https://artemis.example.com', principal: { id: 1 } };
        const svc = new CourseAccessStorageService(memento, () => active);
        svc.onCourseAccessed(100);
        await waitFor(5);
        active = { serverUrl: 'https://artemis.example.com', principal: { id: 2 } };
        assert.deepStrictEqual(svc.getLastAccessedCourses(), []);
    });

    test('no scope available → write is no-op, read is empty', async () => {
        const svc = new CourseAccessStorageService(memento, () => null);
        svc.onCourseAccessed(999);
        await waitFor(5);
        assert.strictEqual(memento.keys().length, 0);
        assert.deepStrictEqual(svc.getLastAccessedCourses(), []);
    });

    test('serverUrl normalization: case, trailing slash, default port map to same bucket', async () => {
        let active: CourseAccessScope = { serverUrl: 'https://Artemis.Example.com/', principal: { id: 1 } };
        const writer = new CourseAccessStorageService(memento, () => active);
        writer.onCourseAccessed(42);
        await waitFor(5);

        // Read back via differently-spelled but equivalent URLs
        for (const variant of ['https://artemis.example.com', 'https://artemis.example.com:443']) {
            active = { serverUrl: variant, principal: { id: 1 } };
            assert.deepStrictEqual(writer.getLastAccessedCourses(), [42], `variant "${variant}" should hit the same bucket`);
        }
    });

    test('principal normalization: login lowercase and id/login buckets are distinct', async () => {
        let active: CourseAccessScope = { serverUrl: 'https://a.example.com', principal: { login: 'LIAM' } };
        const writer = new CourseAccessStorageService(memento, () => active);
        writer.onCourseAccessed(1);
        await waitFor(5);

        active = { serverUrl: 'https://a.example.com', principal: { login: 'liam' } };
        assert.deepStrictEqual(writer.getLastAccessedCourses(), [1], 'login case should not matter');

        active = { serverUrl: 'https://a.example.com', principal: { id: 7, login: 'liam' } };
        assert.deepStrictEqual(writer.getLastAccessedCourses(), [], 'id-principal is a different bucket from login-principal');
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
        // Do NOT await — the shadow should already contain the value
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
});
