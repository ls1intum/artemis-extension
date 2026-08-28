import * as assert from 'assert';

import { HandoverFailureStore } from '@extension/services/auth/handoverFailureStore';

suite('HandoverFailureStore', () => {
    test('starts with nothing to report', () => {
        assert.strictEqual(new HandoverFailureStore().current, undefined);
    });

    test('records a failure for the handover that is still current', () => {
        const store = new HandoverFailureStore();
        const generation = store.begin();

        const failure = store.record(generation, 'could not open', 'a-1');

        assert.ok(failure);
        assert.deepStrictEqual(store.current, { error: 'could not open', generation, attemptId: 'a-1' });
    });

    test('refuses a failure from a handover a newer one has superseded', () => {
        // The abandoned navigation is still running and eventually throws. By then it is not news about
        // anything the user is waiting for, and letting it write would bury the newer outcome.
        const store = new HandoverFailureStore();
        const old = store.begin();
        store.begin();

        assert.strictEqual(store.record(old, 'stale'), undefined);
        assert.strictEqual(store.current, undefined);
    });

    test('a stale success cannot clear a newer failure', () => {
        const store = new HandoverFailureStore();
        const old = store.begin();
        const current = store.begin();
        store.record(current, 'the real one');

        store.clearFor(old);

        assert.strictEqual(store.current?.error, 'the real one');
    });

    test('its own success clears it', () => {
        const store = new HandoverFailureStore();
        const generation = store.begin();
        store.record(generation, 'transient');

        store.clearFor(generation);

        assert.strictEqual(store.current, undefined);
    });

    test('clear drops the record whatever generation it belongs to', () => {
        // For the things that make it meaningless regardless: a deliberate new sign-in, and the
        // credential it refers to going away.
        const store = new HandoverFailureStore();
        store.record(store.begin(), 'obsolete');

        store.clear();

        assert.strictEqual(store.current, undefined);
    });

    test('a handover still open when the credential went away can no longer record', () => {
        // Logout, an expired session or a server change clears the store while a navigation from the
        // sign-in before it is still running. When that navigation then fails, its record would claim
        // the user is signed in and only needs to reload, with no credential behind it.
        const store = new HandoverFailureStore();
        const generation = store.begin();

        store.clear();

        assert.strictEqual(store.record(generation, 'signed in, could not open'), undefined);
        assert.strictEqual(store.current, undefined);
    });

    test('a handover opened after the credential went away still records', () => {
        // The invalidation above must not outlive itself: the next sign-in is a fresh credential and
        // its failure is real news.
        const store = new HandoverFailureStore();
        store.begin();
        store.clear();

        const generation = store.begin();

        assert.ok(store.record(generation, 'could not open'));
        assert.strictEqual(store.current?.generation, generation);
    });
});
