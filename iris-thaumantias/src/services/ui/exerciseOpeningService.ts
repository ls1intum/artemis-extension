import * as vscode from 'vscode';
import type { ExerciseRegistry } from '../exerciseRegistry';
import type { IProviderRegistry } from './providerRegistry';
import type { TelemetryManager } from '../telemetry/telemetryManager';
import { logger, LogCategory } from '../loggingService';
import type { ExerciseDetailsResponse } from '../../types/apiResponses';

export class ExerciseOpeningService {
    constructor(
        private readonly _exerciseRegistry: ExerciseRegistry,
        private readonly _providerRegistry: IProviderRegistry,
        private _telemetryManager?: TelemetryManager,
    ) {}

    public setTelemetryManager(telemetryManager: TelemetryManager): void {
        this._telemetryManager = telemetryManager;
    }

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
                exercise.course?.id
            );
            logger.exercise(`Registered individual exercise: ${exerciseTitle}`);
        }

        // Start telemetry session
        this._telemetryManager?.startExerciseSession(
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
