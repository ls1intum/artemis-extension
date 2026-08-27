import type { FeedbackSummary } from '@shared/types/apiResponses';

import type { ArtemisFeedback } from '@extension/domain';

/**
 * Projects an extension-host feedback onto the wire DTO the webview receives.
 *
 * Lives extension-side rather than in `shared/messageContracts/domainMappers`
 * because its input is an `@extension/domain` type, and `eslint.config.mjs`
 * forbids `src/shared/**` from importing `@extension/*`.
 *
 * Deliberately NOT accompanied by a shared result mapper: `handleNewResult`
 * sends a superset of what `handleNewSubmission`'s nested results carry, and
 * `ResultSummary` has an index signature, so one generic mapper would
 * type-check silently while widening the `newSubmission` payload.
 */
export function toFeedbackSummary(feedback: ArtemisFeedback): FeedbackSummary {
    return {
        id: feedback.id,
        text: feedback.text,
        detailText: feedback.detailText,
        credits: feedback.credits,
        positive: feedback.positive,
        type: feedback.type,
        testCase: feedback.testCase,
    };
}
