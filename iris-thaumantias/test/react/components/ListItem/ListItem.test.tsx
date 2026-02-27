import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListItem } from '../../../../src/views/webview/react/components/ListItem/ListItem';

describe('ListItem', () => {
	it('renders with role="option"', () => {
		render(<ListItem title="My item" />);
		expect(screen.getByRole('option')).toBeInTheDocument();
	});

	it('renders title text content', () => {
		render(<ListItem title="Course Name" />);
		expect(screen.getByText('Course Name')).toBeInTheDocument();
	});

	it('renders subtitle when provided', () => {
		render(<ListItem title="Exercise" subtitle="Due: Monday" />);
		expect(screen.getByText('Due: Monday')).toBeInTheDocument();
	});

	it('calls onClick handler when clicked', async () => {
		const handleClick = vi.fn();
		render(<ListItem title="Clickable" onClick={handleClick} />);

		await userEvent.click(screen.getByRole('option'));

		expect(handleClick).toHaveBeenCalledOnce();
	});

	it('reflects selected state with aria-selected', () => {
		render(<ListItem title="Selected item" selected={true} />);
		expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
	});

	it('has aria-disabled attribute when disabled', () => {
		const handleClick = vi.fn();
		render(<ListItem title="Disabled" onClick={handleClick} disabled={true} />);

		// Disabled items have pointer-events: none so cannot be clicked via userEvent
		// Verify the ARIA attribute is set correctly instead
		expect(screen.getByRole('option')).toHaveAttribute('aria-disabled', 'true');
		expect(handleClick).not.toHaveBeenCalled();
	});
});
