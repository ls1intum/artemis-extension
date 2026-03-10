import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
	ChatContext,
	ChatSession,
	ContextItem,
} from '../../../../../src/views/webview/react/views/IrisChat/types';
import { ContextSelector } from '../../../../../src/views/webview/react/views/IrisChat/components/ContextSelector';

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
	recentExercises: [],
	recentCourses: [],
	allExercises: [],
	allCourses: [],
	forceContextPicker: false,
	onSelectContext: vi.fn(),
	onSelectSession: vi.fn(),
	onCreateNewSession: vi.fn(),
	onSwitchToWorkspace: vi.fn(),
	onSwitchContext: vi.fn(),
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
		expect(screen.getByText('Sorting Algorithms')).toBeInTheDocument();
	});

	it('opens dropdown when header button clicked', async () => {
		render(<ContextSelector {...defaultProps} />);
		const headerButton = screen.getByRole('button');
		await userEvent.click(headerButton);
		// Search input appears when dropdown is open
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

	it('displays recent exercises in context picker mode (no context)', async () => {
		const exercises = [
			makeContextItem(1, 'Bubble Sort'),
			makeContextItem(2, 'Binary Search'),
		];
		render(<ContextSelector {...defaultProps} recentExercises={exercises} allExercises={exercises} />);

		await userEvent.click(screen.getByRole('button'));

		expect(screen.getByText('Bubble Sort')).toBeInTheDocument();
		expect(screen.getByText('Binary Search')).toBeInTheDocument();
	});

	it('displays recent courses in context picker mode (no context)', async () => {
		const courses = [
			makeContextItem(10, 'Introduction to Programming'),
			makeContextItem(11, 'Data Structures'),
		];
		render(<ContextSelector {...defaultProps} recentCourses={courses} allCourses={courses} />);

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
				recentExercises={exercises}
				allExercises={exercises}
			/>
		);

		await userEvent.click(screen.getByRole('button'));
		await userEvent.click(screen.getByText('Quick Sort'));

		expect(onSelectContext).toHaveBeenCalledWith('exercise', 42, 'Quick Sort', 'qs');
	});

	it('closes dropdown after selecting an exercise', async () => {
		const exercises = [makeContextItem(1, 'Merge Sort')];
		render(
			<ContextSelector
				{...defaultProps}
				recentExercises={exercises}
				allExercises={exercises}
			/>
		);

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
		render(
			<ContextSelector
				{...defaultProps}
				allExercises={exercises}
				recentExercises={exercises}
			/>
		);

		await userEvent.click(screen.getByRole('button'));
		const searchInput = screen.getByPlaceholderText('Search exercises or courses...');
		await userEvent.type(searchInput, 'sort');

		expect(screen.getByText('Bubble Sort')).toBeInTheDocument();
		expect(screen.getByText('Merge Sort')).toBeInTheDocument();
		expect(screen.queryByText('Binary Tree')).not.toBeInTheDocument();
	});

	it('shows sessions list when context is already set', async () => {
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

		await userEvent.click(screen.getByText('Sorting Algorithms'));

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

		await userEvent.click(screen.getByText('Test Exercise'));
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

		await userEvent.click(screen.getByText('Test Exercise'));
		await userEvent.click(screen.getByText('New Conversation'));

		expect(onCreateNewSession).toHaveBeenCalledOnce();
	});

	it('shows empty state message when no exercises or courses match search', async () => {
		render(
			<ContextSelector
				{...defaultProps}
				allExercises={[makeContextItem(1, 'Bubble Sort')]}
				recentExercises={[makeContextItem(1, 'Bubble Sort')]}
			/>
		);

		await userEvent.click(screen.getByRole('button'));
		const searchInput = screen.getByPlaceholderText('Search exercises or courses...');
		await userEvent.type(searchInput, 'zzznomatch');

		expect(screen.getByText('No exercises or courses found')).toBeInTheDocument();
	});

	it('displays "Switch to Different Context" button in session list mode', async () => {
		const context: ChatContext = {
			type: 'exercise',
			id: 1,
			title: 'My Exercise',
			locked: false,
			source: 'user-selected',
		};
		render(
			<ContextSelector
				{...defaultProps}
				context={context}
				sessions={[makeSession('s1', 1)]}
				activeSessionId="s1"
			/>
		);

		await userEvent.click(screen.getByText('My Exercise'));
		expect(screen.getByText('Switch to Different Context')).toBeInTheDocument();
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

		await userEvent.click(screen.getByText('Exercise'));
		await userEvent.click(screen.getByText('Preview of session session-abc'));

		expect(onSelectSession).toHaveBeenCalledWith('session-abc');
	});
});
