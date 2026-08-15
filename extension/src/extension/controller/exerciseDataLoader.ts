import type { CourseDetailData } from '@shared/messageContracts';
import { toCourseDetailData } from '@shared/messageContracts';
import type { PendingSubmissionStatus } from '@shared/types/apiResponses';

import type { ArtemisApiService } from '@extension/api';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { ExerciseDetailsResponse } from '@extension/types';
import { ApiError, MalformedResponseError } from '@extension/types';
import { pickHighestId } from '@extension/utils/participationHelpers';

/**
 * Enrichment-error policy:
 *   - 401/403: auth state is invalid → rethrow, callers already handle this
 *   - 5xx / network / unknown: enrichment outage → log warning, continue with
 *     the base exercise data so the user can still open the exercise page
 *   - Malformed/schema-invalid response (MalformedResponseError): rethrow,
 *     because a silent fall-back would hide real backend regressions
 */
function isAuthError(err: unknown): boolean {
    return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

/**
 * Decide what to do with a settled rejection from per-participation
 * enrichment. Returns the error if it must propagate, `null` if it was
 * handled (logged) and the load can continue without that piece of data.
 *
 * Centralizing this keeps the policy from drifting across its two call sites
 * (pending submission + latest result).
 */
function classifyEnrichmentError(err: unknown, context: string): Error | null {
    if (isAuthError(err) || err instanceof MalformedResponseError) {
        return err as Error;
    }
    const status = err instanceof ApiError ? err.status : undefined;
    logger.warn(
        `${context} (status=${status ?? 'network'}); continuing without it`,
        LogCategory.VIEW,
    );
    return null;
}

/**
 * Fetch exercise details and enrich all participations with pending submissions
 * and result feedbacks. This is the single source of truth for exercise data loading.
 *
 * Per-participation enrichment runs in parallel. Fatal errors (see the
 * enrichment-error policy above) are deferred until every task has settled and
 * the first one is then rethrown; non-fatal failures are logged and the load
 * continues with whatever did succeed.
 *
 * Pending submissions are returned keyed by participation, never as a single
 * value: an exercise can have concurrent pending builds across participations,
 * and a singleton would drop all but one of them.
 *
 * The expected participation count per exercise is ≤2 (graded + practice),
 * so there is no concurrency cap on the outer Promise.all. If the instructor /
 * test-run case ever causes that to grow, revisit.
 */
export async function fetchAndEnrichExerciseDetails(
    api: ArtemisApiService,
    exerciseId: number,
): Promise<ExerciseDetailsResponse> {
    const exerciseDetails = await api.getExerciseDetails(exerciseId);

    const participations = exerciseDetails.exercise?.studentParticipations ?? [];
    const pendingSubmissionsByParticipationId: Record<number, PendingSubmissionStatus> = {};
    const fatalErrors: Error[] = [];

    await Promise.all(participations.map(async (participation) => {
        if (!participation.id) { return; }
        const participationId = participation.id;

        const [pendingResult, feedbacksResult] = await Promise.allSettled([
            api.getLatestPendingSubmission(participationId),
            api.getLatestResultWithFeedbacks(participationId),
        ]);

        if (pendingResult.status === 'fulfilled') {
            if (pendingResult.value) {
                // Normalize the raw ProgrammingSubmission to the lean DTO the
                // store/UI expect. `state` and `buildTimingInfo` only ever
                // arrive via the WebSocket submissionProcessing path; the
                // REST endpoint just signals presence.
                pendingSubmissionsByParticipationId[participationId] = { participationId };
            }
        } else {
            const fatal = classifyEnrichmentError(
                pendingResult.reason,
                `Pending submission enrichment failed for participation ${participationId}`,
            );
            if (fatal) { fatalErrors.push(fatal); }
        }

        if (feedbacksResult.status === 'fulfilled') {
            const resultWithFeedbacks = feedbacksResult.value;
            if (resultWithFeedbacks?.feedbacks?.length) {
                // Same endpoint as the Artemis webapp: one call returns the
                // latest Result with feedbacks embedded, so there is no
                // resultId lookup and no separate feedbacks call.
                const latestSubmission = pickHighestId(participation.submissions);
                const latestResult = pickHighestId(latestSubmission?.results);
                if (latestResult) {
                    latestResult.feedbacks = resultWithFeedbacks.feedbacks;
                }
            }
        } else {
            const fatal = classifyEnrichmentError(
                feedbacksResult.reason,
                `Latest-result enrichment failed for participation ${participationId}`,
            );
            if (fatal) { fatalErrors.push(fatal); }
        }
    }));

    if (fatalErrors.length > 0) {
        // Settling everything before throwing prevents background log spam
        // after the rejection.
        throw fatalErrors[0];
    }

    exerciseDetails.pendingSubmissionsByParticipationId = pendingSubmissionsByParticipationId;
    return exerciseDetails;
}

export async function fetchArchivedCourseDetail(
    api: ArtemisApiService,
    courseId: number,
): Promise<CourseDetailData> {
    const dashboardDTO = await api.getCourseForDashboard(courseId);
    const mapped = toCourseDetailData(dashboardDTO.course, { isArchived: true });
    if (!mapped) {
        throw new Error(`Archived course ${courseId} is missing an id`);
    }
    return mapped;
}
