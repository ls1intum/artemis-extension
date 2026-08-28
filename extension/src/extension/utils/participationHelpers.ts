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
 * Return raw feedbacks from the result a surface should be displaying for a
 * participation. Callers map to their own DTO shape.
 *
 * `buildPending` is not optional: a pending submission is by definition
 * resultless, so reading the newest submission alone during a build hands back
 * nothing and the problem statement loses the task markers it was showing a
 * moment ago. That is the state the webview and the Artemis client both keep
 * the previous result for.
 */
export function extractLatestFeedbacks(
    participation: ParticipationWithFeedbacks | undefined,
    buildPending: boolean,
): unknown[] | undefined {
    return displayedResult(participation?.submissions, buildPending)?.feedbacks;
}
