import { describe, it, expect } from 'vitest';
import {
    isValidToken,
    buildSessionCookie,
    readSessionFromCookies,
    clearSessionCookie,
    SESSION_COOKIE_NAME,
} from '../../server/auth';
import type { ViewerSession } from '../../server/viewerSession';

const SECRET = 's'.repeat(64);
const NOW = 1_716_000_000;

describe('isValidToken', () => {
    it('returns false when expected is undefined', () => {
        expect(isValidToken('x', undefined)).toBe(false);
    });
    it('uses timing-safe equality', () => {
        expect(isValidToken('a', 'a')).toBe(true);
        expect(isValidToken('ab', 'a')).toBe(false);
        expect(isValidToken('b', 'a')).toBe(false);
    });
});

describe('buildSessionCookie', () => {
    const session: ViewerSession = { v: 1, role: 'rater', raterId: 'r_abc', raterName: 'Alice', iat: NOW, exp: NOW + 3600 };
    it('signs the payload and produces HttpOnly + SameSite=Strict cookie', () => {
        const cookie = buildSessionCookie(session, SECRET, { isHttps: false });
        expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=`));
        expect(cookie).toMatch(/HttpOnly/);
        expect(cookie).toMatch(/SameSite=Strict/);
        expect(cookie).toMatch(/Path=\//);
        expect(cookie).toMatch(/Max-Age=604800/);
        expect(cookie).not.toMatch(/Secure/);
    });
    it('adds Secure attribute when isHttps=true', () => {
        const cookie = buildSessionCookie(session, SECRET, { isHttps: true });
        expect(cookie).toMatch(/Secure/);
    });
});

describe('readSessionFromCookies', () => {
    const session: ViewerSession = { v: 1, role: 'researcher', iat: NOW, exp: NOW + 3600 };
    const validCookie = buildSessionCookie(session, SECRET, { isHttps: false }).split(';')[0].split('=').slice(1).join('=');

    it('returns null when cookie missing', () => {
        expect(readSessionFromCookies({}, SECRET, NOW + 1)).toBeNull();
    });
    it('returns the parsed session when cookie valid', () => {
        const result = readSessionFromCookies({ [SESSION_COOKIE_NAME]: decodeURIComponent(validCookie) }, SECRET, NOW + 1);
        expect(result).toEqual(session);
    });
    it('returns null when cookie expired', () => {
        const result = readSessionFromCookies({ [SESSION_COOKIE_NAME]: decodeURIComponent(validCookie) }, SECRET, session.exp + 1);
        expect(result).toBeNull();
    });
});

describe('clearSessionCookie', () => {
    it('returns a Set-Cookie that wipes the value', () => {
        const cookie = clearSessionCookie();
        expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=`));
        expect(cookie).toMatch(/Max-Age=0/);
    });
});
