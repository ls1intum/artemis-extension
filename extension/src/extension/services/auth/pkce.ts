import { createHash, randomBytes } from 'node:crypto';

// PKCE (RFC 7636) helpers for the browser-delegated login handoff.
// The server derives the S256 challenge as base64url(SHA-256(verifier)) without padding
// (see PkceUtil.java), so we must match that exactly.

/** Generates a high-entropy PKCE code verifier, base64url-encoded without padding. */
export function generateCodeVerifier(): string {
    return randomBytes(32).toString('base64url');
}

/** Derives the S256 code challenge for a verifier: base64url(SHA-256(verifier)) without padding. */
export function deriveS256Challenge(codeVerifier: string): string {
    return createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
}

/** Generates an opaque anti-forgery state token, base64url-encoded without padding. */
export function generateState(): string {
    return randomBytes(32).toString('base64url');
}
