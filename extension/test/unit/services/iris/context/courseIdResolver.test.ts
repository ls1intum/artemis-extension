import * as assert from 'assert';
import * as sinon from 'sinon';
import { resolveCourseIdFromContext } from '../../../../../src/extension/services/iris/context/courseIdResolver';
import type { ActiveContext } from '../../../../../src/shared/types/context';

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

const courseContext: ActiveContext = {
    type: 'course', id: 42, title: 'C', source: 'user-selected', locked: false, selectedAt: 0,
};
const exerciseContext: ActiveContext = {
    type: 'exercise', id: 123, title: 'E', source: 'user-selected', locked: false, selectedAt: 0,
};

suite('resolveCourseIdFromContext', () => {
    test('course context returns its own id', async () => {
        const id = await resolveCourseIdFromContext(courseContext, makeContextStore(), makeApi());
        assert.strictEqual(id, 42);
    });

    test('exercise context with courseId returns it directly', async () => {
        const ctx = { ...exerciseContext, courseId: 7 };
        const id = await resolveCourseIdFromContext(ctx, makeContextStore(), makeApi());
        assert.strictEqual(id, 7);
    });

    test('falls back to contextStore when context has no courseId', async () => {
        const store = makeContextStore({
            getExerciseById: sinon.stub().withArgs(123).returns({ id: 123, title: 'E', courseId: 9 }),
        });
        const id = await resolveCourseIdFromContext(exerciseContext, store, makeApi());
        assert.strictEqual(id, 9);
    });

    test('falls back to getExerciseDetails and registers exercise on success', async () => {
        const store = makeContextStore();
        const api = makeApi({
            getExerciseDetails: sinon.stub().withArgs(123).resolves({ exercise: { course: { id: 11 } } }),
        });
        const id = await resolveCourseIdFromContext(exerciseContext, store, api);
        assert.strictEqual(id, 11);
        assert.ok((store.registerExercise as sinon.SinonStub).calledOnceWith(
            sinon.match({ id: 123, courseId: 11 }),
        ));
    });

    test('returns undefined when nothing resolves', async () => {
        const store = makeContextStore();
        const api = makeApi({ getExerciseDetails: sinon.stub().resolves({}) });
        const id = await resolveCourseIdFromContext(exerciseContext, store, api);
        assert.strictEqual(id, undefined);
    });

    test('returns undefined when getExerciseDetails throws', async () => {
        const store = makeContextStore();
        const api = makeApi({ getExerciseDetails: sinon.stub().rejects(new Error('boom')) });
        const id = await resolveCourseIdFromContext(exerciseContext, store, api);
        assert.strictEqual(id, undefined);
    });
});
