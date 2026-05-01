import { describe, it, expect } from 'vitest';
import { isValidToken, buildSessionCookie, isSessionCookieValid } from '../../server/auth';

describe('auth.isValidToken', () => {
    it('rejects when no expected token configured', () => {
        expect(isValidToken('whatever', undefined)).toBe(false);
    });
    it('rejects when provided token is empty', () => {
        expect(isValidToken('', 'secret')).toBe(false);
    });
    it('accepts matching token', () => {
        expect(isValidToken('secret', 'secret')).toBe(true);
    });
    it('rejects mismatching token of equal length', () => {
        expect(isValidToken('secrxt', 'secret')).toBe(false);
    });
    it('rejects token of different length', () => {
        expect(isValidToken('secret-long', 'secret')).toBe(false);
    });
});

describe('auth.buildSessionCookie', () => {
    it('returns Set-Cookie value with HttpOnly, SameSite=Strict, Path=/, Max-Age 7d', () => {
        const cookie = buildSessionCookie('secret');
        expect(cookie).toMatch(/^recording_viewer_session=secret/);
        expect(cookie).toMatch(/HttpOnly/);
        expect(cookie).toMatch(/SameSite=Strict/);
        expect(cookie).toMatch(/Path=\//);
        expect(cookie).toMatch(/Max-Age=604800/);
    });
    it('clearing variant uses Max-Age=0', () => {
        expect(buildSessionCookie('', { clear: true })).toMatch(/Max-Age=0/);
    });
});

describe('auth.isSessionCookieValid', () => {
    it('returns false when cookie missing', () => {
        expect(isSessionCookieValid({}, 'secret')).toBe(false);
    });
    it('returns true when cookie matches token', () => {
        expect(isSessionCookieValid({ recording_viewer_session: 'secret' }, 'secret')).toBe(true);
    });
    it('returns false when cookie does not match', () => {
        expect(isSessionCookieValid({ recording_viewer_session: 'wrong' }, 'secret')).toBe(false);
    });
    it('returns false when expected token undefined', () => {
        expect(isSessionCookieValid({ recording_viewer_session: 'anything' }, undefined)).toBe(false);
    });
});
