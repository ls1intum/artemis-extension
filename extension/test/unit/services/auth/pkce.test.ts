import * as assert from 'assert';

import { deriveS256Challenge, generateCodeVerifier, generateState } from '@extension/services/auth/pkce';

suite('PKCE helpers', () => {
    // RFC 7636 Appendix B reference vector — must match the server's PkceUtil exactly.
    const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

    test('deriveS256Challenge matches the RFC 7636 reference vector', () => {
        assert.strictEqual(deriveS256Challenge(RFC_VERIFIER), RFC_CHALLENGE);
    });

    test('challenge is base64url without padding', () => {
        const challenge = deriveS256Challenge('some-verifier-value');
        assert.ok(!/[+/=]/.test(challenge), 'must not contain +, / or =');
    });

    test('generateCodeVerifier produces a high-entropy base64url string', () => {
        const verifier = generateCodeVerifier();
        assert.ok(verifier.length >= 43, 'verifier should be at least 43 characters');
        assert.ok(!/[+/=]/.test(verifier), 'must be base64url without padding');
        assert.notStrictEqual(generateCodeVerifier(), generateCodeVerifier(), 'each verifier must be unique');
    });

    test('generateState produces unique base64url tokens', () => {
        const a = generateState();
        const b = generateState();
        assert.notStrictEqual(a, b);
        assert.ok(!/[+/=]/.test(a), 'must be base64url without padding');
    });

    test('deriveS256Challenge is deterministic for a given verifier', () => {
        const verifier = generateCodeVerifier();
        assert.strictEqual(deriveS256Challenge(verifier), deriveS256Challenge(verifier));
    });
});
