import type { ArtemisApiService } from '@extension/api';
import { LogCategory, logger } from '@extension/services/loggingService';

import type { ContextStore } from './contextStore';

/**
 * Resolves the course an exercise belongs to, walking:
 *   1. contextStore.getExerciseById(...).courseId
 *   2. api.getExerciseDetails(...).exercise.course.id (registers the exercise
 *      back into the store on success)
 *
 * Returns undefined if both fail. Keyed on the exercise id (spec 10): every
 * caller knows an exercise, not a selected context, and this is the only code
 * that can find a course for an exercise the store has never seen, which is
 * exactly the fresh-window case.
 */
export async function resolveCourseIdForExercise(
    exerciseId: number,
    contextStore: ContextStore,
    api: ArtemisApiService | undefined,
): Promise<number | undefined> {
    const tracked = contextStore.getExerciseById(exerciseId);
    if (tracked?.courseId) {
        return tracked.courseId;
    }
    if (!api) {
        return undefined;
    }
    try {
        const details = await api.getExerciseDetails(exerciseId);
        const resolved = details?.exercise?.course?.id;
        if (resolved) {
            contextStore.registerExercise({
                id: exerciseId,
                // The details response is the better title (it is the server's
                // own), but a tracked row may already carry one and the input
                // requires a definite string.
                title: details.exercise?.title ?? tracked?.title ?? `Exercise ${exerciseId}`,
                shortName: details.exercise?.shortName ?? tracked?.shortName,
                courseId: resolved,
            });
        }
        return resolved;
    } catch (error) {
        logger.warn('Failed to resolve course from exercise details:', LogCategory.IRIS_CHAT, error);
        return undefined;
    }
}
