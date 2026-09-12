/**
 * Unit tests for `isSupportedVersion`.
 *
 * The extension calls `courses/{id}/exercises-for-overview`, which Artemis added in
 * 9.9 and which does not exist at 9.8. Below that version the course contents do
 * not load, and nothing in the extension used to say so.
 *
 * Two properties carry the whole function. Comparison must be numeric, because
 * '9.10.0' sorts BELOW '9.9.0' as a string and 9.10 is the newer release. And a
 * version it cannot read must count as supported: telling a student their working
 * server is too old is worse than saying nothing.
 */

import * as assert from 'assert';

import { isSupportedVersion, MIN_ARTEMIS_VERSION } from '@extension/domain';

suite('isSupportedVersion', () => {
    test('the minimum itself is supported, so the constant and the comparator cannot drift apart', () => {
        // The comparator hard-codes its segments for speed. This is what stops that
        // from silently disagreeing with the constant the warning text quotes.
        assert.strictEqual(MIN_ARTEMIS_VERSION, '9.9.0');
        assert.strictEqual(isSupportedVersion(MIN_ARTEMIS_VERSION), true);
    });

    const supported = [
        '9.9.0', '9.9.2', '9.10.0', '10.0.0', '9.9', '10',
        '9.9.0-SNAPSHOT', '9.9.0+b7', '9.9.0.1', '9.9abc',
    ];
    for (const version of supported) {
        test(`${version} is supported`, () => {
            assert.strictEqual(isSupportedVersion(version), true);
        });
    }

    const tooOld = ['9.8.1', '9.8', '8.0.0', '9..0'];
    for (const version of tooOld) {
        test(`${version} is too old`, () => {
            assert.strictEqual(isSupportedVersion(version), false);
        });
    }

    // '9..0' above starts with a digit, so its empty middle segment reads as 0 and
    // it really is 9.0.0. '.9.9' below does not, and is unreadable rather than old.
    const unreadable: Array<string | undefined> = [undefined, '', '   ', 'nine', '.9.9', '..9', '-9.9', '.'];
    for (const version of unreadable) {
        test(`${JSON.stringify(version)} is treated as supported rather than warned about`, () => {
            assert.strictEqual(isSupportedVersion(version), true);
        });
    }
});
