import * as assert from 'assert';

import { buildCourseAccessKey, normalizePrincipal, normalizeServerUrl } from '@extension/services/session/identityKeys';

suite('identityKeys', () => {
    test('normalizes a server URL to protocol, host, non-default port and path', () => {
        assert.strictEqual(normalizeServerUrl('HTTPS://Artemis.TUM.de:443/'), 'https://artemis.tum.de');
        assert.strictEqual(normalizeServerUrl('http://localhost:8080/artemis/'), 'http://localhost:8080/artemis');
        assert.strictEqual(normalizeServerUrl('not a url'), null);
    });

    test('prefers the numeric id over the login', () => {
        assert.strictEqual(normalizePrincipal({ id: 7, login: 'ab12cde' }), 'id:7');
        assert.strictEqual(normalizePrincipal({ login: ' AB12CDE ' }), 'login:ab12cde');
        assert.strictEqual(normalizePrincipal({}), null);
    });

    // The one test that protects a student's stored history. The literal is the
    // format that shipped; it may not change without a migration.
    test('builds the frozen course-access storage key', () => {
        assert.strictEqual(
            buildCourseAccessKey('https://artemis.tum.de', 'id:7'),
            'dashboard.courseAccess::https://artemis.tum.de::id:7',
        );
    });
});
