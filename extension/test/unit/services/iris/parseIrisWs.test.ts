/**
 * Unit tests for the light-touch Iris WS guards (#183 part B).
 *
 * Light-touch means: reject obvious shape failures (null, arrays, primitives)
 * but trust the type interface for per-field details. The downstream handler
 * (`IrisWebSocketMessageHandler.handleIrisWebSocketMessage`) performs the
 * per-message narrowing.
 */

import * as assert from 'assert';

import { isIrisActivity, isIrisWebSocketMessage } from '@extension/services/iris/parseIrisWs';

suite('isIrisWebSocketMessage', () => {
    test('accepts a plain object', () => {
        assert.strictEqual(isIrisWebSocketMessage({ type: 'MESSAGE' }), true);
    });

    test('accepts an empty object', () => {
        assert.strictEqual(isIrisWebSocketMessage({}), true);
    });

    test('rejects null', () => {
        assert.strictEqual(isIrisWebSocketMessage(null), false);
    });

    test('rejects undefined', () => {
        assert.strictEqual(isIrisWebSocketMessage(undefined), false);
    });

    test('rejects arrays', () => {
        assert.strictEqual(isIrisWebSocketMessage([{ type: 'MESSAGE' }]), false);
    });

    test('rejects primitives', () => {
        assert.strictEqual(isIrisWebSocketMessage('STATUS'), false);
        assert.strictEqual(isIrisWebSocketMessage(42), false);
        assert.strictEqual(isIrisWebSocketMessage(true), false);
    });
});

suite('isIrisActivity', () => {
    const valid = { id: 'a1', kind: 'TOOL', name: 'file_lookup', state: 'RUNNING' };

    test('accepts a well-formed activity', () => {
        assert.strictEqual(isIrisActivity(valid), true);
    });

    test('rejects an unknown state', () => {
        assert.strictEqual(isIrisActivity({ ...valid, state: 'DONE' }), false);
    });

    test('rejects an unknown kind', () => {
        assert.strictEqual(isIrisActivity({ ...valid, kind: 'MAGIC' }), false);
    });

    test('rejects missing or wrongly typed id and name', () => {
        assert.strictEqual(isIrisActivity({ ...valid, id: undefined }), false);
        assert.strictEqual(isIrisActivity({ ...valid, name: 42 }), false);
    });

    test('rejects non-objects', () => {
        assert.strictEqual(isIrisActivity(null), false);
        assert.strictEqual(isIrisActivity([valid]), false);
    });
});
