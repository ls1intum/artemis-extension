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

    it('degraded → switch present + limited note, Ask enabled', () => {
        render(<AskIris {...base} proactiveControl={control({ cardState: 'degraded', reason: 'limited' })} />);
        expect(screen.getByRole('switch')).toBeInTheDocument();
        expect(screen.getByText(/limited/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /ask/i })).not.toBeDisabled();
    });

    it('auto-paused only shows on the available card', () => {
        const { rerender } = render(<AskIris {...base} proactiveControl={control({ autoPaused: true })} />);
        expect(screen.getByText(/auto-paused/i)).toBeInTheDocument();
        // Degraded keeps the switch but never the auto-paused affordance (the card already says "limited").
        rerender(<AskIris {...base} proactiveControl={control({ cardState: 'degraded', reason: 'limited', autoPaused: true })} />);
        expect(screen.queryByText(/auto-paused/i)).toBeNull();
    });

    it('no control → plain AskIris (no switch), Ask enabled', () => {
        render(<AskIris {...base} />);
        expect(screen.queryByRole('switch')).toBeNull();
        expect(screen.getByRole('button', { name: /ask/i })).not.toBeDisabled();
    });
});
