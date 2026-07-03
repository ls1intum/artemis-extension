import { describe, expect, it } from 'vitest';

import type { Intent, PendingStamp } from '@extension/services/struggleIntervention/slot/guard';
import { InFlightGuard } from '@extension/services/struggleIntervention/slot/guard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStamp(episodeId: string, generation: number, hardEvent = false): PendingStamp {
    return { episodeId, generation, hardEvent, requestToken: `tok-${episodeId}` };
}

// ---------------------------------------------------------------------------
// InFlightGuard
// ---------------------------------------------------------------------------

describe('InFlightGuard', () => {
    it('issue returns a monotonically increasing token', () => {
        const guard = new InFlightGuard();
        const stamp = makeStamp('ep-1', 1);
        const t1 = guard.issue('decide', stamp);
        const t2 = guard.issue('decide', stamp);
        expect(t2).toBeGreaterThan(t1);
    });

    it('accept returns stamp (with hardEvent + requestToken) on a full match', () => {
        const guard = new InFlightGuard();
        const stamp = makeStamp('ep-1', 2, true);
        const token = guard.issue('decide', stamp);
        const result = guard.accept('decide', token, 'ep-1', 2);
        expect(result).toEqual(stamp);
        expect(result?.hardEvent).toBe(true);
        expect(result?.requestToken).toBe('tok-ep-1');
    });

    it('older decide token is rejected after a newer issue (supersession)', () => {
        const guard = new InFlightGuard();
        const oldStamp = makeStamp('ep-1', 1);
        const newStamp = makeStamp('ep-2', 2);
        const oldToken = guard.issue('decide', oldStamp);
        guard.issue('decide', newStamp);
        // oldToken must be null - superseded by the second issue
        expect(guard.accept('decide', oldToken, 'ep-1', 1)).toBeNull();
    });

    it('response whose generation does not match expected returns null', () => {
        const guard = new InFlightGuard();
        const stamp = makeStamp('ep-1', 3);
        const token = guard.issue('decide', stamp);
        // token is latest, but wrong generation supplied by caller
        expect(guard.accept('decide', token, 'ep-1', 4)).toBeNull();
    });

    it('response whose episodeId does not match expected returns null', () => {
        const guard = new InFlightGuard();
        const stamp = makeStamp('ep-1', 1);
        const token = guard.issue('decide', stamp);
        expect(guard.accept('decide', token, 'ep-99', 1)).toBeNull();
    });

    it('different intents are tracked independently', () => {
        const guard = new InFlightGuard();
        const stamp1 = makeStamp('ep-1', 1);
        const stamp2 = makeStamp('ep-2', 2);
        const t1 = guard.issue('decide', stamp1);
        const t2 = guard.issue('confirm_close', stamp2);

        // each resolves under its own intent
        expect(guard.accept('decide', t1, 'ep-1', 1)).toEqual(stamp1);
        expect(guard.accept('confirm_close', t2, 'ep-2', 2)).toEqual(stamp2);

        // wrong token for an intent always returns null
        expect(guard.accept('confirm_close', t1, 'ep-1', 1)).toBeNull();
    });

    it('issuing a new token for one intent does not affect another intent', () => {
        const guard = new InFlightGuard();
        const s1 = makeStamp('ep-A', 1);
        const s2 = makeStamp('ep-B', 2);
        const t1 = guard.issue('decide', s1);
        // issue confirm_close: separate counter slot
        guard.issue('confirm_close', s2);

        // decide token must still be the latest for decide
        expect(guard.accept('decide', t1, 'ep-A', 1)).toEqual(s1);
    });

    it('cancel clears the outstanding request so subsequent accept returns null', () => {
        const guard = new InFlightGuard();
        const stamp = makeStamp('ep-1', 1);
        const token = guard.issue('decide', stamp);
        guard.cancel('decide');
        expect(guard.accept('decide', token, 'ep-1', 1)).toBeNull();
    });

    it('cancel is a no-op when nothing is outstanding for that intent', () => {
        const guard = new InFlightGuard();
        // should not throw
        expect(() => guard.cancel('confirm_close')).not.toThrow();
    });

    it('accept returns null when nothing has been issued for that intent', () => {
        const guard = new InFlightGuard();
        expect(guard.accept('confirm_close', 1, 'ep-1', 0)).toBeNull();
    });

    it('all Intent values are accepted without error', () => {
        const guard = new InFlightGuard();
        const intents: Intent[] = ['decide', 'confirm_close'];
        for (const intent of intents) {
            const stamp = makeStamp(`ep-${intent}`, 1);
            const token = guard.issue(intent, stamp);
            expect(guard.accept(intent, token, `ep-${intent}`, 1)).toEqual(stamp);
        }
    });
});
