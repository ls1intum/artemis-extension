import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@webview/stores/useChatStore';
import { EpisodeTimeline } from '@webview/views/IrisChat/components/EpisodeTimeline';
import styles from '@webview/views/IrisChat/components/EpisodeTimeline.module.css';
import type { ChatMessage } from '@webview/views/IrisChat/types';

function msg(id: number, extra: Partial<ChatMessage> = {}): ChatMessage {
    return { id, localId: `l${id}`, role: 'assistant', origin: 'proactive', content: `m${id}`, timestamp: 0, proactiveEpisodeId: 'ep', ...extra };
}

beforeEach(() => {
    useChatStore.setState({ foldStates: new Map(), liveEpisodeIds: new Set(['ep']) });
});

describe('EpisodeTimeline', () => {
    it('renders the caption and one hint node per message', () => {
        const messages = [msg(1), msg(2), msg(3)];
        render(<EpisodeTimeline messages={messages} episodeId="ep" dismissable renderRowBody={(m) => <div>{m.content}</div>} />);
        expect(screen.getByText('Iris reached out')).toBeInTheDocument();
        expect(screen.getByText('m1')).toBeInTheDocument();
        expect(screen.getByText('m3')).toBeInTheDocument();
        expect(document.querySelectorAll('[data-episode-row]').length).toBe(3);
    });

    it('renders no rail for a single-hint episode, but one per row from two hints on', () => {
        const { rerender } = render(
            <EpisodeTimeline messages={[msg(1)]} episodeId="ep" dismissable renderRowBody={(m) => <div>{m.content}</div>} />,
        );
        expect(screen.queryByTestId('timeline-rail')).toBeNull();

        rerender(
            <EpisodeTimeline messages={[msg(1), msg(2)]} episodeId="ep" dismissable renderRowBody={(m) => <div>{m.content}</div>} />,
        );
        expect(screen.getAllByTestId('timeline-rail').length).toBe(2);
    });

    it('renders a timestamp on every row', () => {
        render(<EpisodeTimeline messages={[msg(1), msg(2)]} episodeId="ep" dismissable renderRowBody={(m) => <div>{m.content}</div>} />);
        expect(screen.getAllByTestId('row-time').length).toBe(2);
    });

    it('shows exactly one Dismiss, on the latest row, only when dismissable', () => {
        const onDismiss = vi.fn();
        const messages = [msg(1), msg(2)];
        const { rerender } = render(
            <EpisodeTimeline messages={messages} episodeId="ep" dismissable onDismiss={onDismiss} renderRowBody={(m) => <div>{m.content}</div>} />,
        );
        expect(screen.getAllByRole('button', { name: 'Dismiss this suggestion' }).length).toBe(1);

        rerender(
            <EpisodeTimeline messages={messages} episodeId="ep" dismissable={false} onDismiss={onDismiss} renderRowBody={(m) => <div>{m.content}</div>} />,
        );
        expect(screen.queryByRole('button', { name: 'Dismiss this suggestion' })).toBeNull();
    });

    it('renders the condensed decision line for an answered stuck offer, and no answer buttons', () => {
        const messages = [msg(1, { offer: { offerId: 'off-1', moment: 'stuck', answered: 'accept' } })];
        render(
            <EpisodeTimeline
                messages={messages}
                episodeId="ep"
                dismissable
                onOfferAnswer={vi.fn()}
                renderRowBody={(m) => <div>{m.content}</div>}
            />,
        );
        expect(screen.getByText('Offered another hint · You: Show me')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Show me' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
    });

    it('renders the condensed decision line for an answered abandon offer that was declined', () => {
        const messages = [msg(1, { offer: { offerId: 'off-2', moment: 'abandon', answered: 'decline' } })];
        render(
            <EpisodeTimeline
                messages={messages}
                episodeId="ep"
                dismissable
                onOfferAnswer={vi.fn()}
                renderRowBody={(m) => <div>{m.content}</div>}
            />,
        );
        expect(screen.getByText("Checked in · You: I'm still on it")).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: "I'm still on it" })).toBeNull();
        expect(screen.queryByRole('button', { name: 'I need more help' })).toBeNull();
    });

    it('renders offer buttons only when dismissable (live episode); never in a folded/closed episode', () => {
        const onOfferAnswer = vi.fn();
        const messages = [msg(1, { offer: { offerId: 'off-3', moment: 'stuck' } })];
        const { rerender } = render(
            <EpisodeTimeline messages={messages} episodeId="ep" dismissable onOfferAnswer={onOfferAnswer} renderRowBody={(m) => <div>{m.content}</div>} />,
        );
        expect(screen.getByRole('button', { name: 'Show me' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();

        rerender(
            <EpisodeTimeline messages={messages} episodeId="ep" dismissable={false} onOfferAnswer={onOfferAnswer} renderRowBody={(m) => <div>{m.content}</div>} />,
        );
        expect(screen.queryByRole('button', { name: 'Show me' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
    });

    it('renders the invitation prompt for an unanswered stuck offer (not an empty body)', () => {
        const messages = [msg(1), msg(2, { content: '', offer: { offerId: 'off-4', moment: 'stuck' } })];
        render(<EpisodeTimeline messages={messages} episodeId="ep" dismissable onOfferAnswer={vi.fn()} renderRowBody={(m) => <div>{m.content}</div>} />);
        expect(screen.getByText('Still stuck on this? I can offer another hint.')).toBeInTheDocument();
    });

    it('renders the invitation prompt for an unanswered abandon offer', () => {
        const messages = [msg(1), msg(2, { content: '', offer: { offerId: 'off-5', moment: 'abandon' } })];
        render(<EpisodeTimeline messages={messages} episodeId="ep" dismissable onOfferAnswer={vi.fn()} renderRowBody={(m) => <div>{m.content}</div>} />);
        expect(screen.getByText('Still working on this? Want a hand?')).toBeInTheDocument();
    });

    it('pins the offer actions open at rest (persistent foot on the offer row, not the earlier hint)', () => {
        const messages = [msg(1), msg(2, { content: '', offer: { offerId: 'off-6', moment: 'stuck' } })];
        render(<EpisodeTimeline messages={messages} episodeId="ep" dismissable onOfferAnswer={vi.fn()} renderRowBody={(m) => <div>{m.content}</div>} />);
        const foots = screen.getAllByTestId('row-foot');
        expect(foots[foots.length - 1]).toHaveClass(styles.footPersistent);   // offer row (latest)
        expect(foots[0]).not.toHaveClass(styles.footPersistent);              // earlier hint stays hover-only
    });

    it('shows "Solved it" on the latest live row and calls onResolve with the message + episode id', () => {
        const onResolve = vi.fn();
        const messages = [msg(1), msg(2)];
        render(<EpisodeTimeline messages={messages} episodeId="ep" dismissable onResolve={onResolve} renderRowBody={(m) => <div>{m.content}</div>} />);
        const btn = screen.getByRole('button', { name: 'Solved it' });
        expect(btn).toBeInTheDocument();
        fireEvent.click(btn);
        expect(onResolve).toHaveBeenCalledWith(2, 'ep');
    });

    it('shows exactly one "Solved it", on the latest row, only when dismissable (live)', () => {
        const messages = [msg(1), msg(2)];
        const { rerender } = render(
            <EpisodeTimeline messages={messages} episodeId="ep" dismissable onResolve={vi.fn()} renderRowBody={(m) => <div>{m.content}</div>} />,
        );
        expect(screen.getAllByRole('button', { name: 'Solved it' }).length).toBe(1);

        rerender(
            <EpisodeTimeline messages={messages} episodeId="ep" dismissable={false} onResolve={vi.fn()} renderRowBody={(m) => <div>{m.content}</div>} />,
        );
        expect(screen.queryByRole('button', { name: 'Solved it' })).toBeNull();
    });

    it('a row that already carries a terminal outcome shows neither "Solved it" nor "Dismiss" (no double-close)', () => {
        const { rerender } = render(
            <EpisodeTimeline messages={[msg(1, { proactiveOutcome: 'RECOVERED' })]} episodeId="ep" dismissable onDismiss={vi.fn()} onResolve={vi.fn()} renderRowBody={(m) => <div>{m.content}</div>} />,
        );
        expect(screen.queryByRole('button', { name: 'Solved it' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Dismiss this suggestion' })).toBeNull();

        rerender(
            <EpisodeTimeline messages={[msg(1, { proactiveOutcome: 'DISMISSED' })]} episodeId="ep" dismissable onDismiss={vi.fn()} onResolve={vi.fn()} renderRowBody={(m) => <div>{m.content}</div>} />,
        );
        expect(screen.queryByRole('button', { name: 'Solved it' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Dismiss this suggestion' })).toBeNull();
    });

    it('pins Dismiss open at rest on the latest hint row (persistent foot)', () => {
        const messages = [msg(1), msg(2)];
        render(<EpisodeTimeline messages={messages} episodeId="ep" dismissable onDismiss={vi.fn()} renderRowBody={(m) => <div>{m.content}</div>} />);
        const foots = screen.getAllByTestId('row-foot');
        expect(foots[1]).toHaveClass(styles.footPersistent);                  // latest row carries Dismiss
        expect(foots[0]).not.toHaveClass(styles.footPersistent);
    });
});
