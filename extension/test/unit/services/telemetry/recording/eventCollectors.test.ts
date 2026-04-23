/**
 * Unit tests for Block F — collectBuildResult
 *
 * Covers:
 *   1. Feedback positive:false, text:'TestFoo', detailText:'AssertionError'
 *      → failedTestDetails[0]={testName:'TestFoo', detail:'AssertionError'}
 *      → failedTests[0]='AssertionError' (legacy)
 *      → buildErrorFamilies[0]='build:TestFoo'
 *   2. Feedback positive:undefined → no entries in failedTests or failedTestDetails (predicate consistency)
 *   3. Feedback positive:true → not included in any list
 *   4. exerciseId, participationId, submissionId are populated when all fields set
 *   5. failedTestDetails is undefined when no failed tests
 *   6. buildErrorFamilies cutoff: text longer than 200 chars is truncated at 200 (not 50)
 *   7. Feedback positive:false, text undefined → testName='unknown' in failedTestDetails
 *   8. Feedback positive:false, detailText undefined → detail='' in failedTestDetails, failedTests[0]=''
 */

import * as assert from 'assert';
import { collectBuildResult } from '../../../../../src/extension/services/telemetry/recording/eventCollectors';
import type { ResultDTO } from '../../../../../src/extension/domain';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<ResultDTO> = {}): ResultDTO {
    return {
        id: 42,
        successful: false,
        testCaseCount: 5,
        passedTestCaseCount: 3,
        submission: { id: 101, buildFailed: false },
        participation: { id: 9 },
        ...overrides,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

suite('collectBuildResult (Block F)', () => {
    test('1. positive:false → failedTestDetails and failedTests populated', () => {
        const result = makeResult({
            feedbacks: [{ positive: false, text: 'TestFoo', detailText: 'AssertionError' }],
        });
        const event = collectBuildResult(result, 5);

        assert.deepStrictEqual(event.failedTestDetails, [{ testName: 'TestFoo', detail: 'AssertionError' }]);
        assert.deepStrictEqual(event.failedTests, ['AssertionError']);
        assert.ok(event.buildErrorFamilies?.length === 1);
        assert.ok(event.buildErrorFamilies![0].startsWith('build:TestFoo'));
    });

    test('2. positive:undefined → no entries in failedTests or failedTestDetails', () => {
        const result = makeResult({
            feedbacks: [{ positive: undefined, text: 'TestBar', detailText: 'some detail' }],
        });
        const event = collectBuildResult(result, 5);

        assert.deepStrictEqual(event.failedTests, []);
        assert.strictEqual(event.failedTestDetails, undefined);
        assert.strictEqual(event.buildErrorFamilies, undefined);
    });

    test('3. positive:true → not included in any list', () => {
        const result = makeResult({
            feedbacks: [{ positive: true, text: 'TestPass', detailText: 'ok' }],
        });
        const event = collectBuildResult(result, 5);

        assert.deepStrictEqual(event.failedTests, []);
        assert.strictEqual(event.failedTestDetails, undefined);
        assert.strictEqual(event.buildErrorFamilies, undefined);
    });

    test('4. exerciseId, participationId, submissionId populated', () => {
        const result = makeResult();
        const event = collectBuildResult(result, 7);

        assert.strictEqual(event.exerciseId, 7);
        assert.strictEqual(event.participationId, 9);
        assert.strictEqual(event.submissionId, 101);
    });

    test('5. failedTestDetails is undefined when no failed tests', () => {
        const result = makeResult({ feedbacks: [] });
        const event = collectBuildResult(result, 5);

        assert.strictEqual(event.failedTestDetails, undefined);
    });

    test('6. buildErrorFamilies text truncated at 200 chars (not 50)', () => {
        const longText = 'A'.repeat(300);
        const result = makeResult({
            feedbacks: [{ positive: false, text: longText, detailText: 'detail' }],
        });
        const event = collectBuildResult(result, 5);

        assert.ok(event.buildErrorFamilies?.length === 1);
        // prefix 'build:' = 6 chars + 200 chars of text = 206
        assert.strictEqual(event.buildErrorFamilies![0].length, 6 + 200);
        assert.strictEqual(event.buildErrorFamilies![0], `build:${'A'.repeat(200)}`);
    });

    test('7. positive:false, text undefined → testName=unknown', () => {
        const result = makeResult({
            feedbacks: [{ positive: false, text: undefined, detailText: 'some error' }],
        });
        const event = collectBuildResult(result, 5);

        assert.deepStrictEqual(event.failedTestDetails, [{ testName: 'unknown', detail: 'some error' }]);
    });

    test('8. positive:false, detailText undefined → detail and failedTests entry are empty string', () => {
        const result = makeResult({
            feedbacks: [{ positive: false, text: 'TestBaz', detailText: undefined }],
        });
        const event = collectBuildResult(result, 5);

        assert.deepStrictEqual(event.failedTests, ['']);
        assert.deepStrictEqual(event.failedTestDetails, [{ testName: 'TestBaz', detail: '' }]);
    });

    test('9. activeExerciseId undefined → exerciseId not set in event', () => {
        const result = makeResult();
        const event = collectBuildResult(result, undefined);

        assert.strictEqual(event.exerciseId, undefined);
        assert.strictEqual(event.participationId, 9);
    });
});
