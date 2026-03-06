import type { SubmissionStatusType } from '../components/exercise/SubmissionStatus';
import type { ParticipationStatusType } from '../components/exercise/ParticipationActions';

export function determineSubmissionStatus(
    pendingSubmission: unknown,
    latestResult: { score?: number; successful?: boolean } | undefined,
    latestSubmission?: { buildFailed?: boolean } | undefined,
): SubmissionStatusType {
    if (pendingSubmission) {
        return 'building';
    }
    if (latestResult) {
        // result.score is a percentage (0-100) in Artemis
        const scorePercent = latestResult.score ?? 0;
        if (latestResult.successful || scorePercent >= 80) {
            return 'success';
        }
        if (scorePercent > 0) {
            return 'partial';
        }
        return 'failed';
    }
    if (latestSubmission?.buildFailed) {
        return 'failed';
    }
    return 'no-submission';
}

export function determineParticipationStatus(
    hasParticipation: boolean,
    latestResult: unknown,
    latestSubmission: unknown,
): ParticipationStatusType {
    if (!hasParticipation) {
        return 'not-started';
    }
    if (latestResult) {
        return 'graded';
    }
    if (latestSubmission) {
        return 'submitted';
    }
    return 'in-progress';
}
