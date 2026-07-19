import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AskIris } from '@webview/components/AskIris/AskIris';
import styles from '@webview/components/AskIris/AskIris.module.css';

const base = { description: 'd', onClick: vi.fn() };
const control = (over: object) => ({
    level: 'more' as const, cardState: 'available' as const,
    controlAvailable: true as const,
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

    it('degraded/consent-missing → disabled segments with Off active, hint + settings link, Ask enabled (#342)', () => {
        const onOpen = vi.fn();
        render(<AskIris {...base} proactiveControl={control({ cardState: 'degraded', reason: 'consent-missing', level: 'off', onOpenConsentSettings: onOpen })} />);
        screen.getAllByRole('radio').forEach(seg => expect(seg).toBeDisabled());
        expect(screen.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByText(/needs your consent/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /enable in settings/i }));
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: /ask/i })).not.toBeDisabled();
    });

    it('degraded/limited stays segment-free (only the consent case gets the forced-Off control)', () => {
        render(<AskIris {...base} proactiveControl={control({ cardState: 'degraded', reason: 'limited' })} />);
        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(screen.getByText('Proactive help is unavailable right now.')).toBeInTheDocument();
    });

    it('unavailable/iris-off → neutral notice, honest description, no proactive section, Ask disabled', () => {
        render(<AskIris {...base} proactiveControl={control({ cardState: 'unavailable', reason: 'iris-off' })} />);
        expect(screen.getByText('Iris is not available for this exercise.')).toBeInTheDocument();
        expect(screen.getByText('The Iris chat is turned off here.')).toBeInTheDocument();
        expect(screen.queryByText(/Open the Iris chat/i)).toBeNull();
        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(screen.getByRole('button', { name: /ask/i })).toBeDisabled();
    });
    it('unavailable/noai → the .noai notice', () => {
        render(<AskIris {...base} proactiveControl={control({ cardState: 'unavailable', reason: 'noai' })} />);
        expect(screen.getByText('A .noai file disables Iris for this repository, including the chat.')).toBeInTheDocument();
    });
    it('unavailable with no reason → generic notice fallback', () => {
        render(<AskIris {...base} proactiveControl={control({ cardState: 'unavailable', reason: undefined })} />);
        expect(screen.getByText('Iris is not available for this exercise.')).toBeInTheDocument();
    });
    it.each([
        { cardState: 'available' as const, reason: undefined },
        { cardState: 'off-course' as const, reason: 'course-off' as const },
        { cardState: 'degraded' as const, reason: 'limited' as const },
        { cardState: 'degraded' as const, reason: 'consent-missing' as const },
    ])('chat-active $cardState/$reason keeps the passed description and renders no notice', ({ cardState, reason }) => {
        render(<AskIris {...base} proactiveControl={control({ cardState, reason, level: reason === 'consent-missing' ? 'off' : 'more', onOpenConsentSettings: vi.fn() })} />);
        expect(screen.getByText('d')).toBeInTheDocument();
        expect(screen.queryByRole('status')).toBeNull();
    });
    it('unavailable → the disabled Ask carries the neutral unavailableAsk class', () => {
        render(<AskIris {...base} proactiveControl={control({ cardState: 'unavailable', reason: 'noai' })} />);
        expect(screen.getByRole('button', { name: /ask/i })).toHaveClass(styles.unavailableAsk);
    });
    it('clean build (controlAvailable false) + available → bare card, no segments, Ask enabled', () => {
        render(<AskIris {...base} proactiveControl={control({ cardState: 'available', controlAvailable: false })} />);
        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(screen.queryByText('Proactive help')).toBeNull();
        expect(screen.getByText('d')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /ask/i })).not.toBeDisabled();
    });
    it('clean build (controlAvailable false) + unavailable/noai → off-card still renders', () => {
        render(<AskIris {...base} proactiveControl={control({ cardState: 'unavailable', reason: 'noai', controlAvailable: false })} />);
        expect(screen.getByText('A .noai file disables Iris for this repository, including the chat.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /ask/i })).toBeDisabled();
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
