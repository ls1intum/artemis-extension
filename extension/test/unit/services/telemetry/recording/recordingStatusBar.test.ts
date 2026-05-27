import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { RecordingStatusBarService } from '@extension/services/telemetry/recording/recordingStatusBar';
import type { SessionRecorder } from '@extension/services/telemetry/recording/sessionRecorder';

function makeRecorderStub(): SessionRecorder {
    const emitter = new vscode.EventEmitter<{ isEnabled: boolean; isRecording: boolean }>();
    return {
        isEnabled: true,
        isRecording: false,
        onDidChangeState: emitter.event,
        startSession: sinon.stub().resolves(),
        endSession: sinon.stub().resolves(),
    } as unknown as SessionRecorder;
}

suite('RecordingStatusBarService gate', () => {
    let sandbox: sinon.SinonSandbox;
    let recorder: SessionRecorder;
    let warnStub: sinon.SinonStub;
    let bar: RecordingStatusBarService;
    let capturedHandler: (() => Promise<void>) | undefined;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(vscode.window, 'createStatusBarItem').returns({
            dispose: () => undefined, show: () => undefined, hide: () => undefined,
            text: '', backgroundColor: undefined, tooltip: '', command: '',
        } as unknown as vscode.StatusBarItem);
        capturedHandler = undefined;
        sandbox.stub(vscode.commands, 'registerCommand').callsFake((id: string, handler: () => Promise<void>) => {
            if (id === RecordingStatusBarService.COMMAND_ID) {
                capturedHandler = handler;
            }
            return { dispose: () => undefined };
        });
        warnStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined as never);
        recorder = makeRecorderStub();
    });

    teardown(() => {
        bar?.dispose();
        sandbox.restore();
    });

    async function click(): Promise<void> {
        assert.ok(capturedHandler, 'command handler was not captured by the stub');
        await capturedHandler();
    }

    test('starts a session when the getter returns a number', async () => {
        bar = new RecordingStatusBarService(recorder, () => 42);
        await click();
        const startStub = recorder.startSession as sinon.SinonStub;
        assert.ok(startStub.calledOnce);
        assert.strictEqual(startStub.firstCall.args[0], 42);
        assert.ok(!warnStub.called);
    });

    test('shows the new warning text when the getter returns undefined', async () => {
        bar = new RecordingStatusBarService(recorder, () => undefined);
        await click();
        assert.ok((recorder.startSession as sinon.SinonStub).notCalled);
        assert.ok(warnStub.calledOnceWith('No Artemis exercise detected for the current workspace.'));
    });

    test('the getter is invoked exactly once per Record click', async () => {
        const getter = sandbox.stub().returns(7);
        bar = new RecordingStatusBarService(recorder, getter);
        await click();
        assert.strictEqual(getter.callCount, 1);
    });
});
