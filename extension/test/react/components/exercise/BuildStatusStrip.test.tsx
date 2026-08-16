import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BuildStatusStrip } from '@webview/components/exercise/BuildStatusStrip';

describe('BuildStatusStrip', () => {
    const start = '2026-01-01T10:00:00.000Z';
    const eta = '2026-01-01T10:01:00.000Z';

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(start));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders nothing while the card is in view', () => {
        const { container } = render(
            <BuildStatusStrip status="building" cardInView onScrollToCard={() => undefined} />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing for completed states without a flash', () => {
        const { container } = render(
            <BuildStatusStrip status="success" cardInView={false} onScrollToCard={() => undefined} />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('shows countdown and ETA while building with timing info', () => {
        render(
            <BuildStatusStrip
                status="building"
                cardInView={false}
                buildStartDate={start}
                estimatedCompletionDate={eta}
                onScrollToCard={() => undefined}
            />,
        );
        expect(screen.getByText('Building…')).toBeInTheDocument();
        expect(screen.getByText('ETA: 60s')).toBeInTheDocument();
    });

    it('omits the ETA when timing info is missing', () => {
        render(
            <BuildStatusStrip status="building" cardInView={false} onScrollToCard={() => undefined} />,
        );
        expect(screen.getByText('Building…')).toBeInTheDocument();
        expect(screen.queryByText(/ETA:/)).not.toBeInTheDocument();
    });

    it('shows the queued message when pending', () => {
        render(
            <BuildStatusStrip status="pending" cardInView={false} onScrollToCard={() => undefined} />,
        );
        expect(screen.getByText('Build queued…')).toBeInTheDocument();
    });

    it('invokes onScrollToCard when the arrow is clicked', () => {
        const onScrollToCard = vi.fn();
        render(
            <BuildStatusStrip status="building" cardInView={false} onScrollToCard={onScrollToCard} />,
        );
        // fireEvent (not userEvent): userEvent's delays interact badly with fake timers
        fireEvent.click(screen.getByRole('button', { name: 'Scroll to build status' }));
        expect(onScrollToCard).toHaveBeenCalledTimes(1);
    });

    function renderBuildingThenComplete(
        completedProps: Partial<Parameters<typeof BuildStatusStrip>[0]> = {},
    ) {
        const result = render(
            <BuildStatusStrip status="building" cardInView={false} onScrollToCard={() => undefined} />,
        );
        result.rerender(
            <BuildStatusStrip
                status="partial"
                cardInView={false}
                onScrollToCard={() => undefined}
                {...completedProps}
            />,
        );
        return result;
    }

    it('flashes the test summary when the build finishes out of view', () => {
        renderBuildingThenComplete({ hasTestInfo: true, totalTests: 3, passedTests: 2 });
        expect(screen.getByText('2/3 tests passed')).toBeInTheDocument();
    });

    it('flashes "Build failed" when the build itself failed', () => {
        renderBuildingThenComplete({ status: 'failed', buildFailed: true });
        expect(screen.getByText('Build failed')).toBeInTheDocument();
    });

    it('prioritizes the build failure over test info in the flash', () => {
        renderBuildingThenComplete({
            status: 'failed',
            buildFailed: true,
            hasTestInfo: true,
            totalTests: 3,
            passedTests: 2,
        });
        expect(screen.getByText('Build failed')).toBeInTheDocument();
        expect(screen.queryByText('2/3 tests passed')).not.toBeInTheDocument();
    });

    it('applies a variant color class to the flash icon', () => {
        const { container } = renderBuildingThenComplete({ hasTestInfo: true, totalTests: 3, passedTests: 2 });
        // Lucide marks the scroll-button's chevron aria-hidden too, so pick
        // the svg OUTSIDE the button. Guards against the CSS-module lookup
        // silently resolving to undefined.
        const icon = Array.from(container.querySelectorAll('svg[aria-hidden="true"]'))
            .find((svg) => svg.closest('button') === null);
        expect(icon).toBeDefined();
        expect(icon?.getAttribute('class')).toMatch(/flashIcon/);
    });

    it('flashes "Build succeeded" without test info on success', () => {
        renderBuildingThenComplete({ status: 'success' });
        expect(screen.getByText('Build succeeded')).toBeInTheDocument();
    });

    it('flashes "Tests failed" without test info on failure', () => {
        renderBuildingThenComplete({ status: 'failed' });
        expect(screen.getByText('Tests failed')).toBeInTheDocument();
    });

    it('auto-fades the flash after 5 seconds', () => {
        renderBuildingThenComplete({ hasTestInfo: true, totalTests: 3, passedTests: 2 });
        expect(screen.getByText('2/3 tests passed')).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(5_000);
        });
        expect(screen.queryByText('2/3 tests passed')).not.toBeInTheDocument();
    });

    it('hides the flash as soon as the card scrolls into view', () => {
        const { rerender } = renderBuildingThenComplete({ hasTestInfo: true, totalTests: 3, passedTests: 2 });
        rerender(
            <BuildStatusStrip
                status="partial"
                cardInView
                hasTestInfo
                totalTests={3}
                passedTests={2}
                onScrollToCard={() => undefined}
            />,
        );
        expect(screen.queryByText('2/3 tests passed')).not.toBeInTheDocument();
    });

    it('does not flash when the build finishes while the card is in view', () => {
        const { rerender, container } = render(
            <BuildStatusStrip status="building" cardInView onScrollToCard={() => undefined} />,
        );
        rerender(
            <BuildStatusStrip
                status="partial"
                cardInView={false}
                hasTestInfo
                totalTests={3}
                passedTests={2}
                onScrollToCard={() => undefined}
            />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('shows the live strip again when a new build starts during a flash', () => {
        const { rerender } = renderBuildingThenComplete({ hasTestInfo: true, totalTests: 3, passedTests: 2 });
        rerender(
            <BuildStatusStrip status="building" cardInView={false} onScrollToCard={() => undefined} />,
        );
        expect(screen.getByText('Building…')).toBeInTheDocument();
        expect(screen.queryByText('2/3 tests passed')).not.toBeInTheDocument();
    });
});
