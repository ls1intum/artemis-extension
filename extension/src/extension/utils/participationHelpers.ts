import { displayedResult } from '@shared/utils/latestById';

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
 * Return raw feedbacks from the result a surface should be displaying for a participation.
 * Callers map to their own DTO shape.
 *
 * `buildPending` is not optional: a pending submission is resultless, so the strict rule loses the
 * task markers for the length of every build, where the webview and Artemis both keep them.
 */
export function extractLatestFeedbacks(
    participation: ParticipationWithFeedbacks | undefined,
    buildPending: boolean,
): unknown[] | undefined {
    return displayedResult(participation?.submissions, buildPending)?.feedbacks;
}
