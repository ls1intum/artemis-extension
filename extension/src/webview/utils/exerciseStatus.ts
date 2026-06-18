import type { ParticipationStatusType } from '@webview/components/exercise/ParticipationActions';
import type { SubmissionStatusType, TestCase } from '@webview/components/exercise/SubmissionStatus';
import type { PendingSubmissionInfo } from '@webview/stores/useExerciseDetailStore';

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

/**
 * The result to DISPLAY for a participation: the latest result of the newest
 * submission that actually has one (submission-first, matching how the rest of
 * the codebase resolves "latest" — `ExerciseDetailView` lines 227-229,
 * `participationHelpers.ts`).
 *
 * Differs from `getLatestById(latestSubmission?.results)` only during a build:
 * a freshly-created submission has no results yet, so reading only the latest
 * submission returns nothing and the previous result vanishes from the UI.
 * Walking submissions newest-first keeps the previous result visible until the
 * new one lands on the newest submission. When the newest submission has a
 * result, this returns exactly that result — identical to `latestResult`.
 *
 * NOT a global "highest result id" scan: a re-evaluated older submission can
 * own a result with a higher id than the newest submission's, which must NOT
 * override the newest submission's result.
 */
export function getLatestResultAcrossSubmissions<R extends { id?: number }>(
    submissions: ReadonlyArray<{ id?: number; results?: R[] }> | undefined,
): R | undefined {
    const newestFirst = [...(submissions ?? [])].sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    for (const submission of newestFirst) {
        const latest = getLatestById(submission.results);
        if (latest) { return latest; }
    }
    return undefined;
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

// Prefixes Artemis encodes in `feedback.text` to mark non-test automatic
// feedback (kept in sync with the server's feedback.model.ts identifiers).
const SCA_FEEDBACK_IDENTIFIER = 'SCAFeedbackIdentifier:';
const SUBMISSION_POLICY_FEEDBACK_IDENTIFIER = 'SubPolFeedbackIdentifier:';

/**
 * Whether a result feedback describes a programming test case.
 *
 * Mirrors the Artemis web client's `Feedback.isTestCaseFeedback`
 * (`type === AUTOMATIC && !!testCase`): a feedback that references a test case
 * IS a test feedback even when the test name is hidden from students
 * (`showTestNamesToStudents = false`, where Artemis omits both `text` and
 * `testCase.testName`). Older results without a `testCase` relation are
 * identified by their name-bearing `text`, excluding static-code-analysis and
 * submission-policy feedback (both carry an identifier prefix and no testCase).
 */
export function isTestCaseFeedback(f: FeedbackInput): boolean {
    if (f.type && f.type !== 'AUTOMATIC') { return false; }
    if (f.testCase) { return true; }
    return !!f.text
        && !f.text.startsWith(SCA_FEEDBACK_IDENTIFIER)
        && !f.text.startsWith(SUBMISSION_POLICY_FEEDBACK_IDENTIFIER);
}

/**
 * Transforms Artemis result feedbacks into structured test case results.
 * Keeps only test-case feedback (see {@link isTestCaseFeedback}); the name
 * falls back to a generic 'Test' when hidden, matching the Artemis web client.
 */
export function transformFeedbacksToTestCases(feedbacks: FeedbackInput[]): TestCaseResult[] {
    return feedbacks.filter(isTestCaseFeedback).map(f => ({
        name: f.testCase?.testName ?? f.text ?? 'Test',
        passed: f.positive ?? false,
        message: f.detailText,
        id: f.testCase?.id,
    }));
}

/**
 * Classification of a task's test outcome, mirroring the buckets the Artemis
 * web client uses (`ProgrammingExerciseInstructionService.testStatusForTask`)
 * plus the legacy-success fallback for older results without an explicit
 * feedback list.
 *
 * Used by the per-task feedback modal to render differentiated empty states
 * instead of the generic "No tests in this task." message.
 */
export type TaskTestState =
    | { kind: 'no-result'; notExecutedIds: number[] }
    | { kind: 'no-feedbacks'; notExecutedIds: number[] }
    | { kind: 'legacy-success'; testIds: number[] }
    | { kind: 'no-tests-in-task' }
    | { kind: 'success'; passed: TestCase[] }
    | { kind: 'fail'; failed: TestCase[]; passed: TestCase[]; notExecutedIds: number[] }
    | { kind: 'not-executed'; passed: TestCase[]; notExecutedIds: number[] };

interface LatestResultLike {
    successful?: boolean;
    feedbacks?: FeedbackInput[];
}

/**
 * Classify a task's test outcome from the latest result. Pure function.
 *
 * Behaviour parity with Artemis (`testStatusForTask`):
 * - `successful: true` with empty/undefined feedbacks → `legacy-success` (older
 *   results sometimes ship without an inline feedback list).
 * - Otherwise partition `testIds` by feedback.positive:
 *   true → passed, false → failed, undefined-or-missing → not executed.
 *
 * The empty-feedbacks branch additionally distinguishes "the enrichment step
 * never delivered a feedback list" (feedbacks === undefined → `no-result`)
 * from "feedbacks were delivered but the array is empty" (feedbacks === [] →
 * `no-feedbacks`). The first surfaces "submit your code", the second surfaces
 * "the latest build produced no test feedback".
 *
 * `no-tests-in-task` is defensive; the click handler in `ProblemStatement.tsx`
 * already short-circuits empty testId lists before opening the overlay.
 */
export function classifyTaskTests(
    testIds: number[],
    latestResult: LatestResultLike | undefined,
): TaskTestState {
    // A task without testIds has no associated tests; the result is irrelevant.
    // Hoisted above the other guards so 'no-tests-in-task' is the canonical
    // state for this defensive case across all input combinations (the click
    // handler in ProblemStatement.tsx already short-circuits empty testId
    // lists before reaching here).
    if (testIds.length === 0) {
        return { kind: 'no-tests-in-task' };
    }

    if (!latestResult) {
        return { kind: 'no-result', notExecutedIds: testIds };
    }

    const feedbacks = latestResult.feedbacks ?? [];

    if (feedbacks.length === 0) {
        if (latestResult.successful === true) {
            return { kind: 'legacy-success', testIds };
        }
        return latestResult.feedbacks === undefined
            ? { kind: 'no-result', notExecutedIds: testIds }
            : { kind: 'no-feedbacks', notExecutedIds: testIds };
    }

    const byId = new Map<number, FeedbackInput>();
    for (const f of feedbacks) {
        const id = f.testCase?.id;
        if (id === undefined) { continue; }
        byId.set(id, f);
    }

    const passed: TestCase[] = [];
    const failed: TestCase[] = [];
    const notExecutedIds: number[] = [];
    for (const tid of testIds) {
        const fb = byId.get(tid);
        if (!fb) { notExecutedIds.push(tid); continue; }
        const tc: TestCase = {
            id: tid,
            name: fb.testCase?.testName ?? fb.text ?? 'Test',
            passed: fb.positive === true,
            message: fb.detailText,
        };
        if (fb.positive === true) {
            passed.push(tc);
        } else if (fb.positive === false) {
            failed.push(tc);
        } else {
            // positive undefined → not executed (Artemis parity)
            notExecutedIds.push(tid);
        }
    }

    if (failed.length > 0) {
        return { kind: 'fail', failed, passed, notExecutedIds };
    }
    if (notExecutedIds.length > 0) {
        return { kind: 'not-executed', passed, notExecutedIds };
    }
    return { kind: 'success', passed };
}

/**
 * Counts derived from a {@link TaskTestState}, in the shape the telemetry
 * payload expects. `passedCount` + `failedCount` preserves the pre-existing
 * `totalTests` semantics (matched tests for this task); `notExecutedCount`
 * is additive so historical analytics keep working.
 */
export function countsForTelemetry(state: TaskTestState): {
    passedCount: number;
    failedCount: number;
    notExecutedCount: number;
} {
    switch (state.kind) {
        case 'no-result':
        case 'no-feedbacks':
            return { passedCount: 0, failedCount: 0, notExecutedCount: state.notExecutedIds.length };
        case 'legacy-success':
            return { passedCount: state.testIds.length, failedCount: 0, notExecutedCount: 0 };
        case 'no-tests-in-task':
            return { passedCount: 0, failedCount: 0, notExecutedCount: 0 };
        case 'success':
            return { passedCount: state.passed.length, failedCount: 0, notExecutedCount: 0 };
        case 'fail':
            return {
                passedCount: state.passed.length,
                failedCount: state.failed.length,
                notExecutedCount: state.notExecutedIds.length,
            };
        case 'not-executed':
            return {
                passedCount: state.passed.length,
                failedCount: 0,
                notExecutedCount: state.notExecutedIds.length,
            };
    }
}
