import { latestById } from '@shared/utils/latestById';

interface ParticipationWithFeedbacks {
    readonly submissions?: ReadonlyArray<{
        readonly id?: number;
        readonly results?: ReadonlyArray<{
            readonly id?: number;
            readonly feedbacks?: unknown[];
        }>;
    }>;
}

/**
 * Return raw feedbacks from the latest result on the latest submission of a participation,
 * selected by highest numeric `id` at each step. Callers map to their own DTO shape.
 */
export function extractLatestFeedbacks(participation: ParticipationWithFeedbacks | undefined): unknown[] | undefined {
    const latestSubmission = latestById(participation?.submissions);
    const latestResult = latestById(latestSubmission?.results);
    return latestResult?.feedbacks;
}
