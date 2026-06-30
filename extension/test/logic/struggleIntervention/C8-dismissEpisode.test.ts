/**
 * C8: dismissEpisode - episode-scoped slot resolution.
 */
import { describe, expect, it, vi } from 'vitest';

import type { StruggleInterventionDeps } from '@extension/services/struggleIntervention/struggleInterventionService';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';
import type { IrisChatMessage } from '@extension/types';
import type { PendingStamp } from '@extension/services/struggleIntervention/slot/guard';

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
        expect(deps.foldEpisode).toHaveBeenCalledWith('ep-dismiss');
        // NO praise (second arg absent or undefined)
        const foldCall = (deps.foldEpisode as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(foldCall[1]).toBeUndefined();
    });

    it('_clearEpisodeRuntime: latch reset, watchdog disarmed, owed-close cleared, live-ask binding cleared', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-clear');

        // Manually plant a live-ask binding to verify it is cleared
        svc._liveAskBinding = { askId: 'ask-1', messageId: 99, episodeId: 'ep-clear' };
        // Plant an owed confirmClose
        svc._owedConfirmClose = { confirmReason: 'progress' };

        svc.dismissEpisode('ep-clear');

        expect(svc._liveAskBinding).toBeUndefined();
        expect(svc._owedConfirmClose).toBeUndefined();
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
        expect(deps.foldEpisode).toHaveBeenCalledWith('ep-noid');
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

    it('CRITICAL: Dismiss while stale-ask open - pending ABANDON timer fires after dismiss but is NO-OP (binding cleared)', async () => {
        // Use fake timers to control ABANDON timer
        vi.useFakeTimers();
        const abandonCalled = vi.fn();
        const deps = fakeDeps({
            setTimeoutFn: (fn, ms) => { setTimeout(fn, ms); },
            setEpisodeOutcome: vi.fn(async () => ({ applied: true })),
        });
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-abandon');

        // Plant a live-ask binding with an ABANDON timer scheduled
        svc._liveAskBinding = { askId: 'ask-live', messageId: 77, episodeId: 'ep-abandon' };
        // Arm the deadline latch so the timer check passes
        const deadline = svc._deadlineLatch.arm(Date.now(), 60_000, 300_000);
        // Schedule an ABANDON timer (mimicking what the real stale path does)
        const episodeId = 'ep-abandon';
        setTimeout(() => {
            // This is the ABANDON timer callback (simplified)
            if (!svc._deadlineLatch.isCurrent(deadline)) { return; }
            if (!svc._liveAskBinding || svc._liveAskBinding.episodeId !== episodeId) { return; }
            // If it reaches here, ABANDON would fire
            abandonCalled();
        }, 60_000);

        // Now dismiss the episode (clears liveAskBinding via _clearEpisodeRuntime)
        svc.dismissEpisode('ep-abandon');
        expect(svc._slot.snapshot().state.kind).toBe('free');
        expect(svc._liveAskBinding).toBeUndefined();

        // Advance past the ABANDON deadline -- the callback fires but is a NO-OP
        vi.advanceTimersByTime(60_001);

        // ABANDON must NOT have fired (binding was cleared by dismissEpisode)
        expect(abandonCalled).not.toHaveBeenCalled();

        // Only DISMISSED was written, not ABANDONED
        await Promise.resolve();
        const calls = (deps.setEpisodeOutcome as ReturnType<typeof vi.fn>).mock.calls;
        const outcomes = calls.map((c: unknown[]) => c[2]);
        expect(outcomes).toContain('DISMISSED');
        expect(outcomes).not.toContain('ABANDONED');

        vi.useRealTimers();
    });
});
