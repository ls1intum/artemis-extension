import type { ArtemisApiService } from '@extension/api';
import type { CourseCatalog } from '@extension/services/courseCatalog';
import { LogCategory, logger } from '@extension/services/loggingService';

/**
 * Resolves the course an exercise belongs to:
 *   1. the catalog's authoritative entities (dashboard, full course entries)
 *   2. `api.getExerciseDetails(...).exercise.course.id`
 *
 * No write-back, and deliberately no persisted id map: a map keyed by bare
 * numeric id carries no server identity, so an "Ask Iris about this exercise"
 * click can resolve into a course on a different Artemis instance.
 */
export async function resolveCourseIdForExercise(
    exerciseId: number,
    catalog: CourseCatalog,
    api: ArtemisApiService | undefined,
): Promise<number | undefined> {
    const known = catalog.authoritativeCourseIdFor(exerciseId);
    if (known !== undefined) { return known; }
    if (!api) { return undefined; }
    try {
        return (await api.getExerciseDetails(exerciseId))?.exercise?.course?.id;
    } catch (error) {
        logger.warn('Failed to resolve course from exercise details:', LogCategory.IRIS_CHAT, error);
        return undefined;
    }
}
