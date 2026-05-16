import type { ActiveContext } from '@shared/types/context';
import { logger, LogCategory } from '@extension/services/loggingService';
import type { ArtemisApiService } from '@extension/api';
import type { ContextStore } from './contextStore';

/**
 * Resolves the courseId for an ActiveContext, walking:
 *   1. context.courseId (or context.id when type === 'course')
 *   2. contextStore.getExerciseById(...).courseId
 *   3. api.getExerciseDetails(...).exercise.course.id (registers the exercise back into the store on success)
 *
 * Returns undefined if all three paths fail. Mirrors the legacy private
 * resolveCourseIdForExercise from chatSessionService.ts so behavior is preserved
 * across both the IrisChatSessionService and sessionSyncUtils call sites.
 */
export async function resolveCourseIdFromContext(
    context: ActiveContext,
    contextStore: ContextStore,
    api: ArtemisApiService | undefined,
): Promise<number | undefined> {
    if (context.type === 'course') {
        return context.id;
    }
    if (context.courseId) {
        return context.courseId;
    }
    const tracked = contextStore.getExerciseById(context.id);
    if (tracked?.courseId) {
        return tracked.courseId;
    }
    if (!api) {
        return undefined;
    }
    try {
        const details = await api.getExerciseDetails(context.id);
        const resolved = details?.exercise?.course?.id;
        if (resolved) {
            contextStore.registerExercise({
                id: context.id,
                title: context.title,
                shortName: context.shortName,
                courseId: resolved,
            });
        }
        return resolved;
    } catch (error) {
        logger.warn('Failed to resolve course from exercise details:', LogCategory.IRIS_CHAT, error);
        return undefined;
    }
}
