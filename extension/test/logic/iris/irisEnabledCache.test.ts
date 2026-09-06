import * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';

import { IrisEnabledCache, type IrisEnabledCacheDeps } from '@extension/services/iris/irisEnabledCache';

function harness(over: Partial<IrisEnabledCacheDeps> = {}) {
    const start = new vscode.EventEmitter<void>();
    const end = new vscode.EventEmitter<void>();
    const reconnect = new vscode.EventEmitter<void>();
    let active: number | undefined = undefined;
    const timers: Array<{ fn: () => void; cancelled: boolean }> = [];
    const deps: IrisEnabledCacheDeps = {
        classify: vi.fn(async () => 'enabled' as const),
        onSessionStart: start.event,
        onSessionEnd: end.event,
        onReconnect: reconnect.event,
        getActiveExerciseId: () => active,
        schedule: (fn) => { const t = { fn, cancelled: false }; timers.push(t); return () => { t.cancelled = true; }; },
        retryDelaysMs: [10, 20],
        ...over,
    };
    const cache = new IrisEnabledCache(deps);
    const fireTimer = (i: number) => { if (!timers[i].cancelled) { timers[i].fn(); } };
    return { cache, deps, start, end, reconnect, timers, fireTimer, setActive: (id?: number) => { active = id; } };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('IrisEnabledCache', () => {
    it('is fail-closed before any classify', () => {
        const { cache } = harness();
        expect(cache.isEnabled()).toBe(false);
    });

    it('classifies on session start and reports enabled', async () => {
        const h = harness();
        h.setActive(7);
        h.start.fire();
        await tick();
        expect(h.deps.classify).toHaveBeenCalledWith(7);
        expect(h.cache.isEnabled()).toBe(true);
    });

    it('reports disabled without scheduling a retry', async () => {
        const h = harness({ classify: vi.fn(async () => 'disabled' as const) });
        h.setActive(7); h.start.fire(); await tick();
        expect(h.cache.isEnabled()).toBe(false);
        expect(h.timers.length).toBe(0);
    });

    it('schedules a retry on unavailable and heals to enabled', async () => {
        const classify = vi.fn()
            .mockResolvedValueOnce('unavailable')
            .mockResolvedValueOnce('enabled');
        const h = harness({ classify });
        h.setActive(7); h.start.fire(); await tick();
        expect(h.cache.isEnabled()).toBe(false);
        expect(h.timers.length).toBe(1);
        h.fireTimer(0);              // fire the retry timer
        await tick();
        expect(h.cache.isEnabled()).toBe(true);
    });

    it('stops retrying after the bounded budget is exhausted', async () => {
        const h = harness({ classify: vi.fn(async () => 'unavailable' as const) });  // retryDelaysMs [10, 20]
        h.setActive(7); h.start.fire(); await tick();   // schedule timer #0
        h.fireTimer(0); await tick();                    // schedule timer #1
        h.fireTimer(1); await tick();                    // budget exhausted → no timer #2
        expect(h.timers.length).toBe(2);
        expect(h.cache.isEnabled()).toBe(false);
    });

    it('cancels a pending retry when a reconnect heals to enabled', async () => {
        const classify = vi.fn()
            .mockResolvedValueOnce('unavailable')   // initial classify
            .mockResolvedValueOnce('enabled');      // reconnect-triggered classify
        const h = harness({ classify });
        h.setActive(7); h.start.fire(); await tick();
        expect(h.timers.length).toBe(1);
        h.reconnect.fire(); await tick();            // heals to enabled → cancels timer #0
        expect(h.cache.isEnabled()).toBe(true);
        expect(h.timers[0].cancelled).toBe(true);    // the pending retry was cancelled on heal
    });

    it('resets fail-closed on session end', async () => {
        const h = harness();
        h.setActive(7); h.start.fire(); await tick();
        expect(h.cache.isEnabled()).toBe(true);
        h.setActive(undefined); h.end.fire();
        expect(h.cache.isEnabled()).toBe(false);
    });

    it('drops a stale classify result when the session changed mid-flight', async () => {
        let resolve!: (v: 'enabled') => void;
        const classify = vi.fn(() => new Promise<'enabled'>((r) => { resolve = r; }));
        const h = harness({ classify });
        h.setActive(7); h.start.fire();          // classify in-flight for session A
        h.setActive(undefined); h.end.fire();    // session ends before it resolves
        resolve('enabled');
        await tick();
        expect(h.cache.isEnabled()).toBe(false); // stale result dropped
    });

    it('re-classifies on reconnect only while unavailable', async () => {
        const classify = vi.fn().mockResolvedValueOnce('unavailable').mockResolvedValueOnce('enabled');
        const h = harness({ classify });
        h.setActive(7); h.start.fire(); await tick();
        h.reconnect.fire(); await tick();
        expect(h.cache.isEnabled()).toBe(true);
        const calls = classify.mock.calls.length;
        h.reconnect.fire(); await tick();        // now enabled → no re-classify
        expect(classify.mock.calls.length).toBe(calls);
    });

    it('dispose drops an in-flight classify and arms no new timer', async () => {
        let resolve!: (v: 'unavailable') => void;
        const classify = vi.fn(() => new Promise<'unavailable'>((r) => { resolve = r; }));
        const h = harness({ classify });
        h.setActive(7); h.start.fire();          // classify in-flight for the live session
        h.cache.dispose();                       // dispose bumps the token → in-flight becomes stale
        resolve('unavailable');                  // late resolution lands after disposal
        await tick();
        expect(h.timers.length).toBe(0);         // no post-dispose retry timer was armed
        expect(h.cache.isEnabled()).toBe(false); // stale result did not mutate state
    });

    it('reconnect while a retry classify is in-flight does not re-classify or refill the budget', async () => {
        let resolveRetry!: (v: 'unavailable') => void;
        const classify = vi.fn()
            .mockResolvedValueOnce('unavailable')                                                   // call 1: initial → timer #0
            .mockImplementationOnce(() => new Promise<'unavailable'>((r) => { resolveRetry = r; })) // call 2: retry, held in-flight
            .mockResolvedValue('unavailable');                                                      // call 3+: still unavailable
        const h = harness({ classify });   // retryDelaysMs [10, 20] → a 2-retry budget
        h.setActive(7); h.start.fire(); await tick();     // call 1 → schedules retry timer #0
        expect(h.timers.length).toBe(1);
        h.fireTimer(0); await tick();                      // fires retry → call 2 (held in-flight)
        expect(classify).toHaveBeenCalledTimes(2);
        // Reconnect DURING the in-flight retry: single-flight must block dispatch and NOT refill the budget.
        h.reconnect.fire(); await tick();
        expect(classify).toHaveBeenCalledTimes(2);         // no immediate extra classify
        // Resolve the held retry → normal budget continues: schedules the LAST retry timer #1, then exhausts.
        resolveRetry('unavailable'); await tick();
        expect(h.timers.length).toBe(2);                   // exactly the 2-entry budget — not refilled
        h.fireTimer(1); await tick();                      // final retry → call 3 → budget exhausted, no timer #2
        expect(h.timers.length).toBe(2);
        expect(classify).toHaveBeenCalledTimes(3);         // 1 initial + 2 retries — no double-refill
        expect(h.cache.isEnabled()).toBe(false);
    });
});

describe('engine-keyed session events (#349)', () => {
    it('onSessionEnd resets WITHOUT re-kicking a classify even while an exercise is still active', async () => {
        const classify = vi.fn(async () => 'enabled' as const);
        const h = harness({ classify, getActiveExerciseId: () => 42 });   // bookkeeping survives a revoke
        await tick();                                 // constructor backstop classify settles
        const callsAfterConstruction = classify.mock.calls.length;
        h.end.fire();                                 // consent revoke: engine ended, exercise still open
        await tick();
        expect(classify.mock.calls.length).toBe(callsAfterConstruction);        // no re-kick
        expect(h.cache.isEnabled()).toBe(false);       // reset fail-closed
        h.start.fire();                                // regrant: engine session starts
        await tick();
        expect(classify.mock.calls.length).toBe(callsAfterConstruction + 1);    // start classifies
        h.cache.dispose();
    });
});
