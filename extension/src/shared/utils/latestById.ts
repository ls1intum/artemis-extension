/**
 * How "latest" is resolved for Artemis participations, shared by the extension
 * host and the webview so the two cannot drift apart.
 *
 * Artemis represents "latest" as the highest numeric `id`, NOT the newest
 * timestamp. One copy of that rule, in one place: a second copy under a second
 * name is how a host and a webview end up disagreeing about which result a
 * student is looking at.
 */

/**
 * The entry with the highest numeric `id`.
 * Stable for ties: equal ids preserve array order via a stable sort.
 */
export function latestById<T extends { id?: number }>(
    items: readonly T[] | undefined,
): T | undefined {
    if (!items || items.length === 0) { return undefined; }
    return [...items].sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];
}

/**
 * The newest submission that actually HAS a result, then that result.
 *
 * Differs from `latestById(latestById(submissions)?.results)` only while a
 * build is in flight: a freshly created submission has no results yet, so
 * reading the newest submission alone returns nothing and the previous result
 * vanishes. Use this only when a build is genuinely pending; otherwise a
 * resultless submission (e.g. a finished build-failed one) would wrongly
 * resurface an older result.
 *
 * NOT a global "highest result id" scan: a re-evaluated older submission can
 * own a result with a higher id than the newest submission's, which must NOT
 * override the newest submission's result.
 */
export function latestResultAcrossSubmissions<R extends { id?: number }>(
    submissions: ReadonlyArray<{ id?: number; results?: readonly R[] }> | undefined,
): R | undefined {
    const newestFirst = [...(submissions ?? [])].sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    for (const submission of newestFirst) {
        const latest = latestById(submission.results);
        if (latest) { return latest; }
    }
    return undefined;
}

/**
 * The result a surface should display for a participation.
 *
 * Artemis resolves this with `findLatestResult(getAllResultsOfAllSubmissions(...))`, which keeps
 * the previous result's task markers while a build runs; the strict half alone shows nothing.
 *
 * `buildPending` is required rather than defaulted: the wrong default is silently wrong both ways.
 */
export function displayedResult<R extends { id?: number }>(
    submissions: ReadonlyArray<{ id?: number; results?: readonly R[] }> | undefined,
    buildPending: boolean,
): R | undefined {
    return buildPending
        ? latestResultAcrossSubmissions(submissions)
        : latestById(latestById(submissions)?.results);
}
