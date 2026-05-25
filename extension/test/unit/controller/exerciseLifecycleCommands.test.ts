import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { WebviewCmd } from '@shared/messageContracts/webviewCommands';

import { ExerciseLifecycleCommands } from '@extension/controller/commands/exerciseLifecycleCommands';
import type { CommandContext } from '@extension/controller/commands/types';

suite('ExerciseLifecycleCommands', () => {
    let sandbox: sinon.SinonSandbox;
    let showErrorMessage: sinon.SinonStub;
    let showInformationMessage: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as never);
        showInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined as never);
    });

    teardown(() => {
        sandbox.restore();
    });

    function buildContext(overrides: {
        startPracticeParticipation?: sinon.SinonStub;
        startExerciseParticipation?: sinon.SinonStub;
        openExerciseDetails?: sinon.SinonStub;
    }): CommandContext {
        return {
            artemisApi: {
                startPracticeParticipation: overrides.startPracticeParticipation ?? sandbox.stub().resolves(undefined),
                startExerciseParticipation: overrides.startExerciseParticipation ?? sandbox.stub().resolves(undefined),
            },
            actionHandler: {
                openExerciseDetails: overrides.openExerciseDetails ?? sandbox.stub().resolves(undefined),
            },
        } as unknown as CommandContext;
    }

    test('getHandlers returns exactly startPractice and startExercise keys', () => {
        const ctx = buildContext({});
        const mod = new ExerciseLifecycleCommands(ctx);

        const keys = Object.keys(mod.getHandlers()).sort();

        assert.deepStrictEqual(keys, [WebviewCmd.StartExercise, WebviewCmd.StartPractice].sort());
    });

    test('startPractice happy path: calls API, shows success message with title, and opens exercise details', async () => {
        const startPracticeParticipation = sandbox.stub().resolves({ id: 99 });
        const openExerciseDetails = sandbox.stub().resolves(undefined);
        const ctx = buildContext({ startPracticeParticipation, openExerciseDetails });
        const mod = new ExerciseLifecycleCommands(ctx);

        await mod.getHandlers()[WebviewCmd.StartPractice]({
            type: 'command',
            command: WebviewCmd.StartPractice,
            payload: { exerciseId: 42, exerciseTitle: 'Sorting Algorithms' },
        } as never);

        sinon.assert.calledOnceWithExactly(startPracticeParticipation, 42);
        sinon.assert.calledOnceWithExactly(openExerciseDetails, 42);
        const messages = showInformationMessage.getCalls().map(c => c.args[0] as string);
        assert.ok(
            messages.some(m => m.includes('Sorting Algorithms')),
            `Expected an information message to contain the exercise title; got: ${JSON.stringify(messages)}`,
        );
    });

    test('startPractice does NOT open exercise details when API returns a falsy participation', async () => {
        const startPracticeParticipation = sandbox.stub().resolves(undefined);
        const openExerciseDetails = sandbox.stub().resolves(undefined);
        const ctx = buildContext({ startPracticeParticipation, openExerciseDetails });
        const mod = new ExerciseLifecycleCommands(ctx);

        await mod.getHandlers()[WebviewCmd.StartPractice]({
            type: 'command',
            command: WebviewCmd.StartPractice,
            payload: { exerciseId: 7, exerciseTitle: 'Title' },
        } as never);

        sinon.assert.calledOnceWithExactly(startPracticeParticipation, 7);
        sinon.assert.notCalled(openExerciseDetails);
    });

    test('startPractice surfaces an error toast prefixed with "Failed to start practice mode:" when the API throws', async () => {
        const startPracticeParticipation = sandbox.stub().rejects(new Error('boom'));
        const openExerciseDetails = sandbox.stub().resolves(undefined);
        const ctx = buildContext({ startPracticeParticipation, openExerciseDetails });
        const mod = new ExerciseLifecycleCommands(ctx);

        await mod.getHandlers()[WebviewCmd.StartPractice]({
            type: 'command',
            command: WebviewCmd.StartPractice,
            payload: { exerciseId: 1, exerciseTitle: 'X' },
        } as never);

        sinon.assert.notCalled(openExerciseDetails);
        sinon.assert.calledOnce(showErrorMessage);
        const msg = showErrorMessage.firstCall.args[0] as string;
        assert.ok(
            msg.startsWith('Failed to start practice mode:'),
            `Expected error message to start with "Failed to start practice mode:"; got: ${msg}`,
        );
    });

    test('startExercise happy path: calls API and opens exercise details on success', async () => {
        const startExerciseParticipation = sandbox.stub().resolves({ id: 123 });
        const openExerciseDetails = sandbox.stub().resolves(undefined);
        const ctx = buildContext({ startExerciseParticipation, openExerciseDetails });
        const mod = new ExerciseLifecycleCommands(ctx);

        await mod.getHandlers()[WebviewCmd.StartExercise]({
            type: 'command',
            command: WebviewCmd.StartExercise,
            payload: { exerciseId: 55 },
        } as never);

        sinon.assert.calledOnceWithExactly(startExerciseParticipation, 55);
        sinon.assert.calledOnceWithExactly(openExerciseDetails, 55);
    });

    test('startExercise surfaces an error toast prefixed with "Failed to start exercise:" when the API throws', async () => {
        const startExerciseParticipation = sandbox.stub().rejects(new Error('network down'));
        const openExerciseDetails = sandbox.stub().resolves(undefined);
        const ctx = buildContext({ startExerciseParticipation, openExerciseDetails });
        const mod = new ExerciseLifecycleCommands(ctx);

        await mod.getHandlers()[WebviewCmd.StartExercise]({
            type: 'command',
            command: WebviewCmd.StartExercise,
            payload: { exerciseId: 2 },
        } as never);

        sinon.assert.notCalled(openExerciseDetails);
        sinon.assert.calledOnce(showErrorMessage);
        const msg = showErrorMessage.firstCall.args[0] as string;
        assert.ok(
            msg.startsWith('Failed to start exercise:'),
            `Expected error message to start with "Failed to start exercise:"; got: ${msg}`,
        );
    });
});
