import * as assert from 'assert';

import { extractJwtFromHeaders } from '@extension/services/websocket/jwtExtractor';

suite('extractJwtFromHeaders', () => {
    test('extracts JWT from Bearer Authorization header', () => {
        assert.strictEqual(
            extractJwtFromHeaders({ Authorization: 'Bearer abc.def.ghi' }),
            'abc.def.ghi'
        );
    });

    test('extracts JWT from Cookie header (jwt cookie)', () => {
        assert.strictEqual(
            extractJwtFromHeaders({ Cookie: 'jwt=abc.def.ghi; other=foo' }),
            'abc.def.ghi'
        );
    });

    test('returns undefined when no JWT is present', () => {
        assert.strictEqual(extractJwtFromHeaders({}), undefined);
        assert.strictEqual(extractJwtFromHeaders({ Cookie: 'other=foo' }), undefined);
    });

    test('handles Bearer with no token gracefully', () => {
        assert.strictEqual(extractJwtFromHeaders({ Authorization: 'Bearer ' }), '');
    });
});
