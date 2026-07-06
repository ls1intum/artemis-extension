import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AskIris } from '@webview/components/AskIris/AskIris';

describe('AskIris proactive control', () => {
    const base = { description: 'd', onClick: () => {} };

    it('renders the Off/Less/More segments, marks the current level, and reports a pick', () => {
        const onLevelChange = vi.fn();
        render(<AskIris {...base} proactiveControl={{ level: 'more', autoPaused: false, cardState: 'available', onLevelChange, onResume: () => {} }} />);
        expect(screen.getAllByRole('radio').map(s => s.textContent)).toEqual(['Off', 'Less', 'More']);
        expect(screen.getByRole('radio', { name: 'More' })).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(screen.getByRole('radio', { name: 'Off' }));
        expect(onLevelChange).toHaveBeenCalledWith('off');
    });

    it('shows the dismiss-caused pause + a Resume action', () => {
        const onResume = vi.fn();
        render(<AskIris {...base} proactiveControl={{ level: 'more', autoPaused: true, cardState: 'available', onLevelChange: () => {}, onResume }} />);
        expect(screen.getByText(/dismissing recent hints/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /resume/i }));
        expect(onResume).toHaveBeenCalled();
    });

    it('renders no proactive section when the prop is absent (plain AskIris)', () => {
        render(<AskIris {...base} />);
        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(screen.queryByText('Proactive help')).toBeNull();
    });
});
