import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AskIris } from '@webview/components/AskIris/AskIris';

describe('AskIris proactive control', () => {
    const base = { description: 'd', onClick: () => {} };

    it('renders an On/Off switch when control is provided and toggles it', () => {
        const onToggle = vi.fn();
        render(<AskIris {...base} proactiveControl={{ preference: 'on', autoPaused: false, cardState: 'available', onToggle, onResume: () => {} }} />);
        fireEvent.click(screen.getByRole('switch', { name: /proactive/i }));
        expect(onToggle).toHaveBeenCalledWith(false);   // on -> off
    });

    it('shows the dismiss-caused pause + a Resume action', () => {
        const onResume = vi.fn();
        render(<AskIris {...base} proactiveControl={{ preference: 'on', autoPaused: true, cardState: 'available', onToggle: () => {}, onResume }} />);
        expect(screen.getByText(/dismissing recent hints/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /resume/i }));
        expect(onResume).toHaveBeenCalled();
    });

    it('renders no control when the prop is absent (unchanged AskIris)', () => {
        render(<AskIris {...base} />);
        expect(screen.queryByRole('switch')).toBeNull();
    });
});
