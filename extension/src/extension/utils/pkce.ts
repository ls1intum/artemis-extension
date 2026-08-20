import * as crypto from 'crypto';

/**
 * Generates a high-entropy cryptographic code_verifier according to RFC 7636 (43 characters, URL-safe).
 */
export function generateCodeVerifier(): string {
    // 32 random bytes encoded as base64url produce exactly 43 characters
    return crypto.randomBytes(32).toString('base64url');
}

/**
 * Computes the S256 code_challenge: Base64URL(SHA256(ASCII(code_verifier))) without padding.
 */
export function generateCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
}
