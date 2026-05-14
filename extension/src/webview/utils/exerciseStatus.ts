import type { SubmissionStatusType, TestCase } from '../components/exercise/SubmissionStatus';
import type { ParticipationStatusType } from '../components/exercise/ParticipationActions';
import type { PendingSubmissionInfo } from '../stores/useExerciseDetailStore';

export function determineSubmissionStatus(
    pendingSubmission: PendingSubmissionInfo | null,
    latestResult: { score?: number; successful?: boolean } | undefined,
    latestSubmission?: { buildFailed?: boolean } | undefined,
): SubmissionStatusType {
    if (pendingSubmission) {
        if (pendingSubmission.state === 'QUEUED') {
            return 'pending';
        }
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

/**
 * Extracts the latest item from an array by highest ID.
 * Artemis represents "latest" as highest ID, not chronological.
 */
export function getLatestById<T extends { id?: number }>(
    items: T[] | undefined,
): T | undefined {
    if (!items || items.length === 0) { return undefined; }
    return [...items].sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];
}

interface TestCaseResult {
    name: string;
    passed: boolean;
    message?: string;
    id?: number;
}

interface FeedbackInput {
    type?: string;
    text?: string;
    positive?: boolean;
    detailText?: string;
    testCase?: { id?: number; testName?: string };
}

/**
 * Transforms Artemis result feedbacks into structured test case results.
 * Filters out SCA feedback identifiers and keeps only test-related entries.
 */
export function transformFeedbacksToTestCases(feedbacks: FeedbackInput[]): TestCaseResult[] {
    const testFeedbacks = feedbacks.filter(f =>
        f.testCase?.testName || ((!f.type || f.type === 'AUTOMATIC') && f.text && !f.text.startsWith('SCAFeedbackIdentifier:'))
    );
    return testFeedbacks.map(f => ({
        name: f.testCase?.testName ?? f.text ?? 'Test',
        passed: f.positive ?? false,
        message: f.detailText,
        id: f.testCase?.id,
    }));
}

/**
 * Filter a TestCase array to only the entries whose id is in the given set.
 * Used by the per-task feedback modal to show only the tests linked to the
 * clicked [task] entry in the SSR'd problem statement.
 *
 * Tests without an id are excluded (cannot be matched). Returns a new array
 * preserving the input order.
 */
export function filterTestCasesByIds(all: TestCase[], ids: number[]): TestCase[] {
    const idSet = new Set(ids);
    return all.filter(tc => tc.id !== undefined && idSet.has(tc.id));
}
