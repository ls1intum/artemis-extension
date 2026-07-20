import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThinkingIndicator } from '@webview/views/IrisChat/components/ThinkingIndicator';

describe('ThinkingIndicator', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders when isVisible is true (default)', () => {
        const { container } = render(<ThinkingIndicator isVisible runState={null} error={null} />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('renders nothing when hidden and not failed', () => {
        const { container } = render(<ThinkingIndicator isVisible={false} runState={null} error={null} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders a rotating label while thinking', () => {
        render(<ThinkingIndicator isVisible runState={null} error={null} />);
        expect(screen.getByTestId('thinking-indicator')).toBeTruthy();
        expect(screen.getByText('Thinking hard')).toBeTruthy();
    });

    it('rotates labels every 2600ms while visible', () => {
        render(<ThinkingIndicator isVisible runState="RUNNING" error={null} />);
        expect(screen.getByText('Thinking hard')).toBeInTheDocument();

        act(() => { vi.advanceTimersByTime(2600); });
        expect(screen.getByText('Analyzing context')).toBeInTheDocument();

        act(() => { vi.advanceTimersByTime(2600); });
        expect(screen.getByText('Processing your request')).toBeInTheDocument();

        act(() => { vi.advanceTimersByTime(2600); });
        expect(screen.getByText('Formulating a response')).toBeInTheDocument();

        act(() => { vi.advanceTimersByTime(2600); });
        expect(screen.getByText('Thinking hard')).toBeInTheDocument();
    });

    it('renders the error branch on FAILED', () => {
        render(<ThinkingIndicator isVisible runState="FAILED" error={{ message: 'Pyris exploded' }} />);
        expect(screen.getByRole('alert').textContent).toContain('Pyris exploded');
    });

    it('falls back to generic copy when the server sends no message', () => {
        render(<ThinkingIndicator isVisible runState="FAILED" error={null} />);
        expect(screen.getByRole('alert').textContent).toContain('An error occurred');
    });

    it('renders the error branch on FAILED even when not visible (run is over)', () => {
        render(<ThinkingIndicator isVisible={false} runState="FAILED" error={{ message: 'boom' }} />);
        expect(screen.getByRole('alert').textContent).toContain('boom');
    });

    it('has aria-live polite on the status text', () => {
        const { container } = render(<ThinkingIndicator isVisible runState="RUNNING" error={null} />);
        const ariaLive = container.querySelector('[aria-live="polite"]');
        expect(ariaLive).toBeInTheDocument();
    });
});
