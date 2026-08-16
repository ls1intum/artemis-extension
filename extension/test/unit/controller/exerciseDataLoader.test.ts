/**
 * Enrichment-error policy for `fetchAndEnrichExerciseDetails`:
 *
 *   401 / 403           → rethrow (auth state invalid; caller surfaces login UI)
 *   5xx / network       → log warning, continue (exercise page must still open)
 *   Malformed JSON      → rethrow (schema/contract failure must not be hidden)
 *   404 / null body     → handled inside the API layer; loader sees `null`
 */

import * as assert from 'assert';

import type { ArtemisApiService } from '@extension/api';
import { fetchAndEnrichExerciseDetails } from '@extension/controller/exerciseDataLoader';
import type { ExerciseDetailsResponse, ProgrammingSubmission, ResultSummary } from '@extension/types';
import { ApiError, MalformedResponseError } from '@extension/types';

interface ApiStubOptions {
    pendingSubmissionResult?: ProgrammingSubmission | null | (() => Promise<never>);
    resultWithFeedbacks?: ResultSummary | null | (() => Promise<never>);
    /** Override the participations the stubbed exercise carries. Defaults to a single participation id 5001. */
    participations?: Array<{ id: number }>;
    /**
     * Per-participation overrides for the two enrichment calls. When set,
     * these take precedence over the global `pendingSubmissionResult` /
     * `resultWithFeedbacks` options for that participationId. Used to
     * model the multi-participation cases (different builds in flight on
     * graded vs. practice).
     */
    perParticipation?: Record<number, {
        pendingSubmissionResult?: ProgrammingSubmission | null | (() => Promise<never>);
        resultWithFeedbacks?: ResultSummary | null | (() => Promise<never>);
    }>;
}

function makeApiStub(opts: ApiStubOptions): {
    api: ArtemisApiService;
    pendingCalls: number;
    resultCalls: number;
} {
    const state = { pendingCalls: 0, resultCalls: 0 };

    const exerciseDetails: ExerciseDetailsResponse = {
        exercise: {
            id: 1,
            studentParticipations: opts.participations ?? [{ id: 5001 }],
        },
    } as unknown as ExerciseDetailsResponse;

    const resolveValue = <T>(
        participationId: number,
        global: T | (() => Promise<never>) | undefined,
        perKey: 'pendingSubmissionResult' | 'resultWithFeedbacks',
    ): T | null | (() => Promise<never>) => {
        const perPart = opts.perParticipation?.[participationId]?.[perKey] as T | (() => Promise<never>) | undefined;
        const resolved = perPart !== undefined ? perPart : global;
        return resolved === undefined ? null : (resolved as T | null | (() => Promise<never>));
    };

    const api = {
        getExerciseDetails: async () => structuredClone(exerciseDetails),
        getLatestPendingSubmission: async (participationId: number) => {
            state.pendingCalls++;
            const resolved = resolveValue<ProgrammingSubmission | null>(
                participationId,
                opts.pendingSubmissionResult,
                'pendingSubmissionResult',
            );
            if (typeof resolved === 'function') { return (resolved as () => Promise<never>)(); }
            return resolved;
        },
        getLatestResultWithFeedbacks: async (participationId: number) => {
            state.resultCalls++;
            const resolved = resolveValue<ResultSummary | null>(
                participationId,
                opts.resultWithFeedbacks,
                'resultWithFeedbacks',
            );
            if (typeof resolved === 'function') { return (resolved as () => Promise<never>)(); }
            return resolved;
        },
    } as unknown as ArtemisApiService;

    return { api, get pendingCalls() { return state.pendingCalls; }, get resultCalls() { return state.resultCalls; } };
}

suite('fetchAndEnrichExerciseDetails — enrichment-error policy', () => {
    test('401 from pending-submission rethrows (auth state invalid)', async () => {
        const stub = makeApiStub({
            pendingSubmissionResult: () => Promise.reject(new ApiError('auth', 401)),
        });

        await assert.rejects(
            () => fetchAndEnrichExerciseDetails(stub.api, 1),
            (err: unknown) => err instanceof ApiError && err.status === 401,
        );
    });

    test('403 from pending-submission rethrows', async () => {
        const stub = makeApiStub({
            pendingSubmissionResult: () => Promise.reject(new ApiError('forbidden', 403)),
        });

        await assert.rejects(
            () => fetchAndEnrichExerciseDetails(stub.api, 1),
            (err: unknown) => err instanceof ApiError && err.status === 403,
        );
    });

    test('500 from pending-submission is logged and continues (exercise still loads)', async () => {
        const stub = makeApiStub({
            pendingSubmissionResult: () => Promise.reject(new ApiError('server', 500)),
        });

        const data = await fetchAndEnrichExerciseDetails(stub.api, 1);
        assert.ok(data, 'exercise data must still resolve when enrichment fails');
        assert.strictEqual(stub.resultCalls, 1, 'subsequent enrichment must still run');
    });

    test('network error from pending-submission is logged and continues', async () => {
        const stub = makeApiStub({
            pendingSubmissionResult: () => Promise.reject(new TypeError('fetch failed')),
        });

        const data = await fetchAndEnrichExerciseDetails(stub.api, 1);
        assert.ok(data);
    });

    test('MalformedResponseError from pending-submission rethrows (schema failure)', async () => {
        const stub = makeApiStub({
            pendingSubmissionResult: () => Promise.reject(
                new MalformedResponseError(
                    'Malformed pending-submission response for participation 5001: unexpected token',
                    200,
                    'parse error',
                ),
            ),
        });

        await assert.rejects(
            () => fetchAndEnrichExerciseDetails(stub.api, 1),
            (err: unknown) => err instanceof MalformedResponseError,
        );
    });

    test('401 from latest-result-with-feedbacks rethrows', async () => {
        const stub = makeApiStub({
            pendingSubmissionResult: null,
            resultWithFeedbacks: () => Promise.reject(new ApiError('auth', 401)),
        });

        await assert.rejects(
            () => fetchAndEnrichExerciseDetails(stub.api, 1),
            (err: unknown) => err instanceof ApiError && err.status === 401,
        );
    });

    test('500 from latest-result-with-feedbacks is logged and continues', async () => {
        const stub = makeApiStub({
            pendingSubmissionResult: null,
            resultWithFeedbacks: () => Promise.reject(new ApiError('server', 500)),
        });

        const data = await fetchAndEnrichExerciseDetails(stub.api, 1);
        assert.ok(data);
    });

    test('MalformedResponseError from latest-result-with-feedbacks rethrows (schema failure)', async () => {
        const stub = makeApiStub({
            pendingSubmissionResult: null,
            resultWithFeedbacks: () => Promise.reject(
                new MalformedResponseError(
                    'Malformed latest-result response for participation 5001: unexpected token',
                    200,
                    'parse error',
                ),
            ),
        });

        await assert.rejects(
            () => fetchAndEnrichExerciseDetails(stub.api, 1),
            (err: unknown) => err instanceof MalformedResponseError,
        );
    });
});

suite('fetchAndEnrichExerciseDetails — per-participation pending submission map (#168)', () => {
    test('two participations with concurrent pending submissions both land in the map under distinct keys', async () => {
        const stub = makeApiStub({
            participations: [{ id: 100 }, { id: 200 }],
            perParticipation: {
                100: { pendingSubmissionResult: { id: 9001 } as unknown as ProgrammingSubmission },
                200: { pendingSubmissionResult: { id: 9002 } as unknown as ProgrammingSubmission },
            },
        });

        const data = await fetchAndEnrichExerciseDetails(stub.api, 1);
        const map = data.pendingSubmissionsByParticipationId ?? {};
        assert.ok(map[100], 'participation 100 must have a pending entry');
        assert.ok(map[200], 'participation 200 must have a pending entry');
        // Neither entry may be silently lost.
        assert.strictEqual(Object.keys(map).length, 2);
    });

    test('REST ProgrammingSubmission is normalized to a lean { participationId } DTO', async () => {
        // The loader must not just stash the raw ProgrammingSubmission. The
        // wire DTO is intentionally minimal because state + buildTimingInfo
        // only ever arrive via the WebSocket submissionProcessing path.
        const rawSubmission = {
            id: 7777,
            commitHash: 'abc123',
            submissionDate: '2026-05-21T10:00:00Z',
            // Deliberately no state and no top-level participationId, matching
            // what parseProgrammingSubmission produces.
        } as unknown as ProgrammingSubmission;

        const stub = makeApiStub({
            participations: [{ id: 42 }],
            pendingSubmissionResult: rawSubmission,
        });

        const data = await fetchAndEnrichExerciseDetails(stub.api, 1);
        const entry = data.pendingSubmissionsByParticipationId?.[42];
        assert.ok(entry, 'entry must exist for participation 42');
        assert.strictEqual(entry.participationId, 42);
        assert.strictEqual(entry.state, undefined, 'state must remain undefined; WS path supplies it later');
        assert.strictEqual(entry.buildTimingInfo, undefined, 'buildTimingInfo must remain undefined here');
        // Ensure no raw API fields leaked through the normalization.
        assert.strictEqual((entry as unknown as Record<string, unknown>).commitHash, undefined);
        assert.strictEqual((entry as unknown as Record<string, unknown>).id, undefined);
    });

    test('one participation 500-failing does not drop another participation\'s pending entry', async () => {
        const stub = makeApiStub({
            participations: [{ id: 100 }, { id: 200 }],
            perParticipation: {
                100: { pendingSubmissionResult: () => Promise.reject(new ApiError('server', 500)) },
                200: { pendingSubmissionResult: { id: 9002 } as unknown as ProgrammingSubmission },
            },
        });

        const data = await fetchAndEnrichExerciseDetails(stub.api, 1);
        const map = data.pendingSubmissionsByParticipationId ?? {};
        assert.strictEqual(map[100], undefined, 'failed call yields no entry but does not abort the load');
        assert.ok(map[200], 'sibling participation\'s data is preserved');
    });

    test('auth error on one participation\'s call still rethrows after all participations settle', async () => {
        // Even with parallel enrichment, auth errors must still abort the load;
        // they are not enrichment-recoverable. Promise.allSettled lets every
        // sibling call settle first so background calls do not keep logging
        // after the rejection.
        const stub = makeApiStub({
            participations: [{ id: 100 }, { id: 200 }],
            perParticipation: {
                100: { pendingSubmissionResult: () => Promise.reject(new ApiError('auth', 401)) },
                200: { pendingSubmissionResult: { id: 9002 } as unknown as ProgrammingSubmission },
            },
        });

        await assert.rejects(
            () => fetchAndEnrichExerciseDetails(stub.api, 1),
            (err: unknown) => err instanceof ApiError && err.status === 401,
        );
        // Both per-participation pending calls are attempted before the throw:
        // "settle, then rethrow" rather than "fail-fast".
        assert.strictEqual(stub.pendingCalls, 2);
    });

    test('participations with no pending submission produce no map entry', async () => {
        const stub = makeApiStub({
            participations: [{ id: 100 }, { id: 200 }],
            pendingSubmissionResult: null,
        });

        const data = await fetchAndEnrichExerciseDetails(stub.api, 1);
        assert.deepStrictEqual(data.pendingSubmissionsByParticipationId, {});
    });
});
