/**
 * Unit tests for the light-touch Iris WS guards (#183 part B).
 *
 * Light-touch means: reject obvious shape failures (null, arrays, primitives)
 * but trust the type interface for per-field details. The downstream handler
 * (`IrisWebSocketMessageHandler.handleIrisWebSocketMessage`) performs the
 * per-message narrowing.
 */

import * as assert from 'assert';

import { isIrisActivity, isIrisWebSocketMessage, isVisibleIrisStage } from '@extension/services/iris/parseIrisWs';

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

suite('isVisibleIrisStage', () => {
    test('accepts an object without an internal flag (default-visible)', () => {
        assert.strictEqual(isVisibleIrisStage({ name: 'Compile', state: 'DONE' }), true);
    });

    test('accepts an object with internal: false', () => {
        assert.strictEqual(isVisibleIrisStage({ name: 'Compile', internal: false }), true);
    });

    test('rejects an object with internal: true', () => {
        assert.strictEqual(isVisibleIrisStage({ name: 'Bookkeeping', internal: true }), false);
    });

    test('accepts an object with truthy-but-not-true internal value', () => {
        // Production code checks `internal !== true`. Anything other than
        // literal `true` (including 1, 'yes', objects) means "visible".
        // Documenting this here so the guard's lenient semantic is intentional.
        assert.strictEqual(isVisibleIrisStage({ internal: 1 }), true);
        assert.strictEqual(isVisibleIrisStage({ internal: 'yes' }), true);
    });

    test('rejects null', () => {
        assert.strictEqual(isVisibleIrisStage(null), false);
    });

    test('rejects arrays', () => {
        assert.strictEqual(isVisibleIrisStage([]), false);
    });

    test('rejects primitives', () => {
        assert.strictEqual(isVisibleIrisStage('Compile'), false);
        assert.strictEqual(isVisibleIrisStage(0), false);
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
