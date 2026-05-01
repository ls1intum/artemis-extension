import * as crypto from 'crypto';

export const SESSION_COOKIE_NAME = 'recording_viewer_session';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 3600; // 7 days

export function isValidToken(provided: string, expected: string | undefined): boolean {
    if (!expected || !provided) return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

export interface CookieOptions { clear?: boolean }

export function buildSessionCookie(value: string, opts: CookieOptions = {}): string {
    const parts = [
        `${SESSION_COOKIE_NAME}=${opts.clear ? '' : encodeURIComponent(value)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Strict',
    ];
    parts.push(`Max-Age=${opts.clear ? 0 : SESSION_MAX_AGE_SECONDS}`);
    return parts.join('; ');
}

export function isSessionCookieValid(
    cookies: Record<string, string>,
    expectedToken: string | undefined,
): boolean {
    if (!expectedToken) return false;
    const c = cookies[SESSION_COOKIE_NAME];
    if (!c) return false;
    return isValidToken(c, expectedToken);
}
