import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AskIris } from '@webview/components/AskIris/AskIris';

const base = { description: 'd', onClick: vi.fn() };
const control = (over: object) => ({
    preference: 'on' as const, autoPaused: false, cardState: 'available' as const,
    onToggle: vi.fn(), onResume: vi.fn(), ...over,
});

describe('AskIris card states (§12.2)', () => {
    it('available → interactive On/Off switch, Ask enabled', () => {
        render(<AskIris {...base} proactiveControl={control({})} />);
        expect(screen.getByRole('switch')).not.toBeDisabled();
        expect(screen.getByRole('button', { name: /ask/i })).not.toBeDisabled();
    });

    it('off-course → switch disabled + course note, Ask still enabled', () => {
        render(<AskIris {...base} proactiveControl={control({ cardState: 'off-course', reason: 'course-off' })} />);
        expect(screen.getByRole('switch')).toBeDisabled();
        expect(screen.getByText(/course/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /ask/i })).not.toBeDisabled();
    });

    it('unavailable → no switch, Ask disabled', () => {
        render(<AskIris {...base} proactiveControl={control({ cardState: 'unavailable', reason: 'iris-off' })} />);
        expect(screen.queryByRole('switch')).toBeNull();
        expect(screen.getByRole('button', { name: /ask/i })).toBeDisabled();
    });

    it('degraded → no switch, truthful note, Ask enabled', () => {
        render(<AskIris {...base} proactiveControl={control({ cardState: 'degraded', reason: 'limited' })} />);
        expect(screen.queryByRole('switch')).toBeNull();
        expect(screen.getByText('Proactive help is unavailable right now.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /ask/i })).not.toBeDisabled();
    });

    it('auto-pause names the dismiss reason and only shows on the available card', () => {
        const { rerender } = render(<AskIris {...base} proactiveControl={control({ autoPaused: true })} />);
        // Transparency (§12.2): the pause spells out WHY it paused (an explicit dismiss), not a bare "paused".
        expect(screen.getByText(/dismissing recent hints/i)).toBeInTheDocument();
        // Degraded hides the switch entirely (proactive is off), so the auto-pause affordance never shows either.
        rerender(<AskIris {...base} proactiveControl={control({ cardState: 'degraded', reason: 'limited', autoPaused: true })} />);
        expect(screen.queryByText(/dismissing recent hints/i)).toBeNull();
    });

    it('labels the switch so its purpose is visible, not just an opaque On/Off (§12.2 awareness)', () => {
        render(<AskIris {...base} proactiveControl={control({})} />);
        expect(screen.getByText('Proactive help')).toBeInTheDocument();
        // A tooltip explains what On/Off actually does.
        expect(screen.getByRole('switch')).toHaveAttribute('title', expect.stringMatching(/on its own/i));
    });

    it('no control → plain AskIris (no switch), Ask enabled', () => {
        render(<AskIris {...base} />);
        expect(screen.queryByRole('switch')).toBeNull();
        expect(screen.getByRole('button', { name: /ask/i })).not.toBeDisabled();
    });
});
