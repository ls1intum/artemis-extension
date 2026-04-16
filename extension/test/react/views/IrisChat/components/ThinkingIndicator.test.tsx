import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ThinkingIndicator } from '../../../../../src/webview/views/IrisChat/components/ThinkingIndicator';
import type { IrisStageDTO } from '../../../../../src/webview/views/IrisChat/types';

const makeStage = (overrides: Partial<IrisStageDTO> = {}): IrisStageDTO => ({
    name: 'thinking',
    weight: 10,
    state: 'IN_PROGRESS',
    message: 'Thinking hard',
    ...overrides,
});

describe('ThinkingIndicator', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders when isVisible is true (default)', () => {
        const { container } = render(<ThinkingIndicator isVisible={true} />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('returns null when isVisible is false', () => {
        const { container } = render(<ThinkingIndicator isVisible={false} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders three animated dots with no activeStage (fallback)', () => {
        const { container } = render(<ThinkingIndicator />);
        const dots = container.querySelectorAll('span');
        expect(dots.length).toBe(3);
    });

    it('dots have staggered animation delays', () => {
        const { container } = render(<ThinkingIndicator isVisible={true} />);
        const dots = container.querySelectorAll('span');
        expect((dots[0] as HTMLElement).style.animationDelay).toBe('0s');
        expect((dots[1] as HTMLElement).style.animationDelay).toBe('0.2s');
        expect((dots[2] as HTMLElement).style.animationDelay).toBe('0.4s');
    });

    it('shows stage label when activeStage is IN_PROGRESS', () => {
        render(<ThinkingIndicator activeStage={makeStage({ message: 'Thinking hard' })} />);
        expect(screen.getByText('Thinking hard')).toBeInTheDocument();
    });

    it('shows dots only (no label) when activeStage is NOT_STARTED', () => {
        const { container } = render(
            <ThinkingIndicator activeStage={makeStage({ state: 'NOT_STARTED' })} />
        );
        expect(screen.queryByText('Thinking hard')).not.toBeInTheDocument();
        const dots = container.querySelectorAll('span');
        expect(dots.length).toBe(3);
    });

    it('shows error state when activeStage is ERROR', () => {
        render(<ThinkingIndicator activeStage={makeStage({ state: 'ERROR', message: 'Something failed' })} />);
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('Something failed')).toBeInTheDocument();
    });

    it('shows default error message when ERROR stage has no message', () => {
        render(<ThinkingIndicator activeStage={makeStage({ state: 'ERROR', message: undefined })} />);
        expect(screen.getByText('An error occurred')).toBeInTheDocument();
    });

    it('rotates labels every 2600ms when IN_PROGRESS', () => {
        render(<ThinkingIndicator activeStage={makeStage()} />);
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

    it('has aria-live polite on status text', () => {
        const { container } = render(<ThinkingIndicator activeStage={makeStage()} />);
        const ariaLive = container.querySelector('[aria-live="polite"]');
        expect(ariaLive).toBeInTheDocument();
    });
});
