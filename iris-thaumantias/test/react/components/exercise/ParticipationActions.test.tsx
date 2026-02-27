import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ParticipationActions } from '../../../../src/views/webview/react/components/exercise/ParticipationActions';

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
					hasRepository={true}
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
					onSubmit={handleSubmit}
				/>
			);

			await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

			expect(handleSubmit).toHaveBeenCalledOnce();
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
