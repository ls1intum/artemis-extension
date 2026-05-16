import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from '@webview/components/EmptyState/EmptyState';

describe('EmptyState', () => {
	it('renders the title text', () => {
		render(<EmptyState title="No results" message="Try adjusting filters." />);
		expect(screen.getByText('No results')).toBeInTheDocument();
	});

	it('renders the message text', () => {
		render(<EmptyState title="Nothing here" message="No items found." />);
		expect(screen.getByText('No items found.')).toBeInTheDocument();
	});

	it('renders action button when actionLabel and onAction are provided', () => {
		const handleAction = vi.fn();
		render(
			<EmptyState
				title="Empty"
				message="No data."
				actionLabel="Refresh"
				onAction={handleAction}
			/>
		);
		expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
	});

	it('calls onAction when action button is clicked', async () => {
		const handleAction = vi.fn();
		render(
			<EmptyState
				title="Empty"
				message="No data."
				actionLabel="Try again"
				onAction={handleAction}
			/>
		);

		await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

		expect(handleAction).toHaveBeenCalledOnce();
	});

	it('does not render action button when actionLabel is absent', () => {
		render(<EmptyState title="Empty" message="No items." />);
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});
});
