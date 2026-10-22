import * as assert from 'assert';
import * as path from 'path';
import * as sinon from 'sinon';

import { LocalCloneStore } from '@extension/services/workspace';
import { MockMemento } from '@test/unit/mocks/vscodeMocks';

const REPO = 'https://artemis.example.com/git/PROG/prog-alice.git';

suite('LocalCloneStore', () => {
    let memento: MockMemento;
    let origins: Map<string, string>;
    let directories: Set<string>;
    let defaultClonePath: string;

    function makeStore(): LocalCloneStore {
        return new LocalCloneStore(memento, {
            readOriginUrl: async (fsPath) => origins.get(fsPath) ?? null,
            isDirectory: async (fsPath) => directories.has(fsPath),
            getDefaultClonePath: () => defaultClonePath,
        });
    }

    function addClone(fsPath: string, origin: string): void {
        directories.add(fsPath);
        origins.set(fsPath, origin);
    }

    setup(() => {
        memento = new MockMemento();
        origins = new Map();
        directories = new Set();
        defaultClonePath = '';
    });

    test('finds a remembered clone whose origin is the repository', async () => {
        addClone('/work/prog', 'https://alice@artemis.example.com/git/PROG/prog-alice.git');
        const store = makeStore();

        await store.remember(REPO, '/work/prog');

        assert.strictEqual(await store.find(REPO), '/work/prog');
    });

    test('rejects and forgets a remembered folder that now holds another repository', async () => {
        addClone('/work/prog', 'https://artemis.example.com/git/OTHER/other-alice.git');
        const store = makeStore();
        await store.remember(REPO, '/work/prog');

        assert.strictEqual(await store.find(REPO), undefined);
        assert.deepStrictEqual(memento.get('artemis.localClones'), {});
    });

    test('rejects a remembered folder that no longer exists', async () => {
        const store = makeStore();
        await store.remember(REPO, '/work/gone');

        assert.strictEqual(await store.find(REPO), undefined);
    });

    test('falls back to the repository-named folder in the default clone path', async () => {
        defaultClonePath = '/clones';
        addClone(path.join('/clones', 'prog-alice'), REPO);

        assert.strictEqual(await makeStore().find(REPO), path.join('/clones', 'prog-alice'));
    });

    test('a failing git lookup counts as no clone instead of throwing', async () => {
        defaultClonePath = '/clones';
        directories.add(path.join('/clones', 'prog-alice'));
        const store = new LocalCloneStore(memento, {
            readOriginUrl: sinon.stub().rejects(new Error('dubious ownership')),
            isDirectory: async (fsPath) => directories.has(fsPath),
            getDefaultClonePath: () => defaultClonePath,
        });

        assert.strictEqual(await store.find(REPO), undefined);
    });

    test('a failing state read neither rejects remember nor find', async () => {
        sinon.stub(memento, 'get').throws(new Error('storage unavailable'));
        const store = makeStore();

        await store.remember(REPO, '/work/prog');
        assert.strictEqual(await store.find(REPO), undefined);
    });

    test('a failing configuration read counts as no clone', async () => {
        const store = new LocalCloneStore(memento, {
            readOriginUrl: async () => null,
            isDirectory: async () => false,
            getDefaultClonePath: () => { throw new Error('configuration unavailable'); },
        });

        assert.strictEqual(await store.find(REPO), undefined);
    });

    test('keeps the 50 most recent clones', async () => {
        const store = makeStore();
        for (let i = 0; i < 51; i++) {
            await store.remember(`https://artemis.example.com/git/P/p-${i}.git`, `/work/p-${i}`);
        }

        const stored = memento.get<Record<string, string>>('artemis.localClones') ?? {};
        assert.strictEqual(Object.keys(stored).length, 50);
        assert.ok(!Object.values(stored).includes('/work/p-0'), 'the oldest clone is evicted');
        assert.ok(Object.values(stored).includes('/work/p-50'));
    });

    test('re-remembering a repository makes it the newest entry', async () => {
        const store = makeStore();
        await store.remember(REPO, '/work/old');
        for (let i = 0; i < 49; i++) {
            await store.remember(`https://artemis.example.com/git/P/p-${i}.git`, `/work/p-${i}`);
        }
        await store.remember(REPO, '/work/new');
        await store.remember('https://artemis.example.com/git/P/p-49.git', '/work/p-49');

        const stored = memento.get<Record<string, string>>('artemis.localClones') ?? {};
        assert.ok(Object.values(stored).includes('/work/new'));
        assert.ok(!Object.values(stored).includes('/work/p-0'));
    });

    suite('hasCloneOfDisplayedParticipation', () => {
        const graded = { repositoryUri: 'https://artemis.example.com/git/PROG/prog-alice.git', testRun: false };
        const practice = { repositoryUri: 'https://artemis.example.com/git/PROG/prog-practice-alice.git', testRun: true };

        test('is true when the graded participation shown while disconnected has a clone', async () => {
            addClone('/work/graded', graded.repositoryUri);
            const store = makeStore();
            await store.remember(graded.repositoryUri, '/work/graded');

            assert.strictEqual(await store.hasCloneOfDisplayedParticipation([practice, graded]), true);
        });

        test('is false when only the practice repository is cloned but a graded one exists', async () => {
            addClone('/work/practice', practice.repositoryUri);
            const store = makeStore();
            await store.remember(practice.repositoryUri, '/work/practice');

            assert.strictEqual(await store.hasCloneOfDisplayedParticipation([graded, practice]), false);
        });

        test('is false without participations', async () => {
            assert.strictEqual(await makeStore().hasCloneOfDisplayedParticipation(undefined), false);
        });
    });
});
