import * as vscode from 'vscode';

import type { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import { logger } from '@extension/services/loggingService';
import type { IStruggleCoordinator } from '@extension/telemetry/contract';
import type { ExerciseDetailsResponse } from '@extension/types';

import type { IProviderRegistry } from './providerRegistry';

export class ExerciseOpeningService {
    constructor(
        private readonly _exerciseRegistry: ExerciseRegistry,
        private readonly _providerRegistry: IProviderRegistry,
        private _struggleCoordinator?: IStruggleCoordinator,
        private readonly _courseAccessStorage?: CourseAccessStorageService,
    ) {}

    /**
     * Handle post-open side effects after an exercise is opened:
     * registry registration, telemetry session start, chat provider notification.
     */
    public handleExerciseOpened(exerciseData: ExerciseDetailsResponse, exerciseId: number): void {
        const exercise = exerciseData.exercise;
        if (!exercise) { return; }

        const exerciseTitle = exercise.title || 'Untitled';
        const exerciseIdFromData = exercise.id || exerciseId;

        // Register in exercise registry
        const participations = exercise.studentParticipations || [];
        if (participations.length > 0 && participations[0]?.repositoryUri) {
            this._exerciseRegistry.registerExercise(
                exerciseIdFromData,
                exerciseTitle,
                participations[0].repositoryUri,
                exercise.shortName || '',
                exercise.course?.id,
                typeof participations[0].id === 'number' ? participations[0].id : undefined,
            );
            logger.exercise(`Registered individual exercise: ${exerciseTitle}`);
        }

        const courseId = exercise.course?.id;
        if (typeof courseId === 'number') {
            this._courseAccessStorage?.onCourseAccessed(courseId);
        }

        // Start struggle-detection session
        this._struggleCoordinator?.startExerciseSession(
            exerciseIdFromData,
            vscode.workspace.workspaceFolders?.[0]?.uri,
        );

        // Notify chat provider
        const chatProvider = this._providerRegistry.getChatWebviewProvider();
        if (chatProvider && typeof chatProvider.updateDetectedExercise === 'function') {
            const releaseDate = exercise.releaseDate || exercise.startDate;
            const dueDate = exercise.dueDate;
            const shortName = exercise.shortName;
            chatProvider.updateDetectedExercise(exerciseTitle, exerciseIdFromData, releaseDate, dueDate, shortName || '', exercise.course?.id);
        }
    }
}
