/**
 * Unit tests for `describeLoginFailure`.
 *
 * The function turns whatever the two login stages threw into one sentence for the
 * student. It classifies on `ApiError.status` because the regex it replaced tested
 * the message TEXT for "401", which misfires on any error body that happens to
 * mention that number. The regex survives only as a fallback for errors that carry
 * no status.
 */

import * as assert from 'assert';

import { ApiError, describeLoginFailure } from '@extension/domain';

suite('describeLoginFailure', () => {
    test('401 is wrong credentials, whatever the server called it', () => {
        assert.strictEqual(
            describeLoginFailure(new ApiError('Bad credentials', 401)),
            'Login failed: Invalid username or password. Please verify your credentials and try again.',
        );
    });

    test('400 is wrong credentials too', () => {
        assert.strictEqual(
            describeLoginFailure(new ApiError('Method argument not valid', 400)),
            'Login failed: Invalid username or password. Please verify your credentials and try again.',
        );
    });

    test('403 keeps the reason the server gave, because only it knows which one', () => {
        assert.strictEqual(
            describeLoginFailure(new ApiError('Account locked after 5 attempts', 403)),
            'Login failed: Account locked after 5 attempts',
        );
    });

    test('403 without a reason falls back to the generic one', () => {
        assert.strictEqual(
            describeLoginFailure(new ApiError('', 403)),
            'Login failed: Your account is not activated or access is forbidden.',
        );
    });

    test('a 404 whose body mentions 401 is still a 404', () => {
        // The whole point of classifying on status. The old regex read this as
        // bad credentials and sent the user off to retype a correct password.
        const message = describeLoginFailure(new ApiError('Not Found (error 401 in page text)', 404));
        assert.ok(!/Invalid username or password/.test(message), `misclassified as credentials: ${message}`);
    });

    test('an error without a status still goes through the text fallback', () => {
        assert.strictEqual(
            describeLoginFailure(new Error('Failed to fetch')),
            'Login failed: Could not reach the Artemis server. Check your network connection or server URL.',
        );
    });

    test('a timeout without a status is still a timeout', () => {
        assert.strictEqual(
            describeLoginFailure(new Error('The request timed out')),
            'Login failed: The Artemis server did not respond in time. Please try again.',
        );
    });

    test('something that is not an Error at all', () => {
        assert.strictEqual(
            describeLoginFailure('nope'),
            'Login failed: An unexpected error occurred. Please try again.',
        );
    });

    test('404 says the API was not found here, without claiming there is no Artemis', () => {
        const expected = 'Login failed: Could not find the Artemis API at this address. '
            + 'Check the server URL in the Artemis settings.';
        assert.strictEqual(describeLoginFailure(new ApiError('404 Not Found', 404)), expected);
    });

    test('405 says the same thing', () => {
        const expected = 'Login failed: Could not find the Artemis API at this address. '
            + 'Check the server URL in the Artemis settings.';
        assert.strictEqual(describeLoginFailure(new ApiError('405 Method Not Allowed', 405)), expected);
    });

    test('the 404 message does not swallow the 401 and 403 branches', () => {
        // Ordering guard: the new branch must sit after the more specific ones.
        assert.ok(/Invalid username or password/.test(describeLoginFailure(new ApiError('x', 401))));
        assert.ok(/forbidden/i.test(describeLoginFailure(new ApiError('', 403))));
    });
});
