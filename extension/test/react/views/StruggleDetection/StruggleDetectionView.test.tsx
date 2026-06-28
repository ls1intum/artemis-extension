import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { StruggleDebugSnapshot } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import { createMockVsCodeApi, dispatchExtensionMessage, getPostMessageCalls } from '@test/react/__helpers__/vscodeApi';
import { StruggleDetectionView } from '@webview/views/StruggleDetection/StruggleDetectionView';

function debugSnapshot(over: Partial<StruggleDebugSnapshot> = {}): StruggleDebugSnapshot {
    return {
        sessionActive: true, nowMs: 1000, sessionStartMs: 0, lastAlertMs: null, lastFmBadMs: null,
        throttle: null, fN2Active: false, effectiveWindowS: 60, longestGapS: 10, notRearmed: false,
        caps: { warmupS: 480, cooldownS: 120, graceS: 32.94, minDeliveryGapS: 30, maxAlertsPerMinute: 2, maxAlertsPerSession: 6, n2MinActiveS: 60, gapNormS: 40 },
        ...over,
    };
}

function init(over: Record<string, unknown> = {}) {
    return {
        type: ExtensionMsg.StruggleDetectionInit,
        isStruggling: false, urgency: 0.3, v: 0.2, s: 0.3,
        primaryBoundary: null, lastAlertT: null, isEnabled: true,
        developerMode: true, debug: debugSnapshot(), embedded: false,
        ...over,
    };
}

describe('StruggleDetectionView', () => {
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

    it('embedded copy hides the back-link, pop-out button and live chart but keeps the timers dashboard', () => {
        const api = createMockVsCodeApi();
        render(<StruggleDetectionView vscodeApi={api} />);
        act(() => dispatchExtensionMessage(init({ embedded: true })));
        expect(screen.queryByText('Back to Dashboard')).not.toBeInTheDocument();
        expect(screen.queryByTitle('Open in Editor')).not.toBeInTheDocument();
        expect(screen.queryByText(/Live Engine View/i)).not.toBeInTheDocument();
        expect(screen.getByText(/Engine Timers/i)).toBeInTheDocument();
    });
});
