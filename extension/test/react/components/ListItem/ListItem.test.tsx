import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ListItem } from '@webview/components/ListItem/ListItem';

describe('ListItem', () => {
	it('renders with role="button", because a row navigates rather than being chosen from a set', () => {
		// `option` is only valid inside a `listbox`, and no caller provides one. axe
		// reports the missing parent as critical, so the role has to be the honest one.
		render(<ListItem title="My item" />);
		expect(screen.getByRole('button')).toBeInTheDocument();
		expect(screen.queryByRole('option')).not.toBeInTheDocument();
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

		await userEvent.click(screen.getByRole('button'));

		expect(handleClick).toHaveBeenCalledOnce();
	});

	it('marks the selected row with aria-current, which any role may carry', () => {
		render(<ListItem title="Selected item" selected={true} />);
		expect(screen.getByRole('button')).toHaveAttribute('aria-current', 'true');
	});

	it('says nothing about currency when the row is not the selected one', () => {
		render(<ListItem title="Plain item" />);
		expect(screen.getByRole('button')).not.toHaveAttribute('aria-current');
	});

	it('carries the test id a caller gives it, which is how the UI suite finds a row', () => {
		render(<ListItem title="Course" testId="course-entry-7" />);
		expect(screen.getByTestId('course-entry-7')).toBeInTheDocument();
	});

	it('has aria-disabled attribute when disabled', () => {
		render(<ListItem title="Disabled" disabled={true} />);
		expect(screen.getByRole('button')).toHaveAttribute('aria-disabled', 'true');
	});

	it('does not call onClick when disabled and clicked', () => {
		const handleClick = vi.fn();
		render(<ListItem title="Disabled" onClick={handleClick} disabled={true} />);

		// fireEvent bypasses CSS pointer-events:none and exercises the JS guard
		fireEvent.click(screen.getByRole('button'));

		expect(handleClick).not.toHaveBeenCalled();
	});
});
