import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AskIris } from '@webview/components/AskIris/AskIris';

const base = { description: 'd', onClick: vi.fn() };
const control = (over: object) => ({
    level: 'more' as const, cardState: 'available' as const,
    onLevelChange: vi.fn(), ...over,
});

describe('AskIris card states (§12.2)', () => {
    it('available → interactive Off/Less/More segments, Ask enabled', () => {
        render(<AskIris {...base} proactiveControl={control({})} />);
        screen.getAllByRole('radio').forEach(seg => expect(seg).not.toBeDisabled());
        expect(screen.getByRole('button', { name: /ask/i })).not.toBeDisabled();
    });

    it('off-course → segments disabled + course note, Ask still enabled', () => {
        render(<AskIris {...base} proactiveControl={control({ cardState: 'off-course', reason: 'course-off' })} />);
        screen.getAllByRole('radio').forEach(seg => expect(seg).toBeDisabled());
        expect(screen.getByText(/course/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /ask/i })).not.toBeDisabled();
    });

    it('unavailable → no proactive section, Ask disabled', () => {
        render(<AskIris {...base} proactiveControl={control({ cardState: 'unavailable', reason: 'iris-off' })} />);
        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(screen.queryByText('Proactive help')).toBeNull();
        expect(screen.getByRole('button', { name: /ask/i })).toBeDisabled();
    });

    it('degraded → no segments, truthful note, Ask enabled', () => {
        render(<AskIris {...base} proactiveControl={control({ cardState: 'degraded', reason: 'limited' })} />);
        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(screen.getByText('Proactive help is unavailable right now.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /ask/i })).not.toBeDisabled();
    });

    it('never renders a Paused/Resume affordance (removed with the level rework)', () => {
        render(<AskIris {...base} proactiveControl={control({})} />);
        expect(screen.queryByText(/paused/i)).toBeNull();
        expect(screen.queryByRole('button', { name: /resume/i })).toBeNull();
    });

    it('labels the control so its purpose is visible, not just opaque segments (§12.2 awareness)', () => {
        render(<AskIris {...base} proactiveControl={control({})} />);
        expect(screen.getByText('Proactive help')).toBeInTheDocument();
        // A tooltip explains what the levels actually do.
        expect(screen.getAllByRole('radio')[0]).toHaveAttribute('title', expect.stringMatching(/on its own/i));
    });

    it('no control → plain AskIris (no segments), Ask enabled', () => {
        render(<AskIris {...base} />);
        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(screen.getByRole('button', { name: /ask/i })).not.toBeDisabled();
    });
});
