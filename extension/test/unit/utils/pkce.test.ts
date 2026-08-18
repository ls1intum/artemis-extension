import * as assert from 'assert';

import { generateCodeChallenge, generateCodeVerifier } from '@extension/utils/pkce';

// The patterns the Artemis server validates against, so a drift here is a login that fails remotely
// for reasons no local test would otherwise explain.
const SERVER_VERIFIER_PATTERN = /^[a-zA-Z0-9\-._~]{43,128}$/;
const SERVER_CHALLENGE_PATTERN = /^[a-zA-Z0-9\-_]{43}$/;

suite('PKCE Test Suite', () => {
    test('the verifier is 43 characters and passes the server pattern', () => {
        const verifier = generateCodeVerifier();

        assert.strictEqual(verifier.length, 43);
        assert.match(verifier, SERVER_VERIFIER_PATTERN);
    });

    test('two verifiers differ', () => {
        assert.notStrictEqual(generateCodeVerifier(), generateCodeVerifier());
    });

    test('the challenge is S256 over the verifier, base64url without padding', () => {
        // RFC 7636 appendix B: the worked example every implementation is checked against.
        const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

        assert.strictEqual(generateCodeChallenge(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });

    test('the challenge passes the server pattern', () => {
        const challenge = generateCodeChallenge(generateCodeVerifier());

        assert.strictEqual(challenge.length, 43);
        assert.match(challenge, SERVER_CHALLENGE_PATTERN);
        assert.ok(!challenge.includes('='), 'padding would be rejected');
    });
});
