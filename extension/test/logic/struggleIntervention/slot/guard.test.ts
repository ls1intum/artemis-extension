import { describe, expect, it } from 'vitest';

import { DeadlineLatch, InFlightGuard } from '@extension/services/struggleIntervention/slot/guard';
import type { Intent, PendingStamp } from '@extension/services/struggleIntervention/slot/guard';

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

        // wrong intent always returns null
        expect(guard.accept('stale_check', t1, 'ep-1', 1)).toBeNull();
    });

    it('issuing a new token for one intent does not affect another intent', () => {
        const guard = new InFlightGuard();
        const s1 = makeStamp('ep-A', 1);
        const s2 = makeStamp('ep-B', 2);
        const t1 = guard.issue('decide', s1);
        // issue stale_check: separate counter slot
        guard.issue('stale_check', s2);

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
        expect(() => guard.cancel('stale_check')).not.toThrow();
    });

    it('accept returns null when nothing has been issued for that intent', () => {
        const guard = new InFlightGuard();
        expect(guard.accept('stale_check', 1, 'ep-1', 0)).toBeNull();
    });

    it('all three Intent values are accepted without error', () => {
        const guard = new InFlightGuard();
        const intents: Intent[] = ['decide', 'confirm_close', 'stale_check'];
        for (const intent of intents) {
            const stamp = makeStamp(`ep-${intent}`, 1);
            const token = guard.issue(intent, stamp);
            expect(guard.accept(intent, token, `ep-${intent}`, 1)).toEqual(stamp);
        }
    });
});

// ---------------------------------------------------------------------------
// DeadlineLatch
// ---------------------------------------------------------------------------

describe('DeadlineLatch', () => {
    it('arm stores the initial deadline and returns it', () => {
        const latch = new DeadlineLatch();
        const deadline = latch.arm(1000, 5000, 30000);
        expect(deadline).toBe(6000); // 1000 + 5000
        expect(latch.current()).toBe(6000);
    });

    it('arm with different times computes ceiling correctly', () => {
        const latch = new DeadlineLatch();
        latch.arm(2000, 3000, 60000);
        // ceiling = 62000, deadline = 5000
        expect(latch.current()).toBe(5000);
    });

    it('advance moves deadline to now+resetMs when under the ceiling', () => {
        const latch = new DeadlineLatch();
        latch.arm(1000, 5000, 30000); // ceiling = 31000
        const d = latch.advance(10000, 15000); // 25000 < 31000
        expect(d).toBe(25000);
        expect(latch.current()).toBe(25000);
    });

    it('advance never returns a deadline past the ceiling', () => {
        const latch = new DeadlineLatch();
        latch.arm(1000, 5000, 30000); // ceiling = 31000
        const d = latch.advance(25000, 20000); // 45000 > 31000, capped to 31000
        expect(d).toBe(31000);
        expect(latch.current()).toBe(31000);
    });

    it('advance exactly at the ceiling returns the ceiling', () => {
        const latch = new DeadlineLatch();
        latch.arm(1000, 5000, 30000); // ceiling = 31000
        const d = latch.advance(1000, 30000); // 31000 = ceiling
        expect(d).toBe(31000);
    });

    it('multiple advances accumulate and are ceiling-capped', () => {
        const latch = new DeadlineLatch();
        latch.arm(0, 5000, 20000); // ceiling = 20000
        latch.advance(5000, 5000); // 10000
        latch.advance(10000, 5000); // 15000
        const d = latch.advance(16000, 10000); // 26000 -> capped to 20000
        expect(d).toBe(20000);
    });

    it('current returns the active deadline', () => {
        const latch = new DeadlineLatch();
        latch.arm(0, 10000, 60000);
        expect(latch.current()).toBe(10000);
        latch.advance(1000, 5000);
        expect(latch.current()).toBe(6000);
    });

    it('isCurrent returns true for the active deadline', () => {
        const latch = new DeadlineLatch();
        const dl = latch.arm(1000, 5000, 30000);
        expect(latch.isCurrent(dl)).toBe(true);
    });

    it('isCurrent returns false for a superseded (pre-advance) deadline', () => {
        const latch = new DeadlineLatch();
        const old = latch.arm(1000, 5000, 30000); // 6000
        latch.advance(2000, 10000); // deadline becomes 12000
        expect(latch.isCurrent(old)).toBe(false);
        expect(latch.isCurrent(12000)).toBe(true);
    });

    it('restore sets the deadline back so isCurrent(prev) is true again', () => {
        const latch = new DeadlineLatch();
        const prev = latch.arm(1000, 5000, 30000); // 6000
        latch.advance(2000, 10000); // 12000
        expect(latch.isCurrent(prev)).toBe(false);

        latch.restore(prev);

        expect(latch.current()).toBe(prev);
        expect(latch.isCurrent(prev)).toBe(true);
        expect(latch.isCurrent(12000)).toBe(false);
    });

    it('restore to an arbitrary deadline (not one that was ever armed/advanced) works', () => {
        const latch = new DeadlineLatch();
        latch.arm(0, 5000, 20000);
        // rollback to an explicit prior snapshot
        latch.restore(3000);
        expect(latch.current()).toBe(3000);
        expect(latch.isCurrent(3000)).toBe(true);
    });
});
