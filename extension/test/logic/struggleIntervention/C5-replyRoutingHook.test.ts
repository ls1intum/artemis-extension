/**
 * C5: Reply-routing hook + stale-ask button command tests.
 *
 * Covers the orchestrator-side mechanics of the per-ask ABANDON latch, the
 * free-text grace hook, and the three quick-reply buttons (solved / still-on-it /
 * something-else). Uses a fake timer injected via `setTimeoutFn` so no real
 * timers fire.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    // Restore real timers after any test that may have called vi.useFakeTimers()
    afterEach(() => vi.useRealTimers());

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
            expect(deps.foldEpisode).toHaveBeenCalledWith(episodeId, 'ABANDONED');
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

        it('ceiling is respected: advance cannot push the latch deadline past the ceiling', () => {
            // Use fake timers so Date.now() is controllable and the ceiling clamp is
            // actually exercised (without this, Date.now() never advances between
            // advance() calls and the assertion is tautological).
            vi.useFakeTimers();
            vi.setSystemTime(1_000_000);
            const T0 = 1_000_000;
            const sched = makeFakeScheduler();
            const { svc, episodeId } = buildDeliveredService(sched);
            simulateStaleAsk(svc, episodeId, 'ask-1', 99);

            // C5_SLOT_CFG.abandonCeilingMs is defined (300_000) -- non-null assertion is safe.
            const ceiling = T0 + C5_SLOT_CFG.abandonCeilingMs!; // T0 + 300_000

            // Advance Date.now() to 5 s before the ceiling -- onFreeTextReply should
            // clamp the new deadline to exactly the ceiling, not to now+30 s.
            vi.setSystemTime(T0 + 295_000);
            svc.onFreeTextReply();
            expect(svc._deadlineLatch.current()).toBe(ceiling);

            // Advance Date.now() PAST the ceiling -- the latch must not grow beyond it.
            // Without the Math.min(..., ceiling) clamp this would return T0+340_000.
            vi.setSystemTime(T0 + 310_000);
            svc.onFreeTextReply();
            expect(svc._deadlineLatch.current()).toBe(ceiling);
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
            svc.onServerClose(episodeId, true, 20, undefined, 'episode label');
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
            svc.onServerClose(episodeId, false, undefined, undefined, undefined);
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
            expect(deps.foldEpisode).toHaveBeenCalledWith(episodeId, 'ABANDONED');
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

        it('ABANDON still fires after the ceiling even if the student keeps typing', async () => {
            // Use fake timers so Date.now() advances past the ceiling.
            // Without this, now+abandonFreeTextMs is always below the ceiling and the
            // timer delay is never 0 -- so this test can never verify the bounded-delay property.
            vi.useFakeTimers();
            vi.setSystemTime(1_000_000);
            const T0 = 1_000_000;
            const sched = makeFakeScheduler();
            const { svc, deps, episodeId } = buildDeliveredService(sched);
            simulateStaleAsk(svc, episodeId, 'ask-1', 99);

            // Advance well past the ceiling (310 s > 300 s ceiling).
            vi.setSystemTime(T0 + 310_000);

            // Student sends a free-text reply -- the new timer must fire immediately
            // (delayMs=0) because the ceiling deadline is already in the past.
            // Without the Math.min(..., ceiling) clamp the deadline would be
            // T0+340_000 and delayMs would be 30_000, not 0.
            svc.onFreeTextReply();
            const lastTimer = sched.timers.at(-1)!;
            expect(lastTimer.ms).toBe(0);

            // Fire the timer -- ABANDON teardown must complete.
            lastTimer.fn();
            await Promise.resolve();

            expect(svc._slot.isFree()).toBe(true);
            expect(deps.setEpisodeOutcome).toHaveBeenCalledWith(42, episodeId, 'ABANDONED');
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
