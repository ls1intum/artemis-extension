import { computeAlertBarState, formatAlertBar } from '@extension/services/ui/struggleAlertBarState';

const BASE_TRACE = {
    outcome: 'suppressed', reason: 'no-candidate', discreteTrigger: null,
    urgency: 0.4, theta: 0.7, typingRate: 0, boundariesPresent: [],
    secondsSinceLastAlert: null, inWarmup: false, graceActive: false,
};

function fakeTick(over: any = {}, traceOver: any = {}): any {
    return {
        t: 10, ts: 10000, sBase: 0.4, s: 0.4,
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

test('formatAlertBar: armed shows the tick-time warm-up countdown while remaining > 0', () => {
    const d = formatAlertBar({ kind: 'armed', urgency: 0.4, theta: 0.7 }, 470);
    expect(d.text).toBe('$(pulse) Struggle: warm-up 7:50');
    expect(d.background).toBeNull();
    expect(d.tooltip).toContain('warming up');
    expect(d.tooltip).toContain('7:50 remaining');
});

test('formatAlertBar: armed shows urgency (no warm-up) when not in warm-up (null)', () => {
    const d = formatAlertBar({ kind: 'armed', urgency: 0.42, theta: 0.7 }, null);
    expect(d.text).toBe('$(pulse) Struggle: 0.42');
    expect(d.tooltip).not.toContain('warm-up');
});

test('formatAlertBar: armed keeps the warm-up readout on the final warm-up tick (remaining 0, still in warm-up)', () => {
    // Engine gate is t <= warmupS, so the last warm-up tick has remaining 0 but is still in warm-up.
    const d = formatAlertBar({ kind: 'armed', urgency: 0.42, theta: 0.7 }, 0);
    expect(d.text).toBe('$(pulse) Struggle: warm-up 0:00');
});

test('formatAlertBar: firing text is never altered by warm-up, but the tooltip notes it', () => {
    const d = formatAlertBar({ kind: 'firing', urgency: 0.9, theta: 0.7 }, 300);
    expect(d.text).toBe('$(megaphone) Struggle alert');
    expect(d.background).toBe('error');
    expect(d.tooltip).toContain('Warm-up: 5:00 remaining');
});

test('formatAlertBar: gated text is never altered by warm-up; tooltip names the gate', () => {
    const d = formatAlertBar({ kind: 'gated', urgency: 0.8, theta: 0.7, gateReason: 'cooldown' }, 120);
    expect(d.text).toBe('$(shield) Alert gated: cooldown');
    expect(d.background).toBe('warning');
    expect(d.tooltip).toContain('cooldown gate');
    expect(d.tooltip).toContain('Warm-up: 2:00 remaining');
});

test('formatAlertBar: the warm-up countdown ceils and zero-pads seconds', () => {
    expect(formatAlertBar({ kind: 'armed', urgency: 0.4, theta: 0.7 }, 65.2).text).toBe('$(pulse) Struggle: warm-up 1:06');
});
