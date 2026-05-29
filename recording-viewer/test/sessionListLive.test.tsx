import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { SessionList } from '../src/components/SessionList';

const SESSIONS = [
    { id: 'live-sess-1', metadata: null, hasReplay: false, hasVideo: false, hasSubtitles: false },
    { id: 'archived-sess-2', metadata: { exerciseId: 1, startTime: 1, endTime: 2, eventCount: 3 }, hasReplay: false, hasVideo: false, hasSubtitles: false },
];

beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sessions: SESSIONS, recordingsDir: '/tmp/rec' }),
    }) as unknown as typeof fetch;
});
afterEach(() => { vi.restoreAllMocks(); });

describe('SessionList live indicator', () => {
    it('marks the live row, renders the LIVE badge, and places it before the id', async () => {
        const { container } = render(
            <SessionList onSelectSession={() => {}} liveIds={new Set(['live-sess-1'])} readOnly />,
        );
        await waitFor(() => expect(container.querySelectorAll('.session-table-row').length).toBe(2));

        const liveRows = container.querySelectorAll('.session-table-row.live');
        expect(liveRows).toHaveLength(1);
        expect(liveRows[0].textContent).toContain('live-sess-1');

        const cell = liveRows[0].querySelector('.session-id-cell');
        // Badge must be the FIRST child so overflow:hidden cannot clip it (the bug).
        expect(cell?.firstElementChild?.classList.contains('live-session-badge')).toBe(true);
        expect(cell?.querySelector('.live-session-badge')?.textContent).toBe('LIVE');
    });

    it('does not mark archived (non-live) sessions', async () => {
        const { container } = render(
            <SessionList onSelectSession={() => {}} liveIds={new Set(['live-sess-1'])} readOnly />,
        );
        await waitFor(() => expect(container.querySelectorAll('.session-table-row').length).toBe(2));

        const rows = Array.from(container.querySelectorAll('.session-table-row'));
        const archived = rows.find(r => r.textContent?.includes('archived-sess-2'));
        expect(archived?.classList.contains('live')).toBe(false);
        expect(archived?.querySelector('.live-session-badge')).toBeNull();
    });

    it('renders no live markup when liveIds is empty', async () => {
        const { container } = render(
            <SessionList onSelectSession={() => {}} liveIds={new Set()} readOnly />,
        );
        await waitFor(() => expect(container.querySelectorAll('.session-table-row').length).toBe(2));
        expect(container.querySelectorAll('.session-table-row.live')).toHaveLength(0);
        expect(container.querySelector('.live-session-badge')).toBeNull();
    });
});
