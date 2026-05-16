/**
 * Unit tests for the API-response validators in
 * `extension/src/extension/domain/responseValidation.ts`.
 *
 * The validators are deliberately small. They guard the boundary between
 * `fetch(...).json()` (typed as `unknown`) and the permissive interfaces in
 * `shared/types/apiResponses.ts` so callers can rely on `instanceof
 * MalformedResponseError` to distinguish schema failures from transport
 * failures.
 */

import * as assert from 'assert';

import {
    expectArray,
    expectObject,
    MalformedResponseError,
    parseApiObject,
} from '@extension/domain';

suite('expectObject', () => {
    test('returns the value when it is a plain object', () => {
        const obj = { foo: 'bar' };
        const result = expectObject('thing', obj);
        assert.strictEqual(result, obj);
    });

    test('rejects null', () => {
        assert.throws(
            () => expectObject('thing', null),
            (err: unknown) => err instanceof MalformedResponseError && /got null/.test(err.message),
        );
    });

    test('rejects arrays', () => {
        assert.throws(
            () => expectObject('thing', [1, 2, 3]),
            (err: unknown) => err instanceof MalformedResponseError && /got array/.test(err.message),
        );
    });

    test('rejects primitives', () => {
        for (const v of [42, 'hello', true, undefined]) {
            assert.throws(
                () => expectObject('thing', v),
                (err: unknown) => err instanceof MalformedResponseError,
                `value ${String(v)} must reject`,
            );
        }
    });
});

suite('expectArray', () => {
    test('returns the value when it is an array', () => {
        const arr = [1, 2, 3];
        assert.strictEqual(expectArray('list', arr), arr);
    });

    test('rejects objects', () => {
        assert.throws(
            () => expectArray('list', { 0: 'x' }),
            (err: unknown) => err instanceof MalformedResponseError && /got object/.test(err.message),
        );
    });

    test('rejects null', () => {
        assert.throws(
            () => expectArray('list', null),
            (err: unknown) => err instanceof MalformedResponseError,
        );
    });

    test('elementValidator runs and propagates throws from it', () => {
        assert.throws(
            () => expectArray('list', [1, 2, 'bad'], (item, i) => {
                if (typeof item !== 'number') {
                    throw new Error(`item[${i}] not a number`);
                }
                return item;
            }),
            /item\[2\] not a number/,
        );
    });

    test('elementValidator mapping result is returned', () => {
        const out = expectArray('list', [1, 2, 3], (n) => (n as number) * 10);
        assert.deepStrictEqual(out, [10, 20, 30]);
    });
});

suite('parseApiObject', () => {
    test('passes when all required fields are present with the right type', () => {
        const data = { id: 42, title: 'Foo' };
        const result = parseApiObject<{ id: number; title: string }>('Thing', data, [
            { key: 'id', type: 'number' },
            { key: 'title', type: 'string' },
        ]);
        assert.strictEqual(result.id, 42);
        assert.strictEqual(result.title, 'Foo');
    });

    test('rejects when a required field is missing', () => {
        assert.throws(
            () => parseApiObject('Thing', { title: 'Foo' }, [{ key: 'id', type: 'number' }]),
            (err: unknown) => err instanceof MalformedResponseError && /missing or non-number field "id"/.test(err.message),
        );
    });

    test('rejects when a required field is the wrong type', () => {
        assert.throws(
            () => parseApiObject('Thing', { id: '42' }, [{ key: 'id', type: 'number' }]),
            (err: unknown) => err instanceof MalformedResponseError && /missing or non-number field "id"/.test(err.message),
        );
    });

    test('passes with no required fields (object-shape check only)', () => {
        const result = parseApiObject<{ foo?: string }>('Thing', { foo: 'bar' });
        assert.strictEqual(result.foo, 'bar');
    });

    test('rejects non-object input', () => {
        assert.throws(
            () => parseApiObject('Thing', null),
            (err: unknown) => err instanceof MalformedResponseError,
        );
        assert.throws(
            () => parseApiObject('Thing', [1, 2]),
            (err: unknown) => err instanceof MalformedResponseError,
        );
    });
});
