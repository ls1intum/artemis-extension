import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { LiveDecisionTrace, StruggleDebugSnapshot } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import { createMockVsCodeApi, dispatchExtensionMessage, getPostMessageCalls } from '@test/react/__helpers__/vscodeApi';
import { StruggleDetectionView } from '@webview/views/StruggleDetection/StruggleDetectionView';

function trace(over: Partial<LiveDecisionTrace> = {}): LiveDecisionTrace {
    return {
        outcome: 'suppressed', reason: 'cooldown', discreteTrigger: null,
        urgency: 0.8, theta: 0.7, typingRate: 0, boundariesPresent: ['STATE'],
        secondsSinceLastAlert: 30, inWarmup: false, graceActive: false,
        gates: { fluentTyping: false, grace: false, warmup: false, belowThreshold: false, cooldown: true, notRearmed: true },
        ...over,
    };
}

function debugSnapshot(over: Partial<StruggleDebugSnapshot> = {}): StruggleDebugSnapshot {
    return {
        sessionActive: true, nowMs: 1000, sessionStartMs: 0, lastAlertMs: null, lastFmBadMs: null,
        throttle: null, fN2Active: false, effectiveWindowS: 60, longestGapS: 10, decisionTrace: trace(),
        caps: { warmupS: 480, cooldownS: 120, graceS: 32.94, minDeliveryGapS: 30, maxAlertsPerMinute: 2, maxAlertsPerSession: 6, n2MinActiveS: 60, gapNormS: 40 },
        ...over,
    };
}

function init(over: Record<string, unknown> = {}) {
    return {
        type: ExtensionMsg.StruggleDetectionInit,
        urgency: 0.3, isEnabled: true,
        developerMode: true, debug: debugSnapshot(), embedded: false,
        ...over,
    };
}

describe('StruggleDetectionView', () => {
    it('renders the decision-flow pipeline at the top in developer mode', () => {
        const api = createMockVsCodeApi();
        render(<StruggleDetectionView vscodeApi={api} />);
        act(() => dispatchExtensionMessage(init()));
        expect(screen.getByText('Decision flow')).toBeInTheDocument();
    });

    it('shows a no-session state in the Urgency card instead of a calm green 0.00 when no session is active', () => {
        const api = createMockVsCodeApi();
        render(<StruggleDetectionView vscodeApi={api} />);
        act(() => dispatchExtensionMessage(init({
            urgency: 0,
            debug: debugSnapshot({ sessionActive: false, decisionTrace: null }),
        })));
        expect(screen.getByText(/the score appears once it ticks/i)).toBeInTheDocument();
        expect(screen.queryByText('Below alert threshold')).not.toBeInTheDocument();
        expect(screen.queryByText('At or above alert threshold')).not.toBeInTheDocument();
    });

    it('removes the legacy Status card (struggling / S / V / boundary / last alert)', () => {
        const api = createMockVsCodeApi();
        render(<StruggleDetectionView vscodeApi={api} />);
        act(() => dispatchExtensionMessage(init()));
        expect(screen.queryByText('Currently struggling')).not.toBeInTheDocument();
        expect(screen.queryByText('Boundary at last tick')).not.toBeInTheDocument();
    });

    it('shows a developer-only notice when not in developer mode', () => {
        const api = createMockVsCodeApi();
        render(<StruggleDetectionView vscodeApi={api} />);
        act(() => dispatchExtensionMessage(init({ developerMode: false, debug: undefined })));
        expect(screen.getByText(/only available in developer mode/i)).toBeInTheDocument();
        expect(screen.queryByText('Decision flow')).not.toBeInTheDocument();
    });

    it('shows the "Open in Editor" pop-out button in developer mode and posts toggleStruggleFullscreen', () => {
        const api = createMockVsCodeApi();
        render(<StruggleDetectionView vscodeApi={api} />);
        act(() => dispatchExtensionMessage(init()));
        const btn = screen.getByTitle('Open in Editor');
        fireEvent.click(btn);
        const sent = getPostMessageCalls(api).map(c => c[0]);
        expect(sent).toContainEqual(expect.objectContaining({ type: 'command', command: 'toggleStruggleFullscreen' }));
    });

    it('hides the pop-out button when developer mode is off', () => {
        const api = createMockVsCodeApi();
        render(<StruggleDetectionView vscodeApi={api} />);
        act(() => dispatchExtensionMessage(init({ developerMode: false, debug: undefined })));
        expect(screen.queryByTitle('Open in Editor')).not.toBeInTheDocument();
    });

    it('embedded copy hides the back-link, pop-out button and live chart but keeps the pipeline and timers', () => {
        const api = createMockVsCodeApi();
        render(<StruggleDetectionView vscodeApi={api} />);
        act(() => dispatchExtensionMessage(init({ embedded: true })));
        expect(screen.queryByText('Back to Dashboard')).not.toBeInTheDocument();
        expect(screen.queryByTitle('Open in Editor')).not.toBeInTheDocument();
        expect(screen.queryByText(/Live Engine View/i)).not.toBeInTheDocument();
        expect(screen.getByText('Decision flow')).toBeInTheDocument();   // pipeline fed by init data
        expect(screen.getByText(/Engine timers/i)).toBeInTheDocument();
    });
});
