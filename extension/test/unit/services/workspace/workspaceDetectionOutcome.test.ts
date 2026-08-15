import * as assert from 'assert';
import * as sinon from 'sinon';

import type { CourseCatalog } from '@extension/services/courseCatalog';
import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import {
    detectAndRegisterWorkspaceExercise,
    detectWorkspaceExerciseForRepository,
    searchArchivedCoursesForRepository,
} from '@extension/services/workspace/workspaceDetectionService';

const REPO_URL = 'https://artemis.example/git/AB/ab-student.git';

function emptyRegistry(): ExerciseRegistry {
    return { getAllExercises: () => [], registerFromCourseData: () => undefined } as unknown as ExerciseRegistry;
}

suite('detectAndRegisterWorkspaceExercise outcome', () => {
    let sandbox: sinon.SinonSandbox;
    setup(() => { sandbox = sinon.createSandbox(); });
    teardown(() => { sandbox.restore(); });

    // Both of these MUST inject the resolver. The unit runner launches with no
    // workspace folder (`.vscode-test.mjs:20` passes only `--user-data-dir`),
    // so the real `getWorkspaceRepositoryUrl()` answers null and the wrapper
    // would short-circuit to no-match without ever reaching the branch under
    // test.

    test('an unreachable dashboard reports unavailable and does not clear the workspace', async () => {
        const clearStaleWorkspaceContext = sinon.spy();
        const fetch = sinon.stub().resolves(undefined);
        const cache = { fetch } as unknown as CourseCatalog;

        const outcome = await detectAndRegisterWorkspaceExercise(
            undefined,
            { registerExercise: () => undefined, clearStaleWorkspaceContext },
            emptyRegistry(),
            cache,
            async () => REPO_URL,
        );

        assert.strictEqual(fetch.calledOnce, true, 'the dashboard branch was never reached');
        assert.strictEqual(outcome.kind, 'unavailable');
        assert.strictEqual(clearStaleWorkspaceContext.called, false,
            'an unreachable server must not be reported as "no exercise here"');
    });

    test('a student with zero courses is a no-match, not an outage', async () => {
        const clearStaleWorkspaceContext = sinon.spy();
        const fetch = sinon.stub().resolves({ courses: [] });
        const cache = { fetch } as unknown as CourseCatalog;

        const outcome = await detectAndRegisterWorkspaceExercise(
            undefined,
            { registerExercise: () => undefined, clearStaleWorkspaceContext },
            emptyRegistry(),
            cache,
            async () => REPO_URL,
        );

        assert.strictEqual(fetch.calledOnce, true, 'the dashboard branch was never reached');
        assert.strictEqual(outcome.kind, 'no-match');
        assert.strictEqual(clearStaleWorkspaceContext.calledOnce, true);
    });

    test('an archived course whose detail cannot be read reports unreachable', async () => {
        const getCourseForDashboard = sinon.stub().rejects(new Error('offline'));
        const api = { getCourseForDashboard } as never;

        const result = await searchArchivedCoursesForRepository(
            api, 'https://artemis.example/git/AB/ab-student.git', [{ id: 1 } as never],
        );

        assert.strictEqual(getCourseForDashboard.calledOnce, true,
            'the probe must actually have been attempted');
        assert.strictEqual(result.entry, undefined);
        assert.strictEqual(result.reachable, false,
            'the archive is where the match would have been; failing to read it is not proof of absence');
    });

    test('an archive searched successfully with no hit is reachable', async () => {
        const api = { getCourseForDashboard: async () => ({ course: { id: 1 }, exercises: [] }) } as never;

        const result = await searchArchivedCoursesForRepository(
            api, 'https://artemis.example/git/AB/ab-student.git', [{ id: 1 } as never],
        );

        assert.strictEqual(result.entry, undefined);
        assert.strictEqual(result.reachable, true);
    });

    test('an exercise with no course is not made the workspace exercise', async () => {
        const registerExercise = sinon.spy();
        const clearStaleWorkspaceContext = sinon.spy();
        const cache = { fetch: async () => ({ courses: [] }) } as unknown as CourseCatalog;
        // The orphan is already in the registry and matches REPO_URL, so the
        // core reaches the courseId branch deterministically.
        const registry = {
            getAllExercises: () => [{ id: 4, title: 'Orphan', repositoryUri: REPO_URL, courseId: undefined }],
            registerFromCourseData: () => undefined,
        } as unknown as ExerciseRegistry;

        const outcome = await detectWorkspaceExerciseForRepository(
            REPO_URL,
            undefined,
            { registerExercise, clearStaleWorkspaceContext },
            registry,
            cache,
        );

        assert.strictEqual(outcome.kind, 'no-match');
        assert.strictEqual(registerExercise.called, false,
            'a non-null workspaceExerciseId would suppress the cold-start chooser the student needs');
        assert.strictEqual(clearStaleWorkspaceContext.calledOnce, true);
    });

    test('a folder with no git remote is a no-match even when the server is down', async () => {
        const clearStaleWorkspaceContext = sinon.spy();
        const cache = { fetch: async () => undefined } as unknown as CourseCatalog;

        const outcome = await detectAndRegisterWorkspaceExercise(
            undefined,
            { registerExercise: () => undefined, clearStaleWorkspaceContext },
            emptyRegistry(),
            cache,
            async () => null,               // the injected resolver
        );

        assert.strictEqual(outcome.kind, 'no-match',
            'whether this folder is an exercise checkout does not depend on the server');
        assert.strictEqual(clearStaleWorkspaceContext.calledOnce, true);
    });

    test('an unexpected throw is unavailable, never a silent no-match', async () => {
        const clearStaleWorkspaceContext = sinon.spy();
        const registry = { getAllExercises: () => { throw new Error('boom'); } } as unknown as ExerciseRegistry;

        const outcome = await detectAndRegisterWorkspaceExercise(
            undefined,
            { registerExercise: () => undefined, clearStaleWorkspaceContext },
            registry,
            undefined,
            async () => REPO_URL,
        );

        assert.strictEqual(outcome.kind, 'unavailable');
        assert.strictEqual(clearStaleWorkspaceContext.called, false);
    });
});
