import type { ArtemisApiService } from '../../api';
import type { CourseDashboardResponse, CourseDashboardCourse, ExerciseDetailsResponse } from '../../types/apiResponses';
import type { CourseDetailData } from '../../shared/messageContracts';
import { toCourseDetailData } from '../../shared/messageContracts';
import { logger, LogCategory } from '../../services/loggingService';

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

        // Enrich the latest result with detailed feedbacks (test cases)
        const latestSubmission = [...(participation.submissions ?? [])]
            .sort((a, b) => ((b as { id?: number }).id ?? 0) - ((a as { id?: number }).id ?? 0))[0] as { id?: number; results?: Array<{ id?: number; feedbacks?: unknown[] }> } | undefined;
        const latestResult = [...(latestSubmission?.results ?? [])]
            .sort((a, b) => (a.id ?? 0) > (b.id ?? 0) ? -1 : 1)[0];
        if (latestResult?.id) {
            try {
                const feedbacks = await api.getResultFeedbacks(participation.id, latestResult.id);
                if (feedbacks.length > 0) {
                    latestResult.feedbacks = feedbacks;
                }
            } catch {
                logger.warn(`Could not fetch result details for result ${latestResult.id}`, LogCategory.VIEW);
            }
        }
    }

    return exerciseDetails;
}

/**
 * Fetch archived course detail with exams.
 */
export async function fetchArchivedCourseDetail(
    api: ArtemisApiService,
    courseId: number,
): Promise<CourseDetailData> {
    const dashboardDTO = await api.getCourseForDashboard(courseId);
    const courseData = toCourseDetailData(
        dashboardDTO.course as CourseDashboardCourse,
        { isArchived: true }
    );

    try {
        const exams = await api.getExamsForCourse(courseId);
        courseData.course.exams = exams as typeof courseData.course.exams;
    } catch { /* continue without exams */ }

    return courseData;
}
