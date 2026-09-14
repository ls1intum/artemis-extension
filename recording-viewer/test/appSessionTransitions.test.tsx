import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { RecordingViewerApp } from '../src/App';
import type { AuthStatus } from '../src/hooks/useAuth';

/** The session view is what these tests are about, so the chart-heavy children
 *  are stubbed: they render canvases in jsdom and say nothing about the
 *  session/live transitions under test. */
vi.mock('../src/components/SessionTimeline', () => ({ SessionTimeline: () => <div data-testid="session-timeline" /> }));
vi.mock('../src/components/TrackingTimeline', () => ({ TrackingTimeline: () => <div data-testid="tracking-timeline" /> }));
vi.mock('../src/components/EventStream', () => ({ EventStream: () => <div data-testid="event-stream" /> }));

class FakeEventSource {
    static instances: FakeEventSource[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string; lastEventId: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    constructor(public url: string) { FakeEventSource.instances.push(this); }
    addEventListener() {}
    close() { this.closed = true; }
    emit(event: object, lineNo: number) {
        this.onmessage?.({ data: JSON.stringify(event), lastEventId: String(lineNo) });
    }
}

const AUTH: AuthStatus = {
    authenticated: true, authRequired: true, allowWrite: true, role: 'rater', raterName: 'Alice',
};

const SESSION_ROW = { id: 's1', metadata: null, hasReplay: false, hasVideo: false, hasSubtitles: false };
const METADATA = { exerciseId: 1, startTime: 1_000, endTime: 9_000, eventCount: 2 };

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const notFound = () => ({ ok: false, status: 404, json: async () => ({}) });

/** Records every requested URL so a test can assert what the app fetched. */
let requested: string[] = [];

function route(url: string) {
    if (url === '/api/recordings') return ok({ sessions: [SESSION_ROW], recordingsDir: '/tmp/rec' });
    if (url === '/api/live/sessions') return ok({ sessions: [{ id: 's1', metadata: null }] });
    if (url.includes('/metadata')) return ok(METADATA);
    if (url.includes('/annotations')) return ok([]);
    if (url.includes('/replay-eq')) return notFound();
    if (url.includes('/video-sync')) return notFound();
    if (url.includes('/subtitles')) return notFound();
    if (url.includes('/events')) return ok([{ type: 'sessionStart', timestamp: 1_000 }]);
    return notFound();
}

beforeEach(() => {
    requested = [];
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', vi.fn((url: string) => {
        requested.push(url);
        return Promise.resolve(route(url) as unknown as Response);
    }));
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

async function openLiveSession() {
    render(<RecordingViewerApp authStatus={AUTH} />);
    const row = await screen.findByText('s1');
    await act(async () => { row.closest('.session-table-row')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    return FakeEventSource.instances[0];
}

describe('App session transitions', () => {
    it('opening a live session streams it and shows the live bar', async () => {
        const es = await openLiveSession();

        // The stream is opened for the session the user clicked, which only
        // works if the render path sees the newly claimed session id.
        expect(es.url).toContain('/api/recordings/s1/events/stream');
        await waitFor(() => expect(document.querySelector('.live-control-bar')).not.toBeNull());
        // Live mode does not fetch the archived event list.
        expect(requested.some(u => u === '/api/recordings/s1/events')).toBe(false);
    });

    it('leaves live mode and reloads the archive when the session ends', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const es = await openLiveSession();
        await waitFor(() => expect(document.querySelector('.live-control-bar')).not.toBeNull());

        await act(async () => { es.emit({ type: 'sessionEnd', timestamp: 5_000 }, 1); });

        // Live UI is gone immediately, and the capped live buffer is replaced by
        // a tail-limited archive reload half a second later.
        await waitFor(() => expect(document.querySelector('.live-control-bar')).toBeNull());
        await act(async () => { await vi.advanceTimersByTimeAsync(600); });
        await waitFor(() => expect(requested.some(u => u === '/api/recordings/s1/events?tail=5000')).toBe(true));
    });

    it('does not re-enter live mode after the session ended', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const es = await openLiveSession();
        await waitFor(() => expect(document.querySelector('.live-control-bar')).not.toBeNull());

        await act(async () => { es.emit({ type: 'sessionEnd', timestamp: 5_000 }, 1); });
        // /api/live/sessions keeps reporting s1 as live for a while after the
        // recorder stopped; the ended-id suppression is what must hold here.
        await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });

        expect(document.querySelector('.live-control-bar')).toBeNull();
    });

    it('going back clears the session view', async () => {
        await openLiveSession();
        await waitFor(() => expect(document.querySelector('.session-view')).not.toBeNull());

        const back = screen.getByText(/Back/);
        await act(async () => { back.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

        await waitFor(() => expect(document.querySelector('.session-view')).toBeNull());
        expect(FakeEventSource.instances[0].closed).toBe(true);
    });
});
