import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VsCodeApi } from '@shared/messageContracts';

import { useProblemStatementTracking } from '@webview/hooks/useProblemStatementTracking';

// happy-dom lacks ResizeObserver — stub with a regular function (arrow fns
// are not constructable with `new`). Tests can trigger observed callbacks
// via the captured instances.
type ROCallback = (entries: unknown[], observer: unknown) => void;
const roInstances: { callback: ROCallback; observed: Element[] }[] = [];
function stubResizeObserver() {
    vi.stubGlobal('ResizeObserver', function (this: { callback: ROCallback }, callback: ROCallback) {
        const instance = { callback, observed: [] as Element[] };
        roInstances.push(instance);
        return {
            observe: (el: Element) => instance.observed.push(el),
            disconnect: () => { instance.observed.length = 0; },
        };
    } as unknown as typeof ResizeObserver);
}

function makeVsCodeApi() {
    const postMessage = vi.fn();
    return { api: { postMessage, getState: () => undefined, setState: () => undefined } as unknown as VsCodeApi, postMessage };
}

/** All messages posted with the given command. */
function postedPayloads(postMessage: ReturnType<typeof vi.fn>, command: string) {
    return postMessage.mock.calls
        .map(([msg]) => msg as { command?: string; payload?: unknown })
        .filter(msg => msg.command === command)
        .map(msg => msg.payload);
}

function makeStatementEl(rect: Partial<DOMRect> = {}): HTMLDivElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({
        top: 900, left: 0, right: 600, bottom: 2500, width: 600, height: 1600,
        x: 0, y: 900, toJSON: () => ({}),
        ...rect,
    } as DOMRect);
    return el;
}

describe('useProblemStatementTracking', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        roInstances.length = 0;
        stubResizeObserver();
        // happy-dom: make page metrics deterministic
        Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
        Object.defineProperty(window, 'scrollX', { value: 0, writable: true, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 800, writable: true, configurable: true });
        Object.defineProperty(document.documentElement, 'scrollHeight', { value: 3000, writable: true, configurable: true });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    // ── Scroll + baseline ───────────────────────────────────────────────

    it('emits a baseline scroll payload after mount (debounced)', () => {
        const { api, postMessage } = makeVsCodeApi();
        const el = makeStatementEl();
        renderHook(() => useProblemStatementTracking(el, '<p>x</p>', api));
        expect(postMessage).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(300); });
        expect(postedPayloads(postMessage, 'problemStatementScroll')).toEqual([{
            scrollTop: 0, scrollHeight: 3000, viewportHeight: 800,
            statementTop: 900, statementHeight: 1600,
        }]);
    });

    it('does not emit when element is null or bodyHtml is undefined', () => {
        const a = makeVsCodeApi();
        renderHook(() => useProblemStatementTracking(null, '<p>x</p>', a.api));
        const b = makeVsCodeApi();
        const el = makeStatementEl();
        renderHook(() => useProblemStatementTracking(el, undefined, b.api));
        act(() => { vi.advanceTimersByTime(1000); });
        expect(a.postMessage).not.toHaveBeenCalled();
        expect(b.postMessage).not.toHaveBeenCalled();
    });

    it('debounces a scroll burst into one trailing emit', () => {
        const { api, postMessage } = makeVsCodeApi();
        const el = makeStatementEl();
        renderHook(() => useProblemStatementTracking(el, '<p>x</p>', api));
        act(() => { vi.advanceTimersByTime(300); }); // baseline
        act(() => {
            (window as unknown as { scrollY: number }).scrollY = 50;
            window.dispatchEvent(new Event('scroll'));
            vi.advanceTimersByTime(100);
            (window as unknown as { scrollY: number }).scrollY = 150;
            window.dispatchEvent(new Event('scroll'));
            vi.advanceTimersByTime(100);
            (window as unknown as { scrollY: number }).scrollY = 250;
            window.dispatchEvent(new Event('scroll'));
            vi.advanceTimersByTime(300);
        });
        const payloads = postedPayloads(postMessage, 'problemStatementScroll');
        expect(payloads).toHaveLength(2); // baseline + one trailing emit
        expect(payloads[1]).toMatchObject({ scrollTop: 250 });
    });

    it('suppresses identical consecutive scroll payloads', () => {
        const { api, postMessage } = makeVsCodeApi();
        const el = makeStatementEl();
        renderHook(() => useProblemStatementTracking(el, '<p>x</p>', api));
        act(() => { vi.advanceTimersByTime(300); }); // baseline
        act(() => {
            window.dispatchEvent(new Event('scroll')); // same scrollY → same payload
            vi.advanceTimersByTime(300);
        });
        expect(postedPayloads(postMessage, 'problemStatementScroll')).toHaveLength(1);
    });

    it('rounds fractional geometry to integers', () => {
        const { api, postMessage } = makeVsCodeApi();
        const el = makeStatementEl({ top: 900.4, height: 1600.6 });
        renderHook(() => useProblemStatementTracking(el, '<p>x</p>', api));
        act(() => { vi.advanceTimersByTime(300); });
        expect(postedPayloads(postMessage, 'problemStatementScroll')[0]).toMatchObject({
            statementTop: 900, statementHeight: 1601,
        });
    });

    it('re-emits the baseline when bodyHtml changes and geometry differs', () => {
        const { api, postMessage } = makeVsCodeApi();
        const el = makeStatementEl();
        const { rerender } = renderHook(
            ({ html }) => useProblemStatementTracking(el, html, api),
            { initialProps: { html: '<p>a</p>' } },
        );
        act(() => { vi.advanceTimersByTime(300); });
        el.getBoundingClientRect = () => ({
            top: 900, left: 0, right: 600, bottom: 3100, width: 600, height: 2200,
            x: 0, y: 900, toJSON: () => ({}),
        } as DOMRect);
        rerender({ html: '<p>b</p>' });
        act(() => { vi.advanceTimersByTime(300); });
        const payloads = postedPayloads(postMessage, 'problemStatementScroll');
        expect(payloads).toHaveLength(2);
        expect(payloads[1]).toMatchObject({ statementHeight: 2200 });
    });

    it('re-emits via ResizeObserver when the statement or body resizes', () => {
        const { api, postMessage } = makeVsCodeApi();
        const el = makeStatementEl();
        renderHook(() => useProblemStatementTracking(el, '<p>x</p>', api));
        act(() => { vi.advanceTimersByTime(300); }); // baseline
        // The hook observes both the statement element and document.body.
        expect(roInstances).toHaveLength(1);
        expect(roInstances[0].observed).toContain(el);
        expect(roInstances[0].observed).toContain(document.body);
        el.getBoundingClientRect = () => ({
            top: 900, left: 0, right: 600, bottom: 1900, width: 600, height: 1000,
            x: 0, y: 900, toJSON: () => ({}),
        } as DOMRect);
        act(() => {
            roInstances[0].callback([], {});
            vi.advanceTimersByTime(300);
        });
        expect(postedPayloads(postMessage, 'problemStatementScroll')[1]).toMatchObject({ statementHeight: 1000 });
    });

    it('re-emits on window resize when the viewport height changes', () => {
        const { api, postMessage } = makeVsCodeApi();
        const el = makeStatementEl();
        renderHook(() => useProblemStatementTracking(el, '<p>x</p>', api));
        act(() => { vi.advanceTimersByTime(300); }); // baseline
        act(() => {
            (window as unknown as { innerHeight: number }).innerHeight = 500;
            window.dispatchEvent(new Event('resize'));
            vi.advanceTimersByTime(300);
        });
        expect(postedPayloads(postMessage, 'problemStatementScroll')[1]).toMatchObject({ viewportHeight: 500 });
    });

    it('flushes a pending scroll emit on unmount while the element is connected', () => {
        const { api, postMessage } = makeVsCodeApi();
        const el = makeStatementEl();
        const { unmount } = renderHook(() => useProblemStatementTracking(el, '<p>x</p>', api));
        act(() => { vi.advanceTimersByTime(300); }); // baseline
        act(() => {
            (window as unknown as { scrollY: number }).scrollY = 400;
            window.dispatchEvent(new Event('scroll'));
        });
        unmount(); // pending 300ms emit must flush synchronously
        const payloads = postedPayloads(postMessage, 'problemStatementScroll');
        expect(payloads).toHaveLength(2);
        expect(payloads[1]).toMatchObject({ scrollTop: 400 });
    });

    it('does not flush garbage when the element is already detached on unmount', () => {
        const { api, postMessage } = makeVsCodeApi();
        const el = makeStatementEl();
        const { unmount } = renderHook(() => useProblemStatementTracking(el, '<p>x</p>', api));
        act(() => { vi.advanceTimersByTime(300); }); // baseline
        act(() => {
            (window as unknown as { scrollY: number }).scrollY = 400;
            window.dispatchEvent(new Event('scroll'));
        });
        el.remove(); // detach → isConnected false
        unmount();
        expect(postedPayloads(postMessage, 'problemStatementScroll')).toHaveLength(1);
    });

    // ── Selection ───────────────────────────────────────────────────────

    function stubSelection(el: HTMLElement, text: string, rect: Partial<DOMRect> = {}) {
        const range = {
            getBoundingClientRect: () => ({
                top: 1200, left: 40, width: 320, height: 18,
                right: 360, bottom: 1218, x: 40, y: 1200, toJSON: () => ({}),
                ...rect,
            } as DOMRect),
        };
        const textNode = document.createTextNode(text);
        el.appendChild(textNode);
        vi.stubGlobal('getSelection', () => ({
            isCollapsed: false,
            rangeCount: 1,
            anchorNode: textNode,
            focusNode: textNode,
            toString: () => text,
            getRangeAt: () => range,
        }));
    }

    it('emits a selection payload for a selection inside the statement', () => {
        const { api, postMessage } = makeVsCodeApi();
        const el = makeStatementEl();
        renderHook(() => useProblemStatementTracking(el, '<p>x</p>', api));
        stubSelection(el, 'implement the constructor');
        act(() => {
            document.dispatchEvent(new Event('selectionchange'));
            vi.advanceTimersByTime(200);
        });
        expect(postedPayloads(postMessage, 'problemStatementSelection')).toEqual([{
            selectedText: 'implement the constructor', selectionLength: 25, truncated: false,
            selectionTop: 1200, selectionLeft: 40, selectionWidth: 320, selectionHeight: 18,
        }]);
    });

    it('caps the selected text at 500 chars and sets truncated + full length', () => {
        const { api, postMessage } = makeVsCodeApi();
        const el = makeStatementEl();
        renderHook(() => useProblemStatementTracking(el, '<p>x</p>', api));
        stubSelection(el, 'y'.repeat(1200));
        act(() => {
            document.dispatchEvent(new Event('selectionchange'));
            vi.advanceTimersByTime(200);
        });
        const [payload] = postedPayloads(postMessage, 'problemStatementSelection') as [
            { selectedText: string; selectionLength: number; truncated: boolean },
        ];
        expect(payload.selectedText).toHaveLength(500);
        expect(payload.selectionLength).toBe(1200);
        expect(payload.truncated).toBe(true);
    });

    it('ignores collapsed selections and selections outside the statement', () => {
        const { api, postMessage } = makeVsCodeApi();
        const el = makeStatementEl();
        renderHook(() => useProblemStatementTracking(el, '<p>x</p>', api));
        // collapsed
        vi.stubGlobal('getSelection', () => ({ isCollapsed: true, rangeCount: 1 }));
        act(() => {
            document.dispatchEvent(new Event('selectionchange'));
            vi.advanceTimersByTime(200);
        });
        // outside the statement container (e.g. document-wide select-all)
        const outside = document.createTextNode('elsewhere');
        document.body.appendChild(outside);
        vi.stubGlobal('getSelection', () => ({
            isCollapsed: false, rangeCount: 1,
            anchorNode: outside, focusNode: outside,
            toString: () => 'elsewhere',
            getRangeAt: () => ({ getBoundingClientRect: () => ({ top: 0, left: 0, width: 1, height: 1, toJSON: () => ({}) } as DOMRect) }),
        }));
        act(() => {
            document.dispatchEvent(new Event('selectionchange'));
            vi.advanceTimersByTime(200);
        });
        expect(postedPayloads(postMessage, 'problemStatementSelection')).toHaveLength(0);
    });

    it('suppresses consecutive duplicate selections', () => {
        const { api, postMessage } = makeVsCodeApi();
        const el = makeStatementEl();
        renderHook(() => useProblemStatementTracking(el, '<p>x</p>', api));
        stubSelection(el, 'same phrase');
        act(() => {
            document.dispatchEvent(new Event('selectionchange'));
            vi.advanceTimersByTime(200);
            document.dispatchEvent(new Event('selectionchange'));
            vi.advanceTimersByTime(200);
        });
        expect(postedPayloads(postMessage, 'problemStatementSelection')).toHaveLength(1);
    });

    it('does not flush a selection from a detached element on unmount', () => {
        const { api, postMessage } = makeVsCodeApi();
        const el = makeStatementEl();
        const { unmount } = renderHook(() => useProblemStatementTracking(el, '<p>x</p>', api));
        stubSelection(el, 'pending selection');
        act(() => {
            document.dispatchEvent(new Event('selectionchange'));
            // no timer advance — emit stays pending
        });
        el.remove(); // detach → isConnected false
        unmount();
        expect(postedPayloads(postMessage, 'problemStatementSelection')).toHaveLength(0);
    });

    it('debounces rapid selectionchange bursts into one trailing emit', () => {
        const { api, postMessage } = makeVsCodeApi();
        const el = makeStatementEl();
        renderHook(() => useProblemStatementTracking(el, '<p>x</p>', api));
        stubSelection(el, 'drag selection result');
        act(() => {
            document.dispatchEvent(new Event('selectionchange'));
            vi.advanceTimersByTime(50);
            document.dispatchEvent(new Event('selectionchange'));
            vi.advanceTimersByTime(50);
            document.dispatchEvent(new Event('selectionchange'));
            vi.advanceTimersByTime(200);
        });
        expect(postedPayloads(postMessage, 'problemStatementSelection')).toHaveLength(1);
    });
});
