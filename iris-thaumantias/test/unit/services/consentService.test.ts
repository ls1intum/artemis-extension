import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ConsentService, ConsentLevel } from '../../../src/services/consentService';

suite('ConsentService', () => {
    let sandbox: sinon.SinonSandbox;
    let mockConfig: { get: sinon.SinonStub; update: sinon.SinonStub };

    setup(() => {
        sandbox = sinon.createSandbox();

        // Reset the singleton instance before each test
        ConsentService.resetInstance();

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
    });

    teardown(() => {
        ConsentService.resetInstance();
        sandbox.restore();
    });

    suite('Singleton Pattern', () => {
        test('should return the same instance', () => {
            const instance1 = ConsentService.getInstance();
            const instance2 = ConsentService.getInstance();
            assert.strictEqual(instance1, instance2);
        });

        test('should create new instance after reset', () => {
            const instance1 = ConsentService.getInstance();
            ConsentService.resetInstance();
            const instance2 = ConsentService.getInstance();
            assert.notStrictEqual(instance1, instance2);
        });
    });

    suite('Consent Level', () => {
        test('should return pending when config returns pending', () => {
            mockConfig.get.returns('pending');
            const service = ConsentService.getInstance();
            assert.strictEqual(service.consentLevel, ConsentLevel.Pending);
        });

        test('should return declined when config returns declined', () => {
            mockConfig.get.returns('declined');
            const service = ConsentService.getInstance();
            assert.strictEqual(service.consentLevel, ConsentLevel.Declined);
        });

        test('should return basic when config returns basic', () => {
            mockConfig.get.returns('basic');
            const service = ConsentService.getInstance();
            assert.strictEqual(service.consentLevel, ConsentLevel.Basic);
        });

        test('should return extended when config returns extended', () => {
            mockConfig.get.returns('extended');
            const service = ConsentService.getInstance();
            assert.strictEqual(service.consentLevel, ConsentLevel.Extended);
        });

        test('should default to pending for unknown values', () => {
            mockConfig.get.returns('unknown');
            const service = ConsentService.getInstance();
            assert.strictEqual(service.consentLevel, ConsentLevel.Pending);
        });
    });

    suite('Data Collection Flags', () => {
        test('isDataCollectionEnabled should be false for pending', () => {
            mockConfig.get.returns('pending');
            const service = ConsentService.getInstance();
            assert.strictEqual(service.isDataCollectionEnabled, false);
        });

        test('isDataCollectionEnabled should be false for declined', () => {
            mockConfig.get.returns('declined');
            const service = ConsentService.getInstance();
            assert.strictEqual(service.isDataCollectionEnabled, false);
        });

        test('isDataCollectionEnabled should be true for basic', () => {
            mockConfig.get.returns('basic');
            const service = ConsentService.getInstance();
            assert.strictEqual(service.isDataCollectionEnabled, true);
        });

        test('isDataCollectionEnabled should be true for extended', () => {
            mockConfig.get.returns('extended');
            const service = ConsentService.getInstance();
            assert.strictEqual(service.isDataCollectionEnabled, true);
        });

        test('isExtendedCollectionEnabled should be true only for extended', () => {
            mockConfig.get.returns('extended');
            const service = ConsentService.getInstance();
            assert.strictEqual(service.isExtendedCollectionEnabled, true);

            mockConfig.get.returns('basic');
            ConsentService.resetInstance();
            const service2 = ConsentService.getInstance();
            assert.strictEqual(service2.isExtendedCollectionEnabled, false);
        });
    });

    suite('promptIfPending', () => {
        test('should show notification when consent is pending', async () => {
            mockConfig.get.returns('pending');
            const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

            const service = ConsentService.getInstance();
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

            const service = ConsentService.getInstance();
            await service.promptIfPending();

            assert.ok(showInfoStub.notCalled, 'showInformationMessage should not be called');
        });

        test('should not show notification when consent is basic', async () => {
            mockConfig.get.returns('basic');
            const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

            const service = ConsentService.getInstance();
            await service.promptIfPending();

            assert.ok(showInfoStub.notCalled, 'showInformationMessage should not be called');
        });

        test('should not show notification when consent is extended', async () => {
            mockConfig.get.returns('extended');
            const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

            const service = ConsentService.getInstance();
            await service.promptIfPending();

            assert.ok(showInfoStub.notCalled, 'showInformationMessage should not be called');
        });

        test('should set consent to basic when Accept is clicked', async () => {
            mockConfig.get.returns('pending');
            sandbox.stub(vscode.window, 'showInformationMessage').resolves('Accept' as any);

            const service = ConsentService.getInstance();
            await service.promptIfPending();

            assert.ok(mockConfig.update.calledOnce, 'config.update should be called');
            assert.strictEqual(mockConfig.update.firstCall.args[0], 'dataCollectionConsent');
            assert.strictEqual(mockConfig.update.firstCall.args[1], 'basic');
        });

        test('should set consent to declined when Decline is clicked', async () => {
            mockConfig.get.returns('pending');
            sandbox.stub(vscode.window, 'showInformationMessage').resolves('Decline' as any);

            const service = ConsentService.getInstance();
            await service.promptIfPending();

            assert.ok(mockConfig.update.calledOnce, 'config.update should be called');
            assert.strictEqual(mockConfig.update.firstCall.args[0], 'dataCollectionConsent');
            assert.strictEqual(mockConfig.update.firstCall.args[1], 'declined');
        });
    });

    suite('setConsent', () => {
        test('should update configuration with correct value', async () => {
            const service = ConsentService.getInstance();
            await service.setConsent(ConsentLevel.Extended);

            assert.ok(mockConfig.update.calledOnce, 'config.update should be called');
            assert.strictEqual(mockConfig.update.firstCall.args[0], 'dataCollectionConsent');
            assert.strictEqual(mockConfig.update.firstCall.args[1], 'extended');
            assert.strictEqual(mockConfig.update.firstCall.args[2], vscode.ConfigurationTarget.Global);
        });
    });

    suite('Disposal', () => {
        test('should dispose resources correctly', () => {
            const service = ConsentService.getInstance();
            // Should not throw
            service.dispose();
        });
    });
});
