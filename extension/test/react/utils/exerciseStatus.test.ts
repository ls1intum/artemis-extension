import { describe, expect, it } from 'vitest';

import { classifyTaskTests, countsForTelemetry, transformFeedbacksToTestCases } from '@webview/utils/exerciseStatus';

describe('classifyTaskTests', () => {
    it('returns no-result when latestResult is undefined', () => {
        const state = classifyTaskTests([1, 2, 3], undefined);
        expect(state).toEqual({ kind: 'no-result', notExecutedIds: [1, 2, 3] });
    });

    it('returns no-result when feedbacks field is undefined (enrichment never delivered)', () => {
        // Note: `feedbacks` not in the object at all; the enrichment path leaves it undefined.
        const state = classifyTaskTests([1], { successful: false });
        expect(state).toEqual({ kind: 'no-result', notExecutedIds: [1] });
    });

    it('returns no-feedbacks when feedbacks is an empty array and result is not successful', () => {
        const state = classifyTaskTests([1, 2], { successful: false, feedbacks: [] });
        expect(state).toEqual({ kind: 'no-feedbacks', notExecutedIds: [1, 2] });
    });

    it('returns legacy-success when successful=true and feedbacks empty (Artemis legacy)', () => {
        const state = classifyTaskTests([10, 11], { successful: true, feedbacks: [] });
        expect(state).toEqual({ kind: 'legacy-success', testIds: [10, 11] });
    });

    it('returns legacy-success even when feedbacks field is undefined but successful=true', () => {
        const state = classifyTaskTests([42], { successful: true });
        expect(state).toEqual({ kind: 'legacy-success', testIds: [42] });
    });

    it('returns no-tests-in-task when testIds is empty for every latestResult shape', () => {
        // testIds=[] short-circuits at the top of the classifier, so the result
        // shape (undefined / successful / failed / with-feedbacks) is irrelevant.
        expect(classifyTaskTests([], undefined)).toEqual({ kind: 'no-tests-in-task' });
        expect(classifyTaskTests([], { successful: true, feedbacks: [] })).toEqual({ kind: 'no-tests-in-task' });
        expect(classifyTaskTests([], { successful: false, feedbacks: [] })).toEqual({ kind: 'no-tests-in-task' });
        expect(classifyTaskTests([], { feedbacks: [{ testCase: { id: 1, testName: 'x' }, positive: true }] }))
            .toEqual({ kind: 'no-tests-in-task' });
    });

    it('returns success when every testId has a passing feedback', () => {
        const state = classifyTaskTests([1, 2], {
            feedbacks: [
                { testCase: { id: 1, testName: 'tA' }, positive: true },
                { testCase: { id: 2, testName: 'tB' }, positive: true },
            ],
        });
        expect(state.kind).toBe('success');
        if (state.kind === 'success') {
            expect(state.passed).toHaveLength(2);
            expect(state.passed[0]).toMatchObject({ id: 1, name: 'tA', passed: true });
        }
    });

    it('returns fail when at least one testId failed', () => {
        const state = classifyTaskTests([1, 2, 3], {
            feedbacks: [
                { testCase: { id: 1, testName: 'tA' }, positive: true },
                { testCase: { id: 2, testName: 'tB' }, positive: false, detailText: 'boom' },
            ],
        });
        expect(state.kind).toBe('fail');
        if (state.kind === 'fail') {
            expect(state.failed.map(t => t.id)).toEqual([2]);
            expect(state.passed.map(t => t.id)).toEqual([1]);
            expect(state.notExecutedIds).toEqual([3]);
            expect(state.failed[0].message).toBe('boom');
        }
    });

    it('returns not-executed when no failures but some testIds lack feedback', () => {
        const state = classifyTaskTests([1, 2, 3], {
            feedbacks: [{ testCase: { id: 1, testName: 'tA' }, positive: true }],
        });
        expect(state.kind).toBe('not-executed');
        if (state.kind === 'not-executed') {
            expect(state.passed.map(t => t.id)).toEqual([1]);
            expect(state.notExecutedIds).toEqual([2, 3]);
        }
    });

    it('treats positive=undefined as not-executed (Artemis parity)', () => {
        const state = classifyTaskTests([1, 2], {
            feedbacks: [
                { testCase: { id: 1, testName: 'tA' }, positive: true },
                { testCase: { id: 2, testName: 'tB' }, positive: undefined },
            ],
        });
        expect(state.kind).toBe('not-executed');
        if (state.kind === 'not-executed') {
            expect(state.notExecutedIds).toEqual([2]);
        }
    });

    it('ignores feedbacks without testCase.id (cannot be matched)', () => {
        const state = classifyTaskTests([1], {
            feedbacks: [
                { text: 'orphan automatic feedback', positive: true }, // no testCase
                { testCase: { id: 1, testName: 'tA' }, positive: true },
            ],
        });
        expect(state.kind).toBe('success');
        if (state.kind === 'success') {
            expect(state.passed.map(t => t.id)).toEqual([1]);
        }
    });

    it('falls back to f.text when testCase.testName is absent', () => {
        const state = classifyTaskTests([1], {
            feedbacks: [{ testCase: { id: 1 }, text: 'Fallback name', positive: true }],
        });
        if (state.kind === 'success') {
            expect(state.passed[0].name).toBe('Fallback name');
        }
    });
});

describe('transformFeedbacksToTestCases', () => {
    // Feedbacks exactly as Artemis delivers them when showTestNamesToStudents=false:
    // no `text`, no `testCase.testName`, only `detailText` + `testCase.id`.
    // Mirrors Feedback.isTestCaseFeedback (type==AUTOMATIC && !!testCase).
    const hiddenNameFeedbacks = [
        { type: 'AUTOMATIC', positive: false, detailText: 'Method: isValidSelection', testCase: { id: 364902 } },
        { type: 'AUTOMATIC', positive: false, detailText: 'Method: doOverlap', testCase: { id: 370396 } },
        { type: 'AUTOMATIC', positive: true, detailText: 'Method: getName', testCase: { id: 370393 } },
    ];

    it('keeps test feedbacks even when the test name is hidden (showTestNamesToStudents=false)', () => {
        const result = transformFeedbacksToTestCases(hiddenNameFeedbacks);

        expect(result).toHaveLength(3);
        expect(result[0]).toMatchObject({
            id: 364902,
            name: 'Test', // generic fallback, same as the Artemis web client
            passed: false,
            message: 'Method: isValidSelection', // detailText is preserved
        });
        expect(result[2].passed).toBe(true);
    });

    it('still excludes static code analysis and submission policy feedback (no testCase)', () => {
        const feedbacks = [
            { type: 'AUTOMATIC', positive: false, text: 'SCAFeedbackIdentifier:checkstyle', detailText: 'sca' },
            { type: 'AUTOMATIC', positive: false, text: 'SubPolFeedbackIdentifier:limit', detailText: 'policy' },
            { type: 'AUTOMATIC', positive: false, detailText: 'a real test', testCase: { id: 1 } },
        ];
        const result = transformFeedbacksToTestCases(feedbacks);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(1);
    });

    it('keeps the test name when it is visible (showTestNamesToStudents=true)', () => {
        const result = transformFeedbacksToTestCases([
            { type: 'AUTOMATIC', positive: true, testCase: { id: 5, testName: 'testDoOverlap()' }, detailText: 'ok' },
        ]);
        expect(result).toEqual([{ id: 5, name: 'testDoOverlap()', passed: true, message: 'ok' }]);
    });

    it('keeps a testCase-bearing feedback even when the testCase has no id (Artemis !!testCase parity)', () => {
        const result = transformFeedbacksToTestCases([
            { type: 'AUTOMATIC', positive: false, detailText: 'no id but is a test', testCase: {} },
        ]);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ name: 'Test', passed: false, message: 'no id but is a test' });
        expect(result[0].id).toBeUndefined();
    });
});

describe('countsForTelemetry', () => {
    it('maps no-result / no-feedbacks to {0, 0, notExecutedIds.length}', () => {
        expect(countsForTelemetry({ kind: 'no-result', notExecutedIds: [1, 2] }))
            .toEqual({ passedCount: 0, failedCount: 0, notExecutedCount: 2 });
        expect(countsForTelemetry({ kind: 'no-feedbacks', notExecutedIds: [1] }))
            .toEqual({ passedCount: 0, failedCount: 0, notExecutedCount: 1 });
    });

    it('maps legacy-success to {testIds.length, 0, 0}', () => {
        expect(countsForTelemetry({ kind: 'legacy-success', testIds: [1, 2, 3] }))
            .toEqual({ passedCount: 3, failedCount: 0, notExecutedCount: 0 });
    });

    it('maps no-tests-in-task to all-zero', () => {
        expect(countsForTelemetry({ kind: 'no-tests-in-task' }))
            .toEqual({ passedCount: 0, failedCount: 0, notExecutedCount: 0 });
    });

    it('maps success to {passed.length, 0, 0}', () => {
        expect(countsForTelemetry({
            kind: 'success',
            passed: [{ id: 1, name: 'a', passed: true }, { id: 2, name: 'b', passed: true }],
        })).toEqual({ passedCount: 2, failedCount: 0, notExecutedCount: 0 });
    });

    it('maps fail to {passed, failed, notExecuted} counts', () => {
        expect(countsForTelemetry({
            kind: 'fail',
            passed: [{ id: 1, name: 'a', passed: true }],
            failed: [{ id: 2, name: 'b', passed: false }, { id: 3, name: 'c', passed: false }],
            notExecutedIds: [99],
        })).toEqual({ passedCount: 1, failedCount: 2, notExecutedCount: 1 });
    });

    it('maps not-executed to {passed.length, 0, notExecutedIds.length}', () => {
        expect(countsForTelemetry({
            kind: 'not-executed',
            passed: [{ id: 1, name: 'a', passed: true }],
            notExecutedIds: [2, 3],
        })).toEqual({ passedCount: 1, failedCount: 0, notExecutedCount: 2 });
    });
});
