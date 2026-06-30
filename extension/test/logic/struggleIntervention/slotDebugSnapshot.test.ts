/**
 * Task 3: slot debug snapshot, episode history, and coalesced notify.
 *
 * Tests getSlotDebugSnapshot(), getEpisodeHistory(), recordTerminalEpisode(),
 * and notifySlotDebugChanged() on StruggleInterventionService.
 */
import { describe, expect, it, vi } from 'vitest';

import type { AlertRecord, TickRecord } from '@extension/services/struggle/types';
import type { PendingStamp } from '@extension/services/struggleIntervention/slot/guard';
import type { StruggleInterventionDeps } from '@extension/services/struggleIntervention/struggleInterventionService';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';
import type { IrisChatMessage } from '@extension/types';
import { emptyDecisionTrace } from '@test/__shared__/tickRecordFixture';

// ---------------------------------------------------------------------------
// Shared helpers (mirrors the fakeDeps pattern from struggleInterventionService.test.ts)
// ---------------------------------------------------------------------------

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
        setTimeoutFn: () => { /* no real timers in tests */ },
        generateLocalId: () => 'test-local-id',
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

function makeService(over: Partial<StruggleInterventionDeps> = {}): { svc: StruggleInterventionService } {
    return { svc: new StruggleInterventionService(fakeDeps(over)) };
}

function alertRecord(): AlertRecord {
    return { kind: 'edit', t: 530, ts: 530000, urgency: 0.72, v: 0.72, typesPreGate: ['FM'], types: ['FM'], primary: 'FM', path: 'armed', inWarmup: false, inGrace: false };
}

function tickRecord(): TickRecord {
    return { t: 530, ts: 530_000, features: {} as TickRecord['features'], sBase: 0.5, s: 0.5, v: 0.5, fastDecay: false, boundariesPreGate: [], alert: null, decisionTrace: emptyDecisionTrace };
}

/** Drive the service into DELIVERED state via onServerActive (take-delivered path). */
function simulateDelivered(svc: StruggleInterventionService, _level: 'active' | 'ambient', episodeId = 'ep-test'): void {
    const gen = svc._slot.generation();
    const requestToken = 'tok-delivered';
    const stamp: PendingStamp = { episodeId, generation: gen, hardEvent: true, requestToken };
    const localToken = svc._guard.issue('decide', stamp);
    svc._inFlightMarker = { requestToken, episodeId, generation: gen, intent: 'decide', localToken };
    svc._candidate = { episodeId, isNew: true, hints: [], createdAtMs: Date.now() };
    svc.onServerActive(1, undefined, undefined, undefined, 0.9, 'hint text', 99);
}

/** Drive the service into PARKED state via onServerAmbient (take-parked path). */
function simulateParked(svc: StruggleInterventionService, episodeId = 'ep-parked'): void {
    const gen = svc._slot.generation();
    const requestToken = 'tok-parked';
    const stamp: PendingStamp = { episodeId, generation: gen, hardEvent: false, requestToken };
    const localToken = svc._guard.issue('decide', stamp);
    svc._inFlightMarker = { requestToken, episodeId, generation: gen, intent: 'decide', localToken };
    svc._candidate = { episodeId, isNew: true, hints: [], createdAtMs: Date.now() };
    svc.onServerAmbient('ambient hint', undefined, undefined, undefined, 0.9, 99);
}

/** Simulate onServerStale(ask=true): binds _liveAskBinding and arms the deadline latch. Slot must be DELIVERED. */
function simulateStaleAsk(svc: StruggleInterventionService): void {
    const snap = svc._slot.snapshot();
    const episodeId = snap.state.kind === 'delivered' ? snap.state.episode.episodeId : 'ep-test';
    const gen = svc._slot.generation();
    const stamp: PendingStamp = { episodeId, generation: gen, hardEvent: false, requestToken: 'rt-stale' };
    const localToken = svc._guard.issue('stale_check', stamp);
    svc._inFlightMarker = { requestToken: 'rt-stale', episodeId, generation: gen, intent: 'stale_check', localToken };
    svc.onServerStale(episodeId, true, 10, 'Are you stuck?');
}

/** Set up an in-flight confirm_close marker against the current slot episode. */
function armConfirmCloseInFlight(svc: StruggleInterventionService): void {
    const snap = svc._slot.snapshot();
    const st = snap.state;
    const episodeId = (st.kind === 'delivered' || st.kind === 'parked') ? st.episode.episodeId : 'ep-test';
    const gen = snap.generation;
    const stamp: PendingStamp = { episodeId, generation: gen, hardEvent: false, requestToken: 'rt-cc' };
    const localToken = svc._guard.issue('confirm_close', stamp);
    svc._inFlightMarker = { requestToken: 'rt-cc', episodeId, generation: gen, intent: 'confirm_close', localToken };
}

let _epCounter = 0;
/** Drive one full deliver-then-dismiss cycle (creates a fresh episode per call). */
function driveDismiss(svc: StruggleInterventionService): void {
    const epId = `ep-dismiss-${++_epCounter}`;
    simulateDelivered(svc, 'active', epId);
    svc.dismissEpisode();
}

/** Drive a full decide POST via the production deliver() path, leaving _inFlightMarker set (waiting for ws reply). */
async function driveAcceptedPost(svc: StruggleInterventionService): Promise<void> {
    svc.onTick(tickRecord());
    svc.deliver(alertRecord());
    await new Promise(r => setTimeout(r, 0));
}

/** Override setEpisodeOutcome to return applied=false, then await applyEpisodeOutcome to ensure _setPendingOutcome is called. */
async function drivePendingBackfill(svc: StruggleInterventionService): Promise<void> {
    svc['_deps'].setEpisodeOutcome = vi.fn(async () => ({ applied: false }));
    await svc.applyEpisodeOutcome('ep-backfill', 'DISMISSED');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StruggleInterventionService - slot debug snapshot + episode history', () => {
    it('snapshot reflects FREE slot', () => {
        const { svc } = makeService();
        const s = svc.getSlotDebugSnapshot();
        expect(s.state).toBe('free');
        expect(s.episodeId).toBeNull();
        expect(s.level).toBeNull();
        expect(s.inFlight).toBeNull();
    });

    it('snapshot reflects a DELIVERED active episode with in-flight confirm_close', () => {
        const { svc } = makeService();
        simulateDelivered(svc, 'active');
        armConfirmCloseInFlight(svc);
        const s = svc.getSlotDebugSnapshot();
        expect(s.state).toBe('delivered');
        expect(s.level).toBe('active');
        expect(s.hintCount).toBeGreaterThan(0);
        expect(s.inFlight?.intent).toBe('confirm_close');
        expect(s.inFlight?.requestToken).toBeTypeOf('string');
    });

    it('abandon.armed derives from the live ask binding, not the latch', () => {
        const { svc } = makeService();
        simulateDelivered(svc, 'active');
        expect(svc.getSlotDebugSnapshot().abandon.armed).toBe(false);
        simulateStaleAsk(svc);
        const s = svc.getSlotDebugSnapshot();
        expect(s.abandon.armed).toBe(true);
        expect(s.abandon.deadlineMs).toBeTypeOf('number');
    });

    it('recordTerminalEpisode caps at 20 and derives peakLevel/duration', () => {
        const { svc } = makeService();
        for (let i = 0; i < 25; i++) { driveDismiss(svc); }
        const hist = svc.getEpisodeHistory();
        expect(hist.length).toBe(20);
        expect(hist[hist.length - 1].outcome).toBe('DISMISSED');
        expect(['ambient', 'active']).toContain(hist[0].peakLevel);
    });

    it('resetSession records INTERRUPTED for DELIVERED, DISCARDED for PARKED', () => {
        const { svc } = makeService();
        simulateDelivered(svc, 'active');
        svc.resetSession();
        expect(svc.getEpisodeHistory().at(-1)?.outcome).toBe('INTERRUPTED');
        simulateParked(svc);
        svc.resetSession();
        expect(svc.getEpisodeHistory().at(-1)?.outcome).toBe('DISCARDED');
    });

    it('notifySlotDebugChanged fires once per branch (coalesced) and is a no-op without onSlotChange', async () => {
        const onSlotChange = vi.fn();
        const { svc } = makeService({ onSlotChange });
        svc.setInSession(true);
        svc.setInSession(false); // two sync mutations
        await Promise.resolve(); // flush microtask
        expect(onSlotChange).toHaveBeenCalledTimes(1);

        const { svc: svc2 } = makeService(); // no onSlotChange
        expect(() => svc2.setInSession(true)).not.toThrow();
    });

    it('notify covers in-flight + pending-outcome mutations (not just public exits)', async () => {
        const onSlotChange = vi.fn();
        const { svc } = makeService({ onSlotChange });
        await driveAcceptedPost(svc); // deliver -> accepted POST sets _inFlightMarker via _setInFlightMarker
        await Promise.resolve();
        expect(onSlotChange).toHaveBeenCalled();
        expect(svc.getSlotDebugSnapshot().inFlight).not.toBeNull();
        onSlotChange.mockClear();
        await drivePendingBackfill(svc); // await so _setPendingOutcome has been called before checking
        await Promise.resolve();         // let the queueMicrotask notify callback fire
        expect(onSlotChange).toHaveBeenCalled();
    });
});
