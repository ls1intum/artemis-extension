import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ParticipationActions } from '@webview/components/exercise/ParticipationActions';

describe('ParticipationActions', () => {
	describe('programming exercise - not started', () => {
		it('renders "Start Exercise" button when not participated', () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="not-started"
				/>
			);
			expect(screen.getByRole('button', { name: 'Start Exercise' })).toBeInTheDocument();
		});

		it('calls onStart when Start Exercise clicked', async () => {
			const handleStart = vi.fn();
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="not-started"
					onStart={handleStart}
				/>
			);

			await userEvent.click(screen.getByRole('button', { name: 'Start Exercise' }));

			expect(handleStart).toHaveBeenCalledOnce();
		});

		it('shows "Not Participating Yet" participation info', () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="not-started"
				/>
			);
			expect(screen.getByText('Not Participating Yet')).toBeInTheDocument();
		});
	});

	describe('programming exercise - in progress', () => {
		it('renders "Clone Repository" button when participating', () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
				/>
			);
			expect(screen.getByRole('button', { name: 'Clone Repository' })).toBeInTheDocument();
		});

		it('shows "Repository Ready" participation info', () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
				/>
			);
			expect(screen.getByText('Repository Ready')).toBeInTheDocument();
		});

		it('renders Submit button when canSubmit is true', () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					canSubmit={true}
					workspaceStatus="dirty"
				/>
			);
			expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
		});

		it('does not render Submit button when canSubmit is false', () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					canSubmit={false}
				/>
			);
			expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
		});

		it('calls onSubmit when Submit button clicked', async () => {
			const handleSubmit = vi.fn();
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					canSubmit={true}
					workspaceStatus="dirty"
					onSubmit={handleSubmit}
				/>
			);

			await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

			expect(handleSubmit).toHaveBeenCalledOnce();
		});

		it('calls onToggleCommitMessage when commit message button clicked', async () => {
			const handleToggle = vi.fn();
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					canSubmit={true}
					workspaceStatus="dirty"
					onToggleCommitMessage={handleToggle}
				/>
			);

			const submitGroup = screen.getByRole('button', { name: 'Submit' }).parentElement!;
			const mailBtn = submitGroup.querySelector('button:last-child')!;
			await userEvent.click(mailBtn);

			expect(handleToggle).toHaveBeenCalledOnce();
		});

		it('shows commit message input when showCommitMessageInput is true', () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					canSubmit={true}
					showCommitMessageInput={true}
				/>
			);
			expect(screen.getByPlaceholderText('Enter commit message...')).toBeInTheDocument();
		});

		it('hides commit message input when showCommitMessageInput is false', () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					canSubmit={true}
					showCommitMessageInput={false}
				/>
			);
			expect(screen.queryByPlaceholderText('Enter commit message...')).not.toBeInTheDocument();
		});

		it('shows unsaved changes banner when hasUnsavedChanges is true', () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					hasUnsavedChanges={true}
				/>
			);
			expect(screen.getByText(/Unsaved changes detected/)).toBeInTheDocument();
		});

		it('shows Practice Mode indicator when isPracticeMode is true', () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					isPracticeMode={true}
				/>
			);
			expect(screen.getByText(/Practice Mode/)).toBeInTheDocument();
		});
	});

	describe('programming exercise - workspace-aware clone visibility', () => {
		it('shows Clone as standalone button when workspaceStatus is "disconnected"', () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					workspaceStatus="disconnected"
				/>
			);
			expect(screen.getByRole('button', { name: 'Clone Repository' })).toBeInTheDocument();
		});

		it('hides standalone Clone button when workspaceStatus is "clean"', () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					workspaceStatus="clean"
				/>
			);
			expect(screen.queryByRole('button', { name: 'Clone Repository' })).not.toBeInTheDocument();
		});

		it('hides standalone Clone button when workspaceStatus is "dirty"', () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					workspaceStatus="dirty"
				/>
			);
			expect(screen.queryByRole('button', { name: 'Clone Repository' })).not.toBeInTheDocument();
		});

		it('shows Clone in dropdown when workspace is connected', async () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					workspaceStatus="clean"
				/>
			);
			await userEvent.click(screen.getByRole('button', { name: /More options/ }));
			// The dropdown Clone is a plain <button>, not a Button component
			const dropdownClone = screen.getByText('Clone Repository');
			expect(dropdownClone).toBeInTheDocument();
			expect(dropdownClone.tagName).toBe('BUTTON');
		});

		it('shows "Check workspace status" in dropdown', async () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
				/>
			);
			await userEvent.click(screen.getByRole('button', { name: /More options/ }));
			expect(screen.getByText('Check workspace status')).toBeInTheDocument();
		});

		it('calls onCheckWorkspace when "Check workspace status" clicked', async () => {
			const handleCheckWorkspace = vi.fn();
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					onCheckWorkspace={handleCheckWorkspace}
				/>
			);

			await userEvent.click(screen.getByRole('button', { name: /More options/ }));
			await userEvent.click(screen.getByText('Check workspace status'));

			expect(handleCheckWorkspace).toHaveBeenCalledOnce();
		});
	});

	describe('Open Repository entry', () => {
		it('renders Open Repository entry and calls onOpenRepository when clicked', async () => {
			const onOpenRepository = vi.fn();
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					workspaceStatus="clean"
					onOpenRepository={onOpenRepository}
				/>
			);

			await userEvent.click(screen.getByRole('button', { name: /More options/i }));
			await userEvent.click(screen.getByRole('button', { name: /Open Repository/i }));

			expect(onOpenRepository).toHaveBeenCalledOnce();
		});

		it('hides Open Repository entry when onOpenRepository is not provided', async () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					workspaceStatus="clean"
				/>
			);

			await userEvent.click(screen.getByRole('button', { name: /More options/i }));
			expect(screen.queryByRole('button', { name: /Open Repository/i })).not.toBeInTheDocument();
		});
	});

	describe('more options dropdown', () => {
		it('toggles dropdown open and closed on click', async () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
				/>
			);
			const toggle = screen.getByRole('button', { name: /More options/ });

			// Initially closed
			expect(screen.queryByText('Pull Changes')).not.toBeInTheDocument();

			// Open
			await userEvent.click(toggle);
			expect(screen.getByText('Pull Changes')).toBeInTheDocument();

			// Close
			await userEvent.click(toggle);
			expect(screen.queryByText('Pull Changes')).not.toBeInTheDocument();
		});

		it('closes dropdown on Escape key', async () => {
			render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
				/>
			);

			await userEvent.click(screen.getByRole('button', { name: /More options/ }));
			expect(screen.getByText('Pull Changes')).toBeInTheDocument();

			await userEvent.keyboard('{Escape}');
			expect(screen.queryByText('Pull Changes')).not.toBeInTheDocument();
		});
	});

	describe('programming exercise - workspace status indicator', () => {
		it('renders workspace status with data-state="clean"', () => {
			const { container } = render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					workspaceStatus="clean"
				/>
			);
			const statusEl = container.querySelector('[data-state="clean"]');
			expect(statusEl).toBeInTheDocument();
			expect(screen.getByText('Workspace is up to date')).toBeInTheDocument();
		});

		it('renders workspace status with data-state="dirty"', () => {
			const { container } = render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					workspaceStatus="dirty"
				/>
			);
			const statusEl = container.querySelector('[data-state="dirty"]');
			expect(statusEl).toBeInTheDocument();
			expect(screen.getByText('Uncommitted changes detected')).toBeInTheDocument();
		});

		it('renders workspace status with data-state="disconnected"', () => {
			const { container } = render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
					workspaceStatus="disconnected"
				/>
			);
			const statusEl = container.querySelector('[data-state="disconnected"]');
			expect(statusEl).toBeInTheDocument();
			expect(screen.getByText('Repository not found in workspace')).toBeInTheDocument();
		});

		it('renders workspace status with data-state="checking" by default', () => {
			const { container } = render(
				<ParticipationActions
					exerciseType="programming"
					participationStatus="in-progress"
				/>
			);
			const statusEl = container.querySelector('[data-state="checking"]');
			expect(statusEl).toBeInTheDocument();
			expect(screen.getByText('Checking workspace status...')).toBeInTheDocument();
		});
	});

	describe('non-programming exercises', () => {
		it('shows "Open in browser" button for quiz exercise', () => {
			render(
				<ParticipationActions
					exerciseType="quiz"
					participationStatus="not-started"
				/>
			);
			expect(screen.getByRole('button', { name: 'Open in browser' })).toBeInTheDocument();
		});

		it('displays exercise type info for text exercise', () => {
			render(
				<ParticipationActions
					exerciseType="text"
					participationStatus="not-started"
				/>
			);
			expect(screen.getByText('Text Exercise')).toBeInTheDocument();
		});

		it('calls onOpenInBrowser for non-programming exercises', async () => {
			const handleOpenInBrowser = vi.fn();
			render(
				<ParticipationActions
					exerciseType="quiz"
					participationStatus="not-started"
					onOpenInBrowser={handleOpenInBrowser}
				/>
			);

			await userEvent.click(screen.getByRole('button', { name: 'Open in browser' }));

			expect(handleOpenInBrowser).toHaveBeenCalledOnce();
		});
	});
});
