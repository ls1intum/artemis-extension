/**
 * Pick the entry with the highest numeric `id` from a list.
 * Stable for ties (preserves array order via stable sort).
 */
export function pickHighestId<T extends { id?: number }>(items: readonly T[] | undefined): T | undefined {
    if (!items || items.length === 0) { return undefined; }
    return [...items].sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];
}

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
    const latestSubmission = pickHighestId(participation?.submissions);
    const latestResult = pickHighestId(latestSubmission?.results);
    return latestResult?.feedbacks;
}
