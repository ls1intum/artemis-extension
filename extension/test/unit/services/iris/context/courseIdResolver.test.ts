import * as assert from 'assert';
import * as sinon from 'sinon';

import { resolveCourseIdForExercise } from '@extension/services/iris/context/courseIdResolver';

function makeContextStore(overrides: any = {}): any {
    return {
        getExerciseById: sinon.stub().returns(undefined),
        registerExercise: sinon.stub(),
        ...overrides,
    };
}

function makeApi(overrides: any = {}): any {
    return {
        getExerciseDetails: sinon.stub().rejects(new Error('not stubbed')),
        ...overrides,
    };
}

/**
 * The exercise-keyed resolver is the only one: every caller knows an exercise
 * id, never a selected context (spec 10).
 */
suite('resolveCourseIdForExercise', () => {
    test('the tracked exercise answers without a request', async () => {
        const store = makeContextStore({
            getExerciseById: sinon.stub().withArgs(123).returns({ id: 123, title: 'E', courseId: 9 }),
        });
        const api = makeApi();

        const id = await resolveCourseIdForExercise(123, store, api);

        assert.strictEqual(id, 9);
        assert.strictEqual((api.getExerciseDetails as sinon.SinonStub).callCount, 0);
    });

    test('falls back to getExerciseDetails and registers the exercise under the SERVER title', async () => {
        // The title is load-bearing: the store row is what the pickers and the
        // header read, and an exercise the store has never seen is exactly the
        // fresh-window case this function exists for.
        const store = makeContextStore();
        const api = makeApi({
            getExerciseDetails: sinon.stub().withArgs(123).resolves({
                exercise: { title: 'Breadth First Search', shortName: 'BFS', course: { id: 11 } },
            }),
        });

        const id = await resolveCourseIdForExercise(123, store, api);

        assert.strictEqual(id, 11);
        assert.ok((store.registerExercise as sinon.SinonStub).calledOnceWith(
            sinon.match({ id: 123, courseId: 11, title: 'Breadth First Search', shortName: 'BFS' }),
        ));
    });

    test('keeps the tracked title when the details response carries none', async () => {
        const store = makeContextStore({
            getExerciseById: sinon.stub().withArgs(123).returns({ id: 123, title: 'Known title' }),
        });
        const api = makeApi({
            getExerciseDetails: sinon.stub().resolves({ exercise: { course: { id: 11 } } }),
        });

        await resolveCourseIdForExercise(123, store, api);

        assert.ok((store.registerExercise as sinon.SinonStub).calledOnceWith(
            sinon.match({ id: 123, title: 'Known title' }),
        ));
    });

    test('falls back to a placeholder title only when nothing else has one', async () => {
        const store = makeContextStore();
        const api = makeApi({
            getExerciseDetails: sinon.stub().resolves({ exercise: { course: { id: 11 } } }),
        });

        await resolveCourseIdForExercise(123, store, api);

        assert.ok((store.registerExercise as sinon.SinonStub).calledOnceWith(
            sinon.match({ id: 123, title: 'Exercise 123' }),
        ));
    });

    test('returns undefined with no api', async () => {
        const id = await resolveCourseIdForExercise(123, makeContextStore(), undefined);
        assert.strictEqual(id, undefined);
    });

    test('returns undefined when nothing resolves, and registers nothing', async () => {
        const store = makeContextStore();
        const api = makeApi({ getExerciseDetails: sinon.stub().resolves({}) });

        const id = await resolveCourseIdForExercise(123, store, api);

        assert.strictEqual(id, undefined);
        assert.strictEqual((store.registerExercise as sinon.SinonStub).callCount, 0);
    });

    test('returns undefined when getExerciseDetails throws', async () => {
        const api = makeApi({ getExerciseDetails: sinon.stub().rejects(new Error('boom')) });
        const id = await resolveCourseIdForExercise(123, makeContextStore(), api);
        assert.strictEqual(id, undefined);
    });
});

/** The adapter the surviving old-model call sites still use. */
