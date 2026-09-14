import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLiveSession } from '../src/hooks/useLiveSession';
import type { RecordedEvent } from '../src/types';

/** Minimal EventSource stand-in: jsdom has none, and the hook only uses
 *  onopen/onmessage/onerror, addEventListener for named events, and close(). */
class FakeEventSource {
    static instances: FakeEventSource[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string; lastEventId: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    private listeners = new Map<string, Array<() => void>>();

    constructor(public url: string) {
        FakeEventSource.instances.push(this);
    }

    addEventListener(type: string, fn: () => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
    }

    close() { this.closed = true; }

    emit(event: RecordedEvent, lineNo: number) {
        this.onmessage?.({ data: JSON.stringify(event), lastEventId: String(lineNo) });
    }

    emitNamed(type: string) {
        for (const fn of this.listeners.get(type) ?? []) fn();
    }
}

const ev = (type: string, timestamp: number): RecordedEvent =>
    ({ type, timestamp } as unknown as RecordedEvent);

beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => vi.unstubAllGlobals());

describe('useLiveSession onEnded', () => {
    it('fires once with the final events when a sessionEnd line arrives', () => {
        const onEnded = vi.fn();
        renderHook(() => useLiveSession('s1', true, onEnded));
        const es = FakeEventSource.instances[0];

        act(() => {
            es.emit(ev('typing', 10), 1);
            es.emit(ev('sessionEnd', 20), 2);
        });

        expect(onEnded).toHaveBeenCalledTimes(1);
        const finalEvents = onEnded.mock.calls[0][0] as RecordedEvent[];
        expect(finalEvents.map(e => e.timestamp)).toEqual([10, 20]);
        expect(es.closed).toBe(true);
    });

    it('fires when the server reports the session is gone', () => {
        const onEnded = vi.fn();
        renderHook(() => useLiveSession('s1', true, onEnded));
        const es = FakeEventSource.instances[0];

        act(() => {
            es.emit(ev('typing', 10), 1);
            es.emitNamed('session-gone');
        });

        expect(onEnded).toHaveBeenCalledTimes(1);
        // The typing event was still waiting for the next animation frame, and
        // the snapshot handed over is supposed to be the final one.
        expect((onEnded.mock.calls[0][0] as RecordedEvent[]).map(e => e.timestamp)).toEqual([10]);
        expect(es.closed).toBe(true);
    });

    it('fires once when both end signals arrive for the same stream', () => {
        const onEnded = vi.fn();
        renderHook(() => useLiveSession('s1', true, onEnded));
        const es = FakeEventSource.instances[0];

        act(() => {
            es.emit(ev('sessionEnd', 20), 1);
            es.emitNamed('session-gone');
        });

        expect(onEnded).toHaveBeenCalledTimes(1);
    });

    it('starts over for a new session id', () => {
        const onEnded = vi.fn();
        const { rerender } = renderHook(
            ({ id }: { id: string }) => useLiveSession(id, true, onEnded),
            { initialProps: { id: 's1' } },
        );
        act(() => { FakeEventSource.instances[0].emit(ev('sessionEnd', 20), 1); });
        rerender({ id: 's2' });
        act(() => { FakeEventSource.instances[1].emit(ev('sessionEnd', 40), 1); });

        expect(onEnded).toHaveBeenCalledTimes(2);
    });

    it('does not fire on a transient disconnect', () => {
        const onEnded = vi.fn();
        renderHook(() => useLiveSession('s1', true, onEnded));
        const es = FakeEventSource.instances[0];

        act(() => { es.onerror?.(); });

        expect(onEnded).not.toHaveBeenCalled();
    });

    it('keeps the stream open when only the callback identity changes', () => {
        const { rerender } = renderHook(
            ({ cb }: { cb: () => void }) => useLiveSession('s1', true, cb),
            { initialProps: { cb: () => {} } },
        );
        expect(FakeEventSource.instances).toHaveLength(1);

        rerender({ cb: () => {} });

        expect(FakeEventSource.instances).toHaveLength(1);
        expect(FakeEventSource.instances[0].closed).toBe(false);
    });

    it('calls the newest callback, not the one from the render that opened the stream', () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = renderHook(
            ({ cb }: { cb: () => void }) => useLiveSession('s1', true, cb),
            { initialProps: { cb: first } },
        );
        rerender({ cb: second });

        act(() => { FakeEventSource.instances[0].emit(ev('sessionEnd', 20), 1); });

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });
});
