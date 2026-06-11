import { fireEvent, render, screen } from '@testing-library/react';
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

    // ── Live states ──────────────────────────────────────────────────────

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

    // ── Arrow button ─────────────────────────────────────────────────────

    it('invokes onScrollToCard when the arrow is clicked', () => {
        const onScrollToCard = vi.fn();
        render(
            <BuildStatusStrip status="building" cardInView={false} onScrollToCard={onScrollToCard} />,
        );
        // fireEvent (not userEvent): userEvent's delays interact badly with fake timers
        fireEvent.click(screen.getByRole('button', { name: 'Scroll to build status' }));
        expect(onScrollToCard).toHaveBeenCalledTimes(1);
    });
});
