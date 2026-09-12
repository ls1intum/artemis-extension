/**
 * Unit tests for `ServerVersionNotifier`.
 *
 * Two properties matter more than the happy path.
 *
 * The probe must never be authenticated. `getProfileInfo` goes through
 * `makeRequest`, whose 401 branch clears the stored credential and fires the
 * auth-expired handler. This check runs beside a fresh sign-in, so borrowing that
 * path would let a diagnostic sign the user back out.
 *
 * And the guard must be a promise, not a boolean. Two concurrent sign-in
 * navigations would both pass a boolean set on display and warn twice.
 */

import * as assert from 'assert';

import { ServerVersionNotifier } from '@extension/services/serverVersionNotifier';

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    } as unknown as Response;
}

function makeNotifier(fetchInfo: (url: string) => Promise<Response>) {
    const warnings: string[] = [];
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const notifier = new ServerVersionNotifier({
        fetchInfo: (url, init) => { calls.push({ url, init }); return fetchInfo(url); },
        showWarning: (message) => { warnings.push(message); },
    });
    return { notifier, warnings, calls };
}

const OLD = { activeProfiles: [], activeModuleFeatures: [], build: { version: '9.8.1' } };
const CURRENT = { activeProfiles: [], activeModuleFeatures: [], build: { version: '9.9.2' } };

/** Lets the probe's microtask chain run to completion. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

suite('ServerVersionNotifier', () => {
    test('warns once for a server that is too old', async () => {
        const { notifier, warnings } = makeNotifier(async () => jsonResponse(OLD));
        notifier.check('https://artemis.example.edu');
        await settle();

        assert.strictEqual(warnings.length, 1);
        assert.ok(/9\.8\.1/.test(warnings[0]), warnings[0]);
        assert.ok(/9\.9\.0/.test(warnings[0]), warnings[0]);
    });

    test('a second check for the same server stays quiet', async () => {
        const { notifier, warnings } = makeNotifier(async () => jsonResponse(OLD));
        notifier.check('https://artemis.example.edu');
        await settle();
        notifier.check('https://artemis.example.edu/');
        await settle();

        assert.strictEqual(warnings.length, 1, 'the trailing slash is the same server after normalization');
    });

    test('two concurrent checks produce one warning', async () => {
        const { notifier, warnings, calls } = makeNotifier(async () => jsonResponse(OLD));
        notifier.check('https://artemis.example.edu');
        notifier.check('https://artemis.example.edu');
        await settle();

        assert.strictEqual(warnings.length, 1);
        assert.strictEqual(calls.length, 1, 'the guard is registered before the first await');
    });

    test('a supported version says nothing', async () => {
        const { notifier, warnings } = makeNotifier(async () => jsonResponse(CURRENT));
        notifier.check('https://artemis.tum.de');
        await settle();

        assert.strictEqual(warnings.length, 0);
    });

    test('a non-2xx rejects rather than counting as a versionless success, and can be retried', async () => {
        let attempts = 0;
        const { notifier, warnings } = makeNotifier(async () => {
            attempts++;
            return attempts === 1 ? jsonResponse({}, 404) : jsonResponse(OLD);
        });

        notifier.check('https://artemis.example.edu');
        await settle();
        assert.strictEqual(warnings.length, 0, 'nothing to say when the probe did not answer');

        notifier.check('https://artemis.example.edu');
        await settle();
        assert.strictEqual(warnings.length, 1, 'a failed probe must not consume the one attempt');
    });

    test('a rejected probe is swallowed, not thrown at the caller', async () => {
        const { notifier, warnings } = makeNotifier(async () => { throw new Error('offline'); });
        assert.doesNotThrow(() => notifier.check('https://artemis.example.edu'));
        await settle();
        assert.strictEqual(warnings.length, 0);
    });

    test('a different server is checked again', async () => {
        const { notifier, warnings } = makeNotifier(async () => jsonResponse(OLD));
        notifier.check('https://a.example.edu');
        await settle();
        notifier.check('https://b.example.edu');
        await settle();

        assert.strictEqual(warnings.length, 2);
    });

    test('an unparseable server URL is skipped entirely', async () => {
        const { notifier, calls } = makeNotifier(async () => jsonResponse(OLD));
        notifier.check('not a url');
        await settle();

        assert.deepStrictEqual(calls, []);
    });

    test('the probe hits management/info and sends no headers at all', async () => {
        // The load-bearing test. If someone reroutes this through makeRequest to
        // "reuse getProfileInfo", a 401 during the probe clears the credential of
        // the session that has just signed in. Asserting on the absence of every
        // header is blunter than checking for Cookie and Authorization by name,
        // and blunt is what is wanted: a header added here later should have to
        // delete this assertion on purpose.
        const { notifier, calls } = makeNotifier(async () => jsonResponse(CURRENT));
        notifier.check('https://artemis.tum.de');
        await settle();

        assert.strictEqual(calls.length, 1, 'the probe ran');
        assert.ok(calls[0].url.endsWith('/management/info'), calls[0].url);
        assert.strictEqual(calls[0].init.headers, undefined, 'no headers, and above all no Cookie or Authorization');
        assert.strictEqual(calls[0].init.method, 'GET');
    });
});
