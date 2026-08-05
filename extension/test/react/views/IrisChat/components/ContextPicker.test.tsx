import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ContextPicker } from '@webview/views/IrisChat/components/ContextPicker';
import type { ContextItem } from '@webview/views/IrisChat/types';

/**
 * The topic picker's own behaviours. `irisChatConversationFirst.test.tsx`
 * covers when its entries are DISABLED (unknown content state, send in
 * flight); this file covers what it renders and what a click produces.
 */

const exercises: ContextItem[] = [
    { id: 10, title: 'Ex A', courseId: 1, dueDate: '2025-01-01T00:00:00Z' },
    { id: 11, title: 'Ex B', courseId: 1, dueDate: '2026-01-01T00:00:00Z', isWorkspace: true },
    { id: 20, title: 'Other course', courseId: 2 },
];

const props = {
    courseId: 1,
    exercises,
    committedContext: { mode: 'PROGRAMMING_EXERCISE_CHAT' as const, entityId: 10, name: 'Ex A' },
    contentState: 'content' as const,
    sendInFlight: false,
    onSelect: vi.fn(),
    onClose: vi.fn(),
};

/** Exercise row titles, in DOM order, with the "Workspace" badge stripped off. */
function visibleTitles(): string[] {
    return screen.getAllByRole('button')
        .filter((b) => b.getAttribute('data-testid')?.startsWith('picker-entry-') && b.getAttribute('data-testid') !== 'picker-entry-course')
        .map((b) => (b.textContent ?? '').replace(/Workspace$/, '').trim());
}

describe('ContextPicker (topic picker)', () => {
    it('renders a Course chat entry and this course\'s exercises only', () => {
        render(<ContextPicker {...props} />);
        expect(screen.getByText('Course chat')).toBeInTheDocument();
        expect(screen.getByText('Ex A')).toBeInTheDocument();
        expect(screen.getByText('Ex B')).toBeInTheDocument();
        // The host rejects a cross-course topic change outright, so listing
        // one would offer a pick that can only ever fail.
        expect(screen.queryByText('Other course')).not.toBeInTheDocument();
    });

    it('pins the workspace exercise first and badges it', () => {
        render(<ContextPicker {...props} />);
        const rows = screen.getAllByRole('button')
            .filter((b) => b.getAttribute('data-testid')?.startsWith('picker-entry-'));
        // Course chat is the fixed first entry; the workspace exercise leads
        // the exercises.
        expect(rows[0]).toHaveAttribute('data-testid', 'picker-entry-course');
        expect(rows[1]).toHaveAttribute('data-testid', 'picker-entry-11');
        expect(screen.getByText('Workspace')).toBeInTheDocument();
    });

    it('badges the workspace exercise reported by the host even when the tracked item does not say so', () => {
        // `workspaceExerciseId` comes from workspace detection, the
        // `isWorkspace` flag from the tracked store; either is enough.
        render(<ContextPicker {...props} exercises={[{ id: 10, title: 'Ex A', courseId: 1 }]} workspaceExerciseId={10} />);
        expect(screen.getByText('Workspace')).toBeInTheDocument();
    });

    it('marks exactly one active row, on `pending ?? committed`', () => {
        const { rerender } = render(<ContextPicker {...props} />);
        expect(screen.getAllByRole('button', { current: true })).toHaveLength(1);
        expect(screen.getByTestId('picker-entry-10')).toHaveAttribute('aria-current', 'true');

        // A staged topic wins over the committed one, so the checkmark and the
        // composer chip can never disagree about what the topic is.
        rerender(<ContextPicker {...props} pendingContext={{ mode: 'COURSE_CHAT', entityId: 1 }} />);
        expect(screen.getAllByRole('button', { current: true })).toHaveLength(1);
        expect(screen.getByTestId('picker-entry-course')).toHaveAttribute('aria-current', 'true');
    });

    it('selects the course-chat entry', () => {
        const onSelect = vi.fn();
        render(<ContextPicker {...props} onSelect={onSelect} />);
        fireEvent.click(screen.getByText('Course chat'));
        expect(onSelect).toHaveBeenCalledWith({ mode: 'COURSE_CHAT', entityId: 1 });
    });

    it('selects an exercise entry, carrying its display name', () => {
        const onSelect = vi.fn();
        render(<ContextPicker {...props} onSelect={onSelect} />);
        fireEvent.click(screen.getByText('Ex A'));
        expect(onSelect).toHaveBeenCalledWith({
            mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 10, name: 'Ex A',
        });
    });

    it('closes on Escape', () => {
        const onClose = vi.fn();
        render(<ContextPicker {...props} onClose={onClose} />);
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('orders the picker by workspace, then due date, then title, with no lastViewed on the wire', () => {
        const wireExercises = [
            { id: 3, title: 'Zulu', courseId: 1 },
            { id: 1, title: 'Alpha', courseId: 1, dueDate: '2030-01-01T00:00:00Z' },
            { id: 2, title: 'Bravo', courseId: 1 },
        ];
        render(<ContextPicker {...props} exercises={wireExercises} workspaceExerciseId={2} />);
        expect(visibleTitles()).toEqual(['Bravo', 'Alpha', 'Zulu']);
    });

    it('filters by title and by short name, and says so when nothing matches', () => {
        render(<ContextPicker {...props} />);
        fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'Ex B' } });
        expect(screen.getByText('Ex B')).toBeInTheDocument();
        expect(screen.queryByText('Ex A')).not.toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'zzz' } });
        expect(screen.getByText('No topics found')).toBeInTheDocument();
    });
});
