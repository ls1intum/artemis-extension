import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConversationHistory } from '@webview/views/IrisChat/components/ConversationHistory';
import type { ConversationSummary } from '@webview/views/IrisChat/types';

const NOW = Date.now();

const conversations: ConversationSummary[] = [
    {
        sessionId: 1,
        courseId: 7,
        mode: 'COURSE_CHAT',
        entityId: 7,
        title: 'General questions',
        lastActivity: NOW - 60_000,
    },
    {
        sessionId: 2,
        courseId: 7,
        mode: 'PROGRAMMING_EXERCISE_CHAT',
        entityId: 42,
        entityName: 'Sorting Algorithms',
        title: '',
        lastActivity: NOW - 5 * 24 * 60 * 60 * 1000,
    },
    {
        sessionId: 3,
        courseId: 7,
        mode: 'COURSE_CHAT',
        entityId: 7,
        entityName: 'Graph Traversal',
        title: 'Older discussion',
        lastActivity: NOW - 15 * 24 * 60 * 60 * 1000,
    },
];

const props = {
    conversations,
    currentSessionId: 1,
    onOpen: vi.fn(),
    onNewConversation: vi.fn(),
    onClose: vi.fn(),
};

describe('ConversationHistory', () => {
    it('renders conversations grouped under time buckets', () => {
        render(<ConversationHistory {...props} />);
        expect(screen.getByText('Today')).toBeInTheDocument();
        expect(screen.getByText('Last 7 days')).toBeInTheDocument();
        expect(screen.getByText('Last 30 days')).toBeInTheDocument();
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

    // THE SHAPE THE HOST ACTUALLY PRODUCES on every detail load: only the
    // overview endpoint carries `entityName`. Labelling this row "Course chat"
    // is not a missing label, it is a wrong one.
    it('names a nameless row by its mode instead of calling it a course chat', () => {
        const nameless: ConversationSummary[] = [{
            sessionId: 4,
            courseId: 7,
            mode: 'PROGRAMMING_EXERCISE_CHAT',
            entityId: 42,
            title: 'BFS loop',
            lastActivity: NOW - 60_000,
        }];
        render(<ConversationHistory {...props} conversations={nameless} />);
        expect(screen.getByText('Exercise 42')).toBeInTheDocument();
        expect(screen.queryByText('Course chat')).toBeNull();
    });

    it('marks the conversation matching currentSessionId as active', () => {
        render(<ConversationHistory {...props} />);
        expect(screen.getAllByTestId('history-active')).toHaveLength(1);
    });

    it('clicking a row calls onOpen with that conversation AND does not close the popover', () => {
        const onOpen = vi.fn();
        const onClose = vi.fn();
        render(<ConversationHistory {...props} onOpen={onOpen} onClose={onClose} />);
        fireEvent.click(screen.getByText('Untitled conversation'));
        expect(onOpen).toHaveBeenCalledWith(conversations[1]);
        // Staying open is what gives a resulting `openError` a visible
        // destination; the caller closes it once the conversation changes.
        expect(onClose).not.toHaveBeenCalled();
    });

    it('clicking the already-open row does not call onOpen, and closes the popover instead', () => {
        const onOpen = vi.fn();
        const onClose = vi.fn();
        render(<ConversationHistory {...props} onOpen={onOpen} onClose={onClose} />);
        fireEvent.click(screen.getByText('General questions'));
        expect(onOpen).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('clicking "New conversation" fires onNewConversation', () => {
        const onNewConversation = vi.fn();
        render(<ConversationHistory {...props} onNewConversation={onNewConversation} />);
        fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
        expect(onNewConversation).toHaveBeenCalledOnce();
    });

    it('closes on Escape', () => {
        const onClose = vi.fn();
        render(<ConversationHistory {...props} onClose={onClose} />);
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('shows an empty state when the course has no conversations', () => {
        render(<ConversationHistory {...props} conversations={[]} />);
        expect(screen.getByText('No conversations')).toBeInTheDocument();
    });

    it('renders openError as an inline banner inside the popover', () => {
        render(<ConversationHistory {...props} openError="That conversation is no longer available." />);
        expect(screen.getByRole('alert')).toHaveTextContent('That conversation is no longer available.');
    });

    it('renders no alert banner when openError is null', () => {
        render(<ConversationHistory {...props} openError={null} />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('filters by title and by entity name', () => {
        render(<ConversationHistory {...props} />);
        fireEvent.change(screen.getByPlaceholderText('Search conversations…'), { target: { value: 'sorting' } });
        expect(screen.getByText('Untitled conversation')).toBeInTheDocument();
        expect(screen.queryByText('General questions')).not.toBeInTheDocument();
    });
});
