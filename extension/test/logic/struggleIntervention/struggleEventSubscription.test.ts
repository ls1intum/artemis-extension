import { describe, expect, it, vi } from 'vitest';

import { classifyStruggleEvent, subscribeStruggleEvents } from '@extension/services/struggleIntervention/struggleEventSubscription';

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
    it('returns undefined for malformed / non-struggle frames', () => {
        expect(classifyStruggleEvent({ foo: 1 })).toBeUndefined();
        expect(classifyStruggleEvent(null)).toBeUndefined();
        expect(classifyStruggleEvent({ exerciseId: 42, action: 'silent' })).toBeUndefined();
        expect(classifyStruggleEvent({ exerciseId: 42, action: 'active' })).toBeUndefined();
    });
});

describe('subscribeStruggleEvents dispatch', () => {
    it('threads exerciseId through to the ambient/active handlers (for stale-frame filtering)', () => {
        let onFrame: ((d: unknown) => void) | undefined;
        const subscribe = (_topic: string, f: (d: unknown) => void) => { onFrame = f; return { dispose() { /* noop */ } }; };
        const onServerAmbient = vi.fn();
        const onServerActive = vi.fn();
        subscribeStruggleEvents(subscribe, { onServerAmbient, onServerActive });

        onFrame!({ exerciseId: 42, action: 'ambient', message: 'Re-check the logic.' });
        expect(onServerAmbient).toHaveBeenCalledWith(42, 'Re-check the logic.', undefined);

        onFrame!({ exerciseId: 99, action: 'active', sessionId: 7, confidence: 0.5 });
        expect(onServerActive).toHaveBeenCalledWith(99, 7, 0.5);
    });
});
