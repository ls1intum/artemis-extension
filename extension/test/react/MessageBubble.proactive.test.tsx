import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MessageBubble } from '@webview/views/IrisChat/components/MessageBubble';
import type { ChatMessage } from '@webview/views/IrisChat/types';

function proactive(overrides: Partial<ChatMessage> = {}): ChatMessage {
    return {
        localId: '1',
        role: 'assistant',
        content: 'Have you checked the empty-list case?',
        timestamp: 0,
        origin: 'proactive',
        status: 'sent',
        ...overrides,
    };
}

describe('MessageBubble proactive', () => {
    it('marks a proactive assistant bubble distinctly', () => {
        const { container } = render(<MessageBubble message={proactive()} onFeedback={() => {}} />);
        expect(container.querySelector('[data-origin="proactive"]')).not.toBeNull();
        expect(container.textContent).toContain('Iris reached out');
    });

    it('shows a Dismiss control on an un-dismissed proactive bubble', () => {
        const onDismiss = vi.fn();
        render(<MessageBubble message={proactive({ id: 7 })} onFeedback={() => {}} onDismiss={onDismiss} />);
        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
        // C8: dismiss passes (messageId, proactiveEpisodeId); undefined when the message has none.
        expect(onDismiss).toHaveBeenCalledWith(7, undefined);
    });

    it('removes thumbs from a proactive bubble but keeps Dismiss', () => {
        render(<MessageBubble message={proactive({ id: 7 })} onFeedback={() => {}} onDismiss={() => {}} />);
        expect(screen.queryByRole('button', { name: 'Helpful' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Not helpful' })).toBeNull();
        expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
    });

    it('in grouped mode renders NO bubble-level Dismiss (the timeline footer owns it)', () => {
        render(<MessageBubble message={proactive({ id: 7 })} onFeedback={() => {}} onDismiss={() => {}} grouped />);
        expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
    });

    it('keeps thumbs on a normal (non-proactive) assistant reply', () => {
        const normal: ChatMessage = {
            localId: 'n1', role: 'assistant', content: 'Here is the answer.', timestamp: 0, status: 'sent',
        };
        render(<MessageBubble message={normal} onFeedback={() => {}} />);
        expect(screen.getByRole('button', { name: 'Helpful' })).toBeInTheDocument();
    });

    it('renders a dismissed proactive bubble collapsed but keeps the caption (never deleted)', () => {
        const { container } = render(
            <MessageBubble message={proactive({ id: 7, proactiveOutcome: 'DISMISSED', content: 'secret body' })} onFeedback={() => {}} />,
        );
        expect(container.textContent).toContain('Iris reached out');
        expect(container.textContent).not.toContain('secret body');
        // The dismissed bubble offers an expand toggle, NOT the Dismiss action (the toggle's label avoids "dismiss").
        expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
    });

    it('in grouped mode renders NO caption (the episode block owns the single header)', () => {
        const { container } = render(<MessageBubble message={proactive()} onFeedback={() => {}} grouped />);
        expect(container.textContent).not.toContain('Iris reached out');
        expect(container.textContent).toContain('Have you checked the empty-list case?');
    });

    it('in grouped mode a DISMISSED row shows its content (no per-row collapse; the fold is the collapse)', () => {
        const { container } = render(
            <MessageBubble message={proactive({ id: 7, proactiveOutcome: 'DISMISSED', content: 'secret body' })} onFeedback={() => {}} grouped />,
        );
        expect(container.textContent).toContain('secret body');
        expect(screen.queryByText('Show suggestion')).toBeNull();
    });
});
