import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorMessage } from '../../../../src/views/webview/react/components/ErrorMessage/ErrorMessage';

describe('ErrorMessage', () => {
	it('displays the error message text', () => {
		render(<ErrorMessage error="Failed to load courses." onRetry={vi.fn()} />);
		expect(screen.getByText('Failed to load courses.')).toBeInTheDocument();
	});

	it('renders a Retry button', () => {
		render(<ErrorMessage error="Something went wrong." onRetry={vi.fn()} />);
		expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
	});

	it('calls onRetry handler when retry button is clicked', async () => {
		const handleRetry = vi.fn();
		render(<ErrorMessage error="Network error." onRetry={handleRetry} />);

		await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

		expect(handleRetry).toHaveBeenCalledOnce();
	});

	it('renders different error messages correctly', () => {
		const { rerender } = render(<ErrorMessage error="Error A" onRetry={vi.fn()} />);
		expect(screen.getByText('Error A')).toBeInTheDocument();

		rerender(<ErrorMessage error="Error B" onRetry={vi.fn()} />);
		expect(screen.getByText('Error B')).toBeInTheDocument();
	});
});
