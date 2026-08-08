import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatHeader } from '@webview/views/IrisChat/components/ChatHeader';

const noop = () => {};
const base = {
    courseTitle: 'Algorithms',
    conversationTitle: 'My chat',
    displayMessageCount: 3,
    onOpenCoursePicker: noop,
    onNewConversation: noop,
    onOpenHistory: noop,
};

describe('ChatHeader', () => {
    it('shows the course as the clickable label and the conversation meta below it', () => {
        render(<ChatHeader {...base} />);
        expect(screen.getByRole('button', { name: /Algorithms/ })).toBeInTheDocument();
        expect(screen.getByText(/My chat/)).toBeInTheDocument();
        expect(screen.getByText(/3 messages/)).toBeInTheDocument();
    });

    it('always renders new-conversation and history buttons with labels', () => {
        render(<ChatHeader {...base} />);
        expect(screen.getByLabelText('New conversation')).toBeInTheDocument();
        expect(screen.getByLabelText('View past conversations')).toBeInTheDocument();
    });

    it('fires the course-picker/history/new callbacks', () => {
        const onOpenCoursePicker = vi.fn(), onOpenHistory = vi.fn(), onNewConversation = vi.fn();
        render(<ChatHeader {...base} onOpenCoursePicker={onOpenCoursePicker} onOpenHistory={onOpenHistory} onNewConversation={onNewConversation} />);
        fireEvent.click(screen.getByRole('button', { name: /Algorithms/ }));
        fireEvent.click(screen.getByLabelText('View past conversations'));
        fireEvent.click(screen.getByLabelText('New conversation'));
        expect(onOpenCoursePicker).toHaveBeenCalledOnce();
        expect(onOpenHistory).toHaveBeenCalledOnce();
        expect(onNewConversation).toHaveBeenCalledOnce();
    });

    it('falls back to "Choose a course" and "New conversation" when nothing is named yet', () => {
        render(<ChatHeader {...base} courseTitle={null} conversationTitle={null} displayMessageCount={0} />);
        expect(screen.getByText('Choose a course')).toBeInTheDocument();
        expect(screen.getByText(/New conversation · 0 messages/)).toBeInTheDocument();
    });

    it('uses the singular for exactly one message', () => {
        render(<ChatHeader {...base} displayMessageCount={1} />);
        expect(screen.getByText(/1 message$/)).toBeInTheDocument();
    });

    describe('disableNavigation', () => {
        it('disables the course label, new-conversation, and history buttons', () => {
            render(<ChatHeader {...base} disableNavigation />);
            expect(screen.getByRole('button', { name: /Algorithms/ })).toBeDisabled();
            expect(screen.getByLabelText('New conversation')).toBeDisabled();
            expect(screen.getByLabelText('View past conversations')).toBeDisabled();
        });

        it('does not fire onOpenCoursePicker/onNewConversation/onOpenHistory when clicked', () => {
            const onOpenCoursePicker = vi.fn(), onOpenHistory = vi.fn(), onNewConversation = vi.fn();
            render(
                <ChatHeader
                    {...base}
                    disableNavigation
                    onOpenCoursePicker={onOpenCoursePicker}
                    onOpenHistory={onOpenHistory}
                    onNewConversation={onNewConversation}
                />
            );
            fireEvent.click(screen.getByRole('button', { name: /Algorithms/ }));
            fireEvent.click(screen.getByLabelText('View past conversations'));
            fireEvent.click(screen.getByLabelText('New conversation'));
            expect(onOpenCoursePicker).not.toHaveBeenCalled();
            expect(onOpenHistory).not.toHaveBeenCalled();
            expect(onNewConversation).not.toHaveBeenCalled();
        });

        it('is interactive again when disableNavigation is false (default)', () => {
            render(<ChatHeader {...base} />);
            expect(screen.getByRole('button', { name: /Algorithms/ })).not.toBeDisabled();
            expect(screen.getByLabelText('View past conversations')).not.toBeDisabled();
        });
    });
});
