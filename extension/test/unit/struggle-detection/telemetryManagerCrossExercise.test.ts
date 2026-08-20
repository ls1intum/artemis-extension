/**
 * Cross-exercise build result contamination.
 *
 * ResultDTO from the Artemis WebSocket carries only a participationId, never an
 * exerciseId. Without a reverse lookup, a build result from exercise A lands in
 * the engine of the currently-active exercise B and produces phantom struggle
 * signals. onNewResult therefore resolves result.participation.id → exerciseId
 * via the ExerciseRegistry and drops mismatches. Unknown mappings are passed
 * through (permissive fallback so real data is not lost while the registry is
 * still populating).
 */

import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { ResultDTO } from '@extension/domain';
import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import { TelemetryManager } from '@extension/services/telemetry/telemetryManager';

function makeResult(participationId: number | undefined, opts: { buildFailed?: boolean; successful?: boolean } = {}): ResultDTO {
    return {
        id: Math.floor(Math.random() * 1_000_000),
        participation: participationId !== undefined ? { id: participationId } : undefined,
        submission: opts.buildFailed !== undefined ? { buildFailed: opts.buildFailed } : undefined,
        successful: opts.successful,
    };
}

suite('TelemetryManager Cross-Exercise Filter (NEW-2 fix)', () => {
    let registry: ExerciseRegistry;
    let telemetry: TelemetryManager;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));
        registry = new ExerciseRegistry();
        // Exercise A: exerciseId=1, participationId=5001
        // Exercise B: exerciseId=2, participationId=5002
        registry.registerExercise(1, 'Exercise A', 'git://a', 'exA', 100, 5001);
        registry.registerExercise(2, 'Exercise B', 'git://b', 'exB', 100, 5002);
        telemetry = new TelemetryManager(registry);
    });

    teardown(() => {
        telemetry.dispose();
        sandbox.restore();
    });

    // Note: a failing build result causes *two* EQ fires: one with source='build'
    // (from the snapshot add path) and one with source='trigger' (from the
    // execution-error BoundaryTrigger). We count them together and only assert
    // on the delta, so the guard logic is tested independently of that coupling.

    test('result for active exercise is processed', () => {
        telemetry.startExerciseSession(2); // active = B
        let fireCount = 0;
        const sub = telemetry.onDidCalculateEQ(() => { fireCount++; });
        try {
            telemetry.onNewResult(makeResult(5002, { buildFailed: true }));
            assert.ok(fireCount > 0, 'EQ should update for active-exercise result');
        } finally {
            sub.dispose();
        }
    });

    test('result for a different registered exercise is dropped', () => {
        telemetry.startExerciseSession(2); // active = B
        let fireCount = 0;
        const sub = telemetry.onDidCalculateEQ(() => { fireCount++; });
        try {
            // Result belongs to A's participation while B is active → must be dropped
            telemetry.onNewResult(makeResult(5001, { buildFailed: true }));
            assert.strictEqual(fireCount, 0, 'EQ must not update for foreign-exercise result');
        } finally {
            sub.dispose();
        }
    });

    test('result with unknown participation is passed through (permissive fallback)', () => {
        telemetry.startExerciseSession(2);
        let fireCount = 0;
        const sub = telemetry.onDidCalculateEQ(() => { fireCount++; });
        try {
            // participationId 9999 is not in the registry → permissive: let it through
            telemetry.onNewResult(makeResult(9999, { buildFailed: true }));
            assert.ok(fireCount > 0, 'unknown mapping must not drop data');
        } finally {
            sub.dispose();
        }
    });

    test('result without participation is passed through (permissive fallback)', () => {
        telemetry.startExerciseSession(2);
        let fireCount = 0;
        const sub = telemetry.onDidCalculateEQ(() => { fireCount++; });
        try {
            telemetry.onNewResult(makeResult(undefined, { buildFailed: true }));
            assert.ok(fireCount > 0, 'missing participation must not drop data');
        } finally {
            sub.dispose();
        }
    });

    test('result is dropped when no session is active regardless of participation', () => {
        // No startExerciseSession call
        let fireCount = 0;
        const sub = telemetry.onDidCalculateEQ(() => { fireCount++; });
        try {
            telemetry.onNewResult(makeResult(5002, { buildFailed: true }));
            assert.strictEqual(fireCount, 0, 'no active session → no EQ update');
        } finally {
            sub.dispose();
        }
    });

    test('after session switch, only results for new active exercise are accepted', () => {
        telemetry.startExerciseSession(1); // active = A
        let fireCount = 0;
        const sub = telemetry.onDidCalculateEQ(() => { fireCount++; });
        try {
            telemetry.onNewResult(makeResult(5001, { buildFailed: true }));
            const afterA = fireCount;
            assert.ok(afterA > 0, 'A-result on active session A must fire EQ');

            telemetry.startExerciseSession(2); // switch to B

            telemetry.onNewResult(makeResult(5001, { buildFailed: true }));
            assert.strictEqual(fireCount, afterA, 'stale A-result after switch must be dropped');

            telemetry.onNewResult(makeResult(5002, { buildFailed: true }));
            assert.ok(fireCount > afterA, 'B-result on active session B must fire EQ');
        } finally {
            sub.dispose();
        }
    });
});
