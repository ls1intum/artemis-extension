import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ContextPicker } from '@webview/views/IrisChat/components/ContextPicker';
import type { ChatContext, ContextItem } from '@webview/views/IrisChat/types';

const ctx: ChatContext = { type: 'exercise', id: 10, title: 'Ex A', courseId: 1, locked: false, source: 'user-selected' };
const exercises: ContextItem[] = [
    { id: 10, title: 'Ex A', courseId: 1, dueDate: '2025-01-01T00:00:00Z' },
    { id: 11, title: 'Ex B', courseId: 1, dueDate: '2026-01-01T00:00:00Z', isWorkspace: true },
];
const courses: ContextItem[] = [{ id: 1, title: 'Course One' }, { id: 2, title: 'Course Two' }];

const props = { context: ctx, exercises, courses, onSelectContext: vi.fn(), onClose: vi.fn() };

describe('ContextPicker', () => {
    it('renders a Course chat item and the course exercises', () => {
        render(<ContextPicker {...props} />);
        expect(screen.getByText('Course chat')).toBeInTheDocument();
        expect(screen.getByText('Ex A')).toBeInTheDocument();
        expect(screen.getByText('Ex B')).toBeInTheDocument();
    });
    it('pins the workspace exercise first with a Workspace badge', () => {
        render(<ContextPicker {...props} />);
        const items = screen.getAllByTestId('picker-exercise').map(n => n.textContent);
        expect(items[0]).toContain('Ex B');
        expect(screen.getByText('Workspace')).toBeInTheDocument();
    });
    it('selects an exercise context', () => {
        const onSelectContext = vi.fn();
        render(<ContextPicker {...props} onSelectContext={onSelectContext} />);
        fireEvent.click(screen.getByText('Ex A'));
        expect(onSelectContext).toHaveBeenCalledWith('exercise', 10, 'Ex A', undefined);
    });
    it('selects the course-chat context', () => {
        const onSelectContext = vi.fn();
        render(<ContextPicker {...props} onSelectContext={onSelectContext} />);
        fireEvent.click(screen.getByText('Course chat'));
        expect(onSelectContext).toHaveBeenCalledWith('course', 1, 'Course One', undefined);
    });
    it('closes on Escape', () => {
        const onClose = vi.fn();
        render(<ContextPicker {...props} onClose={onClose} />);
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });
    it('marks exactly one active row', () => {
        render(<ContextPicker {...props} />);
        expect(screen.getAllByTestId('picker-active')).toHaveLength(1);
    });
    it('search spans other courses, grouped by course', () => {
        const multi = {
            ...props,
            exercises: [
                { id: 10, title: 'Trees', courseId: 1 },
                { id: 20, title: 'Treaps', courseId: 2 },
            ] as ContextItem[],
        };
        render(<ContextPicker {...multi} />);
        fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'Tre' } });
        expect(screen.getByText('Trees')).toBeInTheDocument();
        expect(screen.getByText('Treaps')).toBeInTheDocument();
        expect(screen.getByText('Course One')).toBeInTheDocument();  // group header
        expect(screen.getByText('Course Two')).toBeInTheDocument();  // group header
    });
});
