import { describe, expect, it, vi } from 'vitest';

import type { InterventionEventLog } from '@extension/services/struggleIntervention/interventionEventLog';
import type { PendingStamp } from '@extension/services/struggleIntervention/slot/guard';
import { classifyStruggleEvent, subscribeStruggleEvents } from '@extension/services/struggleIntervention/struggleEventSubscription';
import type { StruggleInterventionDeps } from '@extension/services/struggleIntervention/struggleInterventionService';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set up a synthetic in-flight 'decide' for testing inbound handlers.
 * In production these are set by _handleAlert before the async POST;
 * tests call them directly, so this synthetic setup is required.
 */
function simulateDecidePending(svc: StruggleInterventionService, episodeId = 'ep-test', hardEvent = false): void {
    const gen = svc._slot.generation();
    const requestToken = 'test-request-token';
    const stamp: PendingStamp = { episodeId, generation: gen, hardEvent, requestToken };
    const localToken = svc._guard.issue('decide', stamp);
    svc._inFlightMarker = { requestToken, episodeId, generation: gen, intent: 'decide', localToken };
    svc._candidate = { episodeId, hints: [], createdAtMs: 0 };
}

function makeDeps(overrides: Partial<StruggleInterventionDeps> = {}): StruggleInterventionDeps {
    return {
        isIrisEnabled: vi.fn().mockReturnValue(true),
        isEgressEnabled: vi.fn().mockReturnValue(true),
        hasNoaiMarker: vi.fn().mockReturnValue(false),
        getExerciseId: vi.fn().mockReturnValue(1),
        getExerciseRoot: vi.fn().mockReturnValue(undefined),
        collectFiles: vi.fn().mockResolvedValue({}),
        readFileContent: vi.fn(() => undefined),
        postIntervention: vi.fn().mockResolvedValue('accepted'),
        openSession: vi.fn().mockResolvedValue(undefined),
        clearLamp: vi.fn(),
        showActiveJump: vi.fn(),
        clearEpisodeLamp: vi.fn(),
        showInline: vi.fn(),
        clearInline: vi.fn(),
        isStudentProactiveOn: vi.fn().mockReturnValue(true),
        softThreshold: 4,
        pauseStrikes: 3,
        setBadge: vi.fn(),
        showActiveBanner: vi.fn(),
        hideActiveBanner: vi.fn(),
        showLamp: vi.fn(),
        showGutterOnly: vi.fn(),
        postBubble: vi.fn(),
        setChatLiveEpisode: vi.fn(),
        log: { record: vi.fn().mockResolvedValue(undefined) } as unknown as InterventionEventLog,
        setTimeoutFn: (_fn: () => void, _ms: number) => { /* deterministic noop */ },
        // C2 reveal deps (no-ops for these tests)
        generateLocalId: () => 'test-local-id',
        postRevealBubble: vi.fn(),
        reconcileOptimisticBubble: vi.fn(),
        revealAmbient: vi.fn(async () => ({ id: 1, sentAt: 'T' })),
        setEpisodeOutcome: vi.fn(async () => ({ applied: true })),
        // C3 slot-continuity deps (no-ops for these tests)
        cancelOutstandingStruggleJob: vi.fn(async () => undefined),
        foldEpisode: vi.fn(),
        // C4: stale-row suppression (no-op for most tests)
        postRemoveMessage: vi.fn(),
        deleteSupersededProactiveMessage: vi.fn(async () => undefined),
        ...overrides,
    };
}

/**
 * Set up a synthetic in-flight 'confirm_close' and put the slot in DELIVERED state.
 * Simulates the state after the student triggered a progress-close.
 */
function simulateDeliveredWithClosePending(svc: StruggleInterventionService, episodeId = 'ep-close'): void {
    // First put slot in DELIVERED via the decide path
    simulateDecidePending(svc, episodeId);
    svc.onServerActive(42, undefined, undefined, undefined, undefined, 'Iris has a hint.', 100);
    // Now set up the confirm_close in-flight
    const gen = svc._slot.generation();
    const requestToken = 'close-request-token';
    const stamp: PendingStamp = { episodeId, generation: gen, hardEvent: false, requestToken };
    const localToken = svc._guard.issue('confirm_close', stamp);
    svc._inFlightMarker = { requestToken, episodeId, generation: gen, intent: 'confirm_close', localToken };
}

/**
 * Set up a synthetic in-flight 'confirm_close' with slot in PARKED state.
 */
function simulateParkedWithClosePending(svc: StruggleInterventionService, episodeId = 'ep-parked'): void {
    // Put slot in PARKED via ambient decide path
    simulateDecidePending(svc, episodeId);
    svc.onServerAmbient('Ambient hint', undefined, undefined, undefined, undefined, null);
    // Now set up the confirm_close in-flight
    const gen = svc._slot.generation();
    const requestToken = 'close-parked-token';
    const stamp: PendingStamp = { episodeId, generation: gen, hardEvent: false, requestToken };
    const localToken = svc._guard.issue('confirm_close', stamp);
    svc._inFlightMarker = { requestToken, episodeId, generation: gen, intent: 'confirm_close', localToken };
}


// ---------------------------------------------------------------------------
// classifyStruggleEvent
// ---------------------------------------------------------------------------

describe('classifyStruggleEvent', () => {
    it('parses an ambient event', () => {
        const e = classifyStruggleEvent({ exerciseId: 42, action: 'ambient', message: 'Re-check the logic.' });
        expect(e).toMatchObject({ exerciseId: 42, action: 'ambient', message: 'Re-check the logic.' });
    });
    it('parses an active event with sessionId', () => {
        const e = classifyStruggleEvent({ exerciseId: 42, action: 'active', sessionId: 7 });
        expect(e).toMatchObject({ exerciseId: 42, action: 'active', sessionId: 7 });
    });
    it('reads an optional confidence if the frame forwards it (Plan 2 cross-plan)', () => {
        const e = classifyStruggleEvent({ exerciseId: 42, action: 'ambient', message: 'x', confidence: 0.7 });
        expect(e?.confidence).toBe(0.7);
    });
    it('parses messageId when present (ambient + active)', () => {
        expect(classifyStruggleEvent({ exerciseId: 1, action: 'ambient', message: 'hi', sessionId: 9, messageId: 556, confidence: 0.8 })?.messageId).toBe(556);
        expect(classifyStruggleEvent({ exerciseId: 1, action: 'active', sessionId: 9, messageId: 555 })?.messageId).toBe(555);
    });
    it('leaves messageId undefined when absent or non-numeric', () => {
        expect(classifyStruggleEvent({ exerciseId: 1, action: 'active', sessionId: 9 })?.messageId).toBeUndefined();
        expect(classifyStruggleEvent({ exerciseId: 1, action: 'active', sessionId: 9, messageId: 'x' })?.messageId).toBeUndefined();
    });
    it('parses anchor + inlineHint', () => {
        const e = classifyStruggleEvent({ exerciseId: 1, action: 'ambient', sessionId: 9, messageId: 5, anchorFile: 'Sort.java', anchorLine: 42, inlineHint: 'off-by-one?' });
        expect(e?.anchorFile).toBe('Sort.java');
        expect(e?.anchorLine).toBe(42);
        expect(e?.inlineHint).toBe('off-by-one?');
    });
    it('leaves anchor fields undefined when absent or wrong-typed', () => {
        const e = classifyStruggleEvent({ exerciseId: 1, action: 'ambient', message: 'x', anchorFile: 7, anchorLine: 'x', inlineHint: 9 });
        expect(e?.anchorFile).toBeUndefined();
        expect(e?.anchorLine).toBeUndefined();
        expect(e?.inlineHint).toBeUndefined();
    });
    it('returns undefined for malformed / non-struggle frames', () => {
        expect(classifyStruggleEvent({ foo: 1 })).toBeUndefined();
        expect(classifyStruggleEvent(null)).toBeUndefined();
        expect(classifyStruggleEvent({ exerciseId: 42, action: 'silent' })).toBeUndefined();
        expect(classifyStruggleEvent({ exerciseId: 42, action: 'active' })).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// subscribeStruggleEvents dispatch
// ---------------------------------------------------------------------------

describe('subscribeStruggleEvents dispatch', () => {
    it('threads exerciseId + messageId through to the ambient/active handlers', () => {
        let onFrame: ((d: unknown) => void) | undefined;
        const subscribe = (_topic: string, f: (d: unknown) => void) => { onFrame = f; return { dispose() { /* noop */ } }; };
        const onServerAmbient = vi.fn();
        const onServerActive = vi.fn();
        subscribeStruggleEvents(subscribe, { onServerAmbient, onServerActive, onServerSilent: vi.fn(), onServerClose: vi.fn() });

        // Ambient: messageId absent -> null
        onFrame!({ exerciseId: 42, action: 'ambient', message: 'Re-check the logic.', anchorFile: 'src/A.java', anchorLine: 42, inlineHint: 'off-by-one?' });
        expect(onServerAmbient).toHaveBeenCalledWith(42, 'Re-check the logic.', 'src/A.java', 42, 'off-by-one?', undefined, null);

        // Active without anchor: messageId absent -> null, message absent -> undefined
        onFrame!({ exerciseId: 99, action: 'active', sessionId: 7, confidence: 0.5 });
        expect(onServerActive).toHaveBeenCalledWith(99, 7, undefined, undefined, undefined, 0.5, undefined, null);

        // Active with anchor and messageId
        onFrame!({ exerciseId: 99, action: 'active', sessionId: 8, anchorFile: 'src/B.java', anchorLine: 84, inlineHint: 'check punctuation', confidence: 0.9 });
        expect(onServerActive).toHaveBeenCalledWith(99, 8, 'src/B.java', 84, 'check punctuation', 0.9, undefined, null);

        // Active with messageId set: threads through
        onFrame!({ exerciseId: 5, action: 'active', sessionId: 3, message: 'Try X.', messageId: 556 });
        expect(onServerActive).toHaveBeenCalledWith(5, 3, undefined, undefined, undefined, undefined, 'Try X.', 556);
    });
});

// ---------------------------------------------------------------------------
// C1: Surface split (onServerAmbient / onServerActive behavior)
// ---------------------------------------------------------------------------

describe('StruggleInterventionService surface split (C1)', () => {
    it('onServerAmbient with anchor: showGutterOnly + badge + lamp; never showInline, never banner, never bubble', () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);

        svc.onServerAmbient('Try checking bounds.', 'Sort.java', 10, 'off-by-one?');

        expect(deps.showGutterOnly).toHaveBeenCalledWith('Sort.java', 10);
        expect(deps.setBadge).toHaveBeenCalledWith(true);
        expect(deps.showLamp).toHaveBeenCalled();
        // Must NOT show inline text, banner, or bubble:
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.showActiveBanner).not.toHaveBeenCalled();
        expect(deps.postBubble).not.toHaveBeenCalled();
    });

    it('onServerAmbient without anchor: badge + lamp only; no gutter-only, no inline', () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);

        svc.onServerAmbient('Try checking bounds.', undefined, undefined, undefined);

        expect(deps.showLamp).toHaveBeenCalled();
        expect(deps.setBadge).toHaveBeenCalledWith(true);
        expect(deps.showGutterOnly).not.toHaveBeenCalled();
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.postBubble).not.toHaveBeenCalled();
    });

    it('onServerActive posts optimistic bubble tagged with messageId + inline + banner + badge + hides lamp', () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);

        svc.onServerActive(42, 'Sort.java', 10, 'off-by-one?', undefined, 'Try checking array bounds.', 556);

        // Optimistic bubble with messageId for dedup
        expect(deps.postBubble).toHaveBeenCalledWith('Try checking array bounds.', 556, 'ep-test');
        // Inline breadcrumb armed at the anchor (4th arg = message ?? inlineHint, so message wins when provided)
        expect(deps.showInline).toHaveBeenCalledWith('Sort.java', 10, 'off-by-one?', 'Try checking array bounds.');
        // Nudge banner
        expect(deps.showActiveBanner).toHaveBeenCalledWith('ep-test');
        // Badge
        expect(deps.setBadge).toHaveBeenCalledWith(true);
        // Anchored active: the jump lamp is armed (not the unconditional clearLamp), and the
        // ambient reveal-lamp is never shown for active.
        expect(deps.showActiveJump).toHaveBeenCalledWith('Sort.java', 10);
        expect(deps.clearLamp).not.toHaveBeenCalled();
        expect(deps.showLamp).not.toHaveBeenCalled();
    });

    it('onServerActive with messageId=null posts runtime-only fallback bubble and still proceeds', () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);

        svc.onServerActive(42, undefined, undefined, undefined, undefined, 'Try checking bounds.', null);

        // Fallback bubble with null id (runtime-only, no dedup tag)
        expect(deps.postBubble).toHaveBeenCalledWith('Try checking bounds.', null, 'ep-test');
        expect(deps.showActiveBanner).toHaveBeenCalledWith('ep-test');
        expect(deps.clearLamp).toHaveBeenCalled();
    });

    it('onServerActive with undefined message falls back to a default bubble text', () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);

        svc.onServerActive(42, undefined, undefined, undefined, undefined, undefined, 123);

        // postBubble still called even if message is undefined
        expect(deps.postBubble).toHaveBeenCalled();
        const [calledText, calledId] = (deps.postBubble as ReturnType<typeof vi.fn>).mock.calls[0] as [string, number];
        expect(typeof calledText).toBe('string');
        expect(calledText.length).toBeGreaterThan(0);
        expect(calledId).toBe(123);
    });

    it('applyEscalation(inSession=true) posts quiet bubble and suppresses banner + inline', () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);

        svc.applyEscalation(true, 'Check the loop bounds.', 'Sort.java', 10, 'off-by-one?', 789);

        expect(deps.postBubble).toHaveBeenCalledWith('Check the loop bounds.', 789, undefined);
        expect(deps.showActiveBanner).not.toHaveBeenCalled();
        expect(deps.showInline).not.toHaveBeenCalled();
    });

    it('applyEscalation(inSession=false) fires banner + inline push', () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);

        svc.applyEscalation(false, 'Check the loop bounds.', 'Sort.java', 10, 'off-by-one?', 789);

        expect(deps.postBubble).toHaveBeenCalledWith('Check the loop bounds.', 789, undefined);
        expect(deps.showActiveBanner).toHaveBeenCalledWith(undefined);
        expect(deps.showInline).toHaveBeenCalledWith('Sort.java', 10, 'off-by-one?', 'Check the loop bounds.');
    });

    it('applyEscalation(inSession=false) without anchor data: banner but no inline push', () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);

        svc.applyEscalation(false, 'Check the loop bounds.', undefined, undefined, undefined, null);

        expect(deps.postBubble).toHaveBeenCalledWith('Check the loop bounds.', null, undefined);
        expect(deps.showActiveBanner).toHaveBeenCalledWith(undefined);
        expect(deps.showInline).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// C4: classifyStruggleEvent -- new frame kinds
// ---------------------------------------------------------------------------

describe('classifyStruggleEvent -- C4 new frame kinds', () => {
    it('round-trips kind=decide action=silent with episodeId and messageId', () => {
        const e = classifyStruggleEvent({ exerciseId: 5, kind: 'decide', action: 'silent', episodeId: 'ep-1', messageId: 42 });
        expect(e).toMatchObject({ exerciseId: 5, kind: 'decide', action: 'silent', episodeId: 'ep-1', messageId: 42 });
    });

    it('round-trips kind=confirm_close with all fields', () => {
        const e = classifyStruggleEvent({
            exerciseId: 5, kind: 'confirm_close', episodeId: 'ep-1', resolved: true,
            closingSentence: 'Great job!', episodeLabel: 'Sort fixed', messageId: 99,
        });
        expect(e).toMatchObject({ kind: 'confirm_close', episodeId: 'ep-1', resolved: true, closingSentence: 'Great job!', episodeLabel: 'Sort fixed', messageId: 99 });
    });

    it('returns undefined for kind=confirm_close missing resolved', () => {
        expect(classifyStruggleEvent({ exerciseId: 5, kind: 'confirm_close', episodeId: 'ep-1' })).toBeUndefined();
    });

    it('parses kind=decide action=ambient with episodeId (new-style)', () => {
        const e = classifyStruggleEvent({ exerciseId: 5, kind: 'decide', action: 'ambient', episodeId: 'ep-2', message: 'Check bounds.', messageId: 88 });
        expect(e).toMatchObject({ kind: 'decide', action: 'ambient', episodeId: 'ep-2', message: 'Check bounds.', messageId: 88 });
    });
});

// ---------------------------------------------------------------------------
// C4: subscribeStruggleEvents -- dispatch to new handlers
// ---------------------------------------------------------------------------

describe('subscribeStruggleEvents -- C4 new handler dispatch', () => {
    function makeSubscribe() {
        let onFrame: ((d: unknown) => void) | undefined;
        const subscribe = (_topic: string, f: (d: unknown) => void) => { onFrame = f; return { dispose() { /* noop */ } }; };
        return { subscribe, emit: (d: unknown) => onFrame!(d) };
    }

    it('dispatches kind=decide action=silent to onServerSilent with episodeId and messageId', () => {
        const { subscribe, emit } = makeSubscribe();
        const onServerSilent = vi.fn();
        subscribeStruggleEvents(subscribe, {
            onServerAmbient: vi.fn(), onServerActive: vi.fn(),
            onServerSilent, onServerClose: vi.fn(),
        });
        emit({ exerciseId: 7, kind: 'decide', action: 'silent', episodeId: 'ep-silent', messageId: 11 });
        expect(onServerSilent).toHaveBeenCalledWith('ep-silent', 11);
    });

    it('dispatches kind=confirm_close to onServerClose', () => {
        const { subscribe, emit } = makeSubscribe();
        const onServerClose = vi.fn();
        subscribeStruggleEvents(subscribe, {
            onServerAmbient: vi.fn(), onServerActive: vi.fn(),
            onServerSilent: vi.fn(), onServerClose,
        });
        emit({ exerciseId: 7, kind: 'confirm_close', episodeId: 'ep-close', resolved: true, episodeLabel: 'Sort done', messageId: 22 });
        expect(onServerClose).toHaveBeenCalledWith('ep-close', true, 22, undefined, 'Sort done');
    });

    it('still dispatches backwards-compat ambient/active frames', () => {
        const { subscribe, emit } = makeSubscribe();
        const onServerAmbient = vi.fn();
        const onServerActive = vi.fn();
        subscribeStruggleEvents(subscribe, {
            onServerAmbient, onServerActive,
            onServerSilent: vi.fn(), onServerClose: vi.fn(),
        });
        emit({ exerciseId: 3, action: 'ambient', message: 'Try X.' });
        expect(onServerAmbient).toHaveBeenCalled();
        emit({ exerciseId: 3, action: 'active', sessionId: 9 });
        expect(onServerActive).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// C4: orchestrator handler integration -- silent / confirmClose / staleCheck
// ---------------------------------------------------------------------------

describe('StruggleInterventionService -- C4 silent dispatch', () => {
    it('kind=decide action=silent with matching episodeId on FREE slot stays FREE and clears candidate', () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-test');

        svc.onServerSilent('ep-test', undefined);

        expect(svc._slot.snapshot().state.kind).toBe('free');
        expect(svc._candidate).toBeUndefined();
        expect(svc._inFlightMarker).toBeUndefined();
    });

    it('kind=decide action=silent with mismatched episodeId is dropped (no slot change)', () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-test');

        svc.onServerSilent('ep-OTHER', undefined);

        // in-flight marker must NOT be consumed (real reply may still arrive)
        expect(svc._inFlightMarker).toBeDefined();
        // slot stays FREE (was already free; no change)
        expect(svc._slot.snapshot().state.kind).toBe('free');
    });

    it('mismatched episodeId with messageId triggers postRemoveMessage', () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-test');

        svc.onServerSilent('ep-OTHER', 42);

        expect(deps.postRemoveMessage).toHaveBeenCalledWith(42);
    });

    it('kind=decide action=silent with PARKED slot calls discardParkedToFree', () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-parked');
        // Put slot in PARKED via ambient
        svc.onServerAmbient('Ambient hint.', undefined, undefined, undefined, undefined, null);
        expect(svc._slot.snapshot().state.kind).toBe('parked');

        // Now set up a new decide in-flight for the parked episode
        const gen2 = svc._slot.generation();
        const stamp2: PendingStamp = { episodeId: 'ep-parked-2', generation: gen2, hardEvent: false, requestToken: 'tok2' };
        const lt2 = svc._guard.issue('decide', stamp2);
        svc._inFlightMarker = { requestToken: 'tok2', episodeId: 'ep-parked-2', generation: gen2, intent: 'decide', localToken: lt2 };
        svc._candidate = { episodeId: 'ep-parked-2', hints: [], createdAtMs: 0 };

        svc.onServerSilent('ep-parked-2', undefined);

        expect(svc._slot.snapshot().state.kind).toBe('free');
    });
});

describe('StruggleInterventionService -- C4 confirmClose dispatch', () => {
    it('DELIVERED resolved=true frees slot + calls setEpisodeOutcome(RECOVERED) + foldEpisode with praise', () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDeliveredWithClosePending(svc, 'ep-close');

        svc.onServerClose('ep-close', true, 55, undefined, 'Well done!');

        expect(svc._slot.snapshot().state.kind).toBe('free');
        expect(deps.setEpisodeOutcome).toHaveBeenCalledWith(1, 'ep-close', 'RECOVERED');
        expect(deps.foldEpisode).toHaveBeenCalledWith('ep-close', 'RECOVERED', { episodeLabel: 'Well done!', closeMessageId: 55 });
    });

    it('DELIVERED resolved=true with no episodeLabel emits fold without praise', () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDeliveredWithClosePending(svc, 'ep-close');

        svc.onServerClose('ep-close', true, undefined, undefined, undefined);

        // praise=undefined because both closeMessageId and episodeLabel are undefined
        expect(deps.foldEpisode).toHaveBeenCalledWith('ep-close', 'RECOVERED', undefined);
    });

    it('PARKED resolved=true calls discardParkedToFree: no message, no fold, no outcome', () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateParkedWithClosePending(svc, 'ep-parked');

        svc.onServerClose('ep-parked', true, undefined, undefined, undefined);

        expect(svc._slot.snapshot().state.kind).toBe('free');
        expect(deps.foldEpisode).not.toHaveBeenCalled();
        // PARKED resolved=true: no outcome (discardParkedToFree, no RECOVERED)
        expect(deps.setEpisodeOutcome).not.toHaveBeenCalled();
    });

    it('PARKED resolved=false stays PARKED', () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateParkedWithClosePending(svc, 'ep-parked');

        svc.onServerClose('ep-parked', false, undefined, undefined, undefined);

        expect(svc._slot.snapshot().state.kind).toBe('parked'); // stays PARKED
        expect(deps.foldEpisode).not.toHaveBeenCalled();
    });

    it('confirmClose with mismatched episodeId is dropped + triggers postRemoveMessage', () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDeliveredWithClosePending(svc, 'ep-close');

        svc.onServerClose('ep-WRONG', true, 77, undefined, 'Close sentence');

        // Slot stays DELIVERED
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
        expect(deps.postRemoveMessage).toHaveBeenCalledWith(77);
        // Marker NOT consumed (real reply may still arrive)
        expect(svc._inFlightMarker).toBeDefined();
    });
});
