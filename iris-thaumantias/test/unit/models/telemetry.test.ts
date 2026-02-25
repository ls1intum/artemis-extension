import * as assert from 'assert';
import { BuildResult } from '../../../src/models/telemetry';

suite('BuildResult', () => {
    test('parses complete valid JSON', () => {
        const b = BuildResult.fromJSON({
            timestamp: 1700000000, success: true, errorCount: 2,
            failedTests: ['testA', 'testB'], buildLog: 'some log',
            submissionId: 42, rawBuildFailed: false,
        });
        assert.ok(b instanceof BuildResult);
        assert.strictEqual(b.timestamp, 1700000000);
        assert.strictEqual(b.success, true);
        assert.strictEqual(b.errorCount, 2);
        assert.deepStrictEqual(b.failedTests, ['testA', 'testB']);
        assert.strictEqual(b.buildLog, 'some log');
        assert.strictEqual(b.submissionId, 42);
        assert.strictEqual(b.rawBuildFailed, false);
    });

    test('handles missing optional fields with defaults', () => {
        const b = BuildResult.fromJSON({ success: false });
        assert.strictEqual(b.success, false);
        assert.strictEqual(b.errorCount, 0);
        assert.deepStrictEqual(b.failedTests, []);
        assert.strictEqual(b.buildLog, undefined);
        assert.strictEqual(b.submissionId, undefined);
        assert.strictEqual(b.rawBuildFailed, undefined);
    });

    test('defaults timestamp to Date.now() when missing', () => {
        const before = Date.now();
        const b = BuildResult.fromJSON({ success: true });
        const after = Date.now();
        assert.ok(b.timestamp >= before && b.timestamp <= after);
    });

    test('throws on invalid input', () => {
        assert.throws(() => BuildResult.fromJSON(null), /Invalid/);
        assert.throws(() => BuildResult.fromJSON(undefined), /Invalid/);
    });
});
