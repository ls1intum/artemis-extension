/**
 * Single source of truth for build-error family keys derived from build-result feedbacks.
 *
 * Used by both the live EQ path (compileEquivalentEmitter) and the recording path
 * (eventCollectors) so that replayed EQ matches live EQ. Keeping the truncation length
 * in one place prevents the live/recording divergence that otherwise breaks replay fidelity.
 */

/**
 * Max characters of feedback text used to distinguish build-error families.
 * Longer keeps similar-but-distinct failures separate; shorter over-merges them.
 * [Engineering choice] — 200 was chosen to avoid family-merging of similar errors.
 */
export const BUILD_ERROR_FAMILY_MAX_CHARS = 200;

/** Minimal structural shape of an Artemis build-result feedback. */
interface FeedbackLike {
    readonly positive?: boolean;
    readonly text?: string;
}

/**
 * Build the ordered list of `build:<text>` family keys for the failed feedbacks.
 *
 * A feedback contributes a family iff it is explicitly failing (`positive === false`)
 * and carries non-empty `text`. Returns families only — the `build:compiler-error`
 * fallback for an empty result is applied by each caller's snapshot construction.
 */
export function buildErrorFamiliesFromFeedbacks(
    feedbacks: readonly FeedbackLike[] | undefined,
): string[] {
    if (!feedbacks) {
        return [];
    }
    const families: string[] = [];
    for (const feedback of feedbacks) {
        if (feedback.positive === false && feedback.text) {
            families.push(`build:${feedback.text.substring(0, BUILD_ERROR_FAMILY_MAX_CHARS)}`);
        }
    }
    return families;
}
