import type { CourseDetailData } from '@shared/messageContracts';
import { toCourseDetailData } from '@shared/messageContracts';
import type { PendingSubmissionStatus } from '@shared/types/apiResponses';

import type { ArtemisApiService } from '../api';
import { LogCategory, logger } from '../services/loggingService';
import type { CourseDashboardCourse, CourseDashboardResponse, ExerciseDetailsResponse } from '../types';
import { ApiError, MalformedResponseError } from '../types';
import { pickHighestId } from '../utils/participationHelpers';

/**
 * Enrichment-error policy:
 *   - 401/403: auth state is invalid → rethrow, callers already handle this
 *   - 5xx / network / unknown: enrichment outage → log warning, continue with
 *     the base exercise data so the user can still open the exercise page
 *   - Malformed/schema-invalid response (MalformedResponseError): rethrow —
 *     silent fall-back would hide real backend regressions
 */
function isAuthError(err: unknown): boolean {
    return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

/**
 * Decide what to do with a settled rejection from per-participation
 * enrichment. Returns the error if it must propagate, `null` if it was
 * handled (logged) and the load can continue without that piece of data.
 *
 * Centralizing this prevents the policy from drifting across the two
 * call sites (pending submission + latest result) where it used to live.
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
 * Per-participation enrichment runs in parallel; auth (401/403) and malformed
 * responses are deferred until every per-participation task has settled, then
 * the first such fatal error is rethrown. Non-fatal failures (network, 5xx)
 * are logged and the load continues with whatever did succeed. This matters
 * for exercises with concurrent pending builds across participations — see
 * #168 for the data-loss bug this loop used to silently produce when the
 * `pendingSubmission` field was a singleton.
 *
 * The expected participation count per exercise is ≤2 (graded + practice),
 * so we do not impose a concurrency cap on the outer Promise.all. If the
 * instructor / test-run case ever causes that to grow, revisit.
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
                // Enrich the latest result with feedbacks using the same endpoint
                // as the Artemis webapp. This single call returns the latest
                // Result with feedbacks embedded — no need to manually find the
                // resultId or make a separate feedbacks call.
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
        // Throwing the first fatal error matches the previous semantics
        // (the old serial loop would have aborted on the first auth/
        // malformed failure). Settling everything first prevents
        // background log spam after the rejection.
        throw fatalErrors[0];
    }

    exerciseDetails.pendingSubmissionsByParticipationId = pendingSubmissionsByParticipationId;
    return exerciseDetails;
}

/**
 * Fetch archived course detail.
 */
export async function fetchArchivedCourseDetail(
    api: ArtemisApiService,
    courseId: number,
): Promise<CourseDetailData> {
    const dashboardDTO = await api.getCourseForDashboard(courseId);
    return toCourseDetailData(
        dashboardDTO.course as CourseDashboardCourse,
        { isArchived: true }
    );
}
