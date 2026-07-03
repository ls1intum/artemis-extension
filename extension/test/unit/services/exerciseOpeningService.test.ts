import * as assert from 'assert';

import type { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { TelemetryManager } from '@extension/services/telemetry';
import { ExerciseOpeningService } from '@extension/services/ui/exerciseOpeningService';
import type { IProviderRegistry } from '@extension/services/ui/providerRegistry';
import type { ExerciseDetailsResponse } from '@extension/types';

class FakeCourseAccess {
    public readonly recorded: number[] = [];
    onCourseAccessed(id: number): void { this.recorded.push(id); }
    getLastAccessedCourses(): number[] { return this.recorded.slice().reverse(); }
}

function buildRegistry(): ExerciseRegistry {
    return {
        registerExercise() { /* no-op */ },
        getAllExercises() { return []; },
        registerFromCourseData() { /* no-op */ },
    } as unknown as ExerciseRegistry;
}

function buildProviderRegistry(): IProviderRegistry {
    return { getChatWebviewProvider: () => undefined } as unknown as IProviderRegistry;
}

suite('ExerciseOpeningService → CourseAccessStorage hook', () => {
    test('calls onCourseAccessed with exercise.course.id', () => {
        const storage = new FakeCourseAccess();
        const svc = new ExerciseOpeningService(
            buildRegistry(),
            buildProviderRegistry(),
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
            buildRegistry(),
            buildProviderRegistry(),
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
            buildRegistry(),
            buildProviderRegistry(),
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
