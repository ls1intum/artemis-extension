import { describe, expect, it, vi } from 'vitest';

import { classifyStruggleEvent, subscribeStruggleEvents } from '@extension/services/struggleIntervention/struggleEventSubscription';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';
import type { StruggleInterventionDeps } from '@extension/services/struggleIntervention/struggleInterventionService';
import type { InterventionEventLog } from '@extension/services/struggleIntervention/interventionEventLog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<StruggleInterventionDeps> = {}): StruggleInterventionDeps {
    return {
        isEgressEnabled: vi.fn().mockReturnValue(true),
        hasNoaiMarker: vi.fn().mockReturnValue(false),
        getExerciseId: vi.fn().mockReturnValue(1),
        getExerciseRoot: vi.fn().mockReturnValue(undefined),
        collectFiles: vi.fn().mockResolvedValue({}),
        postIntervention: vi.fn().mockResolvedValue('accepted'),
        openSession: vi.fn().mockResolvedValue(undefined),
        showAmbient: vi.fn(),
        clearLamp: vi.fn(),
        showInline: vi.fn(),
        clearInline: vi.fn(),
        isAnchorLive: vi.fn().mockReturnValue(false),
        isStudentProactiveOn: vi.fn().mockReturnValue(true),
        softThreshold: 4,
        pauseStrikes: 3,
        setBadge: vi.fn(),
        showActiveNotification: vi.fn(),
        showLamp: vi.fn(),
        showGutterOnly: vi.fn(),
        postBubble: vi.fn(),
        log: { record: vi.fn().mockResolvedValue(undefined) } as unknown as InterventionEventLog,
        setTimeoutFn: (_fn: () => void, _ms: number) => { /* deterministic noop */ },
        // C2 reveal deps (no-ops for these tests)
        generateLocalId: () => 'test-local-id',
        postRevealBubble: vi.fn(),
        reconcileOptimisticBubble: vi.fn(),
        revealAmbient: vi.fn(async () => ({ id: 1, sentAt: 'T' })),
        setEpisodeOutcome: vi.fn(async () => ({ applied: true })),
        ...overrides,
    };
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
        subscribeStruggleEvents(subscribe, { onServerAmbient, onServerActive });

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
    it('onServerAmbient with live anchor: showGutterOnly + badge + lamp; never showInline, never toast, never bubble', () => {
        const deps = makeDeps({ isAnchorLive: vi.fn().mockReturnValue(true) });
        const svc = new StruggleInterventionService(deps);

        svc.onServerAmbient('Try checking bounds.', 'Sort.java', 10, 'off-by-one?');

        expect(deps.showGutterOnly).toHaveBeenCalledWith('Sort.java', 10);
        expect(deps.setBadge).toHaveBeenCalledWith(true);
        expect(deps.showLamp).toHaveBeenCalled();
        // Must NOT show inline text, toast, or bubble:
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.showActiveNotification).not.toHaveBeenCalled();
        expect(deps.postBubble).not.toHaveBeenCalled();
    });

    it('onServerAmbient without live anchor: badge + lamp only; no gutter-only, no inline', () => {
        const deps = makeDeps({ isAnchorLive: vi.fn().mockReturnValue(false) });
        const svc = new StruggleInterventionService(deps);

        svc.onServerAmbient('Try checking bounds.', undefined, undefined, undefined);

        expect(deps.showLamp).toHaveBeenCalled();
        expect(deps.setBadge).toHaveBeenCalledWith(true);
        expect(deps.showGutterOnly).not.toHaveBeenCalled();
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.postBubble).not.toHaveBeenCalled();
    });

    it('onServerActive posts optimistic bubble tagged with messageId + inline + toast + badge + hides lamp', () => {
        const deps = makeDeps({ isAnchorLive: vi.fn().mockReturnValue(true) });
        const svc = new StruggleInterventionService(deps);

        svc.onServerActive(42, 'Sort.java', 10, 'off-by-one?', undefined, 'Try checking array bounds.', 556);

        // Optimistic bubble with messageId for dedup
        expect(deps.postBubble).toHaveBeenCalledWith('Try checking array bounds.', 556);
        // Inline breadcrumb at the live anchor (4th arg = message ?? inlineHint, so message wins when provided)
        expect(deps.showInline).toHaveBeenCalledWith('Sort.java', 10, 'off-by-one?', 'Try checking array bounds.');
        // Toast notification
        expect(deps.showActiveNotification).toHaveBeenCalled();
        // Badge
        expect(deps.setBadge).toHaveBeenCalledWith(true);
        // Lamp hidden (active surface takes over)
        expect(deps.clearLamp).toHaveBeenCalled();
        // Ambient lamp must NOT be shown for active
        expect(deps.showLamp).not.toHaveBeenCalled();
    });

    it('onServerActive with messageId=null posts runtime-only fallback bubble and still proceeds', () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);

        svc.onServerActive(42, undefined, undefined, undefined, undefined, 'Try checking bounds.', null);

        // Fallback bubble with null id (runtime-only, no dedup tag)
        expect(deps.postBubble).toHaveBeenCalledWith('Try checking bounds.', null);
        expect(deps.showActiveNotification).toHaveBeenCalled();
        expect(deps.clearLamp).toHaveBeenCalled();
    });

    it('onServerActive with undefined message falls back to a default bubble text', () => {
        const deps = makeDeps();
        const svc = new StruggleInterventionService(deps);

        svc.onServerActive(42, undefined, undefined, undefined, undefined, undefined, 123);

        // postBubble still called even if message is undefined
        expect(deps.postBubble).toHaveBeenCalled();
        const [calledText, calledId] = (deps.postBubble as ReturnType<typeof vi.fn>).mock.calls[0] as [string, number];
        expect(typeof calledText).toBe('string');
        expect(calledText.length).toBeGreaterThan(0);
        expect(calledId).toBe(123);
    });

    it('applyEscalation(inSession=true) posts quiet bubble and suppresses toast + inline', () => {
        const deps = makeDeps({ isAnchorLive: vi.fn().mockReturnValue(true) });
        const svc = new StruggleInterventionService(deps);

        svc.applyEscalation(true, 'Check the loop bounds.', 'Sort.java', 10, 'off-by-one?', 789);

        expect(deps.postBubble).toHaveBeenCalledWith('Check the loop bounds.', 789);
        expect(deps.showActiveNotification).not.toHaveBeenCalled();
        expect(deps.showInline).not.toHaveBeenCalled();
    });

    it('applyEscalation(inSession=false) fires toast + inline push', () => {
        const deps = makeDeps({ isAnchorLive: vi.fn().mockReturnValue(true) });
        const svc = new StruggleInterventionService(deps);

        svc.applyEscalation(false, 'Check the loop bounds.', 'Sort.java', 10, 'off-by-one?', 789);

        expect(deps.postBubble).toHaveBeenCalledWith('Check the loop bounds.', 789);
        expect(deps.showActiveNotification).toHaveBeenCalled();
        expect(deps.showInline).toHaveBeenCalledWith('Sort.java', 10, 'off-by-one?', 'Check the loop bounds.');
    });

    it('applyEscalation(inSession=false) without live anchor: toast but no inline push', () => {
        const deps = makeDeps({ isAnchorLive: vi.fn().mockReturnValue(false) });
        const svc = new StruggleInterventionService(deps);

        svc.applyEscalation(false, 'Check the loop bounds.', 'Sort.java', 10, 'off-by-one?', null);

        expect(deps.postBubble).toHaveBeenCalledWith('Check the loop bounds.', null);
        expect(deps.showActiveNotification).toHaveBeenCalled();
        expect(deps.showInline).not.toHaveBeenCalled();
    });
});
