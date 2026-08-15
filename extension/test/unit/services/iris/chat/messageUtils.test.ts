/**
 * Unit tests for `extractIrisMessageContent`. The function must always return a
 * string, including for null/undefined input: `IrisWebSocketMessageHandler` reads
 * `content.length` on the result and crashes on `undefined`.
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
        // The declared return type is `string`, and null/undefined must honour it.
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

    test('part without textContent yields empty string', () => {
        // Items without textContent are unrecognised and contribute nothing.
        // The function must not crash and must still return a string.
        const out = extractIrisMessageContent([{}]);
        assert.strictEqual(typeof out, 'string');
        assert.strictEqual(out, '');
    });

    test('empty array falls through to JSON.stringify', () => {
        // An empty array does not match the length > 0 branch and serializes to
        // `'[]'`. Every call site tolerates that.
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
