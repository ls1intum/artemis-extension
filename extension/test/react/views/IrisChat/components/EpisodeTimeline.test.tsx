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
});
