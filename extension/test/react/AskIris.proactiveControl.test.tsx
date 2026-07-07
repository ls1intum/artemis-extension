import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AskIris } from '@webview/components/AskIris/AskIris';

describe('AskIris proactive control', () => {
    const base = { description: 'd', onClick: () => {} };

    it('renders the Off/Less/More segments, marks the current level, and reports a pick', () => {
        const onLevelChange = vi.fn();
        render(<AskIris {...base} proactiveControl={{ level: 'more', cardState: 'available', onLevelChange }} />);
        expect(screen.getAllByRole('radio').map(s => s.textContent)).toEqual(['Off', 'Less', 'More']);
        expect(screen.getByRole('radio', { name: 'More' })).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(screen.getByRole('radio', { name: 'Off' }));
        expect(onLevelChange).toHaveBeenCalledWith('off');
    });

    it('reports a pick of "less" too (both non-off levels post the real level, no local shim)', () => {
        const onLevelChange = vi.fn();
        render(<AskIris {...base} proactiveControl={{ level: 'off', cardState: 'available', onLevelChange }} />);
        fireEvent.click(screen.getByRole('radio', { name: 'Less' }));
        expect(onLevelChange).toHaveBeenCalledWith('less');
    });

    it('never renders a Resume affordance (Paused/Resume was removed with the level rework)', () => {
        render(<AskIris {...base} proactiveControl={{ level: 'more', cardState: 'available', onLevelChange: () => {} }} />);
        expect(screen.queryByRole('button', { name: /resume/i })).toBeNull();
        expect(screen.queryByText(/paused/i)).toBeNull();
    });

    it('renders no proactive section when the prop is absent (plain AskIris)', () => {
        render(<AskIris {...base} />);
        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(screen.queryByText('Proactive help')).toBeNull();
    });
});
