import * as vscode from 'vscode';

import type { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { CourseCatalog } from '@extension/services/courseCatalog';
import type { IStruggleCoordinator } from '@extension/telemetry/contract';
import type { ExerciseDetailsResponse } from '@extension/types';

export class ExerciseOpeningService {
    constructor(
        private readonly _courseCatalog: CourseCatalog | undefined,
        private _struggleCoordinator?: IStruggleCoordinator,
        private readonly _courseAccessStorage?: CourseAccessStorageService,
    ) {}

    /**
     * Handle post-open side effects after an exercise is opened: record it in
     * the catalog's supplemental layer (the registry rebuild picks it up from
     * there), remember the course as recently opened, and start the telemetry
     * session.
     *
     * `epoch` is passed in rather than read live. This runs after the caller
     * has awaited the exercise fetch, and a live read here would hand the
     * previous session's exercise the new session's generation, which is the
     * one write `upsertSupplemental`'s guard cannot then reject.
     */
    public handleExerciseOpened(exerciseData: ExerciseDetailsResponse, exerciseId: number, epoch: number): void {
        // ONE guard, ahead of all three side effects, because they are one
        // decision: this open either still belongs to the current session or it
        // does not. The catalog write and the recency write each reject a stale
        // epoch on their own, but the telemetry start does not, so without this
        // a late `openExerciseDetails` completing after an identity change
        // would start a session for the PREVIOUS account's exercise moments
        // after the reset ended it.
        //
        // With no catalog there is no epoch to compare against, so the check
        // stands down rather than silently swallowing every open. The two inner
        // guards stay: they are shared with call sites that do not come through
        // here.
        if (epoch !== (this._courseCatalog?.currentEpoch ?? epoch)) { return; }

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
            // The same captured epoch as the catalog write above, so the two
            // either both land or both do not.
            this._courseAccessStorage?.onCourseAccessed(courseId, epoch);
        }

        // Start the struggle-detection session. Reachable only past the epoch check above.
        this._struggleCoordinator?.startExerciseSession(
            exerciseIdFromData,
            vscode.workspace.workspaceFolders?.[0]?.uri,
        );
    }
}
