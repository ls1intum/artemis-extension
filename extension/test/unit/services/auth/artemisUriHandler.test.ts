import * as assert from 'assert';
import * as vscode from 'vscode';
import { ArtemisUriHandler } from '@extension/services/auth/artemisUriHandler';

suite('Artemis URI Handler Test Suite', () => {
    test('should pass code to handler when code parameter is present', async () => {
        let capturedCode: string | null = null;
        const handler = new ArtemisUriHandler(async (code: string) => {
            capturedCode = code;
        });

        const uri = { query: 'code=test_code_123' } as vscode.Uri;
        await handler.handleUri(uri);

        assert.strictEqual(capturedCode, 'test_code_123');
    });

    test('should handle error parameter without calling code handler', async () => {
        let called = false;
        const handler = new ArtemisUriHandler(async () => {
            called = true;
        });

        const uri = { query: 'error=deactivated' } as vscode.Uri;
        await handler.handleUri(uri);

        assert.strictEqual(called, false);
    });
});
