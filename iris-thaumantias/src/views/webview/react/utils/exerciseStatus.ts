import type { SubmissionStatusType } from '../components/exercise/SubmissionStatus';
import type { ParticipationStatusType } from '../components/exercise/ParticipationActions';

export function determineSubmissionStatus(
    pendingSubmission: unknown,
    latestResult: { score?: number; successful?: boolean } | undefined,
    maxPoints: number,
): SubmissionStatusType {
    if (pendingSubmission) {
        return 'building';
    }
    if (latestResult) {
        const score = latestResult.score ?? 0;
        if (latestResult.successful || score >= maxPoints * 0.8) {
            return 'success';
        }
        if (score > 0) {
            return 'partial';
        }
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
