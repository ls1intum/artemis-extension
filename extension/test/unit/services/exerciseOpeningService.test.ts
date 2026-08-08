import * as assert from 'assert';

import type { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { CourseCatalog, SupplementalRecord } from '@extension/services/courseCatalog';
import type { TelemetryManager } from '@extension/services/telemetry';
import { ExerciseOpeningService } from '@extension/services/ui/exerciseOpeningService';
import type { ExerciseDetailsResponse } from '@extension/types';

class FakeCourseAccess {
    public readonly recorded: number[] = [];
    public readonly epochs: number[] = [];
    onCourseAccessed(id: number, epoch: number): void { this.recorded.push(id); this.epochs.push(epoch); }
    getLastAccessedCourses(): number[] { return this.recorded.slice().reverse(); }
}

class FakeCatalog {
    public readonly calls: Array<{ record: SupplementalRecord; epoch: number }> = [];
    /**
     * Deliberately records unconditionally. The real `upsertSupplemental` has
     * its own guard; this double must not, or a test could not tell the
     * difference between the guard in `handleExerciseOpened` and the one in
     * the catalog.
     */
    constructor(public currentEpoch = 0) {}
    upsertSupplemental(record: SupplementalRecord, epoch: number): void {
        this.calls.push({ record, epoch });
    }
}

class FakeTelemetry {
    public readonly started: number[] = [];
    startExerciseSession(exerciseId: number): void { this.started.push(exerciseId); }
}

suite('ExerciseOpeningService → CourseAccessStorage hook', () => {
    test('calls onCourseAccessed with exercise.course.id', () => {
        const storage = new FakeCourseAccess();
        const svc = new ExerciseOpeningService(
            undefined,
            undefined as unknown as TelemetryManager,
            storage as unknown as CourseAccessStorageService,
        );

        const exerciseData: ExerciseDetailsResponse = {
            exercise: {
                id: 101,
                title: 'Ex 1',
                course: { id: 42, title: 'Course 42' },
                studentParticipations: [],
            },
        } as unknown as ExerciseDetailsResponse;

        svc.handleExerciseOpened(exerciseData, 101, 0);
        assert.deepStrictEqual(storage.recorded, [42]);
    });

    test('does nothing when exercise.course.id is missing', () => {
        const storage = new FakeCourseAccess();
        const svc = new ExerciseOpeningService(
            undefined,
            undefined as unknown as TelemetryManager,
            storage as unknown as CourseAccessStorageService,
        );

        const exerciseData: ExerciseDetailsResponse = {
            exercise: {
                id: 102,
                title: 'Ex 2',
                course: undefined,
                studentParticipations: [],
            },
        } as unknown as ExerciseDetailsResponse;

        svc.handleExerciseOpened(exerciseData, 102, 0);
        assert.deepStrictEqual(storage.recorded, []);
    });

    // The recency store is persisted per account, and its scope is resolved at
    // write time. It has to be gated on the SAME captured epoch as the catalog
    // write next to it, or the two disagree about which session this is.
    test('the recency write carries the same captured epoch as the catalog write', () => {
        const storage = new FakeCourseAccess();
        const catalog = new FakeCatalog(6);
        const svc = new ExerciseOpeningService(
            catalog as unknown as CourseCatalog,
            undefined as unknown as TelemetryManager,
            storage as unknown as CourseAccessStorageService,
        );

        const exerciseData: ExerciseDetailsResponse = {
            exercise: {
                id: 104,
                title: 'Ex 4',
                course: { id: 42 },
                studentParticipations: [],
            },
        } as unknown as ExerciseDetailsResponse;

        svc.handleExerciseOpened(exerciseData, 104, 6);

        assert.deepStrictEqual(storage.epochs, [6]);
        assert.strictEqual(catalog.calls[0]?.epoch, 6);
    });

    test('works without storage service (optional param)', () => {
        const svc = new ExerciseOpeningService(
            undefined,
            undefined as unknown as TelemetryManager,
            undefined,
        );

        const exerciseData: ExerciseDetailsResponse = {
            exercise: {
                id: 103,
                title: 'Ex 3',
                course: { id: 99 },
                studentParticipations: [],
            },
        } as unknown as ExerciseDetailsResponse;

        // Should not throw when storage is undefined
        assert.doesNotThrow(() => svc.handleExerciseOpened(exerciseData, 103, 0));
    });
});

suite('ExerciseOpeningService → CourseCatalog write', () => {
    test('records the opened exercise as a partial-exercise, stamped with the epoch it was given', () => {
        const catalog = new FakeCatalog(7);
        const svc = new ExerciseOpeningService(
            catalog as unknown as CourseCatalog,
            undefined as unknown as TelemetryManager,
            undefined,
        );

        const exerciseData: ExerciseDetailsResponse = {
            exercise: {
                id: 101,
                title: 'Ex 1',
                shortName: 'e1',
                course: { id: 42 },
                dueDate: '2030-01-01T00:00:00Z',
                studentParticipations: [{ id: 5, repositoryUri: 'https://git/x' }],
            },
        } as unknown as ExerciseDetailsResponse;

        svc.handleExerciseOpened(exerciseData, 101, 7);

        assert.strictEqual(catalog.calls.length, 1);
        assert.deepStrictEqual(catalog.calls[0], {
            epoch: 7,
            record: {
                kind: 'partial-exercise',
                id: 101,
                courseId: 42,
                title: 'Ex 1',
                shortName: 'e1',
                releaseDate: undefined,
                dueDate: '2030-01-01T00:00:00Z',
                repositoryUri: 'https://git/x',
                participationId: 5,
            },
        });
    });

    // An exercise with no course id cannot be placed; writing `courseId: 0`
    // would be a made-up fact of exactly the kind the catalog exists to
    // remove, so the whole write is guarded on a real numeric course id.
    test('does not write to the catalog when the exercise has no course id', () => {
        const catalog = new FakeCatalog();
        const svc = new ExerciseOpeningService(
            catalog as unknown as CourseCatalog,
            undefined as unknown as TelemetryManager,
            undefined,
        );

        const exerciseData: ExerciseDetailsResponse = {
            exercise: {
                id: 102,
                title: 'Ex 2',
                course: undefined,
                studentParticipations: [],
            },
        } as unknown as ExerciseDetailsResponse;

        svc.handleExerciseOpened(exerciseData, 102, 0);

        assert.strictEqual(catalog.calls.length, 0);
    });
});

suite('ExerciseOpeningService: a late open that crossed an identity change', () => {
    function openWith(capturedEpoch: number, currentEpoch: number): {
        catalog: FakeCatalog;
        storage: FakeCourseAccess;
        telemetry: FakeTelemetry;
    } {
        const catalog = new FakeCatalog(currentEpoch);
        const storage = new FakeCourseAccess();
        const telemetry = new FakeTelemetry();
        const svc = new ExerciseOpeningService(
            catalog as unknown as CourseCatalog,
            telemetry as unknown as TelemetryManager,
            storage as unknown as CourseAccessStorageService,
        );

        svc.handleExerciseOpened({
            exercise: {
                id: 101,
                title: 'Ex 1',
                course: { id: 42 },
                studentParticipations: [{ id: 5, repositoryUri: 'https://git/x' }],
            },
        } as unknown as ExerciseDetailsResponse, 101, capturedEpoch);

        return { catalog, storage, telemetry };
    }

    // The one side effect here that has no guard of its own.
    // `openExerciseDetails` captures the epoch, awaits the exercise fetch and
    // then calls this. If the identity changed in between, the reset has just
    // ended the detector's session, and an unguarded start would immediately
    // open a NEW one for the previous account's exercise: the same corrupt
    // cross-account recording, through a different door.
    test('starts no exercise session for the previous identity', () => {
        const { telemetry } = openWith(4, 5);

        assert.deepStrictEqual(telemetry.started, [],
            'the session the reset just ended must not be reopened by a late fetch');
    });

    test('writes neither the catalog nor the recency history', () => {
        const { catalog, storage } = openWith(4, 5);

        assert.deepStrictEqual(catalog.calls, []);
        assert.deepStrictEqual(storage.recorded, []);
    });

    test('an open that is still current does all three', () => {
        const { catalog, storage, telemetry } = openWith(5, 5);

        assert.strictEqual(catalog.calls.length, 1, 'the guard must not block a live open');
        assert.deepStrictEqual(storage.recorded, [42]);
        assert.deepStrictEqual(telemetry.started, [101]);
    });

    // Without a catalog there is no epoch to compare against, so the check has
    // to stand down rather than swallow every open.
    test('with no catalog the guard stands down', () => {
        const telemetry = new FakeTelemetry();
        const svc = new ExerciseOpeningService(
            undefined,
            telemetry as unknown as TelemetryManager,
            undefined,
        );

        svc.handleExerciseOpened({
            exercise: { id: 101, title: 'Ex 1', course: { id: 42 }, studentParticipations: [] },
        } as unknown as ExerciseDetailsResponse, 101, 9);

        assert.deepStrictEqual(telemetry.started, [101]);
    });
});
