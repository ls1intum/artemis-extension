import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LiveDecisionTrace, StruggleDebugSnapshot } from '@shared/messageContracts';

import { TimersPanel } from '@webview/views/StruggleDetection/TimersPanel';

const BASE = 1_700_000_000_000;

function trace(over: Partial<LiveDecisionTrace> = {}): LiveDecisionTrace {
    return {
        outcome: 'suppressed', reason: 'no-candidate', discreteTrigger: null,
        urgency: 0.3, theta: 0.7, typingRate: 30, boundariesPresent: [],
        secondsSinceLastAlert: null, inWarmup: false, graceActive: false,
        gates: { fluentTyping: false, grace: false, warmup: false, belowThreshold: false, cooldown: false, notRearmed: false },
        ...over,
    };
}

function snapshot(over: Partial<StruggleDebugSnapshot> = {}): StruggleDebugSnapshot {
    return {
        sessionActive: true,
        nowMs: BASE,
        sessionStartMs: BASE - 100_000,   // 100 s elapsed
        lastAlertMs: null,
        lastFmBadMs: null,
        throttle: null,
        fN2Active: false,
        effectiveWindowS: 60,
        longestGapS: 18,
        decisionTrace: null,
        testStagnation: null,
        caps: {
            warmupS: 480,
            cooldownS: 120,
            graceS: 32.94,
            minDeliveryGapS: 30,
            maxAlertsPerMinute: 2,
            maxAlertsPerSession: 6,
            n2MinActiveS: 60,
            gapNormS: 40,
        },
        ...over,
    };
}

describe('TimersPanel', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(BASE);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders the three groups', () => {
        render(<TimersPanel debug={snapshot()} />);
        expect(screen.getByText('Countdowns')).toBeInTheDocument();
        expect(screen.getByText('Hints delivered')).toBeInTheDocument();
        expect(screen.getByText('Signals (last tick)')).toBeInTheDocument();
    });

    it('shows a "no active session" empty state instead of bogus timers when inactive', () => {
        render(<TimersPanel debug={snapshot({ sessionActive: false, sessionStartMs: 0, nowMs: BASE })} />);
        expect(screen.getByText(/No active exercise session/i)).toBeInTheDocument();
        expect(screen.queryByText('Countdowns')).not.toBeInTheDocument();
    });

    it('derives the warm-up countdown from session start (480 − 100 = 6:20)', () => {
        render(<TimersPanel debug={snapshot()} />);
        expect(screen.getByText('6:20')).toBeInTheDocument();
    });

    it('advances the countdown by the local 1 s clock between snapshots', () => {
        render(<TimersPanel debug={snapshot()} />);
        expect(screen.getByText('6:20')).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(5_000); });
        expect(screen.getByText('6:15')).toBeInTheDocument();
    });

    it('shows "no alert yet" for the cooldown when none has fired', () => {
        render(<TimersPanel debug={snapshot({ lastAlertMs: null })} />);
        expect(screen.getByText('no alert yet')).toBeInTheDocument();
    });

    it('derives the cooldown countdown from lastAlertMs (120 − 30 = 1:30)', () => {
        render(<TimersPanel debug={snapshot({ lastAlertMs: BASE - 30_000 })} />);
        expect(screen.getByText('1:30')).toBeInTheDocument();
    });

    it('shows the grace remaining when a bad build armed it (~33 − 10 = 23s)', () => {
        render(<TimersPanel debug={snapshot({ lastFmBadMs: BASE - 10_000 })} />);
        expect(screen.getByText('23s')).toBeInTheDocument();
    });

    it('renders the delivery counters and last-delivered time from the throttle state', () => {
        render(<TimersPanel debug={snapshot({
            throttle: { deliveredThisSession: 2, deliveredAtMs: [BASE - 5_000], lastDeliveryMs: BASE - 5_000 },
        })} />);
        expect(screen.getByText('2 / 6')).toBeInTheDocument();   // session
        expect(screen.getByText('1 / 2')).toBeInTheDocument();   // last minute (one delivery in window)
        expect(screen.getByText('at 1:35')).toBeInTheDocument(); // delivered 95 s into the session
    });

    it('shows n/a counters and "none yet" for last-delivered when the sink exposes no throttle state', () => {
        render(<TimersPanel debug={snapshot({ throttle: null })} />);
        expect(screen.getAllByText('n/a').length).toBeGreaterThanOrEqual(2);
        expect(screen.getByText('none yet')).toBeInTheDocument();
    });

    it('renders the off-screen-error and re-arm metrics in plain language (no codes)', () => {
        render(<TimersPanel debug={snapshot({ fN2Active: true, decisionTrace: trace({ gates: { fluentTyping: false, grace: false, warmup: false, belowThreshold: false, cooldown: false, notRearmed: true } }) })} />);
        expect(screen.getByText('active')).toBeInTheDocument();
        expect(screen.getByText('waiting')).toBeInTheDocument();   // re-arm pending (was "gated")
        expect(screen.queryByText('gated')).not.toBeInTheDocument();
    });

    it('shows "waiting for first tick" for re-arm before the first tick arrives', () => {
        render(<TimersPanel debug={snapshot({ decisionTrace: null })} />);
        expect(screen.getByText('waiting for first tick')).toBeInTheDocument();
    });

    it('renders the typing rate from the latest trace, rounded, with the fluent threshold as context', () => {
        render(<TimersPanel debug={snapshot({ decisionTrace: trace({ typingRate: 12.4 }) })} />);
        expect(screen.getByText('12/min')).toBeInTheDocument();
        expect(screen.getByText('(fluent ≥ 20/min)')).toBeInTheDocument();
    });

    it('renders the typing-rate row with n/a before the first tick (the row itself stays visible)', () => {
        render(<TimersPanel debug={snapshot({ decisionTrace: null })} />);
        expect(screen.getByText('Typing rate')).toBeInTheDocument();
        expect(screen.getByText('(fluent ≥ 20/min)')).toBeInTheDocument();
    });

    it('renders the test-stagnation streak when enabled, and its disabled/inactive fallbacks', () => {
        const { rerender } = render(<TimersPanel debug={snapshot({ testStagnation: { enabled: true, streak: 2, n: 3 } })} />);
        expect(screen.getByText('2 / 3 builds without progress')).toBeInTheDocument();

        rerender(<TimersPanel debug={snapshot({ testStagnation: { enabled: false, streak: 0, n: 3 } })} />);
        expect(screen.getByText('disabled')).toBeInTheDocument();
        expect(screen.queryByText(/builds without progress/)).not.toBeInTheDocument();

        rerender(<TimersPanel debug={snapshot({ testStagnation: null })} />);
        expect(screen.queryByText(/builds without progress/)).not.toBeInTheDocument();
        expect(screen.queryByText('disabled')).not.toBeInTheDocument();
    });
});
