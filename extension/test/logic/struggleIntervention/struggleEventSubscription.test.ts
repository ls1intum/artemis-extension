import { describe, expect, it, vi } from 'vitest';

import type { InterventionEventLog } from '@extension/services/struggleIntervention/interventionEventLog';
import type { PendingStamp } from '@extension/services/struggleIntervention/slot/guard';
import { classifyStruggleEvent, subscribeStruggleEvents } from '@extension/services/struggleIntervention/struggleEventSubscription';
import type { StruggleInterventionDeps } from '@extension/services/struggleIntervention/struggleInterventionService';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';

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
        getProactiveLevel: vi.fn().mockReturnValue('more'),
        setBadge: vi.fn(),
        showActiveBanner: vi.fn(),
        hideActiveBanner: vi.fn(),
        postOfferBubble: vi.fn(),
        resolveOfferBubble: vi.fn(),
        showOfferBanner: vi.fn(),
        showLamp: vi.fn(),
        showGutterOnly: vi.fn(),
        postBubble: vi.fn(),
        setChatLiveEpisode: vi.fn(),
        log: { record: vi.fn().mockResolvedValue(undefined) } as unknown as InterventionEventLog,
        setTimeoutFn: (_fn: () => void, _ms: number) => { /* deterministic noop */ },
        // C2 reveal deps (no-ops for these tests)
        reconcileOptimisticBubble: vi.fn(),
        // Reveal navigation (unused in this suite).
        resolveRevealTarget: () => ({ courseId: 100, title: 'Fake Exercise' }),
        currentNavToken: () => 1,
        openRevealSession: vi.fn(async () => true),
        notifyRevealUnavailable: vi.fn(),
        notifyRevealFailed: vi.fn(),
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
    svc.onServerActive(episodeId, 42, undefined, undefined, undefined, undefined, 'Iris has a hint.', 100);
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
    svc.onServerAmbient(episodeId, 'Ambient hint', undefined, undefined, undefined, undefined, null);
    const gen = svc._slot.generation();
    const requestToken = 'close-parked-token';
    const stamp: PendingStamp = { episodeId, generation: gen, hardEvent: false, requestToken };
    const localToken = svc._guard.issue('confirm_close', stamp);
    svc._inFlightMarker = { requestToken, episodeId, generation: gen, intent: 'confirm_close', localToken };
}

describe('classifyStruggleEvent', () => {
    it('parses an ambient event', async () => {
        const e = classifyStruggleEvent({ exerciseId: 42, action: 'ambient', message: 'Re-check the logic.' });
        expect(e).toMatchObject({ exerciseId: 42, action: 'ambient', message: 'Re-check the logic.' });
    });
    it('parses an active event with sessionId', async () => {
        const e = classifyStruggleEvent({ exerciseId: 42, action: 'active', sessionId: 7 });
        expect(e).toMatchObject({ exerciseId: 42, action: 'active', sessionId: 7 });
    });
    it('reads an optional confidence if the frame forwards it', async () => {
        const e = classifyStruggleEvent({ exerciseId: 42, action: 'ambient', message: 'x', confidence: 0.7 });
        expect(e?.confidence).toBe(0.7);
    });
    it('parses messageId when present (ambient + active)', async () => {
        expect(classifyStruggleEvent({ exerciseId: 1, action: 'ambient', message: 'hi', sessionId: 9, messageId: 556, confidence: 0.8 })?.messageId).toBe(556);
        expect(classifyStruggleEvent({ exerciseId: 1, action: 'active', sessionId: 9, messageId: 555 })?.messageId).toBe(555);
    });
    it('leaves messageId undefined when absent or non-numeric', async () => {
        expect(classifyStruggleEvent({ exerciseId: 1, action: 'active', sessionId: 9 })?.messageId).toBeUndefined();
        expect(classifyStruggleEvent({ exerciseId: 1, action: 'active', sessionId: 9, messageId: 'x' })?.messageId).toBeUndefined();
    });
    it('parses anchor + inlineHint', async () => {
        const e = classifyStruggleEvent({ exerciseId: 1, action: 'ambient', sessionId: 9, messageId: 5, anchorFile: 'Sort.java', anchorLine: 42, inlineHint: 'off-by-one?' });
        expect(e?.anchorFile).toBe('Sort.java');
        expect(e?.anchorLine).toBe(42);
        expect(e?.inlineHint).toBe('off-by-one?');
    });
    it('leaves anchor fields undefined when absent or wrong-typed', async () => {
        const e = classifyStruggleEvent({ exerciseId: 1, action: 'ambient', message: 'x', anchorFile: 7, anchorLine: 'x', inlineHint: 9 });
        expect(e?.anchorFile).toBeUndefined();
        expect(e?.anchorLine).toBeUndefined();
        expect(e?.inlineHint).toBeUndefined();
    });
    it('returns undefined for malformed / non-struggle frames', async () => {
        expect(classifyStruggleEvent({ foo: 1 })).toBeUndefined();
        expect(classifyStruggleEvent(null)).toBeUndefined();
        expect(classifyStruggleEvent({ exerciseId: 42, action: 'silent' })).toBeUndefined();
        expect(classifyStruggleEvent({ exerciseId: 42, action: 'active' })).toBeUndefined();
    });
});

describe('subscribeStruggleEvents dispatch', () => {
    it('threads exerciseId + episodeId + messageId through to the ambient/active handlers', async () => {
        let onFrame: ((d: unknown) => void) | undefined;
        const subscribe = (_topic: string, f: (d: unknown) => void) => { onFrame = f; return { dispose() { /* noop */ } }; };
        const onServerAmbient = vi.fn();
        const onServerActive = vi.fn();
        subscribeStruggleEvents(subscribe, { onServerAmbient, onServerActive, onServerSilent: vi.fn(), onServerClose: vi.fn() });

        // Ambient: episodeId threaded, messageId absent -> null
        onFrame!({ exerciseId: 42, action: 'ambient', episodeId: 'ep-a', message: 'Re-check the logic.', anchorFile: 'src/A.java', anchorLine: 42, inlineHint: 'off-by-one?' });
        expect(onServerAmbient).toHaveBeenCalledWith(42, 'ep-a', 'Re-check the logic.', 'src/A.java', 42, 'off-by-one?', undefined, null, undefined);

        // Active without anchor: episodeId threaded, messageId absent -> null, message absent -> undefined
        onFrame!({ exerciseId: 99, action: 'active', episodeId: 'ep-b', sessionId: 7, confidence: 0.5 });
        expect(onServerActive).toHaveBeenCalledWith(99, 'ep-b', 7, undefined, undefined, undefined, 0.5, undefined, null, undefined);

        // Active with anchor and messageId
        onFrame!({ exerciseId: 99, action: 'active', episodeId: 'ep-c', sessionId: 8, anchorFile: 'src/B.java', anchorLine: 84, inlineHint: 'check punctuation', confidence: 0.9 });
        expect(onServerActive).toHaveBeenCalledWith(99, 'ep-c', 8, 'src/B.java', 84, 'check punctuation', 0.9, undefined, null, undefined);

        // Active with messageId set: threads through; frame with NO episodeId forwards undefined
        onFrame!({ exerciseId: 5, action: 'active', sessionId: 3, message: 'Try X.', messageId: 556 });
        expect(onServerActive).toHaveBeenCalledWith(5, undefined, 3, undefined, undefined, undefined, undefined, 'Try X.', 556, undefined);

        // rationale is eval-log telemetry: it rides beside confidence and must reach the handler,
        // on the ambient path as much as the active one.
        onFrame!({ exerciseId: 42, action: 'ambient', episodeId: 'ep-r', message: 'm', rationale: 'earlier hint already said this' });
        expect(onServerAmbient).toHaveBeenLastCalledWith(42, 'ep-r', 'm', undefined, undefined, undefined, undefined, null, 'earlier hint already said this');
        onFrame!({ exerciseId: 42, action: 'active', episodeId: 'ep-s', sessionId: 4, rationale: 'compile error still present at the anchor' });
        expect(onServerActive).toHaveBeenLastCalledWith(42, 'ep-s', 4, undefined, undefined, undefined, undefined, undefined, null, 'compile error still present at the anchor');
        // A non-string rationale is dropped rather than forwarded.
        onFrame!({ exerciseId: 42, action: 'active', episodeId: 'ep-t', sessionId: 4, rationale: 42 });
        expect(onServerActive).toHaveBeenLastCalledWith(42, 'ep-t', 4, undefined, undefined, undefined, undefined, undefined, null, undefined);
    });
});

describe('StruggleInterventionService surface split (C1)', () => {
    it('onServerAmbient with anchor: showGutterOnly + badge + lamp; never showInline, never banner, never bubble', async () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);

        svc.onServerAmbient('ep-test', 'Try checking bounds.', 'Sort.java', 10, 'off-by-one?');

        expect(deps.showGutterOnly).toHaveBeenCalledWith('Sort.java', 10);
        expect(deps.setBadge).toHaveBeenCalledWith(true);
        expect(deps.showLamp).toHaveBeenCalled();
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.showActiveBanner).not.toHaveBeenCalled();
        expect(deps.postBubble).not.toHaveBeenCalled();
    });

    it('onServerAmbient without anchor: badge + lamp only; no gutter-only, no inline', async () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);

        svc.onServerAmbient('ep-test', 'Try checking bounds.', undefined, undefined, undefined);

        expect(deps.showLamp).toHaveBeenCalled();
        expect(deps.setBadge).toHaveBeenCalledWith(true);
        expect(deps.showGutterOnly).not.toHaveBeenCalled();
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.postBubble).not.toHaveBeenCalled();
    });

    it('onServerActive posts optimistic bubble tagged with messageId + inline + banner + badge + hides lamp', async () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);

        svc.onServerActive('ep-test', 42, 'Sort.java', 10, 'off-by-one?', undefined, 'Try checking array bounds.', 556);
        // The active surface navigates before posting the bubble, so let that settle.
        await Promise.resolve();
        await Promise.resolve();

        // Optimistic bubble with messageId for dedup
        expect(deps.postBubble).toHaveBeenCalledWith('Try checking array bounds.', 556, 'ep-test');
        // Inline breadcrumb armed at the anchor (4th arg = message ?? inlineHint, so message wins when provided)
        expect(deps.showInline).toHaveBeenCalledWith('Sort.java', 10, 'off-by-one?', 'Try checking array bounds.');
        expect(deps.showActiveBanner).toHaveBeenCalledWith('ep-test');
        expect(deps.setBadge).toHaveBeenCalledWith(true);
        // Anchored active: the jump lamp is armed (not the unconditional clearLamp), and the
        // ambient reveal-lamp is never shown for active.
        expect(deps.showActiveJump).toHaveBeenCalledWith('Sort.java', 10);
        expect(deps.clearLamp).not.toHaveBeenCalled();
        expect(deps.showLamp).not.toHaveBeenCalled();
    });

    it('onServerActive with messageId=null posts runtime-only fallback bubble and still proceeds', async () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);

        svc.onServerActive('ep-test', 42, undefined, undefined, undefined, undefined, 'Try checking bounds.', null);
        // The active surface navigates before posting the bubble, so let that settle.
        await Promise.resolve();
        await Promise.resolve();

        // Fallback bubble with null id (runtime-only, no dedup tag)
        expect(deps.postBubble).toHaveBeenCalledWith('Try checking bounds.', null, 'ep-test');
        expect(deps.showActiveBanner).toHaveBeenCalledWith('ep-test');
        expect(deps.clearLamp).toHaveBeenCalled();
    });

    it('onServerActive with undefined message falls back to a default bubble text', async () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);

        svc.onServerActive('ep-test', 42, undefined, undefined, undefined, undefined, undefined, 123);
        // The active surface navigates before posting the bubble, so let that settle.
        await Promise.resolve();
        await Promise.resolve();

        expect(deps.postBubble).toHaveBeenCalled();
        const [calledText, calledId] = (deps.postBubble as ReturnType<typeof vi.fn>).mock.calls[0] as [string, number];
        expect(typeof calledText).toBe('string');
        expect(calledText.length).toBeGreaterThan(0);
        expect(calledId).toBe(123);
    });

    it('applyEscalation(inSession=true) posts quiet bubble and suppresses banner + inline', async () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);

        svc.applyEscalation(true, 'Check the loop bounds.', 'Sort.java', 10, 'off-by-one?', 789);

        expect(deps.postBubble).toHaveBeenCalledWith('Check the loop bounds.', 789, undefined);
        expect(deps.showActiveBanner).not.toHaveBeenCalled();
        expect(deps.showInline).not.toHaveBeenCalled();
    });

    it('applyEscalation(inSession=false) fires banner + inline push', async () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);

        svc.applyEscalation(false, 'Check the loop bounds.', 'Sort.java', 10, 'off-by-one?', 789);

        expect(deps.postBubble).toHaveBeenCalledWith('Check the loop bounds.', 789, undefined);
        expect(deps.showActiveBanner).toHaveBeenCalledWith(undefined);
        expect(deps.showInline).toHaveBeenCalledWith('Sort.java', 10, 'off-by-one?', 'Check the loop bounds.');
    });

    it('applyEscalation(inSession=false) without anchor data: banner but no inline push', async () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);

        svc.applyEscalation(false, 'Check the loop bounds.', undefined, undefined, undefined, null);

        expect(deps.postBubble).toHaveBeenCalledWith('Check the loop bounds.', null, undefined);
        expect(deps.showActiveBanner).toHaveBeenCalledWith(undefined);
        expect(deps.showInline).not.toHaveBeenCalled();
    });
});

describe('classifyStruggleEvent -- C4 new frame kinds', () => {
    it('round-trips kind=decide action=silent with episodeId and messageId', async () => {
        const e = classifyStruggleEvent({ exerciseId: 5, kind: 'decide', action: 'silent', episodeId: 'ep-1', messageId: 42 });
        expect(e).toMatchObject({ exerciseId: 5, kind: 'decide', action: 'silent', episodeId: 'ep-1', messageId: 42 });
    });

    it('round-trips kind=confirm_close with all fields', async () => {
        const e = classifyStruggleEvent({
            exerciseId: 5, kind: 'confirm_close', episodeId: 'ep-1', resolved: true,
            closingSentence: 'Great job!', episodeLabel: 'Sort fixed', messageId: 99,
        });
        expect(e).toMatchObject({ kind: 'confirm_close', episodeId: 'ep-1', resolved: true, closingSentence: 'Great job!', episodeLabel: 'Sort fixed', messageId: 99 });
    });

    it('returns undefined for kind=confirm_close missing resolved', async () => {
        expect(classifyStruggleEvent({ exerciseId: 5, kind: 'confirm_close', episodeId: 'ep-1' })).toBeUndefined();
    });

    it('parses kind=decide action=ambient with episodeId (new-style)', async () => {
        const e = classifyStruggleEvent({ exerciseId: 5, kind: 'decide', action: 'ambient', episodeId: 'ep-2', message: 'Check bounds.', messageId: 88 });
        expect(e).toMatchObject({ kind: 'decide', action: 'ambient', episodeId: 'ep-2', message: 'Check bounds.', messageId: 88 });
    });
});

describe('subscribeStruggleEvents -- C4 new handler dispatch', () => {
    function makeSubscribe() {
        let onFrame: ((d: unknown) => void) | undefined;
        const subscribe = (_topic: string, f: (d: unknown) => void) => { onFrame = f; return { dispose() { /* noop */ } }; };
        return { subscribe, emit: (d: unknown) => onFrame!(d) };
    }

    it('dispatches kind=decide action=silent to onServerSilent with episodeId and messageId', async () => {
        const { subscribe, emit } = makeSubscribe();
        const onServerSilent = vi.fn();
        subscribeStruggleEvents(subscribe, {
            onServerAmbient: vi.fn(), onServerActive: vi.fn(),
            onServerSilent, onServerClose: vi.fn(),
        });
        emit({ exerciseId: 7, kind: 'decide', action: 'silent', episodeId: 'ep-silent', messageId: 11 });
        expect(onServerSilent).toHaveBeenCalledWith('ep-silent', 11, undefined, undefined);

        // A silent gate is the case the eval log could not explain, so confidence and the reason
        // have to reach the handler here just as they do on the ambient/active paths.
        emit({ exerciseId: 7, kind: 'decide', action: 'silent', episodeId: 'ep-q', confidence: 0.31, rationale: 'same diagnosis as the earlier hint' });
        expect(onServerSilent).toHaveBeenLastCalledWith('ep-q', undefined, 0.31, 'same diagnosis as the earlier hint');
    });

    it('dispatches kind=confirm_close to onServerClose', async () => {
        const { subscribe, emit } = makeSubscribe();
        const onServerClose = vi.fn();
        subscribeStruggleEvents(subscribe, {
            onServerAmbient: vi.fn(), onServerActive: vi.fn(),
            onServerSilent: vi.fn(), onServerClose,
        });
        emit({ exerciseId: 7, kind: 'confirm_close', episodeId: 'ep-close', resolved: true, episodeLabel: 'Sort done', messageId: 22 });
        expect(onServerClose).toHaveBeenCalledWith('ep-close', true, 22, undefined, 'Sort done');
    });

    it('still dispatches backwards-compat ambient/active frames', async () => {
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

describe('StruggleInterventionService -- C4 silent dispatch', () => {
    it('kind=decide action=silent with matching episodeId on FREE slot stays FREE and clears candidate', async () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-test');

        svc.onServerSilent('ep-test', undefined);

        expect(svc._slot.snapshot().state.kind).toBe('free');
        expect(svc._candidate).toBeUndefined();
        expect(svc._inFlightMarker).toBeUndefined();
    });

    it('kind=decide action=silent with mismatched episodeId is dropped (no slot change)', async () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-test');

        svc.onServerSilent('ep-OTHER', undefined);

        // in-flight marker must NOT be consumed (real reply may still arrive)
        expect(svc._inFlightMarker).toBeDefined();
        expect(svc._slot.snapshot().state.kind).toBe('free');
    });

    it('mismatched episodeId with messageId triggers postRemoveMessage', async () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-test');

        svc.onServerSilent('ep-OTHER', 42);

        expect(deps.postRemoveMessage).toHaveBeenCalledWith(42);
    });

    it('kind=decide action=silent with PARKED slot calls discardParkedToFree', async () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-parked');
        // Put slot in PARKED via ambient
        svc.onServerAmbient('ep-parked', 'Ambient hint.', undefined, undefined, undefined, undefined, null);
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
    it('DELIVERED resolved=true frees slot + calls setEpisodeOutcome(RECOVERED) + foldEpisode with praise', async () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDeliveredWithClosePending(svc, 'ep-close');

        svc.onServerClose('ep-close', true, 55, undefined, 'Well done!');

        expect(svc._slot.snapshot().state.kind).toBe('free');
        expect(deps.setEpisodeOutcome).toHaveBeenCalledWith(1, 'ep-close', 'RECOVERED');
        expect(deps.foldEpisode).toHaveBeenCalledWith('ep-close', 'RECOVERED', { episodeLabel: 'Well done!', closeMessageId: 55 });
    });

    it('DELIVERED resolved=true with no episodeLabel emits fold without praise', async () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDeliveredWithClosePending(svc, 'ep-close');

        svc.onServerClose('ep-close', true, undefined, undefined, undefined);

        // praise=undefined because both closeMessageId and episodeLabel are undefined
        expect(deps.foldEpisode).toHaveBeenCalledWith('ep-close', 'RECOVERED', undefined);
    });

    it('PARKED resolved=true calls discardParkedToFree: no message, no fold, no outcome', async () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateParkedWithClosePending(svc, 'ep-parked');

        svc.onServerClose('ep-parked', true, undefined, undefined, undefined);

        expect(svc._slot.snapshot().state.kind).toBe('free');
        expect(deps.foldEpisode).not.toHaveBeenCalled();
        // PARKED resolved=true: no outcome (discardParkedToFree, no RECOVERED)
        expect(deps.setEpisodeOutcome).not.toHaveBeenCalled();
    });

    it('PARKED resolved=false stays PARKED', async () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateParkedWithClosePending(svc, 'ep-parked');

        svc.onServerClose('ep-parked', false, undefined, undefined, undefined);

        expect(svc._slot.snapshot().state.kind).toBe('parked');
        expect(deps.foldEpisode).not.toHaveBeenCalled();
    });

    it('confirmClose with mismatched episodeId is dropped + triggers postRemoveMessage', async () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDeliveredWithClosePending(svc, 'ep-close');

        svc.onServerClose('ep-WRONG', true, 77, undefined, 'Close sentence');

        expect(svc._slot.snapshot().state.kind).toBe('delivered');
        expect(deps.postRemoveMessage).toHaveBeenCalledWith(77);
        // Marker NOT consumed (real reply may still arrive)
        expect(svc._inFlightMarker).toBeDefined();
    });
});

describe('active surface: bubble ordering against the conversation open', () => {
    /**
     * A bubble emitted while another conversation is still installed is attributed
     * to THAT one, so the student sees the hint in the wrong chat or not at all.
     * The bubble therefore waits for the open.
     */
    it('posts the bubble only after the target conversation has opened', async () => {
        let openTargetConversation!: () => void;
        const openSession = vi.fn().mockReturnValue(new Promise<void>(r => { openTargetConversation = r; }));
        const deps = makeDeps({ openSession });
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);

        svc.onServerActive('ep-test', 42, undefined, undefined, undefined, undefined, 'Hint.', 556);
        await Promise.resolve();

        expect(openSession).toHaveBeenCalledWith(100, 42);
        expect(deps.postBubble).not.toHaveBeenCalled();

        openTargetConversation();
        await Promise.resolve();
        await Promise.resolve();

        expect(deps.postBubble).toHaveBeenCalledWith('Hint.', 556, 'ep-test');
    });

    it('still posts the bubble when the conversation fails to open, rather than swallowing the hint', async () => {
        const openSession = vi.fn().mockRejectedValue(new Error('offline'));
        const deps = makeDeps({ openSession });
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);

        svc.onServerActive('ep-test', 42, undefined, undefined, undefined, undefined, 'Hint.', 556);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(deps.postBubble).toHaveBeenCalledWith('Hint.', 556, 'ep-test');
    });
});
