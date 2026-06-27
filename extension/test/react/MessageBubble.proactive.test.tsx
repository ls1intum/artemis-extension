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
        expect(container.textContent).toContain('Iris thought this might help');
    });

    it('shows a Dismiss control on an un-dismissed proactive bubble', () => {
        const onDismiss = vi.fn();
        render(<MessageBubble message={proactive({ id: 7 })} onFeedback={() => {}} onDismiss={onDismiss} />);
        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
        expect(onDismiss).toHaveBeenCalledWith(7);
    });

    it('renders the thumbs and Dismiss in one action bar, thumbs left and Dismiss right', () => {
        render(<MessageBubble message={proactive({ id: 7 })} onFeedback={() => {}} onDismiss={() => {}} />);
        const thumbUp = screen.getByRole('button', { name: 'Helpful' });
        const dismiss = screen.getByRole('button', { name: /dismiss/i });

        // Thumbs and Dismiss share the action bar (visually revealed on hover via CSS),
        // with Dismiss after the thumbs in document order.
        const actionRow = thumbUp.parentElement?.parentElement;
        expect(actionRow).toContainElement(dismiss);
        expect(thumbUp.compareDocumentPosition(dismiss) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders a dismissed proactive bubble collapsed but keeps the caption (never deleted)', () => {
        const { container } = render(
            <MessageBubble message={proactive({ id: 7, proactiveOutcome: 'DISMISSED', content: 'secret body' })} onFeedback={() => {}} />,
        );
        expect(container.textContent).toContain('Iris thought this might help');
        expect(container.textContent).not.toContain('secret body');
        // The dismissed bubble offers an expand toggle, NOT the Dismiss action (the toggle's label avoids "dismiss").
        expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
    });
});
