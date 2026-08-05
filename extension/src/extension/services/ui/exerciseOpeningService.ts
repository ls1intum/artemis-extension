import * as vscode from 'vscode';

import type { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { CourseCatalog } from '@extension/services/courseCatalog';
import type { ITelemetryManager } from '@extension/services/telemetry';
import type { ExerciseDetailsResponse } from '@extension/types';

export class ExerciseOpeningService {
    constructor(
        private readonly _courseCatalog: CourseCatalog | undefined,
        private _telemetryManager?: ITelemetryManager,
        private readonly _courseAccessStorage?: CourseAccessStorageService,
    ) {}

    /**
     * Handle post-open side effects after an exercise is opened: record it in
     * the catalog's supplemental layer (Task 5's registry rebuild picks it up
     * from there) and start the telemetry session.
     *
     * `epoch` is passed in rather than read live. This runs after the caller
     * has awaited the exercise fetch, and a live read here would hand the
     * previous session's exercise the new session's generation, which is the
     * one write `upsertSupplemental`'s guard cannot then reject.
     */
    public handleExerciseOpened(exerciseData: ExerciseDetailsResponse, exerciseId: number, epoch: number): void {
        const exercise = exerciseData.exercise;
        if (!exercise) { return; }

        const exerciseTitle = exercise.title || 'Untitled';
        const exerciseIdFromData = exercise.id || exerciseId;
        const courseId = exercise.course?.id;

        // An exercise with no course id cannot be placed; a `courseId: 0` row
        // would be a made-up fact of exactly the kind this catalog exists to
        // remove.
        if (typeof courseId === 'number') {
            const participation = exercise.studentParticipations?.[0];
            this._courseCatalog?.upsertSupplemental({
                kind: 'partial-exercise',
                id: exerciseIdFromData,
                courseId,
                title: exerciseTitle,
                shortName: exercise.shortName,
                releaseDate: exercise.releaseDate ?? exercise.startDate,
                dueDate: exercise.dueDate,
                repositoryUri: participation?.repositoryUri,
                participationId: typeof participation?.id === 'number' ? participation.id : undefined,
            }, epoch);
            this._courseAccessStorage?.onCourseAccessed(courseId);
        }

        // Start telemetry session
        this._telemetryManager?.startExerciseSession(
            exerciseIdFromData,
            vscode.workspace.workspaceFolders?.[0]?.uri,
        );
    }
}
