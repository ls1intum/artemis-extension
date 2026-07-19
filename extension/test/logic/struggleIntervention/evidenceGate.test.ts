/**
 * Evidence gate after idle-abandon (plan: abandon-evidence-gate).
 *
 * After the stale watchdog silently frees a slot (force-free DELIVERED -> ABANDONED,
 * free-silent PARKED), the orchestrator drops non-hard-boundary alerts PRE-throttle
 * until fresh student activity: a typing tick, a hard-boundary alert, a new green
 * test, or an explicit proactive re-enable.
 */
import { describe, expect, it, vi } from 'vitest';

import type { AlertRecord, TickRecord } from '@extension/services/struggle/types';
import type { PendingStamp } from '@extension/services/struggleIntervention/slot/guard';
import type { StruggleInterventionDeps } from '@extension/services/struggleIntervention/struggleInterventionService';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';
import type { IrisChatMessage } from '@extension/types';
import { emptyDecisionTrace } from '@test/__shared__/tickRecordFixture';

// ---------------------------------------------------------------------------
// Harness (mirrors the fakeDeps pattern from struggleInterventionService.test.ts)
// ---------------------------------------------------------------------------

const IDLE_ABANDON_MS = 1000;

function fakeDeps(over: Partial<StruggleInterventionDeps> = {}): StruggleInterventionDeps {
    return {
        isIrisEnabled: () => true,
        isEgressEnabled: () => true,
        hasNoaiMarker: () => false,
        getExerciseId: () => 42,
        getExerciseRoot: () => undefined,
        collectFiles: vi.fn(async () => ({ 'src/A.java': 'class A {}' })),
        readFileContent: vi.fn(() => undefined),
        postIntervention: vi.fn(async () => 'accepted' as const),
        openSession: vi.fn(async () => undefined),
        showLamp: vi.fn(),
        clearLamp: vi.fn(),
        showActiveJump: vi.fn(),
        clearEpisodeLamp: vi.fn(),
        showInline: vi.fn(),
        showGutterOnly: vi.fn(),
        clearInline: vi.fn(),
        isStudentProactiveOn: () => true,
        getProactiveLevel: () => 'more',
        setBadge: vi.fn(),
        showActiveBanner: vi.fn(),
        hideActiveBanner: vi.fn(),
        postOfferBubble: vi.fn(),
        resolveOfferBubble: vi.fn(),
        showOfferBanner: vi.fn(),
        postBubble: vi.fn(),
        setChatLiveEpisode: vi.fn(),
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
        slotCfg: { idleAbandonMs: IDLE_ABANDON_MS },
        ...over,
    };
}

function makeService(over: Partial<StruggleInterventionDeps> = {}): {
    svc: StruggleInterventionService;
    deps: StruggleInterventionDeps;
} {
    const deps = fakeDeps(over);
    return { svc: new StruggleInterventionService(deps), deps };
}

function tick(ts: number, sBase: number, typingRate = 0): TickRecord {
    return {
        t: Math.floor(ts / 1000),
        ts,
        features: { typingRate } as TickRecord['features'],
        sBase,
        boundariesPreGate: [],
        alert: null,
        decisionTrace: emptyDecisionTrace,
    };
}

function stateAlert(): AlertRecord {
    return { kind: 'edit', t: 530, ts: 530_000, urgency: 0.72, typesPreGate: ['STATE'], types: ['STATE'], primary: 'STATE', path: 'armed', inWarmup: false, inGrace: false };
}

function fmAlert(): AlertRecord {
    return { kind: 'edit', t: 530, ts: 530_000, urgency: 0.72, typesPreGate: ['FM'], types: ['FM'], primary: 'FM', path: 'armed', inWarmup: false, inGrace: false };
}

function tpsAlert(): AlertRecord {
    return { kind: 'discrete', t: 530, ts: 530_000, urgency: 0.72, trigger: 'test-stagnation', inWarmup: false };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Drive the service into DELIVERED state via onServerActive (take-delivered path). */
function simulateDelivered(svc: StruggleInterventionService, episodeId = 'ep-test'): void {
    const gen = svc._slot.generation();
    const requestToken = 'tok-delivered';
    const stamp: PendingStamp = { episodeId, generation: gen, hardEvent: true, requestToken };
    const localToken = svc._guard.issue('decide', stamp);
    svc._inFlightMarker = { requestToken, episodeId, generation: gen, intent: 'decide', localToken };
    svc._candidate = { episodeId, hints: [], createdAtMs: Date.now() };
    svc.onServerActive(episodeId, 1, undefined, undefined, undefined, 0.9, 'hint text', 99);
}

/** Drive the service into PARKED state via onServerAmbient (take-parked path). */
function simulateParked(svc: StruggleInterventionService, episodeId = 'ep-parked'): void {
    const gen = svc._slot.generation();
    const requestToken = 'tok-parked';
    const stamp: PendingStamp = { episodeId, generation: gen, hardEvent: false, requestToken };
    const localToken = svc._guard.issue('decide', stamp);
    svc._inFlightMarker = { requestToken, episodeId, generation: gen, intent: 'decide', localToken };
    svc._candidate = { episodeId, hints: [], createdAtMs: Date.now() };
    svc.onServerAmbient(episodeId, 'ambient hint', undefined, undefined, undefined, 0.9, 99);
}

/** Idle past the watchdog deadline (high sBase so resetProgress does not defer it). */
function driveIdleAbandon(svc: StruggleInterventionService): void {
    svc.onTick(tick(Date.now() + IDLE_ABANDON_MS + 1000, 0.7));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StruggleInterventionService - evidence gate after idle-abandon', () => {
    it('setStudentProactive(true) from a NON-active exercise does NOT clear the active exercise evidence gate (#341)', () => {
        const { svc } = makeService();
        simulateDelivered(svc);
        driveIdleAbandon(svc);
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(true);

        svc.setStudentProactive(999, true);   // non-active On: the id guard keeps the gate
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(true);

        svc.setStudentProactive(42, true);    // active On: resets the gate ("student present")
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(false);
    });

    it('force-free (DELIVERED -> ABANDONED) sets the gate; a STATE-only alert no longer POSTs', async () => {
        const { svc, deps } = makeService();
        simulateDelivered(svc);
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(false);

        driveIdleAbandon(svc);
        expect(svc.getSlotDebugSnapshot().state).toBe('free');
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(true);

        // Pre-throttle budget protection: the BackoffSource predicate drops it above the throttle.
        expect(svc.shouldSuppress(stateAlert())).toBe(true);

        svc.deliver(stateAlert());
        await flush();
        expect(deps.postIntervention).not.toHaveBeenCalled();
    });

    it('free-silent (PARKED) sets the gate too', () => {
        const { svc } = makeService();
        simulateParked(svc);
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(false);

        driveIdleAbandon(svc);
        expect(svc.getSlotDebugSnapshot().state).toBe('free');
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(true);
    });

    it('a typing tick clears the gate and STATE-only alerts POST again', async () => {
        const { svc, deps } = makeService();
        simulateDelivered(svc);
        driveIdleAbandon(svc);
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(true);

        svc.onTick(tick(Date.now() + IDLE_ABANDON_MS + 2000, 0.7, 25));
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(false);

        svc.deliver(stateAlert());
        await flush();
        expect(deps.postIntervention).toHaveBeenCalledTimes(1);
    });

    it('a hard-boundary alert passes the gate, POSTs, and clears it for later STATE alerts', async () => {
        const { svc, deps } = makeService();
        simulateDelivered(svc);
        driveIdleAbandon(svc);
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(true);

        expect(svc.shouldSuppress(fmAlert())).toBe(false);
        svc.deliver(fmAlert());
        await flush();
        expect(deps.postIntervention).toHaveBeenCalledTimes(1);
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(false);
        expect(svc.shouldSuppress(stateAlert())).toBe(false);
    });

    it('a TPS (discrete) alert is a hard event too: passes the gate, POSTs, and clears it', async () => {
        // TPS is build-anchored (a student-submitted build), so like FM/E4/N1 it counts as
        // fresh evidence after an idle-abandon.
        const { svc, deps } = makeService();
        simulateDelivered(svc);
        driveIdleAbandon(svc);
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(true);

        expect(svc.shouldSuppress(tpsAlert())).toBe(false);
        svc.deliver(tpsAlert());
        await flush();
        expect(deps.postIntervention).toHaveBeenCalledTimes(1);
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(false);
        expect(svc.shouldSuppress(stateAlert())).toBe(false);
    });

    it('a new green test clears the gate', () => {
        const { svc } = makeService();
        simulateDelivered(svc);
        driveIdleAbandon(svc);
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(true);

        svc.onNewBuildResult(true);
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(false);
    });

    it('resetSession (new exercise) clears the gate', () => {
        const { svc } = makeService();
        simulateDelivered(svc);
        driveIdleAbandon(svc);
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(true);

        svc.resetSession();
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(false);
    });

    it('proactive re-enable (off -> on) clears the gate; disable does not', () => {
        const { svc } = makeService();
        simulateDelivered(svc);
        driveIdleAbandon(svc);
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(true);

        svc.setStudentProactive(42, false);
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(true);

        svc.setStudentProactive(42, true);
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(false);
    });

    it('DISMISSED and RECOVERED terminals do NOT set the gate', () => {
        const { svc } = makeService();
        simulateDelivered(svc, 'ep-dismiss');
        svc.dismissEpisode();
        expect(svc.getSlotDebugSnapshot().state).toBe('free');
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(false);

        simulateDelivered(svc, 'ep-recover');
        // Arm a confirm_close in-flight against the live episode, then resolve it.
        const snap = svc._slot.snapshot();
        const stamp: PendingStamp = { episodeId: 'ep-recover', generation: snap.generation, hardEvent: false, requestToken: 'rt-cc' };
        const localToken = svc._guard.issue('confirm_close', stamp);
        svc._inFlightMarker = { requestToken: 'rt-cc', episodeId: 'ep-recover', generation: snap.generation, intent: 'confirm_close', localToken };
        svc.onServerClose('ep-recover', true, undefined, undefined, undefined);
        expect(svc.getSlotDebugSnapshot().state).toBe('free');
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(false);
    });

    it('threshold-tick race: typing on the very tick the watchdog is due defers the abandon (no gate, slot stays)', () => {
        const { svc } = makeService();
        simulateDelivered(svc);

        // The deadline tick carries typing evidence AND high sBase: the student just returned.
        const dueTs = Date.now() + IDLE_ABANDON_MS + 1000;
        svc.onTick(tick(dueTs, 0.7, 25));
        expect(svc.getSlotDebugSnapshot().state).toBe('delivered');
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(false);

        // Idle continues past the DEFERRED deadline without typing: now the abandon fires.
        svc.onTick(tick(dueTs + IDLE_ABANDON_MS + 1000, 0.7));
        expect(svc.getSlotDebugSnapshot().state).toBe('free');
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(true);
    });

    it('race regression: a late decide reply after force-free is dropped and the gate stays set', () => {
        const { svc, deps } = makeService();
        simulateDelivered(svc, 'ep-race');

        // A continuation decide is on the wire against the live episode when the abandon fires.
        const gen = svc._slot.generation();
        const stamp: PendingStamp = { episodeId: 'ep-race', generation: gen, hardEvent: false, requestToken: 'rt-late' };
        const localToken = svc._guard.issue('decide', stamp);
        svc._inFlightMarker = { requestToken: 'rt-late', episodeId: 'ep-race', generation: gen, intent: 'decide', localToken };

        driveIdleAbandon(svc);
        expect(svc.getSlotDebugSnapshot().state).toBe('free');
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(true);

        // Late replies from the pre-abandon POST must not deliver anything.
        svc.onServerActive('ep-race', 1, undefined, undefined, undefined, 0.9, 'late hint', 123);
        expect(svc.getSlotDebugSnapshot().state).toBe('free');
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(true);

        svc.onServerAmbient('ep-race', 'late ambient', undefined, undefined, undefined, 0.9, 124);
        expect(svc.getSlotDebugSnapshot().state).toBe('free');
        expect(svc.getSlotDebugSnapshot().awaitingEvidence).toBe(true);
        expect(deps.showLamp).not.toHaveBeenCalled();
    });
});
