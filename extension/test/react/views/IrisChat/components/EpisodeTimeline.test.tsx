import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@webview/stores/useChatStore';
import { EpisodeTimeline } from '@webview/views/IrisChat/components/EpisodeTimeline';
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
});
