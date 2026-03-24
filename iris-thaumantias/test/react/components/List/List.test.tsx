import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { List } from '../../../../src/webview/components/List/List';
import { ListItem } from '../../../../src/webview/components/ListItem/ListItem';

describe('List', () => {
	it('renders with role="listbox"', () => {
		render(
			<List ariaLabel="Items">
				<ListItem title="First" />
			</List>
		);
		expect(screen.getByRole('listbox', { name: 'Items' })).toBeInTheDocument();
	});

	it('renders child ListItem components', () => {
		render(
			<List ariaLabel="Course list">
				<ListItem title="Course A" />
				<ListItem title="Course B" />
			</List>
		);
		expect(screen.getByText('Course A')).toBeInTheDocument();
		expect(screen.getByText('Course B')).toBeInTheDocument();
	});

	it('accepts ariaLabel prop for accessibility', () => {
		render(
			<List ariaLabel="Navigation items">
				<ListItem title="Home" />
			</List>
		);
		const listbox = screen.getByRole('listbox');
		expect(listbox).toHaveAttribute('aria-label', 'Navigation items');
	});

	it('calls onSelect when Enter key is pressed on selected item', async () => {
		const handleSelect = vi.fn();
		render(
			<List ariaLabel="Items" onSelect={handleSelect}>
				<ListItem title="Item 1" />
			</List>
		);

		const listbox = screen.getByRole('listbox');
		listbox.focus();
		await userEvent.keyboard('{Enter}');

		expect(handleSelect).toHaveBeenCalledWith(0);
	});

	it('navigates between items with arrow keys', async () => {
		render(
			<List ariaLabel="Nav list">
				<ListItem title="Item A" />
				<ListItem title="Item B" />
			</List>
		);

		const listbox = screen.getByRole('listbox');
		listbox.focus();
		await userEvent.keyboard('{ArrowDown}');

		// After ArrowDown, activedescendant should point to index 1
		expect(listbox).toHaveAttribute('aria-activedescendant', 'list-item-1');
	});
});
