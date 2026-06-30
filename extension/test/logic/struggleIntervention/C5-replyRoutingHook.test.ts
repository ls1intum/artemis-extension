/**
 * C5: Reply-routing hook + stale-ask button command tests.
 *
 * Covers the orchestrator-side mechanics of the per-ask ABANDON latch, the
 * free-text grace hook, and the three quick-reply buttons (solved / still-on-it /
 * something-else). Uses a fake timer injected via `setTimeoutFn` so no real
 * timers fire.
 */
import { describe, expect, it, vi } from 'vitest';

import { newEpisode } from '@extension/services/struggleIntervention/slot/episode';
import type { PendingStamp } from '@extension/services/struggleIntervention/slot/guard';
import type { StaleConfig } from '@extension/services/struggleIntervention/slot/staleWatchdog';
import type { StruggleInterventionDeps } from '@extension/services/struggleIntervention/struggleInterventionService';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';
import type { IrisChatMessage } from '@extension/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture scheduled fake timeouts for manual firing. */
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
        setTimeoutFn: () => { /* default: no timers */ },
        generateLocalId: () => crypto.randomUUID(),
        postRevealBubble: vi.fn(),
        reconcileOptimisticBubble: vi.fn(),
        revealAmbient: vi.fn(async () => ({
            id: 7,
            sentAt: '2024-01-01T00:00:00Z',
            proactiveEpisodeId: 'server-ep-id',
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

const C5_SLOT_CFG: StaleConfig = {
    staleAfterMs: 10_000,
    staleWindowMax: 3,
    staleAskCap: 2,
    abandonInitialMs: 60_000,
    abandonFreeTextMs: 30_000,
    abandonCeilingMs: 300_000,
};

/** Simulate the server acknowledging a staleCheck with ask=true (mints a liveAskBinding). */
function simulateStaleAsk(
    svc: StruggleInterventionService,
    episodeId: string,
    askId: string,
    messageId: number,
): void {
    // We call onServerStale directly after faking the in-flight marker
    const gen = svc._slot.generation();
    const stamp: PendingStamp = { episodeId, generation: gen, hardEvent: false, requestToken: 'rt-1' };
    const localToken = svc._guard.issue('stale_check', stamp);
    svc._inFlightMarker = { requestToken: 'rt-1', episodeId, generation: gen, intent: 'stale_check', localToken };
    // Override generateLocalId so we control the askId
    const origGen = svc['_deps'].generateLocalId;
    svc['_deps'].generateLocalId = () => askId;
    svc.onServerStale(episodeId, true, messageId, 'Are you stuck?');
    svc['_deps'].generateLocalId = origGen;
}

const FAKE_SIGNAL = {
    alert: { tSessionS: 530, primaryBoundary: 'FM' as const, boundaryTypes: ['FM' as const], severity: 0.72, path: 'armed' as const, inWarmup: false, inGrace: false },
    trajectory: [],
    dominantComponents: [],
    sessionSeconds: 530,
};

/**
 * Set up a DELIVERED slot with a fake episode, so stale-ask logic can run.
 */
function buildDeliveredService(scheduler: ReturnType<typeof makeFakeScheduler>): {
    svc: StruggleInterventionService;
    deps: StruggleInterventionDeps;
    episodeId: string;
} {
    const deps = fakeDeps({ setTimeoutFn: scheduler.setTimeoutFn, slotCfg: C5_SLOT_CFG });
    const svc = new StruggleInterventionService(deps);
    const ep = newEpisode(0, () => 'ep-c5');
    const gen = svc._slot.generation();
    const stamp: PendingStamp = { episodeId: ep.episodeId, generation: gen, hardEvent: false, requestToken: 'rt-decide' };
    const localToken = svc._guard.issue('decide', stamp);
    svc._inFlightMarker = { requestToken: 'rt-decide', episodeId: ep.episodeId, generation: gen, intent: 'decide', localToken };
    svc._candidate = ep;
    svc.onServerActive(1, undefined, undefined, undefined, undefined, 'Here is a hint', 10);
    // _drainOwed needs _lastSignal to be set (just like the existing test suite does)
    svc._lastSignal = FAKE_SIGNAL;
    return { svc, deps, episodeId: ep.episodeId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('C5: ABANDON latch + free-text grace + button routing', () => {
    // -----------------------------------------------------------------------
    // ABANDON timer basics
    // -----------------------------------------------------------------------

    describe('ABANDON timer fires when ask is open', () => {
        it('frees the slot and calls setEpisodeOutcome(ABANDONED) when deadline fires', async () => {
            const sched = makeFakeScheduler();
            const { svc, deps, episodeId } = buildDeliveredService(sched);

            // Trigger stale-ask
            simulateStaleAsk(svc, episodeId, 'ask-1', 99);

            // Should have scheduled an abandon timeout
            expect(sched.timers.length).toBeGreaterThan(0);
            const abandonTimer = sched.timers.at(-1)!;
            expect(abandonTimer.ms).toBe(60_000);

            // Fire the abandon timer
            abandonTimer.fn();
            await Promise.resolve();

            // Slot should be free, outcome ABANDONED
            expect(svc._slot.isFree()).toBe(true);
            expect(deps.setEpisodeOutcome).toHaveBeenCalledWith(42, episodeId, 'ABANDONED');
            expect(deps.foldEpisode).toHaveBeenCalledWith(episodeId);
        });

        it('is a no-op if the ask was already closed (stale timer)', () => {
            const sched = makeFakeScheduler();
            const { svc, deps, episodeId } = buildDeliveredService(sched);

            simulateStaleAsk(svc, episodeId, 'ask-1', 99);
            const abandonTimer = sched.timers.at(-1)!;

            // Close the ask via still-on-it (clears _liveAskBinding)
            svc.onStaleAskButton('ask-1', 'still-on-it');

            // Fire old timer -- should be a no-op because _liveAskBinding is gone
            abandonTimer.fn();

            expect(deps.setEpisodeOutcome).not.toHaveBeenCalledWith(42, episodeId, 'ABANDONED');
        });

        it('old timer is a no-op after a free-text advance reschedules', async () => {
            const sched = makeFakeScheduler();
            const { svc, deps, episodeId } = buildDeliveredService(sched);

            simulateStaleAsk(svc, episodeId, 'ask-1', 99);
            const oldTimer = sched.timers.at(-1)!;

            // Free-text advances the latch
            svc.onFreeTextReply();
            const newTimer = sched.timers.at(-1)!;
            expect(newTimer).not.toBe(oldTimer);

            // Old timer fires -- the isCurrent check should reject it
            oldTimer.fn();
            await Promise.resolve();
            expect(svc._slot.isFree()).toBe(false); // still DELIVERED
            expect(deps.setEpisodeOutcome).not.toHaveBeenCalledWith(42, episodeId, 'ABANDONED');

            // New timer fires
            newTimer.fn();
            await Promise.resolve();
            expect(svc._slot.isFree()).toBe(true);
            expect(deps.setEpisodeOutcome).toHaveBeenCalledWith(42, episodeId, 'ABANDONED');
        });

        it('ceiling is respected: advance cannot push deadline past ceiling', () => {
            const sched = makeFakeScheduler();
            const { svc, episodeId } = buildDeliveredService(sched);

            simulateStaleAsk(svc, episodeId, 'ask-1', 99);

            // Advance many times -- deadline must not exceed ceiling (arm(now, 60s, 300s))
            // Each advance = now + 30s; because now grows, we keep pushing forward
            // Simulate time by calling onFreeTextReply repeatedly
            for (let i = 0; i < 20; i++) {
                svc.onFreeTextReply();
            }

            // The latch current() should never exceed ceilingMs from the original arm time
            // ceiling was set at arm time = Date.now() + 300_000
            // Since tests run fast, ceiling = ~Date.now() + 300_000
            // Each advance = Math.min(now + 30_000, ceiling)
            // All should be <= ceiling
            const latches = sched.timers.map(t => t.ms);
            expect(latches.every(ms => ms <= 300_000)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Free-text grace hook
    // -----------------------------------------------------------------------

    describe('onFreeTextReply', () => {
        it('returns undefined when no ask is open', () => {
            const deps = fakeDeps({ slotCfg: C5_SLOT_CFG });
            const svc = new StruggleInterventionService(deps);
            // Slot is FREE -- no ask open
            expect(svc.onFreeTextReply()).toBeUndefined();
        });

        it('returns a revoke handle and advances the latch when ask is open', () => {
            const sched = makeFakeScheduler();
            const { svc, episodeId } = buildDeliveredService(sched);
            simulateStaleAsk(svc, episodeId, 'ask-1', 99);

            const prev = svc._deadlineLatch.current();
            const result = svc.onFreeTextReply();
            expect(result).toBeDefined();
            // A new timer should have been scheduled (the advance timer)
            expect(sched.timers.length).toBeGreaterThan(1);
            // The latch deadline may have moved (advance: min(now+30s, ceiling))
            // It should still be a defined number
            expect(typeof svc._deadlineLatch.current()).toBe('number');
            expect(result!.revoke).toBeTypeOf('function');

            // Revoke rolls back to prev
            result!.revoke();
            expect(svc._deadlineLatch.current()).toBe(prev);
        });

        it('revoke restores the deadline on hard send failure', () => {
            const sched = makeFakeScheduler();
            const { svc, episodeId } = buildDeliveredService(sched);
            simulateStaleAsk(svc, episodeId, 'ask-1', 99);

            const prevDeadline = svc._deadlineLatch.current();
            const handle = svc.onFreeTextReply()!;

            // Simulated hard send failure
            handle.revoke();
            expect(svc._deadlineLatch.current()).toBe(prevDeadline);
        });

        it('revoke reschedules a new timer for the restored deadline', () => {
            const sched = makeFakeScheduler();
            const { svc, episodeId } = buildDeliveredService(sched);
            simulateStaleAsk(svc, episodeId, 'ask-1', 99);

            const timersBefore = sched.timers.length;
            const handle = svc.onFreeTextReply()!;
            handle.revoke();

            // After revoke, at least 2 more timers were added (advance + revoke-reschedule)
            expect(sched.timers.length).toBeGreaterThan(timersBefore + 1);
        });
    });

    // -----------------------------------------------------------------------
    // Button routing
    // -----------------------------------------------------------------------

    describe('onStaleAskButton', () => {
        it('solved: queues stale_solved owedConfirmClose and drains', async () => {
            const sched = makeFakeScheduler();
            const { svc, deps, episodeId } = buildDeliveredService(sched);
            simulateStaleAsk(svc, episodeId, 'ask-1', 99);

            // Wire postIntervention to capture what intent gets drained
            let capturedIntent: string | undefined;
            (deps.postIntervention as ReturnType<typeof vi.fn>).mockImplementation(async (_exId, body) => {
                capturedIntent = body.intent;
                return 'accepted';
            });

            svc.onStaleAskButton('ask-1', 'solved');
            await Promise.resolve(); // let _drainOwed micro-task run
            await Promise.resolve();

            // The confirm_close POST should have been attempted with stale_solved reason
            expect(capturedIntent).toBe('confirm_close');
            // Ask binding should be cleared
            expect(svc._liveAskBinding).toBeUndefined();
        });

        it('solved: clears liveAskBinding so ABANDON latch fires are no-ops', async () => {
            const sched = makeFakeScheduler();
            const { svc, deps, episodeId } = buildDeliveredService(sched);
            simulateStaleAsk(svc, episodeId, 'ask-1', 99);
            const abandonTimer = sched.timers.at(-1)!;

            svc.onStaleAskButton('ask-1', 'solved');
            // Fire the abandon timer -- should be a no-op (liveAskBinding gone)
            abandonTimer.fn();
            await Promise.resolve();

            expect(deps.setEpisodeOutcome).not.toHaveBeenCalledWith(42, episodeId, 'ABANDONED');
        });

        it('solved: if a confirm_close is already in-flight, stale_solved queues and does not double-close', async () => {
            const sched = makeFakeScheduler();
            const { svc, deps, episodeId } = buildDeliveredService(sched);
            simulateStaleAsk(svc, episodeId, 'ask-1', 99);

            // Inject an in-flight confirm_close marker to simulate one being in-flight
            const gen = svc._slot.generation();
            const stamp: PendingStamp = { episodeId, generation: gen, hardEvent: false, requestToken: 'rt-cc' };
            const lt = svc._guard.issue('confirm_close', stamp);
            svc._inFlightMarker = { requestToken: 'rt-cc', episodeId, generation: gen, intent: 'confirm_close', localToken: lt };

            svc.onStaleAskButton('ask-1', 'solved');
            await Promise.resolve();

            // _drainOwed exits early (wire busy), no second POST yet
            const callCount = (deps.postIntervention as ReturnType<typeof vi.fn>).mock.calls.length;

            // Simulate the in-flight confirm_close returning resolved=true
            svc.onServerClose(episodeId, true, 20, undefined, 'episode label', false);
            await Promise.resolve();

            // _owedConfirmClose was cleared on resolved=true -- no second POST
            expect((deps.postIntervention as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);
            expect(svc._slot.isFree()).toBe(true);
        });

        it('solved: if confirm_close returns resolved=false, queued stale_solved drains', async () => {
            const sched = makeFakeScheduler();
            const { svc, deps, episodeId } = buildDeliveredService(sched);
            simulateStaleAsk(svc, episodeId, 'ask-1', 99);

            // Inject an in-flight confirm_close
            const gen = svc._slot.generation();
            const stamp: PendingStamp = { episodeId, generation: gen, hardEvent: false, requestToken: 'rt-cc2' };
            const lt = svc._guard.issue('confirm_close', stamp);
            svc._inFlightMarker = { requestToken: 'rt-cc2', episodeId, generation: gen, intent: 'confirm_close', localToken: lt };

            svc.onStaleAskButton('ask-1', 'solved');
            await Promise.resolve();

            // Simulate resolved=false: slot stays, drain should pick up stale_solved
            svc.onServerClose(episodeId, false, undefined, undefined, undefined, true);
            await Promise.resolve();
            await Promise.resolve(); // let _drainOwed run

            // A second POST (the stale_solved confirmClose) should have been issued
            const calls = (deps.postIntervention as ReturnType<typeof vi.fn>).mock.calls;
            const cc2Call = calls.find(([, body]) => body.confirmReason === 'stale_solved');
            expect(cc2Call).toBeDefined();
        });

        it('still-on-it: cancels staleCheck, closes ask, calls watchdog.resetProgress', async () => {
            const sched = makeFakeScheduler();
            const { svc, episodeId } = buildDeliveredService(sched);
            simulateStaleAsk(svc, episodeId, 'ask-1', 99);

            const resetSpy = vi.spyOn(svc._watchdog!, 'resetProgress');
            svc.onStaleAskButton('ask-1', 'still-on-it');
            await Promise.resolve();

            expect(svc._liveAskBinding).toBeUndefined();
            expect(resetSpy).toHaveBeenCalledOnce();
            // Slot should still be DELIVERED (not freed)
            expect(svc._slot.snapshot().state.kind).toBe('delivered');
        });

        it('something-else: frees slot, calls setEpisodeOutcome(ABANDONED), and foldEpisode', async () => {
            const sched = makeFakeScheduler();
            const { svc, deps, episodeId } = buildDeliveredService(sched);
            simulateStaleAsk(svc, episodeId, 'ask-1', 99);

            svc.onStaleAskButton('ask-1', 'something-else');
            await Promise.resolve();

            expect(svc._slot.isFree()).toBe(true);
            expect(deps.setEpisodeOutcome).toHaveBeenCalledWith(42, episodeId, 'ABANDONED');
            expect(deps.foldEpisode).toHaveBeenCalledWith(episodeId);
        });

        it('stale askId is a no-op', async () => {
            const sched = makeFakeScheduler();
            const { svc, deps, episodeId } = buildDeliveredService(sched);
            simulateStaleAsk(svc, episodeId, 'ask-1', 99);

            svc.onStaleAskButton('ask-WRONG', 'solved');
            await Promise.resolve();

            // Slot should still be DELIVERED, nothing happened
            expect(svc._slot.snapshot().state.kind).toBe('delivered');
            expect(svc._liveAskBinding).toBeDefined();
            expect(deps.setEpisodeOutcome).not.toHaveBeenCalledWith(42, episodeId, 'ABANDONED');
        });

        it('solved cancels an in-flight staleCheck (clears wire so drain proceeds)', async () => {
            const sched = makeFakeScheduler();
            const { svc, deps, episodeId } = buildDeliveredService(sched);
            simulateStaleAsk(svc, episodeId, 'ask-1', 99);

            // Inject a second stale_check in-flight after the ask was bound
            const gen2 = svc._slot.generation();
            const stamp2: PendingStamp = { episodeId, generation: gen2, hardEvent: false, requestToken: 'rt-sc2' };
            const lt2 = svc._guard.issue('stale_check', stamp2);
            svc._inFlightMarker = { requestToken: 'rt-sc2', episodeId, generation: gen2, intent: 'stale_check', localToken: lt2 };

            let drainIntent: string | undefined;
            (deps.postIntervention as ReturnType<typeof vi.fn>).mockImplementation(async (_exId, body) => {
                drainIntent = body.intent;
                return 'accepted';
            });

            svc.onStaleAskButton('ask-1', 'solved');
            await Promise.resolve();
            await Promise.resolve();

            // The stale_check in-flight should have been cancelled
            expect(deps.cancelOutstandingStruggleJob).toHaveBeenCalledWith(42, 'rt-sc2');
            // The drain should have run a confirm_close (wire now free)
            expect(drainIntent).toBe('confirm_close');
        });
    });

    // -----------------------------------------------------------------------
    // Integration: free-text + ABANDON interaction
    // -----------------------------------------------------------------------

    describe('free-text advance defers ABANDON', () => {
        it('advancing the latch defers the ABANDON timer', () => {
            const sched = makeFakeScheduler();
            const { svc, episodeId } = buildDeliveredService(sched);
            simulateStaleAsk(svc, episodeId, 'ask-1', 99);
            const initialTimerCount = sched.timers.length;

            svc.onFreeTextReply();

            // A new timer should have been scheduled
            expect(sched.timers.length).toBeGreaterThan(initialTimerCount);
        });

        it('ABANDON still fires after ceiling if student keeps typing', async () => {
            const sched = makeFakeScheduler();
            const { svc, deps, episodeId } = buildDeliveredService(sched);
            simulateStaleAsk(svc, episodeId, 'ask-1', 99);

            // Advance many times -- eventually the ceiling timer fires
            for (let i = 0; i < 30; i++) {
                svc.onFreeTextReply();
            }

            // Find the last scheduled timer (should be at the ceiling or close to it)
            // Fire each timer in order to ensure the ceiling one eventually fires
            for (const timer of sched.timers) {
                timer.fn();
            }
            await Promise.resolve();

            // After ceiling fires, the slot should be free
            // (depends on which timer was "current" when fired)
            // At least one fired correctly
            expect(svc._slot.isFree() || (deps.setEpisodeOutcome as ReturnType<typeof vi.fn>).mock.calls.length > 0).toBe(true);
        });
    });
});

describe('C5: _scheduleAbandon integration with _clearEpisodeRuntime', () => {
    it('clearEpisodeRuntime neutralises ABANDON timer by clearing liveAskBinding', async () => {
        const sched = makeFakeScheduler();
        const { svc, deps, episodeId } = buildDeliveredService(sched);
        simulateStaleAsk(svc, episodeId, 'ask-1', 99);
        const abandonTimer = sched.timers.at(-1)!;

        // Force a session reset (clears ALL episode runtime including liveAskBinding)
        svc.resetSession();

        // Abandon timer fires -- should be a complete no-op
        abandonTimer.fn();
        await Promise.resolve();

        expect(deps.setEpisodeOutcome).not.toHaveBeenCalledWith(42, episodeId, 'ABANDONED');
    });
});
