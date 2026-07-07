import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SlotDebugSnapshot, VsCodeApi } from '@shared/messageContracts';

import { createMockVsCodeApi, dispatchExtensionMessage } from '@test/react/__helpers__/vscodeApi';
import { SlotPanel } from '@webview/views/StruggleDetection/SlotPanel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW_MS = 1_700_000_000_000;

const SUPPRESSION_CLEAR: SlotDebugSnapshot['suppression'] = {
    serverAvailable: true, courseProactiveOff: false, studentProactiveOn: true,
};

function makeDeliveredSnapshot(overrides: Partial<SlotDebugSnapshot> = {}): SlotDebugSnapshot {
    return {
        nowMs: NOW_MS,
        state: 'delivered',
        level: 'active',
        episodeId: 'ep-1',
        generation: 3,
        episodeAgeMs: 500,
        hintCount: 2,
        isNew: false,
        inSession: true,
        watchdog: { armed: true, staleDeadlineMs: NOW_MS + 2000 },
        inFlight: {
            intent: 'confirm_close',
            localToken: 7,
            episodeId: 'ep-1',
            generation: 3,
            requestToken: 'rt-abcdef12',
        },
        owed: { confirmClose: false },
        pendingOutcomes: 0,
        awaitingEvidence: false,
        suppression: SUPPRESSION_CLEAR,
        ...overrides,
    };
}

function makeFreeSnapshot(overrides: Partial<SlotDebugSnapshot> = {}): SlotDebugSnapshot {
    return {
        nowMs: NOW_MS,
        state: 'free',
        level: null,
        episodeId: null,
        generation: 0,
        episodeAgeMs: null,
        hintCount: 0,
        isNew: false,
        inSession: false,
        watchdog: { armed: false, staleDeadlineMs: null },
        inFlight: null,
        owed: { confirmClose: false },
        pendingOutcomes: 0,
        awaitingEvidence: false,
        suppression: SUPPRESSION_CLEAR,
        ...overrides,
    };
}

/** Extract posted commands from the mock vscodeApi. */
function postedCommands(api: VsCodeApi): string[] {
    return (api.postMessage as ReturnType<typeof import('vitest').vi.fn>).mock.calls
        .map((c) => c[0])
        .filter((m): m is { type: 'command'; command: string } =>
            typeof m === 'object' && m !== null && (m as { type?: string }).type === 'command')
        .map((m) => m.command);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SlotPanel', () => {
    it('renders state badge, episode id, in-flight intent, and idle-free countdown when delivered', () => {
        const api = createMockVsCodeApi();
        render(<SlotPanel vscodeApi={api} />);

        act(() => dispatchExtensionMessage({
            type: 'struggleSlotUpdate',
            snapshot: makeDeliveredSnapshot(),
            episodes: [],
        }));

        expect(screen.getByText(/DELIVERED/)).toBeInTheDocument();
        expect(screen.getByText('ep-1')).toBeInTheDocument();
        expect(screen.getByText(/confirm_close/)).toBeInTheDocument();
        // The watchdog is armed, so the idle-free countdown in M:SS format must be visible.
        expect(screen.getAllByText(/\d:\d{2}/).length).toBeGreaterThanOrEqual(1);
    });

    it('shows a "slot free" empty state when state is free', () => {
        const api = createMockVsCodeApi();
        render(<SlotPanel vscodeApi={api} />);

        act(() => dispatchExtensionMessage({
            type: 'struggleSlotUpdate',
            snapshot: makeFreeSnapshot(),
            episodes: [],
        }));

        expect(screen.getByText(/no active intervention/i)).toBeInTheDocument();
    });

    it('renders the suppression status group on free AND delivered snapshots', () => {
        const api = createMockVsCodeApi();
        render(<SlotPanel vscodeApi={api} />);

        act(() => dispatchExtensionMessage({
            type: 'struggleSlotUpdate',
            snapshot: makeFreeSnapshot(),
            episodes: [],
        }));
        expect(screen.getByText('Suppression status')).toBeInTheDocument();
        expect(screen.getByText('available')).toBeInTheDocument();      // server

        act(() => dispatchExtensionMessage({
            type: 'struggleSlotUpdate',
            snapshot: makeDeliveredSnapshot(),
            episodes: [],
        }));
        expect(screen.getByText('Suppression status')).toBeInTheDocument();
    });

    it('shows the server/course latches and the student toggle when suppression is active', () => {
        const api = createMockVsCodeApi();
        render(<SlotPanel vscodeApi={api} />);

        act(() => dispatchExtensionMessage({
            type: 'struggleSlotUpdate',
            snapshot: makeFreeSnapshot({
                suppression: {
                    ...SUPPRESSION_CLEAR,
                    serverAvailable: false, courseProactiveOff: true, studentProactiveOn: false,
                },
            }),
            episodes: [],
        }));
        expect(screen.getByText('unavailable (local fallback)')).toBeInTheDocument();
        expect(screen.getByText('latched off')).toBeInTheDocument();    // course proactive
        expect(screen.getByText('off')).toBeInTheDocument();            // student toggle
    });

    it('renders the idle-abandon gate line on a FREE slot only while awaitingEvidence is set', () => {
        const api = createMockVsCodeApi();
        render(<SlotPanel vscodeApi={api} />);

        act(() => dispatchExtensionMessage({
            type: 'struggleSlotUpdate',
            snapshot: makeFreeSnapshot({ awaitingEvidence: true }),
            episodes: [],
        }));
        expect(screen.getByText(/awaiting fresh evidence/i)).toBeInTheDocument();

        act(() => dispatchExtensionMessage({
            type: 'struggleSlotUpdate',
            snapshot: makeFreeSnapshot(),
            episodes: [],
        }));
        expect(screen.queryByText(/awaiting fresh evidence/i)).toBeNull();
    });

    it('posts struggleLiveSubscribe on mount and struggleLiveUnsubscribe on unmount', () => {
        const api = createMockVsCodeApi();
        const { unmount } = render(<SlotPanel vscodeApi={api} />);
        expect(postedCommands(api)).toContain('struggleLiveSubscribe');
        unmount();
        expect(postedCommands(api)).toContain('struggleLiveUnsubscribe');
    });
});
