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

suite('extractIrisMessageContent: quiz content', () => {
    const SINGLE = '*Iris created a quiz question. Open this chat in Artemis to answer it.*';
    const question = { question: 'q?', options: [{ text: 'a', correct: true }, { text: 'b', correct: false }], explanation: 'e' };
    const json = (attributes: unknown) => ({ type: 'json', attributes });

    test('keeps the intro text and appends one placeholder for a single question', () => {
        assert.strictEqual(
            extractIrisMessageContent([{ type: 'text', textContent: 'Here is a question:' }, json({ type: 'mcq', ...question })]),
            `Here is a question:\n${SINGLE}`,
        );
    });

    test('names the number of questions in a set', () => {
        assert.strictEqual(
            extractIrisMessageContent([json({ type: 'mcq-set', questions: [question, question, question] })]),
            '*Iris created 3 quiz questions. Open this chat in Artemis to answer them.*',
        );
    });

    test('uses the singular wording for a set of one, and for a set without a usable question list', () => {
        assert.strictEqual(extractIrisMessageContent([json({ type: 'mcq-set', questions: [question] })]), SINGLE);
        assert.strictEqual(extractIrisMessageContent([json({ type: 'mcq-set' })]), SINGLE);
        assert.strictEqual(extractIrisMessageContent([json({ type: 'mcq-set', questions: [] })]), SINGLE);
        assert.strictEqual(extractIrisMessageContent([json({ type: 'mcq-set', questions: 'three' })]), SINGLE);
    });

    test('reads attributes serialised as a string', () => {
        assert.strictEqual(extractIrisMessageContent([json(JSON.stringify({ type: 'mcq', ...question }))]), SINGLE);
    });

    test('an unparseable attributes string contributes nothing', () => {
        assert.strictEqual(extractIrisMessageContent([json('{"type":"mcq"')]), '');
    });

    test('json that is not a quiz contributes nothing', () => {
        assert.strictEqual(
            extractIrisMessageContent([json({ type: 'pointOut', parameters: { lectureUnitId: 42, page: 3 } })]),
            '',
        );
    });
});
