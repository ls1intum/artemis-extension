import * as assert from 'assert';
import {
    CourseAccessStorageService,
    COURSE_ACCESS_STORAGE_LIMIT,
    COURSE_ACCESS_DISPLAY_LIMIT,
    buildScopeKey,
    type CourseAccessMap,
    type CourseAccessScope,
} from '../../../src/extension/services/courseAccessStorageService';

class InMemoryMemento {
    private readonly _store = new Map<string, unknown>();
    public updateCalls = 0;

    get<T>(key: string, defaultValue: T): T {
        return (this._store.has(key) ? this._store.get(key) : defaultValue) as T;
    }

    async update(key: string, value: unknown): Promise<void> {
        this.updateCalls++;
        if (value === undefined) {
            this._store.delete(key);
        } else {
            this._store.set(key, value);
        }
    }

    keys(): readonly string[] { return Array.from(this._store.keys()); }
    snapshot(): Map<string, unknown> { return new Map(this._store); }
}

function waitFor(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

suite('CourseAccessStorageService', () => {
    let memento: InMemoryMemento;
    let scope: CourseAccessScope;
    let service: CourseAccessStorageService;

    setup(() => {
        memento = new InMemoryMemento();
        scope = { serverUrl: 'https://artemis.example.com', principal: { id: 42 } };
        service = new CourseAccessStorageService(memento as unknown as import('vscode').Memento, () => scope);
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
        // Flush: last update must have dropped id=1
        await waitFor(10);
        const remaining = memento.get<CourseAccessMap>(buildScopeKey(scope)!, {});
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
        const svc = new CourseAccessStorageService(memento as unknown as import('vscode').Memento, () => activeScope);
        svc.onCourseAccessed(10);
        await waitFor(5);
        activeScope = { serverUrl: 'https://b.example.com', principal: { id: 1 } };
        assert.deepStrictEqual(svc.getLastAccessedCourses(), []);
        svc.onCourseAccessed(20);
        await waitFor(5);
        assert.deepStrictEqual(svc.getLastAccessedCourses(), [20]);
        // Restore scope A → original data still there
        activeScope = { serverUrl: 'https://a.example.com', principal: { id: 1 } };
        assert.deepStrictEqual(svc.getLastAccessedCourses(), [10]);
    });

    test('scope isolation: different userId uses different bucket', async () => {
        let active: CourseAccessScope = { serverUrl: 'https://artemis.example.com', principal: { id: 1 } };
        const svc = new CourseAccessStorageService(memento as unknown as import('vscode').Memento, () => active);
        svc.onCourseAccessed(100);
        await waitFor(5);
        active = { serverUrl: 'https://artemis.example.com', principal: { id: 2 } };
        assert.deepStrictEqual(svc.getLastAccessedCourses(), []);
    });

    test('no scope available → write is no-op, read is empty', async () => {
        const svc = new CourseAccessStorageService(memento as unknown as import('vscode').Memento, () => null);
        svc.onCourseAccessed(999);
        await waitFor(5);
        assert.strictEqual(memento.updateCalls, 0);
        assert.deepStrictEqual(svc.getLastAccessedCourses(), []);
    });

    test('serverUrl normalization: case + trailing slash + default port', () => {
        const k1 = buildScopeKey({ serverUrl: 'https://Artemis.Example.com/', principal: { id: 1 } });
        const k2 = buildScopeKey({ serverUrl: 'https://artemis.example.com', principal: { id: 1 } });
        const k3 = buildScopeKey({ serverUrl: 'https://artemis.example.com:443', principal: { id: 1 } });
        assert.strictEqual(k1, k2);
        assert.strictEqual(k1, k3);
    });

    test('principal normalization: id preferred, login falls back with lowercase', () => {
        const byId = buildScopeKey({ serverUrl: 'https://a.example.com', principal: { id: 7, login: 'Liam' } });
        const byLogin = buildScopeKey({ serverUrl: 'https://a.example.com', principal: { login: 'LIAM' } });
        const byLoginLc = buildScopeKey({ serverUrl: 'https://a.example.com', principal: { login: 'liam' } });
        assert.ok(byId);
        assert.ok(byLogin);
        assert.notStrictEqual(byId, byLogin);
        assert.strictEqual(byLogin, byLoginLc);
    });

    test('invalid input is ignored', async () => {
        service.onCourseAccessed(0);
        service.onCourseAccessed(-1);
        service.onCourseAccessed(NaN);
        await waitFor(5);
        assert.strictEqual(memento.updateCalls, 0);
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
        // First persist failed, shadow still has both, in-memory reads work
        assert.deepStrictEqual(svc.getLastAccessedCourses(), [2, 1]);
    });
});
