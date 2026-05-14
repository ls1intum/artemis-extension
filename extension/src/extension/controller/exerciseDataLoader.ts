import type { ArtemisApiService } from '../api';
import type { CourseDashboardResponse, CourseDashboardCourse, ExerciseDetailsResponse } from '../types';
import type { CourseDetailData } from '../../shared/messageContracts';
import { toCourseDetailData } from '../../shared/messageContracts';
import { logger, LogCategory } from '../services/loggingService';
import { pickHighestId } from '../utils/participationHelpers';

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

        // Check for pending submissions (builds in progress)
        try {
            const pendingSubmission = await api.getLatestPendingSubmission(participation.id);
            if (pendingSubmission) {
                exerciseDetails.pendingSubmission = pendingSubmission;
            }
        } catch { /* ignore */ }

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
        } catch {
            logger.warn(`Could not fetch latest result with feedbacks for participation ${participation.id}`, LogCategory.VIEW);
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
