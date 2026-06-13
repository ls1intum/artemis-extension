import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { ResultDTO } from '@extension/domain/submissions';
import { StruggleCoordinator } from '@extension/services/struggle/struggleCoordinator';
import type { AlertRecord } from '@extension/services/struggle/types';
import { TestSensorHub } from '@test/__shared__/testSensorHub';

function failingBuild(buildFailed = true): ResultDTO {
    return { id: 1, submission: { id: 1, buildFailed }, feedbacks: [] } as unknown as ResultDTO;
}

suite('StruggleCoordinator', () => {
    let hub: TestSensorHub;
    let delivered: AlertRecord[];
    let coord: StruggleCoordinator;

    setup(() => {
        hub = new TestSensorHub();
        delivered = [];
        coord = new StruggleCoordinator({
            hub,
            alertSink: { deliver: a => delivered.push(a) },
            exerciseRegistry: undefined,
        });
    });
    teardown(() => coord.dispose());

    test('onNewResult emits a guarded build result into the hub (engine sees it)', () => {
        const seen: unknown[] = [];
        const sub = hub.onBuildResult(s => seen.push(s));
        coord.startExerciseSession(1);
        coord.onNewResult(failingBuild());
        assert.strictEqual(seen.length, 1);
        sub.dispose();
    });

    test('an idle session drives the engine to an alert and the sink receives it', () => {
        coord.startExerciseSession(1, vscode.Uri.parse('file:///ws'));
        coord.advanceTo(coord.sessionStartMs + 520_000);   // test-only passthrough to engine.advanceTo
        assert.ok(delivered.length >= 1);
        assert.strictEqual(delivered[0].primary, 'STATE');
    });

    test('getSnapshot reflects the last tick', () => {
        coord.startExerciseSession(1);
        coord.advanceTo(coord.sessionStartMs + 20_000);
        const snap = coord.getSnapshot();
        assert.strictEqual(typeof snap.v, 'number');
        assert.strictEqual(snap.sessionSeconds, 20);
    });

    test('onDidTick fires for the recorder', () => {
        coord.startExerciseSession(1);
        const ticks: number[] = [];
        const sub = coord.onDidTick(t => ticks.push(t.t));
        coord.advanceTo(coord.sessionStartMs + 30_000);
        assert.deepStrictEqual(ticks, [10, 20, 30]);
        sub.dispose();
    });

    test('endExerciseSession stops the engine; restart resets', () => {
        coord.startExerciseSession(1);
        coord.advanceTo(coord.sessionStartMs + 30_000);
        coord.endExerciseSession();
        coord.startExerciseSession(2);
        const snap = coord.getSnapshot();
        assert.strictEqual(snap.sessionSeconds, 0);
    });

    test('struggleDetection.enabled=false suppresses intervention delivery (engine still ticks)', () => {
        // Stub the config so the coordinator reads enabled=false at construction.
        const realGet = vscode.workspace.getConfiguration;
        const stub = sinon.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
            const cfg = realGet.call(vscode.workspace, section);
            if (section === 'artemis.struggleDetection') {
                return { ...cfg, get: (key: string, dflt?: unknown) => (key === 'enabled' ? false : cfg.get(key, dflt)) } as vscode.WorkspaceConfiguration;
            }
            return cfg;
        });
        try {
            const seen: AlertRecord[] = [];
            const disabled = new StruggleCoordinator({
                hub: new TestSensorHub(),
                alertSink: { deliver: a => seen.push(a) },
                exerciseRegistry: undefined,
            });
            try {
                assert.strictEqual(disabled.isEnabled(), false);
                disabled.startExerciseSession(1, vscode.Uri.parse('file:///ws'));
                disabled.advanceTo(disabled.sessionStartMs + 520_000);   // would alert at t=490 if enabled
                assert.strictEqual(seen.length, 0, 'no intervention delivered while disabled');
            } finally {
                disabled.dispose();
            }
        } finally {
            stub.restore();
        }
    });
});
