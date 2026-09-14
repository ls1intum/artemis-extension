/**
 * Inverse of `recording/eventCollectors.ts#collectBuildResult`: rebuild the
 * minimal `ResultDTO` that the engine's build-delta classifier consumes from a
 * recorded `buildResult` event.
 *
 * The classifier (`services/struggle/signals/buildDelta.ts`) reads ONLY:
 *   - `result.submission?.buildFailed`  → compile-error vs test-build branch
 *   - `result.feedbacks[]` where `positive === false` → the failed-test SET,
 *     keyed on `detailText` (the exact string the frozen reference diffed).
 *
 * The recorder derives the failed set from `fb.positive === false → detailText`
 * and persists it as `failedTestDetails[].detail` (with `testName`). We invert
 * that mapping: one failed feedback per recorded detail. Every other ResultDTO
 * field is left undefined except the required `id` (the parser/DTO contract
 * marks it non-optional); buildDelta never reads it, so a constant is fine.
 */
import type { ArtemisFeedback } from '@extension/domain/core';
import type { ResultDTO } from '@extension/domain/submissions';
import type { BuildResultEvent } from '@extension/services/recording/types';

export function rehydrateResultDTO(event: BuildResultEvent): ResultDTO {
    // Prefer the structured details (testName + detail); fall back to the legacy
    // flat `failedTests` list of detailText strings when details are absent.
    const failedFeedbacks: ArtemisFeedback[] = event.failedTestDetails
        ? event.failedTestDetails.map(d => ({ positive: false, detailText: d.detail, text: d.testName }))
        : event.failedTests.map(detail => ({ positive: false, detailText: detail }));

    return {
        id: event.submissionId ?? 0,
        successful: event.successful,
        feedbacks: failedFeedbacks,
        // Defensive null at the rehydrate boundary: a compile-error build has no
        // usable test info, so counts never reach the Test-Stagnation add-on.
        passedTestCaseCount: event.buildFailed ? undefined : event.passedTestCaseCount,
        testCaseCount: event.buildFailed ? undefined : event.testCaseCount,
        submission: { id: event.submissionId, buildFailed: event.buildFailed },
    };
}
