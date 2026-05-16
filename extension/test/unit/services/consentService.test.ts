import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ConsentService, ConsentLevel } from '@extension/services/auth/consentService';

suite('ConsentService', () => {
    let sandbox: sinon.SinonSandbox;
    let mockConfig: { get: sinon.SinonStub; update: sinon.SinonStub };
    let service: ConsentService;

    setup(() => {
        sandbox = sinon.createSandbox();

        // Mock workspace configuration
        mockConfig = {
            get: sandbox.stub().returns('pending'),
            update: sandbox.stub().resolves(),
        };
        sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

        // Mock onDidChangeConfiguration
        sandbox.stub(vscode.workspace, 'onDidChangeConfiguration').returns({
            dispose: () => { },
        } as vscode.Disposable);

        service = new ConsentService();
    });

    teardown(() => {
        service.dispose();
        sandbox.restore();
    });

    suite('Consent Level', () => {
        test('should return pending when config returns pending', () => {
            mockConfig.get.returns('pending');
            assert.strictEqual(service.consentLevel, ConsentLevel.Pending);
        });

        test('should return declined when config returns declined', () => {
            mockConfig.get.returns('declined');
            assert.strictEqual(service.consentLevel, ConsentLevel.Declined);
        });

        test('should return basic when config returns basic', () => {
            mockConfig.get.returns('basic');
            assert.strictEqual(service.consentLevel, ConsentLevel.Basic);
        });

        test('should return extended when config returns extended', () => {
            mockConfig.get.returns('extended');
            assert.strictEqual(service.consentLevel, ConsentLevel.Extended);
        });

        test('should default to pending for unknown values', () => {
            mockConfig.get.returns('unknown');
            assert.strictEqual(service.consentLevel, ConsentLevel.Pending);
        });
    });

    suite('Data Collection Flags', () => {
        test('isExtendedCollectionEnabled should be true only for extended', () => {
            mockConfig.get.returns('extended');
            assert.strictEqual(service.isExtendedCollectionEnabled, true);

            mockConfig.get.returns('basic');
            assert.strictEqual(service.isExtendedCollectionEnabled, false);
        });
    });

    suite('promptIfPending', () => {
        test('should show notification when consent is pending', async () => {
            mockConfig.get.returns('pending');
            const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

            await service.promptIfPending();

            assert.ok(showInfoStub.calledOnce, 'showInformationMessage should be called');
            assert.ok(
                showInfoStub.firstCall.args[0].includes('Help improve Iris'),
                'Message should mention improving Iris'
            );
        });

        test('should not show notification when consent is declined', async () => {
            mockConfig.get.returns('declined');
            const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

            await service.promptIfPending();

            assert.ok(showInfoStub.notCalled, 'showInformationMessage should not be called');
        });

        test('should not show notification when consent is basic', async () => {
            mockConfig.get.returns('basic');
            const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

            await service.promptIfPending();

            assert.ok(showInfoStub.notCalled, 'showInformationMessage should not be called');
        });

        test('should not show notification when consent is extended', async () => {
            mockConfig.get.returns('extended');
            const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

            await service.promptIfPending();

            assert.ok(showInfoStub.notCalled, 'showInformationMessage should not be called');
        });

        test('should set consent to basic when Accept is clicked', async () => {
            mockConfig.get.returns('pending');
            sandbox.stub(vscode.window, 'showInformationMessage').resolves('Accept' as any);

            await service.promptIfPending();

            assert.ok(mockConfig.update.calledOnce, 'config.update should be called');
            assert.strictEqual(mockConfig.update.firstCall.args[0], 'dataCollectionConsent');
            assert.strictEqual(mockConfig.update.firstCall.args[1], 'basic');
        });

        test('should set consent to declined when Decline is clicked', async () => {
            mockConfig.get.returns('pending');
            sandbox.stub(vscode.window, 'showInformationMessage').resolves('Decline' as any);

            await service.promptIfPending();

            assert.ok(mockConfig.update.calledOnce, 'config.update should be called');
            assert.strictEqual(mockConfig.update.firstCall.args[0], 'dataCollectionConsent');
            assert.strictEqual(mockConfig.update.firstCall.args[1], 'declined');
        });
    });

    suite('setConsent', () => {
        test('should update configuration with correct value', async () => {
            await service.setConsent(ConsentLevel.Extended);

            assert.ok(mockConfig.update.calledOnce, 'config.update should be called');
            assert.strictEqual(mockConfig.update.firstCall.args[0], 'dataCollectionConsent');
            assert.strictEqual(mockConfig.update.firstCall.args[1], 'extended');
            assert.strictEqual(mockConfig.update.firstCall.args[2], vscode.ConfigurationTarget.Global);
        });
    });

    suite('Disposal', () => {
        test('should dispose resources correctly', () => {
            // Should not throw
            service.dispose();
        });
    });
});
