import * as assert from 'assert';
import * as sinon from 'sinon';

import { CourseCatalog } from '@extension/services/courseCatalog';
import { resolveCourseIdForExercise } from '@extension/services/iris/context/courseIdResolver';
import type { CourseDashboardEntry } from '@extension/types';

/**
 * A catalog seeded through its real, public surface: `injectEntry` puts a
 * dashboard-shaped entry into the supplemental `course` layer, exactly the
 * layer `authoritativeCourseIdFor` is specified to read. Going through the
 * real `CourseCatalog` (rather than a hand-rolled stub) is what makes the
 * mutation check in this suite meaningful: it exercises the production
 * `authoritativeCourseIdFor` implementation, not a test double of it.
 */
function fakeCatalog(options: { exercises: Array<{ id: number; courseId: number; title: string; pickable: boolean }> }): CourseCatalog {
    const catalog = new CourseCatalog({} as never);
    const byCourse = new Map<number, CourseDashboardEntry>();
    for (const ex of options.exercises) {
        let entry = byCourse.get(ex.courseId);
        if (!entry) {
            entry = { course: { id: ex.courseId, title: `Course ${ex.courseId}`, exercises: [] } };
            byCourse.set(ex.courseId, entry);
        }
        entry.course?.exercises?.push({
            id: ex.id,
            title: ex.title,
            studentParticipations: ex.pickable ? [{ id: 1, repositoryUri: 'https://example.test/repo.git' }] : [],
        });
    }
    for (const entry of byCourse.values()) { catalog.injectEntry(entry, catalog.currentEpoch); }
    return catalog;
}

/**
 * A catalog whose only knowledge of the exercise is a `partial-exercise`
 * supplemental record, the shape produced by an individually opened exercise
 * or a history row. `authoritativeCourseIdFor` is specified to never read it.
 */
function fakeCatalogWithPartial(record: { id: number; courseId: number }): CourseCatalog {
    const catalog = new CourseCatalog({} as never);
    catalog.upsertSupplemental(
        { kind: 'partial-exercise', id: record.id, courseId: record.courseId, title: 'Partial' },
        catalog.currentEpoch,
    );
    return catalog;
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
    test('answers from the catalog without asking the server', async () => {
        const catalog = fakeCatalog({ exercises: [{ id: 5, courseId: 42, title: 'E', pickable: true }] });
        const api = { getExerciseDetails: sinon.stub() };

        assert.strictEqual(await resolveCourseIdForExercise(5, catalog, api as never), 42);
        assert.strictEqual(api.getExerciseDetails.callCount, 0);
    });

    test('asks the API for an exercise the catalog has no entry for', async () => {
        const catalog = fakeCatalog({ exercises: [] });
        const api = { getExerciseDetails: sinon.stub().resolves({ exercise: { id: 5, course: { id: 42 } } }) };

        assert.strictEqual(await resolveCourseIdForExercise(5, catalog, api as never), 42);
        assert.strictEqual(api.getExerciseDetails.callCount, 1);
    });

    // A partial exercise carries a `courseId` from the very response that
    // produced it, so consulting it would usually be right. The spec draws
    // the line at "no partial record is ever consulted for navigation or for
    // resolving an exercise's course" (partial records are display data), and
    // bounds the cost: `askIrisAbout` already accepts a `courseHint` and the
    // sidebar passes one on the hot path.
    test('does not answer from a partial record', async () => {
        const catalog = fakeCatalogWithPartial({ id: 5, courseId: 42 });
        const api = { getExerciseDetails: sinon.stub().resolves({ exercise: { id: 5, course: { id: 42 } } }) };

        const id = await resolveCourseIdForExercise(5, catalog, api as never);

        assert.strictEqual(id, 42, 'the API still answers, so the student is not refused; only the shortcut is refused');
        assert.strictEqual(api.getExerciseDetails.callCount, 1);
    });

    test('returns undefined when the server cannot say either', async () => {
        const catalog = fakeCatalog({ exercises: [] });
        const api = { getExerciseDetails: sinon.stub().rejects(new Error('boom')) };

        assert.strictEqual(await resolveCourseIdForExercise(5, catalog, api as never), undefined);
    });

    test('returns undefined with no api and no catalog entry', async () => {
        const catalog = fakeCatalog({ exercises: [] });

        const id = await resolveCourseIdForExercise(5, catalog, undefined);

        assert.strictEqual(id, undefined);
    });

    test('returns undefined when the API resolves with no course id', async () => {
        const catalog = fakeCatalog({ exercises: [] });
        const api = makeApi({ getExerciseDetails: sinon.stub().resolves({}) });

        const id = await resolveCourseIdForExercise(5, catalog, api);

        assert.strictEqual(id, undefined);
    });
});
