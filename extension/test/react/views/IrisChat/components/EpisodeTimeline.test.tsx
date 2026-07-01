import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@webview/stores/useChatStore';
import { EpisodeTimeline } from '@webview/views/IrisChat/components/EpisodeTimeline';
import type { ChatMessage } from '@webview/views/IrisChat/types';

function msg(id: number, extra: Partial<ChatMessage> = {}): ChatMessage {
    return { id, localId: `l${id}`, role: 'assistant', origin: 'proactive', content: `m${id}`, timestamp: 0, proactiveEpisodeId: 'ep', ...extra };
}

beforeEach(() => {
    useChatStore.setState({
        staleAskBindings: new Map(), staleAnswers: new Map(),
        foldStates: new Map(), liveEpisodeIds: new Set(['ep']),
    });
});

describe('EpisodeTimeline', () => {
    it('renders a node per message and reflects a solved check-in', () => {
        const messages = [msg(1), msg(2, { proactiveKind: 'stale-check', staleAnswer: 'solved' }), msg(3)];
        render(<EpisodeTimeline messages={messages} episodeId="ep" dismissable renderRowBody={(m) => <div>{m.content}</div>} />);
        expect(screen.getByText('m1')).toBeInTheDocument();
        expect(screen.getByText('Iris reached out')).toBeInTheDocument();
        expect(document.querySelector('[data-node-state="solved"]')).not.toBeNull();
        expect(document.querySelectorAll('[data-node-kind="hint"]').length).toBe(2);
    });

    it('resolves multiple stale-checks in one episode independently (staleAskCap=2)', () => {
        // ep with: hint(1), check-in(2) UNANSWERED and not latest -> ignored, check-in(4) answered solved -> solved.
        const messages = [
            msg(1),
            msg(2, { proactiveKind: 'stale-check' }),
            msg(3),
            msg(4, { proactiveKind: 'stale-check', staleAnswer: 'solved' }),
        ];
        render(<EpisodeTimeline messages={messages} episodeId="ep" dismissable renderRowBody={(m) => <div>{m.content}</div>} />);
        // The unanswered, superseded earlier check-in is ignored; the later answered one is solved.
        expect(document.querySelector('[data-node-state="ignored"]')).not.toBeNull();
        expect(document.querySelector('[data-node-state="solved"]')).not.toBeNull();
    });

    it('shows a pending check-in when it is the latest of a live, unfolded episode', () => {
        const messages = [msg(1), msg(2, { proactiveKind: 'stale-check' })];
        render(<EpisodeTimeline messages={messages} episodeId="ep" dismissable renderRowBody={(m) => <div>{m.content}</div>} />);
        expect(document.querySelector('[data-node-state="pending"]')).not.toBeNull();
    });
});
