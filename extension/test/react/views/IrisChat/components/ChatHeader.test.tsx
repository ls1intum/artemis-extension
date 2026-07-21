import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatHeader } from '@webview/views/IrisChat/components/ChatHeader';
import type { ChatContext, ChatSession } from '@webview/views/IrisChat/types';

const exerciseCtx: ChatContext = { type: 'exercise', id: 5, title: 'Sorting Lab', locked: false, source: 'user-selected' };
const session: ChatSession = { id: 's1', preview: '', title: 'My chat', messageCount: 3, createdAt: 0, lastActivity: Date.now() };

const noop = () => {};
const base = { context: exerciseCtx, activeSession: session, courseName: 'Algorithms', canCreateConversation: true, onOpenContextPicker: noop, onNewConversation: noop, onOpenHistory: noop };

describe('ChatHeader', () => {
    it('shows exercise title bold with course name dim, and conversation meta', () => {
        render(<ChatHeader {...base} />);
        expect(screen.getByText('Sorting Lab')).toBeInTheDocument();
        expect(screen.getByText('Algorithms')).toBeInTheDocument();
        expect(screen.getByText('My chat')).toBeInTheDocument();
        expect(screen.getByText(/3 messages/)).toBeInTheDocument();
    });
    it('always renders new-conversation and history buttons with labels', () => {
        render(<ChatHeader {...base} />);
        expect(screen.getByLabelText('New conversation')).toBeInTheDocument();
        expect(screen.getByLabelText('View past conversations')).toBeInTheDocument();
    });
    it('disables new-conversation when canCreateConversation is false', () => {
        render(<ChatHeader {...base} canCreateConversation={false} />);
        expect(screen.getByLabelText('New conversation')).toBeDisabled();
    });
    it('fires the picker/history/new callbacks', () => {
        const onOpenContextPicker = vi.fn(), onOpenHistory = vi.fn(), onNewConversation = vi.fn();
        render(<ChatHeader {...base} onOpenContextPicker={onOpenContextPicker} onOpenHistory={onOpenHistory} onNewConversation={onNewConversation} />);
        fireEvent.click(screen.getByRole('button', { name: /Sorting Lab/ }));
        fireEvent.click(screen.getByLabelText('View past conversations'));
        fireEvent.click(screen.getByLabelText('New conversation'));
        expect(onOpenContextPicker).toHaveBeenCalledOnce();
        expect(onOpenHistory).toHaveBeenCalledOnce();
        expect(onNewConversation).toHaveBeenCalledOnce();
    });
    it('falls back to "New conversation" title and "Course chat" secondary for a course context', () => {
        render(<ChatHeader {...base} context={{ type: 'course', id: 2, title: 'Algorithms', locked: false, source: 'user-selected' }} activeSession={undefined} courseName={null} />);
        expect(screen.getByText('New conversation')).toBeInTheDocument();
        expect(screen.getByText('Course chat')).toBeInTheDocument();
    });

    describe('disableNavigation', () => {
        it('disables the context row, new-conversation, and history buttons', () => {
            render(<ChatHeader {...base} disableNavigation />);
            expect(screen.getByRole('button', { name: /Sorting Lab/ })).toBeDisabled();
            expect(screen.getByLabelText('New conversation')).toBeDisabled();
            expect(screen.getByLabelText('View past conversations')).toBeDisabled();
        });

        it('does not fire onOpenContextPicker/onNewConversation/onOpenHistory when clicked', () => {
            const onOpenContextPicker = vi.fn(), onOpenHistory = vi.fn(), onNewConversation = vi.fn();
            render(
                <ChatHeader
                    {...base}
                    disableNavigation
                    onOpenContextPicker={onOpenContextPicker}
                    onOpenHistory={onOpenHistory}
                    onNewConversation={onNewConversation}
                />
            );
            fireEvent.click(screen.getByRole('button', { name: /Sorting Lab/ }));
            fireEvent.click(screen.getByLabelText('View past conversations'));
            fireEvent.click(screen.getByLabelText('New conversation'));
            expect(onOpenContextPicker).not.toHaveBeenCalled();
            expect(onOpenHistory).not.toHaveBeenCalled();
            expect(onNewConversation).not.toHaveBeenCalled();
        });

        it('is interactive again when disableNavigation is false (default)', () => {
            render(<ChatHeader {...base} />);
            expect(screen.getByRole('button', { name: /Sorting Lab/ })).not.toBeDisabled();
            expect(screen.getByLabelText('View past conversations')).not.toBeDisabled();
        });
    });
});
