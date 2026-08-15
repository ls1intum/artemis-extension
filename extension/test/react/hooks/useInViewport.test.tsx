import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useInViewport } from '@webview/hooks/useInViewport';

function Probe() {
    const [el, setEl] = useState<HTMLDivElement | null>(null);
    const inViewport = useInViewport(el);
    return <div ref={setEl} data-testid="probe" data-inviewport={String(inViewport)} />;
}

/** Probe whose observed element can mount/unmount after the first render. */
function LateProbe({ mounted }: { mounted: boolean }) {
    const [el, setEl] = useState<HTMLDivElement | null>(null);
    const inViewport = useInViewport(el);
    return (
        <div data-testid="host" data-inviewport={String(inViewport)}>
            {mounted && <div ref={setEl} data-testid="late" />}
        </div>
    );
}

describe('useInViewport', () => {
    let observerCallback: IntersectionObserverCallback;
    const observe = vi.fn();
    const disconnect = vi.fn();

    beforeEach(() => {
        // happy-dom has no IntersectionObserver, so stub it.
        // Must use a regular function (not an arrow function) so it is new-able.
        vi.stubGlobal(
            'IntersectionObserver',
            vi.fn(function (callback: IntersectionObserverCallback) {
                observerCallback = callback;
                return { observe, disconnect, unobserve: vi.fn() };
            }),
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function emit(isIntersecting: boolean) {
        act(() => {
            observerCallback(
                [{ isIntersecting } as IntersectionObserverEntry],
                {} as IntersectionObserver,
            );
        });
    }

    it('defaults to true before the observer fires', () => {
        render(<Probe />);
        expect(screen.getByTestId('probe').dataset.inviewport).toBe('true');
    });

    it('observes the element', () => {
        render(<Probe />);
        expect(observe).toHaveBeenCalledWith(screen.getByTestId('probe'));
    });

    it('reflects intersection changes', () => {
        render(<Probe />);
        emit(false);
        expect(screen.getByTestId('probe').dataset.inviewport).toBe('false');
        emit(true);
        expect(screen.getByTestId('probe').dataset.inviewport).toBe('true');
    });

    it('attaches the observer when the element mounts later (ExerciseDetailView early-return case)', () => {
        const { rerender } = render(<LateProbe mounted={false} />);
        expect(observe).not.toHaveBeenCalled();

        rerender(<LateProbe mounted />);
        expect(observe).toHaveBeenCalledWith(screen.getByTestId('late'));
        emit(false);
        expect(screen.getByTestId('host').dataset.inviewport).toBe('false');
    });

    it('resets to true when the element unmounts', () => {
        const { rerender } = render(<LateProbe mounted />);
        emit(false);
        expect(screen.getByTestId('host').dataset.inviewport).toBe('false');

        rerender(<LateProbe mounted={false} />);
        expect(screen.getByTestId('host').dataset.inviewport).toBe('true');
        expect(disconnect).toHaveBeenCalled();
    });

    it('disconnects on unmount', () => {
        const { unmount } = render(<Probe />);
        unmount();
        expect(disconnect).toHaveBeenCalled();
    });

    it('stays true when IntersectionObserver is unavailable', () => {
        vi.unstubAllGlobals(); // remove the stub → IO undefined in happy-dom
        render(<Probe />);
        expect(screen.getByTestId('probe').dataset.inviewport).toBe('true');
    });
});
