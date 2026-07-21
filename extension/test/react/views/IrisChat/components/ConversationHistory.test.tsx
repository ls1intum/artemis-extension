import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConversationHistory } from '@webview/views/IrisChat/components/ConversationHistory';
import type { ChatSession } from '@webview/views/IrisChat/types';

const sessions: ChatSession[] = [
    { id: 'a', preview: 'p', title: 'Untitled work', messageCount: 3, createdAt: 0, lastActivity: Date.now() - 60_000 },
    { id: 'b', preview: 'p', title: '', messageCount: 0, createdAt: 0, lastActivity: Date.now() - 120_000 },
];

const props = {
    sessions,
    activeSessionId: 'a',
    canCreateConversation: true,
    onSelectSession: vi.fn(),
    onNewConversation: vi.fn(),
    onClose: vi.fn(),
};

describe('ConversationHistory', () => {
    it('renders each session with its title (or the Untitled fallback) and marks the active one', () => {
        render(<ConversationHistory {...props} />);
        expect(screen.getByText('Untitled work')).toBeInTheDocument();
        expect(screen.getByText('Untitled conversation')).toBeInTheDocument();
        expect(screen.getAllByTestId('history-active')).toHaveLength(1);
    });

    it('clicking a row selects that session', () => {
        const onSelectSession = vi.fn();
        render(<ConversationHistory {...props} onSelectSession={onSelectSession} />);
        fireEvent.click(screen.getByText('Untitled conversation'));
        expect(onSelectSession).toHaveBeenCalledWith('b');
    });

    it('clicking "New conversation" fires onNewConversation when enabled', () => {
        const onNewConversation = vi.fn();
        render(<ConversationHistory {...props} onNewConversation={onNewConversation} />);
        fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
        expect(onNewConversation).toHaveBeenCalledOnce();
    });

    it('disables "New conversation" when canCreateConversation is false', () => {
        render(<ConversationHistory {...props} canCreateConversation={false} />);
        expect(screen.getByRole('button', { name: 'New conversation' })).toBeDisabled();
    });

    it('closes on Escape', () => {
        const onClose = vi.fn();
        render(<ConversationHistory {...props} onClose={onClose} />);
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('shows an empty state when there are no sessions', () => {
        render(<ConversationHistory {...props} sessions={[]} />);
        expect(screen.getByText('No conversations yet')).toBeInTheDocument();
    });
});
