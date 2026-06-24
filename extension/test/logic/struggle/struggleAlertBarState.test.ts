import { computeAlertBarState } from '@extension/services/ui/struggleAlertBarState';

const BASE_TRACE = {
    outcome: 'suppressed', reason: 'no-candidate', discreteTrigger: null,
    urgency: 0.4, theta: 0.7, typingRate: 0, boundariesPresent: [],
    secondsSinceLastAlert: null, inWarmup: false, graceActive: false,
};

function fakeTick(over: any = {}, traceOver: any = {}): any {
    return {
        t: 10, ts: 10000, sBase: 0.4, s: 0.4, v: 0.3, fastDecay: false,
        boundariesPreGate: [], alert: null,
        ...over,
        decisionTrace: { ...BASE_TRACE, ...traceOver },
    };
}

test('firing when a real alert is present', () => {
    const s = computeAlertBarState(fakeTick({ sBase: 0.9, alert: { kind: 'edit' } }, { reason: 'fired', urgency: 0.9 }));
    expect(s.kind).toBe('firing');
});

test('gated when urgency >= theta and a suppressing gate is the reason', () => {
    const s = computeAlertBarState(fakeTick({ sBase: 0.8 }, { reason: 'cooldown', urgency: 0.8 }));
    expect(s.kind).toBe('gated');
    expect(s.gateReason).toBe('cooldown');
});

test('armed when a gate is the reason but urgency is below threshold', () => {
    // Fluent-typing suppresses before the threshold check, so urgency can be low.
    const s = computeAlertBarState(fakeTick({ sBase: 0.5 }, { reason: 'b2-fluent-typing', urgency: 0.5 }));
    expect(s.kind).toBe('armed');
});

test('armed for below-threshold and no-candidate (not would-fire)', () => {
    expect(computeAlertBarState(fakeTick({ sBase: 0.5 }, { reason: 'below-threshold' })).kind).toBe('armed');
    expect(computeAlertBarState(fakeTick({ sBase: 0.9 }, { reason: 'no-candidate' })).kind).toBe('armed');
});

test('a real alert wins even at high urgency with a fired reason', () => {
    const s = computeAlertBarState(fakeTick({ sBase: 0.95, alert: { kind: 'discrete' } }, { reason: 'fired', urgency: 0.95 }));
    expect(s.kind).toBe('firing');
});
