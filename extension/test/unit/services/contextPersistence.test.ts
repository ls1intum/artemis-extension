import * as assert from 'assert';
import * as vscode from 'vscode';
import { ContextPersistence } from '@extension/services/iris/context/contextPersistence';
import { MockExtensionContext } from '../mocks/vscodeMocks';

suite('ContextPersistence Migration', () => {
    let mockContext: MockExtensionContext;

    setup(() => {
        mockContext = new MockExtensionContext();
    });

    test('default state when nothing stored is v2 with empty lists', () => {
        const p = new ContextPersistence(mockContext as unknown as vscode.ExtensionContext);
        const loaded = p.load();
        assert.strictEqual(loaded.version, 2);
        assert.deepStrictEqual(loaded.exercises, []);
        assert.deepStrictEqual(loaded.courses, []);
        assert.deepStrictEqual(loaded.sessions, {});
        assert.strictEqual(loaded.activeSessionId, null);
    });

    test('migrates v1 by union-merging recent + all, stripping priority/lastUpdated', () => {
        const v1 = {
            version: 1,
            activeContext: null,
            activeSessionId: null,
            recentExercises: [
                { id: 1, title: 'A', priority: 999, lastUpdated: 50, lastViewed: 200 },
                { id: 2, title: 'B', priority: 0, lastUpdated: 30, lastViewed: 100 },
            ],
            allExercises: [
                { id: 1, title: 'A-rich', shortName: 'a', priority: 100, lastUpdated: 60, lastViewed: 150 },
                { id: 3, title: 'C', priority: 10, lastUpdated: 10 },
            ],
            recentCourses: [{ id: 10, title: 'CR', priority: 1, lastUpdated: 1 }],
            allCourses: [
                { id: 10, title: 'C-rich', shortName: 'cr', priority: 2, lastUpdated: 2 },
                { id: 11, title: 'D', priority: 3, lastUpdated: 3 },
            ],
            sessions: { 'exercise:1': [{ id: 's1' }] },
        };
        mockContext.globalState.update('iris.contextStore', v1);

        const p = new ContextPersistence(mockContext as unknown as vscode.ExtensionContext);
        const loaded = p.load();

        assert.strictEqual(loaded.version, 2);

        const ids = loaded.exercises.map(e => e.id).sort();
        assert.deepStrictEqual(ids, [1, 2, 3]);

        const merged = loaded.exercises.find(e => e.id === 1)!;
        assert.strictEqual(merged.title, 'A-rich');
        assert.strictEqual(merged.shortName, 'a');
        assert.strictEqual(merged.lastViewed, 200);
        assert.strictEqual((merged as { priority?: number }).priority, undefined);
        assert.strictEqual((merged as { lastUpdated?: number }).lastUpdated, undefined);

        assert.deepStrictEqual(loaded.sessions, {});
        assert.strictEqual(loaded.activeSessionId, null);

        const persisted = mockContext.globalState.get('iris.contextStore') as { version: number; recentExercises?: unknown };
        assert.strictEqual(persisted.version, 2);
        assert.strictEqual(persisted.recentExercises, undefined);
    });

    test('handles partial v1 with only recentExercises (no all*)', () => {
        const v1 = {
            version: 1,
            recentExercises: [{ id: 7, title: 'Solo', priority: 5, lastUpdated: 1 }],
        };
        mockContext.globalState.update('iris.contextStore', v1);
        const p = new ContextPersistence(mockContext as unknown as vscode.ExtensionContext);
        const loaded = p.load();
        assert.strictEqual(loaded.exercises.length, 1);
        assert.strictEqual(loaded.exercises[0]!.id, 7);
    });

    test('skips legacy items with non-numeric id', () => {
        const v1 = {
            version: 1,
            allExercises: [
                { id: 'bad', title: 'Bad' },
                { id: 5, title: 'Good' },
            ],
        };
        mockContext.globalState.update('iris.contextStore', v1);
        const p = new ContextPersistence(mockContext as unknown as vscode.ExtensionContext);
        const loaded = p.load();
        assert.strictEqual(loaded.exercises.length, 1);
        assert.strictEqual(loaded.exercises[0]!.id, 5);
    });
});
