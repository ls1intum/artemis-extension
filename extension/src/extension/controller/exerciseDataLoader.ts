import type { ArtemisApiService } from '../api';
import type { CourseDashboardResponse, CourseDashboardCourse, ExerciseDetailsResponse } from '../types';
import { ApiError, MalformedResponseError } from '../types';
import type { CourseDetailData } from '../../shared/messageContracts';
import { toCourseDetailData } from '../../shared/messageContracts';
import { logger, LogCategory } from '../services/loggingService';
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
 * Fetch exercise details and enrich all participations with pending submissions
 * and result feedbacks. This is the single source of truth for exercise data loading.
 */
export async function fetchAndEnrichExerciseDetails(
    api: ArtemisApiService,
    exerciseId: number,
): Promise<ExerciseDetailsResponse> {
    const exerciseDetails = await api.getExerciseDetails(exerciseId);

    const participations = exerciseDetails.exercise?.studentParticipations ?? [];
    for (const participation of participations) {
        if (!participation.id) { continue; }

        // Check for pending submissions (builds in progress).
        try {
            const pendingSubmission = await api.getLatestPendingSubmission(participation.id);
            if (pendingSubmission) {
                exerciseDetails.pendingSubmission = pendingSubmission;
            }
        } catch (err) {
            if (isAuthError(err) || err instanceof MalformedResponseError) {
                throw err;
            }
            const status = err instanceof ApiError ? err.status : undefined;
            logger.warn(
                `Pending submission enrichment failed for participation ${participation.id} (status=${status ?? 'network'}); continuing without it`,
                LogCategory.VIEW,
            );
        }

        // Enrich the latest result with feedbacks using the same endpoint as the Artemis webapp.
        // This single call returns the latest Result with feedbacks embedded — no need to
        // manually find the resultId or make a separate feedbacks call.
        try {
            const resultWithFeedbacks = await api.getLatestResultWithFeedbacks(participation.id);
            if (resultWithFeedbacks?.feedbacks?.length) {
                const latestSubmission = pickHighestId(participation.submissions);
                const latestResult = pickHighestId(latestSubmission?.results);
                if (latestResult) {
                    latestResult.feedbacks = resultWithFeedbacks.feedbacks;
                }
            }
        } catch (err) {
            if (isAuthError(err) || err instanceof MalformedResponseError) {
                throw err;
            }
            const status = err instanceof ApiError ? err.status : undefined;
            logger.warn(
                `Latest-result enrichment failed for participation ${participation.id} (status=${status ?? 'network'}); continuing without feedbacks`,
                LogCategory.VIEW,
            );
        }
    }

    return exerciseDetails;
}

/**
 * Fetch archived course detail.
 * Exams are already included in the dashboard response (course.exams).
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
