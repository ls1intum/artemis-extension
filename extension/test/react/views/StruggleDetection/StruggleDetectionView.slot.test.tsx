import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { LiveDecisionTrace, SlotDebugSnapshot, StruggleDebugSnapshot } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import { createMockVsCodeApi, dispatchExtensionMessage } from '@test/react/__helpers__/vscodeApi';
import { StruggleDetectionView } from '@webview/views/StruggleDetection/StruggleDetectionView';

// ---------------------------------------------------------------------------
// Fixtures (mirrored from StruggleDetectionView.test.tsx)
// ---------------------------------------------------------------------------

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

const FREE_SNAPSHOT: SlotDebugSnapshot = {
    nowMs: 1_000_000,
    state: 'free',
    level: null,
    episodeId: null,
    generation: 0,
    episodeAgeMs: null,
    hintCount: 0,
    isNew: false,
    inSession: false,
    watchdog: { armed: false, staleDeadlineMs: null },
    abandon: { armed: false, deadlineMs: null },
    inFlight: null,
    owed: { confirmClose: false, staleCheck: false },
    pendingOutcomes: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StruggleDetectionView - slot and episode panels', () => {
    it('mounts both Slot and Episodes panels when developerMode:true and not embedded', () => {
        const api = createMockVsCodeApi();
        render(<StruggleDetectionView vscodeApi={api} />);
        act(() => dispatchExtensionMessage(init()));
        act(() => dispatchExtensionMessage({
            type: 'struggleSlotUpdate',
            snapshot: FREE_SNAPSHOT,
            episodes: [],
        }));
        expect(screen.getByText('Slot (live)')).toBeInTheDocument();
        expect(screen.getByText('Episodes (this session)')).toBeInTheDocument();
    });

    it('renders the live panels when embedded:true (sender-aware feed)', () => {
        const api = createMockVsCodeApi();
        render(<StruggleDetectionView vscodeApi={api} />);
        act(() => dispatchExtensionMessage(init({ embedded: true })));
        expect(screen.getByText('Slot (live)')).toBeInTheDocument();
        expect(screen.getByText('Episodes (this session)')).toBeInTheDocument();
        expect(screen.getByText(/Live Engine View/i)).toBeInTheDocument();
    });

    it('hides both panels when developerMode:false', () => {
        const api = createMockVsCodeApi();
        render(<StruggleDetectionView vscodeApi={api} />);
        act(() => dispatchExtensionMessage(init({ developerMode: false, debug: undefined })));
        expect(screen.queryByText('Slot (live)')).not.toBeInTheDocument();
        expect(screen.queryByText('Episodes (this session)')).not.toBeInTheDocument();
    });

    it('renders the Urgency section header as a collapsible button', () => {
        const api = createMockVsCodeApi();
        render(<StruggleDetectionView vscodeApi={api} />);
        act(() => dispatchExtensionMessage(init()));
        expect(screen.getByRole('button', { name: /Urgency/ })).toBeInTheDocument();
    });
});
