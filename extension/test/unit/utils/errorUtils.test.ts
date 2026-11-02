import * as vscode from 'vscode';
import * as assert from 'assert';

import { isCancellationError } from '@extension/utils/errorUtils';

suite('isCancellationError', () => {
    test('matches the API cancellation and the error a shutdown rejects pending calls with', () => {
        assert.strictEqual(isCancellationError(new vscode.CancellationError()), true);
        assert.strictEqual(isCancellationError(Object.assign(new Error('Canceled'), { name: 'Canceled' })), true);
    });

    test('needs both the name and the message', () => {
        assert.strictEqual(isCancellationError(Object.assign(new Error('boom'), { name: 'Canceled' })), false);
        assert.strictEqual(isCancellationError(new Error('Canceled')), false);
    });

    test('rejects values that are not errors', () => {
        assert.strictEqual(isCancellationError('Canceled'), false);
        assert.strictEqual(isCancellationError(undefined), false);
    });
});
