import { describe, it, expect } from 'vitest';
import { signSession, verifySession, generateEphemeralSecret } from '../../server/cookieSign';
import type { ViewerSession } from '../../server/viewerSession';

const SECRET = 'k'.repeat(64);

describe('signSession / verifySession', () => {
    const now = 1_716_000_000;
    const raterPayload: ViewerSession = {
        v: 1, role: 'rater', raterId: 'r_abc', raterName: 'Alice',
        iat: now, exp: now + 3600,
    };

    it('round-trips a rater session', () => {
        const cookie = signSession(raterPayload, SECRET);
        const decoded = verifySession(cookie, SECRET, now + 1);
        expect(decoded).toEqual(raterPayload);
    });

    it('round-trips a researcher session', () => {
        const r: ViewerSession = { v: 1, role: 'researcher', iat: now, exp: now + 3600 };
        const cookie = signSession(r, SECRET);
        expect(verifySession(cookie, SECRET, now + 1)).toEqual(r);
    });

    it('rejects a tampered payload', () => {
        const cookie = signSession(raterPayload, SECRET);
        const [p, s] = cookie.split('.');
        const tamperedPayload = Buffer.from(p, 'base64url').toString('utf8').replace('Alice', 'Mallory');
        const tampered = Buffer.from(tamperedPayload).toString('base64url') + '.' + s;
        expect(verifySession(tampered, SECRET, now + 1)).toBeNull();
    });

    it('rejects a tampered signature', () => {
        const cookie = signSession(raterPayload, SECRET);
        const [p] = cookie.split('.');
        expect(verifySession(p + '.' + 'A'.repeat(43), SECRET, now + 1)).toBeNull();
    });

    it('rejects an expired session', () => {
        const cookie = signSession(raterPayload, SECRET);
        expect(verifySession(cookie, SECRET, raterPayload.exp + 1)).toBeNull();
    });

    it('rejects a wrong-version payload', () => {
        const wrong = { ...raterPayload, v: 2 as 1 };
        const cookie = signSession(wrong as ViewerSession, SECRET);
        expect(verifySession(cookie, SECRET, now + 1)).toBeNull();
    });

    it('rejects malformed cookie (no dot)', () => {
        expect(verifySession('not-a-cookie', SECRET, now + 1)).toBeNull();
    });

    it('rejects when secret mismatches', () => {
        const cookie = signSession(raterPayload, SECRET);
        expect(verifySession(cookie, 'x'.repeat(64), now + 1)).toBeNull();
    });
});

describe('generateEphemeralSecret', () => {
    it('returns a 64-char hex string', () => {
        const s = generateEphemeralSecret();
        expect(s).toMatch(/^[0-9a-f]{64}$/);
    });
    it('returns different values across calls', () => {
        expect(generateEphemeralSecret()).not.toEqual(generateEphemeralSecret());
    });
});
