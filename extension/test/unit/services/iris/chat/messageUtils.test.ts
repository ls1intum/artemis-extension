/**
 * Unit tests for `extractIrisMessageContent` (#193 fix). With null/undefined
 * inputs the function previously returned the *value* `undefined` from
 * `JSON.stringify`, which then crashed `IrisWebSocketMessageHandler` on
 * `content.length`.
 */

import * as assert from 'assert';

import { extractIrisMessageContent } from '@extension/services/iris/chat/messageUtils';

suite('extractIrisMessageContent: null / undefined (regression #193)', () => {
    test('returns empty string for undefined', () => {
        assert.strictEqual(extractIrisMessageContent(undefined), '');
    });

    test('returns empty string for null', () => {
        assert.strictEqual(extractIrisMessageContent(null), '');
    });

    test('result is always a string (type-honest)', () => {
        // The declared return type is `string`; verify it for the inputs
        // that previously violated the contract.
        assert.strictEqual(typeof extractIrisMessageContent(undefined), 'string');
        assert.strictEqual(typeof extractIrisMessageContent(null), 'string');
    });
});

suite('extractIrisMessageContent: string inputs', () => {
    test('passes through plain strings unchanged', () => {
        assert.strictEqual(extractIrisMessageContent('hello'), 'hello');
    });

    test('passes through empty string unchanged', () => {
        assert.strictEqual(extractIrisMessageContent(''), '');
    });
});

suite('extractIrisMessageContent: array of content parts', () => {
    test('joins textContent fields with newline', () => {
        const parts = [{ textContent: 'first' }, { textContent: 'second' }];
        assert.strictEqual(extractIrisMessageContent(parts), 'first\nsecond');
    });

    test('single textContent part', () => {
        assert.strictEqual(extractIrisMessageContent([{ textContent: 'only' }]), 'only');
    });

    test('part without textContent falls back to String(item)', () => {
        // Items without textContent and without a custom toString collapse
        // to the default `[object Object]` rendering. Not pretty, but the
        // function must not crash and must still return a string.
        const out = extractIrisMessageContent([{}]);
        assert.strictEqual(typeof out, 'string');
        assert.ok(out.length > 0);
    });

    test('empty array falls through to JSON.stringify', () => {
        // Pre-existing behaviour: empty array does not match the
        // length > 0 branch and serializes to `'[]'`. Documenting here
        // so a future refactor noticing it knows the call sites have
        // tolerated this for the entire history of the function.
        assert.strictEqual(extractIrisMessageContent([]), '[]');
    });
});

suite('extractIrisMessageContent: other inputs (defensive)', () => {
    test('object input serializes via JSON.stringify', () => {
        assert.strictEqual(extractIrisMessageContent({ a: 1 }), '{"a":1}');
    });

    test('number input serializes via JSON.stringify', () => {
        assert.strictEqual(extractIrisMessageContent(42), '42');
    });
});

suite('extractIrisMessageContent: object content parts', () => {
    test('an object content part without textContent yields no text', () => {
        assert.strictEqual(extractIrisMessageContent([{ type: 'unknown', payload: { a: 1 } }]), '');
    });

    test('a recognised part is unaffected by an unrecognised sibling', () => {
        assert.strictEqual(
            extractIrisMessageContent([{ type: 'unknown' }, { textContent: 'hallo', type: 'text' }]),
            'hallo',
        );
    });
});
