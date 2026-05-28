import * as crypto from 'crypto';
import { signSession, verifySession } from './cookieSign';
import type { ViewerSession } from './viewerSession';

export const SESSION_COOKIE_NAME = 'recording_viewer_session';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 3600;

export function isValidToken(provided: string, expected: string | undefined): boolean {
    if (!expected || !provided) return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

export interface BuildCookieOpts {
    isHttps: boolean;
}

export function buildSessionCookie(session: ViewerSession, secret: string, opts: BuildCookieOpts): string {
    const value = signSession(session, secret);
    const parts = [
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Strict',
        `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    ];
    if (opts.isHttps) parts.push('Secure');
    return parts.join('; ');
}

export function clearSessionCookie(): string {
    return [
        `${SESSION_COOKIE_NAME}=`,
        'Path=/',
        'HttpOnly',
        'SameSite=Strict',
        'Max-Age=0',
    ].join('; ');
}

export function readSessionFromCookies(
    cookies: Record<string, string>,
    secret: string,
    nowSeconds: number,
): ViewerSession | null {
    const raw = cookies[SESSION_COOKIE_NAME];
    if (!raw) return null;
    return verifySession(raw, secret, nowSeconds);
}
