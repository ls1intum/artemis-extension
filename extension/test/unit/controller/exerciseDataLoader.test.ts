/**
 * Enrichment-error policy for `fetchAndEnrichExerciseDetails`:
 *
 *   401 / 403           → rethrow (auth state invalid; caller surfaces login UI)
 *   5xx / network       → log warning, continue (exercise page must still open)
 *   Malformed JSON      → rethrow (schema/contract failure must not be hidden)
 *   404 / null body     → handled inside the API layer; loader sees `null`
 *
 * Previously every error was silently swallowed by an empty catch block,
 * which masked auth and contract failures and produced incorrect "no pending
 * submission" signals downstream.
 */

import * as assert from 'assert';
import { fetchAndEnrichExerciseDetails } from '@extension/controller/exerciseDataLoader';
import { ApiError, MalformedResponseError } from '@extension/types';
import type { ArtemisApiService } from '@extension/api';
import type { ExerciseDetailsResponse, ProgrammingSubmission, ResultSummary } from '@extension/types';

interface ApiStubOptions {
    pendingSubmissionResult?: ProgrammingSubmission | null | (() => Promise<never>);
    resultWithFeedbacks?: ResultSummary | null | (() => Promise<never>);
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
            studentParticipations: [{ id: 5001 }],
        },
    } as unknown as ExerciseDetailsResponse;

    const api = {
        getExerciseDetails: async () => structuredClone(exerciseDetails),
        getLatestPendingSubmission: async () => {
            state.pendingCalls++;
            if (typeof opts.pendingSubmissionResult === 'function') {
                return opts.pendingSubmissionResult();
            }
            return opts.pendingSubmissionResult ?? null;
        },
        getLatestResultWithFeedbacks: async () => {
            state.resultCalls++;
            if (typeof opts.resultWithFeedbacks === 'function') {
                return opts.resultWithFeedbacks();
            }
            return opts.resultWithFeedbacks ?? null;
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
