import * as assert from 'assert';

import type { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { CourseCatalog, SupplementalRecord } from '@extension/services/courseCatalog';
import type { TelemetryManager } from '@extension/services/telemetry';
import { ExerciseOpeningService } from '@extension/services/ui/exerciseOpeningService';
import type { ExerciseDetailsResponse } from '@extension/types';

class FakeCourseAccess {
    public readonly recorded: number[] = [];
    onCourseAccessed(id: number): void { this.recorded.push(id); }
    getLastAccessedCourses(): number[] { return this.recorded.slice().reverse(); }
}

class FakeCatalog {
    public readonly calls: Array<{ record: SupplementalRecord; epoch: number }> = [];
    upsertSupplemental(record: SupplementalRecord, epoch: number): void {
        this.calls.push({ record, epoch });
    }
}

suite('ExerciseOpeningService → CourseAccessStorage hook', () => {
    test('calls onCourseAccessed with exercise.course.id', () => {
        const storage = new FakeCourseAccess();
        const svc = new ExerciseOpeningService(
            undefined,
            () => 0,
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

        svc.handleExerciseOpened(exerciseData, 101);
        assert.deepStrictEqual(storage.recorded, [42]);
    });

    test('does nothing when exercise.course.id is missing', () => {
        const storage = new FakeCourseAccess();
        const svc = new ExerciseOpeningService(
            undefined,
            () => 0,
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

        svc.handleExerciseOpened(exerciseData, 102);
        assert.deepStrictEqual(storage.recorded, []);
    });

    test('works without storage service (optional param)', () => {
        const svc = new ExerciseOpeningService(
            undefined,
            () => 0,
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
        assert.doesNotThrow(() => svc.handleExerciseOpened(exerciseData, 103));
    });
});

suite('ExerciseOpeningService → CourseCatalog write', () => {
    test('records the opened exercise as a partial-exercise, stamped with the session epoch', () => {
        const catalog = new FakeCatalog();
        const svc = new ExerciseOpeningService(
            catalog as unknown as CourseCatalog,
            () => 7,
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

        svc.handleExerciseOpened(exerciseData, 101);

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
            () => 0,
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

        svc.handleExerciseOpened(exerciseData, 102);

        assert.strictEqual(catalog.calls.length, 0);
    });
});
