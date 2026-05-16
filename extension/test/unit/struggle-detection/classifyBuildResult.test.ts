/**
 * classifyBuildResult — Unit Tests
 *
 * Verifies correct classification of Artemis build results into
 * compiler-error, test-failure, or success for EQ pipeline consumption.
 *
 * Covers the NEW-3 fix: result.successful === false fallback prevents
 * genuinely failed builds from being silently classified as 'success'.
 */

import * as assert from 'assert';
import { classifyBuildResult } from '@extension/services/telemetry/eventPipeline/compileEquivalentEmitter';
import type { ResultDTO } from '@extension/domain/submissions';

function makeResult(overrides: Partial<ResultDTO> = {}): ResultDTO {
    return {
        id: 1,
        ...overrides,
    };
}

suite('classifyBuildResult', () => {

    // ── Standard cases ──────────────────────────────────────────────

    test('buildFailed === true → compiler-error', () => {
        const result = makeResult({ submission: { buildFailed: true } });
        assert.strictEqual(classifyBuildResult(result), 'compiler-error');
    });

    test('test failures with counts → test-failure', () => {
        const result = makeResult({
            testCaseCount: 5,
            passedTestCaseCount: 3,
            submission: { buildFailed: false },
        });
        assert.strictEqual(classifyBuildResult(result), 'test-failure');
    });

    test('all tests pass → success', () => {
        const result = makeResult({
            testCaseCount: 5,
            passedTestCaseCount: 5,
            successful: true,
            submission: { buildFailed: false },
        });
        assert.strictEqual(classifyBuildResult(result), 'success');
    });

    test('no failure signals → success', () => {
        const result = makeResult({ successful: true });
        assert.strictEqual(classifyBuildResult(result), 'success');
    });

    // ── NEW-3 fix: result.successful === false fallback ─────────────

    test('successful === false with missing buildFailed and no test counts → test-failure (not success)', () => {
        const result = makeResult({
            successful: false,
            // submission.buildFailed is undefined
            // testCaseCount is undefined
        });
        assert.strictEqual(
            classifyBuildResult(result),
            'test-failure',
            'must not classify genuinely failed build as success when buildFailed field is missing',
        );
    });

    test('successful === false with buildFailed === undefined and empty submission → test-failure', () => {
        const result = makeResult({
            successful: false,
            submission: { buildFailed: undefined },
        });
        assert.strictEqual(classifyBuildResult(result), 'test-failure');
    });

    test('successful === undefined (truly unknown) with no other signals → success', () => {
        const result = makeResult({
            // successful is undefined
            // no buildFailed, no test counts
        });
        assert.strictEqual(
            classifyBuildResult(result),
            'success',
            'when server provides no success/failure signal, default to success',
        );
    });

    // ── Priority: buildFailed takes precedence over successful ──────

    test('buildFailed === true takes precedence over successful === false', () => {
        const result = makeResult({
            successful: false,
            submission: { buildFailed: true },
        });
        assert.strictEqual(classifyBuildResult(result), 'compiler-error');
    });

    test('test counts take precedence over successful === false', () => {
        const result = makeResult({
            successful: false,
            testCaseCount: 10,
            passedTestCaseCount: 3,
        });
        assert.strictEqual(classifyBuildResult(result), 'test-failure');
    });
});
