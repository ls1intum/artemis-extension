/**
 * C8: dismissEpisode - episode-scoped slot resolution.
 */
import { describe, expect, it, vi } from 'vitest';

import type { PendingStamp } from '@extension/services/struggleIntervention/slot/guard';
import type { StruggleInterventionDeps } from '@extension/services/struggleIntervention/struggleInterventionService';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';
import type { IrisChatMessage } from '@extension/types';

// ---------------------------------------------------------------------------
// Fake-scheduler harness (mirrors C5: captures callback + delay for manual firing)
// ---------------------------------------------------------------------------

interface FakeTimer {
    fn: () => void;
    ms: number;
}

function makeFakeScheduler(): { timers: FakeTimer[]; setTimeoutFn: (fn: () => void, ms: number) => void } {
    const timers: FakeTimer[] = [];
    const setTimeoutFn = (fn: () => void, ms: number) => { timers.push({ fn, ms }); };
    return { timers, setTimeoutFn };
}

function fakeDeps(over: Partial<StruggleInterventionDeps> = {}): StruggleInterventionDeps {
    return {
        isEgressEnabled: () => true,
        hasNoaiMarker: () => false,
        getExerciseId: () => 42,
        getExerciseRoot: () => undefined,
        collectFiles: vi.fn(async () => ({ 'src/A.java': 'class A {}' })),
        postIntervention: vi.fn(async () => 'accepted' as const),
        openSession: vi.fn(async () => undefined),
        showAmbient: vi.fn(),
        showLamp: vi.fn(),
        clearLamp: vi.fn(),
        showInline: vi.fn(),
        showGutterOnly: vi.fn(),
        clearInline: vi.fn(),
        isAnchorLive: () => false,
        isStudentProactiveOn: () => true,
        softThreshold: 3,
        pauseStrikes: 5,
        setBadge: vi.fn(),
        showActiveNotification: vi.fn(),
        postBubble: vi.fn(),
        log: { record: vi.fn(async () => undefined) } as unknown as StruggleInterventionDeps['log'],
        setTimeoutFn: vi.fn(),
        generateLocalId: () => 'test-local-id',
        postRevealBubble: vi.fn(),
        reconcileOptimisticBubble: vi.fn(),
        revealAmbient: vi.fn(async () => ({
            id: 7,
            sentAt: '2024-01-01T00:00:00Z',
            proactiveEpisodeId: 'ep-server',
        } as IrisChatMessage)),
        setEpisodeOutcome: vi.fn(async () => ({ applied: true })),
        cancelOutstandingStruggleJob: vi.fn(async () => undefined),
        foldEpisode: vi.fn(),
        postRemoveMessage: vi.fn(),
        deleteSupersededProactiveMessage: vi.fn(async () => undefined),
        postStaleAsk: vi.fn(),
        ...over,
    };
}

/** Drive the service into DELIVERED state (simulates a full active-push cycle). */
function simulateDelivered(svc: StruggleInterventionService, episodeId = 'ep-1'): void {
    const gen = svc._slot.generation();
    const requestToken = 'tok-1';
    const stamp: PendingStamp = { episodeId, generation: gen, hardEvent: true, requestToken };
    const localToken = svc._guard.issue('decide', stamp);
    svc._inFlightMarker = { requestToken, episodeId, generation: gen, intent: 'decide', localToken };
    svc._candidate = { episodeId, isNew: true, hints: [], createdAtMs: 0 };
    // Simulate an active server response, which takes the slot and sets delivered
    svc.onServerActive(1, undefined, undefined, undefined, 0.9, 'hint text', 99);
}

/**
 * Arm the REAL ABANDON timer via the production path.
 *
 * Mirrors the simulateStaleAsk helper from C5: sets an in-flight stale_check marker,
 * then calls the real onServerStale(ask=true), which calls _scheduleAbandon and
 * registers a callback via the injected setTimeoutFn. Requires the slot to be
 * DELIVERED (so _watchdog is armed) and the service to have an injected setTimeoutFn
 * that captures the callback (e.g. from makeFakeScheduler).
 */
function armRealAbandonTimer(
    svc: StruggleInterventionService,
    episodeId: string,
    messageId: number,
): void {
    const gen = svc._slot.generation();
    const stamp: PendingStamp = { episodeId, generation: gen, hardEvent: false, requestToken: 'rt-stale-arm' };
    const localToken = svc._guard.issue('stale_check', stamp);
    svc._inFlightMarker = { requestToken: 'rt-stale-arm', episodeId, generation: gen, intent: 'stale_check', localToken };
    svc.onServerStale(episodeId, true, messageId, 'Are you stuck?');
}

describe('C8: dismissEpisode', () => {
    it('frees the slot (generation bumps), writes DISMISSED, tears down runtime, folds without praise', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-dismiss');
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
        const genBefore = svc._slot.generation();

        svc.dismissEpisode('ep-dismiss');

        // Slot is now free
        expect(svc._slot.snapshot().state.kind).toBe('free');
        // Generation bumped (slot transitioned)
        expect(svc._slot.generation()).toBeGreaterThan(genBefore);
        // Episode outcome written
        await Promise.resolve();
        expect(deps.setEpisodeOutcome).toHaveBeenCalledWith(42, 'ep-dismiss', 'DISMISSED');
        // Fold posted without praise
        expect(deps.foldEpisode).toHaveBeenCalledWith('ep-dismiss', 'DISMISSED');
        // NO praise (third arg absent or undefined; the second arg is now the outcome)
        const foldCall = (deps.foldEpisode as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(foldCall[2]).toBeUndefined();
    });

    it('_clearEpisodeRuntime: watchdog disarmed, owed-close cleared, live-ask binding cleared', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-clear');

        // Manually plant a live-ask binding to verify it is cleared
        svc._liveAskBinding = { askId: 'ask-1', messageId: 99, episodeId: 'ep-clear' };
        // Plant an owed confirmClose
        svc._owedConfirmClose = { confirmReason: 'progress' };
        // Watchdog was armed by simulateDelivered (via onServerActive take-delivered path)
        expect(svc._watchdog).toBeDefined();

        svc.dismissEpisode('ep-clear');

        expect(svc._liveAskBinding).toBeUndefined();
        expect(svc._owedConfirmClose).toBeUndefined();
        // Watchdog is disarmed and set to undefined by _clearEpisodeRuntime
        expect(svc._watchdog).toBeUndefined();
    });

    it('dismissEpisode called with no arg resolves the current delivered slot episode', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-noid');
        expect(svc._slot.snapshot().state.kind).toBe('delivered');

        svc.dismissEpisode(); // no arg - should resolve live episode

        expect(svc._slot.snapshot().state.kind).toBe('free');
        await Promise.resolve();
        expect(deps.setEpisodeOutcome).toHaveBeenCalledWith(42, 'ep-noid', 'DISMISSED');
        expect(deps.foldEpisode).toHaveBeenCalledWith('ep-noid', 'DISMISSED');
    });

    it('double-dismiss (slot already free): safe no-op for slot, outcome write still fires (idempotent)', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-double');

        svc.dismissEpisode('ep-double'); // first dismiss
        await Promise.resolve();
        expect(svc._slot.snapshot().state.kind).toBe('free');

        const callCountAfterFirst = (deps.setEpisodeOutcome as ReturnType<typeof vi.fn>).mock.calls.length;
        const foldCallsAfterFirst = (deps.foldEpisode as ReturnType<typeof vi.fn>).mock.calls.length;

        svc.dismissEpisode('ep-double'); // second dismiss (double)
        await Promise.resolve();

        // Outcome write fires again (A10 first-terminal-wins handles idempotency server-side)
        expect((deps.setEpisodeOutcome as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCountAfterFirst + 1);
        // foldEpisode does NOT fire again (slot was already free, so shouldFreeSlot is false)
        expect((deps.foldEpisode as ReturnType<typeof vi.fn>).mock.calls.length).toBe(foldCallsAfterFirst);
    });

    it('dismiss when slot is FREE and no episodeId passed: safe total no-op', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        // slot starts FREE

        svc.dismissEpisode(); // no arg, slot free

        expect(deps.setEpisodeOutcome).not.toHaveBeenCalled();
        expect(deps.foldEpisode).not.toHaveBeenCalled();
    });

    it('episodeId mismatch: writes outcome for passed id but does NOT free slot or fold', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-live');
        expect(svc._slot.snapshot().state.kind).toBe('delivered');

        svc.dismissEpisode('ep-stale-different'); // different from live 'ep-live'

        // Slot must NOT be freed
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
        await Promise.resolve();
        // Outcome write for the passed id (safe back-fill)
        expect(deps.setEpisodeOutcome).toHaveBeenCalledWith(42, 'ep-stale-different', 'DISMISSED');
        // foldEpisode must NOT be called (could collapse the wrong episode)
        expect(deps.foldEpisode).not.toHaveBeenCalled();
    });

    it('CRITICAL: Dismiss while stale-ask open - pending ABANDON timer fires after dismiss but is NO-OP (real _scheduleAbandon guard)', async () => {
        // Build the service with an injected fake scheduler (same pattern as C5).
        // The fake captures the callback + delay that _scheduleAbandon registers via
        // setTimeoutFn, so we can fire the timer manually without vi.useFakeTimers().
        const sched = makeFakeScheduler();
        const deps = fakeDeps({
            setTimeoutFn: sched.setTimeoutFn,
            slotCfg: {
                staleAfterMs: 10_000,
                staleWindowMax: 3,
                staleAskCap: 2,
                abandonInitialMs: 60_000,
                abandonFreeTextMs: 30_000,
                abandonCeilingMs: 300_000,
            },
            setEpisodeOutcome: vi.fn(async () => ({ applied: true })),
        });
        const svc = new StruggleInterventionService(deps);
        const episodeId = 'ep-abandon-real';
        simulateDelivered(svc, episodeId);

        // Arm the REAL ABANDON timer via the production path (NOT a hand-rolled setTimeout).
        // armRealAbandonTimer calls onServerStale(ask=true) which calls _scheduleAbandon,
        // which registers a callback via the injected setTimeoutFn captured by sched.
        armRealAbandonTimer(svc, episodeId, 77);

        // The production _scheduleAbandon must have been called and the timer captured.
        expect(sched.timers.length).toBeGreaterThan(0);
        const abandonTimer = sched.timers.at(-1)!;
        expect(abandonTimer.ms).toBe(60_000);
        // _liveAskBinding must be set - this is the guard the production code checks.
        expect(svc._liveAskBinding).toBeDefined();
        expect(svc._liveAskBinding!.episodeId).toBe(episodeId);

        // Dismiss the episode. _clearEpisodeRuntime clears _liveAskBinding.
        svc.dismissEpisode(episodeId);
        expect(svc._slot.snapshot().state.kind).toBe('free');
        expect(svc._liveAskBinding).toBeUndefined();
        // Record the generation after the dismiss's slot.free() call.
        const genAfterDismiss = svc._slot.generation();

        // Fire the REAL callback that _scheduleAbandon registered.
        // The production guard at this point: `if (!_liveAskBinding ...) { return; }`
        // This guard must neutralise the timer (binding was cleared by dismissEpisode).
        abandonTimer.fn();
        await Promise.resolve();

        // ABANDON must be a complete NO-OP.
        // If the guard were removed, slot.free() would be called again (bumping the
        // generation) and setEpisodeOutcome would be called with 'ABANDONED'.
        expect(svc._slot.generation()).toBe(genAfterDismiss); // no second free()
        const calls = (deps.setEpisodeOutcome as ReturnType<typeof vi.fn>).mock.calls;
        const outcomes = calls.map((c: unknown[]) => c[2]);
        expect(outcomes).toContain('DISMISSED');
        expect(outcomes).not.toContain('ABANDONED');
    });
});
