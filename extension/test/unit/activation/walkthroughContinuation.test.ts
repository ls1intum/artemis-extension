/**
 * The Get Started walkthrough's buttons tick their step and move it on to the next one.
 * Each test runs the real command the way a walkthrough link does (with
 * `{ walkthroughStep }`) and the way the palette does (no argument), and records the
 * workbench commands it issues.
 *
 * The test host is never signed in, so Meet Iris is hidden there and the sign-in button
 * always takes the "show the login, finish after it" path. The signed-in branches are
 * covered by the `WalkthroughNavigator` tests in `test/logic/activation/onboarding.test.ts`.
 */

import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { VSCODE_CONFIG } from '@extension/utils';

const CATEGORY = 'aet-tum.iris-thaumantias#artemisGetStarted';

/** Workbench commands recorded instead of run, so no editor or view actually opens. */
const RECORDED = new Set([
    'welcome.markStepComplete',
    'workbench.action.openWalkthrough',
    'artemis.loginView.focus',
    'iris.chatView.focus',
]);

type Call = { id: string; args: unknown[] };

function fakeQuickPickThatIsDismissed(): vscode.QuickPick<vscode.QuickPickItem> {
    const hideListeners: (() => void)[] = [];
    return {
        onDidAccept: () => ({ dispose() {} }),
        onDidHide: (listener: () => void) => {
            hideListeners.push(listener);
            return { dispose() {} };
        },
        show: () => { hideListeners.forEach(listener => listener()); },
        hide: () => {},
        dispose: () => {},
    } as unknown as vscode.QuickPick<vscode.QuickPickItem>;
}

suite('Get Started walkthrough continuation', () => {
    let sandbox: sinon.SinonSandbox;
    let calls: Call[];
    let originalClonePath: string | undefined;

    function ticked(): unknown[] {
        return calls.filter(c => c.id === 'welcome.markStepComplete').map(c => c.args[0]);
    }

    function walkthroughSteps(): unknown[] {
        return calls.filter(c => c.id === 'workbench.action.openWalkthrough').map(c => c.args[0]);
    }

    function globalClonePath(): string | undefined {
        return vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION)
            .inspect<string>(VSCODE_CONFIG.DEFAULT_CLONE_PATH_KEY)?.globalValue;
    }

    async function setClonePath(value: string | undefined): Promise<void> {
        await vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION)
            .update(VSCODE_CONFIG.DEFAULT_CLONE_PATH_KEY, value, vscode.ConfigurationTarget.Global);
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        calls = [];
        originalClonePath = globalClonePath();
        const execute = vscode.commands.executeCommand.bind(vscode.commands);
        sandbox.stub(vscode.commands, 'executeCommand').callsFake(((id: string, ...args: unknown[]) => {
            if (RECORDED.has(id)) {
                calls.push({ id, args });
                return Promise.resolve(undefined);
            }
            return execute(id, ...args);
        }) as typeof vscode.commands.executeCommand);
        sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    });

    teardown(async () => {
        sandbox.restore();
        await setClonePath(originalClonePath);
    });

    suite('server step', () => {
        test('continues to Sign in after the picker is dismissed, which keeps the current server', async () => {
            sandbox.stub(vscode.window, 'createQuickPick').returns(fakeQuickPickThatIsDismissed());

            await vscode.commands.executeCommand('artemis.setServerUrl', { walkthroughStep: 'chooseServer' });

            assert.deepStrictEqual(ticked(), [`${CATEGORY}#chooseServer`]);
            assert.deepStrictEqual(walkthroughSteps(), [{ category: CATEGORY, step: 'signIn' }]);
        });

        test('leaves the walkthrough alone when run from the palette', async () => {
            sandbox.stub(vscode.window, 'createQuickPick').returns(fakeQuickPickThatIsDismissed());

            await vscode.commands.executeCommand('artemis.setServerUrl');

            assert.deepStrictEqual(calls, []);
        });
    });

    suite('sign-in step', () => {
        test('shows the login and waits for the login instead of continuing right away', async () => {
            await vscode.commands.executeCommand('artemis.login', { walkthroughStep: 'signIn' });

            assert.deepStrictEqual(calls.map(c => c.id), ['artemis.loginView.focus']);
        });

        test('shows the login when run from the palette', async () => {
            await vscode.commands.executeCommand('artemis.login');

            assert.deepStrictEqual(calls.map(c => c.id), ['artemis.loginView.focus']);
        });
    });

    suite('folder step', () => {
        test('ticks the step after a folder is chosen and moves past Meet Iris, hidden while signed out', async () => {
            sandbox.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file('/tmp/artemis-exercises')]);

            await vscode.commands.executeCommand('artemis.setDefaultClonePath', { walkthroughStep: 'exerciseFolder' });

            assert.deepStrictEqual(ticked(), [`${CATEGORY}#exerciseFolder`]);
            assert.deepStrictEqual(walkthroughSteps(), [{ category: CATEGORY, step: 'preferences' }]);
        });

        test('neither ticks nor leaves the step when the dialog is cancelled', async () => {
            sandbox.stub(vscode.window, 'showOpenDialog').resolves(undefined);

            await vscode.commands.executeCommand('artemis.setDefaultClonePath', { walkthroughStep: 'exerciseFolder' });

            assert.deepStrictEqual(calls, []);
        });

        test('leaves the walkthrough alone when run from the palette', async () => {
            sandbox.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file('/tmp/artemis-exercises')]);

            await vscode.commands.executeCommand('artemis.setDefaultClonePath');

            assert.deepStrictEqual(calls, []);
        });
    });

    suite('Meet Iris step', () => {
        test('moves the walkthrough on first and focuses the chat last, so the chat keeps the focus', async () => {
            await vscode.commands.executeCommand('artemis.openIrisChat', { walkthroughStep: 'meetIris' });

            assert.deepStrictEqual(calls.map(c => c.id), [
                'welcome.markStepComplete', 'workbench.action.openWalkthrough', 'iris.chatView.focus',
            ]);
            assert.deepStrictEqual(ticked(), [`${CATEGORY}#meetIris`]);
            assert.deepStrictEqual(walkthroughSteps(), [{ category: CATEGORY, step: 'preferences' }]);
        });

        test('only focuses the chat when run from the palette', async () => {
            await vscode.commands.executeCommand('artemis.openIrisChat');

            assert.deepStrictEqual(calls.map(c => c.id), ['iris.chatView.focus']);
        });
    });

    test('a walkthrough that cannot be opened does not fail the command', async () => {
        sandbox.restore();
        sandbox = sinon.createSandbox();
        const execute = vscode.commands.executeCommand.bind(vscode.commands);
        sandbox.stub(vscode.commands, 'executeCommand').callsFake(((id: string, ...args: unknown[]) => {
            if (id === 'workbench.action.openWalkthrough' || id === 'welcome.markStepComplete') {
                return Promise.reject(new Error('command not found'));
            }
            if (RECORDED.has(id)) {
                return Promise.resolve(undefined);
            }
            return execute(id, ...args);
        }) as typeof vscode.commands.executeCommand);

        await vscode.commands.executeCommand('artemis.openIrisChat', { walkthroughStep: 'meetIris' });
    });
});
