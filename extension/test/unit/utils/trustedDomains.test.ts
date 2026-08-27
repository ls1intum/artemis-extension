import * as assert from 'assert';
import type * as vscode from 'vscode';

import { clearTrustedDomains, getTrustedDomains, trustDomain } from '@extension/utils';

/**
 * Minimal `globalState` backed by one map, so stored shapes can be forced. It
 * honours the key it is given: reading or writing under a different one has to
 * come back empty, which is what makes a drifted key visible here.
 */
function contextWith(stored?: unknown): vscode.ExtensionContext {
    const state = new Map<string, unknown>();
    if (stored !== undefined) {
        state.set('artemis.trustedDomains', stored);
    }
    return {
        globalState: {
            get: (key: string, fallback: unknown) => (state.has(key) ? state.get(key) : fallback),
            update: async (key: string, next: unknown) => { state.set(key, next); },
        },
    } as unknown as vscode.ExtensionContext;
}

suite('trusted domains', () => {
    test('starts empty', () => {
        assert.deepStrictEqual(getTrustedDomains(contextWith()), []);
    });

    test('appends without dropping what was already trusted', async () => {
        const context = contextWith(['a.example']);

        await trustDomain(context, 'b.example');

        assert.deepStrictEqual(getTrustedDomains(context), ['a.example', 'b.example']);
    });

    test('reads a non-array as empty rather than handing it to the caller', () => {
        // globalState is user-writable JSON: a downgrade or a hand-edited state
        // file can leave anything here, and `.includes` on it would throw.
        assert.deepStrictEqual(getTrustedDomains(contextWith('not-an-array')), []);
    });

    test('clearing leaves nothing trusted', async () => {
        const context = contextWith(['a.example', 'b.example']);

        await clearTrustedDomains(context);

        assert.deepStrictEqual(getTrustedDomains(context), []);
    });
});
