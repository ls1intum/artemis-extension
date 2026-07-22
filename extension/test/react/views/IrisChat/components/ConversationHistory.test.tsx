import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConversationHistory } from '@webview/views/IrisChat/components/ConversationHistory';
import type { CourseHistoryEntryVM } from '@webview/views/IrisChat/historyBuckets';

const NOW = Date.now();

const entries: CourseHistoryEntryVM[] = [
    {
        artemisSessionId: 1,
        courseId: 7,
        mode: 'COURSE_CHAT',
        entityId: 7,
        title: 'General questions',
        lastActivity: NOW - 60_000,
    },
    {
        artemisSessionId: 2,
        courseId: 7,
        mode: 'PROGRAMMING_EXERCISE_CHAT',
        entityId: 42,
        entityName: 'Sorting Algorithms',
        title: '',
        lastActivity: NOW - 5 * 24 * 60 * 60 * 1000,
    },
];

const props = {
    entries,
    status: 'ready' as const,
    activeArtemisSessionId: 1,
    canCreateConversation: true,
    openError: null,
    onSelectEntry: vi.fn(),
    onNewConversation: vi.fn(),
    onRetry: vi.fn(),
    onClose: vi.fn(),
};

describe('ConversationHistory', () => {
    it('renders entries grouped under time buckets', () => {
        render(<ConversationHistory {...props} />);
        expect(screen.getByText('Today')).toBeInTheDocument();
        expect(screen.getByText('Last 7 days')).toBeInTheDocument();
    });

    it('falls back to "Untitled conversation" when title is missing/empty', () => {
        render(<ConversationHistory {...props} />);
        expect(screen.getByText('Untitled conversation')).toBeInTheDocument();
    });

    it('shows entityName as the context label, falling back to "Course chat"', () => {
        render(<ConversationHistory {...props} />);
        expect(screen.getByText((text) => text.includes('Sorting Algorithms'))).toBeInTheDocument();
        expect(screen.getByText((text) => text.includes('Course chat'))).toBeInTheDocument();
    });

    it('marks the entry matching activeArtemisSessionId as active', () => {
        render(<ConversationHistory {...props} />);
        expect(screen.getAllByTestId('history-active')).toHaveLength(1);
    });

    it('clicking a row calls onSelectEntry with that entry AND does not close the popover', () => {
        const onSelectEntry = vi.fn();
        const onClose = vi.fn();
        render(<ConversationHistory {...props} onSelectEntry={onSelectEntry} onClose={onClose} />);
        fireEvent.click(screen.getByText('Untitled conversation'));
        expect(onSelectEntry).toHaveBeenCalledWith(entries[1]);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('clicking the already-active row does not call onSelectEntry, and closes the popover instead', () => {
        const onSelectEntry = vi.fn();
        const onClose = vi.fn();
        render(<ConversationHistory {...props} onSelectEntry={onSelectEntry} onClose={onClose} />);
        fireEvent.click(screen.getByText('General questions'));
        expect(onSelectEntry).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledOnce();
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

    it('shows an empty state when there are no entries and status is ready', () => {
        render(<ConversationHistory {...props} entries={[]} status="ready" />);
        expect(screen.getByText('No past conversations')).toBeInTheDocument();
    });

    it('shows a loading skeleton (no rows, no empty-state text) while status is loading', () => {
        render(<ConversationHistory {...props} entries={[]} status="loading" />);
        expect(screen.queryByText('No past conversations')).not.toBeInTheDocument();
        expect(screen.queryByText('Today')).not.toBeInTheDocument();
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
    });

    it('shows an error state with a Retry button when status is error, and Retry calls onRetry', () => {
        const onRetry = vi.fn();
        render(<ConversationHistory {...props} entries={[]} status="error" onRetry={onRetry} />);
        const retryButton = screen.getByRole('button', { name: 'Retry' });
        fireEvent.click(retryButton);
        expect(onRetry).toHaveBeenCalledOnce();
    });

    it('renders openError as an inline banner inside the popover', () => {
        render(<ConversationHistory {...props} openError="That conversation is no longer available." />);
        expect(screen.getByRole('alert')).toHaveTextContent('That conversation is no longer available.');
    });

    it('renders no alert banner when openError is null', () => {
        render(<ConversationHistory {...props} openError={null} />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
