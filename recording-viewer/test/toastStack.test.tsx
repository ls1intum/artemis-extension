import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { ToastStack, appendToast, type ActiveToast } from '../src/components/ToastStack';

function mk(id: number, over: Partial<ActiveToast> = {}): ActiveToast {
    return { id, kind: 'add', text: undefined, at: 0, ...over };
}

describe('appendToast', () => {
    it('appends to the end', () => {
        const out = appendToast([mk(0)], mk(1), 5);
        expect(out.map(t => t.id)).toEqual([0, 1]);
    });

    it('drops the oldest when over the cap', () => {
        const start = [mk(0), mk(1), mk(2), mk(3), mk(4)];
        const out = appendToast(start, mk(5), 5);
        expect(out.map(t => t.id)).toEqual([1, 2, 3, 4, 5]);
    });
});

describe('ToastStack', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('renders nothing when empty', () => {
        const { container } = render(
            <ToastStack toasts={[]} durationMs={2500} onDismiss={() => {}} />,
        );
        expect(container.querySelector('.annotation-toast-stack')).toBeNull();
    });

    it('renders toasts in order, newest last (corner)', () => {
        const toasts = [mk(0, { text: 'first' }), mk(1, { text: 'second' })];
        const { container } = render(
            <ToastStack toasts={toasts} durationMs={2500} onDismiss={() => {}} />,
        );
        const items = container.querySelectorAll('.annotation-toast');
        expect(items).toHaveLength(2);
        expect(items[0].textContent).toBe('+ first');
        expect(items[1].textContent).toBe('+ second');
    });

    it('formats each kind and resolves the human label', () => {
        const toasts: ActiveToast[] = [
            mk(0, { kind: 'add', label: 'high-struggle' }),
            mk(1, { kind: 'undo', text: 'x' }),
            mk(2, { kind: 'redo', text: 'x' }),
            mk(3, { kind: 'error', text: 'boom' }),
        ];
        const { container } = render(
            <ToastStack toasts={toasts} durationMs={2500} onDismiss={() => {}} />,
        );
        const items = container.querySelectorAll('.annotation-toast');
        expect(items[0].textContent).toBe('+ High struggle');
        expect(items[1].textContent).toBe('↶ x');
        expect(items[2].textContent).toBe('↷ x');
        expect(items[3].textContent).toBe('⚠ boom');
        expect(items[0].className).toContain('annotation-toast-add');
        expect(items[3].className).toContain('annotation-toast-error');
    });

    it('calls onDismiss once after durationMs, not before', () => {
        const onDismiss = vi.fn();
        render(<ToastStack toasts={[mk(7)]} durationMs={2500} onDismiss={onDismiss} />);

        act(() => { vi.advanceTimersByTime(2499); });
        expect(onDismiss).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(1); });
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(onDismiss).toHaveBeenCalledWith(7);
    });

    it('dismisses exactly once under StrictMode (double-invoked effects)', () => {
        const onDismiss = vi.fn();
        render(
            <StrictMode>
                <ToastStack toasts={[mk(3)]} durationMs={2500} onDismiss={onDismiss} />
            </StrictMode>,
        );
        act(() => { vi.advanceTimersByTime(2500); });
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(onDismiss).toHaveBeenCalledWith(3);
    });

    it('runs an independent timer per toast across rerenders', () => {
        const onDismiss = vi.fn();
        const { rerender } = render(
            <ToastStack toasts={[mk(0)]} durationMs={2500} onDismiss={onDismiss} />,
        );
        act(() => { vi.advanceTimersByTime(1000); });            // t=1000
        rerender(<ToastStack toasts={[mk(0), mk(1)]} durationMs={2500} onDismiss={onDismiss} />);
        act(() => { vi.advanceTimersByTime(1500); });            // t=2500 -> toast 0 expires
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(onDismiss).toHaveBeenCalledWith(0);
        act(() => { vi.advanceTimersByTime(1000); });            // t=3500 -> toast 1 expires
        expect(onDismiss).toHaveBeenCalledTimes(2);
        expect(onDismiss).toHaveBeenCalledWith(1);
    });
});
