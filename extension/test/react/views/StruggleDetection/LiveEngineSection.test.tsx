import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LiveDecisionTrace, LiveTick, VsCodeApi } from '@shared/messageContracts';

import { createMockVsCodeApi, dispatchExtensionMessage } from '@test/react/__helpers__/vscodeApi';
import { LiveEngineSection } from '@webview/views/StruggleDetection/LiveEngineSection';

// ---------------------------------------------------------------------------
// Fixtures — minimal LiveTick / LiveDecisionTrace builders.
// ---------------------------------------------------------------------------

function makeTrace(overrides: Partial<LiveDecisionTrace> = {}): LiveDecisionTrace {
    return {
        outcome: 'suppressed',
        reason: 'no-candidate',
        discreteTrigger: null,
        urgency: 0.2,
        theta: 0.7,
        typingRate: 40,
        boundariesPresent: [],
        secondsSinceLastAlert: null,
        inWarmup: false,
        graceActive: false,
        ...overrides,
    };
}

interface TickOverrides {
    reason?: LiveDecisionTrace['reason'];
    outcome?: LiveDecisionTrace['outcome'];
    discreteTrigger?: LiveDecisionTrace['discreteTrigger'];
    boundariesPreGate?: LiveTick['boundariesPreGate'];
    alertKind?: LiveTick['alertKind'];
    urgency?: number;
    inWarmup?: boolean;
    graceActive?: boolean;
    secondsSinceLastAlert?: number | null;
}

function makeTick(t: number, o: TickOverrides = {}): LiveTick {
    const urgency = o.urgency ?? 0.2;
    return {
        t,
        urgency,
        s: urgency,
        v: urgency,
        theta: 0.7,
        boundariesPreGate: o.boundariesPreGate ?? [],
        alertKind: o.alertKind ?? null,
        alertPrimary: null,
        decisionTrace: makeTrace({
            outcome: o.outcome ?? 'suppressed',
            reason: o.reason ?? 'no-candidate',
            discreteTrigger: o.discreteTrigger ?? null,
            urgency,
            inWarmup: o.inWarmup ?? false,
            graceActive: o.graceActive ?? false,
            secondsSinceLastAlert: o.secondsSinceLastAlert ?? null,
        }),
    };
}

/** Convenience accessor for the commands posted via postCommand. */
function postedCommands(api: VsCodeApi): string[] {
    return (api.postMessage as ReturnType<typeof import('vitest').vi.fn>).mock.calls
        .map((c) => c[0])
        .filter((m): m is { type: 'command'; command: string } =>
            typeof m === 'object' && m !== null && (m as { type?: string }).type === 'command')
        .map((m) => m.command);
}

describe('LiveEngineSection', () => {
    it('renders the plain-language gate explanation for the latest tick', () => {
        const api = createMockVsCodeApi();
        render(<LiveEngineSection vscodeApi={api} />);
        act(() => dispatchExtensionMessage({
            type: 'struggleLiveBackfill',
            ticks: [makeTick(20, { reason: 'b2-fluent-typing' })],
        }));
        // Spelled-out primary text present. A small secondary "B2" badge is
        // allowed (spec) — do NOT assert its absence.
        expect(screen.getByText(/typing fluently/i)).toBeInTheDocument();
    });

    it('names the discrete trigger in plain language', () => {
        const api = createMockVsCodeApi();
        render(<LiveEngineSection vscodeApi={api} />);
        act(() => dispatchExtensionMessage({
            type: 'struggleLiveTick',
            tick: makeTick(30, { outcome: 'fired-discrete', discreteTrigger: 'test-stagnation' }),
        }));
        expect(screen.getByText(/tests are stuck/i)).toBeInTheDocument();
    });

    it('appends streamed ticks and clears on StruggleLiveReset', () => {
        const api = createMockVsCodeApi();
        render(<LiveEngineSection vscodeApi={api} />);
        act(() => dispatchExtensionMessage({ type: 'struggleLiveTick', tick: makeTick(10) }));
        act(() => dispatchExtensionMessage({ type: 'struggleLiveTick', tick: makeTick(20) }));
        expect(screen.getByTestId('live-tick-count')).toHaveTextContent('2');
        act(() => dispatchExtensionMessage({ type: 'struggleLiveReset' }));
        expect(screen.getByTestId('live-tick-count')).toHaveTextContent('0');
    });

    it('sets the array on StruggleLiveBackfill (replacing prior ticks)', () => {
        const api = createMockVsCodeApi();
        render(<LiveEngineSection vscodeApi={api} />);
        act(() => dispatchExtensionMessage({ type: 'struggleLiveTick', tick: makeTick(10) }));
        act(() => dispatchExtensionMessage({
            type: 'struggleLiveBackfill',
            ticks: [makeTick(1), makeTick(2), makeTick(3)],
        }));
        expect(screen.getByTestId('live-tick-count')).toHaveTextContent('3');
    });

    it('posts struggleLiveSubscribe on mount and struggleLiveUnsubscribe on unmount', () => {
        const api = createMockVsCodeApi();
        const { unmount } = render(<LiveEngineSection vscodeApi={api} />);
        expect(postedCommands(api)).toContain('struggleLiveSubscribe');
        unmount();
        expect(postedCommands(api)).toContain('struggleLiveUnsubscribe');
    });

    it('renders active boundaries via their spelled-out glossary text', () => {
        const api = createMockVsCodeApi();
        render(<LiveEngineSection vscodeApi={api} />);
        act(() => dispatchExtensionMessage({
            type: 'struggleLiveTick',
            tick: makeTick(40, { boundariesPreGate: ['FM'], reason: 'b4-grace-filter' }),
        }));
        expect(screen.getByText(/A build or test run just failed/i)).toBeInTheDocument();
    });

    it('renders the chart with data without emitting recharts size warnings', () => {
        // Locks in the pristine-output guarantee: under happy-dom the chart
        // container measures 0, so a regression to ResponsiveContainer (or a
        // 0-width chart) would log recharts width/height warnings here.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const api = createMockVsCodeApi();
            render(<LiveEngineSection vscodeApi={api} />);
            act(() => dispatchExtensionMessage({
                type: 'struggleLiveBackfill',
                ticks: [makeTick(10, { urgency: 0.3 }), makeTick(20, { urgency: 0.8, boundariesPreGate: ['FM'], alertKind: 'edit' })],
            }));
            expect(warn).not.toHaveBeenCalled();
            expect(error).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
            error.mockRestore();
        }
    });
});
