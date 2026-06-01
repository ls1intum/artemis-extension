import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ViewerSession } from './viewerSession';

/**
 * Sign a `ViewerSession` payload with HMAC-SHA256.
 * Returns `${payloadB64}.${sigB64}` where both halves are base64url-encoded.
 */
export function signSession(session: ViewerSession, secret: string): string {
    const payloadJson = JSON.stringify(session);
    const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64url');
    const sigB64 = createHmac('sha256', secret).update(payloadB64).digest('base64url');
    return `${payloadB64}.${sigB64}`;
}

/**
 * Verify and decode a signed cookie value. Returns the payload if all of:
 *  - format is `<payloadB64>.<sigB64>` (one dot)
 *  - signature matches via timing-safe comparison
 *  - payload parses as JSON, has `v === 1`
 *  - payload.exp > nowSeconds
 * Otherwise returns `null` so the caller can clear the cookie.
 */
export function verifySession(cookieValue: string, secret: string, nowSeconds: number): ViewerSession | null {
    if (cookieValue.length > 4096) return null;
    const dot = cookieValue.indexOf('.');
    if (dot < 0 || cookieValue.indexOf('.', dot + 1) >= 0) return null;
    const payloadB64 = cookieValue.slice(0, dot);
    const sigB64 = cookieValue.slice(dot + 1);

    const expectedSig = createHmac('sha256', secret).update(payloadB64).digest();
    const providedSig = Buffer.from(sigB64, 'base64url');
    if (providedSig.length !== expectedSig.length) return null;
    if (!timingSafeEqual(providedSig, expectedSig)) return null;

    let payload: unknown;
    try {
        payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
    if (!isViewerSession(payload)) return null;
    if (payload.exp <= nowSeconds) return null;
    return payload;
}

/**
 * Cryptographically random 32-byte hex string, used as fallback session secret
 * when `RECORDING_VIEWER_SESSION_SECRET` is unset at startup.
 */
export function generateEphemeralSecret(): string {
    return randomBytes(32).toString('hex');
}

function isViewerSession(x: unknown): x is ViewerSession {
    if (!x || typeof x !== 'object') return false;
    const o = x as Record<string, unknown>;
    if (o.v !== 1) return false;
    if (!Number.isFinite(o.iat) || !Number.isFinite(o.exp)) return false;
    if (o.role === 'rater') {
        return typeof o.raterId === 'string' && typeof o.raterName === 'string';
    }
    if (o.role === 'researcher') return true;
    return false;
}
