import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ContextSelector } from '@webview/views/IrisChat/components/ContextSelector';
import type { ChatContext, ChatSession, ContextItem } from '@webview/views/IrisChat/types';

function makeContextItem(id: number, title: string, overrides: Partial<ContextItem> = {}): ContextItem {
	return { id, title, ...overrides };
}

function makeSession(id: string, messageCount: number): ChatSession {
	return {
		id,
		preview: `Preview of session ${id}`,
		messageCount,
		createdAt: Date.now() - 10000,
		lastActivity: Date.now() - 5000,
	};
}

const defaultProps = {
	context: null,
	sessions: [],
	activeSessionId: null,
	exercises: [],
	courses: [],
	onSelectContext: vi.fn(),
	onSelectSession: vi.fn(),
	onCreateNewSession: vi.fn(),
	onSwitchToWorkspace: vi.fn(),
};

describe('ContextSelector', () => {
	it('renders the header button', () => {
		render(<ContextSelector {...defaultProps} />);
		const headerButton = screen.getByRole('button');
		expect(headerButton).toBeInTheDocument();
	});

	it('shows "Select context" when no context is set', () => {
		render(<ContextSelector {...defaultProps} />);
		expect(screen.getByText('Select context')).toBeInTheDocument();
	});

	it('shows context title when context is set', () => {
		const context: ChatContext = {
			type: 'exercise',
			id: 1,
			title: 'Sorting Algorithms',
			locked: false,
			source: 'user-selected',
		};
		render(<ContextSelector {...defaultProps} context={context} />);
		expect(screen.getByText(/Sorting Algorithms/)).toBeInTheDocument();
	});

	it('opens dropdown when header button clicked', async () => {
		render(<ContextSelector {...defaultProps} />);
		const headerButton = screen.getByRole('button');
		await userEvent.click(headerButton);
		expect(screen.getByPlaceholderText('Search exercises or courses...')).toBeInTheDocument();
	});

	it('closes dropdown when header button clicked again', async () => {
		render(<ContextSelector {...defaultProps} />);
		const headerButton = screen.getByRole('button');

		await userEvent.click(headerButton);
		expect(screen.getByPlaceholderText('Search exercises or courses...')).toBeInTheDocument();

		await userEvent.click(headerButton);
		expect(screen.queryByPlaceholderText('Search exercises or courses...')).not.toBeInTheDocument();
	});

	it('displays exercises in dropdown', async () => {
		const exercises = [
			makeContextItem(1, 'Bubble Sort'),
			makeContextItem(2, 'Binary Search'),
		];
		render(<ContextSelector {...defaultProps} exercises={exercises} />);

		await userEvent.click(screen.getByRole('button'));

		expect(screen.getByText('Bubble Sort')).toBeInTheDocument();
		expect(screen.getByText('Binary Search')).toBeInTheDocument();
	});

	it('displays courses in dropdown', async () => {
		const courses = [
			makeContextItem(10, 'Introduction to Programming'),
			makeContextItem(11, 'Data Structures'),
		];
		render(<ContextSelector {...defaultProps} courses={courses} />);

		await userEvent.click(screen.getByRole('button'));

		expect(screen.getByText('Introduction to Programming')).toBeInTheDocument();
		expect(screen.getByText('Data Structures')).toBeInTheDocument();
	});

	it('calls onSelectContext with exercise data when exercise item clicked', async () => {
		const onSelectContext = vi.fn();
		const exercises = [makeContextItem(42, 'Quick Sort', { shortName: 'qs' })];
		render(
			<ContextSelector
				{...defaultProps}
				onSelectContext={onSelectContext}
				exercises={exercises}
			/>
		);

		await userEvent.click(screen.getByRole('button'));
		await userEvent.click(screen.getByText('Quick Sort'));

		expect(onSelectContext).toHaveBeenCalledWith('exercise', 42, 'Quick Sort', 'qs');
	});

	it('closes dropdown after selecting an exercise', async () => {
		const exercises = [makeContextItem(1, 'Merge Sort')];
		render(<ContextSelector {...defaultProps} exercises={exercises} />);

		await userEvent.click(screen.getByRole('button'));
		await userEvent.click(screen.getByText('Merge Sort'));

		expect(screen.queryByPlaceholderText('Search exercises or courses...')).not.toBeInTheDocument();
	});

	it('filters exercises when searching', async () => {
		const exercises = [
			makeContextItem(1, 'Bubble Sort'),
			makeContextItem(2, 'Merge Sort'),
			makeContextItem(3, 'Binary Tree'),
		];
		render(<ContextSelector {...defaultProps} exercises={exercises} />);

		await userEvent.click(screen.getByRole('button'));
		const searchInput = screen.getByPlaceholderText('Search exercises or courses...');
		await userEvent.type(searchInput, 'sort');

		expect(screen.getByText('Bubble Sort')).toBeInTheDocument();
		expect(screen.getByText('Merge Sort')).toBeInTheDocument();
		expect(screen.queryByText('Binary Tree')).not.toBeInTheDocument();
	});

	it('shows sessions list when context is set', async () => {
		const context: ChatContext = {
			type: 'exercise',
			id: 1,
			title: 'Sorting Algorithms',
			locked: false,
			source: 'user-selected',
		};
		const sessions = [makeSession('session-1', 5)];
		render(
			<ContextSelector
				{...defaultProps}
				context={context}
				sessions={sessions}
				activeSessionId="session-1"
			/>
		);

		await userEvent.click(screen.getByRole('button', { name: /Sorting Algorithms/ }));

		expect(screen.getByText('Preview of session session-1')).toBeInTheDocument();
	});

	it('shows "New Conversation" button when context is set', async () => {
		const context: ChatContext = {
			type: 'exercise',
			id: 1,
			title: 'Test Exercise',
			locked: false,
			source: 'user-selected',
		};
		const sessions = [makeSession('s1', 3)];
		render(
			<ContextSelector
				{...defaultProps}
				context={context}
				sessions={sessions}
				activeSessionId="s1"
			/>
		);

		await userEvent.click(screen.getByRole('button', { name: /Test Exercise/ }));
		expect(screen.getByText('New Conversation')).toBeInTheDocument();
	});

	it('calls onCreateNewSession when New Conversation clicked', async () => {
		const onCreateNewSession = vi.fn();
		const context: ChatContext = {
			type: 'exercise',
			id: 1,
			title: 'Test Exercise',
			locked: false,
			source: 'user-selected',
		};
		const sessions = [makeSession('s1', 3)];
		render(
			<ContextSelector
				{...defaultProps}
				context={context}
				sessions={sessions}
				activeSessionId="s1"
				onCreateNewSession={onCreateNewSession}
			/>
		);

		await userEvent.click(screen.getByRole('button', { name: /Test Exercise/ }));
		await userEvent.click(screen.getByText('New Conversation'));

		expect(onCreateNewSession).toHaveBeenCalledOnce();
	});

	it('shows empty state message when no exercises or courses match search', async () => {
		render(
			<ContextSelector
				{...defaultProps}
				exercises={[makeContextItem(1, 'Bubble Sort')]}
			/>
		);

		await userEvent.click(screen.getByRole('button'));
		const searchInput = screen.getByPlaceholderText('Search exercises or courses...');
		await userEvent.type(searchInput, 'zzznomatch');

		expect(screen.getByText('No exercises or courses found')).toBeInTheDocument();
	});

	it('calls onSelectSession when a session is clicked', async () => {
		const onSelectSession = vi.fn();
		const context: ChatContext = {
			type: 'exercise',
			id: 1,
			title: 'Exercise',
			locked: false,
			source: 'user-selected',
		};
		const sessions = [makeSession('session-abc', 3)];
		render(
			<ContextSelector
				{...defaultProps}
				context={context}
				sessions={sessions}
				activeSessionId="session-abc"
				onSelectSession={onSelectSession}
			/>
		);

		await userEvent.click(screen.getByRole('button', { name: /Exercise/ }));
		await userEvent.click(screen.getByText('Preview of session session-abc'));

		expect(onSelectSession).toHaveBeenCalledWith('session-abc');
	});

	it('shows course shortName as tag next to exercises', async () => {
		const exercises = [makeContextItem(1, 'Bubble Sort', { courseId: 99 })];
		const courses = [makeContextItem(99, 'Algorithms', { shortName: 'ALG' })];
		render(
			<ContextSelector
				{...defaultProps}
				exercises={exercises}
				courses={courses}
			/>
		);
		await userEvent.click(screen.getByRole('button'));
		expect(screen.getByText('Bubble Sort')).toBeInTheDocument();
		expect(screen.getByText('ALG')).toBeInTheDocument();
	});

	it('hides sessions section when search is active', async () => {
		const context: ChatContext = {
			type: 'exercise',
			id: 1,
			title: 'Ex',
			locked: false,
			source: 'user-selected',
		};
		const sessions = [makeSession('s1', 3)];
		render(
			<ContextSelector
				{...defaultProps}
				context={context}
				sessions={sessions}
				activeSessionId="s1"
				exercises={[makeContextItem(1, 'Ex')]}
			/>
		);
		await userEvent.click(screen.getByRole('button', { name: /Ex/ }));
		expect(screen.getByText('Preview of session s1')).toBeInTheDocument();
		await userEvent.type(screen.getByPlaceholderText('Search exercises or courses...'), 'ex');
		expect(screen.queryByText('Preview of session s1')).not.toBeInTheDocument();
	});
});
